const rd = (value, digits = 3) => Number(value.toFixed(digits));
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const mix = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);
const pulse = (t, center, width) => Math.max(0, 1 - Math.abs(t - center) / width);

function keyValue(keys, t) {
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (t <= b[0]) return mix(a[1], b[1], ease(clamp01((t - a[0]) / (b[0] - a[0]))));
  }
  return keys.at(-1)[1];
}

function frameAt(t) {
  const turn = ease(clamp01((t - 0.08) / 0.84));
  const front = pulse(t, 0.5, 0.24);
  const stepL = pulse(t, 0.32, 0.13);
  const stepR = pulse(t, 0.68, 0.14);
  const settle = pulse(t, 0.9, 0.12);
  const rootX = keyValue([[0, 0], [0.18, -1.2], [0.32, -4.6], [0.5, 0], [0.68, 4.8], [1, 0]], t);
  const rootY = 46.2 - 2.1 * stepL - 1.8 * stepR - 0.35 * settle;
  const torsoLead = 2.8 * pulse(t, 0.22, 0.18) - 1.2 * settle;
  const headLead = 13 * pulse(t, 0.16, 0.2) + 5 * pulse(t, 0.36, 0.18) - 5 * settle;
  const armOpen = front;
  const counter = 7 * Math.sin((turn * 2 - 0.15) * Math.PI);
  const lLift = stepL;
  const rLift = stepR;
  const exitTurn = clamp01((t - 0.42) / 0.2);
  const lateTurn = clamp01((t - 0.72) / 0.16);
  const lStep = keyValue([[0, 6], [0.28, -18], [0.5, -28], [0.72, -8], [1, 6]], t);
  const rStep = keyValue([[0, 10], [0.28, 8], [0.5, 28], [0.72, -18], [1, 10]], t);
  return {
    root: { x: rd(rootX), y: rd(rootY) },
    angles: {
      torso: rd(90 + torsoLead),
      head: rd(5 + headLead),
      lLeg: {
        thigh: rd(lStep - 10 * lLift),
        shin: rd(-8 - 16 * lLift + 14 * front + 8 * lateTurn),
        foot: rd(62 - 65 * turn - 8 * lLift)
      },
      rLeg: {
        thigh: rd(rStep - 10 * rLift),
        shin: rd(-10 - 15 * rLift - 12 * front + 70 * rLift * exitTurn + 10 * lateTurn + 8 * pulse(t, 0.57, 0.08)),
        foot: rd(61 - 58 * turn - 8 * rLift)
      },
      lArm: {
        upper: rd(mix(168 - counter, 146, armOpen)),
        fore: rd(mix(20, 35, armOpen) - 16 * pulse(t, 0.61, 0.1) - 18 * pulse(t, 0.7, 0.18))
      },
      rArm: {
        upper: rd(mix(-166 - counter, -146, armOpen)),
        fore: rd(mix(-20, -35, armOpen) + 16 * pulse(t, 0.39, 0.1) + 18 * pulse(t, 0.3, 0.18))
      }
    },
    contacts: {
      l: lLift < 0.54,
      r: rLift < 0.54
    },
    facing: rd(Math.cos(Math.PI * turn))
  };
}

export function afterSmooth(frames) {
  const count = 29;
  const out = Array.from({ length: count }, (_, i) => frameAt(i / (count - 1)));
  out[0].contacts = { l: true, r: true };
  out.at(-1).contacts = { l: true, r: true };
  out[0].facing = 1;
  out.at(-1).facing = -1;
  return out;
}

export function finalize(clip) {
  return {
    ...clip,
    frames: clip.frames,
    markers: {
      ...(clip.markers ?? {}),
      anticipationEnd: 8,
      leftStep: 9,
      frontBlend: 14,
      rightStep: 19,
      settleStart: 25
    }
  };
}

