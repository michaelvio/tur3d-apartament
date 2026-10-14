// Viewer-ul turului 3D: three.js + Spark (Gaussian Splatting).
// Faza 5: încărcare tour.json, machetă/mers, coliziuni pe bounds, puncte de vedere cu tranziții,
// minimap, uși, controale pe mobil, panorame 360° (varianta A), mod VR (WebXR). Cu ?edit=1 se încarcă și editorul de aliniere (Faza 4).
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { SparkRenderer, SplatMesh, isOculus } from "@sparkjsdev/spark";
import { buildRoomBar, buildViewpointBar, setStatus, showFloorplan } from "./ui.js";
import { Minimap, splatWorldBox } from "./minimap.js";
import { TouchControls, isTouch } from "./touch.js";
import { XrMode } from "./xr.js";
import { PanoView } from "./pano.js";

const EYE_HEIGHT = 1.6;
const WALK_SPEED = 1.4;      // m/s
const WALL_MARGIN = 0.25;    // m, distanța minimă față de marginea camerei
const DOOR_RADIUS = 0.6;     // m, lângă o ușă marginea nu se aplică: așa treci în camera vecină
const TRANSITION_MS = 1200;

const params = new URLSearchParams(location.search);
// Pe mobil (Faza 5, pasul 8): rezoluție limitată, LoD (Spark ține ~1 mil. splat-uri pe Android)
// și doar camerele vecine încărcate în fundal. ?lod=0 / ?lod=1 forțează LoD-ul. Căștile Quest: tot cu LoD.
const LOD = params.has("lod") ? params.get("lod") === "1" : isTouch || isOculus();
// Modelele .rad (LoD precalculat de build-lod) se citesc pe bucăți, după nevoie (cereri HTTP Range).
// În aplicația Android serverul de assets nu suportă Range: acolo fișierul se încarcă întreg.
const PAGED = params.has("paged") ? params.get("paged") === "1" : location.hostname !== "appassets.androidplatform.net";

// ---------- Scena ----------
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouch ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById("app").appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101114);
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.02, 200);
camera.rotation.order = "YXZ";
scene.add(new SparkRenderer({ renderer }));

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
const walk = new PointerLockControls(camera, document.body);
const touch = isTouch ? new TouchControls(renderer.domElement, camera) : null;
let mode = "orbit";      // orbit | walk | pano

// ---------- Turul ----------
const tourUrl = params.get("tour") ?? "tour/tour.json";
const tourBase = tourUrl.substring(0, tourUrl.lastIndexOf("/") + 1);
const meshes = new Map();   // id cameră → SplatMesh
const doorGroup = new THREE.Group();
scene.add(doorGroup);
const markerGroup = new THREE.Group();   // celelalte puncte cu panoramă din cameră (modul Panoramă)
scene.add(markerGroup);
const pano = new PanoView(scene);
let tour;
let currentRoom;
let currentVp = null;
let minimap;

async function main() {
  try {
    // no-cache: browserul verifică la server dacă turul s-a schimbat (GitHub Pages ține fișierele 10 min în cache;
    // un tour.json vechi ar cere modele care nu mai există).
    tour = await (await fetch(tourUrl, { cache: "no-cache" })).json();
  } catch (e) {
    setStatus(`Nu pot citi ${tourUrl}. Rulează: tur3d manifest, apoi deschide pagina printr-un server http.`);
    throw e;
  }
  document.getElementById("title").textContent = tour.apartment;
  buildRoomBar(tour.rooms, (room) => enterRoom(room.id));
  minimap = new Minimap(document.getElementById("minimap"), {
    tour, camera, meshes,
    getCurrentRoom: () => currentRoom,
    onSelectRoom: (id) => enterRoom(id),
  });
  if (tour.floorplan) {
    const url = tourBase + tour.floorplan;
    minimap.loadFloorplan(url);
    const plan = document.getElementById("plan");
    plan.hidden = false;
    plan.addEventListener("click", () => showFloorplan(url, tour.apartment));
  }
  buildDoors();

  const start = tour.start ?? { room: tour.rooms[0].id };
  await enterRoom(start.room, start.viewpoint, true);
  // Pe desktop toate camerele se încarcă în fundal, după prima; pe mobil doar vecinele (setActiveRoom).
  if (!isTouch) for (const r of tour.rooms) loadRoom(r);

  if (params.get("edit") === "1") {
    const { Editor } = await import("./editor.js");
    new Editor(api);
  }
}

