/* ============================================================
   RSI-Index — the star field
   A long-exposure star map: thousands of white points drift along
   a smooth flow (a vortex around a pole plus a periodic, divergence-
   free potential field), leaving trails. Faint blue streamlines with
   arrowheads trace the same flow. The field loops every ~52 s with a
   slow phase drift, so no two passes are identical.
   Drag to pan · ctrl/⌘ + scroll (or pinch) to zoom · double-click to
   reset. Ambient variant on subpage headers is non-interactive.
   ============================================================ */
(function () {
  "use strict";

  var TAU = Math.PI * 2;
  var PERIOD = 52;                                   // seconds per loop
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var shotMode = /(\?|&)shot=1/.test(location.search);
  if (shotMode) document.documentElement.classList.add("shot");

  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

  /* deterministic rng so the field is reproducible per page */
  function mulberry(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* soft round sprite for the brightest stars */
  function makeSprite(size) {
    var c = document.createElement("canvas");
    c.width = c.height = size;
    var g = c.getContext("2d");
    var r = size / 2;
    var grad = g.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, "rgba(255,255,255,0.9)");
    grad.addColorStop(0.3, "rgba(220,232,255,0.35)");
    grad.addColorStop(1, "rgba(200,220,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    return c;
  }
  var SPRITE = makeSprite(28);

  function createField(section, opts) {
    var linesC = section.querySelector("canvas.field-lines");
    var starsC = section.querySelector("canvas.field-stars");
    if (!linesC || !starsC) return;
    section.classList.add("field-live");
    var lctx = linesC.getContext("2d");
    var sctx = starsC.getContext("2d");

    var rng = mulberry(opts.seed || 7);
    var interactive = !!opts.interactive;
    var poleAt = opts.poleAt || [0.7, 0.46];       // screen fraction at rest
    var density = opts.density || 1;
    var lineCount = opts.lines || 84;

    var W = 0, H = 0, DPR = 1;
    var zoom = 1, camX = 0, camY = 0;               // world point at screen centre
    var zoomT = 1, camXT = 0, camYT = 0;            // eased targets
    var zoomAnchor = null;                          // screen point to zoom about
    var homeX = 0, homeY = 0;
    var particles = [], count = 0;
    var seeds = [];
    var t = rng() * PERIOD, lastT = 0, frame = 0;
    var raf = null, running = false, visible = !document.hidden, inView = true;
    var quality = { count: 1, dpr: 1, lineEvery: 8 };  // degraded by the governor if frames run long
    var dtAvg = 16, slowSince = 0, level = 0;

    /* ---------- the flow ---------- */

    // periodic potential: sum of plane waves, each with a period that divides PERIOD
    var waves = [];
    var wl = [980, 640, 470, 350, 270, 210, 165];
    for (var i = 0; i < wl.length; i++) {
      var ang = rng() * TAU, k = TAU / wl[i];
      var m = 1 + ((rng() * 4) | 0);
      waves.push({
        kx: Math.cos(ang) * k, ky: Math.sin(ang) * k,
        phase: rng() * TAU,
        omega: (TAU / PERIOD) * m * (rng() < 0.5 ? -1 : 1),
        drift: (rng() - 0.5) * 0.006,                // breaks exact repetition
        amp: 10.5 / k
      });
    }
    var SWIRL = 0.15, R0 = 260, CURL = 0.55, INWARD = 3.2;

    // velocity at world point (px/s) -> writes into out[0], out[1]
    function flow(x, y, time, out) {
      var dx = 0, dy = 0;
      for (var i = 0; i < waves.length; i++) {
        var w = waves[i];
        var c = Math.cos(w.kx * x + w.ky * y + w.phase + (w.omega + w.drift) * time) * w.amp;
        dx += w.kx * c;                              // dpsi/dx
        dy += w.ky * c;                              // dpsi/dy
      }
      // curl of psi is divergence-free: (dpsi/dy, -dpsi/dx)
      var vx = dy * CURL, vy = -dx * CURL;
      var r = Math.sqrt(x * x + y * y) + 1e-3;
      var om = SWIRL / Math.sqrt(1 + r / R0);
      vx += -y * om - (x / r) * INWARD;
      vy += x * om - (y / r) * INWARD;
      out[0] = vx; out[1] = vy;
    }

    /* ---------- geometry ---------- */

    function toScreenX(x) { return (x - camX) * zoom + W / 2; }
    function toScreenY(y) { return (y - camY) * zoom + H / 2; }

    function resize() {
      var r = section.getBoundingClientRect();
      var nw = Math.max(1, Math.round(r.width)), nh = Math.max(1, Math.round(r.height));
      // pixel budget: ~3.6M canvas pixels max, never above 1.5x, never below 1x
      DPR = Math.max(1, Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(3.6e6 / (nw * nh)))) * quality.dpr;
      var first = W === 0;
      W = nw; H = nh;
      linesC.width = starsC.width = W * DPR;
      linesC.height = starsC.height = H * DPR;
      lctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      sctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      homeX = -(poleAt[0] - 0.5) * W;
      homeY = -(poleAt[1] - 0.5) * H;
      if (first) { camX = camXT = homeX; camY = camYT = homeY; }
      var target = clamp(Math.round(W * H / 780 * density * quality.count), 300, 2400);
      if (target !== count) { count = target; seedParticles(); }
      seedLines();
      drawLines();
      if (!first) drawStars(0);                      // repaint after a resize
    }

    /* ---------- particles ---------- */

    // spawn density forms spiral bands that follow the swirl
    function band(x, y, time) {
      var r = Math.sqrt(x * x + y * y), th = Math.atan2(y, x);
      var b = 0.5 + 0.5 * Math.sin(2.5 * th - r / 175 + 0.6 * Math.sin(time / 11));
      return 0.12 + 0.88 * b * b * b;
    }

    function spawn(p, fresh) {
      var pad = 0.28;
      var vw = W / zoom, vh = H / zoom;
      var tries = 0;
      do {
        p.x = camX + (rng() - 0.5) * vw * (1 + pad * 2);
        p.y = camY + (rng() - 0.5) * vh * (1 + pad * 2);
        tries++;
      } while (tries < 8 && rng() > band(p.x, p.y, t));
      p.life = 11 + rng() * 21;
      p.age = fresh ? rng() * p.life : 0;
      var s = rng();
      p.size = s < 0.02 ? 2.3 : 0.7 + rng() * 0.9;
      p.bright = s < 0.02;
      p.alpha = 0.35 + rng() * 0.65;
      p.tint = rng() < 0.55 ? 0 : rng() < 0.7 ? 1 : 2;
    }

    function seedParticles() {
      particles = new Array(count);
      for (var i = 0; i < count; i++) { particles[i] = {}; spawn(particles[i], true); }
    }

    var TINTS = ["255,255,255", "214,228,255", "176,204,255"];
    var buckets = [];
    for (var b = 0; b < 12; b++) buckets.push([]);

    var vout = [0, 0];

    function stepParticles(dt) {
      var kill = 14;                                 // core radius: respawn there
      for (var i = 0; i < count; i++) {
        var p = particles[i];
        flow(p.x, p.y, t, vout);
        p.x += vout[0] * dt;
        p.y += vout[1] * dt;
        p.age += dt;
        var r = p.x * p.x + p.y * p.y;
        if (p.age >= p.life || r < kill * kill) { spawn(p, false); continue; }
        // out of the extended view -> respawn
        var sx = toScreenX(p.x), sy = toScreenY(p.y);
        if (sx < -W * 0.35 || sx > W * 1.35 || sy < -H * 0.35 || sy > H * 1.35) spawn(p, false);
      }
    }

    function drawStars(fade) {
      if (fade > 0) {
        sctx.globalCompositeOperation = "destination-out";
        sctx.fillStyle = "rgba(0,0,0," + fade + ")";
        sctx.fillRect(0, 0, W, H);
        sctx.globalCompositeOperation = "source-over";
      }
      for (var b = 0; b < 12; b++) buckets[b].length = 0;
      for (var i = 0; i < count; i++) {
        var p = particles[i];
        var env = Math.min(1, p.age / 1.6, (p.life - p.age) / 2.2);
        if (env <= 0.02) continue;
        var a = p.alpha * env;
        var ab = a < 0.3 ? 0 : a < 0.55 ? 1 : a < 0.8 ? 2 : 3;
        buckets[p.tint * 4 + ab].push(p);
      }
      var ALPHAS = [0.22, 0.42, 0.66, 0.92];
      for (b = 0; b < 12; b++) {
        var list = buckets[b];
        if (!list.length) continue;
        sctx.fillStyle = "rgba(" + TINTS[(b / 4) | 0] + "," + ALPHAS[b % 4] + ")";
        sctx.beginPath();
        for (i = 0; i < list.length; i++) {
          var q = list[i];
          var sx = toScreenX(q.x), sy = toScreenY(q.y);
          if (q.bright) {
            sctx.rect(sx - 1.1, sy - 1.1, 2.2, 2.2);
          } else {
            sctx.rect(sx - q.size / 2, sy - q.size / 2, q.size, q.size);
          }
        }
        sctx.fill();
      }
      // halos on the bright few
      sctx.globalAlpha = 0.55;
      for (i = 0; i < count; i++) {
        var pb = particles[i];
        if (!pb.bright) continue;
        var e = Math.min(1, pb.age / 1.6, (pb.life - pb.age) / 2.2);
        if (e <= 0.05) continue;
        sctx.drawImage(SPRITE, toScreenX(pb.x) - 9, toScreenY(pb.y) - 9, 18, 18);
      }
      sctx.globalAlpha = 1;
    }

    /* ---------- streamlines ---------- */

    function seedLines() {
      seeds = [];
      var lr = mulberry((opts.seed || 7) * 31 + 5);
      var cols = Math.ceil(Math.sqrt(lineCount * W / Math.max(1, H)));
      var rows = Math.ceil(lineCount / cols);
      var vw = W / zoom * 1.7, vh = H / zoom * 1.7;
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          seeds.push({
            x: homeX + ((c + 0.2 + lr() * 0.6) / cols - 0.5) * vw,
            y: homeY + ((r + 0.2 + lr() * 0.6) / rows - 0.5) * vh
          });
        }
      }
    }

    var STEP = 7, STEPS = 110, ARROW_GAP = 150;

    function drawLines() {
      lctx.clearRect(0, 0, W, H);

      // pole glow
      var px = toScreenX(0), py = toScreenY(0);
      var halo = lctx.createRadialGradient(px, py, 0, px, py, 420 * Math.sqrt(zoom));
      halo.addColorStop(0, "rgba(90,130,220,0.20)");
      halo.addColorStop(0.5, "rgba(60,95,180,0.07)");
      halo.addColorStop(1, "rgba(40,70,140,0)");
      lctx.fillStyle = halo;
      lctx.fillRect(0, 0, W, H);
      var breath = 0.62 + 0.2 * Math.sin(t * TAU / 9);
      var core = lctx.createRadialGradient(px, py, 0, px, py, (24 + 6 * breath) * Math.sqrt(zoom));
      core.addColorStop(0, "rgba(255,255,255," + (0.6 + 0.3 * breath).toFixed(3) + ")");
      core.addColorStop(0.35, "rgba(230,238,255,0.25)");
      core.addColorStop(1, "rgba(200,220,255,0)");
      lctx.fillStyle = core;
      lctx.fillRect(px - 40, py - 40, 80, 80);

      lctx.lineWidth = 1;
      lctx.lineCap = "round";
      lctx.lineJoin = "round";
      var arrows = [];
      lctx.strokeStyle = "rgba(96,142,224,0.28)";
      lctx.beginPath();
      for (var s = 0; s < seeds.length; s++) {
        var x = seeds[s].x, y = seeds[s].y;
        var arc = 0, nextArrow = 0;
        var sx0 = toScreenX(x), sy0 = toScreenY(y);
        lctx.moveTo(sx0, sy0);
        for (var i = 0; i < STEPS; i++) {
          flow(x, y, t, vout);
          var m = Math.sqrt(vout[0] * vout[0] + vout[1] * vout[1]) + 1e-6;
          var ux = vout[0] / m, uy = vout[1] / m;
          x += ux * STEP; y += uy * STEP;
          var sx = toScreenX(x), sy = toScreenY(y);
          lctx.lineTo(sx, sy);
          arc += STEP * zoom;
          if (arc >= nextArrow + ARROW_GAP) {
            nextArrow += ARROW_GAP;
            if (sx > -10 && sx < W + 10 && sy > -10 && sy < H + 10) arrows.push(sx, sy, ux, uy);
          }
          if (x * x + y * y < 400) break;            // reached the core
        }
      }
      lctx.stroke();

      lctx.strokeStyle = "rgba(130,172,240,0.6)";
      lctx.lineWidth = 1.1;
      lctx.beginPath();
      for (i = 0; i < arrows.length; i += 4) {
        var ax = arrows[i], ay = arrows[i + 1], aux = arrows[i + 2], auy = arrows[i + 3];
        var L = 5.5;
        lctx.moveTo(ax - aux * L + auy * L * 0.6, ay - auy * L - aux * L * 0.6);
        lctx.lineTo(ax, ay);
        lctx.lineTo(ax - aux * L - auy * L * 0.6, ay - auy * L + aux * L * 0.6);
      }
      lctx.stroke();
    }

    /* ---------- camera ---------- */

    function shiftTrails(dx, dy, scale, ox, oy) {
      if (dx === 0 && dy === 0 && scale === 1) return;
      sctx.save();
      sctx.globalCompositeOperation = "copy";
      sctx.setTransform(DPR * scale, 0, 0, DPR * scale,
        DPR * (ox * (1 - scale) + dx), DPR * (oy * (1 - scale) + dy));
      sctx.drawImage(starsC, 0, 0, W, H);
      sctx.restore();
      sctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }

    function easeCamera() {
      var changed = false;
      var pz = zoom, pcx = camX, pcy = camY;
      if (Math.abs(zoomT - zoom) > 1e-4) {
        zoom += (zoomT - zoom) * 0.16;
        if (Math.abs(zoomT - zoom) < 1e-4) zoom = zoomT;
        changed = true;
      }
      if (Math.abs(camXT - camX) > 0.05 || Math.abs(camYT - camY) > 0.05) {
        camX += (camXT - camX) * 0.22;
        camY += (camYT - camY) * 0.22;
        if (Math.abs(camXT - camX) < 0.05 && Math.abs(camYT - camY) < 0.05) { camX = camXT; camY = camYT; }
        changed = true;
      }
      if (!changed) return false;
      var scale = zoom / pz;
      var ox = zoomAnchor ? zoomAnchor[0] : W / 2, oy = zoomAnchor ? zoomAnchor[1] : H / 2;
      // screen shift of a fixed world point caused by the pan
      var dx = (pcx - camX) * zoom, dy = (pcy - camY) * zoom;
      shiftTrails(dx, dy, scale, ox, oy);
      return true;
    }

    function zoomAt(sx, sy, factor) {
      var nz = clamp(zoomT * factor, 0.55, 3.2);
      if (nz === zoomT) return;
      // keep the world point under the cursor fixed
      var wx = (sx - W / 2) / zoomT + camXT, wy = (sy - H / 2) / zoomT + camYT;
      zoomT = nz;
      camXT = wx - (sx - W / 2) / nz;
      camYT = wy - (sy - H / 2) / nz;
      zoomAnchor = [sx, sy];
      wake();
    }

    function resetView() {
      zoomT = 1; camXT = homeX; camYT = homeY; zoomAnchor = null;
      wake();
    }

    /* ---------- loop ---------- */

    function update(dt) {
      t += dt;
      stepParticles(dt);
    }

    function frameFn(now) {
      raf = null;
      if (!running) return;
      var dt = Math.min(0.05, (now - lastT) / 1000 || 0.016);
      lastT = now;
      var moved = easeCamera();
      update(dt);
      drawStars(0.072);
      if (moved || (frame++ % quality.lineEvery) === 0) drawLines();
      govern(now, dt);
      raf = requestAnimationFrame(frameFn);
    }

    /* frame-time governor: shed work on machines that cannot keep ~40 fps */
    function govern(now, dt) {
      dtAvg += (dt * 1000 - dtAvg) * 0.05;
      if (dtAvg > 27) {
        if (!slowSince) slowSince = now;
        if (now - slowSince > 1500 && level < 2) {
          level++;
          if (level === 1) { quality.count = 0.6; quality.lineEvery = 12; }
          else { quality.dpr = 1 / 1.5; quality.lineEvery = 16; }
          count = 0;                                   // force re-seed at the new budget
          resize();
          slowSince = 0; dtAvg = 16;
        }
      } else slowSince = 0;
    }

    function start() {
      if (running || reduced) return;
      running = true;
      lastT = performance.now();
      if (!raf) raf = requestAnimationFrame(frameFn);
    }
    function stop() {
      running = false;
      if (raf) { cancelAnimationFrame(raf); raf = null; }
    }
    function syncRun() { (visible && inView) ? start() : stop(); }
    function wake() {
      if (reduced) {                                   // static mode: settle instantly
        var guard = 0;
        while (easeCamera() && guard++ < 200) { /* converge */ }
        drawLines();
        drawStars(0);
      }
    }

    /* pre-expose so the first paint already carries trails */
    function preroll(frames) {
      for (var i = 0; i < frames; i++) {
        update(1 / 60);
        drawStars(0.072);
      }
      drawLines();
    }

    /* ---------- interaction ---------- */

    function bind() {
      var el = starsC;
      var pointers = {};
      var dragging = false, lastX = 0, lastY = 0, pinchD = 0, moved = 0;
      var engaged = false, hintTimer = null;
      var hint = section.querySelector(".field-hint");

      el.addEventListener("pointerdown", function (e) {
        if (e.pointerType === "touch") {
          pointers[e.pointerId] = [e.clientX, e.clientY];
          var ids = Object.keys(pointers);
          if (ids.length === 2) {
            var a = pointers[ids[0]], b = pointers[ids[1]];
            pinchD = Math.hypot(a[0] - b[0], a[1] - b[1]);
            lastX = (a[0] + b[0]) / 2; lastY = (a[1] + b[1]) / 2;
            el.setPointerCapture(e.pointerId);
          }
          return;
        }
        if (e.button !== 0) return;
        dragging = true; moved = 0; engaged = true;
        lastX = e.clientX; lastY = e.clientY;
        el.setPointerCapture(e.pointerId);
        el.classList.add("dragging");
      });

      el.addEventListener("pointermove", function (e) {
        if (e.pointerType === "touch") {
          if (!pointers[e.pointerId]) return;
          pointers[e.pointerId] = [e.clientX, e.clientY];
          var ids = Object.keys(pointers);
          if (ids.length !== 2) return;
          var a = pointers[ids[0]], b = pointers[ids[1]];
          var d = Math.hypot(a[0] - b[0], a[1] - b[1]);
          var mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
          var r = el.getBoundingClientRect();
          if (pinchD > 0) zoomAt(mx - r.left, my - r.top, d / pinchD);
          camXT -= (mx - lastX) / zoomT; camYT -= (my - lastY) / zoomT;
          camX = camXT; camY = camYT;
          pinchD = d; lastX = mx; lastY = my;
          e.preventDefault();
          return;
        }
        if (!dragging) return;
        var dx = e.clientX - lastX, dy = e.clientY - lastY;
        moved += Math.abs(dx) + Math.abs(dy);
        lastX = e.clientX; lastY = e.clientY;
        camXT -= dx / zoom; camYT -= dy / zoom;
        camX = camXT; camY = camYT;                    // drag is immediate
        shiftTrails(dx, dy, 1, 0, 0);
        if (reduced) { drawLines(); drawStars(0); }
      });

      function endPointer(e) {
        if (e.pointerType === "touch") { delete pointers[e.pointerId]; pinchD = 0; return; }
        dragging = false;
        el.classList.remove("dragging");
      }
      el.addEventListener("pointerup", endPointer);
      el.addEventListener("pointercancel", endPointer);

      el.addEventListener("wheel", function (e) {
        if (!(e.ctrlKey || e.metaKey || engaged)) return;
        e.preventDefault();
        var r = el.getBoundingClientRect();
        var f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016));
        zoomAt(e.clientX - r.left, e.clientY - r.top, f);
      }, { passive: false });

      el.addEventListener("dblclick", function (e) { e.preventDefault(); resetView(); });

      el.addEventListener("pointerenter", function (e) {
        if (e.pointerType === "touch" || !hint) return;
        hintTimer = setTimeout(function () { hint.classList.add("on"); }, 900);
      });
      el.addEventListener("pointerleave", function (e) {
        if (e.pointerType === "touch") return;
        engaged = false;
        clearTimeout(hintTimer);
        if (hint) hint.classList.remove("on");
      });
    }

    /* ---------- init ---------- */

    resize();
    preroll(reduced || shotMode ? 60 : 30);

    if (!reduced) {
      if ("IntersectionObserver" in window) {
        new IntersectionObserver(function (es) {
          inView = es[0].isIntersecting;
          syncRun();
        }, { rootMargin: "60px" }).observe(section);
      }
      document.addEventListener("visibilitychange", function () {
        visible = !document.hidden;
        syncRun();
      });
      start();
    }

    window.addEventListener("resize", resize);
    if ("ResizeObserver" in window) {
      new ResizeObserver(function () {
        var r = section.getBoundingClientRect();
        if (Math.round(r.width) !== W || Math.round(r.height) !== H) resize();
      }).observe(section);
    }

    if (interactive) bind();
  }

  function init() {
    var hero = document.querySelector("[data-field-hero]");
    if (hero) createField(hero, { seed: 7, interactive: true, poleAt: [0.7, 0.46], density: 1, lines: 84 });
    var heads = document.querySelectorAll("[data-field-head]");
    for (var i = 0; i < heads.length; i++) {
      createField(heads[i], { seed: 11 + i, interactive: false, poleAt: [0.76, 0.5], density: 0.55, lines: 44 });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
