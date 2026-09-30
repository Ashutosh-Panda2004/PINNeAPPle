"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const fmt = (v, d = 1) => (typeof v === "number" && isFinite(v) ? v.toFixed(d) : "—");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
let META = null;

// ── tabs & segmented controls ────────────────────────────────────────────────
$$("#tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
function showTab(name) {
  $$("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  $$(".tab").forEach((t) => t.classList.toggle("active", t.id === `tab-${name}`));
  if (name === "trust") loadTrust();
}
$$(".seg").forEach((seg) => {
  seg.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    $$("button", seg).forEach((x) => x.classList.toggle("on", x === b));
    const form = seg.closest("form");
    $$(".forced-only", form).forEach((el) => (el.style.display = b.dataset.v === "forced" ? "" : "none"));
  });
});
const cooling = (form) => $(".seg .on", form).dataset.v;

function readForm(form) {
  const out = {};
  $$("input[name], select[name]", form).forEach((el) => {
    if (el.type === "checkbox") return;
    if (el.value === "") return;
    out[el.name] = el.type === "number" ? Number(el.value) : el.value;
  });
  if (cooling(form) === "natural") { out.air_velocity_m_s = 0; delete out.max_pressure_drop_pa; }
  return out;
}

async function post(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(Array.isArray(j.detail) ? j.detail.map((d) => `${d.loc.slice(-1)[0]}: ${d.msg}`).join("; ") : j.detail);
  return j;
}

function busy(btn, on, label) {
  btn.disabled = on;
  btn.innerHTML = on ? `<span class="spinner"></span>${label}` : btn.dataset.label;
}

// ── meta ─────────────────────────────────────────────────────────────────────
async function init() {
  META = await (await fetch("/api/meta")).json();
  const mats = Object.entries(META.materials);
  $("#material-checks").innerHTML = mats.map(([k, m], i) =>
    `<label><input type="checkbox" name="mat" value="${k}" ${i === 0 ? "checked" : ""}> ${esc(m.label)}</label>`).join("");
  $("#material-select").innerHTML = mats.map(([k, m]) => `<option value="${k}">${esc(m.label)} (k=${m.k_w_mk})</option>`).join("");
  $("#process-select").innerHTML = Object.entries(META.processes).map(([k, p]) =>
    `<option value="${k}">${esc(p.label)} (fin ≥ ${p.t_min} mm, gap ≥ ${p.gap_min} mm)</option>`).join("");
  $$("button.primary").forEach((b) => (b.dataset.label = b.textContent));
}
init();

// ── SIZE ─────────────────────────────────────────────────────────────────────
$("#size-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target, btn = $("button.primary", form);
  const body = readForm(form);
  body.materials = $$("#material-checks input:checked").map((x) => x.value);
  if (!body.materials.length) { alert("Select at least one material."); return; }
  busy(btn, true, "Screening designs…");
  try { renderSize(await post("/api/size", body)); }
  catch (err) { $("#size-results").innerHTML = `<p class="err">${esc(err.message)}</p>`; }
  finally { busy(btn, false); }
});

function verdictBadge(status) { return `<span class="badge ${status}">${status.replace(/_/g, " ")}</span>`; }

