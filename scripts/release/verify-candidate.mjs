// Private local inspection only. Ephemeral loopback server; no deployment.
import http from "node:http";
import { deepStrictEqual } from "node:assert";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { readAllowed, listFiles, sha256 } from "./prepare.mjs";

const target = resolve(process.argv[2] ?? "");
if (process.argv.length !== 3) throw new Error("Use node scripts/release/verify-candidate.mjs <candidate-directory>");
const provenance = JSON.parse(await readAllowed(target, "provenance.json"));
if (provenance.publicationApproved !== false) throw new Error("Expected a private review candidate.");
for (const artifact of provenance.artifacts) {
  if (sha256(await readAllowed(target, artifact.path)) !== artifact.sha256) throw new Error(`Artifact drift: ${artifact.path}`);
}
const root = join(target, "site"), manifest = JSON.parse(await readAllowed(root, "release-manifest.json"));
const names = (await listFiles(root)).filter(name => name !== "release-manifest.json");
if (JSON.stringify(names) !== JSON.stringify(manifest.files.map(file => file.path).sort())) throw new Error("Site membership differs from manifest.");
for (const file of manifest.files) {
  if (sha256(await readAllowed(root, file.path)) !== file.sha256) throw new Error(`Site drift: ${file.path}`);
}
const catalogue = JSON.parse(await readAllowed(root, "catalogue.json"));
if (catalogue.development || catalogue.motions.some(motion => motion.note || motion.score || motion.approval !== "user-approved")) {
  throw new Error("Unexpected private review data or approval state.");
}
const mime = { ".html": "text/html", ".json": "application/json", ".svg": "image/svg+xml",
  ".js": "text/javascript", ".css": "text/css", ".png": "image/png",
  ".mp4": "video/mp4", ".vtt": "text/vtt", ".md": "text/plain", ".txt": "text/plain" };
const server = http.createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname).replace(/^\//, "") || "index.html";
    const bytes = await readAllowed(root, path);
    let start = 0, end = bytes.length - 1, status = 200;
    if (request.headers.range) {
      const match = request.headers.range.match(/^bytes=(\d+)-(\d*)$/);
      if (!match) { response.writeHead(416).end(); return; }
      start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), end) : end;
      if (start > end || start >= bytes.length) { response.writeHead(416).end(); return; }
      status = 206;
    }
    response.writeHead(status, { "Content-Type": mime[extname(path)] ?? "text/plain",
      "Content-Length": end - start + 1, "Accept-Ranges": "bytes",
      ...(status === 206 ? { "Content-Range": `bytes ${start}-${end}/${bytes.length}` } : {}) });
    response.end(bytes.subarray(start, end + 1));
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], failed = [], external = [];
page.on("pageerror", error => errors.push(error.message));
page.on("response", response => { if (response.status() >= 400) failed.push(response.url()); });
page.on("request", request => { if (!request.url().startsWith(base + "/")) external.push(request.url()); });
const review = join(dirnameForReview(target), `candidate-review-${provenance.version}`);
await mkdir(review, { recursive: true });
try {
  await page.goto(base);
  await page.locator(".motion-card").first().waitFor();
  if (await page.locator("meta[name=robots]").getAttribute("content") !== "index,follow") throw new Error("Candidate indexing metadata missing.");
  if (!await page.locator("#connect").textContent().then(text => text.includes(`vallahrich-stickman-mcp-${provenance.version}.tgz`))) throw new Error("Wrong installation version.");
  await page.locator("#category").selectOption("");
  if (await page.locator(".motion-card").count() !== catalogue.motionCount) throw new Error("Gallery inventory mismatch.");
  await page.locator("#search").fill("cloud");
  // Search includes descriptions and tags: more than one motion can match.
  // Compare exact identities, not a stale assumed result count.
  const cloudIds = catalogue.motions.filter(motion =>
    `${motion.id} ${motion.label} ${motion.summary} ${motion.family} ${motion.tags.join(" ")}`.toLowerCase().includes("cloud")
  ).map(motion => motion.id);
  deepStrictEqual(await page.locator(".motion-card").evaluateAll(cards =>
    cards.map(card => card.dataset.motion)), cloudIds, "Gallery search identities differ.");
  await page.locator("#search").fill("");
  await page.locator("#runtimeOnly").check();
  if (await page.locator(".motion-card").count() !== catalogue.motions.filter(motion => motion.runtimeIdAvailable).length) throw new Error("Runtime filter failed.");
  await page.locator(".preview").first().focus();
  await page.locator(".preview").first().press("Enter");
  if (!await page.locator("#motionDialog").isVisible()) throw new Error("Keyboard preview failed.");
  await page.locator("#closeDialog").click();
  await page.locator("#runtimeOnly").uncheck();
  const frame = page.frameLocator("#cloudSlide");
  await frame.locator("#play").waitFor();
  if (await frame.locator("#play").textContent() !== "Play") throw new Error("Native demo must start paused.");
  const sources = JSON.parse(await readAllowed(root, "showcase/manifest.json"));
  if (sources.slide.runtime !== "stickman-native") throw new Error("External-dependent deck must not ship.");
  const videos = await page.locator("video").evaluateAll(async elements => {
    return Promise.all(elements.map(video => new Promise((resolve, reject) => {
      if (video.readyState >= 1) { resolve({ duration: video.duration, source: video.currentSrc }); return; }
      video.addEventListener("loadedmetadata", () => resolve({ duration: video.duration, source: video.currentSrc }), { once: true });
      video.addEventListener("error", () => reject(new Error("Video metadata failed")), { once: true });
    })));
  });
  if (videos.length !== 2 || videos.some((video, i) => Math.abs(video.duration - sources.videos[i].seconds) > .1)) throw new Error("Film metadata differs from recipe.");
  await page.screenshot({ path: join(review, "gallery-desktop.png"), fullPage: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error("Mobile page overflows.");
  if (!await frame.locator("#mobileEvidence").isVisible()) throw new Error("Mobile native summary missing.");
  await page.screenshot({ path: join(review, "gallery-mobile.png"), fullPage: true });
  if (errors.length || failed.length || external.length) throw new Error(JSON.stringify({ errors, failed, external }));
  const result = { version: provenance.version, archiveChecksums: "passed", siteFiles: manifest.files.length,
    motions: catalogue.motionCount, runtimeIds: catalogue.runtimeMotionIds.length, videos,
    nativePresentation: true, keyboardPreview: true, mobile: true, noExternalRequests: true,
    errors, failed, publicationApproved: false };
  await writeFile(join(review, "verification.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
function dirnameForReview(path) { return resolve(path, ".."); }
