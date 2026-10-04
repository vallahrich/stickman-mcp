const FPS = 30;
const FRAME_COUNT = 96;
const IDLE_ROOT_Y = 47.969;
const FOOT_ABS = 322;

const rd = (n, p = 3) => Number(n.toFixed(p));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
const wrapDeg = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
const d2r = (a) => (a * Math.PI) / 180;
const r2d = (a) => (a * 180) / Math.PI;
const dir = (a) => ({ x: Math.cos(d2r(a)), y: Math.sin(d2r(a)) });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a, s) => ({ x: a.x * s, y: a.y * s });
const angleLerp = (a, b, t) => rd(a + wrapDeg(b - a) * ease(t));

function phaseAt(t) {
  const down = ease(t / 0.32);
  const up = ease((t - 0.68) / 0.28);
  return down * (1 - up);
}

function solveLimb(origin, target, upper, lower, preferForward = true) {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const dist = clamp(Math.hypot(dx, dy), 2, upper + lower - 0.001);
  const base = Math.atan2(dy, dx);
  const open = Math.acos(clamp((upper * upper + dist * dist - lower * lower) / (2 * upper * dist), -1, 1));
  const candidates = [1, -1].map((sign) => {
    const jointAbs = r2d(base + sign * open);
    const joint = add(origin, mul(dir(jointAbs), upper));
    const lowerAbs = r2d(Math.atan2(target.y - joint.y, target.x - joint.x));
    return { joint, jointAbs, lowerAbs };
  });
  return candidates.sort((a, b) => (preferForward ? b.joint.x - a.joint.x : a.joint.y - b.joint.y))[0];
}

function legAngles(root, torso, rig, toe) {
  const ankle = {
    x: toe.x - Math.cos(d2r(FOOT_ABS)) * rig.foot,
    y: toe.y - Math.sin(d2r(FOOT_ABS)) * rig.foot,
  };
  const ik = solveLimb(root, ankle, rig.thigh, rig.shin, true);
  return {
    thigh: rd(wrapDeg(ik.jointAbs - torso - 180)),
    shin: rd(wrapDeg(ik.lowerAbs - ik.jointAbs)),
    foot: rd(wrapDeg(FOOT_ABS - ik.lowerAbs)),
  };
}

function armAngles(root, torso, rig, target, side) {
  const chest = add(root, mul(dir(torso), rig.torso));
  const ik = solveLimb(chest, target, rig.upperArm, rig.forearm, false);
  const upperAbs = ik.jointAbs;
  const foreAbs = ik.lowerAbs;
  const elbowBias = side === "l" ? -0.8 : 0.8;
  return {
    upper: rd(wrapDeg(upperAbs - torso + elbowBias)),
    fore: rd(wrapDeg(foreAbs - upperAbs - elbowBias)),
  };
}

function pose(frame, rig) {
  const a = frame.angles;
  const root = frame.root;
  const chest = add(root, mul(dir(a.torso), rig.torso));
  const head = add(chest, mul(dir(a.torso + a.head), rig.neck + rig.headRadius));
  function leg(side) {
    const l = a[`${side}Leg`];
    const thighAbs = a.torso + 180 + l.thigh;
    const knee = add(root, mul(dir(thighAbs), rig.thigh));
    const shinAbs = thighAbs + l.shin;
    const ankle = add(knee, mul(dir(shinAbs), rig.shin));
    const toe = add(ankle, mul(dir(shinAbs + l.foot), rig.foot));
    return { hip: root, knee, ankle, toe };
  }
  function arm(side) {
    const u = a[`${side}Arm`];
    const upperAbs = a.torso + u.upper;
    const elbow = add(chest, mul(dir(upperAbs), rig.upperArm));
    const hand = add(elbow, mul(dir(upperAbs + u.fore), rig.forearm));
    return { elbow, hand };
  }
  return { root, chest, head, lLeg: leg("l"), rLeg: leg("r"), lArm: arm("l"), rArm: arm("r") };
}

function angleBetween(a, b) {
  const mag = Math.max(0.0001, Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y));
  return r2d(Math.acos(clamp((a.x * b.x + a.y * b.y) / mag, -1, 1)));
}

