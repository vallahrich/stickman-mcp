import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ADDON_TYPES,
  actionCatalog,
  composeMovie,
  renderMovieSvgFrame
} from "../../dist/index.js";

export const SITE_URL = "https://vallahrich.github.io/stickman-mcp/";
export const REPO_URL = "https://github.com/vallahrich/stickman-mcp";
export const DEFAULT_BRANCH = "vallahrich-stickman-mcp-engine";

export const MCP_TOOLS = Object.freeze([
  { name: "stickman_discover", group: "Discovery & Schema", readOnly: true, summary: "Discover supported runtime actions with optional category, tag, prop, kind, travel, or search filters." },
  { name: "stickman_describe", group: "Discovery & Schema", readOnly: true, summary: "Describe one action by bare name (e.g. 'idea') or versioned ID (e.g. 'idea@1.1.0')." },
  { name: "stickman_schema", group: "Discovery & Schema", readOnly: true, summary: "Return the strict JSON Schema for stickman.animation/v1, stickman.animation/v2, or stickman.movie/v1." },
  { name: "stickman_story", group: "Discovery & Schema", readOnly: true, summary: "List combined IT story recipes or fetch an executable multi-action animation plus synchronized host cues." },
  { name: "stickman_validate", group: "Choreography & Movies", readOnly: true, summary: "Validate a v1, v2, or movie/v1 document and return path-specific diagnostics." },
  { name: "stickman_compile", group: "Choreography & Movies", readOnly: true, summary: "Validate and compile a v1, v2, or movie/v1 document into a canonical deterministic program." },
  { name: "stickman_choreograph", group: "Choreography & Movies", readOnly: true, summary: "Auto-choreograph single- or multi-actor v2 beats using semantic anchors, natural timing, auto-props, and cues." },
  { name: "stickman_movie", group: "Choreography & Movies", readOnly: true, summary: "Compose a multi-scene stickman.movie/v1 program with backdrops, fade/wipe transitions, idle-tail trimming, and optional critique." },
  { name: "stickman_storyboard", group: "Review & Critique", readOnly: true, summary: "Render a multi-panel storyboard contact sheet (default or CAD blueprint) with bounds, overlap, and seam lint plus optional PNG." },
  { name: "stickman_critique", group: "Review & Critique", readOnly: true, summary: "Run 6-axis perceptual quality scoring plus annotated SVG/PNG contact sheet and human critique rubric." },
  { name: "stickman_preview", group: "Preview & Export", readOnly: true, summary: "Render a single SVG frame, animated SVG, storyboard SVG, or self-contained HTML preview to stdout/tool output." },
  { name: "stickman_export", group: "Preview & Export", readOnly: false, summary: "Export svg-frame, svg, html, storyboard-svg, gif, mp4, or transparent webm to a new relative file under --root." },
  { name: "stickman_list_film_assets", group: "Continuous Films", readOnly: true, summary: "List mechanically qualified film motion IDs, kits, headwear, places, set props, overlay primitives, and join count." },
  { name: "stickman_check_join", group: "Continuous Films", readOnly: true, summary: "Check film-scale hard-join continuity cost and suggested bridge length between two approved motions." },
  { name: "stickman_compose_film", group: "Continuous Films", readOnly: true, summary: "Validate and compose a strict JSON film recipe with automatic pose-space bridges and continuity bounds." },
  { name: "stickman_render_film", group: "Continuous Films", readOnly: false, summary: "Render a film recipe into silent MP4, poster PNG, VTT captions, and optional QA sheet in a new directory under --root." },
  { name: "stickman_author_motion", group: "Motion Authoring", readOnly: false, summary: "Author a status=draft motion from reusable pose keys with anatomy/contact/continuity gates into a new outputDir under --root." },
  { name: "stickman_preview_motion", group: "Motion Authoring", readOnly: true, summary: "Render a sampled PNG preview strip for a draft, candidate, or packaged motion into a new outputDir under --root." }
]);

export const MCP_RESOURCES = Object.freeze([
  { uri: "stickman://catalog", summary: "Grouped catalog of all runtime actions, clip markers, and prop metadata." },
  { uri: "stickman://schema/v1", summary: "Strict JSON Schema for stickman.animation/v1 single-actor timelines." },
  { uri: "stickman://schema/v2", summary: "Strict JSON Schema for stickman.animation/v2 multi-actor choreography." },
  { uri: "stickman://schema/movie-v1", summary: "Strict JSON Schema for stickman.movie/v1 multi-scene movies." },
  { uri: "stickman://anchors", summary: "Semantic stage anchors and coordinate conventions for the 800x450 canvas." },
  { uri: "stickman://props", summary: "All geometric runtime prop definitions, attachment sockets, and action auto-mappings." },
  { uri: "stickman://rubric/human-critique", summary: "6-axis weighted quality rubric, pass thresholds, and visual self-critique checklist." },
  { uri: "ui://stickman/player", summary: "Self-contained interactive MCP App vector player UI resource with blueprint toggle and critique pills." },
  { uri: "stickman://templates/presentation-pitch", summary: "Ready-to-compile v2 single-actor slide presentation pitch template." },
  { uri: "stickman://templates/two-actor-dialogue", summary: "Ready-to-compile v2 two-actor cue-synced conversation template." },
  { uri: "stickman://templates/idea-reveal", summary: "Ready-to-compile v2 think -> idea lightbulb -> reveal -> cheer template." },
  { uri: "stickman://templates/sports-action", summary: "Ready-to-compile v2 hurdle -> basketball-shot -> fist-pump template." },
  { uri: "stickman://templates/incident-warroom-movie", summary: "Ready-to-compose 3-scene stickman.movie/v1 incident war-room recovery template." },
  { uri: "stickman://templates/two-actor-handoff", summary: "Ready-to-choreograph 2-actor shared card handoff and elevated stairs template." }
]);

