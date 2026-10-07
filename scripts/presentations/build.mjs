import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stageKitSource } from "../motions/review-renderer.mjs";
import { parseCatalogue, readMotion, releaseMotionSpec } from "../site/catalogue.mjs";
import { keyPoseGates } from "../motions/keypose.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const escapeHtml = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const scriptJson = value => JSON.stringify(value).replaceAll("<", "\\u003c");
const isInside = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
};

export function validatePresentation(source, design) {
  if (source.version !== 1 || !Array.isArray(source.slides) || !source.assets) throw new Error("Unsupported source manifest");
  if (!source.canvasEmu || !Number.isFinite(source.canvasEmu.width) || !Number.isFinite(source.canvasEmu.height) || source.canvasEmu.width <= 0 || source.canvasEmu.height <= 0) throw new Error("Invalid source dimensions");
  if (typeof design.title !== "string" || !design.title.trim() || !Array.isArray(design.slides) || !design.slides.length) throw new Error("A presentation needs a title and slides");
  const indices = new Set();
  let previous = 0;
  for (const slide of design.slides) {
    if (indices.has(slide.source) || slide.source <= previous) throw new Error("Source slides must be unique and stay in original order");
    indices.add(slide.source);
    previous = slide.source;
    const original = source.slides.find(item => item.number === slide.source);
    if (!original) throw new Error(`Missing source slide ${slide.source}`);
    for (const key of ["title", "subtitle", "section"]) if (typeof slide[key] !== "string") throw new Error(`Slide ${slide.source}: missing ${key}`);
    if (!Array.isArray(slide.beats) || !slide.beats.length) throw new Error(`Slide ${slide.source}: no presenter beats`);
    const ids = new Set();
    for (const node of slide.nodes ?? []) {
      if (!node.id || ids.has(node.id)) throw new Error(`Slide ${slide.source}: duplicate node ID`);
      ids.add(node.id);
      for (const key of ["x", "y", "width", "height"]) if (!Number.isFinite(node[key])) throw new Error(`Node ${node.id}: invalid ${key}`);
      if (node.width <= 0 || node.height <= 0 || node.x < 0 || node.y < 160 || node.x + node.width > 1280 || node.y + node.height > 640) throw new Error(`Node ${node.id} is outside the content area`);
      if (!Array.isArray(node.label) || !node.label.every(t => typeof t === "string")) throw new Error(`Node ${node.id}: invalid label`);
      if (node.shape && !["band", "plain"].includes(node.shape)) throw new Error(`Node ${node.id}: unsupported shape`);
    }
    for (const edge of slide.edges ?? []) {
      if (!edge.id || ids.has(edge.id)) throw new Error(`Slide ${slide.source}: duplicate edge ID`);
      if (!Array.isArray(edge.points) || edge.points.length < 2 || edge.points.some(point => !Array.isArray(point) || point.length !== 2 || point.some((n, axis) => !Number.isFinite(n) || n < 0 || n > (axis ? 720 : 1280)))) throw new Error(`Edge ${edge.id}: invalid path`);
      if (edge.label && (!Number.isFinite(edge.label.x) || !Number.isFinite(edge.label.y) || typeof edge.label.text !== "string")) throw new Error(`Edge ${edge.id}: invalid label`);
      ids.add(edge.id);
    }
    const diagramIds = new Set(ids);
    for (const object of slide.objects ?? []) {
      if (!object.id || ids.has(object.id)) throw new Error(`Slide ${slide.source}: duplicate object ID`);
      ids.add(object.id);
      if (!["files", "table"].includes(object.type) || typeof object.label !== "string") throw new Error("Invalid data object");
      for (const key of ["x", "y", "w", "h"]) if (!Number.isFinite(object[key])) throw new Error(`Invalid object ${key}`);
      if (object.w <= 0 || object.h <= 0 || object.x < 0 || object.y < 160 || object.x + object.w > 1280 || object.y + object.h > 640) throw new Error("Data object is outside the content area");
    }
    for (const beat of slide.beats) {
      if (typeof beat.caption !== "string") throw new Error(`Slide ${slide.source}: beat needs a caption`);
      for (const key of ["active", "visible"]) if (beat[key] !== undefined && (!Array.isArray(beat[key]) || !beat[key].every(id => typeof id === "string"))) throw new Error(`Invalid ${key} targets`);
      for (const id of beat.active ?? []) if (!diagramIds.has(id)) throw new Error(`Unknown cue target ${id}`);
      for (const id of beat.visible ?? []) if (!diagramIds.has(id)) throw new Error(`Unknown reveal target ${id}`);
      for (const [id, change] of Object.entries(beat.objects ?? {})) {
        const originalObject = slide.objects?.find(object => object.id === id);
        if (!originalObject) throw new Error(`Unknown data object ${id}`);
        const object = { ...originalObject, ...change };
        for (const key of ["x", "y", "w", "h"]) if (!Number.isFinite(object[key])) throw new Error(`Invalid object state ${key}`);
        if (!["files", "table"].includes(object.type) || typeof object.label !== "string" || object.w <= 0 || object.h <= 0 || object.x < 0 || object.y < 160 || object.x + object.w > 1280 || object.y + object.h > 640) throw new Error("Invalid data object state");
        if (change.startAt !== undefined && (!Number.isFinite(change.startAt) || change.startAt < 0 || change.startAt >= 1)) throw new Error("Invalid object transition start");
        if (change.visible !== undefined && typeof change.visible !== "boolean") throw new Error("Invalid object visibility");
      }
      if (beat.actor) {
        for (const key of ["x", "groundY", "scale", "from", "to", "durationMs"]) if (!Number.isFinite(beat.actor[key])) throw new Error(`Invalid actor ${key}`);
        if (!beat.actor.motion || beat.actor.scale <= 0 || beat.actor.from < 0 || beat.actor.to < beat.actor.from || beat.actor.durationMs <= 0) throw new Error("Invalid actor cue");
        if (beat.actor.payload && (!["files", "table"].includes(beat.actor.payload.type) || typeof beat.actor.payload.label !== "string")) throw new Error("Invalid data payload");
        for (const key of ["scene", "keepProps", "figure", "hideAtEnd", "hideSceneAtEnd"]) if (beat.actor[key] !== undefined && typeof beat.actor[key] !== "boolean") throw new Error(`Invalid actor ${key}`);
        if (beat.actor.payload && !beat.actor.scene) throw new Error("Data payload requires an actor scene");
      }
    }
    if (slide.video) {
      if (!original.media.includes(slide.video.asset) || source.assets[slide.video.asset]?.mime !== "video/mp4") throw new Error("Video must belong to its source slide");
      if (!original.media.includes(slide.video.poster) || !source.assets[slide.video.poster]?.mime.startsWith("image/")) throw new Error("Video needs its source poster");
      for (const key of ["x", "y", "width", "height"]) if (!Number.isFinite(slide.video[key])) throw new Error(`Invalid video ${key}`);
      const movie = slide.video;
      if (movie.width <= 0 || movie.height <= 0 || movie.x < 0 || movie.y < 160 || movie.x + movie.width > 1280 || movie.y + movie.height > 640) throw new Error("Video is outside the content area");
      if (movie.focus) {
        const focus = movie.focus;
        for (const key of ["left", "top", "width", "height"]) if (!Number.isFinite(focus[key])) throw new Error(`Invalid poster focus ${key}`);
        if (!Number.isInteger(focus.beat) || focus.beat < 0 || focus.beat >= slide.beats.length || focus.width <= 0 || focus.height <= 0 || focus.left < 0 || focus.top < 0 || focus.left + focus.width > 1 || focus.top + focus.height > 1) throw new Error("Poster focus is outside its source image");
      }
      if (movie.revealBeat !== undefined && (!Number.isInteger(movie.revealBeat) || movie.revealBeat < 0 || movie.revealBeat >= slide.beats.length)) throw new Error("Invalid video reveal beat");
      if (movie.revealAtEnd !== undefined && typeof movie.revealAtEnd !== "boolean") throw new Error("Invalid video reveal timing");
    }
  }
}

