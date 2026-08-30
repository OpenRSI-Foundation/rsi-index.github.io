/* ============================================================
   RSI-Index — the search field
   An illustrative simulation of the RSI loop: an agent explores
   a tree of runs from a frozen human baseline. Node brightness
   tracks score; a new best sends a pulse down its lineage;
   hard policy violations flash and are pruned to zero.
   Hover a run to light its lineage. Click a run to branch it.
   ============================================================ */
(function () {
  "use strict";

  var CELL = 56;                        // grid pitch, matches the CSS grid
  var TAU = Math.PI * 2;

  var MUTATIONS = [
    "swap LR schedule → WSD",
    "reshape preconditioner geometry",
    "fuse QKV projections",
    "raise grad-clip → 1.5",
    "re-mix data: +code −web",
    "cache dataloader shards",
    "EMA weights for eval",
    "rotate momentum basis",
    "widen warmup 2×",
    "drop attention bias terms",
    "compress long-CoT traces",
    "curriculum: easy → hard",
    "orthogonalize update steps",
    "prune duplicate captions",
    "tighten tokenizer merges",
    "overlap comm/compute",
    "re-weight loss by learnability",
    "anneal batch size up",
    "distill judge signal",
    "regularize state norms",
    "shard optimizer states",
    "swap init → μP-scaled",
    "filter low-entropy batches",
    "two-stage decay restart",
    "quantize activations to fp8",
    "resample hard negatives"
  ];

  var VIOLATIONS = [
    "eval-data leakage",
    "reward-path edit",
    "budget overrun",
    "protected-path change",
    "undeclared artifact"
  ];

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var shotMode = /(\?|&)shot=1/.test(location.search);
  if (shotMode) document.documentElement.classList.add("shot");

  function gauss() {
    var u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function backOut(t) { var s = 1.70158; t -= 1; return 1 + (s + 1) * t * t * t + s * t * t; }

  /* pre-rendered radial glow sprite (white); tinted at draw time */
  function makeGlow(size) {
    var c = document.createElement("canvas");
    c.width = c.height = size;
    var g = c.getContext("2d");
    var r = size / 2;
    var grad = g.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, "rgba(255,255,255,0.85)");
    grad.addColorStop(0.35, "rgba(255,255,255,0.28)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    return c;
  }
  var GLOW = makeGlow(96);

  /* color ramps: lavender -> pale -> warm white; violation orange */
  function nodeColor(bright, heat, viol) {
    // base lavender 143,147,214 -> bright 228,225,251
    var r = lerp(143, 228, bright), g = lerp(147, 225, bright), b = lerp(214, 251, bright);
    if (heat > 0) { r = lerp(r, 255, heat); g = lerp(g, 243, heat); b = lerp(b, 221, heat); }
    if (viol > 0) { r = lerp(r, 255, viol); g = lerp(g, 122, viol); b = lerp(b, 61, viol); }
    return [r | 0, g | 0, b | 0];
  }

  function createField(section, opts) {
    var canvas = section.querySelector("canvas");
    if (!canvas) return;
    section.classList.add("field-live");
    var ctx = canvas.getContext("2d");
    var tip = document.createElement("div");
    tip.className = "tree-tip";
    section.appendChild(tip);

    var spawnMs = opts.spawnMs || 300;
    var maxLive = opts.maxLive || 220;
    var frontierAt = opts.frontierAt || 0.78;
    var padTop = opts.padTop || 66;
    var padBottom = opts.padBottom || 150;

    var W = 0, H = 0, DPR = 1;
    var camX = -CELL * 1.5, camTarget = camX;
    var nodes = [], byId = {}, occupied = {};
    var nextId = 1, runCount = 0, violCount = 0;
    var best = null, bestScore = -1e9, bestPath = [];
    var minScore = 0, maxScore = 0.001;
    var pulses = [], rings = [], burstQueue = [];
    var acc = 0, lastT = 0, raf = null, running = false, visible = !document.hidden;
    var inView = true;
    var hoverNode = null, hoverStart = 0, dim = 0;
    var simNow = 0;                       // simulation clock; backdated during pre-grow
    var mouseX = -1, mouseY = -1, hasPointer = window.matchMedia("(hover: hover)").matches;

    var readout = opts.readout ? {
      runs: section.querySelector("[data-ro-runs]"),
      best: section.querySelector("[data-ro-best]"),
      viol: section.querySelector("[data-ro-viol]")
    } : null;

    function rowBounds() {
      return {
        min: Math.ceil(padTop / CELL),
        max: Math.max(Math.ceil(padTop / CELL) + 2, Math.floor((H - padBottom) / CELL))
      };
    }

    function resize() {
      var r = section.getBoundingClientRect();
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      W = Math.max(1, Math.round(r.width));
      H = Math.max(1, Math.round(r.height));
      canvas.width = W * DPR;
      canvas.height = H * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      draw(performance.now());
    }

    function key(c, r) { return c + "," + r; }

    function makeNode(parent, col, row, forceOk) {
      var n = {
        id: nextId++,
        parent: parent,
        col: col, row: row,
        x: col * CELL, y: row * CELL,
        score: 0, born: simNow,
        state: "live",                    // live | viol | ghost
        stateT: 0,
        kids: 0,
        depth: parent ? parent.depth + 1 : 0,
        mut: MUTATIONS[(Math.random() * MUTATIONS.length) | 0],
        violMsg: null,
        heat: 0,                          // white flash for new best
        _hl: 0, _hlDelay: 0,
        run: ++runCount
      };
      if (parent) {
        parent.kids++;
        n.score = parent.score + gauss() * 0.5 - 0.06;
        if (Math.random() < 0.055) n.score += 0.9 + Math.random() * 0.6;   // breakthrough
        if (!forceOk && n.depth > 2 && Math.random() < 0.062) {
          n.state = "viol";
          n.stateT = n.born;
          n.violMsg = VIOLATIONS[(Math.random() * VIOLATIONS.length) | 0];
          violCount++;
        }
      }
      nodes.push(n);
      byId[n.id] = n;
      occupied[key(col, row)] = true;
      if (n.state !== "viol" && n.score > bestScore + 1e-6) {
        bestScore = n.score;
        best = n;
        bestPath = [];
        var p = n;
        while (p) { bestPath.unshift(p); p = p.parent; }
        if (n.depth > 0) {
          var pts = bestPath.map(function (q) { return { x: q.x, y: q.y }; });
          pulses.push({ pts: pts, t0: n.born, dur: Math.min(2200, 380 + pts.length * 90) });
        }
        n.heat = 1;
      }
      return n;
    }

    var DYS = [-2, -1, -1, 0, 0, 1, 1, 2];

    function crowd(c, r) {
      var n = 0;
      for (var dc = -1; dc <= 1; dc++)
        for (var dr = -1; dr <= 1; dr++)
          if ((dc || dr) && occupied[key(c + dc, r + dr)]) n++;
      return n;
    }

    function spawnFrom(parent, force) {
      var rb = rowBounds();
      var col = parent.col + 1;
      var tries = 0, row;
      var order = DYS.slice();
      // shuffle preference
      for (var i = order.length - 1; i > 0; i--) {
        var j = (Math.random() * (i + 1)) | 0, t = order[i]; order[i] = order[j]; order[j] = t;
      }
      for (tries = 0; tries < order.length; tries++) {
        row = parent.row + order[tries];
        if (row < rb.min || row > rb.max) continue;
        if (occupied[key(col, row)]) continue;
        if (!force && crowd(col, row) > 2 && Math.random() < 0.85) continue;
        return makeNode(parent, col, row, false);
      }
      return null;
    }

    function frontierCol() {
      var m = 0;
      for (var i = 0; i < nodes.length; i++) if (nodes[i].col > m) m = nodes[i].col;
      return m;
    }

    function pickParent() {
      var fc = frontierCol();
      var span = Math.max(0.001, maxScore - minScore);
      var cands = [], weights = [], total = 0;
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (n.state !== "live") continue;
        if (n.kids >= 2) continue;
        if (n.col < fc - 8) continue;
        var norm = (n.score - minScore) / span;
        var w = Math.exp(2.3 * norm) + 0.14;
        cands.push(n); weights.push(w); total += w;
      }
      if (!cands.length) return null;
      var r = Math.random() * total;
      for (i = 0; i < cands.length; i++) {
        r -= weights[i];
        if (r <= 0) return cands[i];
      }
      return cands[cands.length - 1];
    }

    function liveCount() {
      var c = 0;
      for (var i = 0; i < nodes.length; i++) if (nodes[i].state === "live") c++;
      return c;
    }

    function pruneWeak(now) {
      if (liveCount() <= maxLive) return;
      var worst = null, worstScore = 1e9;
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (n.state !== "live" || n.kids > 0 || n === best) continue;
        if (now - n.born < 4000) continue;
        if (n.score < worstScore) { worstScore = n.score; worst = n; }
      }
      if (worst) {
        worst.state = "ghost";
        worst.stateT = now;
        if (worst.parent && worst.parent.kids > 0) worst.parent.kids--;
      }
    }

    function step(now) {
      simNow = now;
      var burst = burstQueue.length > 0;
      var p = burst ? burstQueue.shift() : pickParent();
      if (p) spawnFrom(p, burst);
      pruneWeak(now);
      // brightness normalization tracks the live population
      var lo = 1e9, hi = -1e9;
      for (var q = 0; q < nodes.length; q++) {
        var s = nodes[q].score;
        if (s < lo) lo = s;
        if (s > hi) hi = s;
      }
      if (lo <= hi) { minScore = lo; maxScore = hi; }
      // camera follows the frontier
      camTarget = Math.max(camTarget, frontierCol() * CELL - W * frontierAt);
      // cull far-left nodes
      var cut = camX - CELL * 3;
      if (nodes.length && nodes[0].x < cut) {
        var keep = [];
        for (var i = 0; i < nodes.length; i++) {
          var n = nodes[i];
          if (n.x < cut || n.state === "dead") {
            delete occupied[key(n.col, n.row)];
            delete byId[n.id];
            if (hoverNode === n) hoverNode = null;
          } else keep.push(n);
        }
        nodes = keep;
      }
      if (readout) {
        if (readout.runs) readout.runs.textContent = String(runCount).padStart(4, "0");
        if (readout.best) readout.best.textContent = (bestScore >= 0 ? "+" : "") + bestScore.toFixed(2) + "%";
        if (readout.viol) readout.viol.textContent = String(violCount);
      }
    }

    /* ---------------- hover ---------------- */

    function findNode(mx, my, radius) {
      var wx = mx + camX, wy = my;
      var bestN = null, bestD = radius * radius;
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (n.state === "ghost") continue;
        var dx = n.x - wx, dy = n.y - wy;
        var d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; bestN = n; }
      }
      return bestN;
    }

    var hoverSet = null;
    function setHover(n) {
      if (n === hoverNode) return;
      hoverNode = n;
      hoverStart = performance.now();
      if (n) {
        hoverSet = {};
        var d = 0, p = n;
        while (p) { p._hlDelay = d * 34; hoverSet[p.id] = true; d++; p = p.parent; }
        showTip(n);
        canvas.style.cursor = "pointer";
      } else {
        hoverSet = null;
        tip.classList.remove("on");
        canvas.style.cursor = "";
      }
    }

    function showTip(n) {
      var html;
      var pct = (n.score >= 0 ? "+" : "") + n.score.toFixed(2) + "%";
      if (n.state === "viol") {
        html = '<span class="t-id">run ' + String(n.run).padStart(4, "0") + "</span> · " +
               '<span class="t-viol">hard violation: ' + n.violMsg + "</span>" +
               '<span class="t-note">reward → 0 · branch pruned</span>';
      } else if (n.depth === 0) {
        html = '<span class="t-id">baseline</span> · human recipe, rerun frozen' +
               '<span class="t-note">the reference every run is scored against</span>';
      } else {
        html = '<span class="t-id">run ' + String(n.run).padStart(4, "0") + "</span> · " +
               '<span class="t-delta' + (n.score < 0 ? " neg" : "") + '">' + pct + " vs baseline</span>" +
               '<span class="t-note">' + n.mut + (n === best ? " · current best" : "") + "</span>";
      }
      tip.innerHTML = html;
      tip.classList.add("on");
      positionTip(n);
    }

    function positionTip(n) {
      var sx = n.x - camX, sy = n.y;
      var tw = tip.offsetWidth || 200;
      var left = Math.max(10, Math.min(W - tw - 10, sx - tw / 2));
      var top = sy - (tip.offsetHeight || 48) - 18;
      if (top < 8) top = sy + 18;
      tip.style.left = left + "px";
      tip.style.top = top + "px";
    }

    /* ---------------- drawing ---------------- */

    function inLineage(n) { return hoverSet !== null && hoverSet[n.id] === true; }

    function draw(now) {
      ctx.clearRect(0, 0, W, H);

      /* grid, panning with the camera */
      ctx.strokeStyle = "rgba(196,190,232,0.05)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      var gx = -((camX % CELL) + CELL) % CELL;
      for (var x = gx; x <= W; x += CELL) {
        ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H);
      }
      for (var y = 0; y <= H; y += CELL) {
        ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5);
      }
      ctx.stroke();

      var span = Math.max(0.001, maxScore - minScore);
      var hovering = hoverNode !== null;
      dim += ((hovering ? 0.5 : 0) - dim) * 0.12;

      var bestSet = null;
      if (bestPath.length) {
        bestSet = {};
        for (var b = 0; b < bestPath.length; b++) bestSet[bestPath[b].id] = true;
      }

      /* links */
      var i, n;
      for (i = 0; i < nodes.length; i++) {
        n = nodes[i];
        if (!n.parent || !byId[n.parent.id]) continue;
        var p = n.parent;
        var x1 = p.x - camX, y1 = p.y, x2 = n.x - camX, y2 = n.y;
        if (x2 < -CELL || x1 > W + CELL) continue;

        var age = now - n.born;
        var grow = reduced ? 1 : clamp01(age / 460);
        var alpha, width, cr, cg, cb;
        var bn = clamp01(Math.pow((n.score - minScore) / span, 1.6));


        var onBest = bestSet && bestSet[n.id] && bestSet[p.id];
        if (onBest) {
          alpha = 0.72; width = 1.9;
          cr = 255; cg = 240; cb = 214;
        } else {
          alpha = 0.3 + bn * 0.4; width = 1.25;
          cr = 156; cg = 158; cb = 222;
        }
        if (n._hl > 0.01) {
          alpha = lerp(alpha, 0.95, n._hl);
          width = lerp(width, 2.1, n._hl);
          cr = lerp(cr, 255, n._hl); cg = lerp(cg, 214, n._hl); cb = lerp(cb, 156, n._hl);
        } else if (dim > 0.01) {
          alpha *= (1 - dim * 0.8);
        }
        if (n.state === "ghost") alpha *= Math.max(0, 1 - (now - n.stateT) / 700);
        if (n.state === "viol") { cr = 255; cg = 132; cb = 80; }

        ctx.strokeStyle = "rgba(" + (cr | 0) + "," + (cg | 0) + "," + (cb | 0) + "," + (alpha * grow).toFixed(3) + ")";
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        var mx = (x2 - x1) * 0.55;
        ctx.bezierCurveTo(x1 + mx, y1, x2 - mx, y2, x2, y2);
        if (grow < 1) {
          var len = Math.hypot(x2 - x1, y2 - y1) * 1.15;
          ctx.setLineDash([len, len]);
          ctx.lineDashOffset = len * (1 - grow);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.lineDashOffset = 0;
        } else {
          ctx.stroke();
        }
      }

      /* best pulses travelling along the lineage */
      for (i = pulses.length - 1; i >= 0; i--) {
        var pu = pulses[i];
        var t = (now - pu.t0) / pu.dur;
        if (t >= 1) { pulses.splice(i, 1); continue; }
        var pos = t * (pu.pts.length - 1);
        var seg = Math.min(pu.pts.length - 2, pos | 0);
        var ft = pos - seg;
        var px = lerp(pu.pts[seg].x, pu.pts[seg + 1].x, ft) - camX;
        var py = lerp(pu.pts[seg].y, pu.pts[seg + 1].y, ft);
        if (px < -20 || px > W + 20) continue;
        var pa = Math.sin(Math.min(1, t) * Math.PI);
        ctx.globalAlpha = pa * 0.9;
        ctx.drawImage(GLOW, px - 14, py - 14, 28, 28);
        ctx.globalAlpha = 1;
      }

      /* nodes */
      ctx.globalCompositeOperation = "lighter";
      for (i = 0; i < nodes.length; i++) {
        n = nodes[i];
        var sx = n.x - camX, sy = n.y;
        if (sx < -CELL || sx > W + CELL) continue;

        var age2 = now - n.born;
        var pop = reduced ? 1 : (age2 < 450 ? backOut(clamp01(age2 / 450)) : 1);
        var bn2 = clamp01(Math.pow((n.score - minScore) / span, 1.6));
        n.heat *= 0.985;
        var viol = n.state === "viol" ? Math.min(1, age2 / 250) : 0;
        var isBest = n === best;
        var heat = Math.max(n.heat, isBest ? 0.55 + 0.1 * Math.sin(now / 300) : 0);

        // hover lineage highlight (staggered), animated here for every node
        var hlT = 0;
        if (hovering && inLineage(n)) hlT = clamp01(((now - hoverStart) - n._hlDelay) / 200);
        n._hl += (hlT - n._hl) * 0.25;

        var col = nodeColor(bn2, heat, viol);
        var r = (1.7 + Math.pow(bn2, 1.4) * 6.2
                 + (n.kids >= 2 ? 1.1 : 0)
                 + (isBest ? 2.0 : 0)
                 + (n.depth === 0 ? 2.4 : 0)) * pop;
        var alpha2 = 0.55 + bn2 * 0.45;
        if (n.state === "ghost") alpha2 = Math.max(0, 1 - (now - n.stateT) / 700);
        if (dim > 0.01 && !(hovering && inLineage(n))) alpha2 *= (1 - dim * 0.75);
        var hlN = n._hl;
        if (hlN > 0.01) { col = nodeColor(bn2, Math.max(heat, hlN * 0.9), viol); r *= 1 + hlN * 0.25; }
        if (alpha2 <= 0.01 || r <= 0.05) {
          if (n.state === "ghost" && alpha2 <= 0.01) n.state = "dead";
          continue;
        }

        /* glow */
        var glowR = r * (2.8 + heat * 3.0 + viol * 2);
        ctx.globalAlpha = alpha2 * (0.16 + bn2 * 0.42 + heat * 0.5 + viol * 0.45);
        tintGlow(col);
        ctx.drawImage(TINT, sx - glowR, sy - glowR, glowR * 2, glowR * 2);

        /* core */
        ctx.globalAlpha = alpha2;
        ctx.fillStyle = "rgb(" + col[0] + "," + col[1] + "," + col[2] + ")";
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.globalCompositeOperation = "source-over";

      /* click rings */
      for (i = rings.length - 1; i >= 0; i--) {
        var rg = rings[i];
        var rt = (now - rg.t0) / 620;
        if (rt >= 1) { rings.splice(i, 1); continue; }
        ctx.strokeStyle = "rgba(255,244,224," + (0.7 * (1 - rt)).toFixed(3) + ")";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(rg.x - camX, rg.y, 6 + rt * 30, 0, TAU);
        ctx.stroke();
      }

      /* labels: baseline root + current best */
      ctx.font = "600 9.5px 'Geist Mono', ui-monospace, monospace";
      var root = nodes[0];
      if (root && root.depth === 0) {
        var rx = root.x - camX;
        if (rx > -80 && rx < W + 80) {
          ctx.fillStyle = "rgba(233,230,250,0.55)";
          ctx.textAlign = "center";
          ctx.fillText("HUMAN BASELINE", rx, root.y + 24);
        }
      }
      if (best && best.depth > 0) {
        var bx = best.x - camX;
        if (bx > -80 && bx < W + 80) {
          ctx.fillStyle = "rgba(247,196,120,0.9)";
          ctx.textAlign = "center";
          ctx.fillText("+" + best.score.toFixed(2) + "%", bx, best.y - 16);
        }
      }
      ctx.textAlign = "start";
    }

    /* tint cache: recolor the white glow sprite */
    var TINT = document.createElement("canvas");
    TINT.width = TINT.height = 96;
    var tctx = TINT.getContext("2d");
    var lastTint = "";
    function tintGlow(col) {
      var k = col[0] + "," + col[1] + "," + col[2];
      if (k === lastTint) return;
      lastTint = k;
      tctx.clearRect(0, 0, 96, 96);
      tctx.drawImage(GLOW, 0, 0);
      tctx.globalCompositeOperation = "source-in";
      tctx.fillStyle = "rgb(" + k + ")";
      tctx.fillRect(0, 0, 96, 96);
      tctx.globalCompositeOperation = "source-over";
    }

    /* ---------------- main loop ---------------- */

    function frame(now) {
      raf = null;
      if (!running) return;
      var dt = Math.min(100, now - lastT);
      lastT = now;
      acc += dt;
      var guard = 0;
      while (acc >= spawnMs && guard++ < 6) { step(now); acc -= spawnMs; }
      camX += (camTarget - camX) * 0.018;
      if (hoverNode && byId[hoverNode.id]) positionTip(hoverNode);
      else if (hoverNode) setHover(null);
      draw(now);
      raf = requestAnimationFrame(frame);
    }

    function start() {
      if (running || reduced) return;
      running = true;
      lastT = performance.now();
      if (!raf) raf = requestAnimationFrame(frame);
    }
    function stop() {
      running = false;
      if (raf) { cancelAnimationFrame(raf); raf = null; }
    }
    function syncRun() { (visible && inView) ? start() : stop(); }

    /* ---------------- init ---------------- */

    function seed() {
      var rb = rowBounds();
      var midRow = Math.max(rb.min, Math.min(rb.max, Math.round((rb.min + rb.max) / 2)));
      makeNode(null, 1, midRow, true);
    }

    resize();
    simNow = performance.now();
    seed();

    // pre-grow so the field never starts empty
    var pre = opts.preGrow || 70;
    if (reduced || shotMode) pre = Math.max(pre, opts.shotGrow || 260);
    var t0 = performance.now();
    for (var s = 0; s < pre; s++) step(t0 - (pre - s) * spawnMs);
    camX = camTarget;
    draw(t0);

    if (!reduced) {
      if ("IntersectionObserver" in window) {
        new IntersectionObserver(function (es) {
          inView = es[0].isIntersecting;
          syncRun();
        }, { rootMargin: "80px" }).observe(section);
      }
      document.addEventListener("visibilitychange", function () {
        visible = !document.hidden;
        syncRun();
      });
      start();
    }

    window.addEventListener("resize", resize);

    if (hasPointer) {
      canvas.addEventListener("mousemove", function (e) {
        var r = canvas.getBoundingClientRect();
        mouseX = e.clientX - r.left;
        mouseY = e.clientY - r.top;
        setHover(findNode(mouseX, mouseY, 26));
        if (reduced) draw(performance.now());
      });
      canvas.addEventListener("mouseleave", function () {
        setHover(null);
        if (reduced) draw(performance.now());
      });
    }
    canvas.addEventListener("click", function (e) {
      var r = canvas.getBoundingClientRect();
      var n = findNode(e.clientX - r.left, e.clientY - r.top, 34);
      if (!n || n.state !== "live") return;
      rings.push({ x: n.x, y: n.y, t0: performance.now() });
      burstQueue.push(n, n, n);
      acc += spawnMs * 3;                 // release the burst promptly
      if (reduced) {
        var now = performance.now();
        for (var k = 0; k < 3; k++) step(now);
        camX = camTarget;
        draw(now);
      }
    });
  }

  /* auto-init */
  function init() {
    var hero = document.querySelector("[data-tree-hero]");
    if (hero) createField(hero, {
      spawnMs: 300, maxLive: 230, frontierAt: 0.86,
      padTop: 76, padBottom: 170, preGrow: 80, shotGrow: 300, readout: true
    });
    var heads = document.querySelectorAll("[data-tree-head]");
    for (var i = 0; i < heads.length; i++) createField(heads[i], {
      spawnMs: 640, maxLive: 110, frontierAt: 0.8,
      padTop: 44, padBottom: 44, preGrow: 90, shotGrow: 160, readout: false
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
