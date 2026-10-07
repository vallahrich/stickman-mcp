import { test, expect } from "@playwright/test";

test("all approved assets, truthful runtime scope and private indexing", async ({ page, request }) => {
  const response = await request.get("/catalogue.json");
  const catalogue = await response.json();
  expect(catalogue.approvedCount).toBe(98);
  expect(catalogue.motions).toHaveLength(98);
  expect(catalogue.runtimeMotionIds).toHaveLength(11);
  expect(catalogue.motions.some(m => ["dance", "roll"].includes(m.id))).toBe(false);
  expect(catalogue.motions.find(m => m.id === "rack-server").runtimeIdAvailable).toBe(false);
  for (const motion of catalogue.motions.flatMap(m => [m, ...m.variants])) {
    for (const asset of [motion.poster, motion.preview, motion.spec]) expect((await request.get("/" + asset)).status(), asset).toBe(200);
  }
  expect(catalogue.motions.find(m => m.id === "pull-banner").variants).toHaveLength(3);
  expect(catalogue.motions.find(m => m.id === "throw").variants[0].id).toBe("basketball-shot");
  await page.goto("/");
  await expect(page.locator("#category")).toHaveValue("IT");
  await expect(page.locator(".motion-card")).toHaveCount(catalogue.motions.filter(m => m.family === "IT").length);
  await expect(page.locator("meta[name=robots]")).toHaveAttribute("content", "noindex,nofollow");
  expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  await expect(page.locator(".scope")).toContainText("Approval is not automatic shipping");
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

test("real NIST comparison animates inside the deck and media supports seeking", async ({ page, request }) => {
  const comparison = await (await request.get("/demo/comparison.json")).json();
  expect(comparison.slides.map(s => s.page)).toEqual([1, 2, 4, 5]);
  expect(comparison.historicalPreRelease).toBe(true);
  await page.goto("/");
  await expect(page.locator("#inSlidePlayer")).toBeHidden();
  await page.locator("#after").click();
  await expect(page.locator("#inSlidePlayer")).toBeVisible();
  await expect(page.locator("#sourceSlide")).toBeHidden();
  const scene = page.frameLocator("#inSlidePlayer");
  await expect(scene.locator('[data-actor="inside-slide"]')).toBeVisible();
  const x = await scene.locator("#scene svg").getAttribute("data-actor-x");
  await page.waitForTimeout(3100);
  expect(await scene.locator("#scene svg").getAttribute("data-actor-x")).not.toBe(x);
  await page.locator("#before").click();
  await expect(page.locator("#inSlidePlayer")).not.toHaveAttribute("src", /.+/);
  for (const file of ["nist-original.pptx", "nist-with-stickman.pptx", "nist-original.pdf"]) expect((await request.get("/demo/" + file)).status()).toBe(200);
  const video = await request.get("/showcase.mp4", { headers: { Range: "bytes=0-99" } });
  expect(video.status()).toBe(206);
  expect((await video.body()).length).toBe(100);
  const badRange = await request.get("/showcase.mp4", { headers: { Range: "bytes=999999999999-" } });
  expect(badRange.status()).toBe(416);
});
