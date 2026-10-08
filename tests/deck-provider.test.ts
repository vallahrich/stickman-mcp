import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import {
  MAX_FRAMES,
  cloudDeckPlan,
  compactSvg,
  composeDeckPerformance,
  deckTimeline,
  injectDeck,
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
    expect(html).not.toMatch(/"<\/script>"/);
    expect(html.indexOf("window.ok=1;")).toBeLessThan(html.lastIndexOf("</body>"));
    expect(() => injectDeck(html, { timing, film: {}, client: "" })).toThrow(/already/);
    expect(() => injectDeck("<html><body></body></html>", { timing, film: {}, client: "" })).toThrow(/dynamic-presentations/);
  });

  it("maps film colours to theme tokens and trims precision", () => {
    expect(tokenTheme('<path fill="#ffffff" stroke="#1b1b1b"/><rect fill="#b11f4b"/>')).toBe('<path fill="@s" stroke="@t"/><rect fill="@a"/>');
    expect(compactSvg('<g id="x" data-part="arm"><path d="M1.234 -5.678"/></g>')).toBe('<g><path d="M1.2 -5.7"/></g>');
  });

  it("composes one continuous performance that fits the 60 second showcase", async () => {
    const storyboard = JSON.parse(await fs.readFile(path.resolve("examples", "cloud-deck", "storyboard.json"), "utf8"));
    const { composed } = await composeDeckPerformance(cloudDeckPlan);
    expect(composed.continuity.maxJointStep).toBeLessThanOrEqual(14);
    const timing = deckTimeline(cloudDeckPlan, storyboard, composed);
    expect(timing.totalFrames).toBeLessThanOrEqual(MAX_FRAMES);
    expect(timing.totalFrames).toBeGreaterThanOrEqual(1500);
    expect(timing.timeline.map(entry => entry.slide)).toEqual(["question", "on-prem", "on-prem", "on-prem", "cloud", "cloud", "cloud", "evidence", "evidence", "evidence", "decision"]);
    expect(Object.keys(timing.cueSlides)).toEqual(["rack-for-peak", "elastic-cloud", "walk-the-steps"]);
  }, 120_000);
});
