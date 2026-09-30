"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const fmt = (v, d = 1) => (typeof v === "number" && isFinite(v) ? v.toFixed(d) : "—");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let META = null, COMPS = [], LAST = null, FACE = "top";

const EXAMPLE = [
  { name: "FPGA", package: "BGA 35x35", power_w: 8, x_mm: 62, y_mm: 52, side: "top", tj_max_c: 100, vias: 0 },
  { name: "DDR1", package: "BGA 17x17", power_w: 1.2, x_mm: 108, y_mm: 70, side: "top", tj_max_c: 95, vias: 0 },
  { name: "DDR2", package: "BGA 17x17", power_w: 1.2, x_mm: 108, y_mm: 32, side: "top", tj_max_c: 95, vias: 0 },
  { name: "VRM", package: "QFN-32 5x5", power_w: 1.8, x_mm: 22, y_mm: 80, side: "top", tj_max_c: 125, vias: 9 },
  { name: "PHY", package: "QFN-64 9x9", power_w: 1.0, x_mm: 140, y_mm: 20, side: "top", tj_max_c: 125, vias: 0 },
  { name: "LDO", package: "SOIC-8", power_w: 0.6, x_mm: 140, y_mm: 82, side: "top", tj_max_c: 125, vias: 0 },
];

// ── tabs / segmented controls ────────────────────────────────────────────────
$$("#tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
function showTab(n) {
  $$("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === n));
  $$(".tab").forEach((t) => t.classList.toggle("active", t.id === `tab-${n}`));
}
$$(".seg").forEach((seg) => seg.addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  $$("button", seg).forEach((x) => x.classList.toggle("on", x === b));
  if (seg.id === "face-seg") { FACE = b.dataset.v; drawBoard(); return; }
  const forced = b.dataset.v === "forced";
  $$(".forced-only").forEach((el) => (el.style.display = forced ? "" : "none"));
  $$(".natural-only").forEach((el) => (el.style.display = forced ? "none" : ""));
  scheduleQuick();
}));

// ── case assembly ────────────────────────────────────────────────────────────
function caseBody() {
  const f = $("#setup"), v = (n) => $(`[name="${n}"]`, f);
  const num = (n) => Number(v(n).value);
  const forced = $(".seg[data-target=cooling] .on").dataset.v === "forced";
  return {
    board: {
      width_mm: num("width_mm"), depth_mm: num("depth_mm"), n_copper: num("n_copper"),
      thickness_mm: num("thickness_mm"), outer_oz: num("outer_oz"), inner_oz: num("inner_oz"),
      outer_coverage: num("outer_coverage_pct") / 100, inner_coverage: num("inner_coverage_pct") / 100,
      chassis_edges: v("chassis_edges").checked,
    },
    environment: {
      t_ambient_c: num("t_ambient_c"), air_velocity_m_s: forced ? num("air_velocity_m_s") : 0,
      orientation: v("orientation").value, emissivity: num("emissivity"),
    },
    components: COMPS.map((c) => ({ ...c })),
  };
}

async function post(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(Array.isArray(j.detail) ? j.detail.map((d) => `${d.loc.slice(1).join(".")}: ${d.msg}`).join("; ") : j.detail);
  return j;
}

