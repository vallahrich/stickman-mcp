// Key-pose motions: authored StyleKey sequences rendered by the shipping engine (sampleClipMotion),
// the same pose system as the user-approved walk/run/stop/jump/point.
import { engineSampledFrame, loadEngineRenderer, REVIEW_STAGE } from "./review-renderer.mjs";

export function buildKeyPoseClip(spec, neutralFrame) {
  const n = Math.max(2, Math.round(spec.frames));
  const frame = { root: { x: 0, y: neutralFrame.root.y }, angles: neutralFrame.angles, contacts: { l: true, r: true } };
  const poseKeys = [...spec.poseKeys].sort((a, b) => a.frame - b.frame);
  if (poseKeys[0].frame !== 0) throw new Error(`${spec.id}: first pose key must be at frame 0`);
  if (!spec.loop && poseKeys[poseKeys.length - 1].frame !== n - 1) throw new Error(`${spec.id}: last pose key must be at frame ${n - 1}`);
  const strideLength = spec.strideLength ?? 0;
  if (!Number.isFinite(strideLength)) throw new Error(`${spec.id}: strideLength must be finite`);
  return {
    name: spec.id, fps: 30, loop: Boolean(spec.loop), frames: Array.from({ length: n }, () => frame), strideLength,
    markers: spec.markers ?? {}, poseKeys,
    rig: { units: "normalized-height-100", height: 100, thigh: 22.5, shin: 22.5, foot: 7, torso: 30, neck: 4, headRadius: 11, upperArm: 17, forearm: 16 },
    source: { authored: "key poses" }, license: "Original key-pose animation"
  };
}

const wrap = (deg) => ((deg + 180) % 360 + 360) % 360 - 180;
const segWorldAngle = (a) => Math.atan2(a.x2 - a.x1, a.y2 - a.y1) * 180 / Math.PI;
const segLength = (a) => Math.hypot(a.x2 - a.x1, a.y2 - a.y1);
const framePoints = (s) => [s.head, ...s.segments.flatMap((x) => [{ x: x.x1, y: x.y1 }, { x: x.x2, y: x.y2 }])];
const ELEVATED_PROPS = new Set(["stairs", "ladder", "ledge", "platform"]);
const AIRBORNE_CLIPS = new Set(["basketball-shot", "cheer", "hop", "hurdle", "jog", "jump", "kick", "kick-ball", "long-jump", "run", "run-start", "skip", "vault"]);

