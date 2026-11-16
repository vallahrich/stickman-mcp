import { execFileSync } from "node:child_process";
import http from "node:http";
import { chromium } from "@playwright/test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
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

  it("renders v0.2 #blueprint inline SVGs, toggles aria-pressed views, keeps video count === 2, and has zero mobile overflow", async () => {
    const pkg = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")) as { version: string };
    const siteOut = join(process.cwd(), ".release-local", "d2-site-verify");
    await rm(siteOut, { recursive: true, force: true });
    const showcaseDir = join(siteOut, "showcase");
    await mkdir(showcaseDir, { recursive: true });

    const slide = await nativeCloudHtml();
    await writeFile(join(showcaseDir, "on-prem-to-cloud.html"), slide.html);
    const videos = ["open-source", "julius-caesar"].map((id, index) => ({
      id,
      src: `${id}.mp4`,
      poster: `${id}.png`,
      captions: `${id}.vtt`,
      seconds: index === 0 ? 58.43 : 59.17,
      frames: index === 0 ? 1753 : 1775
    }));
    for (const v of videos) {
      await writeFile(join(showcaseDir, v.src), "");
      await writeFile(join(showcaseDir, v.poster), "");
      await writeFile(join(showcaseDir, v.captions), "WEBVTT\n\n");
    }
    await writeFile(
      join(showcaseDir, "manifest.json"),
      JSON.stringify({
        slide: { src: "on-prem-to-cloud.html", seconds: slide.seconds, runtime: "stickman-native" },
        videos
      })
    );

    execFileSync(process.execPath, [join(process.cwd(), "scripts", "site", "build.mjs"), "--release-candidate"], {
      cwd: process.cwd(),
      stdio: "pipe",
      env: { ...process.env, STICKMAN_SITE_OUTPUT: siteOut }
    });

    const mime: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".json": "application/json",
      ".svg": "image/svg+xml",
      ".js": "text/javascript",
      ".css": "text/css",
      ".png": "image/png",
      ".mp4": "video/mp4",
      ".vtt": "text/vtt",
      ".md": "text/plain; charset=utf-8",
      ".txt": "text/plain; charset=utf-8"
    };
    const server = http.createServer(async (req, res) => {
      try {
        const urlPath = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname).replace(/^\//, "") || "index.html";
        const body = await readFile(join(siteOut, urlPath));
        res.writeHead(200, { "Content-Type": mime[extname(urlPath)] ?? "text/plain" });
        res.end(body);
      } catch {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((resolveServer) => server.listen(0, "127.0.0.1", () => resolveServer()));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const base = `http://127.0.0.1:${port}`;

    const channel = process.env.STICKMAN_SITE_BROWSER ?? (process.platform === "win32" ? "msedge" : undefined);
    const browser = await chromium.launch(channel ? { channel } : undefined);
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = [];
    const external: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (!request.url().startsWith(base + "/") && request.url() !== base) {
        external.push(request.url());
      }
    });

    try {
      await page.goto(base);
      await page.locator(".motion-card").first().waitFor();

      expect(await page.locator("meta[name=robots]").getAttribute("content")).toBe("index,follow");
      expect(await page.locator(".badge").textContent()).toBe(`v${pkg.version} · Local MCP`);
      expect(await page.locator("#connect").textContent()).toContain(`vallahrich-stickman-mcp-${pkg.version}.tgz`);
      expect(await page.locator("main").textContent()).toContain("106 runtime actions");
      expect(await page.locator("main").textContent()).toContain("53 geometric");
      expect(await page.locator("main").textContent()).toContain("stickman.animation/v2");
      expect(await page.locator(".score").count()).toBe(0);

      // Strict video-count invariant: exactly 2 <video> elements across the entire page
      expect(await page.locator("video").count()).toBe(2);

      // #blueprint live scriptless animated SVGs & spatial lint badges
      const blueprint = page.locator("#blueprint");
      await expect(blueprint.isVisible()).resolves.toBe(true);
      expect(await blueprint.textContent()).toContain("0 out-of-bounds");
      expect(await blueprint.textContent()).toContain("maxSeamStepPx");
      expect(await page.locator("#bp-anim-collab [data-accessory-type='tie']").count()).toBeGreaterThan(0);
      expect(await page.locator("#bp-anim-collab [data-accessory-type='glasses']").count()).toBeGreaterThan(0);
      expect(await page.locator("#bp-anim-sports [data-addon='hurdle']").count()).toBeGreaterThan(0);
      expect(await page.locator("#bp-anim-sports [data-addon='basketball']").count()).toBeGreaterThan(0);
      expect(await page.locator("#bp-anim-sports [data-addon='hoop']").count()).toBeGreaterThan(0);

      // Accessible aria-pressed view switcher (mouse + keyboard ArrowRight)
      const cadBtn = page.locator("[data-blueprint-view='cad']");
      const stdBtn = page.locator("[data-blueprint-view='standard']");
      const roomBtn = page.locator("[data-blueprint-view='room']");

      expect(await cadBtn.getAttribute("aria-pressed")).toBe("true");
      expect(await stdBtn.getAttribute("aria-pressed")).toBe("false");
      expect(await roomBtn.getAttribute("aria-pressed")).toBe("false");
      expect(await page.locator("#blueprintPanelCad").isVisible()).toBe(true);
      expect(await page.locator("#blueprintPanelStandard").isVisible()).toBe(false);
      expect(await page.locator("#blueprintPanelRoom").isVisible()).toBe(false);
      expect(await page.locator("#bp-cad-collab").getAttribute("data-theme")).toBe("blueprint");

      await stdBtn.click();
      expect(await cadBtn.getAttribute("aria-pressed")).toBe("false");
      expect(await stdBtn.getAttribute("aria-pressed")).toBe("true");
      expect(await page.locator("#blueprintPanelCad").isVisible()).toBe(false);
      expect(await page.locator("#blueprintPanelStandard").isVisible()).toBe(true);
      expect(await page.locator("#bp-std-collab [data-panel]").count()).toBe(8);

      await stdBtn.focus();
      await stdBtn.press("ArrowRight");
      expect(await roomBtn.getAttribute("aria-pressed")).toBe("true");
      expect(await stdBtn.getAttribute("aria-pressed")).toBe("false");
      expect(await page.locator("#blueprintPanelRoom").isVisible()).toBe(true);
      expect(await page.locator("#bp-room-datum [data-part='floor-grid']").count()).toBe(1);
      expect(await page.locator("#bp-room-datum [data-occupiable='true']").count()).toBe(1);

      // Mobile 390x844 containment check across all three blueprint views + dark theme
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width: 390, height: 844 });
      for (const btn of [cadBtn, stdBtn, roomBtn]) {
        await btn.click();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      }
      await page.goto(`${base}/?scoutTheme=dark`);
      expect(await page.locator("html").getAttribute("data-theme")).toBe("dark");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      expect(errors).toEqual([]);
      expect(external).toEqual([]);
    } finally {
      await browser.close();
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      await rm(siteOut, { recursive: true, force: true });
    }
  }, 120_000);
});
