/* OpenRSI Index — shared site scripts (star-trails edition) */
(function () {
  "use strict";

  /* screenshot / static mode: no entrance animations */
  if (/(\?|&)(shot|static)=1/.test(location.search)) {
    document.documentElement.classList.add("static");
  }

  /* ---------- nav: solid once the page has scrolled; light over the dark hero ---------- */
  var nav = document.querySelector(".nav");
  var hero = document.querySelector(".hero[data-sky-hero]");
  /* A single reversible view change, tied to the tree entering the viewport.
     No timers, wheel interception or scroll snapping. The renderer applies
     this progress to both the camera and mountains in the same frame. */
  var skyJourney = document.querySelector("body.home [data-sky-journey]");
  var journeyTree = skyJourney && document.querySelector(".tree-band");
  function updateSkyView() {
    if (!journeyTree) return;
    var vh = skyJourney.parentNode.clientHeight || window.innerHeight;
    var p = (vh * 0.92 - journeyTree.getBoundingClientRect().top) / (vh * 0.52);
    var progress = Math.max(0, Math.min(1, p)).toFixed(5);
    if (skyJourney.getAttribute("data-sky-progress") === progress) return;
    /* Persist the initial value: this script may run before the canvas boots. */
    skyJourney.setAttribute("data-sky-progress", progress);
    window.dispatchEvent(new CustomEvent("rsi-sky-view", { detail: { progress: +progress } }));
  }
  if (journeyTree) {
    window.addEventListener("scroll", updateSkyView, { passive: true });
    window.addEventListener("resize", updateSkyView, { passive: true });
    window.addEventListener("pageshow", updateSkyView);
    if ("ResizeObserver" in window) {
      var journeyResize = new ResizeObserver(updateSkyView);
      journeyResize.observe(hero);
      journeyResize.observe(journeyTree);
      journeyResize.observe(skyJourney.parentNode);
    }
    if (document.fonts) document.fonts.ready.then(updateSkyView);
    updateSkyView();
  }
  if (nav) {
    var onScroll = function () {
      nav.classList.toggle("scrolled", window.scrollY > 24);
      if (hero) {
        var r = hero.getBoundingClientRect();
        /* Like the blog's fixed sky, stay at y=0 when the page rubber-bands
           below the top edge. Follow the hero normally for downward scroll. */
        hero.classList.toggle("sky-anchored", r.top >= 0);
        var darks = document.querySelectorAll("[data-dark]");
        var last = darks.length ? darks[darks.length - 1].getBoundingClientRect() : r;
        nav.classList.toggle("over-dark", last.bottom > 64 && r.top < 64);
        /* how far the hero has scrolled away: the sky recedes, the copy fades */
        var p = -r.top / Math.max(1, r.height * 0.7);
        hero.style.setProperty("--hero", (p < 0 ? 0 : p > 1 ? 1 : p).toFixed(3));
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    onScroll();
  }

  /* ---------- the sky pauses off-screen; the button replays the exposure ---------- */
  if (hero && "IntersectionObserver" in window) {
    /* the sky is fixed behind the hero and the tree: it runs while either is on screen */
    var skyHosts = [hero].concat(Array.prototype.slice.call(document.querySelectorAll(".tree-band")));
    var skySeen = {};
    var skyIo = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { skySeen[skyHosts.indexOf(e.target)] = !!e.isIntersecting; });
      var any = skyHosts.some(function (_, i) { return skySeen[i]; });
      window.dispatchEvent(new CustomEvent("rsi-sky-visibility", { detail: { visible: any } }));
    });
    skyHosts.forEach(function (el) { skyIo.observe(el); });
  }
  /* the research tree draws itself the first time it is seen */
  var tree = document.querySelector(".rtree-wrap");
  var journeyHost = document.querySelector("body.home [data-sky-journey]");
  if (tree && "IntersectionObserver" in window) {
    /* on the home the camera is still moving while the tree comes up: let it settle first, so the
       tree's own draw-in (filtered strokes, repainted every frame) does not fight the sky for frames */
    var treeSeen = false, treeDrawn = false;
    var drawTree = function () {
      if (treeDrawn || !treeSeen) return;
      var p = journeyHost ? +journeyHost.getAttribute("data-sky-progress") || 0 : 1;
      if (p < 0.98) return;
      treeDrawn = true; tree.classList.add("in"); treeIo.disconnect();
      window.removeEventListener("rsi-sky-view", drawTree);
    };
    var treeIo = new IntersectionObserver(function (entries) {
      treeSeen = !!entries[0].isIntersecting; drawTree();
    }, { threshold: 0.25 });
    treeIo.observe(tree);
    if (journeyHost) window.addEventListener("rsi-sky-view", drawTree);
  } else if (tree) { tree.classList.add("in"); }
  /* so does the contribution flow */
  var flow = document.querySelector("#contribute .cfc-flow");
  if (flow && "IntersectionObserver" in window) {
    var flowIo = new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) { flow.classList.add("in"); flowIo.disconnect(); }
    }, { threshold: 0.35 });
    flowIo.observe(flow);
  } else if (flow) { flow.classList.add("in"); }

  /* the partner band opens out as its middle rises through the lower screen */
  var band = document.querySelector("[data-band]");
  if (band) {
    var onBand = function () {
      var b = band.getBoundingClientRect(), vh = window.innerHeight;
      var p = 1 - (b.top + b.height / 2 - vh * 0.3) / (vh * 0.9);
      p = p < 0 ? 0 : p > 1 ? 1 : p;
      band.style.setProperty("--band", (1 - Math.pow(1 - p, 3)).toFixed(4));
    };
    window.addEventListener("scroll", onBand, { passive: true });
    window.addEventListener("resize", onBand, { passive: true });
    onBand();
  }

  var replay = document.querySelector("[data-sky-replay]");
  if (replay) {
    replay.addEventListener("click", function () { window.dispatchEvent(new Event("rsi-sky-replay")); });
  }

  /* ---------- mobile nav ---------- */
  var toggle = document.querySelector(".nav-toggle");
  var links = document.querySelector(".nav-links");
  if (toggle && links) {
    toggle.addEventListener("click", function () {
      links.classList.toggle("open");
      toggle.setAttribute("aria-expanded", links.classList.contains("open") ? "true" : "false");
    });
  }

  /* ---------- hero labels: one letter at a time, from the outside in ---------- */
  var labels = document.querySelectorAll("[data-split]");
  Array.prototype.forEach.call(labels, function (el) {
    var text = el.textContent;
    el.setAttribute("aria-label", text);
    el.textContent = "";
    var chars = text.split("");
    var fromRight = el.classList.contains("right");
    chars.forEach(function (c, i) {
      var s = document.createElement("span");
      s.className = "ch";
      s.setAttribute("aria-hidden", "true");
      s.textContent = c === " " ? "\u00a0" : c;
      var order = fromRight ? chars.length - 1 - i : i;
      s.style.setProperty("--i", String(order));
      el.appendChild(s);
    });
  });

  /* ---------- task domain filters (tasks page) ---------- */
  var chips = document.querySelectorAll(".filterbar .chip");
  if (chips.length) {
    var sections = document.querySelectorAll(".track-section");
    Array.prototype.forEach.call(chips, function (chip) {
      chip.addEventListener("click", function () {
        Array.prototype.forEach.call(chips, function (c) { c.classList.remove("active"); });
        chip.classList.add("active");
        var dom = chip.getAttribute("data-domain");
        Array.prototype.forEach.call(sections, function (s) {
          var show = dom === "all" || s.getAttribute("data-domain") === dom;
          s.style.display = show ? "" : "none";
        });
      });
    });
  }

  /* A detail-page axis switch only controls its own combined climb. */
  Array.prototype.forEach.call(document.querySelectorAll("[data-climb]"), function (climb) {
    var controls = climb.querySelector(".climb-switch");
    var buttons = climb.querySelectorAll("[data-climb-axis]");
    var views = climb.querySelectorAll(".climb-view");
    Array.prototype.forEach.call(buttons, function (button) {
      button.addEventListener("click", function () {
        var axis = button.getAttribute("data-climb-axis");
        Array.prototype.forEach.call(buttons, function (other) {
          other.setAttribute("aria-pressed", other === button ? "true" : "false");
        });
        Array.prototype.forEach.call(views, function (view) {
          var selected = view.getAttribute("data-axis") === axis;
          view.hidden = !selected;
          view.classList.toggle("on", selected);
        });
      });
    });
    if (controls) { controls.hidden = false; }
  });
})();

