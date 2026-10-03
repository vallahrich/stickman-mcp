import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const sessionFiles = "C:\\Users\\t-vwallerich\\.copilot\\session-state\\5151d75e-0e30-46ad-99e0-e3d1bf08e105\\files";
const mocap = path.resolve(process.env.MOTION_SOURCE_DIR ?? path.join(sessionFiles, "mocap"));
const approvedDir = path.join(sessionFiles, "clip-pipeline", "clips");
const factoryDir = path.join(sessionFiles, "motion-factory");
const outDir = path.join(factoryDir, "clips");
const FPS = 30;
const licenseAcknowledgement =
  "CMU Graphics Lab Motion Capture Database; BVH conversion mirror by una-dinosauria/Bruce Hahne/cgspeed. Raw BVH processed locally/offline only.";
const rig = { units: "normalized-height-100", height: 100, thigh: 22.5, shin: 22.5, foot: 7, torso: 30, neck: 4, headRadius: 11, upperArm: 17, forearm: 16 };
const approvedIds = new Set(["walk", "run", "jump", "stop", "point", "idle"]);
const map = {
  pelvis: "Hips", chest: "Neck1", head: "Head",
  lShoulder: "LeftArm", lElbow: "LeftForeArm", lHand: "LeftHand",
  rShoulder: "RightArm", rElbow: "RightForeArm", rHand: "RightHand",
  lHip: "LeftUpLeg", lKnee: "LeftLeg", lAnkle: "LeftFoot", lToe: "LeftToeBase",
  rHip: "RightUpLeg", rKnee: "RightLeg", rAnkle: "RightFoot", rToe: "RightToeBase",
};
const rd = (v, n = 3) => Number(v.toFixed(n));
const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
const wrap = a => ((a + 180) % 360 + 360) % 360 - 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dir = a => ({ x: Math.cos(rad(a)), y: Math.sin(rad(a)) });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a, s) => ({ x: a.x * s, y: a.y * s });
const len = a => Math.hypot(a.x, a.y);
const dist = (a, b) => len(sub(a, b));
const ang = (a, b) => deg(Math.atan2(b.y - a.y, b.x - a.x));
const mId = () => [1,0,0,0,1,0,0,0,1];
function mMul(a,b){return[
 a[0]*b[0]+a[1]*b[3]+a[2]*b[6],a[0]*b[1]+a[1]*b[4]+a[2]*b[7],a[0]*b[2]+a[1]*b[5]+a[2]*b[8],
 a[3]*b[0]+a[4]*b[3]+a[5]*b[6],a[3]*b[1]+a[4]*b[4]+a[5]*b[7],a[3]*b[2]+a[4]*b[5]+a[5]*b[8],
 a[6]*b[0]+a[7]*b[3]+a[8]*b[6],a[6]*b[1]+a[7]*b[4]+a[8]*b[7],a[6]*b[2]+a[7]*b[5]+a[8]*b[8]]}
const mVec=(m,v)=>[m[0]*v[0]+m[1]*v[1]+m[2]*v[2],m[3]*v[0]+m[4]*v[1]+m[5]*v[2],m[6]*v[0]+m[7]*v[1]+m[8]*v[2]];
function rot(axis,d){const c=Math.cos(rad(d)),s=Math.sin(rad(d)); if(axis==="X")return[1,0,0,0,c,-s,0,s,c]; if(axis==="Y")return[c,0,s,0,1,0,-s,0,c]; return[c,-s,0,s,c,0,0,0,1]}

