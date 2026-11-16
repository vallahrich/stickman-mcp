#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import type { JsonSchemaType } from "@modelcontextprotocol/sdk/validation";
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  type CallToolResult,
  type GetPromptResult,
  type Prompt,
  type ReadResourceResult,
  type Resource,
  type Tool
} from "@modelcontextprotocol/sdk/types.js";
import {
  ACTOR_ACCESSORIES,
  ADDON_TYPES,
  AUTO_MAPPED_ACTIONS,
  CONTRACT_VERSION_V2,
  ENTRANCE_EXIT_ACTIONS,
  PROP_CATALOG_VERSION,
  PROP_DEFINITIONS,
  STAGE_ANCHOR_NAMES,
  actionCatalog,
  analyzeStoryboard,
  animationSchema,
  animationSchemaV2,
  choreographAnimation,
  compileAnimation,
  compileV2Animation,
  defaultAddonsForAction,
  describeAction,
  exportAnimation,
  getMotionClip,
  getMotionMeta,
  queryActionCatalog,
  rasterizeStoryboardPng,
  renderArtifact,
  renderStoryboardSvg,
  resolveStageAnchors,
  validateAnimation,
  type ActionCatalogFilter,
  type AnimationSpec,
  type AnimationSpecV2,
  type ChoreographInput,
  type CompileResult,
  type CompiledAnimation,
  type ExportFormat,
  type PlaybackMode
} from "./index.js";
import { getStory, storyCatalog } from "./stories.js";
import { filmRecipeSchema } from "./film-schema.js";
import { composeFilmRecipe, renderFilmRecipe, listFilmAssets, checkFilmJoin } from "./film.js";
import { authorMotionDraft, previewMotionStrip } from "./motion-authoring.js";

type ObjectSchema = JsonSchemaType & { type: "object" };
type DefinedTool = Omit<Tool, "inputSchema" | "outputSchema"> & {
  inputSchema: ObjectSchema;
  outputSchema: ObjectSchema;
};
type PreviewFormat = "svg-frame" | "svg" | "html" | "storyboard-svg";

const PREVIEW_FORMATS: readonly PreviewFormat[] = ["svg-frame", "svg", "html", "storyboard-svg"];
const EXPORT_FORMATS: readonly ExportFormat[] = ["svg-frame", "svg", "html", "storyboard-svg", "gif", "mp4"];

const point2DSchema: ObjectSchema = {
  type: "object",
  additionalProperties: false,
  required: ["x", "y"],
  properties: {
    x: { type: "number" },
    y: { type: "number" }
  }
};

const descriptionSchema: ObjectSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "action", "label", "summary", "kind", "travel", "prop", "requiredBinding", "reducedMotion"],
  properties: {
    id: { type: "string" },
    action: { type: "string" },
    label: { type: "string" },
    summary: { type: "string" },
    kind: { type: "string" },
    travel: { type: "string" },
    prop: { oneOf: [{ type: "string" }, { type: "null" }] },
    requiredBinding: { type: "string" },
    reducedMotion: { type: "string" }
  }
};

const diagnosticsSchema: JsonSchemaType = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["path", "code", "message"],
    properties: {
      path: { type: "string" },
      code: { type: "string" },
      message: { type: "string" }
    }
  }
};

const validationSchema: ObjectSchema = {
  type: "object",
  additionalProperties: false,
  required: ["valid", "diagnostics"],
  properties: {
    valid: { type: "boolean" },
    diagnostics: diagnosticsSchema
  }
};

const validationFailureSchema: ObjectSchema = {
  ...validationSchema,
  properties: { ...validationSchema.properties, valid: { const: false } }
};

const markerEventSchema: ObjectSchema = {
  type: "object",
  additionalProperties: false,
  required: ["timeMs", "actionIndex", "action", "marker", "frame"],
  properties: {
    timeMs: { type: "number" },
    actionIndex: { type: "integer" },
    action: { type: "string" },
    marker: { type: "string" },
    frame: { type: "number" },
    actorId: { type: "string" }
  }
};

const programSchema: ObjectSchema = {
  type: "object",
  additionalProperties: false,
  required: ["contractVersion", "spec"],
  properties: {
    contractVersion: { type: "string", enum: ["stickman.animation/v1", "stickman.animation/v2"] },
    spec: { type: "object" },
    events: {
      type: "array",
      description: "Timed motion markers (e.g. key, reveal, cardPlaced, or emitted cues) to sync slide content; the HTML player dispatches each as a 'stickman:marker' CustomEvent.",
      items: markerEventSchema
    }
  }
};

const compileSchema: ObjectSchema = {
  ...validationSchema,
  properties: {
    ...validationSchema.properties,
    program: programSchema
  }
};

const choreographPayloadSchema: ObjectSchema = {
  type: "object",
  additionalProperties: false,
  required: ["valid", "diagnostics", "spec", "program", "anchors", "summary"],
  properties: {
    valid: { const: true },
    diagnostics: diagnosticsSchema,
    spec: { type: "object" },
    program: programSchema,
    anchors: {
      type: "object",
      additionalProperties: point2DSchema
    },
    summary: { type: "string" }
  }
};

const outOfBoundsFrameSchema: ObjectSchema = {
  type: "object",
  additionalProperties: false,
  required: ["timeMs", "kind", "id", "x", "y", "reason"],
  properties: {
    timeMs: { type: "number" },
    kind: { type: "string", enum: ["actor", "addon"] },
    id: { type: "string" },
    action: { type: "string" },
    x: { type: "number" },
    y: { type: "number" },
    reason: { type: "string" }
  }
};

const actorOverlapWarningSchema: ObjectSchema = {
  type: "object",
  additionalProperties: false,
  required: ["actorA", "actorB", "startMs", "endMs", "durationMs", "minDistancePx", "message"],
  properties: {
    actorA: { type: "string" },
    actorB: { type: "string" },
    startMs: { type: "number" },
    endMs: { type: "number" },
    durationMs: { type: "number" },
    minDistancePx: { type: "number" },
    message: { type: "string" }
  }
};

