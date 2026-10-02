// 3D temperature view of a PCB (three.js, vendored under /vendor).
// Board slab coloured by its top / bottom copper temperature, components as
// boxes coloured by case temperature and labelled with the junction
// temperature — the view board-level thermal tools (Icepak/FloTHERM PCB) show.
import * as THREE from "three";
import { OrbitControls } from "/vendor/three/OrbitControls.js";

const CMAPS = {
  rainbow: [[0, [0, 0, 255]], [0.25, [0, 255, 255]], [0.5, [0, 255, 0]], [0.75, [255, 255, 0]], [1, [255, 0, 0]]],
  inferno: [[0, [0, 0, 4]], [0.25, [87, 16, 110]], [0.5, [188, 55, 84]], [0.75, [249, 142, 9]], [1, [252, 255, 164]]],
};
function cmap(name, t, bands) {
  t = Math.min(1, Math.max(0, t));
  if (bands) t = Math.min(bands - 1, Math.floor(t * bands)) / (bands - 1);
  const s = CMAPS[name];
  for (let i = 1; i < s.length; i++) if (t <= s[i][0]) {
    const [t0, c0] = s[i - 1], [t1, c1] = s[i], f = (t - t0) / (t1 - t0);
    return c0.map((c, j) => (c + f * (c1[j] - c)) / 255);
  }
  return s[s.length - 1][1].map((c) => c / 255);
}

// Grid surface with a per-vertex temperature attribute (uv filled by recolor()).
function surface(nu, nv, at) {
  const pos = [], temp = [], idx = [];
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const [x, y, z, T] = at(i, j); pos.push(x, y, z); temp.push(T); }
  for (let j = 0; j < nv - 1; j++) for (let i = 0; i < nu - 1; i++) {
    const a = j * nu + i, b = a + 1, c = a + nu, d = c + 1; idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("temp", new THREE.Float32BufferAttribute(temp, 1));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(new Array(temp.length * 2).fill(0.5), 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function label(text) {
  const c = document.createElement("canvas"), ctx = c.getContext("2d");
  ctx.font = "bold 44px system-ui"; c.width = Math.ceil(ctx.measureText(text).width) + 24; c.height = 64;
  ctx.font = "bold 44px system-ui"; ctx.fillStyle = "#172033e0"; ctx.roundRect(0, 0, c.width, c.height, 12); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.textBaseline = "middle"; ctx.fillText(text, 12, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false }));
  s.userData.aspect = c.width / c.height; s.renderOrder = 10;
  return s;
}

