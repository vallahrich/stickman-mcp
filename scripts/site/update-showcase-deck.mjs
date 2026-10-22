// Update only the silent presentation and its measured duration; never encode the two films.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { inspectSlide, inspectSlideMetadata } from "./build-showcase.mjs";
const [source, destination = "dist/site/showcase"] = process.argv.slice(2);
if (!source) throw new Error("Use update-showcase-deck.mjs <story.html> [showcase folder]");
const html = await fs.readFile(source, "utf8");
const timing = JSON.parse(html.match(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/)?.[1] ?? "null");
if (!timing || timing.fps !== 30 || !Number.isInteger(timing.totalFrames) || timing.totalFrames <= 0 || timing.totalFrames > 1800) throw new Error("Invalid deck timing.");
const slideMetadata = inspectSlideMetadata(html);
const folder = path.resolve(destination);
const manifestPath = path.join(folder, "manifest.json");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
if (manifest.slide?.src !== "on-prem-to-cloud.html" || manifest.videos?.map(v => v.src).join() !== "open-source.mp4,julius-caesar.mp4") throw new Error("Unexpected showcase manifest.");
const digest = async file => createHash("sha256").update(await fs.readFile(path.join(folder, file))).digest("hex");
const before = await Promise.all(manifest.videos.map(v => digest(v.src)));
manifest.slide = { ...manifest.slide, ...slideMetadata, seconds: inspectSlide(html) };
const token = randomUUID();
const temporary = path.join(folder, `.deck-${token}.tmp`);
const manifestTemporary = path.join(folder, `.manifest-${token}.tmp`);
try {
  await fs.writeFile(temporary, html, {flag:"wx"});
  await fs.writeFile(manifestTemporary, JSON.stringify(manifest, null, 2) + "\n", {flag:"wx"});
  await fs.rename(temporary, path.join(folder, manifest.slide.src));
  await fs.rename(manifestTemporary, manifestPath);
} finally {
  await fs.rm(temporary, { force: true });
  await fs.rm(manifestTemporary, { force: true });
}
const after = await Promise.all(manifest.videos.map(v => digest(v.src)));
if (before.join() !== after.join()) throw new Error("Film media changed during deck-only update.");
console.log(JSON.stringify({ seconds: manifest.slide.seconds, filmHashes: after, filmsUnchanged: true }));
