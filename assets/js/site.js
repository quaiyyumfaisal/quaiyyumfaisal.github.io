(function () {
  "use strict";

  // Header gets a border once the page scrolls
  var header = document.querySelector(".site-header");
  var progress = document.querySelector(".progress");
  var article = document.querySelector(".note .prose");

  function onScroll() {
    var y = window.scrollY || window.pageYOffset;
    if (header) header.classList.toggle("is-scrolled", y > 8);

    // Reading progress on note pages
    if (progress && article) {
      var rect = article.getBoundingClientRect();
      var total = rect.height - window.innerHeight * 0.6;
      var done = Math.min(1, Math.max(0, (-rect.top + window.innerHeight * 0.25) / Math.max(total, 1)));
      progress.style.transform = "scaleX(" + done.toFixed(4) + ")";
    }
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  onScroll();

  // Copy buttons on code blocks
  document.querySelectorAll(".prose div.highlighter-rouge").forEach(function (block) {
    var code = block.querySelector("code");
    if (!code) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "copy-btn";
    btn.textContent = "Copy";
    btn.setAttribute("aria-label", "Copy code to clipboard");
    btn.addEventListener("click", function () {
      var text = code.innerText.replace(/\n$/, "");
      var done = function () {
        btn.textContent = "Copied";
        btn.classList.add("is-copied");
        setTimeout(function () { btn.textContent = "Copy"; btn.classList.remove("is-copied"); }, 1600);
      };
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(done, function () {});
      } else {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); done(); } catch (e) {}
        document.body.removeChild(ta);
      }
    });
    block.appendChild(btn);
  });

  // External links inside notes open in a new tab
  document.querySelectorAll(".prose a[href^='http']").forEach(function (a) {
    if (a.hostname !== window.location.hostname) {
      a.target = "_blank";
      a.rel = "noopener";
    }
  });
})();
