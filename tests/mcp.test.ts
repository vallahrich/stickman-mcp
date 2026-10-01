import { spawnSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import { compileAnimation, sampleAnimation, validateAnimation } from "../src/compiler.js";
import { animationSchema } from "../src/contract-schema.js";
import { renderAnimatedSvg, renderHtml, renderSvgFrame } from "../src/render.js";
import type { AnimationSpec } from "../src/contract.js";

const connections: { client: Client; root: string }[] = [];
type ToolResponse = Awaited<ReturnType<Client["callTool"]>>;

afterEach(async () => {
  for (const { client, root } of connections.splice(0)) {
    try {
      await client.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

async function connect() {
  const root = await mkdtemp(resolve(tmpdir(), "stickman-mcp-test-"));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(process.cwd(), "dist", "mcp.js"), "--root", root],
    stderr: "pipe"
  });
  const stderr: string[] = [];
  const transportErrors: Error[] = [];
  transport.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk.toString()));
  transport.onerror = (error) => transportErrors.push(error);
  const client = new Client({ name: "stickman-test-client", version: "1.0.0" });
  connections.push({ client, root });
  await client.connect(transport);
  const listed = await client.listTools();
  return { client, root, listed, stderr, transportErrors };
}

function text(response: ToolResponse): string {
  return CallToolResultSchema.parse(response).content.map((item) => "text" in item ? item.text : "").join("");
}

function expectResult(response: ToolResponse, expected: unknown): void {
  expect(response.isError).not.toBe(true);
  expect(JSON.parse(text(response))).toEqual(expected);
  expect(response.structuredContent).toEqual({ result: expected });
}

const scene = {
  version: "stickman.animation/v1",
  canvas: { width: 640, height: 360, fps: 24 },
  durationMs: 1800,
  actor: { x: 20, groundY: 210 },
  targets: { arrival: { x: 148, y: 210 } },
  prop: { id: "crate", x: 150, y: 160, width: 50, height: 50, toX: 250, handle: { x: 5, y: 8 } },
  actions: [
    { action: "walk", startMs: 0, durationMs: 600, target: "arrival" },
    { action: "push", startMs: 600, durationMs: 1000, target: "crate" }
  ]
} satisfies AnimationSpec;