// COLMAP/3DGS: Y în jos, Z înainte → three.js: rotație 180° în jurul lui X (flipX).
// level (tur3d align): nivelarea, aplicată întâi, în coordonatele modelului.
function applyTransform(mesh, t = {}) {
  mesh.quaternion.identity();
  if (t.level) mesh.quaternion.fromArray(t.level);
  if (t.flipX ?? true) mesh.quaternion.premultiply(new THREE.Quaternion(1, 0, 0, 0));
  mesh.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(t.rotationY ?? 0));
  mesh.position.fromArray(t.position ?? [0, 0, 0]);
  mesh.scale.setScalar(t.scale ?? 1);
  mesh.updateMatrixWorld(true);
}

function loadRoom(room) {
  if (!room.splat) return null;   // cameră doar cu panorame
  if (meshes.has(room.id)) return meshes.get(room.id);
  const url = tourBase + room.splat;
  const mesh = new SplatMesh(room.splat.endsWith(".rad") ? { url, paged: PAGED } : { url, lod: LOD });
  applyTransform(mesh, room.transform);
  mesh.visible = !(mode === "pano" && pano.sphere.material.opacity === 1);
  scene.add(mesh);
  meshes.set(room.id, mesh);
  return mesh;
}

// Camera devine activă (butoane, puncte de vedere) fără să mutăm vizitatorul.
function setActiveRoom(room) {
  if (currentRoom === room) return;
  currentRoom = room;
  document.querySelectorAll("#rooms button").forEach((b) => b.classList.toggle("active", b.dataset.id === room.id));
  buildViewpointBar(room.viewpoints ?? [], (vp) => goTo(vp));
  // Camerele în care duc ușile se încarcă dinainte, ca trecerea să fie fără așteptare.
  for (const d of room.doors ?? []) {
    const next = tour.rooms.find((r) => r.id === d.to);
    if (next) loadRoom(next);
  }
  api.onRoomChange?.(room);
}

async function enterRoom(id, viewpointName, instant = false) {
  const room = tour.rooms.find((r) => r.id === id);
  if (!room) return;
  const mesh = loadRoom(room);
  if (mesh) {
    setStatus(`Se încarcă ${room.name}…`);
    await mesh.initialized;
    setStatus("");
  }
  currentRoom = null;
  setActiveRoom(room);
  const vps = room.viewpoints ?? [];
  // Camera fără model se vizitează doar prin panorame; în modul Panoramă rămânem în panorame cât se poate.
  const wantPano = !mesh || mode === "pano";
  const vp = vps.find((v) => v.name === viewpointName)
    ?? (wantPano ? vps.find((v) => v.pano) : null) ?? vps[0];
  if (!mesh && !vp?.pano) { setStatus(`${room.name}: nu are nici model 3D, nici panoramă.`); return; }
  if (vp) goTo(vp, instant);
  else { exitPano(); frameMesh(mesh); }
}

// Fără puncte de vedere: încadrăm modelul automat.
function frameMesh(mesh) {
  const box = splatWorldBox(mesh);
  if (!box) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  if (xr.presenting) { xr.teleport(center.x, center.z); return; }
  camera.position.copy(center).add(new THREE.Vector3(0, size * 0.3, size * 0.8));
  orbit.target.copy(center);
  camera.lookAt(center);
}

// ---------- Uși (hotspot-uri) ----------
function doorSprite(label, icon = "→") {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 96;
  const g = c.getContext("2d");
  g.fillStyle = "rgba(20,22,27,0.85)";
  g.beginPath(); g.roundRect(4, 4, 248, 88, 44); g.fill();
  g.strokeStyle = "#4fa3ff"; g.lineWidth = 6; g.stroke();
  g.fillStyle = "#eef0f3"; g.font = "600 36px system-ui, sans-serif";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(`${icon} ${label}`, 128, 50, 220);
  // Mărime constantă pe ecran, oricât de aproape ar fi ușa.
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, sizeAttenuation: false }));
  s.scale.set(0.16, 0.06, 1);
  s.renderOrder = 10;
  return s;
}

function buildDoors() {
  doorGroup.clear();
  for (const room of tour.rooms) {
    for (const d of room.doors ?? []) {
      const target = tour.rooms.find((r) => r.id === d.to);
      if (!target) continue;
      const s = doorSprite(target.name);
      s.position.fromArray(d.pos);
      s.userData = { from: room.id, to: target.id };
      doorGroup.add(s);
    }
  }
}