function kneeInterior(j) {
  return angleBetween({ x: j.hip.x - j.knee.x, y: j.hip.y - j.knee.y }, { x: j.ankle.x - j.knee.x, y: j.ankle.y - j.knee.y });
}

function elbowInterior(p, side) {
  const arm = p[`${side}Arm`];
  return angleBetween({ x: p.chest.x - arm.elbow.x, y: p.chest.y - arm.elbow.y }, { x: arm.hand.x - arm.elbow.x, y: arm.hand.y - arm.elbow.y });
}

function kneeForward(j) {
  const dy = j.ankle.y - j.hip.y;
  const t = Math.abs(dy) < 0.001 ? 0.5 : clamp((j.knee.y - j.hip.y) / dy, 0, 1);
  const lineX = lerp(j.hip.x, j.ankle.x, t);
  return j.knee.x >= lineX - 0.1;
}

export function finalize(clip, ctx) {
  const rig = clip.rig ?? ctx.idle.clip.rig;
  const idle = ctx.idle.frame;
  const frames = [];
  const idlePose = pose(idle, rig);
  const lToe = { x: idlePose.lLeg.toe.x, y: idlePose.lLeg.toe.y };
  const rToe = { x: idlePose.rLeg.toe.x, y: idlePose.rLeg.toe.y };

  for (let i = 0; i < FRAME_COUNT; i++) {
    const t = i / (FRAME_COUNT - 1);
    const crouch = phaseAt(t);
    const hold = t > 0.34 && t < 0.67 ? Math.sin(((t - 0.34) / 0.33) * Math.PI * 3) : 0;
    const prep = Math.sin(clamp(t / 0.14, 0, 1) * Math.PI) * (1 - crouch);
    const settle = t > 0.78 ? Math.sin(((t - 0.78) / 0.22) * Math.PI * 2) * (1 - t) : 0;
    const root = {
      x: rd(-0.45 * prep - 4.8 * crouch + 0.3 * hold * crouch + 0.22 * settle),
      y: rd(IDLE_ROOT_Y - 18.5 * crouch - 0.55 * hold * crouch - 0.18 * prep + 0.28 * settle),
    };
    const torso = rd(94 - 28 * crouch - 1.2 * prep + 0.55 * hold * crouch);
    const head = rd(angleLerp(idle.angles.head, 82 - torso, crouch) - 0.3 * hold * crouch);

    const handY = root.y + 26 + 2.2 * crouch + 0.25 * hold * crouch;
    const reach = 12 + 24 * crouch - 1.5 * prep;
    const lHand = { x: root.x + reach - 1.1, y: handY + 1.1 };
    const rHand = { x: root.x + reach + 1.1, y: handY - 1.1 };

    frames.push({
      root,
      angles: {
        torso,
        head,
        lLeg: legAngles(root, torso, rig, lToe),
        rLeg: legAngles(root, torso, rig, rToe),
        lArm: crouch > 0.02 ? armAngles(root, torso, rig, lHand, "l") : {
          upper: angleLerp(idle.angles.lArm.upper, armAngles(root, torso, rig, lHand, "l").upper, crouch),
          fore: angleLerp(idle.angles.lArm.fore, armAngles(root, torso, rig, lHand, "l").fore, crouch),
        },
        rArm: crouch > 0.02 ? armAngles(root, torso, rig, rHand, "r") : {
          upper: angleLerp(idle.angles.rArm.upper, armAngles(root, torso, rig, rHand, "r").upper, crouch),
          fore: angleLerp(idle.angles.rArm.fore, armAngles(root, torso, rig, rHand, "r").fore, crouch),
        },
      },
      contacts: { l: true, r: true },
    });
  }

  return {
    ...clip,
    name: "crouch",
    fps: FPS,
    loop: false,
    frames,
    rig,
    markers: { anticipation: 8, bottomStart: 32, hold: [34, 64], riseStart: 65, settled: 88 },
    meta: {
      ...(clip.meta ?? {}),
      id: "crouch",
      label: ctx.spec.label,
      summary: "Crouch down with planted feet, knees forward, hips back and down, arms reaching for balance, a subtle breathing hold, then rise to idle.",
      kind: ctx.spec.kind,
      travel: ctx.spec.travel,
      facingChange: 0,
      contacts: ctx.spec.contacts,
      prop: ctx.spec.prop,
      mirrorable: true,
      tags: ctx.spec.tags ?? [],
      durationS: rd(frames.length / FPS),
      source: { dataset: "CMU", trial: `${ctx.spec.source?.subject}_${ctx.spec.source?.trial}`, range120: ctx.spec.source?.range120 },
      license: "CMU mocap (mocap.cs.cmu.edu), see NOTICE",
    },
  };
}

