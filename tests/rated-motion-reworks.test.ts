import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { sampleClipMotion, type MotionClip, type PoseKey } from "../dist/motion-clips.js";
import { RUNTIME_MOTION_LIBRARY } from "../dist/motion-library.js";
import { frameGeometry } from "../dist/render.js";
import { buildKeyPoseClip, keyPoseGates } from "../scripts/motions/keypose.mjs";
import { engineSampledFrame, stageKitSource, REVIEW_STAGE } from "../scripts/motions/review-renderer.mjs";

interface ReworkSpec {
  id: string;
  frames: number;
  loop: boolean;
  poseKeys: { frame: number; pose: PoseKey }[];
  gates: { headFloor: boolean; maxJointStep: number };
}
interface SceneProp { type: string; x: number; y: number; w: number; h: number; rot: number }
const ids = ["tablet-tap", "inspect-magnifier", "video-call", "dance", "hang-swing", "climb-ledge", "open-laptop", "frustrated-pc", "write-notes"];
const neutral = (RUNTIME_MOTION_LIBRARY.clips.idle as MotionClip).frames[0]!;
const load = (id: string) => {
  const spec: ReworkSpec = JSON.parse(readFileSync(new URL(`../motions/specs/${id}.json`, import.meta.url), "utf8"));
  return { spec, clip: buildKeyPoseClip(spec, neutral) as MotionClip };
};
type ReviewFrame = ReturnType<typeof engineSampledFrame>;
const hand = (frame: ReviewFrame, side: string) => {
  const segment = frame.segments.find((s: { id: string }) => s.id === `${side}-forearm`)!;
  return { x: segment.x2, y: segment.y2 };
};

