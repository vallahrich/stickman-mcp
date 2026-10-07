import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import ffmpeg from "ffmpeg-static";
import { buildPresentation } from "../../scripts/presentations/build.mjs";

let artifact, temporary;
test.beforeAll(async () => {
  if (process.env.STICKMAN_PRESENTATION_HTML) {
    artifact = path.resolve(process.env.STICKMAN_PRESENTATION_HTML);
    return;
  }
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), "stickman-presentation-"));
  const poster = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5GQAAAAASUVORK5CYII=", "base64");
  await fs.writeFile(path.join(temporary, "poster.png"), poster);
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=white:s=160x90:d=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", path.join(temporary, "movie.mp4")]);
  const movie = await fs.readFile(path.join(temporary, "movie.mp4"));
  const hash = value => createHash("sha256").update(value).digest("hex");
  const assets = {
    poster: { path: "poster.png", mime: "image/png", sha256: hash(poster) },
    movie: { path: "movie.mp4", mime: "video/mp4", sha256: hash(movie) }
  };
  const originals = [1, 2, 3].map(number => ({
    number, text: [`Original title ${number}`], notes: [`Unmodified source note ${number}`],
    links: ["https://example.invalid/resource"], media: number === 2 ? ["poster", "movie"] : ["poster"],
    shapes: [{ bounds: { x: 100, y: 160, width: 900, height: 500 }, media: ["poster"], text: [], crop: { t: "500" } }]
  }));
  const slides = originals.map(original => ({
    source: original.number, section: "Authored example", title: `Test slide ${original.number}`, subtitle: "Source-free local fixture.",
    nodes: [{ id: "activity", x: 320, y: 340, width: 300, height: 120, label: ["Activity"] }],
    beats: [
      { caption: "Wait for the presenter.", active: [] },
      { caption: "Show the next step.", active: ["activity"], actor: { motion: "point", x: 200, groundY: 460, scale: .8, from: 0, to: 32, durationMs: 200 } },
      { caption: "Hold the complete explanation.", active: ["activity"] }
    ],
    ...(original.number === 2 ? { video: { asset: "movie", poster: "poster", x: 730, y: 220, width: 450, height: 254 } } : {})
  }));
  const sourceFile = path.join(temporary, "source.json"), designFile = path.join(temporary, "design.json");
  await fs.writeFile(sourceFile, JSON.stringify({ version: 1, sourceName: "fixture.pptx", sourceSha256: "fixture", canvasEmu: { width: 1280, height: 720 }, slides: originals, assets }));
  await fs.writeFile(designFile, JSON.stringify({ title: "Offline fixture", slides }));
  artifact = path.join(temporary, "fixture.html");
  await buildPresentation({ sourceFile, designFile, outputFile: artifact });
});
test.afterAll(async () => {
  if (temporary) {
    for (const filename of ["poster.png", "movie.mp4", "source.json", "design.json", "fixture.html"]) await fs.unlink(path.join(temporary, filename));
    await fs.rmdir(temporary);
  }
});
test.beforeEach(async ({ page, context }) => {
  await context.setOffline(true);
  await page.goto(`${pathToFileURL(artifact).href}?scoutTheme=light`);
  await expect(page.locator("#error")).toBeHidden();
});
const model = page => page.locator("#presentation-data").evaluate(el => {
  const data = JSON.parse(el.textContent);
  return { slides: data.slides, sourceCount: data.sourceCount, sourceSha256: data.sourceSha256 };
});
const finish = async page => {
  await expect(page.locator("#next")).not.toHaveText("Finish beat");
};