function renderSize(res) {
  const s = res.search, recs = res.recommendations;
  const cls = res.status === "ok" ? "ok" : "bad";
  $("#size-results").innerHTML = `
    <div class="toolbar"><h2 style="margin:0">Recommended designs</h2>
      <button class="ghost noprint" onclick="window.print()">Print / PDF</button></div>
    <div class="banner ${cls}">${esc(res.message)}</div>
    <table>
      <thead><tr><th>#</th><th>Base W×D×t (mm)</th><th>Fins n × t × H (mm)</th><th>Material</th>
        <th class="num">T max °C</th><th class="num">Pessimistic °C</th><th class="num">Margin °C</th>
        <th class="num">Mass g</th><th class="num">ΔP Pa</th><th>Verdict</th><th></th></tr></thead>
      <tbody>${recs.map((r, i) => {
        const d = r.design, k = r.kpis;
        return `<tr class="pick" data-i="${i}">
          <td>${i + 1}</td>
          <td>${d.base_width_mm} × ${d.base_depth_mm} × ${d.base_thickness_mm}</td>
          <td>${d.n_fins} × ${d.fin_thickness_mm} × ${d.fin_height_mm}<div class="meta">gap ${fmt(k.fin_gap_mm, 2)} mm</div></td>
          <td>${esc(META.materials[d.material].label.split(" (")[0])}</td>
          <td class="num">${fmt(k.t_source_max_c)}</td>
          <td class="num">${fmt(k.t_source_band_c[1])}</td>
          <td class="num">${fmt(k.margin_to_limit_c)}</td>
          <td class="num">${fmt(k.mass_g, 0)}</td>
          <td class="num">${k.mode === "forced" ? fmt(k.pressure_drop_pa, 1) : "—"}</td>
          <td>${verdictBadge(r.verdict.status)}</td>
          <td><button class="ghost noprint">Details →</button></td></tr>`;
      }).join("")}</tbody>
    </table>
    <h3>How these were found</h3>
    <div class="kpis">
      <div class="kpi"><div class="l">Candidates screened</div><div class="v">${s.candidates_screened.toLocaleString()}</div><div class="s">${esc(s.process)}</div></div>
      <div class="kpi"><div class="l">Passed the screen</div><div class="v">${s.passed_screen.toLocaleString()}</div><div class="s">95% upper bound ≤ limit</div></div>
      <div class="kpi"><div class="l">Verified by physics</div><div class="v">${s.verified_with_physics}</div><div class="s">FVM + correlations, ±15% h</div></div>
      <div class="kpi"><div class="l">Screen vs physics</div><div class="v">${fmt(s.screen_error_on_verified_c.mean_abs, 2)} °C</div><div class="s">mean |Δ| on verified designs</div></div>
      <div class="kpi"><div class="l">Time</div><div class="v">${fmt(s.seconds, 1)} s</div><div class="s">${s.mode} convection</div></div>
    </div>
    <p class="meta">Screening: ${esc(s.screening.method)}. Designs are rounded to manufacturable
      dimensions before verification; every row above comes from the physics engine, not the surrogate.</p>`;
  $$("#size-results tr.pick").forEach((tr) => tr.addEventListener("click", () => openInEvaluate(recs[+tr.dataset.i], res.request)));
}

function openInEvaluate(rec, req) {
  const f = $("#eval-form");
  const set = (n, v) => { const el = $(`[name="${n}"]`, f); if (el && v !== undefined && v !== null) el.value = v; };
  Object.entries(rec.design).forEach(([k, v]) => set(k, v));
  ["power_w", "t_ambient_c", "t_limit_c", "air_velocity_m_s", "source_width_mm", "source_depth_mm", "tim_k_mm2_w"]
    .forEach((k) => set(k, req[k]));
  $$(".seg button", f).forEach((b) => b.classList.toggle("on", b.dataset.v === (req.air_velocity_m_s > 0 ? "forced" : "natural")));
  $$(".forced-only", f).forEach((el) => (el.style.display = req.air_velocity_m_s > 0 ? "" : "none"));
  showTab("evaluate");
  f.requestSubmit();
}

// ── EVALUATE ─────────────────────────────────────────────────────────────────
$("#eval-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target, btn = $("button.primary", form), v = readForm(form);
  const dk = ["base_width_mm", "base_depth_mm", "base_thickness_mm", "n_fins", "fin_thickness_mm", "fin_height_mm", "material"];
  const design = {}, operating = {};
  Object.entries(v).forEach(([k, x]) => ((dk.includes(k) ? design : operating)[k] = x));
  busy(btn, true, "Solving…");
  try { renderEval(await post("/api/evaluate", { design, operating })); }
  catch (err) { $("#eval-results").innerHTML = `<p class="err">${esc(err.message)}</p>`; }
  finally { busy(btn, false); }
});

const RES_COLORS = { interface_tim: "#7a5af8", spreading_and_base: "#f79009", fins_convection: "#0b6bcb" };
const RES_LABEL = { interface_tim: "Interface (TIM)", spreading_and_base: "Spreading + base", fins_convection: "Fins → air" };

