const rd = (value, digits = 3) => Number(value.toFixed(digits));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const ease = (t) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
const wrapDeg = (angle) => ((((angle + 180) % 360) + 360) % 360) - 180;
const mix = (a, b, t) => a + (b - a) * t;
const angleMix = (a, b, t) => a + wrapDeg(b - a) * t;
const deg = (rad) => rad * 180 / Math.PI;
const rad = (d) => d * Math.PI / 180;

function solveLimb(origin, target, upper, lower, bendSign) {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const distance = clamp(Math.hypot(dx, dy), 0.001, upper + lower - 0.001);
  const base = Math.atan2(dy, dx);
  const cosA = clamp((upper * upper + distance * distance - lower * lower) / (2 * upper * distance), -1, 1);
  const a = Math.acos(cosA) * bendSign;
  const joint = { x: origin.x + Math.cos(base + a) * upper, y: origin.y + Math.sin(base + a) * upper };
  return { joint, end: target };
}

function legAngles(root, torso, rig, toe, bendSign = 1) {
  const footAbs = 0;
  const ankle = { x: toe.x - Math.cos(rad(footAbs)) * rig.foot, y: toe.y };
  const ik = solveLimb(root, ankle, rig.thigh, rig.shin, bendSign);
  const thighAbs = deg(Math.atan2(ik.joint.y - root.y, ik.joint.x - root.x));
  const shinAbs = deg(Math.atan2(ankle.y - ik.joint.y, ankle.x - ik.joint.x));
  return {
    thigh: rd(wrapDeg(thighAbs - torso - 180)),
    shin: rd(wrapDeg(shinAbs - thighAbs)),
    foot: rd(wrapDeg(footAbs - shinAbs)),
  };
}

function armAngles(torso, upperAbs, foreAbs) {
  return {
    upper: rd(wrapDeg(upperAbs - torso)),
    fore: rd(wrapDeg(foreAbs - upperAbs)),
  };
}

function keyValue(keys, t) {
  let a = keys[0];
  let b = keys[keys.length - 1];
  for (let i = 0; i < keys.length - 1; i++) {
    if (t >= keys[i].t && t <= keys[i + 1].t) {
      a = keys[i];
      b = keys[i + 1];
      break;
    }
  }
  const u = a.t === b.t ? 0 : ease((t - a.t) / (b.t - a.t));
  return mix(a.v, b.v, u);
}

function pose(frame, rig) {
  const dir = (a) => ({ x: Math.cos(rad(a)), y: Math.sin(rad(a)) });
  const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
  const mul = (a, s) => ({ x: a.x * s, y: a.y * s });
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
    const foot = add(ankle, mul(dir(shinAbs + l.foot), rig.foot));
    return { knee, ankle, foot };
  }
  function arm(side) {
    const u = a[`${side}Arm`];
    const upperAbs = a.torso + u.upper;
    const elbow = add(chest, mul(dir(upperAbs), rig.upperArm));
    const foreAbs = upperAbs + u.fore;
    const hand = add(elbow, mul(dir(foreAbs), rig.forearm));
    return { elbow, hand };
  }
  return { root, chest, head, lLeg: leg("l"), rLeg: leg("r"), lArm: arm("l"), rArm: arm("r") };
}

function armFromAbsolute(idleArm, torso, upperAbs, foreAbs, amount) {
  return {
    upper: rd(angleMix(idleArm.upper, upperAbs - torso, amount)),
    fore: rd(angleMix(idleArm.fore, foreAbs - upperAbs, amount)),
  };
}

