/* RSI-Index — shared site scripts */
(function () {
  "use strict";

  /* screenshot / static mode: reveal everything instantly */
  if (/(\?|&)shot=1/.test(location.search)) {
    document.documentElement.classList.add("shot");
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
  var shot = document.documentElement.classList.contains("shot");
  var groups = document.querySelectorAll(
    ".grid, .env-grid, .post-list, .pipeline, .steps"
  );
  var singles = document.querySelectorAll(
    ".section-head, .formula, .cta-band, .track-head, .track-desc, " +
    ".table-scroll, pre.tree, .forbid, .checks, .updated, .pagehead .lede"
  );
  var tagged = [];
  groups.forEach(function (g) {
    if (g.closest(".hero-field")) return;
    Array.prototype.forEach.call(g.children, function (c, i) {
      c.classList.add("reveal");
      c.style.setProperty("--rd", Math.min(i, 6) * 70 + "ms");
      tagged.push(c);
    });
  });
  singles.forEach(function (el) {
    if (el.closest(".hero-field")) return;
    el.classList.add("reveal");
    tagged.push(el);
  });
  if (reduced || shot || document.hidden || !("IntersectionObserver" in window)) {
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