function renderEval(r) {
  const k = r.kpis, vs = r.verdict.status;
  const cls = vs === "meets" ? "ok" : vs === "marginal" ? "warn" : "bad";
  const rt = Object.values(r.resistances_k_w).reduce((a, b) => a + b, 0);
  const d = r.inputs.design, o = r.inputs.operating;
  $("#eval-results").innerHTML = `
    <div class="toolbar"><div><h2 style="margin:0">Thermal report</h2>
      <div class="meta">${d.base_width_mm}×${d.base_depth_mm}×${d.base_thickness_mm} mm base ·
      ${d.n_fins} fins ${d.fin_thickness_mm}×${d.fin_height_mm} mm · ${esc(r.details.material)} ·
      ${o.power_w} W · ${k.mode === "forced" ? o.air_velocity_m_s + " m/s ducted" : "natural convection"} · ambient ${o.t_ambient_c} °C</div></div>
      <button class="ghost noprint" onclick="window.print()">Print / PDF</button></div>
    <div class="banner ${cls}">${esc(r.verdict.text)}</div>
    <div class="kpis">
      <div class="kpi"><div class="l">Hotspot temperature</div><div class="v">${fmt(k.t_source_max_c)} °C</div>
        <div class="s">band ${fmt(k.t_source_band_c[0])}–${fmt(k.t_source_band_c[1])} °C</div></div>
      <div class="kpi"><div class="l">Margin to ${fmt(k.t_limit_c, 0)} °C</div><div class="v">${fmt(k.margin_to_limit_c)} °C</div><div class="s">pessimistic case</div></div>
      <div class="kpi"><div class="l">Thermal resistance</div><div class="v">${fmt(k.r_total_k_w, 3)}</div><div class="s">K/W source → air</div></div>
      <div class="kpi"><div class="l">Mass</div><div class="v">${fmt(k.mass_g, 0)} g</div><div class="s">${esc(r.details.material.split(" (")[0])}</div></div>
      ${k.mode === "forced" ? `
      <div class="kpi"><div class="l">Pressure drop</div><div class="v">${fmt(k.pressure_drop_pa, 1)} Pa</div><div class="s">${fmt(k.airflow_m3_h, 1)} m³/h · ${fmt(k.fan_power_w, 2)} W air power</div></div>` : ""}
      <div class="kpi"><div class="l">Fin efficiency</div><div class="v">${fmt(k.fin_efficiency * 100, 0)} %</div><div class="s">h = ${fmt(k.h_w_m2k, 1)} W/m²K · gap ${fmt(k.fin_gap_mm, 2)} mm</div></div>
    </div>
    <h3>3D temperature field</h3>
    <div id="v3d" class="v3d"></div>
    <div class="meta">${esc(r.field3d.method)} Drag to rotate, scroll to zoom, right-drag to pan;
      hover to probe the temperature.</div>
    <div class="grid2">
      <div>
        <h3>Where the temperature rise comes from</h3>
        <div class="bar">${Object.entries(r.resistances_k_w).map(([n, v]) =>
          `<div style="width:${(100 * v) / rt}%;background:${RES_COLORS[n]}" title="${RES_LABEL[n]}">${fmt((100 * v) / rt, 0)}%</div>`).join("")}</div>
        <div class="legend">${Object.entries(r.resistances_k_w).map(([n, v]) =>
          `<span><i style="background:${RES_COLORS[n]}"></i>${RES_LABEL[n]}: ${fmt(v, 4)} K/W (${fmt(v * o.power_w, 1)} °C)</span>`).join("")}</div>
        <h3>Physics checks</h3>
        <table><tbody>${r.checks.map((c) => `<tr>
          <td>${verdictBadge(c.status === "n/a" ? "na" : c.status).replace(">na<", ">n/a<")}</td>
          <td><b>${esc(c.name.replace(/_/g, " "))}</b><div class="meta">${esc(c.detail)}</div></td>
          <td class="num">${typeof c.value === "number" ? (Math.abs(c.value) < 1e-3 ? c.value.toExponential(1) : fmt(c.value * (c.name === "temperature_above_ambient" ? 1 : 100), 1) + (c.name === "temperature_above_ambient" ? " K" : " %")) : ""}</td></tr>`).join("")}</tbody></table>
      </div>
      <div>
        <h3>Base temperature map (heat-source side)</h3>
        <div class="mapwrap"><canvas id="tmap"></canvas><canvas id="cbar" class="cbar"></canvas>
          <div class="cbar-l"><span id="cmax"></span><span id="cmin"></span></div></div>
        <div class="meta">${esc(r.temperature_map.note)} Dashed box: heat source. ✕: hotspot.
          Grid ${r.details.fvm_grid.nx}×${r.details.fvm_grid.ny}×${r.details.fvm_grid.nz}.</div>
      </div>
    </div>
    ${r.warnings.length ? `<div class="warnings">${r.warnings.map((w) => `<div>⚠ ${esc(w)}</div>`).join("")}</div>` : ""}
    <p class="meta"><b>Method.</b> ${esc(r.method)} Uncertainty band: ±${fmt(r.details.h_uncertainty_band * 100, 0)}% on the convection coefficient
      (typical correlation accuracy — an engineering assumption, not a measurement).</p>`;
  drawMap(r.temperature_map);
  show3d(r.field3d);
}

