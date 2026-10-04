import { describe, expect, it } from "vitest";
import { frameGeometry } from "../src/render.js";
import type { SampledFrame } from "../src/contract.js";

const seg = (id: string, x1: number, y1: number, x2: number, y2: number) => ({ id, x1, y1, x2, y2 });

// Facing right; both knees and elbows bent forward (+x) of their root→end line.
function bentFrame(articulated: boolean): SampledFrame {
  return {
    timeMs: 0, action: "walk", x: 0, groundY: 120, head: { x: 2, y: -20 }, prop: null, facing: 1,
    ...(articulated ? { articulated: true } : {}),
    segments: [
      seg("torso", 0, 60, 2, 30),
      seg("left-thigh", 0, 60, 14, 88), seg("left-shin", 14, 88, 0, 118),
      seg("right-thigh", 0, 60, 14, 88), seg("right-shin", 14, 88, 0, 118),
      seg("left-upper-arm", 2, 32, 14, 50), seg("left-forearm", 14, 50, 2, 68),
      seg("right-upper-arm", 2, 32, 14, 50), seg("right-forearm", 14, 50, 2, 68)
    ]
  } as SampledFrame;
}

function controlX(d: string): number {
  const m = /Q(-?[\d.]+) /.exec(d);
  if (!m) throw new Error(`limb is not curved: ${d}`);
  return Number(m[1]);
}

describe("limb curves bow toward the real joint", () => {
  for (const articulated of [false, true]) {
    it(`${articulated ? "articulated" : "pivot curve"} knees and elbows bulge forward`, () => {
      const g = frameGeometry(bentFrame(articulated));
      for (const limb of g.limbs) expect(controlX(limb.d), limb.id).toBeGreaterThan(1);
    });
  }
});
