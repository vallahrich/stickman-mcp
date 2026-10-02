import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { compileAnimation, sampleAnimation } from "../src/compiler.js";

const scene = {
  version: "stickman.animation/v1",
  canvas: { width: 640, height: 360, fps: 30 },
  durationMs: 3400,
  actor: { x: 105, groundY: 290 },
  prop: { id: "crate", x: 150, y: 240, width: 50, height: 50, toX: 240, handle: { x: 0, y: 18 } },
  actions: [{ action: "push", startMs: 100, durationMs: 3000, target: "crate" }]
};
function compile(input = scene) {
  const result = compileAnimation(input);
  if (!result.program) throw new Error(JSON.stringify(result.diagnostics));
  return result.program;
}

it("memoizes invariant posture search without adding fields or mutating compiled input", () => {
  const program = compile();
  const keys = Reflect.ownKeys(program);
  const original = structuredClone(program);
  Object.freeze(program);
  for (const time of [1000, 2000, 1000, 700, 3000, 2000]) {
    expect(sampleAnimation(program, time)).toEqual(sampleAnimation(compile(), time));
  }
  expect(Reflect.ownKeys(program)).toEqual(keys);
  expect(program).toEqual(original);
});

it("includes changed route geometry in the posture cache key", () => {
  const program = compile();
  sampleAnimation(program, 1000);
  program.spec.prop!.toX = 270;
  const changed = compile({ ...scene, prop: { ...scene.prop, toX: 270 } });
  for (const time of [700, 1000, 2000, 3100]) {
    expect(sampleAnimation(program, time)).toEqual(sampleAnimation(changed, time));
  }
});

it("keeps cached push sampling self-contained when serialized for an offline player", () => {
  const program = compile();
  const embedded: unknown = runInNewContext(`(${sampleAnimation.toString()})`);
  if (typeof embedded !== "function") throw new Error("Expected an executable serialized sampler.");
  for (const time of [1000, 2000, 1000, 700, 3000]) {
    expect(embedded(program, time)).toEqual(sampleAnimation(program, time));
  }
});
