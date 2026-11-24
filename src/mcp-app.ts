import { COMPACT_CLIENT_RENDERER_JS } from "./player-runtime.js";
import { renderBlueprintPatternsSvg } from "./props.js";
import { BLUEPRINT_STAGE_STYLE } from "./render.js";

export const MCP_APP_PLAYER_URI = "ui://stickman/player";
export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";

const MCP_APP_STYLE = `:root{color-scheme:light;--cp-bg:#f7f4ef;--cp-bg-elevated:#fcfbf8;--cp-surface:#ffffff;--cp-surface-soft:#f5f5f5;--cp-border:#dedede;--cp-border-strong:#919191;--cp-text:#242424;--cp-text-muted:#5c5c5c;--cp-text-soft:#6f6f6f;--cp-actor-ink:#202124;--cp-accent:#b11f4b;--cp-accent-hover:#9a1a41;--cp-accent-soft:rgba(177,31,75,0.08);--cp-accent-fg:#ffffff;--cp-link:#0078d4;--cp-success:#16a34a;--cp-warning:#f59e0b;--cp-danger:#dc2626;--cp-ease-out:cubic-bezier(0.22,1,0.36,1);--cp-dur-fast:140ms;--cp-dur-enter:180ms;--cp-card-shadow:0 1px 2px rgba(0,0,0,0.04),0 8px 24px rgba(0,0,0,0.06)}
html[data-theme="dark"]{color-scheme:dark;--cp-bg:#3d3b3a;--cp-bg-elevated:#343231;--cp-surface:#292929;--cp-surface-soft:#2e2e2e;--cp-border:#474747;--cp-border-strong:#5f5f5f;--cp-text:#dedede;--cp-text-muted:#919191;--cp-text-soft:#b0b0b0;--cp-actor-ink:#dedede;--cp-accent:#fd8ea1;--cp-accent-hover:#fb7b91;--cp-accent-soft:rgba(253,142,161,0.14);--cp-accent-fg:#1a1a1a;--cp-link:#4da6ff;--cp-success:#4ade80;--cp-warning:#fbbf24;--cp-danger:#f87171;--cp-card-shadow:0 1px 2px rgba(0,0,0,0.24),0 8px 24px rgba(0,0,0,0.32)}
*{box-sizing:border-box}
body{margin:0;padding:12px;background:var(--cp-bg);color:var(--cp-text);font:14px/1.4 "Segoe UI",Aptos,Calibri,-apple-system,BlinkMacSystemFont,sans-serif}
.app{max-width:980px;margin:0 auto;display:flex;flex-direction:column;gap:10px}
.bar{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;padding:8px 10px;background:var(--cp-surface);border:1px solid var(--cp-border);border-radius:10px;box-shadow:var(--cp-card-shadow)}
.title{font-weight:700;font-size:14px;letter-spacing:-0.01em;display:flex;align-items:center;gap:8px}
.tag{font:700 11px/1 Consolas,"Courier New",Courier,monospace;text-transform:uppercase;letter-spacing:0.06em;padding:3px 7px;border-radius:4px;background:var(--cp-surface-soft);border:1px solid var(--cp-border);color:var(--cp-text-muted)}
.grp{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
button,select{font:600 13px/1.2 inherit;background:var(--cp-surface);color:var(--cp-text);border:1px solid var(--cp-border);border-radius:8px;padding:6px 10px;cursor:pointer;transition:border-color 140ms var(--cp-ease-out),background-color 140ms var(--cp-ease-out),color 140ms var(--cp-ease-out),transform 140ms var(--cp-ease-out)}
button:hover,select:hover{border-color:var(--cp-accent)}
button:active{transform:scale(0.985)}
button[aria-pressed="true"]{background:var(--cp-accent);color:var(--cp-accent-fg);border-color:var(--cp-accent)}
button:disabled{opacity:0.5;cursor:not-allowed}
:focus-visible{outline:3px solid var(--cp-accent);outline-offset:4px}
.stage-card{background:var(--cp-surface);border:1px solid var(--cp-border);border-radius:12px;box-shadow:var(--cp-card-shadow);overflow:hidden;position:relative}
#stage{width:100%;min-height:220px;display:flex;align-items:center;justify-content:center}
#stage svg{display:block;width:100%;height:auto}
.empty{padding:36px 20px;text-align:center;color:var(--cp-text-muted);font-size:13px}
.ctrl{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 10px;background:var(--cp-surface);border:1px solid var(--cp-border);border-radius:10px;box-shadow:var(--cp-card-shadow)}
#seek{flex:1 1 160px;min-width:110px;accent-color:var(--cp-accent);cursor:pointer}
.cp-timecode,.pill-val{font-variant-numeric:tabular-nums;font-family:Consolas,"Courier New",Courier,monospace}
.cp-timecode{font-size:12px;color:var(--cp-text-muted);min-width:13ch;text-align:right}
.chapters{display:none;gap:6px;flex-wrap:wrap}
.chapters.has-items{display:flex}
.cp-chapter{font-size:12px;padding:4px 9px}
.cp-chapter[aria-current="true"]{border-color:var(--cp-accent);background:var(--cp-accent-soft);color:var(--cp-text)}
.critique{display:none;flex-direction:column;gap:8px;padding:10px 12px;background:var(--cp-surface);border:1px solid var(--cp-border);border-radius:10px;box-shadow:var(--cp-card-shadow);transition:opacity 180ms var(--cp-ease-out)}
.critique.visible{display:flex}
.crit-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.score-badge{font:700 12px/1 Consolas,"Courier New",Courier,monospace;font-variant-numeric:tabular-nums;padding:5px 9px;border-radius:6px;color:#fff}
.score-pass{background:var(--cp-success)}
.score-warn{background:var(--cp-warning);color:#1a1a1a}
.score-fail{background:var(--cp-danger)}
.pill{display:inline-flex;align-items:center;gap:5px;padding:4px 8px;border-radius:6px;border:1px solid var(--cp-border);background:var(--cp-surface-soft);font-size:11.5px;color:var(--cp-text)}
.pill-dot{width:7px;height:7px;border-radius:50%;display:inline-block}
.pill-ok .pill-dot{background:var(--cp-success)}
.pill-mid .pill-dot{background:var(--cp-warning)}
.pill-bad .pill-dot{background:var(--cp-danger)}
.issues{display:flex;gap:6px;flex-wrap:wrap}
.issue-btn{font:600 11px/1.2 Consolas,"Courier New",Courier,monospace;padding:3px 7px;border-radius:5px;background:var(--cp-surface-soft)}
.issue-err{border-color:var(--cp-danger);color:var(--cp-danger)}
.issue-warn{border-color:var(--cp-warning);color:var(--cp-text-muted)}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{transition:none!important;animation:none!important}}`;

