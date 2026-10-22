import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error Local native demo builder is JS.
import { nativeCloudHtml } from "../scripts/release/native-showcase.mjs";

describe("native release presentation", () => {
  it("checks every frame for clipped/overlapping text and actor collisions; plays continuously", async () => {
    const candidate = await nativeCloudHtml();
    const review = join(process.cwd(), ".release-local", "native-review");
    await mkdir(review, { recursive: true });
    const channel = process.env.STICKMAN_SITE_BROWSER ?? (process.platform === "win32" ? "msedge" : undefined);
    const browser = await chromium.launch(channel ? { channel } : undefined);
    const context = await browser.newContext({ viewport: { width: 1100, height: 760 },
      recordVideo: { dir: review, size: { width: 1100, height: 760 } } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.setContent(candidate.html);
      const result = await page.evaluate(() => {
        const native = (window as any).StickmanNative;
        const svg = document.getElementById("stage") as unknown as SVGSVGElement;
        const box = (element: Element) => (element as SVGGraphicsElement).getBBox();
        const intersects = (a: DOMRect, b: DOMRect) => a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 &&
          a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;
        const failures: unknown[] = [];
        let minimumFont = Infinity, minActorHeight = Infinity, maxActorHeight = 0;
        for (let frame = 0; frame < native.data.framesTotal; frame++) {
          native.seek(frame);
          const texts = [...svg.querySelectorAll("#diagram text")];
          const boxes = texts.map(box);
          for (let i = 0; i < boxes.length; i++) {
            const b = boxes[i];
            minimumFont = Math.min(minimumFont, Number(texts[i].getAttribute("font-size")));
            if (b.x < 0 || b.y < 0 || b.x + b.width > 1000 || b.y + b.height > 420) failures.push({ frame, clipped: texts[i].textContent });
            for (let j = i + 1; j < boxes.length; j++) if (intersects(b, boxes[j])) {
              failures.push({ frame, overlap: [texts[i].textContent, texts[j].textContent] });
            }
          }
          // Client rect includes all nested actor transforms (SVG getBBox on a
          // group does not include its own transform).
          const actor = svg.querySelector("#actor")!.getBoundingClientRect();
          const stage = svg.getBoundingClientRect();
          const actorHeight = actor.height / stage.width * 1000;
          minActorHeight = Math.min(minActorHeight, actorHeight);
          maxActorHeight = Math.max(maxActorHeight, actorHeight);
          if (actor.left < stage.left || actor.right > stage.right || actor.top < stage.top || actor.bottom > stage.bottom + 1) failures.push({ frame, actorClipped: true });
          for (const text of texts) if (intersects(actor, text.getBoundingClientRect())) failures.push({ frame, actorTextCollision: text.textContent });
          if (actor.right > stage.left + stage.width * .25) failures.push({ frame, actorOutsideReservedColumn: true });
          if (failures.length > 10) break;
        }
        native.seek(0);
        return { frames: native.data.framesTotal, failures, minimumFont, minActorHeight, maxActorHeight };
      });
      expect(result.failures).toEqual([]);
      expect(result.minimumFont).toBeGreaterThanOrEqual(24);
      expect(result.minActorHeight).toBeGreaterThanOrEqual(115);
      expect(result.maxActorHeight).toBeLessThanOrEqual(155);
      const timeline = await page.evaluate(() => (window as any).StickmanNative.data.timeline);
      for (const scene of timeline) {
        await page.evaluate(frame => (window as any).StickmanNative.seek(frame), scene.startFrame + Math.floor(scene.frames / 2));
        await page.screenshot({ path: join(review, `${scene.id}.png`) });
      }
      await page.evaluate(() => (window as any).StickmanNative.seek(0));
      await page.getByRole("button", { name: "Play", exact: true }).click();
      // Real requestAnimationFrame playback: do not replace this with sparse
      // mid/end seeking checks or a claim that numerical gates prove polish.
      const states: { frame: number; playing: boolean; scene: string }[] = [];
      for (let i = 0; i < Math.ceil(candidate.seconds); i++) {
        await page.waitForTimeout(1000);
        states.push(await page.evaluate(() => (window as any).StickmanNative.state()));
      }
      expect(new Set(states.map(state => state.scene)).size).toBe(5);
      expect(states.at(-1)?.playing).toBe(false);
      for (let i = 1; i < states.length; i++) expect(states[i].frame).toBeGreaterThanOrEqual(states[i - 1].frame);
      expect(errors).toEqual([]);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(frame => (window as any).StickmanNative.seek(frame), timeline[3].startFrame);
      await expect.poll(() => page.locator("#mobileEvidence li").count()).toBe(4);
      expect(await page.locator("#mobileEvidence").isVisible()).toBe(true);
      expect(await page.locator("#stage").isVisible()).toBe(false);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: join(review, "mobile-evidence.png") });
      await writeFile(join(review, "checks.json"), JSON.stringify({ ...result, continuousPlayback: states, errors }, null, 2));
    } finally {
      const video = page.video();
      await context.close();
      if (video) await video.saveAs(join(review, "continuous-playback.webm"));
      await browser.close();
    }
  }, 180_000);
});