const storyboardAnalysisSchema: ObjectSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "panelCount",
    "timestampsMs",
    "durationMs",
    "actorIds",
    "addonTypes",
    "outOfBoundsCount",
    "outOfBoundsFrames",
    "maxSeamStepPx",
    "seamStepByActorPx",
    "actorOverlapWarnings",
    "beatSummary"
  ],
  properties: {
    panelCount: { type: "integer", minimum: 1 },
    timestampsMs: { type: "array", items: { type: "number" } },
    durationMs: { type: "number" },
    actorIds: { type: "array", items: { type: "string" } },
    addonTypes: { type: "array", items: { type: "string" } },
    outOfBoundsCount: { type: "integer", minimum: 0 },
    outOfBoundsFrames: { type: "array", items: outOfBoundsFrameSchema },
    maxSeamStepPx: { type: "number" },
    seamStepByActorPx: { type: "object", additionalProperties: { type: "number" } },
    actorOverlapWarnings: { type: "array", items: actorOverlapWarningSchema },
    beatSummary: { type: "array", items: { type: "string" } }
  }
};

const storyboardPayloadSchema: ObjectSchema = {
  type: "object",
  additionalProperties: false,
  required: ["valid", "diagnostics", "svg", "analysis", "rasterizerAvailable"],
  properties: {
    valid: { const: true },
    diagnostics: diagnosticsSchema,
    svg: { type: "string" },
    analysis: storyboardAnalysisSchema,
    rasterizerAvailable: { type: "boolean" }
  }
};

const schemaContractOutputSchema: ObjectSchema = {
  type: "object",
  additionalProperties: false,
  required: ["$schema", "$id", "title", "type", "additionalProperties", "required", "properties", "$defs"],
  properties: {
    $schema: { type: "string" },
    $id: { type: "string" },
    title: { type: "string" },
    type: { const: "object" },
    additionalProperties: { type: "boolean" },
    required: { type: "array", items: { type: "string" } },
    anyOf: { type: "array", items: { type: "object" } },
    properties: { type: "object" },
    $defs: { type: "object" }
  }
};

const errorSchema: ObjectSchema = {
  type: "object",
  additionalProperties: false,
  required: ["code", "message"],
  properties: {
    code: { type: "string", enum: ["invalid_arguments", "execution_error"] },
    message: { type: "string" }
  }
};

const emptyInput: ObjectSchema = { type: "object", additionalProperties: false };

const discoverInput: ObjectSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    category: { type: "string" },
    tag: { type: "string" },
    prop: { type: "string" },
    kind: { type: "string", enum: ["loop", "oneshot", "hold"] },
    travel: { type: "string", enum: ["travel", "in-place"] },
    search: { type: "string" }
  }
};

const animationInput: ObjectSchema = {
  type: "object",
  additionalProperties: false,
  required: ["animation"],
  properties: { animation: { type: "object" } }
};

function defineTool(
  name: string,
  description: string,
  inputSchema: ObjectSchema,
  payloadSchema: JsonSchemaType,
  options: { writes?: boolean; validationErrors?: boolean } = {}
): DefinedTool {
  return {
    name,
    description,
    inputSchema,
    outputSchema: {
      type: "object",
      oneOf: [
        {
          required: ["result"],
          additionalProperties: false,
          properties: {
            result: options.validationErrors ? { anyOf: [payloadSchema, validationFailureSchema] } : payloadSchema
          }
        },
        {
          required: ["error"],
          additionalProperties: false,
          properties: { error: errorSchema }
        }
      ]
    },
    annotations: {
      readOnlyHint: !options.writes,
      destructiveHint: false,
      idempotentHint: !options.writes,
      openWorldHint: false
    }
  };
}

const filmResultSchema: ObjectSchema = {
  type: "object",
  required: ["valid", "id", "frames", "seconds", "fps", "scenes", "items", "bridges", "continuity"],
  properties: {
    valid: { const: true },
    id: { type: "string" },
    frames: { type: "integer", minimum: 1 },
    seconds: { type: "number" },
    fps: { const: 30 },
    scenes: { type: "array", items: { type: "object" } },
    items: { type: "array", items: { type: "object" } },
    bridges: { type: "array", items: { type: "object" } },
    continuity: {
      type: "object",
      required: ["lead", "actors"],
      properties: {
        lead: { type: "object" },
        actors: { type: "array", items: { type: "object" } }
      }
    }
  }
};

const filmInput: ObjectSchema = {
  type: "object",
  additionalProperties: false,
  required: ["recipe"],
  properties: { recipe: filmRecipeSchema }
};

const poseOverrides = {
  type: "object",
  additionalProperties: false,
  properties: Object.fromEntries(
    [
      "anchor", "lean", "neck", "bob", "dx", "dy", "facing",
      "rLeg.hip", "rLeg.knee", "rLeg.lift",
      "lLeg.hip", "lLeg.knee", "lLeg.lift",
      "rArm.shoulder", "rArm.elbow", "rArm.spread", "rArm.elbowSpread",
      "lArm.shoulder", "lArm.elbow", "lArm.spread", "lArm.elbowSpread",
      "rFoot.x", "rFoot.y", "lFoot.x", "lFoot.y"
    ].map((name) => [
      name,
      name === "anchor"
        ? { oneOf: [{ type: "string", enum: ["both", "l", "r"] }, { type: "null" }] }
        : { type: "number" }
    ])
  )
};

const authorMotionInput: ObjectSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "label", "kind", "view", "travel", "keys", "outputDir"],
  properties: {
    id: { type: "string", pattern: "^[a-z][a-z0-9-]{0,63}$" },
    label: { type: "string", minLength: 1, maxLength: 100 },
    kind: { type: "string", enum: ["oneshot", "loop"] },
    view: { type: "string", enum: ["side", "front", "three-quarter"] },
    travel: { type: "string", enum: ["in-place", "travel"] },
    frames: { type: "integer", minimum: 2, maximum: 1800 },
    hold: { type: "integer", minimum: 0, maximum: 1800 },
    easing: { type: "string", enum: ["linear", "in", "out", "inOut", "hold"] },
    props: { type: "array", maxItems: 10, items: { type: "string", minLength: 1 } },
    tags: { type: "array", maxItems: 30, uniqueItems: true, items: { type: "string", minLength: 1 } },
    notes: { type: "string", maxLength: 500 },
    outputDir: { type: "string", minLength: 1 },
    keys: {
      type: "array",
      minItems: 2,
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["frame", "pose"],
        properties: {
          frame: { type: "integer", minimum: 0, maximum: 1800 },
          pose: { type: "string", minLength: 1 },
          overrides: poseOverrides,
          easing: { type: "string", enum: ["linear", "in", "out", "inOut", "hold"] }
        }
      }
    }
  }
};

