import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MOTION_CLIP_LIBRARY, sampleClipFrameAsSampledFrame, type MotionClip } from "../dist/motion-clips.js";
import { clipFrameToSampledFrame } from "../scripts/motions/review-renderer.mjs";

const sessionFiles = process.env.STICKMAN_SESSION_FILES ?? process.env.MOTION_SESSION_FILES ?? "C:\\Users\\t-vwallerich\\.copilot\\session-state\\5151d75e-0e30-46ad-99e0-e3d1bf08e105\\files";
const candidateIds = ["step-up", "turn-around", "wave", "climb-ladder", "push", "crouch", "sit-down", "stand-up", "kick", "cheer"];

function candidateClip(): { id: string; clip: MotionClip } | null {
  for (const id of candidateIds) {
    const file = path.join(sessionFiles, "motion-factory", "clips", id, "clip.json");
    if (existsSync(file)) return { id, clip: JSON.parse(readFileSync(file, "utf8")) as MotionClip };
  }
  return null;
}

function framesFor(clip: MotionClip): number[] {
  return [0, Math.floor((clip.frames.length - 1) / 2), clip.frames.length - 1];
}

function expectPointClose(actual: { x: number; y: number }, expected: { x: number; y: number }): void {
  expect(actual.x).toBeCloseTo(expected.x, 6);
  expect(actual.y).toBeCloseTo(expected.y, 6);
}

async function expectReviewMatchesEngine(clip: MotionClip): Promise<void> {
  for (const frameIndex of framesFor(clip)) {
    const review = await clipFrameToSampledFrame(clip, frameIndex);
    const engine = sampleClipFrameAsSampledFrame(clip, { frameIndex });
    expectPointClose(review.head, engine.head);
    expect(review.segments.map((segment: { id: string }) => segment.id)).toEqual(engine.segments.map((segment) => segment.id));
    for (let i = 0; i < engine.segments.length; i++) {
      const a = review.segments[i]!;
      const b = engine.segments[i]!;
      expect(a.x1).toBeCloseTo(b.x1, 6);
      expect(a.y1).toBeCloseTo(b.y1, 6);
      expect(a.x2).toBeCloseTo(b.x2, 6);
      expect(a.y2).toBeCloseTo(b.y2, 6);
    }
    for (const [name, point] of Object.entries(engine.joints)) {
      expectPointClose(review.joints[name], point);
    }
  }
}

describe("motion review renderer geometry", () => {
  it("uses the engine clip-frame sampler for shipped walk and run clips", async () => {
    await expectReviewMatchesEngine(MOTION_CLIP_LIBRARY.clips.walk);
    await expectReviewMatchesEngine(MOTION_CLIP_LIBRARY.clips.run);
  });

  it("uses the engine clip-frame sampler for an available candidate clip", async () => {
    const candidate = candidateClip();
    if (!candidate) return;
    await expectReviewMatchesEngine(candidate.clip);
  });
});