const raycaster = new THREE.Raycaster();
function doorAt(ndc) {
  raycaster.setFromCamera(ndc, camera);
  return raycaster.intersectObjects([...doorGroup.children, ...markerGroup.children])[0]?.object;
}

// Click (nu tragere) pe o ușă → camera vecină. În modul mers, ținta e centrul ecranului.
let downAt = null;
renderer.domElement.addEventListener("pointerdown", (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener("pointerup", (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
  const ndc = walk.isLocked ? new THREE.Vector2(0, 0)
    : new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  const door = doorAt(ndc);
  if (door?.userData.vp) goTo(door.userData.vp);
  else if (door) enterRoom(door.userData.to);
  else if (mode === "walk" && !isTouch && !walk.isLocked) walk.lock();
});

// ---------- Coliziuni: vizitatorul rămâne în interiorul camerelor (bounds) ----------
const hasBounds = () => tour?.rooms.some((r) => r.bounds);

function roomAt(x, z, margin = 0) {
  return tour.rooms.find((r) => r.bounds
    && x >= r.bounds.min[0] + margin && x <= r.bounds.max[0] - margin
    && z >= r.bounds.min[2] + margin && z <= r.bounds.max[2] - margin);
}

const nearDoor = (x, z) => tour.rooms.some((r) => (r.doors ?? []).some(
  (d) => Math.hypot(d.pos[0] - x, d.pos[2] - z) < DOOR_RADIUS));

const walkable = (x, z) => !!(roomAt(x, z, WALL_MARGIN) || (nearDoor(x, z) && roomAt(x, z)));

// Încearcă mutarea completă, apoi pe fiecare axă (alunecare de-a lungul pereților).
function constrainMove(prev) {
  if (!hasBounds()) return;
  const p = camera.position;
  if (walkable(p.x, p.z)) return;
  if (walkable(p.x, prev.z)) { p.z = prev.z; return; }
  if (walkable(prev.x, p.z)) { p.x = prev.x; return; }
  p.x = prev.x; p.z = prev.z;
}

const floorY = (room) => room?.bounds?.min[1] ?? 0;

// ---------- Tranziții între puncte de vedere ----------
let transition = null;

function goTo(vp, instant = false) {
  currentVp = vp;
  updatePanoButton();
  if (vp.pano && (mode === "pano" || !currentRoom?.splat) && !xr.presenting) { showPano(vp); return; }
  exitPano();
  // În VR capul e urmărit de cască: mutăm vizitatorul acolo, privind spre punctul ales.
  if (xr.presenting) {
    xr.teleport(vp.pos[0], vp.pos[2], Math.atan2(-(vp.look[0] - vp.pos[0]), -(vp.look[2] - vp.pos[2])));
    return;
  }
  const toPos = new THREE.Vector3().fromArray(vp.pos);
  const toLook = new THREE.Vector3().fromArray(vp.look);
  const toQuat = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().lookAt(toPos, toLook, new THREE.Vector3(0, 1, 0)));
  if (instant) {
    camera.position.copy(toPos);
    camera.quaternion.copy(toQuat);
    orbit.target.copy(toLook);
    return;
  }
  transition = {
    t0: performance.now(),
    fromPos: camera.position.clone(), toPos,
    fromQuat: camera.quaternion.clone(), toQuat,
    fromTarget: orbit.target.clone(), toTarget: toLook,
  };
}

const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

function updateTransition(now) {
  if (!transition) return false;
  const k = Math.min(1, (now - transition.t0) / TRANSITION_MS);
  const e = easeInOut(k);
  camera.position.lerpVectors(transition.fromPos, transition.toPos, e);
  camera.quaternion.slerpQuaternions(transition.fromQuat, transition.toQuat, e);
  orbit.target.lerpVectors(transition.fromTarget, transition.toTarget, e);
  if (k >= 1) transition = null;
  return true;
}

// ---------- Moduri: machetă (orbită) / mers (WASD sau joystick) ----------
const modeBtn = document.getElementById("mode");
modeBtn.addEventListener("click", () => setMode(mode === "pano" ? panoReturn : mode === "orbit" ? "walk" : "orbit"));
document.getElementById("hint").innerHTML = isTouch
  ? "<b>Foto 360°:</b> trage de imagine, ciupește pentru zoom.<br><b>Machetă:</b> un deget rotește, două fac zoom.<br><b>Mers:</b> joystick în stânga, glisare în dreapta pentru privire."
  : "<b>Foto 360°:</b> trage de imagine, rotița pentru zoom; ● duce la alt punct fotografiat.<br><b>Machetă:</b> trage cu mouse-ul pentru rotire, rotița pentru zoom.<br><b>Mers:</b> click în scenă, apoi W A S D + mouse; Esc ca să ieși. Click pe o ușă te duce în camera vecină.";

function setMode(m) {
  if (mode === "pano") { exitPano(m); return; }
  mode = m;
  orbit.enabled = m === "orbit";
  touch?.setEnabled(m === "walk");
  modeBtn.textContent = m === "orbit" ? "Mod: machetă" : "Mod: mers";
  if (m === "walk") {
    transition = null;
    camera.position.y = floorY(currentRoom) + EYE_HEIGHT;
    // Dacă vizitatorul e în afara camerelor, îl ducem în centrul camerei curente.
    if (hasBounds() && !roomAt(camera.position.x, camera.position.z) && currentRoom?.bounds) {
      const b = currentRoom.bounds;
      camera.position.x = (b.min[0] + b.max[0]) / 2;
      camera.position.z = (b.min[2] + b.max[2]) / 2;
    }
    // Privire orizontală.
    camera.rotation.set(0, camera.rotation.y, 0);
  } else {
    if (walk.isLocked) walk.unlock();
    // Ținta orbitei: un punct la 2 m în fața camerei.
    orbit.target.copy(camera.position).add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(2));
  }
}