const motionPreviewInput: ObjectSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "outputDir"],
  properties: {
    id: { type: "string", pattern: "^[a-z][a-z0-9-]{0,63}$" },
    outputDir: { type: "string", minLength: 1 },
    count: { type: "integer", minimum: 2, maximum: 24 },
    draftDir: {
      type: "string",
      minLength: 1,
      description: "Optional existing relative draft directory under --root (the author's outputDir). Otherwise read the packaged library."
    }
  }
};

const motionDraftResult: ObjectSchema = {
  type: "object",
  required: ["spec", "specPath", "preview", "checks"],
  properties: {
    spec: { type: "object" },
    specPath: { type: "string" },
    preview: { type: "object" },
    checks: { type: "object" }
  }
};

const motionPreviewResult: ObjectSchema = {
  type: "object",
  required: ["id", "status", "preview"],
  properties: {
    id: { type: "string" },
    status: { type: "string" },
    preview: { type: "object" },
    checks: { oneOf: [{ type: "object" }, { type: "null" }] }
  }
};

const toolDefinitions: DefinedTool[] = [
  defineTool(
    "stickman_compose_film",
    "Validate a strict JSON film recipe and compose continuous lead/supporting performances; return scene and item frame ranges, duration and joint-step continuity (limit 14). Composer and assets are included in the installed package.",
    filmInput,
    filmResultSchema
  ),
  defineTool(
    "stickman_render_film",
    "Render a JSON film recipe to silent MP4, poster PNG, captions VTT and optional QA PNG. outputDir must be a NEW relative directory inside the launch-time --root; existing paths and symlinks are refused. preview uses 640x360 at 15 fps, preserving duration.",
    {
      ...filmInput,
      required: ["recipe", "outputDir"],
      properties: {
        ...filmInput.properties,
        outputDir: { type: "string", minLength: 1 },
        preview: { type: "boolean" },
        qaFrames: { type: "integer", minimum: 1, maximum: 24 }
      }
    },
    {
      ...filmResultSchema,
      required: [...(filmResultSchema.required ?? []), "outputDir", "files", "sha256"],
      properties: {
        ...filmResultSchema.properties,
        outputDir: { type: "string" },
        files: { type: "object" },
        sha256: { type: "string" }
      }
    },
    { writes: true }
  ),
  defineTool(
    "stickman_list_film_assets",
    "List mechanically qualified user-approved film motion IDs with frame counts/kind, kits, headwear, places, set prop types, overlay primitives, approved-pair join count and the strict film recipe JSON Schema. This is separate from the runtime action catalogue.",
    emptyInput,
    {
      type: "object",
      required: ["motions", "kits", "places", "overlays", "recipeSchema", "joinCount"],
      properties: {
        joinCount: { type: "integer", minimum: 0 },
        motions: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "frames", "kind"],
            properties: {
              id: { type: "string" },
              frames: { type: "integer" },
              kind: { type: "string", enum: ["oneshot", "loop", "travel"] }
            }
          }
        },
        kits: { type: "array", items: { type: "string" } },
        places: { type: "array", items: { type: "string" } },
        overlays: { type: "array", items: { type: "string" } },
        recipeSchema: { type: "object" }
      }
    }
  ),
  defineTool(
    "stickman_author_motion",
    "Author a status=draft motion from named reusable pose keys, run engine anatomy/contact/joint-step gates plus film-scale continuity (2.4x, limit 14), write <id>.json and a preview PNG into a new relative outputDir under --root. The installed library is never modified; packaged non-draft IDs are protected; drafts are not film assets.",
    authorMotionInput,
    motionDraftResult,
    { writes: true }
  ),
  defineTool(
    "stickman_preview_motion",
    "Render a draft, candidate, or approved motion as a sampled preview strip PNG into a new relative outputDir under --root. Read-only on the motion spec.",
    motionPreviewInput,
    motionPreviewResult,
    { writes: true }
  ),
  defineTool(
    "stickman_check_join",
    "Check an approved motion pair and return its film-scale hard-join cost, continuity limit and suggested generated bridge length.",
    {
      type: "object",
      additionalProperties: false,
      required: ["motionA", "motionB"],
      properties: {
        motionA: { type: "string", pattern: "^[a-z][a-z0-9-]{0,63}$" },
        motionB: { type: "string", pattern: "^[a-z][a-z0-9-]{0,63}$" }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["from", "to", "cost", "limit", "needsBridge", "bridgeFrames"],
      properties: {
        from: { type: "string" },
        to: { type: "string" },
        cost: { type: "number" },
        limit: { type: "number" },
        needsBridge: { type: "boolean" },
        bridgeFrames: { type: "integer", minimum: 6, maximum: 24 }
      }
    }
  ),
  defineTool(
    "stickman_discover",
    "Discover supported stickman actions and their binding/prop metadata, with optional category, tag, prop, kind, travel, or search filters.",
    discoverInput,
    { type: "array", items: descriptionSchema }
  ),
  defineTool(
    "stickman_describe",
    "Describe a supported action by bare action name (e.g. 'idea') or versioned ID (e.g. 'idea@1.1.0').",
    {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      properties: { id: { type: "string", minLength: 1 } }
    },
    descriptionSchema
  ),
  defineTool(
    "stickman_schema",
    "Get the strict JSON Schema for stickman.animation/v1 (default) or stickman.animation/v2.",
    {
      type: "object",
      additionalProperties: false,
      properties: { version: { type: "string", enum: ["v1", "v2"] } }
    },
    schemaContractOutputSchema
  ),
  defineTool(
    "stickman_validate",
    "Validate a stickman.animation/v1 or stickman.animation/v2 document and return actionable diagnostics.",
    animationInput,
    validationSchema
  ),
  defineTool(
    "stickman_compile",
    "Validate and compile a stickman.animation/v1 or stickman.animation/v2 document to the canonical deterministic program.",
    animationInput,
    compileSchema
  ),
  defineTool(
    "stickman_choreograph",
    "Auto-choreograph a concise v2 single-actor or multi-actor beat list using semantic stage anchors, natural clip timing, auto-props, and cues.",
    {
      type: "object",
      additionalProperties: false,
      required: ["scene"],
      properties: { scene: { type: "object" } }
    },
    choreographPayloadSchema,
    { validationErrors: true }
  ),
  defineTool(
    "stickman_storyboard",
    "Render a multi-panel storyboard contact sheet (default or orthographic CAD blueprint theme) and run automated stage/seam/overlap self-review lint (plus PNG image when available).",
    {
      type: "object",
      additionalProperties: false,
      required: ["animation"],
      properties: {
        animation: { type: "object" },
        columns: { type: "integer", minimum: 1, maximum: 8 },
        maxPanels: { type: "integer", minimum: 2, maximum: 16 },
        mode: { type: "string", enum: ["normal", "reduced", "static"] },
        theme: { type: "string", enum: ["default", "blueprint"] },
        includePng: { type: "boolean" }
      }
    },
    storyboardPayloadSchema,
    { validationErrors: true }
  ),
  defineTool(
    "stickman_preview",
    "Render a single SVG frame, animated SVG, storyboard SVG, or self-contained HTML preview from v1, v2, or shorthand choreography input.",
    {
      ...animationInput,
      properties: {
        ...animationInput.properties,
        format: { type: "string", enum: [...PREVIEW_FORMATS] },
        timeMs: { type: "number" },
        mode: { type: "string", enum: ["normal", "reduced", "static"] }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["format", "content"],
      properties: {
        format: { type: "string", enum: [...PREVIEW_FORMATS] },
        content: { type: "string" }
      }
    },
    { validationErrors: true }
  ),
  defineTool(
    "stickman_export",
    "Export svg-frame, svg, html, storyboard-svg, gif, or mp4 to a relative file strictly inside the server's launch-time output root.",
    {
      ...animationInput,
      required: ["animation", "path", "format"],
      properties: {
        ...animationInput.properties,
        path: { type: "string", minLength: 1 },
        format: { type: "string", enum: [...EXPORT_FORMATS] },
        timeMs: { type: "number" },
        mode: { type: "string", enum: ["normal", "reduced", "static"] }
      }
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["format", "path", "bytes"],
      properties: {
        format: { type: "string", enum: [...EXPORT_FORMATS] },
        path: { type: "string" },
        bytes: { type: "integer", minimum: 0 },
        warnings: { type: "array", items: { type: "string" } },
        estimatedWork: {
          type: "object",
          additionalProperties: false,
          required: ["frameCount", "pixelsPerFrame", "totalRasterPixels"],
          properties: {
            frameCount: { type: "integer" },
            pixelsPerFrame: { type: "integer" },
            totalRasterPixels: { type: "integer" }
          }
        }
      }
    },
    { writes: true, validationErrors: true }
  ),
  defineTool(
    "stickman_story",
    "Discover combined IT story recipes (no id), or get an executable multi-action animation and synchronized host content cues by story id. Pass result.animation to validate/compile/preview/export; result.cues are for the presentation host, not animation-contract fields.",
    {
      type: "object",
      additionalProperties: false,
      properties: { id: { type: "string", minLength: 1 } }
    },
    {
      anyOf: [
        {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "title", "summary"],
            properties: { id: { type: "string" }, title: { type: "string" }, summary: { type: "string" } }
          }
        },
        {
          type: "object",
          additionalProperties: false,
          required: ["id", "title", "summary", "animation", "cues"],
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            summary: { type: "string" },
            animation: { type: "object" },
            cues: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["id", "timeMs", "title", "text"],
                properties: {
                  id: { type: "string" },
                  timeMs: { type: "number" },
                  title: { type: "string" },
                  text: { type: "string" }
                }
              }
            }
          }
        }
      ]
    }
  )
];

