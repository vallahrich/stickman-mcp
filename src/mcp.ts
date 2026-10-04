#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import type { JsonSchemaType } from "@modelcontextprotocol/sdk/validation";
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError, type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { actionCatalog, compileAnimation, describeAction, exportAnimation, renderArtifact, validateAnimation } from "./index.js";
import { animationSchema } from "./contract-schema.js";
import type { PlaybackMode } from "./contract.js";
import type { ExportFormat } from "./export.js";

type ObjectSchema = JsonSchemaType & { type: "object" };
type DefinedTool = Omit<Tool, "inputSchema" | "outputSchema"> & {
  inputSchema: ObjectSchema;
  outputSchema: ObjectSchema;
};

const descriptionSchema: ObjectSchema = {
  type: "object", additionalProperties: false,
  required: ["id", "action", "label", "summary", "kind", "travel", "prop", "requiredBinding", "reducedMotion"],
  properties: {
    id: { type: "string" }, action: { type: "string" }, label: { type: "string" }, summary: { type: "string" },
    kind: { type: "string" }, travel: { type: "string" }, prop: { oneOf: [{ type: "string" }, { type: "null" }] },
    requiredBinding: { type: "string" }, reducedMotion: { type: "string" }
  }
};
const diagnosticsSchema: JsonSchemaType = {
  type: "array", items: {
    type: "object", additionalProperties: false, required: ["path", "code", "message"],
    properties: { path: { type: "string" }, code: { type: "string" }, message: { type: "string" } }
  }
};
const validationSchema: ObjectSchema = {
  type: "object", additionalProperties: false, required: ["valid", "diagnostics"],
  properties: { valid: { type: "boolean" }, diagnostics: diagnosticsSchema }
};
const validationFailureSchema: ObjectSchema = {
  ...validationSchema,
  properties: { ...validationSchema.properties, valid: { const: false } }
};
const compileSchema: ObjectSchema = {
  ...validationSchema,
  properties: {
    ...validationSchema.properties,
    program: {
      type: "object", additionalProperties: false, required: ["contractVersion", "spec"],
      properties: {
        contractVersion: { const: "stickman.animation/v1" }, spec: { type: "object" },
        events: {
          type: "array", description: "Timed motion markers (e.g. key, reveal, cardPlaced) to sync slide content; the HTML player dispatches each as a 'stickman:marker' CustomEvent.",
          items: {
            type: "object", additionalProperties: false, required: ["timeMs", "actionIndex", "action", "marker", "frame"],
            properties: { timeMs: { type: "number" }, actionIndex: { type: "integer" }, action: { type: "string" }, marker: { type: "string" }, frame: { type: "number" } }
          }
        }
      }
    }
  }
};
const errorSchema: ObjectSchema = {
  type: "object", additionalProperties: false, required: ["code", "message"],
  properties: {
    code: { type: "string", enum: ["invalid_arguments", "execution_error"] },
    message: { type: "string" }
  }
};
const emptyInput: ObjectSchema = { type: "object", additionalProperties: false };
const animationInput: ObjectSchema = {
  type: "object", additionalProperties: false, required: ["animation"],
  properties: { animation: { type: "object" } }
};

function defineTool(name: string, description: string, inputSchema: ObjectSchema, payloadSchema: JsonSchemaType, options: { writes?: boolean; validationErrors?: boolean } = {}): DefinedTool {
  return {
    name, description, inputSchema,
    outputSchema: {
      type: "object",
      oneOf: [
        { required: ["result"], additionalProperties: false, properties: {
          result: options.validationErrors ? { anyOf: [payloadSchema, validationFailureSchema] } : payloadSchema
        } },
        { required: ["error"], additionalProperties: false, properties: { error: errorSchema } }
      ]
    },
    annotations: { readOnlyHint: !options.writes, destructiveHint: false, idempotentHint: !options.writes, openWorldHint: false }
  };
}

