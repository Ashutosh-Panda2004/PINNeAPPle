// "Model scope & validation" panel shared by the PINNeAPPle apps.
// Leads with what was validated, then each simplification with the direction
// of its error, what to do about it today, and what is planned.
(function () {
  const css = `
  .scope { border: 1px solid var(--line); border-radius: 10px; margin-top: 18px; overflow: hidden; }
  .scope > summary { cursor: pointer; padding: 12px 16px; font-weight: 700; list-style: none;
    display: flex; justify-content: space-between; gap: 12px; align-items: center; background: #f7f9fc; }
  .scope > summary::-webkit-details-marker { display: none; }
  .scope > summary .meta { font-weight: 400; }
  .scope > summary::after { content: "▾"; color: var(--muted); }
  .scope:not([open]) > summary::after { content: "▸"; }
  .scope-body { display: grid; grid-template-columns: 1fr 1.6fr; gap: 20px; padding: 14px 16px 16px; }
  @media (max-width: 900px) { .scope-body { grid-template-columns: 1fr; } }
  .scope h4 { margin: 0 0 8px; font-size: 13px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
  .scope ul.ok { margin: 0; padding: 0; list-style: none; font-size: 13px; }
  .scope ul.ok li { padding: 4px 0 4px 22px; position: relative; }
  .scope ul.ok li::before { content: "✓"; position: absolute; left: 2px; color: var(--ok); font-weight: 700; }
  .scope .band { font-size: 12.5px; color: var(--muted); margin-top: 10px; }
  .scope .item { padding: 9px 0; border-top: 1px solid var(--line); font-size: 13px; }
  .scope .item:first-of-type { border-top: 0; padding-top: 0; }
  .scope .item b { margin-right: 6px; }
  .scope .tag { display: inline-block; font-size: 11px; font-weight: 700; border-radius: 99px; padding: 1px 8px; vertical-align: 1px; }
  .scope .tag.conservative { background: var(--ok-bg); color: var(--ok); }
  .scope .tag.optimistic { background: var(--warn-bg); color: var(--warn); }
  .scope .tag.check { background: #eef1f5; color: var(--na); }
  .scope .row { display: grid; grid-template-columns: 92px 1fr; gap: 6px; margin-top: 3px; color: var(--muted); }
  .scope .row span:first-child { font-weight: 600; }
  @media print { .scope { break-inside: avoid; } .scope-body { grid-template-columns: 1fr 1.6fr; } }`;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  const TAG = {
    conservative: "Conservative — real part runs cooler",
    optimistic: "Can read low — keep margin",
    check: "Assumption to confirm",
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  window.renderScope = function (scope, { open = false } = {}) {
    if (!scope) return "";
    const n = scope.items.length;
    const tags = { ...TAG, ...(scope.tags || {}) };
    return `<details class="scope"${open ? " open" : ""}>
      <summary><span>${esc(scope.title || "Model scope & validation")}</span>
        <span class="meta">${scope.validated.length} independent checks passed · ${n} ${esc(scope.noun || "modelling assumption")}${n === 1 ? "" : "s"} to know</span></summary>
      <div class="scope-body">
        <div>
          <h4>Validated against</h4>
          <ul class="ok">${scope.validated.map((v) => `<li>${esc(v)}</li>`).join("")}</ul>
          <div class="band">${esc(scope.band)}</div>
        </div>
        <div>
          <h4>${esc(scope.items_title || "What the model assumes")}</h4>
          ${scope.items.map((it) => `<div class="item">
            <b>${esc(it.topic)}</b><span class="tag ${it.effect}">${esc(tags[it.effect] || it.effect)}</span>
            <div style="margin-top:4px">${esc(it.detail)}</div>
            <div class="row"><span>What to do</span><span>${esc(it.today)}</span></div>
            <div class="row"><span>Roadmap</span><span>${esc(it.planned)}</span></div>
          </div>`).join("")}
        </div>
      </div>
    </details>`;
  };
})();
