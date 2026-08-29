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

  /* ---------- task domain filters ---------- */
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

  /* ---------- hero: the self-rewiring blueprint ----------
     An engineering schematic of the RSI loop, drawn in hairlines:
     PROPOSE → PATCH → TRAIN → VERIFY → ARCHIVE. An amber signal runs
     the loop. When a lap verifies, the revision counter advances and
     the schematic rewrites one piece of itself — a trace is rerouted,
     the training profile changes, a test stub appears. Failed laps
     ride the dashed reject bus back to PROPOSE and change nothing.
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

  var VW = 1000, VH = 620;
  var W = 0, H = 0, dpr = 1;
  var mouse = { x: 0, y: 0, inside: false };

  /* glow sprite for the signal */
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

  /* ---- the schematic, hand-composed in virtual 1000×620 space ---- */
  var M = {
    propose: { x: 150, y: 132, w: 170, h: 60, label: "PROPOSE",
               note: "drafts the next hypothesis" },
    patch:   { x: 520, y: 92,  w: 170, h: 60, label: "PATCH",
               note: "edits the pinned source" },
    train:   { x: 760, y: 250, w: 190, h: 130, label: "TRAIN",
               note: "six rungs · fixed budget" },
    verify:  { x: 540, y: 474, w: 180, h: 60, label: "VERIFY",
               note: "clean image · fail → zero" },
    archive: { x: 130, y: 452, w: 190, h: 60, label: "ARCHIVE",
               note: "commit if the rerun is beaten" }
  };

  /* connection routes: hand-designed Manhattan variants */
  var ROUTES = {
    A: { variants: [   // propose → patch
      [[320, 162], [430, 162], [430, 122], [520, 122]],
      [[320, 150], [382, 150], [382, 62], [468, 62], [468, 122], [520, 122]],
      [[320, 176], [462, 176], [462, 122], [520, 122]]
    ], cur: 0 },
    B: { variants: [   // patch → train
      [[690, 122], [855, 122], [855, 250]],
      [[690, 140], [782, 140], [782, 204], [855, 204], [855, 250]]
    ], cur: 0 },
    C: { variants: [   // train → verify
      [[855, 380], [855, 504], [720, 504]],
      [[855, 380], [855, 442], [792, 442], [792, 504], [720, 504]]
    ], cur: 0 },
    D: { variants: [   // verify → archive
      [[540, 504], [430, 504], [430, 482], [320, 482]],
      [[540, 520], [362, 520], [362, 482], [320, 482]]
    ], cur: 0 },
    E: { variants: [   // archive → propose (left return bus)
      [[130, 482], [72, 482], [72, 150], [150, 150]],
      [[130, 500], [52, 500], [52, 172], [150, 172]]
    ], cur: 0 }
  };
  var REJECT = [[630, 534], [630, 586], [90, 586], [90, 180], [150, 180]];
  var ORDER = ["A", "B", "C", "D", "E"];

  var rev = 41;                     // schematic revision counter
  var trainBars = [];               // current E0–E5 profile
  var trainBarsOld = null, barsMorphT0 = 0;
  var stubs = [];                   // accreted test stubs
  var floats = [];                  // rising annotations
  var rewire = null;                // {conn, oldPts, t0}
  var verdict = null;               // {ok, t0} tick at VERIFY
  var hoverMod = null;

  function newBars() {
    var b = [];
    for (var i = 0; i < 6; i++) b.push(0.35 + rnd() * 0.6);
    return b;
  }
  trainBars = newBars();

  /* ---- lap state machine ---- */
  var lap = null;   // {plan:[{kind,conn|at,dur,fx}], t, ok}
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

  /* one self-rewrite after a verified lap */
  function rewriteOnce(now) {
    var roll = rnd();
    if (roll < 0.45) {
      /* reroute one already-travelled trace */
      var pool = ["A", "B", "C", "D"].filter(function (k) { return ROUTES[k].variants.length > 1; });
      var k2 = pool[(rnd() * pool.length) | 0];
      var r = ROUTES[k2];
      var next = ((r.cur + 1 + ((rnd() * (r.variants.length - 1)) | 0)) % r.variants.length);
      rewire = { conn: k2, oldPts: r.variants[r.cur], t0: now };
      r.cur = next;
    } else if (roll < 0.75) {
      /* new training profile */
      trainBarsOld = trainBars.slice();
      trainBars = newBars();
      barsMorphT0 = now;
    } else {
      /* accrete a test stub off a random trace */
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
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var rect = canvas.getBoundingClientRect();
    W = rect.width; H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
  function tracePath(rg, pts, upTo) {
    ctx.beginPath();
    var R = 7;
    var n = upTo == null ? pts.length : upTo;
    for (var i = 0; i < n; i++) {
      var X = mx(rg, pts[i][0]), Y = my(rg, pts[i][1]);
      if (i === 0) ctx.moveTo(X, Y);
      else if (i < n - 1 && upTo == null) {
        var nx = mx(rg, pts[i + 1][0]), ny = my(rg, pts[i + 1][1]);
        ctx.arcTo(X, Y, nx, ny, R);
      } else ctx.lineTo(X, Y);
    }
  }
  function drawTrace(rg, pts, alpha, dashed) {
    ctx.strokeStyle = "rgba(" + INK + "," + alpha + ")";
    ctx.lineWidth = 1;
    if (dashed) ctx.setLineDash([4, 5]);
    tracePath(rg, pts);
    ctx.stroke();
    ctx.setLineDash([]);
    /* vias on interior bends */
    for (var i = 1; i < pts.length - 1; i++) {
      ctx.beginPath();
      ctx.arc(mx(rg, pts[i][0]), my(rg, pts[i][1]), 2, 0, 7);
      ctx.strokeStyle = "rgba(" + INK + "," + (alpha * 0.9) + ")";
      ctx.stroke();
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

  function drawModule(rg, key, now, active) {
    var m = M[key];
    var X = mx(rg, m.x), Y = my(rg, m.y);
    var Wd = mx(rg, m.x + m.w) - X, Hd = my(rg, m.y + m.h) - Y;
    var hot = active || hoverMod === key;
    var a = hot ? 0.85 : 0.5;

    if (active) {
      ctx.fillStyle = "rgba(" + AMBER + ",0.07)";
      ctx.fillRect(X, Y, Wd, Hd);
    }
    ctx.strokeStyle = hot ? "rgba(" + AMBER + ",0.8)" : "rgba(" + INK + "," + a + ")";
    ctx.lineWidth = 1;
    ctx.strokeRect(X, Y, Wd, Hd);

    /* pin ticks */
    ctx.strokeStyle = "rgba(" + INK + "," + (a * 0.6) + ")";
    var pins = 3;
    for (var i = 1; i <= pins; i++) {
      var py2 = Y + (Hd * i) / (pins + 1);
      ctx.beginPath(); ctx.moveTo(X - 5, py2); ctx.lineTo(X, py2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(X + Wd, py2); ctx.lineTo(X + Wd + 5, py2); ctx.stroke();
    }

    /* label */
    ctx.font = "700 10px " + MONO;
    ctx.textAlign = "left";
    ctx.fillStyle = hot ? "rgba(" + AMBER + ",0.95)" : "rgba(" + INK + ",0.8)";
    ctx.fillText(m.label, X + 10, Y + 17);

    /* TRAIN: inner rung bars */
    if (key === "train") {
      var innerX = X + 12, innerY = Y + 30;
      var innerW = Wd - 24, innerH = Hd - 44;
      var bw = innerW / 6;
      var fillN = 6;
      if (lap) {
        var seg = segAt(lap);
        if (seg && seg.at === "train") {
          fillN = ((lap.t - seg.t0) / seg.dur) * 7;
        } else if (seg && seg.t0 < trainT0(lap)) fillN = 0;
      }
      for (var b = 0; b < 6; b++) {
        var hgt = trainBars[b];
        if (trainBarsOld && now - barsMorphT0 < 900) {
          var mt = easeIO(Math.min(1, (now - barsMorphT0) / 900));
          hgt = trainBarsOld[b] + (trainBars[b] - trainBarsOld[b]) * mt;
        }
        var bh = innerH * hgt;
        var bx = innerX + b * bw + 1.5;
        ctx.strokeStyle = "rgba(" + INK + ",0.35)";
        ctx.strokeRect(bx, innerY + innerH - bh, bw - 3, bh);
        if (b < fillN) {
          ctx.fillStyle = "rgba(" + AMBER + "," + (b < fillN - 1 ? 0.55 : 0.55 * Math.min(1, fillN - b)) + ")";
          ctx.fillRect(bx, innerY + innerH - bh, bw - 3, bh);
        }
        ctx.font = "700 6.5px " + MONO;
        ctx.fillStyle = "rgba(" + INK + ",0.45)";
        ctx.fillText("E" + b, bx, innerY + innerH + 9);
      }
    }

    /* ARCHIVE: revision label */
    if (key === "archive") {
      ctx.font = "700 10px " + MONO;
      ctx.fillStyle = "rgba(" + AMBER + ",0.75)";
      ctx.fillText("#" + String(rev).padStart(3, "0"), X + 10, Y + Hd - 12);
    }
    /* VERIFY: verdict tick */
    if (key === "verify" && verdict && now - verdict.t0 < 1400) {
      var va = 1 - Math.max(0, (now - verdict.t0 - 800) / 600);
      ctx.font = "700 15px " + MONO;
      ctx.fillStyle = verdict.ok ? "rgba(" + GREEN + "," + va + ")" : "rgba(" + PINK + "," + va + ")";
      ctx.textAlign = "right";
      ctx.fillText(verdict.ok ? "✓" : "✗", X + Wd - 10, Y + 20);
      ctx.textAlign = "left";
    }

    /* hover note */
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

  function trainT0(l) {
    for (var i = 0; i < l.plan.length; i++) if (l.plan[i].at === "train") return l.plan[i].t0;
    return 0;
  }
  function segAt(l) {
    for (var i = l.plan.length - 1; i >= 0; i--) if (l.t >= l.plan[i].t0) return l.plan[i];
    return l.plan[0];
  }

  function drawTitleBlock(rg, now) {
    var X = mx(rg, 700), Y = my(rg, 548);
    var Wd = mx(rg, 952) - X, Hd = my(rg, 612) - Y;
    ctx.strokeStyle = "rgba(" + INK + ",0.4)";
    ctx.lineWidth = 1;
    ctx.strokeRect(X, Y, Wd, Hd);
    var r1 = Y + Hd / 3, r2 = Y + (2 * Hd) / 3;
    ctx.beginPath(); ctx.moveTo(X, r1); ctx.lineTo(X + Wd, r1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(X, r2); ctx.lineTo(X + Wd, r2); ctx.stroke();
    ctx.font = "700 8.5px " + MONO;
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(" + INK + ",0.6)";
    ctx.fillText("RSI LOOP — SCHEMATIC", X + 8, r1 - 4);
    var flash = lap && lap.ok && segAt(lap).at === "archive";
    ctx.fillStyle = flash ? "rgba(" + AMBER + ",0.95)" : "rgba(" + AMBER + ",0.7)";
    ctx.fillText("REV #" + String(rev).padStart(3, "0"), X + 8, r2 - 4);
    ctx.fillStyle = "rgba(" + INK + ",0.45)";
    ctx.fillText("SIX RUNGS · CLEAN VERIFIER", X + 8, Y + Hd - 5);
  }

  function draw(now) {
    ctx.clearRect(0, 0, W, H);
    var rg = region();

    /* registration marks */
    ctx.strokeStyle = "rgba(" + INK + ",0.25)";
    ctx.lineWidth = 1;
    [[20, 20], [980, 20], [20, 600], [980, 600]].forEach(function (c) {
      var X = mx(rg, c[0]), Y = my(rg, c[1]);
      ctx.beginPath(); ctx.moveTo(X - 4, Y); ctx.lineTo(X + 4, Y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(X, Y - 4); ctx.lineTo(X, Y + 4); ctx.stroke();
    });

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
      if (st.sq) {
        ctx.strokeRect(mx(rg, st.x2) - 2.5, my(rg, st.y2) - 2.5, 5, 5);
      } else {
        ctx.beginPath(); ctx.arc(mx(rg, st.x2), my(rg, st.y2), 2.5, 0, 7); ctx.stroke();
      }
    }

    /* reject bus, always faint */
    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = "rgba(" + PINK + ",0.14)";
    tracePath(rg, REJECT);
    ctx.stroke();
    ctx.setLineDash([]);

    /* the loop traces */
    for (var k = 0; k < ORDER.length; k++) {
      var key = ORDER[k];
      if (rewire && rewire.conn === key) {
        var rt = now - rewire.t0;
        if (rt < 600) {
          drawPartialTrace(rg, rewire.oldPts, 1 - easeIO(rt / 600), 0.3);
        } else if (rt < 1500) {
          drawPartialTrace(rg, ROUTES[key].variants[ROUTES[key].cur], easeIO((rt - 600) / 900), 0.7, AMBER);
        } else {
          drawTrace(rg, ROUTES[key].variants[ROUTES[key].cur], 0.38);
          rewire = null;
        }
      } else {
        drawTrace(rg, ROUTES[key].variants[ROUTES[key].cur], 0.38);
      }
    }

    /* lap: signal + effects */
    var activeMod = null;
    if (lap) {
      var seg = segAt(lap);
      var segT = Math.min(1, (lap.t - seg.t0) / seg.dur);
      if (seg.kind === "travel") {
        var pts = ROUTES[seg.conn].variants[ROUTES[seg.conn].cur];
        var P = pointAt(pts, easeIO(segT));
        drawSignal(rg, P, AMBER);
      } else if (seg.kind === "reject") {
        ctx.setLineDash([4, 5]);
        ctx.strokeStyle = "rgba(" + PINK + ",0.4)";
        tracePath(rg, REJECT);
        ctx.stroke();
        ctx.setLineDash([]);
        drawSignal(rg, pointAt(REJECT, easeIO(segT)), PINK);
      } else {
        activeMod = seg.at;
        drawSignal(rg, moduleAnchor(seg.at), AMBER, 0.5);
        /* one-shot effects at dwell start */
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

    /* modules on top of traces */
    for (var mk in M) drawModule(rg, mk, now, activeMod === mk);

    drawTitleBlock(rg, now);

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

  function moduleAnchor(key) {
    var m = M[key];
    return [m.x + m.w / 2, m.y + m.h / 2];
  }
  function drawSignal(rg, P, color, dim) {
    var X = mx(rg, P[0]), Y = my(rg, P[1]);
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = dim ? 0.35 : 0.8;
    ctx.drawImage(glowSprite(), X - 16, Y - 16, 32, 32);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(" + color + ",0.95)";
    ctx.beginPath(); ctx.arc(X, Y, 2.4, 0, 7); ctx.fill();
  }

  /* ---- frame loop ----
     rAF while visible; a slow setTimeout tick while the page is hidden,
     so the schematic never boots to a blank panel. */
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
    return [ (p.x - rg.x0) / (rg.x1 - rg.x0) * VW, (p.y - rg.y0) / (rg.y1 - rg.y0) * VH ];
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
      /* static: finished schematic, mid-history */
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
    rT = setTimeout(function () { resize(); if (reduced) draw(0); }, 120);
  });
  boot();
})();
