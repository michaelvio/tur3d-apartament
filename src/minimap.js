// Minimap (Faza 5, pasul 5): vedere de sus cu camerele (bounds din tour.json sau, dacă lipsesc,
// cutia modelului), ușile, poziția și direcția vizitatorului. Click pe o cameră → teleportare acolo.
import * as THREE from "three";

const PAD = 10;   // px

// Cutia modelului în coordonatele lumii (centrele splat-urilor, deci fără halo-ul gaussienelor).
export function splatWorldBox(mesh) {
  if (!mesh?.isInitialized) return null;
  mesh.updateMatrixWorld(true);
  const box = mesh.getBoundingBox(true).applyMatrix4(mesh.matrixWorld);
  return box.isEmpty() ? null : box;
}

export class Minimap {
  constructor(canvas, { tour, camera, meshes, getCurrentRoom, onSelectRoom }) {
    this.canvas = canvas;
    this.g = canvas.getContext("2d");
    Object.assign(this, { tour, camera, meshes, getCurrentRoom });
    this.boxCache = new Map();   // cutiile modelelor fără bounds; golit de editor la mutare
    this.walls = [];             // [x, z, w, h] din floorplan.svg (metri, coordonatele lumii)
    canvas.addEventListener("click", (e) => {
      const r = canvas.getBoundingClientRect();
      const hit = this.rects().find(({ x0, z0, x1, z1 }) => {
        const [px, pz] = this.toWorld(e.clientX - r.left, e.clientY - r.top);
        return px >= x0 && px <= x1 && pz >= z0 && pz <= z1;
      });
      if (hit) onSelectRoom(hit.room.id);
    });
  }

  // Pereții din planul generat de „tur3d floorplan" (grupul #walls, deja în coordonatele lumii).
  async loadFloorplan(url) {
    try {
      const doc = new DOMParser().parseFromString(await (await fetch(url, { cache: "no-cache" })).text(), "image/svg+xml");
      this.walls = [...doc.querySelectorAll("#walls rect")].map((r) =>
        ["x", "y", "width", "height"].map((a) => parseFloat(r.getAttribute(a))));
    } catch (e) {
      console.warn("Planul nu s-a putut citi:", url, e);
    }
  }

  // Dreptunghiul fiecărei camere în planul XZ (lumea three.js).
  rects() {
    const out = [];
    for (const room of this.tour.rooms) {
      let b = room.bounds;
      if (!b) {
        if (!this.boxCache.has(room.id)) {
          const box = splatWorldBox(this.meshes.get(room.id));
          if (!box) continue;
          this.boxCache.set(room.id, { min: box.min.toArray(), max: box.max.toArray() });
        }
        b = this.boxCache.get(room.id);
      }
      out.push({ room, x0: b.min[0], z0: b.min[2], x1: b.max[0], z1: b.max[2] });
    }
    return out;
  }

  // Scara: toate camerele încap în canvas, cu proporțiile păstrate.
  fit(rects) {
    const xs = rects.flatMap((r) => [r.x0, r.x1]), zs = rects.flatMap((r) => [r.z0, r.z1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const s = Math.min((w - 2 * PAD) / (maxX - minX || 1), (h - 2 * PAD) / (maxZ - minZ || 1));
    this.view = { s, ox: (w - s * (maxX - minX)) / 2 - s * minX, oz: (h - s * (maxZ - minZ)) / 2 - s * minZ };
  }

  toPx(x, z) { return [this.view.ox + x * this.view.s, this.view.oz + z * this.view.s]; }
  toWorld(px, pz) { return [(px - this.view.ox) / this.view.s, (pz - this.view.oz) / this.view.s]; }

  draw() {
    const rects = this.rects();
    this.canvas.hidden = rects.length === 0;
    if (!rects.length) return;
    const dpr = devicePixelRatio || 1, w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (this.canvas.width !== Math.round(w * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    const g = this.g;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    this.fit(rects);

    const current = this.getCurrentRoom();
    g.font = "11px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const r of rects) {
      const [x0, z0] = this.toPx(r.x0, r.z0), [x1, z1] = this.toPx(r.x1, r.z1);
      const active = r.room === current;
      g.fillStyle = active ? "rgba(79,163,255,0.28)" : "rgba(255,255,255,0.08)";
      g.strokeStyle = active ? "#4fa3ff" : "rgba(255,255,255,0.35)";
      g.lineWidth = active ? 2 : 1;
      g.fillRect(x0, z0, x1 - x0, z1 - z0);
      g.strokeRect(x0, z0, x1 - x0, z1 - z0);
      g.fillStyle = "#eef0f3";
      g.fillText(r.room.name, (x0 + x1) / 2, (z0 + z1) / 2, x1 - x0 - 4);
    }

    g.fillStyle = "rgba(238,240,243,0.85)";
    for (const [x, z, ww, hh] of this.walls) {
      const [px, pz] = this.toPx(x, z);
      g.fillRect(px, pz, Math.max(1, ww * this.view.s), Math.max(1, hh * this.view.s));
    }

    g.fillStyle = "#ffd166";
    for (const room of this.tour.rooms) for (const d of room.doors ?? []) {
      const [x, z] = this.toPx(d.pos[0], d.pos[2]);
      g.beginPath(); g.arc(x, z, 3, 0, Math.PI * 2); g.fill();
    }

    // Vizitatorul: punct + con de vedere.
    const p = this.camera.position;
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    const yaw = Math.atan2(dir.z, dir.x);
    const [cx, cz] = this.toPx(p.x, p.z);
    g.fillStyle = "rgba(255,255,255,0.25)";
    g.beginPath(); g.moveTo(cx, cz); g.arc(cx, cz, 22, yaw - 0.5, yaw + 0.5); g.closePath(); g.fill();
    g.fillStyle = "#fff";
    g.beginPath(); g.arc(cx, cz, 4, 0, Math.PI * 2); g.fill();
  }
}
