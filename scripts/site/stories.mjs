import fs from "node:fs/promises";
import path from "node:path";
import { storyCatalog, getStory, storyState } from "../../dist/stories.js";
import { compileAnimation, sampleAnimation } from "../../dist/compiler.js";
import { renderHtml, renderSvgFrame } from "../../dist/render.js";
import { repo } from "./catalogue.mjs";

const xml = text => String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const programs = new WeakMap();
function compiled(story) {
  if (programs.has(story)) return programs.get(story);
  const result = compileAnimation(story.animation);
  if (!result.valid || !result.program) throw new Error(`Story preview did not compile: ${JSON.stringify(result.diagnostics)}`);
  programs.set(story, result.program);
  return result.program;
}
function wrap(text, limit) {
  const lines = [""];
  for (const word of text.split(" ")) {
    if ((lines.at(-1) + " " + word).trim().length > limit) lines.push(word);
    else lines[lines.length - 1] = (lines.at(-1) + " " + word).trim();
  }
  return lines;
}
function text(text, x, y, size, color, limit = 45) {
  return wrap(text, limit).map((line, i) => `<text x="${x}" y="${y + i * size * 1.2}" font-size="${size}" fill="${color}">${xml(line)}</text>`).join("");
}
const diagrams = {
  "cloud-journey": [
    { x: 250, width: 240, label: "Application", cue: "application", target: "appLabel" },
    { x: 650, width: 240, label: "Cloud service", cue: "cloud", target: "cloudLabel" }
  ],
  "incident-resolution": [
    { x: 360, width: 240, label: "Incident signal", cue: "investigate", target: "evidence" },
    { x: 740, width: 240, label: "Service health", cue: "verify", target: "status" }
  ],
  "deployment-rollout": [
    { x: 380, width: 240, label: "Release destination", cue: "verify", target: "destination" }
  ]
};
export function renderStoryFrame(story, timeMs, palette) {
  const state = storyState(story, timeMs);
  const program = compiled(story);
  const frame = sampleAnimation(program, state.timeMs);
  const revealed = new Set(state.revealed.map(cue => cue.id));
  const zones = diagrams[story.id];
  if (!zones) throw new Error(`No diagram layout for story ${story.id}`);
  let diagram = `<path d="M100 560H1150" fill="none" stroke="${palette.border}" stroke-width="3"/>`;
  for (const zone of zones) {
    const active = revealed.has(zone.cue);
    const target = story.animation.targets[zone.target];
    diagram += `<rect x="${zone.x}" y="215" width="${zone.width}" height="390" rx="16" fill="${active ? palette["accent-soft"] : palette.surface}" stroke="${active ? palette.accent : palette.border}" stroke-width="2"/>`;
    diagram += text(zone.label, zone.x + 18, 255, 24, palette.text, 20);
    diagram += `<circle cx="${target.x}" cy="${target.y}" r="16" fill="${active ? palette.accent : palette.surface}" stroke="${palette.accent}" stroke-width="2"/>`;
  }
  if (zones.length > 1) diagram += `<path d="M${zones[0].x + zones[0].width} 510H${zones[1].x}" fill="none" stroke="${palette.accent}" stroke-width="3" stroke-dasharray="8 6"/>`;
  // The shipping renderer keeps both the actor and bound prop on this one canvas.
  const actor = renderSvgFrame(program, state.timeMs).replace(/<rect width="100%" height="100%" fill="#ffffff"\/>/, "")
    .replace(/<path id="ground"[^>]*\/>/, "")
    .replaceAll("#202124", palette.text).replaceAll("#ffffff", palette.surface).replaceAll("#fff", palette.surface);
  const cue = state.active;
  const cueMarkup = cue ? text(cue.title, 55, 146, 26, palette.accent) + text(cue.text, 55, 190, 18, palette["text-muted"], 115) : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720" data-story="${xml(story.id)}" data-time-ms="${state.timeMs}" data-actor-x="${frame.x.toFixed(3)}" data-action="${xml(frame.action)}" data-cue="${xml(cue?.id ?? "")}" data-complete="${state.complete}"><rect width="1280" height="720" fill="${palette.bg}"/><g font-family="Segoe UI,Calibri,sans-serif">${text(story.title, 55, 80, 40, palette.text, 65)}${cueMarkup}${diagram}${actor}${text(`${story.animation.actions.map(action => action.action).join(" → ")} · one actor, one shared timeline`, 55, 665, 17, palette["text-muted"], 120)}<rect x="0" y="714" width="${state.timeMs / story.animation.durationMs * 1280}" height="6" fill="${palette.accent}"/></g></svg>`;
}

export async function buildStories(output) {
  const directory = path.join(output, "stories");
  await fs.mkdir(directory, { recursive: true });
  const css = await fs.readFile(path.join(repo, "site", "styles.css"), "utf8");
  const colors = Object.fromEntries([...css.split('html[data-theme="dark"]')[0].matchAll(/--cp-([\w-]+):\s*([^;]+);/gi)].map(m => [m[1], m[2].trim()]));
  const template = await fs.readFile(path.join(repo, "site", "scene-player.html"), "utf8");
  const theme = await fs.readFile(path.join(repo, "site", "index.html"), "utf8");
  const detection = theme.match(/<script>[\s\S]*?<\/script>\s*<script>[\s\S]*?<\/script>/)[0];
  const catalogue = [];
  for (const item of storyCatalog()) {
    const recipe = getStory(item.id);
    const frames = Array.from({ length: Math.ceil(recipe.animation.durationMs / 1000 * 30) + 1 }, (_, i) => renderStoryFrame(recipe, i * 1000 / 30, colors));
    await fs.writeFile(path.join(directory, `${item.id}.html`), template
      .replace("In-slide Stickman animation", xml(recipe.title))
      .replace("__THEME__", detection + `<style>${css}</style>`)
      .replace("__FRAMES__", JSON.stringify(frames).replaceAll("<", "\\u003c")));
    const posterAction = recipe.animation.actions.filter(action => action.action === "point").at(-1);
    const posterTime = posterAction ? posterAction.startMs + posterAction.durationMs / 2 : recipe.animation.durationMs / 2;
    await fs.writeFile(path.join(directory, `${item.id}.svg`), renderStoryFrame(recipe, posterTime, colors));
    await fs.writeFile(path.join(directory, `${item.id}.json`), JSON.stringify(recipe, null, 2) + "\n");
    await fs.writeFile(path.join(directory, `${item.id}.animation.json`), JSON.stringify(recipe.animation, null, 2) + "\n");
    // This second download goes straight through the normal MCP/CLI renderer.
    await fs.writeFile(path.join(directory, `${item.id}.motion.html`), renderHtml(compiled(recipe)));
    catalogue.push({ ...item, durationMs: recipe.animation.durationMs, actions: recipe.animation.actions.map(action => action.action), cues: recipe.cues.length,
      preview: `stories/${item.id}.html`, poster: `stories/${item.id}.svg`, recipe: `stories/${item.id}.json`,
      animation: `stories/${item.id}.animation.json`, motionPreview: `stories/${item.id}.motion.html` });
  }
  await fs.writeFile(path.join(output, "stories.json"), JSON.stringify(catalogue, null, 2) + "\n");
  return catalogue;
}
