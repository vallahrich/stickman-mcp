import { describe, expect, it } from "vitest";
// @ts-expect-error Build-time scripts are deliberately separate from the published library.
import { validatePresentation } from "../scripts/presentations/build.mjs";

const source = () => ({
  version: 1, canvasEmu: { width: 1600, height: 900 }, assets: {},
  slides: [1, 2, 3].map(number => ({ number, media: [], text: [], notes: [] }))
});
const design = () => ({
  title: "Local presentation",
  slides: [{
    source: 1, title: "A real dependency", subtitle: "One activity leads to another.", section: "Example",
    nodes: [{ id: "first", x: 100, y: 240, width: 300, height: 120, label: ["Activity"] }],
    edges: [{ id: "route", points: [[400, 300], [600, 300]] }],
    beats: [{ caption: "Explain the dependency.", active: ["first", "route"] }]
  }]
});
const interactionDesign = () => ({
  ...design(), slides: [{
    ...design().slides[0],
    objects: [{ id: "data", type: "files", label: "RAW", x: 300, y: 400, w: 50, h: 40 }],
    beats: [{
      caption: "Release, then move the object.", active: ["first"], visible: ["first"],
      objects: { data: { x: 600, type: "table", label: "DELTA", startAt: .5, visible: true } },
      actor: { motion: "push-walk", x: 200, groundY: 530, scale: 1, from: 132, to: 167, durationMs: 1000,
        scene: true, keepProps: true, hideAtEnd: true, payload: { type: "files", label: "RAW" } }
    }]
  }]
});

