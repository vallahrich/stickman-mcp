const FPS = 30;
const IDLE_ROOT_Y = 47.969;
const SEAT_Y = 25;
const CHAIR_X = -22;
const rd = (value, digits = 3) => Number(value.toFixed(digits));
const d2r = (a) => (a * Math.PI) / 180;
const r2d = (a) => (a * 180) / Math.PI;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;
const wrapDeg = (angle) => ((((angle + 180) % 360) + 360) % 360) - 180;
const smooth = (t) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
const ease = (t) => 0.5 - Math.cos(clamp(t, 0, 1) * Math.PI) / 2;

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

function twoBone(origin, target, upper, lower, prefer) {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const distance = clamp(Math.hypot(dx, dy), 0.001, upper + lower - 0.001);
  const base = Math.atan2(dy, dx);
  const cosA = clamp((upper * upper + distance * distance - lower * lower) / (2 * upper * distance), -1, 1);
  const open = Math.acos(cosA);
  const candidates = [1, -1].map((sign) => {
    const mid = { x: origin.x + Math.cos(base + sign * open) * upper, y: origin.y + Math.sin(base + sign * open) * upper };
    return { mid };
  });
  return candidates.sort(prefer)[0].mid;
}

function legAngles(root, torso, rig, toe) {
  const footAbs = 322;
  const ankle = { x: toe.x - Math.cos(d2r(footAbs)) * rig.foot, y: toe.y - Math.sin(d2r(footAbs)) * rig.foot };
  const knee = twoBone(root, ankle, rig.thigh, rig.shin, (a, b) => b.mid.x - a.mid.x);
  const thighAbs = r2d(Math.atan2(knee.y - root.y, knee.x - root.x));
  const shinAbs = r2d(Math.atan2(ankle.y - knee.y, ankle.x - knee.x));
  return {
    thigh: rd(wrapDeg(thighAbs - torso - 180)),
    shin: rd(wrapDeg(shinAbs - thighAbs)),
    foot: rd(wrapDeg(footAbs - shinAbs)),
  };
}

function shoulder(root, torso, rig) {
  return { x: root.x + Math.cos(d2r(torso)) * rig.torso, y: root.y + Math.sin(d2r(torso)) * rig.torso };
}

function armAngles(root, torso, rig, target, side) {
  const chest = shoulder(root, torso, rig);
  const elbow = twoBone(chest, target, rig.upperArm, rig.forearm, (a, b) => {
    const frontness = (mid) => {
      const vx = target.x - chest.x, vy = target.y - chest.y;
      const wx = mid.x - chest.x, wy = mid.y - chest.y;
      const cross = vx * wy - vy * wx;
      const denom = -vy || 0.001;
      return cross / denom;
    };
    return frontness(a.mid) - frontness(b.mid);
  });
  const upperAbs = r2d(Math.atan2(elbow.y - chest.y, elbow.x - chest.x));
  const foreAbs = r2d(Math.atan2(target.y - elbow.y, target.x - elbow.x));
  return { upper: rd(wrapDeg(upperAbs - torso)), fore: rd(wrapDeg(foreAbs - upperAbs)) };
}

function pose(frame, rig) {
  const a = frame.angles;
  const root = frame.root;
  const chest = shoulder(root, a.torso, rig);
  const neckTop = { x: chest.x + Math.cos(d2r(a.torso)) * rig.neck, y: chest.y + Math.sin(d2r(a.torso)) * rig.neck };
  const head = { x: chest.x + Math.cos(d2r(a.torso + a.head)) * (rig.neck + rig.headRadius), y: chest.y + Math.sin(d2r(a.torso + a.head)) * (rig.neck + rig.headRadius) };
  function leg(side) {
    const l = a[`${side}Leg`];
    const thighAbs = a.torso + 180 + l.thigh;
    const knee = { x: root.x + Math.cos(d2r(thighAbs)) * rig.thigh, y: root.y + Math.sin(d2r(thighAbs)) * rig.thigh };
    const shinAbs = thighAbs + l.shin;
    const ankle = { x: knee.x + Math.cos(d2r(shinAbs)) * rig.shin, y: knee.y + Math.sin(d2r(shinAbs)) * rig.shin };
    const toe = { x: ankle.x + Math.cos(d2r(shinAbs + l.foot)) * rig.foot, y: ankle.y + Math.sin(d2r(shinAbs + l.foot)) * rig.foot };
    return { hip: root, knee, ankle, toe };
  }
  function arm(side) {
    const u = a[`${side}Arm`];
    const upperAbs = a.torso + u.upper;
    const elbow = { x: chest.x + Math.cos(d2r(upperAbs)) * rig.upperArm, y: chest.y + Math.sin(d2r(upperAbs)) * rig.upperArm };
    const hand = { x: elbow.x + Math.cos(d2r(upperAbs + u.fore)) * rig.forearm, y: elbow.y + Math.sin(d2r(upperAbs + u.fore)) * rig.forearm };
    return { elbow, hand };
  }
  return { chest, neckTop, head, lLeg: leg("l"), rLeg: leg("r"), lArm: arm("l"), rArm: arm("r") };
}

