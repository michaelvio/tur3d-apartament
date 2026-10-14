// Editorul de aliniere (Faza 4, varianta b), încărcat doar cu ?edit=1.
// Pentru camera curentă: transformare (poziție, rotație, scară), bounds, puncte de vedere, uși, start.
// „Salvează" scrie tour.json prin scripts/serve.py; pe alt server descarcă fișierul.

const r2 = (x) => Math.round(x * 100) / 100;
const vec = (v) => [r2(v.x), r2(v.y), r2(v.z)];

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k in e) e[k] = v;
    else e.setAttribute(k, v);
  }
  e.append(...children.filter((c) => c != null && c !== false));
  return e;
}

function num(value, step, onInput) {
  return el("input", { type: "number", step, value, oninput: (e) => {
    const v = parseFloat(e.target.value);
    if (Number.isFinite(v)) onInput(v);
  } });
}

export class Editor {
  constructor(api) {
    this.api = api;
    const { THREE, scene } = api;
    this.boundsBox = new THREE.Box3();
    this.helper = new THREE.Box3Helper(this.boundsBox, 0xffd166);
    this.helper.visible = false;
    scene.add(this.helper);
    this.panel = el("aside", { id: "editor" });
    document.body.appendChild(this.panel);
    document.body.classList.add("editing");
    this.dirty = false;
    api.onRoomChange = () => this.render();
    addEventListener("beforeunload", (e) => { if (this.dirty) e.preventDefault(); });
    this.render();
  }

  get room() { return this.api.currentRoom; }

  changed({ doors = false, bounds = false } = {}) {
    this.dirty = true;
    this.saveBtn?.classList.add("active");
    if (doors) this.api.buildDoors();
    if (bounds) this.updateHelper();
  }

  // ---------- Transformarea modelului ----------
  setTransform(key, value, index) {
    const t = (this.room.transform ??= { position: [0, 0, 0], rotationY: 0, scale: 1, flipX: true });
    if (index !== undefined) (t[key] ??= [0, 0, 0])[index] = value;
    else t[key] = value;
    this.api.applyTransform(this.api.meshes.get(this.room.id), t);
    this.api.minimap?.boxCache.delete(this.room.id);
    this.changed();
  }

  // ---------- Bounds ----------
  updateHelper() {
    const b = this.room?.bounds;
    this.helper.visible = !!b;
    if (b) this.boundsBox.min.fromArray(b.min), this.boundsBox.max.fromArray(b.max);
  }

  boundsFromModel() {
    const box = this.api.splatWorldBox(this.api.meshes.get(this.room.id));
    if (!box) return;
    // Centrele splat-urilor includ și „zgomot" în afara camerei: strângem 5% pe fiecare latură.
    const size = box.getSize(new this.api.THREE.Vector3()).multiplyScalar(0.05);
    this.room.bounds = { min: vec(box.min.clone().add(size)), max: vec(box.max.clone().sub(size)) };
    this.changed({ bounds: true });
    this.render();
  }

