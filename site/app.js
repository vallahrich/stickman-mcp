(() => {
  const section = document.getElementById("blueprint");
  const motionSelect = document.getElementById("motionMode");

  const syncDocumentMotionMode = () => {
    if (!motionSelect) return;
    document.documentElement.setAttribute("data-motion-mode", motionSelect.value);
  };
  if (motionSelect) {
    syncDocumentMotionMode();
    motionSelect.addEventListener("change", syncDocumentMotionMode);
  }

  if (!section) return;

  const buttons = [...section.querySelectorAll("[data-blueprint-view]")];
  const panels = [...section.querySelectorAll("[data-blueprint-panel]")];
  const status = document.getElementById("blueprintViewStatus");

  const descriptions = {
    cad: "CAD Dimensional Blueprint · monochrome orthographic panels with 144u rig leaders, L/C/R anchor ticks, and T+0.00s timecodes.",
    standard: "Standard Contact Sheet · 8 key-beat panels per scene with non-scaling ground datum hairlines and cue markers.",
    room: "2.5D Isometric Room Datum · orthographic floor grid, W×D×H obstacle callouts, vertical ground projections, and occupiability check.",
    stage: "Full-Stage Hatched CAD Blueprint · live animated 800×450 blueprint stage with diagonal prop hatching, dashed ground datum, anchor ticks, and moving 144u rig callouts."
  };

  function selectView(viewId, focusButton = false) {
    for (const button of buttons) {
      const active = button.dataset.blueprintView === viewId;
      button.setAttribute("aria-pressed", active ? "true" : "false");
      if (active && focusButton) button.focus();
    }
    for (const panel of panels) {
      panel.hidden = panel.dataset.blueprintPanel !== viewId;
    }
    if (status && descriptions[viewId]) {
      status.textContent = descriptions[viewId];
    }
  }

  for (let index = 0; index < buttons.length; index++) {
    const button = buttons[index];
    button.addEventListener("click", () => selectView(button.dataset.blueprintView));
    button.addEventListener("keydown", (event) => {
      let nextIndex = -1;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % buttons.length;
      else if (event.key === "ArrowLeft") nextIndex = (index - 1 + buttons.length) % buttons.length;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = buttons.length - 1;
      if (nextIndex >= 0) {
        event.preventDefault();
        selectView(buttons[nextIndex].dataset.blueprintView, true);
      }
    });
  }

  const scroller = section.querySelector("[data-scroll-scrub-demo]");
  const scrubStage = document.getElementById("bp-scroll-stage");
  const timecodeOut = document.getElementById("scrollScrubTimecode");
  const progressOut = document.getElementById("scrollScrubProgress");
  const actionOut = document.getElementById("scrollScrubAction");
  const rangeInput = document.getElementById("scrollScrubRange");

  if (scroller && scrubStage) {
    const slices = [...scrubStage.querySelectorAll("[data-scrub-slice]")];
    const steps = [...scroller.querySelectorAll("[data-scrub-step]")];
    const durationMs = Number(scroller.dataset.durationMs) || 0;
    const reducedMql = window.matchMedia("(prefers-reduced-motion: reduce)");

    const isReducedScrub = () => {
      const modeVal = motionSelect ? motionSelect.value : "auto";
      if (modeVal === "normal") return false;
      if (modeVal === "reduced" || modeVal === "static") return true;
      return reducedMql.matches;
    };

    const applyScrubProgress = (rawProgress, syncRange = true) => {
      if (slices.length === 0) return;
      const p = Math.max(0, Math.min(1, rawProgress));
      const activeIdx = Math.min(slices.length - 1, Math.round(p * (slices.length - 1)));
      for (let i = 0; i < slices.length; i++) {
        const slice = slices[i];
        if (i === activeIdx) {
          slice.removeAttribute("hidden");
          slice.setAttribute("data-active", "true");
        } else {
          slice.setAttribute("hidden", "");
          slice.removeAttribute("data-active");
        }
      }
      const currentMs = p * durationMs;
      scrubStage.setAttribute("data-active-slice", String(activeIdx));
      scrubStage.setAttribute("data-active-time-ms", String(Math.round(currentMs)));
      if (timecodeOut) {
        timecodeOut.textContent = `${(currentMs / 1000).toFixed(2)}s / ${(durationMs / 1000).toFixed(2)}s`;
      }
      if (progressOut) {
        progressOut.textContent = `${Math.round(p * 100)}%`;
      }
      if (actionOut) {
        const activeAction = slices[activeIdx].getAttribute("data-action") || "pose";
        actionOut.textContent = `frame ${String(activeIdx + 1).padStart(2, "0")}/${String(slices.length).padStart(2, "0")} · ${activeAction}`;
      }
      if (syncRange && rangeInput) {
        rangeInput.value = String(Math.round(p * 1000));
      }
      let activeStepIdx = 0;
      for (let i = 0; i < steps.length; i++) {
        const minP = Number(steps[i].dataset.stepMin) || 0;
        if (p + 0.001 >= minP) activeStepIdx = i;
      }
      for (let i = 0; i < steps.length; i++) {
        if (i === activeStepIdx) steps[i].setAttribute("data-step-active", "true");
        else steps[i].removeAttribute("data-step-active");
      }
    };

    const syncFromScroll = () => {
      if (isReducedScrub()) {
        applyScrubProgress(1, true);
        return;
      }
      const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const progress = maxScroll > 0 ? Math.max(0, Math.min(1, scroller.scrollTop / maxScroll)) : 0;
      applyScrubProgress(progress, true);
    };

    scroller.addEventListener("scroll", syncFromScroll, { passive: true });
    window.addEventListener("resize", syncFromScroll, { passive: true });
    reducedMql.addEventListener("change", syncFromScroll);
    if (motionSelect) {
      motionSelect.addEventListener("change", syncFromScroll);
    }

    if (rangeInput) {
      rangeInput.addEventListener("input", () => {
        if (isReducedScrub()) {
          applyScrubProgress(1, true);
          return;
        }
        const nextP = Math.max(0, Math.min(1, Number(rangeInput.value) / 1000));
        const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        scroller.scrollTop = nextP * maxScroll;
        applyScrubProgress(nextP, false);
      });
    }

    scroller.addEventListener("keydown", (event) => {
      if (isReducedScrub()) return;
      const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      if (maxScroll <= 0) return;
      const currentP = scroller.scrollTop / maxScroll;
      let nextP = null;
      if (event.key === "ArrowDown" || event.key === "ArrowRight") nextP = currentP + 0.1;
      else if (event.key === "ArrowUp" || event.key === "ArrowLeft") nextP = currentP - 0.1;
      else if (event.key === "PageDown") nextP = currentP + 0.25;
      else if (event.key === "PageUp") nextP = currentP - 0.25;
      else if (event.key === "Home") nextP = 0;
      else if (event.key === "End") nextP = 1;
      if (nextP !== null) {
        event.preventDefault();
        const clamped = Math.max(0, Math.min(1, nextP));
        scroller.scrollTop = clamped * maxScroll;
        applyScrubProgress(clamped, true);
      }
    });

    syncFromScroll();
  }

  // Interactive v0.3.0 Movie, Camera & Critique Studio
  const studioSection = document.getElementById("studio");
  const studioDataEl = document.getElementById("studioData");
  if (studioSection && studioDataEl && typeof mountStickmanCompactPlayer === "function") {
    const studioData = JSON.parse(studioDataEl.textContent || "{}");
    const presets = Array.isArray(studioData.presets) ? studioData.presets : [];
    const axes = Array.isArray(studioData.axes) ? studioData.axes : [];
    const bpDefsMarkup = typeof studioData.bpDefsMarkup === "string" ? studioData.bpDefsMarkup : "";

    const presetButtons = [...studioSection.querySelectorAll("[data-studio-preset]")];
    const styleButtons = [...studioSection.querySelectorAll("[data-studio-style]")];
    const summaryEl = document.getElementById("studioPresetSummary");
    const stageEl = document.getElementById("studioStage");
    const chaptersEl = document.getElementById("studioChapters");
    const toggleBtn = document.getElementById("studioToggle");
    const seekEl = document.getElementById("studioSeek");
    const timecodeEl = document.getElementById("studioTimecode");
    const overallBadgeEl = document.getElementById("studioOverallBadge");
    const contractPillEl = document.getElementById("studioContractPill");
    const sizePillEl = document.getElementById("studioSizePill");
    const oobPillEl = document.getElementById("studioOobPill");
    const axesEl = document.getElementById("studioAxes");

    let activePresetId = presets[0] ? presets[0].id : "";
    let activeStyle = "default";
    let activePayload = null;
    let studioPlayer = null;
    let playing = false;
    let curMs = 0;
    let rafId = null;
    let lastTs = 0;

    const getPreset = (id) => presets.find((p) => p.id === id) || presets[0] || null;

    const stopStudioLoop = () => {
      playing = false;
      lastTs = 0;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (toggleBtn) {
        toggleBtn.textContent = "Play";
        toggleBtn.setAttribute("aria-pressed", "false");
      }
    };

    const syncStudioTimeUi = () => {
      const dur = activePayload ? activePayload.dur : 0;
      if (seekEl) {
        seekEl.max = String(dur);
        seekEl.value = String(Math.round(curMs));
      }
      if (timecodeEl) {
        timecodeEl.textContent = `${(curMs / 1000).toFixed(2)}s / ${(dur / 1000).toFixed(2)}s`;
      }
      if (chaptersEl && activePayload && activePayload.kind === "movie") {
        const scenes = activePayload.sc || [];
        let activeSceneId = scenes[0] ? scenes[0].id : "";
        for (let i = 0; i < scenes.length; i++) {
          if (curMs < scenes[i].e || i === scenes.length - 1) {
            activeSceneId = scenes[i].id;
            break;
          }
        }
        for (const btn of chaptersEl.querySelectorAll("[data-scene-id]")) {
          btn.setAttribute("aria-current", btn.getAttribute("data-scene-id") === activeSceneId ? "true" : "false");
        }
      }
    };

    const stepStudioLoop = (now) => {
      rafId = null;
      if (!playing || !studioPlayer || !activePayload) return;
      if (lastTs) {
        curMs += Math.max(0, now - lastTs);
      }
      lastTs = now;
      if (curMs >= activePayload.dur) {
        curMs = activePayload.dur;
        studioPlayer.seek(curMs);
        syncStudioTimeUi();
        stopStudioLoop();
        return;
      }
      studioPlayer.seek(curMs);
      syncStudioTimeUi();
      rafId = requestAnimationFrame(stepStudioLoop);
    };

    const startStudioLoop = () => {
      if (!studioPlayer || !activePayload) return;
      if (curMs >= activePayload.dur) curMs = 0;
      playing = true;
      lastTs = 0;
      if (toggleBtn) {
        toggleBtn.textContent = "Pause";
        toggleBtn.setAttribute("aria-pressed", "true");
      }
      studioPlayer.seek(curMs);
      syncStudioTimeUi();
      rafId = requestAnimationFrame(stepStudioLoop);
    };

    const renderCritiqueCard = (preset) => {
      if (!preset || !preset.critique) return;
      const c = preset.critique;
      if (overallBadgeEl) {
        overallBadgeEl.textContent = `${Number(c.overallScore).toFixed(1)} / 10 · ${c.passed ? "PASS" : "POLISH"}`;
        overallBadgeEl.className = `studio-overall-badge ${c.passed ? "studio-pass" : "studio-warn"}`;
      }
      if (contractPillEl) contractPillEl.textContent = preset.contractTag;
      if (sizePillEl) sizePillEl.textContent = `${(preset.htmlBytes / 1024).toFixed(1)} KB HTML`;
      if (oobPillEl) oobPillEl.textContent = `${c.outOfBoundsCount} out-of-bounds`;
      if (axesEl) {
        axesEl.replaceChildren();
        for (const axis of axes) {
          const val = Number(c.dimensions[axis.key] || 0);
          const pct = Math.max(0, Math.min(100, Math.round((val / 10) * 100)));
          const li = document.createElement("li");
          li.className = "studio-axis-row";
          li.dataset.studioAxis = axis.key;

          const head = document.createElement("div");
          head.className = "studio-axis-head";
          const labelSpan = document.createElement("span");
          labelSpan.textContent = axis.label;
          const valStrong = document.createElement("strong");
          valStrong.className = "studio-axis-val";
          valStrong.textContent = `${val.toFixed(1)} / 10`;
          head.append(labelSpan, valStrong);

          const track = document.createElement("div");
          track.className = "studio-axis-track";
          track.setAttribute("role", "progressbar");
          track.setAttribute("aria-label", axis.label);
          track.setAttribute("aria-valuemin", "0");
          track.setAttribute("aria-valuemax", "10");
          track.setAttribute("aria-valuenow", val.toFixed(1));
          const fill = document.createElement("div");
          fill.className = "studio-axis-fill";
          fill.style.width = `${pct}%`;
          track.append(fill);

          li.append(head, track);
          axesEl.append(li);
        }
      }
    };

    const mountStudioPreset = (presetId, style, preserveTime = false) => {
      stopStudioLoop();
      const preset = getPreset(presetId);
      if (!preset || !stageEl) return;
      activePresetId = preset.id;
      activeStyle = style === "blueprint" ? "blueprint" : "default";
      activePayload = preset.payloads[activeStyle] || preset.payloads.default;

      for (const btn of presetButtons) {
        btn.setAttribute("aria-pressed", btn.dataset.studioPreset === activePresetId ? "true" : "false");
      }
      for (const btn of styleButtons) {
        btn.setAttribute("aria-pressed", btn.dataset.studioStyle === activeStyle ? "true" : "false");
      }
      if (summaryEl) summaryEl.textContent = preset.summary;

      const isBp = activeStyle === "blueprint";
      const w = activePayload.w || 800;
      const h = activePayload.h || 450;
      const firstSc = activePayload.sc[0] || { bg: "#ffffff", gy: Math.round(h * 0.82) };
      const defsHtml = isBp ? `<defs>${bpDefsMarkup}</defs>` : "";
      const bgMarkup = isBp
        ? `<rect width="100%" height="100%" fill="#f8fafc"/><rect width="100%" height="100%" fill="url(#sm-bp-grid)"/><rect x="1.5" y="1.5" width="${Math.max(1, w - 3)}" height="${Math.max(1, h - 3)}" fill="none" stroke="#cbd5e1" stroke-width="1"/><path id="studioGround" d="M0 ${firstSc.gy}H${w}" fill="none" stroke="#1e3a5f" stroke-width="1" stroke-dasharray="4 3"/>`
        : `<rect width="100%" height="100%" fill="${firstSc.bg || "#ffffff"}"/><path id="studioGround" d="M0 ${firstSc.gy}H${w}" stroke="#d8dbe0" stroke-width="1"/>`;

      stageEl.setAttribute("data-active-preset", activePresetId);
      stageEl.setAttribute("data-active-style", activeStyle);
      stageEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${preset.label} interactive vector stage" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${defsHtml}${bgMarkup}<g id="studioScene"></g></svg>`;

      if (chaptersEl) {
        chaptersEl.replaceChildren();
        if (activePayload.kind === "movie" && activePayload.sc.length > 1) {
          chaptersEl.hidden = false;
          for (let i = 0; i < activePayload.sc.length; i++) {
            const sc = activePayload.sc[i];
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "studio-chapter-btn";
            btn.dataset.sceneId = sc.id;
            btn.dataset.sceneJump = String(sc.s || 0);
            btn.textContent = `S${i + 1} · ${sc.ti || sc.id}`;
            btn.addEventListener("click", () => {
              curMs = Number(sc.s || 0);
              if (studioPlayer) studioPlayer.seek(curMs);
              syncStudioTimeUi();
            });
            chaptersEl.append(btn);
          }
        } else {
          chaptersEl.hidden = true;
        }
      }

      const svgNode = stageEl.querySelector("svg");
      const sceneNode = stageEl.querySelector("#studioScene");
      const groundNode = stageEl.querySelector("#studioGround");
      studioPlayer = mountStickmanCompactPlayer(activePayload, {
        svg: svgNode,
        sceneEl: sceneNode,
        groundEl: groundNode,
        seek: null,
        toggle: null,
        modeSelect: null,
        timecode: null
      });
      studioPlayer.stop();
      curMs = preserveTime
        ? Math.max(0, Math.min(activePayload.dur, curMs))
        : Math.max(0, Math.min(activePayload.dur, Number(preset.initialMs) || 0));
      studioPlayer.seek(curMs);
      renderCritiqueCard(preset);
      syncStudioTimeUi();
    };

    for (let i = 0; i < presetButtons.length; i++) {
      const btn = presetButtons[i];
      btn.addEventListener("click", () => mountStudioPreset(btn.dataset.studioPreset, activeStyle, false));
      btn.addEventListener("keydown", (event) => {
        let next = -1;
        if (event.key === "ArrowRight") next = (i + 1) % presetButtons.length;
        else if (event.key === "ArrowLeft") next = (i - 1 + presetButtons.length) % presetButtons.length;
        if (next >= 0) {
          event.preventDefault();
          presetButtons[next].focus();
          mountStudioPreset(presetButtons[next].dataset.studioPreset, activeStyle, false);
        }
      });
    }

    for (const btn of styleButtons) {
      btn.addEventListener("click", () => mountStudioPreset(activePresetId, btn.dataset.studioStyle, true));
    }

    if (toggleBtn) {
      toggleBtn.addEventListener("click", () => {
        if (playing) stopStudioLoop();
        else startStudioLoop();
      });
    }

    if (seekEl) {
      seekEl.addEventListener("input", () => {
        stopStudioLoop();
        curMs = Math.max(0, Math.min(activePayload ? activePayload.dur : 0, Number(seekEl.value) || 0));
        if (studioPlayer) studioPlayer.seek(curMs);
        syncStudioTimeUi();
      });
    }

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stopStudioLoop();
    });

    if (presets.length > 0) {
      mountStudioPreset(presets[0].id, "default", false);
    }
  }
})();
