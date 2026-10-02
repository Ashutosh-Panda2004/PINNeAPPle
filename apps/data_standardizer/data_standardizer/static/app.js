"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const num = (v) => (typeof v === "number" && isFinite(v) ? PChart.fmt(v) : "—");

let META = null, FILES = [], MODE = null, INSPECT = null, RESULT = null, VAR = null;
const OPTS = { resample: "auto", layout: "wide" };
const PALETTE = ["#0e7490", "#d9480f", "#6941c6", "#1a7f4b", "#b42318", "#0b6bcb", "#a16207", "#be185d"];

// ── tabs ─────────────────────────────────────────────────────────────────────
$$("#tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
function showTab(n) {
  $$("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === n));
  $$(".tab").forEach((t) => t.classList.toggle("active", t.id === `tab-${n}`));
  if (n === "result" && RESULT) requestAnimationFrame(drawCharts);
}

// ── files ────────────────────────────────────────────────────────────────────
const drop = $("#drop");
["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => addFiles([...e.dataTransfer.files]));
$("#files").addEventListener("change", (e) => { addFiles([...e.target.files]); e.target.value = ""; });
function addFiles(list) {
  for (const f of list) if (!FILES.some((x) => x.name === f.name)) FILES.push(f);
  FILES = FILES.slice(0, META ? META.max_files : 8);
  renderFiles();
}
function renderFiles() {
  $("#filelist").innerHTML = FILES.map((f, i) => `<div><span><b>${esc(f.name)}</b> · ${(f.size / 1024).toFixed(0)} KB</span><button data-i="${i}" title="Remove">×</button></div>`).join("");
  $$("#filelist button").forEach((b) => b.addEventListener("click", () => { FILES.splice(+b.dataset.i, 1); renderFiles(); }));
  $("#inspect").disabled = !FILES.length;
}

async function call(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) {
    const j = await r.json().catch(() => ({ detail: `HTTP ${r.status}` }));
    throw new Error(typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail));
  }
  return r;
}
function busy(btn, text) {
  const old = btn.textContent; btn.disabled = true;
  btn.innerHTML = `<span class="spinner" style="border-color:#0e749055;border-top-color:#0e7490"></span>${text}`;
  return () => { btn.disabled = false; btn.textContent = old; };
}

async function inspect(mode) {
  const btn = mode === "example" ? $("#example") : $("#inspect");
  const done = busy(btn, "Reading…");
  $("#status").textContent = "";
  try {
    let r;
    if (mode === "example") r = await call(`/api/example/inspect?system=${$("#system").value}`);
    else {
      const fd = new FormData();
      FILES.forEach((f) => fd.append("files", f));
      fd.append("system", $("#system").value);
      r = await call("/api/inspect", { method: "POST", body: fd });
    }
    INSPECT = await r.json(); MODE = mode; RESULT = null;
    renderSources(); renderMapping();
    $("#result").innerHTML = `<div class="empty"><h3>Nothing standardized yet</h3><p>Review the mapping and press Standardize.</p></div>`;
    showTab("mapping");
  } catch (e) { $("#status").innerHTML = `<span class="err">${esc(e.message)}</span>`; }
  finally { done(); }
}
$("#inspect").addEventListener("click", () => inspect("files"));
$("#example").addEventListener("click", () => inspect("example"));
$("#system").addEventListener("change", () => { if (INSPECT) inspect(MODE); });

function renderSources() {
  $("#sources-view").innerHTML = `<h2 style="margin-top:0">${INSPECT.sources.length} source${INSPECT.sources.length > 1 ? "s" : ""} read</h2>` +
    INSPECT.sources.map((s) => `<div class="src">
      <h3>${esc(s.file.name)} <span class="pill">${esc(s.file.format)}</span></h3>
      <div class="meta">${s.file.rows.toLocaleString()} rows × ${s.file.columns} columns${s.file.delimiter ? ` · separator “${esc(s.file.delimiter)}”, decimal “${esc(s.file.decimal)}”` : ""}${s.file.sheet ? ` · sheet ${esc(s.file.sheet)}` : ""}
        · time column <b>${esc(s.mapping.time_column || "not found")}</b>${s.mapping.time_parsed_as ? ` (${esc(s.mapping.time_parsed_as)})` : ""}</div>
      <div class="prev"><table><thead><tr>${s.header.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
        <tbody>${s.preview.map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
    </div>`).join("");
}

// ── mapping ──────────────────────────────────────────────────────────────────
function unitOptions(q, cur) {
  const ch = (META.unit_choices[q] || []).slice();
  if (cur && !ch.includes(cur)) ch.unshift(cur);
  return ch.map((u) => `<option ${u === cur ? "selected" : ""}>${esc(u)}</option>`).join("");
}
function renderMapping() {
  const tzs = META.timezones;
  $("#mapping").innerHTML = `<div class="toolbar"><h2 style="margin:0">Mapping</h2><span class="meta">Draft from the headers — review, edit, then standardize.</span></div>
    <div class="globalopts">
      <label>Time grid<select id="resample">${[["auto", "Auto (coarsest source)"], ["none", "None (keep timestamps)"], ["1s", "1 s"], ["10s", "10 s"], ["1min", "1 min"], ["5min", "5 min"], ["15min", "15 min"], ["1h", "1 h"], ["1D", "1 day"]]
        .map(([v, l]) => `<option value="${v}" ${OPTS.resample === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label>Table layout<select id="layout"><option value="wide">Wide: one column per variable</option><option value="long" ${OPTS.layout === "long" ? "selected" : ""}>Long: time, source, variable, value, unit</option></select></label>
      <button class="primary" type="button" id="run">Standardize</button>
    </div>
    <div class="status-line" id="run-status"></div>
    ${INSPECT.sources.map((s, si) => {
      const m = s.mapping;
      return `<div class="src" data-si="${si}">
        <h3>${esc(m.source)} <span class="pill">${esc(s.file.format)}</span></h3>
        <div class="srcopts">
          <label>Time column<select data-k="time_column">${s.header.map((h) => `<option ${h === m.time_column ? "selected" : ""}>${esc(h)}</option>`).join("")}</select></label>
          <label>Time zone of the timestamps<select data-k="timezone">${tzs.map((z) => `<option ${z === m.timezone ? "selected" : ""}>${z}</option>`).join("")}</select>
            ${m.timezone_needed ? `<span class="tzwarn">Local times without an offset: set the site's time zone.</span>` : `<span class="meta">Timestamps carry their offset (or are Unix time): the zone is ignored.</span>`}</label>
        </div>
        <div class="maptable"><table><thead><tr><th>Use</th><th>Source column</th><th>Unit</th><th>Quantity</th><th>Target name</th><th>Target unit</th><th>Conversion</th><th title="Temperature difference: no offset">ΔT</th></tr></thead><tbody>
        ${m.columns.map((c, ci) => `<tr data-ci="${ci}" class="${c.include ? "" : "off"}">
          <td><input type="checkbox" data-k="include" ${c.include ? "checked" : ""} ${c.kind !== "numeric" ? "disabled" : ""}></td>
          <td class="src-col">${esc(c.source)}${c.kind !== "numeric" ? ' <span class="pill">text</span>' : ""}${!c.unit_known && c.kind === "numeric" ? ' <span class="pill warning">no unit</span>' : ""}</td>
          <td><input data-k="unit" value="${esc(c.unit || "")}" placeholder="unit" style="width:80px"></td>
          <td><select data-k="quantity"><option value="">—</option>${META.quantities.map((q) => `<option value="${q}" ${q === c.quantity ? "selected" : ""}>${q.replace(/_/g, " ")}</option>`).join("")}</select></td>
          <td><input class="tgt" data-k="target" value="${esc(c.target || "")}"></td>
          <td><select data-k="target_unit">${unitOptions(c.quantity, c.target_unit)}</select></td>
          <td class="conv">${esc(c.conversion || "")}</td>
          <td><input type="checkbox" data-k="difference" ${c.difference ? "checked" : ""}></td></tr>`).join("")}
        </tbody></table></div></div>`;
    }).join("")}`;
  $("#resample").addEventListener("change", (e) => (OPTS.resample = e.target.value));
  $("#layout").addEventListener("change", (e) => (OPTS.layout = e.target.value));
  $("#run").addEventListener("click", run);
  $$("#mapping .src").forEach((box) => {
    const m = INSPECT.sources[+box.dataset.si].mapping;
    $$(".srcopts select", box).forEach((el) => el.addEventListener("change", () => (m[el.dataset.k] = el.value)));
    $$("tbody tr", box).forEach((tr) => {
      const c = m.columns[+tr.dataset.ci];
      $$("[data-k]", tr).forEach((el) => el.addEventListener("change", async () => {
        const k = el.dataset.k;
        c[k] = el.type === "checkbox" ? el.checked : el.value;
        if (k === "include") tr.classList.toggle("off", !el.checked);
        if (k === "quantity") {
          const sys = META.unit_choices[c.quantity] || [];
          c.target_unit = sys.includes(c.target_unit) ? c.target_unit : (sys[1] || sys[0] || c.unit);
          $('[data-k="target_unit"]', tr).innerHTML = unitOptions(c.quantity, c.target_unit);
        }
        if (["unit", "quantity", "target_unit", "difference"].includes(k) && c.unit && c.target_unit) {
          try {
            const j = await (await call(`/api/convert?src=${encodeURIComponent(c.unit)}&dst=${encodeURIComponent(c.target_unit)}&difference=${!!c.difference}`)).json();
            $(".conv", tr).textContent = j.text;
          } catch { /* ignore */ }
        }
      }));
    });
  });
}

function recipe() {
  return { schema: "pinneapple.recipe/1", target_system: $("#system").value, resample: OPTS.resample === "none" ? null : OPTS.resample,
    agg: "mean", layout: OPTS.layout,
    sources: INSPECT.sources.map((s) => ({ match: s.mapping.source, time_column: s.mapping.time_column, timezone: s.mapping.timezone,
      columns: s.mapping.columns.map((c) => ({ source: c.source, include: !!c.include, quantity: c.quantity || null, unit: c.unit || null,
        target: c.target, target_unit: c.target_unit, difference: !!c.difference })) })) };
}
function formData(fmt) {
  const fd = new FormData();
  if (MODE !== "example") FILES.forEach((f) => fd.append("files", f));
  fd.append("recipe", JSON.stringify(recipe()));
  fd.append("format", fmt);
  fd.append("layout", OPTS.layout);
  return fd;
}
const endpoint = () => (MODE === "example" ? "/api/example/standardize" : "/api/standardize");

async function run() {
  const done = busy($("#run"), "Standardizing…");
  $("#run-status").textContent = "";
  try {
    RESULT = await (await call(endpoint(), { method: "POST", body: formData("preview") })).json();
    VAR = RESULT.manifest.variables.find((v) => v.sources.length > 1)?.name || RESULT.manifest.variables[0]?.name;
    renderResult(); showTab("result");
  } catch (e) { $("#run-status").innerHTML = `<span class="err">${esc(e.message)}</span>`; }
  finally { done(); }
}

// ── result ───────────────────────────────────────────────────────────────────
const VERDICT = { agree: "ok", offset: "warning", differ: "critical", "time shift": "critical", "no overlap": "" };
function renderResult() {
  const r = RESULT, m = r.manifest;
  const agree = r.agreement.length ? `<h3>Do the sources agree after conversion?</h3>
    <p class="meta" style="margin-top:-4px">Where two sources measure the same variable, their values are compared on the common grid. A wrong unit or time zone shows here.</p>
    <table class="agree"><thead><tr><th>Variable</th><th>Compared</th><th class="num">Points</th><th class="num">Median |Δ|</th><th>Verdict</th><th>Reading</th></tr></thead><tbody>
    ${r.agreement.map((a) => `<tr><td><b>${esc(a.variable)}</b></td><td class="meta">${esc((a.a.split("@")[1] || a.a))} vs ${esc(a.b.split("@")[1] || a.b)}</td>
      <td class="num">${a.n}</td><td class="num">${a.median_abs_diff !== undefined ? `${num(a.median_abs_diff)} ${esc(a.unit)}` : "—"}</td>
      <td><span class="pill ${VERDICT[a.verdict] || ""}">${esc(a.verdict)}</span></td><td class="meta">${esc(a.note || "")}</td></tr>`).join("")}</tbody></table>` : "";
  const ok = r.agreement.filter((a) => a.verdict === "agree").length;
  const bad = r.agreement.filter((a) => ["differ", "time shift"].includes(a.verdict)).length;
  $("#result").innerHTML = `
    <div class="toolbar"><h2 style="margin:0">Unified dataset</h2><span class="meta">schema ${esc(m.schema)}</span></div>
    ${r.agreement.length ? `<div class="banner ${bad ? "bad" : ok === r.agreement.length ? "ok" : "warn"}">${bad ? `${bad} comparison${bad > 1 ? "s" : ""} between sources disagree: check the units and time zones below.` : `All ${r.agreement.length} cross-source comparisons ${ok === r.agreement.length ? "agree" : "are consistent"} after conversion.`}</div>` : ""}
    <div class="kpis">
      <div class="kpi"><div class="l">Sources</div><div class="v">${m.sources.length}</div><div class="s">${m.sources.map((s) => esc(s.tag)).join(" · ")}</div></div>
      <div class="kpi"><div class="l">Variables</div><div class="v">${m.variables.length}</div><div class="s">${r.columns.length - 1} columns (wide)</div></div>
      <div class="kpi"><div class="l">Rows</div><div class="v">${r.rows.toLocaleString()}</div><div class="s">${r.long_rows.toLocaleString()} in long layout</div></div>
      <div class="kpi"><div class="l">Time grid</div><div class="v">${esc(r.resample || "original")}</div><div class="s">UTC · ${esc(m.time.aggregation || "no aggregation")}</div></div>
    </div>
    ${r.notes.length ? `<div class="warnings">${r.notes.map((n) => `<div>${esc(n)}</div>`).join("")}</div>` : ""}
    <h3>Download</h3>
    <div class="dl">
      <button class="main" data-f="zip">ZIP bundle (CSV + Parquet + HDF5 + manifest + recipe)</button>
      <button data-f="csv">CSV</button><button data-f="parquet">Parquet</button><button data-f="hdf5">HDF5</button>
      <button data-f="json">JSON</button><button data-f="manifest">Manifest</button><button data-f="recipe">Recipe</button>
    </div>
    <p class="meta">Layout: ${OPTS.layout}. Parquet stores units in the schema metadata, HDF5 in each dataset's attributes; the manifest lists the conversion applied to every source column.</p>
    ${agree}
    <h3>Before and after</h3>
    <div class="colpick"><select id="varsel">${m.variables.map((v) => `<option ${v.name === VAR ? "selected" : ""}>${esc(v.name)}</option>`).join("")}</select>
      <span class="meta" id="varmeta"></span></div>
    <div class="charts2"><div><h4>As recorded (each source in its own unit and clock)</h4><div id="ch-before"></div></div>
      <div><h4>Standardized (common unit, UTC)</h4><div id="ch-after"></div></div></div>
    <h3>Variables and conversions</h3>
    <table><thead><tr><th>Variable</th><th>Quantity</th><th>Unit</th><th>From</th></tr></thead><tbody>
    ${m.variables.map((v) => `<tr><td><b>${esc(v.name)}</b></td><td>${esc((v.quantity || "").replace(/_/g, " "))}</td><td>${esc(v.unit)}</td>
      <td class="meta">${v.sources.map((s) => `${esc(s.tag)}: <code>${esc(s.column)}</code> [${esc(s.unit)}] ${esc(s.conversion)}`).join("<br>")}</td></tr>`).join("")}</tbody></table>
    <h3>First rows</h3>
    <div class="headtab"><table><thead><tr>${r.columns.map((c) => `<th>${esc(c)}${m.units[c] ? ` [${esc(m.units[c])}]` : ""}</th>`).join("")}</tr></thead>
      <tbody>${r.head.map((row) => `<tr>${row.map((v) => `<td>${typeof v === "number" ? num(v) : esc(v ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
    <details class="man"><summary>Manifest (pinneapple.upd/1)</summary><pre class="code"><code>${esc(JSON.stringify({ ...m, recipe: "… (download Recipe)" }, null, 2))}</code></pre></details>
    ${window.renderScope ? renderScope(r.scope) : ""}`;
  $$(".dl button").forEach((b) => b.addEventListener("click", () => download(b.dataset.f, b)));
  $("#varsel").addEventListener("change", (e) => { VAR = e.target.value; drawCharts(); });
  requestAnimationFrame(drawCharts);
}

function drawCharts() {
  const c = RESULT.charts[VAR];
  if (!c) return;
  const v = RESULT.manifest.variables.find((x) => x.name === VAR);
  $("#varmeta").textContent = `${v.sources.length} source${v.sources.length > 1 ? "s" : ""} · target unit ${v.unit}`;
  PChart.mount($("#ch-before"), { height: 230, x: c.x, legend: true, series: c.before.map((s, i) => ({ name: s.name, y: s.y, color: PALETTE[i % 8], width: 1.4 })) });
  PChart.mount($("#ch-after"), { height: 230, x: c.x, legend: true, yLabel: c.unit, series: c.after.map((s, i) => ({ name: s.name, y: s.y, color: PALETTE[i % 8], width: 1.4, dash: i ? "5 3" : "" })) });
}

async function download(fmt, btn) {
  const done = busy(btn, "Preparing…");
  try {
    const r = await call(endpoint(), { method: "POST", body: formData(fmt) });
    const blob = await r.blob();
    const name = (r.headers.get("Content-Disposition") || "").match(/filename="([^"]+)"/)?.[1] || `unified.${fmt}`;
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  } catch (e) { alert(e.message); }
  finally { done(); }
}

// ── init ─────────────────────────────────────────────────────────────────────
(async function init() {
  META = await (await fetch("/api/meta")).json();
  $("#system").innerHTML = Object.entries(META.unit_systems).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("");
  $("#maxfiles").textContent = META.max_files;
  const o = location.origin;
  $("#c1").textContent = `curl -u USER:PASSWORD -F "files=@bms_export.csv" -F "files=@scada_api.json" -F system=metric \\\n     ${o}/api/inspect | jq .recipe > recipe.json\n# review / edit recipe.json (targets, units, time zones)`;
  $("#c2").textContent = `curl -u USER:PASSWORD -F "files=@bms_2026-04.csv" -F "files=@scada_2026-04.json" \\\n     -F "recipe=<recipe.json" -F format=parquet ${o}/api/standardize -o unified_2026-04.parquet`;
  $("#c3").textContent = `import json, requests\n\nfiles = [("files", open("bms_2026-04.csv", "rb")), ("files", open("scada_2026-04.json", "rb"))]\nr = requests.post("${o}/api/standardize", auth=("USER", "PASSWORD"), files=files,\n                  data={"recipe": open("recipe.json").read(), "format": "zip"})\nopen("unified_2026-04.zip", "wb").write(r.content)`;
})();
window.addEventListener("resize", () => { if (RESULT && $("#tab-result").classList.contains("active")) drawCharts(); });
