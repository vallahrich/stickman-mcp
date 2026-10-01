import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AnimationSpec } from "../src/contract.js";

const folders: string[] = [];
afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
});

describe("stdio MCP protocol", () => {
  it("negotiates, lists tools, and validates through the same contract", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "stickman-mcp-test-"));
    folders.push(root);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", resolve(process.cwd(), "src/mcp.ts"), "--root", root],
      stderr: "pipe"
    });
    const client = new Client({ name: "stickman-test-client", version: "1.0.0" });
    await client.connect(transport);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain("stickman_export");
      const animation: AnimationSpec = {
        version: "stickman.animation/v1",
        canvas: { width: 320, height: 240, fps: 24 },
        durationMs: 1200,
        actions: [{ action: "wave", startMs: 0, durationMs: 800 }]
      };
      const valid = await client.callTool({ name: "stickman_validate", arguments: { animation } });
      expect(valid.isError).not.toBe(true);
      expect(valid.content.map((item) => "text" in item ? item.text : "").join("")).toContain('"valid": true');
      const invalid = await client.callTool({ name: "stickman_validate", arguments: { animation: { ...animation, actions: [{ action: "fly", startMs: 0, durationMs: 500 }] } } });
      expect(invalid.content.map((item) => "text" in item ? item.text : "").join("")).toContain("unsupported_action");
    } finally {
      await client.close();
    }
  });
});
