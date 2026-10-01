#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { actionCatalog, compileAnimation, describeAction, exportAnimation, renderArtifact, validateAnimation } from "./index.js";
import { animationSchema } from "./contract-schema.js";
import type { PlaybackMode } from "./contract.js";
import type { ExportFormat } from "./export.js";

const toolDefinitions: Tool[] = [
  { name: "stickman_discover", description: "Discover supported versioned stickman actions and their binding requirements.", inputSchema: { type: "object", additionalProperties: false } },
  { name: "stickman_describe", description: "Describe a supported action by exact versioned ID.", inputSchema: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string" } } } },
  { name: "stickman_schema", description: "Get the strict JSON Schema for stickman.animation/v1.", inputSchema: { type: "object", additionalProperties: false } },
  { name: "stickman_validate", description: "Validate an animation document and return actionable diagnostics.", inputSchema: { type: "object", additionalProperties: false, required: ["animation"], properties: { animation: { type: "object" } } } },
  { name: "stickman_compile", description: "Validate and compile an animation to the canonical deterministic program.", inputSchema: { type: "object", additionalProperties: false, required: ["animation"], properties: { animation: { type: "object" } } } },
  { name: "stickman_preview", description: "Render an SVG frame or self-contained HTML preview from the canonical compiler.", inputSchema: { type: "object", additionalProperties: false, required: ["animation"], properties: { animation: { type: "object" }, format: { type: "string", enum: ["svg", "html"] }, timeMs: { type: "number" }, mode: { type: "string", enum: ["normal", "reduced", "static"] } } } },
  {
    name: "stickman_export",
    description: "Export SVG, HTML, GIF, or MP4 to a relative file inside the server's launch-time output root.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["animation", "path", "format"],
      properties: {
        animation: { type: "object" },
        path: { type: "string" },
        format: { type: "string", enum: ["svg", "html", "gif", "mp4"] }
      }
    }
  }
];

function result(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function errorResult(error: unknown): CallToolResult {
  return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
}

export function createMcpServer(outputRoot: string): Server {
  const server = new Server({ name: "stickman-mcp", version: "0.1.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolDefinitions }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;
    try {
      switch (name) {
        case "stickman_discover": return result(actionCatalog);
        case "stickman_describe": {
          const item = describeAction(String(args.id ?? ""));
          if (!item) throw new Error(`Unknown action ID. Supported IDs: ${actionCatalog.map((a) => a.id).join(", ")}.`);
          return result(item);
        }
        case "stickman_schema": return result(animationSchema);
        case "stickman_validate": return result(validateAnimation(args.animation));
        case "stickman_compile": {
          const compiled = compileAnimation(args.animation);
          return compiled.valid ? result(compiled) : { ...result(compiled), isError: true };
        }
        case "stickman_preview": {
          const compiled = compileAnimation(args.animation);
          if (!compiled.valid || !compiled.program) return { ...result(compiled), isError: true };
          const format = (args.format ?? "svg") as "svg" | "html";
          if (format !== "svg" && format !== "html") throw new Error("Preview format must be svg or html.");
          const mode = (args.mode ?? "normal") as PlaybackMode;
          if (!["normal", "reduced", "static"].includes(mode)) throw new Error("Mode must be normal, reduced, or static.");
          const timeMs = args.timeMs === undefined ? undefined : Number(args.timeMs);
          if (timeMs !== undefined && !Number.isFinite(timeMs)) throw new Error("timeMs must be finite.");
          return result({ format, content: renderArtifact(compiled.program, format, { ...(timeMs === undefined ? {} : { timeMs }), mode }) });
        }
        case "stickman_export": {
          const compiled = compileAnimation(args.animation);
          if (!compiled.valid || !compiled.program) return { ...result(compiled), isError: true };
          const format = String(args.format) as ExportFormat;
          if (!["svg", "html", "gif", "mp4"].includes(format)) throw new Error("Format must be svg, html, gif, or mp4.");
          return result(await exportAnimation(compiled.program, outputRoot, String(args.path ?? ""), format));
        }
        default: throw new Error(`Unknown tool "${name}".`);
      }
    } catch (error) {
      return errorResult(error);
    }
  });
  return server;
}

function parseRoot(args: string[]): string {
  let root = process.cwd();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) throw new Error("--root requires an output directory.");
      root = resolve(value);
      i++;
    } else throw new Error(`Unknown MCP server option "${args[i]}". Use --root <approved-output-directory>.`);
  }
  return root;
}

export async function startMcp(args: string[] = process.argv.slice(2)): Promise<void> {
  const server = createMcpServer(parseRoot(args));
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startMcp().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