// ── component table ──────────────────────────────────────────────────────────
function renderRows() {
  const pk = Object.keys(META.packages), n = (k, v, w, ph = "") =>
    `<input data-k="${k}" type="number" step="any" value="${v ?? ""}" placeholder="${ph}" style="width:${w}px">`;
  $("#comp-rows").innerHTML = COMPS.map((c, i) => {
    const p = META.packages[c.package] || {};
    return `<tr data-i="${i}">
    <td><input data-k="name" value="${esc(c.name)}" style="width:80px"></td>
    <td><select data-k="package" style="width:130px">${pk.map((q) => `<option ${q === c.package ? "selected" : ""}>${q}</option>`).join("")}</select></td>
    <td>${n("power_w", c.power_w, 64)}</td><td>${n("x_mm", c.x_mm, 64)}</td><td>${n("y_mm", c.y_mm, 64)}</td>
    <td><select data-k="side" style="width:84px"><option ${c.side === "top" ? "selected" : ""}>top</option><option ${c.side === "bottom" ? "selected" : ""}>bottom</option></select></td>
    <td>${n("tj_max_c", c.tj_max_c, 60)}</td><td>${n("theta_jb", c.theta_jb, 60, p.theta_jb)}</td><td>${n("theta_jc", c.theta_jc, 60, p.theta_jc)}</td>
    <td>${n("vias", c.vias, 60)}</td>
    <td><button type="button" class="ghost" data-del="${i}" title="remove">✕</button></td></tr>`;
  }).join("");
}
$("#comp-rows").addEventListener("change", (e) => {
  const tr = e.target.closest("tr"), k = e.target.dataset.k; if (!tr || !k) return;
  const c = COMPS[+tr.dataset.i];
  if (e.target.type === "number" && e.target.value === "") delete c[k];
  else c[k] = e.target.type === "number" ? Number(e.target.value) : e.target.value;
  if (k === "package") renderRows();
  scheduleQuick();
});
$("#export-json").addEventListener("click", () => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(caseBody(), null, 2)], { type: "application/json" }));
  a.download = "pcb_case.json"; a.click();
});
$("#import-json").addEventListener("change", async (e) => {
  try {
    const j = JSON.parse(await e.target.files[0].text()), f = $("#setup");
    for (const [k, v] of Object.entries(j.board || {})) {
      const el = $(`[name="${k.replace(/_coverage$/, "_coverage_pct")}"]`, f); if (!el) continue;
      if (el.type === "checkbox") el.checked = !!v; else el.value = k.endsWith("_coverage") ? v * 100 : v;
    }
    for (const [k, v] of Object.entries(j.environment || {})) { const el = $(`[name="${k}"]`, f); if (el) el.value = v; }
    const forced = (j.environment?.air_velocity_m_s || 0) > 0;
    $(`.seg[data-target=cooling] button[data-v=${forced ? "forced" : "natural"}]`).click();
    COMPS = j.components || []; renderRows(); scheduleQuick(0);
  } catch (err) { alert(`Could not read the case file: ${err.message}`); }
  e.target.value = "";
});
$("#comp-rows").addEventListener("click", (e) => {
  const d = e.target.dataset.del; if (d === undefined) return;
  COMPS.splice(+d, 1); renderRows(); scheduleQuick();
});
$("#add-comp").addEventListener("click", () => {
  const b = caseBody().board;
  COMPS.push({ name: `U${COMPS.length + 1}`, package: "QFN-32 5x5", power_w: 1, x_mm: b.width_mm / 2, y_mm: b.depth_mm / 2, side: "top", tj_max_c: 125, vias: 0 });
  renderRows(); scheduleQuick();
});
$("#load-example").addEventListener("click", () => { COMPS = EXAMPLE.map((c) => ({ ...c })); renderRows(); scheduleQuick(); });
$$("#setup input, #setup select").forEach((el) => el.addEventListener("change", () => scheduleQuick()));

// ── colour map ───────────────────────────────────────────────────────────────
const STOPS = [[0, [0, 0, 255]], [0.25, [0, 255, 255]], [0.5, [0, 255, 0]], [0.75, [255, 255, 0]], [1, [255, 0, 0]]];
function cmap(t) {
  t = Math.min(1, Math.max(0, t));
  for (let i = 1; i < STOPS.length; i++) if (t <= STOPS[i][0]) {
    const [t0, c0] = STOPS[i - 1], [t1, c1] = STOPS[i], f = (t - t0) / (t1 - t0);
    return c0.map((c, j) => Math.round(c + f * (c1[j] - c)));
  }
  return STOPS[STOPS.length - 1][1];
}
(() => { const c = $("#leg").getContext("2d"); for (let x = 0; x < 220; x++) { const [r, g, b] = cmap(x / 219); c.fillStyle = `rgb(${r},${g},${b})`; c.fillRect(x, 0, 1, 12); } })();

