import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { compileAnimation } from "../src/compiler.js";
import { exportAnimation, resolveSafeOutputPath } from "../src/export.js";
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
});
