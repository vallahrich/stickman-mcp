import fs from "node:fs/promises";
import path from "node:path";
import {
  analyzeStoryboard,
  compileAnimation,
  renderAnimatedSvg,
  renderStoryboardSvg,
  sampleAnimation
} from "../../dist/index.js";
import { createIsometricRoom, renderRoomBlueprintSvg } from "../../dist/room.js";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function assertCleanInlineSvg(svg, label) {
  if (!svg || !svg.startsWith("<svg ")) {
    throw new Error(`${label}: expected root <svg> markup.`);
  }
  if (/<script\b/i.test(svg)) {
    throw new Error(`${label}: inline blueprint SVG must remain scriptless.`);
  }
  if (/\b(?:NaN|Infinity|undefined)\b/.test(svg)) {
    throw new Error(`${label}: non-finite geometry token detected.`);
  }
}

export function scopeInlineSvg(rawSvg, prefix, { loop = false } = {}) {
  let svg = rawSvg.replace(/^<\?xml[^?]*\?>\s*/i, "").trim();
  svg = svg.replace(/^<svg\b/, `<svg id="${prefix}" class="inline-blueprint-svg"`);
  svg = svg
    .replaceAll('id="ground"', `id="${prefix}-ground"`)
    .replaceAll('id="sm-sb-clip"', `id="${prefix}-sb-clip"`)
    .replaceAll("url(#sm-sb-clip)", `url(#${prefix}-sb-clip)`)
    .replaceAll('id="sm-bp-grid"', `id="${prefix}-bp-grid"`)
    .replaceAll("url(#sm-bp-grid)", `url(#${prefix}-bp-grid)`);

  if (svg.includes("@keyframes sm-slice")) {
    svg = svg
      .replaceAll("sm-slice", `${prefix}-slice`)
      .replaceAll("sm-final", `${prefix}-final`)
      .replaceAll("sm-reduced", `${prefix}-reduced`)
      .replaceAll("sm-last", `${prefix}-last`)
      .replace(/\bsm-f\b/g, `${prefix}-f`);

    if (loop) {
      svg = svg
        .replace("steps(1,end) 0s 1 normal forwards", "steps(1,end) 0s infinite normal none")
        .replace(
          `.${prefix}-f.${prefix}-last{animation-name:${prefix}-final}`,
          `.${prefix}-f.${prefix}-last{animation:none;visibility:hidden}`
        );
    }

    const modeOverrideRule =
      `html[data-motion-mode="reduced"] #${prefix} .${prefix}-f,` +
      `html[data-motion-mode="static"] #${prefix} .${prefix}-f{animation:none!important;visibility:hidden!important}` +
      `html[data-motion-mode="reduced"] #${prefix} .${prefix}-reduced,` +
      `html[data-motion-mode="static"] #${prefix} .${prefix}-reduced{display:inline}`;
    svg = svg.replace("</style>", `${modeOverrideRule}</style>`);
  }

  svg = svg.replace(/<style>([\s\S]*?)<\/style>/g, (_full, cssBody) => {
    const scoped = cssBody.replace(/\.(?:sb|bp|rb)-[a-z0-9_-]+(?=\s*\{)/gi, (sel) => `#${prefix} ${sel}`);
    return `<style>${scoped}</style>`;
  });

  assertCleanInlineSvg(svg, prefix);
  return svg;
}

async function compileShowcaseExample(repoRoot, relativeFile) {
  const raw = JSON.parse(await fs.readFile(path.join(repoRoot, relativeFile), "utf8"));
  const compiled = compileAnimation(raw);
  if (!compiled.valid || !compiled.program) {
    throw new Error(`Failed to compile ${relativeFile}: ${JSON.stringify(compiled.diagnostics)}`);
  }
  const analysis = analyzeStoryboard(compiled.program);
  if (analysis.outOfBoundsCount !== 0) {
    throw new Error(`${relativeFile}: expected 0 out-of-bounds frames, received ${analysis.outOfBoundsCount}.`);
  }
  return { program: compiled.program, analysis };
}

function buildIsometricRoomSvg() {
  const canvas = { width: 980, height: 520 };
  const room = createIsometricRoom({
    width: 480,
    depth: 320,
    canvas,
    unitScale: 0.9,
    padding: 48,
    objects: [
      { id: "rack", x: 116, z: 32, width: 84, depth: 56, height: 92 },
      { id: "desk", x: 268, z: 116, width: 116, depth: 68, height: 62 },
      { id: "podium", x: 352, z: 224, width: 68, depth: 56, height: 74 }
    ]
  });
  const actorWorldPos = { x: 108, z: 220 };
  const projectedFloor = room.project(actorWorldPos, 0);
  const poseCompiled = compileAnimation({
    version: "stickman.animation/v2",
    canvas: { width: canvas.width, height: canvas.height, fps: 30 },
    groundY: Math.round(projectedFloor.y),
    addons: "none",
    actor: {
      id: "presenter",
      x: Math.round(projectedFloor.x),
      scale: 0.55,
      accessory: "tie",
      color: "#0f172a"
    },
    actions: [{ action: "present" }]
  });
  if (!poseCompiled.valid || !poseCompiled.program) {
    throw new Error(`Failed to compile isometric room presenter pose: ${JSON.stringify(poseCompiled.diagnostics)}`);
  }
  const frame = sampleAnimation(poseCompiled.program, poseCompiled.program.spec.durationMs * 0.5, "normal");
  const rawRoomSvg = renderRoomBlueprintSvg(
    room,
    { position: actorWorldPos, height: 0, radius: 16, label: "presenter", frame },
    { gridStep: 80, wallHeight: 72, title: "SHEET 03 · ISOMETRIC 2.5D STAGE & OBSTACLE DATUM" }
  );
  return {
    svg: scopeInlineSvg(rawRoomSvg, "bp-room-datum"),
    occupiable: room.canOccupy(actorWorldPos, 16),
    obstacleCount: room.objects.length,
    dimensions: `${room.width}×${room.depth}`
  };
}

export async function blueprintSection(repoRoot) {
  const collab = await compileShowcaseExample(repoRoot, "examples/v2-two-actors-collab.json");
  const sports = await compileShowcaseExample(repoRoot, "examples/v2-sports-addons.json");
  const room = buildIsometricRoomSvg();

  const collabAnimSvg = scopeInlineSvg(renderAnimatedSvg(collab.program), "bp-anim-collab", { loop: true });
  const sportsAnimSvg = scopeInlineSvg(renderAnimatedSvg(sports.program), "bp-anim-sports", { loop: true });

  const collabCadSvg = scopeInlineSvg(
    renderStoryboardSvg(collab.program, {
      theme: "blueprint",
      columns: 4,
      maxPanels: 8,
      title: "SHEET 01 · 2-ACTOR WHITEBOARD COLLABORATION (TIE + GLASSES)"
    }),
    "bp-cad-collab"
  );
  const sportsCadSvg = scopeInlineSvg(
    renderStoryboardSvg(sports.program, {
      theme: "blueprint",
      columns: 4,
      maxPanels: 8,
      title: "SHEET 02 · BALLISTIC PROPS & SOCKET ADD-ONS (HURDLE → SHOT → CHEER)"
    }),
    "bp-cad-sports"
  );

  const collabStdSvg = scopeInlineSvg(
    renderStoryboardSvg(collab.program, {
      theme: "default",
      columns: 4,
      maxPanels: 8,
      title: "2-Actor Whiteboard Collaboration · Cue-Synced Contact Sheet"
    }),
    "bp-std-collab"
  );
  const sportsStdSvg = scopeInlineSvg(
    renderStoryboardSvg(sports.program, {
      theme: "default",
      columns: 4,
      maxPanels: 8,
      title: "Ballistic Add-ons · Hurdle → Basketball Shot → Cheer"
    }),
    "bp-std-sports"
  );

  const collabSec = (collab.analysis.durationMs / 1000).toFixed(2);
  const sportsSec = (sports.analysis.durationMs / 1000).toFixed(2);
  const collabSeam = collab.analysis.maxSeamStepPx.toFixed(3);
  const sportsSeam = sports.analysis.maxSeamStepPx.toFixed(3);

  return `<section class="section" id="blueprint">
  <div class="section-heading">
    <div>
      <p class="eyebrow">stickman.animation/v2 · Orthographic inspection</p>
      <h2>Multi-actor choreography &amp; CAD blueprints.</h2>
    </div>
    <p class="quiet">Compiled deterministically at build time with C1 Hermite joins, semantic stage anchors, and automated bounds/seam verification.</p>
  </div>
  <div class="blueprint-live-grid">
    <article class="blueprint-card" data-scene="two-actors-collab">
      <div class="blueprint-card-head">
        <h3>2-Actor Whiteboard Collaboration</h3>
        <p class="quiet">Lead presenter (<code>tie</code>) and design reviewer (<code>glasses</code>) synchronized via <code>emitCue</code> / <code>afterCue</code> on an 800×450 stage.</p>
        <div class="blueprint-metrics" aria-label="2-actor spatial lint metrics">
          <span class="metric-pill metric-pass">${collab.analysis.outOfBoundsCount} out-of-bounds</span>
          <span class="metric-pill">maxSeamStepPx ${escapeHtml(collabSeam)}px</span>
          <span class="metric-pill">${collab.analysis.actorIds.length} actors · ${escapeHtml(collabSec)}s</span>
          <span class="metric-pill">prop: ${escapeHtml(collab.analysis.addonTypes.join(", "))}</span>
        </div>
      </div>
      <figure class="blueprint-figure">
        ${collabAnimSvg}
        <figcaption class="quiet">Scriptless animated SVG · cues: <code>boardWritten</code> → <code>reacted</code> → <code>approved</code></figcaption>
      </figure>
    </article>
    <article class="blueprint-card" data-scene="sports-addons">
      <div class="blueprint-card-head">
        <h3>Ballistic Add-ons &amp; Socket Props</h3>
        <p class="quiet">Athlete (<code>badge</code>) chains <code>hurdle</code> → <code>basketball-shot</code> → <code>cheer</code> with parabolic arc flight and hoop reaction.</p>
        <div class="blueprint-metrics" aria-label="Ballistic add-ons spatial lint metrics">
          <span class="metric-pill metric-pass">${sports.analysis.outOfBoundsCount} out-of-bounds</span>
          <span class="metric-pill">maxSeamStepPx ${escapeHtml(sportsSeam)}px</span>
          <span class="metric-pill">${sports.analysis.addonTypes.length} props · ${escapeHtml(sportsSec)}s</span>
          <span class="metric-pill">${escapeHtml(sports.analysis.addonTypes.join(" · "))}</span>
        </div>
      </div>
      <figure class="blueprint-figure">
        ${sportsAnimSvg}
        <figcaption class="quiet">Scriptless animated SVG · lifecycle: appear → socket → parabolic flight → target reaction</figcaption>
      </figure>
    </article>
  </div>
  <div class="blueprint-inspector">
    <div class="blueprint-toolbar">
      <div>
        <p class="eyebrow">stickman_storyboard &amp; room datum</p>
        <h3>Inspect every key beat on a drafting grid</h3>
      </div>
      <div class="blueprint-tabs" role="group" aria-label="Blueprint inspection view">
        <button type="button" class="blueprint-tab" data-blueprint-view="cad" aria-pressed="true" aria-controls="blueprintPanelCad">CAD Blueprint</button>
        <button type="button" class="blueprint-tab" data-blueprint-view="standard" aria-pressed="false" aria-controls="blueprintPanelStandard">Standard Contact Sheet</button>
        <button type="button" class="blueprint-tab" data-blueprint-view="room" aria-pressed="false" aria-controls="blueprintPanelRoom">2.5D Room Datum</button>
      </div>
    </div>
    <p id="blueprintViewStatus" class="quiet" aria-live="polite">CAD Dimensional Blueprint · monochrome orthographic panels with 144u rig leaders, L/C/R anchor ticks, and T+0.00s timecodes.</p>
    <div id="blueprintPanelCad" class="blueprint-panel" data-blueprint-panel="cad">
      <div class="blueprint-sheet-stack">
        <figure class="blueprint-sheet">${collabCadSvg}</figure>
        <figure class="blueprint-sheet">${sportsCadSvg}</figure>
      </div>
    </div>
    <div id="blueprintPanelStandard" class="blueprint-panel" data-blueprint-panel="standard" hidden>
      <div class="blueprint-sheet-stack">
        <figure class="blueprint-sheet">${collabStdSvg}</figure>
        <figure class="blueprint-sheet">${sportsStdSvg}</figure>
      </div>
    </div>
    <div id="blueprintPanelRoom" class="blueprint-panel" data-blueprint-panel="room" hidden>
      <div class="blueprint-sheet-stack">
        <div class="blueprint-metrics" aria-label="2.5D room blueprint metrics">
          <span class="metric-pill metric-pass">occupiable: ${room.occupiable ? "true" : "false"}</span>
          <span class="metric-pill">floor ${escapeHtml(room.dimensions)}</span>
          <span class="metric-pill">${room.obstacleCount} W×D×H obstacles</span>
          <span class="metric-pill">datum (108, 220, h=0)</span>
        </div>
        <figure class="blueprint-sheet">${room.svg}</figure>
      </div>
    </div>
  </div>
</section>`;
}
