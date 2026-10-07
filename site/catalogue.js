const catalogue = JSON.parse(document.getElementById("catalogueData").textContent);
const comparison = JSON.parse(document.getElementById("comparisonData").textContent);
const stories = JSON.parse(document.getElementById("storyData").textContent);
const $ = id => document.getElementById(id);
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const theme = document.documentElement.getAttribute("data-theme");
let activePreview = null;
let dialogVariants = [];
function stopPreview() {
  activePreview?.remove();
  activePreview = null;
}
function previewUrl(motion, hover = false) {
  const query = new URLSearchParams({ scoutTheme: theme, onion: "0" });
  if (hover) query.set("bare", "1");
  if (hover && !reducedMotion.matches) query.set("animate", "1");
  if (reducedMotion.matches) query.set("frame", "0");
  return motion.preview + "?" + query;
}
function openMotion(motion) {
  stopPreview();
  $("dialogScope").textContent = `${catalogue.development ? motion.note + ". " : ""}${catalogue.scope}`;
  dialogVariants = [motion, ...motion.variants];
  $("previewVariant").replaceChildren();
  for (const variant of dialogVariants) {
    const option = document.createElement("option"); option.value = variant.id; option.textContent = variant.label;
    $("previewVariant").append(option);
  }
  $("variantLabel").hidden = motion.variants.length === 0;
  updateVariant();
  $("motionDialog").showModal();
}
function updateVariant() {
  const variant = dialogVariants.find(m => m.id === $("previewVariant").value);
  $("dialogTitle").textContent = variant.label;
  $("downloadSpec").href = variant.spec;
  $("fullPreview").src = previewUrl(variant);
}
$("previewVariant").addEventListener("change", updateVariant);
function renderCatalogue() {
  stopPreview();
  const search = $("search").value.trim().toLowerCase(), category = $("category").value;
  const rows = catalogue.motions.filter(m => (!category || m.family === category)
    && (!$("runtimeOnly").checked || m.runtimeIdAvailable)
    && `${m.id} ${m.label} ${m.summary} ${m.family} ${m.tags.join(" ")}`.toLowerCase().includes(search));
  $("motionGrid").replaceChildren();
  for (const motion of rows) {
    const article = document.createElement("article");
    article.className = "motion-card";
    article.dataset.motion = motion.id;
    const button = document.createElement("button");
    button.className = "preview";
    button.setAttribute("aria-label", `Preview ${motion.label}`);
    const image = document.createElement("img");
    image.src = motion.poster; image.alt = `${motion.label} key pose`; image.loading = "lazy";
    button.append(image);
    const play = () => {
      if (reducedMotion.matches || $("motionDialog").open) return;
      stopPreview();
      const iframe = document.createElement("iframe");
      iframe.title = `${motion.label} hover preview`; iframe.tabIndex = -1;
      iframe.setAttribute("sandbox", "allow-scripts");
      iframe.src = previewUrl(motion, true);
      button.append(iframe); activePreview = iframe;
    };
    button.addEventListener("pointerenter", event => { if (event.pointerType === "mouse") play(); });
    button.addEventListener("pointerleave", stopPreview);
    button.addEventListener("focus", play); button.addEventListener("blur", stopPreview);
    button.addEventListener("click", () => openMotion(motion));
    const body = document.createElement("div"); body.className = "card-body";
    const title = document.createElement("h3"); title.textContent = motion.label;
    const meta = document.createElement("div"); meta.className = "card-meta";
    const family = document.createElement("span"); family.textContent = motion.family;
    meta.append(family);
    if (catalogue.development) {
      const score = document.createElement("span"); score.className = "score"; score.textContent = motion.score ? `${motion.score}/10` : "Dev approved";
      meta.append(score);
    }
    const caption = document.createElement("p"); caption.textContent = `${motion.duration}s · ${motion.loop ? "Loop" : "One-shot"} · ${motion.id}`;
    const runtime = document.createElement("p"); runtime.className = "runtime";
    runtime.textContent = motion.runtimeIdAvailable ? "Runtime ID available · version integration separate" : "Authored motion · runtime integration pending";
    if (motion.mechanicalCheck === "needs-requalification") runtime.textContent += " · mechanical requalification needed";
    body.append(title, meta, caption, runtime); article.append(button, body); $("motionGrid").append(article);
  }
  $("resultCount").textContent = `${rows.length} of ${catalogue.motionCount} motions`;
  $("empty").hidden = rows.length > 0;
}
for (const family of [...new Set(catalogue.motions.map(m => m.family))]) {
  const option = document.createElement("option"); option.value = family; option.textContent = family; $("category").append(option);
}
$("category").value = "IT";
$("heroStatus").textContent = `${stories.length} combined stories · ${catalogue.motionCount} motion building blocks · private, local-first preview${catalogue.development ? " · development review mode" : ""}`;
$("search").addEventListener("input", renderCatalogue);
$("category").addEventListener("change", renderCatalogue);
$("runtimeOnly").addEventListener("change", renderCatalogue);
$("closeDialog").addEventListener("click", () => $("motionDialog").close());
$("motionDialog").addEventListener("close", () => { $("fullPreview").removeAttribute("src"); });
document.addEventListener("visibilitychange", () => { if (document.hidden) stopPreview(); });
reducedMotion.addEventListener("change", stopPreview);

