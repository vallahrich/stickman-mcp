import { describe, expect, it } from "vitest";
import { runInNewContext, Script } from "node:vm";
import { sampleClipMotion, type MotionClip, type PoseKey } from "../dist/motion-clips.js";
import { RUNTIME_MOTION_LIBRARY } from "../dist/motion-library.js";
import { addonLifecycleState, clipFrameToSampledFrame, computeAddonFlightPoint, doorGeometry, renderReviewHtml, renderStaticSvg, stageKitSource, REVIEW_STAGE } from "../scripts/motions/review-renderer.mjs";
import { buildKeyPoseClip, keyPoseGates } from "../scripts/motions/keypose.mjs";

const stand: PoseKey = { anchor: "both", lean: 2, neck: -1, bob: 0, rLeg: { hip: 5, knee: 13 }, lLeg: { hip: -8, knee: 14 }, rArm: { shoulder: -8, elbow: 45 }, lArm: { shoulder: 8, elbow: 45 } };
const neutral = (RUNTIME_MOTION_LIBRARY.clips.idle as MotionClip).frames[0]!;

function keyed(poseKeys: { frame: number; pose: PoseKey }[], frames = 21): MotionClip {
  return buildKeyPoseClip({ id: "test-keyed", frames, poseKeys }, neutral) as MotionClip;
}

function engineAt(clip: MotionClip, frame: number) {
  const n = clip.frames.length;
  return sampleClipMotion({ clips: { [clip.name]: clip } }, { action: clip.name, clipId: clip.name, progress: clip.loop ? frame / n : frame / (n - 1), startX: REVIEW_STAGE.rootX, endX: REVIEW_STAGE.rootX, groundY: REVIEW_STAGE.groundY, facing: 1, scale: REVIEW_STAGE.scale });
}

