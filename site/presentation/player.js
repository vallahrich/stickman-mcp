(() => {
  "use strict";
  const data = JSON.parse(document.getElementById("presentation-data").textContent);
  const embeddedMedia = document.getElementById("presentation-media");
  data.media = JSON.parse(embeddedMedia.textContent);
  embeddedMedia.remove();
  const $ = id => document.getElementById(id);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const state = { slide: 0, beat: 0, progress: 1, animation: !reduced.matches, playing: false, demoStarted: false };
  let raf = 0, generation = 0, video = null, videoUrl = null;
  const parameterTheme = new URLSearchParams(location.search).get("scoutTheme");
  if (parameterTheme === "light" || parameterTheme === "dark") document.documentElement.dataset.theme = parameterTheme;
  const current = () => data.slides[state.slide];
  const beat = () => current().beats[state.beat];
  const mediaUrl = id => {
    const asset = data.media[id];
    if (!asset) throw new Error(`Missing embedded media: ${id}`);
    return `data:${asset.mime};base64,${asset.base64}`;
  };
  function report(error) {
    $("error").hidden = false;
    $("error").textContent = error instanceof Error ? error.message : String(error);
  }
  function cancel() {
    generation++;
    cancelAnimationFrame(raf);
    raf = 0;
  }
  function resetDemo() {
    if (!video) return;
    video.pause();
    video.currentTime = 0;
    state.demoStarted = false;
    video.hidden = true;
  }
  function releaseVideo() {
    if (video) {
      const outgoing = video;
      video = null;
      outgoing.pause();
      outgoing.removeAttribute("src");
      outgoing.load();
    }
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    videoUrl = null;
    state.playing = false;
    state.demoStarted = false;
  }
  function resize() {
    const frame = $("stage").parentElement;
    const scale = frame.clientWidth / 1280;
    $("stage").style.transform = `scale(${scale})`;
    frame.style.height = `${720 * scale}px`;
  }
  function iconMarkup(kind, x, y) {
    if (kind === "database") return `<g class="icon" transform="translate(${x} ${y})"><ellipse cx="0" cy="0" rx="14" ry="5"/><path d="M-14 0v22c0 7 28 7 28 0V0M-14 11c0 7 28 7 28 0"/></g>`;
    if (kind === "notebook") return `<g class="icon" transform="translate(${x} ${y})"><rect x="-14" y="-6" width="28" height="30" rx="3"/><path d="M-20 0h10M-20 8h10M-20 16h10M-5 3h13M-5 10h13"/></g>`;
    if (kind === "mail") return `<g class="icon" transform="translate(${x} ${y})"><rect x="-16" y="-4" width="32" height="24" rx="3"/><path d="m-16-4 16 13 16-13"/></g>`;
    if (kind === "dashboard") return `<g class="icon" transform="translate(${x} ${y})"><rect x="-16" y="-6" width="32" height="26" rx="3"/><path d="M-8 14V7M0 14V0M8 14V4"/></g>`;
    return "";
  }
  function diagramMarkup(slide) {
    const edgeMarkup = edge => {
      const d = edge.points.map(([x, y], index) => `${index ? "L" : "M"}${x} ${y}`).join(" ");
      const label = edge.label ? `<text class="edge-label" ${edge.label.onlyActive ? `data-label-target="${xml(edge.id)}"` : ""} x="${edge.label.x}" y="${edge.label.y}" text-anchor="${edge.label.align === "middle" ? "middle" : "start"}">${xml(edge.label.text)}</text>` : "";
      return `<g data-component="${xml(edge.id)}"><path class="edge ${edge.dashed ? "dashed" : ""} ${edge.activeOnly ? "active-only" : ""}" data-target="${xml(edge.id)}" d="${d}" ${edge.arrow === false ? "" : 'marker-end="url(#arrow)"'}/>${label}</g>`;
    };
    const edges = (slide.edges ?? []).filter(edge => !edge.foreground).map(edgeMarkup).join("");
    const foreground = (slide.edges ?? []).filter(edge => edge.foreground).map(edgeMarkup).join("");
    const nodes = (slide.nodes ?? []).map(node => {
      const center = node.align === "center";
      const tx = center ? node.x + node.width / 2 : node.x + (node.icon ? 64 : 24);
      const ty = node.y + (node.labelY ?? (node.kicker ? 62 : 50));
      const label = node.label.map((text, index) => `<tspan x="${tx}" dy="${index ? 29 : 0}">${xml(text)}</tspan>`).join("");
      return `<g data-component="${xml(node.id)}"><rect class="node ${node.shape === "plain" ? "plain" : ""} ${node.shape === "band" ? "band" : ""} ${node.layer === "foundation" ? "foundation" : ""}" data-target="${xml(node.id)}" x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${node.shape === "band" ? 12 : 10}"/>
        ${node.kicker ? `<text class="node-kicker" x="${node.x+24}" y="${node.y+29}">${xml(node.kicker)}</text>` : ""}
        ${iconMarkup(node.icon, node.x+35, ty-8)}
        <text class="node-label" ${node.shape === "plain" ? `data-plain-label="${xml(node.id)}"` : ""} x="${tx}" y="${ty}" text-anchor="${center ? "middle" : "start"}" ${node.fontSize ? `style="font-size:${Number(node.fontSize)}px"` : ""}>${label}</text></g>`;
    }).join("");
    return `<svg class="diagram" viewBox="0 0 1280 720" role="img" aria-label="${xml(slide.diagramLabel ?? slide.title)}">
      <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--cp-border-strong)"/></marker></defs>${edges}${nodes}${foreground}</svg>`;
  }
  function payloadMarkup(prop, payload) {
    const { x, y, w, h } = prop;
    const left = x + w * .17, right = x + w * .83;
    const top = y + h * .12, bottom = y + h * .5;
    const fontSize = Math.min(16, h * .24, w / (payload.label.length * .65 + 1));
    const detail = payload.type === "table"
      ? `M${left} ${top}H${right}V${bottom}H${left}ZM${left} ${(top+bottom)/2}H${right}M${(left+right)/2} ${top}V${bottom}`
      : `M${left} ${top}H${right}V${bottom}H${left}ZM${left+w*.08} ${top+h*.12}H${right-w*.08}M${left+w*.08} ${top+h*.24}H${right-w*.08}`;
    return `<g data-payload="${xml(payload.type)}" opacity="${num(prop.opacity ?? 1)}">
      <rect class="data-packet" data-prop="data-packet" x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}" rx="4"/>
      <path class="payload-detail" d="${detail}"/>
      <text class="data-packet-label" x="${num(x+w/2)}" y="${num(y+h*.87)}" style="font-size:${num(fontSize)}px" text-anchor="middle">${xml(payload.label)}</text></g>`;
  }
  function focusImage(image, detail, focus) {
    const shown = focus && image.naturalWidth > 0;
    detail.toggleAttribute("hidden", !shown);
    image.hidden = Boolean(shown);
    if (shown) {
      const width = image.naturalWidth, height = image.naturalHeight;
      detail.setAttribute("viewBox", `${focus.left*width} ${focus.top*height} ${focus.width*width} ${focus.height*height}`);
      detail.querySelector("image").setAttribute("width", String(width));
      detail.querySelector("image").setAttribute("height", String(height));
    }
  }
  function actorScene(actor, progress) {
    const motion = data.motions[actor.motion];
    const frame = actor.from + (actor.to-actor.from) * progress;
    const stage = { rootX: actor.x, groundY: actor.groundY, scale: actor.scale };
    const sample = engineSampledFrame(sampleClipMotion, motion.clip, frame, stage);
    const geometry = ENGINE_FRAME_GEOMETRY(sample);
    let props = [];
    if (actor.scene) {
      const spec = structuredClone(motion.spec);
      if (actor.keepProps && spec.review?.prop) {
        delete spec.review.prop.enter;
        delete spec.review.prop.exit;
      }
      props = layoutScene(spec, data.propsCatalog, frame, (index, side) =>
        pointFromSample(engineSampledFrame(sampleClipMotion, motion.clip, index, stage), side), stage);
    }
    const markup = props.map(prop => actor.payload && prop.type === "box"
      ? payloadMarkup(prop, actor.payload)
      : scenePropMarkup(prop, geometry.strokeWidth, "var(--cp-text)")).join("");
    return { frame, sample, geometry, markup: markup.replace(/\b(fill|stroke)="(#[0-9a-f]{3,8})"/gi, (_, attribute, color) =>
      `${attribute}="${attribute === "stroke" ? "var(--cp-text-muted)" : /^#(?:fff|ffffff)$/i.test(color) ? "var(--cp-surface)" : "var(--cp-surface-soft)"}"`) };
  }
  function paint() {
    const activeBeat = state.progress < .55 && state.beat > 0 ? current().beats[state.beat-1] : beat();
    const active = new Set(activeBeat.active ?? []);
    $("stage").querySelectorAll("[data-target]").forEach(node => node.classList.toggle("active", active.has(node.dataset.target)));
    $("stage").querySelectorAll("[data-component]").forEach(node => {
      const shown = !activeBeat.visible || activeBeat.visible.includes(node.dataset.component);
      node.style.display = shown ? "" : "none";
      node.setAttribute("aria-hidden", String(!shown));
    });
    $("stage").querySelectorAll("[data-plain-label]").forEach(node =>
      node.classList.toggle("emphasized", active.has(node.dataset.plainLabel)));
    $("stage").querySelectorAll("[data-label-target]").forEach(node => { node.style.display = active.has(node.dataset.labelTarget) ? "" : "none"; });
    for (const image of current().images ?? []) {
      const frame = $(`image-${image.id}`);
      focusImage(frame.querySelector("img"), frame.querySelector("svg"), activeBeat.imageFocus?.[image.id]);
    }
    $("caption").textContent = beat().caption;
    const actor = beat().actor;
    const layer = $("actor");
    const movieVisible = current().video && (state.beat > (current().video.revealBeat ?? 0) ||
      (state.beat === (current().video.revealBeat ?? 0) && (!current().video.revealAtEnd || state.progress === 1)));
    const visible = actor && actor.figure !== false && state.animation && !state.demoStarted && !(actor.hideAtEnd && state.progress === 1);
    layer.toggleAttribute("hidden", !visible);
    if (actor && !state.demoStarted) {
      const scene = actorScene(actor, state.progress);
      layer.dataset.motion = actor.motion;
      layer.dataset.frame = String(scene.frame);
      layer.innerHTML = visible ? figureMarkup(scene.sample, scene.geometry, "var(--cp-text)") : "";
      $("props").innerHTML = actor.scene && !(actor.hideSceneAtEnd && state.progress === 1) ? scene.markup : "";
      if (/NaN|Infinity/.test(layer.innerHTML)) throw new Error("Actor produced nonfinite geometry");
    } else {
      delete layer.dataset.motion;
      delete layer.dataset.frame;
      layer.innerHTML = "";
      $("props").innerHTML = "";
    }
    $("objects").innerHTML = (current().objects ?? []).map(object => {
      const next = beat().objects?.[object.id];
      if (!next || next.visible === false) return "";
      const previous = state.beat > 0 ? current().beats[state.beat-1].objects?.[object.id] : next;
      const start = { ...object, ...previous };
      const end = { ...object, ...next };
      const position = { ...end };
      const progress = Math.max(0, Math.min(1, (state.progress-(next.startAt ?? 0))/(1-(next.startAt ?? 0))));
      for (const key of ["x", "y", "w", "h"]) position[key] = start[key] + (end[key]-start[key])*progress;
      const type = progress < .55 ? start.type : end.type;
      const label = progress < .55 ? start.label : end.label;
      return payloadMarkup(position, { type, label });
    }).join("");
    if (/NaN|Infinity/.test($("props").innerHTML)) throw new Error("Scene prop produced nonfinite geometry");
    const atEnd = state.slide === data.slides.length-1 && state.beat === current().beats.length-1 && state.progress === 1;
    $("next").disabled = state.playing || atEnd;
    $("next").textContent = state.playing ? "Demo playing" : state.progress < 1 ? "Finish beat" : state.beat < current().beats.length-1 ? "Next beat" : atEnd ? (data.slides.length === data.sourceCount ? "End of presentation" : "End of preview") : "Next slide";
    $("back").disabled = state.slide === 0 && state.beat === 0;
    $("replay").disabled = state.playing || !state.animation || !actor || actor.from === actor.to;
    $("beat-status").textContent = `Source slide ${current().source} of ${data.sourceCount} · Beat ${state.beat+1} / ${current().beats.length}${state.playing ? " · Character paused" : ""}`;
    $("motion").textContent = state.animation ? "Animation on" : "Animation off";
    $("motion").setAttribute("aria-pressed", String(state.animation));
    $("play-demo").hidden = !movieVisible;
    $("play-demo").disabled = state.playing;
    $("play-demo").textContent = state.demoStarted ? "Resume original demo" : "Play original demo";
    $("expand-demo").hidden = !movieVisible;
    if (current().video) {
      $("video-wrap").hidden = !movieVisible;
      $("play-expanded").disabled = state.playing;
      $("play-expanded").textContent = state.demoStarted ? "Resume original demo" : "Play original demo";
      const focus = current().video.focus;
      const poster = $("poster"), detail = $("video-detail");
      focusImage(poster, detail, !state.demoStarted && state.beat === focus?.beat ? focus : null);
      if (state.demoStarted) poster.hidden = true;
    }
  }
  function runBeat() {
    cancel();
    resetDemo();
    const token = generation;
    const duration = beat().actor?.durationMs ?? 650;
    if (!state.animation || reduced.matches) {
      state.progress = 1;
      paint();
      return;
    }
    state.progress = 0;
    paint();
    const start = performance.now();
    function tick(now) {
      if (token !== generation || state.playing) return;
      state.progress = Math.min(1, (now-start)/duration);
      try {
        paint();
        if (state.progress < 1) raf = requestAnimationFrame(tick);
        else raf = 0;
      } catch (error) {
        cancel();
        report(error);
      }
    }
    raf = requestAnimationFrame(tick);
  }
  function mountSlide() {
    cancel();
    releaseVideo();
    $("error").hidden = true;
    const slide = current();
    const movie = slide.video;
    const images = (slide.images ?? []).map(image => `<button type="button" id="image-${xml(image.id)}" class="source-figure" data-component="${xml(image.id)}" data-target="${xml(image.id)}" style="left:${image.x}px;top:${image.y}px;width:${image.width}px;height:${image.height}px" aria-label="Enlarge original image: ${xml(image.alt)}">
      <img src="${mediaUrl(image.asset)}" alt="${xml(image.alt)}">
      <svg hidden aria-hidden="true"><image href="${mediaUrl(image.asset)}"/></svg></button>`).join("");
    const resources = (slide.resources ?? []).map(resource => `<a class="resource-link ${resource.large ? "large" : ""}" data-component="${xml(resource.id)}" data-target="${xml(resource.id)}" style="left:${resource.x}px;top:${resource.y}px;width:${resource.width}px;height:${resource.height}px" href="${xml(resource.href)}" target="_blank" rel="noopener noreferrer"><strong>${xml(resource.label)}</strong><span>${xml(resource.href)}</span></a>`).join("");
    const videoMarkup = movie ? `<div id="video-wrap" class="video-wrap" style="left:${movie.x}px;top:${movie.y}px;width:${movie.width}px;height:${movie.height}px">
      <img id="poster" class="video-poster" src="${mediaUrl(movie.poster)}" alt="${xml(slide.title)} original demo poster">
      <svg id="video-detail" class="video-detail" hidden role="img" aria-label="Enlarged detail from the original demo poster"><image href="${mediaUrl(movie.poster)}"/></svg>
      <video id="demo" hidden controls preload="none" playsinline poster="${mediaUrl(movie.poster)}" aria-label="${xml(slide.title)} embedded demo"></video>
      <nav class="demo-fullscreen-controls" aria-label="Enlarged demo controls"><button id="play-expanded" class="primary">Play original demo</button><button id="close-expanded">Exit enlarged demo</button></nav></div>` : "";
    $("stage").innerHTML = `${slide.blank ? "" : `<div class="eyebrow">${xml(slide.section)}</div><h1>${xml(slide.title)}</h1><p class="subtitle">${xml(slide.subtitle)}</p>`}
      ${diagramMarkup(slide)}${images}${resources}${videoMarkup}
      <svg id="objects" class="scene-props" viewBox="0 0 1280 720" aria-hidden="true"></svg>
      <svg id="props" class="scene-props" viewBox="0 0 1280 720" aria-hidden="true"></svg>
      <svg id="actor" class="actor-layer" viewBox="0 0 1280 720" aria-hidden="true"></svg>
      <p id="caption" class="beat-caption"></p>`;
    for (const image of slide.images ?? []) {
      const frame = $(`image-${image.id}`);
      frame.querySelector("img").addEventListener("load", paint);
      frame.addEventListener("click", () => openDialog(image.alt, body => {
        body.className = "source-assets";
        const original = document.createElement("img");
        original.src = mediaUrl(image.asset);
        original.alt = image.alt;
        body.append(original);
      }));
    }
    if (movie) {
      video = $("demo");
      $("poster").addEventListener("load", () => { if (video) paint(); });
      $("play-expanded").addEventListener("click", playDemo);
      $("close-expanded").addEventListener("click", () => document.exitFullscreen().catch(report));
      const element = video;
      element.addEventListener("play", () => {
        if (video !== element) return;
        cancel();
        state.progress = 1;
        state.playing = true;
        state.demoStarted = true;
        element.hidden = false;
        $("poster").hidden = true;
        paint();
      });
      const stopped = () => {
        if (video !== element) return;
        state.playing = false;
        paint();
      };
      element.addEventListener("pause", stopped);
      element.addEventListener("ended", stopped);
      element.addEventListener("error", () => {
        if (video !== element) return;
        state.playing = false;
        report(`Embedded demo could not play (media error ${element.error?.code ?? "unknown"}). Try a browser with MP4/H.264 support.`);
        paint();
      });
    }
    $("slide-select").value = String(state.slide);
    paint();
    resize();
  }
  function go(slide, nextBeat = 0) {
    if (slide < 0 || slide >= data.slides.length) return;
    state.slide = slide;
    state.beat = nextBeat;
    state.progress = 1;
    mountSlide();
  }
  function next() {
    if (state.playing) return;
    if (state.progress < 1) {
      cancel();
      state.progress = 1;
      paint();
    } else if (state.beat < current().beats.length-1) {
      state.beat++;
      runBeat();
    } else if (state.slide < data.slides.length-1) {
      go(state.slide+1);
    }
  }
  function back() {
    cancel();
    if (state.beat > 0) {
      resetDemo();
      state.beat--;
      state.progress = 1;
      paint();
    } else if (state.slide > 0) {
      go(state.slide-1, data.slides[state.slide-1].beats.length-1);
    }
  }
  function openDialog(title, fill) {
    if (video && !video.paused) video.pause();
    cancel();
    state.progress = 1;
    paint();
    $("dialog-title").textContent = title;
    $("dialog-body").replaceChildren();
    fill($("dialog-body"));
    $("dialog").showModal();
  }
  function addParagraph(parent, text) {
    const element = document.createElement("p");
    element.textContent = text;
    parent.append(element);
  }
  function notes() {
    openDialog(`Source slide ${current().source} — presenter notes`, body => {
      body.className = "notes";
      const heading = document.createElement("h3");
      heading.textContent = "Original speaker notes";
      body.append(heading);
      (current().original.notes.length ? current().original.notes : ["No speaker notes in this source slide."]).forEach(text => addParagraph(body, text));
      const added = document.createElement("h3");
      added.textContent = "Added presentation beats";
      body.append(added);
      current().beats.forEach(item => addParagraph(body, item.caption));
      const links = current().original.links.filter(link => /^https?:\/\//i.test(link));
      if (links.length) {
        const heading = document.createElement("h3");
        heading.textContent = "Source resource links (online)";
        body.append(heading);
        for (const href of links) {
          const link = document.createElement("a");
          link.href = href;
          link.textContent = href;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          body.append(link, document.createElement("br"));
        }
      }
    });
  }
  function original() {
    openDialog(`Original source slide ${current().source}`, body => {
      body.className = "";
      const canvas = document.createElement("div");
      canvas.className = "original";
      body.append(canvas);
      const { width, height } = data.canvasEmu;
      for (const shape of current().original.shapes) {
        if (!shape.bounds) continue;
        const box = document.createElement("div");
        box.className = "source-shape";
        const b = shape.bounds;
        Object.assign(box.style, { left: `${b.x/width*100}%`, top: `${b.y/height*100}%`, width: `${b.width/width*100}%`, height: `${b.height/height*100}%`, overflow: "hidden" });
        const imageId = [...shape.media].reverse().find(id => data.media[id]?.mime.startsWith("image/"));
        if (imageId) {
          const image = document.createElement("img");
          image.className = "source-image";
          image.alt = shape.description || `Source slide ${current().source} image`;
          image.src = mediaUrl(imageId);
          const crop = shape.crop ?? {};
          const l = Number(crop.l ?? 0)/100000, r = Number(crop.r ?? 0)/100000;
          const t = Number(crop.t ?? 0)/100000, bottom = Number(crop.b ?? 0)/100000;
          Object.assign(image.style, { position: "absolute", left: `${-l/(1-l-r)*100}%`, top: `${-t/(1-t-bottom)*100}%`, width: `${100/(1-l-r)}%`, height: `${100/(1-t-bottom)}%` });
          box.append(image);
        } else if (shape.text?.length) {
          const paragraph = document.createElement("p");
          paragraph.className = "source-text";
          paragraph.style.fontSize = "clamp(12px, 2.15vw, 28px)";
          paragraph.textContent = shape.text.join("\n");
          box.append(paragraph);
        }
        canvas.append(box);
      }
      addParagraph(body, "Full source images below retain uncropped detail. The slide above reconstructs source positions; embedded demos remain available in the presentation.");
      const assets = document.createElement("div");
      assets.className = "source-assets";
      for (const id of current().original.media.filter(id => data.media[id]?.mime.startsWith("image/"))) {
        const image = document.createElement("img");
        image.alt = `Uncropped original image from source slide ${current().source}`;
        image.src = mediaUrl(id);
        assets.append(image);
      }
      body.append(assets);
    });
  }
  function fullscreen() {
    const promise = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    promise.catch(report);
  }
  function playDemo() {
    if (!video) return;
    if (!videoUrl) {
      const asset = data.media[current().video.asset];
      const raw = atob(asset.base64);
      const bytes = new Uint8Array(raw.length);
      for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index);
      videoUrl = URL.createObjectURL(new Blob([bytes], { type: asset.mime }));
      video.src = videoUrl;
    }
    video.hidden = false;
    $("poster").hidden = true;
    $("video-detail").setAttribute("hidden", "");
    video.play().catch(error => {
      if (video) video.hidden = true;
      paint();
      report(`Embedded demo playback failed: ${error.message}`);
    });
  }
  $("slide-select").innerHTML = data.slides.map((slide, index) => `<option value="${index}">${slide.source} — ${xml(slide.title || "Blank closing slide")}</option>`).join("");
  $("slide-select").addEventListener("change", event => go(Number(event.target.value)));
  $("next").addEventListener("click", next);
  $("back").addEventListener("click", back);
  $("replay").addEventListener("click", runBeat);
  $("notes").addEventListener("click", notes);
  $("source").addEventListener("click", original);
  $("play-demo").addEventListener("click", playDemo);
  $("expand-demo").addEventListener("click", () => {
    if ($("video-wrap")) $("video-wrap").requestFullscreen().catch(report);
  });
  $("fullscreen").addEventListener("click", fullscreen);
  $("close-dialog").addEventListener("click", () => $("dialog").close());
  $("theme").addEventListener("click", () => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; });
  $("motion").addEventListener("click", () => {
    cancel();
    state.animation = !state.animation;
    state.progress = 1;
    paint();
  });
  reduced.addEventListener("change", event => {
    if (event.matches) {
      cancel();
      state.animation = false;
      state.progress = 1;
      paint();
    }
  });
  document.addEventListener("keydown", event => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || $("dialog").open) return;
    if (event.target.closest?.("input, textarea, select, button, video, a, [contenteditable]")) return;
    const key = event.key.toLowerCase();
    const action = { " ": next, arrowright: next, pagedown: next, arrowleft: back, pageup: back, n: notes, o: original, f: fullscreen }[key];
    if (action) {
      event.preventDefault();
      action();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      cancel();
      if (video && !video.paused) video.pause();
      state.progress = 1;
      paint();
    }
  });
  window.addEventListener("pagehide", () => { cancel(); releaseVideo(); });
  new ResizeObserver(resize).observe($("stage").parentElement);
  try { mountSlide(); } catch (error) { report(error); }
})();
