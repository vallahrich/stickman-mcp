import fs from "node:fs/promises";
import path from "node:path";
import {
  BLUEPRINT_STAGE_STYLE,
  buildCompactPlayerPayload,
  compileAnimation,
  composeMovie,
  evaluateAnimationQuality,
  renderBlueprintPatternsSvg,
  renderHtml,
  renderMovieHtml
} from "../../dist/index.js";

const STUDIO_AXES = [
  { key: "propIntegrity", label: "Prop Integrity" },
  { key: "spatialContinuity", label: "Spatial Continuity" },
  { key: "stagingAndEyeTrace", label: "Staging & Eye-Trace" },
  { key: "pacingAndReadability", label: "Pacing & Readability" },
  { key: "kinematicAppeal", label: "Kinematic Appeal" },
  { key: "cinematography", label: "Cinematography" }
];

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function encodeJsonForScript(data) {
  return JSON.stringify(data)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

async function buildPreset(repoRoot, config) {
  const raw = JSON.parse(await fs.readFile(path.join(repoRoot, config.file), "utf8"));
  let target;
  let htmlBytes;
  if (config.kind === "movie") {
    const composed = composeMovie(raw);
    if (!composed.valid || !composed.movie) {
      throw new Error(`Studio preset ${config.id} failed to compose: ${JSON.stringify(composed.diagnostics)}`);
    }
    target = composed.movie;
    htmlBytes = Buffer.byteLength(renderMovieHtml(target), "utf8");
  } else {
    const compiled = compileAnimation(raw);
    if (!compiled.valid || !compiled.program) {
      throw new Error(`Studio preset ${config.id} failed to compile: ${JSON.stringify(compiled.diagnostics)}`);
    }
    target = compiled.program;
    htmlBytes = Buffer.byteLength(renderHtml(target), "utf8");
  }

  const critique = evaluateAnimationQuality(target);
  if (!critique.passed || critique.overallScore < 8.5) {
    throw new Error(
      `Studio preset ${config.id} failed quality bar: overallScore=${critique.overallScore}, passed=${critique.passed}`
    );
  }

  const standardPayload = buildCompactPlayerPayload(target, { style: "default" });
  const blueprintPayload = buildCompactPlayerPayload(target, { style: "blueprint" });

  return {
    id: config.id,
    label: config.label,
    contractTag: config.contractTag,
    summary: config.summary,
    initialMs: config.initialMs ?? 0,
    htmlBytes,
    critique: {
      overallScore: critique.overallScore,
      passed: critique.passed,
      grade: critique.grade,
      dimensions: critique.dimensions,
      outOfBoundsCount: critique.metrics.outOfBoundsCount,
      maxSeamStepPx: critique.metrics.maxSeamStepPx,
      sceneCount: critique.metrics.sceneCount
    },
    payloads: {
      default: standardPayload,
      blueprint: blueprintPayload
    }
  };
}

export async function studioSection(repoRoot) {
  const presets = await Promise.all([
    buildPreset(repoRoot, {
      id: "warroom-movie",
      label: "3-Scene Incident Movie",
      contractTag: "stickman.movie/v1 · 1280×720",
      file: "examples/v3-incident-warroom-movie.json",
      kind: "movie",
      initialMs: 800,
      summary:
        "3-scene incident recovery movie with war-room, datacenter, and office backdrops, 2.5D depth planes, spotlight focus, auto-director camera, editorial callouts, and fade/wipe transitions."
    }),
    buildPreset(repoRoot, {
      id: "handoff-stairs",
      label: "Shared Handoff & Stairs",
      contractTag: "stickman.animation/v2 · 800×450",
      file: "examples/v3-handoff-and-stairs.json",
      kind: "animation",
      initialMs: 1200,
      summary:
        "2-actor cue-synced choreography transferring a single shared card prop across actors before ascending stairs, celebrating elevated on the landing, and descending."
    }),
    buildPreset(repoRoot, {
      id: "ballistic-sports",
      label: "Ballistic Sports",
      contractTag: "stickman.animation/v2 · 800×450",
      file: "examples/v2-sports-addons.json",
      kind: "animation",
      initialMs: 1100,
      summary:
        "Hurdle clearance into a parabolic basketball arc toward the right-facing hoop, finishing with an expressive celebration using curved Bezier spine and hand glyphs."
    })
  ]);

  const first = presets[0];
  const firstDurSec = (first.payloads.default.dur / 1000).toFixed(2);
  const firstInitSec = (first.initialMs / 1000).toFixed(2);
  const firstKb = (first.htmlBytes / 1024).toFixed(1);
  const bpDefsMarkup = `${renderBlueprintPatternsSvg()}<style>${BLUEPRINT_STAGE_STYLE}</style>`;

  const studioBundle = {
    bpDefsMarkup,
    axes: STUDIO_AXES,
    presets
  };

  const presetButtonsHtml = presets
    .map(
      (preset, index) =>
        `<button type="button" class="studio-preset-btn" data-studio-preset="${escapeHtml(preset.id)}" aria-pressed="${index === 0 ? "true" : "false"}">${escapeHtml(preset.label)}</button>`
    )
    .join("");

  const axesHtml = STUDIO_AXES.map((axis) => {
    const val = Number(first.critique.dimensions[axis.key] ?? 0);
    const pct = Math.max(0, Math.min(100, Math.round((val / 10) * 100)));
    return `<li class="studio-axis-row" data-studio-axis="${escapeHtml(axis.key)}">
      <div class="studio-axis-head">
        <span>${escapeHtml(axis.label)}</span>
        <strong class="studio-axis-val">${val.toFixed(1)} / 10</strong>
      </div>
      <div class="studio-axis-track" role="progressbar" aria-label="${escapeHtml(axis.label)}" aria-valuemin="0" aria-valuemax="10" aria-valuenow="${val.toFixed(1)}">
        <div class="studio-axis-fill" style="width:${pct}%"></div>
      </div>
    </li>`;
  }).join("");

  return `<section class="section" id="studio">
  <div class="section-heading">
    <div>
      <p class="eyebrow">v0.3.1 · Live Movie, Camera &amp; Critique Studio</p>
      <h2>Interactive vector player &amp; 6-axis critique.</h2>
    </div>
    <p class="quiet">Runs the shipping <code>COMPACT_CLIENT_RENDERER_JS</code> runtime directly on compiled <code>stickman.movie/v1</code> and <code>v2</code> payloads—curved spines, gaze cues, hand glyphs, virtual camera, depth planes, spotlight, and editorial callouts with zero external requests.</p>
  </div>
  <div class="studio-shell">
    <div class="studio-toolbar">
      <div class="studio-presets" role="group" aria-label="Studio animation presets">${presetButtonsHtml}</div>
      <div class="studio-style-group" role="group" aria-label="Studio visual style">
        <button type="button" class="studio-style-btn" data-studio-style="default" aria-pressed="true">Standard</button>
        <button type="button" class="studio-style-btn" data-studio-style="blueprint" aria-pressed="false">Blueprint CAD</button>
      </div>
    </div>
    <p id="studioPresetSummary" class="quiet" aria-live="polite">${escapeHtml(first.summary)}</p>
    <div class="studio-workspace">
      <div class="studio-player-card">
        <div id="studioStage" class="studio-stage" data-studio-stage="true"></div>
        <div id="studioChapters" class="studio-chapters" aria-label="Movie scene chapters"></div>
        <div class="studio-controls">
          <button type="button" id="studioToggle" aria-pressed="false">Play</button>
          <input type="range" id="studioSeek" min="0" max="${first.payloads.default.dur}" step="10" value="${first.initialMs}" aria-label="Studio timeline scrubber">
          <output id="studioTimecode" class="metric-pill" data-timecode="true">${escapeHtml(firstInitSec)}s / ${escapeHtml(firstDurSec)}s</output>
        </div>
      </div>
      <aside class="studio-critique-card" id="studioCritiqueCard" aria-label="Six-axis stickman_critique quality report">
        <div class="studio-critique-head">
          <div>
            <p class="eyebrow">stickman_critique</p>
            <h3>6-Axis Quality Card</h3>
          </div>
          <span id="studioOverallBadge" class="studio-overall-badge studio-pass" data-studio-overall="true">${first.critique.overallScore.toFixed(1)} / 10 · ${first.critique.passed ? "PASS" : "POLISH"}</span>
        </div>
        <div class="studio-meta-pills">
          <span id="studioContractPill" class="metric-pill">${escapeHtml(first.contractTag)}</span>
          <span id="studioSizePill" class="metric-pill">${escapeHtml(firstKb)} KB HTML</span>
          <span id="studioOobPill" class="metric-pill metric-pass">${first.critique.outOfBoundsCount} out-of-bounds</span>
        </div>
        <ul class="studio-axes" id="studioAxes">${axesHtml}</ul>
      </aside>
    </div>
  </div>
  <script id="studioData" type="application/json">${encodeJsonForScript(studioBundle)}</script>
</section>`;
}
