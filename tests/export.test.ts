import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { choreographAnimation } from "../src/choreograph.js";
import { compileAnimation } from "../src/compiler.js";
import { exportAnimation, planAnimationExport, resolveSafeOutputPath } from "../src/export.js";
import type { AnimationSpec } from "../src/contract.js";

const folders: string[] = [];
async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), "stickman-test-"));
  folders.push(directory);
  return directory;
}
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

const spec = {
  version: "stickman.animation/v1",
  canvas: { width: 320, height: 240, fps: 10 },
  durationMs: 800,
  actions: [{ action: "wave", startMs: 0, durationMs: 600 }]
} satisfies AnimationSpec;

describe("safe exports", () => {
  it("writes an artifact under the root and refuses traversal and overwrites", async () => {
    const root = await tempDirectory();
    const program = compileAnimation(spec).program!;
    const result = await exportAnimation(program, root, "preview.svg", "svg");
    expect(result.bytes).toBeGreaterThan(100);
    expect(await readFile(resolve(root, "preview.svg"), "utf8")).toContain("<svg");
    await expect(resolveSafeOutputPath(root, "../outside.svg")).rejects.toThrow("inside the approved output root");
    await expect(exportAnimation(program, root, "preview.svg", "svg")).rejects.toThrow("already exists");
  });

  it("refuses a symlinked output directory", async () => {
    const root = await tempDirectory();
    const elsewhere = await tempDirectory();
    await symlink(elsewhere, resolve(root, "linked"), "junction");
    await expect(resolveSafeOutputPath(root, "linked/output.svg")).rejects.toThrow("symlinks");
  });

  it("plans uncapped raster exports with advisory work and propagates cancellation/progress errors", async () => {
    const root = await tempDirectory();
    const longProgram = compileAnimation({
      ...spec,
      canvas: { ...spec.canvas, fps: 30 },
      durationMs: 60_300,
      actions: [{ action: "wave", startMs: 0, durationMs: 60_000 }]
    }).program!;
    const plan = planAnimationExport(longProgram, "mp4");
    expect(plan.estimatedWork.frameCount).toBeGreaterThan(1800);
    expect(plan.warnings.join(" ")).toContain("curated-showcase limit");
    const controller = new AbortController();
    controller.abort();
    await expect(exportAnimation(compileAnimation(spec).program!, root, "cancelled.svg", "svg", { signal: controller.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
    await expect(exportAnimation(compileAnimation(spec).program!, root, "progress.svg", "svg", {
      onProgress: () => { throw new Error("progress consumer failed"); }
    })).rejects.toThrow("progress consumer failed");
    await expect(readFile(resolve(root, "cancelled.svg"))).rejects.toThrow();
    await expect(readFile(resolve(root, "progress.svg"))).rejects.toThrow();
  });

  it("loads system fonts in video export only for SVG frames containing <text> labels", async () => {
    const root = resolve(process.cwd(), `.stickman-video-test-${randomUUID()}`);
    await mkdir(root, { recursive: true });
    folders.push(root);

    const fontFlagsPure: boolean[] = [];
    class MockPureResvg {
      constructor(_svg: string, options?: { font?: { loadSystemFonts?: boolean } }) {
        fontFlagsPure.push(Boolean(options?.font?.loadSystemFonts));
      }
      render() {
        return { asPng: () => new Uint8Array([137, 80, 78, 71]) };
      }
    }
    const stubEncoder = async (args: string[]) => {
      await writeFile(args.at(-1)!, Buffer.from("GIF89a"));
    };

    const pureProgram = compileAnimation(spec).program!;
    const pureRes = await exportAnimation(pureProgram, root, "pure.gif", "gif", {
      loadResvg: async () => ({ Resvg: MockPureResvg }),
      runEncoder: stubEncoder
    });
    expect(pureRes.bytes).toBe(6);
    expect(fontFlagsPure.length).toBeGreaterThanOrEqual(2);
    expect(fontFlagsPure.every((flag) => flag === false)).toBe(true);

    const fontFlagsText: Array<{ hasTextTag: boolean; loadSystemFonts: boolean }> = [];
    class MockTextResvg {
      constructor(svg: string, options?: { font?: { loadSystemFonts?: boolean } }) {
        fontFlagsText.push({
          hasTextTag: svg.includes("<text"),
          loadSystemFonts: Boolean(options?.font?.loadSystemFonts)
        });
      }
      render() {
        return { asPng: () => new Uint8Array([137, 80, 78, 71]) };
      }
    }

    const cardProgram = choreographAnimation({
      canvas: { width: 320, height: 240, fps: 5 },
      actions: [{ action: "present-card", durationMs: 1000, addon: { type: "card", text: "Ship R9" } }]
    }).program!;
    const cardRes = await exportAnimation(cardProgram, root, "card.gif", "gif", {
      loadResvg: async () => ({ Resvg: MockTextResvg }),
      runEncoder: stubEncoder
    });
    expect(cardRes.bytes).toBe(6);
    expect(fontFlagsText.some((entry) => entry.hasTextTag && entry.loadSystemFonts)).toBe(true);
    expect(fontFlagsText.some((entry) => !entry.hasTextTag && !entry.loadSystemFonts)).toBe(true);
    expect(fontFlagsText.every((entry) => entry.loadSystemFonts === entry.hasTextTag)).toBe(true);
  });
});