const toolDefinitions: DefinedTool[] = [
  defineTool("stickman_discover", "Discover supported versioned stickman actions and their binding requirements.", emptyInput, { type: "array", items: descriptionSchema }),
  defineTool("stickman_describe", "Describe a supported action by exact versioned ID.", {
    type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "string", minLength: 1 } }
  }, descriptionSchema),
  defineTool("stickman_schema", "Get the strict JSON Schema for stickman.animation/v1.", emptyInput, {
    type: "object", required: ["$schema", "$id", "type", "properties", "required"],
    properties: { $schema: { type: "string" }, $id: { type: "string" }, type: { const: "object" }, properties: { type: "object" }, required: { type: "array", items: { type: "string" } } }
  }),
  defineTool("stickman_validate", "Validate an animation document and return actionable diagnostics.", animationInput, validationSchema),
  defineTool("stickman_compile", "Validate and compile an animation to the canonical deterministic program.", animationInput, compileSchema),
  defineTool("stickman_preview", "Render an SVG frame or self-contained HTML preview from the canonical compiler.", {
    ...animationInput, properties: {
      ...animationInput.properties, format: { type: "string", enum: ["svg", "html"] },
      timeMs: { type: "number" }, mode: { type: "string", enum: ["normal", "reduced", "static"] }
    }
  }, {
    type: "object", additionalProperties: false, required: ["format", "content"],
    properties: { format: { type: "string", enum: ["svg", "html"] }, content: { type: "string" } }
  }, { validationErrors: true }),
  defineTool("stickman_export", "Export SVG, HTML, GIF, or MP4 to a relative file inside the server's launch-time output root.", {
    ...animationInput, required: ["animation", "path", "format"], properties: {
      ...animationInput.properties, path: { type: "string", minLength: 1 },
      format: { type: "string", enum: ["svg", "html", "gif", "mp4"] }
    }
  }, {
    type: "object", additionalProperties: false, required: ["format", "path", "bytes"],
    properties: {
      format: { type: "string", enum: ["svg", "html", "gif", "mp4"] },
      path: { type: "string" }, bytes: { type: "integer", minimum: 0 }
    }
  }, { writes: true, validationErrors: true })
];

const schemaValidator = new AjvJsonSchemaValidator();
const argumentValidators = new Map(toolDefinitions.map((tool) => [
  tool.name, schemaValidator.getValidator<Record<string, unknown>>(tool.inputSchema)
]));

function result(value: unknown, isError = false): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: { result: value },
    ...(isError ? { isError: true } : {})
  };
}

function errorResult(error: unknown, code: "invalid_arguments" | "execution_error" = "execution_error"): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: message }],
    structuredContent: { error: { code, message } },
    isError: true
  };
}

function stringArgument(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string") throw new TypeError(`${key} must be a string.`);
  return value;
}

function isPlaybackMode(value: unknown): value is PlaybackMode {
  return value === "normal" || value === "reduced" || value === "static";
}

function isExportFormat(value: unknown): value is ExportFormat {
  return value === "svg" || value === "html" || value === "gif" || value === "mp4";
}

export function createMcpServer(outputRoot: string): Server {
  const server = new Server({ name: "stickman-mcp", version: "0.1.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolDefinitions }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: input = {} } = request.params;
    const validateArguments = argumentValidators.get(name);
    if (!validateArguments) throw new McpError(ErrorCode.InvalidParams, `Unknown tool "${name}".`);
    const validation = validateArguments(input);
    if (!validation.valid) {
      return errorResult(`Invalid arguments for ${name}: ${validation.errorMessage}`, "invalid_arguments");
    }
    const args = validation.data;
    try {
      switch (name) {
        case "stickman_discover": return result(actionCatalog);
        case "stickman_describe": {
          const item = describeAction(stringArgument(args, "id"));
          if (!item) throw new Error(`Unknown action ID. Supported IDs: ${actionCatalog.map((a) => a.id).join(", ")}.`);
          return result(item);
        }
        case "stickman_schema": return result(animationSchema);
        case "stickman_validate": return result(validateAnimation(args.animation));
        case "stickman_compile": {
          const compiled = compileAnimation(args.animation);
          return result(compiled, !compiled.valid);
        }
        case "stickman_preview": {
          const compiled = compileAnimation(args.animation);
          if (!compiled.valid || !compiled.program) return result(compiled, true);
          const format = args.format === undefined ? "svg" : args.format;
          if (format !== "svg" && format !== "html") throw new Error("Preview format must be svg or html.");
          const mode = args.mode === undefined ? "normal" : args.mode;
          if (!isPlaybackMode(mode)) throw new Error("Mode must be normal, reduced, or static.");
          const timeMs = args.timeMs;
          if (timeMs !== undefined && (typeof timeMs !== "number" || !Number.isFinite(timeMs))) throw new Error("timeMs must be finite.");
          return result({ format, content: renderArtifact(compiled.program, format, { ...(timeMs === undefined ? {} : { timeMs }), mode }) });
        }
        case "stickman_export": {
          const compiled = compileAnimation(args.animation);
          if (!compiled.valid || !compiled.program) return result(compiled, true);
          const format = args.format;
          if (!isExportFormat(format)) throw new Error("Format must be svg, html, gif, or mp4.");
          return result(await exportAnimation(compiled.program, outputRoot, stringArgument(args, "path"), format));
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
  let seenRoot = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") {
      if (seenRoot) throw new Error("--root may only be supplied once.");
      const value = args[i + 1];
      if (!value || value.startsWith("--")) throw new Error("--root requires an output directory.");
      root = resolve(value);
      seenRoot = true;
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