/** Gates measured on the engine's world output, i.e. exactly what users see. */
export async function keyPoseGates(clip, spec) {
  const { sampleClipMotion, frameGeometry } = await loadEngineRenderer();
  const unit = REVIEW_STAGE.scale;
  const failures = [];
  const add = (name, frame, value, threshold) => { if (failures.filter((f) => f.metric === name).length < 6) failures.push({ metric: name, frame, value: Number(value.toFixed(2)), threshold }); };
  const seg = (s, id) => s.segments.find((x) => x.id === id);
  const angle = (dir, x1, y1, x2, y2) => Math.atan2(dir * (x2 - x1), y2 - y1) * 180 / Math.PI;
  let prev = null;
  let firstFrame = null;
  let lastFrame = null;
  const allow = new Set(spec.gates?.allow ?? []);
  const maxAngVel = spec.gates?.maxAngularVelocity ?? 4500;
  if ((spec.kind === "loop" || spec.kind === "oneshot") && (spec.kind === "loop") !== Boolean(clip.loop) && !allow.has("loopKindMismatch")) {
    add("loopKindMismatch", clip.frames.length - 1, clip.loop ? 1 : 0, "clip.loop must match spec.kind === 'loop'");
  }
  for (let f = 0; f < clip.frames.length + (clip.loop ? 1 : 0); f++) {
    const s = engineSampledFrame(sampleClipMotion, clip, f);
    if (f === 0) firstFrame = s;
    if (f === clip.frames.length - 1) lastFrame = s;
    if (spec.gates?.headFloor === true) {
      const geometry = frameGeometry(s);
      const headPenetration = geometry.head.y + geometry.headRadius + geometry.strokeWidth / 2 - s.groundY;
      if (headPenetration > 0.01) add("headGroundPenetration", f, headPenetration / unit, "<= 0 units (rendered head outline)");
    }
    const dir = Math.sign(s.facing ?? 1) || 1;
    const sideView = Math.abs(s.facing ?? 1) > 0.3;
    for (const side of ["left", "right"]) {
      const th = seg(s, `${side}-thigh`), sh = seg(s, `${side}-shin`), ua = seg(s, `${side}-upper-arm`), fa = seg(s, `${side}-forearm`);
      if (sideView) {
        const knee = wrap(angle(dir, th.x1, th.y1, th.x2, th.y2) - angle(dir, sh.x1, sh.y1, sh.x2, sh.y2));
        if (knee < -4 && !allow.has("knee")) add("kneeBendsBackward", f, knee, ">= -4 deg (knees bend forward)");
        const elbow = wrap(angle(dir, fa.x1, fa.y1, fa.x2, fa.y2) - angle(dir, ua.x1, ua.y1, ua.x2, ua.y2));
        if (elbow < -6 && !allow.has("elbow")) add("elbowHyperextended", f, elbow, ">= -6 deg (elbows bend forward/up)");
      }
      for (const [a, len] of [[th, 36], [sh, 36], [ua, 28], [fa, 28]]) {
        const l = Math.hypot(a.x2 - a.x1, a.y2 - a.y1) / unit;
        if (Math.abs(s.facing ?? 1) > 0.97 && Math.abs(l - len) > len * 0.04) add("limbStretch", f, l - len, `|len-${len}| <= 4%`);
      }
      if (sh.y2 > s.groundY + 1) add("groundPenetration", f, sh.y2 - s.groundY, "<= 1px");
    }
    const enforcesGroundedSupport = Boolean(spec.travel || spec.contacts?.length)
      && !ELEVATED_PROPS.has(spec.prop)
      && !AIRBORNE_CLIPS.has(spec.id)
      && !AIRBORNE_CLIPS.has(clip.name)
      && !allow.has("groundedFloat");
    if (f < clip.frames.length && enforcesGroundedSupport) {
      const lShin = seg(s, "left-shin"), rShin = seg(s, "right-shin");
      const lFootClear = (s.groundY - lShin.y2) / unit, rFootClear = (s.groundY - rShin.y2) / unit;
      const lKneeClear = (s.groundY - lShin.y1) / unit, rKneeClear = (s.groundY - rShin.y1) / unit;
      const lHandClear = (s.groundY - seg(s, "left-forearm").y2) / unit, rHandClear = (s.groundY - seg(s, "right-forearm").y2) / unit;
      const pelvisHeight = (s.groundY - seg(s, "torso").y1) / unit;
      const minBodyClear = Math.min(...framePoints(s).map((pt) => (s.groundY - pt.y) / unit));
      const bothFeetClear = Math.min(lFootClear, rFootClear);
      const nonFootSupport = Math.min(lHandClear, rHandClear, lKneeClear, rKneeClear) <= 2.0 || pelvisHeight <= 20;
      if (minBodyClear > 2.0 || (!nonFootSupport && bothFeetClear > 2.0)) {
        add("groundedFloat", f, Math.max(minBodyClear, bothFeetClear), "<= 2.0 units (grounded support contact required)");
      }
    }
    if (prev) {
      const pairs = [["head", s.head, prev.head], ...s.segments.map((x, i) => [x.id, { x: x.x2, y: x.y2 }, { x: prev.segments[i].x2, y: prev.segments[i].y2 }])];
      for (const [id, a, b] of pairs) {
        const d = Math.hypot(a.x - b.x, a.y - b.y) / unit;
        if (d > (spec.gates?.maxJointStep ?? 14)) add("jointPop", f, d, `<= ${spec.gates?.maxJointStep ?? 14} units/frame (${id})`);
      }
      for (const side of ["left", "right"]) {
        const sh = seg(s, `${side}-shin`), ps = seg(prev, `${side}-shin`);
        const planted = sh.y2 >= s.groundY - 0.5 && ps.y2 >= prev.groundY - 0.5;
        if (planted && Math.abs(sh.x2 - ps.x2) / unit > 1.2) add("footSlide", f, Math.abs(sh.x2 - ps.x2) / unit, "<= 1.2 units while planted on ground");
        if (!allow.has("angularVelocity")) {
          for (const [joint, uId, lId] of [["knee", `${side}-thigh`, `${side}-shin`], ["elbow", `${side}-upper-arm`, `${side}-forearm`]]) {
            const uPrev = seg(prev, uId), lPrev = seg(prev, lId), uCurr = seg(s, uId), lCurr = seg(s, lId);
            if (Math.min(segLength(uPrev), segLength(lPrev), segLength(uCurr), segLength(lCurr)) > 4 * unit) {
              const prevBend = wrap(segWorldAngle(uPrev) - segWorldAngle(lPrev));
              const currBend = wrap(segWorldAngle(uCurr) - segWorldAngle(lCurr));
              const angVel = Math.abs(wrap(currBend - prevBend)) * clip.fps;
              if (angVel > maxAngVel) add("jointAngularVelocity", f, angVel, `<= ${maxAngVel} deg/s (${side}-${joint})`);
            }
          }
        }
      }
    }
    if (clip.loop && f === clip.frames.length && firstFrame && lastFrame && !allow.has("loopSeam")) {
      const dir0 = Math.sign(firstFrame.facing ?? 1) || 1;
      const strideShift = dir0 * (clip.strideLength ?? 0) * unit;
      const p0 = framePoints(firstFrame), pLast = framePoints(lastFrame), pWrap = framePoints(s);
      const netPelvisDx = seg(lastFrame, "torso").x1 - seg(firstFrame, "torso").x1;
      const maxSeamTol = spec.gates?.maxLoopSeam ?? 10;
      let wrapErr = 0, endModDx = 0;
      for (let i = 0; i < p0.length; i++) {
        wrapErr = Math.max(wrapErr, Math.hypot((pWrap[i].x - strideShift) - p0[i].x, pWrap[i].y - p0[i].y) / unit);
        endModDx = Math.max(endModDx, Math.hypot((pLast[i].x - netPelvisDx) - p0[i].x, pLast[i].y - p0[i].y) / unit);
      }
      if (wrapErr > 0.5) add("loopSeam", f, wrapErr, "<= 0.5 units cycle wrap modulo strideLength");
      if (endModDx > maxSeamTol) add("loopSeam", clip.frames.length - 1, endModDx, `<= ${maxSeamTol} units end-to-start modulo net dx`);
    }
    prev = s;
  }
  return { passed: failures.length === 0, failures };
}