function buildAppScript(): string {
  const bpDefsJson = JSON.stringify(
    `${renderBlueprintPatternsSvg()}<style>${BLUEPRINT_STAGE_STYLE}</style>`
  );
  return `(()=>{"use strict";
${COMPACT_CLIENT_RENDERER_JS}
const BP_DEFS=${bpDefsJson};
const DIMS=[["propIntegrity","PROP"],["spatialContinuity","CONT"],["stagingAndEyeTrace","STAGE"],["pacingAndReadability","PACE"],["kinematicAppeal","KIN"],["cinematography","CINE"]];
const appEl=document.getElementById("app"),stageEl=document.getElementById("stage"),titleEl=document.getElementById("app-title"),kindTag=document.getElementById("kind-tag"),chaptersEl=document.getElementById("chapters"),toggleBtn=document.getElementById("toggle"),seekEl=document.getElementById("seek"),timecodeEl=document.getElementById("timecode"),speedEl=document.getElementById("speed"),themeBtn=document.getElementById("theme-btn"),bpBtn=document.getElementById("bp-btn"),critiqueEl=document.getElementById("critique-bar"),critRow=document.getElementById("crit-pills"),issuesEl=document.getElementById("crit-issues");
let basePayload=null,activeReport=null,player=null,playing=false,blueprint=false,curMs=0,speed=1,rafId=null,lastTs=0,initialized=false;

function postRpc(msg){
  try{
    if(typeof window!=="undefined"&&window.parent&&window.parent!==window){
      window.parent.postMessage(msg,"*");
    }
  }catch(_e){}
}

function notifySize(){
  const h=Math.ceil((appEl?appEl.getBoundingClientRect().height:document.body.scrollHeight)+24);
  const w=Math.ceil(appEl?appEl.getBoundingClientRect().width:window.innerWidth);
  postRpc({jsonrpc:"2.0",method:"ui/notifications/size-changed",params:{width:w,height:h}});
}

function setTheme(theme){
  const t=theme==="dark"?"dark":"light";
  document.documentElement.setAttribute("data-theme",t);
  if(themeBtn){
    themeBtn.setAttribute("aria-pressed",String(t==="dark"));
    themeBtn.textContent=t==="dark"?"Light":"Dark";
  }
}

function stopLoop(){
  playing=false;
  lastTs=0;
  if(rafId!==null){cancelAnimationFrame(rafId);rafId=null;}
  if(toggleBtn){toggleBtn.textContent="Play";toggleBtn.setAttribute("aria-pressed","false");}
}

function updateTimeUi(){
  const dur=basePayload?basePayload.dur:0;
  if(seekEl){seekEl.max=String(dur);seekEl.value=String(Math.round(curMs));}
  if(timecodeEl){timecodeEl.textContent=(curMs/1000).toFixed(2)+"s / "+(dur/1000).toFixed(2)+"s";}
}

function stepLoop(now){
  rafId=null;
  if(!playing||!player||!basePayload)return;
  if(lastTs){
    curMs+=Math.max(0,now-lastTs)*speed;
  }
  lastTs=now;
  if(curMs>=basePayload.dur){
    curMs=basePayload.dur;
    player.seek(curMs);
    updateTimeUi();
    stopLoop();
    return;
  }
  player.seek(curMs);
  updateTimeUi();
  rafId=requestAnimationFrame(stepLoop);
}

function startLoop(){
  if(!player||!basePayload)return;
  if(curMs>=basePayload.dur)curMs=0;
  playing=true;
  lastTs=0;
  if(toggleBtn){toggleBtn.textContent="Pause";toggleBtn.setAttribute("aria-pressed","true");}
  player.seek(curMs);
  updateTimeUi();
  rafId=requestAnimationFrame(stepLoop);
}

function renderCritique(report){
  activeReport=report||null;
  if(!critiqueEl||!critRow||!issuesEl)return;
  if(!report||typeof report.overallScore!=="number"||!report.dimensions){
    critiqueEl.classList.remove("visible");
    critRow.innerHTML="";
    issuesEl.innerHTML="";
    notifySize();
    return;
  }
  const passCls=report.passed?"score-pass":report.overallScore>=6.5?"score-warn":"score-fail";
  const label=report.overallScore.toFixed(1)+"/10 "+(report.passed?"PASS":"POLISH");
  let html='<span class="score-badge '+passCls+'" data-part="overall-score">'+label+"</span>";
  for(const pair of DIMS){
    const val=Number(report.dimensions[pair[0]]);
    if(!Number.isFinite(val))continue;
    const cls=val>=8?"pill-ok":val>=6.5?"pill-mid":"pill-bad";
    html+='<span class="pill '+cls+'" data-dim="'+pair[0]+'"><span class="pill-dot"></span>'+pair[1]+' <strong class="pill-val">'+val.toFixed(1)+"</strong></span>";
  }
  critRow.innerHTML=html;
  issuesEl.innerHTML="";
  const issues=Array.isArray(report.issues)?report.issues.slice(0,6):[];
  for(const iss of issues){
    const btn=document.createElement("button");
    btn.type="button";
    btn.className="issue-btn "+(iss.severity==="error"?"issue-err":"issue-warn");
    btn.textContent=iss.code+" @ "+(Number(iss.timeMs||0)/1000).toFixed(2)+"s";
    btn.title=iss.message||iss.code;
    btn.addEventListener("click",()=>{
      stopLoop();
      curMs=Number(iss.timeMs||0);
      if(player)player.seek(curMs);
      updateTimeUi();
    });
    issuesEl.appendChild(btn);
  }
  critiqueEl.classList.add("visible");
  notifySize();
}

function mountPayload(payload,preserveTime){
  stopLoop();
  if(!payload||typeof payload!=="object"||!Array.isArray(payload.sc)||!payload.sc.length){return;}
  basePayload=payload;
  const effective=Object.assign({},payload);
  if(blueprint){effective.bp=1;}else{delete effective.bp;}
  const w=effective.w||800,h=effective.h||450;
  const firstBg=blueprint?"#f8fafc":(effective.sc[0].bg||"#ffffff");
  const firstGy=effective.sc[0].gy||Math.round(h*0.82);
  const defsHtml=blueprint?("<defs>"+BP_DEFS+"</defs>"):"";
  const bgMarkup=blueprint
    ?'<rect width="100%" height="100%" fill="#f8fafc"/><rect width="100%" height="100%" fill="url(#sm-bp-grid)"/><rect x="1.5" y="1.5" width="'+Math.max(1,w-3)+'" height="'+Math.max(1,h-3)+'" fill="none" stroke="#cbd5e1" stroke-width="1"/><path id="ground" d="M0 '+firstGy+'H'+w+'" fill="none" stroke="#1e3a5f" stroke-width="1" stroke-dasharray="4 3"/>'
    :'<rect width="100%" height="100%" fill="'+firstBg+'"/><path id="ground" d="M0 '+firstGy+'H'+w+'" stroke="#d8dbe0" stroke-width="1"/>';
  stageEl.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Stickman interactive player" viewBox="0 0 '+w+" "+h+'" width="'+w+'" height="'+h+'">'+defsHtml+bgMarkup+'<g id="scene"></g></svg>';
  if(titleEl)titleEl.textContent=effective.ti||(effective.kind==="movie"?"Stickman Movie":"Stickman Scene");
  if(kindTag)kindTag.textContent=(effective.kind==="movie"?effective.sc.length+" SCENES":"SCENE")+" · "+w+"x"+h;
  if(chaptersEl){
    chaptersEl.innerHTML="";
    if(effective.kind==="movie"&&effective.sc.length>1){
      for(let i=0;i<effective.sc.length;i++){
        const sc=effective.sc[i];
        const b=document.createElement("button");
        b.type="button";
        b.className="cp-chapter";
        b.setAttribute("data-scene-jump",String(sc.s||0));
        b.setAttribute("data-scene-id",sc.id||("s"+(i+1)));
        b.textContent="S"+(i+1)+" · "+(sc.ti||sc.id||("Scene "+(i+1)));
        b.addEventListener("click",()=>{
          curMs=Number(sc.s||0);
          if(player)player.seek(curMs);
          updateTimeUi();
        });
        chaptersEl.appendChild(b);
      }
      chaptersEl.classList.add("has-items");
    }else{
      chaptersEl.classList.remove("has-items");
    }
  }
  const svgNode=stageEl.querySelector("svg");
  const sceneNode=stageEl.querySelector("#scene");
  const groundNode=stageEl.querySelector("#ground");
  player=mountStickmanCompactPlayer(effective,{svg:svgNode,sceneEl:sceneNode,groundEl:groundNode,seek:null,toggle:null,modeSelect:null,timecode:null});
  player.stop();
  curMs=preserveTime?Math.max(0,Math.min(effective.dur||0,curMs)):0;
  player.seek(curMs);
  if(toggleBtn)toggleBtn.disabled=false;
  if(seekEl)seekEl.disabled=false;
  if(bpBtn){bpBtn.disabled=false;bpBtn.setAttribute("aria-pressed",String(blueprint));}
  updateTimeUi();
  const reduced=typeof matchMedia==="function"&&matchMedia("(prefers-reduced-motion: reduce)").matches;
  if(!preserveTime&&!reduced){startLoop();}
  notifySize();
}

function renderStaticSvgPreview(svgMarkup){
  stopLoop();
  basePayload=null;
  player=null;
  stageEl.innerHTML=svgMarkup;
  if(chaptersEl)chaptersEl.classList.remove("has-items");
  if(toggleBtn)toggleBtn.disabled=true;
  if(seekEl)seekEl.disabled=true;
  if(kindTag)kindTag.textContent="PREVIEW";
  notifySize();
}

function handleToolPayload(res){
  if(!res||typeof res!=="object")return;
  if(res.playerPayload){
    blueprint=res.playerPayload.bp===1;
    mountPayload(res.playerPayload,false);
  }else if(typeof res.content==="string"&&res.content.trim().startsWith("<svg")){
    renderStaticSvgPreview(res.content);
  }
  renderCritique(res.report||null);
}

window.addEventListener("message",(event)=>{
  const msg=event&&event.data;
  if(!msg||typeof msg!=="object")return;
  if(msg.jsonrpc==="2.0"){
    if(msg.id===1&&msg.result&&!initialized){
      initialized=true;
      if(msg.result.hostContext&&msg.result.hostContext.theme){setTheme(msg.result.hostContext.theme);}
      postRpc({jsonrpc:"2.0",method:"ui/notifications/initialized",params:{}});
      notifySize();
      return;
    }
    if(msg.method==="ui/notifications/host-context-changed"&&msg.params&&msg.params.theme){
      setTheme(msg.params.theme);
      return;
    }
    if(msg.method==="ui/notifications/tool-result"&&msg.params){
      const sc=msg.params.structuredContent;
      const candidate=(sc&&sc.result)||msg.params.result||sc||msg.params;
      handleToolPayload(candidate);
      return;
    }
  }
  if(msg.type==="stickman:load"){
    handleToolPayload(msg);
  }
});

if(toggleBtn){toggleBtn.addEventListener("click",()=>{if(!player)return;if(playing)stopLoop();else startLoop();});}
if(seekEl){seekEl.addEventListener("input",()=>{if(!player)return;stopLoop();curMs=Number(seekEl.value)||0;player.seek(curMs);updateTimeUi();});}
if(speedEl){speedEl.addEventListener("change",()=>{const v=Number(speedEl.value);if(Number.isFinite(v)&&v>0)speed=v;});}
if(themeBtn){themeBtn.addEventListener("click",()=>{const cur=document.documentElement.getAttribute("data-theme")==="dark"?"light":"dark";setTheme(cur);});}
if(bpBtn){bpBtn.addEventListener("click",()=>{if(!basePayload)return;blueprint=!blueprint;const wasPlaying=playing;mountPayload(basePayload,true);if(wasPlaying)startLoop();});}

const initDark=typeof matchMedia==="function"&&matchMedia("(prefers-color-scheme: dark)").matches;
const urlTheme=typeof URLSearchParams==="function"?new URLSearchParams(window.location.search).get("scoutTheme"):null;
setTheme(urlTheme||(initDark?"dark":"light"));

if(typeof ResizeObserver==="function"&&appEl){
  try{new ResizeObserver(()=>notifySize()).observe(appEl);}catch(_e){}
}
postRpc({jsonrpc:"2.0",id:1,method:"ui/initialize",params:{protocolVersion:"2025-11-21",appInfo:{name:"stickman-player",version:"0.3.1"},appCapabilities:{}}});
notifySize();
})();`;
}

