(function () {
  "use strict";
  const deck = window.DynamicDeck;
  if (!deck) throw new Error("DynamicDeck runtime is missing.");
  const films = JSON.parse(document.getElementById("stickman-020-frames").textContent);
  deck.registerMotionProvider({
    id: "stickman-020", adapterVersion: "1.0",
    capabilities: { absoluteSeek: true, staticState: true, cleanup: true, offline: true, effects: ["perform", "flow"] },
    mount(stage, scene) {
      const id = stage.closest(".slide").id;
      const film = films[id];
      if (!film) throw new Error("Unknown test scene " + id);
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "150 210 500 380");
      svg.setAttribute("data-test-actor", film.action);
      svg.style.cssText = "position:absolute;bottom:48px;left:0;width:100%;height:55%;overflow:hidden";
      const caveat = document.createElement("p");
      caveat.textContent = id === "inspect" ? "Inspect the draft. It is not approved." :
        id === "handoff" ? "Proposed process only. The check is not real consent." : "Human approval is still pending.";
      caveat.setAttribute("data-approval-caveat", "");
      caveat.style.cssText = "position:absolute;bottom:8px;left:6%;width:88%;margin:0;font-size:18px;line-height:24px;color:var(--cp-text-muted);text-align:center";
      stage.appendChild(caveat);
      const flow = stage.closest(".scene").querySelector(".native-flow");
      const native = flow?.cloneNode(true);
      if (native) {
        native.style.cssText = "position:absolute;top:12px;left:4%;width:92%;height:36%;margin:0";
        native.querySelectorAll("[id]").forEach(el => el.removeAttribute("id"));
        stage.appendChild(native);
      }
      stage.appendChild(svg);
      let start = 0, raf = 0, last = -1;
      function draw(frame) {
        if (frame === last) return;
        last = frame;
        const style = getComputedStyle(stage);
        const colors = { t: "--cp-text", s: "--cp-surface", b: "--cp-border-strong", a: "--cp-accent" };
        const ink = key => style.getPropertyValue(colors[key]).trim();
        const localProps = {
          inspect: `<rect x="440" y="350" width="58" height="74" rx="4" fill="@s" stroke="@b" stroke-width="3"/><path d="M450 400l12-18 10 6 14-23" fill="none" stroke="@a" stroke-width="3"/>`,
          compare: `<rect x="309" y="365" width="50" height="70" rx="4" fill="@s" stroke="@b" stroke-width="3"/><rect x="456" y="365" width="50" height="70" rx="4" fill="@s" stroke="@a" stroke-width="3"/><path d="M319 380h30m-30 14h22m144-14h30m-30 14h22" stroke="@b" stroke-width="3"/>`,
          review: `<rect x="444" y="349" width="56" height="54" rx="4" fill="@s" stroke="@b" stroke-width="3"/><path d="M454 363h32m-32 12h25" stroke="@a" stroke-width="3"/>`
        };
        const opacity = Math.max(0, Math.min(1, (76 - frame) / 16));
        svg.innerHTML = (`<g data-test-prop="" opacity="${opacity}">${localProps[film.action]}</g>` + film.dict[film.frames[frame]])
          .replace(/@([tsba])/g, (_, key) => ink(key));
        svg.setAttribute("data-frame", String(frame));
      }
      function tick(now) {
        raf = 0;
        const frame = Math.min(film.frames.length - 1, Math.floor((now - start) * 30 / 1000));
        draw(frame);
        if (frame < film.frames.length - 1) raf = requestAnimationFrame(tick);
      }
      return {
        ready: () => Promise.resolve(),
        seek(beat, cues, options) {
          if (raf) cancelAnimationFrame(raf);
          raf = 0; last = -1;
          if (!cues.length) { svg.innerHTML = ""; caveat.hidden = true; if (native) native.style.visibility = "hidden"; }
          else {
            caveat.hidden = false;
            if (native) native.style.visibility = "visible";
            start = performance.now();
            draw(options?.static ? film.frames.length - 1 : 0);
            if (!options?.static) raf = requestAnimationFrame(tick);
          }
          return { bounds: { x: 0, y: 0, w: scene.slot.w, h: scene.slot.h }, activeProps: cues.length ? ["review-artifact"] : [] };
        },
        cleanup() { if (raf) cancelAnimationFrame(raf); svg.remove(); native?.remove(); caveat.remove(); }
      };
    }
  });
})();
