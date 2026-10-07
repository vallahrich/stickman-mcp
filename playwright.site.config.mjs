import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/site",
  testMatch: "**/*.pw.mjs",
  workers: 1,
  timeout: 30000,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4174",
    browserName: "chromium",
    channel: process.env.STICKMAN_SITE_BROWSER ?? (process.platform === "win32" ? "msedge" : undefined),
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure"
  },
  outputDir: "./dist/site-test-results",
  webServer: {
    command: "node scripts/site/serve.mjs --port 4174",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: false,
    timeout: 15000
  }
});
