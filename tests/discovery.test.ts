import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error Site discovery generator is authored in ESM .mjs.
import { MCP_TOOLS, buildAtomFeedXml, buildRobotsTxt } from "../scripts/site/discovery.mjs";

const root = process.cwd();
const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

function assertWellFormedXml(xml: string, expectedRootTag: string): void {
  expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  expect(xml).toContain(`<${expectedRootTag}`);
  expect(xml.trimEnd().endsWith(`</${expectedRootTag}>`)).toBe(true);
  // Ensure no unescaped bare ampersands or stray script/HTML fragments.
  expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/);
}

describe("G1 machine-readable discovery assets & repo standards", () => {
  it("emits valid llms.txt, llms-full.txt, sitemap.xml, feed.xml, robots.txt, 1200x630 og-card.png, and JSON-LD head metadata", async () => {
    const outDir = await makeTempDir("stickman-discovery-rc-");
    execFileSync(process.execPath, [resolve(root, "scripts", "site", "build.mjs"), "--release-candidate"], {
      cwd: root,
      stdio: "pipe",
      env: { ...process.env, STICKMAN_SITE_OUTPUT: outDir }
    });

    // 1. llms.txt follows llmstxt.org v2 structure (# Title, > summary, ## link sections)
    const siteLlms = await readFile(join(outDir, "llms.txt"), "utf8");
    const rootLlms = await readFile(resolve(root, "llms.txt"), "utf8");
    for (const llms of [siteLlms, rootLlms]) {
      expect(llms).toMatch(/^# Stickman MCP\r?\n/);
      expect(llms).toMatch(/\r?\n> .+/);
      expect(llms).toMatch(/\r?\n## .+/);
      expect(llms).toContain("https://vallahrich.github.io/stickman-mcp/");
      expect(llms).toContain("llms-full.txt");
      expect(llms).toContain("feed.xml");
    }

    // 2. llms-full.txt contains all 18 MCP tools and copy-paste client configs
    const llmsFull = await readFile(join(outDir, "llms-full.txt"), "utf8");
    expect(MCP_TOOLS).toHaveLength(18);
    for (const tool of MCP_TOOLS as ReadonlyArray<{ name: string }>) {
      expect(llmsFull, `missing tool ${tool.name}`).toContain(tool.name);
    }
    expect(llmsFull).toContain("copilot mcp add stickman");
    expect(llmsFull).toContain('"mcpServers"');
    expect(llmsFull).toContain("claude mcp add --transport stdio stickman");
    expect(llmsFull).toContain("codex mcp add stickman");
    expect(llmsFull).toContain('"stickman.animation/v2"');
    expect(llmsFull).toContain('"stickman.movie/v1"');

    // 3. sitemap.xml & feed.xml are well-formed XML with canonical URLs
    const sitemap = await readFile(join(outDir, "sitemap.xml"), "utf8");
    assertWellFormedXml(sitemap, "urlset");
    for (const url of [
      "https://vallahrich.github.io/stickman-mcp/",
      "https://vallahrich.github.io/stickman-mcp/llms.txt",
      "https://vallahrich.github.io/stickman-mcp/llms-full.txt",
      "https://vallahrich.github.io/stickman-mcp/feed.xml",
      "https://vallahrich.github.io/stickman-mcp/showcase/on-prem-to-cloud.html",
      "https://vallahrich.github.io/stickman-mcp/catalogue.json"
    ]) {
      expect(sitemap).toContain(`<loc>${url}</loc>`);
    }

    const feed = await readFile(join(outDir, "feed.xml"), "utf8");
    assertWellFormedXml(feed, "feed");
    expect(feed).toContain('xmlns="http://www.w3.org/2005/Atom"');
    expect(feed).toContain("<id>https://vallahrich.github.io/stickman-mcp/feed.xml</id>");
    for (const tag of ["v0.3.0", "v0.2.2", "v0.2.1", "v0.2.0", "v0.1.0"]) {
      expect(feed).toContain(`releases/tag/${tag}`);
    }

    // Newer versions (e.g. 0.3.1) prepend automatically while preserving history
    const nextFeed = buildAtomFeedXml({ version: "0.3.1" });
    assertWellFormedXml(nextFeed, "feed");
    expect(nextFeed.indexOf("releases/tag/v0.3.1")).toBeLessThan(nextFeed.indexOf("releases/tag/v0.3.0"));

    // 4. robots.txt welcomes search/AI bots in release-candidate mode and disallows in dev mode
    const rcRobots = await readFile(join(outDir, "robots.txt"), "utf8");
    for (const bot of [
      "OAI-SearchBot",
      "Claude-SearchBot",
      "Claude-User",
      "PerplexityBot",
      "Perplexity-User",
      "Googlebot",
      "Bingbot"
    ]) {
      expect(rcRobots).toContain(`User-agent: ${bot}\nAllow: /`);
    }
    expect(rcRobots).toContain("Sitemap: https://vallahrich.github.io/stickman-mcp/sitemap.xml");
    expect(buildRobotsTxt({ releaseCandidate: false })).toBe("User-agent: *\nDisallow: /\n");

    // 5. og-card.png has valid PNG signature and exact 1200x630 dimensions
    const ogBytes = await readFile(join(outDir, "og-card.png"));
    expect(ogBytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    expect(ogBytes.readUInt32BE(16)).toBe(1200);
    expect(ogBytes.readUInt32BE(20)).toBe(630);

    // 6. Built index.html injects canonical, describedby, Atom alternate, OG tags, and valid JSON-LD @graph
    const html = await readFile(join(outDir, "index.html"), "utf8");
    expect(html).not.toContain("<!-- DISCOVERY_HEAD -->");
    expect(html).toContain('<link rel="canonical" href="https://vallahrich.github.io/stickman-mcp/">');
    expect(html).toContain('<link rel="describedby" href="llms.txt">');
    expect(html).toContain('<link rel="alternate" type="text/markdown" href="llms-full.txt">');
    expect(html).toContain('<link rel="alternate" type="application/atom+xml" title="Stickman MCP Releases" href="feed.xml">');
    expect(html).toContain('<meta property="og:image" content="https://vallahrich.github.io/stickman-mcp/og-card.png">');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');

    const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(jsonLdMatch).not.toBeNull();
    const jsonLd = JSON.parse(jsonLdMatch![1]) as {
      "@context": string;
      "@graph": Array<Record<string, unknown>>;
    };
    expect(jsonLd["@context"]).toBe("https://schema.org");
    const app = jsonLd["@graph"].find((node) => node["@type"] === "SoftwareApplication");
    const src = jsonLd["@graph"].find((node) => node["@type"] === "SoftwareSourceCode");
    expect(app).toBeDefined();
    expect(src).toBeDefined();
    expect((app!.offers as { price: string }).price).toBe("0");
    expect(app).not.toHaveProperty("aggregateRating");
    expect(src!.codeRepository).toBe("https://github.com/vallahrich/stickman-mcp");
    expect(src!.programmingLanguage).toBe("TypeScript");
    expect(Array.isArray(src!.keywords)).toBe(true);
  }, 60_000);

  it("ships valid repo-root server.json, CITATION.cff, and scriptless 1200x420 docs/hero-banner.svg", async () => {
    const serverJson = JSON.parse(await readFile(resolve(root, "server.json"), "utf8")) as {
      $schema: string;
      name: string;
      title: string;
      description: string;
      version: string;
      websiteUrl: string;
      repository: { url: string; source: string };
      packages: Array<{ transport: { type: string } }>;
    };
    expect(serverJson.$schema).toBe("https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json");
    expect(serverJson.name).toBe("io.github.vallahrich/stickman-mcp");
    expect(serverJson.title).toBe("Stickman MCP");
    expect(serverJson.description.length).toBeLessThanOrEqual(100);
    expect(serverJson.websiteUrl).toBe("https://vallahrich.github.io/stickman-mcp/");
    expect(serverJson.repository).toEqual({
      url: "https://github.com/vallahrich/stickman-mcp",
      source: "github"
    });
    expect(serverJson.packages[0]?.transport.type).toBe("stdio");

    const citation = await readFile(resolve(root, "CITATION.cff"), "utf8");
    expect(citation).toMatch(/^cff-version:\s*1\.2\.0\r?\n/);
    expect(citation).toContain('title: "Stickman MCP"');
    expect(citation).toContain('repository-code: "https://github.com/vallahrich/stickman-mcp"');

    const banner = await readFile(resolve(root, "docs", "hero-banner.svg"), "utf8");
    expect(banner).toContain('viewBox="0 0 1200 420"');
    expect(banner).not.toContain("<script");
  });
});