const schemaValidator = new AjvJsonSchemaValidator();
const argumentValidators = new Map(
  toolDefinitions.map((tool) => [tool.name, schemaValidator.getValidator<Record<string, unknown>>(tool.inputSchema)])
);
const outputValidators = new Map(
  toolDefinitions.map((tool) => [tool.name, schemaValidator.getValidator<Record<string, unknown>>(tool.outputSchema)])
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compileAnyAnimation(input: unknown): CompileResult {
  if (isRecord(input) && input.version === undefined) {
    return compileV2Animation(input);
  }
  return compileAnimation(input);
}

function summarizeChoreography(program: CompiledAnimation): string {
  const { canvas, durationMs } = program.spec;
  const eventCount = program.events?.length ?? 0;
  if (program.contractVersion === CONTRACT_VERSION_V2) {
    const v2 = program.spec as AnimationSpecV2;
    const actorSummary = v2.actors
      .map((actor) => `${actor.id}[${actor.actions.map((a) => a.action).join(" -> ") || "idle"}]`)
      .join("; ");
    const totalActions = v2.actors.reduce((sum, actor) => sum + actor.actions.length, 0);
    return `${v2.actors.length} actor(s) (${actorSummary}), ${totalActions} action(s), ${durationMs}ms (${canvas.width}x${canvas.height}@${canvas.fps}fps), ${eventCount} marker event(s).`;
  }
  const v1 = program.spec as AnimationSpec;
  const actions = v1.actions.map((a) => a.action).join(" -> ") || "idle";
  return `1 actor (${actions}), ${v1.actions.length} action(s), ${durationMs}ms (${canvas.width}x${canvas.height}@${canvas.fps}fps), ${eventCount} marker event(s).`;
}

async function checkRasterizerAvailable(): Promise<boolean> {
  try {
    const mod = (await import("@resvg/resvg-js")) as { Resvg?: unknown };
    return typeof mod?.Resvg === "function";
  } catch {
    return false;
  }
}

function result(value: unknown, isError = false, extraContent: CallToolResult["content"] = []): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }, ...extraContent],
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