describe("motion review renderer uses the shipping engine", () => {
  it("draws the approved run exactly as sampleClipMotion does", async () => {
    const run = RUNTIME_MOTION_LIBRARY.clips.run as MotionClip;
    for (const frame of [0, 5, 11, 17]) {
      const review = await clipFrameToSampledFrame(run, frame);
      const engine = engineAt(run, frame);
      expect(review.segments).toEqual(engine.segments);
      expect(review.head).toEqual(engine.headPoint);
    }
  });

  describe("bounded office review props", () => {
    const types = ["laptop", "tablet", "magnifier", "notebook", "pen"];
    const clip = keyed([{ frame: 0, pose: stand }, { frame: 20, pose: stand }]);
    const catalog = { props: [] };
    const sizes = [[48, 34], [22, 30], [24, 34], [30, 36], [4, 22]];
    const parts = ["laptop-hinge", "tablet-screen", "magnifier-lens", "notebook-pages", "pen-nib"];

    it.each(types)("draws identifiable colored %s in primary, extra, and add-on paths", async (type) => {
      const descriptor = { type, x: 40, open: 1, ink: 1, color: "#9876ab" };
      const specs = [
        { prop: type, review: { prop: descriptor } },
        { review: { extraProps: [descriptor] } },
        { review: { addons: [descriptor] } }
      ];
      for (const [i, spec] of specs.entries()) {
        const svg = await renderStaticSvg({ clip, spec, propsCatalog: catalog, frameIndex: 10 });
        expect(svg).toContain(`data-${i === 2 ? "addon" : "prop"}="${type}"`);
        expect(svg).toContain(`data-part="${parts[types.indexOf(type)]}"`);
        expect(svg).toContain("#9876ab");
        expect(svg).toMatch(/data-part="[^"]+"[^>]*(?: d="M| cx=")/);
        expect(svg).not.toContain(`<rect data-prop="${type}"`);
      }
    });

    it("projects the hinged laptop lid as it opens and clamps authored fractions", async () => {
      const render = (open: number) => renderStaticSvg({ clip, spec: { prop: "laptop", review: { prop: { open } } }, propsCatalog: catalog });
      const [closed, half, opened, under, over] = await Promise.all([render(0), render(0.5), render(1), render(-1), render(2)]);
      const lid = (svg: string) => svg.match(/data-part="laptop-lid" d="([^"]+)"/)![1];
      expect(lid(closed)).not.toBe(lid(half));
      expect(lid(half)).not.toBe(lid(opened));
      expect(lid(under)).toBe(lid(closed));
      expect(lid(over)).toBe(lid(opened));
      expect(closed).not.toContain('data-part="laptop-screen"');
      expect(opened).toContain('data-part="laptop-screen"');
      expect(opened).toContain('data-part="laptop-keyboard"');
      expect(opened).toContain('data-part="laptop-base"');
    });

    it("reveals notebook ink through primary, extra, and add-on motion keys", async () => {
      const keys = [{ frame: 0, ink: 0 }, { frame: 20, ink: 1 }];
      for (const spec of [
        { prop: "notebook", review: { propMotion: keys } },
        { review: { extraProps: [{ type: "notebook", propMotion: keys }] } },
        { review: { addons: [{ type: "notebook", keys }] } }
      ]) {
        const render = (frameIndex: number) => renderStaticSvg({ clip, spec, propsCatalog: catalog, frameIndex });
        const [blank, mid, full] = await Promise.all([render(0), render(10), render(20)]);
        expect(blank).toContain('data-part="notebook-rule"');
        expect(blank).not.toContain('data-part="notebook-ink"');
        expect(mid.match(/data-part="notebook-ink"/g)).toHaveLength(2);
        expect(full.match(/data-part="notebook-ink"/g)).toHaveLength(4);
      }
    });

    it.each(types)("honors %s attachment, fade, scale, lifecycle and escaped colors in standalone kits", async (type) => {
      const kit = await stageKitSource();
      const descriptor = {
        type, open: 1, color: 'red" onload="<bad>&\'', fade: 0.8, scale: 0.9,
        enter: { frame: 2, dur: 4, style: "fade" }, exit: { frame: 12, dur: 4, style: "shrink" }
      };
      const spec = { prop: type, review: { prop: { ...descriptor, attach: { hand: "r", from: 0 } } } };
      const addonSpec = { review: { addons: [{ ...descriptor, attach: [{ to: "right-hand", from: 0 }] }] } };
      const extraSpec = { review: { extraProps: [{ ...descriptor, attach: { hand: "r", from: 0 } }] } };
      for (const s of [spec, extraSpec, addonSpec]) {
        const result = runInNewContext(`${kit};
          const spec=${JSON.stringify(s)}, stage={rootX:160,groundY:150,scale:.75};
          const pointAt=()=>({x:178,y:78,angle:0});
          const scenes=[1,4,8,14,16].map(f=>layoutScene(spec,{props:[]},f,pointAt,stage));
          const p=scenes[2][0];
          ({counts:scenes.map(s=>s.length), anchor:officePropAnchor(p), w:p.w,h:p.h,
            rot:p.rot, fade:scenes[1][0].opacity, scale:scenes[3][0].drawScale,
            markup:scenePropMarkup(p,3,"#202124")});`);
        expect(Array.from(result.counts)).toEqual([0, 1, 1, 1, 0]);
        expect(result.anchor).toEqual({ x: 178, y: 78 });
        expect(result.w).toBe(sizes[types.indexOf(type)]![0]! * 0.75);
        expect(result.h).toBe(sizes[types.indexOf(type)]![1]! * 0.75);
        expect(result.rot).toBe(type === "pen" ? -90 : 0);
        expect(result.fade).toBeCloseTo(0.4);
        expect(result.scale).toBeCloseTo(0.45);
        expect(result.markup).toContain("red&quot; onload=&quot;&lt;bad&gt;&amp;&apos;");
        expect(result.markup).not.toContain('onload="<bad>');
        if (type === "pen") expect(result.markup).toContain("rotate(-90 178 78)");
        if (type === "magnifier") {
          expect(result.markup).toContain('fill-opacity="0.25"');
          expect(result.markup).toMatch(/data-part="magnifier-ring"[^>]*fill="none"/);
        }
      }
    });

    it("samples office transforms and open keys without changing old fallback dimensions", async () => {
      const kit = await stageKitSource();
      const result = runInNewContext(`${kit};
        const p=layoutProp({prop:"laptop",review:{prop:{x:40,y:10,w:60,h:40},
          propMotion:[{frame:0,open:0,rot:0,scale:1,fade:1},{frame:20,open:1,rot:40,scale:2,fade:0}]}},{props:[]},10);
        const old=layoutProp({prop:"unknown",review:{prop:{}}},{props:[]},0);
        ({open:p.open,rot:p.rot,scale:p.drawScale,opacity:p.opacity,w:p.w,h:p.h,old:[old.w,old.h]});`);
      expect(result).toMatchObject({ open: 0.5, rot: 20, scale: 1.5, opacity: 0.5, w: 45, h: 30 });
      expect(Array.from(result.old)).toEqual([45, 30]);
    });

    it("preserves attachment windows, offsets and catalog dimension overrides", async () => {
      const kit = await stageKitSource();
      const result = runInNewContext(`${kit};
        const prop={type:"pen",attach:{hand:"l",from:5,to:10,hiddenBefore:true,hiddenAfter:true,dx:2,dy:3}};
        const catalog={props:[{type:"pen",defaultSize:{w:6,h:24}}]};
        const scenes=[4,5,10,11].map(f=>layoutScene({review:{extraProps:[prop]}},catalog,f,
          (ix,side)=>({x:100+ix,y:80,angle:Math.PI/2})));
        ({counts:scenes.map(s=>s.length),anchor:officePropAnchor(scenes[1][0]),
          w:scenes[1][0].w,h:scenes[1][0].h,rot:scenes[1][0].rot,
          lifecycle:addonLifecycleState({},0),raw:layoutAddonRaw({type:"pen"},0)});`);
      expect(Array.from(result.counts)).toEqual([0, 1, 1, 0]);
      expect(result.anchor.x).toBeCloseTo(106.5);
      expect(result.anchor.y).toBeCloseTo(77.75);
      expect(result).toMatchObject({ w: 4.5, h: 18, rot: 0, lifecycle: { visible: true }, raw: { w: 3, h: 16.5 } });
    });

    it("carries every office helper into self-contained review HTML without changing its theme", async () => {
      const html = await renderReviewHtml({ clip, spec: { prop: "laptop", review: { prop: { open: 1 } } }, report: {}, propsCatalog: catalog });
      const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]!).find(source => source.includes("const ENGINE_FRAME_GEOMETRY="))!;
      expect(() => new Script(script)).not.toThrow();
      const helpers = script.split("const D=JSON.parse")[0]!;
      const result = runInNewContext(`${helpers};
        ["laptop","tablet","magnifier","notebook","pen"].map(type=>{
          const p=layoutProp({prop:type,review:{prop:{open:1,ink:1}}},{props:[]},0);
          return scenePropMarkup(p,3,"#202124");
        });`);
      for (const [i, markup] of Array.from(result as string[]).entries()) {
        expect(markup).toContain(`data-prop="${types[i]}"`);
        expect(markup).toContain(`data-part="${parts[i]}"`);
      }
      expect(html).toContain("--cp-bg:");
      expect(html).toContain('font:14px "Segoe UI",Aptos,Calibri');
    });
  });

  it("renders authored pose keys through the engine pose system", async () => {
    const lean = { ...stand, lean: 20 };
    const clip = keyed([{ frame: 0, pose: stand }, { frame: 10, pose: lean }, { frame: 20, pose: stand }]);
    const mid = engineAt(clip, 10);
    const torso = mid.segments!.find(s => s.id === "torso")!;
    expect(Math.atan2(torso.x2 - torso.x1, torso.y1 - torso.y2) * 180 / Math.PI).toBeCloseTo(20, 4);
    const review = await clipFrameToSampledFrame(clip, 10);
    expect(review.segments).toEqual(mid.segments);
  });

  it("checks the loop seam and previews accumulated travel past the first cycle", async () => {
    const pose = { ...stand, anchor: null, bob: 30, dx: 0 };
    const spec = {
      id: "travel-loop", frames: 21, loop: true,
      poseKeys: [{ frame: 0, ease: "linear", pose }, { frame: 20, ease: "linear", pose: { ...pose, dx: 100 } }]
    };
    const broken = buildKeyPoseClip(spec, neutral) as MotionClip;
    const failure = await keyPoseGates(broken, spec);
    expect(failure.failures.some((f: { metric: string; frame: number }) => f.metric === "jointPop" && f.frame === 21)).toBe(true);
    const clip = buildKeyPoseClip({ ...spec, strideLength: 105 }, neutral) as MotionClip;
    expect(clip.strideLength).toBe(105);
    expect((await keyPoseGates(clip, spec)).passed).toBe(true);
    const before = await clipFrameToSampledFrame(clip, 20);
    const seam = await clipFrameToSampledFrame(clip, 21);
    const later = await clipFrameToSampledFrame(clip, 42);
    expect(seam.segments![0]!.x1 - before.segments![0]!.x1).toBeCloseTo(5 * REVIEW_STAGE.scale, 5);
    expect(later.segments![0]!.x1 - seam.segments![0]!.x1).toBeCloseTo(105 * REVIEW_STAGE.scale, 5);
    expect(later.x).toBeCloseTo(later.segments![0]!.x1, 5);
    expect(() => buildKeyPoseClip({ ...spec, strideLength: NaN }, neutral)).toThrow("strideLength must be finite");
  });

  it("supports root offsets, raised foot plants, foot/hand targets and facing", () => {
    const up: PoseKey = { ...stand, anchor: "both", dx: 30, dy: 20, lPlant: 20, rPlant: 20, rHand: { x: 50, y: 120 }, facing: -1 };
    const clip = keyed([{ frame: 0, pose: stand }, { frame: 20, pose: up }]);
    const end = engineAt(clip, 20);
    const s = REVIEW_STAGE.scale;
    const lShin = end.segments!.find(x => x.id === "left-shin")!;
    expect(lShin.y2).toBeCloseTo(REVIEW_STAGE.groundY - 20 * s, 3);
    expect(end.joints!.rightHand.x).toBeCloseTo(REVIEW_STAGE.rootX - 50 * s, 3);
    expect(end.joints!.rightHand.y).toBeCloseTo(REVIEW_STAGE.groundY - 120 * s, 3);
    expect(end.joints!.pelvis.x).toBeCloseTo(REVIEW_STAGE.rootX - 30 * s, 3);
    expect(end.facing).toBe(-1);
    const footClip = keyed([{ frame: 0, pose: { ...stand, rFoot: { x: 20, y: 30 }, anchor: "l" } }, { frame: 20, pose: { ...stand, rFoot: { x: 20, y: 30 }, anchor: "l" } }]);
    const foot = engineAt(footClip, 10).segments!.find(x => x.id === "right-shin")!;
    expect(foot.x2).toBeCloseTo(REVIEW_STAGE.rootX + 20 * s, 3);
    expect(foot.y2).toBeCloseTo(REVIEW_STAGE.groundY - 30 * s, 3);
  });

  it("gates catch backward knees on the real engine output", async () => {
    const bad: PoseKey = { ...stand, anchor: null, bob: 20, rLeg: { hip: 0, knee: -40 } };
    const result = await keyPoseGates(keyed([{ frame: 0, pose: stand }, { frame: 10, pose: bad }, { frame: 20, pose: stand }]), { id: "t" });
    expect(result.failures.some((f: { metric: string }) => f.metric === "kneeBendsBackward")).toBe(true);
    const ok = await keyPoseGates(keyed([{ frame: 0, pose: stand }, { frame: 20, pose: stand }]), { id: "t" });
    expect(ok.passed).toBe(true);
  });

  it("rejects floor penetration by the rendered head outline", async () => {
    const inverted: PoseKey = { ...stand, anchor: null, lean: 180, neck: 0, bob: 30 };
    const result = await keyPoseGates(keyed([
      { frame: 0, pose: stand }, { frame: 10, pose: inverted }, { frame: 20, pose: stand }
    ]), { id: "inverted-head-test", gates: { headFloor: true } });
    expect(result.failures.some((f: { metric: string }) => f.metric === "headGroundPenetration")).toBe(true);
    const neutralResult = await keyPoseGates(keyed([{ frame: 0, pose: stand }, { frame: 20, pose: stand }]), { id: "neutral-head-test" });
    expect(neutralResult.failures.some((f: { metric: string }) => f.metric === "headGroundPenetration")).toBe(false);
    const legacyResult = await keyPoseGates(keyed([
      { frame: 0, pose: stand }, { frame: 10, pose: inverted }, { frame: 20, pose: stand }
    ]), { id: "legacy-head-test" });
    expect(legacyResult.failures.some((f: { metric: string }) => f.metric === "headGroundPenetration")).toBe(false);
  });

  it("computes add-on lifecycle visibility and pop scale", () => {
    const addOn = { enter: { frame: 10, style: "pop", dur: 8 }, exit: { frame: 30, style: "fade", dur: 6 } };
    expect(addonLifecycleState(addOn, 9).visible).toBe(false);
    expect(addonLifecycleState(addOn, 10).scale).toBeCloseTo(0, 5);
    expect(addonLifecycleState(addOn, 14).scale).toBeCloseTo(1.1, 5);
    expect(addonLifecycleState(addOn, 18).scale).toBeCloseTo(1, 5);
    expect(addonLifecycleState(addOn, 36).visible).toBe(false);
  });

  it.each(["box", "ladder"])("preserves authored %s color and its default appearance", async (type) => {
    const clip = keyed([{ frame: 0, pose: stand }, { frame: 20, pose: stand }]);
    const render = (color?: string) => renderStaticSvg({
      clip, spec: { id: "colored-prop", prop: type, review: { prop: { x: 40, w: 40, h: 80, color } } },
      propsCatalog: { props: [{ type, defaultSize: { w: 40, h: 80 } }] }, frameIndex: 10
    });
    const colored = await render("#c89b31");
    expect(colored).toMatch(new RegExp(`data-prop="${type}"[^>]*${type === "box" ? "fill" : "stroke"}="#c89b31"`));
    const plain = await render();
    expect(plain).not.toContain("#c89b31");
    expect(plain).toMatch(new RegExp(`data-prop="${type}"[^>]*stroke="#202124"`));
  });

  it("renders long-jump add-on types with lifecycle visibility", async () => {
    const clip = keyed([{ frame: 0, pose: stand }, { frame: 20, pose: stand }]);
    const spec = {
      id: "long-jump-addons-test",
      review: {
        addons: [
          { id: "pit", type: "sand-pit", x: 30, y: 0, w: 80, h: 14, enter: { frame: 5, style: "fade", dur: 4 } },
          { id: "board", type: "board", x: 8, y: 0, w: 20, h: 5, enter: { frame: 5, style: "fade", dur: 4 } },
          { id: "impact", type: "sand-puff", x: 72, y: 6, w: 22, h: 16, enter: { frame: 8, style: "pop", dur: 6 }, exit: { frame: 16, style: "fade", dur: 4 } }
        ]
      }
    };
    const before = await renderStaticSvg({ clip, spec, propsCatalog: { props: [] }, frameIndex: 4 });
    expect(before).not.toContain('data-addon="sand-pit"');
    const during = await renderStaticSvg({ clip, spec, propsCatalog: { props: [] }, frameIndex: 10 });
    expect(during).toContain('data-addon="sand-pit"');
    expect(during).toContain('data-addon="board"');
    expect(during).toContain('data-addon="sand-puff"');
    expect(during).toContain("#e8c872");
  });

  it("renders attachable phone add-on with custom color", async () => {
    const clip = keyed([{ frame: 0, pose: { ...stand, rHand: { x: 24, y: 96 } } }, { frame: 20, pose: { ...stand, rHand: { x: 24, y: 96 } } }]);
    const spec = {
      id: "phone-addon-test",
      review: {
        addons: [
          { id: "phone", type: "phone", color: "#123456", attach: [{ to: "right-hand", from: 0, until: 20 }] }
        ]
      }
    };
    const svg = await renderStaticSvg({ clip, spec, propsCatalog: { props: [] }, frameIndex: 10 });
    expect(svg).toContain('data-addon="phone"');
    expect(svg).toContain('fill="#123456"');
    expect(svg).toContain('fill="#dfe5ee"');
  });

  it("renders attachable sign with centered text and stick grip anchor", async () => {
    const clip = keyed([{ frame: 0, pose: { ...stand, rHand: { x: 24, y: 96 } } }, { frame: 20, pose: { ...stand, rHand: { x: 24, y: 96 } } }]);
    const spec = {
      id: "sign-addon-test",
      review: {
        addons: [
          { id: "sign", type: "sign", color: "#ffeeaa", text: "GO", attach: [{ to: "right-hand", from: 0, until: 20 }] }
        ]
      }
    };
    const svg = await renderStaticSvg({ clip, spec, propsCatalog: { props: [] }, frameIndex: 10 });
    expect(svg).toContain('data-addon="sign"');
    expect(svg).toContain('fill="#ffeeaa"');
    expect(svg).toContain(">GO</text>");
    expect(svg).toContain('stroke="#8B5A2B"');
    // Right-hand target is at (178, 78) in review-stage pixels; default sign grip is 4 units above stick bottom.
    expect(svg).toContain('L178 81');
  });

  it("computes add-on flight parabola endpoints and apex", () => {
    const start = { x: 10, y: 100 };
    const end = { x: 70, y: 100 };
    const flight = { from: 20, to: 40, apex: 40, spin: 720 };
    expect(computeAddonFlightPoint(start, end, flight, 20, REVIEW_STAGE)).toMatchObject({ x: 10, y: 100, rot: 0 });
    expect(computeAddonFlightPoint(start, end, flight, 40, REVIEW_STAGE)).toMatchObject({ x: 70, y: 100, rot: 720 });
    const mid = computeAddonFlightPoint(start, end, flight, 30, REVIEW_STAGE);
    expect(mid.x).toBeCloseTo(40, 5);
    expect(mid.y).toBeLessThan(100);
  });

  it("keeps hinged door free edge inside frame when fully open", () => {
    const right = doorGeometry({ x: 42, y: 0, w: 67, h: 185, hinge: "right", open: 1 }, 4);
    expect(right.freeX).toBeGreaterThanOrEqual(right.x);
    expect(right.freeX).toBeLessThanOrEqual(right.x + right.w);
    expect(Math.abs(right.freeX - right.hingeX)).toBeLessThanOrEqual(right.w * 0.1);
    const left = doorGeometry({ x: 42, y: 0, w: 67, h: 185, hinge: "left", open: 1 }, 4);
    expect(left.freeX).toBeGreaterThanOrEqual(left.x);
    expect(left.freeX).toBeLessThanOrEqual(left.x + left.w);
    expect(Math.abs(left.freeX - left.hingeX)).toBeLessThanOrEqual(left.w * 0.1);
  });

  it("clips the figure to the doorway after clipFigureFrom without fading it", async () => {
    const clip = keyed([{ frame: 0, pose: stand }, { frame: 20, pose: { ...stand, dx: 70 } }]);
    const spec = {
      id: "door-clip-test",
      prop: "door",
      review: { prop: { x: 42, y: 0, w: 67, h: 185, hinge: "right", clipFigureFrom: 5 } }
    };
    const before = await renderStaticSvg({ clip, spec, propsCatalog: { props: [] }, frameIndex: 4 });
    expect(before).not.toContain("<clipPath");
    const after = await renderStaticSvg({ clip, spec, propsCatalog: { props: [] }, frameIndex: 6 });
    expect(after).toContain("<clipPath");
    expect(after).toContain('clip-path="url(#door-figure-clip-6)"');
    expect(after).toContain('data-stickman="exact-pivot"');
    expect(after).toContain('opacity="1"');
  });

  it("releases entrance clipping at clipFigureUntil while leaving the door visible", async () => {
    const clip = keyed([{ frame: 0, pose: stand }, { frame: 20, pose: { ...stand, dx: 70 } }]);
    const spec = {
      id: "door-entrance-test", prop: "door",
      review: { prop: { x: 42, y: 0, w: 67, h: 185, open: 1, clipFigureFrom: 5, clipFigureUntil: 10 } }
    };
    for (const frameIndex of [4, 5, 9, 10, 11]) {
      const svg = await renderStaticSvg({ clip, spec, propsCatalog: { props: [] }, frameIndex });
      expect(svg.includes("<clipPath")).toBe(frameIndex >= 5 && frameIndex < 10);
      expect(svg).toContain('data-prop="door"');
      expect(svg).toContain('data-stickman="exact-pivot"');
    }
  });

  it("bundles the bounded door-clipping helper into standalone stage kits", async () => {
    const kit = await stageKitSource();
    const result = runInNewContext(`${kit}; [5, 9, 10].map(frame => doorClipsFigure({ type: "door", clipFigureFrom: 5, clipFigureUntil: 10 }, frame));`);
    expect(Array.from(result)).toEqual([true, true, false]);
  });
});
