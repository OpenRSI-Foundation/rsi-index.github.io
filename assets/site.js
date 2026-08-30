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

})();

/* ---------- scroll reveal (expo-out rise on first sight) ---------- */
(function () {
  "use strict";
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var groups = document.querySelectorAll(
    ".grid, .env-grid, .post-list, .pipeline, .steps"
  );
  var singles = document.querySelectorAll(
    ".section-head, .formula, .cta-band, .track-head, .track-desc, " +
    ".table-scroll, pre.tree, .forbid, .checks, .updated, .pagehead .lede"
  );
  var tagged = [];
  groups.forEach(function (g) {
    if (g.closest(".hero")) return;
    Array.prototype.forEach.call(g.children, function (c, i) {
      c.classList.add("reveal");
      c.style.setProperty("--rd", Math.min(i, 6) * 70 + "ms");
      tagged.push(c);
    });
  });
  singles.forEach(function (el) {
    if (el.closest(".hero")) return;
    el.classList.add("reveal");
    tagged.push(el);
  });
  if (reduced || document.hidden || !("IntersectionObserver" in window)) {
    tagged.forEach(function (el) { el.classList.add("in"); });
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    });
  }, { threshold: 0.1, rootMargin: "0px 0px -6% 0px" });
  tagged.forEach(function (el) { io.observe(el); });
})();

/* ---------- hero light follows the pointer ---------- */
(function () {
  "use strict";
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (!window.matchMedia("(pointer: fine)").matches) return;
  var hero = document.querySelector(".hero");
  var aur = hero && hero.querySelector(".hero-aurora");
  if (!aur) return;

  var glow = document.createElement("div");
  glow.className = "aurora-cursor";
  aur.appendChild(glow);
  var blobs = aur.querySelectorAll("i");
  var depth = [0.055, 0.085, 0.04];          // parallax per blob

  var tx = 0, ty = 0, cx = 0, cy = 0;
  var bcx = [0, 0, 0], bcy = [0, 0, 0];
  var inside = false, raf = null, started = false;

  function tick() {
    cx += (tx - cx) * 0.09;
    cy += (ty - cy) * 0.09;
    glow.style.translate = cx.toFixed(1) + "px " + cy.toFixed(1) + "px";

    var r = hero.getBoundingClientRect();
    var ox = tx - r.width / 2, oy = ty - r.height / 2;
    var still = Math.abs(tx - cx) < 0.4 && Math.abs(ty - cy) < 0.4;
    for (var i = 0; i < blobs.length; i++) {
      var gx = inside ? ox * depth[i] : 0;
      var gy = inside ? oy * depth[i] * 0.8 : 0;
      bcx[i] += (gx - bcx[i]) * 0.06;
      bcy[i] += (gy - bcy[i]) * 0.06;
      blobs[i].style.translate = bcx[i].toFixed(1) + "px " + bcy[i].toFixed(1) + "px";
      if (Math.abs(gx - bcx[i]) > 0.3 || Math.abs(gy - bcy[i]) > 0.3) still = false;
    }
    if (inside || !still) raf = requestAnimationFrame(tick);
    else raf = null;
  }

  hero.addEventListener("mousemove", function (e) {
    var r = hero.getBoundingClientRect();
    tx = e.clientX - r.left;
    ty = e.clientY - r.top;
    if (!started) { cx = tx; cy = ty; started = true; }   // no fly-in from the corner
    inside = true;
    glow.classList.add("on");
    if (!raf) raf = requestAnimationFrame(tick);
  });
  hero.addEventListener("mouseleave", function () {
    inside = false;
    glow.classList.remove("on");
    if (!raf) raf = requestAnimationFrame(tick);          // ease the blobs home
  });
})();
