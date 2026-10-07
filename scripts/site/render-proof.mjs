import fs from "node:fs/promises";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { repo } from "./catalogue.mjs";
import { deckScenes, renderDeckScene } from "./deck-scenes.mjs";

const directory = path.join(repo, "dist", "site", "qa");
await fs.mkdir(directory, { recursive: true });
const options = process.platform === "win32" ? { font: { loadSystemFonts: false, fontFiles: ["segoeui.ttf", "segoeuib.ttf"].map(name => path.join(process.env.WINDIR ?? "C:\\Windows", "Fonts", name)), defaultFontFamily: "Segoe UI" } } : undefined;
if (process.argv.includes("--scenes")) {
  const css = await fs.readFile(path.join(repo, "site", "styles.css"), "utf8");
  const colors = Object.fromEntries([...css.split('html[data-theme="dark"]')[0].matchAll(/--cp-([\w-]+):\s*([^;]+);/gi)].map(m => [m[1], m[2].trim()]));
  for (const [index, scene] of deckScenes.entries()) {
    for (const time of [6000, 14800]) {
      const svg = renderDeckScene(index, time, colors, time === 14800);
      await fs.writeFile(path.join(directory, `scene-${scene.page}-${time}.png`), new Resvg(svg, options).render().asPng());
    }
  }
}
for (const filename of process.argv.slice(2).filter(name => name !== "--scenes")) {
  const payload = JSON.parse(await fs.readFile(filename, "utf8"));
  const render = payload.result.render;
  if (render.slides.length !== 4) throw new Error("Expected four rendered slides");
  const kind = render.widthPx > 1000 ? "after" : "before";
  for (const slide of render.slides) {
    const svgPath = path.join(directory, `${kind}-${slide.index + 1}.svg`);
    await fs.writeFile(svgPath, slide.svg);
    await fs.writeFile(path.join(directory, `${kind}-${slide.index + 1}.png`), new Resvg(slide.svg, options).render().asPng());
  }
}
console.log(directory);
