import { renderOverlays } from "../film/overlays.mjs";
// Two silent shorts staged as one continuous performance each, under a locked camera.
// `performance` drives the actor (see performance.mjs); `scenes` hold the mute-readable cues and
// the world overlays, which fade in with their beat and fade out when the beat is over.
const cue = (frame, text) => ({ frame, text });
const caesar = item => ({ laurel: true, ...item });
// Supporting actors: each is its own small continuous performance (gated like the lead).
const march = (delay, kit = "legionary") => ({ actor: [{ relocate: -70 }, { walk: { to: 1470, pace: 12 } }, { motion: "nod" }],
  scale: .6, lift: 16, kit, from: "gaul", until: "gaul", delay });
const ford = (x, wait, kit = "legionary") => ({ actor: [{ motion: "nod", root: x, hold: wait }, { walk: { to: 1470, pace: 12 } }, { motion: "nod" }],
  scale: .6, lift: 16, kit, from: "rubicon", until: "rubicon", delay: 0 });
const conspirator = (x, delay, mirror, lift = 0) => ({ actor: [{ relocate: -80 }, { walk: { to: mirror ? 1280 - x : x, pace: 12 } }, { motion: "punch" }],
  scale: .78, lift, kit: "dagger", mirror, from: "power", until: "ides", delay });

