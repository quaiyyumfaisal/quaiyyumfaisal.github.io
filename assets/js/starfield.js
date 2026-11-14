/*
 * Night sky behind the whole site.
 *  - Far layer (static): a procedural Milky Way — noise-textured glow, warm core, dust lanes,
 *    pink nebulae and thousands of faint stars. Computed once on a coarse grid, cached per session.
 *  - Near layer (animated): twinkling stars in two depths, coloured by temperature, drifting slowly
 *    like the turning sky and shifting with scroll/pointer (parallax). Bright stars get a glow and
 *    diffraction spikes. Occasional shooting stars.
 *  - Star positions come from a fixed seed plus the clock, so the sky looks continuous between pages.
 *  - Pauses when the tab is hidden; a single still frame for prefers-reduced-motion.
 */
(function () {
  "use strict";

  var root = document.querySelector(".cosmos");
  if (!root) return;
  var far = root.querySelector(".sky-far");
  var near = root.querySelector(".sky-near");
  if (!far || !near || !far.getContext) return;

  var fctx = far.getContext("2d");
  var ctx = near.getContext("2d");
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  var finePointer = window.matchMedia("(pointer: fine)").matches;

  var SEED = 20261114;
  var TAU = Math.PI * 2;

  // star colours by temperature, with weights
  var COLORS = [
    [205, 220, 255, 0.30], // blue-white
    [240, 242, 255, 0.40], // white
    [255, 241, 214, 0.17], // yellow-white
    [255, 214, 176, 0.09], // orange
    [255, 178, 165, 0.04]  // red giant
  ];

  var W = 0, H = 0, dpr = 1;
  var stars = [];
  var sprites = {};
  var meteors = [];
  var nextMeteor = 0;
  var raf = null, lastTs = 0;
  var px = 0, py = 0, tx = 0, ty = 0; // pointer parallax: smoothed and target

  // ---------- helpers ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function pickColor(rnd) {
    var x = rnd(), acc = 0;
    for (var i = 0; i < COLORS.length; i++) {
      acc += COLORS[i][3];
      if (x <= acc) return i;
    }
    return 1;
  }
  function rgb(i) { var c = COLORS[i]; return c[0] + "," + c[1] + "," + c[2]; }
  function wrap(v, len) {
    var m = 30, span = len + 2 * m;
    return ((((v + m) % span) + span) % span) - m;
  }

  // ---------- glow sprites (halo, or halo + diffraction spikes) ----------
  function makeSprite(ci, spikes) {
    var S = 96, m = S / 2, c = rgb(ci);
    var cv = document.createElement("canvas");
    cv.width = cv.height = S;
    var g = cv.getContext("2d");
    var halo = g.createRadialGradient(m, m, 0, m, m, m);
    halo.addColorStop(0, "rgba(" + c + ",0.9)");
    halo.addColorStop(0.06, "rgba(" + c + ",0.55)");
    halo.addColorStop(0.22, "rgba(" + c + ",0.12)");
    halo.addColorStop(1, "rgba(" + c + ",0)");
    g.fillStyle = halo;
    g.fillRect(0, 0, S, S);
    if (spikes) {
      var h = g.createLinearGradient(0, 0, S, 0);
      h.addColorStop(0, "rgba(" + c + ",0)");
      h.addColorStop(0.5, "rgba(" + c + ",0.9)");
      h.addColorStop(1, "rgba(" + c + ",0)");
      g.fillStyle = h;
      g.fillRect(0, m - 1.4, S, 2.8);
      var v = g.createLinearGradient(0, 0, 0, S);
      v.addColorStop(0, "rgba(" + c + ",0)");
      v.addColorStop(0.5, "rgba(" + c + ",0.9)");
      v.addColorStop(1, "rgba(" + c + ",0)");
      g.fillStyle = v;
      g.fillRect(m - 1.4, 0, 2.8, S);
    }
    return cv;
  }
  for (var ci = 0; ci < COLORS.length; ci++) {
    sprites["halo" + ci] = makeSprite(ci, false);
    sprites["spike" + ci] = makeSprite(ci, true);
  }
  var meteorSprite = makeSprite(2, false);

  // ---------- star catalogue (deterministic) ----------
  function buildStars() {
    var rnd = mulberry32(SEED);
    var area = W * H;
    var nMid = Math.min(220, Math.round(area / 7500));
    var nNear = Math.min(70, Math.round(area / 22000));
    stars = [];
    for (var i = 0; i < nMid + nNear; i++) {
      var layer = i < nMid ? 0 : 1;
      var c = pickColor(rnd);
      var bright = layer === 1 && rnd() < 0.24;
      stars.push({
        x0: rnd(),
        y0: rnd(),
        layer: layer,
        r: layer ? 0.8 + rnd() * 0.9 : 0.45 + rnd() * 0.6,
        a: layer ? 0.6 + rnd() * 0.4 : 0.28 + rnd() * 0.45,
        rgb: rgb(c),
        ci: c,
        tw: 0.5 + rnd() * 2.2,               // twinkle speed (rad/s)
        ph: rnd() * TAU,
        drift: layer ? 3 + rnd() * 1.4 : 1.3 + rnd() * 0.6, // px/s, westward
        par: layer ? 0.09 : 0.035,           // scroll parallax
        glow: bright ? (rnd() < 0.35 ? "spike" : "halo") : null,
        gs: 22 + rnd() * 22                  // glow size (px)
      });
    }
  }

  // ---------- value noise (seeded) ----------
  function makeNoise(seed) {
    var rnd = mulberry32(seed), perm = [], p = new Uint16Array(512), val = new Float32Array(256), i, j, t;
    for (i = 0; i < 256; i++) { perm[i] = i; val[i] = rnd(); }
    for (i = 255; i > 0; i--) { j = Math.floor(rnd() * (i + 1)); t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
    for (i = 0; i < 512; i++) p[i] = perm[i & 255];
    return function (x, y) {
      var xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      var X = xi & 255, Y = yi & 255;
      var a = val[p[p[X] + Y]], b = val[p[p[X + 1] + Y]], c = val[p[p[X] + Y + 1]], d = val[p[p[X + 1] + Y + 1]];
      var u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
  }
  var noise = makeNoise(SEED);
  function fbm(x, y, oct) {
    var s = 0, amp = 0.5, n = 0, t;
    for (var i = 0; i < oct; i++) {
      s += amp * noise(x, y); n += amp; amp *= 0.5;
      t = x; x = (0.8 * t - 0.6 * y) * 2.03 + 17.1; y = (0.6 * t + 0.8 * y) * 2.03 + 3.7;
    }
    return s / n;
  }
  function ridged(x, y, oct) {
    var s = 0, amp = 0.5, n = 0, r, t;
    for (var i = 0; i < oct; i++) {
      r = 1 - Math.abs(2 * noise(x, y) - 1);
      s += amp * r * r; n += amp; amp *= 0.5;
      t = x; x = (0.8 * t - 0.6 * y) * 2.03 + 31.7; y = (0.6 * t + 0.8 * y) * 2.03 + 11.3;
    }
    return s / n;
  }
  function smooth(e0, e1, x) { var t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }
  function sq(x) { return x * x; }

  // ---------- far layer: the Milky Way ----------
  // Glow, dust lanes and colour are computed on a coarse grid in a background worker
  // (cached per session), then upscaled; thousands of real star dots are drawn on top.
  var MW_VERSION = 7;

  // Pure function (also runs inside the worker): returns RGBA pixels for a gw×gh grid.
  function computeField(W, H, gw, gh, seed) {
    var data = new Uint8ClampedArray(gw * gh * 4);
    var S = Math.sqrt(W * W + H * H);
    var theta = -Math.atan(H / W) * 0.82;        // band rises to the right
    var ct = Math.cos(theta), st = Math.sin(theta);
    var x0 = W * 0.5, y0 = H * 0.56;
    var uc = -0.3;                                // galactic core, towards the lower left
    var dither = mulberry32(seed ^ 0x2545F491);

    // band shape along its length (centre-line wobble and width), tabulated once
    var TN = 512, U0 = -0.8, U1 = 0.8, wigT = new Float32Array(TN), widT = new Float32Array(TN), coreT = new Float32Array(TN);
    for (var q = 0; q < TN; q++) {
      var uq = U0 + (U1 - U0) * q / (TN - 1);
      wigT[q] = (noise(uq * 3.1 + 11.3, 4.2) - 0.5) * 0.05;
      widT[q] = 0.052 * (0.75 + 0.55 * noise(uq * 4.3 + 2.1, 8.7)) + 0.05 * Math.exp(-sq((uq - uc) / 0.13));
      coreT[q] = Math.exp(-sq((uq - uc) / 0.075));
    }

    for (var j = 0; j < gh; j++) {
      var y = (j + 0.5) * H / gh;
      for (var i = 0; i < gw; i++) {
        var x = (i + 0.5) * W / gw;
        var dx = x - x0, dy = y - y0;
        var un = (dx * ct + dy * st) / S;         // along the band
        var vn = (-dx * st + dy * ct) / S;        // across the band
        var qi = Math.max(0, Math.min(TN - 1, Math.round((un - U0) / (U1 - U0) * (TN - 1))));
        var vv = vn - wigT[qi];
        var width = widT[qi];
        var d = vv / width;
        var d2 = d * d;
        if (d2 > 26) continue;                    // outside the faint halo
        var halo = Math.exp(-d2 / 5);

        var nx = x / S, ny = y / S;
        var prof = Math.exp(-d2);
        var clouds = fbm(nx * 7, ny * 7, 4);
        var c2 = smooth(0.28, 0.78, clouds);
        var body = prof * (0.1 + 0.95 * Math.pow(c2, 1.6));
        var core = 0.85 * coreT[qi] * Math.exp(-sq(d / 1.1));

        var dust = 0, pink = 0;
        if (d2 < 6) {
          // dust: a central rift plus warped, filamentary lanes
          var wx = fbm(nx * 6 + 5.2, ny * 6 + 1.3, 2), wy = fbm(nx * 6 + 1.7, ny * 6 + 9.2, 2);
          var rd = ridged(nx * 15 + wx * 2.2, ny * 15 + wy * 2.2, 3);
          var lane = smooth(0.7, 0.92, rd) * Math.exp(-sq((vv - 0.15 * width) / (width * 0.8)));
          var rift = Math.exp(-sq((vv + 0.06 * width) / (width * 0.2))) * smooth(0.35, 0.7, fbm(nx * 9 + 3.3, ny * 9 + 8.1, 3));
          dust = Math.min(0.85, lane * 0.6 + rift * 0.65);
          // pink emission nebulae inside the band
          pink = smooth(0.68, 0.82, fbm(nx * 17 + 40, ny * 17 + 7, 3)) * prof * prof * c2;
        }

        var clear = 1 - dust;
        var bI = body * clear, cI = core * (1 - dust * 0.7), hI = halo * 0.08 * (0.6 + 0.8 * clouds), pI = pink * clear * 0.6;
        var R = bI * 0.80 + cI * 1.00 + hI * 0.58 + pI * 1.00;
        var G = bI * 0.83 + cI * 0.80 + hI * 0.50 + pI * 0.40;
        var B = bI * 1.00 + cI * 0.58 + hI * 1.00 + pI * 0.55;
        var A = Math.max(R, G, B);
        if (A < 0.002) continue;
        var alpha = 1 - Math.exp(-A * 0.4);       // soft tone curve
        var k = (j * gw + i) * 4;
        data[k] = R / A * 255;
        data[k + 1] = G / A * 255;
        data[k + 2] = B / A * 255;
        data[k + 3] = alpha * 255 + (dither() - 0.5) * 2;
      }
    }
    return data;
  }

  // Run computeField in a worker so page load never stalls; fall back to the main thread.
  function computeAsync(gw, gh, done) {
    try {
      var src = [mulberry32, makeNoise, fbm, ridged, smooth, sq, computeField].map(String).join("\n") +
        "\nvar noise;\nonmessage = function (e) { var m = e.data; noise = makeNoise(m.seed);" +
        " var px = computeField(m.W, m.H, m.gw, m.gh, m.seed); postMessage(px, [px.buffer]); };";
      var url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      var worker = new Worker(url);
      worker.onmessage = function (e) { done(e.data); worker.terminate(); URL.revokeObjectURL(url); };
      worker.onerror = function () { worker.terminate(); URL.revokeObjectURL(url); done(computeField(W, H, gw, gh, SEED)); };
      worker.postMessage({ W: W, H: H, gw: gw, gh: gh, seed: SEED });
    } catch (e) {
      setTimeout(function () { done(computeField(W, H, gw, gh, SEED)); }, 30);
    }
  }

  var farJob = 0;
  function drawFar() {
    var job = ++farJob;
    var cell = Math.max(4, Math.sqrt((W * H) / 90000));
    var gw = Math.max(16, Math.round(W / cell)), gh = Math.max(16, Math.round(H / cell));
    var key = "mw" + MW_VERSION + ":" + W + "x" + H;
    var small = document.createElement("canvas");
    small.width = gw; small.height = gh;
    var sctx = small.getContext("2d");

    function finish(fresh) {
      if (job !== farJob) return;                 // a newer resize superseded this one
      var px = sctx.getImageData(0, 0, gw, gh).data;
      fctx.clearRect(0, 0, W, H);
      fctx.imageSmoothingEnabled = true;
      fctx.imageSmoothingQuality = "high";
      fctx.drawImage(small, 0, 0, W, H);
      sprinkleStars(function (x, y) {
        var i = Math.min(gw - 1, Math.floor(x / W * gw)), j = Math.min(gh - 1, Math.floor(y / H * gh));
        return px[(j * gw + i) * 4 + 3] / 255;
      });
      if (fresh) {
        far.style.transition = "opacity 1.2s ease";
        far.style.opacity = "1";
      }
    }

    var cached = null;
    try { cached = window.sessionStorage.getItem(key); } catch (e) {}
    if (cached) {
      var im = new Image();
      im.onload = function () { sctx.drawImage(im, 0, 0); finish(false); };
      im.src = cached;
      return;
    }
    far.style.opacity = "0";
    computeAsync(gw, gh, function (pixels) {
      if (job !== farJob) return;
      var img = sctx.createImageData(gw, gh);
      img.data.set(pixels);
      sctx.putImageData(img, 0, 0);
      try { window.sessionStorage.setItem(key, small.toDataURL("image/png")); } catch (e) {}
      finish(true);
    });
  }

  // thousands of faint stars, densest where the band is bright
  function sprinkleStars(alphaAt) {
    var rnd = mulberry32(SEED ^ 0x51ED27);
    var n = Math.min(110000, Math.round((W * H) / 20));
    var bright = 0;
    for (var i = 0; i < n; i++) {
      var x = rnd() * W, y = rnd() * H;
      var a = alphaAt(x, y);
      var r1 = rnd(), r2 = rnd(), r3 = rnd(), c = pickColor(rnd);
      if (r1 > 0.012 + Math.pow(a, 0.9) * 2.4) continue;
      var size = r2 < 0.82 ? 0.5 : (r2 < 0.97 ? 0.8 : 1.2);
      var alpha = Math.min(1, (0.13 + r3 * 0.45) * (0.6 + a * 1.1));
      fctx.fillStyle = "rgba(" + rgb(c) + "," + alpha.toFixed(3) + ")";
      fctx.fillRect(x - size / 2, y - size / 2, size, size);
      if (a > 0.18 && r3 > 0.994 && bright < 14) {
        bright++;
        var g = 8 + r2 * 12;
        fctx.globalAlpha = 0.45 + r3 * 0.3;
        fctx.drawImage(sprites["halo" + c], x - g / 2, y - g / 2, g, g);
        fctx.globalAlpha = 1;
      }
    }
  }

  // ---------- near layer ----------
  function spawnMeteor() {
    var fromLeft = Math.random() < 0.5;
    var slope = 0.3 + Math.random() * 0.4;          // radians below horizontal
    var speed = 650 + Math.random() * 500;          // px/s
    var dir = fromLeft ? 1 : -1;
    meteors.push({
      x: fromLeft ? Math.random() * W * 0.6 : W * 0.4 + Math.random() * W * 0.6,
      y: Math.random() * H * 0.45,
      ux: Math.cos(slope) * dir,
      uy: Math.sin(slope),
      speed: speed,
      len: 90 + Math.random() * 120,
      life: 0,
      dur: 0.7 + Math.random() * 0.6
    });
  }

  function drawNear(now, dt) {
    ctx.clearRect(0, 0, W, H);
    var still = reduceMotion.matches;
    var sy = window.scrollY || window.pageYOffset || 0;

    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var k = s.layer ? 1 : 0.4;
      var x = wrap(s.x0 * W - (still ? 0 : s.drift * now) + px * k * 14, W);
      var y = wrap(s.y0 * H - (still ? 0 : sy * s.par) + py * k * 10, H);
      var a = s.a * (still ? 1 : 0.68 + 0.32 * Math.sin(now * s.tw + s.ph));
      if (s.glow) {
        ctx.globalAlpha = a * 0.85;
        ctx.drawImage(sprites[s.glow + s.ci], x - s.gs / 2, y - s.gs / 2, s.gs, s.gs);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = "rgba(" + s.rgb + "," + a.toFixed(3) + ")";
      ctx.beginPath();
      ctx.arc(x, y, s.r, 0, TAU);
      ctx.fill();
    }

    // shooting stars
    for (var j = meteors.length - 1; j >= 0; j--) {
      var m = meteors[j];
      m.life += dt;
      m.x += m.ux * m.speed * dt;
      m.y += m.uy * m.speed * dt;
      var p = m.life / m.dur;
      if (p >= 1) { meteors.splice(j, 1); continue; }
      var alpha = Math.sin(Math.PI * p);
      var L = m.len * Math.min(1, p * 2.5);
      var tailX = m.x - m.ux * L, tailY = m.y - m.uy * L;
      var g = ctx.createLinearGradient(m.x, m.y, tailX, tailY);
      g.addColorStop(0, "rgba(255,248,240," + (0.9 * alpha).toFixed(3) + ")");
      g.addColorStop(1, "rgba(255,248,240,0)");
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(tailX, tailY);
      ctx.stroke();
      ctx.globalAlpha = alpha;
      ctx.drawImage(meteorSprite, m.x - 10, m.y - 10, 20, 20);
      ctx.globalAlpha = 1;
    }
  }

  // ---------- loop ----------
  function frame(ts) {
    var dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.1) : 1 / 60;
    lastTs = ts;
    var now = Date.now() / 1000;
    px += (tx - px) * 0.04;
    py += (ty - py) * 0.04;
    if (now > nextMeteor) {
      if (meteors.length < 2) spawnMeteor();
      nextMeteor = now + 4 + Math.random() * 8;
    }
    drawNear(now, dt);
    raf = window.requestAnimationFrame(frame);
  }

  function start() {
    if (raf || reduceMotion.matches || document.hidden) return;
    lastTs = 0;
    raf = window.requestAnimationFrame(frame);
  }
  function stop() {
    if (raf) window.cancelAnimationFrame(raf);
    raf = null;
  }

  function resize(force) {
    var rect = root.getBoundingClientRect();
    var nw = Math.max(1, Math.round(rect.width));
    var nh = Math.max(1, Math.round(rect.height));
    var nd = Math.min(window.devicePixelRatio || 1, 2);
    if (!force && nw === W && nh === H && nd === dpr) return;
    W = nw; H = nh; dpr = nd;
    [far, near].forEach(function (c) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    });
    fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    buildStars();
    drawFar();
    drawNear(Date.now() / 1000, 0);
  }

  // ---------- events ----------
  if (finePointer) {
    window.addEventListener("pointermove", function (e) {
      tx = e.clientX / Math.max(W, 1) - 0.5;
      ty = e.clientY / Math.max(H, 1) - 0.5;
    }, { passive: true });
  }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stop(); else start();
  });

  var onMotionChange = function () {
    if (reduceMotion.matches) { stop(); drawNear(Date.now() / 1000, 0); } else start();
  };
  if (reduceMotion.addEventListener) reduceMotion.addEventListener("change", onMotionChange);
  else if (reduceMotion.addListener) reduceMotion.addListener(onMotionChange);

  var resizeTimer;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { resize(false); }, 150);
  });

  resize(true);
  nextMeteor = Date.now() / 1000 + 2 + Math.random() * 3;
  root.classList.add("is-ready");
  start();
})();
