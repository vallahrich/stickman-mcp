import { compileAnimation, sampleAnimation } from "../../dist/compiler.js";
import { frameGeometry } from "../../dist/render.js";
import { figureMarkup } from "../motions/review-renderer.mjs";

export const deckScenes = [
  { page: 1, title: "Journey to the NIST\nCybersecurity Framework 2.0", kind: "title", subtitle: "Cherilyn Pascoe · NIST CSF Program · February 28, 2023", labels: ["Organizations", "Technology", "Cybersecurity"], summary: "Historical briefing: a journey toward CSF 2.0." },
  { page: 2, title: "Cybersecurity Framework Attributes", kind: "cards", subtitle: "Shared security concepts for IT and digital-service teams", labels: ["Common, accessible language", "Adaptable across technologies", "Risk-based decisions", "International standards", "Many stakeholder perspectives", "Align requirements and priorities"], summary: "The source describes a shared, adaptable, risk-based framework for organizations and technology." },
  { page: 4, title: "CSF Update: Journey to CSF 2.0", kind: "timeline", subtitle: "Community engagement shapes the framework", labels: ["2022 · RFI", "Jun 2022 · Workshop #1", "Jan 2023 · Concept paper", "Feb 2023 · Workshop #2", "Summer 2023 · Draft", "Winter 2024 · CSF 2.0"], summary: "Historical timeline and then-planned milestones from the February 2023 source." },
  { page: 5, title: "CSF 2.0 Concept Paper: Changes", kind: "cards", subtitle: "Six proposed directions in the February 2023 briefing", labels: ["Clarify broad applications", "Connect standards and resources", "Expand implementation guidance", "Emphasize governance", "Supply-chain risk management", "Measurement and assessment"], summary: "Proposed changes from the historical concept paper, not current cybersecurity guidance." }
];
export const beatDurationMs = 2500;
export const sceneDurationMs = beatDurationMs * 6;
const xml = text => String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const positions = [140, 340, 540, 740, 940, 1140];
const programs = new Map();
function programFor(index, colors) {
  const key = `${index}:${colors.text}`;
  if (programs.has(key)) return programs.get(key);
  const scene = deckScenes[index];
  const groundY = scene.kind === "title" ? 625 : 465;
  // Small figures use a uniform host transform, never shortened rig bones.
  const factor = .7;
  const targets = {}, actions = [];
  for (let beat = 0; beat < 6; beat++) {
    const to = positions[beat];
    targets[`stop-${beat}`] = { x: to / factor, y: groundY / factor };
    const aimX = scene.kind === "title" ? [140, 540, 1140][Math.min(2, Math.floor(beat / 2))] : to + 40;
    const aimY = scene.kind === "cards" ? 300 : scene.kind === "timeline" ? groundY - 100 : 515;
    targets[`idea-${beat}`] = { x: aimX / factor, y: aimY / factor };
    if (beat > 0) actions.push({ action: "walk", startMs: beat * beatDurationMs, durationMs: 1800, target: `stop-${beat}` });
    actions.push({ action: "point", startMs: beat * beatDurationMs + (beat ? 1800 : 0), durationMs: beat ? 700 : beatDurationMs, target: `idea-${beat}` });
  }
  const result = compileAnimation({
    version: "stickman.animation/v1", canvas: { width: Math.ceil(1280 / factor), height: Math.ceil(720 / factor), fps: 30 },
    durationMs: sceneDurationMs, actor: { x: positions[0] / factor, groundY: groundY / factor, color: colors.text }, targets, actions
  });
  if (!result.valid || !result.program) throw new Error(`In-slide scene ${index} did not compile: ${JSON.stringify(result.diagnostics)}`);
  const value = { program: result.program, factor, groundY };
  programs.set(key, value);
  return value;
}
function textLines(text, x, y, size, color, weight = 400) {
  return String(text).split("\n").map((line, i) => `<text x="${x}" y="${y + i * size * 1.15}" font-size="${size}" font-weight="${weight}" fill="${color}">${xml(line)}</text>`).join("");
}
function wrapLabel(label, maxLength = 25) {
  const words = label.split(" "), lines = [""];
  for (const word of words) {
    if ((lines.at(-1) + " " + word).trim().length > maxLength) lines.push(word);
    else lines[lines.length - 1] = (lines.at(-1) + " " + word).trim();
  }
  return lines.join("\n");
}
export function renderDeckScene(index, timeMs, colors, still = false) {
  const scene = deckScenes[index];
  if (!scene) throw new Error(`Unknown presentation scene ${index}`);
  const time = Math.min(sceneDurationMs - 1, Math.max(0, timeMs));
  const travelBeat = Math.min(5, Math.floor(time / beatDurationMs));
  const beat = travelBeat > 0 && time % beatDurationMs < 1800 ? travelBeat - 1 : travelBeat;
  const { program, factor, groundY } = programFor(index, colors);
  const frame = sampleAnimation(program, time);
  const active = scene.kind === "title" ? Math.floor(beat / 2) : beat;
  let content = "";
  if (scene.kind === "cards") {
    scene.labels.forEach((label, i) => {
      const x = positions[i] - 90, y = 210;
      const highlight = still || i <= active;
      content += `<rect data-content="${i}" x="${x}" y="${y}" width="180" height="300" rx="10" fill="${highlight ? colors["accent-soft"] : colors.surface}" stroke="${i === active ? colors.accent : colors.border}" stroke-width="${i === active ? 3 : 1}"/>`;
      content += `${textLines(`${i + 1}`, x + 14, y + 30, 17, colors.accent, 700)}<g opacity="${highlight ? 1 : .25}">${textLines(wrapLabel(label, 16), x + 14, y + 65, 17, colors.text, 600)}</g>`;
    });
    content += `<path d="M55 ${groundY}H1225" stroke="${colors.border}" fill="none"/>`;
  } else if (scene.kind === "timeline") {
    content += `<path d="M100 ${groundY}H1180" stroke="${colors.border}" stroke-width="5" fill="none"/><path d="M100 ${groundY}H${Math.max(100, frame.x * factor)}" stroke="${colors.accent}" stroke-width="5" fill="none"/>`;
    scene.labels.forEach((label, i) => {
      const x = positions[i], parts = label.split(" · ");
      content += `<circle cx="${x}" cy="${groundY}" r="9" fill="${i <= active || still ? colors.accent : colors.surface}" stroke="${colors.accent}" stroke-width="3"/>`;
      content += `<g opacity="${i <= active || still ? 1 : 0}">${textLines(parts[0], x - 60, 510, 18, colors.accent, 600)}${textLines(wrapLabel(parts[1]), x - 60, 540, 17, colors.text)}</g>`;
    });
    content += textLines("Community feedback informs an evolving cybersecurity framework.", 55, 250, 25, colors["text-muted"]);
  } else {
    content += `<path d="M100 ${groundY}H1180" stroke="${colors.border}" stroke-width="3" fill="none"/>`;
    scene.labels.forEach((label, i) => {
      const x = [140, 540, 1140][i];
      content += `<circle cx="${x}" cy="570" r="62" fill="${i <= active || still ? colors["accent-soft"] : colors.surface}" stroke="${i === active ? colors.accent : colors.border}" stroke-width="2"/>`;
      content += `<text x="${x}" y="485" text-anchor="middle" font-size="22" fill="${colors.text}">${xml(label)}</text>`;
    });
  }
  const actor = `<g data-actor="inside-slide" transform="scale(${factor})">${figureMarkup(frame, frameGeometry(frame), colors.text)}</g>`;
  const footer = "Source: Cherilyn Pascoe / NIST · Feb 2023 (historical) · Adapted layout + motion · No endorsement";
  const titleY = scene.kind === "title" ? 175 : 88, titleSize = scene.kind === "title" ? 55 : 42;
  const heading = textLines(scene.title, 55, titleY, titleSize, colors.text, 700);
  const subtitleY = scene.kind === "title" ? 345 : 147;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720" data-beat="${beat}" data-actor-x="${(frame.x * factor).toFixed(3)}"><rect width="1280" height="720" fill="${colors.bg}"/><g font-family="Segoe UI,Calibri,sans-serif">${heading}${textLines(scene.subtitle, 55, subtitleY, 23, colors["text-muted"])}${content}${actor}${textLines(footer, 55, 690, 16, colors["text-muted"])}</g></svg>`;
}
