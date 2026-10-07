import { describe, expect, it } from "vitest";
import { compileAnimation, sampleAnimation } from "../src/compiler.js";
import { composeStory, getStory, storyCatalog, storyState } from "../src/stories.js";

describe("combined story scenes", () => {
  it("composes cumulative actions and cues without mutating the input", () => {
    const input = {
      id: "hello", title: "Hello", summary: "A greeting",
      canvas: { width: 640, height: 360, fps: 30 },
      steps: [
        { action: "idle", durationMs: 1000 },
        { action: "wave", durationMs: 2000, cue: { id: "greet", title: "Welcome", text: "Hello", offsetMs: 200 } }
      ]
    };
    const original = structuredClone(input);
    const story = composeStory(input);
    expect(input).toEqual(original);
    expect(story.animation.actions.map(action => action.startMs)).toEqual([0, 1000]);
    expect(story.animation.durationMs).toBe(3000);
    expect(story.cues[0].timeMs).toBe(1200);
    story.animation.canvas.width = 500;
    expect(input.canvas.width).toBe(640);
    expect(() => composeStory({ ...input, steps: [] })).toThrow("at least one");
    expect(() => composeStory({ ...input, steps: [{ action: "fly", durationMs: 1000 }] })).toThrow("not feasible");
    expect(() => composeStory({ ...input, steps: [{ action: "wave", durationMs: -1 }] })).toThrow("not feasible");
    expect(() => composeStory({ ...input, steps: [{ ...input.steps[1], cue: { ...input.steps[1].cue!, offsetMs: 2000 } }] })).toThrow("inside");
    expect(() => composeStory({ ...input, steps: [input.steps[1], input.steps[1]] })).toThrow("unique");
  });

  it("keeps one deterministic actor and persistent prop through every recipe", () => {
    expect(storyCatalog()).toHaveLength(3);
    for (const { id } of storyCatalog()) {
      const story = getStory(id);
      const result = compileAnimation(story.animation);
      expect(result.valid, JSON.stringify(result.diagnostics)).toBe(true);
      const program = result.program!;
      const initial = sampleAnimation(program, 0);
      const lengths = new Map(initial.segments.map(segment => [segment.id, Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1)]));
      const actions = story.animation.actions;
      expect(new Set(actions.map(action => action.action)).size).toBeGreaterThanOrEqual(3);
      expect(story.cues).toHaveLength(actions.length);
      for (const action of actions.slice(1)) {
        const before = sampleAnimation(program, action.startMs - .001);
        const after = sampleAnimation(program, action.startMs);
        expect(Math.abs(before.x - after.x)).toBeLessThan(.1);
        for (let index = 0; index < after.segments.length; index++) {
          const current = after.segments[index], prior = before.segments[index];
          expect(Math.hypot(current.x2 - prior.x2, current.y2 - prior.y2)).toBeLessThan(.1);
        }
        if (before.prop && after.prop) expect(before.prop.x).toBeCloseTo(after.prop.x, 2);
      }
      for (let time = 0; time <= story.animation.durationMs; time += 1000 / 30) {
        const frame = sampleAnimation(program, time);
        expect(sampleAnimation(program, time)).toEqual(frame);
        expect(Number.isFinite(frame.x)).toBe(true);
        for (const segment of frame.segments) {
          expect([segment.x1, segment.x2, segment.y1, segment.y2].every(Number.isFinite)).toBe(true);
          expect(Math.hypot(segment.x2 - segment.x1, segment.y2 - segment.y1)).toBeCloseTo(lengths.get(segment.id)!, 5);
        }
        if (frame.action === "wave") {
          const previous = actions.at(-2)!;
          expect(frame.x).toBeCloseTo(sampleAnimation(program, previous.startMs + previous.durationMs).x, 4);
        }
        if (frame.prop) expect(frame.prop.id).toBe("release-package");
      }
      const again = getStory(id);
      story.animation.actions[0].durationMs = 1;
      expect(again.animation.actions[0].durationMs).not.toBe(1);
    }
    expect(() => getStory("unknown")).toThrow("Unknown story");
  });

  it("keeps two hands on the release package during contacted travel, then releases it", () => {
    const story = getStory("deployment-rollout");
    const program = compileAnimation(story.animation).program!;
    for (const time of [2000, 3000, 5000]) {
      const frame = sampleAnimation(program, time);
      expect(frame.prop!.x).toBeGreaterThan(story.animation.prop!.x);
      for (const side of ["left", "right"]) {
        const hand = frame.segments.find(segment => segment.id === `${side}-forearm`)!;
        expect(hand.x2).toBeCloseTo(frame.prop!.handleX, 5);
        expect(Math.abs(hand.y2 - frame.prop!.handleY)).toBeCloseTo(4, 5);
      }
    }
    const released = sampleAnimation(program, 7000);
    expect(released.prop!.x).toBe(story.animation.prop!.toX);
    const hand = released.segments.find(segment => segment.id === "right-forearm")!;
    expect(Math.hypot(hand.x2 - released.prop!.handleX, hand.y2 - released.prop!.handleY)).toBeGreaterThan(20);
  });

  it("derives synchronized cues for forward playback, backward seek and final state", () => {
    const story = getStory("cloud-journey");
    expect(storyState(story, 4399).active?.id).toBe("request");
    expect(storyState(story, 4400).active?.id).toBe("application");
    expect(storyState(story, 18000).revealed).toHaveLength(5);
    expect(storyState(story, 0).revealed).toHaveLength(1);
    expect(storyState(story, -1).timeMs).toBe(0);
    expect(storyState(story, 999999).complete).toBe(true);
    expect(() => storyState(story, Infinity)).toThrow("finite");
  });
});