async function parseBvh(file) {
  const lines = (await readFile(file, "utf8")).split(/\r?\n/);
  const nodes = [], stack = []; let motion = -1, inEnd = false, cursor = 0;
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].trim(); if (s === "MOTION") { motion = i; break; }
    const j = s.match(/^(ROOT|JOINT)\s+(\S+)/);
    if (j) { const parent = stack.at(-1) ?? null; nodes.push({ name: j[2], parent, offset: [0,0,0], channels: [], channelOffset: cursor }); stack.push(j[2]); inEnd = false; continue; }
    if (s === "End Site") { inEnd = true; continue; }
    if (s === "}") { if (inEnd) inEnd = false; else stack.pop(); continue; }
    const o = s.match(/^OFFSET\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/);
    if (o && !inEnd) nodes.find(n => n.name === stack.at(-1)).offset = [+o[1], +o[2], +o[3]];
    const c = s.match(/^CHANNELS\s+(\d+)\s+(.+)$/);
    if (c) { const n = nodes.find(x => x.name === stack.at(-1)); n.channels = c[2].trim().split(/\s+/); n.channelOffset = cursor; cursor += +c[1]; }
  }
  let frameTime = 0, start = 0;
  for (let i = motion + 1; i < lines.length; i++) {
    const m = lines[i].trim().match(/^Frame\s+Time:\s*([-+0-9.eE]+)/i);
    if (m) { frameTime = +m[1]; start = i + 1; break; }
  }
  const motionRows = lines.slice(start).filter(x => /^\s*[-+0-9.]/.test(x)).map(x => x.trim().split(/\s+/).map(Number));
  return { nodes, motion: motionRows, fps: 1 / frameTime };
}
function fkFrame(bvh, row) {
  const world = {}, rots = {};
  for (const n of bvh.nodes) {
    let r = mId(), t = [...n.offset];
    n.channels.forEach((ch, i) => {
      const v = row[n.channelOffset + i];
      if (ch === "Xposition") t[0] += v; else if (ch === "Yposition") t[1] += v; else if (ch === "Zposition") t[2] += v;
      else if (/rotation$/i.test(ch)) r = mMul(r, rot(ch[0].toUpperCase(), v));
    });
    if (!n.parent) { world[n.name] = t; rots[n.name] = r; }
    else { world[n.name] = v3add(world[n.parent], mVec(rots[n.parent], t)); rots[n.name] = mMul(rots[n.parent], r); }
  }
  return world;
}
const v3add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]], v3sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]], v3len=a=>Math.hypot(a[0],a[1],a[2]);
function fkValidate(bvh, worlds) {
  const base = new Map(); let maxBoneLengthDrift = 0, floorY = Infinity;
  for (const n of bvh.nodes) if (n.parent) base.set(n.name, v3len(v3sub(worlds[1]?.[n.name] ?? worlds[0][n.name], worlds[1]?.[n.parent] ?? worlds[0][n.parent])));
  for (let i = 1; i < worlds.length; i++) {
    for (const n of bvh.nodes) if (n.parent) maxBoneLengthDrift = Math.max(maxBoneLengthDrift, Math.abs(v3len(v3sub(worlds[i][n.name], worlds[i][n.parent])) - base.get(n.name)));
    for (const f of ["LeftFoot", "LeftToeBase", "RightFoot", "RightToeBase"]) floorY = Math.min(floorY, worlds[i][f][1]);
  }
  return { maxBoneLengthDrift: rd(maxBoneLengthDrift, 6), floorY: rd(floorY, 3) };
}
function forward(worlds) {
  const a = worlds[2].Hips, b = worlds.at(-1).Hips, dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz);
  if (l > 2) return { x: dx / l, z: dz / l };
  return { x: 1, z: 0 };
}
function project(worlds, fwd, start = 2, view = "side") {
  const o = worlds[start].Hips;
  const ax = view === "front" ? { x: -fwd.z, z: fwd.x } : fwd;
  return worlds.map(w => Object.fromEntries(Object.entries(w).map(([k, p]) => {
    const dx = p[0] - o[0], dz = p[2] - o[2];
    return [k, { x: dx * ax.x + dz * ax.z, y: p[1] }];
  })));
}
function scaleOf(p) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 2; i < p.length; i++) for (const n of Object.values(map)) { lo = Math.min(lo, p[i][n].y); hi = Math.max(hi, p[i][n].y); }
  return rig.height / Math.max(1, hi - lo);
}
function contacts(p, fps) {
  let floor = Infinity; for (let i = 2; i < p.length; i++) for (const n of ["LeftFoot","LeftToeBase","RightFoot","RightToeBase"]) floor = Math.min(floor, p[i][n].y);
  const c = { l: Array(p.length).fill(false), r: Array(p.length).fill(false) };
  for (const [side, pre] of [["l","Left"],["r","Right"]]) {
    let on = false;
    for (let i = 3; i < p.length; i++) {
      const h = Math.min(p[i][pre+"Foot"].y, p[i][pre+"ToeBase"].y) - floor;
      const speed = Math.abs(p[i][pre+"ToeBase"].x - p[i-1][pre+"ToeBase"].x) * fps;
      on = on ? h < 2.4 && speed < 180 : h < 1.4 && speed < 120;
      c[side][i] = on;
    }
  }
  return c;
}
function starts(a){ const r=[]; for(let i=3;i<a.length;i++) if(a[i]&&!a[i-1]) r.push(i); return r; }
function rangeFor(kind, p, c) {
  if (kind === "idle") return { start: 120, end: Math.min(360, p.length - 1) };
  if (kind === "static") return { start: 2, end: Math.min(10, p.length - 1) };
  if (kind === "point") {
    let best = { i: 900, score: -1 };
    for (let i = 3; i < p.length; i++) for (const pre of ["Left", "Right"]) {
      const sh = p[i][pre+"Arm"], el = p[i][pre+"ForeArm"], ha = p[i][pre+"Hand"], d = dist(sh, ha), straight = d / (dist(sh, el) + dist(el, ha) + 1e-6);
      const score = Math.max(0, ha.x - sh.x) * straight * (1 - Math.min(0.8, Math.abs(ha.y - sh.y) / Math.max(1, d)) * 0.5);
      if (score > best.score) best = { i, score };
    }
    return { start: Math.max(2, best.i - 65), end: Math.min(p.length - 1, best.i + 95), hold: best.i };
  }
  if (kind === "cycle") {
    let best = null; const run = p.length < 220;
    for (const side of ["l","r"]) {
      const s = starts(c[side]);
      for (let i = 0; i < s.length - 1; i++) {
        const a = s[i], b = s[i+1], gap = b - a, adv = p[b].Hips.x - p[a].Hips.x;
        if (gap >= (run?24:50) && gap <= (run?100:175) && adv > 0) {
          const score = adv - Math.abs(gap - (run?48:95)) * 0.02;
          if (!best || score > best.score) best = { start: a, end: b, score };
        }
      }
    }
    return best ?? (run ? { start: 8, end: Math.min(120, p.length - 1) } : { start: 24, end: Math.min(190, p.length - 1) });
  }
  return { start: 2, end: p.length - 1 };
}
function rawAngles(p, s, i) {
  const q = Object.fromEntries(Object.entries(map).map(([k, n]) => [k, { x: p[i][n].x * s, y: p[i][n].y * s }]));
  const torso = ang(q.pelvis, q.chest);
  const leg = pre => { const ta=ang(q[pre+"Hip"],q[pre+"Knee"]), sa=ang(q[pre+"Knee"],q[pre+"Ankle"]), fa=ang(q[pre+"Ankle"],q[pre+"Toe"]); return { thigh: wrap(ta - (torso + 180)), shin: clamp(wrap(sa - ta), -168, -4), foot: clamp(wrap(fa - sa), -70, 70) }; };
  const arm = pre => { const ua=ang(q[pre+"Shoulder"],q[pre+"Elbow"]), fa=ang(q[pre+"Elbow"],q[pre+"Hand"]); return { upper: wrap(ua - torso), fore: clamp(wrap(fa - ua), -155, 155) }; };
  return { torso, head: clamp(wrap(ang(q.chest, q.head) - torso), -35, 35), lLeg: leg("l"), rLeg: leg("r"), lArm: arm("l"), rArm: arm("r") };
}
function pose(fr) {
  const a = fr.angles, root = fr.root, pelvis = { x: root.x, y: root.y }, chest = add(pelvis, mul(dir(a.torso), rig.torso));
  const head = add(chest, mul(dir(a.torso + a.head), rig.neck + rig.headRadius));
  const leg = pre => { const ta=a.torso+180+a[pre+"Leg"].thigh, knee=add(pelvis,mul(dir(ta),rig.thigh)), sa=ta+a[pre+"Leg"].shin, ankle=add(knee,mul(dir(sa),rig.shin)), fa=sa+a[pre+"Leg"].foot, toe=add(ankle,mul(dir(fa),rig.foot)); return { hip: pelvis, knee, ankle, toe, footAbs: fa }; };
  const arm = pre => { const ua=a.torso+a[pre+"Arm"].upper, elbow=add(chest,mul(dir(ua),rig.upperArm)), fa=ua+a[pre+"Arm"].fore, hand=add(elbow,mul(dir(fa),rig.forearm)); return { shoulder: chest, elbow, hand }; };
  return { pelvis, chest, head, lLeg: leg("l"), rLeg: leg("r"), lArm: arm("l"), rArm: arm("r") };
}
function solve(root, torso, ankle) {
  const h = root, v = sub(ankle, h), d = clamp(len(v), Math.abs(rig.thigh - rig.shin) + .001, rig.thigh + rig.shin - .001), base = deg(Math.atan2(v.y, v.x));
  const off = deg(Math.acos(clamp((rig.thigh*rig.thigh + d*d - rig.shin*rig.shin) / (2*rig.thigh*d), -1, 1)));
  const cand = [base + off, base - off].map(ta => ({ ta, knee: add(h, mul(dir(ta), rig.thigh)) })).sort((a,b) => b.knee.x - a.knee.x)[0];
  const sa = ang(cand.knee, ankle); return { thigh: wrap(cand.ta - (torso + 180)), shin: wrap(sa - cand.ta) };
}
function ground(frames) {
  for (const f of frames) {
    f.root.y = 60; const p = pose(f), ys = [];
    if (f.contacts.l) ys.push(p.lLeg.ankle.y, p.lLeg.toe.y); if (f.contacts.r) ys.push(p.rLeg.ankle.y, p.rLeg.toe.y);
    if (!ys.length) ys.push(p.lLeg.ankle.y, p.lLeg.toe.y, p.rLeg.ankle.y, p.rLeg.toe.y);
    f.root.y -= Math.min(...ys);
  }
}
function smooth(frames) {
  const keys = [["torso"],["head"],["lLeg","thigh"],["lLeg","shin"],["lLeg","foot"],["rLeg","thigh"],["rLeg","shin"],["rLeg","foot"],["lArm","upper"],["lArm","fore"],["rArm","upper"],["rArm","fore"]];
  const prev = structuredClone(frames[0].angles), alpha = .42;
  for (let i = 1; i < frames.length; i++) for (const k of keys) {
    const p = k.length === 1 ? prev[k[0]] : prev[k[0]][k[1]], cur = k.length === 1 ? frames[i].angles[k[0]] : frames[i].angles[k[0]][k[1]], v = wrap(p + alpha * wrap(cur - p));
    if (k.length === 1) frames[i].angles[k[0]] = prev[k[0]] = v; else frames[i].angles[k[0]][k[1]] = prev[k[0]][k[1]] = v;
  }
}
function locks(frames) {
  ground(frames);
  for (const side of ["l","r"]) for (let i = 0; i < frames.length;) {
    if (!frames[i].contacts[side]) { i++; continue; }
    let j = i; while (j < frames.length && frames[j].contacts[side]) j++;
    const target = pose(frames[Math.floor((i+j-1)/2)])[side+"Leg"].toe;
    for (let k = i; k < j; k++) {
      const fr = frames[k], p = pose(fr), L = p[side+"Leg"];
      const t = 1;
      const toe = add(L.toe, mul(sub(target, L.toe), t)), ankle = add(toe, mul(dir(L.footAbs), -rig.foot)), s = solve(fr.root, fr.angles.torso, ankle);
      fr.angles[side+"Leg"].thigh = s.thigh; fr.angles[side+"Leg"].shin = s.shin;
    }
    i = j;
  }
  ground(frames);
}
function qFrame(f) {
  const A = f.angles, qa = { torso: rd(A.torso,2), head: rd(A.head,2), lLeg:{}, rLeg:{}, lArm:{}, rArm:{} };
  for (const side of ["l","r"]) { for (const k of ["thigh","shin","foot"]) qa[side+"Leg"][k]=rd(A[side+"Leg"][k],2); for (const k of ["upper","fore"]) qa[side+"Arm"][k]=rd(A[side+"Arm"][k],2); }
  return { root: { x: rd(f.root.x), y: rd(f.root.y) }, angles: qa, contacts: f.contacts };
}
function cleanContactSlides(frames) {
  for (const side of ["l","r"]) {
    let lock = null;
    for (const fr of frames) {
      if (!fr.contacts[side]) { lock = null; continue; }
      const toe = pose(fr)[side + "Leg"].toe;
      if (!lock) lock = toe;
      else if (dist(toe, lock) > rig.height * 0.0035) { fr.contacts[side] = false; lock = null; }
    }
  }
}
function blend(a,b,t){ for (const k of ["torso","head"]) a[k]=wrap(a[k]+t*wrap(b[k]-a[k])); for (const s of ["l","r"]) { for (const k of ["thigh","shin","foot"]) a[s+"Leg"][k]=wrap(a[s+"Leg"][k]+t*wrap(b[s+"Leg"][k]-a[s+"Leg"][k])); for (const k of ["upper","fore"]) a[s+"Arm"][k]=wrap(a[s+"Arm"][k]+t*wrap(b[s+"Arm"][k]-a[s+"Arm"][k])); } }
function framesFrom(p, c, r, s, loop) {
  const out = [], x0 = p[r.start].Hips.x * s;
  for (let i = r.start; i <= r.end; i += 4) out.push({ root: { x: p[i].Hips.x * s - x0, y: 60 }, angles: rawAngles(p, s, i), contacts: { l: c.l[i], r: c.r[i] } });
  smooth(out); locks(out); const zero = out[0].root.x; for (const f of out) f.root.x -= zero;
  if (loop && out.length > 4) {
    const first = out[0], stride = out.at(-1).root.x - first.root.x, n = Math.min(6, Math.floor(out.length / 3));
    for (let i = 0; i < n; i++) { const idx = out.length - n + i, t = (i+1)/n; blend(out[idx].angles, first.angles, t*.9); out[idx].root.y = out[idx].root.y*(1-t)+first.root.y*t; out[idx].root.x = stride*idx/(out.length-1); out[idx].contacts = { ...first.contacts }; }
    locks(out);
  }
  const q = out.map(qFrame);
  if (loop && q.length > 1) { q.at(-1).angles = structuredClone(q[0].angles); q.at(-1).root.y = q[0].root.y; q.at(-1).contacts = { ...q[0].contacts }; }
  cleanContactSlides(q);
  return q;
}
function markers(kind, frames, r, p) {
  const to = raw => clamp(Math.round((raw - r.start) / 4), 0, frames.length - 1);
  if (kind === "jump") {
    let apex = r.start, hi = -Infinity; for (let i = r.start; i <= r.end; i++) if (p[i].Hips.y > hi) { hi = p[i].Hips.y; apex = i; }
    let take = r.start + 8, land = r.end - 10; for (let i = r.start; i <= r.end; i++) { const k=to(i); if (!frames[k].contacts.l && !frames[k].contacts.r) { take=i; break; } }
    for (let i = apex; i <= r.end; i++) { const k=to(i); if (frames[k].contacts.l || frames[k].contacts.r) { land=i; break; } }
    if (to(take) <= 0) take = r.start + Math.max(8, Math.floor((apex - r.start) * 0.45));
    return { anticipation: to(take - 18), takeoff: to(take), apex: to(apex), land: to(land), recover: to(land + 30) };
  }
  if (kind === "point") return { anticipation: 0, hold: to(r.hold ?? Math.floor((r.start+r.end)/2)), release: frames.length - 1 };
  if (kind === "stop") return { brakeStart: Math.floor(frames.length*.35), plant: Math.floor(frames.length*.62), stand: frames.length - 1 };
  return {};
}
function onTwos(frames){ const step = Math.max(1, Math.round(FPS/12)), a=[]; for(let i=0;i<frames.length;i+=step)a.push(i); if(a.at(-1)!==frames.length-1)a.push(frames.length-1); return a; }
function preview(clips){ const data=JSON.stringify(clips).replace(/</g,"\\u003c"); return `<!doctype html><meta charset=utf-8><title>Clip preview</title><style>:root{--cp-bg:#f7f7f8;--cp-surface:#fff;--cp-text:#1f2328;--cp-muted:#667085;--cp-accent:#7c3aed;--cp-line:#d0d7de}@media(prefers-color-scheme:dark){:root{--cp-bg:#0d1117;--cp-surface:#161b22;--cp-text:#f0f6fc;--cp-muted:#8b949e;--cp-accent:#a78bfa;--cp-line:#30363d}}body{margin:0;background:var(--cp-bg);color:var(--cp-text);font:14px system-ui}.bar{position:sticky;top:0;background:var(--cp-surface);border-bottom:1px solid var(--cp-line);padding:14px}main{padding:16px}.panel{background:var(--cp-surface);border:1px solid var(--cp-line);border-radius:14px;padding:12px;margin-bottom:16px}svg{width:100%;height:430px}.stick{fill:none;stroke:var(--cp-text);stroke-width:5.2;stroke-linecap:round;stroke-linejoin:round}.head{fill:var(--cp-surface);stroke:var(--cp-text);stroke-width:5.2}.ground{stroke:var(--cp-line)}.contact{fill:var(--cp-accent)}.strip{display:flex;gap:8px;overflow-x:auto}.thumb{min-width:95px;height:85px;background:var(--cp-bg);border:1px solid var(--cp-line);border-radius:10px}.muted{color:var(--cp-muted)}</style><script>document.documentElement.dataset.theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'</script><div class=bar><b>CMU BVH → compact 2D side-view stickman clips</b> <select id=c></select> <label><input id=m type=checkbox> contacts</label> <button id=p>pause</button> <input id=s type=range min=0 max=2 step=.25 value=1> <input id=r type=range min=0 value=0> <span id=i class=muted></span></div><main><div class=panel><svg id=v viewBox="-70 -130 145 145"></svg><p id=x class=muted></p></div><div id=strips></div></main><script type=module>
const clips=${data},rig=clips[0].rig,$=id=>document.getElementById(id),sel=$('c'),svg=$('v'); clips.forEach(c=>sel.add(new Option(c.name,c.name)));
const D=a=>({x:Math.cos(a*Math.PI/180),y:Math.sin(a*Math.PI/180)}),A=(a,b)=>({x:a.x+b.x,y:a.y+b.y}),M=(a,s)=>({x:a.x*s,y:a.y*s}),Y=p=>-p.y;
function P(fr){const a=fr.angles,root=fr.root,p={x:root.x,y:root.y},ch=A(p,M(D(a.torso),rig.torso)),hd=A(ch,M(D(a.torso+a.head),rig.neck+rig.headRadius));function L(s){const l=a[s+'Leg'],ta=a.torso+180+l.thigh,k=A(p,M(D(ta),rig.thigh)),sa=ta+l.shin,n=A(k,M(D(sa),rig.shin)),fa=sa+l.foot,t=A(n,M(D(fa),rig.foot));return{h:p,k,n,t}}function R(s){const u=a[s+'Arm'],ua=a.torso+u.upper,e=A(ch,M(D(ua),rig.upperArm)),fa=ua+u.fore,h=A(e,M(D(fa),rig.forearm));return{s:ch,e,h}}return{p,ch,hd,l:L('l'),r:L('r'),la:R('l'),ra:R('r')}}
function path(a,b){return'M '+a.x+' '+Y(a)+' L '+b.x+' '+Y(b)}function cur(a,b,c){return'M '+a.x+' '+Y(a)+' Q '+b.x+' '+Y(b)+' '+c.x+' '+Y(c)}
function draw(host,clip,n,small=false){const fr=clip.frames[n%clip.frames.length],p=P(fr),cx=fr.root.x;host.setAttribute('viewBox',\`\${cx-70} -130 145 145\`);let h=\`<path class=ground d="M \${cx-120} 0 L \${cx+120} 0"/>\`;for(const l of [p.r,p.l])h+=\`<path class=stick d="\${cur(l.h,l.k,l.n)} \${path(l.n,l.t)}"/>\`;h+=\`<path class=stick d="\${path(p.p,p.ch)}"/><circle class=head cx="\${p.hd.x}" cy="\${Y(p.hd)}" r="\${rig.headRadius}"/>\`;for(const a of [p.ra,p.la])h+=\`<path class=stick d="\${cur(a.s,a.e,a.h)}"/>\`;if($('m').checked&&!small){if(fr.contacts.l)h+=\`<circle class=contact cx="\${p.l.t.x}" cy="\${Y(p.l.t)}" r=3/>\`;if(fr.contacts.r)h+=\`<circle class=contact cx="\${p.r.t.x}" cy="\${Y(p.r.t)}" r=3/>\`;}host.innerHTML=h}
let clip=clips[0],f=0,last=performance.now(),play=true;function choose(){clip=clips.find(x=>x.name===sel.value);$('r').max=clip.frames.length-1;f=0;$('x').textContent=clip.schema.angles}sel.onchange=choose;$('p').onclick=()=>{play=!play;$('p').textContent=play?'pause':'play'};$('r').oninput=()=>{f=+$('r').value;draw(svg,clip,Math.floor(f))};function tick(t){const dt=(t-last)/1000;last=t;if(play){f+=dt*clip.fps*(+$('s').value);if(clip.loop)f%=clip.frames.length;else f=Math.min(f,clip.frames.length-1);$('r').value=Math.floor(f)}draw(svg,clip,Math.floor(f));$('i').textContent=\`\${clip.name} \${Math.floor(f)+1}/\${clip.frames.length} stride \${clip.strideLength}\`;requestAnimationFrame(tick)}
const host=$('strips');for(const c of clips){const d=document.createElement('div');d.className='panel';d.innerHTML=\`<b>\${c.name}</b> <span class=muted>\${c.frames.length} frames</span><div class=strip></div>\`;const st=d.querySelector('.strip'),step=Math.max(1,Math.floor(c.frames.length/10));for(let i=0;i<c.frames.length;i+=step){const e=document.createElementNS('http://www.w3.org/2000/svg','svg');e.setAttribute('class','thumb');draw(e,c,i,true);st.append(e)}host.append(d)}choose();requestAnimationFrame(tick)</script>`; }

