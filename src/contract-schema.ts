import { actionCatalog } from "./catalog.js";
import { CONTRACT_VERSION, CONTRACT_VERSION_MOVIE, CONTRACT_VERSION_V2 } from "./contract.js";
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
        depth: { type: "number", minimum: 0, maximum: 1 },
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
    stageProps: {
      type: "array",
      items: { $ref: "#/$defs/stageProp" }
    },
    customMotions: {
      type: "object",
      additionalProperties: { $ref: "#/$defs/customMotion" }
    },
    camera: {
      oneOf: [
        { const: "auto-director" },
        { type: "array", items: { $ref: "#/$defs/cameraKeyframe" } }
      ]
    },
    spotlight: {
      oneOf: [
        { type: "boolean" },
        { const: "auto" }
      ]
    },
    callouts: {
      type: "array",
      items: { $ref: "#/$defs/calloutSpec" }
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
    stageProp: {
      type: "object",
      additionalProperties: false,
      required: ["id", "type"],
      properties: {
        id: { type: "string", minLength: 1 },
        type: { enum: ADDON_TYPES },
        x: { type: "number" },
        y: { type: "number" },
        anchor: { type: "string", minLength: 1 },
        width: { type: "number", exclusiveMinimum: 0 },
        height: { type: "number", exclusiveMinimum: 0 },
        facing: { enum: ["left", "right"] },
        color: { type: "string", minLength: 1 },
        text: { type: "string" },
        layer: { enum: ["back", "front"] },
        scale: { type: "number", exclusiveMinimum: 0, maximum: 5 }
      }
    },
    handoffSpec: {
      type: "object",
      additionalProperties: false,
      required: ["actorId"],
      properties: {
        actorId: { type: "string", minLength: 1 },
        propType: { enum: ADDON_TYPES },
        propId: { type: "string", minLength: 1 },
        atProgress: { type: "number", minimum: 0, maximum: 1 }
      }
    },
    customMotion: {
      type: "object",
      additionalProperties: true,
      required: ["frames"],
      properties: {
        id: { type: "string", minLength: 1 },
        name: { type: "string", minLength: 1 },
        label: { type: "string" },
        frames: {
          oneOf: [
            { type: "integer", minimum: 2, maximum: 1800 },
            { type: "array", minItems: 2 }
          ]
        },
        fps: { type: "number", exclusiveMinimum: 0, maximum: 120 },
        loop: { type: "boolean" },
        kind: { enum: ["oneshot", "loop", "hold"] },
        travel: { enum: ["in-place", "travel"] },
        facingChange: { enum: [0, 90, 180] },
        prop: { oneOf: [{ type: "string" }, { type: "null" }] },
        aim: { oneOf: [{ enum: ["hand", "head"] }, { type: "null" }] },
        markers: { type: "object", additionalProperties: { type: "number" } },
        strideLength: { type: "number" },
        poseKeys: { type: "array", minItems: 1 }
      }
    },
    cameraKeyframe: {
      type: "object",
      additionalProperties: false,
      properties: {
        timeMs: { type: "number", minimum: 0 },
        atCue: { type: "string", minLength: 1 },
        x: { type: "number" },
        y: { type: "number" },
        zoom: { type: "number", minimum: 0.5, maximum: 3 },
        followActor: { type: "string", minLength: 1 },
        framing: { enum: ["center", "thirds-left", "thirds-right"] },
        holdMs: { type: "number", minimum: 0 },
        ease: { enum: ["inOut", "linear", "cut"] }
      }
    },
    calloutSpec: {
      type: "object",
      additionalProperties: false,
      required: ["text"],
      properties: {
        id: { type: "string", minLength: 1 },
        kind: { enum: ["speech", "thought", "status", "caption"] },
        text: { type: "string", minLength: 1 },
        actorId: { type: "string", minLength: 1 },
        startMs: { type: "number", minimum: 0 },
        durationMs: { type: "number", exclusiveMinimum: 0 },
        atCue: { type: "string", minLength: 1 },
        tone: { enum: ["neutral", "accent", "success", "warning", "danger"] },
        icon: { enum: ["alert", "check", "info", "spark", "metric"] }
      }
    },
    choreographAction: {
      type: "object",
      additionalProperties: false,
      required: ["action"],
      properties: {
        action: {
          anyOf: [
            { enum: V2_ACTION_IDS },
            { type: "string", minLength: 1 }
          ]
        },
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
        persist: { type: "boolean" },
        handoffTo: { $ref: "#/$defs/handoffSpec" },
        toGround: { type: "boolean" },
        say: { type: "string", minLength: 1 },
        think: { type: "string", minLength: 1 },
        badge: { type: "string", minLength: 1 }
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
        depth: { type: "number", minimum: 0, maximum: 1 },
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

export const BACKDROP_PRESETS = Object.freeze([
  "none",
  "office",
  "datacenter",
  "war-room",
  "classroom",
  "court",
  "outdoor"
] as const);

export const SCENE_TRANSITION_KINDS = Object.freeze([
  "cut",
  "fade",
  "wipe"
] as const);

export const movieSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://stickman-mcp.dev/schemas/movie-v1.json",
  title: "Stickman multi-scene movie",
  type: "object",
  additionalProperties: false,
  required: ["scenes"],
  properties: {
    version: { const: CONTRACT_VERSION_MOVIE },
    title: { type: "string", minLength: 1 },
    canvas: {
      type: "object",
      additionalProperties: false,
      properties: {
        width: { type: "integer", minimum: 64, maximum: 4096 },
        height: { type: "integer", minimum: 64, maximum: 4096 },
        fps: { type: "integer", minimum: 1, maximum: 60 }
      }
    },
    theme: animationSchemaV2.properties.theme,
    trimIdleTails: { type: "boolean" },
    scenes: {
      type: "array",
      minItems: 1,
      maxItems: 16,
      items: { $ref: "#/$defs/movieScene" }
    }
  },
  $defs: {
    ...animationSchemaV2.$defs,
    sceneTransition: {
      oneOf: [
        { enum: SCENE_TRANSITION_KINDS },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind"],
          properties: {
            kind: { enum: SCENE_TRANSITION_KINDS },
            durationMs: { type: "integer", minimum: 0, maximum: 5000 }
          }
        }
      ]
    },
    movieScene: {
      type: "object",
      additionalProperties: false,
      required: ["id"],
      anyOf: [
        { required: ["actors"] },
        { required: ["actions"] }
      ],
      properties: {
        id: { type: "string", minLength: 1 },
        title: { type: "string" },
        caption: { type: "string" },
        backdrop: { enum: BACKDROP_PRESETS },
        transition: { $ref: "#/$defs/sceneTransition" },
        trimIdleTails: { type: "boolean" },
        maxIdleTailMs: { type: "integer", minimum: 0, maximum: 30000 },
        durationMs: animationSchemaV2.properties.durationMs,
        groundY: animationSchemaV2.properties.groundY,
        theme: animationSchemaV2.properties.theme,
        addons: animationSchemaV2.properties.addons,
        anchors: animationSchemaV2.properties.anchors,
        targets: animationSchemaV2.properties.targets,
        actor: animationSchemaV2.properties.actor,
        stageProps: animationSchemaV2.properties.stageProps,
        customMotions: animationSchemaV2.properties.customMotions,
        camera: animationSchemaV2.properties.camera,
        spotlight: animationSchemaV2.properties.spotlight,
        callouts: animationSchemaV2.properties.callouts,
        actors: animationSchemaV2.properties.actors,
        actions: animationSchemaV2.properties.actions
      }
    }
  }
} as const;