test("opens file offline, waits for Next, and preserves source ordering", async ({ page }) => {
  const data = await model(page);
  expect(data.slides.map(slide => slide.source)).toEqual([...data.slides.map(slide => slide.source)].sort((a, b) => a-b));
  await expect(page.locator("#caption")).toHaveText(data.slides[0].beats[0].caption);
  await page.waitForTimeout(300);
  await expect(page.locator("#caption")).toHaveText(data.slides[0].beats[0].caption);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.locator("body").click({ position: { x: 4, y: 4 } });
  await page.keyboard.press("Space");
  await finish(page);
  await expect(page.locator("#caption")).toHaveText(data.slides[0].beats[1].caption);
  await expect(page.locator("#actor [data-stickman]")).toHaveCount(1);
});
test("Back and Replay reconstruct the same stable geometry and cues", async ({ page }) => {
  await page.locator("#next").click();
  await finish(page);
  const geometry = await page.locator("#actor").innerHTML();
  const active = await page.locator("[data-target].active").evaluateAll(nodes => nodes.map(node => node.dataset.target));
  await page.locator("#replay").click();
  await finish(page);
  expect(await page.locator("#actor").innerHTML()).toBe(geometry);
  await page.locator("#next").click();
  await finish(page);
  await page.locator("#back").click();
  expect(await page.locator("[data-target].active").evaluateAll(nodes => nodes.map(node => node.dataset.target))).toEqual(active);
  expect(await page.locator("#actor").innerHTML()).toBe(geometry);
});
test("source notes and uncropped images remain available", async ({ page }) => {
  const data = await model(page);
  await page.locator("#notes").click();
  for (const note of data.slides[0].original.notes) await expect(page.locator("#dialog-body")).toContainText(note);
  await page.locator("#close-dialog").click();
  await page.locator("#source").click();
  expect(await page.locator(".source-assets img").count()).toBeGreaterThan(0);
  expect(await page.locator(".source-assets img").evaluateAll(images => images.every(img => img.complete && img.naturalWidth > 0))).toBe(true);
  await page.locator("#close-dialog").click();
});
test("video plays offline, hides actor, blocks Next, and is disposed on slide jump", async ({ page }) => {
  const data = await model(page);
  const index = data.slides.findIndex(slide => slide.video);
  expect(index).toBeGreaterThanOrEqual(0);
  await page.locator("#slide-select").selectOption(String(index));
  await page.locator("#next").click();
  await finish(page);
  if (data.slides[index].video.focus?.beat === 1) {
    await expect(page.locator("#video-detail")).toBeVisible();
    await expect(page.locator("#poster")).toBeHidden();
    const detail = await page.locator("#video-detail").evaluate(svg => ({
      width: svg.viewBox.baseVal.width, height: svg.viewBox.baseVal.height,
      imageWidth: Number(svg.querySelector("image").getAttribute("width"))
    }));
    expect(detail.width).toBeGreaterThan(0);
    expect(detail.height).toBeGreaterThan(0);
    expect(detail.imageWidth).toBeGreaterThan(0);
  }
  await page.locator("#play-demo").click();
  await expect(page.locator("video")).toHaveJSProperty("paused", false);
  await expect(page.locator("#next")).toBeDisabled();
  await expect(page.locator("#actor [data-stickman]")).toHaveCount(0);
  await expect(page.locator("#play-overlay")).toBeHidden();
  await expect(page.locator("#video-detail")).toBeHidden();
  await expect.poll(() => page.locator("video").evaluate(video => video.currentTime)).toBeGreaterThan(0);
  await page.locator("video").evaluate(video => video.pause());
  const stopped = await page.locator("#caption").textContent();
  await page.locator("video").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("#caption")).toHaveText(stopped);
  await page.locator("#back").click();
  await expect(page.locator("#poster")).toBeVisible();
  await expect(page.locator("video")).toBeHidden();
  await expect(page.locator("#play-overlay")).toBeVisible();
  await page.locator("video").evaluate(video => { window.outgoingVideo = video; });
  await page.locator("#slide-select").selectOption("0");
  expect(await page.evaluate(() => ({ paused: window.outgoingVideo.paused, src: window.outgoingVideo.getAttribute("src") }))).toEqual({ paused: true, src: null });
  await expect(page.locator("#error")).toBeHidden();
});
test("reduced motion and Animation off retain every explanation beat", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  const data = await model(page);
  await expect(page.locator("#motion")).toHaveAttribute("aria-pressed", "false");
  for (let index = 1; index < data.slides[0].beats.length; index++) {
    await page.locator("#next").click();
    await expect(page.locator("#caption")).toHaveText(data.slides[0].beats[index].caption);
    await expect(page.locator("#actor [data-stickman]")).toHaveCount(0);
  }
  await expect(page.locator("#error")).toBeHidden();
});
test("all slides and stable beats render without nonfinite geometry or missing captions", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const data = await model(page);
  for (let slide = 0; slide < data.slides.length; slide++) {
    await page.locator("#slide-select").selectOption(String(slide));
    for (let index = 0; index < data.slides[slide].beats.length; index++) {
      if (index) { await page.locator("#next").click(); await finish(page); }
      await expect(page.locator("#caption")).toHaveText(data.slides[slide].beats[index].caption);
      const invalidGeometry = await page.locator("#stage svg").evaluateAll(roots => roots.flatMap(root =>
        [...root.querySelectorAll("*")].flatMap(node => [...node.attributes]
          .filter(attribute => ["d", "x", "y", "cx", "cy", "r", "width", "height", "transform", "viewBox"].includes(attribute.name) && /NaN|Infinity/.test(attribute.value))
          .map(attribute => `${node.tagName}.${attribute.name}`))));
      expect(invalidGeometry).toEqual([]);
      await expect(page.locator("#error")).toBeHidden();
      if (process.env.STICKMAN_PRESENTATION_QA) await page.locator(".stage-frame").screenshot({ path: path.join(process.env.STICKMAN_PRESENTATION_QA, `slide-${data.slides[slide].source}-beat-${index}.png`) });
    }
  }
  await expect(page.locator("#next")).toBeDisabled();
  expect(errors).toEqual([]);
});
test("responsive projection stays isotropic and source dialogs fit small screens", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 900 });
  const ratio = await page.locator(".stage-frame").evaluate(frame => frame.clientWidth / frame.clientHeight);
  expect(ratio).toBeCloseTo(16/9, 1);
  await page.locator("#source").click();
  const rectangle = await page.locator("#dialog").boundingBox();
  expect(rectangle.width).toBeLessThanOrEqual(640);
  await page.locator("#close-dialog").click();
});

