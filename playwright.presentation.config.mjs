import { defineConfig } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = fs.realpathSync(path.dirname(fileURLToPath(import.meta.url)));
if (process.env.STICKMAN_PRESENTATION_HTML) {
  const qa = process.env.STICKMAN_PRESENTATION_QA;
  if (!qa) throw new Error("Private presentation checks require STICKMAN_PRESENTATION_QA outside the repository");
  let ancestor = path.resolve(qa);
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const relative = path.relative(repo, fs.realpathSync(ancestor));
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
    throw new Error("Private presentation screenshots and error reports must stay outside the repository");
  }
}

export default defineConfig({
  testDir: "./tests/site",
  testMatch: "**/presentation.pw.mjs",
  workers: 1,
  timeout: process.env.STICKMAN_PRESENTATION_HTML ? 180000 : 60000,
  reporter: "list",
  outputDir: process.env.STICKMAN_PRESENTATION_QA ?? "./dist/presentation-test-results",
  use: {
    browserName: "chromium",
    channel: process.env.STICKMAN_SITE_BROWSER ?? (process.platform === "win32" ? "msedge" : undefined),
    viewport: { width: 1440, height: 1000 },
    trace: "off"
  }
});
