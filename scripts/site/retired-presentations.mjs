import fs from "node:fs/promises";
import path from "node:path";

export const retiredPresentationAssets = [
  "demo/nist-original.pptx", "demo/nist-with-stickman.pptx", "demo/nist-original.pdf",
  "demo/nasa-original.pptx", "demo/comparison.json", "demo/source-pages.json",
  "demo/inspect-magnifier.gif", "demo/point.gif", "demo/present.gif",
  ...[1, 2, 4, 5].flatMap(page => [
    `demo/enhanced-${page}.svg`, `demo/in-slide-${page}.gif`,
    `demo/scene-${page}.html`, `demo/source-${page}.png`
  ]),
  "showcase.mp4", "showcase.vtt", "showcase-manifest.json"
];

export async function removeRetiredPresentationAssets(output) {
  for (const asset of retiredPresentationAssets) {
    await fs.rm(path.join(output, ...asset.split("/")), { force: true });
  }
}
