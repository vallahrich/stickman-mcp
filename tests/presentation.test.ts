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
});
