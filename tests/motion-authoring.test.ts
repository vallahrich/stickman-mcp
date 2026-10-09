import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFile, mkdtemp, mkdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { authorMotion, loadPoseLibrary, previewMotion } from "../scripts/motions/authoring.mjs";
import { buildKeyPoseClip, keyPoseGates } from "../scripts/motions/keypose.mjs";
import { loadEngineRenderer } from "../scripts/motions/review-renderer.mjs";

const base = (id = "pose-test-draft") => ({
  id, label: "Test pose", kind: "oneshot", view: "side", travel: "in-place", frames: 30,
  keys: [{ frame: 0, pose: "stand" }, { frame: 29, pose: "bow" }]
});
const specsDir = resolve(`.motion-authoring-tests-${process.pid}`);
const previewFile = resolve(`.motion-authoring-tests-${process.pid}.png`);
afterEach(async () => { await rm(specsDir, { recursive: true, force: true }); await rm(previewFile, { force: true }); });

describe("pose library and authoring", () => {
  it("extracts deterministic provenance and every named pose passes the engine anatomy gates", async () => {
    const generated = JSON.parse(await readFile(resolve("motions/poses/poses.json"), "utf8"));
    const library = await loadPoseLibrary();
    expect(library).toEqual(generated);
    expect(Object.keys(library.poses)).toEqual(expect.arrayContaining(["stand", "stand-arms-down", "crouch", "kneel", "sit", "lie-face-down", "reach-forward", "reach-up", "point", "strike", "carry", "hands-on-hips", "arms-crossed", "wave-up", "think", "bow"]));
    const { runtimeLibrary } = await loadEngineRenderer();
    for (const [id, entry] of Object.entries(library.poses)) {
      expect(entry.provenance).toMatchObject({ sourceSpec: expect.any(String), sourceStatus: expect.any(String), keyFrame: expect.any(Number), specSha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
      const spec = { id, frames: 2, loop: false, poseKeys: [{ frame: 0, pose: entry.pose }, { frame: 1, pose: entry.pose }] };
      expect(await keyPoseGates(buildKeyPoseClip(spec, runtimeLibrary.clips.idle.frames[0]), spec)).toMatchObject({ passed: true });
    }
  });
  it("writes a draft and PNG preview, reporting film-scale continuity", async () => {
    await mkdir(specsDir, { recursive: true });
    const result = await authorMotion(base(), { specDir: specsDir, outputFile: previewFile });
    expect(result.spec.status).toBe("draft");
    expect(result.spec.poseKeys).toHaveLength(2);
    expect(result.checks).toMatchObject({ limit: 14, filmScale: 2.4 });
    expect(JSON.parse(await readFile(join(specsDir, `${result.spec.id}.json`), "utf8")).status).toBe("draft");
    expect((await readFile(previewFile)).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });
  it("protects approved/candidate specs and rejects unknown poses, joints, and unordered keys", async () => {
    await mkdir(specsDir, { recursive: true });
    await import("node:fs/promises").then(async ({ writeFile }) => {
      await writeFile(join(specsDir, "protected.json"), JSON.stringify({ status: "approved" }));
      await writeFile(join(specsDir, "candidate-protected.json"), JSON.stringify({ status: "candidate" }));
    });
    await expect(authorMotion(base("protected"), { specDir: specsDir, outputFile: previewFile })).rejects.toThrow("only draft specs may be replaced");
    await expect(authorMotion(base("candidate-protected"), { specDir: specsDir, outputFile: previewFile })).rejects.toThrow("only draft specs may be replaced");
    await expect(authorMotion({ ...base(), keys: [{ frame: 0, pose: "not-in-library" }, { frame: 29, pose: "stand" }] }, { specDir: specsDir, outputFile: previewFile })).rejects.toThrow("Unknown pose name");
    await expect(authorMotion({ ...base(), keys: [{ frame: 0, pose: "stand", overrides: { "elbow.wrong": 30 } }, { frame: 29, pose: "bow" }] }, { specDir: specsDir, outputFile: previewFile })).rejects.toThrow("Unknown joint name");
    await expect(authorMotion({ ...base(), keys: [{ frame: 10, pose: "stand" }, { frame: 9, pose: "bow" }] }, { specDir: specsDir, outputFile: previewFile })).rejects.toThrow("strictly increasing");
  });
  it("renders existing draft specs without changing their status", async () => {
    await mkdir(specsDir, { recursive: true });
    const draft = await authorMotion(base("preview-only"), { specDir: specsDir, outputFile: previewFile });
    const out = resolve(`.motion-preview-only-${process.pid}.png`);
    try {
      const result = await previewMotion(draft.spec.id, { specDir: specsDir, outputFile: out });
      expect(result.status).toBe("draft");
      expect((await stat(out)).size).toBeGreaterThan(1000);
      expect(JSON.parse(await readFile(join(specsDir, `${draft.spec.id}.json`), "utf8")).status).toBe("draft");
    } finally { await rm(out, { force: true }); }
  });
  it("exposes author and preview tools over MCP stdio", async () => {
    const root = await mkdtemp(resolve(`.motion-mcp-test-${process.pid}-`));
    const id = `mcp-draft-${process.pid}`;
    const specPath = join(root, "authored-preview", `${id}.json`);
    const client = new Client({ name: "motion-authoring-tests", version: "1.0.0" });
    try {
      await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve("dist", "mcp.js"), "--root", root], stderr: "pipe" }));
      const authored = await client.callTool({ name: "stickman_author_motion", arguments: { ...base(id), outputDir: "authored-preview" } });
      expect(authored.isError, JSON.stringify(authored)).not.toBe(true);
      expect(authored.structuredContent).toMatchObject({ result: { spec: { id, status: "draft" }, checks: { limit: 14, filmScale: 2.4 } } });
      const preview = await client.callTool({ name: "stickman_preview_motion", arguments: { id, draftDir: "authored-preview", outputDir: "read-only-preview", count: 4 } });
      expect(preview.isError, JSON.stringify(preview)).not.toBe(true);
      expect(preview.structuredContent).toMatchObject({ result: { id, status: "draft", preview: { samples: 4 } } });
      expect((await readFile(specPath, "utf8"))).toContain('"status": "draft"');
      const protectedResult = await client.callTool({ name: "stickman_author_motion", arguments: { ...base("walk"), outputDir: "protected-preview" } });
      expect(protectedResult.isError).toBe(true);
      expect(protectedResult.content?.[0]).toMatchObject({ text: expect.stringContaining("only draft specs may be replaced") });
    } finally {
      await client.close();
      await rm(specPath, { force: true });
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);
});