function finalizeResponse(toolName: string, response: CallToolResult): CallToolResult {
  const validateOutput = outputValidators.get(toolName);
  if (validateOutput && response.structuredContent) {
    const outCheck = validateOutput(response.structuredContent);
    if (!outCheck.valid) {
      throw new McpError(
        ErrorCode.InternalError,
        `Output schema validation failed for ${toolName}: ${outCheck.errorMessage}`
      );
    }
  }
  return response;
}

function stringArgument(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string") throw new TypeError(`${key} must be a string.`);
  return value;
}

function isPlaybackMode(value: unknown): value is PlaybackMode {
  return value === "normal" || value === "reduced" || value === "static";
}

function isPreviewFormat(value: unknown): value is PreviewFormat {
  return typeof value === "string" && (PREVIEW_FORMATS as readonly string[]).includes(value);
}

function isExportFormat(value: unknown): value is ExportFormat {
  return typeof value === "string" && (EXPORT_FORMATS as readonly string[]).includes(value);
}

const TEMPLATES: Readonly<Record<string, ChoreographInput & { version: typeof CONTRACT_VERSION_V2 }>> = Object.freeze({
  "stickman://templates/presentation-pitch": {
    version: CONTRACT_VERSION_V2,
    canvas: { width: 800, height: 450, fps: 30 },
    theme: { accentColor: "#2563eb", background: "#ffffff" },
    actor: {
      id: "presenter",
      label: "Slide Presenter",
      x: "offstage-left",
      color: "#1e293b",
      accessory: "tie"
    },
    actions: [
      { action: "walk-on", to: "left", emitCue: "arrived" },
      { action: "write-board", emitCue: "boardWritten" },
      { action: "point", to: "board" },
      { action: "present-card", addon: { type: "card", text: "Q4" }, emitCue: "kpiShown" },
      { action: "cheer" },
      { action: "walk-off", to: "offstage-right" }
    ]
  },
  "stickman://templates/two-actor-dialogue": {
    version: CONTRACT_VERSION_V2,
    canvas: { width: 800, height: 450, fps: 30 },
    theme: { accentColor: "#0f766e", background: "#ffffff" },
    actors: [
      {
        id: "speaker",
        label: "Lead Speaker",
        x: "left",
        facing: "right",
        color: "#0f172a",
        accessory: "tie",
        zIndex: 2,
        actions: [
          { action: "wave", emitCue: "greeted" },
          { action: "present-card", afterCue: "acknowledged", emitCue: "proposalShared" },
          { action: "thumbs-up", afterCue: "agreed" }
        ]
      },
      {
        id: "partner",
        label: "Collaborator",
        x: "right",
        facing: "left",
        color: "#334155",
        accessory: "glasses",
        zIndex: 1,
        actions: [
          { action: "nod", afterCue: "greeted", emitCue: "acknowledged" },
          { action: "think", afterCue: "proposalShared" },
          { action: "clap", emitCue: "agreed" }
        ]
      }
    ]
  },
  "stickman://templates/idea-reveal": {
    version: CONTRACT_VERSION_V2,
    canvas: { width: 800, height: 450, fps: 30 },
    theme: { accentColor: "#d97706", background: "#ffffff" },
    actor: {
      id: "inventor",
      label: "Inventor",
      x: "center",
      color: "#1e293b",
      accessory: "glasses"
    },
    actions: [
      { action: "think", emitCue: "pondering" },
      { action: "idea", emitCue: "lightbulbPop" },
      { action: "reveal", emitCue: "solutionRevealed" },
      { action: "cheer" }
    ]
  },
  "stickman://templates/sports-action": {
    version: CONTRACT_VERSION_V2,
    canvas: { width: 800, height: 450, fps: 30 },
    theme: { accentColor: "#e11d48", background: "#ffffff" },
    actor: {
      id: "athlete",
      label: "Athlete",
      x: "left",
      color: "#0f172a",
      accessory: "badge"
    },
    actions: [
      { action: "hurdle", emitCue: "clearedHurdle" },
      { action: "basketball-shot", emitCue: "shotMade" },
      { action: "fist-pump" }
    ]
  }
});

function buildCatalogResourcePayload() {
  const grouped = new Map<string, { category: string; group: string; actions: Array<Record<string, unknown>> }>();
  for (const desc of actionCatalog) {
    const meta = getMotionMeta(desc.action);
    const clip = getMotionClip(desc.action);
    const category = meta?.category ?? "basic";
    const group = meta?.group ?? "Basic (moving & postures)";
    let bucket = grouped.get(category);
    if (!bucket) {
      bucket = { category, group, actions: [] };
      grouped.set(category, bucket);
    }
    const markers = clip?.markers ? Object.keys(clip.markers) : [];
    bucket.actions.push({
      ...desc,
      tags: meta?.tags ?? [],
      markers
    });
  }
  return {
    totalActions: actionCatalog.length,
    categories: [...grouped.values()].map((b) => ({
      category: b.category,
      group: b.group,
      count: b.actions.length,
      actions: b.actions
    })),
    propSummary: {
      totalProps: ADDON_TYPES.length,
      propTypes: ADDON_TYPES,
      autoMappedActions: AUTO_MAPPED_ACTIONS
    }
  };
}

function buildAnchorsResourcePayload() {
  const defaultCanvas = { width: 800, height: 450, fps: 30 };
  const defaultGroundY = Math.round(defaultCanvas.height * 0.82);
  return {
    defaultCanvas,
    defaultGroundY,
    stageAnchorNames: STAGE_ANCHOR_NAMES,
    anchors: resolveStageAnchors(defaultCanvas, defaultGroundY),
    entranceExitActions: ENTRANCE_EXIT_ACTIONS,
    accessories: ACTOR_ACCESSORIES,
    conventions: {
      origin: "Top-left (0, 0); +x points right, +y points down.",
      floor: `Default groundY is round(height * 0.82) = ${defaultGroundY}px on an 800x450 stage.`,
      offstage: "Offstage anchors ('offstage-left', 'offstage-right') are reserved for entrance/exit locomotion (walk-on, walk-off, walk, run, jog, sneak).",
      spacing: "Keep simultaneous onstage actors at least 100px apart (e.g. 'left' vs 'right' or 'center-left' vs 'center-right') so silhouettes never overlap."
    }
  };
}