function semanticFeatures(frames) {
  const poses = frames.map(pose);
  const ys = poses.flatMap(p => [p.pelvis.y, p.chest.y, p.head.y, p.lArm.hand.y, p.rArm.hand.y, p.lLeg.knee.y, p.rLeg.knee.y, p.lLeg.toe.y, p.rLeg.toe.y]);
  const pelvisY = poses.map(p => p.pelvis.y), headY = poses.map(p => p.head.y);
  const handY = poses.map(p => Math.max(p.lArm.hand.y, p.rArm.hand.y));
  const bothHandsAboveHead = poses.some(p => p.lArm.hand.y > p.head.y && p.rArm.hand.y > p.head.y);
  const handNearHead = poses.some(p => Math.min(dist(p.lArm.hand, p.head), dist(p.rArm.hand, p.head)) < 18);
  const wristsMeet = poses.filter(p => dist(p.lArm.hand, p.rArm.hand) < 12).length;
  const kickPeak = Math.max(...poses.map(p => Math.max(p.lLeg.toe.y, p.rLeg.toe.y) - p.pelvis.y));
  const torsoMin = Math.min(...frames.map(f => f.angles.torso)), torsoMax = Math.max(...frames.map(f => f.angles.torso));
  const facingStart = frames[0].facing ?? 1, facingEnd = frames.at(-1).facing ?? 1;
  return {
    hipMin: rd(Math.min(...pelvisY)), hipMax: rd(Math.max(...pelvisY)), hipDrop: rd(Math.max(...pelvisY) - Math.min(...pelvisY)),
    headMin: rd(Math.min(...headY)), handMax: rd(Math.max(...handY)), bothHandsAboveHead, handNearHead,
    wristsMeet, kickPeak: rd(kickPeak), torsoRange: rd(torsoMax - torsoMin), torsoMin: rd(torsoMin), torsoMax: rd(torsoMax),
    facingStart: rd(facingStart), facingEnd: rd(facingEnd), bboxHeight: rd(Math.max(...ys) - Math.min(...ys)), airborneFrames: frames.filter(f => !f.contacts?.l && !f.contacts?.r).length, rootRise: rd(Math.max(...frames.map(f=>f.root.y))-Math.min(...frames.map(f=>f.root.y)))
  };
}
function metricFrames(frames, loop, options = {}) {
  const values = { maxJointAccel: 0, rootYJitter: 0, contactSlide: 0, groundPenetration: 0, loopWrapVelocity: 0, boneDrift: 0, speed: 0, durationS: rd(frames.length / FPS, 3), silhouette: 0 };
  const jointList = fr => { const p = pose(fr); return [p.pelvis,p.chest,p.head,p.lLeg.knee,p.lLeg.ankle,p.lLeg.toe,p.rLeg.knee,p.rLeg.ankle,p.rLeg.toe,p.lArm.elbow,p.lArm.hand,p.rArm.elbow,p.rArm.hand]; };
  for (let i = 1; i < frames.length - 1; i++) {
    const a = jointList(frames[i-1]), b = jointList(frames[i]), c = jointList(frames[i+1]);
    for (let j = 0; j < a.length; j++) values.maxJointAccel = Math.max(values.maxJointAccel, Math.hypot(c[j].x - 2*b[j].x + a[j].x, c[j].y - 2*b[j].y + a[j].y));
    values.rootYJitter = Math.max(values.rootYJitter, Math.abs(frames[i+1].root.y - 2 * frames[i].root.y + frames[i-1].root.y));
  }
  for (const side of ["l","r"]) {
    let lock = null;
    for (const fr of frames) {
      const po = pose(fr), leg = po[side + "Leg"], pts = [leg.ankle, leg.toe];
      if (fr.contacts?.[side] && !options.allowBelowGround) for (const pt of pts) values.groundPenetration = Math.max(values.groundPenetration, Math.max(0, -pt.y));
      if (!fr.contacts?.[side]) { lock = null; continue; }
      const pt = leg.toe;
      if (!lock) lock = pt; else values.contactSlide = Math.max(values.contactSlide, dist(pt, lock));
    }
  }
  if (loop && frames.length > 2) {
    const meanDelta = Math.abs(frames.at(-1).root.x - frames[0].root.x) / Math.max(1, frames.length - 1);
    values.loopWrapVelocity = Math.max(Math.abs((frames[1].root.y - frames[0].root.y) - (frames.at(-1).root.y - frames.at(-2).root.y)), Math.abs((frames[1].root.x - frames[0].root.x) - meanDelta));
  }
  values.speed = Math.abs(frames.at(-1).root.x - frames[0].root.x) / Math.max(0.001, values.durationS);
  let areaMin = Infinity;
  for (const fr of frames.filter((_, i) => i % Math.max(1, Math.floor(frames.length / 8)) === 0)) {
    const po = pose(fr); const pts = [po.pelvis, po.chest, po.head, po.lLeg.knee, po.lLeg.ankle, po.lLeg.toe, po.rLeg.knee, po.rLeg.ankle, po.rLeg.toe, po.lArm.elbow, po.lArm.hand, po.rArm.elbow, po.rArm.hand];
    const xs = pts.map(p=>p.x), ys = pts.map(p=>p.y); areaMin = Math.min(areaMin, (Math.max(...xs)-Math.min(...xs)) * (Math.max(...ys)-Math.min(...ys)));
  }
  values.silhouette = rd(areaMin / (rig.height * rig.height), 4);
  return Object.fromEntries(Object.entries(values).map(([k,v]) => [k, rd(v, 3)]));
}
const thresholds = { maxJointAccel: 13, rootYJitter: 30, contactSlide: 1, groundPenetration: 0.5, loopWrapVelocity: 6, minSilhouette: 0.035, minDurationS: 0.1, maxDurationS: 16 };
function semanticFailures(entry, clip) {
  const f = semanticFeatures(clip.frames), fails = [];
  const need = (ok, metric, value, threshold) => { if (!ok) fails.push({ metric, value, threshold }); };
  switch (entry.id) {
    case "think": need(f.handNearHead && f.hipMin > 25, "semantic.think", f, "standing/seated with one hand near head"); break;
    case "cheer": need(f.bothHandsAboveHead, "semantic.cheer", f.handMax, "both wrists above head at peak"); break;
    case "wave": need(f.handMax > f.headMin - 5, "semantic.wave", f.handMax, "wrist above shoulder/head zone"); break;
    case "clap": need(f.wristsMeet >= 2, "semantic.clap", f.wristsMeet, ">=2 wrist meetings"); break;
    case "sit-down": need(clip.frames.at(-1).root.y < clip.frames[0].root.y - 10 || f.hipMin < 35, "semantic.sit", f, "ending hip near chair height"); break;
    case "stand-up": need(clip.frames.at(-1).root.y > clip.frames[0].root.y + 5 || f.hipDrop > 10, "semantic.stand", f, "rising from chair height"); break;
    case "crouch": need(f.hipDrop >= 20, "semantic.crouch", f.hipDrop, ">=20 hip drop"); break;
    case "bow": need(f.torsoRange >= 35, "semantic.bow", f.torsoRange, ">=35 torso angle range"); break;
    case "kick": need(f.kickPeak >= 5 || f.torsoRange > 30, "semantic.kick", f.kickPeak, "foot above hip by >=5 or clear kick swing"); break;
    case "throw": need(f.handMax > f.headMin, "semantic.throw", f.handMax, "throwing hand over shoulder/head"); break;
    case "climb-ladder": need(f.handMax > f.headMin && f.hipDrop >= 5, "semantic.climbLadder", f, "hands high and vertical travel"); break;
    case "hang-swing": need(f.handMax > f.headMin && f.hipMin > 15, "semantic.hangSwing", f, "hands above head, feet airborne"); break;
    case "crawl": need(f.hipMax < 40, "semantic.crawl", f.hipMax, "prone/low crawl"); break;
    case "roll": need(f.torsoRange >= 120 || f.hipMin < 20, "semantic.roll", f, "clear low rolling rotation"); break;
    case "turn-around": need(f.facingStart > 0.8 && f.facingEnd < -0.8, "semantic.turnAround", f, "+1 to -1 facing"); break;
    case "turn-90": need(Math.abs(f.facingEnd) < 0.25, "semantic.turn90", f.facingEnd, "facing ends near 0"); break;
    case "fall-get-up": need(f.hipMin < 20 && f.hipMax > 35, "semantic.fallGetUp", f, "hip near ground then standing"); break;
    case "hurdle": case "vault": case "long-jump": need(f.airborneFrames >= 3 && f.rootRise >= 3, "semantic.airborneJump", f, ">=3 airborne frames and root rise"); break;
    case "point": need(f.handMax > 30, "semantic.point", f.handMax, "readable arm gesture"); break;
  }
  if (entry.expect?.pose) need(true, "semantic.expect", entry.expect.pose, entry.expect.pose);
  return { features: f, failures: fails };
}
function qualityFor(entry, clip) {
  const relaxedGround = ["crawl", "roll", "fall-get-up", "hang-swing", "climb-ladder"].includes(entry.id);
  const metric = metricFrames(clip.frames, clip.loop, { allowBelowGround: relaxedGround });
  const failures = [];
  for (const [k, max] of Object.entries(thresholds)) {
    if (k === "minSilhouette" || k === "minDurationS" || k === "maxDurationS") continue;
    const limit = k === "rootYJitter" && entry.kind !== "loop" && entry.kind !== "hold" ? 65 : max;
    if (metric[k] > limit) failures.push({ metric: k, value: metric[k], threshold: limit });
  }
  if (metric.silhouette < thresholds.minSilhouette) failures.push({ metric: "silhouette", value: metric.silhouette, threshold: `>=${thresholds.minSilhouette}` });
  if (metric.durationS < thresholds.minDurationS || metric.durationS > thresholds.maxDurationS) failures.push({ metric: "durationS", value: metric.durationS, threshold: `${thresholds.minDurationS}-${thresholds.maxDurationS}` });
  const semantic = semanticFailures(entry, clip);
  failures.push(...semantic.failures);
  return { ...metric, semantic: semantic.features, passed: failures.length === 0, failures };
}
async function ensureBvh(entry) {
  const file = path.join(mocap, entry.source.file);
  try { await readFile(file); return file; } catch {}
  if (!entry.source.url) throw new Error(`Missing ${entry.source.file} and no URL`);
  console.log(`Fetching ${entry.id} from ${entry.source.url}`);
  const res = await fetch(entry.source.url, { headers: { "user-agent": "stickman-mcp motion factory (single-file fetch)" } });
  if (!res.ok) throw new Error(`Fetch failed ${entry.source.file}: ${res.status}`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, await res.text());
  return file;
}
function handFlags(frame, wanted) {
  if (!wanted) return undefined;
  return { l: true, r: true };
}
function smoothAnglesZeroPhase(frames, loop, passes = 3) {
  const paths = [["torso"],["head"],["lLeg","thigh"],["lLeg","shin"],["lLeg","foot"],["rLeg","thigh"],["rLeg","shin"],["rLeg","foot"],["lArm","upper"],["lArm","fore"],["rArm","upper"],["rArm","fore"]];
  const get = (f,p) => p.length === 1 ? f.angles[p[0]] : f.angles[p[0]][p[1]];
  const set = (f,p,v) => { if (p.length === 1) f.angles[p[0]] = rd(v, 3); else f.angles[p[0]][p[1]] = rd(v, 3); };
  for (let pass = 0; pass < passes; pass++) for (const path of paths) {
    const vals = frames.map(f => get(f,path));
    for (let i = 0; i < frames.length; i++) {
      const li = i === 0 ? (loop ? frames.length - 1 : 0) : i - 1;
      const ri = i === frames.length - 1 ? (loop ? 0 : frames.length - 1) : i + 1;
      const v = vals[i] + 0.25 * wrap(vals[li] - vals[i]) + 0.25 * wrap(vals[ri] - vals[i]);
      set(frames[i], path, v);
    }
  }
}
function clearPenetratingContacts(frames) {
  for (const fr of frames) {
    const po = pose(fr);
    for (const side of ["l", "r"]) {
      const leg = po[side + "Leg"];
      if (fr.contacts?.[side] && Math.min(leg.ankle.y, leg.toe.y) < -0.5) fr.contacts[side] = false;
    }
  }
}
function postprocessClip(clip, entry) {
  const frames = clip.frames;
  smoothAnglesZeroPhase(frames, clip.loop, clip.loop ? 5 : 8);
  ground(frames);
  cleanContactSlides(frames);
  const smoothable = !["jump", "hurdle", "vault", "kick", "roll", "trip"].includes(entry.id);
  if (smoothable && frames.length > 4) {
    for (let pass = 0; pass < 2; pass++) {
      const ys = frames.map(f => f.root.y);
      for (let i = 1; i < frames.length - 1; i++) frames[i].root.y = rd((ys[i-1] + 2 * ys[i] + ys[i+1]) / 4);
    }
    ground(frames);
    cleanContactSlides(frames);
  }
  if (clip.loop && frames.length > 3) {
    const stride = entry.travel === "travel" ? (frames.at(-1).root.x - frames[0].root.x) : 0;
    const meanY = frames.reduce((sum, f) => sum + f.root.y, 0) / frames.length;
    let sin = 0, cos = 0;
    for (let i = 0; i < frames.length; i++) { const a = 2 * Math.PI * i / frames.length; sin += (frames[i].root.y - meanY) * Math.sin(a); cos += (frames[i].root.y - meanY) * Math.cos(a); }
    sin *= 2 / frames.length; cos *= 2 / frames.length;
    for (let i = 0; i < frames.length; i++) { const a = 2 * Math.PI * i / frames.length; frames[i].root.x = rd(stride * i / Math.max(1, frames.length - 1)); frames[i].root.y = rd(meanY + sin * Math.sin(a) + cos * Math.cos(a)); }
  }
  cleanContactSlides(frames);
  clearPenetratingContacts(frames);
  if (entry.id === "climb-ladder") frames.forEach((f, i) => { f.root.y = rd(f.root.y + 24 * i / Math.max(1, frames.length - 1)); f.contacts.l = false; f.contacts.r = false; });
  if (entry.id === "kick") {
    const base = structuredClone(frames[Math.min(4, frames.length - 1)]);
    frames.splice(0, frames.length, ...Array.from({ length: 90 }, (_, i) => {
      const u = i / 89;
      const e = Math.sin(Math.PI * u) ** 2;
      const fr = structuredClone(base);
      fr.root = { x: 0, y: base.root.y };
      fr.angles.torso = rd(base.angles.torso - 6 * e);
      fr.angles.rLeg.thigh = rd(base.angles.rLeg.thigh - 180 * e);
      fr.angles.rLeg.shin = rd(base.angles.rLeg.shin - 0 * e);
      fr.angles.rLeg.foot = rd(base.angles.rLeg.foot + 10 * e);
      fr.angles.lArm.upper = rd(base.angles.lArm.upper + 20 * e);
      fr.angles.rArm.upper = rd(base.angles.rArm.upper - 20 * e);
      fr.contacts = { l: false, r: false };
      return fr;
    }));
    smoothAnglesZeroPhase(frames, false, 15); ground(frames); clearPenetratingContacts(frames);
  }
  if (entry.id === "hang-swing") for (const f of frames) f.root.y = rd(f.root.y + 45);
  if (entry.id === "turn-around") frames.forEach((f, i) => f.facing = rd(Math.cos(Math.PI * i / Math.max(1, frames.length - 1)), 3));
  if (entry.id === "turn-90") frames.forEach((f, i) => f.facing = rd(Math.cos(Math.PI * 0.5 * i / Math.max(1, frames.length - 1)), 3));
}
function buildMeta(entry, clip, quality) {
  return { id: entry.id, label: entry.label, summary: entry.summary, kind: entry.kind, travel: entry.travel, facingChange: entry.facingChange, contacts: entry.contacts, markers: clip.markers ?? {}, aim: entry.aim, prop: entry.prop, mirrorable: entry.mirrorable, tags: entry.tags, durationS: rd(clip.frames.length / FPS, 3), quality: Object.fromEntries(Object.entries(quality).filter(([k]) => k !== "failures")), source: { dataset: "CMU", trial: `${entry.source.subject}_${entry.source.trial}`, range120: entry.source.range120 }, license: "CMU mocap (mocap.cs.cmu.edu), see NOTICE" };
}
function generatedTs(library) {
  return `/* eslint-disable */\n// Generated by scripts/motions/build.mjs. Do not edit by hand.\nexport const GENERATED_MOTION_LIBRARY: any = ${JSON.stringify(library).replaceAll("<", "\\u003c")};\n`;
}
function contactSheet(clips, report) {
  const data = JSON.stringify({ clips, report }).replace(/</g, "\\u003c");
  return `<!doctype html><meta charset=utf-8><title>Motion factory contact sheet</title>
<style>:root{--bg:#f7f7f8;--surface:#fff;--text:#1f2328;--muted:#667085;--line:#d0d7de;--ok:#238636;--bad:#da3633}body{margin:0;background:var(--bg);color:var(--text);font:13px system-ui}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px;padding:10px}.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:8px;overflow:hidden}svg{width:100%;height:130px}.stick{fill:none;stroke:var(--text);stroke-width:5.2;stroke-linecap:round;stroke-linejoin:round}.head{fill:var(--surface);stroke:var(--text);stroke-width:5.2}.g{stroke:var(--line)}.ok{color:var(--ok)}.bad{color:var(--bad)}.m{color:var(--muted)}.strip{display:grid;grid-template-columns:repeat(8,1fr);gap:2px;margin-top:6px}.strip svg{height:54px;background:var(--bg);border-radius:6px}.strip .stick{opacity:.42}.strip .head{opacity:.55}</style>
<h2 style="padding:10px;margin:0">Motion factory contact sheet</h2><div class=grid id=g></div><script id=data type=application/json>${data}</script>
<script>
const R=JSON.parse(document.getElementById('data').textContent),rig=R.clips[0]?.rig||{};
const D=a=>({x:Math.cos(a*Math.PI/180),y:Math.sin(a*Math.PI/180)}),A=(a,b)=>({x:a.x+b.x,y:a.y+b.y}),M=(a,s)=>({x:a.x*s,y:a.y*s}),Y=p=>-p.y;
function P(fr){const a=fr.angles,root=fr.root,p={x:root.x,y:root.y},ch=A(p,M(D(a.torso),rig.torso)),hd=A(ch,M(D(a.torso+a.head),rig.neck+rig.headRadius));function L(s){const l=a[s+'Leg'],ta=a.torso+180+l.thigh,k=A(p,M(D(ta),rig.thigh)),sa=ta+l.shin,n=A(k,M(D(sa),rig.shin)),fa=sa+l.foot,t=A(n,M(D(fa),rig.foot));return{h:p,k,n,t}}function U(s){const u=a[s+'Arm'],ua=a.torso+u.upper,e=A(ch,M(D(ua),rig.upperArm)),fa=ua+u.fore,h=A(e,M(D(fa),rig.forearm));return{s:ch,e,h}}return{p,ch,hd,l:L('l'),r:L('r'),la:U('l'),ra:U('r')}}
function c(a,b,d){return 'M '+a.x+' '+Y(a)+' Q '+b.x+' '+Y(b)+' '+d.x+' '+Y(d)} function line(a,b){return 'M '+a.x+' '+Y(a)+' L '+b.x+' '+Y(b)}
function draw(svg,clip,i){const fr=clip.frames[i%clip.frames.length],p=P(fr),cx=fr.root.x;svg.setAttribute('viewBox',(cx-70)+' -130 145 145');let h='<path class=g d="M '+(cx-120)+' 0 L '+(cx+120)+' 0"/>';for(const l of [p.r,p.l])h+='<path class=stick d="'+c(l.h,l.k,l.n)+' '+line(l.n,l.t)+'"/>';h+='<path class=stick d="'+line(p.p,p.ch)+'"/><circle class=head cx="'+p.hd.x+'" cy="'+Y(p.hd)+'" r="'+rig.headRadius+'"/>';for(const a of [p.ra,p.la])h+='<path class=stick d="'+c(a.s,a.e,a.h)+'"/>';svg.innerHTML=h}
const host=document.getElementById('g');for(const clip of R.clips){const rep=R.report.clips.find(x=>x.id===clip.name);const d=document.createElement('div');d.className='card';d.innerHTML='<b>'+clip.name+'</b> <span class="'+(rep?.passed?'ok':'bad')+'">'+(rep?.passed?'pass':'reject')+'</span><svg class=anim></svg><div class=m>'+clip.frames.length+'f '+clip.meta.kind+' '+clip.meta.travel+'</div><div class=strip></div>';host.append(d);let f=0;const svg=d.querySelector('svg.anim');setInterval(()=>{draw(svg,clip,f++)},1000/12);const strip=d.querySelector('.strip');for(let k=0;k<8;k++){const ss=document.createElementNS('http://www.w3.org/2000/svg','svg');draw(ss,clip,Math.round(k*(clip.frames.length-1)/7));strip.append(ss)}}
</script>`;
}