  // ---------- Puncte de vedere, uși, start ----------
  addViewpoint(name) {
    const { camera, THREE } = this.api;
    const look = camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(2));
    const vps = (this.room.viewpoints ??= []);
    name ||= `Punct ${vps.length + 1}`;
    const existing = vps.find((v) => v.name === name);
    const vp = { name, pos: vec(camera.position), look: vec(look) };
    if (existing) Object.assign(existing, vp); else vps.push(vp);
    this.api.refreshViewpoints();
    this.changed();
    this.render();
  }

  addDoor(to) {
    const { camera, THREE } = this.api;
    // Ușa se pune la 1 m în fața vizitatorului, la 1 m înălțime față de podea.
    const dir = camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
    const p = camera.position.clone().add(dir);
    p.y = (this.room.bounds?.min[1] ?? 0) + 1;
    (this.room.doors ??= []).push({ to, pos: vec(p) });
    this.changed({ doors: true });
    this.render();
  }

  remove(list, item, opts) {
    list.splice(list.indexOf(item), 1);
    this.api.refreshViewpoints();
    this.changed(opts);
    this.render();
  }

  // ---------- Salvare ----------
  async save() {
    const text = JSON.stringify(this.api.tour, null, 4);
    try {
      const res = await fetch(this.api.tourUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: text });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      this.dirty = false;
      this.saveBtn.classList.remove("active");
      this.flash("Salvat în tour.json");
    } catch (e) {
      // Server fără POST (ex. python -m http.server): descărcăm fișierul.
      const a = el("a", { href: URL.createObjectURL(new Blob([text], { type: "application/json" })), download: "tour.json" });
      a.click();
      URL.revokeObjectURL(a.href);
      this.flash(`Serverul nu salvează (${e.message}); am descărcat tour.json — copiază-l în web/tour/.`);
    }
  }

  flash(text) {
    this.msg.textContent = text;
    clearTimeout(this.msgTimer);
    this.msgTimer = setTimeout(() => (this.msg.textContent = ""), 5000);
  }

  // ---------- Panoul ----------
  render() {
    const room = this.room;
    if (!room) return;
    const tour = this.api.tour;
    const t = room.transform ?? {};
    const pos = t.position ?? [0, 0, 0];
    this.updateHelper();

    const vpName = el("input", { type: "text", placeholder: "Nume punct de vedere" });
    const doorTo = el("select", {}, ...tour.rooms.filter((r) => r !== room).map((r) => el("option", { value: r.id }, r.name)));

    const boundsRows = room.bounds
      ? ["min", "max"].map((k) => el("div", { className: "row" }, el("span", {}, k),
          ...[0, 1, 2].map((i) => num(room.bounds[k][i], 0.05, (v) => { room.bounds[k][i] = v; this.changed({ bounds: true }); }))))
      : [el("p", { className: "muted" }, "Fără bounds: vizitatorul nu are coliziuni în această cameră.")];

    this.saveBtn = el("button", { className: this.dirty ? "active" : "", onclick: () => this.save() }, "Salvează");
    this.msg = el("p", { className: "msg" });

    this.panel.replaceChildren(
      el("h2", {}, `Editor — ${room.name}`),

      el("h3", {}, "Transformare"),
      el("div", { className: "row" }, el("span", {}, "poz."),
        ...[0, 1, 2].map((i) => num(pos[i], 0.05, (v) => this.setTransform("position", v, i)))),
      el("div", { className: "row" },
        el("span", {}, "rot. Y°"), num(t.rotationY ?? 0, 1, (v) => this.setTransform("rotationY", v)),
        el("span", {}, "scară"), num(t.scale ?? 1, 0.01, (v) => this.setTransform("scale", v))),
      el("label", { className: "row" },
        el("input", { type: "checkbox", checked: t.flipX ?? true, onchange: (e) => this.setTransform("flipX", e.target.checked) }),
        "flipX (model COLMAP, Y în jos)"),

      el("h3", {}, "Bounds (lume, m)"),
      ...boundsRows,
      el("div", { className: "row" },
        el("button", { onclick: () => this.boundsFromModel() }, "Din model"),
        room.bounds && el("button", { onclick: () => { delete room.bounds; this.changed({ bounds: true }); this.render(); } }, "Șterge")),

      el("h3", {}, "Puncte de vedere"),
      el("ul", {}, ...(room.viewpoints ?? []).map((vp) => el("li", {},
        el("a", { href: "#", onclick: (e) => { e.preventDefault(); this.api.goTo(vp); } }, vp.name),
        el("button", { title: "Punct de start al turului",
          className: tour.start?.room === room.id && tour.start?.viewpoint === vp.name ? "active" : "",
          onclick: () => { tour.start = { room: room.id, viewpoint: vp.name }; this.changed(); this.render(); } }, "★"),
        el("button", { title: "Șterge", onclick: () => this.remove(room.viewpoints, vp) }, "✕")))),
      el("div", { className: "row" }, vpName,
        el("button", { onclick: () => this.addViewpoint(vpName.value.trim()) }, "Adaugă din cameră")),

      el("h3", {}, "Uși"),
      el("ul", {}, ...(room.doors ?? []).map((d) => el("li", {},
        `→ ${tour.rooms.find((r) => r.id === d.to)?.name ?? d.to} [${d.pos.join(", ")}]`,
        el("button", { title: "Șterge", onclick: () => this.remove(room.doors, d, { doors: true }) }, "✕")))),
      tour.rooms.length > 1
        ? el("div", { className: "row" }, doorTo, el("button", { onclick: () => this.addDoor(doorTo.value) }, "Ușă în față"))
        : el("p", { className: "muted" }, "Ușile apar după ce turul are cel puțin două camere."),

      el("h3", {}, "Apartament"),
      el("input", { type: "text", value: tour.apartment, oninput: (e) => {
        tour.apartment = e.target.value;
        document.getElementById("title").textContent = tour.apartment;
        this.changed();
      } }),

      el("div", { className: "row save" }, this.saveBtn),
      this.msg,
    );
  }
}
