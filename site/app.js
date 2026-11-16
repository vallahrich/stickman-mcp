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
})();