export function extraGates(clip) {
  const rig = clip.rig;
  const poses = clip.frames.map((frame) => pose(frame, rig));
  const roots = clip.frames.map((f) => f.root);
  const drop = roots[0].y - Math.min(...roots.map((p) => p.y));
  const xTravel = Math.max(...roots.map((p) => p.x)) - Math.min(...roots.map((p) => p.x));
  const bottom = clip.frames.slice(32, 66);
  const bottomPoses = poses.slice(32, 66);
  const torsoLean = bottom.map((f) => 90 - f.angles.torso);
  const handAhead = bottomPoses.flatMap((p) => [p.lArm.hand.x - p.chest.x, p.rArm.hand.x - p.chest.x]);
  const feet = poses.flatMap((p) => [p.lLeg.toe, p.rLeg.toe]);
  const minFootY = Math.min(...feet.map((p) => p.y));
  const maxFootY = Math.max(...feet.map((p) => p.y));
  const knees = poses.flatMap((p) => [p.lLeg, p.rLeg]);
  const minKneeInterior = Math.min(...knees.map(kneeInterior));
  const badKnees = knees.filter((k) => !kneeForward(k)).length;
  const elbows = poses.flatMap((p) => [elbowInterior(p, "l"), elbowInterior(p, "r")]);
  const holdY = bottom.map((f) => f.root.y);
  const holdRange = Math.max(...holdY) - Math.min(...holdY);
  const first = clip.frames[0];
  const last = clip.frames.at(-1);
  const endpointRootGap = Math.hypot(first.root.x - last.root.x, first.root.y - last.root.y);
  const planted = clip.frames.every((f) => f.contacts?.l && f.contacts?.r);
  return [
    { name: "crouch-duration-natural", value: rd(clip.frames.length / clip.fps), threshold: "2.8..3.5s", pass: clip.frames.length / clip.fps >= 2.8 && clip.frames.length / clip.fps <= 3.5 },
    { name: "hip-drop-readable", value: rd(drop), threshold: ">= 17", pass: drop >= 17 },
    { name: "in-place-root-travel", value: rd(xTravel), threshold: "<= 6", pass: xTravel <= 6 },
    { name: "forward-torso-lean-at-bottom", value: `${rd(Math.min(...torsoLean))}..${rd(Math.max(...torsoLean))}`, threshold: "18..26", pass: Math.min(...torsoLean) >= 18 && Math.max(...torsoLean) <= 26 },
    { name: "arms-forward-for-balance", value: rd(Math.min(...handAhead)), threshold: ">= 16", pass: Math.min(...handAhead) >= 16 },
    { name: "feet-remain-planted", value: planted ? 1 : 0, threshold: 1, pass: planted },
    { name: "feet-on-ground", value: `${rd(minFootY)}..${rd(maxFootY)}`, threshold: "-0.15..0.15", pass: minFootY >= -0.15 && maxFootY <= 0.15 },
    { name: "knees-bend-forward", value: badKnees, threshold: 0, pass: badKnees === 0 },
    { name: "knee-interior-safe", value: rd(minKneeInterior, 1), threshold: ">= 45", pass: minKneeInterior >= 45 },
    { name: "elbow-interior-safe", value: rd(Math.min(...elbows), 1), threshold: ">= 35", pass: Math.min(...elbows) >= 35 },
    { name: "hold-has-subtle-breath", value: rd(holdRange), threshold: "0.4..1.2", pass: holdRange >= 0.4 && holdRange <= 1.2 },
    { name: "returns-to-idle-root", value: rd(endpointRootGap), threshold: "<= 1.1", pass: endpointRootGap <= 1.1 },
  ];
}
