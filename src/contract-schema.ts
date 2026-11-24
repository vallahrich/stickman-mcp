import { actionCatalog } from "./catalog.js";
import { CONTRACT_VERSION, CONTRACT_VERSION_V2 } from "./contract.js";
import { RUNTIME_ACTION_NAMES } from "./motion-library.js";
import { ADDON_TYPES } from "./props.js";

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
          action: { enum: RUNTIME_ACTION_NAMES },
          startMs: { type: "integer", minimum: 0 },
          durationMs: { type: "integer", minimum: 300 },
          speed: { type: "number", minimum: 0.5, maximum: 2 },
          blendMs: { type: "integer", minimum: 0, maximum: 5000 },
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

const V2_ACTION_IDS = Object.freeze([
  ...RUNTIME_ACTION_NAMES,
  ...actionCatalog.map((item) => item.id)
]);

export const animationSchemaV2 = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://stickman-mcp.dev/schemas/animation-v2.json",
  title: "Stickman animation v2",
  type: "object",
  additionalProperties: false,
  required: ["version"],
  anyOf: [
    { required: ["actors"] },
    { required: ["actions"] }
  ],
  properties: {
    version: { const: CONTRACT_VERSION_V2 },
    canvas: {
      type: "object",
      additionalProperties: false,
      properties: {
        width: { type: "integer", minimum: 64, maximum: 4096 },
        height: { type: "integer", minimum: 64, maximum: 4096 },
        fps: { type: "integer", minimum: 1, maximum: 60 }
      }
    },
    durationMs: { type: "integer", minimum: 100, maximum: 120000 },
    groundY: { type: "number" },
    theme: {
      type: "object",
      additionalProperties: false,
      properties: {
        accentColor: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
        background: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
        style: { enum: ["default", "blueprint"] }
      }
    },
    addons: { enum: ["auto", "none"] },
    anchors: {
      type: "object",
      additionalProperties: { $ref: "#/$defs/partialPoint" }
    },
    targets: {
      type: "object",
      additionalProperties: { $ref: "#/$defs/partialPoint" }
    },
    actor: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string", minLength: 1 },
        label: { type: "string" },
        x: { oneOf: [{ type: "number" }, { type: "string", minLength: 1 }] },
        groundY: { type: "number" },
        color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
        accessory: { enum: ["none", "tie", "hat", "glasses", "badge"] },
        accentColor: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
        scale: { type: "number", minimum: 0.25, maximum: 2.5 },
        zIndex: { type: "number" },
        facing: { enum: [-1, 1, "left", "right"] },
        gaze: { $ref: "#/$defs/gazeTarget" }
      }
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
    actors: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: { $ref: "#/$defs/actorSpec" }
    },
    actions: {
      type: "array",
      items: { $ref: "#/$defs/choreographAction" }
    }
  },
  $defs: {
    point: {
      type: "object",
      additionalProperties: false,
      required: ["x", "y"],
      properties: { x: { type: "number" }, y: { type: "number" } }
    },
    partialPoint: {
      type: "object",
      additionalProperties: false,
      required: ["x"],
      properties: { x: { type: "number" }, y: { type: "number" } }
    },
    targetRef: {
      oneOf: [
        { type: "string", minLength: 1 },
        { $ref: "#/$defs/partialPoint" }
      ]
    },
    gazeTarget: {
      oneOf: [
        { enum: ["forward", "down", "up", "target"] },
        { $ref: "#/$defs/point" }
      ]
    },
    addonConfig: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string", minLength: 1 },
        type: { enum: ADDON_TYPES },
        actorId: { type: "string", minLength: 1 },
        socket: { enum: ["rHand", "lHand", "bothHands", "aboveHead", "eyes", "wrist", "rFoot", "lFoot", "stage"] },
        layer: { enum: ["back", "front"] },
        x: { type: "number" },
        y: { type: "number" },
        dx: { type: "number" },
        dy: { type: "number" },
        width: { type: "number", exclusiveMinimum: 0 },
        height: { type: "number", exclusiveMinimum: 0 },
        rotation: { type: "number" },
        scale: { type: "number", exclusiveMinimum: 0 },
        opacity: { type: "number", minimum: 0, maximum: 1 },
        color: { type: "string" },
        secondaryColor: { type: "string" },
        text: { type: "string" },
        hinge: { enum: ["left", "right"] },
        open: { type: "number", minimum: 0, maximum: 1 },
        ink: { type: "number", minimum: 0, maximum: 1 },
        netBulge: { type: "number", minimum: 0 },
        enter: { enum: ["pop", "fade", "slide", "instant"] },
        enterAt: { type: "number", minimum: 0, maximum: 1 },
        enterDuration: { type: "number", minimum: 0, maximum: 1 },
        slideFrom: { enum: ["left", "right", "top", "bottom"] },
        exit: { enum: ["shrink", "fade", "tip", "persist", "instant"] },
        exitAt: { type: "number", minimum: 0, maximum: 1 },
        exitDuration: { type: "number", minimum: 0, maximum: 1 },
        persist: { type: "boolean" },
        attachWindow: {
          type: "object",
          additionalProperties: false,
          properties: {
            from: { type: "number", minimum: 0, maximum: 1 },
            until: { type: "number", minimum: 0, maximum: 1 },
            pinOnRelease: { type: "boolean" },
            pinnedPoint: { $ref: "#/$defs/point" }
          }
        },
        flight: {
          type: "object",
          additionalProperties: false,
          required: ["from", "to"],
          properties: {
            from: { type: "number", minimum: 0, maximum: 1 },
            to: { type: "number", minimum: 0, maximum: 1 },
            target: {
              oneOf: [
                { type: "string", minLength: 1 },
                { $ref: "#/$defs/point" }
              ]
            },
            apex: { type: "number" },
            spin: { type: "number" },
            releaseOffset: { $ref: "#/$defs/point" },
            dropToGroundAt: { type: "number", minimum: 0, maximum: 1 }
          }
        },
        impact: {
          type: "object",
          additionalProperties: false,
          required: ["at"],
          properties: {
            at: { type: "number", minimum: 0, maximum: 1 },
            duration: { type: "number", minimum: 0, maximum: 1 },
            peakBulge: { type: "number", minimum: 0 }
          }
        },
        keyframes: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["at"],
            properties: {
              at: { type: "number", minimum: 0, maximum: 1 },
              x: { type: "number" },
              y: { type: "number" },
              rotation: { type: "number" },
              scale: { type: "number", minimum: 0 },
              opacity: { type: "number", minimum: 0, maximum: 1 },
              open: { type: "number", minimum: 0, maximum: 1 },
              ink: { type: "number", minimum: 0, maximum: 1 },
              netBulge: { type: "number", minimum: 0 }
            }
          }
        }
      }
    },
    addonItem: {
      oneOf: [
        { enum: ADDON_TYPES },
        { $ref: "#/$defs/addonConfig" }
      ]
    },
    choreographAction: {
      type: "object",
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: { enum: V2_ACTION_IDS },
        startMs: { type: "integer", minimum: 0 },
        durationMs: { type: "integer", minimum: 100 },
        delayMs: { type: "integer", minimum: 0 },
        from: { $ref: "#/$defs/targetRef" },
        to: { $ref: "#/$defs/targetRef" },
        target: { type: "string", minLength: 1 },
        gaze: { $ref: "#/$defs/gazeTarget" },
        speed: { type: "number", minimum: 0.5, maximum: 2 },
        blendMs: { type: "integer", minimum: 0, maximum: 5000 },
        afterCue: { type: "string", minLength: 1 },
        emitCue: { type: "string", minLength: 1 },
        emitCueAt: { type: "string", minLength: 1 },
        addon: {
          oneOf: [
            { type: "boolean" },
            { enum: ["auto", "none"] },
            { $ref: "#/$defs/addonItem" },
            { type: "array", items: { $ref: "#/$defs/addonItem" } }
          ]
        },
        persist: { type: "boolean" }
      }
    },
    actorSpec: {
      type: "object",
      additionalProperties: false,
      required: ["id", "actions"],
      properties: {
        id: { type: "string", minLength: 1 },
        label: { type: "string" },
        x: { oneOf: [{ type: "number" }, { type: "string", minLength: 1 }] },
        groundY: { type: "number" },
        color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
        accessory: { enum: ["none", "tie", "hat", "glasses", "badge"] },
        accentColor: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
        scale: { type: "number", minimum: 0.25, maximum: 2.5 },
        zIndex: { type: "number" },
        facing: { enum: [-1, 1, "left", "right"] },
        gaze: { $ref: "#/$defs/gazeTarget" },
        actions: {
          type: "array",
          items: { $ref: "#/$defs/choreographAction" }
        }
      }
    }
  }
} as const;
