import {
  type CompiledAnimation,
  type CompiledMovie,
  type MarkerEvent,
  type MovieMarkerEvent
} from "./contract.js";
import { isCompiledMovie } from "./movie.js";
import { buildCompactPlayerPayload } from "./player-runtime.js";

export const DECK_EMBED_TARGETS = Object.freeze([
  "reveal",
  "slidev",
  "marp",
  "html",
  "pptx-notes"
] as const);

export type DeckEmbedTarget = (typeof DECK_EMBED_TARGETS)[number];

export interface DeckEmbedOptions {
  title?: string;
  controls?: boolean;
  scrollScrub?: boolean;
  blueprint?: boolean;
  assetPath?: string;
}

export function isDeckEmbedTarget(value: unknown): value is DeckEmbedTarget {
  return typeof value === "string" && (DECK_EMBED_TARGETS as readonly string[]).includes(value);
}

function escapeHtmlAttr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function safeJsonForHtmlScript(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
}

function slugify(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "stickman-scene";
}

function collectEvents(programOrMovie: CompiledAnimation | CompiledMovie): Array<MarkerEvent | MovieMarkerEvent> {
  return [...(programOrMovie.events ?? [])].sort((a, b) => a.timeMs - b.timeMs);
}

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

function playerAttributeList(options: DeckEmbedOptions): string {
  const attrs: string[] = [];
  if (options.controls !== false) attrs.push("controls");
  if (options.scrollScrub) attrs.push("scroll-scrub");
  if (options.blueprint) attrs.push("blueprint");
  return attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
}