export const videoRecipes = [
  { id: "open-source", title: "Open source: a small fix, shared", summary: "A silent animated short: one continuous performance takes a missing feature to a reviewed fix and a release other people reuse.", sources: ["https://opensource.org/osd"],
    set: [{ motion: "type-at-desk", types: ["desk", "chair"], root: 330, hideDuring: ["video-call"] }],
    performance: [
      { motion: "frustrated-pc", root: 330, beat: "need" }, { motion: "stand-up" },
      { walk: { to: 640 }, beat: "rights" }, { motion: "inspect-magnifier" }, { motion: "reveal" },
      { walk: { to: 330 }, beat: "change" }, { motion: "sit-down" }, { motion: "type-at-desk", cycles: 2 },
      { motion: "video-call", keep: ["desk", "chair"], beat: "review" }, { motion: "stand-up" }, { motion: "thumbs-up" },
      { walk: { to: 600 }, beat: "release" }, { motion: "hand-over" },
      { motion: "basketball-shot", beat: "reuse" }, { motion: "cheer" }
    ],
    scenes: [
      { id: "need", title: "The missing feature", state: "missing-feature", place: "office",
        cues: [cue(0, "This tool cannot export my work."), cue(130, "What if I could change it myself?")] },
      { id: "rights", title: "Code plus permission", state: "licensed-source", place: "office",
        cues: [cue(0, "Open source shares the code..."), cue(150, "...and a license to use it."), cue(280, "I may use, study, modify and share.")] },
      { id: "change", title: "A working copy", state: "working-copy", place: "office",
        cues: [cue(0, "I make my own copy."), cue(130, "I add the export feature and test it.")] },
      { id: "review", title: "The review", state: "reviewed-contribution", place: "office",
        cues: [cue(0, "I send the fix back to the project."), cue(110, "A maintainer reviews it. Approval is not automatic."), cue(250, "Accepted!")] },
      { id: "release", title: "A shared release", state: "new-release", place: "office",
        cues: [cue(0, "The fix ships in a new release.")] },
      { id: "reuse", title: "The improvement spreads", state: "community-reuse", place: "office",
        cues: [cue(0, "Others reuse it and share improvements."), cue(115, "Follow the license: obligations vary.")] }
    ],
    extras: [
      { motion: "wave", root: 960, scale: .7, from: "release", until: "reuse", delay: 0 },
      { motion: "clap", root: 1050, scale: .7, from: "release", until: "reuse", delay: 20 },
      { motion: "thumbs-up", root: 1140, scale: .7, from: "release", until: "reuse", delay: 40 }
    ] },
  { id: "julius-caesar", title: "Julius Caesar: ambition changes Rome", summary: "A silent historical short: one continuous performance through Rome, Gaul, the Rubicon and the Senate.", sources: ["https://www.worldhistory.org/Julius_Caesar/", "https://en.wikipedia.org/wiki/Julian_calendar"],
    set: [],
    performance: [
      caesar({ motion: "wave", root: 820, beat: "rome" }), caesar({ motion: "present", hold: 12 }),
      caesar({ motion: "beckon", beat: "consul" }), caesar({ walk: { to: 1340, pace: 15 } }),
      { relocate: -90, beat: "gaul" }, caesar({ walk: { to: 460, pace: 15 } }), caesar({ motion: "arms-crossed" }),
      caesar({ walk: { to: 1340, pace: 15 } }),
      { relocate: -90, beat: "rubicon" }, caesar({ walk: { to: 380, pace: 15 } }), caesar({ motion: "think" }), caesar({ walk: { to: 840, pace: 15 }, hold: 56 }),
      caesar({ motion: "write-notes", beat: "power" }),
      caesar({ motion: "surprised", beat: "ides" }), caesar({ motion: "fall-get-up", until: 90, fadeOut: 40 }),
      { relocate: -90, beat: "legacy" }, { walk: { to: 560, pace: 15 } }, { motion: "present" }
    ],
    scenes: [
      { id: "rome", title: "A Roman beginning", state: "roman-republic", place: "city",
        cues: [cue(0, "Rome, 100 BCE. Julius Caesar is born."), cue(76, "A patrician family. An ambitious future.")] },
      { id: "consul", title: "Allies and ambition", state: "political-alliance", place: "senate",
        cues: [cue(0, "59 BCE: Caesar becomes consul."), cue(100, "Allies Pompey and Crassus help him rise.")] },
      { id: "gaul", title: "The campaigns", state: "gallic-campaigns", place: "gaul",
        cues: [cue(0, "58–50 BCE: wars in Gaul bring wealth and power."), cue(150, "Conquest also brings death and enslavement.")] },
      { id: "rubicon", title: "The crossing", state: "crossing-rubicon", place: "rubicon",
        cues: [cue(0, "49 BCE: Caesar reaches the Rubicon."), cue(140, "He crosses with his army. Civil war follows.")] },
      { id: "power", title: "No end to power", state: "dictator-for-life", place: "senate",
        cues: [cue(0, "He reforms Rome's calendar."), cue(95, "44 BCE: dictator for life. Not an emperor.")] },
      { id: "ides", title: "The Ides of March", state: "assassination", place: "senate",
        cues: [cue(0, "15 March, 44 BCE. Senators surround Caesar."), cue(80, "They kill him. His death does not end the crisis.")] },
      { id: "legacy", title: "After Caesar", state: "augustus-and-empire", place: "city",
        cues: [cue(0, "More civil wars follow."), cue(110, "27 BCE: his heir Octavian becomes Augustus.")] }
    ],
    extras: [
      { motion: "nod", root: 250, scale: .8, from: "consul", until: "consul", delay: 0 },
      { motion: "thumbs-up", root: 460, scale: .8, from: "consul", until: "consul", delay: 24 },
      march(0, "standard"), march(24), march(48), march(72), march(96), march(120), march(144),
      ford(330, 165, "standard"), ford(270, 171), ford(210, 177), ford(150, 183), ford(90, 189), ford(30, 195),
      conspirator(730, 37, false), conspirator(650, 49, false, 14), conspirator(1000, 121, true), conspirator(1080, 133, true, 14)
    ] }
];

