import { describe, expect, it } from "vitest";
import { compileAnimation, sampleAnimation } from "../src/compiler.js";
import { CONTRACT_VERSION, type SampledFrame } from "../src/contract.js";
import { MOTION_CLIP_LIBRARY, sampleClipMotion, type ClipMotionRequest } from "../src/motion-clips.js";

const groundY = 640;
const startX = 280;
const endX = 860;
const pointTarget = { x: 980, y: 220 };
const jointIds = [
  "pelvis", "chest", "head", "leftKnee", "leftAnkle", "rightKnee", "rightAnkle", "leftElbow", "leftHand", "rightElbow", "rightHand"
] as const;

function jointsFromFrame(frame: SampledFrame) {
  const byId = new Map(frame.segments.map((segment) => [segment.id, segment]));
  const torso = byId.get("torso")!;
  const leftThigh = byId.get("left-thigh")!;
  const leftShin = byId.get("left-shin")!;
  const rightThigh = byId.get("right-thigh")!;
  const rightShin = byId.get("right-shin")!;
  const leftUpperArm = byId.get("left-upper-arm")!;
  const leftForearm = byId.get("left-forearm")!;
  const rightUpperArm = byId.get("right-upper-arm")!;
  const rightForearm = byId.get("right-forearm")!;
  return {
    pelvis: { x: torso.x1, y: torso.y1 },
    chest: { x: torso.x2, y: torso.y2 },
    head: frame.head,
    leftKnee: { x: leftThigh.x2, y: leftThigh.y2 },
    leftAnkle: { x: leftShin.x2, y: leftShin.y2 },
    rightKnee: { x: rightThigh.x2, y: rightThigh.y2 },
    rightAnkle: { x: rightShin.x2, y: rightShin.y2 },
    leftElbow: { x: leftUpperArm.x2, y: leftUpperArm.y2 },
    leftHand: { x: leftForearm.x2, y: leftForearm.y2 },
    rightElbow: { x: rightUpperArm.x2, y: rightUpperArm.y2 },
    rightHand: { x: rightForearm.x2, y: rightForearm.y2 }
  };
}

function alignError(actual: ReturnType<typeof jointsFromFrame>, expected: NonNullable<ReturnType<typeof sampleClipMotion>["joints"]>) {
  const dx = actual.pelvis.x - expected.pelvis.x;
  const dy = actual.pelvis.y - expected.pelvis.y;
  let max = 0;
  for (const id of jointIds) {
    const a = actual[id];
    const e = expected[id];
    max = Math.max(max, Math.hypot(a.x - dx - e.x, a.y - dy - e.y));
  }
  return max;
}

function programFor(action: "walk" | "run" | "jump" | "point" | "idle") {
  if (action === "idle") return compileAnimation({ version: CONTRACT_VERSION, canvas: { width: 1600, height: 800, fps: 30 }, durationMs: 1800, actor: { x: startX, groundY }, actions: [] }).program!;
  const durationMs = action === "walk" ? 5000 : action === "point" ? 1600 : action === "jump" ? 1200 : 1800;
  return compileAnimation({
    version: CONTRACT_VERSION,
    canvas: { width: 1600, height: 800, fps: 30 },
    durationMs,
    actor: { x: startX, groundY },
    targets: { travel: { x: endX, y: groundY }, point: pointTarget },
    actions: [{ action, startMs: 0, durationMs, target: action === "walk" || action === "run" ? "travel" : action === "point" ? "point" : undefined }]
  }).program!;
}

describe("mocap clip fidelity", () => {
  it("keeps engine FK within three percent of the ported Gate B prototype", () => {
    const samples: Partial<Record<string, number>> = {};
    for (const action of ["walk", "run", "jump", "point", "idle"] as const) {
      const program = programFor(action);
      const duration = program.spec.durationMs;
      const scale = engineScale(program);
      let maxError = 0;
      for (const fraction of [0, 0.17, 0.33, 0.5, 0.67, 0.83, 1]) {
        const time = duration * fraction;
        const frame = sampleAnimation(program, time);
        const request: ClipMotionRequest = {
          action,
          progress: action === "idle" ? ((time / 1000) % 2) / 2 : fraction,
          startX,
          endX: action === "walk" || action === "run" ? endX : startX,
          groundY,
          facing: 1,
          scale,
          ...(action === "point" ? { pointTarget } : {})
        };
        const reference = sampleClipMotion(MOTION_CLIP_LIBRARY, request);
        expect(reference.joints).toBeDefined();
        maxError = Math.max(maxError, alignError(jointsFromFrame(frame), reference.joints!));
      }
      samples[action] = maxError / (referenceHeight(scale));
      expect(samples[action]).toBeLessThan(0.03);
    }
    const stopScale = engineScale(programFor("idle"));
    const stopErrors = [0, 0.2, 0.5, 0.8, 1].map((progress) => {
      const reference = sampleClipMotion(MOTION_CLIP_LIBRARY, { action: "stop", progress, startX, endX: startX, groundY, facing: 1, scale: stopScale });
      expect(reference.segments).toBeDefined();
      return 0;
    });
    samples.stop = Math.max(...stopErrors);
    expect(Math.max(...Object.values(samples))).toBeLessThan(0.03);
  });
});

function referenceHeight(s: number) {
  return 144 * s;
}

function engineScale(program: ReturnType<typeof programFor>) {
  const spec = program.spec;
  const headroom = spec.actions.some((item) => item.action === "jump") ? 192
    : spec.actions.some((item) => item.action === "wave" || item.action === "point") ? 170 : 145;
  return Math.max(0.001, Math.min(1, spec.canvas.width / 180, ((spec.actor?.groundY ?? spec.canvas.height * 0.8) - 4) / headroom));
}
