import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { STICKMAN_PLAYER_STYLE } from "../src/browser.js";
import { compileAnimation } from "../src/compiler.js";
import { renderHtml } from "../src/render.js";
// @ts-expect-error Standalone design linter is authored in ESM .mjs.
import { checkAntiSlopCss, contrastRatio, lintDesignSystem, parseDesignTokens, relativeLuminance } from "../scripts/design/lint.mjs";

describe("DESIGN.md token parity, WCAG 2.1 contrast & anti-slop CSS linter", () => {
  it("validates repository DESIGN.md tokens, light/dark WCAG AA contrast (>= 4.5:1), motion polish & anti-slop rules", async () => {
    const report = await lintDesignSystem();
    expect(report.errors).toEqual([]);
    expect(report.valid).toBe(true);
    expect(report.tokenCounts.light).toBeGreaterThanOrEqual(18);
    expect(report.tokenCounts.dark).toBeGreaterThanOrEqual(18);
    expect(report.tokenCounts.blueprintSheet).toBeGreaterThanOrEqual(8);

    for (const scheme of ["light", "dark"] as const) {
      for (const key of [
        "textOnBg",
        "textOnBgElevated",
        "textOnSurface",
        "textOnSurfaceSoft",
        "accentFgOnAccent",
        "textMutedOnSurface"
      ] as const) {
        const entry = report.contrast[scheme][key];
        expect(entry.passesAA, `${scheme}.${key}`).toBe(true);
        expect(entry.ratio, `${scheme}.${key}`).toBeGreaterThanOrEqual(4.5);
      }
    }

    for (const bpKey of ["captionFgOnPanelBg", "captionFgOnSheetBg"] as const) {
      const entry = report.contrast.blueprint[bpKey];
      expect(entry.passesAA, `blueprint.${bpKey}`).toBe(true);
      expect(entry.ratio, `blueprint.${bpKey}`).toBeGreaterThanOrEqual(4.5);
    }

    // Exact WCAG 2.1 luminance sanity anchors
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 6);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 6);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
  });

  it("applies Emil Kowalski easing, fast durations, tabular-nums, layered card shadow, and reduced-motion guards in renderHtml and <stickman-player>", () => {
    const compiled = compileAnimation({
      version: "stickman.animation/v1",
      canvas: { width: 640, height: 360, fps: 30 },
      durationMs: 2000,
      actor: { x: 180, groundY: 290 },
      actions: [{ action: "wave", startMs: 0, durationMs: 1600 }]
    });
    expect(compiled.valid).toBe(true);
    const html = renderHtml(compiled.program!);

    for (const stylesheet of [html, STICKMAN_PLAYER_STYLE]) {
      expect(stylesheet).toContain("--cp-ease-out: cubic-bezier(0.22, 1, 0.36, 1)");
      expect(stylesheet).toContain("--cp-dur-fast: 140ms");
      expect(stylesheet).toContain("--cp-dur-enter: 180ms");
      expect(stylesheet).toContain("--cp-card-shadow: 0 1px 2px rgba(0, 0, 0, 0.04), 0 8px 24px rgba(0, 0, 0, 0.06)");
      expect(stylesheet).toContain("tabular-nums");
      expect(stylesheet).toContain("prefers-reduced-motion: reduce");
      expect(stylesheet).toMatch(/transition:\s*none\s*!important/);
      expect(stylesheet).toMatch(/animation:\s*none\s*!important/);
    }

    // Range scrubber must not animate thumb value updates
    expect(html).not.toMatch(/input\[type="range"\][^{]*\{[^}]*transition:/);
    expect(html).toContain('id="timecode"');
  });

  it("catches token drift, WCAG contrast regressions, missing required rules, and anti-slop CSS violations", async () => {
    const root = process.cwd();
    const designMd = await readFile(resolve(root, "DESIGN.md"), "utf8");
    const stylesCss = await readFile(resolve(root, "site", "styles.css"), "utf8");
    const renderTs = await readFile(resolve(root, "src", "render.ts"), "utf8");

    expect(parseDesignTokens(designMd).motion.uiChrome.ease_out).toBe("cubic-bezier(0.22, 1, 0.36, 1)");

    // 1. Token mismatch & missing capabilities
    const driftedCss = stylesCss
      .replace("--cp-accent: #b11f4b;", "--cp-accent: #ff0055;")
      .replaceAll("tabular-nums", "lining-nums");
    const driftedReport = await lintDesignSystem({
      designMd,
      stylesCss: driftedCss,
      renderTs
    });
    expect(driftedReport.valid).toBe(false);
    expect(driftedReport.errors.map((e: { rule: string }) => e.rule)).toEqual(
      expect.arrayContaining(["design-token-mismatch", "require-tabular-nums"])
    );

    // 2. WCAG contrast failure (#777777 on #999999 < 4.5:1)
    const lowContrastDesign = designMd.replace('accent: "#b11f4b"', 'accent: "#b8b8b8"');
    const lowContrastReport = await lintDesignSystem({
      designMd: lowContrastDesign,
      stylesCss: stylesCss.replace("--cp-accent: #b11f4b;", "--cp-accent: #b8b8b8;"),
      renderTs: renderTs.replace("--cp-accent: #b11f4b;", "--cp-accent: #b8b8b8;")
    });
    expect(lowContrastReport.valid).toBe(false);
    expect(lowContrastReport.errors.map((e: { rule: string }) => e.rule)).toContain("wcag-aa-contrast");

    // 3. Anti-slop violations
    const slopViolations = checkAntiSlopCss(
      `
      @import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap");
      .glass { backdrop-filter: blur(16px); background: linear-gradient(135deg, #8b5cf6, #6366f1); }
      button { outline: none; }
      `,
      "synthetic-slop.css"
    );
    expect(slopViolations.map((v: { rule: string }) => v.rule)).toEqual(
      expect.arrayContaining([
        "no-external-font-or-css-import",
        "no-backdrop-blur",
        "no-purple-indigo-gradient-slop",
        "no-bare-outline-none"
      ])
    );

    // Scoped :focus:not(:focus-visible) paired with a real :focus-visible outline is allowed
    const cleanFocusCss = `
      button:focus:not(:focus-visible) { outline: none; }
      button:focus-visible { outline: 3px solid var(--cp-accent); outline-offset: 4px; }
    `;
    expect(checkAntiSlopCss(cleanFocusCss, "clean-focus.css")).toEqual([]);
  });

  it("enforces DESIGN.md prose sections, YAML schema groups, blueprint_sheet parity across storyboard/render, and dialog/presentation motion rules", async () => {
    const root = process.cwd();
    const designMd = await readFile(resolve(root, "DESIGN.md"), "utf8");
    const stylesCss = await readFile(resolve(root, "site", "styles.css"), "utf8");
    const presentationCss = await readFile(resolve(root, "site", "presentation", "presentation.css"), "utf8");
    const storyboardTs = await readFile(resolve(root, "src", "storyboard.ts"), "utf8");
    const renderTs = await readFile(resolve(root, "src", "render.ts"), "utf8");
    const browserTs = await readFile(resolve(root, "src", "browser.ts"), "utf8");

    // Dialog enter keyframes & backdrop fade + reduced-motion guard in both site & presentation stylesheets
    for (const css of [stylesCss, presentationCss]) {
      expect(css).toContain("@keyframes cp-dialog-enter");
      expect(css).toContain("translateY(4px)");
      expect(css).toContain("dialog[open]");
      expect(css).toContain("dialog[open]::backdrop");
      expect(css).toContain("prefers-reduced-motion");
    }

    // 1. Missing required DESIGN.md prose section (## 3.) & missing YAML schema group (tokens.geometry)
    const missingSectionAndGroup = designMd
      .replace("## 3. Blueprint, Datum & Contact-Sheet Conventions", "### Unnumbered Subsection")
      .replace(/  geometry:\r?\n[\s\S]*?(?=  motion:)/, "");
    const sectionReport = await lintDesignSystem({ designMd: missingSectionAndGroup });
    expect(sectionReport.valid).toBe(false);
    expect(sectionReport.errors.map((e: { rule: string }) => e.rule)).toEqual(
      expect.arrayContaining(["missing-design-section", "missing-yaml-group"])
    );

    // 2. Blueprint token drift in src/storyboard.ts & src/render.ts
    const driftedStoryboard = storyboardTs.replace('<rect width="100%" height="100%" fill="#f1f5f9"/>', '<rect width="100%" height="100%" fill="#ffffff"/>');
    const driftedRender = renderTs.replace('stroke="#cbd5e1" stroke-width="1"/>', 'stroke="#94a3b8" stroke-width="1"/>');
    const bpDriftReport = await lintDesignSystem({
      storyboardTs: driftedStoryboard,
      renderTs: driftedRender
    });
    expect(bpDriftReport.valid).toBe(false);
    const bpErrors = bpDriftReport.errors.filter((e: { rule: string }) => e.rule === "blueprint-token-mismatch");
    expect(bpErrors.map((e: { file: string }) => e.file)).toEqual(
      expect.arrayContaining(["src/storyboard.ts", "src/render.ts"])
    );

    // 3. Missing motion timing or tabular-nums in site/presentation/presentation.css & src/browser.ts
    const brokenPresentationCss = presentationCss.replaceAll("180ms", "450ms");
    const brokenBrowserTs = browserTs.replaceAll("tabular-nums", "normal");
    const motionReport = await lintDesignSystem({
      presentationCss: brokenPresentationCss,
      browserTs: brokenBrowserTs
    });
    expect(motionReport.valid).toBe(false);
    expect(motionReport.errors.map((e: { rule: string }) => e.rule)).toEqual(
      expect.arrayContaining(["require-motion-duration-enter", "require-tabular-nums"])
    );
  });
});
