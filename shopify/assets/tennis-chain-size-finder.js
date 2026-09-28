/* Tennis chain size finder + shop. Initialises every .tcsf section on the page. */
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- Sizing rules -------------------------------------------------------
  var STANDARD = [16, 18, 20, 22, 24, 26, 28, 30];
  // Inches of length beyond neck size needed to reach each spot.
  var FIT = {
    choker:     { add: 2,  sentence: 'snug at the base of your neck' },
    collarbone: { add: 4,  sentence: 'right on your collarbone' },
    upper:      { add: 6,  sentence: 'on your upper chest, visible over a crew neck' },
    mid:        { add: 9,  sentence: 'at mid chest' },
    low:        { add: 12, sentence: 'low on your chest, ready for layering' }
  };
  var BUILD = { slim: -0.5, average: 0, athletic: 1, large: 2 };
  var SHOULDERS = { slim: 0.9, average: 1, athletic: 1.1, large: 1.22 };
  function widthAdj(mm) { return mm >= 5.5 ? 1 : mm >= 4.75 ? 0.5 : 0; }

  var METAL = { white: ['#fbfcfe', '#c9ced6', '#7f8793'], yellow: ['#fff1b8', '#e3b847', '#8f6512'], rose: ['#ffe0d4', '#dea08b', '#8e4d3f'] };
  var SKIN = { 1: ['#f6dcc6', '#e3b393', '#b98263'], 2: ['#e2ae87', '#c1865d', '#8d5a39'], 3: ['#b27a52', '#8f5a37', '#5e3720'], 4: ['#7a4e36', '#573522', '#301c11'] };
  var TEE = { white: ['#f4f4f1', '#d9d9d4'], black: ['#26262a', '#141416'] };

  // Lowest point of the chain on the model (SVG y) for a given "slack":
  // chain length minus what neck, build and width use up.
  var SLACK_TO_Y = [[-2, 146], [1, 152], [2, 160], [4, 190], [6, 226], [9, 284], [12, 346], [16, 420]];
  var ZONES = [['tight', 172], ['collarbone', 206], ['upper', 252], ['mid', 314], ['low', 9999]];
  var ZONE_LABEL = { tight: 'Tight', collarbone: 'Collarbone', upper: 'Upper chest', mid: 'Mid chest', low: 'Low chest' };
  var ZONE_Y = { tight: 158, collarbone: 190, upper: 226, mid: 284, low: 346 };
  var VIEW_Y = 80, VIEW_H = 380;

  function slackToY(s) {
    if (s <= SLACK_TO_Y[0][0]) return SLACK_TO_Y[0][1];
    for (var i = 1; i < SLACK_TO_Y.length; i++) {
      var a = SLACK_TO_Y[i - 1], b = SLACK_TO_Y[i];
      if (s <= b[0]) return a[1] + (b[1] - a[1]) * (s - a[0]) / (b[0] - a[0]);
    }
    return SLACK_TO_Y[SLACK_TO_Y.length - 1][1];
  }
  function zoneOf(y) { for (var i = 0; i < ZONES.length; i++) if (y < ZONES[i][1]) return ZONES[i][0]; return 'low'; }
  function num(v) { var m = v == null ? null : String(v).match(/(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : null; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function inch(n) { return (Math.round(n * 2) / 2).toString().replace(/\.5$/, '½') + '"'; }
  function mm(n) { return (Math.round(n * 10) / 10) + 'mm'; }

  // ---- Chain geometry & drawing -------------------------------------------
  // U-shaped curve from both sides of the neck down to `drop`.
  function chainPoints(drop, spread) {
    var y0 = 140, s = Math.max(0, (drop - y0) * 1.05 * (spread || 1)), cy = (drop - 0.25 * y0) / 0.75;
    var p0 = [178, y0], p1 = [178 - s, cy], p2 = [222 + s, cy], p3 = [222, y0], pts = [];
    for (var i = 0; i <= 260; i++) {
      var t = i / 260, u = 1 - t;
      pts.push([
        u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]
      ]);
    }
    return pts;
  }
  function ellipsePoints(cx, cy, rx, ry, rot) {
    var pts = [], c = Math.cos(rot), s = Math.sin(rot);
    for (var i = 0; i <= 300; i++) {
      var a = i / 300 * Math.PI * 2, x = rx * Math.cos(a), y = ry * Math.sin(a);
      pts.push([cx + x * c - y * s, cy + x * s + y * c]);
    }
    return pts;
  }
  // [x, y, angle] every `gap` along the curve.
  function along(pts, gap) {
    var out = [], acc = gap;
    for (var i = 1; i < pts.length; i++) {
      var dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
      acc += Math.hypot(dx, dy);
      if (acc >= gap) { out.push([pts[i][0], pts[i][1], Math.atan2(dy, dx) * 180 / Math.PI]); acc = 0; }
    }
    return out;
  }
  function f1(n) { return Math.round(n * 10) / 10; }

  // One tennis link: a box setting with four prongs holding a round brilliant.
  function linkSvg(d, metal, ice) {
    var h = d / 2, r = d * 0.4, t = r * 0.52, pr = Math.max(0.7, d * 0.09), pd = r * 0.93, f = [], star = [];
    for (var k = 0; k < 8; k++) {
      var a = k * Math.PI / 4, b = a + Math.PI / 8;
      f.push(f1(t * Math.cos(a)) + ' ' + f1(t * Math.sin(a)));
      star.push('M' + f1(t * Math.cos(a)) + ' ' + f1(t * Math.sin(a)) + 'L' + f1(r * .96 * Math.cos(b)) + ' ' + f1(r * .96 * Math.sin(b)));
    }
    var prongs = '';
    for (var q = 0; q < 4; q++) {
      var pa = Math.PI / 4 + q * Math.PI / 2;
      prongs += '<circle cx="' + f1(pd * Math.cos(pa)) + '" cy="' + f1(pd * Math.sin(pa)) + '" r="' + f1(pr) + '" fill="url(#' + metal + ')"/>';
    }
    return '<rect x="' + f1(-h) + '" y="' + f1(-h) + '" width="' + f1(d) + '" height="' + f1(d) + '" rx="' + f1(d * .14) + '" fill="url(#' + metal + ')"/>' +
      '<rect x="' + f1(-h + .5) + '" y="' + f1(-h + .5) + '" width="' + f1(d - 1) + '" height="' + f1(d - 1) + '" rx="' + f1(d * .12) + '" fill="none" stroke="#000" stroke-opacity=".28" stroke-width=".5"/>' +
      '<circle r="' + f1(r) + '" fill="url(#' + ice + ')"/>' +
      '<path d="' + star.join('') + '" stroke="#4b5875" stroke-opacity=".35" stroke-width=".45" fill="none"/>' +
      '<polygon points="' + f.join(' ') + '" fill="#fff" fill-opacity=".18" stroke="#fff" stroke-opacity=".8" stroke-width=".45"/>' +
      '<circle cx="' + f1(-r * .38) + '" cy="' + f1(-r * .38) + '" r="' + f1(r * .2) + '" fill="#fff"/>' + prongs;
  }
  function sparkle(x, y, r, delay) {
    var q = r * 0.18;
    return '<path class="tcsf-tw" fill="#fff" style="animation-delay:' + delay + 's" d="M' + f1(x) + ' ' + f1(y - r) + 'L' + f1(x + q) + ' ' + f1(y - q) + 'L' + f1(x + r) + ' ' + f1(y) + 'L' + f1(x + q) + ' ' + f1(y + q) +
      'L' + f1(x) + ' ' + f1(y + r) + 'L' + f1(x - q) + ' ' + f1(y + q) + 'L' + f1(x - r) + ' ' + f1(y) + 'L' + f1(x - q) + ' ' + f1(y - q) + 'Z"/>';
  }
  function chainSvg(pts, widthMm, metal, ice, opts) {
    opts = opts || {};
    var d = opts.scale ? widthMm * opts.scale : 3.4 + widthMm * 2;
    var links = along(pts, d * 1.02), link = linkSvg(d, metal, ice), html = '', tw = '', seed = opts.seed || 0;
    if (opts.shadow) {
      html += '<polyline points="' + pts.map(function (p) { return f1(p[0] + 1.5) + ',' + f1(p[1] + 4); }).join(' ') + '" fill="none" stroke="#000" stroke-opacity=".38" stroke-width="' + f1(d * .9) + '" stroke-linecap="round" filter="url(#' + opts.shadow + ')"/>';
    }
    links.forEach(function (p, i) {
      html += '<g transform="translate(' + f1(p[0]) + ' ' + f1(p[1]) + ') rotate(' + f1(p[2]) + ')">' + link + '</g>';
      if (!REDUCED && opts.twinkle !== false && (i * 7 + seed) % 9 === 0) tw += sparkle(p[0], p[1], d * .95, ((i * .37 + seed) % 2.6).toFixed(2));
    });
    return html + tw;
  }
  function gradients(id) {
    var s = '';
    Object.keys(METAL).forEach(function (k) {
      var m = METAL[k];
      s += '<linearGradient id="' + id + '-m-' + k + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + m[0] + '"/><stop offset=".5" stop-color="' + m[1] + '"/><stop offset="1" stop-color="' + m[2] + '"/></linearGradient>';
    });
    s += '<radialGradient id="' + id + '-ice" cx="36%" cy="32%" r="72%"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="#eef3fa"/><stop offset=".7" stop-color="#b7c3d6"/><stop offset="1" stop-color="#6c7a93"/></radialGradient>';
    return s;
  }

  // Cheap "product photo" used when a product has no image (and in previews).
  function productShot(id, p, metal) {
    var w = p.w || 3, pts = ellipsePoints(150, 150, 104, 78, -0.35);
    return '<svg viewBox="0 0 300 300" aria-hidden="true"><defs>' +
      '<radialGradient id="' + id + '-bg' + p.id + '" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="#2c2c31"/><stop offset="1" stop-color="#0d0d0f"/></radialGradient>' +
      '<filter id="' + id + '-sh' + p.id + '" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="4"/></filter></defs>' +
      '<rect width="300" height="300" fill="url(#' + id + '-bg' + p.id + ')"/>' +
      chainSvg(pts, w, id + '-m-' + metal, id + '-ice', { scale: 3.2, shadow: id + '-sh' + p.id, twinkle: false }) + '</svg>';
  }

  // ---- Body drawing ---------------------------------------------------------
  function outline(W, pad) {
    var L = 200 - W - pad, R = 200 + W + pad;
    return 'C176 158 ' + (L + 44) + ' 164 ' + (L + 14) + ' 176 C' + (L - 6) + ' 184 ' + (L - 14) + ' 212 ' + (L - 16) + ' 252 L' + (L - 8) + ' 470 L' + (R + 8) + ' 470 ' +
      'L' + (R + 16) + ' 252 C' + (R + 14) + ' 212 ' + (R + 6) + ' 184 ' + (R - 14) + ' 176 C' + (R - 44) + ' 164 224 158 ';
  }
  function bodySvg(id, build, outfit) {
    var W = 118 * SHOULDERS[build], L = 200 - W, R = 200 + W, muscle = build === 'athletic' || build === 'large';
    var torso = 'M176 100 L176 142 ' + outline(W, 0) + '224 142 L224 100 Z';
    var s = '<g>';
    s += '<path d="' + torso + '" fill="url(#' + id + '-skin)"/>';
    s += '<path d="' + torso + '" fill="url(#' + id + '-side)"/>';
    s += '<ellipse cx="200" cy="66" rx="44" ry="56" fill="url(#' + id + '-skin)"/>';
    s += '<ellipse cx="200" cy="66" rx="44" ry="56" fill="url(#' + id + '-side)"/>';
    s += '<g filter="url(#' + id + '-b6)">' +
      '<ellipse cx="200" cy="124" rx="36" ry="12" fill="#000" opacity=".28"/>' +          // under the jaw
      '<path d="M176 112 L176 146 Q186 150 184 120 Z M224 112 L224 146 Q214 150 216 120 Z" fill="#000" opacity=".22"/>' + // neck sides
      '<ellipse cx="200" cy="170" rx="9" ry="6" fill="#000" opacity=".22"/>' +            // sternal notch
      '<ellipse cx="' + (L + 30) + '" cy="190" rx="26" ry="16" fill="#fff" opacity=".08"/><ellipse cx="' + (R - 30) + '" cy="190" rx="26" ry="16" fill="#fff" opacity=".08"/>' +
      '<ellipse cx="200" cy="240" rx="' + (W * .55) + '" ry="46" fill="#fff" opacity=".07"/>' +
      '</g>';
    var line = 'fill="none" stroke-linecap="round" filter="url(#' + id + '-b2)"';
    s += '<path d="M188 176 Q' + (200 - W * .45) + ' 166 ' + (L + 26) + ' 180" ' + line + ' stroke="#000" stroke-opacity=".22" stroke-width="3"/>';
    s += '<path d="M212 176 Q' + (200 + W * .45) + ' 166 ' + (R - 26) + ' 180" ' + line + ' stroke="#000" stroke-opacity=".22" stroke-width="3"/>';
    s += '<path d="M188 172 Q' + (200 - W * .45) + ' 162 ' + (L + 26) + ' 176" ' + line + ' stroke="#fff" stroke-opacity=".14" stroke-width="2"/>';
    s += '<path d="M212 172 Q' + (200 + W * .45) + ' 162 ' + (R - 26) + ' 176" ' + line + ' stroke="#fff" stroke-opacity=".14" stroke-width="2"/>';
    var pec = muscle ? 300 : 290, pw = W * (muscle ? .74 : .62), so = muscle ? .26 : .14;
    s += '<path d="M' + (200 - pw) + ' ' + (pec - 34) + ' Q' + (200 - pw * .5) + ' ' + (pec + 10) + ' 196 ' + (pec - 8) + '" ' + line + ' stroke="#000" stroke-opacity="' + so + '" stroke-width="5"/>';
    s += '<path d="M' + (200 + pw) + ' ' + (pec - 34) + ' Q' + (200 + pw * .5) + ' ' + (pec + 10) + ' 204 ' + (pec - 8) + '" ' + line + ' stroke="#000" stroke-opacity="' + so + '" stroke-width="5"/>';
    s += '<path d="M200 186 L200 ' + (pec + 40) + '" ' + line + ' stroke="#000" stroke-opacity=".12" stroke-width="3"/>';
    if (outfit !== 'none') {
      var tee = TEE[outfit];
      var shirt = 'M168 150 ' + outline(W, 3).replace('C176 158', 'C174 160') + '232 150 Q200 186 168 150 Z';
      s += '<linearGradient id="' + id + '-tee" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + tee[0] + '"/><stop offset="1" stop-color="' + tee[1] + '"/></linearGradient>';
      s += '<path d="' + shirt + '" fill="url(#' + id + '-tee)"/><path d="' + shirt + '" fill="url(#' + id + '-side)" opacity=".8"/>';
      s += '<path d="M168 150 Q200 186 232 150" fill="none" stroke="#000" stroke-opacity=".22" stroke-width="7"/>';
      s += '<path d="M170 152 Q200 184 230 152" fill="none" stroke="' + tee[0] + '" stroke-opacity=".6" stroke-width="2"/>';
      s += '<g filter="url(#' + id + '-b2)" stroke="#000" stroke-opacity=".16" fill="none" stroke-width="3"><path d="M' + (L + 30) + ' 250 Q' + (L + 60) + ' 300 ' + (L + 50) + ' 380"/><path d="M' + (R - 30) + ' 260 Q' + (R - 56) + ' 320 ' + (R - 44) + ' 400"/><path d="M180 330 Q200 350 226 336"/></g>';
    }
    return s + '</g>';
  }

  function iconSvg(drop) {
    var s = Math.max(0, (drop - 140) * 1.05), cy = (drop - 35) / 0.75;
    return '<svg viewBox="70 30 260 380" aria-hidden="true"><ellipse cx="200" cy="66" rx="40" ry="50" fill="currentColor" opacity=".25"/>' +
      '<path d="M176 100 L176 142 C176 158 126 164 96 176 L80 420 L320 420 L304 176 C274 164 224 158 224 142 L224 100 Z" fill="currentColor" opacity=".25"/>' +
      '<path d="M178 140 C' + (178 - s) + ' ' + cy + ' ' + (222 + s) + ' ' + cy + ' 222 140" fill="none" style="stroke:var(--tcsf-accent)" stroke-width="13" stroke-linecap="round" stroke-dasharray="0.1 19"/></svg>';
  }
  function buildIcon(b) {
    var W = 118 * SHOULDERS[b];
    return '<svg viewBox="40 20 320 400" aria-hidden="true"><ellipse cx="200" cy="66" rx="40" ry="50" fill="currentColor" opacity=".3"/>' +
      '<path fill="currentColor" opacity=".3" d="M176 100 L176 142 ' + outline(W, 0) + '224 142 L224 100 Z"/></svg>';
  }

  // ---- Products -------------------------------------------------------------
  function metalOf(s) { s = String(s || '').toLowerCase(); return /rose/.test(s) ? 'rose' : /white/.test(s) ? 'white' : /yellow|gold/.test(s) ? 'yellow' : null; }
  function cleanTitle(t) { return String(t).replace(/\s+\(?\d{4,6}\)?\s*$/, '').replace(/\s{2,}/g, ' ').trim(); }
  function normalize(raw) {
    return raw.map(function (p, i) {
      var len = num(p.len) || num((String(p.t).match(/(\d+(?:\.\d+)?)\s*(?:inches|inch|in\b|")/i) || [])[0]);
      var w = num(p.w) || num((String(p.t).match(/(\d+(?:\.\d+)?)\s*mm/i) || [])[0]);
      var hay = [p.t, p.o, (p.tags || []).join(' ')].join(' ');
      var origin = /lab/i.test(p.t + ' ' + (p.o || '')) ? 'lab' : /natural/i.test(p.o || '') ? 'natural' : /lab/i.test(hay) ? 'lab' : null;
      var variants = (p.v || []).map(function (v) {
        return { id: v.id, t: v.t, a: v.a, p: v.p, c: v.c || 0, metal: metalOf(v.t), len: num((String(v.t).match(/(\d+(?:\.\d+)?)\s*(?:inches|inch|")/i) || [])[0]) };
      });
      return { id: p.id, i: i, title: cleanTitle(p.t), url: p.u, img: p.img, img2: p.img2, len: len, w: w, ct: p.ct, col: p.col, cl: p.cl, origin: origin, variants: variants,
        available: variants.some(function (v) { return v.a; }) };
    }).filter(function (p) { return p.variants.length && (!p.len || p.len >= 14); });
  }

  // ---- One section instance -----------------------------------------------
  function init(root) {
    if (root.dataset.ready) return;
    root.dataset.ready = '1';
    var ID = root.id;
    var app = root.querySelector('.tcsf__app');
    var form = root.querySelector('.tcsf__quiz');
    var res = root.querySelector('.tcsf__res');
    var model = root.querySelector('[data-model]');
    var stage = root.querySelector('.tcsf__stage');
    var fmtMoney;
    try {
      fmtMoney = new Intl.NumberFormat(root.dataset.locale || undefined, { style: 'currency', currency: root.dataset.currency || 'USD', maximumFractionDigits: 0 });
    } catch (e) { fmtMoney = { format: function (n) { return '$' + Math.round(n).toLocaleString(); } }; }
    function money(cents) { return fmtMoney.format(cents / 100); }

    model.innerHTML = '<defs>' + gradients(ID) +
      '<linearGradient id="' + ID + '-metal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" data-metal="0"/><stop offset=".5" data-metal="1"/><stop offset="1" data-metal="2"/></linearGradient>' +
      '<linearGradient id="' + ID + '-skin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" data-skin="0"/><stop offset=".55" data-skin="1"/><stop offset="1" data-skin="2"/></linearGradient>' +
      '<linearGradient id="' + ID + '-side" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".45"/><stop offset=".22" stop-color="#000" stop-opacity=".06"/><stop offset=".5" stop-color="#000" stop-opacity="0"/><stop offset=".78" stop-color="#000" stop-opacity=".06"/><stop offset="1" stop-color="#000" stop-opacity=".5"/></linearGradient>' +
      '<filter id="' + ID + '-b2" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2"/></filter>' +
      '<filter id="' + ID + '-b6" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>' +
      '<filter id="' + ID + '-cs" x="-10%" y="-10%" width="120%" height="130%"><feGaussianBlur stdDeviation="2.4"/></filter>' +
      '</defs><g data-body></g><g data-chains></g>';
    var bodyG = model.querySelector('[data-body]');
    var chainsG = model.querySelector('[data-chains]');

    var state = { step: 1, override: null, trying: null, drop: 60, layer: false, shown: 8 };

    function val(name) {
      var el = root.querySelector('[name="' + name + '"]:checked') || root.querySelector('[name="' + name + '"]');
      return el ? el.value : '';
    }
    function setRadio(name, v) { var el = root.querySelector('[name="' + name + '"][value="' + v + '"]'); if (el) el.checked = true; }

    function neckInches() {
      var mode = val('neckMode');
      if (mode === 'collar') return parseFloat(val('collar')) - 0.5;
      if (mode === 'unknown') return val('wearer') === 'women' ? 13.5 : 15.5;
      var n = parseFloat(root.querySelector('[name="neck"]').value);
      if (!isFinite(n) || n <= 0) n = 16;
      if (val('unit') === 'cm') n = n / 2.54;
      return Math.min(Math.max(n, 10), 26);
    }
    function pickedWidth() { return parseFloat(val('width')) || 3; }
    function shownWidth() { return state.trying ? state.trying.w : pickedWidth(); }
    function used(w) { return neckInches() + BUILD[val('build')] + widthAdj(w == null ? pickedWidth() : w); }
    function recommended() {
      var target = used() + FIT[val('fit')].add;
      // Round up: slightly long still sits fine, slightly short sits tighter than wanted.
      for (var i = 0; i < STANDARD.length; i++) if (STANDARD[i] >= target - 0.5) return { len: STANDARD[i], target: target };
      return { len: STANDARD[STANDARD.length - 1], target: target };
    }
    function mySize() { return state.override || recommended().len; }
    function currentLength() { return state.trying ? state.trying.len : mySize(); }
    function yFor(len, w) { return slackToY(len - used(w)); }

    // ---- Model ----
    function setColors() {
      var m = METAL[state.trying ? state.trying.metal : val('metal')] || METAL.yellow, k = SKIN[val('skin')] || SKIN[2];
      model.querySelectorAll('[data-metal]').forEach(function (s) { s.setAttribute('stop-color', m[+s.dataset.metal]); });
      model.querySelectorAll('[data-skin]').forEach(function (s) { s.setAttribute('stop-color', k[+s.dataset.skin]); });
    }
    function drawBody() { bodyG.innerHTML = bodySvg(ID, val('build'), val('outfit')); }
    function renderChains(drop) {
      var w = shownWidth(), html = '', metal = ID + '-metal', ice = ID + '-ice', sh = ID + '-cs';
      if (state.layer) {
        [4, 2].forEach(function (extra, k) {
          html += chainSvg(chainPoints(yFor(currentLength() + extra, w)), Math.max(2, w - 1 + k * .5), metal, ice, { seed: 3 + k, shadow: sh });
        });
      }
      html += chainSvg(chainPoints(drop), w, metal, ice, { shadow: sh });
      chainsG.innerHTML = html;
    }
    var anim = null;
    function animateTo(target, fromTop) {
      if (anim) cancelAnimationFrame(anim);
      if (REDUCED) { state.drop = target; renderChains(target); return; }
      var start = fromTop ? 128 : state.drop, t0 = null, dur = fromTop ? 950 : 420;
      function frame(ts) {
        if (!t0) t0 = ts;
        var k = Math.min(1, (ts - t0) / dur);
        var e = fromTop ? 1 + 2.4 * Math.pow(k - 1, 3) + 1.4 * Math.pow(k - 1, 2) : 1 - Math.pow(1 - k, 3); // easeOutBack / easeOutCubic
        state.drop = start + (target - start) * e;
        renderChains(state.drop);
        if (k < 1) anim = requestAnimationFrame(frame); else { state.drop = target; renderChains(target); }
      }
      anim = requestAnimationFrame(frame);
    }

    root.querySelectorAll('[data-icon]').forEach(function (i) { i.innerHTML = iconSvg(ZONE_Y[i.dataset.icon]); });
    root.querySelectorAll('[data-build]').forEach(function (i) { i.innerHTML = buildIcon(i.dataset.build); });

    // ---- Shop ----
    var shop = root.querySelector('[data-shop]');
    var grid = root.querySelector('[data-grid]');
    var products = [];
    if (shop) {
      try { products = normalize(JSON.parse(root.querySelector('[data-products]').textContent)); } catch (e) { products = []; }
      if (!products.length) shop.hidden = true;
    }
    var cardMetal = {}; // product id -> chosen metal

    function variantFor(p, metal, size) {
      var list = p.variants.slice().sort(function (a, b) {
        var sa = (a.a ? 0 : 100) + (a.metal === metal ? 0 : 10) + (a.len && size ? Math.abs(a.len - size) : 0);
        var sb = (b.a ? 0 : 100) + (b.metal === metal ? 0 : 10) + (b.len && size ? Math.abs(b.len - size) : 0);
        return sa - sb;
      });
      return list[0];
    }
    function fitFor(p, size) {
      var v = variantFor(p, cardMetal[p.id] || val('metal'), size);
      var len = v.len || p.len;
      return { v: v, len: len, diff: len ? len - size : null, zone: len ? zoneOf(yFor(len, p.w || pickedWidth())) : null };
    }
    function metalsOf(p) {
      var seen = {}, out = [];
      p.variants.forEach(function (v) { if (v.metal && !seen[v.metal]) { seen[v.metal] = 1; out.push(v.metal); } });
      return out;
    }

    function renderShop() {
      if (!shop || !products.length) return;
      var size = mySize(), w = pickedWidth();
      var origin = root.querySelector('[data-filter="origin"]').value;
      var wf = root.querySelector('[data-filter="width"]').value;
      var sort = root.querySelector('[data-filter="sort"]').value;
      var list = products.filter(function (p) {
        if (origin !== 'all' && p.origin !== origin) return false;
        if (wf === 'near') return !p.w || Math.abs(p.w - w) <= 1.05;
        if (wf !== 'all') { var r = wf.split('-'); return p.w && p.w > +r[0] && p.w <= +r[1]; }
        return true;
      }).map(function (p) {
        var f = fitFor(p, size);
        var score = (f.len ? Math.abs(f.diff) : 6) + (p.w ? Math.abs(p.w - w) * .8 : 1.5) + (p.available ? 0 : 50) + p.i * .002;
        return { p: p, f: f, score: score };
      });
      list.sort(function (a, b) {
        if (sort === 'price-asc') return a.f.v.p - b.f.v.p;
        if (sort === 'price-desc') return b.f.v.p - a.f.v.p;
        return a.score - b.score;
      });
      var exact = list.filter(function (x) { return x.f.len && Math.abs(x.f.diff) <= 0.5; }).length;
      var done = app.dataset.view === 'result';
      root.querySelector('[data-out="shopEyebrow"]').textContent = done ? 'Matched to your size' : 'Best sellers';
      root.querySelector('[data-out="shopSub"]').textContent = done
        ? (exact ? exact + (exact === 1 ? ' chain comes' : ' chains come') + ' in your exact ' + size + '" size. ' : 'Closest to your ' + size + '" size first. ') + 'Each card shows where that chain will sit on you.'
        : 'Ranked for a ' + size + '" fit. Take the quiz above to match chains to your neck.';

      grid.innerHTML = list.slice(0, state.shown).map(function (x) { return cardHtml(x.p, x.f); }).join('');
      root.querySelector('[data-empty]').hidden = list.length > 0;
      var more = root.querySelector('[data-more]');
      more.hidden = list.length <= state.shown;
      more.textContent = 'Show more chains (' + (list.length - state.shown) + ')';
    }

    function cardHtml(p, f) {
      var v = f.v, metal = v.metal || cardMetal[p.id] || val('metal') || 'yellow';
      var media = p.img
        ? '<img src="' + esc(p.img) + '" alt="' + esc(p.title) + '" loading="lazy" width="720" height="720">' + (p.img2 ? '<img src="' + esc(p.img2) + '" alt="" loading="lazy" width="720" height="720">' : '')
        : productShot(ID, p, metal);
      var fit = '', on = '';
      if (f.len) {
        var d = Math.round(f.diff * 2) / 2;
        fit = Math.abs(d) <= .5 ? '<span class="tcsf-card__fit is-exact">Your size</span>'
          : '<span class="tcsf-card__fit">' + inch(Math.abs(d)) + (d > 0 ? ' longer' : ' shorter') + '</span>';
        on = '<p class="tcsf-card__on' + (Math.abs(d) <= 2 ? ' is-good' : '') + '">On you: ' + ZONE_LABEL[f.zone].toLowerCase() + '</p>';
      } else {
        on = '<p class="tcsf-card__on">See length options</p>';
      }
      var sale = v.c > v.p ? '<span class="tcsf-card__sale">Save ' + money(v.c - v.p) + '</span>' : '';
      var meta = [f.len ? '<b>' + inch(f.len) + '</b>' : null, p.w ? '<b>' + mm(p.w) + '</b>' : null, p.ct ? esc(p.ct) : null,
        p.col || p.cl ? esc([p.col, p.cl].filter(Boolean).join(' ')) : null, p.origin === 'lab' ? 'Lab-grown' : p.origin === 'natural' ? 'Natural' : null].filter(Boolean).join(' · ');
      var metals = metalsOf(p).map(function (m) {
        var any = p.variants.some(function (x) { return x.metal === m && x.a; });
        var c = METAL[m];
        return '<button type="button" data-card-metal="' + m + '" aria-pressed="' + (m === v.metal) + '" aria-label="' + m + ' gold" title="' + m.charAt(0).toUpperCase() + m.slice(1) + ' gold"' + (any ? '' : ' disabled') + ' style="background:linear-gradient(135deg,' + c[0] + ',' + c[2] + ')"></button>';
      }).join('');
      return '<article class="tcsf-card" data-pid="' + p.id + '">' +
        '<a class="tcsf-card__media" href="' + esc(p.url) + '">' + media + fit + sale + '</a>' +
        '<div class="tcsf-card__body">' +
          '<p class="tcsf-card__meta">' + meta + '</p>' +
          '<h3><a href="' + esc(p.url) + '">' + esc(p.title) + '</a></h3>' + on +
          '<div class="tcsf-card__price">' + money(v.p) + (v.c > v.p ? ' <s>' + money(v.c) + '</s>' : '') + '</div>' +
          '<div class="tcsf-card__row"><div class="tcsf-card__metals">' + metals + '</div>' +
            (f.len ? '<button type="button" class="tcsf__link tcsf-card__try" data-try="' + p.id + '">Try it on</button>' : '') + '</div>' +
          '<button type="button" class="tcsf__btn tcsf-card__add" data-add="' + v.id + '"' + (v.a ? '' : ' disabled') + '>' + (v.a ? 'Add to cart' : 'Sold out') + '</button>' +
        '</div></article>';
    }

    function toast(html, ms) {
      var t = root.querySelector('[data-toast]');
      t.innerHTML = html; t.hidden = false;
      clearTimeout(t._h);
      t._h = setTimeout(function () { t.hidden = true; }, ms || 5000);
    }
    function addToCart(btn) {
      var id = +btn.dataset.add, url = (root.dataset.cartAdd || '/cart/add') + '.js';
      btn.disabled = true; btn.textContent = 'Adding…';
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ items: [{ id: id, quantity: 1 }] }) })
        .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.description || j.message || 'Could not add to cart'); return j; }); })
        .then(function () {
          btn.classList.add('is-done'); btn.textContent = 'Added ✓';
          var cart = root.dataset.cart || '/cart';
          toast('<span>Added to your cart.</span><a href="' + esc(cart) + '">View cart</a><a class="tcsf__btn" href="/checkout">Checkout</a>');
          document.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true }));
          fetch(cart + '.js', { headers: { Accept: 'application/json' } }).then(function (r) { return r.json(); }).then(function (c) {
            document.querySelectorAll('[data-cart-count], .cart-count-bubble span[aria-hidden="true"]').forEach(function (n) { n.textContent = c.item_count; });
          }).catch(function () {});
          setTimeout(function () { btn.classList.remove('is-done'); btn.disabled = false; btn.textContent = 'Add to cart'; }, 2600);
        })
        .catch(function (err) {
          btn.disabled = false; btn.textContent = 'Add to cart';
          toast('<span>' + esc(err.message || 'Could not add to cart. Please try again.') + '</span>');
        });
    }

    function tryOn(pid) {
      var p = products.filter(function (x) { return String(x.id) === String(pid); })[0];
      if (!p) return;
      var f = fitFor(p, mySize());
      state.trying = { id: p.id, len: f.len, w: p.w || pickedWidth(), metal: f.v.metal || val('metal'), title: p.title };
      root.querySelector('[data-out="tryName"]').textContent = p.title + ' · ' + inch(f.len);
      root.querySelector('[data-trying]').hidden = false;
      update();
      stage.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
    }
    function untry() { state.trying = null; root.querySelector('[data-trying]').hidden = true; update(); }

    // ---- State -> UI ----
    var lastBadge = '';
    function update(opts) {
      opts = opts || {};
      var mode = val('neckMode');
      root.querySelectorAll('.tcsf__neck').forEach(function (n) { n.hidden = n.dataset.mode !== mode; });
      root.querySelector('[data-out="unitLabel"]').textContent = val('unit') === 'cm' ? 'cm' : 'in';

      var done = app.dataset.view === 'result';
      var rec = recommended(), size = mySize(), len = currentLength(), w = shownWidth();
      // Early in the quiz show the fit being chosen; afterwards show the real length on this body.
      var y = done || state.trying || state.step > 2 ? yFor(len, w) : ZONE_Y[val('fit') === 'choker' ? 'tight' : val('fit')];
      var zone = zoneOf(y);

      drawBody();
      setColors();
      if (!opts.noAnim) animateTo(y, opts.fromTop); else renderChains(state.drop);

      root.querySelectorAll('.tcsf__zones li').forEach(function (li) {
        li.style.top = ((ZONE_Y[li.dataset.zone] - VIEW_Y) / VIEW_H * 100) + '%';
        li.classList.toggle('is-on', li.dataset.zone === zone);
      });
      var badge = root.querySelector('[data-badge]');
      root.querySelector('[data-out="badgeLen"]').textContent = done || state.trying || state.step > 1 ? inch(len) : '?';
      root.querySelector('[data-out="badgeZone"]').textContent = ZONE_LABEL[zone];
      if (len + zone !== lastBadge) { badge.classList.remove('is-pop'); void badge.offsetWidth; badge.classList.add('is-pop'); lastBadge = len + zone; }
      model.setAttribute('aria-label', 'A ' + len + ' inch chain sitting at the ' + ZONE_LABEL[zone].toLowerCase());

      var wl = pickedWidth() >= 7 ? '7mm+' : pickedWidth() + 'mm';
      root.querySelector('[data-out="length"]').textContent = size;
      root.querySelector('[data-out="cm"]').textContent = Math.round(size * 2.54);
      root.querySelector('[data-out="stones"]').textContent = Math.round(size * 25.4 / (pickedWidth() * 1.05));
      root.querySelector('[data-out="widthLabel"]').textContent = wl;
      var note = '';
      if (!state.override && rec.target > 30.5) note = ' Want it even longer? Contact us and we can help.';
      if (!state.override && rec.target < 15) note = ' Want it even tighter? Contact us and we can help.';
      var sz = zoneOf(yFor(size));
      root.querySelector('[data-out="summary"]').textContent = state.override
        ? 'A ' + size + '" ' + wl + ' chain would sit ' + (sz === 'tight' ? 'tight on your neck' : 'at your ' + ZONE_LABEL[sz].toLowerCase()) + '. Your recommended size is ' + rec.len + '".'
        : 'With a ' + inch(neckInches()).replace('"', '') + '" neck, a ' + size + '" ' + wl + ' tennis chain sits ' + FIT[val('fit')].sentence + '.' + note;
      root.querySelector('[data-length]').value = size;
      root.querySelector('[data-reset]').hidden = !state.override || state.override === rec.len;
      setRadio('width2', val('width'));

      root.querySelector('[data-progress]').style.width = (state.step / 4 * 100) + '%';
      root.querySelector('[data-stepcount]').textContent = 'Step ' + state.step + ' of 4';
      root.querySelector('[data-out="barLen"]').textContent = size + '"';
      root.querySelector('[data-out="barMeta"]').textContent = wl + ' · ' + ZONE_LABEL[sz];

      root.querySelectorAll('.tcsf__chart tr').forEach(function (tr) {
        var n = parseInt(tr.dataset.len, 10);
        tr.classList.toggle('is-match', n === size || (size >= 28 && n === 28));
      });
      if (!opts.keepShop) renderShop();
    }

    function goStep(n) {
      state.step = Math.max(1, Math.min(4, n));
      root.querySelectorAll('.tcsf__q').forEach(function (q) { q.hidden = +q.dataset.step !== state.step; });
      update();
    }
    function reveal() {
      state.override = null;
      app.dataset.view = 'result';
      form.hidden = true; res.hidden = false;
      state.shown = 8;
      update({ fromTop: true });
      if (window.innerWidth < 900) stage.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
    }
    function restart() {
      app.dataset.view = 'quiz';
      res.hidden = true; form.hidden = false;
      state.override = null;
      goStep(1);
    }

    // ---- Events ----
    var advanceTimer;
    form.addEventListener('change', function (e) {
      var n = e.target.name;
      if (n === 'unit') {
        var inp = root.querySelector('[name="neck"]'), v = parseFloat(inp.value) || 16, cm = e.target.value === 'cm';
        inp.value = cm ? Math.round(v * 2.54) : Math.round(v / 2.54 * 2) / 2;
        inp.step = cm ? 1 : 0.5; inp.min = cm ? 25 : 10; inp.max = cm ? 66 : 26;
      }
      update();
      if ((n === 'fit' || n === 'build') && !REDUCED) {
        clearTimeout(advanceTimer);
        advanceTimer = setTimeout(function () { goStep(state.step + 1); }, 650);
      }
    });
    form.addEventListener('input', function (e) { if (e.target.name === 'neck') update(); });
    form.addEventListener('submit', function (e) { e.preventDefault(); });

    stage.addEventListener('change', function (e) { if (e.target.name === 'outfit') update({ noAnim: true, keepShop: true }); });

    root.addEventListener('click', function (e) {
      var t = e.target.closest('[data-go],[data-nudge],[data-reset],[data-copy],[data-add],[data-try],[data-untry],[data-more],[data-card-metal]');
      if (!t) return;
      if (t.dataset.nudge) {
        var inp = root.querySelector('[name="neck"]'), step = parseFloat(inp.step) || 0.5;
        var v = (parseFloat(inp.value) || 16) + step * parseFloat(t.dataset.nudge);
        inp.value = Math.min(parseFloat(inp.max), Math.max(parseFloat(inp.min), v));
        update();
      }
      var go = t.dataset.go;
      if (go === 'next') { clearTimeout(advanceTimer); goStep(state.step + 1); }
      if (go === 'back') { clearTimeout(advanceTimer); goStep(state.step - 1); }
      if (go === 'reveal') reveal();
      if (go === 'restart') restart();
      if (go === 'shop' && shop) shop.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
      if (t.hasAttribute('data-reset')) { state.override = null; update(); }
      if (t.hasAttribute('data-add')) addToCart(t);
      if (t.hasAttribute('data-try')) tryOn(t.dataset.try);
      if (t.hasAttribute('data-untry')) untry();
      if (t.hasAttribute('data-more')) { state.shown += 8; renderShop(); }
      if (t.dataset.cardMetal) {
        var card = t.closest('[data-pid]');
        cardMetal[card.dataset.pid] = t.dataset.cardMetal;
        var p = products.filter(function (x) { return String(x.id) === card.dataset.pid; })[0];
        var tmp = document.createElement('div');
        tmp.innerHTML = cardHtml(p, fitFor(p, mySize()));
        card.replaceWith(tmp.firstChild);
      }
      if (t.hasAttribute('data-copy')) {
        var wd = pickedWidth() >= 7 ? '7mm+' : pickedWidth() + 'mm';
        var text = 'My tennis chain size: ' + mySize() + '" (' + Math.round(mySize() * 2.54) + ' cm), ' + wd + ' wide, ' + val('metal') + ' gold';
        var ok = function () { t.textContent = 'Copied ✓'; setTimeout(function () { t.textContent = 'Copy my size'; }, 1800); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, function () { toast('<span>' + esc(text) + '</span>', 8000); });
        else toast('<span>' + esc(text) + '</span>', 8000);
      }
    });

    res.addEventListener('input', function (e) {
      if (e.target.hasAttribute('data-length')) { state.override = parseInt(e.target.value, 10); if (state.trying) untry(); else update(); }
    });
    res.addEventListener('change', function (e) {
      var n = e.target.name;
      if (n === 'width2') { setRadio('width', e.target.value); state.trying = null; root.querySelector('[data-trying]').hidden = true; update(); }
      if (n === 'metal' || n === 'skin') { if (n === 'metal' && state.trying) state.trying.metal = e.target.value; setColors(); if (n === 'metal') renderShop(); }
      if (e.target.hasAttribute('data-layer')) { state.layer = e.target.checked; renderChains(state.drop); }
    });
    if (shop) shop.addEventListener('change', function (e) { if (e.target.dataset.filter) { state.shown = 8; renderShop(); } });

    // Mobile bar: after the reveal, offer a jump to the products while neither is on screen.
    var bar = root.querySelector('[data-bar]');
    if ('IntersectionObserver' in window && bar) {
      var vis = { app: true, shop: false };
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) { vis[en.target === app ? 'app' : 'shop'] = en.isIntersecting; });
        bar.hidden = !(app.dataset.view === 'result' && !vis.app && !vis.shop);
      }, { threshold: 0.05 });
      io.observe(app);
      if (shop) io.observe(shop);
    }

    drawBody();
    setColors();
    goStep(1);
  }

  function boot() { document.querySelectorAll('.tcsf').forEach(init); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  // Re-initialise when the section is added or reloaded in the theme editor.
  document.addEventListener('shopify:section:load', function (e) { var r = e.target.querySelector('.tcsf'); if (r) init(r); });
})();