const keys = new Set();
const typing = (e) => e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
addEventListener("keydown", (e) => { if (!typing(e)) keys.add(e.code); });
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("blur", () => keys.clear());

const _prev = new THREE.Vector3();
function updateWalk(dt) {
  if (mode !== "walk") return;
  let f = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
  let r = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
  if (touch) { f += touch.move.y; r += touch.move.x; }
  if (!f && !r) return;
  _prev.copy(camera.position);
  const speed = WALK_SPEED * (keys.has("ShiftLeft") ? 2 : 1) * dt;
  walk.moveForward(f * speed);
  walk.moveRight(r * speed);
  constrainMove(_prev);
  const here = roomAt(camera.position.x, camera.position.z);
  if (here) setActiveRoom(here);
}

// ---------- Modul Panoramă (Faza 5, pasul 7, varianta A) ----------
const panoBtn = document.getElementById("pano");
let panoReturn = "orbit";   // modul în care revenim la ieșirea din panoramă

function updatePanoButton() {
  const panoOnly = !!currentRoom && !currentRoom.splat;
  const on = mode === "pano";
  panoBtn.hidden = !currentVp?.pano || (panoOnly && on);
  panoBtn.classList.toggle("active", on);
  panoBtn.textContent = on ? "Ieși din 360°" : "Foto 360°";
  modeBtn.hidden = panoOnly && on;
}
panoBtn.addEventListener("click", () => {
  if (mode === "pano") { exitPano(); if (currentVp) goTo(currentVp); }
  else if (currentVp?.pano) showPano(currentVp);
});

const showSplats = (v) => { for (const m of meshes.values()) m.visible = v; };

function showPano(vp) {
  if (mode !== "pano") {
    panoReturn = mode;
    if (walk.isLocked) walk.unlock();
    touch?.setEnabled(false);
    mode = "pano";
  }
  transition = null;
  currentVp = vp;
  // Vizitatorul stă în punctul fotografiat și doar se rotește: orbită în jurul unui punct la 1 cm în față,
  // cu sensul inversat (tragi de imagine, ca în Street View).
  const pos = new THREE.Vector3().fromArray(vp.pos);
  const dir = new THREE.Vector3().fromArray(vp.look).sub(pos).normalize();
  camera.position.copy(pos);
  camera.lookAt(pos.clone().add(dir));
  orbit.target.copy(pos).addScaledVector(dir, 0.01);
  Object.assign(orbit, { enabled: true, enableZoom: false, enablePan: false, rotateSpeed: -0.5 });
  modeBtn.textContent = "Mod: foto 360°";
  pano.show(vp, tourBase).then(() => { if (pano.vp === vp) showSplats(false); })
    .catch(() => { setStatus(`Nu pot încărca ${vp.pano}`); exitPano(); });
  // Celelalte puncte cu panoramă din cameră: marcaje aproape de podea + preîncărcare.
  const others = (currentRoom?.viewpoints ?? []).filter((v) => v.pano && v !== vp);
  markerGroup.clear();
  for (const o of others) {
    const s = doorSprite(o.name, "●");
    s.position.fromArray(o.pos);
    s.position.y = floorY(currentRoom) + 0.3;
    s.userData = { vp: o };
    markerGroup.add(s);
  }
  pano.preload(others.map((o) => tourBase + o.pano));
  updatePanoButton();
}