test("actor cues stay finite during playback and explicit Finish holds the current beat", async ({ page }) => {
  const data = await model(page);
  for (let index = 0; index < data.slides.length; index++) {
    await page.locator("#slide-select").selectOption(String(index));
    const actorBeat = data.slides[index].beats.findIndex(item => item.actor);
    if (actorBeat < 1) continue;
    for (let next = 1; next < actorBeat; next++) { await page.locator("#next").click(); await finish(page); }
    await page.locator("#next").click();
    const motion = data.slides[index].beats[actorBeat].actor;
    if (motion.durationMs > 500) {
      await page.waitForTimeout(250);
      const head = await page.locator("#actor #head").evaluate(head => [head.cx.baseVal.value, head.cy.baseVal.value, head.r.baseVal.value]);
      expect(head.every(Number.isFinite)).toBe(true);
      if (process.env.STICKMAN_PRESENTATION_QA) await page.locator(".stage-frame").screenshot({
        path: path.join(process.env.STICKMAN_PRESENTATION_QA, `slide-${data.slides[index].source}-moving.png`)
      });
      if (await page.locator("#next").textContent() === "Finish beat") await page.locator("#next").click();
    }
    await finish(page);
    await expect(page.locator("#caption")).toHaveText(data.slides[index].beats[actorBeat].caption);
    await expect(page.locator("#error")).toBeHidden();
  }
});
