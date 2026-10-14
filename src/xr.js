// Modul VR (WebXR): căști (Quest, Pico, Vision Pro) sau telefon cu suport immersive-vr.
// Vizitatorul stă într-un „rig" (grup) pe care îl mută controlerele; capul se mișcă liber în rig, urmărit de cască.
// Stick stânga: mers (cu coliziuni); stick dreapta: rotire în trepte de 30°;
// trăgaciul: teleportare pe podea sau trecere prin ușă (raza controlerului, pe telefon privirea + atingere).
import * as THREE from "three";

const SNAP_TURN = Math.PI / 6;
const TELEPORT_RANGE = 8;          // m
const DOOR_SCALE = [0.6, 0.225];   // m, etichetele ușilor în VR (pe ecran au mărime constantă)

export class XrMode {
  /** Suportul se verifică o singură dată; butonul VR apare doar dacă e true. */
  static async supported() {
    try { return !!navigator.xr && await navigator.xr.isSessionSupported("immersive-vr"); }
    catch { return false; }
  }

  /**
   * @param o.floorY () => înălțimea podelei camerei curente
   * @param o.canStand (x, z) => true dacă vizitatorul poate sta acolo (coliziunile din viewer)
   * @param o.onDoor (sprite) => trecere prin ușă; o.onMove (x, z) => capul s-a mutat
   */
  constructor({ renderer, scene, camera, doors, speed, floorY, canStand, onDoor, onMove, onEnter, onExit, scale = 0.5 }) {
    Object.assign(this, { renderer, camera, doors, speed, floorY, canStand, onDoor, onMove, onEnter, onExit });
    this.scale = scale;
    this.rig = new THREE.Group();
    scene.add(this.rig);
    this.raycaster = new THREE.Raycaster();
    this.turnArmed = true;
    this.session = null;

    // Controlerele: rază + țintă (ușă sau punct pe podea), apăsarea trăgaciului acționează ținta.
    this.pointers = [0, 1].map((i) => {
      const ctrl = renderer.xr.getController(i);
      const ray = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthTest: false }));
      ray.renderOrder = 20;
      ctrl.add(ray);
      const p = { ctrl, ray, target: null, handedness: "", mode: "" };
      ctrl.addEventListener("connected", (e) => {
        p.handedness = e.data.handedness;
        p.mode = e.data.targetRayMode;
        ray.visible = p.mode !== "gaze";
      });
      ctrl.addEventListener("select", () => this.activate(p));
      this.rig.add(ctrl);
      return p;
    });

    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.16, 0.22, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x4fa3ff, transparent: true, opacity: 0.85, depthTest: false }));
    this.marker.renderOrder = 20;
    this.marker.visible = false;
    scene.add(this.marker);

    renderer.xr.addEventListener("sessionstart", () => this.attach());
    renderer.xr.addEventListener("sessionend", () => this.detach());
  }

  get presenting() { return this.renderer.xr.isPresenting; }

  async toggle() {
    if (this.session) { await this.session.end(); return; }
    const xr = this.renderer.xr;
    xr.enabled = true;
    xr.setReferenceSpaceType("local-floor");
    // Splat-urile sunt scumpe: rezoluție redusă (Spark folosește tot 0,5). ?xrscale=1 pentru claritate maximă.
    xr.setFramebufferScaleFactor(this.scale);
    const session = await navigator.xr.requestSession("immersive-vr", { optionalFeatures: ["local-floor", "hand-tracking"] });
    session.addEventListener("end", () => { this.session = null; });
    this.session = session;
    await xr.setSession(session);
  }

  // Intrare: rig-ul pe podea, sub cameră, cu aceeași orientare; camera devine capul din rig.
  attach() {
    this.onEnter?.();
    const cam = this.camera;
    this.saved = { fov: cam.fov };
    const yaw = new THREE.Euler().setFromQuaternion(cam.quaternion, "YXZ").y;
    this.rig.position.set(cam.position.x, this.floorY(), cam.position.z);
    this.rig.rotation.set(0, yaw, 0);
    this.rig.add(cam);
    cam.position.set(0, 1.6, 0);
    cam.quaternion.identity();
    this.setDoorScale(true);
  }

  // Ieșire: camera rămâne unde era capul, cu privirea orizontală, și proiecția de dinainte.
  detach() {
    const cam = this.camera;
    const pos = cam.getWorldPosition(new THREE.Vector3());
    const yaw = new THREE.Euler().setFromQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()), "YXZ").y;
    this.rig.remove(cam);
    cam.position.copy(pos);
    cam.rotation.set(0, yaw, 0);
    cam.fov = this.saved?.fov ?? cam.fov;
    cam.zoom = 1;
    cam.aspect = innerWidth / innerHeight;
    cam.updateProjectionMatrix();
    this.marker.visible = false;
    this.setDoorScale(false);
    this.onExit?.();
  }

  // Etichetele ușilor au mărime constantă pe ecran; în VR devin panouri de 60 cm în scenă.
  setDoorScale(vr) {
    for (const s of this.doors.children) {
      s.material.sizeAttenuation = vr;
      s.material.needsUpdate = true;
      if (vr) { s.userData.screenScale = s.scale.clone(); s.scale.set(...DOOR_SCALE, 1); }
      else if (s.userData.screenScale) s.scale.copy(s.userData.screenScale);
    }
  }

  head() { return this.camera.getWorldPosition(new THREE.Vector3()); }

  headYaw() { return new THREE.Euler().setFromQuaternion(this.camera.getWorldQuaternion(new THREE.Quaternion()), "YXZ").y; }

  /** Mută rig-ul astfel încât capul să ajungă deasupra lui (x, z); opțional privind spre yaw (radiani). */
  teleport(x, z, yaw) {
    if (yaw !== undefined) this.rig.rotation.y += yaw - this.headYaw();
    this.rig.updateMatrixWorld(true);
    const h = this.head();
    this.rig.position.x += x - h.x;
    this.rig.position.z += z - h.z;
    this.rig.position.y = this.floorY();
    this.onMove?.(x, z);
  }

  /** Rotire în jurul capului (nu al centrului rig-ului): vizitatorul rămâne pe loc. */
  turn(angle) {
    const before = this.head();
    this.rig.rotation.y += angle;
    this.rig.updateMatrixWorld(true);
    const after = this.head();
    this.rig.position.x += before.x - after.x;
    this.rig.position.z += before.z - after.z;
  }

  /** Deplasare (dx, dz) în lume, cu alunecare de-a lungul pereților ca în modul mers. */
  move(dx, dz) {
    const h = this.head();
    let [mx, mz] = [dx, dz];
    if (!this.canStand(h.x + dx, h.z + dz)) {
      if (this.canStand(h.x, h.z + dz)) mx = 0;
      else if (this.canStand(h.x + dx, h.z)) mz = 0;
      else return;
    }
    this.rig.position.x += mx;
    this.rig.position.z += mz;
    this.onMove?.(h.x + mx, h.z + mz);
  }

  update(dt) {
    this.rig.position.y = this.floorY();
    for (const src of this.session?.inputSources ?? []) {
      const a = src.gamepad?.axes;
      if (!a || a.length < 2) continue;
      // xr-standard: stick-ul e pe axele 2–3 (0–1 la controlerele fără touchpad).
      const [x, y] = a.length >= 4 ? [a[2], a[3]] : [a[0], a[1]];
      if (src.handedness === "right") {
        if (this.turnArmed && Math.abs(x) > 0.6) { this.turn(-Math.sign(x) * SNAP_TURN); this.turnArmed = false; }
        else if (Math.abs(x) < 0.3) this.turnArmed = true;
      } else if (Math.hypot(x, y) > 0.15) {
        const yaw = this.headYaw();
        const f = -y * this.speed * dt, r = x * this.speed * dt;
        this.move(-Math.sin(yaw) * f + Math.cos(yaw) * r, -Math.cos(yaw) * f - Math.sin(yaw) * r);
      }
    }
    this.updatePointers();
  }

  // Ținta fiecărui controler: o ușă (prioritar) sau punctul de pe podea unde se poate sta.
  updatePointers() {
    this.marker.visible = false;
    this.raycaster.camera = this.renderer.xr.getCamera();   // necesar pentru raycast pe sprite-uri
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.floorY());
    for (const s of this.doors.children) s.material.opacity = 1;
    this.doors.updateMatrixWorld(true);
    for (const p of this.pointers) {
      p.target = null;
      if (!p.mode) continue;
      p.ctrl.updateMatrixWorld(true);
      this.raycaster.ray.origin.setFromMatrixPosition(p.ctrl.matrixWorld);
      this.raycaster.ray.direction.set(0, 0, -1).transformDirection(p.ctrl.matrixWorld);
      let len = 3;
      const door = this.raycaster.intersectObjects(this.doors.children)[0];
      if (door) {
        p.target = { door: door.object };
        len = door.distance;
      } else {
        const hit = this.raycaster.ray.intersectPlane(plane, new THREE.Vector3());
        const dist = hit && hit.distanceTo(this.raycaster.ray.origin);
        if (hit && dist < TELEPORT_RANGE && this.canStand(hit.x, hit.z)) {
          p.target = { floor: hit };
          len = dist;
          this.marker.position.copy(hit);
          this.marker.visible = true;
        }
      }
      p.ray.scale.z = len;
      p.ray.material.color.set(p.target ? 0x4fa3ff : 0xffffff);
      if (door) door.object.material.opacity = 0.7;
    }
  }

  activate(p) {
    if (p.target?.door) this.onDoor(p.target.door);
    else if (p.target?.floor) this.teleport(p.target.floor.x, p.target.floor.z);
  }
}
