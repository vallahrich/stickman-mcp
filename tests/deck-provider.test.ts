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
  stagePosition,
  deckActions,
  selectStorySlides,
  tokenTheme
} from "../scripts/site/deck-provider.mjs";
import { DECK_PROVIDER_CAPABILITIES, negotiateDeckProvider } from "../scripts/site/deck-provider.mjs";
// @ts-expect-error Repository catalogue helpers are intentionally plain JavaScript.
import { smallSizeMetadata } from "../scripts/site/catalogue.mjs";

const fakeDeck = `<!doctype html><html><head><title>Deck</title></head>` +
  `<body data-controls="hidden"><div id="deck-toolbar" class="toolbar"><button id="btn-next">Next</button></div>` +
  `<script id="deck-data" type="application/json">{}</script></body></html>`;

describe("stickman deck provider", () => {
  it("negotiates a versioned, explicitly unapproved integration contract with static fallback diagnostics", async () => {
    expect(DECK_PROVIDER_CAPABILITIES.version).toBe("stickman.deck-provider/v1");
    expect(DECK_PROVIDER_CAPABILITIES.minActorHeightPx).toBe(96);
    expect(DECK_PROVIDER_CAPABILITIES.actions).toHaveLength(6);
    expect(DECK_PROVIDER_CAPABILITIES.actions.every(action => action.approvalStatus === "integration-preview-unapproved")).toBe(true);
    expect(negotiateDeckProvider({ registerMotionProvider() {} }).compatible).toBe(true);
    expect(negotiateDeckProvider({ registerMotionProvider() {}, adapterVersion: "2.0" }).diagnostics.join(" "))
      .toContain("does not match required");
    expect(negotiateDeckProvider({}).diagnostics.join(" ")).toContain("does not expose registerMotionProvider");
    expect(smallSizeMetadata("Server check", "Check a server") ).toEqual({
      minHeightPx: 96, semanticFallback: "Server check: Check a server", smallSizePropPolicy: "props-supplement-only"
    });
    const client = await fs.readFile(path.resolve("scripts", "site", "deck-provider-client.js"), "utf8");
    expect(client).toContain("window.negotiateDeckProvider = negotiateDeckProvider");
    expect(client).toContain("using static scene fallback");
  });
  it("does not rewind to the walk origin while joining the next station", () => {
    const performance = { segments: [
      { kind: "walk", root: 400, gapStart: 0, start: 0, length: 80, end: 99 },
      { kind: "motion", root: 780, gapStart: 100, start: 118, end: 160 }
    ] };
    expect(stagePosition(performance,79)).toBe(780);
    expect(stagePosition(performance,89)).toBe(780);
    expect(stagePosition(performance,99)).toBe(780);
    expect(stagePosition(performance,100)).toBe(780);
    expect(stagePosition(performance,117)).toBe(780);
    expect(stagePosition(performance,118)).toBe(780);
  });
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
    expect(timing.totalFrames).toBe(1758);
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
    for (const seg of composed.performance.segments.filter(s=>s.kind==="walk")) {
      const next = composed.performance.segments[composed.performance.segments.indexOf(seg)+1];
      expect(stagePosition(composed.performance,seg.end)).toBe(next.root);
      for(let frame=next.gapStart;frame<=next.start;frame++) {
        expect(stagePosition(composed.performance,frame)).toBe(next.root);
      }
    }
    expect(rendered.frames).toHaveLength(timing.totalFrames);
    expect(rendered.roots).toHaveLength(timing.totalFrames);
    expect(rendered.dict.some(svg => svg.includes('scale(0.44)'))).toBe(true);
    expect(rendered.dict.some(svg => svg.includes('id="deck-door-aperture"'))).toBe(false);
    expect(rendered.dict.some(svg => svg.includes("door-figure-clip"))).toBe(false);
    expect(composed.contacts).toHaveLength(6);
    expect(composed.contacts.every(contact => contact.distance < 1)).toBe(true);
    for (const beat of ["cloud/0", "evidence/0", "decision/0"]) {
      const seg = composed.performance.segments.find(s => s.beat === beat)!;
      expect(seg.id).toBe(deckActions[beat] === "submit" ? "deck-console" : "deck-" + deckActions[beat]);
      expect(seg.spec.markers.preparation).toBeLessThan(seg.spec.markers.contact);
      expect(seg.spec.markers.contact).toBeLessThan(seg.spec.markers.recovery);
    }
    const taskSegments = composed.performance.segments.filter(s => /^deck-/.test(s.id));
    expect(new Set(taskSegments.map(s => s.id)).size).toBe(6);
    expect(new Set(taskSegments.map(s => JSON.stringify(s.spec.poseKeys))).size).toBe(6);
  }, 120_000);

  it("follows W1 through marker-timed causal output, cost inputs and conditional routes", async () => {
    const { composed } = await composeDeckPerformance(cloudDeckPlan);
    const lastFrame = composed.performance.frames-1;
    const context = createContext({
      r: (v: number) => Math.round(v * 10) / 10,
      clamp: (v: number) => Math.max(0, Math.min(1, v)),
      ease: (v: number) => { const t = Math.max(0, Math.min(1, v)); return t*t*(3-2*t); },
      text: (_x: number, _y: number, label: string) => `<text>${label}</text>`
    });
    new Script(await fs.readFile(path.resolve("scripts/site/deck-diagrams.js"), "utf8")).runInContext(context);
    const c = { t:"var(--cp-text)", s:"var(--cp-surface)", a:"var(--cp-accent)", b:"var(--cp-border-strong)", l:"var(--cp-border)", m:"var(--cp-text-muted)" };
    const eventsAt = (id: string, frame: number) => Object.fromEntries(Object.entries(composed.events[id])
      .filter(([,at]) => frame >= Number(at)).map(([name,at]) => [name,{frame:at,elapsed:frame-Number(at)}]));
    for (const [id, fn] of Object.entries(context.sceneProps)) {
      const diagram = (fn as Function)(id === "evidence" ? 3 : 2, 149, c, 847,eventsAt(id,lastFrame));
      expect(diagram.markup).toContain('data-object="workload"');
      expect(diagram.markup).not.toMatch(/18%|successful|basketball|door|Constraints fail|Unpriced estimates/);
    }
    const cloud = composed.events.cloud;
    expect(cloud.submission).toBeLessThan(cloud.arrival);
    expect(cloud.arrival).toBeLessThan(cloud.processing);
    expect(cloud.processing).toBeLessThan(cloud.drained);
    expect([cloud.submission-1,cloud.arrival+12,cloud.drained].map(f =>
      context.cloudScene(1,f,c,220,eventsAt("cloud",f)).markup.match(/data-units="(\d+)"/)[1])).toEqual(["2","5","2"]);
    // Evaluate actual output at every cloud frame; the browser verifier also seeks backwards to markers.
    for (let frame=540;frame<930;frame++) {
      const output = context.cloudScene(0,frame-540,c,220,eventsAt("cloud",frame)).markup;
      const units = Number(output.match(/data-units="(\d+)"/)[1]);
      const queue = Number(output.match(/data-queue="(\d+)"/)[1]);
      if(frame<cloud.arrival) expect(queue).toBe(0);
      if(frame<cloud.arrival+12) expect(units).toBe(2);
      if(frame<cloud.submission) expect(output).not.toContain('data-object="released-batch"');
      if(frame>=cloud.drained) {expect(queue).toBe(0);expect(units).toBe(2);}
    }
    const evidence = context.evidenceScene(3,145,c,847,eventsAt("evidence",lastFrame)).markup;
    for (const id of ["baseline","dependency-map","cost-comparison","pilot-gate"]) expect(evidence).toContain(`data-object="${id}"`);
    for(const label of ["Hardware","Licences","Operations","Migration","Usage","Egress","No result yet"]) expect(evidence).toContain(label);
    expect(evidence).not.toMatch(/stroke-width="5"|h60|m-50/);
    const activeCost = context.evidenceScene(2,145,c,638,eventsAt("evidence",composed.events.evidence.artifact2)).markup;
    expect(activeCost).toContain("same time period");
    for (const [i,id] of ["baseline","dependency-map","cost-comparison","pilot-gate"].entries()) {
      const at = composed.events.evidence["artifact"+i];
      const before = context.evidenceScene(i,0,c,220+209*i,eventsAt("evidence",at-1)).markup;
      const after = context.evidenceScene(i,0,c,220+209*i,eventsAt("evidence",at)).markup;
      expect(before).not.toContain(`data-object="${id}"`);
      expect(after).toContain(`data-object="${id}"`);
      const seg = composed.performance.segments.find(s=>s.start<=at&&s.end>=at)!;
      expect(at).toBe(seg.start+seg.spec.markers.contact);
    }
    expect(context.decisionScene(0,0,c,847,eventsAt("decision",composed.events.decision.evidence-1)).markup).not.toContain('data-object="move-route"');
    expect(context.decisionScene(0,0,c,847,eventsAt("decision",composed.events.decision.routes-1)).markup).toContain('data-object="evidence-input"');
    const final = context.decisionScene(0,180,c,847,eventsAt("decision",lastFrame-89)).markup;
    for(let frame=lastFrame-89;frame<=lastFrame;frame++) {
      expect(final).toEqual(context.decisionScene(0,269,c,847,eventsAt("decision",frame)).markup);
    }
    for(const label of ["Move if","Retain if","Requirements","Total cost","Pilot evidence","Pilot one workload"]) expect(final).toContain(label);
    expect(context.bookendScene(0,179,c,220,eventsAt("question",179)).markup).toContain("W1 = one workload");
    expect(context.cloudScene(0,0,c,220,{}).markup).toContain("Instances serving W1");
    const openingA = context.bookendScene(0,0,c,220,{}).markup;
    const openingB = context.bookendScene(0,179,c,220,eventsAt("question",179)).markup;
    expect(openingA).toEqual(openingB);
    const glyph = (markup: string) => markup.match(/data-object="workload" transform="([^"]+)"/)![1];
    expect(glyph(context.evidenceScene(0,0,c,220,{}).markup))
      .toEqual(glyph(context.evidenceScene(3,145,c,847,eventsAt("evidence",lastFrame)).markup));
    expect(evidence).not.toContain('<circle data-control');
    const atStation = context.evidenceScene(3,145,c,847,eventsAt("evidence",lastFrame)).markup;
    expect(atStation.match(/data-object="action-console"/g)).toHaveLength(1);
    expect(atStation).not.toContain('stroke-dasharray="6 6"');
    expect(final).not.toContain('data-object="action-console"');
    expect(final).not.toContain("Supply evidence to the gate");
    expect(final).not.toContain("M876 334H940");
    const measured = context.loadMeter(2,149,c,220,eventsAt("on-prem",lastFrame)).markup;
    expect(glyph(measured)).toBe("translate(305 210)");
    expect(glyph(context.cloudScene(2,149,c,220,eventsAt("cloud",lastFrame)).markup))
      .toBe(glyph(measured));
    expect(measured).toContain('data-connector="flow"');
    expect(final).toContain("M580 155H615V90M615 155V210");
    expect(final).toContain('x="650" y="40" width="310" height="100"');
    expect(final).toContain('x="650" y="160" width="310" height="100"');
    expect(measured).toContain("M339 210H440");
    expect(measured).toContain('x="440" y="106" width="490" height="202"');
    expect(measured).toContain('data-glyph="application"');
    expect(atStation).toContain('data-action="test"');
    for (const [i,action] of ["inspect","connect","compare","test"].entries()) {
      const output = context.evidenceScene(i,0,c,220+209*i,eventsAt("evidence",lastFrame)).markup;
      expect(output).toContain(`data-action="${action}"`);
      expect(output).not.toMatch(/NaN|undefined/);
    }
    const slider = (frame: number) => context.evidenceScene(3,0,c,847,eventsAt("evidence",frame)).markup;
    expect(slider(composed.events.evidence.testStart)).not.toBe(slider(composed.events.evidence.testStart+12));
    expect(slider(composed.events.evidence.artifact3)).toBe(slider(composed.events.evidence.artifact3+10));
    expect(atStation).not.toContain("Define pilot criteria and rollback before testing");
    const demandFrame = (frame: number) => context.loadMeter(1,0,c,220,eventsAt("on-prem",frame)).markup;
    const demandAt = composed.events["on-prem"].demand;
    expect(demandFrame(demandAt+30)).toContain('data-object="demand-scan"');
    expect(demandFrame(demandAt+120)).toContain('data-object="demand-scan"');
    expect(demandFrame(demandAt+180)).not.toContain('data-object="demand-scan"');
    expect(demandFrame(demandAt+30)).not.toBe(demandFrame(demandAt+120));
  },120_000);

  it("rejects missing story beats and impossible reading budgets", async () => {
    await expect(composeDeckPerformance({...cloudDeckPlan,beatFrames:cloudDeckPlan.beatFrames.map(()=>1)}))
      .rejects.toThrow(/exceeds reading-time budget/);
    const storyboard = JSON.parse(await fs.readFile("examples/cloud-deck/storyboard.json","utf8"));
    const { composed } = await composeDeckPerformance();
    storyboard.slides.find(s=>s.id==="cloud").beats.push({id:"invalid"});
    expect(()=>deckTimeline(cloudDeckPlan,storyboard,composed)).toThrow(/no beat/);
  },120_000);
});