/* tabbed task frames: each frame switches its own panels */
(function () {
  "use strict";
  var frames = document.querySelectorAll(".task-frame");
  Array.prototype.forEach.call(frames, function (fr) {
    var tabs = fr.querySelectorAll(".tt");
    var panels = fr.querySelectorAll(".task-panel");
    function selectTab(tb) {
      Array.prototype.forEach.call(tabs, function (q) {
        q.classList.remove("on"); q.setAttribute("aria-selected", "false");
      });
      Array.prototype.forEach.call(panels, function (pn) {
        pn.classList.toggle("on", pn.getAttribute("data-p") === tb.getAttribute("data-t"));
      });
      tb.classList.add("on"); tb.setAttribute("aria-selected", "true");
    }
    Array.prototype.forEach.call(tabs, function (tb) {
      tb.addEventListener("click", function () { selectTab(tb); });
    });
    var hashTarget = location.hash && document.getElementById(location.hash.slice(1));
    if (hashTarget && fr.contains(hashTarget) && hashTarget.classList.contains("tt")) {
      selectTab(hashTarget);
    }
  });

  /* in-page links to a tab (#marin-scaling-ladder): select it, then land the frame under the nav */
  function aim() {
    var t = location.hash && document.getElementById(location.hash.slice(1));
    if (!t || !t.classList.contains("tt")) { return; }
    t.click();
    var fr = t.closest(".task-frame");
    if (fr) { requestAnimationFrame(function () { fr.scrollIntoView({ block: "start" }); }); }
  }
  window.addEventListener("hashchange", aim);
  window.addEventListener("load", function () { if (location.hash) { setTimeout(aim, 50); } });
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) { return; }
    var id = a.getAttribute("href").slice(1), t = document.getElementById(id);
    if (t && t.classList.contains("tt")) {
      e.preventDefault();
      if (location.hash !== "#" + id) { location.hash = id; } else { aim(); }
    }
  });
})();

// lightweight task tabs: drag the row sideways with the mouse (touch scrolls natively)
(function () {
  var row = document.querySelector('#lightweight .task-tabs');
  if (!row) return;
  var x0 = 0, s0 = 0, moved = false, down = false;
  row.addEventListener('pointerdown', function (e) {
    if (e.pointerType !== 'mouse') return;
    down = true; moved = false; x0 = e.clientX; s0 = row.scrollLeft;
  });
  row.addEventListener('pointermove', function (e) {
    if (!down) return;
    var dx = e.clientX - x0;
    if (!moved && Math.abs(dx) < 4) return;
    if (!moved) { moved = true; row.classList.add('dragging'); }
    row.scrollLeft = s0 - dx;
  });
  function up() { if (!down) return; down = false; row.classList.remove('dragging'); }
  row.addEventListener('pointerup', up); row.addEventListener('pointercancel', up); row.addEventListener('mouseleave', up);
  row.addEventListener('click', function (e) { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
})();
