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
function bookendScene(beat, local, c, rootX, events) {
  var x = 500, y = 180;
  var out = wire("M466 180H210V137M534 180H790V137", c, true) +
    rackIcon(160, 30, c) + cloudIcon(790, 95, c) +
    text(210, 174, "On-premises", 26, c.t, 700, "middle") +
    text(790, 174, "Cloud", 26, c.t, 700, "middle") +
    workload(x, y, c) +
    text(500, 242, "W1 = one workload", 26, c.t, 600, "middle") +
    text(500, 277, "Neither wins by default.", 20, c.m, 500, "middle");
  ["Demand", "Requirements", "Total cost"].forEach(function(label, i) {
    var cx = 450 + i * 200;
    out += '<g data-object="criterion"><line x1="' + (cx - 65) + '" y1="328" x2="' + (cx + 65) + '" y2="328" stroke="' + c.a + '" stroke-width="3"/>' +
      text(cx, 360, label, 22, c.t, 600, "middle") + '</g>';
  });
  return result(out, ["destinations"]);
}
function demand(u) { return .19 + .06 * Math.sin(u * 10) + .61 * Math.exp(-Math.pow((u - .7) / .1, 2)); }
function loadMeter(beat, local, c, rootX, events) {
  var revealed = events && events.demand;
  var out = workload(305, 105, c) + wire("M270 105H260V306M339 105H455", c) +
    text(185, 50, "Inspect the rack", 22, c.t, 700, "middle") +
    text(670, 42, "Demand vs fixed capacity", 26, c.t, 700, "middle") +
    text(670, 72, "Illustrative · relative units", 18, c.m, 500, "middle");
  var left = 455, right = 920, top = 108, bottom = 260;
  out += '<g data-object="fixed-capacity">' + wire("M455 260H920M455 108H920", c) +
    text(left, 100, "Installed capacity", 18, c.t, 600) + '</g>';
  if (revealed) {
    var progress = ease(revealed.elapsed / 30), pts = [];
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
function consoleControl(x, y, c) {
  return '<g data-object="action-console" data-interaction="hand-control"><path d="M'+(x-5)+' '+(y+6)+'h32v48m-32-48v48" fill="none" stroke="'+c.b+'" stroke-width="3"/>' +
    '<rect x="'+(x-5)+'" y="'+(y-13)+'" width="32" height="19" rx="3" fill="'+c.s+'" stroke="'+c.b+'" stroke-width="2"/>' +
    '<path data-control="" data-x="'+x+'" data-y="'+y+'" d="M'+(x-2)+' '+y+'h8" stroke="'+c.b+'" stroke-width="2"/></g>';
}
function cloudScene(beat, local, c, rootX, events) {
  var submitted = events && events.submission, arrival = events && events.arrival;
  var drained = events && events.drained, processing = events && events.processing;
  var queue = !arrival ? 0 : drained ? 0 : processing ? Math.max(1,6-Math.floor(processing.elapsed/9)) : 6;
  var units = !arrival || arrival.elapsed < 12 || drained ? 2 : 2 + Math.ceil(queue / 2);
  var out = workload(305, 110, c) + wire("M249 334H305V137M339 110H505V155", c) +
    consoleControl(249,334,c) +
    text(305, 55, "Submit W1 jobs", 22, c.t, 700, "middle") +
    '<g data-object="batch" data-queue="' + queue + '">';
  for (var i = 0; i < queue; i++) out += '<rect x="' + (370 + i * 22) + '" y="99" width="14" height="22" rx="3" fill="' + c.a + '"/>';
  if (submitted && !arrival) out += '<rect data-object="released-batch" x="'+r(345+25*ease(submitted.elapsed/24))+'" y="99" width="22" height="22" rx="3" fill="'+c.a+'"/>';
  out += text(435, 142, queue ? "Jobs pending" : drained ? "Jobs processed" : submitted ? "Batch in transit" : "Await submission", 16, c.m, 500, "middle") +
    '</g><g data-object="capacity-units" data-units="' + units + '">' +
    '<rect x="500" y="150" width="415" height="115" rx="16" fill="none" stroke="' + c.b + '" stroke-width="2.5"/>';
  for (var j = 0; j < units; j++) out += '<rect x="' + (521 + j * 76) + '" y="178" width="60" height="58" rx="8" fill="' + c.s + '" stroke="' + c.a + '" stroke-width="3"/>' +
    text(551 + j * 76, 214, String(j+1), 18, c.t, 600, "middle");
  out += '</g>' + text(710, 48, "Instances serving W1", 26, c.t, 700, "middle") +
    text(710, 80, "Illustrative · configured scaling policy", 18, c.m, 500, "middle") +
    text(710, 298, !arrival ? "Minimum capacity · waiting for jobs" : queue ? "Arrival → expand → process jobs" : "Jobs drain → release capacity", 23, c.t, 600, "middle");
  if (beat === 2) out += '<g data-object="cost-tags">' + text(450, 350, "Migration + Usage + Operations + Egress", 22, c.t, 700) +
    text(450, 381, "Compare the full bill—not just the unit rate.", 19, c.m, 500) + '</g>';
  return result(out, ["batch", "capacity-units"].concat(beat === 2 ? ["cost-tags"] : []));
}
var stages = [["Baseline",220], ["Requirements",429], ["Total cost",638], ["Pilot",847]];
function station(i, x, c) {
  var out = '<g transform="translate(0 12)" data-object="' + ["baseline","dependency-map","cost-comparison","pilot-gate"][i] + '">';
  if (i === 0) out += '<path d="M' + (x-64) + ' 194l24-8 20 3 22-47 20 36 24-15" fill="none" stroke="' + c.a + '" stroke-width="3"/>' + text(x,222,"Demand recorded",18,c.t,600,"middle");
  if (i === 1) out += wire("M"+(x-50)+" 170H"+(x+50)+"M"+x+" 170V135",c) +
    '<circle cx="'+(x-50)+'" cy="170" r="12" fill="'+c.s+'" stroke="'+c.a+'" stroke-width="3"/><circle cx="'+(x+50)+'" cy="170" r="12" fill="'+c.s+'" stroke="'+c.a+'" stroke-width="3"/>' +
    text(x,146,"?",22,c.a,700,"middle") + text(x,198,"Latency · Recovery?",18,c.m,600,"middle") + text(x,222,"Checks still needed",17,c.t,600,"middle");
  if (i === 2) out += text(x-48,136,"Local",18,c.t,600,"middle") + text(x+48,136,"Cloud",18,c.t,600,"middle") +
    text(x-48,162,"Hardware",17,c.m,500,"middle") + text(x+48,162,"Migration",17,c.m,500,"middle") +
    text(x-48,188,"Licences",17,c.m,500,"middle") + text(x+48,188,"Usage",17,c.m,500,"middle") +
    text(x-48,214,"Operations",17,c.m,500,"middle") + text(x+48,214,"Operations",17,c.m,500,"middle") +
    text(x+48,240,"Egress",17,c.m,500,"middle");
  if (i === 3) out += text(x,146,"Test → Compare",19,c.t,600,"middle") +
    text(x,178,"Latency · Recovery",18,c.m,500,"middle") + text(x,205,"Plan rollback",18,c.a,600,"middle") + text(x,230,"No result yet",17,c.m,500,"middle");
  return out + '</g>';
}
function evidenceScene(beat, local, c, rootX, events) {
  var out = workload(70, 85, c);
  for(var i=0;i<4;i++) {
    var reached = events && events["artifact"+i];
    if (reached) out += station(i,stages[i][1],c);
    var proximity = 1 - ease((Math.abs(rootX-stages[i][1])-20)/65);
    if (proximity > 0) out += '<g opacity="'+r(proximity)+'">' + consoleControl(stages[i][1]+29,334,c) + '</g>';
  }
  out += text(550,92, ["Record demand over a representative period","Check dependencies, latency and recovery","Comparison inputs · same time period · no result yet","Define pilot criteria and rollback before testing"][beat],22,c.m,500,"middle");
  return result(out, ["baseline", "dependency-map", "cost-comparison", "pilot-gate"].filter(function(_, i) {return events && events["artifact"+i];}));
}
function decisionScene(beat, local, c, rootX, events) {
  var supplied = events && events.evidence;
  var out = workload(170,155,c) + wire("M204 155H335",c,true);
  out += '<g data-object="decision-gate">' +
    text(350,88,"Evidence gate",25,c.t,700) +
    text(350,132,"Requirements",21,c.t,600) +
    text(350,172,"Total cost",21,c.t,600) +
    text(350,212,"Pilot evidence",21,c.t,600) + '</g>';
  if (!events.routes) out += consoleControl(876,334,c);
  if (supplied && !events.routes) {
    out += '<g data-object="evidence-input">' + text(350,270,"Compare the evidence",20,c.m,500) + '</g>';
  }
  if (events && events.routes) {
    out += wire("M560 150H610V68H650M610 150V210H650",c,true);
    out += '<g data-object="move-route">' + text(665,48,"Move if",22,c.t,700) +
      text(665,80,"Requirements, costs",18,c.m,500) + text(665,108,"and pilot support it",18,c.m,500) + cloudIcon(920,83,c) + '</g>';
    out += '<g data-object="retain-route">' + text(665,180,"Retain if",22,c.t,700) +
      text(665,212,"Requirements cannot",18,c.m,500) + text(665,240,"be met, or local",18,c.m,500) + text(665,268,"fits better",18,c.m,500) + rackIcon(890,160,c) + '</g>';
  }
  out += '<g data-object="pilot-action">' + text(350,355,"Pilot one workload",30,c.a,700) +
    text(350,390,"Time-box it. Keep rollback. Then decide.",20,c.m,500) + '</g>';
  return result(out, ["decision-gate","move-route","retain-route","pilot-action"]);
}
var sceneProps = {question:bookendScene, "on-prem":loadMeter, cloud:cloudScene, evidence:evidenceScene, decision:decisionScene};
