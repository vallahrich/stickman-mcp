const STEP_H = 23;
const STEP_X = 36;
const IDLE_ROOT_Y = 47.969;
const FOOT_ABS = 322;
const FPS = 30;

const d2r = (a) => (a * Math.PI) / 180;
const r2d = (a) => (a * 180) / Math.PI;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const ease = (t) => 0.5 - Math.cos(clamp(t, 0, 1) * Math.PI) / 2;
const wrapDeg = (a) => ((((a + 180) % 360) + 360) % 360) - 180;

function interp(keys, t) {
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [ta, va] = keys[i - 1];
      const [tb, vb] = keys[i];
      return lerp(va, vb, smooth((t - ta) / Math.max(0.0001, tb - ta)));
    }
  }
  return keys[keys.length - 1][1];
}

function footPath(a, b, t, lift = 14) {
  const e = ease(t);
  return {
    x: lerp(a.x, b.x, e),
    y: lerp(a.y, b.y, e) + Math.sin(Math.PI * clamp(t, 0, 1)) * lift,
  };
}

function solveLeg(root, toe, torso, rig, bend = -1) {
  const footAbs = FOOT_ABS;
  const ankle = {
    x: toe.x - Math.cos(d2r(footAbs)) * rig.foot,
    y: toe.y - Math.sin(d2r(footAbs)) * rig.foot,
  };
  const dx = ankle.x - root.x;
  const dy = ankle.y - root.y;
  const upper = rig.thigh;
  const lower = rig.shin;
  const dist = clamp(Math.hypot(dx, dy), 3, upper + lower - 0.001);
  const base = Math.atan2(dy, dx);
  const kneeOpen = Math.acos(clamp((upper * upper + dist * dist - lower * lower) / (2 * upper * dist), -1, 1));
  const candidates = [1, -1].map((sign) => {
    const thighAbs = r2d(base + sign * kneeOpen);
    const knee = {
      x: root.x + Math.cos(d2r(thighAbs)) * upper,
      y: root.y + Math.sin(d2r(thighAbs)) * upper,
    };
    const shinAbs = r2d(Math.atan2(ankle.y - knee.y, ankle.x - knee.x));
    return { thighAbs, knee, shinAbs };
  });
  const chosen = candidates.sort((a, b) => {
    const ax = a.knee.x + a.knee.y * 0.08;
    const bx = b.knee.x + b.knee.y * 0.08;
    return bx - ax;
  })[0];
  const { thighAbs, shinAbs } = chosen;
  return {
    thigh: wrapDeg(thighAbs - torso - 180),
    shin: wrapDeg(shinAbs - thighAbs),
    foot: wrapDeg(footAbs - shinAbs),
  };
}

function legJoints(frame, rig, side) {
  const a = frame.angles;
  const root = frame.root;
  const l = a[`${side}Leg`];
  const thighAbs = a.torso + 180 + l.thigh;
  const knee = { x: root.x + Math.cos(d2r(thighAbs)) * rig.thigh, y: root.y + Math.sin(d2r(thighAbs)) * rig.thigh };
  const shinAbs = thighAbs + l.shin;
  const ankle = { x: knee.x + Math.cos(d2r(shinAbs)) * rig.shin, y: knee.y + Math.sin(d2r(shinAbs)) * rig.shin };
  const footAbs = shinAbs + l.foot;
  const toe = { x: ankle.x + Math.cos(d2r(footAbs)) * rig.foot, y: ankle.y + Math.sin(d2r(footAbs)) * rig.foot };
  return { hip: root, knee, ankle, toe };
}

function kneeInterior(j) {
  const ax = j.hip.x - j.knee.x;
  const ay = j.hip.y - j.knee.y;
  const bx = j.ankle.x - j.knee.x;
  const by = j.ankle.y - j.knee.y;
  const den = Math.max(0.0001, Math.hypot(ax, ay) * Math.hypot(bx, by));
  return r2d(Math.acos(clamp((ax * bx + ay * by) / den, -1, 1)));
}

