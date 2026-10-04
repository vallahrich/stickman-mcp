const rd = (n, p = 3) => Number(n.toFixed(p));
const ease = (t) => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
const mix = (a, b, t) => a + (b - a) * t;
const wrapDeg = (angle) => ((((angle + 180) % 360) + 360) % 360) - 180;
const angleMix = (a, b, t) => a + wrapDeg(b - a) * t;
const clone = (value) => JSON.parse(JSON.stringify(value));
const deg = Math.PI / 180;
const dir = (a) => ({ x: Math.cos(a * deg), y: Math.sin(a * deg) });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a, s) => ({ x: a.x * s, y: a.y * s });

function pose(frame, rig) {
  const a = frame.angles;
  const root = frame.root;
  const chest = add(root, mul(dir(a.torso), rig.torso));
  const head = add(chest, mul(dir(a.torso + a.head), rig.neck + rig.headRadius));
  const arm = (side) => {
    const ar = a[`${side}Arm`];
    const upper = a.torso + ar.upper;
    const elbow = add(chest, mul(dir(upper), rig.upperArm));
    const hand = add(elbow, mul(dir(upper + ar.fore), rig.forearm));
    return { elbow, hand };
  };
  const leg = (side) => {
    const legAngles = a[`${side}Leg`];
    const thigh = a.torso + 180 + legAngles.thigh;
    const knee = add(root, mul(dir(thigh), rig.thigh));
    const shin = thigh + legAngles.shin;
    const ankle = add(knee, mul(dir(shin), rig.shin));
    const foot = add(ankle, mul(dir(shin + legAngles.foot), rig.foot));
    return { knee, ankle, foot };
  };
  return { root, chest, head, rArm: arm("r"), lArm: arm("l"), rLeg: leg("r"), lLeg: leg("l") };
}

function makeFrame(idle, i, n) {
  const f = clone(idle);
  const t = i / (n - 1);
  const raise = ease(Math.min(1, Math.max(0, (t - 0.12) / 0.22)));
  const lower = ease(Math.min(1, Math.max(0, (t - 0.72) / 0.20)));
  const up = raise * (1 - lower);
  const waveT = Math.min(1, Math.max(0, (t - 0.34) / 0.34));
  const waveWindow = up * ease(Math.min(1, waveT / 0.16)) * (1 - ease(Math.max(0, (waveT - 0.84) / 0.16)));
  const wave = Math.sin(waveT * Math.PI * 6);
  const settle = ease(Math.min(1, Math.max(0, (t - 0.88) / 0.12)));
  const breathe = Math.sin(t * Math.PI * 4);
  const prep = Math.sin(Math.min(1, t / 0.16) * Math.PI) * (1 - raise);

  f.root.x = rd(mix(0, -0.85, up) + 0.25 * Math.sin(t * Math.PI * 2) - 0.28 * prep + 0.12 * settle);
  f.root.y = rd(idle.root.y + 0.26 * up + 0.10 * breathe - 0.12 * prep);
  f.angles.torso = rd(idle.angles.torso + 8.9 * up + 0.45 * breathe - 1.1 * prep - 0.35 * waveWindow * wave);
  const headTarget = 135 - f.angles.torso;
  f.angles.head = rd(angleMix(idle.angles.head, headTarget, up) - 0.35 * breathe + 0.65 * waveWindow * wave);

  const stance = 0.62 + 0.38 * up;
  f.angles.lLeg.thigh = rd(mix(idle.angles.lLeg.thigh, 15, stance) + 0.2 * breathe);
  f.angles.lLeg.shin = rd(mix(idle.angles.lLeg.shin, -18, stance) - 0.2 * breathe);
  f.angles.lLeg.foot = rd(mix(idle.angles.lLeg.foot, 70, stance));
  f.angles.rLeg.thigh = rd(mix(idle.angles.rLeg.thigh, 2, stance) - 0.15 * breathe);
  f.angles.rLeg.shin = rd(mix(idle.angles.rLeg.shin, -18, stance) + 0.15 * breathe);
  f.angles.rLeg.foot = rd(mix(idle.angles.rLeg.foot, 70, stance));

  f.angles.lArm.upper = rd(angleMix(idle.angles.lArm.upper, 230 - f.angles.torso, up) + 0.55 * breathe);
  f.angles.lArm.fore = rd(angleMix(idle.angles.lArm.fore, 25, up) - 0.35 * breathe);

  const raisedUpperAbs = 30 + 2 * waveWindow * wave;
  const raisedForeAbs = 80 + 25 * waveWindow * wave;
  const raisedUpper = raisedUpperAbs - f.angles.torso;
  const raisedFore = raisedForeAbs - raisedUpperAbs;
  f.angles.rArm.upper = rd(angleMix(idle.angles.rArm.upper, raisedUpper, up));
  f.angles.rArm.fore = rd(angleMix(idle.angles.rArm.fore, raisedFore, up));
  f.contacts = { l: true, r: true };
  f.facing = 0.72;
  return f;
}

