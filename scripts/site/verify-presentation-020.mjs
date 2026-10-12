import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
const root = path.resolve(process.argv[2] ?? ".release-local\\presentation-020");
const pilot = JSON.parse(await fs.readFile(path.join(root, "render_pilot.json"), "utf8"));
const report = { files: [], failures: [] };
const browser = await chromium.launch();
try {
  for (const [name, file] of [["native", pilot.path], ["stickman", path.join(root, "with-stickman.html")]]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const errors = [], requests = [], states = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route(/https?:\/\//, route => { requests.push(route.request().url()); return route.abort(); });
    const url = pathToFileURL(file).href;
    await page.goto(url + "?scoutTheme=light");
    await page.waitForFunction(() => window.DynamicDeck);
    await page.evaluate(() => { if (window.DynamicDeck.state().view !== "present") document.getElementById("btn-view").click(); });
    for (const id of ["inspect", "handoff", "decision"]) {
      await page.evaluate(id => window.DynamicDeck.goTo(id, 0), id);
      await page.waitForTimeout(700);
      const probe = async () => page.evaluate(() => {
        const state = window.DynamicDeck.state(), slide = document.getElementById(state.slideId);
        const actor = slide.querySelector("[data-test-actor]");
        const slot = actor?.closest(".scene").getBoundingClientRect();
        const ink = actor?.querySelector("[data-stickman]");
        const box = ink?.getBoundingClientRect();
        const texts = [...slide.querySelectorAll("h1,h2,h3,p,.block,svg text")]
          .filter(el => el.getBoundingClientRect().width && getComputedStyle(el).visibility !== "hidden")
          .map(el => ({ text: el.textContent, box: el.getBoundingClientRect() }));
        const collisions = [];
        if (box?.width) for (const text of texts) {
          const b = text.box;
          if (b.left < box.right && b.right > box.left && b.top < box.bottom && b.bottom > box.top) collisions.push(text.text);
        }
        return { state, action: actor?.getAttribute("data-test-actor"), frame: actor?.getAttribute("data-frame"),
          inside: !box || (box.left >= slot.left && box.right <= slot.right && box.top >= slot.top && box.bottom <= slot.bottom),
          collisions, flow: slide.querySelector(".scene-stage .native-flow")?.getAttribute("data-choreography"),
          caveat: slide.querySelector("[data-approval-caveat]")?.textContent,
          propOpacity: slide.querySelector("[data-test-prop]")?.getAttribute("opacity"),
          animations: slide.getAnimations({ subtree: true }).map(a => ({ name: a.animationName, time: a.currentTime, state: a.playState })),
          diagnostics: window.DynamicDeck.diagnostics() };
      });
      states.push(await probe());
      await page.screenshot({ path: path.join(root, `${name}-${id}-mid.png`) });
      await page.waitForTimeout(5000);
      states.push(await probe());
      await page.screenshot({ path: path.join(root, `${name}-${id}-end.png`) });
      await page.keyboard.press("r");
      await page.waitForTimeout(750);
      states.push(await probe());
      await page.keyboard.press("m");
      await page.waitForTimeout(100);
      const off = await page.evaluate(() => ({ state: window.DynamicDeck.state(), text: document.body.innerText }));
      await page.screenshot({ path: path.join(root, `${name}-${id}-off.png`) });
      await page.keyboard.press("v");
      const reading = await page.evaluate(() => ({ state: window.DynamicDeck.state(), text: document.body.innerText }));
      await page.keyboard.press("v");
      await page.keyboard.press("m");
      if (!/approv/i.test(off.text) || !/approv/i.test(reading.text)) report.failures.push(name + "/" + id + ": fallback loses approval boundary");
    }
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(650);
    const navigation = await page.evaluate(() => window.DynamicDeck.state());
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(root, name + "-reduced.png") });
    const reduced = await page.evaluate(() => ({ state: window.DynamicDeck.state(), text: document.body.innerText }));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url + "?scoutTheme=dark");
    await page.waitForTimeout(400);
    const mobile = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, state: window.DynamicDeck.state() }));
    await page.screenshot({ path: path.join(root, name + "-mobile-dark.png") });
    if (errors.length || requests.length) report.failures.push(name + ": runtime errors or external requests");
    if (mobile.scroll > mobile.width) report.failures.push(name + ": mobile overflow");
    if (states.some(s => !s.inside || s.collisions.length)) report.failures.push(name + ": actor outside slot or colliding with text");
    if (name === "stickman" && (states.some(s => !s.action) || new Set(states.map(s => s.action)).size !== 3)) report.failures.push("Missing distinct actor actions");
    if (name === "stickman" && states.some(s => !s.caveat || !/approv|consent/i.test(s.caveat))) report.failures.push("Missing visible approval caveat");
    if (name === "stickman" && states.filter((_, i) => i % 3 === 1).some(s => s.propOpacity !== "0")) report.failures.push("Props persist after recovery");
    report.files.push({ name, file, states, errors, requests, navigation, reduced, mobile });
    await context.close();
  }
} finally { await browser.close(); }
await fs.writeFile(path.join(root, "browser-observations.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ failures: report.failures, files: report.files.map(f => ({ name: f.name, actions: [...new Set(f.states.map(s => s.action))] })) }));
if (report.failures.length) process.exitCode = 1;