// ── board canvas with drag & drop ────────────────────────────────────────────
const cv = $("#board");
let drag = null;
function geom() {
  const b = caseBody().board, W = cv.clientWidth, pad = 14;
  const s = (W - 2 * pad) / b.width_mm;
  return { b, s, pad, H: Math.round(b.depth_mm * s + 2 * pad), X: (x) => pad + x * s, Y: (y) => pad + (b.depth_mm - y) * s };
}
function drawBoard() {
  const g = geom(), dpr = window.devicePixelRatio || 1;
  cv.style.height = `${g.H}px`; cv.width = cv.clientWidth * dpr; cv.height = g.H * dpr;
  const c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, cv.clientWidth, g.H);
  c.fillStyle = "#2f6b3f"; c.fillRect(g.X(0), g.Y(g.b.depth_mm), g.b.width_mm * g.s, g.b.depth_mm * g.s);
  let lo = null, hi = null;
  if (LAST && LAST.maps && LAST.maps.width_mm === g.b.width_mm && LAST.maps.depth_mm === g.b.depth_mm) {
    const m = LAST.maps[FACE === "top" ? "top_c" : "bottom_c"], ny = m.length, nx = m[0].length;
    const flat = m.flat(); lo = Math.min(...flat); hi = Math.max(...flat);
    const img = c.createImageData(nx, ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const [r, gg, b] = cmap((m[ny - 1 - j][i] - lo) / Math.max(hi - lo, 1e-9));
      img.data.set([r, gg, b, 255], 4 * (j * nx + i));
    }
    const tmp = document.createElement("canvas"); tmp.width = nx; tmp.height = ny; tmp.getContext("2d").putImageData(img, 0, 0);
    c.imageSmoothingEnabled = true; c.drawImage(tmp, g.X(0), g.Y(g.b.depth_mm), g.b.width_mm * g.s, g.b.depth_mm * g.s);
    $("#leg-min").textContent = `${fmt(lo)} °C`; $("#leg-max").textContent = `${fmt(hi)} °C`;
  }
  c.strokeStyle = "#0008"; c.lineWidth = 1; c.strokeRect(g.X(0), g.Y(g.b.depth_mm), g.b.width_mm * g.s, g.b.depth_mm * g.s);
  const res = LAST ? Object.fromEntries(LAST.components.map((r) => [r.name, r])) : {};
  COMPS.forEach((comp, i) => {
    const p = META.packages[comp.package] || {}, w = (comp.w_mm || p.w_mm) * g.s, d = (comp.d_mm || p.d_mm) * g.s;
    const x = g.X(comp.x_mm) - w / 2, y = g.Y(comp.y_mm) - d / 2, r = res[comp.name];
    const onFace = comp.side === FACE;
    c.globalAlpha = onFace ? 1 : 0.35;
    c.fillStyle = "#11151ccc"; c.fillRect(x, y, w, d);
    const st = r ? (r.margin_c < 0 ? "#ff4d4f" : r.margin_c < 10 ? "#ffc53d" : "#73d13d") : "#ffffff";
    c.strokeStyle = drag && drag.i === i ? "#fff" : st; c.lineWidth = 2; c.strokeRect(x, y, w, d);
    c.globalAlpha = 1;
    c.fillStyle = "#fff"; c.font = "600 11px system-ui"; c.textAlign = "center";
    const label = r ? `${comp.name} ${fmt(r.t_junction_c, 0)}°C` : comp.name;
    c.fillText(label, x + w / 2, y - 4 < 10 ? y + d + 12 : y - 4);
  });
}
function hit(px, py) {
  const g = geom();
  for (let i = COMPS.length - 1; i >= 0; i--) {
    const c = COMPS[i], p = META.packages[c.package] || {}, w = (c.w_mm || p.w_mm) * g.s, d = (c.d_mm || p.d_mm) * g.s;
    if (Math.abs(px - g.X(c.x_mm)) <= w / 2 + 3 && Math.abs(py - g.Y(c.y_mm)) <= d / 2 + 3) return i;
  }
  return -1;
}
cv.addEventListener("pointerdown", (e) => {
  const r = cv.getBoundingClientRect(), i = hit(e.clientX - r.left, e.clientY - r.top);
  if (i < 0) return;
  drag = { i }; cv.classList.add("dragging"); cv.setPointerCapture(e.pointerId); drawBoard();
});
cv.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const r = cv.getBoundingClientRect(), g = geom(), c = COMPS[drag.i], p = META.packages[c.package] || {};
  const w = c.w_mm || p.w_mm, d = c.d_mm || p.d_mm;
  const x = (e.clientX - r.left - g.pad) / g.s, y = g.b.depth_mm - (e.clientY - r.top - g.pad) / g.s;
  c.x_mm = Math.round(Math.min(Math.max(x, w / 2), g.b.width_mm - w / 2) * 2) / 2;
  c.y_mm = Math.round(Math.min(Math.max(y, d / 2), g.b.depth_mm - d / 2) * 2) / 2;
  $("#live-status").textContent = `${c.name} → x ${c.x_mm} mm, y ${c.y_mm} mm`;
  drawBoard();
});
cv.addEventListener("pointerup", () => {
  if (!drag) return;
  drag = null; cv.classList.remove("dragging"); renderRows(); scheduleQuick(0);
});
new ResizeObserver(() => drawBoard()).observe(cv);

