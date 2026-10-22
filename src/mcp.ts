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
import { getStory, storyCatalog } from "./stories.js";
import { filmRecipeSchema } from "./film-schema.js";
import { composeFilmRecipe, renderFilmRecipe, listFilmAssets, checkFilmJoin } from "./film.js";
import { authorMotionDraft, previewMotionStrip } from "./motion-authoring.js";
import { readFileSync } from "node:fs";

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

const filmResultSchema: ObjectSchema = {
  type: "object", required: ["valid", "id", "frames", "seconds", "fps", "scenes", "items", "bridges", "continuity"],
  properties: { valid: { const: true }, id: { type: "string" }, frames: { type: "integer", minimum: 1 },
    seconds: { type: "number" }, fps: { const: 30 }, scenes: { type: "array", items: { type: "object" } },
    items: { type: "array", items: { type: "object" } }, bridges: { type: "array", items: { type: "object" } }, continuity: { type: "object", required: ["lead", "actors"],
      properties: { lead: { type: "object" }, actors: { type: "array", items: { type: "object" } } } }
  }
};
const filmInput: ObjectSchema = { type: "object", additionalProperties: false, required: ["recipe"], properties: { recipe: filmRecipeSchema } };
const poseOverrides = { type: "object", additionalProperties: false, properties: Object.fromEntries(
  ["anchor", "lean", "neck", "bob", "dx", "dy", "facing", "rLeg.hip", "rLeg.knee", "rLeg.lift", "lLeg.hip", "lLeg.knee", "lLeg.lift", "rArm.shoulder", "rArm.elbow", "rArm.spread", "rArm.elbowSpread", "lArm.shoulder", "lArm.elbow", "lArm.spread", "lArm.elbowSpread", "rFoot.x", "rFoot.y", "lFoot.x", "lFoot.y"].map(name => [name, name === "anchor" ? { oneOf: [{ type: "string", enum: ["both", "l", "r"] }, { type: "null" }] } : { type: "number" }])) };
const authorMotionInput: ObjectSchema = { type: "object", additionalProperties: false, required: ["id", "label", "kind", "view", "travel", "keys", "outputDir"], properties: {
  id: { type: "string", pattern: "^[a-z][a-z0-9-]{0,63}$" }, label: { type: "string", minLength: 1, maxLength: 100 },
  kind: { type: "string", enum: ["oneshot", "loop"] }, view: { type: "string", enum: ["side", "front", "three-quarter"] }, travel: { type: "string", enum: ["in-place", "travel"] },
  frames: { type: "integer", minimum: 2, maximum: 1800 }, hold: { type: "integer", minimum: 0, maximum: 1800 }, easing: { type: "string", enum: ["linear", "in", "out", "inOut", "hold"] },
  props: { type: "array", maxItems: 10, items: { type: "string", minLength: 1 } }, tags: { type: "array", maxItems: 30, uniqueItems: true, items: { type: "string", minLength: 1 } }, notes: { type: "string", maxLength: 500 },
  outputDir: { type: "string", minLength: 1 }, keys: { type: "array", minItems: 2, maxItems: 100, items: { type: "object", additionalProperties: false, required: ["frame", "pose"], properties: {
    frame: { type: "integer", minimum: 0, maximum: 1800 }, pose: { type: "string", minLength: 1 }, overrides: poseOverrides,
    easing: { type: "string", enum: ["linear", "in", "out", "inOut", "hold"] }
  } } }
} };
const motionPreviewInput: ObjectSchema = { type: "object", additionalProperties: false, required: ["id", "outputDir"], properties: {
  id: { type: "string", pattern: "^[a-z][a-z0-9-]{0,63}$" }, outputDir: { type: "string", minLength: 1 }, count: { type: "integer", minimum: 2, maximum: 24 },
  draftDir: { type: "string", minLength: 1, description: "Optional existing relative draft directory under --root (the author's outputDir). Otherwise read the packaged library." }
} };
const motionDraftResult: ObjectSchema = { type: "object", required: ["spec", "specPath", "preview", "checks"], properties: {
  spec: { type: "object" }, specPath: { type: "string" }, preview: { type: "object" }, checks: { type: "object" }
} };
const motionPreviewResult: ObjectSchema = { type: "object", required: ["id", "status", "preview"], properties: {
  id: { type: "string" }, status: { type: "string" }, preview: { type: "object" }, checks: { oneOf: [{ type: "object" }, { type: "null" }] }
} };