function quotePowerShell(value) { return "'" + value.replaceAll("'", "''") + "'"; }
function updateCommand() {
  const checkout = $("checkout").value.trim(), root = $("outputRoot").value.trim();
  if (!checkout || !root || /[\r\n]/.test(checkout + root)) {
    $("connectCommand").textContent = "Enter one checkout path and one output root, without line breaks.";
    $("copyCommand").disabled = true; return;
  }
  const script = checkout.replace(/[\\/]+$/, "") + "\\dist\\mcp.js";
  const executable = `node ${quotePowerShell(script)} --root ${quotePowerShell(root)}`;
  $("connectCommand").textContent = ({
    copilot: `copilot mcp add stickman --tools 'stickman_discover,stickman_describe,stickman_schema,stickman_validate,stickman_compile,stickman_preview,stickman_story' -- ${executable}`,
    claude: `claude mcp add --transport stdio stickman -- ${executable}`,
    codex: `codex mcp add stickman -- ${executable}`
  })[$("agent").value];
  $("copyCommand").disabled = false;
}
for (const id of ["agent", "checkout", "outputRoot"]) $(id).addEventListener(id === "agent" ? "change" : "input", updateCommand);
$("copyCommand").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("connectCommand").textContent); $("copyStatus").textContent = "Copied. Review before running; adding a server changes your client configuration."; }
  catch (error) { $("copyStatus").textContent = `Clipboard unavailable: ${error.message}. Select and copy the command manually.`; }
});
for (const [index, slide] of comparison.slides.entries()) {
  const option = document.createElement("option"); option.value = index; option.textContent = slide.title; $("demoSlide").append(option);
}
let enhanced = false;
function updateComparison() {
  const slide = comparison.slides[Number($("demoSlide").value) || 0];
  if (!slide) { $("sourceSlide").alt = "Comparison assets have not been built"; return; }
  $("sourceSlide").src = slide.image;
  $("sourceSlide").alt = `Original source slide: ${slide.title}`;
  $("sourceSlide").hidden = enhanced;
  $("inSlidePlayer").hidden = !enhanced;
  if (enhanced) $("inSlidePlayer").src = slide.player + (reducedMotion.matches ? "?paused=1" : "");
  else $("inSlidePlayer").removeAttribute("src");
  $("before").setAttribute("aria-pressed", String(!enhanced));
  $("after").setAttribute("aria-pressed", String(enhanced));
}
$("before").addEventListener("click", () => { enhanced = false; updateComparison(); });
$("after").addEventListener("click", () => { enhanced = true; updateComparison(); });
$("demoSlide").addEventListener("change", updateComparison);
function closeStory() {
  $("storyPlayer").removeAttribute("src");
  $("storyDetails").hidden = true;
}
for (const story of stories) {
  const card = document.createElement("article"); card.className = "story-card";
  const image = document.createElement("img"); image.src = story.poster; image.alt = story.title; image.loading = "lazy";
  const body = document.createElement("div"); body.className = "card-body";
  const title = document.createElement("h3"); title.textContent = story.title;
  const summary = document.createElement("p"); summary.textContent = story.summary;
  const steps = document.createElement("p"); steps.textContent = "Illustrative slide narrative · presenter-controlled beats";
  const button = document.createElement("button"); button.textContent = "Play story"; button.dataset.story = story.id;
  button.onclick = () => {
    stopPreview();
    $("storyTitle").textContent = story.title;
    $("storyDescription").textContent = `${story.summary} ${story.durationMs / 1000}s · ${story.actions.length} actions · ${story.cues} content cues.`;
    $("storyAnimation").href = story.animation; $("storyRecipe").href = story.recipe; $("storyMotion").href = story.motionPreview;
    $("storyPlayer").src = story.preview + (reducedMotion.matches ? "?paused=1" : "");
    $("storyDetails").hidden = false;
    $("storyDetails").scrollIntoView({ behavior: reducedMotion.matches ? "instant" : "smooth", block: "start" });
  };
  body.append(title, summary, steps, button); card.append(image, body); $("storyGrid").append(card);
}
$("closeStory").onclick = closeStory;
renderCatalogue(); updateCommand(); updateComparison();
