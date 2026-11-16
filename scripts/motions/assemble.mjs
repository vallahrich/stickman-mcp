import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildKeyPoseClip, keyPoseGates } from "./keypose.mjs";
import { anatomicalGates } from "./helpers.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const includeCandidates = process.argv.includes("--include-candidates");
const outDirIndex = process.argv.indexOf("--out-dir");
const reportDir = outDirIndex >= 0 ? process.argv[outDirIndex + 1] : null;
const baselineIds = ["idle", "jump", "point", "run", "stop", "walk"];
const baselineSet = new Set(baselineIds);

const ALIASES = {
  kick: "kick-ball",
  throw: "throw-ball",
  "pull-banner": "pull-banner-top"
};

const VARIANTS = {
  throw: ["basketball-shot"],
  "pull-banner": ["pull-banner-bottom", "pull-banner-left", "pull-banner-right"]
};

const GROUP_TO_CATEGORY = {
  "Basic (moving & postures)": "basic",
  "Gestures & emotions": "gestures",
  Presentation: "presentation",
  IT: "it",
  "Work & objects": "work",
  "Sport & action": "sport"
};

const VARIANT_META = {
  "basketball-shot": { category: "sport", group: "Sport & action", wave: "W8" },
  "kick-ball": { category: "sport", group: "Sport & action", wave: "W8" },
  "throw-ball": { category: "work", group: "Work & objects", wave: "W7" },
  "pull-banner-bottom": { category: "presentation", group: "Presentation", wave: "W2" },
  "pull-banner-left": { category: "presentation", group: "Presentation", wave: "W2" },
  "pull-banner-right": { category: "presentation", group: "Presentation", wave: "W2" },
  "pull-banner-top": { category: "presentation", group: "Presentation", wave: "W2" },
  "static-pose": { category: "basic", group: "Basic (moving & postures)", wave: "done" }
};

