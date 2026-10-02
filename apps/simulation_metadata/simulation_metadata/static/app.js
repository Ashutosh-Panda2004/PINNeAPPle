"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const num = (v) => (typeof v === "number" && isFinite(v) ? PChart.fmt(v) : v === null || v === undefined ? "—" : esc(Array.isArray(v) ? `(${v.map((x) => PChart.fmt(x)).join(", ")})` : v));
const int = (v) => (typeof v === "number" ? v.toLocaleString() : "—");
const PALETTE = ["#c2410c", "#0b6bcb", "#1a7f4b", "#6941c6", "#a16207", "#be185d", "#0e7490", "#475569"];

let FILES = [], REC = null;

$$("#tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
function showTab(n) {
  $$("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === n));
  $$(".tab").forEach((t) => t.classList.toggle("active", t.id === `tab-${n}`));
  if (n === "record" && REC) requestAnimationFrame(drawCharts);
}

const drop = $("#drop");
["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => addFiles([...e.dataTransfer.files]));
$("#files").addEventListener("change", (e) => { addFiles([...e.target.files]); e.target.value = ""; });
function addFiles(list) { for (const f of list) if (!FILES.some((x) => x.name === f.name)) FILES.push(f); renderFiles(); }
function renderFiles() {
  $("#filelist").innerHTML = FILES.map((f, i) => `<div><span><b>${esc(f.name)}</b> · ${(f.size / 1024).toFixed(0)} KB</span><button data-i="${i}">×</button></div>`).join("");
  $$("#filelist button").forEach((b) => b.addEventListener("click", () => { FILES.splice(+b.dataset.i, 1); renderFiles(); }));
  $("#run").disabled = !FILES.length;
}

async function load(url, opts, btn) {
  const old = btn.innerHTML; btn.disabled = true;
  btn.innerHTML = `<span class="spinner" style="border-color:#c2410c55;border-top-color:#c2410c"></span>Reading…`;
  $("#status").textContent = "";
  try {
    const r = await fetch(url, opts);
    const j = await r.json().catch(() => ({ detail: `HTTP ${r.status}` }));
    if (!r.ok) throw new Error(typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail));
    REC = j; render(); showTab("record");
  } catch (e) { $("#status").innerHTML = `<span class="err">${esc(e.message)}</span>`; }
  finally { btn.disabled = false; btn.innerHTML = old; if (btn.id === "run") btn.disabled = !FILES.length; }
}
$("#run").addEventListener("click", (e) => {
  const fd = new FormData(); FILES.forEach((f) => fd.append("files", f));
  load("/api/extract", { method: "POST", body: fd }, e.currentTarget);
});

const STATUS_PILL = { converged: "ok", completed: "ok", still_falling: "warning", stalled: "warning", incomplete: "warning", unknown: "", diverged: "critical", crashed: "critical", failed: "critical" };

function kv(rows) {
  return `<dl class="kv">${rows.filter(([, v]) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length)).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>`;
}

function render() {
  const r = REC, c = r.convergence, s = r.solver || {}, a = r.analysis || {}, m = r.mesh || {}, t = r.time || {};
  const ex = s.executed || {};
  const fea = !!m.elements;
  const bb = m.bounding_box ? m.bounding_box.size.map((x) => PChart.fmt(x)).join(" × ") + (fea ? " (model units)" : " m") : null;
  const q = m.quality || {};
  const patches = (m.patches || []).map((p) => `<span class="pill" title="${p.n_faces ?? ""} faces">${esc(p.name)} · ${esc(p.type)}</span>`).join(" ");
  const fieldsTable = c.fields && Object.keys(c.fields).length ? `<table class="restable"><thead><tr><th>Field</th>${c.status === "completed" || c.time_steps !== undefined ? "<th class='num'>Median initial residual</th><th class='num'>Max</th><th class='num'>Linear tolerance</th>" : "<th class='num'>First</th><th class='num'>Final</th><th class='num'>Orders dropped</th><th class='num'>Target</th><th>Met</th>"}</tr></thead><tbody>
    ${Object.entries(c.fields).map(([f, v]) => v.final !== undefined ? `<tr><td><b>${esc(f)}</b></td><td class="num">${num(v.first)}</td><td class="num">${num(v.final)}</td><td class="num">${num(v.orders_dropped)}</td><td class="num">${num(v.target)}</td><td>${v.met === null || v.met === undefined ? "—" : v.met ? '<span class="pill ok">yes</span>' : '<span class="pill warning">no</span>'}</td></tr>`
      : `<tr><td><b>${esc(f)}</b></td><td class="num">${num(v.median_initial)}</td><td class="num">${num(v.max_initial)}</td><td class="num">${num(v.tolerance)}</td></tr>`).join("")}</tbody></table>` : "";
  const bcs = r.boundary_conditions || [];
  const bcTable = !bcs.length ? `<p class="meta">None found.</p>` : bcs[0].field !== undefined
    ? (() => {
      const fields = [...new Set(bcs.map((b) => b.field))], pts = [...new Set(bcs.map((b) => b.patch))];
      return `<div style="overflow-x:auto"><table class="bctable"><thead><tr><th>Patch</th>${fields.map((f) => `<th>${esc(f)}</th>`).join("")}</tr></thead><tbody>
        ${pts.map((p) => `<tr><td><b>${esc(p)}</b></td>${fields.map((f) => { const b = bcs.find((x) => x.field === f && x.patch === p); return `<td class="mono">${b ? `${esc(b.type)}${b.value ? `<br><span class="meta">${esc(b.value)}</span>` : ""}` : ""}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div>`;
    })()
    : `<table class="bctable"><thead><tr><th>Step</th><th>Set</th><th>DOFs</th><th>Value</th></tr></thead><tbody>${bcs.map((b) => `<tr><td>${esc(b.step)}</td><td><b>${esc(b.set)}</b></td><td>${esc(b.dofs.join(", "))}</td><td>${num(b.value)} <span class="meta">${esc(b.kind)}</span></td></tr>`).join("")}</tbody></table>`;
  const loads = (r.loads || []).length ? `<h4 style="margin-top:12px">Loads</h4><table class="bctable"><thead><tr><th>Step</th><th>Type</th><th>Target</th><th>Component</th><th>Value</th></tr></thead><tbody>${r.loads.map((l) => `<tr><td>${l.step}</td><td>${esc(l.type)}</td><td>${esc(l.target)}</td><td>${esc(l.component)}</td><td>${num(l.total ?? l.value)} ${l.total !== undefined ? `<span class="meta">total over ${l.entries} nodes</span>` : ""}</td></tr>`).join("")}</tbody></table>` : "";
  const numerics = r.numerics || {};
  const ls = numerics.linear_solvers ? Object.entries(numerics.linear_solvers).map(([f, v]) => `<tr><td><b>${esc(f)}</b></td><td>${esc(v.solver)}${v.preconditioner ? ` / ${esc(v.preconditioner)}` : ""}${v.smoother ? ` / ${esc(v.smoother)}` : ""}</td><td class="num">${esc(v.tolerance ?? "")}</td><td class="num">${esc(v.relTol ?? "")}</td></tr>`).join("") : "";
  const conv = numerics.convection ? Object.entries(numerics.convection).map(([k, v]) => `<div><code>${esc(k)}</code> ${esc(v)}</div>`).join("") : "";
  $("#record").innerHTML = `
    <div class="toolbar"><h2 style="margin:0">${esc(r.example ? r.example.description : (r.detected.format + " · " + r.detected.root))}</h2>
      <div class="noprint" style="display:flex;gap:6px"><button class="ghost" id="dl">Download JSON</button><button class="ghost" onclick="print()">Print / PDF</button></div></div>
    <div class="verdict ${c.level}">
      <div><div class="meta">Convergence</div><div class="big">${esc(c.label)}</div></div>
      <div><ul>${c.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
        ${c.recommendations.length ? `<ul class="recs">${c.recommendations.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}</div>
    </div>
    ${r.warnings && r.warnings.length ? `<div class="warnings">${r.warnings.map((w) => `<div>${esc(w)}</div>`).join("")}</div>` : ""}
    <div class="cards">
      <div class="card"><h4>Solver</h4>${kv([["Code", esc(s.name)], ["Application", esc(s.application)], ["Version", esc(s.version)], ["Family", esc(s.family)],
        ["Run on", esc([ex.date, ex.host].filter(Boolean).join(" · "))], ["Processes", ex.n_procs], ["Wall time", ex.wall_time_s !== undefined && ex.wall_time_s !== null ? `${num(ex.wall_time_s)} s` : null],
        ["Format", esc(r.detected.format)]])}</div>
      <div class="card"><h4>Analysis</h4>${kv([["Type", `<b>${esc(a.type)}</b>`], ["Physics", (a.physics || []).map((p) => `<span class="pill">${esc(p)}</span>`).join(" ")],
        ["Turbulence", a.turbulence ? esc(`${a.turbulence.type}${a.turbulence.model ? " · " + a.turbulence.model : ""}`) : null], ["Algorithm", esc(a.algorithm)],
        ["Steps", a.steps ? a.steps.map((st) => `${st.index}: ${esc(st.procedure)}${st.nlgeom ? " (NLGEOM)" : ""}`).join("<br>") : null],
        ["Interactions", (a.interactions || []).map(esc).join(", ")]])}</div>
      <div class="card"><h4>Mesh</h4>${kv([[fea ? "Nodes" : "Cells", fea ? int(m.nodes) : int(m.cells)], [fea ? "Elements" : "Points", fea ? int(m.elements) : int(m.points)],
        ["Faces", fea ? null : int(m.faces)], ["Element types", m.element_types ? Object.entries(m.element_types).map(([k, v]) => `${esc(k)} × ${int(v)}`).join(", ") : null],
        ["Domain size", bb], ["Quality", q.status ? `<span class="pill ${q.status === "Mesh OK" ? "ok" : "warning"}">${esc(q.status)}</span>` : null],
        ["Non-orthogonality", q.max_non_orthogonality !== undefined ? `max ${num(q.max_non_orthogonality)}° · avg ${num(q.avg_non_orthogonality)}°` : null],
        ["Skewness / aspect", q.max_skewness !== undefined ? `${num(q.max_skewness)} / ${num(q.max_aspect_ratio)}` : null],
        ["Patches", patches], ["Source", esc(m.source)]])}</div>
      <div class="card"><h4>Time</h4>${kv(fea ? [["Steps", t.steps], ["Step periods", (t.periods || []).map(num).join(", ")], ["First increment", num(t.initial_increment)], ["Increments run", t.increments_run]]
        : [["Unit", esc(t.unit)], ["Start → end", t.end !== undefined ? `${num(t.start)} → ${num(t.end)}` : null], ["Δt", num(t.delta_t)], ["Adaptive Δt", t.adjustable === undefined ? null : t.adjustable ? `yes, maxCo ${num(t.max_courant)}` : "no"],
          ["Steps run", t.steps_run !== undefined ? `${int(t.steps_run)} (last ${num(t.last_time)})` : null], ["Reached end", t.reached_end === undefined ? null : t.reached_end ? "yes" : "no"],
          ["Write", t.write_control ? `${esc(t.write_control)} every ${num(t.write_interval)}` : null], ["Iterations", t.iterations]])}</div>
    </div>
    <h3>Convergence history</h3>
    <div class="charts2"><div id="ch-res"></div><div id="ch-co"></div></div>
    ${fieldsTable}
    <div id="monitors"></div>
    <h3>Boundary conditions</h3>${bcTable}${loads}
    <h3>Parameters</h3>
    <table><thead><tr><th>Parameter</th><th class="num">Value</th><th>Unit</th><th>Source</th></tr></thead><tbody>
      ${(r.parameters || []).map((p) => `<tr><td>${esc(p.name)}</td><td class="num">${num(p.value)}</td><td>${esc(p.unit)}</td><td class="meta">${esc(p.source)}</td></tr>`).join("")}
      ${(r.derived || []).map((d) => `<tr><td><b>${esc(d.name)}</b> <span class="pill info">derived</span></td><td class="num">${int(Math.round(d.value))}</td><td>—</td><td class="meta">${esc(d.definition)}</td></tr>`).join("")}
      ${(r.results || []).map((d) => `<tr><td><b>${esc(d.name)}</b> <span class="pill ok">result</span></td><td class="num">${num(d.value)}</td><td>(model units)</td><td class="meta">at time ${num(d.time)}</td></tr>`).join("")}
    </tbody></table>
    ${(r.materials || []).length ? `<h3>Materials</h3><table><thead><tr><th>Name</th><th class="num">E</th><th class="num">ν</th><th class="num">ρ</th><th>Other</th></tr></thead><tbody>${r.materials.map((mt) => `<tr><td><b>${esc(mt.name)}</b></td><td class="num">${num(mt.young_modulus)}</td><td class="num">${num(mt.poisson_ratio)}</td><td class="num">${num(mt.density)}</td><td class="meta">${esc(Object.keys(mt).filter((k) => !["name", "young_modulus", "poisson_ratio", "density"].includes(k)).join(", "))}</td></tr>`).join("")}</tbody></table>` : ""}
    ${ls || conv ? `<h3>Numerics</h3><div class="grid2">
      <div>${ls ? `<table><thead><tr><th>Field</th><th>Linear solver</th><th class="num">Tolerance</th><th class="num">relTol</th></tr></thead><tbody>${ls}</tbody></table>` : ""}</div>
      <div class="meta">${numerics.time_scheme ? `<div>Time: <code>${esc(numerics.time_scheme)}</code></div>` : ""}${numerics.gradient ? `<div>Gradient: <code>${esc(numerics.gradient)}</code></div>` : ""}
        ${numerics.laplacian ? `<div>Laplacian: <code>${esc(numerics.laplacian)}</code></div>` : ""}<div style="margin-top:6px">Convection:</div>${conv}
        ${numerics.relaxation ? `<div style="margin-top:6px">Relaxation: <code>${esc(JSON.stringify(numerics.relaxation))}</code></div>` : ""}</div></div>` : ""}
    <h3>Files</h3>
    <table class="files"><thead><tr><th>Path</th><th class="num">Bytes</th><th>Used</th></tr></thead><tbody>
      ${r.files.map((f) => `<tr><td>${esc(f.path)}</td><td class="num">${int(f.bytes)}</td><td>${f.used ? "✓" : ""}</td></tr>`).join("")}</tbody></table>
    <details class="raw"><summary>Raw record (JSON)</summary><pre class="code"><code>${esc(JSON.stringify({ ...r, scope: undefined }, null, 2).slice(0, 60000))}</code></pre></details>
    ${window.renderScope ? renderScope(r.scope) : ""}`;
  $("#dl").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ ...REC, scope: undefined }, null, 2)], { type: "application/json" });
    const el = document.createElement("a"); el.href = URL.createObjectURL(blob);
    el.download = (REC.example ? REC.example.name : "simulation") + "_metadata.json"; el.click();
  });
  requestAnimationFrame(drawCharts);
}

function drawCharts() {
  const c = REC.convergence, h = c.history;
  if (h && Object.keys(h.fields).length) {
    const fields = Object.entries(h.fields);
    const targets = c.fields ? Object.entries(c.fields).filter(([, v]) => v.target).map(([f, v], i) => ({ y: v.target, color: "#94a3b8", label: `${f} target`, dash: "3 3" })) : [];
    PChart.mount($("#ch-res"), { height: 260, x: h.x, yLog: true, yLabel: h.y_label || "initial residual", legend: true,
      hlines: targets.filter((tg, i, arr) => arr.findIndex((x) => x.y === tg.y) === i),
      series: fields.map(([f, y], i) => ({ name: f, y, color: PALETTE[i % 8], width: 1.4 })) });
    $("#ch-res").insertAdjacentHTML("afterbegin", `<div class="meta">Residuals per ${esc(h.x_label || "iteration")} (log scale)</div>`);
  } else $("#ch-res").innerHTML = `<p class="meta">No residual history in the upload.</p>`;
  const co = c.courant_history;
  if (co) {
    PChart.mount($("#ch-co"), { height: 260, x: co.x, yLabel: "Courant number", legend: true,
      hlines: [{ y: 1, color: "#b42318", label: "Co = 1" }],
      series: [{ name: "max", y: co.fields.max, color: "#b42318" }, { name: "mean", y: co.fields.mean, color: "#0b6bcb" }] });
    $("#ch-co").insertAdjacentHTML("afterbegin", `<div class="meta">Courant number per time step</div>`);
  } else if (c.increments && c.increments.length) {
    const inc = c.increments;
    PChart.mount($("#ch-co"), { height: 260, x: inc.map((r) => `inc ${r.increment}`), yLabel: "step time", legend: true,
      series: [{ name: "step time reached", y: inc.map((r) => r.step_time), color: "#1a7f4b" }, { name: "increment size", y: inc.map((r) => r.increment_size), color: "#c2410c" }] });
    $("#ch-co").insertAdjacentHTML("afterbegin", `<div class="meta">Increments (automatic step-size control)</div>`);
  } else $("#ch-co").innerHTML = "";
  $("#ch-res").parentElement.style.gridTemplateColumns = $("#ch-co").innerHTML ? "" : "1fr";
  const mons = c.monitors || [];
  $("#monitors").innerHTML = mons.length ? `<h3>Monitors</h3><div class="charts2">${mons.map((mo, i) => `<div><div class="meta">${esc(mo.name)} · final ${num(mo.final)} · last 10 %: ±${num(mo.tail_variation_pct / 2)} %</div><div id="mon-${i}"></div></div>`).join("")}</div>` : "";
  mons.forEach((mo, i) => PChart.mount($(`#mon-${i}`), { height: 180, x: mo.history.x, series: [{ name: mo.name, y: mo.history.fields[mo.name], color: PALETTE[i % 8] }] }));
}

(async function init() {
  const m = await (await fetch("/api/meta")).json();
  const KIND = (n) => (/converged|nlgeom/.test(n) ? ["ok", "converges"] : /early/.test(n) ? ["warning", "stopped early"] : /diverged/.test(n) ? ["critical", "diverges"] : ["ok", "transient"]);
  $("#examples").innerHTML = m.examples.map((e) => { const [cls, lab] = KIND(e.name); return `<button type="button" data-n="${e.name}"><span class="pill ${cls}">${lab}</span><b>${esc(e.name.replace(/_/g, " "))}</b>${esc(e.description)}</button>`; }).join("") +
    `<p class="hint">Real runs made for this app with OpenFOAM v1912 and CalculiX 2.21. Download: ${m.examples.map((e) => `<a class="link" href="/api/example/${e.name}.zip">${e.name.split("_").slice(1, 3).join(" ")}</a>`).join(" · ")}</p>`;
  $$("#examples button").forEach((b) => b.addEventListener("click", () => load(`/api/example/${b.dataset.n}`, {}, b)));
  const o = location.origin;
  $("#c1").textContent = `# a zipped OpenFOAM case (leave out result time directories)\ncurl -u USER:PASSWORD -F "files=@pitzDaily.zip" ${o}/api/extract > meta.json\njq '.convergence.status, .mesh.cells, .analysis.turbulence' meta.json\n\n# loose files work too\ncurl -u USER:PASSWORD -F "files=@beam.inp" -F "files=@beam.sta" -F "files=@beam.cvg" ${o}/api/extract`;
  $("#c2").textContent = `import io, json, pathlib, zipfile, requests\n\ndef zip_case(case: pathlib.Path) -> bytes:\n    buf = io.BytesIO()\n    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:\n        for p in case.rglob("*"):\n            if p.is_file() and p.parts[len(case.parts)] in ("system", "constant", "0") or p.name.startswith("log."):\n                z.write(p, p.relative_to(case))\n    return buf.getvalue()\n\nfor case in pathlib.Path("runs").iterdir():\n    r = requests.post("${o}/api/extract", auth=("USER", "PASSWORD"),\n                      files={"files": (case.name + ".zip", zip_case(case))})\n    meta = r.json()\n    (case / "metadata.json").write_text(json.dumps(meta, indent=2))\n    print(case.name, meta["convergence"]["status"], meta["mesh"].get("cells"))`;
})();
window.addEventListener("resize", () => { if (REC && $("#tab-record").classList.contains("active")) drawCharts(); });
