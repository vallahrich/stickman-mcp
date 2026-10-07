import { describe, expect, it } from "vitest";
import { runInNewContext, Script } from "node:vm";
import { sampleClipMotion, type MotionClip, type PoseKey } from "../dist/motion-clips.js";
import { RUNTIME_MOTION_LIBRARY } from "../dist/motion-library.js";
import { frameGeometry } from "../dist/render.js";
import { addonLifecycleState, clipFrameToSampledFrame, computeAddonFlightPoint, doorGeometry, engineSampledFrame, renderReviewHtml, renderStaticSvg, stageKitSource, REVIEW_STAGE } from "../scripts/motions/review-renderer.mjs";
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
  it("shows call participants only on opted-in desks in static and standalone rendering", async () => {
    const clip = keyed([{ frame: 0, pose: stand }, { frame: 20, pose: stand }]);
    const kit = await stageKitSource();
    for (const screen of [undefined, "video-call", "unknown"]) {
      for (const spec of [
        { prop: "desk", review: { prop: { screen, monitorW: 92, monitorH: 63 } } },
        { review: { extraProps: [{ type: "desk", screen, monitorW: 92, monitorH: 63 }] } }
      ]) {
        const svg = await renderStaticSvg({ clip, spec, propsCatalog: { props: [] }, frameIndex: 10 });
        const markup = runInNewContext(`${kit}; scenePropMarkup(layoutScene(${JSON.stringify(spec)},{props:[]},10)[0],3,"#202124");`) as string;
        for (const output of [svg, markup]) {
          expect(output.includes('data-part="video-participant"')).toBe(screen === "video-call");
          expect(output.includes('data-part="video-call-controls"')).toBe(screen === "video-call");
          expect(output).not.toMatch(/NaN|Infinity/);
        }
      }
    }
    const defaultSpec = { prop: "desk", review: { prop: {} } };
    const unknownSpec = { prop: "desk", review: { prop: { screen: "unknown" } } };
    expect(await renderStaticSvg({ clip, spec: unknownSpec, propsCatalog: { props: [] } }))
      .toEqual(await renderStaticSvg({ clip, spec: defaultSpec, propsCatalog: { props: [] } }));
  });

  it("keeps a gently nodding remote bust without an arm in both call renderers", async () => {
    const clip = keyed([{ frame: 0, pose: stand }, { frame: 90, pose: stand }], 91);
    const spec = { prop: "desk", review: { prop: { screen: "video-call" } } };
    const kit = await stageKitSource();
    const participant = (svg: string) => svg.match(/<g data-part="video-participant"[^>]*>[\s\S]*?<\/g>/)![0];
    const busts: string[] = [];
    for (const frameIndex of [0, 25, 37, 90]) {
      const svg = await renderStaticSvg({ clip, spec, propsCatalog: { props: [] }, frameIndex });
      const strokeWidth = frameGeometry(engineSampledFrame(sampleClipMotion, clip, frameIndex)).strokeWidth;
      const markup = runInNewContext(`${kit}; scenePropMarkup(layoutScene(${JSON.stringify(spec)},{props:[]},${frameIndex})[0],${strokeWidth},"#202124");`) as string;
      expect(participant(svg)).toEqual(participant(markup));
      for (const output of [svg, markup]) {
        expect(output).not.toContain('data-part="video-participant-wave"');
        expect(participant(output).match(/<path/g)).toHaveLength(1);
      }
      busts.push(participant(svg));
    }
    expect(busts[0]).toEqual(busts[3]);
    expect(new Set(busts.slice(0, 3)).size).toBe(3);
  });

  it.each([
    ["headphones", "headphone-band"],
    ["detective-hat", "detective-brim"],
    ["thought-cloud", "frustration-scribble"],
    ["anger-mark", "anger-veins"]
  ])("draws identifiable %s in every office prop path", async (type, part) => {
    const clip = keyed([{ frame: 0, pose: stand }, { frame: 20, pose: stand }]);
    const kit = await stageKitSource();
    for (const spec of [
      { prop: type, review: { prop: { color: "#765432", front: true } } },
      { review: { extraProps: [{ type, color: "#765432", front: true }] } },
      { review: { addons: [{ type, color: "#765432" }] } }
    ]) {
      const svg = await renderStaticSvg({ clip, spec, propsCatalog: { props: [] }, frameIndex: 10 });
      const markup = runInNewContext(`${kit}; scenePropMarkup(layoutScene(${JSON.stringify(spec)},{props:[]},10)[0],3,"#202124");`) as string;
      for (const output of [svg, markup]) {
        expect(output).toContain(`data-part="${part}"`);
        expect(output).toContain("#765432");
        expect(output).not.toMatch(/NaN|Infinity/);
      }
    }
  });

  it("adds laptop keys, touchpad and webcam only when requested, without moving its lid or base", async () => {
    const clip = keyed([{ frame: 0, pose: stand }, { frame: 20, pose: stand }]);
    const base = { prop: "laptop", review: { prop: { x: 33, y: 66.98, w: 48, h: 34, open: 1 } } };
    const detailed = { ...base, review: { prop: { ...base.review.prop, details: true } } };
    const plain = await renderStaticSvg({ clip, spec: base, propsCatalog: { props: [] } });
    const enhanced = await renderStaticSvg({ clip, spec: detailed, propsCatalog: { props: [] } });
    for (const part of ["laptop-lid", "laptop-base", "laptop-hinge"]) {
      const pattern = new RegExp(`data-part="${part}" d="([^"]+)"`);
      expect(enhanced.match(pattern)![1]).toEqual(plain.match(pattern)![1]);
    }
    expect(enhanced.match(/data-part="laptop-key"/g)).toHaveLength(15);
    expect(enhanced).toContain('data-part="laptop-touchpad"');
    expect(enhanced).toContain('data-part="laptop-webcam"');
    expect(plain).not.toContain('data-part="laptop-touchpad"');
    const kit = await stageKitSource();
    const markup = runInNewContext(`${kit}; scenePropMarkup(layoutScene(${JSON.stringify(detailed)},{props:[]},0)[0],3,"#202124");`) as string;
    expect(markup.match(/data-part="laptop-key"/g)).toHaveLength(15);
  });

  it("draws the approved run exactly as sampleClipMotion does", async () => {
    const run = RUNTIME_MOTION_LIBRARY.clips.run as MotionClip;
    for (const frame of [0, 5, 11, 17]) {
      const review = await clipFrameToSampledFrame(run, frame);
      const engine = engineAt(run, frame);
      expect(review.segments).toEqual(engine.segments);
      expect(review.head).toEqual(engine.headPoint);
    }
  });

  describe("hardware and UI review props", () => {
    const clip = keyed([{ frame: 0, pose: stand }, { frame: 20, pose: stand }]);
    const catalog = { props: [] };
    const types = ["cable", "socket", "server-rack", "server-module", "window", "cursor"];
    const sizes = [[64, 32], [18, 22], [64, 120], [52, 16], [80, 54], [12, 18]];
    const parts = ["cable-flex", "socket-port", "rack-rail", "server-chassis", "window-titlebar", "cursor-arrow"];
    const variants = (type: string, descriptor: object = {}, keys: object[] = []) => [
      { prop: type, review: { prop: descriptor, propMotion: keys } },
      { review: { extraProps: [{ type, ...descriptor, propMotion: keys }] } },
      { review: { addons: [{ type, ...descriptor, keys }] } }
    ];

    it.each(types)("draws an identifiable colored %s across all scene paths", async (type) => {
      for (const [i, spec] of variants(type, { color: "#a176bc", w: 96, h: 48 }).entries()) {
        const svg = await renderStaticSvg({ clip, spec, propsCatalog: catalog, frameIndex: 10 });
        expect(svg).toContain(`data-${i === 2 ? "addon" : "prop"}="${type}"`);
        expect(svg).toContain(`data-part="${parts[types.indexOf(type)]}"`);
        expect(svg).toContain("#a176bc");
        expect(svg).not.toContain(`<rect data-prop="${type}"`);
        if (type === "cable") {
          expect(svg).toMatch(/data-part="cable-flex" d="M[^"]+C/);
          expect(svg).toContain('data-part="cable-plug"');
          expect(svg).toContain('data-part="cable-contacts"');
        } else if (type === "server-rack") {
          expect(svg.match(/data-part="rack-rail"/g)).toHaveLength(2);
          expect(svg.match(/data-part="server-unit"/g)).toHaveLength(5);
          expect(svg.match(/data-part="server-indicator"/g)).toHaveLength(5);
          expect(svg.match(/data-part="server-vent"/g)).toHaveLength(20);
        } else if (type === "window") {
          expect(svg).toContain('data-part="window-drag-handle"');
          expect(svg).toContain('data-part="window-content-card"');
          expect(svg.match(/data-part="window-control"/g)).toHaveLength(3);
        } else if (type === "cursor") {
          expect(svg).toMatch(/data-part="cursor-arrow" d="M(?:[^L]+L){6}[^"]+Z"/);
        }
      }
    });

    it("moves only the flexible cable endpoint and meets an actual socket at the last key", async () => {
      const kit = await stageKitSource();
      // Local cable tip starts at (54.4,25.6); socket center is (89,31).
      const keys = [{ frame: 0, plugX: 0, plugY: 0, plugRot: -30 }, { frame: 20, plugX: 34.6, plugY: 5.4, plugRot: 0 }];
      for (const spec of variants("cable", { x: 0 }, keys)) {
        const s = { ...spec, review: { ...spec.review, extraProps: [...("extraProps" in spec.review ? spec.review.extraProps : []), { type: "socket", x: 80, y: 20 }] } };
        const result = runInNewContext(`${kit};
          const spec=${JSON.stringify(s)};
          const scenes=[0,10,20].map(f=>layoutScene(spec,{props:[]},f));
          const cables=scenes.map(s=>s.find(p=>p.type==="cable"));
          ({geometry:cables.map(cableGeometry), rot:cables.map(p=>p.plugRot),
            socket:reviewPropAnchor(scenes[2].find(p=>p.type==="socket")),
            paths:cables.map(p=>scenePropMarkup(p,3,"#202124"))});`);
        const geometries = Array.from(result.geometry as { tip: { x: number; y: number }; tail: object }[]);
        expect(geometries[0]!.tail).toEqual(geometries[1]!.tail);
        expect(geometries[0]!.tail).toEqual(geometries[2]!.tail);
        expect(geometries[1]!.tip.x).toBeCloseTo((geometries[0]!.tip.x + geometries[2]!.tip.x) / 2);
        expect(geometries[1]!.tip.y).toBeCloseTo((geometries[0]!.tip.y + geometries[2]!.tip.y) / 2);
        expect(geometries[2]!.tip.x).toBeCloseTo(result.socket.x);
        expect(geometries[2]!.tip.y).toBeCloseTo(result.socket.y);
        expect(Array.from(result.rot)).toEqual([-30, -15, 0]);
        const svgs = await Promise.all([0, 10, 20].map(frameIndex => renderStaticSvg({ clip, spec: s, propsCatalog: catalog, frameIndex })));
        const flex = (svg: string) => svg.match(/data-part="cable-flex" d="([^"]+)"/)![1];
        expect(new Set(svgs.map(flex)).size).toBe(3);
        expect(svgs.map(flex)).toEqual(Array.from(result.paths as string[]).map(flex));
      }
    });

    it.each(types)("honors %s dimensions, transforms, lifecycle and escaped colors in executable stage kits", async (type) => {
      const kit = await stageKitSource();
      const descriptor = { color: 'red" onload="<bad>&\'', scale: 0.8, rot: 10, fade: 0.8, enter: { frame: 2, dur: 4, style: "fade" }, exit: { frame: 12, dur: 4, style: "shrink" } };
      const keys = [{ frame: 0, rot: 10, scale: 0.8 }, { frame: 20, rot: 50, scale: 1.2 }];
      for (const spec of variants(type, descriptor, keys)) {
        const result = runInNewContext(`${kit};
          const spec=${JSON.stringify(spec)};
          const scenes=[1,4,8,14,16].map(f=>layoutScene(spec,{props:[]},f));
          ({counts:scenes.map(s=>s.length),p:scenes[2][0],fade:scenes[1][0].opacity,
            scale:scenes[3][0].drawScale,markup:scenePropMarkup(scenes[2][0],3,"#202124")});`);
        expect(Array.from(result.counts)).toEqual([0, 1, 1, 1, 0]);
        expect(result.p.w).toBe(sizes[types.indexOf(type)]![0]! * 0.75);
        expect(result.p.h).toBe(sizes[types.indexOf(type)]![1]! * 0.75);
        expect(result.p.rot).toBe(26);
        expect(result.fade).toBeCloseTo(0.4);
        expect(result.scale).toBeCloseTo(0.54);
        expect(result.markup).toContain("red&quot; onload=&quot;&lt;bad&gt;&amp;&apos;");
        expect(result.markup).not.toContain('onload="<bad>');
        expect(result.markup).toContain("rotate(26 ");
      }
    });

    it("uses real grip anchors for cable tips, cursor tips, titlebars and modules", async () => {
      const kit = await stageKitSource();
      for (const type of types) {
        for (const spec of [
          { prop: type, review: { prop: { attach: { hand: "r", from: 5, to: 10, hiddenBefore: true, hiddenAfter: true, dx: 2, dy: 3 } } } },
          { review: { extraProps: [{ type, attach: { hand: "both", from: 5, to: 10, hiddenBefore: true, hiddenAfter: true, dx: 2, dy: 3 } }] } },
          { review: { addons: [{ type, attach: [{ to: "right-hand", from: 5, until: 10, dx: 2, dy: 3 }] }] } }
        ]) {
          const result = runInNewContext(`${kit};
            const spec=${JSON.stringify(spec)},catalog={props:[{type:${JSON.stringify(type)},defaultSize:{w:80,h:40}}]};
            const scenes=[4,5,10,11].map(f=>layoutScene(spec,catalog,f,()=>({x:180,y:80})));
            const p=scenes[1][0];
            const descriptor=spec.review.prop??spec.review.extraProps?.[0]??spec.review.addons?.[0];
            const raw=spec.review.addons?layoutAddonRaw(descriptor,5):
              layoutProp({prop:${JSON.stringify(type)},review:{prop:descriptor}},catalog,5);
            ({counts:scenes.map(s=>s.length),anchor:reviewPropAnchor(p),p,
              tail:p.type==="cable"?cableGeometry(p).tail:null,
              rawTail:p.type==="cable"?cableGeometry(raw).tail:null});`);
          const addon = "addons" in spec.review;
          expect(Array.from(result.counts)).toEqual(addon ? [1, 1, 1, 1] : [0, 1, 1, 0]);
          expect(result.anchor).toEqual({ x: 181.5, y: 77.75 });
          expect(result.p.front).toBe(true);
          if (!addon) expect(result.p).toMatchObject({ w: 60, h: 30 });
          if (type === "cable") expect(result.tail).toEqual(result.rawTail);
        }
      }
    });

    it("drags the UI window and cursor together without changing their local silhouettes", async () => {
      const kit = await stageKitSource();
      const result = runInNewContext(`${kit};
        const keys=[{frame:0,x:0,y:0},{frame:20,x:30,y:12}];
        const spec={prop:"window",review:{prop:{x:10,y:30},propMotion:keys,
          extraProps:[{type:"cursor",x:43.6,y:59.52,propMotion:keys}]}};
        [0,10,20].map(f=>layoutScene(spec,{props:[]},f).map(p=>({anchor:reviewPropAnchor(p),w:p.w,h:p.h})));`);
      const frames = Array.from(result as { anchor: { x: number; y: number }; w: number; h: number }[][]);
      for (const frame of frames) {
        expect(frame[0]!.anchor.x).toBeCloseTo(frame[1]!.anchor.x);
        expect(frame[0]!.anchor.y).toBeCloseTo(frame[1]!.anchor.y);
        expect(frame[0]).toMatchObject({ w: 60, h: 40.5 });
        expect(frame[1]).toMatchObject({ w: 9, h: 13.5 });
      }
      expect(frames[2]![0]!.anchor.x - frames[0]![0]!.anchor.x).toBeCloseTo(22.5);
      expect(frames[2]![0]!.anchor.y - frames[0]![0]!.anchor.y).toBeCloseTo(-9);
    });

    it("slides a separate server module into a stationary rack using every key path", async () => {
      const kit = await stageKitSource();
      for (const spec of variants("server-module", { x: -40, y: 60 }, [{ frame: 0, x: 0 }, { frame: 20, x: 40 }])) {
        const s = { ...spec, review: { ...spec.review, extraProps: [...("extraProps" in spec.review ? spec.review.extraProps : []), { type: "server-rack", x: 0 }] } };
        const result = runInNewContext(`${kit};
          const spec=${JSON.stringify(s)};
          const scenes=[0,10,20].map(f=>layoutScene(spec,{props:[]},f));
          ({modules:scenes.map(s=>s.find(p=>p.type==="server-module")),
            racks:scenes.map(s=>scenePropMarkup(s.find(p=>p.type==="server-rack"),3,"#202124"))});`);
        const modules = Array.from(result.modules as { x: number; y: number; w: number; h: number }[]);
        expect(modules.map(p => p.x)).toEqual([130, 145, 160]);
        expect(modules.every(p => p.y === 93 && p.w === 39 && p.h === 12)).toBe(true);
        expect(new Set(Array.from(result.racks)).size).toBe(1);
      }
    });

    it("executes all hardware helpers from standalone review HTML as well as the stage kit", async () => {
      const spec = { prop: "cable", review: { propMotion: [{ frame: 0, plugX: 0 }, { frame: 20, plugX: 20 }], extraProps: types.slice(1).map(type => ({ type })) } };
      const html = await renderReviewHtml({ clip, spec, report: {}, propsCatalog: catalog });
      const source = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]!).find(s => s.includes("const ENGINE_FRAME_GEOMETRY="))!;
      expect(() => new Script(source)).not.toThrow();
      const execute = (helpers: string) => runInNewContext(`${helpers};
        const spec=${JSON.stringify(spec)},clip=${JSON.stringify(clip)};
        [0,10,20].map(f=>{
          const sample=engineSampledFrame(sampleClipMotion,clip,f);
          const scene=layoutScene(spec,{props:[]},f,(ix,target)=>pointFromSample(engineSampledFrame(sampleClipMotion,clip,ix),target));
          return scene.map(p=>scenePropMarkup(p,ENGINE_FRAME_GEOMETRY(sample).strokeWidth,"#202124")).join("");
        });`);
      const htmlFrames = Array.from(execute(source.split("const D=JSON.parse")[0]!));
      expect(htmlFrames).toEqual(Array.from(execute(await stageKitSource())));
      for (const frame of htmlFrames as string[]) for (const part of parts) expect(frame).toContain(`data-part="${part}"`);
      expect(html).toContain("--cp-bg:");
      expect(html).toContain('font:14px "Segoe UI",Aptos,Calibri');
    });
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
