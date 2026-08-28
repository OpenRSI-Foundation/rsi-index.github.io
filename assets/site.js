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

  /* ---------- hero: the archive constellation ----------
     A sparse, calm tree of experiments in the site's own voice: a few
     dendritic branches fan out from a ring-marked origin, carrying tiny
     pixel-square runs, round artifact nodes, and rare amber milestones —
     the largest wearing an orbit ring. It grows once and then simply
     lives: slow breathing, and every few seconds a signal travels from
     the root out to a leaf, lighting the nodes it passes.
     Pointer (≥900px): hovering illuminates nearby nodes; clicking grows
     a new branch from the nearest node toward the cursor.              */
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
  var rnd = mulberry32(20260828);

  var C = {
    cream: "244,238,220",
    amber: "240,155,60",
    green: "159,199,106",
    edge: "rgba(240,236,220,0.15)",
    edgeAmber: "rgba(240,155,60,0.32)",
    pulse: "255,244,214"
  };

  var VW = 1000, VH = 620;
  var W = 0, H = 0, dpr = 1;
  var nodes = [];         // {vx,vy,r,color,kind:dot|px|ring|core, alpha, born, parent, bow, phase, manual, orbit}
  var leaves = [];        // indices of chain tips (pulse destinations)
  var pulses = [];        // {path:[nodes], t0, dur}
  var mouse = { x: 0, y: 0, inside: false };
  var bootAt = 0, nextPulse = 0, manualCount = 0;

  /* soft halo sprites */
  var sprites = {};
  function sprite(color) {
    if (sprites[color]) return sprites[color];
    var s = document.createElement("canvas");
    s.width = s.height = 128;
    var g = s.getContext("2d");
    var grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "rgba(" + C[color] + ",0.55)");
    grad.addColorStop(0.3, "rgba(" + C[color] + ",0.18)");
    grad.addColorStop(1, "rgba(" + C[color] + ",0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    sprites[color] = s;
    return s;
  }

  function tooClose(vx, vy, minD) {
    for (var i = 0; i < nodes.length; i++) {
      var dx = nodes[i].vx - vx, dy = nodes[i].vy - vy;
      if (dx * dx + dy * dy < minD * minD) return true;
    }
    return false;
  }

  function pushNode(n) { nodes.push(n); return n; }

  /* ---- build: hand-composed skeleton, randomized detail ----
     Five guide curves fan across the right of the panel (designed, so the
     composition always holds); nodes are laid along them with jitter, and
     twigs, sizes, pixel-dots, and accents are randomized per load.      */

  function catmull(pts, per) {
    var out = [];
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[Math.max(0, i - 1)], p1 = pts[i],
          p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      var segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      var n = Math.max(2, Math.round(segLen / per));
      for (var j = (i === 0 ? 0 : 1); j <= n; j++) {
        var t = j / n, t2 = t * t, t3 = t2 * t;
        out.push([
          0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
          0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
        ]);
      }
    }
    return out;
  }

  function jit(p, amt) { return [p[0] + (rnd() - 0.5) * amt, p[1] + (rnd() - 0.5) * amt]; }

  function buildTree() {
    nodes = []; leaves = []; pulses = []; manualCount = 0;
    var t0 = 400;
    var root = pushNode({
      vx: 120, vy: 300 + (rnd() - 0.5) * 30,
      r: 5.5, color: "cream", kind: "ring", alpha: 0.9,
      born: t0, parent: null, bow: 0, phase: rnd() * 7
    });

    /* the dense heart — a cluster of micro-runs hugging the origin */
    var hearts = 7 + (rnd() * 3 | 0);
    for (var hI = 0; hI < hearts; hI++) {
      var ha = rnd() * 6.283, hd = 24 + rnd() * 48;
      var hx = root.vx + Math.cos(ha) * hd, hy = root.vy + Math.sin(ha) * hd * 0.9;
      if (tooClose(hx, hy, 15)) continue;
      pushNode({
        vx: hx, vy: hy, r: 1.2 + rnd() * 1.9,
        color: rnd() < 0.1 ? "amber" : "cream",
        kind: rnd() < 0.25 ? "px" : "dot",
        alpha: 0.5 + rnd() * 0.45,
        born: t0 + 150 + rnd() * 700, parent: root,
        bow: (rnd() - 0.5) * 6, phase: rnd() * 7
      });
    }

    /* designed guides: [points], anchor ("root" or [branchIdx, nodeIdx]), tip role */
    var R = root.vy - 300;   // vertical drift of the whole design follows the root
    function P(x, y) { return jit([x, y + R], 26); }
    var GUIDES = [
      { pts: [[root.vx, root.vy], P(305, 180), P(540, 118), P(800, 96)],            tip: "best" },
      { pts: [[root.vx, root.vy], P(330, 335), P(575, 400), P(775, 442), P(915, 480)], tip: "med" },
      { pts: [[root.vx, root.vy], P(255, 232), P(392, 205)],                        tip: "ring" },
      { pts: [[root.vx, root.vy], P(238, 398), P(332, 480), P(452, 525)],           tip: "green" },
      { pts: [null, P(430, 268), P(568, 300), P(712, 286)], anchor: [0, 1], tip: "amber2" }
    ];

    var branchNodes = [];
    for (var b = 0; b < GUIDES.length; b++) {
      var gd = GUIDES[b];
      var startNode = root;
      if (gd.anchor) {
        var host = branchNodes[gd.anchor[0]];
        startNode = (host && host[Math.min(gd.anchor[1], host.length - 1)]) || root;
        gd.pts[0] = [startNode.vx, startNode.vy];
      }
      var dense = catmull(gd.pts, 8);
      var mine = [];
      var born = t0 + 350 + b * 430;
      var acc = 0, nextAt = 46 + rnd() * 16;
      var parent = startNode;

      for (var i2 = 1; i2 < dense.length; i2++) {
        acc += Math.hypot(dense[i2][0] - dense[i2 - 1][0], dense[i2][1] - dense[i2 - 1][1]);
        if (acc < nextAt) continue;
        acc = 0; nextAt = 46 + rnd() * 18;
        /* perpendicular jitter off the guide */
        var dxg = dense[i2][0] - dense[i2 - 1][0], dyg = dense[i2][1] - dense[i2 - 1][1];
        var dg = Math.hypot(dxg, dyg) || 1;
        var off = (rnd() - 0.5) * 16;
        var nx = dense[i2][0] - (dyg / dg) * off;
        var ny = dense[i2][1] + (dxg / dg) * off;
        if (nx < 26 || nx > VW - 14 || ny < 32 || ny > VH - 32) continue;
        if (tooClose(nx, ny, 18)) continue;

        var kind = rnd() < 0.16 ? "px" : "dot";
        var r = 1.4 + rnd() * 1.5;
        if (kind === "dot" && rnd() < 0.18) r = 3.4 + rnd() * 1.9;
        var node = pushNode({
          vx: nx, vy: ny, r: r, color: "cream", kind: kind,
          alpha: 0.45 + rnd() * 0.5,
          born: born, parent: parent,
          bow: (rnd() - 0.5) * 9, phase: rnd() * 7
        });
        born += 190 + rnd() * 110;
        mine.push(node);

        /* sparse twigs */
        if (rnd() < 0.38) {
          var ta = Math.atan2(dyg, dxg) + (rnd() < 0.5 ? 1 : -1) * (0.9 + rnd() * 0.5);
          var tl = 24 + rnd() * 22;
          var tx = nx + Math.cos(ta) * tl, ty = ny + Math.sin(ta) * tl * 0.9;
          if (tx > 26 && tx < VW - 14 && ty > 30 && ty < VH - 30 && !tooClose(tx, ty, 17)) {
            pushNode({
              vx: tx, vy: ty, r: 1.1 + rnd() * 1.2,
              color: rnd() < 0.12 ? "green" : "cream",
              kind: rnd() < 0.25 ? "px" : "dot",
              alpha: 0.4 + rnd() * 0.4,
              born: born, parent: node,
              bow: (rnd() - 0.5) * 7, phase: rnd() * 7
            });
            born += 90 + rnd() * 70;
          }
        }
        parent = node;
      }
      branchNodes.push(mine);

      /* style the tip by its designed role */
      if (mine.length) {
        var tip = mine[mine.length - 1];
        leaves.push(tip);
        if (gd.tip === "best") {
          tip.color = "amber"; tip.kind = "dot";
          tip.r = 9 + rnd() * 2.5; tip.alpha = 1; tip.orbit = true;
        } else if (gd.tip === "amber2") {
          tip.color = "amber"; tip.kind = "dot"; tip.r = 4.5 + rnd() * 1.6; tip.alpha = 0.92;
        } else if (gd.tip === "ring") {
          tip.kind = "ring"; tip.r = 4.2 + rnd() * 1.4; tip.alpha = 0.85;
        } else if (gd.tip === "green") {
          tip.color = "green"; tip.kind = "dot"; tip.r = 3.6 + rnd() * 1.4; tip.alpha = 0.85;
        } else {
          tip.kind = "dot"; tip.r = Math.max(tip.r, 4 + rnd() * 2); tip.alpha = 0.85;
        }
      }
    }
  }

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
    return {
      narrow: narrow,
      x0: narrow ? W * 0.05 : W * 0.40,
      x1: W * 0.975,
      y0: H * 0.05,
      y1: H * 0.95
    };
  }
  function mapX(rg, vx) { return rg.x0 + (vx / VW) * (rg.x1 - rg.x0); }
  function mapY(rg, vy) { return rg.y0 + (vy / VH) * (rg.y1 - rg.y0); }

  function easeOut(t) { return 1 - (1 - t) * (1 - t) * (1 - t); }
  function easeOutBack(t) {
    var s = 1.6, u = t - 1;
    return 1 + (s + 1) * u * u * u + s * u * u;
  }
  function qPoint(x0, y0, cx, cy, x1, y1, t) {
    var a = 1 - t;
    return [a * a * x0 + 2 * a * t * cx + t * t * x1, a * a * y0 + 2 * a * t * cy + t * t * y1];
  }

  /* path from root to a node */
  function pathTo(node) {
    var path = [];
    var n = node;
    while (n) { path.unshift(n); n = n.parent; }
    return path;
  }

  function spawnPulse(now) {
    var pool = leaves.filter(function (l) { return l.born < now - bootAt; });
    if (!pool.length) return;
    var leaf = pool[(rnd() * pool.length) | 0];
    var path = pathTo(leaf);
    if (path.length < 3) return;
    pulses.push({ path: path, t0: now, dur: 260 + path.length * 150 });
  }

  function draw(now) {
    var elapsed = reduced ? 1e9 : now - bootAt;
    ctx.clearRect(0, 0, W, H);
    var rg = region();
    var interactive = !rg.narrow && !reduced;

    /* pass 1 — edges */
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!n.parent || n.born > elapsed) continue;
      var eP = easeOut(Math.min(1, (elapsed - n.born) / 420));
      var x0 = mapX(rg, n.parent.vx), y0 = mapY(rg, n.parent.vy);
      var x1 = mapX(rg, n.vx), y1 = mapY(rg, n.vy);
      var mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      var dx = x1 - x0, dy = y1 - y0, dl = Math.hypot(dx, dy) || 1;
      var cx = mx - (dy / dl) * n.bow, cy = my + (dx / dl) * n.bow;
      ctx.strokeStyle = n.color === "amber" ? C.edgeAmber : C.edge;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      var SEG = 10;
      for (var t = 1; t <= SEG; t++) {
        var p = qPoint(x0, y0, cx, cy, x1, y1, (t / SEG) * eP);
        ctx.lineTo(p[0], p[1]);
      }
      ctx.stroke();
    }

    /* pass 2 — nodes */
    for (var j = 0; j < nodes.length; j++) {
      var d = nodes[j];
      if (d.born > elapsed) continue;
      var pop = reduced ? 1 : easeOutBack(Math.min(1, Math.max(0.001, (elapsed - d.born) / 430)));
      if (pop <= 0.02) continue;
      var px = mapX(rg, d.vx), py = mapY(rg, d.vy);

      var bright = 1;
      if (interactive && mouse.inside) {
        var md = Math.hypot(px - mouse.x, py - mouse.y);
        if (md < 110) bright += (1 - md / 110) * 0.75;
      }
      if (d.flash) {
        var ft = (now - d.flash) / 550;
        if (ft < 1) bright += (1 - ft) * 0.9; else d.flash = 0;
      }

      var breathe = 1 + 0.035 * Math.sin(now / 2600 + d.phase);
      var shimmer = 0.92 + 0.08 * Math.sin(now / 1900 + d.phase * 1.7);
      var rr = d.r * breathe * pop;
      var a = Math.min(1, d.alpha * shimmer * bright);
      var col = C[d.color];

      /* halo for anything of substance */
      if (d.r > 2.2 || d.color !== "cream") {
        var halo = rr * (d.orbit ? 9 : 6.5);
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = Math.min(1, (d.r > 6 ? 0.5 : 0.3) * bright);
        ctx.drawImage(sprite(d.color), px - halo / 2, py - halo / 2, halo, halo);
        ctx.globalCompositeOperation = "source-over";
      }

      ctx.globalAlpha = a;
      if (d.kind === "px") {
        /* tiny pixel squares — the site's 8-bit lineage */
        var s2 = Math.max(1.6, rr * 1.7);
        ctx.fillStyle = "rgba(" + col + ",0.9)";
        ctx.fillRect(px - s2 / 2, py - s2 / 2, s2, s2);
      } else if (d.kind === "ring") {
        ctx.strokeStyle = "rgba(" + col + ",0.65)";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(px, py, rr, 0, 7); ctx.stroke();
        ctx.fillStyle = "rgba(" + col + ",0.85)";
        ctx.beginPath(); ctx.arc(px, py, Math.max(0.8, rr * 0.24), 0, 7); ctx.fill();
      } else {
        ctx.fillStyle = "rgba(" + col + ",0.94)";
        ctx.beginPath(); ctx.arc(px, py, rr, 0, 7); ctx.fill();
      }

      /* orbit ring around the current best */
      if (d.orbit) {
        ctx.globalAlpha = 0.22 * bright;
        ctx.strokeStyle = "rgba(" + col + ",1)";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(px, py, rr * 1.9 + 2 * Math.sin(now / 2300), 0, 7); ctx.stroke();
      }
      if (d.manual) {
        ctx.globalAlpha = a;
        ctx.fillStyle = "#fdfcf7";
        ctx.beginPath(); ctx.arc(px, py, Math.max(0.8, rr * 0.35), 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    /* pass 3 — signals travelling root → leaf */
    for (var p2 = pulses.length - 1; p2 >= 0; p2--) {
      var pl = pulses[p2];
      var pt = (now - pl.t0) / pl.dur;
      if (pt >= 1) { pulses.splice(p2, 1); continue; }
      var fpos = pt * (pl.path.length - 1);
      var iA = Math.floor(fpos), fB = fpos - iA;
      var nA = pl.path[iA], nB = pl.path[Math.min(iA + 1, pl.path.length - 1)];
      if (nB.born > elapsed) continue;
      var sx = mapX(rg, nA.vx) + (mapX(rg, nB.vx) - mapX(rg, nA.vx)) * fB;
      var sy = mapY(rg, nA.vy) + (mapY(rg, nB.vy) - mapY(rg, nA.vy)) * fB;
      if (fB > 0.8 && !nB.flash) nB.flash = now;
      var tail = 1 - pt * 0.4;
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.5 * tail;
      ctx.drawImage(sprite("cream"), sx - 11, sy - 11, 22, 22);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 0.95 * tail;
      ctx.fillStyle = "rgba(" + C.pulse + ",1)";
      ctx.beginPath(); ctx.arc(sx, sy, 1.7, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function frame(now) {
    if (now > nextPulse) {
      spawnPulse(now);
      nextPulse = now + 2600 + rnd() * 1800;
    }
    draw(now);
    if (!reduced) requestAnimationFrame(frame);
  }

  /* ---------- pointer interaction ---------- */
  function toLocal(e) {
    var r = hero.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  hero.addEventListener("mousemove", function (e) {
    var p = toLocal(e);
    mouse.x = p.x; mouse.y = p.y; mouse.inside = true;
  });
  hero.addEventListener("mouseleave", function () { mouse.inside = false; });

  hero.addEventListener("click", function (e) {
    if (reduced) return;
    if (e.target.closest && (e.target.closest(".hero-content") || e.target.closest("a, button"))) return;
    var rg = region();
    if (rg.narrow || manualCount > 30) return;
    var p = toLocal(e);
    if (p.x < rg.x0 - 20) return;

    var elapsed = performance.now() - bootAt;
    var cvx = (p.x - rg.x0) / (rg.x1 - rg.x0) * VW;
    var cvy = (p.y - rg.y0) / (rg.y1 - rg.y0) * VH;

    /* nearest grown node */
    var near = null, nd = 1e9;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].born > elapsed) continue;
      var dx = nodes[i].vx - cvx, dy = nodes[i].vy - cvy;
      var dd = dx * dx + dy * dy;
      if (dd < nd) { nd = dd; near = nodes[i]; }
    }
    if (!near) return;

    /* grow a chain from the nearest node to the click */
    var dist = Math.hypot(cvx - near.vx, cvy - near.vy);
    var steps = Math.max(2, Math.min(5, Math.ceil(dist / 70)));
    var from = near;
    var newLeaf = null;
    for (var s2 = 0; s2 < steps; s2++) {
      var t = (s2 + 1) / steps;
      var last = s2 === steps - 1;
      var wob = last ? 3 : 20;
      var vx = Math.max(26, Math.min(VW - 14, near.vx + (cvx - near.vx) * t + (rnd() - 0.5) * wob));
      var vy = Math.max(30, Math.min(VH - 30, near.vy + (cvy - near.vy) * t + (rnd() - 0.5) * wob));
      var node = pushNode({
        vx: vx, vy: vy,
        r: last ? 4.5 + rnd() * 2.5 : 1.5 + rnd() * 1.3,
        color: last ? "amber" : "cream",
        kind: !last && rnd() < 0.25 ? "px" : "dot",
        alpha: last ? 0.95 : 0.5 + rnd() * 0.4,
        born: elapsed + s2 * 150,
        parent: from,
        bow: (rnd() - 0.5) * 8,
        phase: rnd() * 7,
        manual: last
      });
      from = node; newLeaf = node;
      manualCount++;
    }
    if (newLeaf) {
      leaves.push(newLeaf);
      /* answer with a signal a moment later */
      setTimeout(function () {
        if (!reduced) pulses.push({ path: pathTo(newLeaf), t0: performance.now(), dur: 260 + pathTo(newLeaf).length * 150 });
      }, steps * 150 + 500);
    }
  });

  /* ---------- boot ---------- */
  function boot() {
    resize();
    buildTree();
    bootAt = performance.now();
    nextPulse = bootAt + 6000;
    if (reduced) { draw(bootAt); return; }
    requestAnimationFrame(frame);
  }

  var rT;
  window.addEventListener("resize", function () {
    clearTimeout(rT);
    rT = setTimeout(function () { resize(); if (reduced) draw(performance.now()); }, 120);
  });

  boot();
})();