describe("stdio MCP protocol", () => {
  it("negotiates and advertises seven strict, annotated tools with output schemas", async () => {
    const { listed, stderr, transportErrors } = await connect();
    expect(listed.tools.map((tool) => tool.name)).toEqual([
      "stickman_discover", "stickman_describe", "stickman_schema", "stickman_validate",
      "stickman_compile", "stickman_preview", "stickman_export"
    ]);
    for (const tool of listed.tools) {
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.outputSchema?.type).toBe("object");
      expect(tool.annotations).toMatchObject({
        readOnlyHint: tool.name !== "stickman_export",
        destructiveHint: false,
        idempotentHint: tool.name !== "stickman_export",
        openWorldHint: false
      });
    }
    expect(stderr).toEqual([]);
    expect(transportErrors).toEqual([]);
  });

  it("preserves text payloads and supplies validated structured results for all seven tools", async () => {
    const { client, root, stderr, transportErrors } = await connect();
    const discovery = await client.callTool({ name: "stickman_discover" });
    const catalog: unknown = JSON.parse(text(discovery));
    expect(Array.isArray(catalog)).toBe(true);
    expectResult(discovery, catalog);
    const description = await client.callTool({ name: "stickman_describe", arguments: { id: "walk@1.0.0" } });
    const described: unknown = JSON.parse(text(description));
    expect(described).toMatchObject({ id: "walk@1.0.0", action: "walk" });
    expectResult(description, described);
    expectResult(await client.callTool({ name: "stickman_schema" }), animationSchema);
    expectResult(await client.callTool({ name: "stickman_validate", arguments: { animation: scene } }), validateAnimation(scene));

    const compiled = compileAnimation(scene);
    expect(compiled.valid).toBe(true);
    expectResult(await client.callTool({ name: "stickman_compile", arguments: { animation: scene } }), compiled);
    const program = compiled.program!;
    expectResult(await client.callTool({
      name: "stickman_preview",
      arguments: { animation: scene, format: "svg", timeMs: 1100, mode: "normal" }
    }), { format: "svg", content: renderSvgFrame(program, 1100) });
    const htmlResponse = await client.callTool({
      name: "stickman_preview",
      arguments: { animation: scene, format: "html" }
    });
    const htmlPayload: { format: string; content: string } = JSON.parse(text(htmlResponse));
    expectResult(htmlResponse, htmlPayload);
    expect(htmlPayload.format).toBe("html");
    expect(htmlPayload.content.split("<script>")[0]).toBe(renderHtml(program).split("<script>")[0]);
    const embedded = /;const sample=([\s\S]+?);const svg=/.exec(htmlPayload.content);
    expect(embedded).not.toBeNull();
    const browserSample: unknown = runInNewContext(`(${embedded![1]})`);
    if (typeof browserSample !== "function") throw new Error("HTML preview must contain an executable sampler.");
    for (const timeMs of [0, 600, 750, 1100, 1450, 1600, 1800]) {
      for (const mode of ["normal", "reduced", "static"] as const) {
        expect(browserSample(program, timeMs, mode)).toEqual(sampleAnimation(program, timeMs, mode));
      }
    }
    for (const mode of ["reduced", "static"] as const) {
      expectResult(await client.callTool({
        name: "stickman_preview",
        arguments: { animation: scene, mode }
      }), { format: "svg", content: renderSvgFrame(program, 0, mode) });
    }
    const exported = await client.callTool({
      name: "stickman_export",
      arguments: { animation: scene, path: "motion.svg", format: "svg" }
    });
    const contents = await readFile(resolve(root, "motion.svg"), "utf8");
    expect(contents).toBe(renderAnimatedSvg(program));
    expectResult(exported, { format: "svg", path: "motion.svg", bytes: Buffer.byteLength(contents) });
    expect(stderr).toEqual([]);
    expect(transportErrors).toEqual([]);
  });

  it("rejects missing, extra, incorrectly typed and invalid enum arguments without coercion", async () => {
    const { client, root } = await connect();
    const invalidCalls = [
      { name: "stickman_discover", arguments: { root } },
      { name: "stickman_schema", arguments: { unused: true } },
      { name: "stickman_describe", arguments: {} },
      { name: "stickman_describe", arguments: { id: 123 } },
      { name: "stickman_validate", arguments: {} },
      { name: "stickman_validate", arguments: { animation: [] } },
      { name: "stickman_validate", arguments: { animation: null } },
      { name: "stickman_compile", arguments: { animation: scene, root } },
      { name: "stickman_preview", arguments: { animation: scene, timeMs: "100" } },
      { name: "stickman_preview", arguments: { animation: scene, timeMs: null } },
      { name: "stickman_preview", arguments: { animation: scene, timeMs: false } },
      { name: "stickman_preview", arguments: { animation: scene, mode: "fast" } },
      { name: "stickman_preview", arguments: { animation: scene, mode: null } },
      { name: "stickman_preview", arguments: { animation: scene, format: "gif" } },
      { name: "stickman_preview", arguments: { animation: scene, format: null } },
      { name: "stickman_export", arguments: { animation: scene, format: "svg" } },
      { name: "stickman_export", arguments: { animation: scene, path: 42, format: "svg" } },
      { name: "stickman_export", arguments: { animation: scene, path: "bad.svg", format: "invalid" } },
      { name: "stickman_export", arguments: { animation: scene, path: "bad.svg", format: "svg", root } }
    ];
    for (const call of invalidCalls) {
      const response = await client.callTool(call);
      expect(response.isError, JSON.stringify(call)).toBe(true);
      expect(response.structuredContent).toMatchObject({
        error: { code: "invalid_arguments", message: expect.any(String) }
      });
      expect(text(response).length).toBeGreaterThan(0);
    }
    expect(await readdir(root)).toEqual([]);
    expectResult(await client.callTool({ name: "stickman_schema" }), animationSchema);
  });

  it("distinguishes unknown tools from recoverable execution failures and animation diagnostics", async () => {
    const { client } = await connect();
    await expect(client.callTool({ name: "stickman_missing" })).rejects.toMatchObject({
      code: ErrorCode.InvalidParams
    });
    const unknownId = await client.callTool({ name: "stickman_describe", arguments: { id: "fly@1.0.0" } });
    expect(unknownId.isError).toBe(true);
    expect(unknownId.structuredContent).toMatchObject({ error: { code: "execution_error" } });

    const invalid = { ...scene, actions: [{ action: "fly", startMs: 0, durationMs: 500 }] };
    const diagnostics = validateAnimation(invalid);
    const validated = await client.callTool({ name: "stickman_validate", arguments: { animation: invalid } });
    expectResult(validated, diagnostics);
    expect(diagnostics.valid).toBe(false);
    for (const name of ["stickman_compile", "stickman_preview", "stickman_export"]) {
      const response = await client.callTool({
        name, arguments: { animation: invalid, ...(name === "stickman_export" ? { path: "bad.svg", format: "svg" } : {}) }
      });
      expect(response.isError).toBe(true);
      expect(JSON.parse(text(response))).toEqual(diagnostics);
      expect(response.structuredContent).toEqual({ result: diagnostics });
    }
    expectResult(await client.callTool({ name: "stickman_validate", arguments: { animation: scene } }), validateAnimation(scene));
  });

  it("enforces the launch-time export root and refuses traversal, absolute paths and overwrites", async () => {
    const { client, root } = await connect();
    const source = compileAnimation(scene).program!;
    const first = await client.callTool({
      name: "stickman_export", arguments: { animation: scene, path: "nested/frame.svg", format: "svg" }
    });
    expect(first.isError).not.toBe(true);
    const contents = await readFile(resolve(root, "nested", "frame.svg"), "utf8");
    expect(contents).toBe(renderAnimatedSvg(source));
    for (const path of ["nested/frame.svg", "../outside.svg", resolve(root, "absolute.svg"), "wrong.html"]) {
      const response = await client.callTool({
        name: "stickman_export", arguments: { animation: scene, path, format: "svg" }
      });
      expect(response.isError, path).toBe(true);
      expect(response.structuredContent).toMatchObject({
        error: { code: "execution_error", message: expect.any(String) }
      });
    }
    expect(await readFile(resolve(root, "nested", "frame.svg"), "utf8")).toBe(contents);
    expect(await readdir(root)).toEqual(["nested"]);
  });

  it("reports invalid startup arguments on stderr without emitting protocol-breaking stdout", () => {
    for (const args of [["--unknown"], ["--root"], ["--root", "a", "--root", "b"]]) {
      const child = spawnSync(process.execPath, [
        resolve(process.cwd(), "dist", "mcp.js"), ...args
      ], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
      expect(child.error).toBeUndefined();
      expect(child.status).toBe(1);
      expect(child.stdout).toBe("");
      expect(child.stderr).toMatch(/--root|Unknown MCP server option/);
    }
  });
});