function exitPano(next = panoReturn) {
  if (mode !== "pano") return;
  showSplats(true);
  pano.hide();
  markerGroup.clear();
  Object.assign(orbit, { enableZoom: true, enablePan: true, rotateSpeed: 1 });
  camera.fov = 70;
  camera.updateProjectionMatrix();
  mode = null;
  setMode(next);
  updatePanoButton();
}

// Zoom în panoramă: unghiul de vedere (rotița; pe telefon ciupire cu două degete).
const setFov = (fov) => {
  camera.fov = THREE.MathUtils.clamp(fov, 30, 90);
  camera.updateProjectionMatrix();
};
renderer.domElement.addEventListener("wheel", (e) => {
  if (mode === "pano") setFov(camera.fov + e.deltaY * 0.05);
}, { passive: true });

const fingers = new Map();   // pointerId → [x, y]
let pinch = null;            // { dist, fov } la începutul ciupirii
const spread = () => { const [a, b] = [...fingers.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]); };
renderer.domElement.addEventListener("pointerdown", (e) => {
  if (e.pointerType !== "touch") return;
  fingers.set(e.pointerId, [e.clientX, e.clientY]);
  if (fingers.size === 2) pinch = { dist: spread(), fov: camera.fov };
});
renderer.domElement.addEventListener("pointermove", (e) => {
  if (!fingers.has(e.pointerId)) return;
  fingers.set(e.pointerId, [e.clientX, e.clientY]);
  if (mode === "pano" && pinch && fingers.size === 2) setFov(pinch.fov * pinch.dist / Math.max(spread(), 1));
});
for (const type of ["pointerup", "pointercancel"]) {
  renderer.domElement.addEventListener(type, (e) => {
    fingers.delete(e.pointerId);
    if (fingers.size < 2) pinch = null;
  });
}

// ---------- Mod VR (Faza 5, pasul 9) ----------
const xr = new XrMode({
  renderer, scene, camera, doors: doorGroup, speed: WALK_SPEED,
  scale: Number(params.get("xrscale")) || 0.5,
  floorY: () => floorY(currentRoom),
  canStand: (x, z) => !hasBounds() || walkable(x, z),
  onDoor: (door) => enterRoom(door.userData.to),
  onMove: (x, z) => { const here = roomAt(x, z); if (here) setActiveRoom(here); },
  // Intrarea pornește din modul mers: vizitatorul e deja în cameră, la înălțimea ochilor.
  onEnter: () => { exitPano(); setMode("walk"); vrBtn.textContent = "Ieși din VR"; },
  onExit: () => { vrBtn.textContent = "VR"; },
});
const vrBtn = document.getElementById("vr");
vrBtn.addEventListener("click", () => xr.toggle().catch((e) => setStatus(`VR indisponibil: ${e.message}`)));
XrMode.supported().then((ok) => {
  vrBtn.hidden = !ok;
  if (ok) document.getElementById("hint").innerHTML += "<br><b>VR:</b> stick stânga mers, dreapta rotire; trăgaciul te teleportează sau deschide ușa.";
});

// ---------- Bucla de randare ----------
const clock = new THREE.Clock();
renderer.setAnimationLoop((now) => {
  const dt = Math.min(clock.getDelta(), 0.1);
  pano.update(now);
  if (xr.presenting) xr.update(dt);
  else if (!updateTransition(now)) {
    updateWalk(dt);
    if (mode === "orbit" || mode === "pano") orbit.update();
  }
  renderer.render(scene, camera);
  minimap?.draw();
});

addEventListener("resize", () => {
  if (xr.presenting) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Folosit de editor și pentru depanare din consolă: tur3d.camera.position etc.
const api = {
  THREE, scene, camera, orbit, meshes, tourUrl, xr,
  get tour() { return tour; },
  get currentRoom() { return currentRoom; },
  get minimap() { return minimap; },
  goTo, enterRoom, applyTransform, buildDoors, splatWorldBox, pano,
  refreshViewpoints: () => buildViewpointBar(currentRoom?.viewpoints ?? [], (vp) => goTo(vp)),
  onRoomChange: null,
};
window.tur3d = api;

main();
