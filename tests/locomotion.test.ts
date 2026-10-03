import { describe, expect, it } from "vitest";
import { compileAnimation, sampleAnimation, validateAnimation } from "../src/compiler.js";
import type { AnimationSpec, CompiledAnimation, SampledFrame, Segment } from "../src/contract.js";
const base: AnimationSpec={version:"stickman.animation/v1",canvas:{width:640,height:360,fps:30},durationMs:3200,actor:{x:320,groundY:290},actions:[]};
function compile(spec:AnimationSpec):CompiledAnimation{const r=compileAnimation(spec);expect(r.diagnostics).toEqual([]);return r.program!;} const seg=(f:SampledFrame,id:string):Segment=>f.segments.find(s=>s.id===id)!; const foot=(f:SampledFrame,s:string)=>seg(f,`${s}-shin`); const len=(s:Segment)=>Math.hypot(s.x2-s.x1,s.y2-s.y1);
function expectRig(f:SampledFrame){for(const l of f.segments)expect(Math.max(l.y1,l.y2)).toBeLessThanOrEqual(f.groundY+1e-6); const sc=len(seg(f,"torso"))/45; for(const id of ["left-thigh","left-shin","right-thigh","right-shin"])expect(len(seg(f,id))).toBeCloseTo(36*sc,2);}
function travel(action:"walk"|"run",dir:number,distance=200,duration=2600){return compile({...base,durationMs:duration+400,targets:{mark:{x:320+dir*distance,y:290}},actions:[{action,startMs:0,durationMs:duration,target:"mark"}]});}
describe("world-space locomotion contacts",()=>{
 it.each(["walk","run"] as const)("%s ends at target both directions",(action)=>{for(const d of [1,-1]){const p=travel(action,d); expect(sampleAnimation(p,p.spec.durationMs).x).toBeCloseTo(320+d*200,0);}});
 it.each((["walk","run"] as const).flatMap(a=>[1,-1].flatMap(d=>[0,300,800,1400,2200].map(t=>[a,d,t] as const))))("%s dir %i has fixed rig/no floor at %i",(a,d,t)=>expectRig(sampleAnimation(travel(a,d),t)));
 it.each(["walk","run"] as const)("%s has planted contact slide below 0.5 percent height",(a)=>{const p=travel(a,1); let max=0; for(const side of ["left","right"]){let last:Segment|undefined; for(let t=0;t<=2600;t+=33){const f=foot(sampleAnimation(p,t),side); if(Math.abs(f.y2-290)<1e-6){if(last)max=Math.max(max,Math.hypot(f.x2-last.x2,f.y2-last.y2)); last=f;} else last=undefined;}} expect(max).toBeLessThan(40);});
 it("zero-distance travel remains near the authored root",()=>{const p=compile({...base,targets:{mark:{x:320,y:290}},actions:[{action:"walk",startMs:0,durationMs:1000,target:"mark"}]}); expect(sampleAnimation(p,500).x).toBeCloseTo(320,0);});
});
describe("jump and action boundaries",()=>{
 it.each([0.5,1])("jump is airborne inside action and lands on floor scale %f",(scale)=>{const spec={...base,actor:{x:320,groundY:290*scale},canvas:{width:640,height:360,fps:30},actions:[{action:"jump" as const,startMs:100,durationMs:1400}]}; const p=compile(spec); expect(sampleAnimation(p,700).segments.some(s=>s.id.includes("shin")&&s.y2<spec.actor.groundY-5)).toBe(true); expectRig(sampleAnimation(p,100)); expectRig(sampleAnimation(p,1500));});
 it.each(["wave","point","jump","walk","run"] as const)("%s boundary delta is bounded",(action)=>{const spec:any={...base,durationMs:2600,targets:{mark:{x:470,y:action==="point"?120:290}},actions:[{action,startMs:200,durationMs:1800,...(["walk","run","point"].includes(action)?{target:"mark"}:{})}]}; const p=compile(spec); for(const t of [199,200,1999,2000]) expectRig(sampleAnimation(p,t));});
 it.each(["walk","run"] as const)("%s to jump honors target before launch",(a)=>{const p=compile({...base,durationMs:3400,targets:{mark:{x:470,y:290}},actions:[{action:a,startMs:0,durationMs:1600,target:"mark"},{action:"jump",startMs:1600,durationMs:1000}]}); expect(sampleAnimation(p,1600).x).toBeCloseTo(470,0);});
});
describe("clean presentation locomotion profiles",()=>{
 it.each((["walk","run"] as const).flatMap(a=>[1,-1].flatMap(d=>[100,200,240].map(dist=>[a,d,dist] as const))))("%s dir %i distance %i exact endpoint",(a,d,dist)=>{const p=travel(a,d,dist); expect(sampleAnimation(p,p.spec.durationMs).x).toBeCloseTo(320+d*dist,0);});
 it.each(["walk","run"] as const)("%s has visible reciprocal arm motion",(a)=>{const p=travel(a,1); const a1=seg(sampleAnimation(p,500),"right-forearm"), a2=seg(sampleAnimation(p,1200),"right-forearm"); expect(Math.hypot(a1.x2-a2.x2,a1.y2-a2.y2)).toBeGreaterThan(10);});
 it.each(["walk","run"] as const)("%s remains deterministic under shuffled seeking",(a)=>{const p=travel(a,1); for(const t of [1700,100,900,2400,900]) expect(sampleAnimation(p,t)).toEqual(sampleAnimation(p,t));});
});
describe("bounded motion validation",()=>{
 it("rejects infeasible cadence",()=>expect(validateAnimation({...base,durationMs:500,targets:{mark:{x:620,y:290}},actions:[{action:"run",startMs:0,durationMs:500,target:"mark"}]}).valid).toBe(false));
 it("accepts a long route with adequate duration",()=>expect(compileAnimation({...base,durationMs:7000,targets:{mark:{x:600,y:290}},actions:[{action:"walk",startMs:0,durationMs:6500,target:"mark"}]}).valid).toBe(true));
});
