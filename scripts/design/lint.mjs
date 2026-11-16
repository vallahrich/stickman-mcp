import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const WCAG_AA_NORMAL_MIN = 4.5;

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

  if (Object.keys(light).length === 0 || Object.keys(dark).length === 0) {
    throw new Error("DESIGN.md YAML block must define tokens.color.light and tokens.color.dark.");
  }

  return {
    color: { light, dark, blueprintSheet },
    motion: { uiChrome }
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

function checkRequiredSheetCapabilities(cssText, fileLabel, expectedEaseOut) {
  const errors = [];
  const stripped = cssText.replace(/\/\*[\s\S]*?\*\//g, "");
  if (!/\btabular-nums\b/.test(stripped)) {
    errors.push({
      file: fileLabel,
      rule: "require-tabular-nums",
      message: `${fileLabel}: missing font-variant-numeric: tabular-nums.`
    });
  }
  if (!/--cp-ease-out\s*:/.test(stripped)) {
    errors.push({
      file: fileLabel,
      rule: "require-ease-out-token",
      message: `${fileLabel}: missing --cp-ease-out motion token.`
    });
  } else if (expectedEaseOut) {
    const tokens = extractCssThemeTokens(stripped);
    const actual = tokens.light["--cp-ease-out"];
    if (actual !== normalizeCssValue(expectedEaseOut)) {
      errors.push({
        file: fileLabel,
        rule: "ease-out-token-mismatch",
        message: `${fileLabel}: --cp-ease-out "${actual ?? ""}" does not match DESIGN.md "${expectedEaseOut}".`
      });
    }
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
  const renderTsText =
    options.renderTs ?? (await readFile(join(rootDir, "src", "render.ts"), "utf8"));

  const errors = [];
  const spec = parseDesignTokens(designMdText);
  const renderShellCss = extractRenderShellCss(renderTsText);

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

  const contrast = { light: {}, dark: {} };
  const contrastPairs = [
    { id: "textOnBg", fg: "text", bg: "bg", label: "text on bg" },
    { id: "textOnSurface", fg: "text", bg: "surface", label: "text on surface" },
    { id: "accentFgOnAccent", fg: "accent_fg", bg: "accent", label: "accent_fg on accent" }
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
        passesAA: ratio >= WCAG_AA_NORMAL_MIN
      };
      if (ratio < WCAG_AA_NORMAL_MIN) {
        errors.push({
          file: "DESIGN.md",
          rule: "wcag-aa-contrast",
          message: `DESIGN.md (${scheme}): ${pair.label} (${fgHex} on ${bgHex}) contrast ${rounded}:1 is below WCAG 2.1 AA minimum ${WCAG_AA_NORMAL_MIN}:1.`
        });
      }
    }
  }

  const expectedEaseOut = spec.motion.uiChrome.ease_out;
  for (const target of targets) {
    errors.push(...checkRequiredSheetCapabilities(target.css, target.label, expectedEaseOut));
  }

  const cssFilesToCheck = [];
  if (options.extraCssFiles) {
    for (const [label, css] of Object.entries(options.extraCssFiles)) {
      cssFilesToCheck.push({ label, css });
    }
  } else if (options.stylesCss !== undefined) {
    cssFilesToCheck.push({ label: "site/styles.css", css: stylesCssText });
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

  const seenLabels = new Set();
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
      dark: Object.keys(spec.color.dark).length
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
