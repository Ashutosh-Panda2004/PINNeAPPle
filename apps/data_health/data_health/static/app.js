"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (v, d = 1) => (typeof v === "number" && isFinite(v) ? v.toFixed(d) : "—");
const num = (v) => (typeof v === "number" && isFinite(v) ? PChart.fmt(v) : "—");

let FILE = null, REPORT = null, SEL = null, FILTER = "all";

// ── tabs ─────────────────────────────────────────────────────────────────────
$$("#tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
function showTab(n) {
  $$("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === n));
  $$(".tab").forEach((t) => t.classList.toggle("active", t.id === `tab-${n}`));
  if (n === "report" && REPORT) requestAnimationFrame(() => { drawHeat(); drawSeries(); drawRelations(); });
}

// ── file input ───────────────────────────────────────────────────────────────
const drop = $("#drop");
["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => { if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); });
$("#file").addEventListener("change", (e) => { if (e.target.files[0]) setFile(e.target.files[0]); });
function setFile(f) {
  FILE = f;
  $("#fileinfo").innerHTML = `<b>${esc(f.name)}</b> · ${(f.size / 1024 / 1024).toFixed(2)} MB`;
  $("#timecol").innerHTML = `<option value="">Auto-detect</option>`;
  $("#sheet-l").style.display = "none";
  $("#run").disabled = false;
}

async function analyse(kind) {
  const btn = kind === "example" ? $("#example") : $("#run");
  const label = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner" style="border-color:#6941c655;border-top-color:#6941c6"></span>Analysing…`;
  $("#status").textContent = "";
  try {
    let r;
    if (kind === "example") r = await fetch("/api/example");
    else {
      const fd = new FormData();
      fd.append("file", FILE);
      if ($("#timecol").value) fd.append("time_column", $("#timecol").value);
      if ($("#sheet").value && $("#sheet-l").style.display !== "none") fd.append("sheet", $("#sheet").value);
      if ($("#units").value.trim()) fd.append("units", $("#units").value.trim());
      r = await fetch("/api/analyze", { method: "POST", body: fd });
    }
    const j = await r.json().catch(() => ({ detail: `HTTP ${r.status}` }));
    if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail));
    REPORT = j; SEL = null; FILTER = "all";
    if (kind === "example") { FILE = null; $("#fileinfo").innerHTML = `<b>Example:</b> chiller_plant_week.csv`; }
    fillOptions(j);
    renderReport(); renderColumns();
    showTab("report");
  } catch (e) {
    $("#status").innerHTML = `<span class="err">${esc(e.message)}</span>`;
  } finally {
    btn.disabled = kind !== "example" && !FILE;
    btn.textContent = label;
  }
}
$("#run").addEventListener("click", () => analyse("file"));
$("#example").addEventListener("click", () => analyse("example"));

function fillOptions(r) {
  const tc = $("#timecol"), cur = r.summary.time_column;
  tc.innerHTML = `<option value="">Auto-detect${cur ? ` (found: ${esc(cur)})` : ""}</option>` +
    (r.columns_all || []).map((c) => `<option ${c === cur ? "" : ""}>${esc(c)}</option>`).join("");
  const sh = r.file.sheets || [];
  $("#sheet-l").style.display = sh.length > 1 ? "" : "none";
  $("#sheet").innerHTML = sh.map((s) => `<option ${s === r.file.sheet ? "selected" : ""}>${esc(s)}</option>`).join("");
}

// ── report ──────────────────────────────────────────────────────────────────
const COLOR = (s) => (s === null ? "#c9d1dd" : s >= 85 ? "#1a7f4b" : s >= 60 ? "#d49100" : "#b42318");

function gauge(score) {
  const r = 78, c = 2 * Math.PI * r, f = Math.max(0, Math.min(100, score)) / 100;
  return `<div class="gauge"><svg viewBox="0 0 180 180"><circle cx="90" cy="90" r="${r}" stroke="#eef1f5" stroke-width="14" fill="none"/>
    <circle cx="90" cy="90" r="${r}" stroke="${COLOR(score)}" stroke-width="14" fill="none" stroke-linecap="round"
      stroke-dasharray="${c * f} ${c}"/></svg>
    <div class="val"><div><b>${Math.round(score)}</b><span>data health / 100</span></div></div></div>`;
}

function renderReport() {
  const r = REPORT, s = r.summary, sc = r.score;
  const counts = { critical: 0, warning: 0, info: 0 };
  r.issues.forEach((i) => counts[i.severity]++);
  const cats = Object.values(sc.categories).map((c) => `<div class="cat ${c.applicable ? "" : "na"}">
      <span>${esc(c.label)}</span>
      <div class="track">${c.applicable ? `<div class="fill" style="width:${c.score}%;background:${COLOR(c.score)}"></div>` : ""}</div>
      <span class="n">${c.applicable ? `${Math.round(c.score)} · ${c.issues} issue${c.issues === 1 ? "" : "s"}` : "n/a"}</span></div>`).join("");
  const gaps = r.issues.find((i) => i.category === "time_axis" && /gap/.test(i.title));
  const answer = r.answer_key ? answerKey(r) : "";
  $("#report").innerHTML = `
    <div class="toolbar"><h2 style="margin:0">Health report · ${esc(r.file.name)}</h2>
      <div class="noprint" style="display:flex;gap:6px"><button class="ghost" id="dl">Download JSON</button><button class="ghost" onclick="print()">Print / PDF</button></div></div>
    <div class="banner ${sc.level}">${esc(sc.verdict)}</div>
    <div class="hero">${gauge(sc.overall)}<div class="cats">${cats}
      <div class="meta" style="margin-top:6px">${esc(sc.method)}</div></div></div>
    <h3>Dataset</h3>
    <div class="kpis">
      <div class="kpi"><div class="l">Rows × columns</div><div class="v">${s.rows.toLocaleString()} × ${s.columns}</div><div class="s">${esc(r.file.format)}${r.file.delimiter ? ` · sep “${esc(r.file.delimiter)}” · decimal “${esc(r.file.decimal)}”` : ""}${r.file.sheet ? ` · sheet ${esc(r.file.sheet)}` : ""}</div></div>
      <div class="kpi"><div class="l">Period</div><div class="v" style="font-size:15px">${s.start ? `${esc(s.start)}<br>→ ${esc(s.end)}` : "no time axis"}</div><div class="s">${s.time_column ? `time column “${esc(s.time_column)}”, ${esc(s.time_parsed_as)}` : ""}</div></div>
      <div class="kpi"><div class="l">Sampling</div><div class="v">${esc(s.sampling || "—")}</div><div class="s">${s.irregular_pct !== undefined ? `${fmt(s.irregular_pct, 1)} % irregular steps` : ""}</div></div>
      <div class="kpi"><div class="l">Gaps</div><div class="v">${gaps ? gaps.count : 0}</div><div class="s">${gaps ? esc(gaps.detail.split(";")[0]) : "none found"}</div></div>
      <div class="kpi"><div class="l">Issues</div><div class="v"><span style="color:var(--bad)">${counts.critical}</span> · <span style="color:#b07800">${counts.warning}</span> · <span style="color:#0b6bcb">${counts.info}</span></div><div class="s">critical · warning · info</div></div>
    </div>
    ${answer}
    <h3>Where the problems are</h3>
    <p class="meta" style="margin-top:-4px">One row per numeric column over time. Click a column name to plot it.</p>
    <div class="heatwrap"><div class="heat-names" id="heat-names"></div><div class="heat"><canvas id="heat"></canvas></div></div>
    <div class="heat-legend"><span><i style="background:#3fa86b"></i>data present</span><span><i style="background:#d0d6df"></i>missing</span>
      <span><i style="background:#e0a100"></i>flagged (warning)</span><span><i style="background:#c8331f"></i>flagged (critical)</span>
      <span id="heat-range" style="margin-left:auto"></span></div>
    <h3>Column detail</h3>
    <div class="colpick"><select id="colsel"></select><span class="meta" id="colmeta"></span></div>
    <div id="series" style="margin-top:8px"></div>
    <div id="relations"></div>
    <h3>Issues</h3>
    <div class="filters" id="filters">${["all", "critical", "warning", "info"].map((f) => `<button data-f="${f}" class="${f === FILTER ? "on" : ""}">${f === "all" ? `All (${r.issues.length})` : `${f} (${counts[f]})`}</button>`).join("")}</div>
    <div class="issues" id="issues"></div>
    ${window.renderScope ? renderScope(r.scope) : ""}`;
  $("#dl").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(REPORT, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = (r.file.name || "dataset").replace(/\.[^.]+$/, "") + "_health_report.json"; a.click();
  });
  $$("#filters button").forEach((b) => b.addEventListener("click", () => { FILTER = b.dataset.f; $$("#filters button").forEach((x) => x.classList.toggle("on", x === b)); renderIssues(); }));
  const numeric = r.columns.filter((c) => c.kind === "numeric");
  const worst = numeric.slice().sort((a, b) => a.score - b.score)[0];
  SEL = SEL || (worst && worst.name);
  $("#colsel").innerHTML = numeric.map((c) => `<option ${c.name === SEL ? "selected" : ""}>${esc(c.name)}</option>`).join("");
  $("#colsel").addEventListener("change", (e) => { SEL = e.target.value; drawSeries(); });
  renderIssues();
  requestAnimationFrame(() => { drawHeat(); drawSeries(); drawRelations(); });
}

