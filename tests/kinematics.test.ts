import { describe, expect, it } from "vitest";
import { compileAnimation, sampleAnimation, sampleMotionIntent } from "../src/compiler.js";
import type { AnimationSpec, CompiledAnimation, SampledFrame, Segment } from "../src/contract.js";
const base: AnimationSpec = { version: "stickman.animation/v1", canvas: { width: 640, height: 360, fps: 30 }, durationMs: 3200, actor: { x: 140, groundY: 290 }, actions: [] };
function compile(spec: AnimationSpec): CompiledAnimation { const r = compileAnimation(spec); expect(r.diagnostics).toEqual([]); return r.program!; }
const seg=(f:SampledFrame,id:string):Segment=>f.segments.find(s=>s.id===id)!; const len=(s:Segment)=>Math.hypot(s.x2-s.x1,s.y2-s.y1);
function expectRig(f:SampledFrame){ const sc=len(seg(f,"torso"))/45; expect(sc).toBeGreaterThan(0); for(const id of ["left-upper-arm","left-forearm","right-upper-arm","right-forearm"]) expect(len(seg(f,id))).toBeCloseTo(28*sc,2); for(const id of ["left-thigh","left-shin","right-thigh","right-shin"]) expect(len(seg(f,id))).toBeCloseTo(36*sc,2); for(const l of f.segments) expect(Math.max(l.y1,l.y2)).toBeLessThanOrEqual(f.groundY+1e-6); }
const programs=[
  compile({...base, targets:{mark:{x:460,y:290}}, actions:[{action:"walk",startMs:0,durationMs:2600,target:"mark"}]}),
  compile({...base, targets:{mark:{x:460,y:290}}, actions:[{action:"run",startMs:0,durationMs:1800,target:"mark"}]}),
  compile({...base, actions:[{action:"jump",startMs:100,durationMs:1400}]}),
  compile({...base, targets:{mark:{x:480,y:120}}, actions:[{action:"point",startMs:100,durationMs:1600,target:"mark"}]}),
  compile({...base, actions:[{action:"wave",startMs:100,durationMs:1600}]})
];
describe("fixed adult-proportion skeleton",()=>{
  it.each(programs.flatMap((p,pi)=>[0,250,700,1200,1800,2600,3200].map(t=>[pi,t,p] as const)))("keeps bone lengths and floor program %i at %ims",(_pi,t,p)=>expectRig(sampleAnimation(p,t)));
  it.each([{x:480,y:120},{x:180,y:60},{x:320,y:40}])("points within 10 degrees toward %#",(mark)=>{const p=compile({...base,targets:{mark},actions:[{action:"point",startMs:0,durationMs:1600,target:"mark"}]}); const f=sampleAnimation(p,800); const sh=seg(f,"right-upper-arm"), hand=seg(f,"right-forearm"); const a=Math.atan2(hand.y2-sh.y1,hand.x2-sh.x1), b=Math.atan2(mark.y-sh.y1,mark.x-sh.x1); expect(Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b)))*180/Math.PI).toBeLessThan(10);});
});
describe("absolute-time motion authority",()=>{
  it.each(programs.flatMap((p,pi)=>[0,333,777,1234,2000].map(t=>[pi,t,p] as const)))("is deterministic program %i time %i",(_pi,t,p)=>expect(sampleAnimation(p,t)).toEqual(sampleAnimation(p,t)));
  it.each(programs.map((p,i)=>[i,p] as const))("has bounded frame deltas program %i",(_i,p)=>{let last=sampleAnimation(p,0), max=0; for(let t=33;t<=p.spec.durationMs;t+=33){const f=sampleAnimation(p,t); for(const l of f.segments){const o=seg(last,l.id); max=Math.max(max,Math.hypot(l.x2-o.x2,l.y2-o.y2));} last=f;} expect(max).toBeLessThan(130);});
  it.each(programs.map((p,i)=>[i,p] as const))("reduced and static are deterministic program %i",(_i,p)=>{expect(sampleAnimation(p,0,"reduced")).toEqual(sampleAnimation(p,900,"reduced")); expect(sampleAnimation(p,0,"static")).toEqual(sampleAnimation(p,900,"static"));});
});
describe("sampler runtime argument contract",()=>{
  it.each([NaN,Infinity,-Infinity,"1",null] as unknown[])("rejects invalid time %#",(time)=>expect(()=>sampleAnimation(programs[0],time as number)).toThrow());
  it.each(["bad",null,1] as unknown[])("rejects invalid mode %#",(mode)=>expect(()=>sampleAnimation(programs[0],0,mode as never)).toThrow());
});
describe("validated structural narrowing",()=>{
  it("evaluates supplied motion intent through the canonical fixed rig",()=>{const p=programs[0]; const f=sampleMotionIntent(p,100,{rootX:200,facing:1,phase:0,hipHeight:70,leftFoot:{x:191,y:290,pole:-1,contact:true},rightFoot:{x:209,y:290,pole:-1,contact:true}}); expectRig(f);});
  it("rejects unreachable intent",()=>{const p=programs[0]; expect(()=>sampleMotionIntent(p,100,{rootX:200,facing:1,phase:0,hipHeight:70,leftFoot:{x:-1000,y:290,pole:-1,contact:true},rightFoot:{x:209,y:290,pole:-1,contact:true}})).toThrow();});
});
