import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import ffmpeg from "ffmpeg-static";
import { Resvg } from "@resvg/resvg-js";
import { repo, readMotion } from "./catalogue.mjs";
import { renderStaticSvg } from "../motions/review-renderer.mjs";
import { deckScenes, renderDeckScene, sceneDurationMs } from "./deck-scenes.mjs";

export const output = path.join(repo, "dist", "site");
const propsCatalog = JSON.parse(await fs.readFile(path.join(repo, "motions", "review-props.json"), "utf8"));
const css = await fs.readFile(path.join(repo, "site", "styles.css"), "utf8");
export const colors = Object.fromEntries([...css.split('html[data-theme="dark"]')[0].matchAll(/--cp-([\w-]+):\s*([^;]+);/gi)].map(m => [m[1], m[2].trim()]));
const xml = text => String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const resvgOptions = process.platform === "win32" ? {
  font: { loadSystemFonts: false, fontFiles: ["segoeui.ttf", "segoeuib.ttf"].map(name => path.join(process.env.WINDIR ?? "C:\\Windows", "Fonts", name)), defaultFontFamily: "Segoe UI" }
} : undefined;
export async function motionSvg(motion, frame, width, height) {
  const index = motion.clip.loop ? frame % motion.clip.frames.length : Math.min(frame, motion.clip.frames.length - 1);
  const svg = await renderStaticSvg({ ...motion, propsCatalog, frameIndex: index, width, height });
  return svg.replace(/<text [^>]*y="-42"[\s\S]*?<\/text>/, "");
}
async function encode(filename, count, createFrame, gif = false, fps = 30) {
  if (!ffmpeg) throw new Error("Optional ffmpeg-static encoder is missing; install it before building media");
  await fs.access(ffmpeg);
  const args = ["-hide_banner", "-loglevel", "error", "-threads", "2", "-filter_complex_threads", "1", "-f", "image2pipe", "-vcodec", "png", "-framerate", String(fps), "-i", "pipe:0"];
  if (gif) args.push("-filter_complex", "[0:v]split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer", "-loop", "0");
  else args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", "-threads", "2", "-movflags", "+faststart");
  args.push("-y", filename);
  const encoder = spawn(ffmpeg, args, { stdio: ["pipe", "ignore", "pipe"] });
  let diagnostics = "";
  encoder.stderr.on("data", data => { diagnostics = (diagnostics + data).slice(-12000); });
  const completion = new Promise((resolve, reject) => {
    encoder.on("error", reject);
    encoder.on("close", code => code === 0 ? resolve() : reject(new Error(`Encoder exited ${code}: ${diagnostics}`)));
  });
  // Keep an early encoder failure handled while rasterization is still running.
  completion.catch(() => {});
  let inputError = null;
  encoder.stdin.on("error", error => { inputError = error; });
  try {
    for (let frame = 0; frame < count; frame++) {
      if (inputError) throw inputError;
      const svg = await createFrame(frame);
      const png = new Resvg(svg, resvgOptions).render().asPng();
      if (!encoder.stdin.write(png)) await once(encoder.stdin, "drain");
      if (frame % 20 === 0) globalThis.gc?.();
    }
    encoder.stdin.end();
    await completion;
  } catch (error) {
    encoder.kill();
    throw new Error(`Media generation failed for ${path.basename(filename)}: ${error.message}`, { cause: error });
  }
}
export async function buildMotionGif(id) {
  const motion = await readMotion(id);
  const count = Math.max(72, motion.clip.frames.length + (motion.clip.loop ? 0 : 24));
  const filename = path.join(output, "demo", `${id}.gif`);
  await encode(filename, count, frame => motionSvg(motion, frame, 320, 420), true);
  return filename;
}
export async function buildDeckScenes() {
  const count = sceneDurationMs / 1000 * 15;
  for (const [index, scene] of deckScenes.entries()) {
    await encode(path.join(output, "demo", `in-slide-${scene.page}.gif`), count, frame => renderDeckScene(index, frame / 15 * 1000, colors), true, 15);
    await fs.writeFile(path.join(output, "demo", `enhanced-${scene.page}.svg`), renderDeckScene(index, 10000, colors, true));
    const frames = Array.from({ length: sceneDurationMs / 1000 * 30 }, (_, frame) => renderDeckScene(index, frame / 30 * 1000, colors));
    const html = await fs.readFile(path.join(repo, "site", "scene-player.html"), "utf8");
    const detection = `<script>(()=>{const p=new URLSearchParams(location.search).get("scoutTheme");document.documentElement.setAttribute("data-theme",p||(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"));})();</script>`;
    await fs.writeFile(path.join(output, "demo", `scene-${scene.page}.html`), html.replace("__THEME__", detection + `<style>${css}</style>`).replace("__FRAMES__", JSON.stringify(frames).replaceAll("<", "\\u003c")));
  }
}
export const storyboard = [
  { start: 0, end: 6, id: "present", title: "Make IT easier to explain.", caption: "An editable character that works inside the presentation content." },
  { start: 6, end: 12, id: "rack-server", title: "Explain the infrastructure.", caption: "Give servers and systems a visible, human-scale action." },
  { start: 12, end: 18, id: "plug-cable", title: "Connect the dots.", caption: "Show a connection instead of describing one more abstract box." },
  { start: 18, end: 24, id: "type-at-desk", title: "Show the workflow.", caption: "A small gesture can make a digital process feel tangible." },
  { start: 24, end: 30, id: "video-call", title: "Bring services to life.", caption: "Collaboration, hybrid work and the people using the technology." },
  { start: 30, end: 36, id: "frustrated-pc", title: "Make incidents relatable.", caption: "A recognizable reaction, then a reason to explain the solution." },
  { start: 36, end: 42, id: "inspect-magnifier", title: "Investigate. Then explain.", caption: "Use a focused visual cue for diagnostics and problem solving." },
  { start: 42, end: 48, id: "reveal", title: "Reveal the next idea.", caption: "Original vector motion, sampled by the real engine—not generated video." },
  { start: 48, end: 52, id: null, title: "Before: the source presentation.", caption: "Original historical NIST slide: a static set of cybersecurity attributes." },
  { start: 52, end: 60, id: null, title: "After: motion works inside the slide.", caption: "The actor traverses the content and reveals the priorities. Source text summarized and relaid out." }
];
export async function createShowcaseFrameRenderer() {
  const manifest = JSON.parse(await fs.readFile(path.join(output, "demo", "source-pages.json"), "utf8"));
  const source = manifest.pages.find(p => p.page === 2);
  if (!source) throw new Error("Build the NIST source comparison before the showcase video");
  const sourceData = (await fs.readFile(path.join(output, source.image))).toString("base64");
  const motions = new Map();
  for (const item of storyboard) if (item.id) motions.set(item.id, await readMotion(item.id));
  const actorCache = new Map();
  const createFrame = async frame => {
    const time = frame / 30, item = storyboard.find(s => time >= s.start && time < s.end);
    const localFrame = frame - item.start * 30;
    const comparison = item.start >= 48;
    const motion = item.id ? motions.get(item.id) : null;
    const actorFrame = motion ? motion.clip.loop ? localFrame % motion.clip.frames.length : Math.min(localFrame, motion.clip.frames.length - 1) : 0;
    const actorKey = `${item.id}:${actorFrame}`;
    // Isolate vector opacity groups before composition: nested SVG opacity
    // bounds can panic in the existing native rasterizer. MP4 is raster output.
    if (motion && !actorCache.has(actorKey)) actorCache.set(actorKey, new Resvg(await motionSvg(motion, actorFrame, 550, 430), resvgOptions).render().asPng().toString("base64"));
    const actor = actorCache.get(actorKey) ?? "";
    const scene = comparison
      ? (item.start === 48 ? `<image href="data:image/png;base64,${sourceData}" x="160" y="138" width="960" height="540"/>` : `<image href="data:image/png;base64,${new Resvg(renderDeckScene(1, localFrame / 30 * 1000, colors), resvgOptions).render().asPng().toString("base64")}" x="160" y="138" width="960" height="540"/>`)
      : `<rect x="600" y="170" width="580" height="440" rx="16" fill="${colors.surface}" stroke="${colors.border}"/><image href="data:image/png;base64,${actor}" x="615" y="180" width="550" height="430"/><text x="64" y="264" font-size="26" fill="${colors.accent}">Architecture</text><text x="64" y="320" font-size="26" fill="${colors.text}">Operations</text><text x="64" y="376" font-size="26" fill="${colors["text-muted"]}">Digital services</text><text x="64" y="470" font-size="18" fill="${colors["text-muted"]}">Reviewable poses. Reproducible playback.</text>`;
    const caption = comparison ? "NIST · Cherilyn Pascoe · February 2023 · historical pre-release briefing · independent demo, no endorsement" : item.caption;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="${colors.bg}"/><g font-family="Segoe UI,Calibri,sans-serif"><text x="48" y="49" font-size="17" fill="${colors.accent}">STICKMAN MCP · IT &amp; DIGITAL SERVICES</text><text x="48" y="108" font-size="42" font-weight="700" fill="${colors.text}">${xml(item.title)}</text>${scene}<text x="48" y="687" font-size="${comparison ? 14 : 19}" fill="${colors["text-muted"]}">${xml(caption)}</text><rect x="0" y="714" width="${frame / 1799 * 1280}" height="6" fill="${colors.accent}"/></g></svg>`;
  };
  return { createFrame, manifest };
}
export async function buildShowcase() {
  const { createFrame, manifest } = await createShowcaseFrameRenderer();
  const filename = path.join(output, "showcase.mp4");
  await encode(filename, 1800, createFrame);
  const stamp = seconds => `00:${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}.000`;
  await fs.writeFile(path.join(output, "showcase.vtt"), "WEBVTT\n\n" + storyboard.map((s, i) => `${i + 1}\n${stamp(s.start)} --> ${stamp(s.end)}\n${s.title}\n${s.caption}\n`).join("\n"));
  await fs.writeFile(path.join(output, "showcase-manifest.json"), JSON.stringify({ fps: 30, frames: 1800, durationSeconds: 60, audio: "silent", storyboard, sourceSha256: manifest.sha256 }, null, 2));
  console.log(JSON.stringify({ video: filename, frames: 1800, fps: 30, durationSeconds: 60 }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await buildShowcase();