async function loadLedgerMetadata() {
  const map = new Map();
  try {
    const planText = await readFile(path.join(repo, "docs", "motion-catalog-plan.md"), "utf8");
    let currentGroup = "Basic (moving & postures)";
    for (const line of planText.split(/\r?\n/)) {
      const groupMatch = line.match(/^###\s+(.+?)\s*\(\d+\)/);
      if (groupMatch) {
        currentGroup = groupMatch[1].trim();
        continue;
      }
      const rowMatch = line.match(/^\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|/);
      if (rowMatch) {
        const id = rowMatch[1].trim();
        const status = rowMatch[2].trim();
        const wave = rowMatch[3].trim();
        map.set(id, {
          status,
          category: GROUP_TO_CATEGORY[currentGroup] ?? "basic",
          group: currentGroup,
          wave
        });
      }
    }
    return map;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const fallback = JSON.parse(await readFile(path.join(repo, "motions", "catalogue.json"), "utf8"));
    for (const row of fallback.rows ?? []) {
      map.set(row.id, {
        status: row.status,
        category: GROUP_TO_CATEGORY[row.family] ?? "basic",
        group: row.family ?? "Basic (moving & postures)",
        wave: "done"
      });
    }
    return map;
  }
}

const ledgerMap = await loadLedgerMetadata();
function resolvePlanInfo(id) {
  return ledgerMap.get(id) ?? VARIANT_META[id] ?? { status: undefined, category: "basic", group: "Basic (moving & postures)", wave: "done" };
}

const approvedLedgerSet = new Set();
for (const [id, info] of ledgerMap.entries()) {
  if (info.status === "user-approved") {
    approvedLedgerSet.add(id);
    if (ALIASES[id]) approvedLedgerSet.add(ALIASES[id]);
    for (const variantId of VARIANTS[id] ?? []) approvedLedgerSet.add(variantId);
  }
}

const baselinesRaw = JSON.parse(await readFile(path.join(repo, "motions", "baselines.json"), "utf8"));
const baselineClips = baselinesRaw.clips ?? baselinesRaw;
const idleFrame = baselineClips.idle.frames[0];

const specsDir = path.join(repo, "motions", "specs");
const specFiles = (await readdir(specsDir)).filter((file) => file.endsWith(".json")).sort((a, b) => a.localeCompare(b));
const specsById = new Map();
for (const file of specFiles) {
  const parsed = JSON.parse(await readFile(path.join(specsDir, file), "utf8"));
  specsById.set(parsed.id, parsed);
}

const rig = baselinesRaw.rig ?? {
  units: "normalized-height-100",
  height: 100,
  thigh: 22.5,
  shin: 22.5,
  foot: 7,
  torso: 30,
  neck: 4,
  headRadius: 11,
  upperArm: 17,
  forearm: 16
};

const clipsMap = {};

for (const id of baselineIds) {
  const baseline = baselineClips[id];
  if (!baseline) throw new Error(`Missing baseline clip "${id}" in motions/baselines.json`);
  const copy = structuredClone(baseline);
  const plan = resolvePlanInfo(id);
  copy.meta = {
    ...copy.meta,
    category: plan.category,
    group: plan.group,
    wave: plan.wave
  };
  clipsMap[id] = copy;
}

function sanitizeTags(tags = []) {
  return tags.filter((tag) => !/^(candidate|approved|rework|review|draft)(?:-|$)/i.test(tag));
}

function buildClipMeta(id, displaySpec, sourceSpec, clip) {
  const plan = resolvePlanInfo(id);
  const label = displaySpec?.label ?? sourceSpec.label ?? id;
  return {
    id,
    label,
    summary: displaySpec?.summary ?? sourceSpec.summary ?? `${label} motion.`,
    category: displaySpec?.category ?? sourceSpec.category ?? plan.category,
    group: displaySpec?.group ?? sourceSpec.group ?? plan.group,
    wave: displaySpec?.wave ?? sourceSpec.wave ?? plan.wave,
    kind: sourceSpec.kind,
    travel: sourceSpec.travel,
    facingChange: sourceSpec.facingChange ?? 0,
    contacts: sourceSpec.contacts ?? ["lFoot", "rFoot"],
    markers: clip.markers ?? {},
    aim: sourceSpec.aim ?? null,
    prop: sourceSpec.prop ?? null,
    mirrorable: sourceSpec.mirrorable ?? true,
    tags: sanitizeTags(sourceSpec.tags ?? []),
    durationS: Number((clip.frames.length / clip.fps).toFixed(3)),
    quality: { assembled: true, keyPoseGates: true, passed: true },
    source: { dataset: "authored", authored: "key poses" },
    license: "Original key-pose animation (MIT) with CMU mocap neutral rig (mocap.cs.cmu.edu), see NOTICE and LICENSE"
  };
}

const candidateIds = new Set([...specsById.keys(), ...approvedLedgerSet]);
const requalification = [];

for (const id of [...candidateIds].sort((a, b) => a.localeCompare(b))) {
  if (baselineSet.has(id)) continue;
  const displaySpec = specsById.get(id);
  const sourceId = ALIASES[id] ?? id;
  const sourceSpec = specsById.get(sourceId) ?? displaySpec;
  if (!sourceSpec) continue;
  const isApproved = approvedLedgerSet.has(id) || displaySpec?.status === "user-approved";
  const isCandidate = includeCandidates && (
    displaySpec?.status === "candidate"
    || displaySpec?.status === "ai-reviewed"
    || ledgerMap.get(id)?.status === "candidate"
  );
  if (!isApproved && !isCandidate) continue;
  if (!Array.isArray(sourceSpec.poseKeys) || sourceSpec.poseKeys.length === 0) {
    console.warn(`Skipping ${id}: no authored poseKeys.`);
    continue;
  }
  const effectiveSpec = id === sourceSpec.id ? sourceSpec : { ...sourceSpec, id };
  const clip = buildKeyPoseClip(effectiveSpec, idleFrame);
  const kpGates = await keyPoseGates(clip, effectiveSpec);
  const anatFailures = anatomicalGates(clip, effectiveSpec).filter((gate) => !gate.pass);
  if (!kpGates.passed || anatFailures.length > 0) {
    requalification.push(id);
    console.warn(`Skipping ${id}: requires mechanical requalification (${kpGates.failures.map((f) => f.metric).concat(anatFailures.map((f) => f.name)).join(", ")}).`);
    continue;
  }
  clip.name = id;
  clip.source = { dataset: "authored", authored: "key poses" };
  clip.license = "Original key-pose animation (MIT), see LICENSE";
  clip.meta = buildClipMeta(id, displaySpec, sourceSpec, clip);
  clipsMap[id] = clip;
}

const sortedClips = Object.fromEntries(
  Object.entries(clipsMap).sort(([a], [b]) => a.localeCompare(b))
);

const library = { version: 1, fps: 30, rig, clips: sortedClips };

await mkdir(path.join(repo, "src", "generated"), { recursive: true });
await writeFile(
  path.join(repo, "src", "generated", "motion-library.ts"),
  `/* eslint-disable */\n// Generated by scripts/motions/assemble.mjs. Do not edit by hand.\nexport const GENERATED_MOTION_LIBRARY: any = ${JSON.stringify(library).replaceAll("<", "\\u003c")};\n`
);

const allSpecsSorted = [...specsById.values()].sort((a, b) => a.id.localeCompare(b.id));
const catalog = {
  version: 1,
  generatedFrom: "motions/specs/*.json",
  motions: allSpecsSorted.map((spec) => {
    const plan = resolvePlanInfo(spec.id);
    const isBaseline = baselineSet.has(spec.id);
    const effectiveStatus = isBaseline || approvedLedgerSet.has(spec.id)
      ? "user-approved"
      : (plan.status ?? spec.status);
    return {
      id: spec.id,
      label: spec.label,
      status: effectiveStatus,
      category: spec.category ?? plan.category,
      group: spec.group ?? plan.group,
      wave: spec.wave ?? plan.wave,
      kind: spec.kind,
      travel: spec.travel,
      prop: spec.prop ?? null,
      baseline: isBaseline,
      runtimeAssembled: Boolean(sortedClips[spec.id]),
      spec: `motions/specs/${spec.id}.json`
    };
  })
};

await writeFile(path.join(repo, "motions", "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);

if (reportDir) {
  await mkdir(reportDir, { recursive: true });
  await writeFile(
    path.join(reportDir, "assembled-report.json"),
    `${JSON.stringify({ includeCandidates, count: Object.keys(sortedClips).length, clips: Object.keys(sortedClips), requalification }, null, 2)}\n`
  );
}

console.log(`Assembled ${Object.keys(sortedClips).length} clips (${includeCandidates ? "including candidates" : "user-approved only"}).`);