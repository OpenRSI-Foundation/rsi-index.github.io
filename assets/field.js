/* ============================================================
   RSI-Index — the star field
   A long-exposure star map with a search tree growing through it.
   Stars drift along a smooth flow — a vortex around a bright pole
   plus a periodic, divergence-free potential field. From the pole (the
   human baseline) a tree of runs grows outward along that flow: tips
   split into new hypotheses, each branch's score random-walks, the
   branches that fall behind die and dim, the leaders split more often,
   and the lineage of the current best is drawn in white. A generation
   grows to the edge, fades, and a new one starts — never the same.

   Drag to pan (with inertia) · scroll to zoom after a click, or
   ctrl/⌘ + scroll · pinch on touch · double-click to reset.
   Ambient variant on subpage headers is non-interactive.
   ============================================================ */
(function () {
  "use strict";

  var TAU = Math.PI * 2;
  var PERIOD = 52;                                   // seconds per loop
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var params = location.search;
  var shotMode = /(\?|&)shot=1/.test(params);
  if (shotMode) document.documentElement.classList.add("shot");
  var zoomParam = parseFloat((params.match(/[?&]zoom=([\d.]+)/) || [])[1]) || 0;

  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

  /* deterministic rng so the field is reproducible per page */
  function mulberry(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function gauss(rng) {
    var u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  }
  // stable jitter for a grid cell
  function hash2(x, y) {
    var h = (x * 374761393 + y * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  /* soft round sprite for flashes and the brightest runs */
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
    var lineGap = opts.lineGap || 185;             // world px between streamline seeds
    var maxTips = opts.maxTips || 48;              // growing frontiers per tree
    var treeSpeed = opts.treeSpeed || 40;          // world px/s

    var W = 0, H = 0, DPR = 1;
    var quality = { count: 1, dpr: 1, lineEvery: 8 };
    var dtAvg = 16, slowSince = 0, level = 0;

    /* camera: derived every frame from an anchor (a world point pinned to a screen point) */
    var zoom = 1, zoomT = 1, camX = 0, camY = 0;
    var aSX = 0, aSY = 0, aWX = 0, aWY = 0;         // anchor: screen point <- world point
    var pendSX = null, pendSY = null;               // pointer position waiting for the next frame
    var velX = 0, velY = 0;                         // inertia of the anchor, screen px/s
    var dragging = false, homing = false;
    var homeX = 0, homeY = 0;

    var particles = [], count = 0;
    var trees = [], growing = null, rMax = 800;
    var linesPath = null, linesArrows = [], arrowsPath = null, arrowsZoom = 1;
    var t = rng() * PERIOD, lastT = 0, frame = 0;
    var raf = null, running = false, visible = !document.hidden, inView = true;

    /* ---------- the flow ---------- */

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
    var vout = [0, 0];

    function curl(x, y, time, out) {
      var dx = 0, dy = 0;
      for (var i = 0; i < waves.length; i++) {
        var w = waves[i];
        var c = Math.cos(w.kx * x + w.ky * y + w.phase + (w.omega + w.drift) * time) * w.amp;
        dx += w.kx * c;
        dy += w.ky * c;
      }
      out[0] = dy; out[1] = -dx;                     // curl of psi: divergence-free
    }

    function flow(x, y, time, out) {
      curl(x, y, time, out);
      var vx = out[0] * CURL, vy = out[1] * CURL;
      var r = Math.sqrt(x * x + y * y) + 1e-3;
      var om = SWIRL / Math.sqrt(1 + r / R0);
      vx += -y * om - (x / r) * INWARD;
      vy += x * om - (y / r) * INWARD;
      out[0] = vx; out[1] = vy;
    }

    /* ---------- geometry ---------- */

    function sx(x) { return (x - camX) * zoom + W / 2; }
    function sy(y) { return (y - camY) * zoom + H / 2; }
    function worldX(px) { return camX + (px - W / 2) / zoom; }
    function worldY(py) { return camY + (py - H / 2) / zoom; }

    function setAnchor(px, py) {                     // re-pin without moving the camera
      aWX = worldX(px); aWY = worldY(py);
      aSX = px; aSY = py;
    }
    function applyAnchor() {
      camX = aWX - (aSX - W / 2) / zoom;
      camY = aWY - (aSY - H / 2) / zoom;
    }

    function resize() {
      var r = section.getBoundingClientRect();
      var nw = Math.max(1, Math.round(r.width)), nh = Math.max(1, Math.round(r.height));
      var first = W === 0;
      W = nw; H = nh;
      DPR = Math.max(1, Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(3.6e6 / (W * H)))) * quality.dpr;
      linesC.width = starsC.width = Math.round(W * DPR);
      linesC.height = starsC.height = Math.round(H * DPR);
      lctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      sctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      homeX = -(poleAt[0] - 0.5) * W;
      homeY = -(poleAt[1] - 0.5) * H;
      if (first) {
        rMax = Math.max(220, Math.min(W * 0.34, H * 0.56));
        camX = homeX; camY = homeY;
        if (zoomParam) { zoom = zoomT = clamp(zoomParam, 0.55, 3); }
        setAnchor(W / 2, H / 2);
      }
      var target = clamp(Math.round(W * H / 780 * density * quality.count), 300, 2400);
      if (target !== count) { count = target; seedParticles(); }
      redrawAll();
    }

    /* ---------- particles ---------- */

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
      p.size = 0.7 + rng() * 0.9;
      p.alpha = 0.25 + rng() * 0.55;
      p.tint = rng() < 0.55 ? 0 : rng() < 0.7 ? 1 : 2;
    }

    function seedParticles() {
      particles = new Array(count);
      for (var i = 0; i < count; i++) { particles[i] = {}; spawn(particles[i], true); }
    }

    function stepParticles(dt) {
      var kill = 14;
      var vw = W / zoom * 0.7, vh = H / zoom * 0.7;
      for (var i = 0; i < count; i++) {
        var p = particles[i];
        flow(p.x, p.y, t, vout);
        p.x += vout[0] * dt;
        p.y += vout[1] * dt;
        p.age += dt;
        var r = p.x * p.x + p.y * p.y;
        if (p.age >= p.life || r < kill * kill ||
            Math.abs(p.x - camX) > vw * 1.35 + 80 || Math.abs(p.y - camY) > vh * 1.35 + 80) spawn(p, false);
      }
    }

    var TINTS = ["255,255,255", "214,228,255", "176,204,255"];
    var ALPHAS = [0.22, 0.42, 0.66, 0.92];
    var buckets = [];
    for (var b = 0; b < 12; b++) buckets.push([]);

    function drawStars(fade) {
      if (fade > 0) {
        sctx.globalCompositeOperation = "destination-out";
        sctx.fillStyle = "rgba(0,0,0," + fade + ")";
        sctx.fillRect(0, 0, W, H);
        sctx.globalCompositeOperation = "source-over";
      }
      for (var b = 0; b < 12; b++) buckets[b].length = 0;
      var i, p;
      for (i = 0; i < count; i++) {
        p = particles[i];
        var env = Math.min(1, p.age / 1.2, (p.life - p.age) / 2.2);
        if (env <= 0.02) continue;
        var a = p.alpha * env;
        var ab = a < 0.3 ? 0 : a < 0.55 ? 1 : a < 0.8 ? 2 : 3;
        buckets[p.tint * 4 + ab].push(p);
      }
      for (b = 0; b < 12; b++) {
        var list = buckets[b];
        if (!list.length) continue;
        sctx.fillStyle = "rgba(" + TINTS[(b / 4) | 0] + "," + ALPHAS[b % 4] + ")";
        sctx.beginPath();
        for (i = 0; i < list.length; i++) {
          var q = list[i];
          var x = sx(q.x), y = sy(q.y), s = q.size;
          sctx.rect(x - s / 2, y - s / 2, s, s);
        }
        sctx.fill();
      }
    }

    /* ============================================================
       THE SEARCH TREE — grows from the pole along the flow
       ============================================================ */

    function newTree() {
      var tr = { edges: [], nodes: [], tips: [], best: 0, bestEdge: -1, alpha: 1, born: t, fadeAt: 0, done: false };
      tr.nodes.push({ x: 0, y: 0, edge: -1, dead: false });
      var n = 4, centre = -0.25 + (rng() - 0.5) * 0.6, span = 2.6;
      for (var k = 0; k < n; k++) {
        var a = centre + (k / (n - 1) - 0.5) * span + (rng() - 0.5) * 0.25;
        var score = gauss(rng) * 0.3;
        tr.edges.push({ pts: [0, 0], parent: -1, score: score, depth: 0, state: 0 });
        tr.tips.push({ edge: k, x: 0, y: 0, dx: Math.cos(a), dy: Math.sin(a), score: score, depth: 0, since: 0, next: 0.7 + rng() * 0.8 });
        if (score > tr.best) tr.best = score;
      }
      trees.push(tr);
      if (trees.length > 3) trees.shift();
      return tr;
    }

    // growth direction: outward from the pole, bending into the ring as radius grows
    function treeDir(x, y, out) {
      var r = Math.sqrt(x * x + y * y) + 1e-3;
      var ox = x / r, oy = y / r;
      var tau = Math.min(0.9, r / 620);
      curl(x, y, t, vout);
      out[0] = ox + (-oy) * tau + vout[0] * 0.02;
      out[1] = oy + ox * tau + vout[1] * 0.02;
    }
    var dout = [0, 0];

    function splitTip(tr, tip) {
      var e = tr.edges[tip.edge];
      tr.nodes.push({ x: tip.x, y: tip.y, edge: tip.edge, dead: false });
      var n = rng() < 0.22 ? 3 : 2;
      var spread = 0.42 + rng() * 0.4;
      for (var k = 0; k < n; k++) {
        var off = n === 2 ? (k === 0 ? -spread : spread) * (0.55 + rng() * 0.45)
                          : (k - 1) * spread * 1.15;
        var ca = Math.cos(off), sa = Math.sin(off);
        var score = tip.score + gauss(rng) * 0.42 - 0.05 + (rng() < 0.06 ? 1 : 0);
        var idx = tr.edges.length;
        tr.edges.push({ pts: [tip.x, tip.y], parent: tip.edge, score: score, depth: tip.depth + 1, state: 0 });
        var lead = score >= tr.best - 0.35;
        tr.tips.push({
          edge: idx, x: tip.x, y: tip.y,
          dx: tip.dx * ca - tip.dy * sa, dy: tip.dx * sa + tip.dy * ca,
          score: score, depth: tip.depth + 1, since: 0,
          next: (0.9 + rng() * 1.3) * (lead ? 0.7 : 1.25) * Math.min(2.2, 1 + tip.depth * 0.09)
        });
        if (score > tr.best) tr.best = score;
      }
    }

    function killTip(tr, tip) {
      tr.edges[tip.edge].state = 1;
      tr.nodes.push({ x: tip.x, y: tip.y, edge: tip.edge, dead: true });
    }

    function stepTree(tr, dt) {
      var tips = tr.tips, i, tip;
      for (i = tips.length - 1; i >= 0; i--) {
        tip = tips[i];
        treeDir(tip.x, tip.y, dout);
        var m = Math.sqrt(dout[0] * dout[0] + dout[1] * dout[1]) + 1e-6;
        var k = Math.min(1, 0.55 * dt);
        var w = gauss(rng) * 0.8 * dt;                 // wiggle
        var dx = tip.dx + (dout[0] / m - tip.dx) * k, dy = tip.dy + (dout[1] / m - tip.dy) * k;
        var cw = Math.cos(w), sw = Math.sin(w);
        var rx = dx * cw - dy * sw, ry = dx * sw + dy * cw;
        var rm = Math.sqrt(rx * rx + ry * ry) + 1e-6;
        tip.dx = rx / rm; tip.dy = ry / rm;
        tip.x += tip.dx * treeSpeed * dt;
        tip.y += tip.dy * treeSpeed * dt;
        tip.since += dt;
        var e = tr.edges[tip.edge], pts = e.pts, n = pts.length;
        var ddx = tip.x - pts[n - 2], ddy = tip.y - pts[n - 1];
        if (ddx * ddx + ddy * ddy >= 25) pts.push(tip.x, tip.y);

        var r = Math.sqrt(tip.x * tip.x + tip.y * tip.y);
        if (r > rMax) { e.state = 2; pts.push(tip.x, tip.y); tips.splice(i, 1); continue; }   // reached the horizon
        var behind = tr.best - tip.score;
        var hazard = 0.03 + (behind > 1.4 ? 0.8 : behind > 0.8 ? 0.18 : 0);
        if (rng() < hazard * dt && tip.depth > 0) { pts.push(tip.x, tip.y); killTip(tr, tip); tips.splice(i, 1); continue; }
        if (tip.since >= tip.next) { pts.push(tip.x, tip.y); splitTip(tr, tip); tips.splice(i, 1); }
      }
      // keep the frontier bounded: the weakest tips are pruned
      if (tips.length > maxTips) {
        tips.sort(function (a, b) { return b.score - a.score; });
        while (tips.length > maxTips) { var w2 = tips.pop(); w2.edge >= 0 && killTip(tr, w2); }
      }
      // current best lineage
      var bestTip = null;
      for (i = 0; i < tips.length; i++) if (!bestTip || tips[i].score > bestTip.score) bestTip = tips[i];
      tr.bestEdge = bestTip ? bestTip.edge : tr.bestEdge;
      if (!tips.length && !tr.done) { tr.done = true; tr.fadeAt = t + 1.5; }
    }

    function stepTrees(dt) {
      if (!growing || growing.done) growing = newTree();
      for (var i = trees.length - 1; i >= 0; i--) {
        var tr = trees[i];
        if (!tr.done) stepTree(tr, dt);
        if (tr.done && t > tr.fadeAt) {
          tr.alpha = Math.max(0, 1 - (t - tr.fadeAt) / 8);
          if (tr.alpha <= 0) trees.splice(i, 1);
        }
      }
      // the next generation starts while this one is still filling the frame
      var far = 0;
      for (i = 0; i < growing.tips.length; i++) {
        var tp = growing.tips[i];
        far = Math.max(far, tp.x * tp.x + tp.y * tp.y);
      }
      if (far > rMax * rMax * 0.5 && growing.edges.length > 120) {
        growing.old = true;
        growing = newTree();
        // at most two generations grow at once; older ones wind down
        var live = 0;
        for (i = trees.length - 1; i >= 0; i--) {
          if (trees[i].done) continue;
          live++;
          if (live > 2) { trees[i].done = true; trees[i].fadeAt = t + 1; }
        }
      }
    }

    function drawTree(tr) {
      var A = tr.alpha, edges = tr.edges, i, e, p, n;
      // best lineage as a set
      var bestSet = {};
      for (i = tr.bestEdge; i >= 0; i = edges[i].parent) bestSet[i] = true;
      var pAlive = new Path2D(), pDead = new Path2D(), pBest = new Path2D();
      for (i = 0; i < edges.length; i++) {
        e = edges[i]; p = e.pts; n = p.length;
        if (n < 4) continue;
        var target = bestSet[i] ? pBest : e.state === 1 ? pDead : pAlive;
        target.moveTo(p[0], p[1]);
        for (var j = 2; j < n; j += 2) target.lineTo(p[j], p[j + 1]);
      }
      lctx.lineWidth = 1 / zoom;
      lctx.strokeStyle = "rgba(96,130,205," + (0.36 * A).toFixed(3) + ")";
      lctx.stroke(pDead);
      lctx.lineWidth = 1.3 / zoom;
      lctx.strokeStyle = "rgba(186,208,255," + (0.8 * A).toFixed(3) + ")";
      lctx.stroke(pAlive);
      lctx.lineWidth = 4 / zoom;
      lctx.strokeStyle = "rgba(170,200,255," + (0.14 * A).toFixed(3) + ")";
      lctx.stroke(pBest);
      lctx.lineWidth = 1.7 / zoom;
      lctx.strokeStyle = "rgba(255,255,255," + (0.9 * A).toFixed(3) + ")";
      lctx.stroke(pBest);

      // nodes: split points and dead ends
      var nd = new Path2D(), na = new Path2D(), rr = 1.7 / zoom;
      for (i = 0; i < tr.nodes.length; i++) {
        var q = tr.nodes[i];
        var tgt = q.dead ? nd : na;
        tgt.moveTo(q.x + rr, q.y);
        tgt.arc(q.x, q.y, rr, 0, TAU);
      }
      lctx.fillStyle = "rgba(96,130,205," + (0.45 * A).toFixed(3) + ")";
      lctx.fill(nd);
      lctx.fillStyle = "rgba(222,234,255," + (0.85 * A).toFixed(3) + ")";
      lctx.fill(na);
    }

    function drawTips() {
      if (!growing) return;
      var tips = growing.tips, A = growing.alpha;
      for (var i = 0; i < tips.length; i++) {
        var tp = tips[i];
        var lead = growing.bestEdge === tp.edge;
        var s = lead ? 22 : 12, a = lead ? 0.95 : 0.55;
        lctx.globalAlpha = a * A;
        lctx.drawImage(SPRITE, sx(tp.x) - s / 2, sy(tp.y) - s / 2, s, s);
      }
      lctx.globalAlpha = 1;
    }

    /* ---------- streamlines (cached in world space, re-projected per frame) ---------- */

    var STEP = 7, STEPS = 110, ARROW_GAP = 150;

    function buildLines() {
      var path = new Path2D();
      var arrows = [];
      var vw = W / zoom, vh = H / zoom;
      var x0 = camX - vw * 0.85, x1 = camX + vw * 0.85;
      var y0 = camY - vh * 0.85, y1 = camY + vh * 0.85;
      var c0 = Math.floor(x0 / lineGap), c1 = Math.ceil(x1 / lineGap);
      var r0 = Math.floor(y0 / lineGap), r1 = Math.ceil(y1 / lineGap);
      var cells = (c1 - c0 + 1) * (r1 - r0 + 1);
      var skip = cells > 320 ? Math.ceil(cells / 320) : 1;   // bounded budget when zoomed out
      var n = 0;
      for (var r = r0; r <= r1; r++) {
        for (var c = c0; c <= c1; c++) {
          if (skip > 1 && (n++ % skip) !== 0) continue;
          var x = (c + 0.15 + hash2(c, r) * 0.7) * lineGap;
          var y = (r + 0.15 + hash2(r, c + 7) * 0.7) * lineGap;
          var arc = 0, nextArrow = ARROW_GAP * 0.5;
          path.moveTo(x, y);
          for (var i = 0; i < STEPS; i++) {
            flow(x, y, t, vout);
            var m = Math.sqrt(vout[0] * vout[0] + vout[1] * vout[1]) + 1e-6;
            var ux = vout[0] / m, uy = vout[1] / m;
            x += ux * STEP; y += uy * STEP;
            path.lineTo(x, y);
            arc += STEP;
            if (arc >= nextArrow) { nextArrow += ARROW_GAP; arrows.push(x, y, ux, uy); }
            if (x * x + y * y < 400) break;
          }
        }
      }
      linesPath = path;
      linesArrows = arrows;
      arrowsPath = null;
    }

    function buildArrows() {
      var path = new Path2D();
      var L = 5.5 / zoom, wdt = 0.6;
      for (var i = 0; i < linesArrows.length; i += 4) {
        var ax = linesArrows[i], ay = linesArrows[i + 1], ux = linesArrows[i + 2], uy = linesArrows[i + 3];
        path.moveTo(ax - ux * L + uy * L * wdt, ay - uy * L - ux * L * wdt);
        path.lineTo(ax, ay);
        path.lineTo(ax - ux * L - uy * L * wdt, ay - uy * L + ux * L * wdt);
      }
      arrowsPath = path;
      arrowsZoom = zoom;
    }

    function drawLines() {
      if (!linesPath) buildLines();
      if (!arrowsPath || Math.abs(zoom / arrowsZoom - 1) > 0.12) buildArrows();
      lctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      lctx.clearRect(0, 0, W, H);

      // pole glow, breathing slowly
      var px = sx(0), py = sy(0), rz = Math.sqrt(zoom);
      var halo = lctx.createRadialGradient(px, py, 0, px, py, 420 * rz);
      halo.addColorStop(0, "rgba(90,130,220,0.20)");
      halo.addColorStop(0.5, "rgba(60,95,180,0.07)");
      halo.addColorStop(1, "rgba(40,70,140,0)");
      lctx.fillStyle = halo;
      lctx.fillRect(0, 0, W, H);
      var breath = 0.62 + 0.2 * Math.sin(t * TAU / 9);
      var core = lctx.createRadialGradient(px, py, 0, px, py, (24 + 6 * breath) * rz);
      core.addColorStop(0, "rgba(255,255,255," + (0.6 + 0.3 * breath).toFixed(3) + ")");
      core.addColorStop(0.35, "rgba(230,238,255,0.25)");
      core.addColorStop(1, "rgba(200,220,255,0)");
      lctx.fillStyle = core;
      lctx.fillRect(px - 60, py - 60, 120, 120);

      // world -> screen transform; stroke the cached paths
      lctx.setTransform(DPR * zoom, 0, 0, DPR * zoom, DPR * (W / 2 - camX * zoom), DPR * (H / 2 - camY * zoom));
      lctx.lineCap = "round";
      lctx.lineJoin = "round";
      lctx.strokeStyle = "rgba(96,142,224,0.16)";
      lctx.lineWidth = 1 / zoom;
      lctx.stroke(linesPath);
      lctx.strokeStyle = "rgba(130,172,240,0.34)";
      lctx.lineWidth = 1.1 / zoom;
      lctx.stroke(arrowsPath);
      for (var ti = 0; ti < trees.length; ti++) drawTree(trees[ti]);
      lctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      drawTips();
    }

    /* ---------- camera ---------- */

    // move the existing trails to where the new camera would draw them
    function carryTrails(pz, pcx, pcy) {
      if (pz === zoom && pcx === camX && pcy === camY) return false;
      var s = zoom / pz;
      var tx = (W / 2 - camX * zoom) - (W / 2 - pcx * pz) * s;
      var ty = (H / 2 - camY * zoom) - (H / 2 - pcy * pz) * s;
      sctx.save();
      sctx.globalCompositeOperation = "copy";
      sctx.setTransform(DPR * s, 0, 0, DPR * s, DPR * tx, DPR * ty);
      sctx.drawImage(starsC, 0, 0, W, H);
      sctx.restore();
      sctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      return true;
    }

    function stepCamera(dt) {
      var pz = zoom, pcx = camX, pcy = camY;
      if (homing) {
        zoom += (1 - zoom) * 0.12;
        camX += (homeX - camX) * 0.12;
        camY += (homeY - camY) * 0.12;
        if (Math.abs(1 - zoom) < 0.002 && Math.abs(homeX - camX) < 0.3 && Math.abs(homeY - camY) < 0.3) {
          zoom = 1; camX = homeX; camY = homeY; homing = false;
        }
        zoomT = zoom;
        setAnchor(W / 2, H / 2);
      } else {
        if (pendSX !== null) { aSX = pendSX; aSY = pendSY; pendSX = pendSY = null; }
        if (!dragging && (velX !== 0 || velY !== 0)) {
          aSX += velX * dt; aSY += velY * dt;
          var f = Math.pow(0.012, dt);                 // ~1.2 s glide
          velX *= f; velY *= f;
          if (Math.abs(velX) + Math.abs(velY) < 6) velX = velY = 0;
        }
        if (zoom !== zoomT) {
          zoom += (zoomT - zoom) * 0.16;
          if (Math.abs(zoomT - zoom) < 0.0008) zoom = zoomT;
        }
        applyAnchor();
      }
      return carryTrails(pz, pcx, pcy);
    }

    function zoomBy(px, py, factor, immediate) {
      homing = false;
      var nz = clamp(zoomT * factor, 0.55, 3);
      if (nz === zoomT) return;
      setAnchor(px, py);
      zoomT = nz;
      if (immediate) { zoom = nz; applyAnchor(); }
    }

    function goHome() {
      homing = true; dragging = false;
      velX = velY = 0; pendSX = pendSY = null;
      if (reduced) {
        zoom = zoomT = 1; camX = homeX; camY = homeY; homing = false;
        setAnchor(W / 2, H / 2); redrawAll();
      }
    }

    /* ---------- loop ---------- */

    function redrawAll() { linesPath = null; drawLines(); drawStars(0); }

    function frameFn(now) {
      raf = null;
      if (!running) return;
      var dt = Math.min(0.05, (now - lastT) / 1000 || 0.016);
      lastT = now;
      stepCamera(dt);
      t += dt;
      stepParticles(dt);
      stepTrees(dt);
      drawStars(0.066);
      if ((frame++ % quality.lineEvery) === 0) linesPath = null;
      drawLines();
      govern(now, dt);
      raf = requestAnimationFrame(frameFn);
    }

    function govern(now, dt) {
      dtAvg += (dt * 1000 - dtAvg) * 0.05;
      if (dtAvg > 27) {
        if (!slowSince) slowSince = now;
        if (now - slowSince > 1500 && level < 2) {
          level++;
          if (level === 1) { quality.count = 0.6; quality.lineEvery = 12; }
          else { quality.dpr = 1 / 1.5; quality.lineEvery = 16; }
          count = 0;
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

    function preroll(frames, treeSeconds) {
      var steps = Math.round(treeSeconds * 30);
      for (var k = 0; k < steps; k++) { t += 1 / 30; stepTrees(1 / 30); }
      for (var i = 0; i < frames; i++) {
        t += 1 / 60;
        stepParticles(1 / 60);
        drawStars(0.066);
      }
      drawLines();
    }

    /* ---------- interaction ---------- */

    function bind() {
      var el = starsC;
      var hint = section.querySelector(".field-hint");
      var pointers = {}, pinchD = 0, pinchZ = 1;
      var engaged = false, hintTimer = null;
      var samples = [];                              // recent pointer samples for inertia

      function localXY(e) {
        var r = el.getBoundingClientRect();
        return [e.clientX - r.left, e.clientY - r.top];
      }
      function sample(x, y) {
        var now = performance.now();
        samples.push([now, x, y]);
        while (samples.length > 6 || (samples.length && now - samples[0][0] > 120)) samples.shift();
      }

      el.addEventListener("pointerdown", function (e) {
        var xy = localXY(e);
        if (e.pointerType === "touch") {
          pointers[e.pointerId] = xy;
          var ids = Object.keys(pointers);
          if (ids.length === 2) {
            var a = pointers[ids[0]], b = pointers[ids[1]];
            pinchD = Math.hypot(a[0] - b[0], a[1] - b[1]);
            pinchZ = zoomT;
            homing = false; velX = velY = 0;
            setAnchor((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
            dragging = true;
            try { el.setPointerCapture(e.pointerId); } catch (x) {}
          }
          return;
        }
        if (e.button !== 0) return;
        homing = false; velX = velY = 0;
        setAnchor(xy[0], xy[1]);
        dragging = true; engaged = true;
        samples.length = 0; sample(xy[0], xy[1]);
        try { el.setPointerCapture(e.pointerId); } catch (x) {}
        el.classList.add("dragging");
        if (reduced) redrawAll();
      });

      el.addEventListener("pointermove", function (e) {
        var xy = localXY(e);
        if (e.pointerType === "touch") {
          if (!pointers[e.pointerId]) return;
          pointers[e.pointerId] = xy;
          var ids = Object.keys(pointers);
          if (ids.length !== 2) return;
          var a = pointers[ids[0]], b = pointers[ids[1]];
          var d = Math.hypot(a[0] - b[0], a[1] - b[1]);
          zoomT = clamp(pinchZ * d / Math.max(1, pinchD), 0.55, 3);
          zoom = zoomT;
          pendSX = (a[0] + b[0]) / 2; pendSY = (a[1] + b[1]) / 2;
          e.preventDefault();
          return;
        }
        if (!dragging) return;
        pendSX = xy[0]; pendSY = xy[1];
        sample(xy[0], xy[1]);
        if (reduced) { aSX = xy[0]; aSY = xy[1]; applyAnchor(); redrawAll(); }
      });

      function endPointer(e) {
        if (e.pointerType === "touch") {
          delete pointers[e.pointerId];
          if (Object.keys(pointers).length < 2) { dragging = false; pinchD = 0; }
          return;
        }
        if (!dragging) return;
        dragging = false;
        el.classList.remove("dragging");
        // inertia from the last ~100 ms of motion
        var now = performance.now();
        if (samples.length >= 2) {
          var last = samples[samples.length - 1], first = samples[0];
          var span = (last[0] - first[0]) / 1000;
          if (span > 0.02 && now - last[0] < 90) {
            velX = clamp((last[1] - first[1]) / span, -2600, 2600);
            velY = clamp((last[2] - first[2]) / span, -2600, 2600);
          }
        }
        samples.length = 0;
      }
      el.addEventListener("pointerup", endPointer);
      el.addEventListener("pointercancel", endPointer);

      el.addEventListener("wheel", function (e) {
        if (!(e.ctrlKey || e.metaKey || engaged)) return;
        e.preventDefault();
        var xy = localXY(e);
        var f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0018));
        zoomBy(xy[0], xy[1], f, reduced);
        if (reduced) redrawAll();
      }, { passive: false });

      el.addEventListener("dblclick", function (e) { e.preventDefault(); goHome(); });

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
    preroll(reduced || shotMode ? 60 : 30, reduced || shotMode ? 16 : 7);

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
    if (hero) createField(hero, { seed: 7, interactive: true, poleAt: [0.7, 0.46], density: 0.5, lineGap: 185, maxTips: 52, treeSpeed: 40 });
    var heads = document.querySelectorAll("[data-field-head]");
    for (var i = 0; i < heads.length; i++) {
      createField(heads[i], { seed: 11 + i, interactive: false, poleAt: [0.76, 0.5], density: 0.3, lineGap: 230, maxTips: 24, treeSpeed: 32 });
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