function buildPropsResourcePayload() {
  const autoMappings = Object.fromEntries(
    AUTO_MAPPED_ACTIONS.map((action) => [action, defaultAddonsForAction(action)])
  );
  return {
    version: PROP_CATALOG_VERSION,
    totalProps: ADDON_TYPES.length,
    sockets: ["rHand", "lHand", "bothHands", "aboveHead", "eyes", "wrist", "rFoot", "lFoot", "stage"],
    props: PROP_DEFINITIONS,
    autoMappedActions: autoMappings
  };
}

interface ResourceEntry {
  meta: Resource;
  read: () => string;
}

const resourceEntries: readonly ResourceEntry[] = [
  {
    meta: {
      uri: "stickman://catalog",
      name: "Stickman Action & Prop Catalog",
      description: `Grouped catalog of all ${actionCatalog.length} deterministic stickman actions, clip markers, and prop summary.`,
      mimeType: "application/json"
    },
    read: () => JSON.stringify(buildCatalogResourcePayload(), null, 2)
  },
  {
    meta: {
      uri: "stickman://schema/v1",
      name: "Stickman Animation Schema v1",
      description: "Strict JSON Schema for stickman.animation/v1 single-actor documents.",
      mimeType: "application/schema+json"
    },
    read: () => JSON.stringify(animationSchema, null, 2)
  },
  {
    meta: {
      uri: "stickman://schema/v2",
      name: "Stickman Animation Schema v2",
      description: "Strict JSON Schema for stickman.animation/v2 multi-actor choreography documents.",
      mimeType: "application/schema+json"
    },
    read: () => JSON.stringify(animationSchemaV2, null, 2)
  },
  {
    meta: {
      uri: "stickman://anchors",
      name: "Stage Anchors & Coordinate Conventions",
      description: "Semantic stage anchors and coordinate conventions for the default 800x450 canvas.",
      mimeType: "application/json"
    },
    read: () => JSON.stringify(buildAnchorsResourcePayload(), null, 2)
  },
  {
    meta: {
      uri: "stickman://props",
      name: "Geometric Props, Sockets & Auto-Mappings",
      description: `All ${ADDON_TYPES.length} runtime geometric prop definitions, attachment sockets, and auto-mapped actions.`,
      mimeType: "application/json"
    },
    read: () => JSON.stringify(buildPropsResourcePayload(), null, 2)
  },
  {
    meta: {
      uri: "stickman://templates/presentation-pitch",
      name: "Template: Presentation Pitch",
      description: "Ready-to-compile v2 single-actor slide presentation pitch template.",
      mimeType: "application/json"
    },
    read: () => JSON.stringify(TEMPLATES["stickman://templates/presentation-pitch"], null, 2)
  },
  {
    meta: {
      uri: "stickman://templates/two-actor-dialogue",
      name: "Template: Two-Actor Dialogue",
      description: "Ready-to-compile v2 2-actor cue-synced conversation template.",
      mimeType: "application/json"
    },
    read: () => JSON.stringify(TEMPLATES["stickman://templates/two-actor-dialogue"], null, 2)
  },
  {
    meta: {
      uri: "stickman://templates/idea-reveal",
      name: "Template: Idea Reveal",
      description: "Ready-to-compile v2 think -> idea lightbulb -> reveal -> cheer template.",
      mimeType: "application/json"
    },
    read: () => JSON.stringify(TEMPLATES["stickman://templates/idea-reveal"], null, 2)
  },
  {
    meta: {
      uri: "stickman://templates/sports-action",
      name: "Template: Sports Action",
      description: "Ready-to-compile v2 hurdle -> basketball-shot -> fist-pump template.",
      mimeType: "application/json"
    },
    read: () => JSON.stringify(TEMPLATES["stickman://templates/sports-action"], null, 2)
  }
];

const resourceMap = new Map(resourceEntries.map((entry) => [entry.meta.uri, entry]));

const promptDefinitions: readonly Prompt[] = [
  {
    name: "choreograph-slide",
    description: "Step-by-step workflow to choreograph, storyboard-critique, and export a deterministic stickman slide animation.",
    arguments: [
      {
        name: "topic",
        description: "Slide topic or narrative message to illustrate.",
        required: true
      },
      {
        name: "beats",
        description: "Optional visual beats or key moments to include.",
        required: false
      }
    ]
  },
  {
    name: "two-actor-dialogue",
    description: "Step-by-step workflow to choreograph and verify a 2-actor cue-synced stickman conversation.",
    arguments: [
      {
        name: "scenario",
        description: "Conversation or handoff scenario between the two stickman actors.",
        required: true
      }
    ]
  }
];