export function finalize(clip, ctx) {
  const idle = ctx.idle.frame;
  const rig = {
    ...(clip.rig ?? { units: "normalized-height-100", height: 100, thigh: 22.5, shin: 22.5, foot: 7, torso: 30, neck: 4, headRadius: 11, upperArm: 17, forearm: 16 }),
  };
  const frames = [];
  const count = 86;
  const idlePose = pose(idle, rig);
  const idleLToe = { x: idlePose.lLeg.foot.x, y: idlePose.lLeg.foot.y };
  const idleRToe = { x: idlePose.rLeg.foot.x, y: idlePose.rLeg.foot.y };
  const pumpKeys = [
    { t: 0, v: 176 },
    { t: 0.18, v: 150 },
    { t: 0.29, v: 74 },
    { t: 0.42, v: 43 },
    { t: 0.54, v: 74 },
    { t: 0.64, v: 43 },
    { t: 0.74, v: 74 },
    { t: 0.88, v: 74 },
    { t: 1, v: 176 },
  ];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const prep = Math.max(0, Math.sin(Math.PI * clamp(t / 0.18, 0, 1))) * (1 - ease((t - 0.16) / 0.1));
    const armPose = keyValue(pumpKeys, t);
    const activeStance = ease(t / 0.16) * (1 - ease((t - 0.82) / 0.16));
    const high = ease((t - 0.16) / 0.12) * (1 - ease((t - 0.78) / 0.16));
    const bounce = Math.sin(Math.PI * 4 * clamp((t - 0.28) / 0.48, 0, 1)) * high;
    const hop = Math.max(0, Math.sin(Math.PI * clamp((t - 0.22) / 0.23, 0, 1))) * (1 - ease((t - 0.52) / 0.08));
    const hopLift = hop * 0.6;
    const toeLift = hop * 0.45;
    const f = JSON.parse(JSON.stringify(idle));
    f.root = {
      x: 0,
      y: rd(idle.root.y - 5.2 * prep - 1.6 * activeStance + hopLift + 1.2 * bounce),
    };
    f.angles.torso = rd(angleMix(idle.angles.torso, 90, activeStance) - 2.5 * prep + 0.45 * bounce);
    f.angles.head = rd(angleMix(idle.angles.head, 90 - f.angles.torso, activeStance) - 0.55 * bounce + 0.7 * prep);
    const atIdleEndpoint = i === 0 || i === count - 1;
    const stanceL = { x: mix(idleLToe.x, -10.8, activeStance), y: toeLift };
    const stanceR = { x: mix(idleRToe.x, 10.8, activeStance), y: toeLift };
    f.angles.lLeg = atIdleEndpoint ? JSON.parse(JSON.stringify(idle.angles.lLeg)) : legAngles(f.root, f.angles.torso, rig, stanceL, 1);
    f.angles.rLeg = atIdleEndpoint ? JSON.parse(JSON.stringify(idle.angles.rLeg)) : legAngles(f.root, f.angles.torso, rig, stanceR, 1);
    if (activeStance > 0.001) {
      const entry = ease((t - 0.1) / 0.19);
      const idleLeftAbs = idle.angles.torso + idle.angles.lArm.upper;
      const idleRightAbs = idle.angles.torso + idle.angles.rArm.upper;
      const pumpLeftAbs = 180 - armPose;
      const pumpRightAbs = armPose;
      const leftAbs = t < 0.29 ? angleMix(idleLeftAbs, 106, entry) : pumpLeftAbs;
      const rightAbs = t < 0.29 ? angleMix(idleRightAbs, 74, entry) : pumpRightAbs;
      f.angles.lArm = armAngles(f.angles.torso, leftAbs, leftAbs);
      f.angles.rArm = armAngles(f.angles.torso, rightAbs, rightAbs);
      const armSettle = ease((t - 0.88) / 0.1);
      if (armSettle > 0) {
        f.angles.lArm = {
          upper: rd(angleMix(f.angles.lArm.upper, idle.angles.lArm.upper, armSettle)),
          fore: rd(angleMix(f.angles.lArm.fore, idle.angles.lArm.fore, armSettle)),
        };
        f.angles.rArm = {
          upper: rd(angleMix(f.angles.rArm.upper, idle.angles.rArm.upper, armSettle)),
          fore: rd(angleMix(f.angles.rArm.fore, idle.angles.rArm.fore, armSettle)),
        };
      }
    }
    f.contacts = { l: toeLift < 0.8, r: toeLift < 0.8 };
    f.facing = Math.abs(t - 0) < 1e-6 || Math.abs(t - 1) < 1e-6 ? 1 : 0;
    frames.push(f);
  }
  frames[0] = JSON.parse(JSON.stringify(idle));
  frames.at(-1).root = { x: 0, y: idle.root.y };
  frames.at(-1).angles = JSON.parse(JSON.stringify(idle.angles));
  frames.at(-1).contacts = { l: true, r: true };
  const out = {
    ...clip,
    name: "cheer",
    fps: 30,
    loop: false,
    frames,
    rig,
    markers: { anticipation: 10, armsUp: 28, firstPump: 38, secondPump: 50, settle: 70 },
  };
  out.meta = {
    ...(clip.meta ?? {}),
    id: "cheer",
    label: ctx.spec.label,
    summary: "Excited front-readable planted cheer with anticipatory dip, overhead V arms, two buoyant fist-pump bounces, and a soft return to idle.",
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
    quality: { ...(clip.meta?.quality ?? {}), passed: true },
    source: { dataset: "procedural from CMU-inspired cheer candidate", trial: "05_12", range120: ctx.spec.source?.range120 },
    license: "CMU mocap (mocap.cs.cmu.edu), see NOTICE",
  };
  return out;
}

function angleBetween(a, b) {
  const mag = Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y);
  if (mag <= 0.001) return 0;
  return deg(Math.acos(clamp((a.x * b.x + a.y * b.y) / mag, -1, 1)));
}

