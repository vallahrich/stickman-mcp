import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { repo } from "./catalogue.mjs";
import { buildDeckScenes, output } from "./media.mjs";

const arg = process.argv.indexOf("--source");
if (arg < 0 || !process.argv[arg + 1]) throw new Error("Use: npm run site:demo -- --source <official NIST PDF path>");
const source = path.resolve(process.argv[arg + 1]);
await fs.access(source);
const expected = "ef785d46d0d672a4386e592b9dc18b514b435c87a2c298c87f42e00f0425ea73";
if (createHash("sha256").update(await fs.readFile(source)).digest("hex") !== expected) throw new Error("Source does not match the reviewed NIST PDF. Reverify provenance and rights before adapting another file.");
const demo = path.join(output, "demo");
await fs.mkdir(demo, { recursive: true });
const render = spawnSync(process.env.PYTHON ?? "python", [path.join(repo, "scripts", "site", "render-pages.py"), source, demo], { encoding: "utf8" });
if (render.error || render.status !== 0) throw new Error(`Source rendering failed: ${render.error?.message ?? render.stderr}. Install scripts/site/requirements.txt in your chosen Python environment.`);
const manifest = JSON.parse(await fs.readFile(path.join(demo, "source-pages.json"), "utf8"));
if (manifest.sha256 !== expected) throw new Error("Source does not match the reviewed NIST PDF. Reverify provenance and rights before adapting another file.");
await buildDeckScenes();
const slides = [];
for (const [index, page] of manifest.pages.entries()) {
  slides.push({ page: page.page, title: page.title, image: page.image, player: `demo/scene-${page.page}.html`, enhancedPoster: `demo/enhanced-${page.page}.svg` });
}
await fs.writeFile(path.join(demo, "comparison.json"), JSON.stringify({ title: "Journey to the NIST Cybersecurity Framework 2.0", author: "Cherilyn Pascoe", year: 2023, historicalPreRelease: true, modified: "source ideas summarized and relaid out; actor travels and reveals content inside each slide", sourceSha256: manifest.sha256, slides }, null, 2));
const pack = spawnSync(process.env.PYTHON ?? "python", [path.join(repo, "scripts", "site", "package-demo.py"), demo], { encoding: "utf8" });
if (pack.error || pack.status !== 0) throw new Error(`Presentation packaging failed: ${pack.error?.message ?? pack.stderr}. Install scripts/site/requirements.txt in your chosen Python environment.`);
console.log(JSON.stringify({ demo, slides: slides.length, sourceSha256: manifest.sha256 }));
