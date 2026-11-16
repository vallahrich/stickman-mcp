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
    room: "2.5D Isometric Room Datum · orthographic floor grid, W×D×H obstacle callouts, vertical ground projections, and occupiability check."
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
})();
