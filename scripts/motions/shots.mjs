import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { renderStaticSvg } from "./review-renderer.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const sessionFiles = process.env.STICKMAN_SESSION_FILES ?? process.env.MOTION_SESSION_FILES ?? "C:\\Users\\t-vwallerich\\.copilot\\session-state\\5151d75e-0e30-46ad-99e0-e3d1bf08e105\\files";
const factoryDir = path.join(sessionFiles, "motion-factory", "clips");
const onlyIndex = process.argv.indexOf("--only");
const framesIndex = process.argv.indexOf("--frames");
const strip = process.argv.includes("--strip");
const only = onlyIndex >= 0 ? process.argv[onlyIndex + 1] : null;
const frameList = framesIndex >= 0 ? process.argv[framesIndex + 1] : null;
if (!only || !frameList) {
  console.error("Use: npm run motions:shots -- --only <id> --frames 0,20,40 [--strip]");
  process.exit(2);
}

const clipDir = path.join(factoryDir, only);
const clip = JSON.parse(await readFile(path.join(clipDir, "clip.json"), "utf8"));
const spec = JSON.parse(await readFile(path.join(repo, "motions", "specs", `${only}.json`), "utf8"));
const propsCatalog = JSON.parse(await readFile(path.join(sessionFiles, "design", "props.json"), "utf8"));
const shotsDir = path.join(clipDir, "shots");
await mkdir(shotsDir, { recursive: true });

function convertPngToJpeg(pngPath, jpgPath) {
  const script = `
Add-Type -AssemblyName System.Drawing
$png = [System.Drawing.Image]::FromFile('${pngPath.replaceAll("'", "''")}')
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$params = New-Object System.Drawing.Imaging.EncoderParameters(1)
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, 70L)
$png.Save('${jpgPath.replaceAll("'", "''")}', $codec, $params)
$png.Dispose()
`;
  execFileSync("powershell", ["-NoProfile", "-Command", script], { stdio: "pipe" });
}

const frames = frameList.split(",").map((item) => Number(item.trim())).filter(Number.isFinite)
  .map((frame) => Math.max(0, Math.min(clip.frames.length - 1, Math.round(frame))));
const rendered = [];

for (const safeFrame of frames) {
  const svg = await renderStaticSvg({ clip, spec, propsCatalog, frameIndex: safeFrame, onion: false, width: 1000, height: 700 });
  rendered.push({ frame: safeFrame, svg });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: 1000 } }).render().asPng();
  const pngPath = path.join(shotsDir, `frame-${safeFrame}.png`);
  const jpgPath = path.join(shotsDir, `frame-${safeFrame}.jpg`);
  await writeFile(pngPath, png);
  convertPngToJpeg(pngPath, jpgPath);
  await unlink(pngPath);
  console.log(jpgPath);
}

if (strip && rendered.length) {
  const panelWidth = 1000;
  const panelHeight = 700;
  const nested = rendered.map(({ frame, svg }, index) => {
    const inner = svg.replace("<svg ", `<svg x="${index * panelWidth}" y="0" `);
    return `<g><title>frame ${frame}</title>${inner}</g>`;
  }).join("");
  const stripSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${panelWidth * rendered.length}" height="${panelHeight}" viewBox="0 0 ${panelWidth * rendered.length} ${panelHeight}">${nested}</svg>`;
  const png = new Resvg(stripSvg, { fitTo: { mode: "width", value: panelWidth * rendered.length } }).render().asPng();
  const names = rendered.map(({ frame }) => frame).join("-");
  const pngPath = path.join(shotsDir, `strip-${names}.png`);
  const jpgPath = path.join(shotsDir, `strip-${names}.jpg`);
  await writeFile(pngPath, png);
  convertPngToJpeg(pngPath, jpgPath);
  await unlink(pngPath);
  console.log(jpgPath);
}
