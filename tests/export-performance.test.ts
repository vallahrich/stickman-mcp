import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";
import {
  COMPACT_CLIENT_RENDERER_JS,
  CONTRACT_VERSION_MOVIE,
  CONTRACT_VERSION_V2,
  buildCompactPlayerPayload,
  choreographAnimation,
  composeMovie,
  exportAnimation,
  renderAnimatedSvg,
  renderHtml,
  renderMovieAnimatedSvg,
  renderMovieHtml,
  renderSvgFrame,
  type CompiledAnimation,
  type CompiledMovie
} from "../src/index.js";

const scratchDirs: string[] = [];

async function makeWorkspaceDir(prefix: string): Promise<string> {
  const dir = resolve(process.cwd(), `.${prefix}-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  scratchDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(scratchDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function buildWarRoom20sProgram(): CompiledAnimation {
  const res = choreographAnimation({
    version: CONTRACT_VERSION_V2,
    canvas: { width: 1280, height: 720, fps: 30 },
    durationMs: 20_000,
    theme: { accentColor: "#b11f4b", background: "#ffffff" },
    camera: "auto-director",
    spotlight: "auto",
    stageProps: [
      { id: "ops-board", type: "board", x: 180, y: 260, text: "EU-WEST P1" },
      { id: "ops-rack", type: "server-rack", x: 1080, y: 590 }
    ],
    actors: [
      {
        id: "ic",
        x: 160,
        color: "#0f172a",
        accessory: "glasses",
        depth: 0,
        actions: [
          { action: "surprised", startMs: 0, durationMs: 1000, say: "P1 alert in EU-West!", badge: "! Alert" },
          { action: "point", startMs: 1200, durationMs: 1200, to: "center", emitCue: "triage" },
          { action: "phone-call", startMs: 3600, durationMs: 1600, say: "Paging storage on-call" },
          { action: "write-board", startMs: 7400, durationMs: 1800 },
          { action: "nod", startMs: 13000, durationMs: 1000 },
          { action: "cheer", startMs: 17500, durationMs: 1800, say: "Incident mitigated!" }
        ]
      },
      {
        id: "sre1",
        x: 360,
        color: "#1e293b",
        accessory: "badge",
        depth: 0.15,
        actions: [
          { action: "type-at-desk", startMs: 800, durationMs: 2000 },
          { action: "think", startMs: 3200, durationMs: 1400, think: "Checking latency graph" },
          { action: "idea", startMs: 5600, durationMs: 1200, say: "BGP route flap!" },
          { action: "open-laptop", startMs: 8800, durationMs: 1600 },
          { action: "thumbs-up", startMs: 14500, durationMs: 1200, badge: "✓ Verified" },
          { action: "fist-pump", startMs: 17500, durationMs: 1800 }
        ]
      },
      {
        id: "sre2",
        x: 560,
        color: "#334155",
        accessory: "tie",
        depth: 0.25,
        actions: [
          { action: "look-around", startMs: 1000, durationMs: 1200 },
          { action: "walk", startMs: 2600, durationMs: 1600, to: { x: 680 } },
          { action: "plug-cable", startMs: 6200, durationMs: 1600 },
          { action: "rack-server", startMs: 9800, durationMs: 1800 },
          { action: "nod", startMs: 15000, durationMs: 1000 },
          { action: "clap", startMs: 17500, durationMs: 1800 }
        ]
      },
      {
        id: "net",
        x: 760,
        color: "#0f172a",
        depth: 0.35,
        actions: [
          { action: "scratch-head", startMs: 1400, durationMs: 1200 },
          { action: "tablet-tap", startMs: 4200, durationMs: 1600 },
          { action: "point", startMs: 7000, durationMs: 1200, to: { x: 960 } },
          { action: "present", startMs: 11200, durationMs: 1800, say: "Failover traffic shifting" },
          { action: "thumbs-up", startMs: 15400, durationMs: 1000 },
          { action: "cheer", startMs: 17500, durationMs: 1800 }
        ]
      },
      {
        id: "db",
        x: 940,
        color: "#1e293b",
        accessory: "hat",
        depth: 0.45,
        actions: [
          { action: "frustrated-pc", startMs: 1800, durationMs: 1500 },
          { action: "inspect-magnifier", startMs: 5000, durationMs: 1500 },
          { action: "write-notes", startMs: 8200, durationMs: 1500 },
          { action: "nod", startMs: 12200, durationMs: 1200 },
          { action: "wave", startMs: 16000, durationMs: 1000 },
          { action: "fist-pump", startMs: 17500, durationMs: 1800 }
        ]
      },
      {
        id: "comms",
        x: 1120,
        color: "#334155",
        depth: 0.55,
        actions: [
          { action: "check-watch", startMs: 600, durationMs: 1200 },
          { action: "video-call", startMs: 3800, durationMs: 1800 },
          { action: "present-card", startMs: 9200, durationMs: 1800, addon: { type: "card", text: "STATUS" } },
          { action: "beckon", startMs: 13400, durationMs: 1200 },
          { action: "thumbs-up", startMs: 16200, durationMs: 1000, badge: "99.98%" },
          { action: "clap", startMs: 17500, durationMs: 1800 }
        ]
      }
    ],
    callouts: [
      { kind: "caption", text: "EU-West P1 Incident War Room — Live Timeline", startMs: 0, durationMs: 19_500 }
    ]
  });
  expect(res.valid, JSON.stringify(res.diagnostics)).toBe(true);
  return res.program!;
}

function build15sThreeSceneMovie(): CompiledMovie {
  const res = composeMovie({
    version: CONTRACT_VERSION_MOVIE,
    title: "15s Multi-Scene Incident Walkthrough",
    canvas: { width: 1280, height: 720, fps: 30 },
    theme: { accentColor: "#b11f4b" },
    trimIdleTails: false,
    scenes: [
      {
        id: "scene-alert",
        title: "Alert Triage",
        caption: "Spike detected across EU-West gateways",
        backdrop: "war-room",
        transition: { kind: "fade", durationMs: 400 },
        camera: "auto-director",
        spotlight: "auto",
        durationMs: 5000,
        actors: [
          {
            id: "lead",
            x: "center-left",
            color: "#0f172a",
            accessory: "glasses",
            actions: [
              { action: "surprised", startMs: 0, durationMs: 1100, say: "Error budget dropping!" },
              { action: "point", startMs: 1400, durationMs: 1400, badge: "! Alert" },
              { action: "write-board", startMs: 3000, durationMs: 1600 }
            ]
          },
          {
            id: "analyst",
            x: "right",
            color: "#334155",
            depth: 0.3,
            actions: [
              { action: "think", startMs: 800, durationMs: 1600, think: "Isolating failing rack" },
              { action: "idea", startMs: 2800, durationMs: 1400, say: "Found it in Aisle 4" }
            ]
          }
        ]
      },
      {
        id: "scene-fix",
        title: "Rack Remediation",
        caption: "Swapping fiber transceiver and draining traffic",
        backdrop: "datacenter",
        transition: { kind: "wipe", durationMs: 450 },
        camera: "auto-director",
        durationMs: 5000,
        actors: [
          {
            id: "sre",
            x: "left",
            color: "#1e293b",
            accessory: "badge",
            actions: [
              { action: "walk", startMs: 0, durationMs: 1400, to: "center" },
              { action: "plug-cable", startMs: 1500, durationMs: 1600, say: "Failover uplink active" },
              { action: "thumbs-up", startMs: 3400, durationMs: 1200, badge: "✓ Verified" }
            ]
          }
        ]
      },
      {
        id: "scene-review",
        title: "Postmortem Wrap",
        caption: "Zero data loss — SLO restored to 99.99%",
        backdrop: "office",
        transition: "cut",
        camera: "auto-director",
        durationMs: 5000,
        actors: [
          {
            id: "lead",
            x: "center-left",
            color: "#0f172a",
            accessory: "tie",
            actions: [
              { action: "present-card", startMs: 200, durationMs: 2200, addon: { type: "card", text: "99.99%" } },
              { action: "cheer", startMs: 2800, durationMs: 1800, say: "Great teamwork!" }
            ]
          },
          {
            id: "sre",
            x: "center-right",
            color: "#1e293b",
            actions: [
              { action: "nod", startMs: 600, durationMs: 1400 },
              { action: "clap", startMs: 2600, durationMs: 2000 }
            ]
          }
        ]
      }
    ]
  });
  expect(res.valid, JSON.stringify(res.diagnostics)).toBe(true);
  return res.movie!;
}

function runCompactScriptInVm(html: string, scriptId: string, seekTimesMs: number[]) {
  const match = new RegExp(`<script id="${scriptId}">([\\s\\S]+?)<\\/script>`).exec(html);
  expect(match).not.toBeNull();
  const script = match![1]!;
  expect(() => new Function(script)).not.toThrow();

  const makeNode = (initialText = "") => {
    const attributes = new Map<string, string>();
    const listeners = new Map<string, () => void>();
    return {
      value: "",
      textContent: initialText,
      innerHTML: "",
      attributes,
      listeners,
      firstChild: null,
      setAttribute(k: string, v: string) { attributes.set(k, String(v)); },
      getAttribute(k: string) { return attributes.get(k) ?? null; },
      addEventListener(ev: string, fn: () => void) { listeners.set(ev, fn); },
      querySelector() { return null; },
      insertBefore() {}
    };
  };

  const nodes = new Map([
    ["stage-svg", makeNode()],
    ["scene", makeNode()],
    ["ground", makeNode()],
    ["mode", makeNode()],
    ["seek", makeNode()],
    ["toggle", makeNode("Pause")],
    ["timecode", makeNode()]
  ]);

  runInNewContext(script, {
    CustomEvent: class { constructor(public type: string, public detail?: unknown) {} },
    document: {
      querySelector(sel: string) {
        if (sel === "#stage svg") return nodes.get("stage-svg") ?? null;
        return nodes.get(sel.replace(/^#/, "")) ?? null;
      },
      getElementById(id: string) { return nodes.get(id) ?? null; },
      querySelectorAll() { return []; },
      dispatchEvent() { return true; }
    },
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {}
  });

  const snapshots: string[] = [nodes.get("scene")!.innerHTML];
  for (const t of seekTimesMs) {
    nodes.get("seek")!.value = String(t);
    nodes.get("seek")!.listeners.get("input")!();
    snapshots.push(nodes.get("scene")!.innerHTML);
  }
  return { script, snapshots, nodes };
}

describe("v03-r5: compact vector player runtime, SVG coalescing & parallel worker video export", () => {
  it("keeps COMPACT_CLIENT_RENDERER_JS < 16 KB and v2-two-actors-collab HTML < 60 KB with valid DOM rendering", async () => {
    const rendererBytes = Buffer.byteLength(COMPACT_CLIENT_RENDERER_JS, "utf8");
    expect(rendererBytes).toBeLessThan(16_000);

    const rawCollab = JSON.parse(
      await readFile(resolve(process.cwd(), "examples", "v2-two-actors-collab.json"), "utf8")
    );
    const compiled = choreographAnimation(rawCollab);
    expect(compiled.valid, JSON.stringify(compiled.diagnostics)).toBe(true);
    const program = compiled.program!;

    const html = renderHtml(program);
    const htmlBytes = Buffer.byteLength(html, "utf8");
    expect(htmlBytes).toBeLessThan(60_000);

    const payload = buildCompactPlayerPayload(program);
    expect(payload.v).toBe(1);
    expect(payload.kind).toBe("animation");
    expect(payload.sym.length).toBeGreaterThan(0);

    const { snapshots } = runCompactScriptInVm(html, "stickman-player", [500, 1500]);
    const combined = snapshots.join("\n");
    expect(combined).toContain("<g data-actor=");
    expect(combined).toContain("data-addon=");
    expect(combined).toContain('data-accessory="tie"');
    expect(combined).toContain('data-accessory="glasses"');
  });

  it("keeps 20s 6-actor IT War-Room (1280x720, 36 beats) HTML < 220 KB and coalesces idle-heavy animated SVG", () => {
    const program = buildWarRoom20sProgram();
    const html = renderHtml(program);
    const htmlBytes = Buffer.byteLength(html, "utf8");
    expect(htmlBytes).toBeLessThan(220_000);

    const { snapshots } = runCompactScriptInVm(html, "stickman-player", [1000, 9500, 18000]);
    const combined = snapshots.join("\n");
    expect(combined).toContain('data-actor="ic"');
    expect(combined).toContain('data-actor="comms"');
    expect(combined).toContain('data-layer="callouts"');

    // Idle-heavy animated SVG coalescing check: 6s scene with 5s hold coalesces drastically vs total frames
    const idleHeavy = choreographAnimation({
      version: CONTRACT_VERSION_V2,
      canvas: { width: 800, height: 450, fps: 30 },
      durationMs: 6000,
      actors: [
        {
          id: "speaker",
          x: "center",
          actions: [
            { action: "wave", startMs: 0, durationMs: 1000 },
            { action: "static-pose", startMs: 1000, durationMs: 5000 }
          ]
        }
      ]
    }).program!;
    const animSvg = renderAnimatedSvg(idleHeavy);
    expect(animSvg).not.toContain("<script");
    expect(animSvg).toContain("@keyframes sm-slice");
    const sliceCount = (animSvg.match(/<g class="sm-f/g) ?? []).length;
    // 6s @ 30fps = 181 raw frames; 5s hold should coalesce well below 60 slices!
    expect(sliceCount).toBeLessThan(60);
  });

  it("keeps 3-scene 15s CompiledMovie HTML < 200 KB with valid JS and coalesces movie animated SVG", () => {
    const movie = build15sThreeSceneMovie();
    const html = renderMovieHtml(movie);
    const htmlBytes = Buffer.byteLength(html, "utf8");
    expect(htmlBytes).toBeLessThan(200_000);

    const { snapshots } = runCompactScriptInVm(html, "stickman-movie-player", [
      4800, // fade transition window
      6500, // scene 2
      9800, // wipe transition window
      12500 // scene 3
    ]);
    expect(snapshots.join("\n")).toContain('data-transition="fade"');
    expect(snapshots.join("\n")).toContain('data-transition="wipe"');
    expect(snapshots.join("\n")).toContain('data-backdrop="war-room"');
    expect(snapshots.join("\n")).toContain('data-backdrop="datacenter"');
    expect(snapshots.join("\n")).toContain('data-backdrop="office"');

    // Movie animated SVG hoists backdrops into <defs> and has zero <script>
    const movieAnimSvg = renderMovieAnimatedSvg(movie);
    expect(movieAnimSvg).not.toContain("<script");
    expect(movieAnimSvg).toContain('<g id="sm-bd-0">');
    expect(movieAnimSvg).toContain('<use href="#sm-bd-0"/>');
  });

  it("exports real MP4 and transparent WebM via parallel worker_threads + stdin streaming with zero leftover temp files", async () => {
    const shortScene = choreographAnimation({
      version: CONTRACT_VERSION_V2,
      canvas: { width: 480, height: 270, fps: 24 },
      durationMs: 1500,
      actors: [
        {
          id: "hero",
          x: "center-left",
          color: "#0f172a",
          accessory: "tie",
          actions: [
            { action: "wave", startMs: 0, durationMs: 800, say: "Hello WebM!" },
            { action: "thumbs-up", startMs: 800, durationMs: 700 }
          ]
        },
        {
          id: "ally",
          x: "center-right",
          color: "#334155",
          actions: [
            { action: "clap", startMs: 400, durationMs: 1100 }
          ]
        }
      ]
    }).program!;

    // Verify transparent SVG frame omits opaque background rect
    const transparentSvg = renderSvgFrame(shortScene, 500, "normal", { transparent: true });
    expect(transparentSvg).not.toContain('<rect width="100%" height="100%"');
    const opaqueSvg = renderSvgFrame(shortScene, 500, "normal", { transparent: false });
    expect(opaqueSvg).toContain('<rect width="100%" height="100%"');

    const outDir = await makeWorkspaceDir("test-fast-video");
    const mp4Progress: string[] = [];
    const mp4Result = await exportAnimation(shortScene, outDir, "clip.mp4", "mp4", {
      onProgress: (p) => { mp4Progress.push(p.phase); }
    });
    expect(mp4Result.format).toBe("mp4");
    expect(mp4Result.bytes).toBeGreaterThan(1000);
    expect(mp4Progress).toContain("rasterize");
    expect(mp4Progress).toContain("encode");
    expect(mp4Progress).toContain("complete");

    const mp4Bytes = await readFile(resolve(outDir, "clip.mp4"));
    // ISO Base Media / MP4 header contains ASCII "ftyp" at offset 4..8
    expect(mp4Bytes.subarray(4, 8).toString("ascii")).toBe("ftyp");

    const webmResult = await exportAnimation(shortScene, outDir, "clip-alpha.webm", "webm", {
      transparent: true
    });
    expect(webmResult.format).toBe("webm");
    expect(webmResult.bytes).toBeGreaterThan(1000);

    const webmBytes = await readFile(resolve(outDir, "clip-alpha.webm"));
    // EBML / WebM magic bytes: 0x1A 0x45 0xDF 0xA3
    expect([...webmBytes.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);

    // Zero leftover temp/lock files in output directory
    const files = (await readdir(outDir)).sort();
    expect(files).toEqual(["clip-alpha.webm", "clip.mp4"]);
  }, 60_000);
});