export const MCP_PROMPTS = Object.freeze([
  { name: "choreograph-slide", summary: "Step-by-step workflow to choreograph, storyboard-critique, and export a deterministic stickman slide animation." },
  { name: "two-actor-dialogue", summary: "Step-by-step workflow to choreograph and verify a 2-actor cue-synced stickman conversation." },
  { name: "create-and-critique-movie", summary: "Step-by-step workflow to compose a multi-scene movie, run Tier A + Tier B critique until >= 8.5/10, and export." }
]);

const RELEASE_HISTORY = Object.freeze([
  {
    version: "0.3.0",
    updated: "2026-11-24T14:00:37Z",
    title: "Stickman MCP v0.3.0 — Multi-Scene Movies, Virtual Camera, 6-Axis Critique & Transparent WebM",
    summary:
      "Adds stickman.movie/v1 multi-scene composition with contextual backdrops and fade/wipe transitions, auto-director virtual camera, 2.5D depth planes, spotlight focus, editorial callouts, curved Bezier spines, gaze cues, hand glyphs, shared multi-actor prop handoffs, 6-axis stickman_critique, ui://stickman/player MCP App, parallel MP4 rasterization, and transparent VP9 WebM export."
  },
  {
    version: "0.2.2",
    updated: "2026-11-17T17:20:35Z",
    title: "Stickman MCP v0.2.2 — Full-Stage Hatched CAD Blueprints & Scroll-Scrubbed Playhead",
    summary:
      "Adds full-stage architectural CAD blueprint rendering (--blueprint / --style blueprint), interactive scroll-scrubbed <stickman-player> timelines via bindScrollTimeline, and DESIGN.md token/contrast/anti-slop linting."
  },
  {
    version: "0.2.1",
    updated: "2026-11-16T18:09:20Z",
    title: "Stickman MCP v0.2.1 — Multi-Actor v2 Stabilization & Release Parity",
    summary:
      "Hardens stickman.animation/v2 multi-actor choreography, storyboard spatial/seam diagnostics, and offline release-candidate verification."
  },
  {
    version: "0.2.0",
    updated: "2026-11-16T10:31:36Z",
    title: "Stickman MCP v0.2.0 — stickman.animation/v2 Choreography, Props & Storyboard Review",
    summary:
      "Introduces stickman.animation/v2 multi-actor choreography with semantic anchors, cue synchronization, geometric vector props/add-ons, storyboard contact sheets, and expanded runtime motion catalog."
  },
  {
    version: "0.1.0",
    updated: "2026-11-05T12:38:30Z",
    title: "Stickman MCP v0.1.0 — Deterministic 2D Stick-Figure Engine & Local Stdio MCP Server",
    summary:
      "Initial release of the deterministic 2D vector stick-figure compiler, CLI, local stdio MCP server, safe export root boundary, continuous film composer, and offline motion gallery."
  }
]);

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeXml(value) {
  return escapeHtml(value).replaceAll("'", "&apos;");
}

function normalizeBaseUrl(url) {
  return url.endsWith("/") ? url : `${url}/`;
}

export function buildHeadMetadata({
  version = "0.3.0",
  releaseCandidate = false,
  siteUrl = SITE_URL,
  repoUrl = REPO_URL
} = {}) {
  const baseUrl = normalizeBaseUrl(siteUrl);
  const cleanRepoUrl = repoUrl.replace(/\/+$/, "");
  const actionCount = actionCatalog.length;
  const propCount = ADDON_TYPES.length;
  const title = "Stickman MCP · Deterministic 2D Stick-Figure Animation & Movie Engine";
  const description = `Deterministic local 2D stick-figure animation and multi-scene movie engine with an ${MCP_TOOLS.length}-tool stdio MCP server, ${actionCount} runtime actions, ${propCount} geometric props, 6-axis perceptual critique, and SVG/HTML/GIF/MP4/transparent WebM export.`;
  const ogImageUrl = `${baseUrl}og-card.png`;
  const downloadUrl = `${cleanRepoUrl}/releases/tag/v${version}`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        "@id": `${baseUrl}#software`,
        name: "Stickman MCP",
        description,
        applicationCategory: "DeveloperApplication",
        operatingSystem: "Windows, macOS, Linux (Node.js 20+)",
        softwareVersion: version,
        url: baseUrl,
        downloadUrl,
        image: ogImageUrl,
        isAccessibleForFree: true,
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD"
        }
      },
      {
        "@type": "SoftwareSourceCode",
        "@id": `${baseUrl}#source`,
        name: "Stickman MCP",
        description,
        codeRepository: cleanRepoUrl,
        programmingLanguage: "TypeScript",
        runtimePlatform: "Node.js 20+",
        license: `${cleanRepoUrl}/blob/${DEFAULT_BRANCH}/LICENSE`,
        version,
        url: baseUrl,
        targetProduct: {
          "@id": `${baseUrl}#software`
        },
        keywords: [
          "stickman",
          "stick-figure",
          "2d-animation",
          "mcp",
          "model-context-protocol",
          "deterministic-animation",
          "svg-animation",
          "multi-scene-movie",
          "explainer-video",
          "transparent-webm"
        ]
      }
    ]
  };

  const safeJsonLd = JSON.stringify(jsonLd).replaceAll("<", "\\u003c");
  const lines = [
    `<link rel="canonical" href="${escapeHtml(baseUrl)}">`,
    `<link rel="describedby" href="llms.txt">`,
    `<link rel="alternate" type="text/markdown" href="llms-full.txt">`,
    `<link rel="alternate" type="application/atom+xml" title="Stickman MCP Releases" href="feed.xml">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="Stickman MCP">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:url" content="${escapeHtml(baseUrl)}">`,
    `<meta property="og:image" content="${escapeHtml(ogImageUrl)}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="Stickman MCP editorial preview card featuring a deterministic multi-actor stick-figure scene, 106 runtime motions, 55 props, and 18 local MCP tools">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${escapeHtml(title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(description)}">`,
    `<meta name="twitter:image" content="${escapeHtml(ogImageUrl)}">`,
    `<script type="application/ld+json">${safeJsonLd}</script>`
  ];

  // Keep releaseCandidate referenced cleanly for callers inspecting build mode.
  void releaseCandidate;
  return lines.join("\n");
}