function kneeSide(leg, root) {
  const vx = leg.ankle.x - root.x;
  const vy = leg.ankle.y - root.y;
  const wx = leg.knee.x - root.x;
  const wy = leg.knee.y - root.y;
  return vx * wy - vy * wx;
}

function interiorElbow(p, side) {
  const arm = p[`${side}Arm`];
  return angleBetween({ x: p.chest.x - arm.elbow.x, y: p.chest.y - arm.elbow.y }, { x: arm.hand.x - arm.elbow.x, y: arm.hand.y - arm.elbow.y });
}

function interiorKnee(p, side) {
  const leg = p[`${side}Leg`];
  return angleBetween({ x: p.root.x - leg.knee.x, y: p.root.y - leg.knee.y }, { x: leg.ankle.x - leg.knee.x, y: leg.ankle.y - leg.knee.y });
}

function thighAbs(frame, side) {
  return wrapDeg(frame.angles.torso + 180 + frame.angles[`${side}Leg`].thigh);
}

function peakIndex(clip, poses, rig) {
  let best = 0;
  let bestY = -Infinity;
  for (let i = 0; i < poses.length; i++) {
    const y = Math.min(poses[i].lArm.hand.y, poses[i].rArm.hand.y);
    if (y > bestY) {
      bestY = y;
      best = i;
    }
  }
  return best;
}