describe("rated motion revisions preserve actual contacts and unchanged gates", () => {
  it.each(ids)("%s passes the original anatomy, floor and continuity gates", async id => {
    const { spec, clip } = load(id);
    expect(spec.gates).toMatchObject({ maxJointStep: 14, headFloor: true });
    const result = await keyPoseGates(clip, spec);
    expect(result.failures).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it.each([["video-call", "headphones"], ["inspect-magnifier", "detective-hat"]])("%s accessories track the rendered head rather than floating beside it", async (id, type) => {
    const { spec, clip } = load(id);
    const kit = await stageKitSource();
    const sceneAt = runInNewContext(`${kit}; (spec,f,handAt)=>layoutScene(spec,{props:[]},f,handAt);`) as (spec: ReworkSpec, f: number, handAt: () => { x: number; y: number }) => SceneProp[];
    for (let f = 0; f < spec.frames - 1; f += 0.5) {
      const frame = engineSampledFrame(sampleClipMotion, clip, f), geometry = frameGeometry(frame);
      const prop = sceneAt(spec, f, () => hand(frame, "right")).find(p => p.type === type)!;
      expect(Math.abs(prop.x + prop.w / 2 - geometry.head.x) / REVIEW_STAGE.scale).toBeLessThan(0.1);
      const y = type === "headphones" ? prop.y + prop.h / 2 : prop.y + prop.h * 0.86 + geometry.headRadius;
      expect(Math.abs(y - geometry.head.y) / REVIEW_STAGE.scale).toBeLessThan(type === "headphones" ? 0.1 : 1);
    }
  });

  it("writing keeps the actual rotated pen nib on the newly revealed handwritten path", async () => {
    const { spec, clip } = load("write-notes");
    const kit = await stageKitSource();
    const sceneAt = runInNewContext(`${kit}; (spec,f)=>layoutScene(spec,{props:[]},f);`) as (spec: ReworkSpec, f: number) => SceneProp[];
    const markupAt = runInNewContext(`${kit}; prop=>scenePropMarkup(prop,3,"#202124");`) as (prop: SceneProp) => string;
    for (const [start, end] of [[40, 64], [76, 100], [112, 136]]) {
      for (let f = start + 0.25; f <= end; f += 0.25) {
        const scene = sceneAt(spec, f), paper = scene.find(p => p.type === "notebook")!, pen = scene.find(p => p.type === "pen")!;
        const ink = [...markupAt(paper).matchAll(/data-part="notebook-ink"[^>]* d="([^"]+)"/g)].at(-1)![1]!;
        const endpoint = [...ink.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].at(-1)!;
        const angle = pen.rot * Math.PI / 180;
        const nib = { x: pen.x + pen.w * 0.5 - Math.sin(angle) * pen.h * 0.58, y: pen.y + pen.h * 0.42 + Math.cos(angle) * pen.h * 0.58 };
        const gap = Math.hypot(nib.x - Number(endpoint[1]), nib.y - Number(endpoint[2])) / REVIEW_STAGE.scale;
        expect(gap, `nib f${f}`).toBeLessThan(0.1);
        const wrist = hand(engineSampledFrame(sampleClipMotion, clip, f), "right");
        expect(Math.hypot(wrist.x - pen.x - pen.w * 0.5, wrist.y - pen.y - pen.h * 0.42) / REVIEW_STAGE.scale).toBeLessThan(0.1);
      }
    }
  });

  it.each(["tablet-tap", "inspect-magnifier"])("%s keeps the visible bottom-left support at fractional playback times", async id => {
    const { spec, clip } = load(id);
    const kit = await stageKitSource();
    const sceneAt = runInNewContext(`${kit}; (spec,f,handAt)=>layoutScene(spec,{props:[]},f,handAt);`) as (spec: ReworkSpec, f: number, handAt: (f: number, side: string) => { x: number; y: number }) => SceneProp[];
    for (let f = 0; f < spec.frames - 1; f += 0.25) {
      const frame = engineSampledFrame(sampleClipMotion, clip, f);
      const wrist = hand(frame, "left");
      const scenes = sceneAt(spec, f, () => hand(frame, "right"));
      const page = scenes.find(p => p.type === (id === "tablet-tap" ? "tablet" : "notebook"))!;
      const gap = Math.hypot(wrist.x - page.x, wrist.y - page.y - page.h) / REVIEW_STAGE.scale;
      expect(gap, `${id} support f${f}`).toBeLessThan(0.15);
    }
  });

  it("tablet contacts land on the screen and retract outside the bezel", async () => {
    const { spec, clip } = load("tablet-tap");
    const kit = await stageKitSource();
    for (const f of [43, 59, 82, 37, 51, 68, 91]) {
      const frame = engineSampledFrame(sampleClipMotion, clip, f);
      const right = hand(frame, "right");
      const page: SceneProp = runInNewContext(`${kit}; layoutScene(${JSON.stringify(spec)},{props:[]},${f})[0];`);
      if ([43, 59, 82].includes(f)) {
        expect(right.x).toBeGreaterThan(page.x + page.w * 0.12);
        expect(right.x).toBeLessThan(page.x + page.w * 0.88);
        expect(right.y).toBeGreaterThan(page.y + page.h * 0.1);
        expect(right.y).toBeLessThan(page.y + page.h * 0.88);
      } else {
        expect(right.y).toBeLessThan(page.y);
      }
    }
  });

  it("hang-swing maintains both bar grips through release and grows a coherent foot arc", async () => {
    const { clip } = load("hang-swing");
    const feet: number[] = [];
    for (let f = 0; f <= 125; f++) {
      const frame = engineSampledFrame(sampleClipMotion, clip, f);
      for (const [side, x] of [["left", 14], ["right", 22]] as const) {
        const wrist = hand(frame, side);
        expect((wrist.x - REVIEW_STAGE.rootX) / REVIEW_STAGE.scale).toBeCloseTo(x, 4);
        expect((REVIEW_STAGE.groundY - wrist.y) / REVIEW_STAGE.scale).toBeCloseTo(185, 4);
      }
      const leftFoot = frame.segments.find((s: { id: string }) => s.id === "left-shin")!;
      feet.push(leftFoot.x2 / REVIEW_STAGE.scale);
      expect(leftFoot.y2).toBeLessThan(REVIEW_STAGE.groundY);
    }
    expect(Math.max(...feet) - Math.min(...feet)).toBeGreaterThan(75);
    for (let f = 135; f < clip.frames.length; f++) {
      const frame = engineSampledFrame(sampleClipMotion, clip, f);
      for (const side of ["left", "right"]) {
        const foot = frame.segments.find((s: { id: string }) => s.id === `${side}-shin`)!;
        expect(foot.y2).toBeCloseTo(REVIEW_STAGE.groundY, 4);
      }
    }
  });
});
