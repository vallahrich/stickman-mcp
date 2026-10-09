import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

// Release scripts are deliberately standalone JS, not part of the runtime build.
// @ts-expect-error No declaration is needed for the local build script.
import { audit, prepare, readAllowed, stageCandidate, npmPack } from "../scripts/release/prepare.mjs";
// @ts-expect-error Local release policy is plain JS.
import { sourceFiles, blockers } from "../scripts/release/policy.mjs";

const root = process.cwd();
const temporary: string[] = [];
async function temp() {
  const directory = await mkdtemp(join(tmpdir(), "stickman-release-test-"));
  temporary.push(directory);
  return directory;
}
afterEach(async () => {
  for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe("private release gate", () => {
  it("reports exact hashes and blocks production packaging", async () => {
    const report = await audit(root);
    expect(report.ready).toBe(false);
    expect(report.blockers).toEqual([...blockers,
      "Inputs do not exactly match the reviewed SHA-256 allowlist in policy.approvedInputs."]);
    expect(report.files.map((file: { path: string }) => file.path).sort()).toEqual(
      [...sourceFiles, "LICENSE", "NOTICE", "scripts/release/README.md"].sort()
    );
    for (const file of report.files) {
      expect(file.sha256).toBe(createHash("sha256").update(await readFile(join(root, file.path))).digest("hex"));
    }
    expect(report.files.some((file: { path: string }) =>
      /^(dist|site|examples|node_modules|\.git|\.playwright-mcp)\//.test(file.path))).toBe(false);
    await expect(prepare(root)).rejects.toThrow("Release blocked");
    const stage = await temp();
    await expect(stageCandidate(root, stage, report)).rejects.toThrow("Release blocked");
    expect(await readdir(stage)).toEqual([]);
  });

  it("rejects traversal, absolute paths, directories and symlink inputs", async () => {
    for (const path of ["../LICENSE", "/LICENSE", "src/../LICENSE", "src\\index.ts", "src//index.ts", "C:LICENSE", "LICENSE:stream"]) {
      await expect(readAllowed(root, path)).rejects.toThrow("Unsafe allowlist path");
    }
    await expect(readAllowed(root, "src")).rejects.toThrow("Not a regular file");
    const fixture = await temp();
    // Windows junctions do not require symlink creation privileges.
    await symlink(join(root, "src"), join(fixture, "linked"), "junction");
    await expect(readAllowed(fixture, "linked/index.ts")).rejects.toThrow("Symlink refused");
  });

  it("rejects content changed after audit before copying anything", async () => {
    const report = await audit(root);
    report.ready = true;
    report.blockers = [];
    report.files[0].sha256 = "0".repeat(64);
    const stage = await temp();
    await expect(stageCandidate(root, stage, report)).rejects.toThrow("Input changed since audit");
    expect(await readdir(stage)).toEqual([]);
  });

  it("packs only a clean core runtime and runs it away from the private checkout", async () => {
    const report = await audit(root);
    // TEST ONLY: exercise mechanics; never changes policy or permission status.
    report.ready = true;
    report.blockers = [];
    const stage = await temp();
    const expected = await stageCandidate(root, stage, report);
    expect(await readdir(stage)).not.toContain("src");
    const pkg = JSON.parse(await readFile(join(stage, "package.json"), "utf8"));
    expect(pkg.private).toBe(true);
    expect(pkg.bin).toEqual({ stickman: "./dist/cli.js" });
    expect(pkg.dependencies).toBeUndefined();
    // Deliberately contaminate staging; npm's allowlist must still exclude it.
    await writeFile(join(stage, ".env"), "TEST_ONLY_NOT_A_SECRET=excluded");
    await writeFile(join(stage, "scratch.html"), "excluded");
    const [dry] = npmPack(stage, ["--dry-run"]);
    expect(dry.files.map((file: { path: string }) => file.path).sort()).toEqual(expected);
    expect(expected.some((path: string) => /mcp|film|site|scratch|\.env/.test(path))).toBe(false);
    const [packed] = npmPack(stage);
    expect(packed.files.map((file: { path: string }) => file.path).sort()).toEqual(expected);
    const install = await temp();
    await writeFile(join(install, "package.json"), '{"private":true}');
    const npm = process.env.npm_execpath!;
    execFileSync(process.execPath, [npm, "install", "--offline", "--ignore-scripts",
      "--no-audit", "--no-fund", "--package-lock=false", join(stage, packed.filename)], { cwd: install });
    const installed = join(install, "node_modules/@vallahrich/stickman-core");
    const discovered = execFileSync(process.execPath, [join(installed, "dist/cli.js"), "discover"], { cwd: install, encoding: "utf8" });
    expect(JSON.parse(discovered)).toBeTruthy();
    const example = resolve(root, "examples/wave.json");
    const svg = execFileSync(process.execPath, [join(installed, "dist/cli.js"), "preview",
      "--input", example, "--format", "svg"], { cwd: install, encoding: "utf8" });
    expect(svg).toContain("<svg");
    const imported = execFileSync(process.execPath, ["--input-type=module", "-e",
      'const core = await import("@vallahrich/stickman-core"); await Promise.all(["browser", "room", "keyboard"].map(entry => import("@vallahrich/stickman-core/" + entry))); console.log(typeof core.compileAnimation);'
    ], { cwd: install, encoding: "utf8" });
    expect(imported.trim()).toBe("function");
    const manifest = JSON.parse(await readFile(join(installed, "release-manifest.json"), "utf8"));
    for (const file of manifest.files) {
      expect(file.sha256).toBe(createHash("sha256").update(await readFile(join(installed, file.path))).digest("hex"));
    }
  }, 120_000);
});