// ── quick (live) solve ───────────────────────────────────────────────────────
let qTimer = null, qSeq = 0;
function scheduleQuick(delay = 350) {
  clearTimeout(qTimer);
  qTimer = setTimeout(runQuick, delay);
}
async function runQuick() {
  if (!COMPS.length) { LAST = null; drawBoard(); $("#live-table").innerHTML = ""; return; }
  const seq = ++qSeq, t0 = performance.now();
  $("#live-status").textContent = "Solving…";
  try {
    const r = await post("/api/solve?quick=true", caseBody());
    if (seq !== qSeq) return;
    LAST = r; drawBoard(); liveTable(r);
    $("#live-status").innerHTML = `Solved in ${fmt((performance.now() - t0) / 1000, 1)} s · critical: <b>${esc(r.critical)}</b> · ` +
      `grid ${r.grid.nx}×${r.grid.ny}×${r.grid.nz} (quick). Run the full analysis for the uncertainty band and checks.` +
      r.warnings.map((w) => `<div class="err">⚠ ${esc(w)}</div>`).join("");
  } catch (err) { $("#live-status").innerHTML = `<span class="err">${esc(err.message)}</span>`; }
}
function liveTable(r) {
  $("#live-table").innerHTML = `<table style="margin-top:10px"><thead><tr><th>Part</th><th class="num">P W</th>
    <th class="num">Tj °C</th><th class="num">Tj max</th><th class="num">Margin</th><th class="num">To board</th></tr></thead><tbody>
    ${[...r.components].sort((a, b) => a.margin_c - b.margin_c).map((c) => `<tr><td><b>${esc(c.name)}</b> <span class="meta">${esc(c.package)}</span></td>
      <td class="num">${fmt(c.power_w, 2)}</td><td class="num">${fmt(c.t_junction_c)}</td><td class="num">${fmt(c.tj_max_c, 0)}</td>
      <td class="num" style="color:${c.margin_c < 0 ? "var(--bad)" : c.margin_c < 10 ? "var(--warn)" : "var(--ok)"}">${fmt(c.margin_c)}</td>
      <td class="num">${fmt(c.heat_to_board_pct, 0)} %</td></tr>`).join("")}</tbody></table>`;
}

// ── full report ──────────────────────────────────────────────────────────────
$("#run-full").addEventListener("click", async (e) => {
  const btn = e.target; btn.disabled = true; btn.textContent = "Solving…";
  try { const r = await post("/api/solve", caseBody()); LAST = r; drawBoard(); renderReport(r); showTab("report"); }
  catch (err) { alert(err.message); }
  finally { btn.disabled = false; btn.textContent = "Run full analysis"; }
});

const SPLIT = { board_top_face: ["Board top", "#0b6bcb"], board_bottom_face: ["Board bottom", "#5b8def"],
  component_tops: ["Component tops", "#f79009"], chassis: ["Chassis", "#7a5af8"] };