/** Scenes start where their beat starts in the composed performance. */
export function storyTimeline(recipe, performance, { showcase = false } = {}) {
  if (!performance?.segments?.length) throw new Error("A film timeline needs its composed performance.");
  const starts = recipe.scenes.map(scene => {
    const index = performance.segments.findIndex(seg => seg.beat === scene.id);
    if (index < 0) throw new Error(`${recipe.id}: no performance beat starts scene ${scene.id}.`);
    return index === 0 ? 0 : performance.segments[index].gapStart;
  });
  if (starts[0] !== 0 || starts.some((start, i) => i && start <= starts[i - 1])) throw new Error(`${recipe.id}: performance beats must follow the scene order.`);
  const total = performance.frames;
  const scenes = recipe.scenes.map((scene, i) => {
    const startFrame = starts[i], frames = (starts[i + 1] ?? total) - startFrame;
    if (!scene.state || !scene.cues?.length) throw new Error("Every film beat needs a state and mute-readable text cues.");
    const cues = scene.cues.map((item, c) => {
      const endFrame = scene.cues[c + 1]?.frame ?? frames;
      if (!item.text || !Number.isInteger(item.frame) || item.frame < 0 || endFrame > frames || endFrame - item.frame < 75 || (c === 0 && item.frame !== 0))
        throw new Error(`${recipe.id}/${scene.id}: every text cue needs at least 2.5 seconds of reading time (scene is ${frames} frames).`);
      return { ...item, endFrame };
    });
    return { ...scene, cues, caption: cues.map(item => item.text).join(" "), startFrame, frames };
  });
  if (showcase && total > 1800) throw new Error(`${recipe.id} exceeds the one-minute story limit (${total} frames).`);
  return { scenes, frames: total, seconds: Number((total / 30).toFixed(2)) };
}

export const xml = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const clamp = value => Math.max(0, Math.min(1, value));
const ease = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const n = value => Number(value.toFixed(2));
const text = (x, y, label, size, fill, weight = 600, anchor = "start") => `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}" font-weight="${weight}" fill="${fill}">${xml(label)}</text>`;
const line = (d, color, width = 4) => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
const move = (x, y, markup) => `<g transform="translate(${n(x)} ${n(y)})">${markup}</g>`;
const show = (opacity, markup) => opacity <= .001 || !markup ? "" : opacity >= .999 ? markup : `<g opacity="${n(opacity)}">${markup}</g>`;
/** Overlay opacity: appears `from` frames into its beat and leaves `until` frames into it (default: beat end). */
const life = (f, frames, from = 0, until = frames, duration = 15) => ease((f - from) / duration) * (1 - ease((f - until + duration) / duration));

const window = (x, y, w, h, c) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${c["accent-soft"]}" stroke="${c.border}" stroke-width="3"/>${line(`M${x + w / 2} ${y}v${h}m${-w / 2} ${-h / 2}h${w}`, c.border, 2)}`;
const floor = (c, width = 3) => `<rect y="540" width="1280" height="180" fill="${c.surface}"/>${line("M0 540H1280", c["border-strong"], width)}`;
const office = c => `<rect width="1280" height="540" fill="${c.bg}"/>${window(70, 90, 200, 190, c)}${window(1010, 80, 180, 170, c)}
  ${line("M1240 535v-82m-25 12 25-34 22 34m-46 20 24-27 29 27", c["border-strong"], 5)}${floor(c)}`;
const columns = (x, y, width, height, c) => `${line(`M${x} ${y + 60}l${width / 2} -80 ${width / 2} 80Z`, c["border-strong"], 6)}
  ${[.1, .3, .5, .7, .9].map(r => `<rect x="${n(x + r * width - 12)}" y="${y + 65}" width="24" height="${height - 65}" fill="${c.surface}" stroke="${c["border-strong"]}" stroke-width="4"/>`).join("")}
  ${line(`M${x - 15} ${y + height + 5}h${width + 30}m${-width - 45} 16h${width + 60}`, c["border-strong"], 6)}`;
