import { describe, expect, it } from "vitest";
import { GENERATED_MOTION_LIBRARY } from "../src/generated/motion-library.js";

describe("generated motion library", () => {
  it("contains factory-quality 30 fps clips with metadata", () => {
    expect(GENERATED_MOTION_LIBRARY.version).toBe(1);
    expect(GENERATED_MOTION_LIBRARY.fps).toBe(30);
    const clips = Object.values(GENERATED_MOTION_LIBRARY.clips);
    expect(clips.length).toBeGreaterThanOrEqual(6);
    for (const id of ["walk", "run", "jump", "stop", "point", "idle"]) {
      expect(GENERATED_MOTION_LIBRARY.clips[id]).toBeDefined();
      expect(GENERATED_MOTION_LIBRARY.clips[id].meta.quality.approvedBaseline).toBe(true);
    }
    for (const clip of clips) {
      expect(clip.fps).toBe(30);
      expect(clip.frames.length).toBeGreaterThan(2);
      expect(clip.meta.quality.passed).toBe(true);
      expect(clip.meta.license).toContain("CMU mocap");
      for (const frame of clip.frames) {
        expect(Number.isFinite(frame.root.x)).toBe(true);
        expect(Number.isFinite(frame.root.y)).toBe(true);
        if ("facing" in frame) expect(frame.facing).toBeGreaterThanOrEqual(-1);
        if ("facing" in frame) expect(frame.facing).toBeLessThanOrEqual(1);
      }
    }
  });
});