export class BoardViewer {
  constructor(container) {
    this.el = container;
    this.el.innerHTML = `
      <div class="v3d-toolbar">
        <span class="v3d-group">${["iso", "top", "bottom", "front", "side"].map((v) =>
          `<button data-view="${v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join("")}</span>
        <span class="v3d-group">
          <select data-k="cmap"><option value="rainbow">Rainbow</option><option value="inferno">Inferno</option></select>
          <label><input type="checkbox" data-k="bands"> Banded</label>
          <label><input type="checkbox" data-k="parts" checked> Components</label>
          <label><input type="checkbox" data-k="labels" checked> Labels</label>
          <label title="Stretch the board thickness so the through-board gradient is visible"><input type="checkbox" data-k="zx"> Thickness ×5</label>
          <button data-k="png">PNG</button>
        </span>
      </div>
      <div class="v3d-stage">
        <div class="v3d-info"></div>
        <div class="v3d-legend"><div class="v3d-lt">Temperature<br>[°C]</div><canvas width="18" height="220"></canvas><div class="v3d-ticks"></div></div>
        <div class="v3d-probe"></div>
      </div>`;
    this.stage = this.el.querySelector(".v3d-stage");
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.stage.prepend(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(1, 2, 1.5);
    this.camera.add(sun); this.scene.add(this.camera);
    this.opts = { cmap: "rainbow", bands: false, parts: true, labels: true, zx: false };
    this.raycaster = new THREE.Raycaster();
    this.tex = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.bind();
    new ResizeObserver(() => this.resize()).observe(this.stage);
    const loop = () => { this.controls.update(); this.renderer.render(this.scene, this.camera); requestAnimationFrame(loop); };
    loop();
  }

  bind() {
    this.el.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => this.view(b.dataset.view)));
    this.el.querySelectorAll("[data-k]").forEach((c) => c.addEventListener(c.tagName === "BUTTON" ? "click" : "change", () => {
      const k = c.dataset.k;
      if (k === "png") return this.png();
      this.opts[k] = c.type === "checkbox" ? c.checked : c.value;
      if (k === "zx") return this.load(this.f, true);
      if (k === "parts") this.parts.visible = this.opts.parts;
      if (k === "labels") this.labels.visible = this.opts.labels;
      this.recolor();
    }));
    const probe = this.el.querySelector(".v3d-probe");
    this.renderer.domElement.addEventListener("pointermove", (e) => {
      if (!this.f) return;
      const r = this.renderer.domElement.getBoundingClientRect();
      const p = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.raycaster.setFromCamera(p, this.camera);
      const targets = [this.slab, ...(this.opts.parts ? this.parts.children : [])];
      const hit = this.raycaster.intersectObjects(targets)[0];
      if (!hit) { probe.style.display = "none"; return; }
      let html;
      if (hit.object.userData.comp) {
        const c = hit.object.userData.comp;
        html = `<b>${c.name}</b> · ${c.power_w} W<br>Tj ${c.t_junction_c.toFixed(1)} °C · case ${c.t_case_top_c.toFixed(1)} °C<br>margin ${c.margin_c.toFixed(1)} °C`;
      } else {
        const g = hit.object.geometry, T = g.getAttribute("temp"), P = g.getAttribute("position"), f = hit.face;
        const tri = new THREE.Triangle(...[f.a, f.b, f.c].map((i) => new THREE.Vector3().fromBufferAttribute(P, i)));
        const w = tri.getBarycoord(hit.object.worldToLocal(hit.point.clone()), new THREE.Vector3());
        const t = w.x * T.getX(f.a) + w.y * T.getX(f.b) + w.z * T.getX(f.c);
        const q = hit.object.worldToLocal(hit.point.clone());
        html = `<b>${t.toFixed(1)} °C</b> board<br>x ${q.x.toFixed(1)} · y ${(-q.z).toFixed(1)} mm`;
      }
      probe.innerHTML = html; probe.style.display = "block";
      probe.style.left = `${e.clientX - r.left + 14}px`; probe.style.top = `${e.clientY - r.top + 14}px`;
    });
    this.renderer.domElement.addEventListener("pointerleave", () => (probe.style.display = "none"));
  }

  resize() {
    const w = this.stage.clientWidth, h = this.stage.clientHeight;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = "100%"; this.renderer.domElement.style.height = "100%";
    this.camera.aspect = w / Math.max(h, 1); this.camera.updateProjectionMatrix();
  }

  load(f, keepView = false) {
    this.f = f;
    if (this.group) { this.scene.remove(this.group); this.group.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose?.(); }); }
    this.group = new THREE.Group(); this.scene.add(this.group);
    const W = f.width_mm, D = f.depth_mm, th = f.thickness_mm * (this.opts.zx ? 5 : 1);
    const ny = f.top_c.length, nx = f.top_c[0].length;
    // world: X = board x, Y = up, Z = -board y (so board y grows "away" from the viewer)
    const xs = (i) => (i / (nx - 1)) * W, zs = (j) => -(j / (ny - 1)) * D;
    const parts = [];
    parts.push(surface(nx, ny, (i, j) => [xs(i), th, zs(j), f.top_c[j][i]]));
    parts.push(surface(nx, ny, (i, j) => [xs(i), 0, zs(j), f.bottom_c[j][i]]));
    const edge = (n, at) => parts.push(surface(n, 2, at));
    edge(nx, (i, k) => [xs(i), k * th, 0, (k ? f.top_c : f.bottom_c)[0][i]]);
    edge(nx, (i, k) => [xs(i), k * th, -D, (k ? f.top_c : f.bottom_c)[ny - 1][i]]);
    edge(ny, (j, k) => [0, k * th, zs(j), (k ? f.top_c : f.bottom_c)[j][0]]);
    edge(ny, (j, k) => [W, k * th, zs(j), (k ? f.top_c : f.bottom_c)[j][nx - 1]]);
    // merge into one geometry
    const merged = new THREE.BufferGeometry(), P = [], T = [], I = [];
    for (const g of parts) {
      const base = P.length / 3;
      P.push(...g.getAttribute("position").array); T.push(...g.getAttribute("temp").array);
      I.push(...g.getIndex().array.map((v) => v + base)); g.dispose();
    }
    merged.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    merged.setAttribute("temp", new THREE.Float32BufferAttribute(T, 1));
    merged.setAttribute("uv", new THREE.Float32BufferAttribute(new Array(T.length * 2).fill(0.5), 2));
    merged.setIndex(I); merged.computeVertexNormals();
    this.slab = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ map: this.tex, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
    const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(W, th, D)),
      new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.5 }));
    outline.position.set(W / 2, th / 2, -D / 2);
    this.group.add(this.slab, outline);

    this.parts = new THREE.Group(); this.labels = new THREE.Group();
    const size = Math.max(W, D);
    for (const c of f.components) {
      const h = c.h_mm, up = c.side === "top";
      const box = new THREE.Mesh(new THREE.BoxGeometry(c.w_mm, h, c.d_mm), new THREE.MeshLambertMaterial());
      box.position.set(c.x_mm, up ? th + h / 2 : -h / 2, -c.y_mm);
      box.userData.comp = c;
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(box.geometry),
        new THREE.LineBasicMaterial({ color: c.margin_c < 0 ? 0xff1f1f : 0x111111 }));
      box.add(e);
      this.parts.add(box);
      const s = label(`${c.name} ${c.t_junction_c.toFixed(0)}°C`), sh = size * 0.035;
      s.scale.set(sh * s.userData.aspect, sh, 1);
      s.position.set(c.x_mm, up ? th + h + sh * 0.9 : -h - sh * 0.9, -c.y_mm);
      this.labels.add(s);
    }
    this.parts.visible = this.opts.parts; this.labels.visible = this.opts.labels;
    this.group.add(this.parts, this.labels);
    this.group.position.set(-W / 2, -th / 2, D / 2);
    this.size = size;
    this.recolor();
    if (!keepView) this.view("iso");
  }

  recolor() {
    const T = this.slab.geometry.getAttribute("temp");
    let lo = Infinity, hi = -Infinity;
    for (const v of T.array) { if (v < lo) lo = v; if (v > hi) hi = v; }
    if (this.opts.parts) for (const c of this.f.components) hi = Math.max(hi, c.t_case_top_c);
    this.range = [lo, hi];
    const bands = this.opts.bands ? 12 : 0, n = bands || 256, data = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) { const c = cmap(this.opts.cmap, i / (n - 1), 0); data.set([c[0] * 255, c[1] * 255, c[2] * 255, 255], i * 4); }
    this.tex.image = { data, width: n, height: 1 };
    this.tex.magFilter = this.tex.minFilter = bands ? THREE.NearestFilter : THREE.LinearFilter;
    this.tex.needsUpdate = true;
    const U = this.slab.geometry.getAttribute("uv");
    for (let i = 0; i < T.count; i++) U.setXY(i, (0.5 + ((T.getX(i) - lo) / Math.max(hi - lo, 1e-9)) * (n - 1)) / n, 0.5);
    U.needsUpdate = true;
    for (const b of this.parts.children) {
      const [r, g, bl] = cmap(this.opts.cmap, (b.userData.comp.t_case_top_c - lo) / Math.max(hi - lo, 1e-9), bands);
      b.material.color.setRGB(r, g, bl, THREE.SRGBColorSpace);
    }
    const cv = this.el.querySelector(".v3d-legend canvas"), c = cv.getContext("2d");
    for (let y = 0; y < cv.height; y++) {
      const [r, g, b] = cmap(this.opts.cmap, 1 - y / (cv.height - 1), bands);
      c.fillStyle = `rgb(${r * 255},${g * 255},${b * 255})`; c.fillRect(0, y, cv.width, 1);
    }
    this.el.querySelector(".v3d-ticks").innerHTML = Array.from({ length: 7 }, (_, i) =>
      `<span>${(hi - (i * (hi - lo)) / 6).toFixed(1)}</span>`).join("");
    const crit = [...this.f.components].sort((a, b) => a.margin_c - b.margin_c)[0];
    this.el.querySelector(".v3d-info").innerHTML =
      `<b>Critical: ${crit.name}</b> Tj ${crit.t_junction_c.toFixed(1)} °C<br>Board ${lo.toFixed(1)}–${Math.max(...T.array).toFixed(1)} °C` +
      `<br>Parts coloured by case temperature${this.opts.zx ? "<br>Thickness exaggerated ×5" : ""}`;
  }

  view(v) {
    const d = this.size * 1.9, dirs = { iso: [0.9, 1.1, 1.1], top: [0, 1, 0.0001], bottom: [0, -1, 0.0001], front: [0, 0.2, 1], side: [1, 0.2, 0] };
    const [x, y, z] = dirs[v], n = Math.hypot(x, y, z);
    this.camera.position.set((x / n) * d, (y / n) * d, (z / n) * d);
    this.controls.target.set(0, 0, 0); this.controls.update();
  }

  png() {
    const src = this.renderer.domElement, legend = this.el.querySelector(".v3d-legend canvas");
    const out = document.createElement("canvas"); out.width = src.width + 140; out.height = src.height;
    const c = out.getContext("2d"); c.fillStyle = "#fff"; c.fillRect(0, 0, out.width, out.height);
    c.drawImage(src, 0, 0);
    const lx = src.width + 30, lh = Math.min(out.height - 80, 400), ly = 50;
    c.drawImage(legend, lx, ly, 24, lh);
    c.fillStyle = "#172033"; c.font = "bold 20px system-ui"; c.fillText("T [°C]", lx - 4, 32);
    c.font = "18px system-ui";
    const [lo, hi] = this.range;
    for (let i = 0; i < 7; i++) c.fillText((hi - (i * (hi - lo)) / 6).toFixed(1), lx + 32, ly + (i * lh) / 6 + 6);
    const a = document.createElement("a"); a.href = out.toDataURL("image/png"); a.download = "pcb_temperature_3d.png"; a.click();
  }
}