const skyline = c => `<g opacity=".35"><path d="M-50 295V170l95-35 95 35v125h70V190l90-55 90 55v105h60V160h170v135h80V210l90-65 90 65v85h70V140l90-35 90 35v155h100v250H-50Z" fill="${c["accent-soft"]}"/></g>`;
export const places = {
  office,
  city: c => `<rect width="1280" height="540" fill="${c.bg}"/>${skyline(c)}${columns(80, 250, 360, 210, c)}${floor(c, 4)}`,
  senate: c => `<rect width="1280" height="540" fill="${c.bg}"/>${skyline(c)}${columns(175, 190, 930, 270, c)}${floor(c, 4)}`,
  gaul: c => `<rect width="1280" height="540" fill="${c.bg}"/>
    <path d="M-60 440Q250 100 520 380T1010 320T1490 410V540H-60Z" fill="${c["accent-soft"]}"/>
    ${[160, 820, 1110].map(x => `${line(`M${x} 370v-160h90v55h-90`, c["border-strong"], 5)}${text(x + 45, 245, "ROME", 19, c.accent, 700, "middle")}`).join("")}
    ${line("M1120 525V425l70-45 70 45v100m-105 0v-60h65v60", c["border-strong"], 4)}${floor(c, 4)}`,
  rubicon: (c, g) => `<rect width="1280" height="540" fill="${c.bg}"/><path d="M520 0Q640 190 580 355T610 540H760Q700 470 760 290T730 0Z" fill="${c["accent-soft"]}"/>
    ${[0, 1, 2, 3, 4, 5].map(i => move(0, (g / 2 + i * 92) % 540, line("M612 0q20-9 45 0t55 0", c.accent, 3))).join("")}
    ${floor(c, 4)}${line("M560 540H790", c.accent, 7)}`
};

export const scroll = (x, y, label, c, width = 300) => `<g transform="translate(${x} ${y}) rotate(-4)">
  <path d="M0 0h${width}v150H0Z" fill="${c.surface}" stroke="${c["border-strong"]}" stroke-width="4"/>
  ${line(`M-12 0h${width + 24}m${-width - 24} 150h${width + 24}`, c.accent, 8)}
  ${text(width / 2, 46, label, 25, c.text, 700, "middle")}
  ${[78, 106].map((y, i) => line(`M30 ${y}h${width - 70 - i * 35}`, c.border, 3)).join("")}</g>`;
export const tick = (x, y, c) => `<circle cx="${x}" cy="${y}" r="22" fill="${c.accent}"/>${line(`M${x - 11} ${y}l8 8 15-17`, c["accent-fg"], 4)}`;
export const packageBox = (x, y, c, label = "v1.1") => `<g transform="translate(${n(x)} ${n(y)})">
  <path d="M0 22 60 0l62 22v80l-62 25L0 102ZM0 22l60 25 62-25M60 47v80" fill="${c.surface}" stroke="${c.accent}" stroke-width="5"/>
  ${text(18, 86, label, 23, c.text, 700)}</g>`;
export const bubble = (x, y, w, first, second, c) => move(x, y, `<path d="M0 0h${w}v116H70l-36 34 8-34H0Z" fill="${c.surface}" stroke="${c.accent}" stroke-width="4"/>
  ${text(w / 2, 48, first, 30, c.text, 700, "middle")}${second ? text(w / 2, 90, second, 23, c.accent, 700, "middle") : ""}`);
const title = (f, label, c) => show(1 - ease((f - 70) / 24), text(640, 76, label, 50, c.text, 800, "middle"));

