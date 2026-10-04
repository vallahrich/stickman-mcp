const rd = (value, digits = 3) => Number(value.toFixed(digits));
const deg = (rad) => rad * 180 / Math.PI;
const len = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function wrapDeg(angle) {
  return ((((angle + 180) % 360) + 360) % 360) - 180;
}

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

function armAngles(root, torso, rig, target, bendSign) {
  const chest = {
    x: root.x + Math.cos(torso * Math.PI / 180) * rig.torso,
    y: root.y + Math.sin(torso * Math.PI / 180) * rig.torso,
  };
  const ik = solveLimb(chest, target, rig.upperArm, rig.forearm, bendSign);
  const upperAbs = deg(Math.atan2(ik.joint.y - chest.y, ik.joint.x - chest.x));
  const foreAbs = deg(Math.atan2(target.y - ik.joint.y, target.x - ik.joint.x));
  return { upper: rd(wrapDeg(upperAbs - torso)), fore: rd(wrapDeg(foreAbs - upperAbs)) };
}

function legAngles(root, torso, rig, toe, bendSign) {
  const footAbs = 0;
  const ankle = {
    x: toe.x - Math.cos(footAbs * Math.PI / 180) * rig.foot,
    y: toe.y - Math.sin(footAbs * Math.PI / 180) * rig.foot,
  };
  const ik = solveLimb(root, ankle, rig.thigh, rig.shin, bendSign);
  const thighAbs = deg(Math.atan2(ik.joint.y - root.y, ik.joint.x - root.x));
  const shinAbs = deg(Math.atan2(ankle.y - ik.joint.y, ankle.x - ik.joint.x));
  return {
    thigh: rd(wrapDeg(thighAbs - torso - 180)),
    shin: rd(wrapDeg(shinAbs - thighAbs)),
    foot: rd(wrapDeg(footAbs - shinAbs)),
  };
}

function smoothStep(t) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function footCycle(phase, sideOffset) {
  const p = (phase + sideOffset) % 1;
  if (p < 0.5) {
    const u = p / 0.5;
    return { x: -36 + 28 * u, y: 0, lift: 0, contact: true };
  }
  const u = (p - 0.5) / 0.5;
  return { x: -8 - 28 * smoothStep(u), y: Math.sin(Math.PI * u) * 6, lift: Math.sin(Math.PI * u) * 6, contact: false };
}

export function finalize(clip) {
  const rig = { ...(clip.rig ?? { torso: 30, neck: 4, headRadius: 11, upperArm: 17, forearm: 16, thigh: 22.5, shin: 22.5, foot: 7 }), thigh: 28, shin: 36 };
  const frames = [];
  const count = 73;
  const stride = 78;
  for (let i = 0; i < count; i++) {
    const phase = i / (count - 1);
    const root = { x: rd(stride * phase), y: rd(52 + 1.1 * Math.sin(phase * Math.PI * 4 + 0.35)) };
    const torso = rd(36.5 + 1.8 * Math.sin(phase * Math.PI * 4 - 0.5));
    const handBase = {
      x: root.x + 54 + 0.6 * Math.sin(phase * Math.PI * 4 + 0.15),
      y: 52.85 + 0.5 * Math.sin(phase * Math.PI * 4 + 0.5),
    };
    const lHand = { x: handBase.x + 0.8, y: handBase.y + 1.2 };
    const rHand = { x: handBase.x - 0.8, y: handBase.y - 1.2 };
    const lToe = footCycle(phase, 0);
    const rToe = footCycle(phase, 0.5);
    frames.push({
      root,
      angles: {
        torso,
        head: rd(45 - torso + 1.4 * Math.sin(phase * Math.PI * 4 + 1.2)),
        lLeg: legAngles(root, torso, rig, { x: root.x + lToe.x, y: lToe.y, lift: lToe.lift }, 1),
        rLeg: legAngles(root, torso, rig, { x: root.x + rToe.x, y: rToe.y, lift: rToe.lift }, 1),
        lArm: armAngles(root, torso, rig, lHand, 1),
        rArm: armAngles(root, torso, rig, rHand, -1),
      },
      contacts: { l: lToe.contact, r: rToe.contact },
      hands: { l: true, r: true },
      prop: { box: { x: rd(root.x + 84 + 0.6 * Math.sin(phase * Math.PI * 4 + 0.15)), y: 0, w: 60, h: 65 } },
    });
  }
  frames[frames.length - 1].angles = JSON.parse(JSON.stringify(frames[0].angles));
  frames[frames.length - 1].contacts = JSON.parse(JSON.stringify(frames[0].contacts));
  frames[frames.length - 1].hands = JSON.parse(JSON.stringify(frames[0].hands));
  frames[frames.length - 1].prop = JSON.parse(JSON.stringify(frames[0].prop));
  frames[frames.length - 1].root.x = stride;
  frames[frames.length - 1].root.y = frames[0].root.y;
  frames[frames.length - 1].prop.box.x = rd(frames[0].prop.box.x + stride);
  return { ...clip, rig, fps: 30, loop: true, frames, strideLength: stride, markers: { contactStart: 0, contactEnd: frames.length - 1, loop: [0, frames.length - 1] } };
}

