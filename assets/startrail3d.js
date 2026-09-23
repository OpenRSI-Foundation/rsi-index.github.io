/* ==========================================================================
   rsi-index — "startrail3d": the circumpolar star-trail timelapse as a true
   3D celestial dome. Stars sit on a sphere and rotate rigidly about a tilted
   polar axis; every star draws a fixed-length analytic arc behind itself
   (bright head, tail fading to nothing), so trails are crisp, never clutter,
   and stay glued to the sky while you look around.
   Drag = look around (yaw/pitch, inertia) · no wheel zoom, so the
   wheel always scrolls the page ·
   double-click = return to the pole view. Vanilla ES5, canvas 2D.

   Star-trails edition: runs inline in the hero (host = [data-field3d]). The
   first exposure "converges": the stars fly in from a scattered cloud, then the
   arcs grow to nearly a full exposure over INTRO seconds before the usual
   live-photo cycle takes over. window events: 'rsi-sky-replay' restarts the
   exposure; 'rsi-sky-visibility' {detail:{visible}} pauses it off-screen.
   ========================================================================== */
(function () {
  'use strict';

  var TAU = Math.PI * 2;

  /* look & motion */
  var OMEGA = 0.042;          /* rad/s — rigid sky rotation (slow exposure)    */
  var TRAIL = 0.26;           /* rad — arc length behind each star (constant)  */
  var SEGS = 8;               /* max segments per arc                          */
  var COMPACT = !!(window.matchMedia && window.matchMedia('(max-width: 720px)').matches);
  var N = COMPACT ? 4200 : 9000;   /* fewer trails on phone-sized fill surfaces */
  var NMW = COMPACT ? 1200 : 3000; /* extra Milky-Way micro stars (heads only)  */
  var NT = N + NMW;
  var PLAX = 0.035;           /* camera translation amplitude (parallax)       */
  var POLE_ALT = 0.45;        /* pole altitude above the horizon (rad)         */
  var PITCH0 = COMPACT ? 0.06 : 0.30; /* pole upper-centre; phones look a little lower so the pole sits behind the title */
  var FOV0 = 1.00;            /* default vertical field of view — panoramic    */
  var INTRO = 5.5;            /* seconds: the first exposure opens             */
  var GATHER = 2.2;           /* seconds: the cloud flies in                   */
  function easeIO(x) { return x <= 0 ? 0 : x >= 1 ? 1 : (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2); }
  function easeOut(x) { return x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.pow(1 - x, 3); }

  function boot() {
    var BGMODE = /[?&]bg=1/.test(location.search);   /* page-header backdrop */
    var STATIC = /[?&]static=1/.test(location.search); /* frozen still image  */
    var FIXT = (function () { var m = /[?&]skyt=([\d.]+)/.exec(location.search); return m ? parseFloat(m[1]) : -1; })();
    var host = document.querySelector('[data-field3d]');
    var NOLAND = !!(host && host.hasAttribute('data-no-land'));   /* stars only: the hills are drawn elsewhere */
    if (!host) return;
    var JOURNEY = !BGMODE && NOLAND && host.hasAttribute('data-sky-journey') && document.body.classList.contains('home');
    var viewProgress = Math.max(0, Math.min(1, +host.getAttribute('data-sky-progress') || 0));
    var lastView = -1;
    /* the drawn view follows the scroll target with a short damped lag (about 90 ms), so wheel
       notches and coarse scroll events become one continuous camera move; the mountains read
       the same value, so the two never drift apart */
    var viewDrawn = viewProgress;
    var VIEW_LAMBDA = 11;
    var canvas = host.querySelector('canvas.f3d');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'f3d';
      host.appendChild(canvas);
    }
    canvas.style.position = 'absolute';
    canvas.style.left = '0';
    canvas.style.top = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    var ctx = canvas.getContext('2d');

    var reduced = STATIC;
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      reduced = !!mq.matches || STATIC;
      var onMq = function () { reduced = !!mq.matches || STATIC; schedule(); };
      if (mq.addEventListener) mq.addEventListener('change', onMq);
      else if (mq.addListener) mq.addListener(onMq);
    }

    /* ---------------- pole frame ----------------
       The pole sits at azimuth 0, altitude POLE_ALT. P is the axis; A/B span
       the circles of "celestial latitude" around it. */
    var P = [Math.cos(POLE_ALT), Math.sin(POLE_ALT), 0];  /* x=north, y=up, z=east */
    var A = [-Math.sin(POLE_ALT), Math.cos(POLE_ALT), 0];
    var B = [0, 0, 1];

    /* ---------------- stars: (angle from axis, phase, look) -------------- */
    var sLat = new Float32Array(NT);  /* angle from the axis (0 = at pole)   */
    var sPh = new Float32Array(NT);   /* phase around the axis               */
    var sB = new Float32Array(NT);    /* brightness                          */
    var sS = new Float32Array(NT);    /* head size px                        */
    var sC = new Uint8Array(NT);      /* color index                         */
    var sT = new Float32Array(NT);    /* twinkle phase                       */
    var sIv = new Float32Array(NT);   /* 1/distance — parallax weight        */
    var sLw = new Float32Array(NT);   /* trail line width                    */
    var sAf = new Float32Array(NT);   /* per-trail opacity factor            */

    /* palette: video-sampled silver base + a FAMILY of blue accents
       (ice -> sky -> azure -> cobalt), no orange */
    var COLS = [
      [213, 215, 219],   /* neutral silver        */
      [199, 208, 216],   /* blue-silver (bright)  */
      [161, 172, 183],   /* blue-slate (dominant) */
      [140, 152, 165],   /* deep slate            */
      [216, 197, 191],   /* warm silver (subtle)  */
      [188, 168, 162],   /* soft rosy (subtle)    */
      [176, 204, 252],   /* ice blue              */
      [140, 182, 252],   /* sky blue              */
      [108, 158, 248],   /* azure                 */
      [88, 128, 238]     /* cobalt                */
    ];
    var seed = 24681357;
    function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }

    (function () {
      var i;
      for (i = 0; i < N; i++) {
        /* uniform on the sphere: cos(lat) uniform in [-1,1] */
        sLat[i] = Math.acos(1 - 2 * rnd());
        sPh[i] = rnd() * TAU;
        var b = rnd(); b = b * b;
        sB[i] = 0.14 + 0.86 * b;
        sS[i] = b > 0.72 ? 2 : (b > 0.3 ? 1.5 : 1);
        var c = rnd();
        sC[i] = c < 0.26 ? 2 : c < 0.48 ? 1 : c < 0.62 ? 3 : c < 0.74 ? 0 :
                c < 0.78 ? 4 : c < 0.80 ? 5 :
                c < 0.87 ? 6 : c < 0.93 ? 7 : c < 0.975 ? 8 : 9;
        /* the blue family runs bright so it reads as jewels */
        if (sC[i] >= 6) {
          var ab = 0.5 + 0.5 * rnd();
          if (sB[i] < ab) { sB[i] = ab; b = (ab - 0.14) / 0.86; }
          if (sS[i] < 1.5) sS[i] = 1.5;
        }
        sT[i] = rnd() * TAU;
        /* bright stars read as near: they parallax more and draw thicker;
           width and opacity also jitter independently star to star */
        sIv[i] = 0.15 + 0.85 * b;
        sLw[i] = 0.5 + 1.05 * b + rnd() * 0.3;
        sAf[i] = 0.7 + 0.6 * rnd();
      }
      /* Milky Way: micro stars clustered around a tilted great circle.
         Built in the pole frame so they co-rotate with the sky. */
      var BETA = 0.62;                       /* band axis tilt from the pole  */
      var nb = [Math.cos(BETA), Math.sin(BETA), 0];
      var e1 = [0, 0, 1];
      var e2 = [nb[1] * e1[2] - nb[2] * e1[1],
                nb[2] * e1[0] - nb[0] * e1[2],
                nb[0] * e1[1] - nb[1] * e1[0]];
      for (i = N; i < NT; i++) {
        var u = rnd() * TAU;
        var off = (rnd() + rnd() + rnd() - 1.5) * 0.24;   /* gaussian-ish band */
        var co = Math.cos(off), so = Math.sin(off);
        var vx0 = co * (Math.cos(u) * e1[0] + Math.sin(u) * e2[0]) + so * nb[0];
        var vy0 = co * (Math.cos(u) * e1[1] + Math.sin(u) * e2[1]) + so * nb[1];
        var vz0 = co * (Math.cos(u) * e1[2] + Math.sin(u) * e2[2]) + so * nb[2];
        sLat[i] = Math.acos(vx0 < -1 ? -1 : vx0 > 1 ? 1 : vx0);
        sPh[i] = Math.atan2(vz0, vy0);
        var bm = rnd();
        sB[i] = 0.07 + 0.20 * bm;
        sS[i] = 1;
        sC[i] = bm < 0.6 ? 1 : (bm < 0.9 ? 0 : 2);
        sT[i] = rnd() * TAU;
        sIv[i] = 0.08;                       /* far layer: barely parallaxes  */
        sLw[i] = 0.6;
        sAf[i] = 1;
      }
    })();

    /* where each star starts before it flies to its place in the sky */
    var gX = new Float32Array(NT), gY = new Float32Array(NT);
    for (var gi = 0; gi < NT; gi++) { gX[gi] = rnd() * 2.2 - 0.6; gY[gi] = rnd() * 2.2 - 0.6; }

    /* color LUT */
    var ALV = 20, LUT = [];
    (function () {
      for (var c = 0; c < COLS.length; c++)
        for (var a = 0; a < ALV; a++)
          LUT.push('rgba(' + COLS[c][0] + ',' + COLS[c][1] + ',' + COLS[c][2] +
                   ',' + ((a + 1) / ALV).toFixed(3) + ')');
    })();

    /* soft radial glow sprites — comet heads, bokeh, meteor */
    function makeGlow(r, g2, b3) {
      var c = document.createElement('canvas'); c.width = c.height = 64;
      var gx = c.getContext('2d');
      var gr = gx.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,0.9)');
      gr.addColorStop(0.25, 'rgba(' + r + ',' + g2 + ',' + b3 + ',0.42)');
      gr.addColorStop(1, 'rgba(' + r + ',' + g2 + ',' + b3 + ',0)');
      gx.fillStyle = gr; gx.fillRect(0, 0, 64, 64);
      return c;
    }
    var glowCool = makeGlow(190, 205, 220);
    var glowWarm = makeGlow(215, 190, 175);
    var glowBlue = makeGlow(150, 188, 252);

    /* out-of-focus near lights (bokeh) — the nearest depth layer */
    var NB = 14;
    var kLat = new Float32Array(NB), kPh = new Float32Array(NB),
        kSz = new Float32Array(NB), kAl = new Float32Array(NB), kIv = new Float32Array(NB);
    (function () {
      for (var i = 0; i < NB; i++) {
        kLat[i] = Math.acos(1 - 2 * rnd());
        kPh[i] = rnd() * TAU;
        kSz[i] = 10 + rnd() * 18;
        kAl[i] = 0.08 + rnd() * 0.12;
        kIv[i] = 1.15 + rnd() * 0.5;
      }
    })();

    /* per-arc scratch buffers + meteor state */
    var APX = new Float32Array(SEGS + 1), APY = new Float32Array(SEGS + 1);
    var APOK = new Uint8Array(SEGS + 1);
    /* Reject only paths whose valid points all lie beyond the same screen
       edge. A head off-screen can still have a visible tail, so test the whole
       projected polyline, not just the star. The gutter includes wide halos,
       antialiasing and the canvas's default miter joins. */
    function arcVisible(first, last, width, height, gutter) {
      var common = 15;
      for (var k = first; k <= last; k++) {
        if (!APOK[k]) continue;
        var side = 0, x = APX[k], y = APY[k];
        if (x < -gutter) side |= 1;
        else if (x > width + gutter) side |= 2;
        if (y < -gutter) side |= 4;
        else if (y > height + gutter) side |= 8;
        common &= side;
        if (!common) return true;
      }
      return false;
    }
    /* exposure cycle: trails GROW from a fixed anchor (the sky position where
       this exposure began); when the exposure completes, it freezes and
       dissolves while the next one is already growing — like a live-photo
       star-trail timelapse looping forever. */
    var EXPOSE = 0.55;          /* arc length a full exposure reaches (rad)   */
    var FADE_S = 8.0;           /* seconds for a finished exposure to dissolve */
    var expA = (reduced || BGMODE) ? -0.35 : 0;   /* exposure starts empty: dots only,
                                         trails grow from nothing (static arcs
                                         under prefers-reduced-motion) */
    var oldA = 0, oldB = 0, oldT = -1e9, oldOn = 0;

    /* ---------------- landscape: two ridge lines, height by azimuth ------
       far = mountains (blue haze), near = rolling hills (near-black). The
       near ridge's pattern slides a little faster with yaw — cheap parallax
       that makes the scene read as deep. */
    function wrapd(q, c) {
      var d = (q - c) % TAU;
      if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU;
      return d;
    }
    function ridgeFar(q) {
      /* folded sines make creased, mountain-like ridges */
      var a = Math.sin(q * 0.75 + 2.0), b = Math.sin(q * 1.9 + 0.8);
      var v = 0.014 + 0.062 * Math.pow(a < 0 ? -a : a, 1.4) +
              0.036 * (b < 0 ? -b : b) +
              0.016 * Math.sin(q * 3.4 + 4.0) + 0.006 * Math.sin(q * 7.1 + 1.5);
      /* two landmark summits fixed on the panorama */
      var d1 = wrapd(q, 0.15);
      v += 0.148 * Math.exp(-d1 * d1 * 12.0);
      var d2 = wrapd(q, 1.90);
      v += 0.092 * Math.exp(-d2 * d2 * 16.0);
      return v < 0.004 ? 0.004 : v;
    }
    function ridgeNear(q) {
      var a = Math.sin(q * 1.3 + 3.1);
      var v = 0.006 + 0.030 * (a < 0 ? -a : a) +
              0.013 * Math.sin(q * 2.9 + 0.4) * Math.sin(q * 2.9 + 0.4) +
              0.005 * Math.sin(q * 6.3 + 2.2);
      var d1 = wrapd(q, 0.42);
      v += 0.024 * Math.exp(-d1 * d1 * 12.0);      /* foothill beside the summit */
      return v < 0.003 ? 0.003 : v;
    }
    var PARX = 0.28;            /* extra azimuthal slide of the near ridge   */
    var LIGHTS = [
      { az: -0.55, r: 170, g: 190, bl: 220, al: 0.45, sz: 9 },
      { az: 0.85, r: 205, g: 185, bl: 155, al: 0.32, sz: 6 },
      { az: 2.6, r: 185, g: 175, bl: 160, al: 0.26, sz: 6 }
    ];

    /* ---------------- sizing / baked sky ---------------- */
    var W = 2, H = 2, dpr = 1;
    var sky = document.createElement('canvas'); var skx = sky.getContext('2d');
    function bake() {
      sky.width = canvas.width; sky.height = canvas.height;
      var g = skx.createLinearGradient(0, 0, 0, sky.height);
      g.addColorStop(0, '#0a0f15');
      g.addColorStop(0.6, '#151c24');
      g.addColorStop(1, '#1f262e');
      skx.fillStyle = g;
      skx.fillRect(0, 0, sky.width, sky.height);
    }
    function resize() {
      W = host.clientWidth || 2; H = host.clientHeight || 2;
      dpr = Math.min(1.5, window.devicePixelRatio || 1);   /* fill-rate headroom */
      canvas.width = Math.max(2, Math.round(W * dpr));
      canvas.height = Math.max(2, Math.round(H * dpr));
      bake();
      schedule();               /* also repaint a fixed-clock preview after resize */
    }
    window.addEventListener('resize', resize);
    resize();

    /* ---------------- camera ---------------- */
    var yaw = 0, pitch = PITCH0, fov = FOV0;
    /* the sky can be dragged (yaw/pitch); double-click resets the view. There is
       deliberately no wheel zoom, so the page keeps scrolling over the hero. */
    var vyaw = 0, vpitch = 0, dragging = false, lx = 0, ly = 0, resetting = false;
    var lastUser = -1e9;        /* cinematic drift runs until someone touches */
    var PMAX = 1.35, PMIN = -0.06;

    canvas.style.cursor = 'grab';
    canvas.style.touchAction = 'pan-y';
    canvas.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'touch') return;          /* phones scroll; no drag there */
      dragging = true; resetting = false; lx = e.clientX; ly = e.clientY;
      vyaw = vpitch = 0; lastUser = performance.now();
      canvas.style.cursor = 'grabbing';
      if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
    });
    window.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      var k = fov / (H || 1);
      yaw -= dx * k; pitch += dy * k;
      if (pitch > PMAX) pitch = PMAX; if (pitch < PMIN) pitch = PMIN;
      vyaw = -dx * k; vpitch = dy * k; lastUser = performance.now();
    });
    function endDrag() { dragging = false; canvas.style.cursor = 'grab'; }
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('dblclick', function () { resetting = true; });


    /* ---------------- frame loop ---------------- */
    var prevNow = -1, phi = 0, idleT = 0;
    var hx = new Float32Array(160), hy = new Float32Array(160);
    var fieldVisible = true;
    var active = !document.hidden;
    var raf = 0;
    

    function schedule() {
      if (active && !raf) raf = window.requestAnimationFrame(frame);
    }

    if (JOURNEY) window.addEventListener('rsi-sky-view', function (event) {
      var p = event.detail && event.detail.progress;
      if (typeof p !== 'number' || !isFinite(p)) return;
      viewProgress = Math.max(0, Math.min(1, p));
      schedule();               /* move the camera without restarting the exposure */
    });

    function syncActive() {
      var next = fieldVisible && !document.hidden;
      if (next === active) return;
      active = next;
      prevNow = -1;
      if (active) schedule();
      else if (raf) { window.cancelAnimationFrame(raf); raf = 0; }
    }

    document.addEventListener('visibilitychange', syncActive);
    window.addEventListener('rsi-sky-visibility', function (event) {
      fieldVisible = !(event.detail && event.detail.visible === false);
      syncActive();
    });
    var t0 = -1;
    window.addEventListener('rsi-sky-replay', function () {
      t0 = -1; phi = 0; expA = 0; oldOn = 0; oldT = -1e9; idleT = 0; resetting = true;
      schedule();
    });

    function frame(now) {
      raf = 0;
      if (!active) return;
      if (prevNow < 0) prevNow = now;
      var dt = (now - prevNow) / 1000; prevNow = now;
      if (dt > 0.05) dt = 0.05; if (dt < 0) dt = 0;

      if (!reduced) phi += OMEGA * dt;

      if (resetting) {
        var kk = 1 - Math.pow(0.002, dt);
        var dy2 = -yaw; dy2 -= TAU * Math.round(dy2 / TAU);
        yaw += dy2 * kk;
        pitch += (PITCH0 - pitch) * kk;
        fov += (FOV0 - fov) * kk;
        if (Math.abs(dy2) < 0.003 && Math.abs(pitch - PITCH0) < 0.003 &&
            Math.abs(fov - FOV0) < 0.003) resetting = false;
      } else if (!dragging) {
        if (Math.abs(vyaw) > 1e-5 || Math.abs(vpitch) > 1e-5) {
          yaw += vyaw; pitch += vpitch;
          if (pitch > PMAX) pitch = PMAX; if (pitch < PMIN) pitch = PMIN;
          var dec = Math.pow(0.93, dt * 60);
          vyaw *= dec; vpitch *= dec;
        }
      }

      /* cinematic idle drift: the viewpoint orbits AROUND the home view —
         swinging left and right of the pole, breathing in pitch and FOV, and
         always gliding back to center. Pauses while the user interacts. */
      if (!reduced && !dragging && !resetting &&
          Math.abs(vyaw) < 1e-4 && Math.abs(vpitch) < 1e-4 &&
          now - lastUser > 1800) {
        idleT += dt;
        var yT = 0.055 * Math.sin(idleT * 0.09) + 0.02 * Math.sin(idleT * 0.031 + 0.8);
        var pT = PITCH0 + 0.018 * Math.sin(idleT * 0.12 + 1.1);
        var fT = FOV0 + 0.022 * Math.sin(idleT * 0.07 + 1.7);
        var kb = 1 - Math.pow(0.45, dt);
        var dyw = yT - yaw; dyw -= TAU * Math.round(dyw / TAU);
        yaw += dyw * kb;
        pitch += (pT - pitch) * kb;
        fov += (fT - fov) * kb;
      }

      var w = canvas.width, h = canvas.height;
      /* portrait: the principal point sits high, so the pole lands behind the title */
      var cx2 = w / 2, cy2 = (h > w) ? h * 0.44 : h / 2;
      /* portrait screens: widen the view by the aspect so the whole vortex fits
         the phone instead of a zoomed-in slice of it */
      var fv = (h > w) ? Math.min(2.5, fov * (h / w)) : fov;
      var focal = (h / 2) / Math.tan(fv / 2);

      var viewPitch = pitch;
      if (JOURNEY) {
        /* Smooth endpoints without temporal lag: reversing the scroll retraces
           exactly the same view. Keep the artwork and sky on one frame clock. */
        if (reduced) viewDrawn = viewProgress;
        else {
          viewDrawn += (viewProgress - viewDrawn) * (1 - Math.exp(-VIEW_LAMBDA * dt));
          if (Math.abs(viewProgress - viewDrawn) < 0.0006) viewDrawn = viewProgress;
          else schedule();      /* keep moving until the camera has settled */
        }
        var view = viewDrawn * viewDrawn * (3 - 2 * viewDrawn);
        if (view !== lastView) {
          host.parentNode.style.setProperty('--sky-view', view.toFixed(5));
          lastView = view;
        }
        /* Lower the gaze, keeping the pole at ~16% height at the destination.
           Derive the angle from FOV so portrait screens retain the same view.
           OS reduced motion uses a stationary sky and a simple mountain fade;
           the static screenshot flag alone still permits camera positioning. */
        if (!(mq && mq.matches)) {
          var poleStart = cy2 - focal * Math.tan(POLE_ALT - PITCH0);
          /* Compact landscape can already place the pole above 16%: never
             reverse the camera just to reach the portrait composition. */
          var poleEnd = Math.min(h * 0.16, poleStart * 0.5);
          var endPitch = POLE_ALT - Math.atan((cy2 - poleEnd) / focal);
          viewPitch += view * (endPitch - PITCH0);
        }
      }

      /* camera basis: forward at (yaw, pitch); x=north z=east y=up */
      var cyw = Math.cos(yaw), syw = Math.sin(yaw);
      var cpt = Math.cos(viewPitch), spt = Math.sin(viewPitch);
      var Fx = cyw * cpt, Fy = spt, Fz = syw * cpt;
      var Rx = -syw, Ry = 0, Rz = cyw;
      var Ux = -cyw * spt, Uy = cpt, Uz = -syw * spt;

      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.drawImage(sky, 0, 0);
      /* trails draw in source-over: overlapping arcs must keep their own
         color instead of adding up to white */

      /* ---------------- star arcs (comet-style) ---------------- */
      if (t0 < 0) t0 = now;
      var t = (now - t0) / 1000;
      if (FIXT >= 0) { t = FIXT; phi = OMEGA * FIXT; }
      var g = reduced ? 1 : easeOut(t / GATHER);      /* the cloud gathers   */
      /* slow orbital drift of the camera position: near stars sway more than
         far ones — genuine parallax layers */
      var ox = 0, oy = 0, oz = 0;
      if (!reduced) {
        ox = PLAX * Math.sin(t * 0.16);
        oy = PLAX * 0.4 * Math.sin(t * 0.09 + 1.3);
        oz = PLAX * Math.cos(t * 0.13);
      }
      /* advance the exposure cycle (first 2.5s: stars only, no exposure) */
      if (!reduced) {
        if (!BGMODE && t < GATHER) {
          /* no exposure while the cloud is still flying in */
          expA = phi;
        } else if (!BGMODE) {
          /* the exposure opens at the sky's own speed (the tail stays where it
             was when the cloud settled) and then simply holds: the tail follows
             the head around the pole, nothing dissolves and nothing restarts */
          if (phi - expA >= EXPOSE) expA = phi - EXPOSE;
        } else if (phi - expA >= EXPOSE) {
          oldA = expA; oldB = phi; oldT = t; oldOn = 1;
          expA = phi;
        }
        if (oldOn && t - oldT > FADE_S) oldOn = 0;
      }
      var oldAl = oldOn ? 1 - (t - oldT) / FADE_S : 0;
      if (oldAl < 0) oldAl = 0;

      var minDot = Math.cos(fv * 0.5 + 0.50 * (w / h) * fv);
      var strokeGutter = 32 * dpr;
      for (var i = 0; i < NT; i++) {
        var sl = Math.sin(sLat[i]), cl = Math.cos(sLat[i]);
        var ph0 = sPh[i] + phi;
        var ivd = sIv[i];
        var ca = Math.cos(ph0), sa = Math.sin(ph0);
        var dx3 = cl * P[0] + sl * (ca * A[0] + sa * B[0]) - ox * ivd;
        var dy3 = cl * P[1] + sl * (ca * A[1] + sa * B[1]) - oy * ivd;
        var dz3 = cl * P[2] + sl * (ca * A[2] + sa * B[2]) - oz * ivd;
        var fdot = dx3 * Fx + dy3 * Fy + dz3 * Fz;
        if (fdot < minDot) continue;

        var b2 = (sB[i] - 0.14) / 0.86; if (b2 < 0) b2 = 0;
        var tw = 0.90 + 0.10 * Math.sin(t * 2.6 + sT[i]);
        var ext = (dy3 - 0.01) / 0.16;
        if (ext > 1) ext = 1; if (ext < 0.22) ext = 0.22;
        var headA = sB[i] * tw * ext;

        if (g < 1) {
          /* still flying in: the head only, blended from its start position */
          if (fdot < 0.18) continue;
          var ginv = focal / fdot;
          var gsx = cx2 + (dx3 * Rx + dy3 * Ry + dz3 * Rz) * ginv;
          var gsy = cy2 - (dx3 * Ux + dy3 * Uy + dz3 * Uz) * ginv;
          gsx = gX[i] * w + (gsx - gX[i] * w) * g;
          gsy = gY[i] * h + (gsy - gY[i] * h) * g;
          var gq = (headA * g * ALV) | 0; if (gq >= ALV) gq = ALV - 1;
          if (gq >= 1) {
            if (i < N && b2 > 0.85) {
              var ggs = (4 + 6 * b2) * dpr;
              ctx.globalCompositeOperation = 'lighter';
              ctx.globalAlpha = headA * g * 0.35;
              ctx.drawImage(sC[i] >= 6 ? glowBlue : (sC[i] >= 4 ? glowWarm : glowCool),
                            gsx - ggs / 2, gsy - ggs / 2, ggs, ggs);
              ctx.globalAlpha = 1;
              ctx.globalCompositeOperation = 'source-over';
            }
            ctx.fillStyle = LUT[sC[i] * ALV + gq];
            var gs4 = (i >= N ? 1 : sS[i]) * dpr;
            ctx.fillRect(gsx - gs4 * 0.5, gsy - gs4 * 0.5, gs4, gs4);
          }
          continue;
        }

        if (i >= N) {
          /* Milky-Way micro star: a single faint point, no trail */
          var qm = (headA * ALV) | 0; if (qm >= ALV) qm = ALV - 1;
          if (qm >= 1 && fdot > 0.18) {
            var invm = focal / fdot;
            var mx = cx2 + (dx3 * Rx + dy3 * Ry + dz3 * Rz) * invm;
            var my = cy2 - (dx3 * Ux + dy3 * Uy + dz3 * Uz) * invm;
            ctx.fillStyle = LUT[sC[i] * ALV + qm];
            ctx.fillRect(mx - 0.5 * dpr, my - 0.5 * dpr, dpr, dpr);
          }
          continue;
        }

        /* ---- the two exposures: current (growing) + old (frozen, fading) */
        var hOK = 0, hX = 0, hY = 0;
        for (var epi = 0; epi < 2; epi++) {
          var aHead, epAl;
          if (epi === 0) { aHead = phi; epAl = 1; }
          else { if (!oldOn || oldAl <= 0.02) continue; aHead = oldB; epAl = oldAl; }
          var aTail = epi === 0 ? expA : oldA;
          var L = aHead - aTail;
          if (L < 0.003) {
            /* no trail yet — still show the star itself */
            if (epi === 0) {
              var ah = sPh[i] + aHead;
              var ch = Math.cos(ah), sh = Math.sin(ah);
              var wx = cl * P[0] + sl * (ch * A[0] + sh * B[0]) - ox * ivd;
              var wy = cl * P[1] + sl * (ch * A[1] + sh * B[1]) - oy * ivd;
              var wz = cl * P[2] + sl * (ch * A[2] + sh * B[2]) - oz * ivd;
              var wf = wx * Fx + wy * Fy + wz * Fz;
              if (wf > 0.18) {
                var wi = focal / wf;
                hX = cx2 + (wx * Rx + wy * Ry + wz * Rz) * wi;
                hY = cy2 - (wx * Ux + wy * Uy + wz * Uz) * wi;
                hOK = 1;
              }
            }
            continue;
          }
          var ns = (L * 18) | 0; if (ns < 2) ns = 2; if (ns > SEGS) ns = SEGS;
          var stepE = L / ns;
          var nOK = 0;
          for (var k2 = 0; k2 <= ns; k2++) {
            var aa = sPh[i] + aHead - stepE * k2;
            var c2 = Math.cos(aa), s2 = Math.sin(aa);
            var vx = cl * P[0] + sl * (c2 * A[0] + s2 * B[0]) - ox * ivd;
            var vy = cl * P[1] + sl * (c2 * A[1] + s2 * B[1]) - oy * ivd;
            var vz = cl * P[2] + sl * (c2 * A[2] + s2 * B[2]) - oz * ivd;
            var f2 = vx * Fx + vy * Fy + vz * Fz;
            if (f2 < 0.18) { APOK[k2] = 0; continue; }
            var inv = focal / f2;
            APX[k2] = cx2 + (vx * Rx + vy * Ry + vz * Rz) * inv;
            APY[k2] = cy2 - (vx * Ux + vy * Uy + vz * Uz) * inv;
            APOK[k2] = 1; nOK++;
          }
          if (!nOK || !arcVisible(0, ns, w, h, strokeGutter)) continue;
          if (epi === 0 && APOK[0]) { hOK = 1; hX = APX[0]; hY = APY[0]; }

          var trailA = sB[i] * ext * epAl * 0.92;   /* uniform, video-metered  */

          /* soft photographic halo under the brightest trails */
          if (b2 > 0.72) {
            var qh = (trailA * 0.13 * ALV) | 0; if (qh >= ALV) qh = ALV - 1;
            if (qh >= 1) {
              ctx.strokeStyle = LUT[sC[i] * ALV + qh];
              ctx.lineWidth = sLw[i] * 2.8 * dpr;
              ctx.beginPath();
              var pen0 = false;
              for (k2 = 0; k2 <= ns; k2++) {
                if (!APOK[k2]) { pen0 = false; continue; }
                if (pen0) ctx.lineTo(APX[k2], APY[k2]);
                else { ctx.moveTo(APX[k2], APY[k2]); pen0 = true; }
              }
              ctx.stroke();
            }
          }

          /* the trail: chunks of two segments; opacity and width breathe
             along the arc (seeing / thin cloud during the exposure). The
             modulation is keyed to the absolute angle on the star's circle,
             so the pattern stays glued to the trail as it grows. */
          var pA = sT[i] * 7.3, pB = sT[i] * 12.7;
          for (var ch0 = 0; ch0 < ns; ch0 += 2) {
            var ch1 = ch0 + 2; if (ch1 > ns) ch1 = ns;
            if (!arcVisible(ch0, ch1, w, h, strokeGutter)) continue;
            var aMid = sPh[i] + aHead - stepE * (ch0 + ch1) * 0.5;
            var am = 0.72 + 0.28 * Math.sin(aMid * 19 + pA);
            var wm2 = 0.76 + 0.30 * Math.sin(aMid * 11 + pB);
            var tailK = (ch0 + ch1) * 0.5 / ns;
            var endF = tailK > 0.72 ? 1 - (tailK - 0.72) * 1.8 : 1;
            if (endF < 0.35) endF = 0.35;
            var q = (trailA * sAf[i] * am * endF * ALV) | 0;
            if (q >= ALV) q = ALV - 1;
            if (q < 1) continue;
            ctx.strokeStyle = LUT[sC[i] * ALV + q];
            ctx.lineWidth = sLw[i] * wm2 * dpr;
            ctx.beginPath();
            var pen1 = false;
            for (k2 = ch0; k2 <= ch1; k2++) {
              if (!APOK[k2]) { pen1 = false; continue; }
              if (pen1) ctx.lineTo(APX[k2], APY[k2]);
              else { ctx.moveTo(APX[k2], APY[k2]); pen1 = true; }
            }
            ctx.stroke();
          }
        }

        /* head: the star itself, twinkling at the growing tip */
        if (hOK) {
          var q0 = (headA * ALV) | 0; if (q0 >= ALV) q0 = ALV - 1;
          if (q0 >= 1) {
            if (b2 > 0.85) {
              var gs = (4 + 6 * b2) * dpr;
              ctx.globalCompositeOperation = 'lighter';
              ctx.globalAlpha = headA * 0.35;
              ctx.drawImage(sC[i] >= 6 ? glowBlue : (sC[i] >= 4 ? glowWarm : glowCool),
                            hX - gs / 2, hY - gs / 2, gs, gs);
              ctx.globalAlpha = 1;
              ctx.globalCompositeOperation = 'source-over';
            }
            ctx.fillStyle = LUT[sC[i] * ALV + q0];
            var s4 = sS[i] * dpr;
            ctx.fillRect(hX - s4 * 0.5, hY - s4 * 0.5, s4, s4);
          }
        }
      }
      ctx.lineWidth = 1 * dpr;

      /* -------- bokeh: big soft out-of-focus lights, nearest layer -------- */
      ctx.globalCompositeOperation = 'lighter';
      var landA = g;
      for (i = 0; i < (BGMODE ? 0 : NB); i++) {
        var bl = Math.sin(kLat[i]), bc = Math.cos(kLat[i]);
        var bp = kPh[i] + phi;
        var bca = Math.cos(bp), bsa = Math.sin(bp);
        var bx3 = bc * P[0] + bl * (bca * A[0] + bsa * B[0]) - ox * kIv[i];
        var by3 = bc * P[1] + bl * (bca * A[1] + bsa * B[1]) - oy * kIv[i];
        var bz3 = bc * P[2] + bl * (bca * A[2] + bsa * B[2]) - oz * kIv[i];
        var bf = bx3 * Fx + by3 * Fy + bz3 * Fz;
        if (bf < 0.25 || by3 < 0.02) continue;
        var binv = focal / bf;
        var bsx = cx2 + (bx3 * Rx + by3 * Ry + bz3 * Rz) * binv;
        var bsy = cy2 - (bx3 * Ux + by3 * Uy + bz3 * Uz) * binv;
        var bgs = kSz[i] * dpr * (0.9 + 0.18 * Math.sin(t * 0.6 + i * 1.9));
        ctx.globalAlpha = kAl[i] * landA;
        ctx.drawImage(i % 3 === 2 ? glowWarm : glowCool,
                      bsx - bgs / 2, bsy - bgs / 2, bgs, bgs);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      /* ------------- landscape: far mountains, then near hills ------------ */
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = landA;
      var span = fv * (w / h) + 1.2;
      var M = 160;
      for (var rg = 0; rg < ((BGMODE || NOLAND) ? 0 : 2); rg++) {
        var isNear = rg === 1;
        var par = isNear ? PARX : 0;
        var got = 0, anyBelow = false, topY = 1e9;
        for (var m = 0; m < M; m++) {
          var az = yaw + (m / (M - 1) - 0.5) * span;
          var alt = isNear ? ridgeNear(az + par * yaw) : ridgeFar(az);
          var gx = Math.cos(az) * Math.cos(alt), gy = Math.sin(alt), gz = Math.sin(az) * Math.cos(alt);
          var gf = gx * Fx + gy * Fy + gz * Fz;
          if (gf < 0.15) continue;
          var gi = focal / gf;
          hx[got] = cx2 + (gx * Rx + gy * Ry + gz * Rz) * gi;
          hy[got] = cy2 - (gx * Ux + gy * Uy + gz * Uz) * gi;
          if (hy[got] < h + 4) anyBelow = true;
          if (hy[got] < topY) topY = hy[got];
          got++;
        }
        if (got < 2 || !anyBelow) continue;

        if (!isNear) {
          /* faint warm haze breathing over the mountain line */
          var glow = ctx.createLinearGradient(0, topY - h * 0.15, 0, topY + h * 0.10);
          glow.addColorStop(0, 'rgba(140,150,160,0)');
          glow.addColorStop(0.6, 'rgba(140,150,160,0.08)');
          glow.addColorStop(1, 'rgba(140,150,160,0)');
          ctx.fillStyle = glow;
          ctx.fillRect(0, topY - h * 0.15, w, h * 0.25);
        }

        ctx.beginPath();
        ctx.moveTo(hx[0], hy[0]);
        for (var m2 = 1; m2 < got; m2++) ctx.lineTo(hx[m2], hy[m2]);
        ctx.lineTo(w + 8, h + 8);
        ctx.lineTo(-8, h + 8);
        ctx.closePath();
        var gg = ctx.createLinearGradient(0, topY, 0, h);
        if (isNear) {
          gg.addColorStop(0, '#04060b'); gg.addColorStop(0.4, '#020408'); gg.addColorStop(1, '#020306');
        } else {
          gg.addColorStop(0, '#161d29'); gg.addColorStop(0.45, '#0e131c'); gg.addColorStop(1, '#090d13');
        }
        ctx.fillStyle = gg;
        ctx.fill();
        ctx.strokeStyle = isNear ? 'rgba(100,108,120,0.15)' : 'rgba(120,130,145,0.13)';
        ctx.lineWidth = 1 * dpr;
        ctx.stroke();

        if (isNear) {
          /* far lights pinned to the near ridge (they slide with its parallax) */
          for (var li = 0; li < LIGHTS.length; li++) {
            var L2 = LIGHTS[li];
            var laz = L2.az - par * yaw;
            var lalt = ridgeNear(L2.az) + 0.004;
            var lxv = Math.cos(laz) * Math.cos(lalt), lyv = Math.sin(lalt), lzv = Math.sin(laz) * Math.cos(lalt);
            var lf = lxv * Fx + lyv * Fy + lzv * Fz;
            if (lf < 0.2) continue;
            var li2 = focal / lf;
            var lsx = cx2 + (lxv * Rx + lyv * Ry + lzv * Rz) * li2;
            var lsy = cy2 - (lxv * Ux + lyv * Uy + lzv * Uz) * li2;
            var rad = L2.sz * dpr * (FOV0 / fov);
            var lg = ctx.createRadialGradient(lsx, lsy, 0, lsx, lsy, rad);
            lg.addColorStop(0, 'rgba(' + L2.r + ',' + L2.g + ',' + L2.bl + ',' + L2.al + ')');
            lg.addColorStop(1, 'rgba(' + L2.r + ',' + L2.g + ',' + L2.bl + ',0)');
            ctx.fillStyle = lg;
            ctx.fillRect(lsx - rad, lsy - rad, rad * 2, rad * 2);
          }
        }
      }
      ctx.globalAlpha = 1;
      if (FIXT >= 0) return;          /* a frozen clock renders one frame */
      schedule();
    }
    schedule();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