function extractSvgInner(svgMarkup, clipPrefix) {
  const openEnd = svgMarkup.indexOf(">");
  const closeStart = svgMarkup.lastIndexOf("</svg>");
  if (openEnd < 0 || closeStart < 0) {
    throw new Error("Expected a valid root <svg> element from renderMovieSvgFrame.");
  }
  const inner = svgMarkup.slice(openEnd + 1, closeStart);
  return inner
    .replaceAll('id="sm-cam-clip"', `id="${clipPrefix}-cam-clip"`)
    .replaceAll("url(#sm-cam-clip)", `url(#${clipPrefix}-cam-clip)`)
    .replaceAll('id="scene"', `id="${clipPrefix}-scene"`);
}

async function sampleWarroomFrameInner(repoRoot, { timeMs = 28000, clipPrefix }) {
  const moviePath = path.join(repoRoot, "examples", "v3-incident-warroom-movie.json");
  const raw = JSON.parse(await fs.readFile(moviePath, "utf8"));
  const composed = composeMovie(raw);
  if (!composed.valid || !composed.movie) {
    throw new Error(`Failed to compose warroom movie for discovery artwork: ${JSON.stringify(composed.diagnostics)}`);
  }
  const frameSvg = renderMovieSvgFrame(composed.movie, timeMs, "normal");
  return extractSvgInner(frameSvg, clipPrefix);
}