function pose(frame, rig) {
  const d = (a) => ({ x: Math.cos(a * Math.PI / 180), y: Math.sin(a * Math.PI / 180) });
  const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
  const mul = (a, s) => ({ x: a.x * s, y: a.y * s });
  const a = frame.angles;
  const root = frame.root;
  const chest = add(root, mul(d(a.torso), rig.torso));
  const head = add(chest, mul(d(a.torso + a.head), rig.neck + rig.headRadius));
  function leg(side) {
    const l = a[`${side}Leg`];
    const thighAbs = a.torso + 180 + l.thigh;
    const knee = add(root, mul(d(thighAbs), rig.thigh));
    const shinAbs = thighAbs + l.shin;
    const ankle = add(knee, mul(d(shinAbs), rig.shin));
    const toe = add(ankle, mul(d(shinAbs + l.foot), rig.foot));
    return { knee, ankle, toe };
  }
  function arm(side) {
    const u = a[`${side}Arm`];
    const upperAbs = a.torso + u.upper;
    const elbow = add(chest, mul(d(upperAbs), rig.upperArm));
    const hand = add(elbow, mul(d(upperAbs + u.fore), rig.forearm));
    return { hand };
  }
  const lLeg = leg("l");
  const rLeg = leg("r");
  return { chest, head, lLeg, rLeg, lFoot: lLeg.toe, rFoot: rLeg.toe, lHand: arm("l").hand, rHand: arm("r").hand };
}

