// Key-pose motions: authored StyleKey sequences rendered by the shipping engine (sampleClipMotion),
// the same pose system as the user-approved walk/run/stop/jump/point.
import { engineSampledFrame, loadEngineRenderer, REVIEW_STAGE } from "./review-renderer.mjs";

export function buildKeyPoseClip(spec, neutralFrame) {
  const n = Math.max(2, Math.round(spec.frames));
  const frame = { root: { x: 0, y: neutralFrame.root.y }, angles: neutralFrame.angles, contacts: { l: true, r: true } };
  const poseKeys = [...spec.poseKeys].sort((a, b) => a.frame - b.frame);
  if (poseKeys[0].frame !== 0) throw new Error(`${spec.id}: first pose key must be at frame 0`);
  if (!spec.loop && poseKeys[poseKeys.length - 1].frame !== n - 1) throw new Error(`${spec.id}: last pose key must be at frame ${n - 1}`);
  return {
    name: spec.id, fps: 30, loop: Boolean(spec.loop), frames: Array.from({ length: n }, () => frame), strideLength: 0,
    markers: spec.markers ?? {}, poseKeys,
    rig: { units: "normalized-height-100", height: 100, thigh: 22.5, shin: 22.5, foot: 7, torso: 30, neck: 4, headRadius: 11, upperArm: 17, forearm: 16 },
    source: { authored: "key poses" }, license: "Original key-pose animation"
  };
}

const wrap = (deg) => ((deg + 180) % 360 + 360) % 360 - 180;

/** Gates measured on the engine's world output, i.e. exactly what users see. */
export async function keyPoseGates(clip, spec) {
  const { sampleClipMotion } = await loadEngineRenderer();
  const unit = REVIEW_STAGE.scale;
  const failures = [];
  const add = (name, frame, value, threshold) => { if (failures.filter((f) => f.metric === name).length < 6) failures.push({ metric: name, frame, value: Number(value.toFixed(2)), threshold }); };
  const seg = (s, id) => s.segments.find((x) => x.id === id);
  const angle = (dir, x1, y1, x2, y2) => Math.atan2(dir * (x2 - x1), y2 - y1) * 180 / Math.PI;
  let prev = null;
  const allow = new Set(spec.gates?.allow ?? []);
  for (let f = 0; f < clip.frames.length; f++) {
    const s = engineSampledFrame(sampleClipMotion, clip, f);
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
      }
    }
    prev = s;
  }
  return { passed: failures.length === 0, failures };
}