function openSourceOverlay(scene, f, frames, c) {
  switch (scene.id) {
    case "need":
      return title(f, "CAN I FIX THIS?", c) + show(life(f, frames, 30), bubble(520, 150, 300, "EXPORT", "NOT AVAILABLE", c));
    case "rights":
      return show(life(f, frames, 120), scroll(800, 130, "SOURCE CODE", c, 300))
        + show(life(f, frames, 190), scroll(830, 300, "OPEN LICENSE", c, 280))
        + show(life(f, frames, 240), text(640, 76, "USE  ·  STUDY  ·  MODIFY  ·  SHARE", 34, c.accent, 800, "middle"));
    case "change": {
      const fork = ease((f - 15) / 70);
      const copy = move(800 - 330 * fork, 130 + 10 * fork, `<g transform="scale(${n(1 - .25 * fork)})">${scroll(0, 0, "MY COPY", c, 300)}</g>`);
      const lines = ["def export(work):", "  data = read(work)", "  save(data, \"work.csv\")", "test_export()  passed"];
      const typed = Math.min(4, Math.floor(Math.max(0, f - 205) / 22));
      return show(life(f, frames, 0, 105), scroll(800, 130, "PROJECT", c, 300)) + show(life(f, frames, 12, 150), copy)
        + show(life(f, frames, 150), move(560, 100, `<path d="M0 0h470v250H0Z" fill="${c.surface}" stroke="${c["border-strong"]}" stroke-width="4"/>
        ${text(24, 46, "MY COPY  ·  export.py", 26, c.accent, 800)}${line("M0 66h470", c.border, 3)}
        ${lines.slice(0, typed).map((label, i) => text(i === 3 ? 62 : 24, 106 + i * 40, label, 26, i === 3 ? c.accent : c.text, i === 3 ? 800 : 600)).join("")}
        ${typed === 4 ? `<g transform="translate(38 218) scale(.62)">${tick(0, 0, c)}</g>` : ""}`));
    }
    case "review":
      return show(life(f, frames, 60, 200), bubble(600, 120, 330, "Does it work?", "Show me the test.", c))
        + show(life(f, frames, 220), `${tick(760, 160, c)}${text(800, 172, "ACCEPTED", 32, c.accent, 800)}`);
    case "release": {
      const hand = ease((f - 150) / 50);
      return show(life(f, frames, 40, frames + 10), `${move(560 + 410 * hand, 100 + 120 * hand, `<g transform="scale(${n(1 - .45 * hand)})">${packageBox(0, 0, c)}</g>`)}
        ${show(1 - hand, text(700, 150, "EXPORT INCLUDED", 30, c.accent, 800))}`);
    }
    case "reuse": {
      const people = [960, 1050, 1140];
      const end = ease((f - 160) / 20);
      return show(life(f, frames, 0, frames + 15), people.map((x, i) => show(ease((f - 125 - i * 12) / 14),
          `${move(x - 34, 230, `<g transform="scale(.55)">${packageBox(0, 0, c)}</g>`)}${text(x, 592, ["USE", "ADAPT", "SHARE"][i], 24, c.accent, 800, "middle")}`)).join(""))
        + show(end, `${text(640, 92, "One small fix.", 46, c.text, 800, "middle")}${text(640, 146, "Shared by many.", 46, c.accent, 800, "middle")}`);
    }    default: throw new Error(`Unknown open-source film scene: ${scene.id}`);
  }
}

function caesarOverlay(scene, f, frames, c) {
  switch (scene.id) {
    case "rome": return title(f, "JULIUS CAESAR", c) + show(life(f, frames, 20), text(1180, 120, "ROME", 26, c.accent, 800, "end"));
    case "consul": return show(life(f, frames, 30), `${text(250, 150, "POMPEY", 27, c.accent, 800, "middle")}${text(460, 150, "CRASSUS", 27, c.accent, 800, "middle")}`);
    case "gaul": return show(life(f, frames, 0), text(80, 90, "GAUL", 28, c.accent, 800))
      + show(life(f, frames, 150), `${text(960, 120, "THE HUMAN COST", 32, c.accent, 800, "middle")}${text(960, 168, "Lives lost. People enslaved.", 25, c.text, 600, "middle")}`);
    case "rubicon": return show(life(f, frames, 0), `<rect x="520" y="38" width="240" height="46" rx="8" fill="${c.bg}"/>${text(640, 70, "THE RUBICON", 28, c.accent, 800, "middle")}${text(250, 150, "GAUL", 24, c["text-muted"], 700, "middle")}${text(1030, 150, "ITALY", 24, c["text-muted"], 700, "middle")}`)
      + show(life(f, frames, 150), text(1030, 230, "CIVIL WAR", 46, c.accent, 800, "middle"));
    case "power": return show(life(f, frames, 10), `<g transform="translate(140 110) rotate(-3)"><rect width="310" height="250" fill="${c.surface}" stroke="${c["border-strong"]}" stroke-width="5"/>
        <path d="M0 57h310" stroke="${c.accent}" stroke-width="7"/>${text(155, 39, "45 BCE · JULIAN", 24, c.accent, 700, "middle")}
        ${Array.from({ length: 15 }, (_, i) => `<circle cx="${35 + (i % 5) * 59}" cy="${100 + Math.floor(i / 5) * 45}" r="9" fill="${c.border}"/>`).join("")}
        ${f > 80 ? tick(270, 214, c) : ""}</g>`) + show(life(f, frames, 95), text(880, 100, "NOT AN EMPEROR", 28, c.accent, 800, "middle"));
    case "ides": return title(f, "THE IDES OF MARCH", c)
      + show(life(f, frames, 20, 120), `${text(690, 296, "BRUTUS", 24, c.accent, 800, "middle")}${text(1040, 296, "CASSIUS", 24, c.accent, 800, "middle")}`);
    case "legacy": return show(life(f, frames, 120, frames + 15), `${text(640, 110, "OCTAVIAN → AUGUSTUS", 30, c.accent, 800, "middle")}${text(640, 152, "Caesar's adopted heir", 23, c.text, 600, "middle")}`);
    default: throw new Error(`Unknown Caesar film scene: ${scene.id}`);
  }
}