function renderReport(r) {
  const vs = r.verdict.status, cls = vs === "meets" ? "ok" : vs === "marginal" ? "warn" : "bad";
  const crit = r.components.find((c) => c.name === r.critical);
  const tot = Object.values(r.heat_split_w).reduce((a, b) => a + b, 0);
  const b = caseBody();
  $("#report").innerHTML = `
    <div class="toolbar"><div><h2 style="margin:0">Thermal report</h2>
      <div class="meta">${b.board.width_mm}×${b.board.depth_mm} mm, ${b.board.n_copper} copper layers, ${b.board.thickness_mm} mm ·
      ${fmt(r.power_w, 2)} W in ${r.components.length} parts · ambient ${b.environment.t_ambient_c} °C ·
      ${b.environment.air_velocity_m_s > 0 ? b.environment.air_velocity_m_s + " m/s airflow" : "natural convection (" + b.environment.orientation + ")"}</div></div>
      <button class="ghost noprint" onclick="window.print()">Print / PDF</button></div>
    <div class="banner ${cls}">${esc(r.verdict.text)}</div>
    <div class="kpis">
      <div class="kpi"><div class="l">Critical part</div><div class="v">${esc(r.critical)}</div><div class="s">${esc(crit.package)}</div></div>
      <div class="kpi"><div class="l">Its junction</div><div class="v">${fmt(crit.t_junction_c)} °C</div><div class="s">band ${fmt(crit.t_junction_band_c[0])}–${fmt(crit.t_junction_band_c[1])} °C</div></div>
      <div class="kpi"><div class="l">Margin to Tj,max</div><div class="v">${fmt(crit.margin_c)} °C</div><div class="s">Tj,max ${fmt(crit.tj_max_c, 0)} °C</div></div>
      <div class="kpi"><div class="l">Board hotspot</div><div class="v">${fmt(r.board_max_c)} °C</div><div class="s">copper surface</div></div>
      <div class="kpi"><div class="l">Surface cooling</div><div class="v">${fmt(r.h.top, 1)}</div><div class="s">W/m²K top (${fmt(r.h.top_rad, 1)} radiation)</div></div>
    </div>
    <h3>Components</h3>
    <table><thead><tr><th>Part</th><th>Package</th><th class="num">Power W</th><th class="num">Tj °C</th><th class="num">±${Math.round(0.2 * 100)}% cooling</th>
      <th class="num">Case °C</th><th class="num">Board °C</th><th class="num">Margin °C</th><th class="num">Heat to board</th><th>Status</th></tr></thead>
      <tbody>${[...r.components].sort((a, b2) => a.margin_c - b2.margin_c).map((c) => `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.package)}${c.vias ? ` · ${c.vias} vias` : ""}</td>
        <td class="num">${fmt(c.power_w, 2)}</td><td class="num">${fmt(c.t_junction_c)}</td>
        <td class="num">${fmt(c.t_junction_band_c[0])}–${fmt(c.t_junction_band_c[1])}</td><td class="num">${fmt(c.t_case_top_c)}</td>
        <td class="num">${fmt(c.t_board_under_c)}</td><td class="num">${fmt(c.margin_c)}</td><td class="num">${fmt(c.heat_to_board_pct, 0)} %</td>
        <td><span class="pill ${c.status}">${c.status}</span></td></tr>`).join("")}</tbody></table>
    <h3>3D temperature view</h3>
    <div id="v3d" class="v3d"></div>
    <div class="grid2">
      <div>
        <h3>Where the heat goes</h3>
        <div class="split">${Object.entries(r.heat_split_w).filter(([, v]) => v > 1e-6).map(([k, v]) =>
          `<div style="width:${(100 * v) / tot}%;background:${SPLIT[k][1]}" title="${SPLIT[k][0]}">${fmt((100 * v) / tot, 0)}%</div>`).join("")}</div>
        <div class="legend">${Object.entries(r.heat_split_w).filter(([, v]) => v > 1e-6).map(([k, v]) =>
          `<span><i style="background:${SPLIT[k][1]}"></i>${SPLIT[k][0]}: ${fmt(v, 2)} W</span>`).join("")}</div>
        <h3>Physics checks</h3>
        <table><tbody>${r.checks.map((c) => `<tr><td><span class="badge ${c.status === "n/a" ? "na" : c.status}">${c.status}</span></td>
          <td><b>${esc(c.name.replace(/_/g, " "))}</b><div class="meta">${esc(c.detail)}</div></td>
          <td class="num">${checkValue(c)}</td></tr>`).join("")}</tbody></table>
      </div>
      <div>
        <h3>Stack-up used</h3>
        <table><thead><tr><th>Layer</th><th class="num">Thickness µm</th><th class="num">Cu %</th><th class="num">k in-plane</th><th class="num">k through</th></tr></thead>
          <tbody>${r.layers.map((l) => `<tr><td>${l.name} <span class="meta">${l.kind}</span></td><td class="num">${fmt(l.thickness_um, 0)}</td>
            <td class="num">${l.coverage == null ? "" : fmt(l.coverage * 100, 0)}</td><td class="num">${fmt(l.k_xy, 2)}</td><td class="num">${fmt(l.k_z, 2)}</td></tr>`).join("")}</tbody></table>
        <p class="meta">Surface model — top: ${esc(r.h.regime_top)}; bottom: ${esc(r.h.regime_bottom)}.
          h = ${fmt(r.h.top, 1)} / ${fmt(r.h.bottom, 1)} W/m²K (top / bottom, incl. radiation).</p>
      </div>
    </div>
    ${r.warnings.length ? `<div class="warnings">${r.warnings.map((w) => `<div>⚠ ${esc(w)}</div>`).join("")}</div>` : ""}
    ${window.renderScope ? renderScope(r.scope) : ""}
    <p class="meta"><b>Method.</b> ${esc(r.method)}</p>`;
  show3d(r.field3d);
}