// three.js viewer, loaded on first use (ES module + import map)
let VIEWER = null;
async function show3d(field) {
  const box = $("#v3d");
  try {
    const { HeatSinkViewer } = await import("/static/viewer3d.js");
    // one WebGL context for the page: re-attach the existing viewer
    if (!VIEWER) VIEWER = new HeatSinkViewer(box);
    else if (VIEWER.el !== box) box.replaceWith(VIEWER.el);
    VIEWER.load(field);
  } catch (err) {
    box.innerHTML = `<p class="meta">3D view unavailable in this browser (${esc(err.message)}).</p>`;
  }
}

// ── colour map (perceptual, "inferno"-like) ──────────────────────────────────
const STOPS = [[0, [0, 0, 4]], [0.25, [87, 16, 110]], [0.5, [188, 55, 84]], [0.75, [249, 142, 9]], [1, [252, 255, 164]]];
function cmap(t) {
  t = Math.min(1, Math.max(0, t));
  for (let i = 1; i < STOPS.length; i++) {
    if (t <= STOPS[i][0]) {
      const [t0, c0] = STOPS[i - 1], [t1, c1] = STOPS[i], f = (t - t0) / (t1 - t0);
      return c0.map((c, j) => Math.round(c + f * (c1[j] - c)));
    }
  }
  return STOPS[STOPS.length - 1][1];
}

function drawMap(m) {
  const vals = m.values_c, ny = vals.length, nx = vals[0].length;
  const flat = vals.flat(), lo = Math.min(...flat), hi = Math.max(...flat);
  const cw = Math.min(460, $("#eval-results").clientWidth / 2 - 60);
  const scale = cw / m.width_mm, W = Math.round(m.width_mm * scale), H = Math.round(m.depth_mm * scale);
  const cv = $("#tmap"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d"), img = ctx.createImageData(nx, ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const [r, g, b] = cmap((vals[ny - 1 - j][i] - lo) / Math.max(hi - lo, 1e-9)), p = 4 * (j * nx + i);
    img.data.set([r, g, b, 255], p);
  }
  const tmp = document.createElement("canvas"); tmp.width = nx; tmp.height = ny;
  tmp.getContext("2d").putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true; ctx.drawImage(tmp, 0, 0, W, H);
  const s = m.source, X = (x) => x * scale, Y = (y) => H - y * scale;
  ctx.setLineDash([5, 4]); ctx.strokeStyle = "#ffffffcc"; ctx.lineWidth = 1.5;
  ctx.strokeRect(X(s.x - s.w / 2), Y(s.y + s.d / 2), s.w * scale, s.d * scale);
  ctx.setLineDash([]); ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
  const [hx, hy] = [X(m.hotspot_mm[0]), Y(m.hotspot_mm[1])];
  ctx.beginPath(); ctx.moveTo(hx - 6, hy - 6); ctx.lineTo(hx + 6, hy + 6); ctx.moveTo(hx + 6, hy - 6); ctx.lineTo(hx - 6, hy + 6); ctx.stroke();
  const cb = $("#cbar"); cb.width = 14; cb.height = H;
  const c2 = cb.getContext("2d");
  for (let y = 0; y < H; y++) { const [r, g, b] = cmap(1 - y / H); c2.fillStyle = `rgb(${r},${g},${b})`; c2.fillRect(0, y, 14, 1); }
  $("#cmax").textContent = `${fmt(hi)} °C`; $("#cmin").textContent = `${fmt(lo)} °C`;
}