const toolDefinitions: DefinedTool[] = [
  defineTool("stickman_compose_film", "Validate a strict JSON film recipe and compose continuous lead/supporting performances; return scene and item frame ranges, duration and joint-step continuity (limit 14). Composer and assets are included in the installed package.", filmInput, filmResultSchema),
  defineTool("stickman_render_film", "Render a JSON film recipe to silent MP4, poster PNG, captions VTT and optional QA PNG. outputDir must be a NEW relative directory inside the launch-time --root; existing paths and symlinks are refused. preview uses 640x360 at 15 fps, preserving duration.", {
    ...filmInput, required: ["recipe", "outputDir"], properties: { ...filmInput.properties,
      outputDir: { type: "string", minLength: 1 }, preview: { type: "boolean" }, qaFrames: { type: "integer", minimum: 1, maximum: 24 } }
  }, { ...filmResultSchema, required: [...(filmResultSchema.required ?? []), "outputDir", "files", "sha256"],
    properties: { ...filmResultSchema.properties, outputDir: { type: "string" }, files: { type: "object" }, sha256: { type: "string" } }
  }, { writes: true }),
  defineTool("stickman_list_film_assets", "List mechanically qualified user-approved film motion IDs with frame counts/kind, kits, headwear, places, set prop types, overlay primitives, approved-pair join count and the strict film recipe JSON Schema. This is separate from the runtime action catalogue.", emptyInput, {
    type: "object", required: ["motions", "kits", "places", "overlays", "recipeSchema", "joinCount"], properties: {
      joinCount: { type: "integer", minimum: 0 }, motions: { type: "array", items: { type: "object", required: ["id", "frames", "kind"], properties: { id: { type: "string" }, frames: { type: "integer" }, kind: { type: "string", enum: ["oneshot", "loop", "travel"] } } } },
      kits: { type: "array", items: { type: "string" } }, places: { type: "array", items: { type: "string" } }, overlays: { type: "array", items: { type: "string" } }, recipeSchema: { type: "object" }
    }
  }),
  defineTool("stickman_author_motion", "Author a status=draft motion from named reusable pose keys, run engine anatomy/contact/joint-step gates plus film-scale continuity (2.4x, limit 14), write <id>.json and a preview PNG into a new relative outputDir under --root. The installed library is never modified; packaged non-draft IDs are protected; drafts are not film assets.", authorMotionInput, motionDraftResult, { writes: true }),
  defineTool("stickman_preview_motion", "Render a draft, candidate, or approved motion as a sampled preview strip PNG into a new relative outputDir under --root. Read-only on the motion spec.", motionPreviewInput, motionPreviewResult, { writes: true }),
  defineTool("stickman_check_join", "Check an approved motion pair and return its film-scale hard-join cost, continuity limit and suggested generated bridge length.", {
    type: "object", additionalProperties: false, required: ["motionA", "motionB"], properties: {
      motionA: { type: "string", pattern: "^[a-z][a-z0-9-]{0,63}$" }, motionB: { type: "string", pattern: "^[a-z][a-z0-9-]{0,63}$" }
    }
  }, { type: "object", additionalProperties: false, required: ["from", "to", "cost", "limit", "needsBridge", "bridgeFrames"], properties: {
    from: { type: "string" }, to: { type: "string" }, cost: { type: "number" }, limit: { type: "number" },
    needsBridge: { type: "boolean" }, bridgeFrames: { type: "integer", minimum: 6, maximum: 24 }
  } }),
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
      path: { type: "string" }, bytes: { type: "integer", minimum: 0 },
      warnings: { type: "array", items: { type: "string" } },
      estimatedWork: { type: "object", additionalProperties: false, required: ["frameCount", "pixelsPerFrame", "totalRasterPixels"],
        properties: { frameCount: { type: "integer" }, pixelsPerFrame: { type: "integer" }, totalRasterPixels: { type: "integer" } } }
    }
  }, { writes: true, validationErrors: true }),
  defineTool("stickman_story", "Discover combined IT story recipes (no id), or get an executable multi-action animation and synchronized host content cues by story id. Pass result.animation to validate/compile/preview/export; result.cues are for the presentation host, not animation-contract fields.", {
    type: "object", additionalProperties: false, properties: { id: { type: "string", minLength: 1 } }
  }, {
    anyOf: [
      { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "title", "summary"], properties: { id: { type: "string" }, title: { type: "string" }, summary: { type: "string" } } } },
      { type: "object", additionalProperties: false, required: ["id", "title", "summary", "animation", "cues"], properties: {
        id: { type: "string" }, title: { type: "string" }, summary: { type: "string" }, animation: { type: "object" },
        cues: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "timeMs", "title", "text"], properties: { id: { type: "string" }, timeMs: { type: "number" }, title: { type: "string" }, text: { type: "string" } } } }
      } }
    ]
  })
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
  const version = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;
  const server = new Server({ name: "stickman-mcp", version }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolDefinitions }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
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
        case "stickman_compose_film": return result(await composeFilmRecipe(args.recipe, {
          signal: extra.signal,
          ...(extra._meta?.progressToken === undefined ? {} : { onProgress: async progress => {
            await extra.sendNotification({ method: "notifications/progress", params: {
              progressToken: extra._meta!.progressToken!, progress: progress.current, total: progress.total, message: progress.phase
            } });
          } })
        }));
        case "stickman_list_film_assets": return result(await listFilmAssets());
        case "stickman_check_join": return result(await checkFilmJoin(stringArgument(args, "motionA"), stringArgument(args, "motionB")));
        case "stickman_author_motion": return result(await authorMotionDraft(args, outputRoot, stringArgument(args, "outputDir")));
        case "stickman_preview_motion": return result(await previewMotionStrip(stringArgument(args, "id"), outputRoot, stringArgument(args, "outputDir"), args.count === undefined ? 8 : args.count as number, args.draftDir === undefined ? undefined : stringArgument(args, "draftDir")));
        case "stickman_render_film": return result(await renderFilmRecipe(args.recipe, outputRoot, stringArgument(args, "outputDir"), {
          ...(args.preview === undefined ? {} : { preview: args.preview as boolean }),
          ...(args.qaFrames === undefined ? {} : { qaFrames: args.qaFrames as number }),
          signal: extra.signal,
          ...(extra._meta?.progressToken === undefined ? {} : { onProgress: async progress => {
            await extra.sendNotification({ method: "notifications/progress", params: {
              progressToken: extra._meta!.progressToken!, progress: progress.current, total: progress.total, message: progress.phase
            } });
          } })
        }));
        case "stickman_discover": return result(actionCatalog);
        case "stickman_story": return result(args.id === undefined ? storyCatalog() : getStory(stringArgument(args, "id")));
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
          return result(await exportAnimation(compiled.program, outputRoot, stringArgument(args, "path"), format, {
            signal: extra.signal,
            ...(extra._meta?.progressToken === undefined ? {} : { onProgress: async progress => {
              await extra.sendNotification({ method: "notifications/progress", params: {
                progressToken: extra._meta!.progressToken!, progress: progress.current, total: progress.total, message: progress.phase
              } });
            } })
          }));
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
