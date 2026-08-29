/* RSI-Index — shared site scripts */
(function () {
  "use strict";

  /* ---------- mobile nav ---------- */
  var toggle = document.querySelector(".nav-toggle");
  var links = document.querySelector(".nav-links");
  if (toggle && links) {
    toggle.addEventListener("click", function () {
      links.classList.toggle("open");
      toggle.setAttribute("aria-expanded", links.classList.contains("open") ? "true" : "false");
    });
  }

  /* ---------- task domain filters (no-op if no filterbar) ---------- */
  var chips = document.querySelectorAll(".filterbar .chip");
  if (chips.length) {
    var sections = document.querySelectorAll(".track-section");
    chips.forEach(function (chip) {
      chip.addEventListener("click", function () {
        chips.forEach(function (c) { c.classList.remove("active"); });
        chip.classList.add("active");
        var dom = chip.getAttribute("data-domain");
        sections.forEach(function (s) {
          var show = dom === "all" || s.getAttribute("data-domain") === dom;
          s.style.display = show ? "" : "none";
        });
      });
    });
  }

  /* ---------- hero: the instrument ----------
     The RSI loop as a drawn instrument. Five modules ring a central
     revision gauge; an amber signal runs laps and leaves light where it
     has been. Verified laps advance the gauge and rewrite one piece of
     the schematic — superseded traces linger underneath as ghost layers,
     the palimpsest of earlier revisions. Failed laps ride the dashed
     reject bus and leave no mark.
     Pointer (≥900px): hover a module for its note, click to run a lap. */
  var canvas = document.getElementById("rsi-canvas");
  if (!canvas) return;

  var hero = canvas.closest(".hero") || canvas.parentElement;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var ctx = canvas.getContext("2d");

  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var rnd = mulberry32(20260829);

  var INK = "244,238,220";
  var AMBER = "240,155,60";
  var GREEN = "159,199,106";
  var PINK = "212,137,155";
  var MONO = "'Geist Mono', ui-monospace, monospace";
  var PIXEL = "Silkscreen, 'Geist Mono', monospace";

  var VW = 1000, VH = 620;
  var W = 0, H = 0, dpr = 1;
  var mouse = { x: 0, y: 0, inside: false };

  var glowS = null;
  function glowSprite() {
    if (glowS) return glowS;
    glowS = document.createElement("canvas");
    glowS.width = glowS.height = 64;
    var g = glowS.getContext("2d");
    var gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(" + AMBER + ",0.6)");
    gr.addColorStop(0.35, "rgba(" + AMBER + ",0.18)");
    gr.addColorStop(1, "rgba(" + AMBER + ",0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    return glowS;
  }

  /* ---- the instrument, hand-composed in virtual 1000×620 space ---- */
  var M = {
    propose: { x: 120, y: 250, w: 170, h: 60, label: "PROPOSE",
               note: "drafts the next hypothesis" },
    patch:   { x: 450, y: 70,  w: 170, h: 60, label: "PATCH",
               note: "edits the pinned source" },
    train:   { x: 780, y: 180, w: 190, h: 130, label: "TRAIN",
               note: "six rungs · fixed budget" },
    verify:  { x: 640, y: 480, w: 180, h: 60, label: "VERIFY",
               note: "clean image · fail → zero" },
    archive: { x: 200, y: 480, w: 190, h: 60, label: "ARCHIVE",
               note: "commit if the rerun is beaten" }
  };
  var DIAL = { x: 600, y: 312, r: 95 };

  var ROUTES = {
    A: { variants: [   // propose → patch
      [[290, 280], [350, 280], [350, 100], [450, 100]],
      [[290, 262], [326, 262], [326, 48], [520, 48], [520, 70]],
      [[290, 296], [372, 296], [372, 100], [450, 100]]
    ], cur: 0 },
    B: { variants: [   // patch → train
      [[620, 100], [860, 100], [860, 180]],
      [[620, 116], [724, 116], [724, 152], [860, 152], [860, 180]]
    ], cur: 0 },
    C: { variants: [   // train → verify
      [[860, 310], [860, 505], [820, 505]],
      [[860, 310], [860, 420], [908, 420], [908, 505], [820, 505]]
    ], cur: 0 },
    D: { variants: [   // verify → archive
      [[640, 505], [390, 505]],
      [[640, 522], [514, 522], [514, 505], [390, 505]]
    ], cur: 0 },
    E: { variants: [   // archive → propose (left return bus)
      [[200, 505], [86, 505], [86, 296], [120, 296]],
      [[200, 522], [64, 522], [64, 268], [120, 268]]
    ], cur: 0 }
  };
  var REJECT = [[730, 540], [730, 578], [96, 578], [96, 308], [120, 308]];
  var ORDER = ["A", "B", "C", "D", "E"];

  var rev = 41;
  var trainBars = [];
  var trainBarsOld = null, barsMorphT0 = 0;
  var stubs = [];
  var floats = [];
  var rewire = null;
  var verdict = null;
  var hoverMod = null;
  var ghosts = [];      // palimpsest: superseded route sets, oldest first

  /* atmosphere: fixed dust field */
  var dust = [];
  (function () {
    var dr = mulberry32(77);
    for (var i = 0; i < 46; i++) {
      dust.push({ x: dr() * VW, y: dr() * VH, r: 0.5 + dr() * 0.8, a: 0.04 + dr() * 0.09 });
    }
  })();

  function newBars() {
    var b = [];
    for (var i = 0; i < 6; i++) b.push(0.35 + rnd() * 0.6);
    return b;
  }
  trainBars = newBars();

  /* ---- lap state machine ---- */
  var lap = null;
  var nextLapAt = 0;

  function buildLap(ok) {
    var p = [];
    p.push({ kind: "travel", conn: "A", dur: 1100 });
    p.push({ kind: "dwell", at: "patch", dur: 700, fx: "patch" });
    p.push({ kind: "travel", conn: "B", dur: 900 });
    p.push({ kind: "dwell", at: "train", dur: 1900, fx: "train" });
    p.push({ kind: "travel", conn: "C", dur: 900 });
    p.push({ kind: "dwell", at: "verify", dur: 700, fx: "verify" });
    if (ok) {
      p.push({ kind: "travel", conn: "D", dur: 900 });
      p.push({ kind: "dwell", at: "archive", dur: 800, fx: "archive" });
      p.push({ kind: "travel", conn: "E", dur: 1100 });
    } else {
      p.push({ kind: "reject", dur: 1700 });
    }
    var acc = 0;
    for (var i = 0; i < p.length; i++) { p[i].t0 = acc; acc += p[i].dur; }
    return { plan: p, total: acc, t: 0, ok: ok, fired: {} };
  }
  function startLap() { lap = buildLap(rnd() < 0.78); }

  function snapshotRoutes() {
    var snap = {};
    for (var k in ROUTES) snap[k] = ROUTES[k].variants[ROUTES[k].cur];
    return snap;
  }

  function rewriteOnce(now) {
    var roll = rnd();
    if (roll < 0.45) {
      ghosts.push(snapshotRoutes());
      if (ghosts.length > 3) ghosts.shift();
      var pool = ["A", "B", "C", "D"].filter(function (k) { return ROUTES[k].variants.length > 1; });
      var k2 = pool[(rnd() * pool.length) | 0];
      var r = ROUTES[k2];
      var next = ((r.cur + 1 + ((rnd() * (r.variants.length - 1)) | 0)) % r.variants.length);
      rewire = { conn: k2, oldPts: r.variants[r.cur], t0: now };
      r.cur = next;
    } else if (roll < 0.75) {
      trainBarsOld = trainBars.slice();
      trainBars = newBars();
      barsMorphT0 = now;
    } else {
      var k3 = ORDER[(rnd() * ORDER.length) | 0];
      var pts = ROUTES[k3].variants[ROUTES[k3].cur];
      var si = (rnd() * (pts.length - 1)) | 0;
      var a = pts[si], b = pts[si + 1];
      var f = 0.3 + rnd() * 0.4;
      var px2 = a[0] + (b[0] - a[0]) * f, py2 = a[1] + (b[1] - a[1]) * f;
      var horiz = Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1]);
      var L = 20 + rnd() * 16, sgn = rnd() < 0.5 ? -1 : 1;
      var ex = horiz ? px2 : px2 + sgn * L;
      var ey = horiz ? py2 + sgn * L : py2;
      stubs.push({ x1: px2, y1: py2, x2: ex, y2: ey, sq: rnd() < 0.5, t0: now });
      if (stubs.length > 8) stubs.shift();
    }
  }

  /* ---- geometry ---- */
  var trail = null, trailCtx = null;   // accumulated light
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var rect = canvas.getBoundingClientRect();
    W = rect.width; H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    trail = document.createElement("canvas");
    trail.width = canvas.width; trail.height = canvas.height;
    trailCtx = trail.getContext("2d");
    trailCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function region() {
    var narrow = W < 900;
    return { narrow: narrow, x0: narrow ? W * 0.03 : W * 0.40, x1: W * 0.985, y0: H * 0.04, y1: H * 0.96 };
  }
  function mx(rg, vx) { return rg.x0 + (vx / VW) * (rg.x1 - rg.x0); }
  function my(rg, vy) { return rg.y0 + (vy / VH) * (rg.y1 - rg.y0); }

  function pathLen(pts) {
    var L = 0;
    for (var i = 1; i < pts.length; i++) L += Math.abs(pts[i][0] - pts[i - 1][0]) + Math.abs(pts[i][1] - pts[i - 1][1]);
    return L;
  }
  function pointAt(pts, f) {
    var total = pathLen(pts), d = f * total;
    for (var i = 1; i < pts.length; i++) {
      var seg = Math.abs(pts[i][0] - pts[i - 1][0]) + Math.abs(pts[i][1] - pts[i - 1][1]);
      if (d <= seg || i === pts.length - 1) {
        var g = seg ? d / seg : 1;
        return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * g,
                pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * g];
      }
      d -= seg;
    }
    return pts[pts.length - 1];
  }
  function easeIO(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  /* ---- drawing ---- */
  function tracePath(g, rg, pts, off) {
    var ox = off || 0;
    g.beginPath();
    var R = 7;
    for (var i = 0; i < pts.length; i++) {
      var X = mx(rg, pts[i][0]) + ox, Y = my(rg, pts[i][1]) + ox * 0.7;
      if (i === 0) g.moveTo(X, Y);
      else if (i < pts.length - 1) {
        var nx = mx(rg, pts[i + 1][0]) + ox, ny = my(rg, pts[i + 1][1]) + ox * 0.7;
        g.arcTo(X, Y, nx, ny, R);
      } else g.lineTo(X, Y);
    }
  }
  function drawTrace(rg, pts, alpha, withVias) {
    ctx.strokeStyle = "rgba(" + INK + "," + alpha + ")";
    ctx.lineWidth = 1;
    tracePath(ctx, rg, pts, 0);
    ctx.stroke();
    if (withVias) {
      for (var i = 1; i < pts.length - 1; i++) {
        ctx.beginPath();
        ctx.arc(mx(rg, pts[i][0]), my(rg, pts[i][1]), 2, 0, 7);
        ctx.stroke();
      }
    }
  }
  function drawPartialTrace(rg, pts, f, alpha, color) {
    var total = pathLen(pts), target = f * total, acc = 0;
    ctx.strokeStyle = "rgba(" + (color || INK) + "," + alpha + ")";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mx(rg, pts[0][0]), my(rg, pts[0][1]));
    for (var i = 1; i < pts.length; i++) {
      var seg = Math.abs(pts[i][0] - pts[i - 1][0]) + Math.abs(pts[i][1] - pts[i - 1][1]);
      if (acc + seg <= target) {
        ctx.lineTo(mx(rg, pts[i][0]), my(rg, pts[i][1]));
        acc += seg;
      } else {
        var g = seg ? (target - acc) / seg : 0;
        ctx.lineTo(mx(rg, pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * g),
                   my(rg, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * g));
        break;
      }
    }
    ctx.stroke();
  }

  function trainT0(l) {
    for (var i = 0; i < l.plan.length; i++) if (l.plan[i].at === "train") return l.plan[i].t0;
    return 0;
  }
  function segAt(l) {
    for (var i = l.plan.length - 1; i >= 0; i--) if (l.t >= l.plan[i].t0) return l.plan[i];
    return l.plan[0];
  }

  function drawModule(rg, key, now, active) {
    var m = M[key];
    var X = mx(rg, m.x), Y = my(rg, m.y);
    var Wd = mx(rg, m.x + m.w) - X, Hd = my(rg, m.y + m.h) - Y;
    var hot = active || hoverMod === key;
    var a = hot ? 0.85 : 0.5;

    if (active) {
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.35;
      ctx.drawImage(glowSprite(), X + Wd / 2 - 55, Y + Hd / 2 - 55, 110, 110);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(" + AMBER + ",0.07)";
      ctx.fillRect(X, Y, Wd, Hd);
    }
    ctx.strokeStyle = hot ? "rgba(" + AMBER + ",0.8)" : "rgba(" + INK + "," + a + ")";
    ctx.lineWidth = 1;
    ctx.strokeRect(X, Y, Wd, Hd);

    ctx.strokeStyle = "rgba(" + INK + "," + (a * 0.6) + ")";
    for (var i = 1; i <= 3; i++) {
      var py2 = Y + (Hd * i) / 4;
      ctx.beginPath(); ctx.moveTo(X - 5, py2); ctx.lineTo(X, py2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(X + Wd, py2); ctx.lineTo(X + Wd + 5, py2); ctx.stroke();
    }

    ctx.font = "700 10px " + MONO;
    ctx.textAlign = "left";
    ctx.fillStyle = hot ? "rgba(" + AMBER + ",0.95)" : "rgba(" + INK + ",0.8)";
    ctx.fillText(m.label, X + 10, Y + 17);

    if (key === "train") {
      var innerX = X + 12, innerY = Y + 30;
      var innerW = Wd - 24, innerH = Hd - 44;
      var bw = innerW / 6;
      var fillN = 6;
      if (lap) {
        var seg = segAt(lap);
        if (seg && seg.at === "train") fillN = ((lap.t - seg.t0) / seg.dur) * 7;
        else if (seg && seg.t0 < trainT0(lap)) fillN = 0;
      }
      for (var b = 0; b < 6; b++) {
        var hgt = trainBars[b];
        if (trainBarsOld && now - barsMorphT0 < 900) {
          var mt = easeIO(Math.max(0, Math.min(1, (now - barsMorphT0) / 900)));
          hgt = trainBarsOld[b] + (trainBars[b] - trainBarsOld[b]) * mt;
        }
        var bh = innerH * hgt;
        var bx = innerX + b * bw + 1.5;
        ctx.strokeStyle = "rgba(" + INK + ",0.35)";
        ctx.strokeRect(bx, innerY + innerH - bh, bw - 3, bh);
        if (b < fillN) {
          ctx.fillStyle = "rgba(" + AMBER + "," + (0.55 * Math.min(1, fillN - b)) + ")";
          ctx.fillRect(bx, innerY + innerH - bh, bw - 3, bh);
        }
        ctx.font = "700 6.5px " + MONO;
        ctx.fillStyle = "rgba(" + INK + ",0.45)";
        ctx.fillText("E" + b, bx, innerY + innerH + 9);
      }
    }

    if (key === "archive") {
      ctx.font = "700 10px " + MONO;
      ctx.fillStyle = "rgba(" + AMBER + ",0.75)";
      ctx.fillText("#" + String(rev).padStart(3, "0"), X + 10, Y + Hd - 12);
    }
    if (key === "verify" && verdict && now - verdict.t0 < 1400) {
      var va = 1 - Math.max(0, (now - verdict.t0 - 800) / 600);
      ctx.font = "700 15px " + MONO;
      ctx.fillStyle = verdict.ok ? "rgba(" + GREEN + "," + va + ")" : "rgba(" + PINK + "," + va + ")";
      ctx.textAlign = "right";
      ctx.fillText(verdict.ok ? "✓" : "✗", X + Wd - 10, Y + 20);
      ctx.textAlign = "left";
    }

    if (hoverMod === key && !region().narrow) {
      ctx.font = "700 9px " + MONO;
      var note = m.note.toUpperCase();
      var tw = ctx.measureText(note).width;
      var nx2 = Math.min(X, mx(rg, VW) - tw - 8);
      ctx.strokeStyle = "rgba(" + INK + ",0.3)";
      ctx.beginPath();
      ctx.moveTo(X + Wd / 2, Y + Hd);
      ctx.lineTo(X + Wd / 2, Y + Hd + 12);
      ctx.stroke();
      ctx.fillStyle = "rgba(" + INK + ",0.75)";
      ctx.fillText(note, nx2, Y + Hd + 24);
    }
  }

  /* the central revision gauge */
  function drawDial(rg, now) {
    var cx = mx(rg, DIAL.x), cy = my(rg, DIAL.y);
    var R = (DIAL.r / VW) * (rg.x1 - rg.x0);

    /* soft heart-light behind the gauge */
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.16 + 0.05 * Math.sin(now / 2400);
    ctx.drawImage(glowSprite(), cx - R * 1.9, cy - R * 1.9, R * 3.8, R * 3.8);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;

    /* outer ring + ticks */
    ctx.strokeStyle = "rgba(" + INK + ",0.42)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
    for (var i = 0; i < 48; i++) {
      var th = (i / 48) * 6.2832 - 1.5708;
      var long = i % 4 === 0;
      var r1 = R - (long ? 9 : 5);
      ctx.strokeStyle = "rgba(" + INK + "," + (long ? 0.42 : 0.22) + ")";
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(th) * r1, cy + Math.sin(th) * r1);
      ctx.lineTo(cx + Math.cos(th) * (R - 1), cy + Math.sin(th) * (R - 1));
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(" + INK + ",0.14)";
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.74, 0, 7); ctx.stroke();

    /* lap progress arc */
    if (lap) {
      var prog = Math.min(1, lap.t / lap.total);
      var failing = !lap.ok && segAt(lap).kind === "reject";
      ctx.strokeStyle = failing ? "rgba(" + PINK + ",0.7)" : "rgba(" + AMBER + ",0.8)";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(cx, cy, R - 14, -1.5708, -1.5708 + prog * 6.2832);
      ctx.stroke();
      ctx.lineCap = "butt";
    }

    /* the number */
    var flash = lap && lap.ok && segAt(lap).at === "archive";
    ctx.textAlign = "center";
    ctx.font = "700 9px " + MONO;
    ctx.fillStyle = "rgba(" + INK + ",0.5)";
    ctx.fillText("REV", cx, cy - R * 0.34);
    ctx.font = "700 " + Math.round(R * 0.42) + "px " + PIXEL;
    ctx.fillStyle = flash ? "rgba(255,220,160,1)" : "rgba(" + AMBER + ",0.95)";
    ctx.fillText("#" + String(rev).padStart(3, "0"), cx, cy + R * 0.14);
    ctx.font = "700 7.5px " + MONO;
    ctx.fillStyle = "rgba(" + INK + ",0.38)";
    ctx.fillText("VERIFIED LOOP", cx, cy + R * 0.42);
    ctx.textAlign = "left";
  }

  function moduleAnchor(key) {
    var m = M[key];
    return [m.x + m.w / 2, m.y + m.h / 2];
  }
  function drawSignal(rg, P, color, dim) {
    var X = mx(rg, P[0]), Y = my(rg, P[1]);
    /* light left behind */
    if (trailCtx && !dim) {
      trailCtx.globalCompositeOperation = "lighter";
      trailCtx.globalAlpha = 0.13;
      trailCtx.drawImage(glowSprite(), X - 9, Y - 9, 18, 18);
      trailCtx.globalCompositeOperation = "source-over";
      trailCtx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = dim ? 0.35 : 0.85;
    ctx.drawImage(glowSprite(), X - 17, Y - 17, 34, 34);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(" + color + ",0.95)";
    ctx.beginPath(); ctx.arc(X, Y, 2.4, 0, 7); ctx.fill();
  }

  var frameN = 0;
  function draw(now) {
    frameN++;
    ctx.clearRect(0, 0, W, H);
    var rg = region();

    /* dust */
    for (var d2 = 0; d2 < dust.length; d2++) {
      var dd = dust[d2];
      ctx.fillStyle = "rgba(" + INK + "," + dd.a + ")";
      ctx.beginPath();
      ctx.arc(mx(rg, dd.x), my(rg, dd.y), dd.r, 0, 7);
      ctx.fill();
    }

    /* accumulated light, fading slowly */
    if (trailCtx) {
      if (frameN % 10 === 0) {
        trailCtx.save();
        trailCtx.globalCompositeOperation = "destination-out";
        trailCtx.fillStyle = "rgba(0,0,0,0.02)";
        trailCtx.fillRect(0, 0, W, H);
        trailCtx.restore();
      }
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(trail, 0, 0, W, H);
      ctx.globalCompositeOperation = "source-over";
    }

    /* registration marks */
    ctx.strokeStyle = "rgba(" + INK + ",0.25)";
    ctx.lineWidth = 1;
    [[20, 20], [980, 20], [20, 600], [980, 600]].forEach(function (c) {
      var X = mx(rg, c[0]), Y = my(rg, c[1]);
      ctx.beginPath(); ctx.moveTo(X - 4, Y); ctx.lineTo(X + 4, Y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(X, Y - 4); ctx.lineTo(X, Y + 4); ctx.stroke();
    });

    /* palimpsest: superseded revisions linger underneath */
    for (var gI = 0; gI < ghosts.length; gI++) {
      var depth = ghosts.length - gI;                 // oldest = deepest
      var ga = [0.055, 0.035, 0.022][depth - 1] || 0.02;
      ctx.strokeStyle = "rgba(" + INK + "," + ga + ")";
      ctx.lineWidth = 1;
      for (var gk in ghosts[gI]) {
        tracePath(ctx, rg, ghosts[gI][gk], depth * 3);
        ctx.stroke();
      }
    }

    /* stubs */
    for (var s = 0; s < stubs.length; s++) {
      var st = stubs[s];
      var ap = Math.max(0, Math.min(1, (now - st.t0) / 700)) * 0.22;
      ctx.strokeStyle = "rgba(" + INK + "," + ap + ")";
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(mx(rg, st.x1), my(rg, st.y1));
      ctx.lineTo(mx(rg, st.x2), my(rg, st.y2));
      ctx.stroke();
      ctx.setLineDash([]);
      if (st.sq) ctx.strokeRect(mx(rg, st.x2) - 2.5, my(rg, st.y2) - 2.5, 5, 5);
      else { ctx.beginPath(); ctx.arc(mx(rg, st.x2), my(rg, st.y2), 2.5, 0, 7); ctx.stroke(); }
    }

    /* reject bus, always faint */
    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = "rgba(" + PINK + ",0.14)";
    tracePath(ctx, rg, REJECT, 0);
    ctx.stroke();
    ctx.setLineDash([]);

    /* live traces */
    for (var k = 0; k < ORDER.length; k++) {
      var key = ORDER[k];
      if (rewire && rewire.conn === key) {
        var rt = now - rewire.t0;
        if (rt < 600) {
          drawPartialTrace(rg, rewire.oldPts, 1 - easeIO(Math.max(0, rt) / 600), 0.3);
        } else if (rt < 1500) {
          drawPartialTrace(rg, ROUTES[key].variants[ROUTES[key].cur], easeIO((rt - 600) / 900), 0.7, AMBER);
        } else {
          drawTrace(rg, ROUTES[key].variants[ROUTES[key].cur], 0.38, true);
          rewire = null;
        }
      } else {
        drawTrace(rg, ROUTES[key].variants[ROUTES[key].cur], 0.38, true);
      }
    }

    /* the gauge at the heart */
    drawDial(rg, now);

    /* lap: signal + effects */
    var activeMod = null;
    if (lap) {
      var seg = segAt(lap);
      var segT = Math.min(1, (lap.t - seg.t0) / seg.dur);
      if (seg.kind === "travel") {
        var pts = ROUTES[seg.conn].variants[ROUTES[seg.conn].cur];
        drawSignal(rg, pointAt(pts, easeIO(segT)), AMBER);
      } else if (seg.kind === "reject") {
        ctx.setLineDash([4, 5]);
        ctx.strokeStyle = "rgba(" + PINK + ",0.4)";
        tracePath(ctx, rg, REJECT, 0);
        ctx.stroke();
        ctx.setLineDash([]);
        drawSignal(rg, pointAt(REJECT, easeIO(segT)), PINK, true);
      } else {
        activeMod = seg.at;
        drawSignal(rg, moduleAnchor(seg.at), AMBER, true);
        if (!lap.fired[seg.t0]) {
          lap.fired[seg.t0] = true;
          if (seg.fx === "patch") {
            floats.push({ text: "+" + (6 + ((rnd() * 14) | 0)) + " −" + (1 + ((rnd() * 8) | 0)),
                          vx: M.patch.x + M.patch.w / 2, vy: M.patch.y - 8, t0: now, color: INK });
          } else if (seg.fx === "verify") {
            verdict = { ok: lap.ok, t0: now };
          } else if (seg.fx === "archive") {
            rev += 1;
            floats.push({ text: "#" + String(rev).padStart(3, "0") + " COMMITTED",
                          vx: M.archive.x + M.archive.w / 2, vy: M.archive.y - 8, t0: now, color: AMBER });
            rewriteOnce(now + 500);
          }
        }
      }
    }

    /* modules above everything */
    for (var mk in M) drawModule(rg, mk, now, activeMod === mk);

    /* floats */
    for (var f2 = floats.length - 1; f2 >= 0; f2--) {
      var fl = floats[f2];
      var ft = (now - fl.t0) / 1100;
      if (ft >= 1) { floats.splice(f2, 1); continue; }
      ctx.font = "700 9.5px " + MONO;
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(" + fl.color + "," + (0.85 * (1 - ft)) + ")";
      ctx.fillText(fl.text, mx(rg, fl.vx), my(rg, fl.vy) - ft * 16);
      ctx.textAlign = "left";
    }
  }

  /* ---- frame loop: rAF while visible, slow tick while hidden ---- */
  var lastTs = 0, boost = 0;
  function scheduleNext() {
    if (reduced) return;
    if (document.hidden) setTimeout(function () { frame(performance.now()); }, 300);
    else requestAnimationFrame(frame);
  }
  function frame(ts) {
    var dt = Math.min(250, lastTs ? ts - lastTs : 16.7);
    lastTs = ts;
    if (lap) {
      lap.t += dt * (ts < boost ? 1.9 : 1);
      if (lap.t >= lap.total) { lap = null; nextLapAt = ts + 1100 + rnd() * 1200; }
    } else if (ts > nextLapAt) {
      startLap();
    }
    draw(ts);
    scheduleNext();
  }

  /* ---- pointer ---- */
  function toLocal(e) {
    var r = hero.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function toVirtual(p, rg) {
    return [(p.x - rg.x0) / (rg.x1 - rg.x0) * VW, (p.y - rg.y0) / (rg.y1 - rg.y0) * VH];
  }
  hero.addEventListener("mousemove", function (e) {
    var p = toLocal(e);
    mouse.x = p.x; mouse.y = p.y; mouse.inside = true;
    var rg = region();
    if (rg.narrow) { hoverMod = null; return; }
    var v = toVirtual(p, rg);
    hoverMod = null;
    for (var k in M) {
      var m = M[k];
      if (v[0] > m.x - 8 && v[0] < m.x + m.w + 8 && v[1] > m.y - 8 && v[1] < m.y + m.h + 8) { hoverMod = k; break; }
    }
  });
  hero.addEventListener("mouseleave", function () { mouse.inside = false; hoverMod = null; });
  hero.addEventListener("click", function (e) {
    if (reduced) return;
    if (e.target.closest && (e.target.closest(".hero-content") || e.target.closest("a, button"))) return;
    var rg = region();
    if (rg.narrow) return;
    var p = toLocal(e);
    if (p.x < rg.x0 - 20) return;
    if (!lap) { startLap(); nextLapAt = 0; }
    else boost = performance.now() + 1400;
  });

  /* ---- boot ---- */
  function boot() {
    resize();
    if (reduced) {
      rev = 47;
      for (var i = 0; i < 4; i++) rewriteOnce(-1e6);
      rewire = null;
      draw(0);
      return;
    }
    nextLapAt = performance.now() + 900;
    draw(performance.now());
    scheduleNext();
  }
  var rT;
  window.addEventListener("resize", function () {
    clearTimeout(rT);
    rT = setTimeout(function () { resize(); if (reduced) draw(performance.now()); }, 120);
  });
  boot();
})();