function circleRectClearance(center, radius, rect) {
  const x = clamp(center.x, rect.left, rect.right);
  const y = clamp(center.y, rect.bottom, rect.top);
  return Math.hypot(center.x - x, center.y - y) - radius;
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

export function extraGates(clip) {
  const rig = clip.rig;
  const poses = clip.frames.map((frame) => pose(frame, rig));
  const torso = clip.frames.map((frame) => frame.angles.torso);
  const torsoFromVertical = torso.map((angle) => 90 - angle);
  const handHeights = poses.flatMap((p) => [p.lHand.y, p.rHand.y]);
  const handOffsets = poses.flatMap((p, i) => [p.lHand.x - clip.frames[i].root.x, p.rHand.x - clip.frames[i].root.x]);
  const handGap = poses.map((p) => len(p.lHand, p.rHand));
  const footSpread = poses.map((p) => Math.abs(p.lFoot.x - p.rFoot.x));
  const footOffsets = poses.flatMap((p, i) => [p.lFoot.x - clip.frames[i].root.x, p.rFoot.x - clip.frames[i].root.x]);
  const backFootOffsets = poses.map((p, i) => Math.min(p.lFoot.x - clip.frames[i].root.x, p.rFoot.x - clip.frames[i].root.x));
  const backHipAngles = poses.map((p, i) => {
    const root = clip.frames[i].root;
    const backFoot = p.lFoot.x < p.rFoot.x ? p.lFoot : p.rFoot;
    return angleBetween({ x: p.chest.x - root.x, y: p.chest.y - root.y }, { x: backFoot.x - root.x, y: backFoot.y - root.y });
  });
  const kneeSides = poses.flatMap((p, i) => [kneeSide(p.lLeg, clip.frames[i].root), kneeSide(p.rLeg, clip.frames[i].root)]);
  const trueBackKneeAngles = poses.map((p, i) => {
    const leg = p.lFoot.x < p.rFoot.x ? p.lLeg : p.rLeg;
    const root = clip.frames[i].root;
    return angleBetween({ x: root.x - leg.knee.x, y: root.y - leg.knee.y }, { x: leg.ankle.x - leg.knee.x, y: leg.ankle.y - leg.knee.y });
  });
  const pushOffBackKneeAngles = trueBackKneeAngles.filter((_, i) => backFootOffsets[i] <= -34);
  const frontKneeAhead = [18, 54].map((i) => {
    const p = poses[i];
    const frontLeg = p.lFoot.x > p.rFoot.x ? p.lLeg : p.rLeg;
    return frontLeg.knee.x - clip.frames[i].root.x;
  });
  const armLengths = poses.flatMap((p) => [len(p.chest, p.lHand), len(p.chest, p.rHand)]);
  const hipHeights = clip.frames.map((frame) => frame.root.y);
  const shoulderHeights = poses.map((p) => p.chest.y);
  const headHeights = poses.map((p) => p.head.y);
  const heelHeadAngles = poses.map((p) => {
    const backFoot = p.lFoot.x < p.rFoot.x ? p.lFoot : p.rFoot;
    return deg(Math.atan2(Math.abs(p.head.x - backFoot.x), Math.max(0.001, p.head.y - backFoot.y)));
  });
  const headClearances = poses.map((p, i) => {
    const b = clip.frames[i].prop?.box;
    if (!b) return Infinity;
    return circleRectClearance(p.head, rig.headRadius, { left: b.x - b.w / 2, right: b.x + b.w / 2, bottom: b.y, top: b.y + b.h });
  });
  const handOffsetSpread = Math.max(...handOffsets) - Math.min(...handOffsets);
  return [
    { name: "push-torso-angle-from-vertical", value: `${rd(Math.min(...torsoFromVertical))}..${rd(Math.max(...torsoFromVertical))}`, threshold: "35..60deg", pass: Math.min(...torsoFromVertical) >= 35 && Math.max(...torsoFromVertical) <= 60 },
    { name: "push-heel-head-line", value: `${rd(Math.min(...heelHeadAngles))}..${rd(Math.max(...heelHeadAngles))}`, threshold: "35..50deg from vertical", pass: Math.min(...heelHeadAngles) >= 35 && Math.max(...heelHeadAngles) <= 50 },
    { name: "push-knees-forward-side", value: rd(Math.min(...kneeSides)), threshold: ">0", pass: Math.min(...kneeSides) > 0 },
    { name: "push-back-knee-angle-pushoff", value: rd(Math.min(...pushOffBackKneeAngles)), threshold: ">=165deg", pass: pushOffBackKneeAngles.length > 0 && Math.min(...pushOffBackKneeAngles) >= 165 },
    { name: "push-front-knee-ahead-midstance", value: rd(Math.min(...frontKneeAhead)), threshold: ">0", pass: Math.min(...frontKneeAhead) > 0 },
    { name: "push-back-hip-angle", value: rd(Math.min(...backHipAngles)), threshold: ">=145deg", pass: Math.min(...backHipAngles) >= 145 },
    { name: "push-back-foot-behind-hip", value: rd(Math.min(...backFootOffsets)), threshold: "-38..-30 at push-off", pass: Math.min(...backFootOffsets) >= -38 && Math.min(...backFootOffsets) <= -30 },
    { name: "push-foot-pose-variance", value: rd(Math.max(...footOffsets) - Math.min(...footOffsets)), threshold: ">20", pass: Math.max(...footOffsets) - Math.min(...footOffsets) > 20 },
    { name: "push-head-box-clearance", value: rd(Math.min(...headClearances)), threshold: ">=4", pass: Math.min(...headClearances) >= 4 },
    { name: "push-arm-visible-length", value: rd(Math.min(...armLengths)), threshold: ">=25", pass: Math.min(...armLengths) >= 25 },
    { name: "push-hips-height", value: rd(Math.min(...hipHeights)), threshold: ">=48", pass: Math.min(...hipHeights) >= 48 },
    { name: "push-shoulder-height", value: `${rd(Math.min(...shoulderHeights))}..${rd(Math.max(...shoulderHeights))}`, threshold: "68..72", pass: Math.min(...shoulderHeights) >= 68 && Math.max(...shoulderHeights) <= 72 },
    { name: "push-head-height", value: `${rd(Math.min(...headHeights))}..${rd(Math.max(...headHeights))}`, threshold: "76..84", pass: Math.min(...headHeights) >= 76 && Math.max(...headHeights) <= 84 },
    { name: "push-foot-spread", value: rd(Math.max(...footSpread)), threshold: "<=45", pass: Math.max(...footSpread) <= 45 },
    { name: "push-torso-forward-lean", value: `${rd(Math.min(...torso))}..${rd(Math.max(...torso))}`, threshold: "30..55deg from horizontal", pass: Math.min(...torso) >= 30 && Math.max(...torso) <= 55 },
    { name: "push-hands-box-face-height", value: `${rd(Math.min(...handHeights))}..${rd(Math.max(...handHeights))}`, threshold: "50..56", pass: Math.min(...handHeights) >= 50 && Math.max(...handHeights) <= 56 },
    { name: "push-hands-locked-to-box", value: rd(handOffsetSpread), threshold: "<=4", pass: handOffsetSpread <= 4 },
    { name: "push-two-hands-contact", value: clip.frames.filter((frame) => frame.hands?.l && frame.hands?.r).length, threshold: clip.frames.length, pass: clip.frames.every((frame) => frame.hands?.l && frame.hands?.r) },
    { name: "push-readable-two-hand-spread", value: `${rd(Math.min(...handGap))}..${rd(Math.max(...handGap))}`, threshold: "2..8", pass: Math.min(...handGap) >= 2 && Math.max(...handGap) <= 8 },
    { name: "push-box-size", value: `${clip.frames[0].prop?.box?.w}x${clip.frames[0].prop?.box?.h}`, threshold: "60x65", pass: clip.frames.every((frame) => frame.prop?.box?.w === 60 && frame.prop?.box?.h === 65) },
    { name: "push-travel-loop-stride", value: rd(clip.frames.at(-1).root.x - clip.frames[0].root.x), threshold: ">=60", pass: clip.frames.at(-1).root.x - clip.frames[0].root.x >= 60 },
  ];
}
