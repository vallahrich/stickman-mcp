import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildKeyPoseClip, keyPoseGates } from "../motions/keypose.mjs";
import { renderReviewHtml, renderStaticSvg } from "../motions/review-renderer.mjs";
import { RUNTIME_MOTION_LIBRARY, RUNTIME_ACTION_NAMES } from "../../dist/motion-library.js";

export const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const aliases = { kick: "kick-ball", throw: "throw-ball", "pull-banner": "pull-banner-top" };
const variants = { throw: ["basketball-shot"], "pull-banner": ["pull-banner-bottom", "pull-banner-left", "pull-banner-right"] };
const useCases = {
  "rack-server": ["cloud", "infrastructure", "datacenter", "digital services"],
  "plug-cable": ["network", "connectivity", "integration"],
  "open-laptop": ["developer", "digital workplace"],
  "type-at-desk": ["workflow", "software", "operations"],
  "video-call": ["collaboration", "digital services"],
  "frustrated-pc": ["incident", "service desk", "operations"],
  "tablet-tap": ["mobility", "field services"],
  "inspect-magnifier": ["diagnostics", "cybersecurity", "root cause"],
  "present": ["architecture", "cloud", "digital services"],
  "write-board": ["architecture", "workshop"],
  "check-watch": ["service level", "operations"]
};
export function parseCatalogue(markdown) {
  let family = "";
  const rows = [];
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^### (.+) \(\d+\)$/);
    if (heading) family = heading[1];
    const row = line.match(/^\| `([^`]+)` \| ([^|]+) \| ([^|]+) \| (.*) \|$/);
    if (row) rows.push({ id: row[1], status: row[2].trim(), family, note: row[4].trim() });
  }
  if (rows.length !== 100 || new Set(rows.map(r => r.id)).size !== 100) throw new Error("Catalogue must contain 100 unique motion records");
  return rows;
}

export async function readMotion(id) {
  const sourceId = aliases[id] ?? id;
  const spec = JSON.parse(await fs.readFile(path.join(repo, "motions", "specs", `${sourceId}.json`), "utf8"));
  const neutral = RUNTIME_MOTION_LIBRARY.clips.idle.frames[0];
  const clip = spec.poseKeys?.length ? buildKeyPoseClip(spec, neutral) : RUNTIME_MOTION_LIBRARY.clips[sourceId];
  if (!clip) throw new Error(`No reproducible clip for ${id} (${sourceId})`);
  return { sourceId, spec, clip };
}

export async function buildCatalogue(output) {
  const rows = parseCatalogue(await fs.readFile(path.join(repo, "docs", "motion-catalog-plan.md"), "utf8"));
  const approved = rows.filter(r => r.status === "user-approved");
  const propsCatalog = JSON.parse(await fs.readFile(path.join(repo, "motions", "review-props.json"), "utf8"));
  const motions = [];
  await fs.mkdir(path.join(output, "motions"), { recursive: true });
  await fs.mkdir(path.join(output, "posters"), { recursive: true });
  await fs.mkdir(path.join(output, "specs"), { recursive: true });
  async function buildRecord(row) {
    const { sourceId, spec, clip } = await readMotion(row.id);
    const gates = spec.poseKeys?.length ? await keyPoseGates(clip, spec) : null;
    const report = { id: sourceId, status: row.status, frames: clip.frames.length, passed: gates?.passed ?? null, failures: gates?.failures ?? [], source: gates ? "current mechanical checks" : "runtime fixture; no new gate result asserted" };
    const frameIndex = Math.min(clip.frames.length - 1, Math.round(clip.frames.length * 0.42));
    const poster = await renderStaticSvg({ clip, spec, propsCatalog, frameIndex, width: 640, height: 420 });
    if (/NaN|Infinity/.test(poster)) throw new Error(`${row.id}: nonfinite rendered geometry`);
    await fs.writeFile(path.join(output, "posters", `${row.id}.svg`), poster);
    const review = await renderReviewHtml({ clip, spec, report, propsCatalog });
    const preview = review.replace("Candidate (shipping engine)", "Reviewed catalogue clip (shipping renderer)")
      .replace("</style>", "#refPanel{display:none}main{display:block}</style>");
    await fs.writeFile(path.join(output, "motions", `${row.id}.html`), preview);
    await fs.writeFile(path.join(output, "specs", `${row.id}.json`), JSON.stringify(spec, null, 2) + "\n");
    return {
      ...row, sourceId, label: spec.label ?? row.id, summary: spec.summary ?? `${row.id.replaceAll("-", " ")} motion`,
      tags: [...(spec.tags ?? []), ...(useCases[row.id] ?? [])], duration: +(clip.frames.length / clip.fps).toFixed(2), loop: Boolean(clip.loop),
      score: row.note.match(/\b(\d+(?:\.\d+)?)\/10\b/)?.[1] ?? null,
      runtimeIdAvailable: RUNTIME_ACTION_NAMES.includes(sourceId),
      mechanicalCheck: gates?.passed === false ? "needs-requalification" : gates ? "passed" : "runtime-fixture",
      poster: `posters/${row.id}.svg`, preview: `motions/${row.id}.html`, spec: `specs/${row.id}.json`
    };
  }
  for (const row of approved) {
    const motion = await buildRecord(row);
    motion.variants = [];
    for (const id of variants[row.id] ?? []) motion.variants.push(await buildRecord({ ...row, id }));
    motions.push(motion);
  }
  const catalogue = {
    name: "Stickman MCP", version: 1, publication: "private-preview", approvedCount: motions.length,
    runtimeMotionIds: RUNTIME_ACTION_NAMES, pending: rows.filter(r => r.status !== "user-approved"), motions,
    scope: "User-approved review catalogue. Runtime ID availability is not proof that the same reviewed revision and props have been promoted."
  };
  await fs.writeFile(path.join(output, "catalogue.json"), JSON.stringify(catalogue, null, 2) + "\n");
  return catalogue;
}