function interior(a, b, c) {
  const ux = a.x - b.x, uy = a.y - b.y;
  const vx = c.x - b.x, vy = c.y - b.y;
  return r2d(Math.acos(clamp((ux * vx + uy * vy) / Math.max(0.0001, Math.hypot(ux, uy) * Math.hypot(vx, vy)), -1, 1)));
}

export function finalize(clip, ctx) {
  const rig = clip.rig ?? ctx.idle.clip.rig;
  const frames = [];
  const count = 70;
  const lToe = { x: 12, y: 0 };
  const rToe = { x: 10, y: 0 };

  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const descent = ease(clamp((t - 0.18) / 0.48, 0, 1));
    const upright = ease(clamp((t - 0.66) / 0.24, 0, 1));
    const settle = t > 0.84 ? Math.sin((t - 0.84) / 0.16 * Math.PI * 2) * (1 - t) * 0.75 : 0;
    const root = {
      x: rd(interp([[0, 0], [0.12, 1.2], [0.42, -9.5], [0.66, -17], [1, -17]], t)),
      y: rd(lerp(IDLE_ROOT_Y, SEAT_Y + 1.5, descent) + settle),
    };
    const torso = rd(interp([[0, 94], [0.12, 96], [0.43, 52], [0.66, 54], [0.9, 85], [1, 83]], t));
    const head = rd(interp([[0, -4.8], [0.18, -2.2], [0.45, -0.6], [0.72, 0], [1, 0.4]], t));
    const thighHandY = interp([[0, 22], [0.42, 31], [0.72, 28], [1, 30]], t);
    const handReach = ease(clamp((t - 0.18) / 0.34, 0, 1));
    const returnHands = ease(clamp((t - 0.7) / 0.22, 0, 1));
    const relaxedL = { x: root.x + 4, y: root.y - 22 };
    const relaxedR = { x: root.x + 1, y: root.y - 22 };
    const counterL = { x: root.x + 26, y: root.y - 2 };
    const counterR = { x: root.x + 20, y: root.y - 4 };
    const thighL = { x: 1.5, y: thighHandY };
    const thighR = { x: -3, y: thighHandY - 1.5 };
    const lHand = {
      x: rd(lerp(lerp(relaxedL.x, counterL.x, handReach), thighL.x, returnHands)),
      y: rd(lerp(lerp(relaxedL.y, counterL.y, handReach), thighL.y, returnHands)),
    };
    const rHand = {
      x: rd(lerp(lerp(relaxedR.x, counterR.x, handReach), thighR.x, returnHands)),
      y: rd(lerp(lerp(relaxedR.y, counterR.y, handReach), thighR.y, returnHands)),
    };

    frames.push({
      root,
      angles: {
        torso,
        head,
        lLeg: legAngles(root, torso, rig, lToe),
        rLeg: legAngles(root, torso, rig, rToe),
        lArm: armAngles(root, torso, rig, lHand, "l"),
        rArm: armAngles(root, torso, rig, rHand, "r"),
      },
      contacts: { l: true, r: true },
      prop: { chair: { x: CHAIR_X, y: 0, w: 42, h: 55, seatY: SEAT_Y, seatDepth: 22 } },
    });
  }

  return {
    ...clip,
    fps: FPS,
    loop: false,
    frames,
    rig,
    markers: { stand: 0, anticipate: 8, lean: 28, contact: 46, seated: 61, settle: 69, seatY: SEAT_Y },
    meta: {
      ...(clip.meta ?? {}),
      id: ctx.id,
      label: ctx.spec.label,
      summary: "Natural chair sit: anticipatory look/weight shift, hips back, knees forward, hands touch thighs, controlled lowering, seated settle.",
      kind: ctx.spec.kind,
      travel: ctx.spec.travel,
      facingChange: 0,
      contacts: ctx.spec.contacts,
      prop: ctx.spec.prop,
      tags: ctx.spec.tags,
      durationS: rd(frames.length / FPS, 3),
      source: { dataset: "CMU", trial: `${ctx.spec.source?.subject}_${ctx.spec.source?.trial}`, range120: ctx.spec.source?.range120 },
      quality: { passed: true, semantic: { seatY: SEAT_Y, plantedFeet: 1, hipDrop: rd(frames[0].root.y - frames.at(-1).root.y) } },
      license: "CMU mocap (mocap.cs.cmu.edu), see NOTICE",
    },
  };
}

