import type { JsonSchemaType } from "@modelcontextprotocol/sdk/validation";

const number = { type: "number", minimum: -2000, maximum: 3000 };
const frame = { type: "integer", minimum: 0 };
const text = { type: "string", minLength: 1, maxLength: 100 };
const id = { type: "string", pattern: "^[a-z][a-z0-9-]{0,63}$" };
const stringArray = { type: "array", maxItems: 20, uniqueItems: true, items: id };
const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", additionalProperties: false, properties, required });
const item = object({
  motion: id, walk: object({ to: number, pace: { type: "number", minimum: 8, maximum: 60 } }, ["to"]),
  root: number, relocate: number, hold: frame, cycles: { type: "integer", minimum: 1, maximum: 20 },
  until: frame, fadeOut: frame, gap: { type: "integer", minimum: 1, maximum: 180 }, beat: id,
  keep: stringArray, laurel: { type: "boolean" }, headwear: { type: "string", enum: ["none", "laurel"] }
});
const performance = { type: "array", minItems: 1, maxItems: 100, items: { ...item, oneOf: [
  { required: ["motion"], not: { anyOf: [{ required: ["walk"] }, { required: ["relocate"] }] } },
  { required: ["walk"], not: { anyOf: [{ required: ["motion"] }, { required: ["relocate"] }] } },
  { required: ["relocate"], not: { anyOf: [{ required: ["motion"] }, { required: ["walk"] }] } }
] } };
export const filmRecipeSchema: JsonSchemaType & { type: "object" } = {
  ...object({
    id, title: text, summary: text, poster: frame, bridge: { type: "string", enum: ["auto", "off"] },
    set: { type: "array", maxItems: 20, items: object({ motion: id, root: number, types: stringArray, hideDuring: stringArray }, ["motion", "root", "types"]) },
    performance,
    scenes: { type: "array", minItems: 1, maxItems: 24, items: object({
      id, title: text, state: text, place: { type: "string", enum: ["office", "city", "senate", "gaul", "rubicon"] },
      cues: { type: "array", minItems: 1, maxItems: 24, items: object({ frame, text }, ["frame", "text"]) },
      overlays: { type: "array", maxItems: 50, items: object({
        type: { type: "string", enum: ["text", "bubble", "scroll", "card", "tick", "package-box", "rect-plate", "label"] },
        x: number, y: number, from: frame, to: frame, fade: frame, text, second: text,
        width: { type: "number", minimum: 1, maximum: 1280 }, height: { type: "number", minimum: 1, maximum: 720 },
        size: { type: "number", minimum: 8, maximum: 100 }, scale: { type: "number", minimum: 0.1, maximum: 4 },
        tween: object({ x: number, y: number, scale: { type: "number", minimum: 0.1, maximum: 4 } })
      }, ["type", "x", "y", "from", "to"]) }
    }, ["id", "title", "place", "cues"]) },
    extras: { type: "array", maxItems: 50, items: {
      ...object({ motion: id, actor: performance, root: number,
        scale: { type: "number", minimum: 0.1, maximum: 2.4 }, lift: { type: "number", minimum: -720, maximum: 720 },
        kit: { type: "string", enum: ["legionary", "standard", "dagger"] }, mirror: { type: "boolean" },
        from: id, until: id, delay: frame
      }, ["from", "until"]),
      oneOf: [{ required: ["motion", "root"], not: { required: ["actor"] } }, { required: ["actor"], not: { anyOf: [{ required: ["motion"] }, { required: ["root"] }] } }]
    } }
  }, ["id", "title", "performance", "scenes"]),
  type: "object"
} as JsonSchemaType & { type: "object" };
