// Controale pe mobil în modul mers (Faza 5, pasul 2): joystick virtual în jumătatea stângă,
// rotirea privirii prin glisare în jumătatea dreaptă. În modul machetă răspunde OrbitControls.

export const isTouch = matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;

const RADIUS = 50;          // px, cursa maximă a joystick-ului
const LOOK_SPEED = 0.005;   // rad/px

export class TouchControls {
  constructor(el, camera) {
    this.el = el;
    this.camera = camera;
    this.enabled = false;
    this.move = { x: 0, y: 0 };    // dreapta / înainte, în [-1, 1]
    this.stick = null;              // { id, x0, y0 }
    this.look = null;               // { id, x, y }

    this.base = document.createElement("div");
    this.base.id = "joystick";
    this.knob = document.createElement("div");
    this.base.appendChild(this.knob);
    document.body.appendChild(this.base);

    el.addEventListener("pointerdown", (e) => this.down(e));
    el.addEventListener("pointermove", (e) => this.moveTo(e));
    el.addEventListener("pointerup", (e) => this.up(e));
    el.addEventListener("pointercancel", (e) => this.up(e));
  }

  setEnabled(on) {
    this.enabled = on;
    this.stick = this.look = null;
    this.move.x = this.move.y = 0;
    this.base.style.display = "none";
  }

  down(e) {
    if (!this.enabled || e.pointerType === "mouse") return;
    if (e.clientX < innerWidth / 2 && !this.stick) {
      this.stick = { id: e.pointerId, x0: e.clientX, y0: e.clientY };
      Object.assign(this.base.style, { display: "block", left: `${e.clientX}px`, top: `${e.clientY}px` });
      this.knob.style.transform = "translate(-50%, -50%)";
    } else if (!this.look) {
      this.look = { id: e.pointerId, x: e.clientX, y: e.clientY };
    }
  }

  moveTo(e) {
    if (this.stick?.id === e.pointerId) {
      let dx = e.clientX - this.stick.x0, dy = e.clientY - this.stick.y0;
      const len = Math.hypot(dx, dy);
      if (len > RADIUS) { dx *= RADIUS / len; dy *= RADIUS / len; }
      this.move.x = dx / RADIUS;
      this.move.y = -dy / RADIUS;
      this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    } else if (this.look?.id === e.pointerId) {
      const r = this.camera.rotation;   // ordinea YXZ: yaw, apoi pitch
      r.y -= (e.clientX - this.look.x) * LOOK_SPEED;
      r.x = Math.max(-1.4, Math.min(1.4, r.x - (e.clientY - this.look.y) * LOOK_SPEED));
      r.z = 0;
      this.look.x = e.clientX;
      this.look.y = e.clientY;
    }
  }

  up(e) {
    if (this.stick?.id === e.pointerId) {
      this.stick = null;
      this.move.x = this.move.y = 0;
      this.base.style.display = "none";
    }
    if (this.look?.id === e.pointerId) this.look = null;
  }
}