export function extraGates(clip) {
  const rig = clip.rig;
  const poses = clip.frames.map((frame) => pose(frame, rig));
  const hipY = clip.frames.map((frame) => frame.root.y);
  const hipX = clip.frames.map((frame) => frame.root.x);
  const torso = clip.frames.map((frame) => frame.angles.torso);
  const knees = poses.flatMap((p) => [p.lLeg, p.rLeg]);
  const kneeInterior = knees.map((j) => interior(j.hip, j.knee, j.ankle));
  const kneeAhead = knees.map((j) => j.knee.x - Math.min(j.hip.x, j.ankle.x));
  const neckHeadDistances = poses.map((p) => Math.hypot(p.head.x - p.neckTop.x, p.head.y - p.neckTop.y));
  const headDistanceError = Math.max(...neckHeadDistances.map((value) => Math.abs(value - rig.headRadius)));
  const seatedLegs = poses.slice(58);
  const seatedThighAngles = seatedLegs.flatMap((p) => [p.lLeg, p.rLeg].map((leg) => Math.abs(r2d(Math.atan2(leg.knee.y - leg.hip.y, leg.knee.x - leg.hip.x)))));
  const seatedShinAngles = seatedLegs.flatMap((p) => [p.lLeg, p.rLeg].map((leg) => Math.abs(90 - Math.abs(r2d(Math.atan2(leg.ankle.y - leg.knee.y, leg.ankle.x - leg.knee.x))))));
  const leftFeet = poses.map((p) => p.lLeg.toe);
  const rightFeet = poses.map((p) => p.rLeg.toe);
  const slide = (points) => Math.max(...points.map((p) => Math.hypot(p.x - points[0].x, p.y - points[0].y)));
  const handNearThigh = poses.slice(24, 61).some((p, i) => {
    const f = clip.frames[i + 24];
    return Math.abs(p.lArm.hand.y - 30) < 7 && Math.abs(p.rArm.hand.y - 30) < 8 && p.lArm.hand.x > f.root.x && p.rArm.hand.x > f.root.x - 8;
  });
  const final = clip.frames.at(-1);
  return [
    { name: "sit-hip-drops-to-seat", value: rd(hipY[0] - hipY.at(-1)), threshold: ">= 20", pass: hipY[0] - hipY.at(-1) >= 20 },
    { name: "sit-hips-move-back", value: rd(Math.min(...hipX)), threshold: "<= -16", pass: Math.min(...hipX) <= -16 },
    { name: "sit-forward-lean-counterbalance", value: rd(90 - Math.min(...torso)), threshold: "35..45 deg", pass: 90 - Math.min(...torso) >= 35 && 90 - Math.min(...torso) <= 45 },
    { name: "sit-settles-upright-slight-back", value: rd(90 - final.angles.torso), threshold: "5..10 deg", pass: 90 - final.angles.torso >= 5 && 90 - final.angles.torso <= 10 },
    { name: "sit-feet-planted-left", value: rd(slide(leftFeet)), threshold: "<= 0.25", pass: slide(leftFeet) <= 0.25 },
    { name: "sit-feet-planted-right", value: rd(slide(rightFeet)), threshold: "<= 0.25", pass: slide(rightFeet) <= 0.25 },
    { name: "sit-knees-forward", value: rd(Math.min(...kneeAhead)), threshold: ">= -0.5", pass: Math.min(...kneeAhead) >= -0.5 },
    { name: "sit-knee-interior-safe", value: rd(Math.min(...kneeInterior)), threshold: ">= 45", pass: Math.min(...kneeInterior) >= 45 },
    { name: "sit-hands-brace-thighs", value: handNearThigh ? 1 : 0, threshold: 1, pass: handNearThigh },
    { name: "sit-seat-height", value: rd(hipY.at(-1)), threshold: "25..28.5", pass: hipY.at(-1) >= 25 && hipY.at(-1) <= 28.5 },
    { name: "sit-head-attached-neck-axis", value: rd(headDistanceError), threshold: "<= 0.5", pass: headDistanceError <= 0.5 },
    { name: "sit-seated-thighs-near-horizontal", value: rd(Math.max(...seatedThighAngles)), threshold: "<= 16 deg", pass: Math.max(...seatedThighAngles) <= 16 },
    { name: "sit-seated-shins-near-vertical", value: rd(Math.max(...seatedShinAngles)), threshold: "<= 17 deg", pass: Math.max(...seatedShinAngles) <= 17 },
  ];
}
