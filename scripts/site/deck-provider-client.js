// Browser half of the stickman deck provider (see scripts/site/deck-provider.mjs).
// Injected after the dynamic-presentations runtime: registers an adapter-1.0 motion provider that draws the
// pre-composed stickman performance inside each scene slot, plus a timed autoplay wrapper (#play, #seek).
(function () {
  "use strict";
  var timing = JSON.parse(document.getElementById("data").textContent);
  var film = JSON.parse(document.getElementById("stickman-frames").textContent);
  var deck = window.DynamicDeck;
  if (!deck) return;
  // Embedded panels can change size without delivering the renderer's window resize event.
  var layoutFrame = 0;
  function refreshLayout() {
    if (layoutFrame) cancelAnimationFrame(layoutFrame);
    layoutFrame = requestAnimationFrame(function () {
      layoutFrame = 0;
      window.dispatchEvent(new Event("resize"));
    });
  }
  var layoutObserver = new ResizeObserver(refreshLayout);
  layoutObserver.observe(document.documentElement);
  window.addEventListener("pageshow", refreshLayout);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) refreshLayout();
  });
  var fps = timing.fps;
  var V = film.view;
  var clock = { external: null };
  window.StickmanDeckClock = clock;

  // Read the theme where the scene lives: decks scope --cp-accent and friends to their brand on .canvas.
  function palette(el) {
    var cs = getComputedStyle(el);
    var get = function (name) { return cs.getPropertyValue(name).trim() || "var(" + name + ")"; };
    return { t: get("--cp-text"), m: get("--cp-text-muted"), a: get("--cp-accent"),
      s: get("--cp-surface"), b: get("--cp-border-strong"), l: get("--cp-border"),
      f: get("--cp-accent-fg") };
  }
  function paint(markup, c) { return markup.replace(/@([tmasblfw])/g, function (_, k) { return c[k]; }); }

  function entryIndexAt(frame) {
    var list = timing.timeline;
    for (var i = list.length - 1; i >= 0; i--) if (frame >= list[i].start) return i;
    return 0;
  }
  function entryFor(slide, beat) {
    for (var i = 0; i < timing.timeline.length; i++) {
      var e = timing.timeline[i];
      if (e.slide === slide && e.beat === beat) return e;
    }
    return null;
  }

  // ---------- scene props (film coordinates, same space as the stickman) ----------
  var clamp = function (v) { return Math.max(0, Math.min(1, v)); };
  var ease = function (v) { var t = clamp(v); return t * t * (3 - 2 * t); };
  var r = function (v) { return Math.round(v * 10) / 10; };
  function text(x, y, label, size, fill, weight, anchor) {
    return '<text x="' + r(x) + '" y="' + r(y) + '" font-size="' + size + '" font-weight="' + (weight || 600) + '" fill="' + fill +
      '" style="font-size:' + size + 'px" text-anchor="' + (anchor || "start") + '" font-family="Segoe UI, Aptos, sans-serif">' + label + "</text>";
  }
  /* DECK_DIAGRAMS */

  // ---------- provider ----------
  function mount(stage, scene) {
    var slideId = film.cueSlides[scene.cues[0] && scene.cues[0].id];
    var ranges = film.scenes[slideId];
    if (!ranges) throw new Error("Unknown stickman scene.");
    var svgNS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", V.x + " " + V.y + " " + V.w + " " + V.h);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.setAttribute("class", "stickman-stage");
    svg.setAttribute("data-slide", slideId);
    var back = document.createElementNS(svgNS, "g"), props = document.createElementNS(svgNS, "g");
    props.setAttribute("data-stickman-diagram", "");
    var actor = document.createElementNS(svgNS, "g"), front = document.createElementNS(svgNS, "g");
    // The lead never exits: position carried through the same continuous performance.
    var characterOffset = 0;
    [back, actor, front].forEach(function (layer) { layer.setAttribute("transform", "translate(" + characterOffset + " 0)"); });
    actor.setAttribute("data-stickman-actor", "");
    back.innerHTML = "";
    svg.appendChild(back); svg.appendChild(props); svg.appendChild(actor); svg.appendChild(front);
    stage.appendChild(svg);
    var slot = stage.closest("figure.scene"), nativeFlow = slot.querySelector(".scene-static .native-flow");
    var flow = nativeFlow ? nativeFlow.cloneNode(true) : null;
    if (flow) {
      flow.classList.add("stickman-native-flow");
      // Reuse the renderer's real finite flow animation, aligned to the diagram's common grid.
      flow.setAttribute("viewBox", V.x + " " + V.y + " " + V.w + " " + V.h);
      flow.querySelectorAll(".flow-stage").forEach(function(node, i) {
        var cx = stages[i][1], rect = node.querySelector("rect"), label = node.querySelector("tspan");
        rect.setAttribute("x", cx - 87); rect.setAttribute("y", 5); rect.setAttribute("width", 174); rect.setAttribute("height", 48);
        label.setAttribute("x", cx); label.setAttribute("y", 36);
        node.querySelector("text").style.fontSize = "22px";
        if (i) flow.style.setProperty("--flow-stop-" + i, (cx - stages[0][1]) + "px");
      });
      [".flow-arrow", ".flow-ink"].forEach(function(selector) {
        flow.querySelectorAll(selector).forEach(function(node, i) {
          var a = stages[i][1] + 89, b = stages[i+1][1] - 89;
          node.setAttribute("d", "M" + a + " 29H" + b + (selector === ".flow-arrow" ? "m-5-5l5 5-5 5" : ""));
        });
      });
      var rail = flow.querySelector(".flow-rail"), packet = flow.querySelector(".flow-packet");
      // Evidence advances through completed stages, not an unrelated travelling dot.
      rail.remove();
      packet.remove();
      flow.style.setProperty("--stickman-flow-duration", (ranges[ranges.length - 1][1] - ranges[0][0]) / fps * 1000 + "ms");
      flow.querySelectorAll("[id]").forEach(function (el) { el.removeAttribute("id"); });
      flow.querySelectorAll("[role=button]").forEach(function (el) { el.removeAttribute("role"); el.removeAttribute("tabindex"); });
      flow.removeAttribute("aria-labelledby"); flow.setAttribute("aria-label", "Baseline, Requirements, Total cost, Pilot");
      stage.appendChild(flow);
    }
    var state = { beat: 0, t0: 0, raf: 0, drawn: -1, activeProps: [] };
    var colors = palette(stage);

    function currentFrame() {
      var range = ranges[state.beat];
      if (clock.external !== null) {
        var e = timing.timeline[entryIndexAt(clock.external)];
        if (e.slide === slideId && e.beat === state.beat) return range[0] + Math.min(range[1] - range[0] - 1, Math.max(0, Math.floor(clock.external - e.start)));
      }
      var elapsed = Math.floor((performance.now() - state.t0) / 1000 * fps);
      return range[0] + Math.min(range[1] - range[0] - 1, Math.max(0, elapsed));
    }
    function draw(frame) {
      if (flow) {
        var enabled = deck.state().motion === "on" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        slot.setAttribute("data-flow-active", enabled ? "true" : "false");
        var elapsed = frame - ranges[0][0];
        flow.querySelectorAll(".flow-stage").forEach(function (node, i) {
          node.setAttribute("data-step-complete", frame >= film.events.evidence["artifact"+i] ? "true" : "false");
        });
        flow.getAnimations({ subtree: true }).forEach(function (animation) {
          animation.pause(); animation.currentTime = elapsed / fps * 1000;
        });
      }
      if (frame === state.drawn) return;
      state.drawn = frame;
      colors = palette(stage);
      var f = film.frames[frame];
      var local = frame - ranges[state.beat][0];
      var events = {};
      Object.keys(film.events[slideId]).forEach(function(name) {
        var at = film.events[slideId][name];
        if (frame >= at) events[name] = { frame: at, elapsed: frame-at };
      });
      var scenePart = sceneProps[slideId](state.beat, local, colors, film.roots[frame], events);
      state.activeProps = scenePart.props;
      back.innerHTML = paint(film.dict[f[0]], colors);
      props.innerHTML = scenePart.markup;
      actor.innerHTML = paint(film.dict[f[1]], colors);
      front.innerHTML = paint(film.dict[f[2]], colors);
      svg.setAttribute("data-frame", String(frame));
    }
    function tick() {
      state.raf = 0;
      draw(currentFrame());
      state.raf = requestAnimationFrame(tick);
    }
    return {
      ready: function () { return Promise.resolve(); },
      seek: function (beat, activeCueIds, options) {
        if (beat !== state.beat || state.t0 === 0) state.t0 = performance.now();
        state.beat = Math.max(0, Math.min(ranges.length - 1, beat));
        state.drawn = -1;
        if (!activeCueIds.length) { back.innerHTML = props.innerHTML = actor.innerHTML = front.innerHTML = ""; state.activeProps = []; }
        else if (options && options.static) draw(ranges[state.beat][1] - 1);
        else { draw(currentFrame()); if (!state.raf) state.raf = requestAnimationFrame(tick); }
        return { bounds: { x: 0, y: 0, w: scene.slot.w, h: scene.slot.h }, activeProps: state.activeProps.slice() };
      },
      cleanup: function () { if (state.raf) cancelAnimationFrame(state.raf); state.raf = 0; svg.remove(); if (flow) flow.remove(); }
    };
  }
  deck.registerMotionProvider({ id: film.provider, adapterVersion: "1.0",
    capabilities: { absoluteSeek: true, staticState: true, cleanup: true, offline: true, effects: ["perform", "flow"] }, mount: mount });

  // ---------- autoplay wrapper ----------
  var play = document.getElementById("play"), seek = document.getElementById("seek");
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var paused = new URLSearchParams(location.search).get("paused") === "1" || reduce;
  var playing = false, frame = 0, f0 = 0, t0 = 0, raf = 0, expected = null;
  var last = timing.totalFrames - 1;

  function sync(f, animate) {
    var i = entryIndexAt(f), e = timing.timeline[i], st = deck.state();
    if (st.slideId !== e.slide || st.beat !== e.beat) {
      var prev = expected !== null ? timing.timeline[expected] : null;
      if (animate && prev && expected === i - 1 && st.slideId === prev.slide && st.beat === prev.beat) document.getElementById("btn-next").click();
      else deck.goTo(e.slide, e.beat);
    }
    expected = i;
  }
  function setFrame(f, animate) {
    frame = Math.max(0, Math.min(last, f));
    clock.external = frame;
    sync(Math.floor(frame), animate);
    seek.value = String(Math.floor(frame));
    play.textContent = playing ? "Pause" : frame >= last ? "Replay" : "Play";
  }
  function stop() { playing = false; if (raf) cancelAnimationFrame(raf); raf = 0; play.textContent = frame >= last ? "Replay" : "Play"; }
  function loop(now) {
    raf = 0;
    if (!playing) return;
    var st = deck.state(), e = expected !== null ? timing.timeline[expected] : null;
    if (e && (st.slideId !== e.slide || st.beat !== e.beat)) { manual(); return; }
    var f = f0 + (now - t0) / 1000 * fps;
    if (f >= last) { setFrame(last, true); stop(); return; }
    setFrame(f, true);
    raf = requestAnimationFrame(loop);
  }
  function start() {
    if (frame >= last) setFrame(0, false);
    if (frame === 0) document.getElementById("btn-replay").click();
    playing = true; f0 = frame; t0 = performance.now();
    play.textContent = "Pause";
    // Embedded in the showcase: tell the host so it can pause its videos.
    if (window.parent !== window) window.parent.postMessage({ type: "stickman:play" }, location.origin);
    raf = requestAnimationFrame(loop);
  }
  window.addEventListener("message", function (event) {
    if (event.source !== window.parent || event.origin !== location.origin || !event.data || event.data.type !== "stickman:pause") return;
    stop();
  });
  // Manual navigation (keys, clicks, toolbar) hands control back to the deck and parks the timeline there.
  function manual() {
    stop();
    clock.external = null;
    var st = deck.state(), e = entryFor(st.slideId, st.beat);
    if (e) { frame = e.start; expected = timing.timeline.indexOf(e); seek.value = String(e.start); }
    play.textContent = "Play";
  }
  play.addEventListener("click", function () { if (playing) stop(); else start(); });
  seek.addEventListener("input", function () { stop(); setFrame(parseInt(seek.value, 10) || 0, false); });
  seek.addEventListener("keydown", function (e) { e.stopPropagation(); });
  seek.addEventListener("keyup", function () { stop(); setFrame(parseInt(seek.value, 10) || 0, false); });
  seek.addEventListener("change", function () { stop(); setFrame(parseInt(seek.value, 10) || 0, false); });
  setInterval(function () {
    if (playing || expected === null) return;
    var st = deck.state(), e = timing.timeline[expected];
    if (st.slideId !== e.slide || st.beat !== e.beat) manual();
  }, 250);
  window.StickmanDeckAutoplay = Object.freeze({
    totalFrames: timing.totalFrames, fps: fps,
    seek: function (f) { stop(); setFrame(f, false); },
    play: start, pause: stop,
    state: function () { return { frame: frame, playing: playing }; }
  });
  setFrame(0, false);
  if (!paused) start();
})();
