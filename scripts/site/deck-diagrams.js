// Deck-local illustrative objects. All positions share the fixed 1000 × 420 stage.
// The W1 glyph is the same workload in every scene; no customer measurements are implied.
function workload(x, y, c) {
  return '<g data-object="workload" transform="translate(' + r(x) + ' ' + r(y) + ')">' +
    '<rect x="-34" y="-27" width="68" height="54" rx="10" fill="' + c.s + '" stroke="' + c.a + '" stroke-width="3"/>' +
    '<path d="M-22-12h12m-12 12h12m-12 12h12" stroke="' + c.a + '" stroke-width="3"/>' +
    text(10, 7, "W1", 20, c.t, 700, "middle") + '</g>';
}
function wire(points, c, dashed) {
  return '<path d="' + points + '" fill="none" stroke="' + c.b + '" stroke-width="2.5"' +
    (dashed ? ' stroke-dasharray="7 7"' : '') + '/>';
}
function rackIcon(x, y, c) {
  var out = '<rect x="' + x + '" y="' + y + '" width="100" height="108" rx="6" fill="' + c.s + '" stroke="' + c.t + '" stroke-width="3"/>';
  for (var i = 0; i < 3; i++) out += '<rect x="' + (x + 12) + '" y="' + (y + 12 + i * 30) + '" width="76" height="22" rx="3" fill="none" stroke="' + c.b + '" stroke-width="2"/>';
  return out;
}
function cloudIcon(x, y, c) {
  return '<path d="M' + (x - 67) + ' ' + (y + 24) + 'a30 30 0 0 1 14-57a40 40 0 0 1 72-12a32 32 0 0 1 42 38a22 22 0 0 1-4 31Z" fill="' + c.s + '" stroke="' + c.t + '" stroke-width="3"/>';
}
function result(markup, props) {
  return { markup: wire("M60 400H940", {b:"var(--cp-border)"}) + markup, props: ["workload"].concat(props || []) };
}
function bookendScene(beat, local, c) {
  var t = ease(local / 75), x = 290 + 210 * t, y = 300 - 120 * t;
  var out = wire("M466 180H210V137M534 180H790V137", c, true) +
    rackIcon(160, 30, c) + cloudIcon(790, 95, c) +
    text(210, 174, "On-premises", 26, c.t, 700, "middle") +
    text(790, 174, "Cloud", 26, c.t, 700, "middle") +
    workload(x, y, c) +
    text(500, 242, "One workload. Two possible homes.", 26, c.t, 600, "middle") +
    text(500, 277, "Neither wins by default.", 20, c.m, 500, "middle");
  ["Demand", "Requirements", "Total cost"].forEach(function(label, i) {
    var cx = 450 + i * 200;
    out += '<g data-object="criterion"><line x1="' + (cx - 65) + '" y1="328" x2="' + (cx + 65) + '" y2="328" stroke="' + c.a + '" stroke-width="3"/>' +
      text(cx, 360, label, 22, c.t, 600, "middle") + '</g>';
  });
  return result(out, ["destinations"]);
}
function demand(u) { return .19 + .06 * Math.sin(u * 10) + .61 * Math.exp(-Math.pow((u - .7) / .1, 2)); }
function loadMeter(beat, local, c) {
  var out = workload(305, 105, c) + wire("M305 132V215M340 105H440", c) +
    text(185, 50, "Inspect the rack", 22, c.t, 700, "middle") +
    text(670, 42, "Demand vs fixed capacity", 26, c.t, 700, "middle") +
    text(670, 72, "Illustrative · relative units", 18, c.m, 500, "middle");
  var left = 455, right = 920, top = 108, bottom = 260;
  out += '<g data-object="fixed-capacity">' + wire("M455 260H920M455 108H920", c) +
    text(left, 100, "Installed capacity", 18, c.t, 600) + '</g>';
  if (beat >= 1) {
    var progress = beat === 1 ? ease(local / 35) : 1, pts = [];
    for (var i = 0; i <= Math.floor(60 * progress); i++) pts.push(r(left + (right-left)*i/60) + " " + r(bottom - (bottom-top)*demand(i/60)));
    out += '<g data-object="demand"><path d="M' + pts.join("L") + '" fill="none" stroke="' + c.a + '" stroke-width="4"/>' +
      text(left, 292, "Demand", 20, c.a, 600) +
      text(right, 292, "One illustrative day →", 18, c.m, 500, "end") + '</g>';
  } else out += text(670, 200, "What does W1 actually need?", 22, c.m, 500, "middle");
  if (beat >= 2) out += '<g data-object="operations">' +
    text(450, 348, "Patch · Power · Recover", 23, c.t, 600) +
    text(450, 378, "CPU alone does not prove waste or savings.", 19, c.m, 500) + '</g>';
  return result(out, ["load-meter"].concat(beat >= 2 ? ["upkeep-tags"] : []));
}
function cloudScene(beat, local, c) {
  // An explicit incoming-batch event drives capacity. No ornamental sine-wave motion.
  var phase = beat === 0 ? 0 : beat === 1 ? clamp(local / 150) : 1;
  var arrival = ease(phase / .35), drain = ease((phase - .62) / .38);
  var queue = Math.round(6 * arrival * (1 - drain));
  var units = 2 + (queue > 0 ? Math.ceil(queue / 2) : 0);
  var out = workload(305, 110, c) + wire("M339 110H505V155", c) +
    text(305, 55, "Incoming work", 22, c.t, 700, "middle") +
    '<g data-object="batch" data-queue="' + queue + '">';
  for (var i = 0; i < queue; i++) out += '<rect x="' + (370 + i * 22) + '" y="99" width="14" height="22" rx="3" fill="' + c.a + '"/>';
  out += text(435, 142, queue ? "Batch pending" : "Queue cleared", 16, c.m, 500, "middle") +
    '</g><g data-object="capacity-units" data-units="' + units + '">' +
    '<rect x="500" y="150" width="415" height="115" rx="16" fill="none" stroke="' + c.b + '" stroke-width="2.5"/>';
  for (var j = 0; j < units; j++) out += '<rect x="' + (521 + j * 76) + '" y="178" width="60" height="58" rx="8" fill="' + c.s + '" stroke="' + c.a + '" stroke-width="3"/>' +
    text(551 + j * 76, 214, "W1", 18, c.t, 600, "middle");
  out += '</g>' + text(710, 48, "Elastic capacity", 26, c.t, 700, "middle") +
    text(710, 80, "Illustrative · configured scaling policy", 18, c.m, 500, "middle") +
    text(710, 298, beat === 0 ? "Start with minimum capacity" : queue ? "Batch arrives → add capacity" : "Batch drains → release capacity", 23, c.t, 600, "middle");
  if (beat === 2) out += '<g data-object="cost-tags">' + text(450, 350, "Migration + Usage + Egress", 24, c.t, 700) +
    text(450, 381, "Compare the full bill—not just the unit rate.", 19, c.m, 500) + '</g>';
  return result(out, ["batch", "capacity-units"].concat(beat === 2 ? ["cost-tags"] : []));
}
var stages = [["Measure",220], ["Validate",429], ["Compare",638], ["Pilot",847]];
function station(i, x, c) {
  var out = '<g transform="translate(0 12)" data-object="' + ["baseline","dependency-map","cost-comparison","pilot-gate"][i] + '">' +
    '<rect x="' + (x-87) + '" y="110" width="174" height="122" rx="10" fill="' + c.s + '" stroke="' + c.l + '" stroke-width="2"/>';
  if (i === 0) out += '<path d="M' + (x-64) + ' 194l24-8 20 3 22-47 20 36 24-15" fill="none" stroke="' + c.a + '" stroke-width="3"/>' + text(x,260,"Demand baseline",18,c.t,600,"middle");
  if (i === 1) out += wire("M"+(x-50)+" 170H"+(x+50)+"M"+x+" 170V135",c) +
    '<circle cx="'+(x-50)+'" cy="170" r="12" fill="'+c.s+'" stroke="'+c.a+'" stroke-width="3"/><circle cx="'+(x+50)+'" cy="170" r="12" fill="'+c.s+'" stroke="'+c.a+'" stroke-width="3"/>' +
    text(x,146,"?",22,c.a,700,"middle") + text(x,208,"Latency?",18,c.m,600,"middle") + text(x,260,"Dependency check",18,c.t,600,"middle");
  if (i === 2) out += text(x-68,146,"Local",17,c.m,500) + text(x-68,197,"Cloud",17,c.m,500) +
    '<path d="M'+(x+2)+' 140h60m-50 51h50" stroke="'+c.a+'" stroke-width="5"/>' +
    text(x,222,"Unpriced estimates",15,c.m,500,"middle") +
    text(x,260,"Like-for-like costs",18,c.t,600,"middle");
  if (i === 3) out += text(x,146,"Test → Compare",19,c.t,600,"middle") +
    text(x,180,"Latency · Recovery",17,c.m,500,"middle") + text(x,211,"Rollback ready",18,c.a,600,"middle") + text(x,260,"Pilot criteria",18,c.t,600,"middle");
  return out + '</g>';
}
function evidenceScene(beat, local, c, rootX) {
  var out = wire("M220 92H847", c), position = stages[beat][1];
  if (beat > 0) position = stages[beat-1][1] + (stages[beat][1]-stages[beat-1][1])*ease(local/70);
  out += workload(position, 92, c);
  for(var i=0;i<4;i++) {
    var reached = i < beat || (i === beat && (beat === 0 || local >= 70));
    out += reached ? station(i,stages[i][1],c) :
      '<rect x="'+(stages[i][1]-87)+'" y="122" width="174" height="122" rx="10" fill="none" stroke="'+c.l+'" stroke-width="2" stroke-dasharray="6 6"/>';
  }
  return result(out, ["baseline", "dependency-map", "cost-comparison", "pilot-gate"].filter(function(_, i) {
    return i < beat || (i === beat && (beat === 0 || local >= 70));
  }));
}
function decisionScene(beat, local, c) {
  var out = workload(170,155,c) + wire("M204 155H350M590 115H650V72H700M590 185H650V201H700",c,true);
  out += '<g data-object="decision-gate"><rect x="350" y="50" width="240" height="205" rx="12" fill="'+c.s+'" stroke="'+c.a+'" stroke-width="3"/>' +
    text(470,88,"Evidence gate",25,c.t,700,"middle") +
    text(470,132,"Requirements",21,c.t,600,"middle") +
    text(470,172,"Total cost",21,c.t,600,"middle") +
    text(470,212,"Pilot evidence",21,c.t,600,"middle") + '</g>';
  out += '<g data-object="move-route">' + text(720,58,"Move if",24,c.t,700) +
    text(720,99,"Requirements pass",18,c.m,500) + text(720,127,"Costs support it",18,c.m,500) + '</g>';
  out += '<g data-object="retain-route">' + text(720,181,"Retain if",24,c.t,700) +
    text(720,219,"Constraints fail",18,c.m,500) + text(720,245,"or local fits better",18,c.m,500) + '</g>';
  out += '<g data-object="pilot-action">' + text(350,355,"Pilot one workload",30,c.a,700) +
    text(350,390,"Time-box it. Keep rollback. Then decide.",20,c.m,500) + '</g>';
  return result(out, ["decision-gate","move-route","retain-route","pilot-action"]);
}
var sceneProps = {question:bookendScene, "on-prem":loadMeter, cloud:cloudScene, evidence:evidenceScene, decision:decisionScene};