function checkValue(c) {
  if (typeof c.value !== "number") return "";
  if (c.name === "temperatures_above_ambient") return `min rise ${fmt(c.value)} K`;
  if (c.name === "energy_balance") return c.value.toExponential(1);
  return `${fmt(c.value * 100, 1)} %`;
}

let VIEWER = null;
async function show3d(field) {
  const box = $("#v3d");
  try {
    const { BoardViewer } = await import("/static/board3d.js");
    if (!VIEWER) VIEWER = new BoardViewer(box); else if (VIEWER.el !== box) box.replaceWith(VIEWER.el);
    VIEWER.load(field);
  } catch (err) { box.innerHTML = `<p class="meta">3D view unavailable (${esc(err.message)}).</p>`; }
}

// ── what-if ──────────────────────────────────────────────────────────────────
document.addEventListener("click", async (e) => {
  if (e.target.id !== "run-whatif") return;
  const btn = e.target; btn.disabled = true; btn.textContent = "Re-solving the board…";
  try { renderWhatIf(await post("/api/whatif", caseBody())); }
  catch (err) { alert(err.message); btn.disabled = false; btn.textContent = "Run what-if study"; }
});
function renderWhatIf(w) {
  const mx = Math.max(...w.scenarios.map((s) => -s.delta_critical_c), 1e-9);
  $("#whatif").innerHTML = `<div class="toolbar"><div><h2 style="margin:0">What-if study</h2>
    <div class="meta">Critical part <b>${esc(w.critical)}</b> at ${fmt(w.baseline_tj_c)} °C. Each option re-solved on the full board model.</div></div>
    <button class="ghost noprint" id="run-whatif">Re-run</button></div>
    <table><thead><tr><th>Change</th><th class="num">${esc(w.critical)} Tj °C</th><th class="num">Δ °C</th><th style="width:30%"></th><th class="num">Hottest junction</th></tr></thead>
    <tbody>${w.scenarios.map((s) => `<tr><td><b>${esc(s.label)}</b><div class="meta">${esc(s.detail)}</div></td>
      <td class="num">${fmt(s.critical_tj_c)}</td><td class="num">${fmt(s.delta_critical_c)}</td>
      <td><div class="delta" style="width:${Math.max(0, (-s.delta_critical_c / mx) * 100)}%"></div></td>
      <td class="num">${fmt(s.max_tj_c)}</td></tr>`).join("")}</tbody></table>
    <p class="meta">Options can be combined; effects are not strictly additive. Apply one in the Board tab and re-run.</p>`;
}

