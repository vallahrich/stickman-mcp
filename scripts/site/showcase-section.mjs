import fs from "node:fs/promises";
import path from "node:path";
import { videoRecipes, xml } from "./story-films.mjs";

export async function showcaseSection(output) {
  let manifest;
  try { manifest = JSON.parse(await fs.readFile(path.join(output, "showcase", "manifest.json"), "utf8")); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    return '<section class="section" id="showcase"><h2>One slide. Two animated stories.</h2><p class="quiet">Local showcase assets have not been generated. Run site:showcase with the reviewed on-premises-to-cloud HTML, then rebuild the site.</p></section>';
  }
  if (manifest.slide?.src !== "on-prem-to-cloud.html" || manifest.videos?.length !== 2 ||
      ![manifest.slide, ...manifest.videos].every(item => Number.isFinite(item.seconds) && item.seconds > 0 && item.seconds <= 60) ||
      !manifest.videos.every((video, index) => video.id === videoRecipes[index].id &&
        video.src === `${video.id}.mp4` && video.poster === `${video.id}.png` && video.captions === `${video.id}.vtt`)) {
    throw new Error("Showcase must contain the cloud slide and exactly two known videos, each at most 60 seconds.");
  }
  for (const asset of [manifest.slide.src, ...manifest.videos.flatMap(video => [video.src, video.poster, video.captions])]) {
    await fs.access(path.join(output, "showcase", asset));
  }
  return `<section class="section" id="showcase">
    <div class="section-heading"><div><p class="eyebrow">Three short examples</p><h2>One slide. Two animated stories.</h2></div><p class="quiet">Each item is under one minute. Playback is your choice.</p></div>
    <article class="showcase-slide"><h3>On-premises to cloud · ${manifest.slide.seconds}s</h3>
      <p class="quiet">Compare the options, examine the evidence and plan a pilot. All numbers are illustrative.</p>
      <iframe id="cloudSlide" src="showcase/on-prem-to-cloud.html?paused=1" title="On-premises-to-cloud slide with playback controls" loading="lazy"></iframe>
      <p><a href="showcase/on-prem-to-cloud.html?paused=1" target="_blank" rel="noopener">Open the slide at full size</a></p>
    </article>
    <div class="showcase-videos">${manifest.videos.map((video, index) => `<article><h3>${xml(videoRecipes[index].title)} · ${Math.ceil(video.seconds)}s</h3>
      <video controls preload="metadata" poster="showcase/${video.poster}?v=${xml(video.sha256 ?? "local")}" aria-label="${xml(videoRecipes[index].title)} animated story">
        <source src="showcase/${video.src}?v=${xml(video.sha256 ?? "local")}" type="video/mp4"><track kind="captions" src="showcase/${video.captions}?v=${xml(video.sha256 ?? "local")}" srclang="en" label="English">
      </video><p class="quiet">${xml(videoRecipes[index].summary)} Current reviewed motions, full-frame scenes and short on-screen text. No audio track.</p>
    </article>`).join("")}</div>
  </section>`;
}
