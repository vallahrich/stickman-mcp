import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";
import {
  DECK_EMBED_TARGETS,
  HUMAN_CRITIQUE_RUBRIC,
  MCP_APP_MIME_TYPE,
  MCP_APP_PLAYER_URI,
  choreographAnimation,
  composeMovie,
  generateDeckEmbed,
  movieSchema,
  renderMcpAppPlayerHtml,
  type CritiqueReport
} from "../src/index.js";
import { createMcpServer } from "../src/mcp.js";

const scratchDirs: string[] = [];
const activeClosers: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of activeClosers.splice(0)) {
    await close();
  }
  for (const dir of scratchDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function createScratchDir(prefix = "mcp-v03-test"): Promise<string> {
  const dir = resolve(process.cwd(), `.${prefix}-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  scratchDirs.push(dir);
  return dir;
}

async function connectInMemory() {
  const outputRoot = await createScratchDir("mcp-v03-out");
  const server = createMcpServer(outputRoot);
  const client = new Client({ name: "stickman-v03-client", version: "0.3.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  activeClosers.push(async () => {
    await client.close();
    await server.close();
  });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, outputRoot };
}

function invokeCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const child = spawnSync(process.execPath, [resolve(process.cwd(), "dist", "cli.js"), ...args], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000
  });
  expect(child.error).toBeUndefined();
  return { status: child.status, stdout: child.stdout, stderr: child.stderr };
}

describe("MCP v0.3 Apps, Critique, Movie, Templates & Deck Integrations", () => {
  it("serves ui://stickman/player (< 45 KB, valid JS, zero external URLs) and advertises _meta.ui.resourceUri on interactive tools", async () => {
    const { client } = await connectInMemory();

    // 1. Resources include all 14 entries with ui://stickman/player and v0.3 schemas/rubric/templates
    const { resources } = await client.listResources();
    expect(resources).toHaveLength(14);
    const uiMeta = resources.find((r) => r.uri === MCP_APP_PLAYER_URI);
    expect(uiMeta).toMatchObject({
      uri: "ui://stickman/player",
      mimeType: MCP_APP_MIME_TYPE
    });

    const uiRead = await client.readResource({ uri: MCP_APP_PLAYER_URI });
    const uiEntry = uiRead.contents[0] as { uri: string; mimeType?: string; text: string };
    expect(uiEntry.mimeType).toBe("text/html;profile=mcp-app");
    expect(uiEntry.text).toBe(renderMcpAppPlayerHtml());
    expect(Buffer.byteLength(uiEntry.text, "utf8")).toBeLessThan(45 * 1024);
    expect(uiEntry.text).not.toMatch(/https?:\/\/(?!www\.w3\.org\/2000\/svg)/i);
    expect(uiEntry.text).toContain("--cp-bg:#f7f4ef");
    expect(uiEntry.text).toContain("tabular-nums");
    expect(uiEntry.text).toContain("prefers-reduced-motion");
    expect(uiEntry.text).toContain("ui/notifications/tool-result");
    expect(uiEntry.text).toContain("ui/initialize");
    expect(uiEntry.text).toContain("ui/notifications/size-changed");

    // Validate all inline <script> blocks parse with new Function
    const scriptMatches = [...uiEntry.text.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
    expect(scriptMatches.length).toBeGreaterThanOrEqual(1);
    for (const match of scriptMatches) {
      expect(() => new Function(match[1]!)).not.toThrow();
    }

    // 2. Schema & rubric resources
    const movieSchemaRes = await client.readResource({ uri: "stickman://schema/movie-v1" });
    expect(JSON.parse((movieSchemaRes.contents[0] as { text: string }).text)).toEqual(movieSchema);

    const rubricRes = await client.readResource({ uri: "stickman://rubric/human-critique" });
    expect(JSON.parse((rubricRes.contents[0] as { text: string }).text)).toEqual(HUMAN_CRITIQUE_RUBRIC);

    // 3. Tools expose _meta.ui.resourceUri on all 4 interactive visual tools
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(18);
    for (const name of ["stickman_choreograph", "stickman_movie", "stickman_preview", "stickman_critique"]) {
      const tool = tools.find((t) => t.name === name);
      expect(tool, `missing tool ${name}`).toBeDefined();
      expect(tool?._meta).toEqual({ ui: { resourceUri: "ui://stickman/player" } });
    }

    // 4. Schema tool supports movie-v1
    const schemaToolRes = await client.callTool({
      name: "stickman_schema",
      arguments: { version: "movie-v1" }
    });
    expect(schemaToolRes.isError).not.toBe(true);
    expect((schemaToolRes.structuredContent as { result: unknown }).result).toEqual(movieSchema);

    // 5. Prompt create-and-critique-movie
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toContain("create-and-critique-movie");
    const promptRes = await client.getPrompt({
      name: "create-and-critique-movie",
      arguments: { topic: "Zero-Downtime Database Failover", scenes: "3" }
    });
    const promptText = promptRes.messages[0]?.content.type === "text" ? promptRes.messages[0].content.text : "";
    expect(promptText).toContain("stickman://schema/movie-v1");
    expect(promptText).toContain("stickman_movie");
    expect(promptText).toContain("stickman_critique");
    expect(promptText).toContain("8.5");
    expect(promptText).toContain("stickman_export");
  });

  it("compiles both new v0.3 templates and scores >= 8.5/10 in stickman_critique with real PNG ImageContent", async () => {
    const { client } = await connectInMemory();

    // Template 1: incident-warroom-movie
    const warroomRes = await client.readResource({ uri: "stickman://templates/incident-warroom-movie" });
    const warroomMovie = JSON.parse((warroomRes.contents[0] as { text: string }).text) as Record<string, unknown>;

    const movieCall = await client.callTool({
      name: "stickman_movie",
      arguments: { movie: warroomMovie, includeCritique: true }
    });
    expect(movieCall.isError).not.toBe(true);
    const movieData = (movieCall.structuredContent as {
      result: {
        valid: boolean;
        sceneCount: number;
        durationMs: number;
        playerPayload: { kind: string; sc: unknown[] };
        report: CritiqueReport;
      };
    }).result;
    expect(movieData.valid).toBe(true);
    expect(movieData.sceneCount).toBe(3);
    expect(movieData.durationMs).toBeGreaterThan(2000);
    expect(movieData.playerPayload.kind).toBe("movie");
    expect(movieData.playerPayload.sc).toHaveLength(3);
    expect(movieData.report.overallScore).toBeGreaterThanOrEqual(8.5);
    expect(movieData.report.passed).toBe(true);

    const movieCritique = await client.callTool({
      name: "stickman_critique",
      arguments: { animation: warroomMovie, maxPanels: 6, columns: 3 }
    });
    expect(movieCritique.isError).not.toBe(true);
    const parsedMovieCritique = CallToolResultSchema.parse(movieCritique);
    const mcResult = (movieCritique.structuredContent as {
      result: {
        valid: boolean;
        report: CritiqueReport;
        svg: string;
        rubric: typeof HUMAN_CRITIQUE_RUBRIC;
        rasterizerAvailable: boolean;
        playerPayload: { kind: string };
      };
    }).result;
    expect(mcResult.valid).toBe(true);
    expect(mcResult.report.overallScore).toBeGreaterThanOrEqual(8.5);
    expect(mcResult.report.passed).toBe(true);
    expect(mcResult.svg).toContain("<svg");
    expect(mcResult.rubric).toEqual(HUMAN_CRITIQUE_RUBRIC);
    expect(mcResult.playerPayload.kind).toBe("movie");
    expect(mcResult.rasterizerAvailable).toBe(true);
    const mcImg = parsedMovieCritique.content.find((item) => item.type === "image");
    expect(mcImg).toBeDefined();
    if (mcImg && mcImg.type === "image") {
      expect(mcImg.mimeType).toBe("image/png");
      expect(Buffer.from(mcImg.data, "base64").subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      );
    }

    // Template 2: two-actor-handoff
    const handoffRes = await client.readResource({ uri: "stickman://templates/two-actor-handoff" });
    const handoffScene = JSON.parse((handoffRes.contents[0] as { text: string }).text) as Record<string, unknown>;

    const choreoCall = await client.callTool({
      name: "stickman_choreograph",
      arguments: { scene: handoffScene }
    });
    expect(choreoCall.isError).not.toBe(true);
    const choreoData = (choreoCall.structuredContent as {
      result: { valid: boolean; playerPayload: { kind: string; v: number } };
    }).result;
    expect(choreoData.valid).toBe(true);
    expect(choreoData.playerPayload.v).toBe(1);
    expect(choreoData.playerPayload.kind).toBe("animation");

    const handoffCritique = await client.callTool({
      name: "stickman_critique",
      arguments: { animation: handoffScene, includePng: false }
    });
    expect(handoffCritique.isError).not.toBe(true);
    const hcResult = (handoffCritique.structuredContent as {
      result: { valid: boolean; report: CritiqueReport; playerPayload: { kind: string } };
    }).result;
    expect(hcResult.valid).toBe(true);
    expect(hcResult.report.overallScore).toBeGreaterThanOrEqual(8.5);
    expect(hcResult.report.passed).toBe(true);
    expect(hcResult.playerPayload.kind).toBe("animation");
  });

  it("supports stickman.movie/v1 across validate/compile/storyboard/preview and exports transparent WebM via MCP", async () => {
    const { client, outputRoot } = await connectInMemory();

    const shortMovie = {
      version: "stickman.movie/v1",
      title: "Quick WebM Demo",
      canvas: { width: 320, height: 180, fps: 12 },
      scenes: [
        {
          id: "intro",
          backdrop: "office",
          transition: { kind: "fade", durationMs: 250 },
          actor: { id: "host", x: "center", accessory: "tie" },
          actions: [{ action: "wave", durationMs: 600, emitCue: "hello" }]
        },
        {
          id: "finish",
          backdrop: "datacenter",
          transition: "cut",
          actor: { id: "host", x: "center", accessory: "tie" },
          actions: [{ action: "thumbs-up", durationMs: 500 }]
        }
      ]
    };

    const valCall = await client.callTool({ name: "stickman_validate", arguments: { animation: shortMovie } });
    expect(valCall.isError).not.toBe(true);
    expect((valCall.structuredContent as { result: { valid: boolean } }).result.valid).toBe(true);

    const compCall = await client.callTool({ name: "stickman_compile", arguments: { animation: shortMovie } });
    expect(compCall.isError).not.toBe(true);
    expect((compCall.structuredContent as { result: { program: { contractVersion: string } } }).result.program.contractVersion).toBe("stickman.movie/v1");

    const sbCall = await client.callTool({
      name: "stickman_storyboard",
      arguments: { animation: shortMovie, includePng: false }
    });
    expect(sbCall.isError).not.toBe(true);
    expect((sbCall.structuredContent as { result: { svg: string; analysis: { actorIds: string[] } } }).result.svg).toContain("<svg");

    const prevCall = await client.callTool({
      name: "stickman_preview",
      arguments: { animation: shortMovie, format: "svg-frame", timeMs: 200 }
    });
    expect(prevCall.isError).not.toBe(true);
    expect((prevCall.structuredContent as { result: { content: string } }).result.content).toContain("data-movie-scene");

    const webmCall = await client.callTool({
      name: "stickman_export",
      arguments: {
        animation: shortMovie,
        path: "alpha-movie.webm",
        format: "webm",
        transparent: true
      }
    });
    expect(webmCall.isError).not.toBe(true);
    const webmResult = (webmCall.structuredContent as {
      result: { format: string; path: string; bytes: number };
    }).result;
    expect(webmResult.format).toBe("webm");
    expect(webmResult.path).toBe("alpha-movie.webm");
    expect(webmResult.bytes).toBeGreaterThan(256);

    const webmBytes = await readFile(resolve(outputRoot, "alpha-movie.webm"));
    // EBML header magic bytes for WebM/Matroska
    expect(webmBytes.subarray(0, 4)).toEqual(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  }, 60_000);

  it("generates framework-accurate deck embed snippets for all 5 targets", () => {
    const choreo = choreographAnimation({
      actor: { id: "host", x: "center", accessory: "tie" },
      actions: [
        { action: "wave", emitCue: "greet" },
        { action: "idea", emitCue: "insight" }
      ]
    });
    expect(choreo.valid).toBe(true);
    const movie = composeMovie({
      version: "stickman.movie/v1",
      title: "Deck Movie",
      scenes: [
        {
          id: "s1",
          backdrop: "office",
          actor: { id: "host", x: "center" },
          actions: [{ action: "wave", emitCue: "start" }]
        }
      ]
    });
    expect(movie.valid).toBe(true);

    expect(DECK_EMBED_TARGETS).toEqual(["reveal", "slidev", "marp", "html", "pptx-notes"]);

    for (const target of DECK_EMBED_TARGETS) {
      const animSnippet = generateDeckEmbed(choreo.program!, target, {
        title: "Architecture Intro",
        controls: true,
        scrollScrub: true,
        blueprint: true
      });
      const movieSnippet = generateDeckEmbed(movie.movie!, target, {
        controls: true,
        assetPath: "./demo.webm"
      });
      expect(animSnippet.length).toBeGreaterThan(60);
      expect(movieSnippet.length).toBeGreaterThan(60);
      if (target !== "pptx-notes") {
        expect(animSnippet).toContain("<stickman-player");
        expect(animSnippet).toContain("controls");
        expect(animSnippet).toContain("scroll-scrub");
        expect(animSnippet).toContain("blueprint");
      } else {
        expect(animSnippet).toContain("PowerPoint");
        expect(animSnippet).toContain("greet");
        expect(movieSnippet).toContain("./demo.webm");
      }
    }
  });

  it("supports CLI v0.3 commands: critique, movie, embed, schema --version movie-v1, and export --format webm --transparent", async () => {
    const dir = await createScratchDir("cli-v03-test");
    const outRoot = resolve(dir, "out");
    await mkdir(outRoot, { recursive: true });

    const moviePath = resolve(dir, "movie.json");
    const invalidPath = resolve(dir, "bad.json");
    await writeFile(
      moviePath,
      JSON.stringify({
        version: "stickman.movie/v1",
        title: "CLI Movie Test",
        canvas: { width: 320, height: 180, fps: 12 },
        scenes: [
          {
            id: "s1",
            backdrop: "office",
            actor: { id: "a", x: "center", accessory: "glasses" },
            actions: [{ action: "wave", durationMs: 600, emitCue: "hi" }]
          }
        ]
      }),
      "utf8"
    );
    await writeFile(invalidPath, JSON.stringify({ actions: [{ action: "fly-to-mars" }] }), "utf8");

    const schemaRes = invokeCli(["schema", "--version", "movie-v1"]);
    expect(schemaRes.status).toBe(0);
    expect(JSON.parse(schemaRes.stdout)).toEqual(movieSchema);

    const movieRes = invokeCli(["movie", "--input", moviePath, "--critique"]);
    expect(movieRes.status).toBe(0);
    const movieJson = JSON.parse(movieRes.stdout) as {
      valid: boolean;
      sceneCount: number;
      report: CritiqueReport;
    };
    expect(movieJson.valid).toBe(true);
    expect(movieJson.sceneCount).toBe(1);
    expect(typeof movieJson.report.overallScore).toBe("number");

    const critJson = invokeCli(["critique", "--input", moviePath, "--json"]);
    expect(critJson.status).toBe(0);
    expect((JSON.parse(critJson.stdout) as CritiqueReport).version).toBe("1.0.0");

    const critSvg = invokeCli(["critique", "--input", moviePath, "--blueprint", "--columns", "2", "--max-panels", "4"]);
    expect(critSvg.status).toBe(0);
    expect(critSvg.stdout).toContain("<svg");
    expect(critSvg.stdout).toContain('data-theme="blueprint"');

    const critBad = invokeCli(["critique", "--input", invalidPath, "--json"]);
    expect(critBad.status).toBe(1);

    const embedRes = invokeCli([
      "embed",
      "--input",
      moviePath,
      "--target",
      "slidev",
      "--controls",
      "--scroll-scrub",
      "--blueprint"
    ]);
    expect(embedRes.status).toBe(0);
    expect(embedRes.stdout).toContain("<stickman-player");
    expect(embedRes.stdout).toContain("controls");
    expect(embedRes.stdout).toContain("scroll-scrub");
    expect(embedRes.stdout).toContain("blueprint");
    expect(embedRes.stdout).toContain("@vallahrich/stickman-mcp/browser");

    const valMovie = invokeCli(["validate", "--input", moviePath]);
    expect(valMovie.status).toBe(0);
    expect(JSON.parse(valMovie.stdout)).toEqual({ valid: true, diagnostics: [] });

    const webmRes = invokeCli([
      "export",
      "--input",
      moviePath,
      "--root",
      outRoot,
      "--output",
      "cli-alpha.webm",
      "--format",
      "webm",
      "--transparent"
    ]);
    expect(webmRes.status).toBe(0);
    expect(JSON.parse(webmRes.stdout)).toMatchObject({ format: "webm", path: "cli-alpha.webm" });
    const bytes = await readFile(resolve(outRoot, "cli-alpha.webm"));
    expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  }, 60_000);
});