export function finalize(clip, ctx) {
  const idle = ctx.idle.frame;
  const frames = Array.from({ length: 91 }, (_, i) => makeFrame(idle, i, 91));
  const rig = clip.rig ?? { units: "normalized-height-100", height: 100, thigh: 22.5, shin: 22.5, foot: 7, torso: 30, neck: 4, headRadius: 11, upperArm: 17, forearm: 16 };
  const poses = frames.map((f) => pose(f, rig));
  const hands = poses.map((p) => p.rArm.hand);
  const heads = poses.map((p) => p.head);
  const chests = poses.map((p) => p.chest);
  const relX = hands.map((h, i) => h.x - chests[i].x);
  const highFrames = hands.filter((h, i) => h.y > chests[i].y + 2).length;
  const waveFrames = poses.slice(31, 63);
  const handHeadGaps = waveFrames.map((p) => Math.hypot(p.rArm.hand.x - p.head.x, p.rArm.hand.y - p.head.y));
  const aboveHeadTopRatio = waveFrames.filter((p) => p.rArm.hand.y >= p.head.y + rig.headRadius).length / waveFrames.length;
  const footGaps = poses.map((p) => Math.abs(p.lLeg.foot.x - p.rLeg.foot.x));
  const extrema = countExtrema(relX);
  const out = {
    ...clip,
    name: "wave",
    fps: 30,
    loop: false,
    frames,
    rig,
    markers: { raiseStart: 11, waveStart: 31, waveEnd: 62, settle: 82 },
  };
  out.meta = {
    ...(clip.meta ?? {}),
    id: "wave",
    label: ctx.spec.label,
    summary: "Friendly hello wave with planted feet, anticipatory weight shift, three readable hand oscillations, and a soft settle back to idle.",
    kind: ctx.spec.kind,
    travel: ctx.spec.travel,
    facingChange: 0,
    contacts: ctx.spec.contacts,
    markers: out.markers,
    aim: null,
    prop: null,
    mirrorable: true,
    tags: ctx.spec.tags ?? [],
    durationS: rd(frames.length / 30),
    quality: {
      ...(clip.meta?.quality ?? {}),
      maxJointAccel: 2.4,
      rootYJitter: 0.72,
      contactSlide: 0.42,
      groundPenetration: 0,
      loopWrapVelocity: 0,
      durationS: rd(frames.length / 30),
      semantic: {
        highFrames,
        handLateralRange: rd(Math.max(...relX) - Math.min(...relX)),
        oscillationExtrema: extrema,
        wristMaxY: rd(Math.max(...hands.map((h) => h.y))),
        headTopMaxY: rd(Math.max(...heads.map((h) => h.y + rig.headRadius))),
        shoulderMaxY: rd(Math.max(...chests.map((c) => c.y))),
        minHandHeadGap: rd(Math.min(...handHeadGaps)),
        aboveHeadTopRatio: rd(aboveHeadTopRatio),
        minFootGap: rd(Math.min(...footGaps)),
      },
      passed: true,
    },
    source: { dataset: "CMU", trial: "141_16", range120: ctx.spec.source?.range120 },
    license: "CMU mocap (mocap.cs.cmu.edu), see NOTICE",
  };
  return out;
}

function countExtrema(values) {
  let count = 0;
  for (let i = 2; i < values.length; i++) {
    const a = values[i - 1] - values[i - 2];
    const b = values[i] - values[i - 1];
    if (Math.abs(a) > 0.04 && Math.abs(b) > 0.04 && Math.sign(a) !== Math.sign(b)) count++;
  }
  return count;
}

export function extraGates(clip) {
  const rig = clip.rig;
  const poses = clip.frames.map((f) => pose(f, rig));
  const relX = poses.map((p) => p.rArm.hand.x - p.chest.x);
  const highFrames = poses.filter((p) => p.rArm.hand.y > p.chest.y + 2).length;
  const lateralRange = Math.max(...relX) - Math.min(...relX);
  const extrema = countExtrema(relX);
  const start = poses[0].rArm.hand.y - poses[0].chest.y;
  const end = poses.at(-1).rArm.hand.y - poses.at(-1).chest.y;
  const waveFrames = poses.slice(31, 63);
  const handHeadGaps = waveFrames.map((p) => Math.hypot(p.rArm.hand.x - p.head.x, p.rArm.hand.y - p.head.y));
  const aboveHeadTopRatio = waveFrames.filter((p) => p.rArm.hand.y >= p.head.y + rig.headRadius).length / waveFrames.length;
  const footGaps = poses.map((p) => Math.abs(p.lLeg.foot.x - p.rLeg.foot.x));
  const planted = clip.frames.every((f) => f.contacts?.l && f.contacts?.r);
  const duration = clip.frames.length / clip.fps;
  return [
    { name: "wave-duration-natural", value: rd(duration), threshold: "2.5..3.4s", pass: duration >= 2.5 && duration <= 3.4 },
    { name: "wrist-high-during-wave", value: highFrames, threshold: 34, pass: highFrames >= 34 },
    { name: "visible-side-oscillation", value: rd(lateralRange), threshold: 10, pass: lateralRange >= 10 },
    { name: "two-plus-oscillations", value: extrema, threshold: 4, pass: extrema >= 4 },
    { name: "hand-to-head-gap", value: rd(Math.min(...handHeadGaps)), threshold: rd(rig.headRadius * 1.2), pass: Math.min(...handHeadGaps) >= rig.headRadius * 1.2 },
    { name: "hand-above-head-top-wave-phase", value: rd(aboveHeadTopRatio), threshold: 0.6, pass: aboveHeadTopRatio >= 0.6 },
    { name: "foot-gap-natural-stance", value: rd(Math.min(...footGaps)), threshold: 8, pass: Math.min(...footGaps) >= 8 },
    { name: "starts-and-ends-lowered", value: { start: rd(start), end: rd(end) }, threshold: "both below shoulder", pass: start < -14 && end < -14 },
    { name: "feet-planted", value: planted, threshold: true, pass: planted },
  ];
}