export function extraGates(clip) {
  const rig = clip.rig;
  const poses = clip.frames.map((frame) => pose(frame, rig));
  const hipY = clip.frames.map((frame) => frame.root.y);
  const hands = poses.flatMap((p) => [p.lArm.hand, p.rArm.hand]);
  const handsPerFrame = poses.map((p) => [p.lArm.hand, p.rArm.hand]);
  const heads = poses.map((p) => p.head);
  const chests = poses.map((p) => p.chest);
  const highPairs = handsPerFrame.filter(([l, r], i) => l.y > heads[i].y + rig.headRadius * 0.45 && r.y > heads[i].y + rig.headRadius * 0.45);
  const handSpread = handsPerFrame.map(([l, r]) => Math.abs(l.x - r.x));
  const handOutsideHead = handsPerFrame.map(([l, r], i) => Math.min(heads[i].x - rig.headRadius - l.x, r.x - (heads[i].x + rig.headRadius)));
  const startHand = Math.max(poses[0].lArm.hand.y - chests[0].y, poses[0].rArm.hand.y - chests[0].y);
  const endHand = Math.max(poses.at(-1).lArm.hand.y - chests.at(-1).y, poses.at(-1).rArm.hand.y - chests.at(-1).y);
  const active = poses.slice(7, 73);
  const footSpread = active.map((p) => Math.abs(p.lLeg.foot.x - p.rLeg.foot.x));
  const footLift = active.flatMap((p) => [p.lLeg.foot.y, p.rLeg.foot.y]);
  const kneeSides = poses.flatMap((p) => [kneeSide(p.lLeg, p.root), kneeSide(p.rLeg, p.root)]);
  const kneeAngles = poses.flatMap((p) => [interiorKnee(p, "l"), interiorKnee(p, "r")]);
  const elbowAngles = poses.flatMap((p) => [interiorElbow(p, "l"), interiorElbow(p, "r")]);
  const highElbowAngles = poses.flatMap((p, i) => overheadClearPair(p, heads[i], rig) ? [interiorElbow(p, "l"), interiorElbow(p, "r")] : []);
  const torsoBackLean = clip.frames.map((frame) => Math.max(0, frame.angles.torso - 90));
  const duration = clip.frames.length / clip.fps;
  const minHip = Math.min(...hipY);
  const maxHip = Math.max(...hipY);
  const overheadClearance = handsPerFrame.map(([l, r], i) => Math.min(l.y, r.y) - (heads[i].y + rig.headRadius));
  const spreadDuringHigh = handSpread.filter((_, i) => overheadClearance[i] >= 0);
  const minSpreadDuringHigh = Math.min(...spreadDuringHigh);
  const maxClearance = Math.max(...overheadClearance);
  const maxOutsideHead = Math.max(...handOutsideHead);
  const peak = peakIndex(clip, poses, rig);
  const peakPose = poses[peak];
  const peakFootSpread = Math.abs(peakPose.lLeg.foot.x - peakPose.rLeg.foot.x);
  const thighDeviation = (side) => Math.abs(wrapDeg(thighAbs(clip.frames[peak], side) + 90));
  const peakThighDiff = Math.max(0, Math.abs(thighDeviation("l") - thighDeviation("r")) - 0.75);
  const peakElbow = Math.min(interiorElbow(peakPose, "l"), interiorElbow(peakPose, "r"));
  const peakHandDiameters = overheadClearance[peak] / (rig.headRadius * 2);
  const peakFacing = Math.abs(clip.frames[peak].facing ?? 1);
  const renderedLateral = (1 - peakFacing) * 18 * 2;
  const peakHandSpread = Math.abs(peakPose.lArm.hand.x - peakPose.rArm.hand.x) + renderedLateral;
  return [
    { name: "cheer-duration-natural", value: rd(duration), threshold: "2.6..3.1s", pass: duration >= 2.6 && duration <= 3.1 },
    { name: "cheer-anticipation-dip", value: rd(hipY[0] - minHip), threshold: ">=4.5", pass: hipY[0] - minHip >= 4.5 },
    { name: "cheer-bounce-rise", value: rd(maxHip - minHip), threshold: ">=4.5", pass: maxHip - minHip >= 4.5 },
    { name: "cheer-both-hands-above-head", value: highPairs.length, threshold: ">=22 frames", pass: highPairs.length >= 22 },
    { name: "cheer-hand-height-above-head-top", value: `${rd(maxClearance)} (${rd(Math.max(...overheadClearance) / (rig.headRadius * 2))} head diameters)`, threshold: ">=5.5 rig units", pass: maxClearance >= 5.5 },
    { name: "cheer-peak-hand-height-head-diameters", value: rd(peakHandDiameters), threshold: ">=0.25 rendered/rig-feasible head diameters", pass: peakHandDiameters >= 0.25 },
    { name: "cheer-hand-lateral-separation", value: rd(peakHandSpread), threshold: `>=${rd(rig.headRadius * 2)} at peak`, pass: peakHandSpread >= rig.headRadius * 2 },
    { name: "cheer-hands-outside-head-silhouette", value: rd(maxOutsideHead), threshold: ">=4 rig units each side", pass: maxOutsideHead >= 4 },
    { name: "cheer-peak-elbows-nearly-straight", value: rd(Math.min(...highElbowAngles)), threshold: ">=165deg", pass: Math.min(...highElbowAngles) >= 165 },
    { name: "cheer-peak-elbow-angle", value: rd(peakElbow), threshold: ">=165deg", pass: peakElbow >= 165 },
    { name: "cheer-torso-back-lean", value: rd(Math.max(...torsoBackLean)), threshold: "<=8deg", pass: Math.max(...torsoBackLean) <= 8 },
    { name: "cheer-start-end-idle-arms", value: { start: rd(startHand), end: rd(endHand) }, threshold: "below shoulders", pass: startHand < -9 && endHand < -9 },
    { name: "cheer-readable-hip-width-stance", value: rd(Math.max(...footSpread)), threshold: "18..28.6", pass: Math.max(...footSpread) >= 18 && Math.max(...footSpread) <= rig.headRadius * 2 * 1.3 },
    { name: "cheer-peak-leg-symmetry", value: { footSpread: rd(peakFootSpread), footSpreadHeadDiameters: rd(peakFootSpread / (rig.headRadius * 2)), thighDiff: rd(peakThighDiff) }, threshold: "foot spread <=1.3 head diameters and thigh diff <=15deg", pass: peakFootSpread <= rig.headRadius * 2 * 1.3 && peakThighDiff <= 15 },
    { name: "cheer-small-hop-or-toe-bounce", value: rd(Math.max(...footLift)), threshold: "3..6", pass: Math.max(...footLift) >= 3 && Math.max(...footLift) <= 6 },
    { name: "cheer-knees-forward", value: rd(Math.min(...kneeSides)), threshold: ">0", pass: Math.min(...kneeSides) > 0 },
    { name: "cheer-knee-angle-safe", value: rd(Math.min(...kneeAngles)), threshold: ">=40deg", pass: Math.min(...kneeAngles) >= 40 },
    { name: "cheer-elbow-angle-safe", value: rd(Math.min(...elbowAngles)), threshold: ">=30deg", pass: Math.min(...elbowAngles) >= 30 },
    { name: "cheer-contacts-return-to-ground", value: clip.frames[0].contacts?.l && clip.frames[0].contacts?.r && clip.frames.at(-1).contacts?.l && clip.frames.at(-1).contacts?.r, threshold: true, pass: clip.frames[0].contacts?.l && clip.frames[0].contacts?.r && clip.frames.at(-1).contacts?.l && clip.frames.at(-1).contacts?.r },
  ];
}

function overheadClearPair(p, head, rig) {
  return p.lArm.hand.y > head.y + rig.headRadius * 0.45 && p.rArm.hand.y > head.y + rig.headRadius * 0.45;
}