export function renderMcpAppPlayerHtml(): string {
  const script = buildAppScript();
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>Stickman Interactive Player</title><style>${MCP_APP_STYLE}</style></head><body>` +
    `<main id="app" class="app">` +
    `<header class="bar"><div class="title"><span id="app-title">Stickman Player</span><span id="kind-tag" class="tag">READY</span></div>` +
    `<div class="grp"><button id="bp-btn" type="button" aria-pressed="false" disabled>Blueprint</button>` +
    `<button id="theme-btn" type="button" aria-pressed="false">Dark</button></div></header>` +
    `<section class="stage-card"><div id="stage"><div class="empty">Waiting for Stickman animation payload via MCP Apps tool-result…</div></div></section>` +
    `<nav id="chapters" class="chapters" aria-label="Movie scenes"></nav>` +
    `<section class="ctrl" aria-label="Playback controls">` +
    `<button id="toggle" type="button" aria-pressed="false" disabled>Play</button>` +
    `<input id="seek" type="range" min="0" max="0" step="1" value="0" aria-label="Playhead" disabled>` +
    `<output id="timecode" class="cp-timecode" data-timecode="true" for="seek">0.00s / 0.00s</output>` +
    `<label>Speed <select id="speed" aria-label="Playback speed"><option value="0.5">0.5x</option><option value="1" selected>1x</option><option value="1.5">1.5x</option><option value="2">2x</option></select></label>` +
    `</section>` +
    `<section id="critique-bar" class="critique" aria-label="Quality critique">` +
    `<div id="crit-pills" class="crit-row"></div><div id="crit-issues" class="issues"></div>` +
    `</section>` +
    `</main><script id="stickman-mcp-app">${script}</script></body></html>`
  );
}
