/**
 * SwarmScribe ambient particle field (p5 instance mode).
 * Cursor attractor + click bursts + constellation links.
 * Canvas is pointer-events:none; pointer tracked on window so UI stays usable.
 *
 * Requires global `p5` (loaded from CDN in index.html before this module).
 */

const STORAGE_KEY = "swarmscribe:particles";

/** Shared pointer state — mutated by window listeners, read inside the sketch. */
const pointer = {
  x: 0,
  y: 0,
  active: false,
  down: false,
};

function prefersReducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function readCssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function hexToRgb(hex) {
  let h = String(hex || "").trim().replace("#", "");
  if (h.startsWith("rgb")) {
    const m = h.match(/(\d+)/g);
    if (m && m.length >= 3) {
      return { r: +m[0], g: +m[1], b: +m[2] };
    }
  }
  if (h.length === 3) {
    return {
      r: parseInt(h[0] + h[0], 16),
      g: parseInt(h[1] + h[1], 16),
      b: parseInt(h[2] + h[2], 16),
    };
  }
  if (h.length < 6) return { r: 200, g: 245, b: 66 };
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function themePalette() {
  return {
    ink: readCssVar("--ink", "#07090d"),
    phos: readCssVar("--phos", "#c8f542"),
    violet: readCssVar("--violet", "#7c6cf0"),
    amber: readCssVar("--amber", "#f0a202"),
    ok: readCssVar("--ok", "#3ee0a2"),
  };
}

/**
 * @param {object} [opts]
 * @param {HTMLElement} [opts.mount]
 * @param {() => number} [opts.getHeat] session heat ~8–48
 */
export function startSwarmParticles(opts = {}) {
  const mount = opts.mount || document.getElementById("swarm-particles");
  if (!mount) return null;

  if (typeof p5 === "undefined") {
    console.warn("[SwarmScribe] p5.js missing — particles disabled");
    mount.hidden = true;
    return null;
  }

  if (prefersReducedMotion()) {
    mount.hidden = true;
    mount.classList.add("is-off");
    return {
      destroy() {},
      setEnabled() {},
      isEnabled() {
        return false;
      },
      burst() {},
    };
  }

  let enabled = true;
  try {
    if (localStorage.getItem(STORAGE_KEY) === "0") enabled = false;
  } catch (_) {}

  const getHeat = typeof opts.getHeat === "function" ? opts.getHeat : () => 17;

  /** @type {any} */
  let api = null;
  /** @type {any} */
  let instance = null;

  const sketch = (p) => {
    p.disableFriendlyErrors = true;

    const CFG = {
      baseCount: 150,
      count: 150,
      maxLinks: 160,
      linkDist: 88,
      noiseScale: 0.00175,
      trailFade: 16,
    };

    /** @type {any[]} */
    let particles = [];
    /** @type {any} */
    let trail = null;
    let colors = [];
    let palette = themePalette();
    let t = 0;
    /** @type {{x:number,y:number,n:number}[]} */
    const burstQueue = [];
    let lastTheme = document.documentElement.dataset.theme || "dark";

    class SwarmParticle {
      /**
       * @param {number} x
       * @param {number} y
       * @param {boolean} [burst]
       */
      constructor(x, y, burst = false) {
        this.pos = p.createVector(x, y);
        this.prev = this.pos.copy();
        this.vel = p5.Vector.random2D().mult(burst ? p.random(2.8, 6.5) : p.random(0.25, 1.15));
        this.acc = p.createVector(0, 0);
        this.size = burst ? p.random(2.4, 4.8) : p.random(1.15, 2.7);
        this.hueIdx = Math.floor(p.random(colors.length));
        this.maxSpeed = burst ? 6 : p.random(1.15, 2.55);
        this.life = 1;
        this.decay = burst ? p.random(0.014, 0.03) : 0;
        this.burst = burst;
        this.phase = p.random(p.TWO_PI);
        this.spin = p.random(-0.035, 0.035);
      }

      applyForce(f) {
        this.acc.add(f);
      }

      followFlow() {
        const n = p.noise(
          this.pos.x * CFG.noiseScale,
          this.pos.y * CFG.noiseScale,
          t * 0.11
        );
        const angle = n * p.TWO_PI * 3 + this.phase;
        this.applyForce(p5.Vector.fromAngle(angle).mult(0.048));
      }

      seekPointer() {
        if (!pointer.active) return;
        const dir = p.createVector(pointer.x - this.pos.x, pointer.y - this.pos.y);
        const d = dir.mag();
        if (d < 6 || d > 440) return;
        dir.normalize();
        if (d < 72) {
          dir.mult(-0.42 * (1 - d / 72));
        } else {
          const heatBoost = 0.5 + (getHeat() / 48) * 1.0;
          dir.mult(0.11 * heatBoost * (1 - d / 440));
        }
        if (pointer.down) dir.mult(1.75);
        this.applyForce(dir);
      }

      update() {
        this.prev.set(this.pos);
        this.followFlow();
        this.seekPointer();
        this.vel.add(this.acc);
        this.vel.limit(this.maxSpeed * (0.85 + (getHeat() / 48) * 0.5));
        this.pos.add(this.vel);
        this.acc.mult(0);
        this.phase += this.spin;
        if (this.burst) {
          this.life -= this.decay;
          this.vel.mult(0.984);
        }
        this.wrap();
      }

      wrap() {
        const m = 28;
        let wrapped = false;
        if (this.pos.x > p.width + m) {
          this.pos.x = -m;
          wrapped = true;
        } else if (this.pos.x < -m) {
          this.pos.x = p.width + m;
          wrapped = true;
        }
        if (this.pos.y > p.height + m) {
          this.pos.y = -m;
          wrapped = true;
        } else if (this.pos.y < -m) {
          this.pos.y = p.height + m;
          wrapped = true;
        }
        if (wrapped) this.prev.set(this.pos);
      }

      isDead() {
        return this.burst && this.life <= 0;
      }

      drawTrail() {
        const c = colors[this.hueIdx];
        const a = this.burst ? this.life * 170 : 78 + (getHeat() / 48) * 36;
        trail.stroke(c.r, c.g, c.b, a);
        trail.strokeWeight(this.burst ? this.size * 0.5 : 0.75);
        trail.line(this.prev.x, this.prev.y, this.pos.x, this.pos.y);
      }

      drawHead() {
        const c = colors[this.hueIdx];
        const pulse = 0.86 + 0.14 * Math.sin(t * 2.4 + this.phase);
        const a = this.burst ? this.life * 230 : 150 * pulse;
        p.noStroke();
        p.fill(c.r, c.g, c.b, a * 0.32);
        p.circle(this.pos.x, this.pos.y, this.size * 3.4 * pulse);
        p.fill(c.r, c.g, c.b, a);
        p.circle(this.pos.x, this.pos.y, this.size * pulse);
      }
    }

    function rebuildColors() {
      palette = themePalette();
      colors = [palette.phos, palette.violet, palette.amber, palette.ok].map(hexToRgb);
    }

    function seedField() {
      const area = Math.max(1, p.width * p.height);
      CFG.count = Math.round(
        CFG.baseCount * Math.min(1.55, Math.max(0.5, area / (1280 * 820)))
      );
      particles = [];
      for (let i = 0; i < CFG.count; i++) {
        particles.push(new SwarmParticle(p.random(p.width), p.random(p.height)));
      }
    }

    function spawnBurst(x, y, n = 30) {
      for (let i = 0; i < n; i++) {
        particles.push(new SwarmParticle(x, y, true));
      }
    }

    function drawLinks() {
      const heat = getHeat();
      const linkAlpha = 16 + (heat / 48) * 26;
      let drawn = 0;
      p.strokeWeight(0.55);
      for (let i = 0; i < particles.length && drawn < CFG.maxLinks; i++) {
        const a = particles[i];
        if (a.burst) continue;
        const nearCursor =
          pointer.active &&
          p.dist(a.pos.x, a.pos.y, pointer.x, pointer.y) < 230;
        if (!nearCursor && Math.random() > 0.07) continue;
        for (let j = i + 1; j < particles.length && drawn < CFG.maxLinks; j++) {
          const b = particles[j];
          if (b.burst) continue;
          const d = p.dist(a.pos.x, a.pos.y, b.pos.x, b.pos.y);
          if (d >= CFG.linkDist) continue;
          const c = colors[a.hueIdx];
          p.stroke(c.r, c.g, c.b, linkAlpha * (1 - d / CFG.linkDist));
          p.line(a.pos.x, a.pos.y, b.pos.x, b.pos.y);
          drawn++;
        }
      }
    }

    function drawCursorHalo() {
      if (!pointer.active) return;
      const c = colors[0];
      const r = 46 + Math.sin(t * 3.1) * 7;
      p.noFill();
      p.stroke(c.r, c.g, c.b, pointer.down ? 58 : 26);
      p.strokeWeight(1.15);
      p.circle(pointer.x, pointer.y, r * 2);
      p.stroke(c.r, c.g, c.b, 11);
      p.circle(pointer.x, pointer.y, r * 3.1);
    }

    p.setup = function () {
      const cnv = p.createCanvas(window.innerWidth, window.innerHeight);
      cnv.parent(mount);
      cnv.elt.setAttribute("aria-hidden", "true");
      p.pixelDensity(Math.min(1.25, window.devicePixelRatio || 1));
      p.frameRate(60);
      rebuildColors();
      trail = p.createGraphics(p.width, p.height);
      trail.pixelDensity(1);
      seedField();
      mount.classList.toggle("is-off", !enabled);
      if (!enabled) p.noLoop();
    };

    p.draw = function () {
      if (!enabled) return;

      const theme = document.documentElement.dataset.theme || "dark";
      if (theme !== lastTheme) {
        lastTheme = theme;
        rebuildColors();
      }

      t += 0.016;
      while (burstQueue.length) {
        const b = burstQueue.shift();
        spawnBurst(b.x, b.y, b.n);
      }

      const ink = hexToRgb(palette.ink);
      trail.noStroke();
      trail.fill(ink.r, ink.g, ink.b, CFG.trailFade);
      trail.rect(0, 0, p.width, p.height);

      for (const pt of particles) {
        pt.update();
        pt.drawTrail();
      }
      particles = particles.filter((pt) => !pt.isDead());
      let ambient = 0;
      for (const pt of particles) if (!pt.burst) ambient++;
      while (ambient < CFG.count) {
        particles.push(new SwarmParticle(p.random(p.width), p.random(p.height)));
        ambient++;
      }

      p.clear();
      p.image(trail, 0, 0);
      drawLinks();
      for (const pt of particles) pt.drawHead();
      drawCursorHalo();
    };

    p.windowResized = function () {
      p.resizeCanvas(window.innerWidth, window.innerHeight);
      const next = p.createGraphics(p.width, p.height);
      next.pixelDensity(1);
      try {
        next.image(trail, 0, 0, p.width, p.height);
      } catch (_) {}
      trail = next;
      seedField();
    };

    api = {
      setEnabled(on) {
        enabled = !!on;
        try {
          localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
        } catch (_) {}
        mount.classList.toggle("is-off", !enabled);
        mount.hidden = false;
        if (enabled) p.loop();
        else {
          p.noLoop();
          p.clear();
          if (trail) trail.clear();
        }
      },
      isEnabled() {
        return enabled;
      },
      burst(x, y, n = 30) {
        burstQueue.push({ x, y, n });
      },
      refreshTheme() {
        rebuildColors();
      },
    };
  };

  instance = new p5(sketch);

  const onMove = (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.active = true;
  };
  const onLeave = () => {
    pointer.active = false;
  };
  const onDown = () => {
    pointer.down = true;
  };
  const onUp = () => {
    pointer.down = false;
  };
  const onClick = (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (
      t.closest(
        "button, a, input, textarea, select, label, [role='button'], [role='tab'], [role='menuitem'], [role='listbox'], .rail, .prompt-wrap, .export-menu, .fusion-md, .box"
      )
    ) {
      return;
    }
    api?.burst(e.clientX, e.clientY, 34);
  };

  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("pointerdown", onDown, { passive: true });
  window.addEventListener("pointerup", onUp, { passive: true });
  document.addEventListener("pointerleave", onLeave, { passive: true });
  window.addEventListener("click", onClick, true);

  const mo = new MutationObserver(() => api?.refreshTheme?.());
  mo.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  return {
    destroy() {
      mo.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("click", onClick, true);
      if (instance) {
        instance.remove();
        instance = null;
      }
      api = null;
    },
    setEnabled(on) {
      api?.setEnabled(on);
    },
    isEnabled() {
      return api?.isEnabled?.() ?? enabled;
    },
    burst(x, y, n) {
      api?.burst(x, y, n);
    },
  };
}
