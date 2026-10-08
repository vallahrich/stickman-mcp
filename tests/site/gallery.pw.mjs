import { test, expect } from "@playwright/test";
import { createSiteServer } from "../../scripts/site/serve.mjs";

test("rating-free release assets, truthful runtime scope and private indexing", async ({ page, request }) => {
  const response = await request.get("/catalogue.json");
  const catalogue = await response.json();
  expect(catalogue.development).toBe(false);
  expect(catalogue).not.toHaveProperty("approvedCount");
  expect(catalogue).not.toHaveProperty("pending");
  expect(catalogue.motionCount).toBe(97);
  expect(catalogue.motions).toHaveLength(97);
  expect(catalogue.runtimeMotionIds).toHaveLength(11);
  expect(catalogue.motions.some(m => ["dance", "roll", "sneak"].includes(m.id))).toBe(false);
  expect(catalogue.motions.find(m => m.id === "rack-server").runtimeIdAvailable).toBe(false);
  for (const motion of catalogue.motions.flatMap(m => [m, ...m.variants])) {
    for (const asset of [motion.poster, motion.preview, motion.spec]) expect((await request.get("/" + asset)).status(), asset).toBe(200);
    expect(motion).not.toHaveProperty("score");
    expect(motion).not.toHaveProperty("note");
    const spec = await (await request.get("/" + motion.spec)).json();
    expect(spec).not.toHaveProperty("notes");
    expect(spec).not.toHaveProperty("status");
    expect(spec).not.toHaveProperty("approvedBaseline");
    const preview = await (await request.get("/" + motion.preview)).text();
    const embedded = JSON.parse(preview.match(/<script id="data" type="application\/json">([\s\S]+?)<\/script>/)[1]);
    expect(embedded.spec).toEqual(spec);
    expect(JSON.stringify(embedded)).not.toMatch(/\b\d+(?:\.\d+)?\/10\b/);
  }
  expect(catalogue.motions.find(m => m.id === "pull-banner").variants).toHaveLength(3);
  expect(catalogue.motions.find(m => m.id === "throw").variants[0].id).toBe("basketball-shot");
  await page.goto("/");
  await expect(page.locator("#category")).toHaveValue("IT");
  await expect(page.locator(".motion-card")).toHaveCount(catalogue.motions.filter(m => m.family === "IT").length);
  await expect(page.locator("meta[name=robots]")).toHaveAttribute("content", "noindex,nofollow");
  expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  await expect(page.locator(".scope")).toContainText("Preview and runtime availability are separate");
  await expect(page.locator(".score")).toHaveCount(0);
});

test("existing runtime recipes remain available outside the focused showcase", async ({ request }) => {
  const stories = await (await request.get("/stories.json")).json();
  expect(stories).toHaveLength(3);
  for (const story of stories) {
    const recipe = await (await request.get("/" + story.recipe)).json();
    const animation = await (await request.get("/" + story.animation)).json();
    expect(animation).toEqual(recipe.animation);
    expect(animation.actions).toHaveLength(story.actions.length);
    expect((await request.get("/" + story.motionPreview)).status()).toBe(200);
  }
});

test("cloud slide starts paused and remains readable on mobile", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const frame = page.frameLocator("#cloudSlide");
  await expect(frame.locator("#play")).toHaveText("Play");
  await expect(frame.locator("#seek")).toHaveValue("0");
  await page.waitForTimeout(500);
  await expect(frame.locator("#seek")).toHaveValue("0");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(frame.locator(".slide")).toHaveCount(5);
  await expect(frame.locator("body")).toContainText("Workload migration comparison");
});