export function extraGates(clip) {
  const frames = clip.frames;
  const facing = frames.map((f) => f.facing ?? 1);
  const rootX = frames.map((f) => f.root.x);
  const airborne = frames.filter((f) => !f.contacts?.l && !f.contacts?.r).length;
  const mid = frames[Math.floor(frames.length / 2)];
  const rig = clip.rig ?? { torso: 30, neck: 4, headRadius: 11, thigh: 22.5, shin: 22.5, foot: 7, upperArm: 17, forearm: 16 };
  const dir = (a) => ({ x: Math.cos(a * Math.PI / 180), y: Math.sin(a * Math.PI / 180) });
  const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
  const mul = (a, s) => ({ x: a.x * s, y: a.y * s });
  function pose(fr) {
    const a = fr.angles, p = { x: fr.root.x, y: fr.root.y }, ch = add(p, mul(dir(a.torso), rig.torso));
    const leg = (s) => {
      const l = a[`${s}Leg`], ta = a.torso + 180 + l.thigh, k = add(p, mul(dir(ta), rig.thigh));
      const sa = ta + l.shin, n = add(k, mul(dir(sa), rig.shin));
      return add(n, mul(dir(sa + l.foot), rig.foot));
    };
    const arm = (s) => {
      const u = a[`${s}Arm`], ua = a.torso + u.upper, e = add(ch, mul(dir(ua), rig.upperArm));
      return add(e, mul(dir(ua + u.fore), rig.forearm));
    };
    return { p, ch, lt: leg("l"), rt: leg("r"), lh: arm("l"), rh: arm("r") };
  }
  const distToTorso = (pt, p, ch) => Math.abs((ch.x - p.x) * (p.y - pt.y) - (p.x - pt.x) * (ch.y - p.y)) / Math.max(0.001, Math.hypot(ch.x - p.x, ch.y - p.y));
  const frontFrames = frames.filter((f) => Math.abs(f.facing ?? 1) <= 0.22);
  const frontMetrics = frontFrames.map((f) => {
    const p = pose(f);
    return {
      footGap: Math.abs(p.lt.x - p.rt.x),
      minHandAway: Math.min(distToTorso(p.lh, p.p, p.ch), distToTorso(p.rh, p.p, p.ch)),
      highHandAboveHip: Math.max(p.lh.y - p.p.y, p.rh.y - p.p.y)
    };
  });
  const minFrontFootGap = Math.min(...frontMetrics.map((m) => m.footGap));
  const minFrontHandAway = Math.min(...frontMetrics.map((m) => m.minHandAway));
  const facingZeroFrames = frames.filter((f) => Math.abs(f.facing ?? 1) <= 0.05);
  const maxFrontHandAboveHip = Math.max(...facingZeroFrames.map((f) => {
    const p = pose(f);
    return Math.max(p.lh.y - p.p.y, p.rh.y - p.p.y);
  }));
  const stableTorso = frames.slice(Math.floor(frames.length * 0.25)).map((f) => f.angles.torso);
  const torsoWobble = Math.max(...stableTorso) - Math.min(...stableTorso);
  const values = {
    startFacing: facing[0],
    endFacing: facing.at(-1),
    midFront: Math.abs(mid.facing ?? 1),
    travel: Math.max(...rootX) - Math.min(...rootX),
    allAirFrames: airborne,
    armOpening: Math.abs(mid.angles.lArm.upper - mid.angles.rArm.upper),
    minFrontHandAway,
    minFrontFootGap,
    maxFrontHandAboveHip,
    torsoWobble
  };
  return [
    { name: "turn.starts-facing-right", value: rd(values.startFacing), threshold: ">= 0.98", pass: values.startFacing >= 0.98 },
    { name: "turn.ends-facing-left", value: rd(values.endFacing), threshold: "<= -0.98", pass: values.endFacing <= -0.98 },
    { name: "turn.front-blend-at-middle", value: rd(values.midFront), threshold: "<= 0.18", pass: values.midFront <= 0.18 },
    { name: "turn.in-place-root-window", value: rd(values.travel), threshold: "<= 14", pass: values.travel <= 14 },
    { name: "turn.always-has-support", value: values.allAirFrames, threshold: "0", pass: values.allAirFrames === 0 },
    { name: "turn.front-view-arms-readable", value: rd(values.armOpening), threshold: ">= 220", pass: values.armOpening >= 220 },
    { name: "turn.front-frame-hand-away-from-torso", value: rd(values.minFrontHandAway), threshold: ">= 6", pass: values.minFrontHandAway >= 6 },
    { name: "turn.front-frame-relaxed-hands", value: rd(values.maxFrontHandAboveHip), threshold: "<= 0", pass: values.maxFrontHandAboveHip <= 0 },
    { name: "turn.front-frame-foot-gap", value: rd(values.minFrontFootGap), threshold: ">= 10", pass: values.minFrontFootGap >= 10 },
    { name: "turn.torso-wobble-after-anticipation", value: rd(values.torsoWobble), threshold: "<= 4", pass: values.torsoWobble <= 4 }
  ];
}