// ── TRUST ────────────────────────────────────────────────────────────────────
let trustLoaded = false;
async function loadTrust() {
  if (trustLoaded) return;
  const out = [];
  for (const mode of ["forced", "natural"]) {
    const r = await fetch(`/api/surrogate/${mode}/report`);
    out.push(r.ok ? renderTrust(await r.json()) : `<div><h3>${mode}</h3><p class="meta">No trained surrogate.</p></div>`);
  }
  $("#trust-results").innerHTML = `
    <div class="toolbar"><div><h2 style="margin:0">Can the screening model be trusted?</h2>
      <div class="meta">Measured on designs the neural surrogates never saw. The surrogates only screen
      candidates — every recommendation is re-verified by the physics engine.</div></div>
      <button class="ghost noprint" onclick="window.print()">Print / PDF</button></div>
    <div class="trustcol">${out.join("")}</div>`;
  trustLoaded = true;
}

function renderTrust(t) {
  const e = t.error.per_output, main = e["thermal resistance (base to air)"], u95 = t.uncertainty.levels["95"];
  const el = Object.entries(t.variables.elasticity_of_resistance);
  const mx = Math.max(...el.map(([, v]) => Math.abs(v)), 1e-9);
  return `<div>
    <h3 style="text-transform:capitalize">${t.mode} convection ${verdictBadge(t.verdict.status)}</h3>
    <div class="meta">${esc(t.verdict.reasons.join(" · "))}</div>
    <div class="kpis" style="margin-top:10px">
      <div class="kpi"><div class="l">Mean error</div><div class="v">${fmt(main.mean_abs_pct, 2)} %</div><div class="s">${t.error.n_test_designs} held-out designs</div></div>
      <div class="kpi"><div class="l">95th pct. error</div><div class="v">${fmt(main.p95_abs_pct, 2)} %</div><div class="s">${fmt(main.pct_within_5pct, 0)}% within ±5%</div></div>
      <div class="kpi"><div class="l">Convergence</div><div class="v" style="font-size:16px">${esc(t.convergence.status.replace(/_/g, " "))}</div><div class="s">loss ↓ ${fmt(t.convergence.reduction_factor, 0)}×</div></div>
      <div class="kpi"><div class="l">Generalization</div><div class="v" style="font-size:16px">${esc(t.generalization.status)}</div><div class="s">test/train error ${fmt(t.generalization.test_over_train, 2)}</div></div>
      <div class="kpi"><div class="l">95% bound coverage</div><div class="v">${fmt(u95.empirical_test_coverage_pct, 1)} %</div><div class="s">×${fmt(u95.multiplicative_factor, 3)} on resistance</div></div>
    </div>
    ${Object.entries(e).length > 1 ? `<p class="meta">Pressure drop: mean ${fmt(e["pressure drop"].mean_abs_pct, 2)} %, p95 ${fmt(e["pressure drop"].p95_abs_pct, 2)} %.</p>` : ""}
    <h3>Physics laws the model respects</h3>
    <table><tbody>${t.physics_checks.map((c) => `<tr><td>${verdictBadge(c.status)}</td>
      <td>${esc(c.law)}<div class="meta">${esc(c.detail)}</div></td></tr>`).join("")}</tbody></table>
    <h3>What drives the thermal resistance</h3>
    <div class="meta" style="margin-bottom:6px">${esc(t.variables.elasticity_note)}</div>
    <div class="elas">${el.map(([n, v]) => `<span>${esc(n)}</span>
      <div class="track"><div class="fill" style="left:${v < 0 ? 50 - (50 * Math.abs(v)) / mx : 50}%;width:${(50 * Math.abs(v)) / mx}%;background:${v < 0 ? "#1a7f4b" : "#b42318"}"></div></div>
      <span class="num">${v > 0 ? "+" : ""}${fmt(v, 2)}</span>`).join("")}</div>
    <h3>Model &amp; training</h3>
    <p class="meta">${esc(t.weights.network.architecture)} · ${t.weights.network.n_params.toLocaleString()} parameters ·
      ${esc(t.weights.training.optimizer)} · ${t.weights.training.n_physics_samples.toLocaleString()} physics-solved designs
      (train ${t.weights.training.split.train} / val ${t.weights.training.split.val} / calibration ${t.weights.training.split.cal} / test ${t.weights.training.split.test})
      · ${fmt(t.weights.training.train_seconds, 0)} s.</p>
    <p class="meta"><b>Valid design space:</b> ${Object.entries(t.generalization.valid_design_space).map(([k, v]) => `${esc(k)} ${v[0]}–${v[1]}`).join(" · ")}</p>
  </div>`;
}
