// Browser half of the stickman deck provider (see scripts/site/deck-provider.mjs).
// Injected after the dynamic-presentations runtime: registers an adapter-1.0 motion provider that draws the
// pre-composed stickman performance inside each scene slot, plus a timed autoplay wrapper (#play, #seek).
(function () {
  "use strict";
  var timing = JSON.parse(document.getElementById("data").textContent);
  var film = JSON.parse(document.getElementById("stickman-frames").textContent);
  var deck = window.DynamicDeck;
  if (!deck) return;
  var fps = timing.fps;
  var V = film.view;
  var clock = { external: null };
  window.StickmanDeckClock = clock;

  // Read the theme where the scene lives: decks scope --cp-accent and friends to their brand on .canvas.
  function palette(el) {
    var cs = getComputedStyle(el);
    var get = function (name, fallback) { return cs.getPropertyValue(name).trim() || fallback; };
    return { t: get("--cp-text", "#242424"), m: get("--cp-text-muted", "#5c5c5c"), a: get("--cp-accent", "#b11f4b"),
      s: get("--cp-surface", "#ffffff"), b: get("--cp-border-strong", "#919191"), l: get("--cp-border", "#dedede"),
      f: get("--cp-accent-fg", "#ffffff") };
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
      '" text-anchor="' + (anchor || "start") + '" font-family="Segoe UI, Aptos, sans-serif">' + label + "</text>";
  }
  function fade(o, markup) { return o <= 0.001 ? "" : o >= 0.999 ? markup : '<g opacity="' + r(o * 100) / 100 + '">' + markup + "</g>"; }

  // Demand over one illustrative day: low most of the time, one short peak.
  function demand(u) {
    var base = 0.13 + 0.03 * Math.sin(u * Math.PI * 4);
    var peak = 0.8 * Math.exp(-Math.pow((u - 0.74) / 0.06, 2));
    return Math.min(0.97, base + peak);
  }
  function loadMeter(beat, local, c) {
    var x = 700, y = 92, w = 335, h = 400, px = x + 28, pw = w - 56, top = y + 96, bottom = y + h - 44, ph = bottom - top;
    var o = beat === 0 ? ease((local - 20) / 30) : 1;
    var out = '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="16" fill="' + c.s + '" stroke="' + c.l + '" stroke-width="3"/>';
    out += text(x + 28, y + 44, "Server load", 26, c.t, 700) + text(x + 28, y + 72, "one illustrative day", 18, c.m, 500);
    var cap = beat === 0 ? ease((local - 40) / 120) : 1;
    var capY = bottom - ph * cap;
    out += '<line x1="' + px + '" y1="' + r(capY) + '" x2="' + (px + pw) + '" y2="' + r(capY) + '" stroke="' + c.t + '" stroke-width="4"/>';
    out += fade(ease((cap - 0.8) / 0.2), text(px + 4, r(capY) + 28, "capacity you bought", 18, c.t, 700));
    out += text(px, bottom + 28, "00:00", 15, c.m, 500) + text(px + pw, bottom + 28, "24:00", 15, c.m, 500, "end");
    out += '<line x1="' + px + '" y1="' + bottom + '" x2="' + (px + pw) + '" y2="' + bottom + '" stroke="' + c.b + '" stroke-width="2"/>';
    if (beat >= 1) {
      var draw = beat === 1 ? ease(local / 70) : 1, n = 60, pts = [];
      for (var i = 0; i <= n * draw; i++) { var u = i / n; pts.push(r(px + pw * u) + " " + r(bottom - ph * demand(u))); }
      if (pts.length > 1) {
        if (beat === 2) out += '<path d="M' + px + " " + r(capY) + "H" + (px + pw) + "V" + bottom + "H" + px + 'Z" fill="' + c.a + '" fill-opacity="0.09"/>';
        out += '<path d="M' + pts.join("L") + '" fill="none" stroke="' + c.a + '" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>';
      }
      var avgO = beat === 1 ? ease((local - 75) / 20) : 1, avgY = bottom - ph * 0.18;
      out += fade(avgO, '<line x1="' + px + '" y1="' + r(avgY) + '" x2="' + (px + pw) + '" y2="' + r(avgY) + '" stroke="' + c.t + '" stroke-width="3" stroke-dasharray="10 8"/>' +
        text(px + 4, r(avgY) - 12, "average 18%", 20, c.t, 700));
      var peakO = beat === 1 ? ease((local - 50) / 20) : 1;
      out += fade(peakO, text(px + pw * 0.74 + 20, r(bottom - ph * 0.6), "peak", 20, c.a, 700, "start"));
      var idleY = r(capY + (avgY - capY) * 0.5);
      if (beat === 2) out += fade(ease(local / 25), text(px + pw * 0.27, idleY, "idle", 30, c.m, 700, "middle") +
        text(px + pw * 0.27, idleY + 26, "most of the day", 18, c.m, 600, "middle"));
    }
    var result = { markup: fade(o, out), props: o > 0.001 ? ["load-meter"] : [] };
    // Upkeep that stays with you: chores pile up above the rack while the admin checks the clock.
    if (beat === 2) {
      var chores = [["patch", 444, 262], ["power", 468, 214], ["spares", 452, 166]], pile = "";
      chores.forEach(function (chore, k) {
        var a = ease((local - 6 - k * 14) / 14), wdt = chore[0].length * 12 + 34;
        pile += fade(a, '<g transform="translate(0 ' + r((1 - a) * -16) + ')"><rect x="' + r(chore[1] - wdt / 2) + '" y="' + (chore[2] - 26) + '" width="' + r(wdt) +
          '" height="38" rx="8" fill="' + c.s + '" stroke="' + c.a + '" stroke-width="3"/>' + text(chore[1], chore[2], chore[0], 20, c.t, 700, "middle") + "</g>");
      });
      if (pile) { result.markup += pile; result.props.push("upkeep-tags"); }
    }
    return result;
  }

  function cloudShape(cx, cy, k, fill, stroke) {
    return '<path d="M' + r(cx - 110 * k) + " " + r(cy + 40 * k) + "a" + r(45 * k) + " " + r(45 * k) + " 0 0 1 " + r(18 * k) + " " + r(-86 * k) +
      "a" + r(62 * k) + " " + r(62 * k) + " 0 0 1 " + r(112 * k) + " " + r(-22 * k) + "a" + r(48 * k) + " " + r(48 * k) + " 0 0 1 " + r(86 * k) + " " + r(40 * k) +
      "a" + r(40 * k) + " " + r(40 * k) + " 0 0 1 " + r(4 * k) + " " + r(68 * k) + 'Z" fill="' + fill + '" stroke="' + stroke + '" stroke-width="4" stroke-linejoin="round"/>';
  }
  function cloudScene(beat, local, c) {
    var cx = 830, cy = 215, k = 1.05;
    var o = beat === 0 ? ease((local - 30) / 30) : 1;
    var out = cloudShape(cx, cy, k, c.s, c.a) + text(cx - 6, cy + 6, "cloud", 26, c.a, 700, "middle");
    var bars = 7, bx = 650, bw = 360, base = 470, maxH = 150, gap = 10, w = (bw - gap * (bars - 1)) / bars;
    // Demand moves; in beat 0 capacity stays flat, from beat 1 it follows demand with a short lag.
    var t = (beat === 0 ? 0 : beat === 1 ? local : 400 + local) / fps;
    var line = [], props = ["cloud"];
    for (var i = 0; i < bars; i++) {
      var phase = t * 1.3 + i * 0.75;
      var need = 0.34 + 0.26 * Math.sin(phase) + 0.12 * Math.sin(phase * 2.3 + 1);
      var follow = beat === 0 ? 0.45 : clamp(0.34 + 0.26 * Math.sin(phase - 0.35) + 0.12 * Math.sin((phase - 0.35) * 2.3 + 1) + 0.06);
      var hgt = Math.max(6, maxH * follow), x = bx + i * (w + gap);
      out += '<rect x="' + r(x) + '" y="' + r(base - hgt) + '" width="' + r(w) + '" height="' + r(hgt) + '" rx="5" fill="' + c.a + '" opacity="0.85"/>';
      line.push(r(x + w / 2) + " " + r(base - maxH * need));
    }
    out += '<line x1="' + (bx - 8) + '" y1="' + base + '" x2="' + (bx + bw + 8) + '" y2="' + base + '" stroke="' + c.b + '" stroke-width="2"/>';
    out += '<path d="M' + r(cx - 6) + " " + r(cy + 44 * k) + "V" + (base - maxH - 18) + '" stroke="' + c.a + '" stroke-width="3" stroke-dasharray="6 7"/>';
    out += text(bx, base + 30, "capacity", 18, c.a, 700);
    props.push("capacity-bars");
    if (beat >= 1) out += fade(ease(local / 25), '<path d="M' + line.join("L") + '" fill="none" stroke="' + c.t + '" stroke-width="4" stroke-dasharray="2 9" stroke-linecap="round"/>' +
      text(bx + bw, base + 30, "demand ···", 18, c.t, 700, "end"));
    if (beat === 2) {
      var tags = ["migration effort", "egress $", "always-on $"], tx = 560, tagMarkup = "";
      tags.forEach(function (tag, n) {
        var a = ease((local - 10 - n * 18) / 18), wdt = tag.length * 10 + 28;
        tagMarkup += fade(a, '<g transform="translate(0 ' + r((1 - a) * 18) + ')"><rect x="' + r(tx) + '" y="510" width="' + r(wdt) + '" height="38" rx="19" fill="' + c.s + '" stroke="' + c.t + '" stroke-width="2.5"/>' +
          text(tx + wdt / 2, 536, tag, 18, c.t, 700, "middle") + "</g>");
        tx += wdt + 14;
      });
      out += tagMarkup;
      props.push("cost-tags");
    }
    return { markup: fade(o, out), props: o > 0.001 ? props : [] };
  }
  var stages = [["Measure", 285], ["Validate", 495], ["Compare cost", 705], ["Pilot", 915]];
  function evidenceScene(beat, local, c, rootX) {
    var out = "";
    var y = 120, h = 66, w = 186;
    for (var i = 0; i < stages.length; i++) {
      var sx = stages[i][1];
      var reached = rootX >= sx - 24 || (beat === 2 && i < 3) || (beat >= 1 && i === 0);
      var active = reached ? 1 : 0;
      var fill = active ? c.a : c.s, ink = active ? c.f : c.t;
      out += '<rect x="' + (sx - w / 2) + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="12" fill="' + fill + '" stroke="' + (active ? c.a : c.b) + '" stroke-width="3"/>';
      out += text(sx, y + 42, stages[i][0], 23, ink, 700, "middle");
      // Each reached step leaves a piece of evidence behind.
      var proof = ["baseline", "dependency map", "cost model", "pilot result"][i];
      if (active) out += '<circle cx="' + (sx - 70) + '" cy="' + (y + h + 46) + '" r="11" fill="none" stroke="' + c.a + '" stroke-width="3"/>' +
        '<path d="M' + (sx - 75) + " " + (y + h + 46) + "l4 4 7-8" + '" fill="none" stroke="' + c.a + '" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
        text(sx - 52, y + h + 52, proof, 18, c.m, 600);
      if (i < stages.length - 1) {
        var ax = sx + w / 2 + 6, bx = stages[i + 1][1] - w / 2 - 6;
        out += '<path d="M' + ax + " " + (y + h / 2) + "H" + bx + "m-8 -8l8 8-8 8" + '" fill="none" stroke="' + c.b + '" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>';
      }
    }
    out += '<line x1="' + (stages[0][1]) + '" y1="' + (y + h + 10) + '" x2="' + r(Math.max(stages[0][1], Math.min(rootX, stages[3][1]))) + '" y2="' + (y + h + 10) + '" stroke="' + c.a + '" stroke-width="5" stroke-linecap="round"/>';
    return { markup: out, props: ["step-markers"] };
  }

  var sceneProps = { "on-prem": loadMeter, cloud: cloudScene, evidence: evidenceScene };

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
    var actor = document.createElementNS(svgNS, "g"), front = document.createElementNS(svgNS, "g");
    actor.setAttribute("data-stickman-actor", "");
    back.innerHTML = "";
    svg.appendChild(back); svg.appendChild(props); svg.appendChild(actor); svg.appendChild(front);
    stage.appendChild(svg);
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
      if (frame === state.drawn) return;
      state.drawn = frame;
      colors = palette(stage);
      var f = film.frames[frame];
      var local = frame - ranges[state.beat][0];
      var scenePart = sceneProps[slideId](state.beat, local, colors, film.roots[frame]);
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
      cleanup: function () { if (state.raf) cancelAnimationFrame(state.raf); state.raf = 0; svg.remove(); }
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