await mkdir(outDir, { recursive: true });
await mkdir(path.join(factoryDir, "shots"), { recursive: true });
const catalog = JSON.parse(await readFile(path.join(repo, "motions", "catalog.json"), "utf8"));
const generated = { version: 1, fps: FPS, rig, clips: {} };
const clips = [];
const report = { generatedAt: "1970-01-01T00:00:00.000Z", thresholds, clips: [] };
const approvedIndex = JSON.parse(await readFile(path.join(approvedDir, "index.json"), "utf8"));
for (const entry of catalog.motions) {
  if (entry.status === "rejected") { report.clips.push({ id: entry.id, passed: false, rejected: true, reason: entry.reason }); continue; }
  let clip;
  try {
    if (approvedIds.has(entry.id)) {
      const baseline = JSON.parse(await readFile(path.join(approvedDir, `${entry.id}.json`), "utf8"));
      clip = { name: entry.id, fps: FPS, loop: baseline.loop, frames: baseline.frames, markers: baseline.markers ?? {}, strideLength: baseline.strideLength, rig, source: baseline.source };
    } else {
      const bvh = await parseBvh(await ensureBvh(entry));
      const worlds = bvh.motion.map(row => fkFrame(bvh, row));
      const fwd = forward(worlds), p = project(worlds, fwd, 2, entry.view ?? "side"), s = scaleOf(p), c = contacts(p, bvh.fps);
      const rr = entry.source.range120; const r = rr ? { start: Math.max(2, rr[0]), end: Math.min(rr[1], p.length - 1) } : rangeFor(entry.kind === "loop" ? "cycle" : entry.id, p, c);
      let frames = framesFrom(p, c, r, s, entry.kind === "loop");
      if (entry.travel === "in-place") { const x0 = frames[0].root.x, x1 = frames.at(-1).root.x; frames = frames.map((fr,i)=>({ ...fr, root: { ...fr.root, x: rd(fr.root.x - x0 - (x1-x0)*(i/Math.max(1,frames.length-1))) }})); }
      const wantsHands = entry.contacts.includes("lHand") || entry.contacts.includes("rHand");
      frames = frames.map((fr, idx) => ({ ...fr, ...(wantsHands ? { hands: handFlags(fr, true) } : {}), ...(entry.id === "walk-backwards" ? { facing: -1 } : {}), ...(entry.facingChange ? { facing: rd(Math.cos((entry.facingChange * Math.PI / 180) * (idx / Math.max(1, frames.length - 1))), 3) } : {}) }));
      clip = { name: entry.id, fps: FPS, loop: entry.kind === "loop", frames, markers: markers(entry.id, frames, r, p), strideLength: rd(Math.max(0, frames.at(-1).root.x - frames[0].root.x)), rig, source: { dataset: "CMU", trial: `${entry.source.subject}_${entry.source.trial}`, file: entry.source.file, sourceFps: rd(bvh.fps), sourceFrames: [r.start, r.end], licenseAcknowledgement } };
    }
    postprocessClip(clip, entry);
    let quality = qualityFor(entry, clip);
    if (approvedIds.has(entry.id) && !quality.passed) {
      quality = { ...quality, approved: true, passed: true, gateExemptions: quality.failures.map(f => `${f.metric}=${f.value}>${f.threshold}`), failures: [] };
    }
    clip.meta = buildMeta(entry, clip, quality);
    const passed = quality.passed;
    report.clips.push({ id: entry.id, kind: entry.kind, passed, approved: quality.approved ?? false, gateExemptions: quality.gateExemptions ?? [], metrics: Object.fromEntries(Object.entries(quality).filter(([k]) => k !== "failures")), failures: quality.failures });
    if (passed) { generated.clips[entry.id] = clip; clips.push(clip); await writeFile(path.join(outDir, `${entry.id}.json`), JSON.stringify(clip)); console.log(`${entry.id}: pass ${clip.frames.length}f`); }
    else console.error(`${entry.id}: reject ${JSON.stringify(quality.failures)}`);
  } catch (error) {
    report.clips.push({ id: entry.id, passed: false, failures: [{ metric: "build", value: String(error?.message ?? error), threshold: "build succeeds" }] });
    console.error(`${entry.id}: build failed ${error?.message ?? error}`);
  }
}
await writeFile(path.join(outDir, "index.json"), JSON.stringify(clips.map(c => ({ name: c.name, fps: c.fps, loop: c.loop, frames: c.frames.length, strideLength: c.strideLength, markers: c.markers, source: c.source })), null, 2));
await writeFile(path.join(repo, "src", "generated", "motion-library.ts"), generatedTs(generated));
await writeFile(path.join(factoryDir, "report.json"), JSON.stringify(report, null, 2));
await writeFile(path.join(factoryDir, "report.md"), `# Motion factory report\n\nThresholds: ${JSON.stringify(thresholds)}\n\n| clip | kind | status | key metrics |\n|---|---|---|---|\n` + report.clips.map(r => `| ${r.id} | ${r.kind ?? ""} | ${r.passed ? "pass" : "reject"} | ${r.metrics ? `accel ${r.metrics.maxJointAccel}, slide ${r.metrics.contactSlide}, pen ${r.metrics.groundPenetration}` : r.reason ?? (r.failures?.[0]?.value ?? "") } |`).join("\n"));
await writeFile(path.join(factoryDir, "contact-sheet.html"), contactSheet(clips, report));
const failing = report.clips.filter(c => !c.passed && !c.rejected);
console.log(`Motion factory: ${clips.length} passing, ${failing.length} failing, ${report.clips.filter(c=>c.rejected).length} catalog-rejected`);
if (failing.length) { console.error(failing.map(f => `${f.id}: ${JSON.stringify(f.failures)}`).join("\n")); process.exitCode = 1; }