describe("local presentation validation", () => {
  it("accepts authored geometry tied to source slides", () => {
    expect(() => validatePresentation(source(), design())).not.toThrow();
  });
  it("rejects missing and reordered source slides", () => {
    const input = design();
    input.slides[0]!.source = 4;
    expect(() => validatePresentation(source(), input)).toThrow("Missing source slide");
    input.slides[0]!.source = 2;
    input.slides.push({ ...input.slides[0]!, source: 1 });
    expect(() => validatePresentation(source(), input)).toThrow("original order");
  });
  it("rejects diagrams outside the actual usable area", () => {
    const input = design();
    input.slides[0]!.nodes[0]!.x = 1200;
    expect(() => validatePresentation(source(), input)).toThrow("outside");
  });
  it("rejects invalid geometry and unknown cue IDs", () => {
    const input = design();
    input.slides[0]!.edges[0]!.points[0]![0] = Number.NaN;
    expect(() => validatePresentation(source(), input)).toThrow("invalid path");
    input.slides[0]!.edges[0]!.points[0]![0] = 400;
    input.slides[0]!.beats[0]!.active.push("missing");
    expect(() => validatePresentation(source(), input)).toThrow("Unknown cue");
  });
  it("does not substitute an unrelated video for source media", () => {
    const input = { ...design(), slides: [{ ...design().slides[0], video: { asset: "movie", poster: "poster" } }] };
    expect(() => validatePresentation(source(), input)).toThrow("source slide");
  });
  it("rejects connector points below the 720-high stage", () => {
    const input = design();
    input.slides[0]!.edges[0]!.points[0]![1] = 900;
    expect(() => validatePresentation(source(), input)).toThrow("invalid path");
  });
  it("rejects poster crops that lose their source bounds", () => {
    const input = {
      ...design(), slides: [{ ...design().slides[0], video: {
        asset: "movie", poster: "poster", x: 200, y: 200, width: 800, height: 400,
        focus: { beat: 1, left: .8, top: 0, width: .4, height: 1 }
      } }]
    };
    const manifest = {
      ...source(), assets: { movie: { mime: "video/mp4" }, poster: { mime: "image/png" } },
      slides: [{ number: 1, media: ["movie", "poster"] }]
    };
    expect(() => validatePresentation(manifest, input)).toThrow("outside its source image");
  });
  it("accepts explicit reveals, an approved scene cue and a delayed object transition", () => {
    expect(() => validatePresentation(source(), interactionDesign())).not.toThrow();
  });
  it("rejects unknown reveals and objects instead of silently dropping them", () => {
    const input = interactionDesign();
    input.slides[0]!.beats[0]!.visible.push("missing");
    expect(() => validatePresentation(source(), input)).toThrow("Unknown reveal");
    input.slides[0]!.beats[0]!.visible.pop();
    input.slides[0]!.objects[0]!.id = "other";
    expect(() => validatePresentation(source(), input)).toThrow("Unknown data object");
  });
  it("rejects invalid delayed transitions and off-stage object destinations", () => {
    const input = interactionDesign(), change = input.slides[0]!.beats[0]!.objects.data;
    for (const value of [-.1, 1, Number.NaN]) {
      change.startAt = value;
      expect(() => validatePresentation(source(), input)).toThrow("Invalid object transition start");
    }
    change.startAt = .5;
    change.x = 1270;
    expect(() => validatePresentation(source(), input)).toThrow("Invalid data object state");
  });
  it("requires a scene when a cue supplies a semantic payload", () => {
    const input = interactionDesign();
    input.slides[0]!.beats[0]!.actor.scene = false;
    expect(() => validatePresentation(source(), input)).toThrow("requires an actor scene");
  });
  it("does not silently accept object IDs as diagram reveal targets", () => {
    const input = interactionDesign();
    input.slides[0]!.beats[0]!.visible.push("data");
    expect(() => validatePresentation(source(), input)).toThrow("Unknown reveal");
  });
  it("ties displayed screenshots, focus crops and links to their actual source", () => {
    const manifest = {
      ...source(), assets: { poster: { mime: "image/png" } },
      slides: [{ number: 1, media: ["poster"], text: ["Read example.invalid/resource"], notes: [], links: [] }]
    };
    const input = {
      ...design(), slides: [{
        ...design().slides[0],
        images: [{ id: "screenshot", asset: "poster", x: 64, y: 170, width: 1152, height: 450, alt: "Original UI" }],
        resources: [{ id: "link", href: "https://example.invalid/resource", label: "Original resource", x: 64, y: 200, width: 400, height: 80 }],
        beats: [{ caption: "Inspect the source.", active: ["screenshot"], imageFocus: { screenshot: { left: .1, top: .1, width: .8, height: .8 } } }]
      }]
    };
    expect(() => validatePresentation(manifest, input)).not.toThrow();
    input.slides[0]!.images[0]!.asset = "other";
    expect(() => validatePresentation(manifest, input)).toThrow("Image must belong");
    input.slides[0]!.images[0]!.asset = "poster";
    input.slides[0]!.beats[0]!.imageFocus.screenshot.width = 1;
    expect(() => validatePresentation(manifest, input)).toThrow("Image focus is outside");
    input.slides[0]!.beats[0]!.imageFocus.screenshot.width = .8;
    input.slides[0]!.resources[0]!.href = "https://example.invalid/resourc";
    expect(() => validatePresentation(manifest, input)).toThrow("Resource link must appear");
  });
  it("requires complete decks to preserve all source slides and recordings", () => {
    const incomplete = { ...design(), complete: true };
    expect(() => validatePresentation(source(), incomplete)).toThrow("preserve every source slide");
    const input = { ...incomplete, slides: [1, 2, 3].map(number => ({ ...design().slides[0], source: number })) };
    expect(() => validatePresentation(source(), input)).not.toThrow();
    const manifest = { ...source(), assets: { movie: { mime: "video/mp4" } },
      slides: source().slides.map(slide => ({ ...slide, media: slide.number === 2 ? ["movie"] : [] })) };
    expect(() => validatePresentation(manifest, input)).toThrow("retain every original recording");
  });
  it("keeps a blank source slide genuinely blank instead of dropping it", () => {
    const input = { title: "Source deck", slides: [{ source: 1, title: "", subtitle: "", section: "", blank: true, beats: [{ caption: "" }] }] };
    expect(() => validatePresentation(source(), input)).not.toThrow();
    const manifest = { ...source(), slides: [{ number: 1, media: [], notes: [], text: ["Important source content"] }] };
    expect(() => validatePresentation(manifest, input)).toThrow("genuinely empty");
  });
  it("rejects truthy non-booleans and a non-text notice", () => {
    expect(() => validatePresentation(source(), { ...design(), complete: "true" })).toThrow("flag");
    expect(() => validatePresentation(source(), { ...design(), notice: 42 })).toThrow("notice");
    expect(() => validatePresentation(source(), { ...design(), slides: [{ ...design().slides[0], blank: "true" }] })).toThrow("blank-slide flag");
  });
});
