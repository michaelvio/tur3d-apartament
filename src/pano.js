// Modul Panoramă (Faza 5, pasul 7, varianta A): fotografia 360° a unui punct de vedere, pe o sferă
// în jurul vizitatorului. Se privește doar prin rotire (tragere), zoom din rotiță / ciupire.
// Ușile și celelalte puncte cu panoramă rămân clicabile, deci turul merge și doar din fotografii.
import * as THREE from "three";

const RADIUS = 50;     // m, în interiorul planului îndepărtat al camerei (200 m)
const FADE_MS = 250;

export class PanoView {
  constructor(scene) {
    this.sphere = new THREE.Mesh(
      // Normale spre interior: privim sfera din centru.
      new THREE.SphereGeometry(RADIUS, 64, 32).scale(-1, 1, 1),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
    // Peste splat-uri (fără test de adâncime), sub etichetele ușilor: intrarea e o tranziție de la 3D la fotografie.
    this.sphere.renderOrder = 5;
    this.sphere.visible = false;
    scene.add(this.sphere);
    this.loader = new THREE.TextureLoader();
    this.cache = new Map();   // url → Promise<Texture>
    this.vp = null;
    this.wanted = null;   // ultima cerere (show/hide): o încărcare depășită nu mai afișează nimic
    this.fade = null;
  }

  get active() { return this.sphere.visible; }

  texture(url) {
    if (!this.cache.has(url)) {
      this.cache.set(url, this.loader.loadAsync(url).then((t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        return t;
      }));
    }
    return this.cache.get(url);
  }

  /** Centrul imaginii echirectangulare cade pe -Z (înainte) la panoYaw = 0; panoYaw rotește în sens trigonometric. */
  setYaw(deg) {
    this.sphere.rotation.y = -Math.PI / 2 + THREE.MathUtils.degToRad(deg);
  }

  /** Afișează panorama punctului de vedere; o trecere scurtă prin negru între două panorame. */
  async show(vp, base) {
    const url = base + vp.pano;
    this.wanted = vp;
    const tex = this.texture(url);
    if (this.active && this.vp !== vp) await this.fadeTo(0);
    const map = await tex;
    if (this.wanted !== vp) return;
    const m = this.sphere.material;
    m.map = map;
    m.needsUpdate = true;
    this.vp = vp;
    this.sphere.position.fromArray(vp.pos);
    this.setYaw(vp.panoYaw ?? 0);
    this.sphere.visible = true;
    await this.fadeTo(1);
  }

  async hide() {
    this.wanted = null;
    if (!this.active) return;
    await this.fadeTo(0);
    if (this.wanted) return;   // între timp s-a cerut altă panoramă
    this.sphere.visible = false;
    this.vp = null;
  }

  /** Preîncarcă panoramele (ex. ale punctelor vecine) ca trecerea să fie imediată. */
  preload(urls) { for (const u of urls) this.texture(u).catch(() => {}); }

  fadeTo(target) {
    this.fade?.resolve();   // tranziția întreruptă nu lasă pe nimeni în așteptare
    return new Promise((resolve) => {
      this.fade = { from: this.sphere.material.opacity, to: target, t0: performance.now(), resolve };
    });
  }

  update(now) {
    const f = this.fade;
    if (!f) return;
    const k = Math.min(1, (now - f.t0) / FADE_MS);
    this.sphere.material.opacity = f.from + (f.to - f.from) * k;
    if (k >= 1) { this.fade = null; f.resolve(); }
  }
}