function buildPromptResult(name: string, promptArgs: Record<string, string> | undefined): GetPromptResult {
  const args = promptArgs ?? {};
  if (name === "choreograph-slide") {
    const topic = args.topic?.trim();
    if (!topic) {
      throw new McpError(ErrorCode.InvalidParams, 'Prompt "choreograph-slide" requires a non-empty "topic" argument.');
    }
    const beatsLine = args.beats?.trim()
      ? `\nRequested visual beats: ${args.beats.trim()}`
      : "\nDesign 4-6 clear visual beats (entrance, setup, key reveal/idea, celebration, optional exit).";

    return {
      description: `Choreograph and self-critique a stickman slide animation for: ${topic}`,
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Create a polished stickman slide animation illustrating "${topic}".${beatsLine}\n\n` +
              `Follow this exact workflow:\n` +
              `1. Read \`stickman://anchors\` (and optionally \`stickman://templates/presentation-pitch\` or \`stickman://props\`) to review semantic stage positions on the 800x450 canvas.\n` +
              `2. Call \`stickman_discover\` with \`category\`, \`tag\`, or \`search\` filters to pick expressive actions and auto-mapped props.\n` +
              `3. Call \`stickman_choreograph\` with a concise \`scene\` beat list using named anchors (\`offstage-left\`, \`left\`, \`center\`, \`board\`, \`offstage-right\`), actor \`accessory\`, and \`emitCue\` markers for slide sync (no manual \`startMs\`/\`durationMs\` math needed).\n` +
              `4. Call \`stickman_storyboard\` on the compiled animation to inspect the contact sheet and \`analysis\` lint: verify \`outOfBoundsCount === 0\`, \`actorOverlapWarnings.length === 0\`, and smooth \`beatSummary\` staging. Adjust anchors/beats if any warning appears.\n` +
              `5. Call \`stickman_export\` (e.g. \`format: "html"\`, \`"svg"\`, or \`"storyboard-svg"\`) to write the final artifact.`
          }
        }
      ]
    };
  }

  if (name === "two-actor-dialogue") {
    const scenario = args.scenario?.trim();
    if (!scenario) {
      throw new McpError(ErrorCode.InvalidParams, 'Prompt "two-actor-dialogue" requires a non-empty "scenario" argument.');
    }

    return {
      description: `Choreograph a 2-actor cue-synced dialogue for: ${scenario}`,
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Create a 2-actor cue-synced stickman animation for the scenario: "${scenario}".\n\n` +
              `Follow this exact workflow:\n` +
              `1. Read \`stickman://anchors\` and \`stickman://templates/two-actor-dialogue\` to review multi-actor spacing and declarative cue synchronization.\n` +
              `2. Call \`stickman_discover\` to choose expressive conversational gestures, reactions, and props.\n` +
              `3. Author a 2-actor \`scene\` via \`stickman_choreograph\`: place actors on distinct anchors (e.g. \`"left"\` facing \`"right"\` and \`"right"\` facing \`"left"\`), differentiate them with \`accessory\` (\`tie\`, \`glasses\`, \`hat\`, \`badge\`) and \`color\`, and synchronize turns with \`emitCue\` / \`emitCueAt\` and \`afterCue\`.\n` +
              `4. Call \`stickman_storyboard\` to review the visual contact sheet and verify \`analysis.outOfBoundsCount === 0\` and \`analysis.actorOverlapWarnings.length === 0\`.\n` +
              `5. Export the verified scene with \`stickman_export\`.`
          }
        }
      ]
    };
  }

  throw new McpError(ErrorCode.InvalidParams, `Unknown prompt "${name}".`);
}

