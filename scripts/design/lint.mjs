import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const WCAG_AA_NORMAL_MIN = 4.5;

export const REQUIRED_PROSE_SECTIONS = Object.freeze(["## 1.", "## 2.", "## 3.", "## 4."]);

export const REQUIRED_YAML_GROUPS = Object.freeze([
  "tokens.color.light",
  "tokens.color.dark",
  "tokens.color.blueprint_sheet",
  "tokens.typography",
  "tokens.geometry",
  "tokens.motion"
]);

export const REQUIRED_BLUEPRINT_SHEET_TOKENS = Object.freeze([
  "sheet_bg",
  "panel_bg",
  "panel_border",
  "divider",
  "ground_datum",
  "caption_fg"
]);

function stripInlineYamlComment(raw) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "#" && !inSingle && !inDouble && (i === 0 || /\s/.test(raw[i - 1]))) {
      return raw.slice(0, i).trim();
    }
  }
  return raw.trim();
}

function unquoteYamlScalar(value) {
  const trimmed = stripInlineYamlComment(value);
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseDesignTokens(markdownText) {
  const match = /```yaml\r?\n([\s\S]*?)```/.exec(markdownText);
  if (!match) {
    throw new Error("DESIGN.md is missing its fenced ```yaml token specification block.");
  }
  const lines = match[1].split(/\r?\n/);
  const stack = [];
  const sections = new Map();

  for (const rawLine of lines) {
    if (!rawLine.trim() || rawLine.trim().startsWith("#")) continue;
    const indent = rawLine.match(/^ */)[0].length;
    const content = rawLine.trim();
    const colonIdx = content.indexOf(":");
    if (colonIdx < 0) continue;

    const key = content.slice(0, colonIdx).trim();
    const rest = stripInlineYamlComment(content.slice(colonIdx + 1));

    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    if (rest === "") {
      stack.push({ indent, key });
      continue;
    }

    const sectionPath = stack.map((item) => item.key).join(".");
    let bucket = sections.get(sectionPath);
    if (!bucket) {
      bucket = {};
      sections.set(sectionPath, bucket);
    }
    bucket[key] = unquoteYamlScalar(rest);
  }

  const light = sections.get("tokens.color.light") ?? {};
  const dark = sections.get("tokens.color.dark") ?? {};
  const blueprintSheet = sections.get("tokens.color.blueprint_sheet") ?? {};
  const uiChrome = sections.get("tokens.motion.ui_chrome") ?? {};
  const sectionPaths = [...sections.keys()].filter((p) => Object.keys(sections.get(p) ?? {}).length > 0);

  return {
    color: { light, dark, blueprintSheet },
    motion: { uiChrome },
    sectionPaths
  };
}

function normalizeCssValue(value) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function extractBlockBody(cssText, selectorPattern) {
  const match = selectorPattern.exec(cssText);
  if (!match) return "";
  const openBrace = cssText.indexOf("{", match.index);
  if (openBrace < 0) return "";
  let depth = 0;
  for (let i = openBrace; i < cssText.length; i++) {
    if (cssText[i] === "{") depth++;
    else if (cssText[i] === "}") {
      depth--;
      if (depth === 0) return cssText.slice(openBrace + 1, i);
    }
  }
  return "";
}

function parseCustomProperties(blockBody) {
  const props = {};
  const propRe = /(--cp-[a-z0-9-]+)\s*:\s*([^;{}]+);?/gi;
  let match;
  while ((match = propRe.exec(blockBody)) !== null) {
    props[match[1].toLowerCase()] = normalizeCssValue(match[2]);
  }
  return props;
}

export function extractCssThemeTokens(cssText) {
  const stripped = cssText.replace(/\/\*[\s\S]*?\*\//g, "");
  const lightBody = extractBlockBody(stripped, /:root\s*\{/);
  const darkBody = extractBlockBody(stripped, /html\[data-theme=["']?dark["']?\]\s*\{/);
  return {
    light: parseCustomProperties(lightBody),
    dark: parseCustomProperties(darkBody)
  };
}

export function extractRenderShellCss(renderTsText) {
  const match = /const\s+HTML_SHELL_STYLE\s*=\s*`([\s\S]*?)`;/.exec(renderTsText);
  if (!match) {
    throw new Error("Could not locate HTML_SHELL_STYLE template in src/render.ts.");
  }
  return match[1];
}

export function extractBrowserPlayerCss(browserTsText) {
  const match = /export\s+const\s+STICKMAN_PLAYER_STYLE\s*=\s*`([\s\S]*?)`;/.exec(browserTsText);
  if (!match) {
    throw new Error("Could not locate STICKMAN_PLAYER_STYLE template in src/browser.ts.");
  }
  return match[1];
}

export function extractStoryboardBlueprintTokens(storyboardTsText) {
  return {
    sheet_bg:
      /rx="5"\/><\/clipPath><style>\$\{style\}<\/style><\/defs>`\s*\+\s*`<rect width="100%" height="100%" fill="(#[0-9a-fA-F]{3,6})"\/>/.exec(
        storyboardTsText
      )?.[1]?.toLowerCase() ?? undefined,
    panel_bg:
      /<rect width="\$\{panelW\}" height="\$\{panelH\}" rx="6" fill="(#[0-9a-fA-F]{3,6})"/.exec(
        storyboardTsText
      )?.[1]?.toLowerCase() ?? undefined,
    panel_border:
      /<rect width="\$\{panelW\}" height="\$\{panelH\}" rx="6" fill="#[0-9a-fA-F]{3,6}" stroke="(#[0-9a-fA-F]{3,6})"\/>/.exec(
        storyboardTsText
      )?.[1]?.toLowerCase() ?? undefined,
    divider:
      /<line x1="0" y1="\$\{sceneH\}" x2="\$\{panelW\}" y2="\$\{sceneH\}" stroke="(#[0-9a-fA-F]{3,6})"\/>/.exec(
        storyboardTsText
      )?.[1]?.toLowerCase() ?? undefined,
    ground_datum:
      /<path d="M0 \$\{num\(frame\.groundY, 0\)\}H\$\{canvas\.width\}" stroke="(#[0-9a-fA-F]{3,6})"/.exec(
        storyboardTsText
      )?.[1]?.toLowerCase() ?? undefined,
    caption_fg:
      /\.sb-l\{[^}]*fill:(#[0-9a-fA-F]{3,6})\}/.exec(storyboardTsText)?.[1]?.toLowerCase() ?? undefined
  };
}

export function extractRenderBlueprintTokens(renderTsText) {
  return {
    panel_bg:
      /`<rect width="100%" height="100%" fill="(#[0-9a-fA-F]{3,6})"\/>`\s*\+\s*`<rect width="100%" height="100%" fill="url\(#sm-bp-grid\)"\/>/.exec(
        renderTsText
      )?.[1]?.toLowerCase() ?? undefined,
    panel_border:
      /<rect x="1\.5" y="1\.5"[^`]*?fill="none" stroke="(#[0-9a-fA-F]{3,6})" stroke-width="1"\/>/.exec(
        renderTsText
      )?.[1]?.toLowerCase() ?? undefined,
    ground_datum:
      /<path id="ground" d="M0 \$\{number\(frame\.groundY\)\}H\$\{width\}" stroke="(#[0-9a-fA-F]{3,6})" stroke-width="1"\/>/.exec(
        renderTsText
      )?.[1]?.toLowerCase() ?? undefined,
    caption_fg:
      /\.bp-ax\{[^}]*fill:(#[0-9a-fA-F]{3,6});/.exec(renderTsText)?.[1]?.toLowerCase() ?? undefined
  };
}

export function parseHexRgb(hex) {
  const cleaned = hex.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(cleaned)) {
    return {
      r: parseInt(cleaned[1] + cleaned[1], 16),
      g: parseInt(cleaned[2] + cleaned[2], 16),
      b: parseInt(cleaned[3] + cleaned[3], 16)
    };
  }
  if (/^#[0-9a-f]{6}$/.test(cleaned)) {
    return {
      r: parseInt(cleaned.slice(1, 3), 16),
      g: parseInt(cleaned.slice(3, 5), 16),
      b: parseInt(cleaned.slice(5, 7), 16)
    };
  }
  throw new Error(`Expected 3- or 6-digit hex color, received "${hex}".`);
}

export function relativeLuminance(hex) {
  const { r, g, b } = parseHexRgb(hex);
  const linearize = (channel) => {
    const s = channel / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

export function contrastRatio(hexA, hexB) {
  const lumA = relativeLuminance(hexA);
  const lumB = relativeLuminance(hexB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

function rgbToHsl(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: h * 60, s, l };
}

function isNeonPurpleIndigoHex(hex) {
  try {
    const { r, g, b } = parseHexRgb(hex);
    const { h, s, l } = rgbToHsl(r, g, b);
    return h >= 235 && h <= 305 && s >= 0.42 && l >= 0.2 && l <= 0.85;
  } catch {
    return false;
  }
}

export function checkAntiSlopCss(cssText, fileLabel) {
  const violations = [];
  const stripped = cssText.replace(/\/\*[\s\S]*?\*\//g, "");

  if (
    /@import\s+(?:url\(\s*)?["']?(?:https?:)?\/\//i.test(stripped) ||
    /fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(stripped)
  ) {
    violations.push({
      file: fileLabel,
      rule: "no-external-font-or-css-import",
      message: `${fileLabel}: external @import URL or Google Fonts CDN reference is forbidden.`
    });
  }

  if (/(?:-webkit-)?backdrop-filter\s*:\s*[^;{}]*\bblur\s*\(/i.test(stripped)) {
    violations.push({
      file: fileLabel,
      rule: "no-backdrop-blur",
      message: `${fileLabel}: glassmorphic backdrop-filter blur is forbidden.`
    });
  }

  const gradientRe = /(?:linear|radial|conic)-gradient\s*\(([^)]*)\)/gi;
  let gradMatch;
  while ((gradMatch = gradientRe.exec(stripped)) !== null) {
    const body = gradMatch[1];
    const namedPurpleIndigo = /\b(?:purple|indigo|violet|blueviolet|darkviolet|mediumpurple|rebeccapurple|magenta|fuchsia)\b/i.test(
      body
    );
    const hexMatches = body.match(/#[0-9a-fA-F]{3,6}\b/g) ?? [];
    const hslPurple = /hsla?\(\s*(2[3-9]\d|30[0-5])\b/i.test(body);
    if (namedPurpleIndigo || hslPurple || hexMatches.some(isNeonPurpleIndigoHex)) {
      violations.push({
        file: fileLabel,
        rule: "no-purple-indigo-gradient-slop",
        message: `${fileLabel}: neon purple/indigo gradient slop is forbidden.`
      });
      break;
    }
  }

  const hasVisibleFocusRule = /:focus-visible\s*\{[^}]*\boutline\s*:\s*(?!none\b|0(?:px)?\b)[^;{}]+/i.test(
    stripped
  );
  const ruleBlockRe = /([^{}]+)\{([^{}]*)\}/g;
  let ruleMatch;
  while ((ruleMatch = ruleBlockRe.exec(stripped)) !== null) {
    const selector = ruleMatch[1].trim();
    const body = ruleMatch[2];
    if (selector.startsWith("@")) continue;
    if (/\boutline\s*:\s*(?:none|0(?:px)?)\s*(?:!important)?\s*(?:;|$)/i.test(body)) {
      const scopedNotFocusVisible =
        selector.includes(":not(:focus-visible)") && !selector.startsWith(":focus-visible");
      if (!hasVisibleFocusRule || !scopedNotFocusVisible) {
        violations.push({
          file: fileLabel,
          rule: "no-bare-outline-none",
          message: `${fileLabel}: bare "outline: none" / "outline: 0" without :focus-visible protection is forbidden (selector: "${selector}").`
        });
      }
    }
  }

  return violations;
}

function checkRequiredSheetCapabilities(cssText, fileLabel, motionUiChrome, { requireRootEaseToken = true } = {}) {
  const errors = [];
  const stripped = cssText.replace(/\/\*[\s\S]*?\*\//g, "");
  const normalizedStripped = normalizeCssValue(stripped);
  const expectedEaseOut = motionUiChrome?.ease_out ?? "cubic-bezier(0.22, 1, 0.36, 1)";
  const fastMs = `${motionUiChrome?.press_hover_ms ?? "140"}ms`;
  const enterMs = `${motionUiChrome?.popover_dialog_enter_ms ?? "180"}ms`;

  if (!/\btabular-nums\b/.test(stripped)) {
    errors.push({
      file: fileLabel,
      rule: "require-tabular-nums",
      message: `${fileLabel}: missing font-variant-numeric: tabular-nums.`
    });
  }

  if (!new RegExp(`\\b${fastMs}\\b`, "i").test(stripped)) {
    errors.push({
      file: fileLabel,
      rule: "require-motion-duration-fast",
      message: `${fileLabel}: missing fast UI motion timing (${fastMs}).`
    });
  }

  if (!new RegExp(`\\b${enterMs}\\b`, "i").test(stripped)) {
    errors.push({
      file: fileLabel,
      rule: "require-motion-duration-enter",
      message: `${fileLabel}: missing enter motion timing (${enterMs}).`
    });
  }

  if (requireRootEaseToken) {
    if (!/--cp-ease-out\s*:/.test(stripped)) {
      errors.push({
        file: fileLabel,
        rule: "require-ease-out-token",
        message: `${fileLabel}: missing --cp-ease-out motion token.`
      });
    } else if (expectedEaseOut) {
      const tokens = extractCssThemeTokens(stripped);
      const actual = tokens.light["--cp-ease-out"];
      if (actual && actual !== normalizeCssValue(expectedEaseOut)) {
        errors.push({
          file: fileLabel,
          rule: "ease-out-token-mismatch",
          message: `${fileLabel}: --cp-ease-out "${actual}" does not match DESIGN.md "${expectedEaseOut}".`
        });
      } else if (!normalizedStripped.includes(normalizeCssValue(expectedEaseOut))) {
        errors.push({
          file: fileLabel,
          rule: "ease-out-token-mismatch",
          message: `${fileLabel}: easing curve does not match DESIGN.md "${expectedEaseOut}".`
        });
      }
    }
  } else if (!normalizedStripped.includes(normalizeCssValue(expectedEaseOut))) {
    errors.push({
      file: fileLabel,
      rule: "require-ease-out-curve",
      message: `${fileLabel}: missing easing curve "${expectedEaseOut}".`
    });
  }

  if (!/:focus-visible\b/.test(stripped)) {
    errors.push({
      file: fileLabel,
      rule: "require-focus-visible",
      message: `${fileLabel}: missing :focus-visible focus indicator rule.`
    });
  }
  if (!/@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/i.test(stripped)) {
    errors.push({
      file: fileLabel,
      rule: "require-prefers-reduced-motion",
      message: `${fileLabel}: missing @media (prefers-reduced-motion: reduce) guard.`
    });
  }
  return errors;
}

function checkDesignMdProseAndSchema(designMdText, spec) {
  const errors = [];
  const proseOnly = designMdText.replace(/```[\s\S]*?```/g, "");
  for (let n = 1; n <= 4; n++) {
    const headingRe = new RegExp(`^##\\s+${n}\\.\\s+\\S+`, "m");
    if (!headingRe.test(proseOnly)) {
      errors.push({
        file: "DESIGN.md",
        rule: "missing-design-section",
        message: `DESIGN.md: missing required prose section "## ${n}."`
      });
    }
  }

  for (const group of REQUIRED_YAML_GROUPS) {
    const present = spec.sectionPaths.some((p) => p === group || p.startsWith(`${group}.`));
    if (!present) {
      errors.push({
        file: "DESIGN.md",
        rule: "missing-yaml-group",
        message: `DESIGN.md: missing required YAML schema group "${group}".`
      });
    }
  }

  return errors;
}

function checkBlueprintTokenParity(spec, storyboardTsText, renderTsText) {
  const errors = [];
  const expectedMap = spec.color.blueprintSheet ?? {};
  const storyboardActuals = extractStoryboardBlueprintTokens(storyboardTsText);
  const renderActuals = extractRenderBlueprintTokens(renderTsText);

  for (const tokenKey of REQUIRED_BLUEPRINT_SHEET_TOKENS) {
    const expectedRaw = expectedMap[tokenKey];
    if (!expectedRaw) {
      errors.push({
        file: "DESIGN.md",
        rule: "missing-blueprint-token",
        message: `DESIGN.md (blueprint_sheet): missing required token "${tokenKey}".`
      });
      continue;
    }
    const expected = normalizeCssValue(expectedRaw);

    const sbActual = storyboardActuals[tokenKey];
    if (!sbActual) {
      errors.push({
        file: "src/storyboard.ts",
        rule: "missing-blueprint-token",
        message: `src/storyboard.ts: could not verify blueprint_sheet token "${tokenKey}" (expected ${expected}).`
      });
    } else if (sbActual !== expected) {
      errors.push({
        file: "src/storyboard.ts",
        rule: "blueprint-token-mismatch",
        message: `src/storyboard.ts: blueprint_sheet "${tokenKey}" is "${sbActual}", expected "${expected}" from DESIGN.md.`
      });
    }

    if (Object.prototype.hasOwnProperty.call(renderActuals, tokenKey)) {
      const renderActual = renderActuals[tokenKey];
      if (!renderActual) {
        errors.push({
          file: "src/render.ts",
          rule: "missing-blueprint-token",
          message: `src/render.ts: could not verify blueprint_sheet token "${tokenKey}" (expected ${expected}).`
        });
      } else if (renderActual !== expected) {
        errors.push({
          file: "src/render.ts",
          rule: "blueprint-token-mismatch",
          message: `src/render.ts: blueprint_sheet "${tokenKey}" is "${renderActual}", expected "${expected}" from DESIGN.md.`
        });
      }
    }
  }

  return errors;
}

async function listCssFilesRecursive(dir, rootDir) {
  const results = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await listCssFilesRecursive(full, rootDir)));
    } else if (entry.isFile() && entry.name.endsWith(".css")) {
      results.push({
        path: relative(rootDir, full).replaceAll("\\", "/"),
        fullPath: full
      });
    }
  }
  return results.sort((a, b) => a.path.localeCompare(b.path));
}

export async function lintDesignSystem(options = {}) {
  const rootDir = resolve(
    options.rootDir ?? fileURLToPath(new URL("../../", import.meta.url))
  );
  const designMdText =
    options.designMd ?? (await readFile(join(rootDir, "DESIGN.md"), "utf8"));
  const stylesCssText =
    options.stylesCss ?? (await readFile(join(rootDir, "site", "styles.css"), "utf8"));
  const presentationCssText =
    options.presentationCss ??
    (await readFile(join(rootDir, "site", "presentation", "presentation.css"), "utf8"));
  const renderTsText =
    options.renderTs ?? (await readFile(join(rootDir, "src", "render.ts"), "utf8"));
  const storyboardTsText =
    options.storyboardTs ?? (await readFile(join(rootDir, "src", "storyboard.ts"), "utf8"));
  const browserTsText =
    options.browserTs ?? (await readFile(join(rootDir, "src", "browser.ts"), "utf8"));

  const errors = [];
  const spec = parseDesignTokens(designMdText);
  errors.push(...checkDesignMdProseAndSchema(designMdText, spec));
  errors.push(...checkBlueprintTokenParity(spec, storyboardTsText, renderTsText));

  const renderShellCss = extractRenderShellCss(renderTsText);
  const browserPlayerCss = extractBrowserPlayerCss(browserTsText);

  const targets = [
    { label: "site/styles.css", tokens: extractCssThemeTokens(stylesCssText), css: stylesCssText },
    { label: "src/render.ts#HTML_SHELL_STYLE", tokens: extractCssThemeTokens(renderShellCss), css: renderShellCss }
  ];

  for (const scheme of ["light", "dark"]) {
    const expectedMap = spec.color[scheme];
    for (const [tokenKey, expectedRaw] of Object.entries(expectedMap)) {
      const cssVar = `--cp-${tokenKey.replaceAll("_", "-")}`;
      const expected = normalizeCssValue(expectedRaw);
      for (const target of targets) {
        const actual = target.tokens[scheme][cssVar];
        if (actual === undefined) {
          errors.push({
            file: target.label,
            rule: "missing-design-token",
            message: `${target.label} (${scheme}): missing token ${cssVar} (expected ${expected}).`
          });
        } else if (actual !== expected) {
          errors.push({
            file: target.label,
            rule: "design-token-mismatch",
            message: `${target.label} (${scheme}): ${cssVar} is "${actual}", expected "${expected}" from DESIGN.md.`
          });
        }
      }
    }
  }

  const contrast = { light: {}, dark: {}, blueprint: {} };
  const contrastPairs = [
    { id: "textOnBg", fg: "text", bg: "bg", label: "text on bg", min: WCAG_AA_NORMAL_MIN },
    { id: "textOnBgElevated", fg: "text", bg: "bg_elevated", label: "text on bg_elevated", min: WCAG_AA_NORMAL_MIN },
    { id: "textOnSurface", fg: "text", bg: "surface", label: "text on surface", min: WCAG_AA_NORMAL_MIN },
    { id: "textOnSurfaceSoft", fg: "text", bg: "surface_soft", label: "text on surface_soft", min: WCAG_AA_NORMAL_MIN },
    { id: "accentFgOnAccent", fg: "accent_fg", bg: "accent", label: "accent_fg on accent", min: WCAG_AA_NORMAL_MIN },
    { id: "textMutedOnSurface", fg: "text_muted", bg: "surface", label: "text_muted on surface", min: WCAG_AA_NORMAL_MIN }
  ];

  for (const scheme of ["light", "dark"]) {
    const palette = spec.color[scheme];
    for (const pair of contrastPairs) {
      const fgHex = palette[pair.fg];
      const bgHex = palette[pair.bg];
      if (!fgHex || !bgHex) {
        errors.push({
          file: "DESIGN.md",
          rule: "missing-contrast-token",
          message: `DESIGN.md (${scheme}): missing ${pair.fg} or ${pair.bg} hex token for WCAG contrast check.`
        });
        continue;
      }
      const ratio = contrastRatio(fgHex, bgHex);
      const rounded = Number(ratio.toFixed(2));
      contrast[scheme][pair.id] = {
        foreground: fgHex,
        background: bgHex,
        ratio: rounded,
        passesAA: ratio >= pair.min
      };
      if (ratio < pair.min) {
        errors.push({
          file: "DESIGN.md",
          rule: "wcag-aa-contrast",
          message: `DESIGN.md (${scheme}): ${pair.label} (${fgHex} on ${bgHex}) contrast ${rounded}:1 is below WCAG 2.1 AA minimum ${pair.min}:1.`
        });
      }
    }
  }

  const blueprintContrastPairs = [
    { id: "captionFgOnPanelBg", fg: "caption_fg", bg: "panel_bg", label: "blueprint caption_fg on panel_bg", min: WCAG_AA_NORMAL_MIN },
    { id: "captionFgOnSheetBg", fg: "caption_fg", bg: "sheet_bg", label: "blueprint caption_fg on sheet_bg", min: WCAG_AA_NORMAL_MIN }
  ];
  for (const pair of blueprintContrastPairs) {
    const fgHex = spec.color.blueprintSheet[pair.fg];
    const bgHex = spec.color.blueprintSheet[pair.bg];
    if (!fgHex || !bgHex) {
      errors.push({
        file: "DESIGN.md",
        rule: "missing-contrast-token",
        message: `DESIGN.md (blueprint_sheet): missing ${pair.fg} or ${pair.bg} hex token for WCAG contrast check.`
      });
      continue;
    }
    const ratio = contrastRatio(fgHex, bgHex);
    const rounded = Number(ratio.toFixed(2));
    contrast.blueprint[pair.id] = {
      foreground: fgHex,
      background: bgHex,
      ratio: rounded,
      passesAA: ratio >= pair.min
    };
    if (ratio < pair.min) {
      errors.push({
        file: "DESIGN.md",
        rule: "wcag-aa-contrast",
        message: `DESIGN.md (blueprint_sheet): ${pair.label} (${fgHex} on ${bgHex}) contrast ${rounded}:1 is below WCAG 2.1 AA minimum ${pair.min}:1.`
      });
    }
  }

  const capabilityTargets = [
    { label: "site/styles.css", css: stylesCssText, requireRootEaseToken: true },
    { label: "site/presentation/presentation.css", css: presentationCssText, requireRootEaseToken: false },
    { label: "src/render.ts#HTML_SHELL_STYLE", css: renderShellCss, requireRootEaseToken: true },
    { label: "src/browser.ts#STICKMAN_PLAYER_STYLE", css: browserPlayerCss, requireRootEaseToken: true }
  ];
  for (const surface of capabilityTargets) {
    errors.push(
      ...checkRequiredSheetCapabilities(surface.css, surface.label, spec.motion.uiChrome, {
        requireRootEaseToken: surface.requireRootEaseToken
      })
    );
  }

  const cssFilesToCheck = [];
  if (options.extraCssFiles) {
    for (const [label, css] of Object.entries(options.extraCssFiles)) {
      cssFilesToCheck.push({ label, css });
    }
  } else if (options.stylesCss !== undefined || options.presentationCss !== undefined) {
    cssFilesToCheck.push({ label: "site/styles.css", css: stylesCssText });
    cssFilesToCheck.push({ label: "site/presentation/presentation.css", css: presentationCssText });
  } else {
    const discovered = await listCssFilesRecursive(join(rootDir, "site"), rootDir);
    for (const entry of discovered) {
      cssFilesToCheck.push({
        label: entry.path,
        css: await readFile(entry.fullPath, "utf8")
      });
    }
  }
  cssFilesToCheck.push({ label: "src/render.ts#HTML_SHELL_STYLE", css: renderShellCss });
  cssFilesToCheck.push({ label: "src/browser.ts#STICKMAN_PLAYER_STYLE", css: browserPlayerCss });

  const seenLabels = new Set(["src/storyboard.ts"]);
  for (const item of cssFilesToCheck) {
    seenLabels.add(item.label);
    errors.push(...checkAntiSlopCss(item.css, item.label));
  }

  return {
    valid: errors.length === 0,
    errors,
    contrast,
    checkedFiles: ["DESIGN.md", ...seenLabels],
    tokenCounts: {
      light: Object.keys(spec.color.light).length,
      dark: Object.keys(spec.color.dark).length,
      blueprintSheet: Object.keys(spec.color.blueprintSheet).length
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  lintDesignSystem()
    .then((report) => {
      if (!report.valid) {
        console.error(JSON.stringify(report, null, 2));
        process.exitCode = 1;
        return;
      }
      console.log(JSON.stringify(report, null, 2));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