export async function renderOgCardSvg(repoRoot, { version = "0.3.0" } = {}) {
  const actionCount = actionCatalog.length;
  const propCount = ADDON_TYPES.length;
  const sceneInner = await sampleWarroomFrameInner(repoRoot, {
    timeMs: 28000,
    clipPrefix: "og"
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630" role="img" aria-label="Stickman MCP deterministic 2D stick-figure animation and movie engine preview">
  <defs>
    <clipPath id="og-stage-clip"><rect x="536" y="150" width="600" height="337.5" rx="10"/></clipPath>
  </defs>
  <rect width="1200" height="630" fill="#f7f4ef"/>
  <rect x="16" y="16" width="1168" height="598" rx="18" fill="#fcfbf8" stroke="#dedede" stroke-width="1.5"/>

  <rect x="54" y="64" width="44" height="5" rx="2.5" fill="#b11f4b"/>
  <rect x="54" y="88" width="234" height="30" rx="6" fill="#f5e6eb"/>
  <text x="68" y="108" font-family="Consolas, 'Courier New', monospace" font-size="13" font-weight="700" letter-spacing="1.2" fill="#b11f4b">LOCAL STDIO MCP · v${escapeXml(version)}</text>

  <text x="54" y="182" font-family="'Segoe UI', Aptos, Calibri, -apple-system, BlinkMacSystemFont, sans-serif" font-size="56" font-weight="800" letter-spacing="-1.2" fill="#242424">Stickman <tspan fill="#b11f4b">MCP</tspan></text>

  <text x="54" y="232" font-family="'Segoe UI', Aptos, Calibri, -apple-system, BlinkMacSystemFont, sans-serif" font-size="22" font-weight="500" fill="#5c5c5c">Deterministic 2D stick-figure</text>
  <text x="54" y="262" font-family="'Segoe UI', Aptos, Calibri, -apple-system, BlinkMacSystemFont, sans-serif" font-size="22" font-weight="500" fill="#5c5c5c">animation &amp; movie engine</text>
  <text x="54" y="292" font-family="'Segoe UI', Aptos, Calibri, -apple-system, BlinkMacSystemFont, sans-serif" font-size="22" font-weight="500" fill="#5c5c5c">for AI agents</text>

  <g font-family="Consolas, 'Courier New', monospace" font-size="14" font-weight="700" fill="#242424">
    <rect x="54" y="336" width="424" height="40" rx="10" fill="#ffffff" stroke="#dedede" stroke-width="1.2"/>
    <circle cx="76" cy="356" r="4.5" fill="#b11f4b"/>
    <text x="92" y="361">${actionCount} motions · ${propCount} geometric props</text>

    <rect x="54" y="388" width="424" height="40" rx="10" fill="#ffffff" stroke="#dedede" stroke-width="1.2"/>
    <circle cx="76" cy="408" r="4.5" fill="#b11f4b"/>
    <text x="92" y="413">${MCP_TOOLS.length} MCP tools · ${MCP_RESOURCES.length} resources · ${MCP_PROMPTS.length} prompts</text>

    <rect x="54" y="440" width="424" height="40" rx="10" fill="#ffffff" stroke="#dedede" stroke-width="1.2"/>
    <circle cx="76" cy="460" r="4.5" fill="#b11f4b"/>
    <text x="92" y="465">SVG / HTML / GIF / MP4 / transparent WebM</text>

    <rect x="54" y="492" width="424" height="40" rx="10" fill="#ffffff" stroke="#dedede" stroke-width="1.2"/>
    <circle cx="76" cy="512" r="4.5" fill="#16a34a"/>
    <text x="92" y="517">Zero AI video API cost · 100% local</text>
  </g>

  <text x="54" y="576" font-family="Consolas, 'Courier New', monospace" font-size="14" fill="#5c5c5c">vallahrich.github.io/stickman-mcp</text>

  <rect x="518" y="88" width="636" height="454" rx="16" fill="#ffffff" stroke="#dedede" stroke-width="1.5"/>
  <rect x="518" y="88" width="636" height="46" rx="16" fill="#f7f4ef"/>
  <rect x="518" y="118" width="636" height="16" fill="#f7f4ef"/>
  <line x1="518" y1="134" x2="1154" y2="134" stroke="#dedede" stroke-width="1.2"/>
  <circle cx="542" cy="111" r="5" fill="#b11f4b"/>
  <text x="558" y="116" font-family="Consolas, 'Courier New', monospace" font-size="13" font-weight="700" fill="#242424">stickman.movie/v1 · 1280×720 · auto-director</text>
  <rect x="1032" y="99" width="104" height="24" rx="6" fill="#e8f7ed"/>
  <text x="1046" y="115" font-family="Consolas, 'Courier New', monospace" font-size="12" font-weight="700" fill="#166534">CRITIQUE OK</text>

  <g clip-path="url(#og-stage-clip)">
    <svg x="536" y="150" width="600" height="337.5" viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid meet">
      ${sceneInner}
    </svg>
  </g>
  <rect x="536" y="150" width="600" height="337.5" rx="10" fill="none" stroke="#dedede" stroke-width="1.2"/>

  <text x="538" y="520" font-family="'Segoe UI', Aptos, Calibri, -apple-system, BlinkMacSystemFont, sans-serif" font-size="14" font-weight="600" fill="#5c5c5c">Multi-actor 2.5D depth · editorial callouts · 6-axis stickman_critique</text>
</svg>`;
}

export async function renderHeroBannerSvg(repoRoot, { version = "0.3.0" } = {}) {
  const actionCount = actionCatalog.length;
  const propCount = ADDON_TYPES.length;
  const sceneInner = await sampleWarroomFrameInner(repoRoot, {
    timeMs: 28000,
    clipPrefix: "hero"
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 420" width="1200" height="420" role="img" aria-label="Stickman MCP multi-actor deterministic 2D stick-figure animation preview">
  <defs>
    <clipPath id="hero-stage-clip"><rect x="538" y="74" width="608" height="304" rx="10"/></clipPath>
  </defs>
  <rect width="1200" height="420" rx="18" fill="#f7f4ef"/>
  <rect x="1" y="1" width="1198" height="418" rx="18" fill="none" stroke="#dedede" stroke-width="1.5"/>

  <rect x="44" y="42" width="40" height="4.5" rx="2.25" fill="#b11f4b"/>
  <text x="44" y="72" font-family="Consolas, 'Courier New', monospace" font-size="12.5" font-weight="700" letter-spacing="1.3" fill="#b11f4b">STICKMAN.MOVIE/V1 · LOCAL STDIO MCP · v${escapeXml(version)}</text>

  <text x="44" y="132" font-family="'Segoe UI', Aptos, Calibri, -apple-system, BlinkMacSystemFont, sans-serif" font-size="48" font-weight="800" letter-spacing="-1" fill="#242424">Stickman <tspan fill="#b11f4b">MCP</tspan></text>

  <text x="44" y="172" font-family="'Segoe UI', Aptos, Calibri, -apple-system, BlinkMacSystemFont, sans-serif" font-size="19" font-weight="500" fill="#5c5c5c">Deterministic 2D stick-figure animation</text>
  <text x="44" y="198" font-family="'Segoe UI', Aptos, Calibri, -apple-system, BlinkMacSystemFont, sans-serif" font-size="19" font-weight="500" fill="#5c5c5c">&amp; multi-scene movie engine for AI agents.</text>

  <g font-family="Consolas, 'Courier New', monospace" font-size="13" font-weight="700" fill="#242424">
    <rect x="44" y="232" width="218" height="36" rx="8" fill="#ffffff" stroke="#dedede" stroke-width="1.2"/>
    <text x="58" y="255">${actionCount} motions · ${propCount} props</text>

    <rect x="274" y="232" width="228" height="36" rx="8" fill="#ffffff" stroke="#dedede" stroke-width="1.2"/>
    <text x="288" y="255">${MCP_TOOLS.length} tools · ${MCP_RESOURCES.length} resources</text>

    <rect x="44" y="280" width="218" height="36" rx="8" fill="#ffffff" stroke="#dedede" stroke-width="1.2"/>
    <text x="58" y="303">SVG · HTML · MP4 · WebM</text>

    <rect x="274" y="280" width="228" height="36" rx="8" fill="#ffffff" stroke="#dedede" stroke-width="1.2"/>
    <text x="288" y="303">Zero API cost · 100% local</text>
  </g>

  <text x="44" y="368" font-family="Consolas, 'Courier New', monospace" font-size="13" fill="#5c5c5c">vallahrich.github.io/stickman-mcp · MIT + NOTICE</text>

  <rect x="522" y="28" width="640" height="364" rx="14" fill="#ffffff" stroke="#dedede" stroke-width="1.5"/>
  <rect x="522" y="28" width="640" height="36" rx="14" fill="#fcfbf8"/>
  <rect x="522" y="50" width="640" height="14" fill="#fcfbf8"/>
  <line x1="522" y1="64" x2="1162" y2="64" stroke="#dedede" stroke-width="1"/>
  <circle cx="542" cy="46" r="4.5" fill="#b11f4b"/>
  <text x="556" y="50" font-family="Consolas, 'Courier New', monospace" font-size="12" font-weight="700" fill="#242424">examples/v3-incident-warroom-movie.json · 3-actor scene</text>
  <rect x="1062" y="36" width="84" height="20" rx="5" fill="#e8f7ed"/>
  <text x="1074" y="50" font-family="Consolas, 'Courier New', monospace" font-size="11" font-weight="700" fill="#166534">30 FPS SVG</text>

  <g clip-path="url(#hero-stage-clip)">
    <rect x="538" y="74" width="608" height="304" fill="#ffffff"/>
    <svg x="538" y="74" width="608" height="304" viewBox="0 0 1280 720" preserveAspectRatio="xMidYMid meet">
      ${sceneInner}
    </svg>
  </g>
  <rect x="538" y="74" width="608" height="304" rx="10" fill="none" stroke="#e2e8f0" stroke-width="1"/>
</svg>
`;
}

export function buildLlmsTxt({
  version = "0.3.0",
  siteUrl = SITE_URL,
  repoUrl = REPO_URL,
  actionCount = actionCatalog.length,
  propCount = ADDON_TYPES.length
} = {}) {
  const baseUrl = normalizeBaseUrl(siteUrl);
  const cleanRepoUrl = repoUrl.replace(/\/+$/, "");
  const blobBase = `${cleanRepoUrl}/blob/${DEFAULT_BRANCH}`;

  return `# Stickman MCP

> Deterministic local 2D stick-figure animation and multi-scene movie engine with an ${MCP_TOOLS.length}-tool stdio MCP server — zero AI video API cost, byte-identical SVG, HTML, GIF, MP4, and transparent VP9 WebM output.

Stickman MCP compiles strict JSON contracts (\`stickman.animation/v1\`, \`stickman.animation/v2\`, and \`stickman.movie/v1\`) into pure 30 fps vector animations and multi-scene explainer movies on Node.js 20+. Every frame is a deterministic function of validated choreography data with ${actionCount} runtime actions, ${propCount} geometric props, virtual auto-director camera, 2.5D depth planes, spotlight focus, editorial callouts, 6-axis perceptual critique (\`stickman_critique\`), and an interactive MCP App player (\`ui://stickman/player\`).

## Live Site & Machine-Readable Endpoints

- [Live Gallery & Interactive v0.3 Studio](${baseUrl}): Interactive vector player, 6-axis critique card, CAD blueprint views, and 97-motion gallery.
- [Full LLM & Developer Reference (llms-full.txt)](${baseUrl}llms-full.txt): Self-contained installation, copy-paste MCP client configs, all ${MCP_TOOLS.length} tools, ${MCP_RESOURCES.length} resources, ${MCP_PROMPTS.length} prompts, and runnable JSON examples.
- [Release Feed (Atom XML)](${baseUrl}feed.xml): Chronological release notes from v0.1.0 through v${version}.
- [Capabilities Manifest (JSON)](${baseUrl}capabilities.json): Transport, contract versions, runtime action IDs, tools, resources, and prompts.
- [Motion Catalogue (JSON)](${baseUrl}catalogue.json): Structured motion catalog with categories, variants, and runtime ID availability.
- [Combined IT Story Recipes (JSON)](${baseUrl}stories.json): Executable multi-step IT presentation narratives and host cues.

## Source & Releases

- [GitHub Repository](${cleanRepoUrl}): Source code, CLI, TypeScript library, and stdio MCP server (branch \`${DEFAULT_BRANCH}\`).
- [Releases (v${version})](${cleanRepoUrl}/releases/tag/v${version}): Verified tarball (\`vallahrich-stickman-mcp-${version}.tgz\`) and offline site archive.
- [README](${blobBase}/README.md): Quick start, copy-paste MCP configs, capability summary, and honest positioning.

## Documentation

- [Local MCP Setup & Verification](${blobBase}/docs/mcp-setup.md): Copilot CLI, VS Code, Claude Code, and OpenAI Codex CLI stdio configuration and tool/error contracts.
- [Browser & Deck Integration](${blobBase}/docs/browser-integration.md): \`<stickman-player>\` Web Component, \`bindScrollTimeline\`, and slide overlay embedding.
- [Design System & Motion Spec (DESIGN.md)](${blobBase}/DESIGN.md): Color tokens, WCAG AA contrast floors, blueprint conventions, and motion timing rules.
- [Film Recipes](${blobBase}/docs/film-recipes.md): Continuous silent short films with automatic pose-space bridges and continuity bounds.
- [Motion Authoring Guide](${blobBase}/docs/motion-authoring.md): Key-pose drafting with \`stickman_author_motion\` and \`stickman_preview_motion\`.
- [Rights & Attribution](${blobBase}/docs/rights.md): MIT engine license and CMU-derived motion clip terms.

## Flagship Examples

- [3-Scene Incident War Room Movie (stickman.movie/v1)](${blobBase}/examples/v3-incident-warroom-movie.json): Multi-scene recovery story with war-room, datacenter, and office backdrops, 2.5D depth, spotlight, and auto-director camera.
- [Two-Actor Shared Handoff & Stairs (stickman.animation/v2)](${blobBase}/examples/v3-handoff-and-stairs.json): Shared single-prop \`handoffTo\` transfer and elevated stairs traversal.
- [Two-Actor Collaboration (stickman.animation/v2)](${blobBase}/examples/v2-two-actors-collab.json): Cue-synced multi-actor dialogue with semantic stage anchors and accessories.
- [Ballistic Sports Add-Ons (stickman.animation/v2)](${blobBase}/examples/v2-sports-addons.json): Hurdle clearance and parabolic basketball arc into hoop.
`;
}

export async function buildLlmsFullTxt(
  repoRoot,
  {
    version = "0.3.0",
    siteUrl = SITE_URL,
    repoUrl = REPO_URL,
    actionCount = actionCatalog.length,
    propCount = ADDON_TYPES.length
  } = {}
) {
  const baseUrl = normalizeBaseUrl(siteUrl);
  const cleanRepoUrl = repoUrl.replace(/\/+$/, "");

  const v2Example = JSON.parse(
    await fs.readFile(path.join(repoRoot, "examples", "v2-two-actors-collab.json"), "utf8")
  );
  const movieExample = JSON.parse(
    await fs.readFile(path.join(repoRoot, "examples", "v3-incident-warroom-movie.json"), "utf8")
  );

  const toolsTable = MCP_TOOLS.map(
    (t) => `| \`${t.name}\` | ${t.group} | ${t.readOnly ? "Read-only" : "Writes under `--root`"} | ${t.summary} |`
  ).join("\n");

  const resourcesList = MCP_RESOURCES.map((r) => `- \`${r.uri}\` — ${r.summary}`).join("\n");
  const promptsList = MCP_PROMPTS.map((p) => `- \`${p.name}\` — ${p.summary}`).join("\n");

  return `# Stickman MCP — Complete LLM & Developer Reference (v${version})

> Deterministic local 2D stick-figure animation and multi-scene movie engine with an ${MCP_TOOLS.length}-tool stdio MCP server. Zero AI video API cost; byte-identical SVG, HTML, GIF, MP4, and transparent VP9 WebM exports on Node.js 20+.

- **Live site:** ${baseUrl}
- **Repository:** ${cleanRepoUrl}
- **Release:** ${cleanRepoUrl}/releases/tag/v${version}
- **Runtime catalog:** ${actionCount} deterministic actions, ${propCount} geometric vector props/add-ons, 3 strict JSON contracts (\`stickman.animation/v1\`, \`stickman.animation/v2\`, \`stickman.movie/v1\`).

## What Stickman MCP Solves

AI coding and presentation assistants struggle to produce repeatable, lightweight technical explainer animations: generative video APIs are non-deterministic, slow, costly, and cannot guarantee legible diagrams or exact slide alignment. Stickman MCP solves this with a pure local 2D vector animation compiler and stdio MCP server:

- **100% local & deterministic:** Same JSON input and timestamp always produces identical SVG geometry at 30 fps. No model-weight calls, no external network dependencies, zero per-render API cost.
- **Declarative multi-actor & multi-scene authoring:** Agents write concise cue-synced beats (\`stickman.animation/v2\`) or multi-scene movies (\`stickman.movie/v1\`) with contextual backdrops (\`war-room\`, \`datacenter\`, \`office\`, \`stage\`), \`auto-director\` virtual camera, 2.5D \`depth\` planes, \`spotlight: "auto"\`, editorial \`say\`/\`think\`/\`badge\` callouts, and shared single-prop \`handoffTo\`.
- **Built-in self-critique loop:** \`stickman_critique\` scores every scene across 6 weighted perceptual axes (\`Prop Integrity\`, \`Spatial Continuity\`, \`Staging & Eye-Trace\`, \`Pacing & Readability\`, \`Kinematic Appeal\`, \`Cinematography\`) and emits annotated SVG/PNG contact sheets so an agent can iterate until \`passed: true\` (\`overallScore >= 8.5\`).
- **Embeddable everywhere:** Export compact self-contained HTML players, scriptless animated SVG, orthographic CAD blueprint SVG, GIF, parallel H.264 MP4, or alpha-channel transparent VP9 WebM overlays, or mount \`<stickman-player controls scroll-scrub blueprint>\` in web pages.

## Quick Install

### Option 1 — GitHub Release Tarball (No Build Needed)

\`\`\`sh
npm install ./vallahrich-stickman-mcp-${version}.tgz
npx stickman discover
npx stickman-mcp --root ./stickman-output
\`\`\`

### Option 2 — Build From Source (Node.js 20+)

\`\`\`sh
git clone ${cleanRepoUrl}.git
cd stickman-mcp
npm install
npm run build
node dist/cli.js discover --category presentation
node dist/mcp.js --root ./stickman-output
\`\`\`

## Copy-Paste MCP Server Configuration

Always pass an explicit \`--root\` directory. All file-writing tools (\`stickman_export\`, \`stickman_render_film\`, \`stickman_author_motion\`) strictly confine writes to new relative paths inside \`--root\` and refuse overwrites, traversal, or symlinks.

### GitHub Copilot CLI

\`\`\`sh
copilot mcp add stickman -- node "/path/to/stickman-mcp/dist/mcp.js" --root "/path/to/stickman-output"
\`\`\`

### VS Code (\`.mcp.json\`)

\`\`\`json
{
  "mcpServers": {
    "stickman": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/path/to/stickman-mcp/dist/mcp.js",
        "--root",
        "/path/to/stickman-output"
      ]
    }
  }
}
\`\`\`

### Claude Code

\`\`\`sh
claude mcp add --transport stdio stickman -- node "/path/to/stickman-mcp/dist/mcp.js" --root "/path/to/stickman-output"
\`\`\`

### OpenAI Codex CLI

\`\`\`sh
codex mcp add stickman -- node "/path/to/stickman-mcp/dist/mcp.js" --root "/path/to/stickman-output"
\`\`\`

## MCP Surface (${MCP_TOOLS.length} Tools · ${MCP_RESOURCES.length} Resources · ${MCP_PROMPTS.length} Prompts)

### Tools (${MCP_TOOLS.length})

| Tool | Group | Mode | Purpose |
|---|---|---|---|
${toolsTable}

### Resources (${MCP_RESOURCES.length})

${resourcesList}

### Prompts (${MCP_PROMPTS.length})

${promptsList}

## Export Formats

| Format | Flag / Option | External Dependencies | Use Case |
|---|---|---|---|
| Single SVG frame | \`svg-frame\` | None | Posters, documentation diagrams, static slide illustrations |
| Animated SVG | \`svg\` | None | Scriptless looping vector animations (GitHub READMEs, docs) |
| Self-contained HTML | \`html\` | None | Interactive compact player (\`< 220 KB\`) with play/pause, seek, blueprint toggle |
| Storyboard SVG | \`storyboard-svg\` | None | Multi-panel contact sheet (default or CAD blueprint theme) |
| Animated GIF | \`gif\` | Optional \`@resvg/resvg-js\` + FFmpeg | Quick messaging, PR previews, legacy slide decks |
| H.264 MP4 | \`mp4\` | Optional \`@resvg/resvg-js\` + FFmpeg | High-clarity silent explainer videos (parallel worker rasterization) |
| Transparent VP9 WebM | \`webm\` + \`transparent: true\` | Optional \`@resvg/resvg-js\` + FFmpeg | Alpha-channel (\`yuva420p\`) compositing over slides or video editors |

## Runnable Example 1: \`stickman.animation/v2\` (Multi-Actor Choreography)

\`\`\`json
${JSON.stringify(v2Example, null, 2)}
\`\`\`

## Runnable Example 2: \`stickman.movie/v1\` (Multi-Scene Movie)

\`\`\`json
${JSON.stringify(movieExample, null, 2)}
\`\`\`

## Deterministic Guarantees & Scope Boundaries

- **Pure function of input and time:** \`sampleAnimation(program, timeMs, mode)\` and \`sampleMovie(movie, timeMs, mode)\` are deterministic with zero hidden timers, zero randomness, and zero network requests.
- **Accessibility built in:** \`reduced\` and \`static\` playback modes keep actors onstage in a meaningful summary pose and honor \`prefers-reduced-motion: reduce\`.
- **Explicit non-goals:** Stickman MCP is not a photorealistic AI video generator, 3D rigged character renderer, general physics simulator, or speech/audio synthesizer. Use it when you want clean, lightweight, auditable 2D technical explainers, slide animations, and storyboarded workflows.
- **Licensing:** Original engine, authored key-pose specifications, and geometric vector props are MIT-licensed (\`LICENSE\`). Compact CMU-derived motion clips retain CMU non-resale dataset terms documented in \`NOTICE\` and \`docs/rights.md\`.
`;
}

export function buildSitemapXml({ siteUrl = SITE_URL } = {}) {
  const baseUrl = normalizeBaseUrl(siteUrl);
  const lastmod = RELEASE_HISTORY[0].updated.slice(0, 10);
  const entries = [
    { loc: baseUrl, priority: "1.0" },
    { loc: `${baseUrl}llms.txt`, priority: "0.9" },
    { loc: `${baseUrl}llms-full.txt`, priority: "0.9" },
    { loc: `${baseUrl}feed.xml`, priority: "0.8" },
    { loc: `${baseUrl}showcase/on-prem-to-cloud.html`, priority: "0.8" },
    { loc: `${baseUrl}catalogue.json`, priority: "0.7" }
  ];

  const urlsXml = entries
    .map(
      (entry) =>
        `  <url>\n    <loc>${escapeXml(entry.loc)}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <priority>${entry.priority}</priority>\n  </url>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlsXml}\n</urlset>\n`;
}

export function buildAtomFeedXml({
  version = "0.3.0",
  siteUrl = SITE_URL,
  repoUrl = REPO_URL
} = {}) {
  const baseUrl = normalizeBaseUrl(siteUrl);
  const cleanRepoUrl = repoUrl.replace(/\/+$/, "");

  const knownVersions = new Set(RELEASE_HISTORY.map((entry) => entry.version));
  const entries = knownVersions.has(version)
    ? [...RELEASE_HISTORY]
    : [
        {
          version,
          updated: "2026-11-24T18:00:00Z",
          title: `Stickman MCP v${version}`,
          summary: `Deterministic 2D stick-figure animation and multi-scene movie engine release v${version} with machine-readable discovery assets, ${actionCatalog.length} runtime actions, ${ADDON_TYPES.length} geometric props, and ${MCP_TOOLS.length} local stdio MCP tools.`
        },
        ...RELEASE_HISTORY
      ];

  const feedUpdated = entries[0].updated;
  const entriesXml = entries
    .map((entry) => {
      const tag = `v${entry.version}`;
      const href = `${cleanRepoUrl}/releases/tag/${tag}`;
      return [
        "  <entry>",
        `    <id>${escapeXml(href)}</id>`,
        `    <title>${escapeXml(entry.title)}</title>`,
        `    <updated>${escapeXml(entry.updated)}</updated>`,
        `    <link rel="alternate" type="text/html" href="${escapeXml(href)}"/>`,
        `    <summary>${escapeXml(entry.summary)}</summary>`,
        "  </entry>"
      ].join("\n");
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <id>${escapeXml(baseUrl)}feed.xml</id>`,
    "  <title>Stickman MCP Releases</title>",
    "  <subtitle>Deterministic 2D stick-figure animation and multi-scene movie engine with a local stdio MCP server.</subtitle>",
    `  <updated>${escapeXml(feedUpdated)}</updated>`,
    `  <link rel="self" type="application/atom+xml" href="${escapeXml(baseUrl)}feed.xml"/>`,
    `  <link rel="alternate" type="text/html" href="${escapeXml(baseUrl)}"/>`,
    "  <author>",
    "    <name>Stickman MCP Maintainers</name>",
    `    <uri>${escapeXml(cleanRepoUrl)}</uri>`,
    "  </author>",
    entriesXml,
    "</feed>",
    ""
  ].join("\n");
}

export function buildRobotsTxt({ releaseCandidate = false, siteUrl = SITE_URL } = {}) {
  if (!releaseCandidate) {
    return "User-agent: *\nDisallow: /\n";
  }
  const baseUrl = normalizeBaseUrl(siteUrl);
  const agents = [
    "OAI-SearchBot",
    "Claude-SearchBot",
    "Claude-User",
    "PerplexityBot",
    "Perplexity-User",
    "Googlebot",
    "Bingbot",
    "*"
  ];
  const blocks = agents.map((agent) => `User-agent: ${agent}\nAllow: /`);
  return `${blocks.join("\n\n")}\n\nSitemap: ${baseUrl}sitemap.xml\n`;
}

async function rasterizeSvgToPng(svgMarkup, width) {
  let Resvg;
  try {
    ({ Resvg } = await import("@resvg/resvg-js"));
  } catch (error) {
    throw new Error(
      `Generating og-card.png requires @resvg/resvg-js: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const renderer = new Resvg(svgMarkup, {
    fitTo: { mode: "width", value: width },
    font: { loadSystemFonts: true }
  });
  return Buffer.from(renderer.render().asPng());
}

export async function generateDiscoveryFiles(
  outputDir,
  {
    version = "0.3.0",
    releaseCandidate = false,
    repoRoot,
    catalogue,
    siteUrl = SITE_URL,
    repoUrl = REPO_URL
  } = {}
) {
  if (!repoRoot) {
    throw new Error("generateDiscoveryFiles requires repoRoot.");
  }
  const actionCount = catalogue?.runtimeMotionIds?.length ?? actionCatalog.length;
  const propCount = ADDON_TYPES.length;

  const [llmsFull, ogSvg] = await Promise.all([
    buildLlmsFullTxt(repoRoot, { version, siteUrl, repoUrl, actionCount, propCount }),
    renderOgCardSvg(repoRoot, { version })
  ]);
  const ogPng = await rasterizeSvgToPng(ogSvg, 1200);

  await Promise.all([
    fs.writeFile(
      path.join(outputDir, "llms.txt"),
      buildLlmsTxt({ version, siteUrl, repoUrl, actionCount, propCount }),
      "utf8"
    ),
    fs.writeFile(path.join(outputDir, "llms-full.txt"), llmsFull, "utf8"),
    fs.writeFile(path.join(outputDir, "sitemap.xml"), buildSitemapXml({ siteUrl }), "utf8"),
    fs.writeFile(path.join(outputDir, "feed.xml"), buildAtomFeedXml({ version, siteUrl, repoUrl }), "utf8"),
    fs.writeFile(path.join(outputDir, "robots.txt"), buildRobotsTxt({ releaseCandidate, siteUrl }), "utf8"),
    fs.writeFile(path.join(outputDir, "og-card.png"), ogPng)
  ]);

  return {
    files: ["llms.txt", "llms-full.txt", "sitemap.xml", "feed.xml", "robots.txt", "og-card.png"],
    ogBytes: ogPng.length
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
  const pkg = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf8"));
  if (process.argv.includes("--write-hero-banner")) {
    const svg = await renderHeroBannerSvg(repoRoot, { version: pkg.version });
    const target = path.join(repoRoot, "docs", "hero-banner.svg");
    await fs.writeFile(target, svg, "utf8");
    console.log(JSON.stringify({ heroBanner: target, bytes: Buffer.byteLength(svg, "utf8") }));
  } else {
    console.error("Usage: node scripts/site/discovery.mjs --write-hero-banner");
    process.exitCode = 1;
  }
}