test("development retains ratings and mechanical requalification independently of release", async ({ page, request }) => {
  const server = await createSiteServer({ development: true });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const catalogue = await (await request.get(base + "/catalogue.json")).json();
    expect(catalogue.development).toBe(true);
    expect(catalogue.approvedCount).toBe(98);
    expect(catalogue.motions).toHaveLength(98);
    expect(catalogue.pending.map(m => m.id).sort()).toEqual(["dance", "roll"]);
    expect(catalogue.motions.find(m => m.id === "sneak").mechanicalCheck).toBe("needs-requalification");
    const motion = catalogue.motions.find(m => m.id === "video-call");
    expect(motion.score).toBe("10");
    expect(motion.note).toContain("10/10");
    const spec = await (await request.get(base + "/" + motion.spec)).json();
    expect(spec.notes).toContain("7/10");
    await page.goto(base);
    await expect(page.locator(".score")).not.toHaveCount(0);
    await page.locator('[data-motion="video-call"] .preview').click();
    await expect(page.locator("#dialogScope")).toContainText("10/10");
    await page.locator("#closeDialog").click();
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("one hover player, real 1x progression and disposal", async ({ page }) => {
  await page.goto("/");
  const card = page.locator('[data-motion="video-call"] .preview');
  await card.hover();
  await expect(page.locator(".preview iframe")).toHaveCount(1);
  const frame = page.frameLocator('[data-motion="video-call"] iframe');
  await expect(frame.locator("#stage")).toHaveAttribute("viewBox", /.+/);
  const start = await frame.locator("#frameNo").evaluate(el => ({ frame: parseInt(el.textContent, 10), time: performance.now() }));
  const svg = await frame.locator("#stage").innerHTML();
  await page.waitForTimeout(1000);
  const end = await frame.locator("#frameNo").evaluate(el => ({ frame: parseInt(el.textContent, 10), time: performance.now() }));
  expect(Math.abs((end.frame - start.frame) - (end.time - start.time) / 1000 * 30)).toBeLessThan(5);
  expect(await frame.locator("#stage").innerHTML()).not.toBe(svg);
  await page.locator('[data-motion="open-laptop"] .preview').hover();
  await expect(page.locator(".preview iframe")).toHaveCount(1);
  await page.locator("h1").hover();
  await expect(page.locator(".preview iframe")).toHaveCount(0);
});

test("search, runtime filtering, keyboard dialog and disposal", async ({ page }) => {
  await page.goto("/");
  await page.locator("#search").fill("cloud");
  await expect(page.locator(".motion-card")).toHaveCount(1);
  await expect(page.locator(".motion-card")).toHaveAttribute("data-motion", "rack-server");
  await page.locator("#category").selectOption("");
  await page.locator("#search").fill("no-such-motion");
  await expect(page.locator("#empty")).toBeVisible();
  await page.locator("#search").fill("");
  await page.locator("#runtimeOnly").check();
  const response = await page.request.get("/catalogue.json");
  const catalogue = await response.json();
  await expect(page.locator(".motion-card")).toHaveCount(catalogue.motions.filter(m => m.runtimeIdAvailable).length);
  const first = page.locator(".preview").first();
  await first.focus(); await first.press("Enter");
  await expect(page.locator("#motionDialog")).toBeVisible();
  await expect(page.locator(".preview iframe")).toHaveCount(0);
  await page.locator("#closeDialog").click();
  await expect(page.locator("#fullPreview")).not.toHaveAttribute("src", /.+/);
});

test("reduced motion stays still and mobile does not overflow", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?scoutTheme=light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const button = page.locator('[data-motion="video-call"] .preview');
  await button.focus();
  await expect(page.locator(".preview iframe")).toHaveCount(0);
  await button.click();
  const frame = page.frameLocator("#fullPreview");
  await expect(frame.locator("#frameNo")).toHaveText(/^0/);
  await page.waitForTimeout(500);
  await expect(frame.locator("#frameNo")).toHaveText(/^0/);
  await page.locator("#closeDialog").click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("client commands quote paths, do not invent endpoints and never install settings", async ({ page }) => {
  await page.goto("/");
  await page.locator("#checkout").fill("C:\\Team's Projects\\stickman-mcp");
  await page.locator("#agent").selectOption("claude");
  await expect(page.locator("#connectCommand")).toContainText("claude mcp add --transport stdio stickman -- node 'C:\\Team''s Projects\\stickman-mcp\\dist\\mcp.js'");
  await page.locator("#agent").selectOption("codex");
  await expect(page.locator("#connectCommand")).toContainText("codex mcp add stickman -- node");
  await expect(page.locator("#connectCommand")).not.toContainText("--type");
  await expect(page.locator("#connectCommand")).toContainText("--root");
});

test("only the cloud slide and two playable videos remain, each under one minute", async ({ page, request }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const manifest = await (await request.get("/showcase/manifest.json")).json();
  expect(manifest.videos).toHaveLength(2);
  expect(manifest.videos.map(video => video.id)).toEqual(["open-source", "julius-caesar"]);
  expect(manifest.slide.seconds).toBeLessThanOrEqual(60);
  await page.goto("/");
  await expect(page.locator("#showcase iframe")).toHaveCount(1);
  await expect(page.locator("#showcase video")).toHaveCount(2);
  await expect(page.locator("#comparison, #stories")).toHaveCount(0);
  expect(await page.locator("body").textContent()).not.toMatch(/\b(?:NIST|NASA)\b/);
  const frame = page.frameLocator("#cloudSlide");
  await expect(frame.locator("#play")).toHaveText("Play");
  await frame.locator("#seek").focus();
  await frame.locator("#seek").press("End");
  await expect(frame.locator("#seek")).toHaveValue(String(Math.round(manifest.slide.seconds * 30) - 1));
  await expect(frame.locator("#play")).toHaveText("Replay");
  for (const [index, film] of manifest.videos.entries()) {
    expect(film.fps).toBe(30);
    expect(film.scenes).toHaveLength(index ? 7 : 6);
    expect(film.seconds).toBeGreaterThan(45);
    expect(film.seconds).toBeLessThanOrEqual(60);
    expect(film.frames).toBe(Math.round(film.seconds * 30));
    expect(film.style).toBe("silent-short-film");
    expect(film.audio).toBe(false);
    const authored = film.provenance.filter(item => item.kind === "authored-key-pose");
    expect(film.provenance.every(item => ["authored-key-pose", "generated-from-walk-on-gait", "continuous-composite"].includes(item.kind))).toBe(true);
    expect(authored.every(item => !["walk", "point", "idle", "stop", "jump"].includes(item.id))).toBe(true);
    expect(film.provenance.at(-1)).toMatchObject({ kind: "continuous-composite", camera: "locked" });
    expect(film.provenance.at(-1).maxJointStep).toBeLessThanOrEqual(14);
    expect(film.sha256).toMatch(/^[a-f0-9]{64}$/);
    for (const motion of authored) expect(motion.specSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(new Set(film.scenes.map(scene => scene.state)).size).toBe(film.scenes.length);
    const captions = await (await request.get("/showcase/" + film.captions)).text();
    for (const scene of film.scenes) for (const cue of scene.cues) expect(captions).toContain(cue.text);
    expect(film.scenes[0].startFrame).toBe(0);
    expect(film.scenes.reduce((frames, scene) => {
      expect(scene.startFrame).toBe(frames);
      return frames + scene.frames;
    }, 0)).toBe(film.frames);
    expect(film.frames / film.fps).toBeCloseTo(film.seconds, 2);
    const video = page.locator("#showcase video").nth(index);
    await expect(video.locator("source")).toHaveAttribute("src", `showcase/${film.src}?v=${film.sha256}`);
    await video.evaluate(async el => {
      if (el.readyState < 1) await new Promise((resolve, reject) => { el.addEventListener("loadedmetadata", resolve, { once: true }); el.addEventListener("error", reject, { once: true }); el.load(); });
      await el.play();
    });
    expect(await video.evaluate(el => el.duration)).toBeCloseTo(film.seconds, 1);
    expect(await video.evaluate(el => el.duration)).toBeLessThanOrEqual(60);
    await expect.poll(() => video.evaluate(el => el.currentTime)).toBeGreaterThan(.1);
    await video.evaluate(el => { el.currentTime = el.duration - .25; });
    await expect.poll(() => video.evaluate(el => el.ended)).toBe(true);
    expect(await video.evaluate(el => el.error)).toBeNull();
  }
  await page.locator("#showcase video").first().evaluate(el => { el.currentTime = 0; return el.play(); });
  // The deck toolbar is fixed to the bottom of the iframe, so bring the whole slide into view first.
  await page.locator("#cloudSlide").scrollIntoViewIfNeeded();
  await frame.locator("#play").click();
  await expect.poll(() => page.locator("#showcase video").first().evaluate(el => el.paused)).toBe(true);
  await page.locator("#showcase video").last().evaluate(el => { el.currentTime = 0; return el.play(); });
  await expect(frame.locator("#play")).toHaveText("Play");
  await page.locator("#showcase video").last().evaluate(el => el.pause());
  for (const file of ["nist-original.pptx", "nist-with-stickman.pptx", "nist-original.pdf", "nasa-original.pptx", "comparison.json"]) expect((await request.get("/demo/" + file)).status()).toBe(404);
  for (const id of ["it-workplace", "expressive"]) expect((await request.get(`/showcase/${id}.mp4`)).status()).toBe(404);
  const video = await request.get("/showcase/open-source.mp4", { headers: { Range: "bytes=0-99" } });
  expect(video.status()).toBe(206);
  expect((await video.body()).length).toBe(100);
  const badRange = await request.get("/showcase/open-source.mp4", { headers: { Range: "bytes=999999999999-" } });
  expect(badRange.status()).toBe(416);
  expect(errors).toEqual([]);
});