function answerKey(r) {
  const TYPE = {
    energy_balance: (i) => i.category === "physics_consistency", stuck: (i) => /Stuck/.test(i.title),
    unit_switch: (i) => /Unit changes/.test(i.title), impossible: (i) => /impossible/.test(i.title) && /RH/.test(i.column || ""),
    spikes: (i) => i.title === "Spikes", sentinel: (i) => /Error code/.test(i.title), gap: (i) => /gap/.test(i.title),
    duplicates: (i) => /Duplicate timestamps/.test(i.title),
  };
  const LABEL = { energy_balance: "Flow meter reads 28 % low from day 4 (values look normal)", stuck: "Supply-temperature sensor frozen for 6 h",
    unit_switch: "Outdoor temperature logged in kelvin for 10 h", impossible: "Humidity sensor reads above 100 %",
    spikes: "14 spikes on condenser pressure", sentinel: "Valve position = −999 while offline", gap: "Logger offline for 3 h",
    duplicates: "30 rows re-sent by the gateway" };
  const rows = r.answer_key.faults.map((f) => {
    const hit = r.issues.find((i) => TYPE[f.type] && TYPE[f.type](i));
    return `<tr><td>${hit ? '<span class="pill ok">found</span>' : '<span class="pill critical">missed</span>'}</td><td>${esc(LABEL[f.type] || f.type)}</td>
      <td class="meta">${hit ? esc(hit.title) : ""}</td></tr>`;
  }).join("");
  const found = r.answer_key.faults.filter((f) => r.issues.some((i) => TYPE[f.type] && TYPE[f.type](i))).length;
  return `<h3>Example answer key: ${found} of ${r.answer_key.faults.length} injected faults found</h3>
    <table class="answer"><tbody>${rows}</tbody></table>`;
}