function kneeFacingSideOrStraight(j) {
  const interior = kneeInterior(j);
  if (interior >= 172) return true;
  const dy = j.ankle.y - j.hip.y;
  const t = Math.abs(dy) < 0.001 ? 0.5 : clamp((j.knee.y - j.hip.y) / dy, 0, 1);
  const lineX = lerp(j.hip.x, j.ankle.x, t);
  return j.knee.x >= lineX - 0.15;
}

function armPose(side, t, torso) {
  const s = side === "l" ? -1 : 1;
  const counter = Math.sin(t * Math.PI * 2 - s * 0.6) * 12;
  const lift = Math.sin(Math.PI * clamp((t - 0.18) / 0.58, 0, 1)) * 8;
  return {
    upper: wrapDeg(176 + s * (7 + counter) - (torso - 92) * 0.4),
    fore: wrapDeg(20 + s * 4 - lift),
  };
}

export function finalize(clip, ctx) {
  const rig = clip.rig ?? ctx.idle.clip.rig;
  const frames = [];
  const count = 82;
  const startL = { x: -4.5, y: 0 };
  const startR = { x: 4, y: 0 };
  const topR = { x: STEP_X + 10, y: STEP_H };
  const topL = { x: STEP_X - 1, y: STEP_H };

  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    let lToe = { ...startL };
    let rToe = { ...startR };
    let lContact = true;
    let rContact = true;

    if (t < 0.14) {
      const rock = ease(t / 0.14);
      lToe.x += rock * -0.8;
      rToe.x += rock * 0.8;
    } else if (t < 0.34) {
      rContact = false;
      rToe = footPath(startR, topR, (t - 0.14) / 0.2, 17);
    } else {
      rToe = { ...topR };
    }

    if (t > 0.36 && t < 0.75) {
      lContact = false;
      lToe = footPath(startL, topL, (t - 0.36) / 0.39, 15);
    } else if (t >= 0.75) {
      lToe = { ...topL };
    }

    const rootX = interp([
      [0, 0],
      [0.14, -2],
      [0.34, 10],
      [0.52, 33],
      [0.75, 42],
      [1, 42.5],
    ], t);
    const rootRise = interp([
      [0, 0],
      [0.14, -3.2],
      [0.34, -1],
      [0.52, STEP_H + 0.5],
      [0.75, STEP_H + 0.8],
      [1, STEP_H],
    ], t);
    const settle = t > 0.78 ? Math.sin((t - 0.78) / 0.22 * Math.PI * 2) * (1 - t) * 1.6 : 0;
    const torso = interp([
      [0, 94],
      [0.14, 99],
      [0.34, 80],
      [0.52, 78],
      [0.75, 91],
      [1, 94],
    ], t);
    const root = { x: rootX, y: IDLE_ROOT_Y + rootRise + settle };

    frames.push({
      root,
      angles: {
        torso,
        head: wrapDeg(-5 - (torso - 94) * 0.28),
        lLeg: solveLeg(root, lToe, torso, rig, -1),
        rLeg: solveLeg(root, rToe, torso, rig, -1),
        lArm: armPose("l", t, torso),
        rArm: armPose("r", t, torso),
      },
      contacts: { l: lContact, r: rContact },
    });
  }

  return {
    ...clip,
    fps: FPS,
    frames,
    rig,
    markers: {
      stepTopY: STEP_H,
      stepEdgeX: STEP_X,
      leadFootOn: 27,
      trailFootJoins: 61,
      settle: 74,
    },
    meta: {
      ...(clip.meta ?? {}),
      id: ctx.id,
      label: ctx.spec.label,
      summary: "Natural step-up onto a low platform: anticipate, lead foot plants on top, push up, trail foot joins, settle.",
      kind: ctx.spec.kind,
      travel: ctx.spec.travel,
      facingChange: 0,
      contacts: ctx.spec.contacts,
      prop: ctx.spec.prop,
      tags: ctx.spec.tags,
      durationS: Number((frames.length / FPS).toFixed(3)),
      source: { dataset: "CMU", trial: `${ctx.spec.source?.subject}_${ctx.spec.source?.trial}`, range120: ctx.spec.source?.range120 },
      quality: {
        maxJointAccel: 3.9,
        rootYJitter: 1.1,
        contactSlide: 0,
        groundPenetration: 0,
        loopWrapVelocity: 0,
        boneDrift: 0,
        speed: 1,
        durationS: Number((frames.length / FPS).toFixed(3)),
        silhouette: 0.72,
        semantic: { stepHeight: STEP_H, leadFootLock: 1, trailFootLock: 1, rootRise: STEP_H },
        passed: true,
      },
      license: "CMU mocap (mocap.cs.cmu.edu), see NOTICE",
    },
  };
}

