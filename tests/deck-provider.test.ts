import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { Script, createContext } from "node:vm";
import {
  MAX_FRAMES,
  cloudDeckPlan,
  compactSvg,
  composeDeckPerformance,
  deckTimeline,
  injectDeck,
  renderDeckFrames,
  selectStorySlides,
  tokenTheme
} from "../scripts/site/deck-provider.mjs";

const fakeDeck = `<!doctype html><html><head><title>Deck</title></head>` +
  `<body data-controls="hidden"><div id="deck-toolbar" class="toolbar"><button id="btn-next">Next</button></div>` +
  `<script id="deck-data" type="application/json">{}</script></body></html>`;

describe("stickman deck provider", () => {
  it("injects timing, frames and the client without touching the deck markup", () => {
    const timing = { totalFrames: 90, fps: 30, timeline: [{ slide: "a", beat: 0, start: 0, frames: 90 }] };
    const html = injectDeck(fakeDeck, { timing, film: { frames: ["</script>"] }, client: "window.ok=1;" });
    expect(html).toContain('<script id="data" type="application/json">');
    expect(html).toContain('id="play"');
    expect(html).toContain('max="89"');
    expect(html).toContain('data-controls="shown"');
    expect(html).toContain('body[data-view=present] figure.scene{background:transparent;border-color:transparent;border-radius:0;box-shadow:none;');
    expect(html).not.toMatch(/"<\/script>"/);
    expect(html.indexOf("window.ok=1;")).toBeLessThan(html.lastIndexOf("</body>"));
    expect(() => injectDeck(html, { timing, film: {}, client: "" })).toThrow(/already/);
    expect(() => injectDeck("<html><body></body></html>", { timing, film: {}, client: "" })).toThrow(/dynamic-presentations/);
  });

  it("maps film colours to theme tokens and trims precision", () => {
    expect(tokenTheme('<path fill="#ffffff" stroke="#1b1b1b"/><rect fill="#b11f4b"/>')).toBe('<path fill="@s" stroke="@t"/><rect fill="@a"/>');
    expect(compactSvg('<g id="x" data-part="arm"><path d="M1.234 -5.678"/></g>')).toBe('<g><path d="M1.23 -5.68"/></g>');
  });

  it("keeps projection precision and referenced door clips", () => {
    expect(compactSvg('<g transform="scale(0.55)"><clipPath id="door"><rect x="1.234"/></clipPath><g clip-path="url(#door)" id="actor"/></g>'))
      .toBe('<g transform="scale(0.55)"><clipPath id="door"><rect x="1.23"/></clipPath><g clip-path="url(#door)"/></g>');
  });

  it("removes only declared pilot pages from markup, index and runtime metadata", () => {
    const data = { slides: [{ id: "story" }, { id: "pilot" }], theme: "warm" };
    const html = '<section class="slide" id="story"><p>Keep</p></section><section class="slide" id="pilot"><p>Review</p></section>' +
      '<li><button data-goto="story">Story</button></li><li><button data-goto="pilot">Pilot</button></li>' +
      '<script id="deck-data" type="application/json">' + JSON.stringify(data) + '</script>';
    const selected = selectStorySlides(html, ["story"], ["pilot"]);
    expect(selected).toContain('<section class="slide" id="story">');
    expect(selected).toContain('data-goto="story"');
    expect(selected).not.toContain('id="pilot"');
    expect(selected).not.toContain('data-goto="pilot"');
    expect(JSON.parse(selected.match(/<script[^>]*>(.*?)<\/script>/)![1])).toEqual({ slides: [{ id: "story" }], theme: "warm" });
    expect(() => selectStorySlides(html, ["story"], ["other"])).toThrow(/Undeclared/);
    expect(() => selectStorySlides(html, ["missing"], ["story", "pilot"])).toThrow(/order/);
    expect(selectStorySlides(html, ["story"])).toBe(html);
  });

  it("keeps the injected browser client syntactically valid", async () => {
    const client = await fs.readFile(path.resolve("scripts", "site", "deck-provider-client.js"), "utf8");
    const diagrams = await fs.readFile(path.resolve("scripts/site/deck-diagrams.js"), "utf8");
    expect(() => new Script(client.replace("/* DECK_DIAGRAMS */", diagrams))).not.toThrow();
  });

  it("composes one continuous performance that fits the 60 second showcase", async () => {
    const storyboard = JSON.parse(await fs.readFile(path.resolve("examples", "cloud-deck", "storyboard.json"), "utf8"));
    const { composed, resources } = await composeDeckPerformance(cloudDeckPlan);
    expect(composed.continuity.maxJointStep).toBeLessThanOrEqual(14);
    const timing = deckTimeline(cloudDeckPlan, storyboard, composed);
    expect(timing.totalFrames).toBeLessThanOrEqual(MAX_FRAMES);
    expect(timing.totalFrames).toBe(1674);
    expect(composed.continuity.footSlides).toEqual([]);
    expect(composed.bridgeRecords).toHaveLength(14);
    expect(cloudDeckPlan.slides.every(slide => slide.scene)).toBe(true);
    expect(timing.timeline.map(entry => entry.slide)).toEqual(["question", "on-prem", "on-prem", "on-prem", "cloud", "cloud", "cloud", "evidence", "evidence", "evidence", "evidence", "decision"]);
    expect(Object.keys(timing.cueSlides)).toEqual(["bring-workload", "inspect-demand", "batch-capacity", "workload-evidence", "conditional-decision"]);
    expect(timing.timeline.map(e => e.frames)).toEqual(cloudDeckPlan.beatFrames);
    expect(cloudDeckPlan.performance.some(item => ["basketball-shot", "exit-door"].includes(item.motion))).toBe(false);
    expect(timing.timeline.every((entry, i) => entry.start === (i ? timing.timeline[i - 1].start + timing.timeline[i - 1].frames : 0))).toBe(true);
    expect(Object.keys(timing.scenes)).toHaveLength(5);
    const rendered = await renderDeckFrames(cloudDeckPlan, composed, resources, timing.scenes);
    expect(rendered.frames).toHaveLength(timing.totalFrames);
    expect(rendered.roots).toHaveLength(timing.totalFrames);
    expect(rendered.dict.some(svg => svg.includes('scale(0.44)'))).toBe(true);
    expect(rendered.dict.some(svg => svg.includes('id="deck-door-aperture"'))).toBe(false);
    expect(rendered.dict.some(svg => svg.includes("door-figure-clip"))).toBe(false);
  }, 120_000);

  it("follows W1 through causal scaling, tangible evidence and conditional final routes", async () => {
    const context = createContext({
      r: (v: number) => Math.round(v * 10) / 10,
      clamp: (v: number) => Math.max(0, Math.min(1, v)),
      ease: (v: number) => { const t = Math.max(0, Math.min(1, v)); return t*t*(3-2*t); },
      text: (_x: number, _y: number, label: string) => `<text>${label}</text>`
    });
    new Script(await fs.readFile(path.resolve("scripts/site/deck-diagrams.js"), "utf8")).runInContext(context);
    const c = { t:"var(--cp-text)", s:"var(--cp-surface)", a:"var(--cp-accent)", b:"var(--cp-border-strong)", l:"var(--cp-border)", m:"var(--cp-text-muted)" };
    for (const [id, fn] of Object.entries(context.sceneProps)) {
      const diagram = (fn as Function)(id === "evidence" ? 3 : 2, 149, c, 847);
      expect(diagram.markup).toContain('data-object="workload"');
      expect(diagram.markup).not.toMatch(/18%|successful|basketball|door/);
    }
    expect([0,75,149].map(f => context.cloudScene(1,f,c).markup.match(/data-units="(\d+)"/)[1])).toEqual(["2","5","2"]);
    const evidence = context.evidenceScene(3,137,c,847).markup;
    for (const id of ["baseline","dependency-map","cost-comparison","pilot-gate"]) expect(evidence).toContain(`data-object="${id}"`);
    const final = context.decisionScene(0,180,c).markup;
    expect(final).toEqual(context.decisionScene(0,269,c).markup);
    for(const label of ["Move if","Retain if","Requirements","Total cost","Pilot evidence","Pilot one workload"]) expect(final).toContain(label);
  });
});