export function createMcpServer(outputRoot: string): Server {
  const version = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;
  const server = new Server(
    { name: "stickman-mcp", version },
    { capabilities: { tools: {}, resources: {}, prompts: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolDefinitions }));

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: resourceEntries.map((entry) => entry.meta)
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request): Promise<ReadResourceResult> => {
    const { uri } = request.params;
    const entry = resourceMap.get(uri);
    if (!entry) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown resource URI "${uri}".`);
    }
    return {
      contents: [
        {
          uri: entry.meta.uri,
          ...(entry.meta.mimeType !== undefined ? { mimeType: entry.meta.mimeType } : {}),
          text: entry.read()
        }
      ]
    };
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [...promptDefinitions]
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request): Promise<GetPromptResult> => {
    return buildPromptResult(request.params.name, request.params.arguments);
  });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: input = {} } = request.params;
    const validateArguments = argumentValidators.get(name);
    if (!validateArguments) throw new McpError(ErrorCode.InvalidParams, `Unknown tool "${name}".`);
    const validation = validateArguments(input);
    if (!validation.valid) {
      return finalizeResponse(name, errorResult(`Invalid arguments for ${name}: ${validation.errorMessage}`, "invalid_arguments"));
    }
    const args = validation.data;
    try {
      switch (name) {
        case "stickman_compose_film":
          return finalizeResponse(
            name,
            result(
              await composeFilmRecipe(args.recipe, {
                signal: extra.signal,
                ...(extra._meta?.progressToken === undefined
                  ? {}
                  : {
                      onProgress: async (progress) => {
                        await extra.sendNotification({
                          method: "notifications/progress",
                          params: {
                            progressToken: extra._meta!.progressToken!,
                            progress: progress.current,
                            total: progress.total,
                            message: progress.phase
                          }
                        });
                      }
                    })
              })
            )
          );
        case "stickman_list_film_assets":
          return finalizeResponse(name, result(await listFilmAssets()));
        case "stickman_check_join":
          return finalizeResponse(
            name,
            result(await checkFilmJoin(stringArgument(args, "motionA"), stringArgument(args, "motionB")))
          );
        case "stickman_author_motion":
          return finalizeResponse(
            name,
            result(await authorMotionDraft(args, outputRoot, stringArgument(args, "outputDir")))
          );
        case "stickman_preview_motion":
          return finalizeResponse(
            name,
            result(
              await previewMotionStrip(
                stringArgument(args, "id"),
                outputRoot,
                stringArgument(args, "outputDir"),
                args.count === undefined ? 8 : (args.count as number),
                args.draftDir === undefined ? undefined : stringArgument(args, "draftDir")
              )
            )
          );
        case "stickman_render_film":
          return finalizeResponse(
            name,
            result(
              await renderFilmRecipe(args.recipe, outputRoot, stringArgument(args, "outputDir"), {
                ...(args.preview === undefined ? {} : { preview: args.preview as boolean }),
                ...(args.qaFrames === undefined ? {} : { qaFrames: args.qaFrames as number }),
                signal: extra.signal,
                ...(extra._meta?.progressToken === undefined
                  ? {}
                  : {
                      onProgress: async (progress) => {
                        await extra.sendNotification({
                          method: "notifications/progress",
                          params: {
                            progressToken: extra._meta!.progressToken!,
                            progress: progress.current,
                            total: progress.total,
                            message: progress.phase
                          }
                        });
                      }
                    })
              })
            )
          );
        case "stickman_story":
          return finalizeResponse(
            name,
            result(args.id === undefined ? storyCatalog() : getStory(stringArgument(args, "id")))
          );
        case "stickman_discover": {
          const filter: ActionCatalogFilter = {
            ...(typeof args.category === "string" ? { category: args.category } : {}),
            ...(typeof args.tag === "string" ? { tag: args.tag } : {}),
            ...(typeof args.prop === "string" ? { prop: args.prop } : {}),
            ...(typeof args.kind === "string" ? { kind: args.kind } : {}),
            ...(typeof args.travel === "string" ? { travel: args.travel } : {}),
            ...(typeof args.search === "string" ? { search: args.search } : {})
          };
          return finalizeResponse(name, result(queryActionCatalog(filter)));
        }
        case "stickman_describe": {
          const item = describeAction(stringArgument(args, "id"));
          if (!item) throw new Error(`Unknown action ID. Supported IDs: ${actionCatalog.map((a) => a.id).join(", ")}.`);
          return finalizeResponse(name, result(item));
        }
        case "stickman_schema": {
          const version = args.version === undefined ? "v1" : args.version;
          if (version !== "v1" && version !== "v2") throw new Error('Schema version must be "v1" or "v2".');
          return finalizeResponse(name, result(version === "v2" ? animationSchemaV2 : animationSchema));
        }
        case "stickman_validate": {
          return finalizeResponse(name, result(validateAnimation(args.animation)));
        }
        case "stickman_compile": {
          const compiled = compileAnimation(args.animation);
          return finalizeResponse(name, result(compiled, !compiled.valid));
        }
        case "stickman_choreograph": {
          const choreographed = choreographAnimation(args.scene);
          if (!choreographed.valid || !choreographed.program || !choreographed.spec || !choreographed.anchors) {
            return finalizeResponse(name, result({ valid: false, diagnostics: choreographed.diagnostics }, true));
          }
          return finalizeResponse(
            name,
            result({
              valid: true,
              diagnostics: choreographed.diagnostics,
              spec: choreographed.spec,
              program: choreographed.program,
              anchors: choreographed.anchors,
              summary: summarizeChoreography(choreographed.program)
            })
          );
        }
        case "stickman_storyboard": {
          const compiled = compileAnyAnimation(args.animation);
          if (!compiled.valid || !compiled.program) {
            return finalizeResponse(name, result({ valid: false, diagnostics: compiled.diagnostics }, true));
          }
          const columns = typeof args.columns === "number" ? args.columns : undefined;
          const maxPanels = typeof args.maxPanels === "number" ? args.maxPanels : undefined;
          const mode = args.mode === undefined ? "normal" : args.mode;
          if (!isPlaybackMode(mode)) throw new Error("Mode must be normal, reduced, or static.");
          const theme = args.theme === undefined ? "default" : args.theme;
          if (theme !== "default" && theme !== "blueprint") {
            throw new Error('Storyboard theme must be "default" or "blueprint".');
          }
          const includePng = args.includePng !== false;

          const svg = renderStoryboardSvg(compiled.program, {
            ...(columns !== undefined ? { columns } : {}),
            ...(maxPanels !== undefined ? { maxPanels } : {}),
            mode,
            theme
          });
          const analysis = analyzeStoryboard(compiled.program);

          let rasterizerAvailable = false;
          const extraContent: CallToolResult["content"] = [];
          if (includePng) {
            const rasterized = await rasterizeStoryboardPng(svg);
            rasterizerAvailable = rasterized.rasterizerAvailable;
            if (rasterized.pngBase64) {
              extraContent.push({
                type: "image",
                data: rasterized.pngBase64,
                mimeType: "image/png"
              });
            }
          } else {
            rasterizerAvailable = await checkRasterizerAvailable();
          }

          return finalizeResponse(
            name,
            result(
              {
                valid: true,
                diagnostics: [],
                svg,
                analysis,
                rasterizerAvailable
              },
              false,
              extraContent
            )
          );
        }
        case "stickman_preview": {
          const compiled = compileAnyAnimation(args.animation);
          if (!compiled.valid || !compiled.program) {
            return finalizeResponse(name, result({ valid: false, diagnostics: compiled.diagnostics }, true));
          }
          const format = args.format === undefined ? "svg" : args.format;
          if (!isPreviewFormat(format)) {
            throw new Error("Preview format must be svg-frame, svg, html, or storyboard-svg.");
          }
          const mode = args.mode;
          if (mode !== undefined && !isPlaybackMode(mode)) throw new Error("Mode must be normal, reduced, or static.");
          const timeMs = args.timeMs;
          if (timeMs !== undefined && (typeof timeMs !== "number" || !Number.isFinite(timeMs))) {
            throw new Error("timeMs must be finite.");
          }
          const content = renderArtifact(compiled.program, format, {
            ...(timeMs !== undefined ? { timeMs } : {}),
            ...(mode !== undefined ? { mode } : {})
          });
          return finalizeResponse(name, result({ format, content }));
        }
        case "stickman_export": {
          const compiled = compileAnyAnimation(args.animation);
          if (!compiled.valid || !compiled.program) {
            return finalizeResponse(name, result({ valid: false, diagnostics: compiled.diagnostics }, true));
          }
          const format = args.format;
          if (!isExportFormat(format)) {
            throw new Error("Format must be svg-frame, svg, html, storyboard-svg, gif, or mp4.");
          }
          const mode = args.mode;
          if (mode !== undefined && !isPlaybackMode(mode)) throw new Error("Mode must be normal, reduced, or static.");
          const timeMs = args.timeMs;
          if (timeMs !== undefined && (typeof timeMs !== "number" || !Number.isFinite(timeMs))) {
            throw new Error("timeMs must be finite.");
          }
          return finalizeResponse(
            name,
            result(
              await exportAnimation(compiled.program, outputRoot, stringArgument(args, "path"), format, {
                ...(timeMs !== undefined ? { timeMs } : {}),
                ...(mode !== undefined ? { mode } : {}),
                signal: extra.signal,
                ...(extra._meta?.progressToken === undefined
                  ? {}
                  : {
                      onProgress: async (progress) => {
                        await extra.sendNotification({
                          method: "notifications/progress",
                          params: {
                            progressToken: extra._meta!.progressToken!,
                            progress: progress.current,
                            total: progress.total,
                            message: progress.phase
                          }
                        });
                      }
                    })
              })
            )
          );
        }
        default:
          throw new Error(`Unknown tool "${name}".`);
      }
    } catch (error) {
      return finalizeResponse(name, errorResult(error));
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
