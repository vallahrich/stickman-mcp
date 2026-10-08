import { xml, scroll, tick, packageBox, bubble } from "../site/story-films.mjs";

export const overlayTypes = ["text", "bubble", "scroll", "card", "tick", "package-box", "rect-plate", "label"];
const ease = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
export function renderOverlays(overlays, frame, colors) {
  return overlays.map(o => {
    if (frame < o.from || frame >= o.to) return "";
    const fade = o.fade ?? 12;
    const opacity = fade ? ease((frame - o.from) / fade) * ease((o.to - frame) / fade) : 1;
    const progress = ease((frame - o.from) / (o.to - o.from));
    const x = o.x + ((o.tween?.x ?? o.x) - o.x) * progress;
    const y = o.y + ((o.tween?.y ?? o.y) - o.y) * progress;
    const scale = (o.scale ?? 1) + ((o.tween?.scale ?? o.scale ?? 1) - (o.scale ?? 1)) * progress;
    const label = `<text x="0" y="0" font-size="${o.size ?? 30}" font-weight="700" fill="${colors.text}">${xml(o.text ?? "")}</text>`;
    let body;
    switch (o.type) {
      case "text": case "label": body = label; break;
      case "bubble": body = bubble(0, 0, o.width ?? 300, o.text ?? "", o.second ?? "", colors); break;
      case "scroll": case "card": body = scroll(0, 0, o.text ?? "", colors, o.width ?? 300); break;
      case "tick": body = tick(0, 0, colors); break;
      case "package-box": body = packageBox(0, 0, colors, o.text ?? "v1.1"); break;
      case "rect-plate": body = `<rect width="${o.width ?? 300}" height="${o.height ?? 100}" rx="8" fill="${colors.surface}" stroke="${colors.accent}" stroke-width="3"/>`; break;
      default: throw new Error(`Unknown overlay type: ${o.type}`);
    }
    return `<g opacity="${opacity.toFixed(3)}" transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale.toFixed(3)})">${body}</g>`;
  }).join("");
}
