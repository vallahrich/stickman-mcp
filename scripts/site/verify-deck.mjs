// Verifies the stickman + dynamic-presentations cloud story.
// Run from the repo root: node scripts\site\verify-deck.mjs <story.html> [tag] --output <work> [--full]
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const { chromium } = await import(pathToFileURL(path.join(process.cwd(), "node_modules", "@playwright", "test", "index.mjs")));
const outputIndex = process.argv.indexOf("--output");
const folder = outputIndex >= 0 ? path.resolve(process.argv[outputIndex + 1]) : path.dirname(fileURLToPath(import.meta.url));
const file = path.resolve(process.argv[2]);
const tag = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : "shots";
const full = process.argv.includes("--full");
const shots = path.join(folder, tag);
await fs.mkdir(shots, { recursive: true });
const url = pathToFileURL(file).href;
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const browser = await chromium.launch({ headless: true });
const report = { file, shots };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(`${url}?paused=1`);
  await page.waitForFunction(() => window.StickmanDeckAutoplay && window.DynamicDeck);
  report.sceneSurfaces = await page.locator("figure.scene").evaluateAll(scenes => scenes.map(scene => {
    const style = getComputedStyle(scene);
    return { background: style.backgroundColor, border: style.borderTopColor, radius: style.borderTopLeftRadius, shadow: style.boxShadow };
  }));
  check(report.sceneSurfaces.length > 0 && report.sceneSurfaces.every(style =>
    style.background === "rgba(0, 0, 0, 0)" && style.border === "rgba(0, 0, 0, 0)" &&
    style.radius === "0px" && style.shadow === "none"), "scene panels are not integrated into the slide surface");
  const timing = await page.evaluate(() => JSON.parse(document.getElementById("data").textContent));
  report.totalFrames = timing.totalFrames;
  report.seconds = timing.totalFrames / 30;
  report.stickman = timing.stickman;
  check(timing.totalFrames / 30 <= 60, `duration ${timing.totalFrames / 30}s > 60s`);
  check(timing.stickman.continuity.footSlides === 0, "planted feet slide in generated deck joins");
  check(timing.stickman.continuity.maxJointStep <= 14, `continuity ${timing.stickman.continuity.maxJointStep}`);
  const html = await fs.readFile(file, "utf8");
  check(html.includes("Workload migration comparison"), "missing literal text");
  check(!/https?:\/\/(?!www\.w3\.org)/.test(html.replace(/xmlns(:\w+)?="[^"]+"/g, "")), "external URL in HTML");
  check(await page.locator("#play").textContent() === "Play", "paused play label");

  const settle = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const probe = () => page.evaluate(() => {
    const st = window.DynamicDeck.state();
    const slide = document.querySelector(".slide[data-active='true'], .slide.is-active") ||
      [...document.querySelectorAll(".slide")].find(s => s.getAttribute("aria-hidden") !== "true" && s.getBoundingClientRect().width > 0);
    const scene = slide?.querySelector("figure.scene");
    const out = { slide: st.slideId, beat: st.beat, view: st.view, motion: st.motion, diag: window.DynamicDeck.diagnostics().motion };
    if (!scene) return out;
    const slot = scene.getBoundingClientRect();
    out.status = scene.getAttribute("data-motion-status");
    const actor = scene.querySelector("[data-stickman-actor]");
    const a = actor?.getBoundingClientRect();
    out.actor = a && a.height ? { x: a.x - slot.x, y: a.y - slot.y, w: a.width, h: a.height } : null;
    out.slot = { w: slot.width, h: slot.height };
    out.inside = !a || !a.height || (a.left >= slot.left - 1 && a.right <= slot.right + 1 && a.top >= slot.top - 1 && a.bottom <= slot.bottom + 1);
    const content = scene.querySelector(".stickman-stage");
    const c = content?.getBoundingClientRect();
    out.stageInside = !c || (c.left >= slot.left - 1 && c.right <= slot.right + 1 && c.top >= slot.top - 1 && c.bottom <= slot.bottom + 1);
    const overlaps = [];
    for (const el of slide.querySelectorAll("h1,h2,h3,p,li,.block,[data-block-id]")) {
      if (scene.contains(el)) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(el).visibility === "hidden" || Number(getComputedStyle(el).opacity) === 0) continue;
      if (r.left < slot.right - 1 && r.right > slot.left + 1 && r.top < slot.bottom - 1 && r.bottom > slot.top + 1) overlaps.push((el.textContent || "").trim().slice(0, 40));
    }
    out.overlaps = overlaps;
    const texts = [...scene.querySelectorAll(".scene-stage text")].filter(el => getComputedStyle(el).opacity !== "0").map(el => ({ label: el.textContent, bounds: el.getBoundingClientRect() })).filter(el => el.bounds.width && el.bounds.height);
    const touches = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
    out.svgTextOverlaps = [];
    texts.forEach((el, i) => {
      if (a && a.height && touches(a, el.bounds)) out.svgTextOverlaps.push("actor / " + el.label);
      texts.slice(i + 1).forEach(other => {
        if (touches(el.bounds, other.bounds)) out.svgTextOverlaps.push(el.label + " / " + other.label);
      });
    });
    out.svg = content ? content.innerHTML.length : 0;
    out.frame = content?.getAttribute("data-frame");
    return out;
  });

  report.beats = [];
  for (const [i, entry] of timing.timeline.entries()) {
    for (const [label, offset] of [["mid", Math.floor(entry.frames * 0.55)], ["end", entry.frames - 1]]) {
      const frame = entry.start + offset;
      await page.evaluate(f => window.StickmanDeckAutoplay.seek(f), frame);
      await page.waitForTimeout(entry.slide === timing.timeline[Math.max(0, i - 1)].slide ? 120 : 700);
      await settle();
      const p = await probe();
      p.frame = frame; p.label = label;
      check(p.slide === entry.slide && p.beat === entry.beat, `seek ${frame}: deck at ${p.slide}/${p.beat}, expected ${entry.slide}/${entry.beat}`);
      check(p.status === "running", `${entry.slide}/${entry.beat}: missing or unnegotiated scene provider`);
      if (p.status !== undefined) {
        check(p.status === "running", `${entry.slide}/${entry.beat}: motion status ${p.status}`);
        check(p.inside && p.stageInside, `${entry.slide}/${entry.beat}: stickman outside slot`);
        check(!p.svgTextOverlaps.length, `${entry.slide}/${entry.beat}: SVG text overlap: ${p.svgTextOverlaps.join(" | ")}`);
        check(p.actor || entry.slide === "decision" && label === "end", `${entry.slide}/${entry.beat}: missing actor`);
        check(!p.overlaps.length, `${entry.slide}/${entry.beat}: text overlaps slot: ${p.overlaps.join(" | ")}`);
        check(!p.actor || (p.actor.h >= 65 && p.actor.h <= 160), `${entry.slide}/${entry.beat}: stickman outside co-presenter height range (${p.actor?.h})`);
      }
      const shot = path.join(shots, `${String(i).padStart(2, "0")}-${entry.slide}-${entry.beat}-${label}.png`);
      if (label === "end" || p.status !== undefined) await page.screenshot({ path: shot });
      report.beats.push({ ...p, shot: path.basename(shot), diag: p.diag.length });
    }
  }
  report.actorHeight = { min: Math.min(...report.beats.filter(b => b.actor).map(b => b.actor.h)), max: Math.max(...report.beats.filter(b => b.actor).map(b => b.actor.h)) };
  const standing = report.beats.filter(b => b.actor && b.slide === "on-prem").map(b => b.actor.h);
  report.standingHeight = { min: Math.min(...standing), max: Math.max(...standing) };
  check(report.standingHeight.min >= 120 && report.standingHeight.max <= 150, "standing co-presenter height outside 120-150px");
  for (const [name, frame] of [["rack-extended", 300], ["typing", 821], ["celebration-release", 1443], ["celebration-swish", 1463], ["exit-through", 1623]]) {
    await page.evaluate(f => window.StickmanDeckAutoplay.seek(f), frame);
    await page.waitForTimeout(700); await settle();
    await page.screenshot({ path: path.join(shots, name + ".png") });
  }
  const diag = await page.evaluate(() => window.DynamicDeck.diagnostics());
  report.motionDiagnostics = diag.motion;
  check(!diag.motion.length, `motion diagnostics: ${JSON.stringify(diag.motion)}`);
  check(!diag.motion.some(d => /UNSUPPORTED/.test(d.code)), "MOTION_UNSUPPORTED present");

  // Deterministic absolute seek: same frame -> identical markup, regardless of the path taken.
  const sample = async f => { await page.evaluate(x => window.StickmanDeckAutoplay.seek(x), f); await page.waitForTimeout(700); await settle();
    return page.evaluate(() => document.querySelector(".slide [data-active] .stickman-stage, .stickman-stage")?.closest("figure")?.querySelector(".stickman-stage")?.innerHTML ?? ""); };
  const visibleStage = () => page.evaluate(() => [...document.querySelectorAll(".stickman-stage")].map(s => s.innerHTML).join("|"));
  const det = [];
  for (const f of [400, 760, 1200]) {
    await sample(f); const a = await visibleStage();
    await sample(1650); await sample(120); await sample(f); const b = await visibleStage();
    await sample(f + 40); await sample(f); const c = await visibleStage();
    det.push({ frame: f, same: a === b && b === c && a.length > 0 });
  }
  report.determinism = det;
  check(det.every(d => d.same), `non-deterministic seek ${JSON.stringify(det)}`);

  // Autoplay must drive the MCP's real entrance/build effects, not static goTo calls.
  const animations = () => page.evaluate(() => document.getElementById("deck").getAnimations({ subtree: true }).map(a => ({ name: a.animationName ?? "build", time: a.currentTime, target: a.effect?.target?.className?.baseVal ?? a.effect?.target?.className })));
  await page.evaluate(() => { window.StickmanDeckAutoplay.seek(0); window.StickmanDeckAutoplay.play(); });
  await page.waitForTimeout(90);
  const entrance = await animations();
  check(entrance.some(a => a.name === "build"), "opening entrance suppressed during autoplay");
  await page.evaluate(() => window.StickmanDeckAutoplay.pause());
  const revealFrame = timing.timeline.find(e => e.slide === "on-prem" && e.beat === 1).start;
  await page.evaluate(f => { window.StickmanDeckAutoplay.seek(f - 2); window.StickmanDeckAutoplay.play(); }, revealFrame);
  await page.waitForTimeout(160);
  const reveal = await animations();
  check(reveal.some(a => a.name === "build" && String(a.target).includes("block")), "native build reveal suppressed during autoplay");
  await page.evaluate(() => window.StickmanDeckAutoplay.pause());
  const flowFrame = timing.timeline.find(e => e.slide === "evidence").start;
  await page.evaluate(f => { window.StickmanDeckAutoplay.seek(f - 2); window.StickmanDeckAutoplay.play(); }, flowFrame);
  await page.waitForTimeout(650);
  const flowSample = () => page.evaluate(() => {
    const slot = document.querySelector("#evidence figure.scene"), packet = slot.querySelector(".stickman-native-flow .flow-packet");
    return { active: slot.getAttribute("data-flow-active"), transform: getComputedStyle(packet).transform,
      animations: packet.getAnimations().map(a => ({ name: a.animationName, time: a.currentTime })),
      completed: [...slot.querySelectorAll(".stickman-native-flow .flow-stage")].filter(n => n.getAttribute("data-step-complete") === "true").length };
  });
  const flowA = await flowSample();
  await page.waitForTimeout(1400);
  const flowB = await flowSample();
  check(flowA.active === "true" && flowB.active === "true" && flowA.transform !== flowB.transform, "native flow packet not travelling during autoplay");
  check(flowB.animations.some(a => a.name === "flow-travel-4" && a.time > 0), "native flow animation missing");
  await page.evaluate(() => window.StickmanDeckAutoplay.pause());
  await page.evaluate(f => window.StickmanDeckAutoplay.seek(f), timing.timeline.find(e => e.slide === "evidence" && e.beat === 1).start + 77);
  await settle();
  const validateStep = await flowSample();
  const flowCount = await page.locator(".stickman-native-flow").count();
  check(flowCount === 1, "native flow clones leaked across provider cleanup: " + flowCount);
  check(validateStep.active === "true", "native flow disabled after deterministic seek");
  check(validateStep.completed === 2, "Validate never became active");
  await page.evaluate(f => window.StickmanDeckAutoplay.seek(f), flowFrame + 250);
  await settle(); const flowSeekA = await flowSample();
  await page.evaluate(() => window.StickmanDeckAutoplay.seek(0));
  await page.evaluate(f => window.StickmanDeckAutoplay.seek(f), flowFrame + 250);
  await settle(); const flowSeekB = await flowSample();
  check(flowSeekA.transform === flowSeekB.transform, "native flow absolute seek is not deterministic");
  report.nativeAnimations = { entrance: entrance.length, reveals: reveal.length, flowA, flowB, validateStep, flowCount, flowSeekA, flowSeekB, deterministic: flowSeekA.transform === flowSeekB.transform };

  // Scrub to the end with the keyboard as the gallery test does.
  await page.locator("#seek").focus();
  await page.keyboard.press("End");
  await page.waitForTimeout(300);
  report.end = { seek: await page.locator("#seek").inputValue(), play: await page.locator("#play").textContent() };
  check(report.end.seek === String(timing.totalFrames - 1) && report.end.play === "Replay", `End key ${JSON.stringify(report.end)}`);

  // Manual click-through still works and parks the timeline.
  await page.evaluate(() => window.DynamicDeck.goTo("question", 0));
  await page.waitForTimeout(300);
  await page.click("#btn-next");
  await page.waitForTimeout(900);
  report.manual = await page.evaluate(() => ({ state: window.DynamicDeck.state().slideId, seek: document.getElementById("seek").value, play: document.getElementById("play").textContent }));
  check(report.manual.state === "on-prem" && report.manual.seek === String(timing.timeline[1].start), `manual navigation ${JSON.stringify(report.manual)}`);

  // Autoplay runs from a normal load.
  const auto = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  auto.on("pageerror", e => errors.push(e.message));
  auto.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await auto.goto(url);
  await auto.waitForTimeout(full ? (timing.totalFrames / 30 + 2.5) * 1000 : 7500);
  report.autoplay = await auto.evaluate(() => ({ ...window.StickmanDeckAutoplay.state(), slide: window.DynamicDeck.state().slideId, beat: window.DynamicDeck.state().beat,
    play: document.getElementById("play").textContent, statuses: [...document.querySelectorAll("figure.scene")].map(s => s.getAttribute("data-motion-status")) }));
  if (full) check(report.autoplay.frame === timing.totalFrames - 1 && report.autoplay.play === "Replay" && report.autoplay.slide === "decision", `full autoplay ${JSON.stringify(report.autoplay)}`);
  else check(report.autoplay.playing && report.autoplay.frame > 120 && report.autoplay.slide === "on-prem", `autoplay ${JSON.stringify(report.autoplay)}`);
  await auto.close();

  // Mobile reading view with reduced motion.
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  mobile.on("pageerror", e => errors.push(e.message));
  await mobile.goto(`${url}?paused=1`);
  await mobile.waitForTimeout(800);
  report.mobile = await mobile.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, width: window.innerWidth,
    play: document.getElementById("play").textContent, seek: document.getElementById("seek").value, slides: document.querySelectorAll(".slide").length }));
  await mobile.screenshot({ path: path.join(shots, "mobile-390.png"), fullPage: true });
  check(report.mobile.scrollWidth <= report.mobile.width, `mobile overflow ${JSON.stringify(report.mobile)}`);
  check(report.mobile.play === "Play" && report.mobile.seek === "0", `mobile controls ${JSON.stringify(report.mobile)}`);
  await mobile.close();

  // Dark theme renders with theme colours (no leftover tokens).
  await page.evaluate(() => { document.documentElement.setAttribute("data-theme", "dark"); window.StickmanDeckAutoplay.seek(800); });
  await page.waitForTimeout(800);
  report.tokensLeft = await page.evaluate(() => /="@[a-z]"/.test([...document.querySelectorAll(".stickman-stage")].map(s => s.innerHTML).join("")));
  check(!report.tokensLeft, "colour tokens left in SVG");

  report.errors = errors;
  check(!errors.length, `console errors: ${errors.join(" | ")}`);
} finally {
  await browser.close();
}
report.failures = failures;
report.ok = !failures.length;
await fs.writeFile(path.join(folder, `${tag}-verification.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: report.ok, failures, seconds: report.seconds, stickman: report.stickman, determinism: report.determinism, standingHeight: report.standingHeight, actorHeight: report.actorHeight, end: report.end, manual: report.manual,
  autoplay: report.autoplay, nativeAnimations: report.nativeAnimations, mobile: report.mobile, actorHeights: report.beats.filter(b => b.actor).map(b => `${b.slide}/${b.beat}:${Math.round(b.actor.h)}`).join(" ") }, null, 1));
process.exitCode = report.ok ? 0 : 1;