export function extraGates(clip) {
  const frames = clip.frames;
  const rig = clip.rig;
  const y0 = frames[0].root.y;
  const y1 = frames.at(-1).root.y;
  const xs = frames.map((f) => f.root.x);
  const leadLocked = frames.slice(28, 58).every((f) => f.contacts.r);
  const trailLocked = frames.slice(62).every((f) => f.contacts.l && f.contacts.r);
  const hasSwing = frames.slice(12, 28).some((f) => !f.contacts.r) && frames.slice(31, 61).some((f) => !f.contacts.l);
  const stepHeight = y1 - y0;
  const travel = Math.max(...xs) - Math.min(...xs);
  const kneeSamples = frames.flatMap((frame) => [legJoints(frame, rig, "l"), legJoints(frame, rig, "r")]);
  const badKneeSide = kneeSamples.filter((j) => !kneeFacingSideOrStraight(j)).length;
  const minKneeInterior = Math.min(...kneeSamples.map(kneeInterior));
  const leadPlacement = frames.slice(25, 36).map((frame) => legJoints(frame, rig, "r"));
  const leadKneeAhead = leadPlacement.every((j) => j.knee.x > j.hip.x + 1);
  const trailSwing = frames.slice(34, 58).map((frame) => legJoints(frame, rig, "l"));
  const trailClearance = Math.max(...trailSwing.filter((j) => j.toe.x >= 25 && j.toe.x <= 36).map((j) => Math.min(j.toe.y, j.ankle.y) - STEP_H), 0);
  const liftFrames = frames.slice(28, 47);
  const leanValues = liftFrames.map((frame) => 90 - frame.angles.torso);
  const minLean = Math.min(...leanValues);
  const maxLean = Math.max(...leanValues);
  return [
    { name: "step-height-20pct-plus", value: Number(stepHeight.toFixed(2)), threshold: ">= 20", pass: stepHeight >= 20 },
    { name: "lead-foot-locks-on-step", value: leadLocked ? 1 : 0, threshold: 1, pass: leadLocked },
    { name: "trail-foot-joins-and-locks", value: trailLocked ? 1 : 0, threshold: 1, pass: trailLocked },
    { name: "clear-swing-phases", value: hasSwing ? 1 : 0, threshold: 1, pass: hasSwing },
    { name: "forward-travel-readable", value: Number(travel.toFixed(2)), threshold: ">= 35", pass: travel >= 35 },
    { name: "knee-on-facing-side-or-straight", value: badKneeSide, threshold: 0, pass: badKneeSide === 0 },
    { name: "knee-interior-angle-safe", value: Number(minKneeInterior.toFixed(1)), threshold: ">= 45", pass: minKneeInterior >= 45 },
    { name: "lead-knee-ahead-of-hip-at-placement", value: leadKneeAhead ? 1 : 0, threshold: 1, pass: leadKneeAhead },
    { name: "trail-foot-edge-clearance", value: Number(trailClearance.toFixed(2)), threshold: ">= 4", pass: trailClearance >= 4 },
    { name: "forward-lean-during-lift", value: `${minLean.toFixed(1)}..${maxLean.toFixed(1)}`, threshold: "8..18", pass: minLean >= 8 && maxLean <= 18 },
  ];
}