export function generateDeckEmbed(
  programOrMovie: CompiledAnimation | CompiledMovie,
  target: DeckEmbedTarget,
  options: DeckEmbedOptions = {}
): string {
  if (!isDeckEmbedTarget(target)) {
    throw new TypeError(
      `Unsupported deck embed target "${String(target)}". Expected one of: ${DECK_EMBED_TARGETS.join(", ")}.`
    );
  }

  const isMovie = isCompiledMovie(programOrMovie);
  const title =
    options.title?.trim() ||
    (isMovie ? programOrMovie.spec.title : undefined) ||
    "Stickman Animation";
  const slug = slugify(title);
  const durationMs = isMovie ? programOrMovie.durationMs : programOrMovie.spec.durationMs;
  const { width, height, fps } = programOrMovie.spec.canvas;
  const style = options.blueprint ? "blueprint" : undefined;
  const compactPayload = buildCompactPlayerPayload(programOrMovie, {
    ...(style ? { style } : {})
  });
  const payloadJson = safeJsonForHtmlScript(compactPayload);
  const attrs = playerAttributeList(options);
  const events = collectEvents(programOrMovie);
  const defaultAsset =
    options.assetPath?.trim() ||
    (target === "pptx-notes"
      ? `./${slug}.mp4`
      : target === "marp"
        ? `./${slug}.svg`
        : `./${slug}.html`);

  switch (target) {
    case "reveal": {
      const cueList =
        events.length > 0
          ? events.map((e) => `${formatSeconds(e.timeMs)} ${e.marker} (${e.action})`).join(", ")
          : "none";
      return [
        `<!-- Reveal.js slide embed (${width}x${height} @ ${fps}fps, ${formatSeconds(durationMs)}) -->`,
        `<section data-stickman-title="${escapeHtmlAttr(title)}">`,
        `  <h2>${escapeHtmlAttr(title)}</h2>`,
        `  <stickman-player id="sm-${slug}"${attrs}></stickman-player>`,
        `  <script type="application/json" id="sm-${slug}-payload">${payloadJson}</script>`,
        `  <!-- Zero-JS fallback: <iframe src="${escapeHtmlAttr(defaultAsset)}" width="${width}" height="${height}" style="border:0"></iframe> -->`,
        `  <!-- Cue markers: ${cueList} -->`,
        `  <aside class="notes">`,
        `    Stickman cues: ${cueList}`,
        `  </aside>`,
        `</section>`,
        `<script type="module">`,
        `  import { registerStickmanPlayerElement } from "@vallahrich/stickman-mcp/browser";`,
        `  registerStickmanPlayerElement();`,
        `  const player = document.getElementById("sm-${slug}");`,
        `  const payload = JSON.parse(document.getElementById("sm-${slug}-payload").textContent || "{}");`,
        `  if (player && typeof player.setProgram === "function") {`,
        `    player.dataset.compactPayload = JSON.stringify(payload);`,
        `    player.addEventListener("stickman:marker", (e) => console.debug("stickman:marker", e.detail));`,
        `  }`,
        `  if (typeof Reveal !== "undefined") {`,
        `    Reveal.on("slidechanged", (ev) => {`,
        `      if (ev.currentSlide?.contains(player)) player?.play?.(); else player?.pause?.();`,
        `    });`,
        `  }`,
        `</script>`
      ].join("\n");
    }

    case "slidev": {
      const sceneList = isMovie
        ? programOrMovie.scenes.map((s) => `${s.id} (${formatSeconds(s.startMs)}–${formatSeconds(s.endMs)})`).join(", ")
        : `single scene (${formatSeconds(durationMs)})`;
      return [
        `---`,
        `layout: default`,
        `---`,
        ``,
        `# ${title}`,
        ``,
        `<script setup lang="ts">`,
        `import { onMounted, ref } from "vue";`,
        `import { registerStickmanPlayerElement } from "@vallahrich/stickman-mcp/browser";`,
        ``,
        `const playerRef = ref<HTMLElement | null>(null);`,
        `const compactPayload = ${JSON.stringify(compactPayload)};`,
        ``,
        `onMounted(() => {`,
        `  registerStickmanPlayerElement();`,
        `  if (playerRef.value) {`,
        `    playerRef.value.dataset.compactPayload = JSON.stringify(compactPayload);`,
        `    playerRef.value.addEventListener("stickman:marker", (ev: Event) => {`,
        `      console.debug("stickman:marker", (ev as CustomEvent).detail);`,
        `    });`,
        `  }`,
        `});`,
        `</script>`,
        ``,
        `<stickman-player ref="playerRef"${attrs} />`,
        ``,
        `<!-- Exported HTML/WebM alternative: ${defaultAsset} (${sceneList}) -->`
      ].join("\n");
    }

    case "marp": {
      const cueNotes =
        events.length > 0
          ? events.map((e) => `- ${formatSeconds(e.timeMs)} — ${e.marker} (${e.action})`).join("\n")
          : `- 0.00s — start (${formatSeconds(durationMs)})`;
      return [
        `---`,
        `marp: true`,
        `---`,
        ``,
        `# ${title}`,
        ``,
        `![bg right:46% fit ${title}](${defaultAsset})`,
        ``,
        `<!-- Optional interactive player when building Marp with --html:`,
        `<stickman-player${attrs}></stickman-player>`,
        `<script type="application/json">${payloadJson}</script>`,
        `-->`,
        ``,
        `<!--`,
        `Speaker cues (${width}x${height} @ ${fps}fps, ${formatSeconds(durationMs)}):`,
        cueNotes,
        `-->`
      ].join("\n");
    }

    case "html": {
      return [
        `<figure class="stickman-embed" data-stickman-title="${escapeHtmlAttr(title)}">`,
        `  <stickman-player id="sm-${slug}"${attrs}></stickman-player>`,
        `  <script type="application/json" id="sm-${slug}-payload">${payloadJson}</script>`,
        `  <figcaption>${escapeHtmlAttr(title)} (${formatSeconds(durationMs)})</figcaption>`,
        `</figure>`,
        `<script type="module">`,
        `  import { registerStickmanPlayerElement } from "@vallahrich/stickman-mcp/browser";`,
        `  registerStickmanPlayerElement();`,
        `  const el = document.getElementById("sm-${slug}");`,
        `  const payload = JSON.parse(document.getElementById("sm-${slug}-payload").textContent || "{}");`,
        `  if (el) {`,
        `    el.dataset.compactPayload = JSON.stringify(payload);`,
        `    el.addEventListener("stickman:marker", (e) => console.debug("stickman:marker", e.detail));`,
        `  }`,
        `</script>`,
        `<!-- Zero-JS fallback: <video src="${escapeHtmlAttr(defaultAsset)}" controls playsinline width="${width}" height="${height}"></video> -->`
      ].join("\n");
    }

    case "pptx-notes": {
      const lines: string[] = [
        `# PowerPoint / Keynote Speaker Cues: ${title}`,
        ``,
        `- **Asset**: \`${defaultAsset}\` (${width}x${height} @ ${fps}fps, duration ${formatSeconds(durationMs)})`,
        `- **Insertion**: Insert -> Video -> This Device... (use \`.mp4\` for universal PowerPoint playback, transparent \`.webm\` for web decks, or \`.svg\` for static vector frames).`,
        `- **Playback**: Set Video Format -> Start: Automatically (or In Click Sequence) to sync with speaker cues below.`
      ];
      if (isMovie) {
        lines.push("", "## Scenes");
        for (const scene of programOrMovie.scenes) {
          lines.push(
            `- **S${scene.index + 1} (${scene.id})** ${formatSeconds(scene.startMs)} – ${formatSeconds(scene.endMs)} · backdrop: \`${scene.backdrop}\` · transition: \`${scene.transition.kind}\`${scene.title ? ` — ${scene.title}` : ""}`
          );
        }
      }
      lines.push("", "## Cue Timeline");
      if (events.length === 0) {
        lines.push(`- \`0.00s\` — Play animation through \`${formatSeconds(durationMs)}\`.`);
      } else {
        for (const ev of events) {
          const scenePrefix = "sceneId" in ev && ev.sceneId ? `[${ev.sceneId}] ` : "";
          const actorPrefix = ev.actorId ? `${ev.actorId}:` : "";
          lines.push(`- \`${formatSeconds(ev.timeMs)}\` — ${scenePrefix}${actorPrefix}${ev.action} (\`${ev.marker}\`)`);
        }
      }
      return lines.join("\n");
    }
  }
}
