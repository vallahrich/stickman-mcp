import { describe, expect, it } from "vitest";
import {
  createMotionIntentState, advanceMotionIntent,
  type MotionIntent, type MotionIntentSample, type MotionIntentState, type WorldMotionScene
} from "../src/world-motion.js";
import { createIsometricRoom } from "../src/room.js";

const scene: WorldMotionScene = {
  canvas: { width: 1280, height: 720, fps: 60 }, width: 400, depth: 400,
  initial: { x: 180, z: 180 }, pointTarget: { x: 300, z: 260, height: 100 },
  projectWorld: (p, height = 0) => ({ x: 640 + p.x - p.z, y: 260 + (p.x + p.z) * 0.5 - height })
};
const idle: MotionIntent = { horizontal: 0, depth: 0, run: false, jumpRequest: 0, pointRequest: 0, stop: false };
function advance(state: MotionIntentState, intent: MotionIntent, duration: number, interval = 10): MotionIntentSample {
  let result = advanceMotionIntent(state, intent, state.timeMs);
  const end = state.timeMs + duration;
  while (result.state.timeMs < end) result = advanceMotionIntent(result.state, intent, Math.min(end, result.state.timeMs + interval));
  return result;
}

describe("orthographic world planner through canonical FK/IK", () => {
  it("projects genuine world root and level screen stance without changing authored spec", () => {
    const state = createMotionIntentState(scene);
    const spec = structuredClone(state.program.spec);
    const sample = advanceMotionIntent(state, idle, 0);
    expect(sample.worldRoot).toEqual(scene.initial);
    expect(sample.frame.x).toBe(640);
    expect(sample.frame.groundY).toBe(440);
    expect(sample.contacts.left.contact).toBe(true);
    expect(sample.contacts.right.contact).toBe(true);
    expect(scene.projectWorld(sample.contacts.left.world).y).toBeCloseTo(440, 8);
    expect(state.program.spec).toEqual(spec);
  });

  describe("rolling planner checkpoint on the legacy flat canonical floor", () => {
    const flat: WorldMotionScene = {
      canvas: { width: 640, height: 360 }, width: 640, depth: 0,
      initial: { x: 140, z: 0 }, pointTarget: { x: 500, z: 0, height: 190 },
      projectWorld: (p, h = 0) => ({ x: p.x, y: 290 - h }),
      canOccupy: p => p.x >= 80 && p.x <= 560
    };
    it("fast-forwards 60 seconds of settled idle without moving the pose or world anchors", () => {
      const initial = createMotionIntentState(flat);
      const before = advanceMotionIntent(initial, idle, 0);
      const after = advanceMotionIntent(before.state, idle, 60_000);
      expect(after.state.timeMs).toBe(60_000);
      expect(after.status).toBe("idle");
      expect(after.worldRoot).toEqual(before.worldRoot);
      expect(after.contacts).toEqual(before.contacts);
      expect({ ...after.frame, timeMs: before.frame.timeMs }).toEqual(before.frame);
      const pressed = advanceMotionIntent(after.state, { ...idle, horizontal: 1 }, 60_000);
      const moved = advance(pressed.state, { ...idle, horizontal: 1 }, 100);
      expect(moved.worldRoot.x).toBeGreaterThan(before.worldRoot.x);
    });
    it("preserves the original fixed tick grid when idle resumes between tick boundaries", () => {
      const idleLater = advanceMotionIntent(createMotionIntentState(flat), idle, 60_003);
      const pressed = advanceMotionIntent(idleLater.state, { ...idle, horizontal: 1 }, 60_003);
      const beforeTick = advanceMotionIntent(pressed.state, { ...idle, horizontal: 1 }, 60_004);
      expect(beforeTick.worldRoot.x).toBe(140);
      const onTick = advanceMotionIntent(beforeTick.state, { ...idle, horizontal: 1 }, 60_005);
      expect(onTick.worldRoot.x).toBeGreaterThan(140);
    });
    it("preserves the same settled pose across RAF partitions before and after a minute-long pause", () => {
      const replay = (interval: number) => {
        let sample = advance(createMotionIntentState(flat), { ...idle, horizontal: 1 }, 200, interval);
        sample = advance(sample.state, idle, 600, interval);
        const beforePause = sample;
        sample = advanceMotionIntent(sample.state, idle, sample.state.timeMs + 60_000);
        expect(sample.contacts).toEqual(beforePause.contacts);
        expect(sample.worldRoot).toEqual(beforePause.worldRoot);
        expect({ ...sample.frame, timeMs: beforePause.frame.timeMs }).toEqual(beforePause.frame);
        return sample;
      };
      const a = replay(10), b = replay(17), c = replay(83);
      expect(a.frame).toEqual(b.frame);
      expect(a.frame).toEqual(c.frame);
      expect(a.contacts).toEqual(c.contacts);
    });
    it.each(["moving", "airborne", "pointing", "new-held-input"] as const)("keeps the explicit active-gap rejection for %s", activity => {
      let state = createMotionIntentState(flat);
      let active: MotionIntent = { ...idle, horizontal: 1 };
      if (activity === "airborne") active = { ...idle, jumpRequest: 1 };
      if (activity === "pointing") active = { ...idle, pointRequest: 1 };
      if (activity !== "new-held-input") state = advanceMotionIntent(state, active, 100).state;
      expect(() => advanceMotionIntent(state, active, 60_000)).toThrow(/gap/i);
      if (activity !== "new-held-input") {
        expect(() => advanceMotionIntent(state, { ...active, horizontal: 0, stop: true }, 60_000)).toThrow(/gap/i);
      }
    });
    it("replays timestamped reversal identically across RAF partitions on a fixed epoch", () => {
      const replay = (interval: number) => {
        let sample = advance(createMotionIntentState(flat, 13), { ...idle, horizontal: 1 }, 137, interval);
        sample = advanceMotionIntent(sample.state, { ...idle, horizontal: -1 }, 150);
        return advance(sample.state, { ...idle, horizontal: -1 }, 413, interval);
      };
      const a = replay(10), b = replay(17), c = replay(83);
      expect(a.worldRoot).toEqual(b.worldRoot);
      expect(a.worldRoot).toEqual(c.worldRoot);
      expect(a.frame).toEqual(b.frame);
      expect(a.frame).toEqual(c.frame);
      expect(a.contacts).toEqual(c.contacts);
    });

    describe("parent room API reference scene", () => {
      const room = createIsometricRoom({
        width: 1000, depth: 600, canvas: { width: 2304, height: 1296 }, unitScale: 1, padding: 100,
        objects: [{ id: "crate", x: 400, z: 240, width: 180, depth: 100, height: 90 }]
      });
      const reference: WorldMotionScene = {
        width: room.width, depth: room.depth, canvas: { ...room.canvas },
        initial: { x: 200, z: 400 }, pointTarget: { x: 650, z: 200, height: 100 },
        projectWorld: (point, height = 0) => room.project(point, height),
        canOccupy: (point, radius) => room.canOccupy(point, radius),
        actorRadius: 12
      };
      it("accepts exact parent projection/collision math and derives the initial canonical pose", () => {
        const initial = createMotionIntentState(reference);
        const sample = advanceMotionIntent(initial, idle, 0);
        const mapped = room.project(reference.initial);
        expect(sample.worldRoot).toEqual(reference.initial);
        expect(sample.frame.x).toBeCloseTo(mapped.x, 8);
        expect(sample.frame.groundY).toBeCloseTo(mapped.y, 8);
        expect(room.contains(sample.contacts.left.world)).toBe(true);
        expect(room.contains(sample.contacts.right.world)).toBe(true);
        expect(room.canOccupy(sample.worldRoot, 12)).toBe(true);
      });
      it("samples a bounded level-depth diagonal preview with the same room callbacks", () => {
        const sample = advance(createMotionIntentState(reference), { ...idle, horizontal: 1, depth: -1 }, 500);
        expect(sample.worldRoot.x).toBeGreaterThan(200);
        expect(sample.worldRoot.z).toBeLessThan(400);
        expect(sample.frame.x).toBeCloseTo(room.project(sample.worldRoot).x, 8);
        expect(room.canOccupy(sample.worldRoot, 12)).toBe(true);
      });
      it("samples in-place jump/landing and pointing through the canonical rig in the reference room", () => {
        let sample = advance(createMotionIntentState(reference), { ...idle, jumpRequest: 1 }, 200);
        expect(sample.status).toBe("jumping");
        expect(sample.worldHeight).toBeGreaterThan(0);
        expect(sample.worldRoot).toEqual(reference.initial);
        sample = advance(sample.state, { ...idle, jumpRequest: 1, stop: true }, 700);
        expect(sample.worldHeight).toBe(0);
        expect(sample.status).toBe("idle");
        sample = advance(sample.state, { ...idle, jumpRequest: 1, pointRequest: 1 }, 100);
        expect(sample.status).toBe("pointing");
        expect(sample.worldRoot).toEqual(reference.initial);
      });
    });
    it("does not tunnel through a thin wall during a 1-second rendering gap", () => {
      const wall: WorldMotionScene = {
        ...flat,
        canOccupy: (p, radius) => p.x >= 80 && p.x <= 560 && !(p.x + radius > 215 && p.x - radius < 215.2)
      };
      const sample = advanceMotionIntent(createMotionIntentState(wall), { ...idle, horizontal: 1, run: true }, 1000);
      expect(sample.status).toBe("blocked");
      expect(sample.worldRoot.x).toBeLessThanOrEqual(201);
      expect(sample.contacts.left.world.x).toBeLessThan(215);
      expect(sample.contacts.right.world.x).toBeLessThan(215);
    });
    it("retains the authored baseline without mutation throughout input sampling", () => {
      const initial = createMotionIntentState(flat);
      const document = structuredClone(initial.program);
      let sample = advance(initial, { ...idle, horizontal: 1 }, 100);
      sample = advance(sample.state, { ...idle, jumpRequest: 1 }, 100);
      advance(sample.state, { ...idle, jumpRequest: 1, stop: true }, 700);
      expect(initial.program).toEqual(document);
    });
  });

  it.each([
    { horizontal: 1, depth: 0 }, { horizontal: -1, depth: 0 },
    { horizontal: 0, depth: 1 }, { horizontal: 0, depth: -1 },
    { horizontal: 1, depth: 1 }, { horizontal: -1, depth: -1 }
  ] as const)("walks X/Z direction %j with per-foot projected floors", axes => {
    const state = createMotionIntentState(scene);
    const sample = advance(state, { ...idle, ...axes }, 500);
    expect(sample.status).toBe("moving");
    if (axes.horizontal) expect(Math.sign(sample.worldRoot.x - scene.initial.x)).toBe(axes.horizontal);
    if (axes.depth) expect(Math.sign(sample.worldRoot.z - scene.initial.z)).toBe(axes.depth);
    expect(sample.frame.x).toBeCloseTo(scene.projectWorld(sample.worldRoot).x, 8);
    expect(sample.frame.groundY).toBeCloseTo(scene.projectWorld(sample.worldRoot).y, 8);
  });

  it("normalizes diagonal speed in world space", () => {
    const axis = advance(createMotionIntentState(scene), { ...idle, horizontal: 1 }, 500);
    const diagonal = advance(createMotionIntentState(scene), { ...idle, horizontal: 1, depth: 1 }, 500);
    const distance = (sample: MotionIntentSample) => Math.hypot(sample.worldRoot.x - scene.initial.x, sample.worldRoot.z - scene.initial.z);
    expect(distance(diagonal)).toBeCloseTo(distance(axis), 7);
  });

  it("keeps world contact anchors fixed and rendered ankles on their own floors", () => {
    let sample = advanceMotionIntent(createMotionIntentState(scene), { ...idle, horizontal: 1, depth: -1 }, 0);
    const lengths = new Map<string, number>();
    let plantedPairs = 0;
    for (let time = 10; time <= 700; time += 10) {
      const previous = sample;
      sample = advanceMotionIntent(sample.state, { ...idle, horizontal: 1, depth: -1 }, time);
      for (const side of ["left", "right"] as const) {
        const contact = sample.contacts[side];
        const old = previous.contacts[side];
        if (old.contact && contact.contact) {
          expect(contact.world).toEqual(old.world);
          plantedPairs++;
        }
        const ankle = sample.frame.segments.find(s => s.id === `${side}-shin`)!;
        const floor = scene.projectWorld(contact.world);
        if (contact.contact) {
          expect(ankle.x2).toBeCloseTo(floor.x, 7);
          expect(ankle.y2).toBeCloseTo(floor.y, 7);
        } else expect(ankle.y2).toBeLessThanOrEqual(floor.y + 1e-6);
      }
      for (const segment of sample.frame.segments) {
        const size = Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1);
        if (!lengths.has(segment.id)) lengths.set(segment.id, size);
        expect(size).toBeCloseTo(lengths.get(segment.id)!, 6);
      }
    }
    expect(plantedPairs).toBeGreaterThan(30);
  });

  it("retains fixed tick epochs across RAF partitions, including a timestamped reversal", () => {
    const execute = (interval: number) => {
      let sample = advance(createMotionIntentState(scene, 13), { ...idle, horizontal: 1 }, 137, interval);
      sample = advanceMotionIntent(sample.state, { ...idle, depth: -1 }, 150);
      return advance(sample.state, { ...idle, depth: -1 }, 413, interval);
    };
    const a = execute(10), b = execute(17), c = execute(83);
    expect(a.worldRoot).toEqual(b.worldRoot);
    expect(a.worldRoot).toEqual(c.worldRoot);
    expect(a.frame).toEqual(b.frame);
    expect(a.frame).toEqual(c.frame);
    expect(a.contacts).toEqual(c.contacts);
  });

  it("checks root path against obstacles rather than teleporting across them after a long frame", () => {
    const blockedScene: WorldMotionScene = {
      ...scene,
      canOccupy: (point, radius) => !(point.x + radius > 215 && point.x - radius < 219)
    };
    const sample = advanceMotionIntent(createMotionIntentState(blockedScene), { ...idle, horizontal: 1, run: true }, 1000);
    expect(sample.worldRoot.x).toBeLessThanOrEqual(201);
    expect(sample.status).toBe("blocked");
    for (const contact of Object.values(sample.contacts)) expect(contact.world.x).toBeLessThan(215);
  });

  it("stops within 250ms, keeps world feet planted and resumes reverse without root reset", () => {
    let sample = advance(createMotionIntentState(scene), { ...idle, horizontal: 1, depth: 1 }, 250);
    sample = advance(sample.state, { ...idle, stop: true }, 250);
    const root = sample.worldRoot;
    expect(sample.status).toBe("idle");
    const stable = advance(sample.state, { ...idle, stop: true }, 200);
    expect(stable.worldRoot).toEqual(root);
    const reverse = advance(stable.state, { ...idle, horizontal: -1, depth: -1 }, 200);
    expect(reverse.worldRoot.x).toBeLessThan(root.x);
    expect(reverse.worldRoot.z).toBeLessThan(root.z);
  });

  it("jumps from support with immediate loading, no air steering, and safe Escape landing", () => {
    let sample = advance(createMotionIntentState(scene), { ...idle, horizontal: 1 }, 100);
    sample = advance(sample.state, { ...idle, jumpRequest: 1 }, 50);
    expect(sample.status).toBe("jumping");
    sample = advance(sample.state, { ...idle, jumpRequest: 1 }, 250);
    const airborneRoot = sample.worldRoot;
    sample = advance(sample.state, { ...idle, horizontal: -1, depth: 1, jumpRequest: 1 }, 50);
    expect(sample.worldRoot).toEqual(airborneRoot);
    sample = advance(sample.state, { ...idle, jumpRequest: 1, stop: true }, 700);
    expect(sample.status).toBe("idle");
    expect(sample.contacts.left.contact && sample.contacts.right.contact).toBe(true);
  });

  it("rejects malformed/blocked initial roots, singular projection, nonmonotonic time/IDs and huge gaps", () => {
    expect(() => createMotionIntentState({ ...scene, initial: { x: 1, z: 1 } })).toThrow(/Initial world/);
    expect(() => createMotionIntentState({ ...scene, canOccupy: () => false })).toThrow(/Initial world/);
    expect(() => createMotionIntentState({ ...scene, projectWorld: (p, h = 0) => ({ x: p.x, y: 440 - h }) })).toThrow(/axes|margin/);
    const state = createMotionIntentState(scene, 10);
    expect(() => advanceMotionIntent(state, idle, 9)).toThrow(/monotonic/);
    const moving = advanceMotionIntent(state, { ...idle, horizontal: 1 }, 10);
    expect(() => advanceMotionIntent(moving.state, { ...idle, horizontal: 1 }, 6000)).toThrow(/gap/);
    const jumped = advanceMotionIntent(state, { ...idle, jumpRequest: 1 }, 10);
    expect(() => advanceMotionIntent(jumped.state, idle, 10)).toThrow(/IDs/);
  });
});