// ── calibration ──────────────────────────────────────────────────────────────
function parseMeasurements(text) {
  const names = new Set(COMPS.map((c) => c.name));
  return text.split(/\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((l, i) => {
    const p = l.split(/[,;\t]+/).map((s) => s.trim());
    if (names.has(p[0])) return { component: p[0], t_c: Number(p[1]) };
    if (p.length < 3 || p.slice(0, 3).some((v) => isNaN(Number(v)))) throw new Error(`Line ${i + 1}: "${l}" — expected x, y, T or Component, T`);
    return { x_mm: Number(p[0]), y_mm: Number(p[1]), t_c: Number(p[2]), side: (p[3] || "top").toLowerCase() };
  });
}
$("#run-cal").addEventListener("click", async (e) => {
  const btn = e.target;
  let meas;
  try { meas = parseMeasurements($("#meas").value); } catch (err) { alert(err.message); return; }
  btn.disabled = true; btn.textContent = "Calibrating (≈10–20 s)…";
  try { renderCal(await post("/api/calibrate", { ...caseBody(), measurements: meas, noise_std_c: Number($("#noise").value) })); }
  catch (err) { $("#cal-results").innerHTML = `<p class="err">${esc(err.message)}</p>`; }
  finally { btn.disabled = false; btn.textContent = "Calibrate model"; }
});
function renderCal(c) {
  const p = c.parameters;
  $("#cal-results").innerHTML = `<div class="toolbar"><h2 style="margin:0">Calibrated model</h2>
      <button class="ghost noprint" onclick="window.print()">Print / PDF</button></div>
    <div class="kpis">
      <div class="kpi"><div class="l">Fit error (RMS)</div><div class="v">${fmt(c.fit.rms_after_c, 2)} °C</div><div class="s">was ${fmt(c.fit.rms_before_c, 2)} °C · ${c.fit.n_used} points</div></div>
      <div class="kpi"><div class="l">Held-out error (RMS)</div><div class="v">${c.holdout.n ? fmt(c.holdout.rms_after_c, 2) + " °C" : "—"}</div><div class="s">${c.holdout.n ? `was ${fmt(c.holdout.rms_before_c, 2)} °C · ${c.holdout.n} unseen points` : esc(c.holdout.note)}</div></div>
      <div class="kpi"><div class="l">Model adequacy</div><div class="v" style="font-size:15px">${esc(c.adequacy.status)}</div><div class="s">χ²/dof ${fmt(c.adequacy.reduced_chi2, 1)}${c.adequacy.uncertainty_inflation > 1.01 ? ` · σ ×${fmt(c.adequacy.uncertainty_inflation, 1)}` : ""}</div></div>
      <div class="kpi"><div class="l">Surface cooling ×</div><div class="v">${fmt(p.h_scale.value, 2)}</div><div class="s">±${fmt(p.h_scale.std_log * 100, 0)}% · ${esc(c.identifiability.h_scale)}</div></div>
      <div class="kpi"><div class="l">In-plane spreading ×</div><div class="v">${fmt(p.k_inplane_scale.value, 2)}</div><div class="s">±${fmt(p.k_inplane_scale.std_log * 100, 0)}% · ${esc(c.identifiability.k_inplane_scale)}</div></div>
    </div>
    ${c.warnings.length ? `<div class="warnings">${c.warnings.map((w) => `<div>⚠ ${esc(w)}</div>`).join("")}</div>` : ""}
    <h3>Junction temperatures after calibration</h3>
    <table><thead><tr><th>Part</th><th class="num">Before °C</th><th class="num">Calibrated °C</th><th class="num">± 1σ</th><th class="num">Tj max</th><th class="num">Margin</th></tr></thead>
      <tbody>${c.junctions_after_calibration.map((j) => `<tr><td><b>${esc(j.name)}</b></td><td class="num">${fmt(j.before_calibration_c)}</td>
        <td class="num"><b>${fmt(j.t_junction_c)}</b></td><td class="num">${fmt(j.std_c, 2)}</td><td class="num">${fmt(j.tj_max_c, 0)}</td>
        <td class="num" style="color:${j.tj_max_c - j.t_junction_c - 2 * j.std_c < 0 ? "var(--bad)" : "var(--ok)"}">${fmt(j.tj_max_c - j.t_junction_c)}</td></tr>`).join("")}</tbody></table>
    <h3>Measured vs model</h3>
    <table><thead><tr><th>Point</th><th class="num">Measured</th><th class="num">Before</th><th class="num">After</th><th>Used for</th></tr></thead>
      <tbody>${c.measurements.map((m) => `<tr><td>${m.component ? `<b>${esc(m.component)}</b> junction` : `x ${m.x_mm}, y ${m.y_mm} (${m.side})`}</td>
        <td class="num">${fmt(m.t_c)}</td><td class="num">${fmt(m.predicted_before_c)}</td><td class="num">${fmt(m.predicted_after_c)}</td>
        <td>${m.used_for === "holdout" ? '<span class="pill">held out</span>' : "fit"}</td></tr>`).join("")}</tbody></table>
    <p class="meta"><b>Method.</b> ${esc(c.method)}</p>`;
}

// ── init ─────────────────────────────────────────────────────────────────────
(async function init() {
  META = await (await fetch("/api/meta")).json();
  COMPS = EXAMPLE.map((c) => ({ ...c }));
  renderRows(); drawBoard(); runQuick();
})();
