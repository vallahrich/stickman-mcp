import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, cp, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
// @ts-expect-error Build scripts are standalone JS.
import { audit, readAllowed, stageCandidate, npmPack, resolveNpmCli, scanPublicText, motionOrigin } from "../scripts/release/prepare.mjs";
// @ts-expect-error Local policy is JS.
import { inputFiles, blockers, scope } from "../scripts/release/policy.mjs";
// @ts-expect-error Local archive helper is JS.
import { zipDirectory } from "../scripts/release/zip.mjs";
// @ts-expect-error Native original demo builder is JS.
import { nativeCloudHtml } from "../scripts/release/native-showcase.mjs";

const root = process.cwd(), temporary: string[] = [];
async function temp() {
  const directory = await mkdtemp(join(tmpdir(), "stickman-product-test-"));
  temporary.push(directory);
  return directory;
}
afterEach(async () => {
  for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true });
});
describe("connected private release preparation", () => {
  it("allows private preparation without pretending publication has been approved", async () => {
    const report = await audit(root);
    expect(report).toMatchObject({ ready: true, publicationApproved: false, scope, status: "local-review-required" });
    expect(report.blockers).toEqual(blockers);
    expect(report.files.map((file: { path: string }) => file.path).sort()).toEqual([...inputFiles, "package-lock.json"].sort());
    for (const file of report.files) {
      expect(file.sha256).toBe(createHash("sha256").update(await readFile(join(root, file.path))).digest("hex"));
    }
    expect(report.dependencies).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "@modelcontextprotocol/sdk", license: "MIT", bundled: false }),
      expect.objectContaining({ name: "ffmpeg-static", license: "GPL-3.0-or-later", bundled: false })
    ]));
    await expect(audit(root, "../bad")).rejects.toThrow("SemVer");
    await expect(audit(root, "0.1.0-rc.01")).rejects.toThrow("SemVer");
    expect(report.fixtureOrigins).toHaveLength(13);
    expect(() => motionOrigin({ id: "unknown", poseKeys: [{}] }, "unknown.json")).toThrow("Unknown motion provenance");
    expect(() => motionOrigin({ id: "walk", source: { dataset: "CMU", file: "16_15.bvh", subject: "16", trial: "99" } }, "wrong.json")).toThrow("Inconsistent CMU");
  });
  it("rejects path escapes, symlinks and known private-content signatures", async () => {
    for (const path of ["../LICENSE", "/LICENSE", "src/../LICENSE", "src\\index.ts", "src//index.ts", "C:LICENSE", "LICENSE:stream"]) {
      await expect(readAllowed(root, path)).rejects.toThrow("Unsafe allowlist path");
    }
    await expect(readAllowed(root, "src")).rejects.toThrow("Not a regular file");
    const fixture = await temp();
    await symlink(join(root, "src"), join(fixture, "linked"), process.platform === "win32" ? "junction" : "dir");
    await expect(readAllowed(fixture, "linked/index.ts")).rejects.toThrow("Symlink refused");
    expect(() => scanPublicText("file.html", Buffer.from("C:\\Users\\private\\file"))).toThrow("private content");
    await expect(zipDirectory(fixture)).rejects.toThrow("symlink");
  });
  it("rejects drift or injected inventory before copying", async () => {
    const report = await audit(root), stage = await temp();
    report.files[0].sha256 = "0".repeat(64);
    await expect(stageCandidate(root, stage, report)).rejects.toThrow("Input changed since audit");
    expect(await readdir(stage)).toEqual([]);
    report.files.push({ path: ".env", sha256: "0".repeat(64) });
    await expect(stageCandidate(root, stage, report)).rejects.toThrow("membership");
  });
  it("creates deterministic standard ZIP without private inputs", async () => {
    const fixture = await temp();
    await writeFile(join(fixture, "index.html"), "<h1>Candidate</h1>");
    const first = await zipDirectory(fixture), second = await zipDirectory(fixture);
    expect(first.equals(second)).toBe(true);
    expect(first.readUInt32LE(0)).toBe(0x04034b50);
    expect(first.readUInt32LE(first.length - 22)).toBe(0x06054b50);
  });
  it("uses native aligned diagrams and stricter full-timeline visible motion checks", async () => {
    const native = await nativeCloudHtml();
    expect(native.seconds).toBeLessThanOrEqual(60);
    expect(native.continuity.maxVisibleStep).toBeLessThanOrEqual(4);
    expect(native.continuity.maxVisibleAcceleration).toBeLessThanOrEqual(2);
    expect(native.continuity.footSlides).toEqual([]);
    expect(native.html).not.toMatch(/DynamicDeck|data-object="workload"|W1|consoleControl|replant/);
    expect(native.html).toContain("Workload · same requirements");
    expect(native.html).toContain("prefers-reduced-motion");
    expect(native.html).toContain('class="mobile-evidence"');
  }, 120_000);
  it("installs the full product outside the checkout and exercises every connected runtime", async () => {
    const supplied = process.env.STICKMAN_CANDIDATE_TARBALL;
    const candidateVersion = supplied ? basename(supplied).replace(/^vallahrich-stickman-mcp-/, "").replace(/\.tgz$/, "") : undefined;
    const report = await audit(root, candidateVersion), stage = await temp();
    const expected = await stageCandidate(root, stage, report);
    const pkg = JSON.parse(await readFile(join(stage, "package.json"), "utf8"));
    expect(pkg.name).toBe("@vallahrich/stickman-mcp");
    expect(pkg.private).toBe(true);
    expect(pkg.bin["stickman-mcp"]).toBe("./dist/mcp.js");
    expect(await readdir(stage)).not.toContain("node_modules");
    await writeFile(join(stage, ".env"), "TEST_ONLY=excluded");
    await writeFile(join(stage, "scratch.html"), "excluded");
    for (const args of [["--dry-run"], []]) {
      const [packed] = npmPack(stage, args);
      expect(packed.files.map((file: { path: string }) => file.path).sort()).toEqual(expected);
    }
    expect(expected).toContain("scripts/film/api.mjs");
    expect(expected).toContain("motions/poses/poses.json");
    expect(expected).not.toContain("docs/motion-catalog-plan.md");
    expect(expected.some((path: string) => /(?:^|\/)(?:scratch\.html|\.env|\.git)|deck-provider|site\/index/.test(path))).toBe(false);
    const install = await temp(), npm = resolveNpmCli();
    await writeFile(join(install, "package.json"), '{"private":true}');
    const archive = (await readdir(stage)).find(name => name.endsWith(".tgz"))!;
    for (const dependency of ["@modelcontextprotocol/sdk", "ffmpeg-static", "zod"]) {
      try {
        await stat(join(root, "node_modules", dependency, "package.json"));
      } catch {
        throw new Error(`Offline release installation is blocked: audited runtime dependency ${dependency} is missing from root/node_modules.`);
      }
    }
    await cp(join(root, "node_modules"), join(install, "node_modules"), { recursive: true });
    execFileSync(process.execPath, [npm, "install", "--offline", "--ignore-scripts",
      "--no-audit", "--no-fund", "--package-lock=false", supplied ? resolve(supplied) : join(stage, archive)], { cwd: install, stdio: "pipe" });
    // Offline verification provisions a separately installed encoder, not a
    // bundled binary. A normal npm installation runs ffmpeg-static's installer.
    const binary = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
    await copyFile(join(root, "node_modules/ffmpeg-static", binary), join(install, "node_modules/ffmpeg-static", binary));
    const installed = join(install, "node_modules/@vallahrich/stickman-mcp");
    const manifest = JSON.parse(await readFile(join(installed, "release-manifest.json"), "utf8"));
    expect(manifest.inputs).toEqual(report.files);
    for (const file of manifest.files) {
      expect(file.sha256).toBe(createHash("sha256").update(await readFile(join(installed, file.path))).digest("hex"));
    }
    const discovered = execFileSync(process.execPath, [join(installed, "dist/cli.js"), "discover"], { cwd: install, encoding: "utf8" });
    expect(JSON.parse(discovered)).toBeTruthy();
    const svg = execFileSync(process.execPath, [join(installed, "dist/cli.js"), "preview",
      "--input", join(installed, "examples/wave.json"), "--format", "svg"], { cwd: install, encoding: "utf8" });
    expect(svg).toContain("<svg");
    expect(execFileSync(process.execPath, ["--input-type=module", "-e",
      'const core=await import("@vallahrich/stickman-mcp");await Promise.all(["browser","room","keyboard","film","motion-authoring"].map(e=>import("@vallahrich/stickman-mcp/"+e)));console.log(typeof core.compileAnimation);'
    ], { cwd: install, encoding: "utf8" }).trim()).toBe("function");
    const client = new Client({ name: "installed-product-test", version: "1.0.0" });
    const recipe = { id: "installed-preview", title: "Installed product", performance: [{ motion: "nod", root: 400, hold: 39, beat: "first" }],
      scenes: [{ id: "first", title: "First", place: "office", cues: [{ frame: 0, text: "Installed package." }] }] };
    try {
      await client.connect(new StdioClientTransport({ command: process.execPath,
        args: [join(installed, "dist/mcp.js"), "--root", install], cwd: install, stderr: "pipe" }));
      expect(client.getServerVersion()?.version).toBe(report.version);
      const tools = (await client.listTools()).tools.map(tool => tool.name);
      expect(tools).toEqual(expect.arrayContaining(["stickman_discover", "stickman_compose_film",
        "stickman_render_film", "stickman_check_join", "stickman_author_motion", "stickman_preview_motion"]));
      const call = async (name: string, args: Record<string, unknown>) => {
        const result = await client.callTool({ name, arguments: args });
        expect(result.isError, JSON.stringify(result)).not.toBe(true);
        return result.structuredContent as { result: Record<string, unknown> };
      };
      await call("stickman_discover", {});
      const assets = await call("stickman_list_film_assets", {});
      expect(assets.result.joinCount).toBeGreaterThan(0);
      await call("stickman_compose_film", { recipe });
      await call("stickman_check_join", { motionA: "nod", motionB: "wave" });
      await call("stickman_render_film", { recipe, outputDir: "film", preview: true, qaFrames: 4 });
      const sourceBefore = await readFile(join(installed, "motions/specs/walk.json"));
      await call("stickman_author_motion", { id: "installed-draft", label: "Installed draft", kind: "oneshot", view: "side",
        travel: "in-place", frames: 30, keys: [{ frame: 0, pose: "stand" }, { frame: 29, pose: "bow" }], outputDir: "draft" });
      await call("stickman_preview_motion", { id: "installed-draft", draftDir: "draft", outputDir: "draft-preview", count: 4 });
      await call("stickman_preview_motion", { id: "walk", outputDir: "approved-preview", count: 4 });
      expect((await readFile(join(installed, "motions/specs/walk.json"))).equals(sourceBefore)).toBe(true);
      expect(JSON.parse(await readFile(join(install, "draft/installed-draft.json"), "utf8")).status).toBe("draft");
      expect((await client.callTool({ name: "stickman_preview_motion",
        arguments: { id: "walk", draftDir: "../outside", outputDir: "unsafe" } })).isError).toBe(true);
    } finally { await client.close(); }
  }, 180_000);
});
