import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  actionCatalog,
  animationSchema,
  animationSchemaV2,
  describeAction,
  queryActionCatalog
} from "../src/index.js";

const scratchDirs: string[] = [];

afterEach(async () => {
  for (const dir of scratchDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function createScratchDir(): Promise<string> {
  const dir = resolve(process.cwd(), `.cli-v02-test-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  scratchDirs.push(dir);
  return dir;
}

function invokeCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const child = spawnSync(process.execPath, [resolve(process.cwd(), "dist", "cli.js"), ...args], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 15_000
  });
  expect(child.error).toBeUndefined();
  return {
    status: child.status,
    stdout: child.stdout,
    stderr: child.stderr
  };
}

describe("CLI v0.2 commands and flags", () => {
  it("supports discover filters, bare/versioned describe, and schema --version v1|v2", () => {
    const all = invokeCli(["discover"]);
    expect(all.status).toBe(0);
    expect(JSON.parse(all.stdout)).toEqual(actionCatalog);

    const byCat = invokeCli([
      "discover",
      "--category",
      "sport",
      "--kind",
      "oneshot",
      "--prop",
      "ball"
    ]);
    expect(byCat.status).toBe(0);
    const byCatParsed = JSON.parse(byCat.stdout) as unknown[];
    expect(byCatParsed.length).toBeGreaterThanOrEqual(1);
    expect(byCatParsed).toEqual(
      queryActionCatalog({ category: "sport", kind: "oneshot", prop: "ball" })
    );

    const bySearch = invokeCli(["discover", "--travel", "in-place", "--tag", "gesture", "--search", "point"]);
    expect(bySearch.status).toBe(0);
    const bySearchParsed = JSON.parse(bySearch.stdout) as unknown[];
    expect(bySearchParsed.length).toBeGreaterThanOrEqual(1);
    expect(bySearchParsed).toEqual(
      queryActionCatalog({ travel: "in-place", tag: "gesture", search: "point" })
    );

    const descBare = invokeCli(["describe", "--id", "idea"]);
    expect(descBare.status).toBe(0);
    expect(JSON.parse(descBare.stdout)).toEqual(describeAction("idea"));

    const descVer = invokeCli(["describe", "--id", "idea@1.1.0"]);
    expect(descVer.status).toBe(0);
    expect(JSON.parse(descVer.stdout)).toEqual(describeAction("idea@1.1.0"));

    const schemaDefault = invokeCli(["schema"]);
    expect(schemaDefault.status).toBe(0);
    expect(JSON.parse(schemaDefault.stdout)).toEqual(animationSchema);

    const schemaV2 = invokeCli(["schema", "--version", "v2"]);
    expect(schemaV2.status).toBe(0);
    expect(JSON.parse(schemaV2.stdout)).toEqual(animationSchemaV2);

    const badSchema = invokeCli(["schema", "--version", "v9"]);
    expect(badSchema.status).toBe(1);
    expect(badSchema.stderr).toContain('must be "v1" or "v2"');
  });

  it("supports choreograph, storyboard (SVG & --lint-only), and storyboard-svg/svg-frame preview & export", async () => {
    const dir = await createScratchDir();
    const outRoot = resolve(dir, "exports");
    await mkdir(outRoot, { recursive: true });

    const shorthandPath = resolve(dir, "shorthand.json");
    const invalidPath = resolve(dir, "invalid.json");
    const v2SpecPath = resolve(dir, "scene-v2.json");

    await writeFile(
      shorthandPath,
      JSON.stringify({
        actor: { id: "host", x: "offstage-left", accessory: "tie" },
        actions: [
          { action: "walk-on", to: "left", emitCue: "ready" },
          { action: "think" },
          { action: "idea", emitCue: "eureka" },
          { action: "cheer" }
        ]
      }),
      "utf8"
    );

    await writeFile(
      invalidPath,
      JSON.stringify({
        actions: [{ action: "teleport-into-orbit" }]
      }),
      "utf8"
    );

    // 1. choreograph valid & invalid
    const choreoOk = invokeCli(["choreograph", "--input", shorthandPath]);
    expect(choreoOk.status).toBe(0);
    const choreoParsed = JSON.parse(choreoOk.stdout) as {
      valid: boolean;
      diagnostics: unknown[];
      spec: Record<string, unknown>;
      events: unknown[];
      summary: string;
    };
    expect(choreoParsed.valid).toBe(true);
    expect(choreoParsed.diagnostics).toEqual([]);
    expect(choreoParsed.spec.version).toBe("stickman.animation/v2");
    expect(Array.isArray(choreoParsed.events)).toBe(true);
    expect(choreoParsed.events.length).toBeGreaterThan(0);
    expect(choreoParsed.summary).toContain("host");

    await writeFile(v2SpecPath, JSON.stringify(choreoParsed.spec, null, 2), "utf8");

    const choreoBad = invokeCli(["choreograph", "--input", invalidPath]);
    expect(choreoBad.status).toBe(1);
    expect(JSON.parse(choreoBad.stdout)).toMatchObject({
      valid: false,
      diagnostics: expect.arrayContaining([expect.objectContaining({ code: "unsupported_action" })])
    });

    // 2. validate & compile on shorthand AND v2 spec
    for (const inputFile of [shorthandPath, v2SpecPath]) {
      const valRes = invokeCli(["validate", "--input", inputFile]);
      expect(valRes.status).toBe(0);
      expect(JSON.parse(valRes.stdout)).toEqual({ valid: true, diagnostics: [] });

      const compRes = invokeCli(["compile", "--input", inputFile]);
      expect(compRes.status).toBe(0);
      expect(JSON.parse(compRes.stdout).program.contractVersion).toBe("stickman.animation/v2");
    }

    // 3. storyboard SVG & --lint-only
    const sbSvg = invokeCli([
      "storyboard",
      "--input",
      shorthandPath,
      "--columns",
      "3",
      "--max-panels",
      "6",
      "--mode",
      "normal"
    ]);
    expect(sbSvg.status).toBe(0);
    expect(sbSvg.stdout).toContain("<svg");
    expect(sbSvg.stdout).toContain("Stickman storyboard");

    const sbLint = invokeCli(["storyboard", "--lint-only", "--input", shorthandPath]);
    expect(sbLint.status).toBe(0);
    const lintData = JSON.parse(sbLint.stdout) as { outOfBoundsCount: number; actorIds: string[] };
    expect(lintData.outOfBoundsCount).toBe(0);
    expect(lintData.actorIds).toEqual(["host"]);

    // 4. preview & export --format storyboard-svg and --format svg-frame
    const previewSb = invokeCli(["preview", "--input", shorthandPath, "--format", "storyboard-svg"]);
    expect(previewSb.status).toBe(0);
    expect(previewSb.stdout).toContain("<svg");
    expect(previewSb.stdout).toContain("data-panel=");

    const previewFrame = invokeCli(["preview", "--input", v2SpecPath, "--format", "svg-frame", "--time", "500"]);
    expect(previewFrame.status).toBe(0);
    expect(previewFrame.stdout).toContain("<svg");
    expect(previewFrame.stdout).not.toContain("@keyframes sm-slice");

    const exportSb = invokeCli([
      "export",
      "--input",
      shorthandPath,
      "--root",
      outRoot,
      "--output",
      "contact-sheet.svg",
      "--format",
      "storyboard-svg"
    ]);
    expect(exportSb.status).toBe(0);
    expect(JSON.parse(exportSb.stdout)).toMatchObject({
      format: "storyboard-svg",
      path: "contact-sheet.svg"
    });
    expect(await readFile(resolve(outRoot, "contact-sheet.svg"), "utf8")).toContain("Stickman storyboard");

    const exportFrame = invokeCli([
      "export",
      "--input",
      v2SpecPath,
      "--root",
      outRoot,
      "--output",
      "still.svg",
      "--format",
      "svg-frame",
      "--time",
      "500"
    ]);
    expect(exportFrame.status).toBe(0);
    expect(JSON.parse(exportFrame.stdout)).toMatchObject({
      format: "svg-frame",
      path: "still.svg"
    });
    expect(await readFile(resolve(outRoot, "still.svg"), "utf8")).toBe(previewFrame.stdout);
  });
});