export async function buildPresentation({ sourceFile, designFile, outputFile }) {
  const output = path.resolve(outputFile);
  if (isInside(repo, output)) throw new Error("Private source-derived HTML must be generated outside the repository");
  const [source, design] = await Promise.all([sourceFile, designFile].map(async file => JSON.parse(await fs.readFile(file, "utf8"))));
  validatePresentation(source, design);
  const selected = design.slides.map(slide => ({ ...slide, original: source.slides.find(item => item.number === slide.source) }));
  const mediaIds = new Set(selected.flatMap(slide => slide.original.media));
  const media = {};
  const sourceRoot = await fs.realpath(path.dirname(sourceFile));
  for (const id of mediaIds) {
    const asset = source.assets[id];
    if (!asset || !["image/png", "image/jpeg", "image/gif", "image/svg+xml", "video/mp4"].includes(asset.mime)) throw new Error(`Unsupported asset ${id}`);
    const filename = await fs.realpath(path.resolve(sourceRoot, asset.path));
    if (!isInside(sourceRoot, filename)) throw new Error(`Asset escapes source directory: ${id}`);
    const data = await fs.readFile(filename);
    const { createHash } = await import("node:crypto");
    if (createHash("sha256").update(data).digest("hex") !== asset.sha256) throw new Error(`Asset changed since inventory: ${id}`);
    media[id] = { mime: asset.mime, base64: data.toString("base64") };
  }
  const approved = new Set(parseCatalogue(await fs.readFile(path.join(repo, "docs", "motion-catalog-plan.md"), "utf8")).filter(row => row.status === "user-approved").map(row => row.id));
  const motionIds = [...new Set(selected.flatMap(slide => slide.beats.flatMap(beat => beat.actor ? [beat.actor.motion] : [])))];
  const motions = {};
  for (const id of motionIds) {
    if (!approved.has(id)) throw new Error(`Motion ${id} is not in the user-approved catalogue`);
    const { spec, clip } = await readMotion(id);
    if (spec.poseKeys?.length) {
      const gates = await keyPoseGates(clip, spec);
      if (!gates.passed) throw new Error(`Motion ${id} fails mechanical checks: ${gates.failures.join("; ")}`);
    }
    for (const slide of selected) for (const beat of slide.beats) if (beat.actor?.motion === id) {
      if (beat.actor.to > clip.frames.length - 1) throw new Error(`Actor cue exceeds ${id} clip`);
      if (beat.actor.payload && spec.prop !== "box") throw new Error(`Data payload requires a box interaction, not ${id}`);
    }
    motions[id] = { clip, spec: releaseMotionSpec(spec) };
  }
  const [theme, css, player, kit, propsCatalog] = await Promise.all([
    fs.readFile(path.join(repo, "site", "presentation", "theme.css"), "utf8"),
    fs.readFile(path.join(repo, "site", "presentation", "presentation.css"), "utf8"),
    fs.readFile(path.join(repo, "site", "presentation", "player.js"), "utf8"),
    stageKitSource(),
    fs.readFile(path.join(repo, "motions", "review-props.json"), "utf8").then(JSON.parse)
  ]);
  const data = { title: design.title, sourceName: source.sourceName, sourceSha256: source.sourceSha256,
    sourceCount: source.slides.length, canvasEmu: source.canvasEmu, slides: selected, media, motions, propsCatalog };
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src blob: data:; connect-src 'none'; font-src 'none'">
<title>${escapeHtml(design.title)}</title>
<script>
(() => {
  const param = new URLSearchParams(window.location.search).get("scoutTheme");
  const theme =
    param || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", theme);
})();
</script><style>${theme}\n${css}</style></head>
<body><main class="shell">
<header class="toolbar"><strong>${escapeHtml(design.title)}</strong>
<label>Slide <select id="slide-select" aria-label="Choose slide"></select></label>
<button id="theme" aria-label="Switch color theme">Theme</button>
<button id="motion" aria-pressed="true">Animation on</button>
<button id="fullscreen">Fullscreen</button></header>
<div class="stage-frame"><article class="stage" id="stage" aria-label="Presentation slide"></article></div>
<nav class="controls" aria-label="Presenter controls"><button id="back">Back</button><button id="replay">Replay beat</button>
<span id="beat-status" role="status" aria-live="polite"></span><button id="source">Original slide</button><button id="notes">Notes</button><button id="play-demo" hidden>Play original demo</button><button id="expand-demo" hidden>Enlarge demo</button><button id="next" class="primary">Next beat</button></nav>
<p class="help">Space / Right: next beat · Left: back · N: notes · O: original · F: fullscreen. Videos play only when you choose Play.</p>
<div id="error" role="alert" hidden></div>
</main><dialog id="dialog"><div class="dialog-header"><h2 id="dialog-title"></h2><button id="close-dialog">Close</button></div><div id="dialog-body"></div></dialog>
<script type="application/json" id="presentation-data">${scriptJson(data)}</script>
<script>${kit}\n${player}</script></body></html>`;
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, html);
  return { path: output, slides: selected.length, sourceSlides: selected.map(slide => slide.source), bytes: Buffer.byteLength(html) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const option = key => {
    const ix = args.indexOf(key);
    if (ix < 0 || !args[ix + 1]) throw new Error(`Required argument ${key}`);
    return args[ix + 1];
  };
  try {
    console.log(JSON.stringify(await buildPresentation({ sourceFile: option("--source"), designFile: option("--design"), outputFile: option("--output") })));
  } catch (error) {
    console.error(`Presentation build failed: ${error.message}`);
    process.exitCode = 1;
  }
}
