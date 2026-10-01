import { CONTRACT_VERSION } from "./contract.js";

export const animationSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://stickman-mcp.dev/schemas/animation-v1.json",
  title: "Stickman animation",
  type: "object",
  additionalProperties: false,
  required: ["version", "canvas", "durationMs", "actions"],
  properties: {
    version: { const: CONTRACT_VERSION },
    canvas: {
      type: "object",
      additionalProperties: false,
      required: ["width", "height", "fps"],
      properties: {
        width: { type: "integer", minimum: 64, maximum: 4096 },
        height: { type: "integer", minimum: 64, maximum: 4096 },
        fps: { type: "integer", minimum: 1, maximum: 60 }
      }
    },
    durationMs: { type: "integer", minimum: 100, maximum: 120000 },
    actor: {
      type: "object",
      additionalProperties: false,
      properties: {
        x: { type: "number" },
        groundY: { type: "number" },
        color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" }
      }
    },
    targets: {
      type: "object",
      additionalProperties: { $ref: "#/$defs/point" }
    },
    prop: {
      type: "object",
      additionalProperties: false,
      required: ["id", "x", "y", "width", "height", "toX", "handle"],
      properties: {
        id: { type: "string", minLength: 1 },
        x: { type: "number" },
        y: { type: "number" },
        width: { type: "number", exclusiveMinimum: 0 },
        height: { type: "number", exclusiveMinimum: 0 },
        toX: { type: "number" },
        handle: { $ref: "#/$defs/point" }
      }
    },
    actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["action", "startMs", "durationMs"],
        properties: {
          action: { enum: ["walk", "run", "wave", "point", "jump", "push"] },
          startMs: { type: "integer", minimum: 0 },
          durationMs: { type: "integer", minimum: 300 },
          target: { type: "string", minLength: 1 }
        }
      }
    }
  },
  $defs: {
    point: {
      type: "object",
      additionalProperties: false,
      required: ["x", "y"],
      properties: { x: { type: "number" }, y: { type: "number" } }
    }
  }
} as const;