function renderIssues() {
  const list = REPORT.issues.filter((i) => FILTER === "all" || i.severity === FILTER);
  $("#issues").innerHTML = list.map((i, k) => `<div class="issue ${i.severity}" data-col="${esc(i.column || "")}">
      <div class="hd"><span class="pill ${i.severity}">${i.severity}</span><b>${esc(i.title)}</b>
        ${i.column ? `<span class="col">${esc(i.column)}</span>` : ""}<span class="meta">${esc(REPORT.score.categories[i.category]?.label || i.category)}</span></div>
      <div class="dt">${esc(i.detail)}</div>
      ${i.spans && i.spans.length ? `<div class="spans">${i.spans.slice(0, 4).map((s) => `${esc(s[0])} → ${esc(s[1])}`).join(" · ")}${i.spans.length > 4 ? ` · +${i.spans.length - 4} more` : ""}</div>` : ""}
      ${i.suggestion ? `<div class="fix">${esc(i.suggestion)}</div>` : ""}</div>`).join("") || `<p class="meta">No issues in this category.</p>`;
  $$("#issues .issue").forEach((el) => el.addEventListener("click", () => {
    const c = el.dataset.col;
    if (c && REPORT.series[c]) {
      SEL = c; $("#colsel").value = c; drawSeries();
      $("#colsel").scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }));
}

function drawHeat() {
  const av = REPORT.availability, cols = Object.keys(av.columns || {});
  const cv = $("#heat");
  if (!cv || !cols.length) return;
  const nb = av.columns[cols[0]].length, rowH = 18;
  cv.width = nb; cv.height = cols.length * rowH;
  cv.style.height = cols.length * rowH + "px";
  const ctx = cv.getContext("2d");
  const sev = {};
  REPORT.issues.forEach((i) => { if (i.column) sev[i.column] = sev[i.column] === "critical" ? "critical" : i.severity === "critical" ? "critical" : sev[i.column] || i.severity; });
  cols.forEach((c, r) => av.columns[c].forEach(([a, f], k) => {
    let col = a > 0.5 ? "#3fa86b" : "#d0d6df";
    if (a > 0 && a <= 0.5) col = "#9fd3b4";
    if (f > 0) col = sev[c] === "critical" ? "#c8331f" : "#e0a100";
    ctx.fillStyle = col; ctx.fillRect(k, r * rowH + 2, 1, rowH - 4);
  }));
  $("#heat-names").innerHTML = cols.map((c) => `<div title="${esc(c)}" data-c="${esc(c)}">${esc(c)}</div>`).join("");
  $$("#heat-names div").forEach((d) => d.addEventListener("click", () => { SEL = d.dataset.c; $("#colsel").value = SEL; drawSeries(); }));
  $("#heat-range").textContent = av.bins.length ? `${av.bins[0]} → ${av.bins[av.bins.length - 1]}` : "";
}

function drawSeries() {
  const s = REPORT.series[SEL], c = REPORT.columns.find((x) => x.name === SEL);
  if (!s || !c) return;
  $("#colmeta").innerHTML = `${c.unit ? `unit <b>${esc(c.unit)}</b>` : "<b>no unit</b>"} · ${c.quantity ? `quantity <b>${esc(c.quantity.replace(/_/g, " "))}</b> (${Math.round(c.quantity_confidence * 100)} %)` : "quantity unknown"}
    · range ${num(c.min)} … ${num(c.max)} · ${fmt(c.missing_pct, 1)} % missing · column score ${Math.round(c.score)}`;
  PChart.mount($("#series"), { height: 240, x: s.x, flags: s.flag, yLabel: `${c.base_name}${c.unit ? ` [${c.unit}]` : ""}`,
    series: [{ name: c.name, lo: s.lo, hi: s.hi, color: "#6941c6" }] });
}

function drawRelations() {
  const rel = REPORT.relations || [];
  const el = $("#relations");
  if (!el) return;
  if (!rel.length) { el.innerHTML = ""; return; }
  el.innerHTML = `<h3>Physics consistency</h3>` + rel.map((r, k) => `<div class="relation">
      <div><b>${esc(r.type)}</b> · <span class="eq">${esc(r.equation)}</span> · ${esc(r.fluid)}</div>
      <div class="meta">${Object.entries(r.columns).map(([k2, v]) => `${k2}: <b>${esc(v)}</b>`).join(" · ")}</div>
      <div class="meta">Computed ÷ reported heat rate: median ${fmt(r.median_ratio, 2)}; outside ±15 % on ${fmt(r.violating_pct, 0)} % of the record.</div>
      <div id="rel-${k}" style="margin-top:6px"></div></div>`).join("");
  rel.forEach((r, k) => PChart.mount($(`#rel-${k}`), { height: 190, x: r.ratio_series.x, yLabel: "ratio", band: { lo: 0.85, hi: 1.15, color: "#1a7f4b14" },
    hlines: [{ y: 1, color: "#1a7f4b", label: "balance closes" }], series: [{ name: "ρ·V·cp·ΔT ÷ reported", y: r.ratio_series.y, color: "#b42318" }] }));
}

// ── columns tab ──────────────────────────────────────────────────────────────
function renderColumns() {
  const r = REPORT;
  $("#columns").innerHTML = `<h2 style="margin-top:0">Columns · ${esc(r.file.name)}</h2>
    <p class="meta">Unit read from the header (or file metadata), physical quantity inferred from the unit's dimension and the name, and a health score per column.</p>
    <div style="overflow-x:auto"><table class="ctable"><thead><tr><th>Column</th><th>Unit</th><th>Quantity</th><th class="num">Missing</th>
      <th class="num">Min</th><th class="num">Max</th><th class="num">Mean</th><th>Score</th><th>Flags</th></tr></thead><tbody>
    ${r.columns.map((c) => `<tr><td class="name">${esc(c.name)}</td><td>${c.unit ? esc(c.unit) : '<span class="pill warning">none</span>'}</td>
      <td>${c.quantity ? `${esc(c.quantity.replace(/_/g, " "))} <span class="meta">${Math.round(c.quantity_confidence * 100)} %</span>` : '<span class="meta">—</span>'}</td>
      <td class="num">${fmt(c.missing_pct, 1)} %</td><td class="num">${num(c.min)}</td><td class="num">${num(c.max)}</td><td class="num">${num(c.mean)}</td>
      <td>${c.kind === "numeric" ? `<span class="scorebar"><i style="width:${c.score}%;background:${COLOR(c.score)}"></i></span>${Math.round(c.score)}` : `<span class="meta">text</span>`}</td>
      <td>${(c.flags || []).map((f) => `<span class="pill ${f.severity}" title="${esc(f.title)}">${esc(f.title)}</span>`).join(" ")}</td></tr>`).join("")}
    </tbody></table></div>`;
}

// ── API tab / init ───────────────────────────────────────────────────────────
(async function init() {
  const o = location.origin;
  $("#curl").textContent = `curl -u USER:PASSWORD -F "file=@plant_export.csv" ${o}/api/analyze > report.json\n\n# overall score and critical issues\njq '.score.overall, [.issues[] | select(.severity=="critical") | .title]' report.json`;
  $("#py").textContent = `import requests\n\nr = requests.post("${o}/api/analyze", auth=("USER", "PASSWORD"),\n                  files={"file": open("plant_export.parquet", "rb")})\nreport = r.json()\nprint(report["score"]["overall"], report["score"]["verdict"])\nfor issue in report["issues"]:\n    print(issue["severity"], issue["column"], issue["title"])`;
  try { const m = await (await fetch("/api/meta")).json(); $("#maxmb").textContent = m.max_mb; } catch { /* offline */ }
})();
window.addEventListener("resize", () => { if (REPORT && $("#tab-report").classList.contains("active")) { drawSeries(); drawRelations(); } });
