// 3D temperature-contour viewer for a plate-fin heat sink (three.js, vendored).
// Mirrors what thermal CAE tools show: surface temperature contour with a
// legend, standard views, probe under the cursor, banded contours, edges,
// airflow arrow, heat-source footprint and hotspot marker, PNG export.
import * as THREE from "three";
import { OrbitControls } from "/static/vendor/three/OrbitControls.js";

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

// Geometry accumulator: grids of (position, temperature) merged into one mesh.
class SurfaceBuilder {
  constructor() { this.pos = []; this.temp = []; this.idx = []; }
  grid(nu, nv, at) {           // at(i, j) -> [x, y, z, T]
    const base = this.pos.length / 3;
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const [x, y, z, T] = at(i, j); this.pos.push(x, y, z); this.temp.push(T);
    }
    for (let j = 0; j < nv - 1; j++) for (let i = 0; i < nu - 1; i++) {
      const a = base + j * nu + i, b = a + 1, c = a + nu, d = c + 1;
      this.idx.push(a, c, b, b, c, d);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("temp", new THREE.Float32BufferAttribute(this.temp, 1));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(new Array((this.pos.length / 3) * 2).fill(0.5), 2));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

// Pad a cell-centred profile out to the domain edges (0 and L).
const padAxis = (c, L) => [0, ...c, L];
const padRow = (r) => [r[0], ...r, r[r.length - 1]];
const lerp1 = (xs, vs, x) => {
  if (x <= xs[0]) return vs[0];
  for (let i = 1; i < xs.length; i++) if (x <= xs[i]) {
    const f = (x - xs[i - 1]) / (xs[i] - xs[i - 1]); return vs[i - 1] + f * (vs[i] - vs[i - 1]);
  }
  return vs[vs.length - 1];
};

export class HeatSinkViewer {
  constructor(container) {
    this.el = container;
    this.el.innerHTML = `
      <div class="v3d-toolbar">
        <span class="v3d-group">${["iso", "front", "top", "side", "bottom"].map((v) =>
          `<button data-view="${v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join("")}</span>
        <span class="v3d-group">
          <select data-k="cmap"><option value="rainbow">Rainbow</option><option value="inferno">Inferno</option></select>
          <label><input type="checkbox" data-k="bands"> Banded</label>
          <label><input type="checkbox" data-k="edges" checked> Edges</label>
          <label><input type="checkbox" data-k="fins" checked> Fins</label>
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
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 10000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.3); sun.position.set(1, 2, 1.5);
    this.camera.add(sun); this.scene.add(this.camera);
    this.opts = { cmap: "rainbow", bands: false, edges: true, fins: true };
    this.raycaster = new THREE.Raycaster();
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
      if (k === "cmap" || k === "bands") this.recolor();
      if (k === "edges") this.edges.visible = this.opts.edges;
      if (k === "fins") { this.finMesh.visible = this.finEdges.visible = this.opts.fins; }
    }));
    const probe = this.el.querySelector(".v3d-probe");
    this.renderer.domElement.addEventListener("pointermove", (e) => {
      const r = this.renderer.domElement.getBoundingClientRect();
      const p = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.raycaster.setFromCamera(p, this.camera);
      const hit = this.raycaster.intersectObjects([this.baseMesh, this.finMesh].filter((m) => m && m.visible))[0];
      if (!hit) { probe.style.display = "none"; return; }
      const g = hit.object.geometry, T = g.getAttribute("temp"), P = g.getAttribute("position"), f = hit.face;
      const tri = new THREE.Triangle(...[f.a, f.b, f.c].map((i) => new THREE.Vector3().fromBufferAttribute(P, i)));
      const w = tri.getBarycoord(hit.point, new THREE.Vector3());
      const t = w.x * T.getX(f.a) + w.y * T.getX(f.b) + w.z * T.getX(f.c);
      const q = hit.point;   // world: x = width, y = height, z = depth (mm)
      probe.innerHTML = `<b>${t.toFixed(1)} °C</b><br>x ${q.x.toFixed(1)} · y ${q.z.toFixed(1)} · z ${q.y.toFixed(1)} mm`;
      probe.style.display = "block";
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

  load(f) {
    this.f = f;
    if (this.group) { this.scene.remove(this.group); this.group.traverse((o) => o.geometry && o.geometry.dispose()); }
    this.group = new THREE.Group(); this.scene.add(this.group);
    const B = f.base, F = f.fins, Ta = f.t_ambient_c;
    const xs = padAxis(B.x, B.width), ys = padAxis(B.y, B.depth);
    const bot = padRow(B.bottom_c.map(padRow)), top = padRow(B.top_c.map(padRow));
    const nx = xs.length, ny = ys.length, tb = B.thickness;
    // world: X = width, Y = up, Z = depth (flow direction)
    const sb = new SurfaceBuilder();
    sb.grid(nx, ny, (i, j) => [xs[i], 0, ys[j], bot[j][i]]);
    sb.grid(nx, ny, (i, j) => [xs[i], tb, ys[j], top[j][i]]);
    const side = (along, fixedIdx, isX) => sb.grid(along.length, 2, (i, k) => {
      const T = isX ? (k ? top : bot)[i][fixedIdx] : (k ? top : bot)[fixedIdx][i];
      return isX ? [xs[fixedIdx], k * tb, ys[i], T] : [xs[i], k * tb, ys[fixedIdx], T];
    });
    side(ys, 0, true); side(ys, nx - 1, true); side(xs, 0, false); side(xs, ny - 1, false);

    const fb = new SurfaceBuilder(), zp = f.fin_profile.z, rp = f.fin_profile.theta_ratio;
    const H = F.height, t = F.thickness;
    F.x_centers.forEach((xc, k) => {
      const root = padRow(F.root_c[k]);
      const T = (j, iz) => Ta + (root[j] - Ta) * rp[iz];
      for (const xf of [xc - t / 2, xc + t / 2]) fb.grid(ny, zp.length, (j, iz) => [xf, tb + zp[iz], ys[j], T(j, iz)]);
      fb.grid(2, ny, (i, j) => [xc + (i - 0.5) * t, tb + H, ys[j], T(j, zp.length - 1)]);
      for (const j of [0, ny - 1]) fb.grid(2, zp.length, (i, iz) => [xc + (i - 0.5) * t, tb + zp[iz], ys[j], T(j, iz)]);
    });
    // Colour by texture lookup of the normalised temperature (per pixel), the
    // way CAE post-processors draw contours: bands stay crisp on coarse meshes.
    this.tex = new THREE.DataTexture(new Uint8Array(256 * 4), 256, 1);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshLambertMaterial({ map: this.tex, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    this.baseMesh = new THREE.Mesh(sb.build(), mat);
    this.finMesh = new THREE.Mesh(fb.build(), mat);
    this.group.add(this.baseMesh, this.finMesh);
    this.finMesh.visible = this.opts.fins;

    // edges: base box + each fin box
    const lineMat = new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.45 });
    const boxEdges = (w, h, d, x, y, z) => {
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)), lineMat);
      e.position.set(x, y, z); return e;
    };
    this.edges = new THREE.Group(); this.finEdges = new THREE.Group();
    this.edges.add(boxEdges(B.width, tb, B.depth, B.width / 2, tb / 2, B.depth / 2));
    F.x_centers.forEach((xc) => this.finEdges.add(boxEdges(t, H, B.depth, xc, tb + H / 2, B.depth / 2)));
    this.edges.add(this.finEdges); this.group.add(this.edges);
    this.edges.visible = this.opts.edges; this.finEdges.visible = this.opts.fins;

    // heat-source footprint (under the base) and hotspot marker
    const s = f.source, y0 = -0.05;
    const pts = [[s.x - s.w / 2, s.y - s.d / 2], [s.x + s.w / 2, s.y - s.d / 2], [s.x + s.w / 2, s.y + s.d / 2], [s.x - s.w / 2, s.y + s.d / 2], [s.x - s.w / 2, s.y - s.d / 2]]
      .map(([x, z]) => new THREE.Vector3(x, y0, z));
    const src = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 2, gapSize: 1.5 }));
    src.computeLineDistances(); this.group.add(src);
    const size = Math.max(B.width, B.depth, tb + H);
    this.hot = new THREE.Mesh(new THREE.SphereGeometry(size * 0.012, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.hot.position.set(f.hotspot.x, -size * 0.012, f.hotspot.y); this.group.add(this.hot);

    // airflow arrow along +depth
    const forced = f.flow.mode === "forced";
    // solid flow arrow beside the heat sink, running along the depth (+Z)
    const L = B.depth * 0.8, r = size * 0.018, arrowMat = new THREE.MeshLambertMaterial({ color: forced ? 0x1565c0 : 0x2e7d32 });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(r, r, L * 0.78, 16), arrowMat);
    const head = new THREE.Mesh(new THREE.ConeGeometry(r * 2.6, L * 0.22, 20), arrowMat);
    shaft.position.y = L * 0.39; head.position.y = L * 0.89;
    this.arrow = new THREE.Group(); this.arrow.add(shaft, head);
    this.arrow.rotation.x = Math.PI / 2;                         // +Y -> +Z
    this.arrow.position.set(B.width + size * 0.22, (tb + H) / 2, B.depth * 0.1);
    this.group.add(this.arrow);
    this.flowText = forced ? `Airflow ${f.flow.velocity_m_s} m/s (ducted)` : "Buoyant airflow (vertical fins)";

    this.group.position.set(-B.width / 2, -(tb + H) / 2, -B.depth / 2);
    this.size = size;
    this.recolor();
    this.view("iso");
  }

  recolor() {
    const all = [...this.baseMesh.geometry.getAttribute("temp").array, ...this.finMesh.geometry.getAttribute("temp").array];
    let lo = Infinity, hi = -Infinity; for (const v of all) { if (v < lo) lo = v; if (v > hi) hi = v; }
    this.range = [lo, hi];
    const bands = this.opts.bands ? 12 : 0;
    const n = bands || 256, data = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const c = cmap(this.opts.cmap, i / (n - 1), 0);
      data.set([c[0] * 255, c[1] * 255, c[2] * 255, 255], i * 4);
    }
    this.tex.image = { data, width: n, height: 1 };
    this.tex.magFilter = this.tex.minFilter = bands ? THREE.NearestFilter : THREE.LinearFilter;
    this.tex.needsUpdate = true;
    for (const m of [this.baseMesh, this.finMesh]) {
      const T = m.geometry.getAttribute("temp"), U = m.geometry.getAttribute("uv");
      // map [lo, hi] onto texel centres so the end colours are exact
      for (let i = 0; i < T.count; i++) {
        const u = (T.getX(i) - lo) / Math.max(hi - lo, 1e-9);
        U.setXY(i, (0.5 + u * (n - 1)) / n, 0.5);
      }
      U.needsUpdate = true;
    }
    const cv = this.el.querySelector(".v3d-legend canvas"), c = cv.getContext("2d");
    for (let y = 0; y < cv.height; y++) {
      const [r, g, b] = cmap(this.opts.cmap, 1 - y / (cv.height - 1), bands);
      c.fillStyle = `rgb(${r * 255},${g * 255},${b * 255})`; c.fillRect(0, y, cv.width, 1);
    }
    const nt = 7;
    this.el.querySelector(".v3d-ticks").innerHTML = Array.from({ length: nt }, (_, i) =>
      `<span>${(hi - (i * (hi - lo)) / (nt - 1)).toFixed(1)}</span>`).join("");
    this.el.querySelector(".v3d-info").innerHTML =
      `<b>Max ${this.f.hotspot.t_c.toFixed(1)} °C</b> at heat source (○)<br>Min ${lo.toFixed(1)} °C · ambient ${this.f.t_ambient_c} °C<br>${this.flowText}`;
  }

  view(v) {
    const d = this.size * 2.6, dirs = {
      iso: [1, 0.8, 1.2], front: [0, 0.15, -1], top: [0, 1, 0.0001], side: [1, 0.15, 0], bottom: [0, -1, 0.0001],
    };
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
    const a = document.createElement("a"); a.href = out.toDataURL("image/png"); a.download = "heatsink_temperature_3d.png"; a.click();
  }
}
