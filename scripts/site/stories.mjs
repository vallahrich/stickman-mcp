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
function architecture(story, state, frame, p) {
  const has = id => state.revealed.some(cue => cue.id === id);
  const box = (x, y, w, h, fill = p.surface, stroke = p.border) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
  const label = (value, x, y, size = 24, color = p.text) => text(value, x, y, size, color, 70);
  const line = (d, color = p.accent, dashed = false) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="3"${dashed ? ' stroke-dasharray="7 7"' : ""}/>`;
  const server = (x, y, color) => `<g fill="${p.surface}" stroke="${color}" stroke-width="2"><rect x="${x}" y="${y}" width="112" height="140" rx="8"/><path d="M${x + 12} ${y + 35}h88m-88 35h88m-88 35h88"/><circle cx="${x + 90}" cy="${y + 20}" r="4"/><circle cx="${x + 90}" cy="${y + 55}" r="4"/><circle cx="${x + 90}" cy="${y + 90}" r="4"/></g>`;
  if (story.id === "cloud-journey") {
    const connected = has("connect"), ready = has("cloud"), delivered = has("delivered");
    const progress = Math.max(0, Math.min(1, (state.timeMs - 6500) / 6500));
    let svg = label("CUSTOMER APPLICATION", 145, 275, 18, p["text-muted"]) +
      box(150, 305, 275, 135) + label("Order", 175, 348, 28) +
      box(175, 375, 105, 36, p["accent-soft"], p.accent) + label("Submit", 189, 401, 19, p.accent) +
      label("Stable API", 466, 339, 20, p["text-muted"]) +
      line("M425 375H710", connected ? p.accent : p.border) +
      `<path d="M694 367l16 8-16 8" fill="none" stroke="${connected ? p.accent : p.border}" stroke-width="3"/>` +
      label("MANAGED SERVICE", 700, 230, 18, p["text-muted"]) +
      `<path transform="translate(0 -60)" d="M724 430C690 430 688 371 724 361C722 309 798 295 820 338C865 310 904 360 884 389C928 402 899 449 867 444H744C738 438 735 434 724 430Z" fill="${ready ? p["accent-soft"] : p.surface}" stroke="${ready ? p.accent : p.border}" stroke-width="3"/>` +
      label(ready ? "Processing" : "Backend", 752, 332, 24) +
      text("Scale independently", 970, 365, 23, p["text-muted"], 16);
    if (connected && !ready) svg += box(430 + progress * 245, 359, 40, 32, p.accent, p.accent) + label("{}", 438 + progress * 245, 382, 18, p["accent-fg"]);
    if (delivered) svg += line("M905 340H940V465H295V440") + label("Confirmation", 490, 495, 23, p.accent) +
      label("Confirmed", 294, 403, 21, p.accent);
    return { svg, stage: delivered ? "confirmed" : ready ? "processing" : connected ? "request-in-flight" : "application", takeaway: "Change backend capacity without changing the customer-facing contract." };
  }
  if (story.id === "incident-resolution") {
    const isolated = has("investigate"), rerouting = has("respond"), verified = has("verify"), restored = has("restored");
    let svg = label("REQUESTS", 80, 295, 18, p["text-muted"]) + box(80, 320, 145, 70) +
      label(restored ? "Serving" : "Waiting", 102, 365, 25, restored ? p.accent : p.text) +
      line("M225 355H420", p.border, isolated) +
      label("FAILED PRIMARY", 403, 270, 18, p["text-muted"]) + server(435, 295, p.border) +
      `<path d="M465 355l45 45m0-45-45 45" stroke="${p.accent}" stroke-width="5"/>` +
      label(isolated ? "Isolated" : "Not responding", 410, 480, 24, p.accent) +
      label("HEALTHY REPLICA", 805, 270, 18, p["text-muted"]) + server(835, 295, verified ? p.accent : p.border) +
      text(verified ? "Ready to serve" : "Available", 985, 360, 24, verified ? p.accent : p["text-muted"], 15);
    if (rerouting) {
      svg += line("M225 345V225H870V295", p.accent, !verified) +
        label(restored ? "Requests restored" : "Failover route", 475, 215, 22, p.accent);
      const distance = Math.max(0, Math.min(1, (state.timeMs - 6000) / 6000));
      svg += `<circle cx="${270 + distance * 550}" cy="225" r="7" fill="${p.accent}"/>`;
    }
    return { svg, stage: restored ? "serving-replica" : verified ? "replica-verified" : rerouting ? "rerouting" : isolated ? "primary-isolated" : "primary-failed", takeaway: "Keep the endpoint. Change the route. Verify recovery." };
  }
  if (story.id === "deployment-rollout") {
    const verifying = has("verify"), live = has("handover");
    let svg = label("STAGING", 130, 302, 18, p["text-muted"]) + label("Release v2", 130, 343, 28) +
      line("M190 365H425", p.border) +
      label("DEPLOYMENT SLOT", 405, 295, 18, p["text-muted"]) +
      box(440, 475, 85, 95, p["accent-soft"], p.border) +
      box(445, 380, 155, 70, p.surface, verifying ? p.accent : p.border) +
      label(live ? "Verified" : verifying ? "Checking" : "Not verified", 460, 423, 21, verifying ? p.accent : p["text-muted"]) +
      label("CUSTOMER TRAFFIC", 855, 302, 18, p["text-muted"]) +
      box(850, 325, 280, 125) + label(live ? "v2 is live" : "Still on v1", 875, 377, 30, live ? p.accent : p.text) +
      label(live ? "Serving the new release" : "No early traffic switch", 875, 419, 18, p["text-muted"]) +
      line("M600 415H850", live ? p.accent : p.border, !live);
    if (!live) svg += `<path d="M725 392v46" stroke="${p.accent}" stroke-width="7"/>` + label("GATE CLOSED", 656, 468, 17, p.accent);
    else svg += `<path d="M825 407l18 8-18 8" fill="none" stroke="${p.accent}" stroke-width="3"/>`;
    return { svg, stage: live ? "traffic-open" : verifying ? "verification" : "traffic-closed", takeaway: "Verify the deployed version before switching customer traffic." };
  }
  throw new Error(`No architecture layout for story ${story.id}`);
}
export function renderStoryFrame(story, timeMs, palette) {
  const state = storyState(story, timeMs);
  const program = compiled(story);
  const frame = sampleAnimation(program, state.timeMs);
  const diagram = architecture(story, state, frame, palette);
  // The shipping renderer keeps both the actor and bound prop on this one canvas.
  const actor = renderSvgFrame(program, state.timeMs).replace(/<rect width="100%" height="100%" fill="#ffffff"\/>/, "")
    .replace(/<path id="ground"[^>]*\/>/, "")
    .replaceAll("#202124", palette.text).replaceAll("#ffffff", palette.surface).replaceAll("#fff", palette.surface);
  const cue = state.active;
  const packageLabel = frame.prop ? text("v2", frame.prop.x + 14, frame.prop.y + 31, 19, palette.accent) : "";
  const cueMarkup = cue ? text(cue.title, 65, 146, 27, palette.accent) : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720" role="img" aria-label="${xml(story.title + ". " + (cue?.title ?? ""))}" data-story="${xml(story.id)}" data-stage="${diagram.stage}" data-time-ms="${state.timeMs}" data-actor-x="${frame.x.toFixed(3)}" data-action="${xml(frame.action)}" data-cue="${xml(cue?.id ?? "")}" data-complete="${state.complete}"><rect width="1280" height="720" fill="${palette.bg}"/><g font-family="Segoe UI,Calibri,sans-serif">${text(story.title, 65, 85, 43, palette.text, 65)}${cueMarkup}${diagram.svg}${actor}${packageLabel}<rect x="65" y="605" width="1150" height="80" rx="12" fill="${palette["accent-soft"]}"/>${text(diagram.takeaway, 88, 654, 27, palette.text, 85)}</g></svg>`;
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
      .replace("__FRAMES__", JSON.stringify(frames).replaceAll("<", "\\u003c"))
      .replace('<button id="play">Pause</button>', '<button id="play">Pause</button><button id="nextBeat">Next beat</button>')
      .replace("</body>", `<script>const beats=${JSON.stringify(recipe.cues.map(cue => Math.min(recipe.animation.durationMs, cue.timeMs + 600)))};document.getElementById("nextBeat").onclick=()=>{const next=beats.find(time=>time>frame/30*1000+1);frame=(next??${recipe.animation.durationMs})/1000*30;playing=false;draw();};</script></body>`));
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
