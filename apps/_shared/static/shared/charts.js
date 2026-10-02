// Small SVG line charts shared by the PINNeAPPle data apps (no dependencies).
//   PChart.mount(el, {height, x, series:[{name, y, color, width, dash, lo, hi}], yLog, yLabel,
//                     flags (bool per x), hlines:[{y, color, label, dash}], band:{lo, hi, color}, yMin, yMax})
// Series with `lo`/`hi` draw a min-max envelope. Hovering shows the values at the nearest x.
(function () {
  const css = `
  .pchart { position: relative; }
  .pchart svg { display: block; width: 100%; overflow: visible; font: 11px system-ui, sans-serif; }
  .pchart .ax { stroke: #c9d1dd; } .pchart .grid { stroke: #eef1f5; }
  .pchart text { fill: #5d6b82; } .pchart .yl { font-weight: 600; }
  .pchart .tip { position: absolute; pointer-events: none; background: #172033; color: #fff; border-radius: 6px;
    padding: 5px 8px; font-size: 11.5px; white-space: nowrap; display: none; z-index: 2; }
  .pchart .tip i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 5px; }
  .pchart-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 12px; color: #5d6b82; margin-top: 4px; }
  .pchart-legend i { display: inline-block; width: 14px; height: 3px; border-radius: 2px; margin-right: 5px; vertical-align: 3px; }`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function nice(lo, hi, n) {
    if (!(hi > lo)) { hi = lo + 1; lo = lo - 1; }
    const raw = (hi - lo) / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toPrecision(12));
    return out;
  }
  function fmt(v) {
    if (v === null || v === undefined || !isFinite(v)) return "—";
    const a = Math.abs(v);
    if (a !== 0 && (a < 1e-3 || a >= 1e6)) return v.toExponential(2);
    return +v.toPrecision(4) + "";
  }
  function fmtX(x) {
    if (typeof x === "string" && /^\d{4}-\d\d-\d\d/.test(x)) return x.slice(5, 16).replace("T", " ");
    return typeof x === "number" ? fmt(x) : String(x);
  }

  function mount(el, spec) {
    const W = Math.max(280, el.clientWidth || 600), H = spec.height || 220;
    const L = 56, R = 14, T = 10, B = 28;
    const n = spec.x.length;
    const ys = [];
    for (const s of spec.series) for (const k of ["y", "lo", "hi"]) if (s[k]) for (const v of s[k]) if (v !== null && isFinite(v) && (!spec.yLog || v > 0)) ys.push(v);
    for (const h of spec.hlines || []) if (isFinite(h.y)) ys.push(h.y);
    if (spec.band) ys.push(spec.band.lo, spec.band.hi);
    let lo = spec.yMin ?? Math.min(...ys), hi = spec.yMax ?? Math.max(...ys);
    if (!ys.length) { lo = 0; hi = 1; }
    const tf = spec.yLog ? (v) => Math.log10(v) : (v) => v;
    let a = tf(lo), b = tf(hi);
    if (spec.yLog) { a = Math.floor(a); b = Math.ceil(b); if (b - a < 1) b = a + 1; }
    else { const pad = (b - a) * 0.06 || Math.abs(a) * 0.1 || 1; a -= pad; b += pad; }
    const X = (i) => L + (n <= 1 ? 0 : (i / (n - 1)) * (W - L - R));
    const Y = (v) => T + (1 - (tf(v) - a) / (b - a)) * (H - T - B);
    let g = "";
    const ticks = spec.yLog ? Array.from({ length: b - a + 1 }, (_, k) => Math.pow(10, a + k)) : nice(a, b, 4);
    for (const v of ticks) {
      const y = Y(v);
      if (y < T - 1 || y > H - B + 1) continue;
      g += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text x="${L - 6}" y="${y + 3.5}" text-anchor="end">${spec.yLog ? "1e" + Math.round(Math.log10(v)) : fmt(v)}</text>`;
    }
    if (spec.flags) {
      const w = Math.max(1.5, (W - L - R) / Math.max(1, n - 1));
      spec.flags.forEach((f, i) => { if (f) g += `<rect x="${X(i) - w / 2}" y="${T}" width="${w}" height="${H - T - B}" fill="#b4231822"/>`; });
    }
    if (spec.band) g += `<rect x="${L}" width="${W - L - R}" y="${Y(spec.band.hi)}" height="${Math.max(0, Y(spec.band.lo) - Y(spec.band.hi))}" fill="${spec.band.color || "#1a7f4b18"}"/>`;
    for (const h of spec.hlines || []) {
      g += `<line x1="${L}" x2="${W - R}" y1="${Y(h.y)}" y2="${Y(h.y)}" stroke="${h.color || "#5d6b82"}" stroke-dasharray="${h.dash || "4 3"}"/>`;
      if (h.label) g += `<text x="${W - R}" y="${Y(h.y) - 4}" text-anchor="end" style="fill:${h.color || "#5d6b82"}">${esc(h.label)}</text>`;
    }
    for (const s of spec.series) {
      const col = s.color || "#0b6bcb";
      if (s.lo && s.hi) {
        let top = "", bot = "", segs = [];
        let cur = [];
        for (let i = 0; i < n; i++) {
          if (s.lo[i] === null || s.hi[i] === null || (spec.yLog && s.lo[i] <= 0)) { if (cur.length) segs.push(cur); cur = []; continue; }
          cur.push(i);
        }
        if (cur.length) segs.push(cur);
        for (const sg of segs) {
          top = sg.map((i) => `${X(i)},${Y(s.hi[i])}`).join(" ");
          bot = sg.slice().reverse().map((i) => `${X(i)},${Y(s.lo[i])}`).join(" ");
          g += `<polygon points="${top} ${bot}" fill="${col}" fill-opacity="${s.fillOpacity ?? 0.55}" stroke="${col}" stroke-width="0.8"/>`;
        }
      }
      if (s.y) {
        let d = "", pen = false;
        for (let i = 0; i < n; i++) {
          const v = s.y[i];
          if (v === null || v === undefined || !isFinite(v) || (spec.yLog && v <= 0)) { pen = false; continue; }
          d += `${pen ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`; pen = true;
        }
        g += `<path d="${d}" fill="none" stroke="${col}" stroke-width="${s.width || 1.6}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ""}/>`;
      }
    }
    const nx = Math.min(6, n);
    for (let k = 0; k < nx; k++) {
      const i = Math.round((k / Math.max(1, nx - 1)) * (n - 1));
      g += `<text x="${X(i)}" y="${H - B + 16}" text-anchor="${k === 0 ? "start" : k === nx - 1 ? "end" : "middle"}">${esc(fmtX(spec.x[i]))}</text>`;
    }
    g += `<line class="ax" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/><line class="ax" x1="${L}" x2="${L}" y1="${T}" y2="${H - B}"/>`;
    if (spec.yLabel) g += `<text class="yl" x="12" y="${T + (H - T - B) / 2}" transform="rotate(-90 12 ${T + (H - T - B) / 2})" text-anchor="middle">${esc(spec.yLabel)}</text>`;
    g += `<line class="cross" x1="0" x2="0" y1="${T}" y2="${H - B}" stroke="#172033" stroke-opacity=".35" style="display:none"/>`;
    el.classList.add("pchart");
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(spec.label || spec.yLabel || "chart")}">${g}</svg><div class="tip"></div>`;
    const legend = spec.series.filter((s) => s.name);
    if (legend.length > 1 || spec.legend) {
      const lg = document.createElement("div"); lg.className = "pchart-legend";
      lg.innerHTML = legend.map((s) => `<span><i style="background:${s.color || "#0b6bcb"}"></i>${esc(s.name)}</span>`).join("");
      el.appendChild(lg);
    }
    const svg = el.querySelector("svg"), tip = el.querySelector(".tip"), cross = svg.querySelector(".cross");
    svg.addEventListener("mousemove", (e) => {
      const r = svg.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W;
      if (px < L || px > W - R) { tip.style.display = "none"; cross.style.display = "none"; return; }
      const i = Math.max(0, Math.min(n - 1, Math.round(((px - L) / (W - L - R)) * (n - 1))));
      cross.setAttribute("x1", X(i)); cross.setAttribute("x2", X(i)); cross.style.display = "";
      const rows = spec.series.map((s) => {
        const v = s.y ? s.y[i] : null, range = s.lo ? `${fmt(s.lo[i])} … ${fmt(s.hi[i])}` : null;
        return `<div><i style="background:${s.color || "#0b6bcb"}"></i>${esc(s.name || "")} ${v !== null && v !== undefined ? fmt(v) : range ?? "—"}</div>`;
      }).join("");
      tip.innerHTML = `<div style="opacity:.75">${esc(fmtX(spec.x[i]))}</div>${rows}`;
      tip.style.display = "block";
      const left = (X(i) / W) * r.width;
      tip.style.left = Math.min(r.width - tip.offsetWidth - 4, Math.max(0, left + 10)) + "px";
      tip.style.top = "6px";
    });
    svg.addEventListener("mouseleave", () => { tip.style.display = "none"; cross.style.display = "none"; });
  }
  window.PChart = { mount, fmt };
})();