/** Extras visible at a global frame, with their local clip frame and fade. */
export function filmExtras(recipe, timeline, frame) {
  const sceneIndex = id => recipe.scenes.findIndex(scene => scene.id === id);
  return (recipe.extras ?? []).flatMap(extra => {
    const from = timeline.scenes[sceneIndex(extra.from)], until = timeline.scenes[sceneIndex(extra.until)];
    if (!from || !until) throw new Error(`${recipe.id}: extras need known scenes.`);
    const start = from.startFrame, end = until.startFrame + until.frames;
    const visibleStart = start + (recipe.declarative ? extra.delay : 0);
    if (frame < visibleStart || frame >= end) return [];
    return [{ ...extra, source: extra, frame: Math.max(0, frame - start - extra.delay), opacity: life(frame - visibleStart, end - visibleStart, 0, end - visibleStart, 18) }];
  });
}

export function sceneAt(timeline, frame) {
  const index = timeline.scenes.findLastIndex(scene => scene.startFrame <= frame);
  if (index < 0 || frame >= timeline.frames) throw new Error("Story frame is outside its timeline.");
  return { index, scene: timeline.scenes[index], local: frame - timeline.scenes[index].startFrame };
}

/** One film frame: locked camera, world → extras → actor → overlays → caption. */
export function renderStoryFrame(recipe, timeline, frame, layers, c) {
  const { index, scene, local } = sceneAt(timeline, frame);
  const previous = timeline.scenes[index - 1];
  const dissolve = previous && previous.place !== scene.place ? ease(local / 24) : 1;
  const world = (dissolve < 1 ? places[previous.place](c, frame) : "") + show(dissolve, places[scene.place](c, frame));
  const overlay = recipe.declarative ? renderOverlays(scene.overlays ?? [], local, c) : (recipe.id === "open-source" ? openSourceOverlay : caesarOverlay)(scene, local, scene.frames, c);
  const currentCue = scene.cues.findLast(entry => entry.frame <= local);
  const rows = [];
  let row = "";
  for (const word of currentCue.text.split(" ")) {
    if (row && row.length + word.length + 1 > 50) { rows.push(row); row = ""; }
    row += (row ? " " : "") + word;
  }
  if (row) rows.push(row);
  if (rows.length > 2) throw new Error("Silent film text must fit two large readable lines.");
  const textY = rows.length === 1 ? 663 : 633;
  const cueIn = ease((local - currentCue.frame) / 8);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" data-story="${recipe.id}" data-state="${xml(scene.state)}" data-style="silent-short-film" data-camera="locked" data-segment="${layers.segment ?? ""}" data-cue="${currentCue.frame}">
    <rect width="1280" height="720" fill="${c.bg}"/>
    <g font-family="Segoe UI, Aptos, Calibri, sans-serif">
    ${world}${layers.back ?? ""}${layers.extras ?? ""}${layers.actor ?? ""}${layers.front ?? ""}${overlay}
    ${show(cueIn, rows.map((label, i) => text(640, textY + i * 50, label, 39, c.text, 700, "middle")).join(""))}
    </g></svg>`;
}
