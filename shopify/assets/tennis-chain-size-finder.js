/* Tennis chain shop + size finder (marketplace layout). Initialises every .tcsf section on the page. */
(function () {
  'use strict';

  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var PAGE = 12;
  var STORE_KEY = 'tcsf-fit-v1';

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
  function widthAdj(w) { return w >= 5.5 ? 1 : w >= 4.75 ? 0.5 : 0; }

  var METAL = { white: ['#fbfcfe', '#c9ced6', '#7f8793'], yellow: ['#fff1b8', '#e3b847', '#8f6512'], rose: ['#ffe0d4', '#dea08b', '#8e4d3f'] };
  var METAL_NAME = { white: 'White gold', yellow: 'Yellow gold', rose: 'Rose gold' };
  var SKIN = { 1: ['#f6dcc6', '#e3b393', '#b98263'], 2: ['#e2ae87', '#c1865d', '#8d5a39'], 3: ['#b27a52', '#8f5a37', '#5e3720'], 4: ['#7a4e36', '#573522', '#301c11'] };
  var TEE = { white: ['#f7f7f4', '#d9d9d4'], black: ['#2a2a2e', '#141416'] };

  // Lowest point of the chain on the model (SVG y) for a given "slack":
  // chain length minus what the neck, build and width use up.
  var SLACK_TO_Y = [[-2, 146], [1, 152], [2, 160], [4, 190], [6, 226], [9, 284], [12, 346], [16, 420]];
  var ZONES = [['tight', 172], ['collarbone', 206], ['upper', 252], ['mid', 314], ['low', 9999]];
  var ZONE_LABEL = { tight: 'Tight', collarbone: 'Collarbone', upper: 'Upper chest', mid: 'Mid chest', low: 'Low chest' };
  var ZONE_Y = { tight: 158, collarbone: 190, upper: 226, mid: 284, low: 346 };
  var VIEW_Y = 80, VIEW_H = 380;

  var WIDTH_BUCKETS = [
    { v: 'w1', label: 'Up to 2.5mm', test: function (w) { return w <= 2.6; } },
    { v: 'w2', label: '2.7–3.5mm', test: function (w) { return w > 2.6 && w <= 3.6; } },
    { v: 'w3', label: '3.7–4.5mm', test: function (w) { return w > 3.6 && w <= 4.6; } },
    { v: 'w4', label: '4.7–5.5mm', test: function (w) { return w > 4.6 && w <= 5.6; } },
    { v: 'w5', label: '6mm and up', test: function (w) { return w > 5.6; } }
  ];
  var CARAT_BUCKETS = [
    { v: 'c1', label: 'Under 5 ct', test: function (c) { return c < 5; } },
    { v: 'c2', label: '5–10 ct', test: function (c) { return c >= 5 && c < 10; } },
    { v: 'c3', label: '10–15 ct', test: function (c) { return c >= 10 && c < 15; } },
    { v: 'c4', label: '15 ct and up', test: function (c) { return c >= 15; } }
  ];

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
  function titleNum(t, re) { var m = String(t || '').match(re); return m ? parseFloat(m[1]) : null; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function inch(n) { var r = Math.round(n * 4) / 4, f = r % 1; return Math.floor(r) + (f === .25 ? '¼' : f === .5 ? '½' : f === .75 ? '¾' : '') + '"'; }
  function mm(n) { return (Math.round(n * 10) / 10) + 'mm'; }
  function f1(n) { return Math.round(n * 10) / 10; }
  function uniq(a) { var s = {}, o = []; a.forEach(function (x) { var k = String(x); if (!s[k]) { s[k] = 1; o.push(x); } }); return o; }

  // ---- Chain geometry & drawing -------------------------------------------
  // U-shaped curve from both sides of the neck down to `drop`.
  function chainPoints(drop) {
    var y0 = 140, s = Math.max(0, (drop - y0) * 1.05), cy = (drop - 0.25 * y0) / 0.75;
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
  // A loosely coiled chain for product shots: a tilted oval with a slight wobble.
  function coilPoints(cx, cy, rx, ry, rot) {
    var pts = [], c = Math.cos(rot), s = Math.sin(rot);
    for (var i = 0; i <= 320; i++) {
      var a = i / 320 * Math.PI * 2, k = 1 + 0.04 * Math.sin(a * 3), x = rx * k * Math.cos(a), y = ry * k * Math.sin(a);
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
      var sdy = opts.shadowDy || 4;
      html += '<polyline points="' + pts.map(function (p) { return f1(p[0] + sdy * .4) + ',' + f1(p[1] + sdy); }).join(' ') + '" fill="none" stroke="#000" stroke-opacity=".32" stroke-width="' + f1(d * .9) + '" stroke-linecap="round" filter="url(#' + opts.shadow + ')"/>';
    }
    links.forEach(function (p, i) {
      html += '<g transform="translate(' + f1(p[0]) + ' ' + f1(p[1]) + ') rotate(' + f1(p[2]) + ')">' + link + '</g>';
      if (!REDUCED && opts.twinkle !== false && (i * 7 + seed) % 9 === 0) tw += sparkle(p[0], p[1], d * .95, ((i * .37 + seed) % 2.6).toFixed(2));
    });
    return html + tw;
  }
  function metalGradients(id) {
    var s = '';
    Object.keys(METAL).forEach(function (k) {
      var m = METAL[k];
      s += '<linearGradient id="' + id + '-m-' + k + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + m[0] + '"/><stop offset=".5" stop-color="' + m[1] + '"/><stop offset="1" stop-color="' + m[2] + '"/></linearGradient>';
    });
    s += '<radialGradient id="' + id + '-ice" cx="36%" cy="32%" r="72%"><stop offset="0" stop-color="#fff"/><stop offset=".35" stop-color="#eef3fa"/><stop offset=".7" stop-color="#b7c3d6"/><stop offset="1" stop-color="#6c7a93"/></radialGradient>';
    s += '<filter id="' + id + '-soft" x="-10%" y="-10%" width="120%" height="130%"><feGaussianBlur stdDeviation="4"/></filter>';
    return s;
  }
  // Studio-style drawing of the chain, used when a product has no photo (and in previews).
  function productShot(gid, p, metal) {
    var w = p.w || 3, tilt = -0.35 + (p.i % 5) * 0.08;
    return '<svg viewBox="0 0 300 300" aria-hidden="true" focusable="false">' +
      '<ellipse cx="154" cy="162" rx="112" ry="80" fill="#000" opacity=".06" transform="rotate(' + f1(tilt * 57.3) + ' 154 162)"/>' +
      chainSvg(coilPoints(150, 150, 104, 76, tilt), w, gid + '-m-' + metal, gid + '-ice', { scale: 3.3, shadow: gid + '-soft', twinkle: false }) + '</svg>';
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
    var s = '<path d="' + torso + '" fill="url(#' + id + '-skin)"/><path d="' + torso + '" fill="url(#' + id + '-side)"/>' +
      '<ellipse cx="200" cy="66" rx="44" ry="56" fill="url(#' + id + '-skin)"/><ellipse cx="200" cy="66" rx="44" ry="56" fill="url(#' + id + '-side)"/>' +
      '<g filter="url(#' + id + '-b6)">' +
        '<ellipse cx="200" cy="124" rx="36" ry="12" fill="#000" opacity=".28"/>' +
        '<path d="M176 112 L176 146 Q186 150 184 120 Z M224 112 L224 146 Q214 150 216 120 Z" fill="#000" opacity=".22"/>' +
        '<ellipse cx="200" cy="170" rx="9" ry="6" fill="#000" opacity=".22"/>' +
        '<ellipse cx="' + (L + 30) + '" cy="190" rx="26" ry="16" fill="#fff" opacity=".1"/><ellipse cx="' + (R - 30) + '" cy="190" rx="26" ry="16" fill="#fff" opacity=".1"/>' +
        '<ellipse cx="200" cy="240" rx="' + f1(W * .55) + '" ry="46" fill="#fff" opacity=".08"/>' +
      '</g>';
    var line = 'fill="none" stroke-linecap="round" filter="url(#' + id + '-b2)"';
    s += '<path d="M188 176 Q' + f1(200 - W * .45) + ' 166 ' + f1(L + 26) + ' 180" ' + line + ' stroke="#000" stroke-opacity=".22" stroke-width="3"/>' +
      '<path d="M212 176 Q' + f1(200 + W * .45) + ' 166 ' + f1(R - 26) + ' 180" ' + line + ' stroke="#000" stroke-opacity=".22" stroke-width="3"/>' +
      '<path d="M188 172 Q' + f1(200 - W * .45) + ' 162 ' + f1(L + 26) + ' 176" ' + line + ' stroke="#fff" stroke-opacity=".16" stroke-width="2"/>' +
      '<path d="M212 172 Q' + f1(200 + W * .45) + ' 162 ' + f1(R - 26) + ' 176" ' + line + ' stroke="#fff" stroke-opacity=".16" stroke-width="2"/>';
    var pec = muscle ? 300 : 290, pw = W * (muscle ? .74 : .62), so = muscle ? .26 : .14;
    s += '<path d="M' + f1(200 - pw) + ' ' + (pec - 34) + ' Q' + f1(200 - pw * .5) + ' ' + (pec + 10) + ' 196 ' + (pec - 8) + '" ' + line + ' stroke="#000" stroke-opacity="' + so + '" stroke-width="5"/>' +
      '<path d="M' + f1(200 + pw) + ' ' + (pec - 34) + ' Q' + f1(200 + pw * .5) + ' ' + (pec + 10) + ' 204 ' + (pec - 8) + '" ' + line + ' stroke="#000" stroke-opacity="' + so + '" stroke-width="5"/>' +
      '<path d="M200 186 L200 ' + (pec + 40) + '" ' + line + ' stroke="#000" stroke-opacity=".12" stroke-width="3"/>';
    if (outfit && outfit !== 'none' && TEE[outfit]) {
      var tee = TEE[outfit];
      var shirt = 'M168 150 ' + outline(W, 3).replace('C176 158', 'C174 160') + '232 150 Q200 186 168 150 Z';
      s += '<linearGradient id="' + id + '-tee" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + tee[0] + '"/><stop offset="1" stop-color="' + tee[1] + '"/></linearGradient>' +
        '<path d="' + shirt + '" fill="url(#' + id + '-tee)"/><path d="' + shirt + '" fill="url(#' + id + '-side)" opacity=".8"/>' +
        '<path d="M168 150 Q200 186 232 150" fill="none" stroke="#000" stroke-opacity=".22" stroke-width="7"/>' +
        '<path d="M170 152 Q200 184 230 152" fill="none" stroke="' + tee[0] + '" stroke-opacity=".6" stroke-width="2"/>' +
        '<g filter="url(#' + id + '-b2)" stroke="#000" stroke-opacity=".16" fill="none" stroke-width="3"><path d="M' + f1(L + 30) + ' 250 Q' + f1(L + 60) + ' 300 ' + f1(L + 50) + ' 380"/><path d="M' + f1(R - 30) + ' 260 Q' + f1(R - 56) + ' 320 ' + f1(R - 44) + ' 400"/><path d="M180 330 Q200 350 226 336"/></g>';
    }
    return s;
  }

  // Photo models: a real photo with the chain drawn over it. Coordinates are pixels of the 1024x1024 photo.
  // neck: where the chain leaves the neck on each side (x, y); px: photo pixels per inch of chain drop;
  // base: chain drop (same units as the drawn model, SVG y) that lands at the base of the neck.
  var PHOTOS = {
    // neck: the outline of the neck on each side at the height a snug chain sits (x, y); notch: the sternal notch;
    // px: photo pixels per inch; base: drawn-model drop (SVG y) that equals a snug fit; bottom: last usable photo row.
    woman: { neck: [[352, 560], [808, 548]], notch: [530, 850], px: 62, base: 152, bottom: 1000, maxDrop: 250 },
    man:   { neck: [[318, 520], [905, 520]], notch: [612, 640], px: 60, base: 152, bottom: 1000, maxDrop: 300 }
  };
  // Converts a drawn-model drop (SVG y, 146..420) into photo pixels of hang below a snug fit.
  function photoHang(ph, drop) { return Math.max(0, (drop - ph.base) / (346 - 158) * 8 * ph.px * 0.92); }
  // The photo only shows the chest down to a point; beyond that the chain is drawn at the photo's limit and the caption says how much further it hangs.
  function photoDrop(ph, drop) { return Math.min(ph.maxDrop || 1e9, photoHang(ph, drop)); }
  function photoOverflowInches(ph, drop) { return Math.max(0, (photoHang(ph, drop) - (ph.maxDrop || 1e9)) / ph.px); }
  // The visible front of the chain on the photo: from just behind each side of the neck, around the front, down to the lowest point.
  function photoChainPoints(ph, drop) {
    var L = ph.neck[0], R = ph.neck[1], dy = photoDrop(ph, drop), cx = (L[0] + R[0]) / 2;
    var snugY = (L[1] + R[1]) / 2 + (ph.notch[1] - (L[1] + R[1]) / 2) * 0.42; // where a snug chain crosses the front of the neck
    var low = snugY + dy, hang = dy / ph.px; // inches of hang
    // A hanging chain narrows into a V as it gets longer; a snug one hugs the neck as a shallow U.
    var narrow = Math.min(1, hang / 7), sideX = (R[0] - L[0]) / 2;
    // Start a little inside the neck outline and higher up, so the first links look like they come from behind the neck.
    var p0 = [L[0] + 26, L[1] - 70], p3 = [R[0] - 26, R[1] - 70];
    var c1 = [L[0] - 10 + sideX * 0.3 * narrow, snugY + dy * (1.15 + 0.2 * narrow)], c2 = [R[0] + 10 - sideX * 0.3 * narrow, snugY + dy * (1.15 + 0.2 * narrow)];
    if (dy < 8) { c1 = [L[0] + 10, snugY + 48]; c2 = [R[0] - 10, snugY + 48]; }
    var pts = [];
    for (var i = 0; i <= 360; i++) {
      var t = i / 360, u = 1 - t;
      pts.push([
        u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p3[1]
      ]);
    }
    return pts;
  }
  // Extends the photo below its last row so long chains have somewhere to hang: a soft blur of the bottom edge.
  function photoExtension(id, src, ph) {
    // Below the photo: a stretched, blurred copy of its last rows, fading out, so a long chain has somewhere to hang.
    return '<clipPath id="' + id + '-clipb"><rect x="0" y="' + ph.bottom + '" width="1024" height="600"/></clipPath>' +
      '<g clip-path="url(#' + id + '-clipb)"><image href="' + src + '" x="0" y="' + (ph.bottom - 1024 * 22) + '" width="1024" height="' + (1024 * 22.6) + '" preserveAspectRatio="none" filter="url(#' + id + '-bl)"/></g>' +
      '<rect x="0" y="' + ph.bottom + '" width="1024" height="600" fill="url(#' + id + '-fade)"/>';
  }
  function createPhotoModel(svg, id, ph, src) {
    svg.setAttribute('viewBox', '0 0 1024 1024');
    svg.setAttribute('preserveAspectRatio', 'xMidYMin slice');
    svg.innerHTML = '<defs>' + metalGradients(id) +
      '<linearGradient id="' + id + '-metal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" data-metal="0"/><stop offset=".5" data-metal="1"/><stop offset="1" data-metal="2"/></linearGradient>' +
      '<filter id="' + id + '-cs" x="-10%" y="-10%" width="120%" height="130%"><feGaussianBlur stdDeviation="5"/></filter>' +
      '<filter id="' + id + '-bl" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="14"/></filter>' +
      '<linearGradient id="' + id + '-fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e9e9ea" stop-opacity="0"/><stop offset="1" stop-color="#e9e9ea" stop-opacity=".9"/></linearGradient>' +
      '<clipPath id="' + id + '-front"><path d="M0 ' + (ph.neck[0][1] + 14) + ' L' + (ph.neck[0][0] + 40) + ' ' + (ph.neck[0][1] + 14) + ' Q' + ((ph.neck[0][0] + ph.neck[1][0]) / 2) + ' ' + (ph.neck[0][1] + 110) + ' ' + (ph.neck[1][0] - 40) + ' ' + (ph.neck[1][1] + 14) + ' L1024 ' + (ph.neck[1][1] + 14) + ' L1024 1700 L0 1700 Z"/></clipPath>' +
      '</defs><image href="' + src + '" x="0" y="0" width="1024" height="1024" preserveAspectRatio="xMidYMid slice"/>' + photoExtension(id, src, ph) + '<g clip-path="url(#' + id + '-front)"><g data-layers></g><g data-chains></g></g>';
    var layersG = svg.querySelector('[data-layers]'), chainsG = svg.querySelector('[data-chains]');
    var drop = null, anim = null;
    // Link size on the photo: real size (px per inch / 25.4 per mm) scaled up so the stones read on screen, as product photos do.
    function linkD(w) { return Math.max(11, w * ph.px / 25.4 * 1.7); }
    function colors(p) {
      var m = METAL[p.metal] || METAL.yellow;
      svg.querySelectorAll('[data-metal]').forEach(function (s) { s.setAttribute('stop-color', m[+s.dataset.metal]); });
    }
    function chains(p, d) {
      chainsG.innerHTML = chainSvg(photoChainPoints(ph, d), p.w, id + '-metal', id + '-ice', { shadow: id + '-cs', twinkle: p.twinkle, scale: linkD(p.w) / p.w, shadowDy: 8 });
      // Slide the photo up a little so the lowest point of a long chain stays in view.
      var lowest = photoChainPoints(ph, d)[180][1];
      svg.style.setProperty('--tcsf-pan', (Math.round(Math.min(Math.max(0, lowest - 880), 200) / 1024 * 100 * 100) / 100) + '%');
      var over = photoOverflowInches(ph, d), cap = svg.parentNode && svg.parentNode.querySelector('[data-overflow]');
      if (cap) { cap.hidden = over < 0.4; cap.textContent = 'Hangs about ' + inch(Math.round(over * 2) / 2) + ' lower than the photo shows'; }
    }
    function set(p, o) {
      o = o || {};
      layersG.innerHTML = (p.layers || []).map(function (l, k) { return chainSvg(photoChainPoints(ph, l.drop), l.w, id + '-metal', id + '-ice', { seed: 3 + k, shadow: id + '-cs', twinkle: p.twinkle, scale: linkD(l.w) / l.w, shadowDy: 8 }); }).join('');
      colors(p);
      if (anim) cancelAnimationFrame(anim);
      if (REDUCED || o.instant || (drop == null && !o.fromTop)) { drop = p.drop; chains(p, drop); return; }
      var start = o.fromTop || drop == null ? 128 : drop, target = p.drop, t0 = null, dur = o.fromTop ? 950 : 420;
      function frame(ts) {
        if (t0 == null) t0 = ts;
        var k = Math.min(1, (ts - t0) / dur);
        var e = o.fromTop ? 1 + 2.4 * Math.pow(k - 1, 3) + 1.4 * Math.pow(k - 1, 2) : 1 - Math.pow(1 - k, 3);
        drop = start + (target - start) * e;
        chains(p, drop);
        if (k < 1) anim = requestAnimationFrame(frame); else { drop = target; chains(p, target); anim = null; }
      }
      anim = requestAnimationFrame(frame);
    }
    return { set: set, photo: true };
  }
  // Picks the photo model for the chosen wearer when the section has a photo for it; else the drawn model.
  function makeModel(svg, id, root, who) {
    var src = root.dataset['photo' + (who === 'women' ? 'Women' : 'Men')];
    if (src) return createPhotoModel(svg, id, PHOTOS[who === 'women' ? 'woman' : 'man'], src);
    svg.setAttribute('viewBox', '0 80 400 380');
    return createModel(svg, id);
  }

  // A model (body + chains) drawn into an <svg>. set() redraws, animating the drop.
  function createModel(svg, id) {
    svg.innerHTML = '<defs>' + metalGradients(id) +
      '<linearGradient id="' + id + '-metal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" data-metal="0"/><stop offset=".5" data-metal="1"/><stop offset="1" data-metal="2"/></linearGradient>' +
      '<linearGradient id="' + id + '-skin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" data-skin="0"/><stop offset=".55" data-skin="1"/><stop offset="1" data-skin="2"/></linearGradient>' +
      '<linearGradient id="' + id + '-side" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".42"/><stop offset=".22" stop-color="#000" stop-opacity=".05"/><stop offset=".5" stop-color="#000" stop-opacity="0"/><stop offset=".78" stop-color="#000" stop-opacity=".05"/><stop offset="1" stop-color="#000" stop-opacity=".48"/></linearGradient>' +
      '<filter id="' + id + '-b2" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2"/></filter>' +
      '<filter id="' + id + '-b6" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>' +
      '<filter id="' + id + '-cs" x="-10%" y="-10%" width="120%" height="130%"><feGaussianBlur stdDeviation="2.4"/></filter>' +
      '</defs><g data-body></g><g data-layers></g><g data-chains></g>';
    var bodyG = svg.querySelector('[data-body]'), layersG = svg.querySelector('[data-layers]'), chainsG = svg.querySelector('[data-chains]');
    var bodyKey = '', drop = null, anim = null;
    function colors(p) {
      var m = METAL[p.metal] || METAL.yellow, k = SKIN[p.skin] || SKIN[2];
      svg.querySelectorAll('[data-metal]').forEach(function (s) { s.setAttribute('stop-color', m[+s.dataset.metal]); });
      svg.querySelectorAll('[data-skin]').forEach(function (s) { s.setAttribute('stop-color', k[+s.dataset.skin]); });
    }
    function chains(p, d) {
      // Only the main chain moves during a drop; the layered chains are drawn once per set().
      chainsG.innerHTML = chainSvg(chainPoints(d), p.w, id + '-metal', id + '-ice', { shadow: id + '-cs', twinkle: p.twinkle });
    }
    function set(p, o) {
      o = o || {};
      layersG.innerHTML = (p.layers || []).map(function (l, k) { return chainSvg(chainPoints(l.drop), l.w, id + '-metal', id + '-ice', { seed: 3 + k, shadow: id + '-cs', twinkle: p.twinkle }); }).join('');
      var key = p.build + '|' + p.outfit;
      if (key !== bodyKey) { bodyG.innerHTML = bodySvg(id, p.build, p.outfit); bodyKey = key; }
      colors(p);
      if (anim) cancelAnimationFrame(anim);
      if (REDUCED || o.instant || (drop == null && !o.fromTop)) { drop = p.drop; chains(p, drop); return; }
      var start = o.fromTop || drop == null ? 128 : drop, target = p.drop, t0 = null, dur = o.fromTop ? 950 : 420;
      function frame(ts) {
        if (t0 == null) t0 = ts;
        var k = Math.min(1, (ts - t0) / dur);
        var e = o.fromTop ? 1 + 2.4 * Math.pow(k - 1, 3) + 1.4 * Math.pow(k - 1, 2) : 1 - Math.pow(1 - k, 3); // easeOutBack / easeOutCubic
        drop = start + (target - start) * e;
        chains(p, drop);
        if (k < 1) anim = requestAnimationFrame(frame); else { drop = target; chains(p, target); anim = null; }
      }
      anim = requestAnimationFrame(frame);
    }
    return { set: set };
  }

  function iconSvg(drop) {
    var s = Math.max(0, (drop - 140) * 1.05), cy = (drop - 35) / 0.75;
    return '<svg viewBox="70 30 260 380" aria-hidden="true" focusable="false"><ellipse cx="200" cy="66" rx="40" ry="50" fill="currentColor" opacity=".18"/>' +
      '<path d="M176 100 L176 142 C176 158 126 164 96 176 L80 420 L320 420 L304 176 C274 164 224 158 224 142 L224 100 Z" fill="currentColor" opacity=".18"/>' +
      '<path d="M178 140 C' + f1(178 - s) + ' ' + f1(cy) + ' ' + f1(222 + s) + ' ' + f1(cy) + ' 222 140" fill="none" stroke="#c9a04a" stroke-width="13" stroke-linecap="round" stroke-dasharray="0.1 19"/></svg>';
  }
  function buildIcon(b) {
    return '<svg viewBox="40 20 320 400" aria-hidden="true" focusable="false"><ellipse cx="200" cy="66" rx="40" ry="50" fill="currentColor" opacity=".22"/>' +
      '<path fill="currentColor" opacity=".22" d="M176 100 L176 142 ' + outline(118 * SHOULDERS[b], 0) + '224 142 L224 100 Z"/></svg>';
  }

  // ---- Products -------------------------------------------------------------
  function metalOf(s) { s = String(s || '').toLowerCase(); return /rose/.test(s) ? 'rose' : /white/.test(s) ? 'white' : /yellow|gold/.test(s) ? 'yellow' : null; }
  function cleanTitle(t) { return String(t).replace(/\s+\(?\d{4,6}\)?\s*$/, '').replace(/\s{2,}/g, ' ').trim(); }
  function normalize(raw) {
    return raw.map(function (p, i) {
      var variants = (p.v || []).map(function (v) {
        return { id: v.id, t: v.t, a: !!v.a, p: +v.p || 0, c: +v.c || 0, metal: metalOf(v.t), len: titleNum(v.t, /(\d+(?:\.\d+)?)\s*(?:inches|inch|")/i) };
      });
      var len = num(p.len) || titleNum(p.t, /(\d+(?:\.\d+)?)\s*(?:inches|inch|in\b|")/i);
      var lens = uniq(variants.map(function (v) { return v.len; }).filter(Boolean)).sort(function (a, b) { return a - b; });
      if (!lens.length && len) lens = [len];
      var w = num(p.w) || titleNum(p.t, /(\d+(?:\.\d+)?)\s*mm/i);
      var tags = (p.tags || []).map(function (t) { return String(t).toLowerCase(); });
      var origin = /lab/i.test(p.t + ' ' + (p.o || '')) ? 'lab' : /natural/i.test(p.o || '') ? 'natural' : null;
      var avail = variants.filter(function (v) { return v.a; });
      var priced = (avail.length ? avail : variants).map(function (v) { return v.p; });
      var quote = !!p.q || variants.every(function (v) { return !v.p; });
      return {
        id: p.id, i: i, title: cleanTitle(p.t), url: p.u,
        imgs: (p.imgs || [p.img, p.img2]).filter(Boolean),
        len: len || lens[0] || null, lens: lens, w: w,
        ct: p.ct, ctN: num(p.ct), col: p.col, cl: p.cl, origin: origin,
        grams: p.g, setting: p.set, metalName: p.m,
        variants: variants,
        metals: uniq(variants.map(function (v) { return v.metal; }).filter(Boolean)),
        price: priced.length ? Math.min.apply(null, priced) : 0,
        sale: !quote && variants.some(function (v) { return v.p > 0 && v.c > v.p; }),
        best: tags.indexOf('best sellers') > -1, isNew: tags.indexOf('new arrivals') > -1,
        // Priced on request ("Quote Only" tag or $0): shown with "Request a quote" instead of Add to cart.
        quote: quote,
        available: avail.length > 0
      };
    }).filter(function (p) { return p.variants.length && (!p.len || p.len >= 14); });
  }

  function storeGet() { try { return JSON.parse(window.localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { return null; } }
  function storeSet(v) { try { window.localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }

  // ---- One section instance -----------------------------------------------
  function init(root) {
    if (root.dataset.ready) return;
    root.dataset.ready = '1';
    var ID = root.id, GID = ID + '-g';
    var q = function (s) { return root.querySelector(s); };
    var qa = function (s) { return Array.prototype.slice.call(root.querySelectorAll(s)); };
    var cur = root.dataset.currency || 'USD', loc = root.dataset.locale || undefined, fmt0, fmt2;
    try {
      fmt0 = new Intl.NumberFormat(loc, { style: 'currency', currency: cur, minimumFractionDigits: 0, maximumFractionDigits: 0 });
      fmt2 = new Intl.NumberFormat(loc, { style: 'currency', currency: cur });
    } catch (e) { fmt0 = fmt2 = { format: function (n) { return cur + ' ' + n.toFixed(2); } }; }
    // Whole amounts without cents ($9,000), otherwise with cents ($9,000.50).
    function money(cents) { return (cents % 100 ? fmt2 : fmt0).format(cents / 100); }

    // Shared gradients for product drawings.
    var defs = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    defs.setAttribute('width', '0'); defs.setAttribute('height', '0'); defs.setAttribute('aria-hidden', 'true');
    defs.style.position = 'absolute';
    defs.innerHTML = '<defs>' + metalGradients(GID) + '</defs>';
    root.insertBefore(defs, root.firstChild);

    var fitModal = q('[data-fit-modal]'), qvModal = q('[data-qv]'), qvBody = q('[data-qv-body]');
    var app = q('.tcsf__app'), form = q('.tcsf__quiz'), res = q('.tcsf__res');
    var modelWho = '', fitModel = null, miniModel = null, miniSvg = q('[data-mini]');
    function wearer() { return val('who') || val('wearer') || 'men'; }
    function ensureModels() {
      var who = wearer();
      if (who === modelWho) return;
      modelWho = who;
      fitModel = makeModel(q('[data-model]'), ID + '-fit', root, who);
      miniModel = miniSvg ? makeModel(miniSvg, ID + '-mini', root, who) : null;
      var stage = q('.tcsf__stage');
      if (stage) stage.classList.toggle('is-photo', !!fitModel.photo);
      if (miniSvg) miniSvg.parentNode.classList.toggle('is-photo', !!(miniModel && miniModel.photo));
    }
    ensureModels();
    var grid = q('[data-grid]'), filters = q('[data-filters]'), facetsEl = q('[data-facets]');

    var st = { step: 1, override: null, layer: false, done: false, shown: PAGE, sort: 'featured', density: '3' };
    var F = { len: {}, width: {}, metal: {}, origin: {}, price: {}, carat: {}, stock: false, sale: false, near: false };
    var cardMetal = {};

    // ---- Answers & sizing ----
    var memo = null; // answers cached while rendering the grid, which reads them for every product
    function val(name) {
      if (memo && name in memo) return memo[name];
      var el = root.querySelector('[name="' + name + '"]:checked') || root.querySelector('[name="' + name + '"]');
      var v = el ? el.value : '';
      if (memo) memo[name] = v;
      return v;
    }
    function setRadio(name, v) { var el = root.querySelector('[name="' + name + '"][value="' + v + '"]'); if (el) el.checked = true; }
    function neckInches() {
      var mode = val('neckMode');
      if (mode === 'collar') return parseFloat(val('collar')) - 0.5;
      if (mode === 'unknown') return val('wearer') === 'women' ? 13.5 : 15.5;
      var n = parseFloat(q('[name="neck"]').value);
      if (!isFinite(n) || n <= 0) return 16;
      if (val('unit') === 'cm') n = n / 2.54;
      return Math.min(Math.max(n, 10), 26);
    }
    // Checks the typed neck size. Returns a message when it needs attention, or '' when it's fine.
    function neckProblem() {
      if (val('neckMode') !== 'measure') return '';
      var inp = q('[name="neck"]'), n = parseFloat(inp.value), cm = val('unit') === 'cm';
      if (!isFinite(n)) return 'Enter your neck size to continue.';
      if (!cm && n > +inp.max && n <= 66) return 'That looks like centimetres. <button type="button" class="tcsf-link" data-to-cm>Switch to cm</button>';
      if (n < +inp.min || n > +inp.max) return 'Neck sizes are usually between ' + inp.min + ' and ' + inp.max + (cm ? ' cm' : '"') + '. Please check your measurement.';
      return '';
    }
    function showNeckProblem(force) {
      var msg = neckProblem(), hint = q('[data-neck-hint]'), inp = q('[name="neck"]');
      var show = !!msg && (force || !/Enter your/.test(msg));
      hint.innerHTML = show ? msg : '';
      hint.hidden = !show;
      if (show) inp.setAttribute('aria-invalid', 'true'); else inp.removeAttribute('aria-invalid');
      return msg;
    }
    function pickedWidth() { return parseFloat(val('width')) || 3; }
    function widthLabel() { return pickedWidth() >= 7 ? '7mm+' : pickedWidth() + 'mm'; }
    function used(w) { return neckInches() + BUILD[val('build')] + widthAdj(w == null ? pickedWidth() : w); }
    function recommended() {
      var target = used() + FIT[val('fit')].add;
      // Round up: slightly long still sits fine, slightly short sits tighter than wanted.
      for (var i = 0; i < STANDARD.length; i++) if (STANDARD[i] >= target - 0.5) return { len: STANDARD[i], target: target };
      return { len: STANDARD[STANDARD.length - 1], target: target };
    }
    function mySize() {
      if (st.override) return st.override;
      if (memo && memo.$size) return memo.$size;
      var s = recommended().len;
      if (memo) memo.$size = s;
      return s;
    }
    function yFor(len, w) { return slackToY(len - used(w)); }
    function modelParams(len, w, metal, extra) {
      var p = { build: val('build'), outfit: val('outfit'), skin: val('skin'), metal: metal, w: w, drop: yFor(len, w), layers: [] };
      if (extra && extra.layer) p.layers = [4, 2].map(function (x, k) { return { drop: yFor(len + x, w), w: Math.max(2, w - 1 + k * .5) }; });
      if (extra && extra.twinkle === false) p.twinkle = false;
      return p;
    }

    // ---- Size finder UI ----
    qa('[data-icon]').forEach(function (i) { i.innerHTML = iconSvg(ZONE_Y[i.dataset.icon]); });
    qa('[data-build]').forEach(function (i) { i.innerHTML = buildIcon(i.dataset.build); });

    var lastBadge = '';
    function updateFinder(o) {
      var own = !memo;
      if (own) memo = {};
      try { updateFinder0(o); } finally { if (own) memo = null; }
    }
    function updateFinder0(o) {
      o = o || {};
      var mode = val('neckMode');
      qa('.tcsf__neck').forEach(function (n) { n.hidden = n.dataset.mode !== mode; });
      q('[data-out="unitLabel"]').textContent = val('unit') === 'cm' ? 'cm' : 'in';
      var inResult = app.dataset.view === 'result';
      var rec = recommended(), size = mySize(), w = pickedWidth();
      var p = modelParams(size, w, val('metal'), { layer: st.layer && inResult });
      // Early in the quiz show the fit being chosen; afterwards the real length on this body.
      if (!inResult && st.step <= 2) p.drop = ZONE_Y[val('fit') === 'choker' ? 'tight' : val('fit')];
      ensureModels();
      if (!o.skipModel) fitModel.set(p, { fromTop: o.fromTop, instant: o.instant });
      var zone = zoneOf(p.drop);
      qa('.tcsf__zones li').forEach(function (li) {
        li.style.top = ((ZONE_Y[li.dataset.zone] - VIEW_Y) / VIEW_H * 100) + '%';
        li.classList.toggle('is-on', li.dataset.zone === zone);
      });
      var badge = q('[data-badge]');
      q('[data-out="badgeLen"]').textContent = inResult || st.step > 1 ? inch(size) : '?';
      q('[data-out="badgeZone"]').textContent = ZONE_LABEL[zone];
      if (size + zone !== lastBadge) { badge.classList.remove('is-pop'); void badge.offsetWidth; badge.classList.add('is-pop'); lastBadge = size + zone; }
      q('[data-model]').setAttribute('aria-label', 'A ' + size + ' inch chain sitting at the ' + ZONE_LABEL[zone].toLowerCase());

      q('[data-out="length"]').textContent = size;
      q('[data-out="cm"]').textContent = Math.round(size * 2.54);
      q('[data-out="stones"]').textContent = Math.round(size * 25.4 / (w * 1.05));
      q('[data-out="widthLabel"]').textContent = widthLabel();
      var sz = zoneOf(yFor(size)), note = '';
      var where = sz === 'tight' ? 'tight on your neck' : 'at your ' + ZONE_LABEL[sz].toLowerCase();
      var clamped = !st.override && (rec.target > 30.5 || rec.target < 15);
      if (!st.override && rec.target > 30.5) note = ' Want it even longer? Contact us and we can help.';
      if (!st.override && rec.target < 15) note = ' Want it even tighter? Contact us and we can help.';
      var summary = st.override
        ? 'A ' + size + '" ' + widthLabel() + ' chain sits ' + where + '. Our pick for you was ' + rec.len + '".'
        : 'With a ' + inch(neckInches()) + ' neck, a ' + size + '" ' + widthLabel() + ' tennis chain sits ' + (clamped ? where : FIT[val('fit')].sentence) + '.' + note;
      q('[data-out="summary"]').textContent = summary;
      if (inResult && !fitModal.hidden) announce('Your size: ' + size + ' inches. ' + summary);
      q('[name="neck"]').setAttribute('aria-label', 'Neck measurement in ' + (val('unit') === 'cm' ? 'centimetres' : 'inches'));
      var slider = q('[data-length]');
      slider.value = size;
      slider.setAttribute('aria-valuetext', size + ' inches, ' + ZONE_LABEL[sz].toLowerCase());
      q('[data-reset]').hidden = !st.override || st.override === rec.len;
      setRadio('width2', val('width'));
      q('[data-progress]').style.width = (st.step / 4 * 100) + '%';
      q('[data-stepcount]').textContent = 'Step ' + st.step + ' of 4';
      var cta = q('[data-go="shop"]');
      if (cta) {
        var nearN = grid && products.length ? countWith('near', true) : 0;
        cta.textContent = !grid ? 'Done' : nearN ? 'Show ' + nearN + ' ' + (nearN === 1 ? 'chain' : 'chains') + ' in my size' : 'Show the closest chains';
      }
    }
    var announceTimer;
    function announce(text) {
      clearTimeout(announceTimer);
      announceTimer = setTimeout(function () { var a = q('[data-announce]'); if (a && a.textContent !== text) a.textContent = text; }, 450);
    }

    function panelToTop() {
      var pnl = fitModal.querySelector('.tcsf-modal__panel');
      if (pnl && window.innerWidth <= 900) pnl.scrollTo({ top: 0, behavior: REDUCED ? 'auto' : 'smooth' });
    }
    function goStep(n, o) {
      st.step = Math.max(1, Math.min(4, n));
      qa('.tcsf__q').forEach(function (s) { s.hidden = +s.dataset.step !== st.step; });
      updateFinder();
      if (!fitModal.hidden && !(o && o.noFocus)) {
        panelToTop();
        var h = form.querySelector('.tcsf__q[data-step="' + st.step + '"] h3');
        if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
      }
    }
    // The answers as saved on this device (also used to undo abandoned edits).
    function snapshot() {
      return {
        v: 1, neckMode: val('neckMode'), neck: q('[name="neck"]').value, unit: val('unit'), collar: val('collar'), wearer: val('wearer'),
        fit: val('fit'), build: val('build'), width: val('width'), metal: val('metal'), skin: val('skin'), outfit: val('outfit'), who: val('who'), len: st.override
      };
    }
    function applySaved(sv) {
      ['neckMode', 'unit', 'collar', 'wearer', 'fit', 'build', 'width', 'metal', 'skin', 'outfit', 'who'].forEach(function (k) { if (sv[k]) setRadio(k, sv[k]); });
      var ni = q('[name="neck"]'), cm = sv.unit === 'cm';
      ni.step = cm ? 1 : 0.5; ni.min = cm ? 25 : 10; ni.max = cm ? 66 : 26;
      if (sv.neck) ni.value = sv.neck;
      st.override = sv.len || null;
      showNeckProblem(false);
    }
    function saveFit() {
      if (!st.done) return;
      st.committed = snapshot();
      storeSet(st.committed);
    }
    function markDone(o) {
      var was = st.done;
      st.done = true;
      if (!was && st.sort === 'featured') { st.sort = 'fit'; var se = q('[data-sort]'); if (se) se.value = 'fit'; }
      var fo = q('[data-sort] option[value="fit"]'); if (fo) fo.textContent = 'Best fit for me';
      saveFit();
      refresh(o);
    }
    function reveal() {
      if (showNeckProblem(true)) { goStep(1); q('[name="neck"]').focus(); return; }
      st.override = null;
      app.dataset.view = 'result';
      form.hidden = true; res.hidden = false;
      updateFinder({ fromTop: true });
      markDone({ skipModel: true });
      panelToTop();
      var top = q('[data-res-top]');
      if (top) top.focus({ preventScroll: true });
    }
    function restart() {
      app.dataset.view = 'quiz';
      res.hidden = true; form.hidden = false;
      st.override = null;
      goStep(1);
    }

    // ---- Products & filters ----
    var products = [];
    if (grid) {
      try { products = normalize(JSON.parse(q('[data-products]').textContent)); } catch (e) { products = []; }
      if (!products.length && /[?&]page=/.test(location.search)) {
        var u = new URL(location.href); u.searchParams.delete('page'); location.replace(u.toString()); return;
      }
    }
    function byId(id) { for (var i = 0; i < products.length; i++) if (String(products[i].id) === String(id)) return products[i]; return null; }

    function niceCents(c) { var d = Math.pow(10, Math.max(2, Math.floor(Math.log10(Math.max(c, 1))) - 1)); return Math.round(c / d) * d; }
    function priceBuckets() {
      var ps = products.filter(function (p) { return !p.quote; }).map(function (p) { return p.price; }).sort(function (a, b) { return a - b; });
      if (ps.length < 6) return [];
      var cuts = uniq([0.25, 0.5, 0.75].map(function (f) { return niceCents(ps[Math.floor(f * (ps.length - 1))]); })).filter(function (c) { return c > 0; });
      var out = [], lo = 0;
      cuts.forEach(function (c, k) {
        var a = lo, b = c;
        out.push({ v: 'p' + k, label: k === 0 ? 'Under ' + money(b) : money(a) + ' – ' + money(b), test: function (x) { return x >= a && x < b; } });
        lo = c;
      });
      out.push({ v: 'p' + cuts.length, label: money(lo) + ' and up', test: function (x) { return x >= lo; } });
      return out;
    }
    var PRICE_BUCKETS = priceBuckets();
    (function promo() {
      var el = q('[data-promo]');
      if (!el) return;
      var onSale = products.filter(function (p) { return p.sale; });
      if (!onSale.length) return;
      var best = Math.max.apply(null, onSale.map(function (p) { return Math.max.apply(null, p.variants.map(pct)); }));
      q('[data-out="promo"]').textContent = 'Sale: save up to ' + best + '% on ' + onSale.length + ' tennis ' + (onSale.length === 1 ? 'chain' : 'chains');
      el.hidden = false;
    })();
    var ALL_LENS = uniq(products.reduce(function (a, p) { return a.concat(p.lens); }, [])).sort(function (a, b) { return a - b; });
    var ALL_METALS = ['yellow', 'white', 'rose'].filter(function (m) { return products.some(function (p) { return p.metals.indexOf(m) > -1; }); });

    function bucketTest(list, sel, x) {
      if (x == null) return false;
      for (var i = 0; i < list.length; i++) if (sel[list[i].v] && list[i].test(x)) return true;
      return false;
    }
    function any(o) { for (var k in o) if (o[k]) return true; return false; }
    var TESTS = {
      len: function (p) { return p.lens.some(function (l) { return F.len[String(l)]; }); },
      width: function (p) { return bucketTest(WIDTH_BUCKETS, F.width, p.w); },
      metal: function (p) { return p.variants.some(function (v) { return F.metal[v.metal] && (v.a || !p.available); }); },
      origin: function (p) { return !!F.origin[p.origin]; },
      price: function (p) { return !p.quote && bucketTest(PRICE_BUCKETS, F.price, variantFor(p, preferredMetal(p), targetLength()).p); },
      carat: function (p) { return bucketTest(CARAT_BUCKETS, F.carat, p.ctN); },
      stock: function (p) { return p.available; },
      sale: function (p) { return p.sale; },
      near: function (p) { var s = mySize(); return p.lens.some(function (l) { return Math.abs(l - s) <= 2; }); }
    };
    function active(key) { return typeof F[key] === 'boolean' ? F[key] : any(F[key]); }
    function passes(p, except) {
      for (var k in TESTS) if (k !== except && active(k) && !TESTS[k](p)) return false;
      return true;
    }
    function countWith(key, patch) {
      var own = !memo;
      if (own) memo = {};
      try {
        var saved = F[key]; F[key] = patch;
        var n = 0;
        for (var i = 0; i < products.length; i++) if (passes(products[i], null)) n++;
        F[key] = saved;
        return n;
      } finally { if (own) memo = null; }
    }
    function one(v) { var o = {}; o[v] = true; return o; }

    function facetHtml() {
      var h = '';
      h += '<div class="tcsf-facet tcsf-facet--fit" data-facet="fit"><div class="tcsf-facet__body tcsf-facet__body--fit">' +
        '<p class="tcsf-fitnote" data-fitnote></p>' +
        '<label class="tcsf-opt" data-nearopt hidden><input type="checkbox" id="' + ID + '-f-near" data-f="near"><span class="tcsf-check"></span><span class="tcsf-opt__label">Within 2" of my size</span><span class="tcsf-opt__n" data-n></span></label>' +
        '</div></div>';
      if (ALL_LENS.length) {
        h += '<details class="tcsf-facet" open data-facet="len"><summary>Length<span class="tcsf-facet__sel" data-sel="len"></span></summary><div class="tcsf-lengths">' +
          ALL_LENS.map(function (l) { return '<label data-opt="' + l + '"><input type="checkbox" id="' + ID + '-f-len-' + String(l).replace('.', '_') + '" data-f="len" value="' + l + '"><span>' + inch(l) + '<small data-n></small></span></label>'; }).join('') + '</div></details>';
      }
      var checks = function (key, title, list, extra, closed) {
        var opts = list;
        return '<details class="tcsf-facet"' + (closed ? '' : ' open') + ' data-facet="' + key + '"><summary>' + title + '<span class="tcsf-facet__sel" data-sel="' + key + '"></span></summary><div class="tcsf-facet__body">' +
          opts.map(function (o) {
            return '<label class="tcsf-opt" data-opt="' + o.v + '"><input type="checkbox" id="' + ID + '-f-' + key + '-' + o.v + '" data-f="' + key + '" value="' + o.v + '"><span class="tcsf-check"></span>' +
              '<span class="tcsf-opt__label">' + (extra ? extra(o) : '') + esc(o.label) + '</span><span class="tcsf-opt__n" data-n></span></label>';
          }).join('') + '</div></details>';
      };
      var present = function (list, get) { return list.filter(function (o) { return products.some(function (p) { var x = get(p); return x != null && o.test(x); }); }); };
      if (PRICE_BUCKETS.length) h += checks('price', 'Price', PRICE_BUCKETS);
      h += checks('width', 'Width', present(WIDTH_BUCKETS, function (p) { return p.w; }));
      if (ALL_METALS.length) h += checks('metal', 'Metal', ALL_METALS.map(function (m) { return { v: m, label: METAL_NAME[m] }; }), function (o) { var c = METAL[o.v]; return '<i class="tcsf-opt__sw" style="background:linear-gradient(135deg,' + c[0] + ',' + c[2] + ')"></i>'; });
      var origins = [{ v: 'natural', label: 'Natural diamonds' }, { v: 'lab', label: 'Lab-grown diamonds' }].filter(function (o) { return products.some(function (p) { return p.origin === o.v; }); });
      if (origins.length) h += checks('origin', 'Diamond type', origins);
      var carats = present(CARAT_BUCKETS, function (p) { return p.ctN; });
      if (carats.length) h += checks('carat', 'Total carat weight', carats, null, true);
      h += '<details class="tcsf-facet" data-facet="more"><summary>Availability</summary><div class="tcsf-facet__body">' +
        '<label class="tcsf-opt" data-opt="stock"><input type="checkbox" id="' + ID + '-f-stock" data-f="stock"><span class="tcsf-check"></span><span class="tcsf-opt__label">In stock</span><span class="tcsf-opt__n" data-n></span></label>' +
        '<label class="tcsf-opt" data-opt="sale"><input type="checkbox" id="' + ID + '-f-sale" data-f="sale"><span class="tcsf-check"></span><span class="tcsf-opt__label">On sale</span><span class="tcsf-opt__n" data-n></span></label>' +
        '</div></details>';
      return h;
    }
    if (facetsEl) facetsEl.innerHTML = products.length ? facetHtml() : '<p class="tcsf-guide__lead">No products to filter yet.</p>';

    function updateFacets() {
      if (!facetsEl || !products.length) return;
      var size = mySize();
      var note = q('[data-fitnote]'), nearOpt = q('[data-nearopt]'), nearN = countWith('near', true);
      var noteKey = st.done ? size + '|' + widthLabel() + '|' + zoneOf(yFor(size)) : 'none';
      if (note.dataset.key !== noteKey) {
        note.dataset.key = noteKey;
        note.innerHTML = st.done
          ? 'Your size: <b>' + size + '"</b> · ' + esc(widthLabel()) + ' · ' + ZONE_LABEL[zoneOf(yFor(size))].toLowerCase() + ' <button type="button" class="tcsf-link" data-open-fit>Edit</button>'
          : 'Rank every chain by how it fits you. <button type="button" class="tcsf-link" data-open-fit>Find my size</button>';
      }
      nearOpt.hidden = !st.done;
      nearOpt.querySelector('input').checked = F.near;
      nearOpt.querySelector('[data-n]').textContent = nearN;
      nearOpt.classList.toggle('is-zero', !nearN && !F.near);
      nearOpt.querySelector('input').disabled = !nearN && !F.near;
      qa('[data-facet="len"] label').forEach(function (lab) {
        var v = lab.dataset.opt, n = countWith('len', one(v));
        lab.querySelector('input').checked = !!F.len[v];
        lab.querySelector('[data-n]').textContent = n;
        lab.classList.toggle('is-zero', !n && !F.len[v]);
        lab.querySelector('input').disabled = !n && !F.len[v];
        lab.classList.toggle('is-mine', st.done && +v === size);
      });
      ['width', 'metal', 'origin', 'price', 'carat'].forEach(function (key) {
        qa('[data-facet="' + key + '"] .tcsf-opt').forEach(function (lab) {
          var v = lab.dataset.opt, n = countWith(key, one(v));
          lab.querySelector('input').checked = !!F[key][v];
          lab.querySelector('[data-n]').textContent = n;
          lab.classList.toggle('is-zero', !n && !F[key][v]);
          lab.querySelector('input').disabled = !n && !F[key][v];
        });
      });
      ['stock', 'sale'].forEach(function (key) {
        var lab = q('[data-facet="more"] [data-opt="' + key + '"]');
        if (!lab) return;
        var n = countWith(key, true);
        lab.querySelector('input').checked = F[key];
        lab.querySelector('[data-n]').textContent = n;
        lab.classList.toggle('is-zero', !n && !F[key]);
        lab.querySelector('input').disabled = !n && !F[key];
      });
      qa('[data-sel]').forEach(function (s) {
        var key = s.dataset.sel, n = Object.keys(F[key]).filter(function (k) { return F[key][k]; }).length;
        s.textContent = n ? n + ' selected' : '';
      });
    }

    function chipList() {
      var chips = [];
      if (F.near) chips.push({ k: 'near', label: 'Within 2" of ' + mySize() + '"', fit: true });
      ALL_LENS.forEach(function (l) { if (F.len[String(l)]) chips.push({ k: 'len', v: String(l), label: inch(l) }); });
      WIDTH_BUCKETS.forEach(function (b) { if (F.width[b.v]) chips.push({ k: 'width', v: b.v, label: b.label }); });
      ALL_METALS.forEach(function (m) { if (F.metal[m]) chips.push({ k: 'metal', v: m, label: METAL_NAME[m] }); });
      if (F.origin.natural) chips.push({ k: 'origin', v: 'natural', label: 'Natural' });
      if (F.origin.lab) chips.push({ k: 'origin', v: 'lab', label: 'Lab-grown' });
      PRICE_BUCKETS.forEach(function (b) { if (F.price[b.v]) chips.push({ k: 'price', v: b.v, label: b.label }); });
      CARAT_BUCKETS.forEach(function (b) { if (F.carat[b.v]) chips.push({ k: 'carat', v: b.v, label: b.label }); });
      if (F.stock) chips.push({ k: 'stock', label: 'In stock' });
      if (F.sale) chips.push({ k: 'sale', label: 'On sale' });
      return chips;
    }
    function renderChips() {
      var el = q('[data-active]'), chips = chipList();
      el.hidden = !chips.length;
      el.innerHTML = chips.map(function (c) {
        return '<button type="button" class="tcsf-chip' + (c.fit ? ' is-fit' : '') + '" data-unchip="' + c.k + '"' + (c.v ? ' data-v="' + esc(c.v) + '"' : '') + ' aria-label="Remove filter ' + esc(c.label) + '">' + esc(c.label) +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg></button>';
      }).join('') + (chips.length > 1 ? '<button type="button" class="tcsf-link" data-clear-all>Clear all</button>' : '');
      var n = chips.length;
      ['filterCount', 'filterCount2'].forEach(function (k) { var c = q('[data-out="' + k + '"]'); if (c) { c.textContent = n; c.hidden = !n; } });
    }

    function preferredMetal(p) {
      if (cardMetal[p.id]) return cardMetal[p.id];
      for (var m in F.metal) if (F.metal[m] && p.metals.indexOf(m) > -1) return m;
      var mine = val('metal');
      if (p.metals.indexOf(mine) > -1) return mine;
      return p.metals[0] || null;
    }
    function targetLength() {
      var sel = Object.keys(F.len).filter(function (k) { return F.len[k]; });
      return sel.length === 1 ? +sel[0] : mySize();
    }
    function variantFor(p, metal, len) {
      var score = function (v) { return (v.a ? 0 : 100) + (!metal || v.metal === metal ? 0 : 10) + (v.len && len ? Math.abs(v.len - len) : 0); };
      return p.variants.slice().sort(function (a, b) { return score(a) - score(b); })[0];
    }
    function fitFor(p, metal, len) {
      var v = variantFor(p, metal || preferredMetal(p), len || targetLength());
      var l = v.len || (p.lens.length === 1 ? p.lens[0] : p.len);
      return { v: v, len: l, diff: l ? l - mySize() : null, zone: l ? zoneOf(yFor(l, p.w || pickedWidth())) : null };
    }
    var CHECK = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7.6 14.2 3.4 10l-1.4 1.4 5.6 5.6 12-12-1.4-1.4z"/></svg>';
    function stockHtml(p, v, cls) {
      if (v.a) return '<p class="' + cls + '">' + CHECK + 'In stock' + (v.metal && p.metals.length > 1 ? ' in ' + METAL_NAME[v.metal].toLowerCase() : '') + '</p>';
      return '<p class="' + cls + ' is-out">' + (p.available ? 'Sold out in this metal' : 'Sold out') + '</p>';
    }
    function pct(v) { return v.c > v.p && v.p > 0 ? Math.round((1 - v.p / v.c) * 100) : 0; }
    function priceHtml(p, v, cls) {
      if (p.quote) return '<div class="' + cls + '"><b>Price on request</b></div>';
      var off = pct(v);
      return '<div class="' + cls + (off ? ' is-sale' : '') + '"><b>' + money(v.p) + '</b>' + (off ? '<s>' + money(v.c) + '</s><em>Save ' + money(v.c - v.p) + '</em>' : '') + '</div>';
    }

    function mediaHtml(p, metal) {
      if (!p.imgs.length) return productShot(GID, p, metal || 'yellow');
      return '<img src="' + esc(p.imgs[0]) + '" alt="' + esc(p.title) + '" loading="lazy" width="800" height="800">' +
        (p.imgs[1] ? '<img src="' + esc(p.imgs[1]) + '" alt="" loading="lazy" width="800" height="800">' : '');
    }
    function cardHtml(x) {
      var p = x.p, f = x.f, v = f.v, off = p.quote ? 0 : pct(v), badges = [];
      if (st.done && f.len && Math.abs(f.diff) <= 0.5) badges.push('<span class="tcsf-badge tcsf-badge--fit">Your size</span>');
      if (off) badges.push('<span class="tcsf-badge tcsf-badge--sale">−' + off + '%</span>');
      if (p.best) badges.push('<span class="tcsf-badge tcsf-badge--best">Best seller</span>');
      else if (p.isNew) badges.push('<span class="tcsf-badge tcsf-badge--new">New</span>');
      var fitLine = '';
      if (st.done && f.len) {
        var d = Math.round(f.diff * 2) / 2, near = Math.abs(d) <= 2;
        fitLine = '<p class="tcsf-card__fit ' + (near ? 'is-good' : 'is-off') + '">' +
          (Math.abs(d) <= .5 ? 'Your size' : inch(Math.abs(d)) + (d > 0 ? ' longer' : ' shorter')) + ' · ' + ZONE_LABEL[f.zone] + '</p>';
      }
      var specs = [f.len ? '<b>' + inch(f.len) + '</b>' : null, p.w ? '<b>' + mm(p.w) + '</b>' : null, p.ct ? esc(p.ct) : null,
        p.origin === 'lab' ? 'Lab-grown' : p.origin === 'natural' ? 'Natural' : null].filter(Boolean).join(' · ');
      if (p.lens.length > 1) specs += ' · ' + p.lens.length + ' lengths';
      var metals = p.metals.map(function (m) {
        var avail = p.variants.some(function (x) { return x.metal === m && x.a; }), c = METAL[m];
        return '<button type="button" data-card-metal="' + m + '" aria-pressed="' + (m === v.metal) + '" aria-label="' + METAL_NAME[m] + '" title="' + METAL_NAME[m] + '"' + (avail ? '' : ' disabled') + ' style="background:linear-gradient(135deg,' + c[0] + ',' + c[2] + ')"></button>';
      }).join('');
      return '<article class="tcsf-card" data-pid="' + p.id + '">' +
        '<div class="tcsf-card__media' + (p.imgs.length ? '' : ' is-drawn') + '"><a class="tcsf-card__img" href="' + esc(p.url) + '" tabindex="-1" aria-hidden="true">' + mediaHtml(p, v.metal) + '</a>' +
          (badges.length ? '<div class="tcsf-card__badges">' + badges.slice(0, 3).join('') + '</div>' : '') +
          '<button type="button" class="tcsf-card__quick" data-qv-open="' + p.id + '">Quick view<span class="tcsf-sr"> of ' + esc(p.title) + '</span></button></div>' +
        '<div class="tcsf-card__body">' + fitLine +
          '<h3><a href="' + esc(p.url) + '">' + esc(p.title) + '</a></h3>' +
          '<p class="tcsf-card__specs">' + specs + '</p>' +
          priceHtml(p, v, 'tcsf-card__price') +
          (p.quote ? '' : stockHtml(p, v, 'tcsf-card__stock')) +
          '<div class="tcsf-card__row"><div class="tcsf-metals" role="group" aria-label="Metal">' + metals + '</div>' +
            (f.len ? '<button type="button" class="tcsf-link tcsf-card__try" data-qv-open="' + p.id + '" data-onyou>Fit preview</button>' : '') + '</div>' +
          (p.quote ? '<a class="tcsf-btn tcsf-btn--outline tcsf-card__add" href="' + esc(p.url) + '">Request a quote</a>'
            : '<button type="button" class="tcsf-btn tcsf-card__add" data-add="' + v.id + '"' + (v.a ? '' : ' disabled') + '>' + (v.a ? 'Add to cart' : 'Sold out') + '</button>') +
        '</div></article>';
    }

    var lastList = [];
    function renderShop() {
      if (!grid) return;
      memo = {};
      try { renderShop0(); } finally { memo = null; }
    }
    function pagerText(shown, total) {
      q('[data-empty]').hidden = total > 0;
      q('[data-pager]').hidden = !total;
      q('[data-out="pagerText"]').textContent = 'Showing ' + shown + ' of ' + total + ' tennis chains';
      q('[data-out="pagerBar"]').style.width = (total ? shown / total * 100 : 0) + '%';
      q('[data-more]').hidden = shown >= total;
    }
    function showMore() {
      var before = grid.children.length;
      st.shown += PAGE;
      var shown = Math.min(st.shown, lastList.length);
      memo = {};
      try { grid.insertAdjacentHTML('beforeend', lastList.slice(before, shown).map(cardHtml).join('')); } finally { memo = null; }
      pagerText(shown, lastList.length);
      return grid.children[before];
    }
    function renderShop0() {
      var size = mySize(), w = pickedWidth();
      var list = products.filter(function (p) { return passes(p, null); }).map(function (p) {
        var f = fitFor(p);
        var score = (f.len ? Math.abs(f.diff) : 6) + (p.w ? Math.abs(p.w - w) * .8 : 1.5) + (p.available ? 0 : 50) + p.i * .002;
        return { p: p, f: f, score: score };
      });
      var s = st.sort;
      list.sort(function (a, b) {
        if (s === 'fit') return a.score - b.score;
        if ((s === 'price-asc' || s === 'price-desc') && a.p.quote !== b.p.quote) return a.p.quote ? 1 : -1;
        if (s === 'price-asc') return a.f.v.p - b.f.v.p || a.p.i - b.p.i;
        if (s === 'price-desc') return b.f.v.p - a.f.v.p || a.p.i - b.p.i;
        if (s === 'carat') return (b.p.ctN || -1) - (a.p.ctN || -1) || a.p.i - b.p.i;
        return (a.p.available ? 0 : 1) - (b.p.available ? 0 : 1) || a.p.i - b.p.i;
      });
      lastList = list;
      var shown = Math.min(st.shown, list.length);
      grid.innerHTML = list.slice(0, shown).map(cardHtml).join('');
      grid.dataset.density = st.density;
      pagerText(shown, list.length);
      var ce = q('[data-out="count"]'), cl = q('[data-out="countLabel"]');
      var lbl = (list.length === 1 ? 'result' : 'results') + (st.done && st.sort === 'fit' ? ', ranked for your ' + size + '" size' : '');
      if (ce.textContent !== String(list.length)) ce.textContent = list.length;
      if (cl.textContent !== lbl) cl.textContent = lbl;
      q('[data-out="countShort"]').textContent = list.length;
      updateFacets();
      renderChips();
    }

    function renderFitbar() {
      var size = mySize(), bar = q('[data-fitbar]');
      ensureModels();
      if (miniModel) {
        var p = modelParams(st.done ? size : recommended().len, pickedWidth(), val('metal'), { twinkle: false });
        if (miniModel.photo) {
          var ph = PHOTOS[wearer() === 'women' ? 'woman' : 'man'], cy = (ph.neck[0][1] + ph.neck[1][1]) / 2 + 30 + photoDrop(ph, p.drop) * 0.5;
          var side = Math.min(1024, 520 + photoDrop(ph, p.drop));
          miniSvg.setAttribute('viewBox', f1(Math.max(0, ph.notch[0] - side / 2)) + ' ' + f1(Math.max(0, Math.min(1024 - side, cy - side / 2))) + ' ' + f1(side) + ' ' + f1(side));
        } else {
          var hgt = Math.max(176, p.drop + 36 - 104), x = 200 - hgt / 2;
          miniSvg.setAttribute('viewBox', f1(x) + ' 104 ' + f1(hgt) + ' ' + f1(hgt));
        }
        miniModel.set(p, { instant: true });
      }
      if (bar) {
        bar.classList.toggle('is-done', st.done);
        var exact = products.filter(function (p) { return p.lens.some(function (l) { return Math.abs(l - size) <= .5; }); }).length;
        var near = products.filter(function (p) { return p.lens.some(function (l) { return Math.abs(l - size) <= 2; }); }).length;
        q('[data-out="fitEyebrow"]').textContent = st.done ? 'Your size' : 'Size finder';
        if (st.done) {
          q('[data-out="fitTitle"]').innerHTML = '<b>' + size + '"</b> ' + esc(widthLabel()) + ' tennis chain · sits at your ' + ZONE_LABEL[zoneOf(yFor(size))].toLowerCase();
          q('[data-out="fitSub"]').textContent = near
            ? (exact ? exact + ' ' + (exact === 1 ? 'chain comes' : 'chains come') + ' in your exact size and ' : '') + near + ' within 2". Every card shows where that chain sits on you.'
            : 'No chains within 2" of ' + size + '" yet. Every card shows where that chain sits on you, or contact us for a custom length.';
        } else {
          q('[data-out="fitTitle"]').textContent = 'Not sure which length? Find your size in 30 seconds.';
          q('[data-out="fitSub"]').textContent = 'Answer 4 quick questions and see the chain on a model. Every chain below is then ranked by how it sits on you.';
        }
        q('[data-out="fitCta"]').textContent = st.done ? 'Edit my size' : 'Find my size';
      }
      var mb = q('[data-out="mbarFit"]');
      if (mb) mb.textContent = st.done ? 'Your size: ' + size + '"' : 'Find my size';
      qa('.tcsf-chart tbody tr').forEach(function (tr) {
        var n = parseInt(tr.dataset.len, 10);
        tr.classList.toggle('is-match', st.done && (n === size || (size >= 28 && n === 28)));
      });
    }

    function refresh(o) {
      updateFinder(o);
      renderFitbar();
      renderShop();
    }

    // ---- Quick view ----
    var qv = null;
    function openQV(pid, onyou, opener) {
      var p = byId(pid);
      if (!p) return;
      var f = fitFor(p);
      qv = { p: p, metal: f.v.metal || preferredMetal(p), len: f.len, qty: 1, view: onyou && f.len ? 'onyou' : 0, lastView: null };
      renderQV();
      openModal(qvModal, opener);
    }
    function qvVariant() { return variantFor(qv.p, qv.metal, qv.len); }
    function buyNowUrl(v) { return (root.dataset.cart || '/cart') + '/' + v.id + ':' + qv.qty; }
    // Quantity changes update the buy row in place so focus and the model view stay put.
    function syncQty() {
      var v = qvVariant(), inp = qvBody.querySelector('[data-qv-qty]'), add = qvBody.querySelector('.tcsf-qv__add'), bn = qvBody.querySelector('[data-buy-now]');
      if (inp) inp.value = qv.qty;
      if (add && v.a && !add.classList.contains('is-done') && add.getAttribute('aria-disabled') !== 'true') add.textContent = 'Add to cart · ' + money(v.p * qv.qty);
      if (bn) bn.setAttribute('href', buyNowUrl(v));
    }
    function renderQV(focusSel) {
      var p = qv.p, v = qvVariant(), len = v.len || qv.len || p.len, off = p.quote ? 0 : pct(v);
      var views = p.imgs.map(function (src, k) { return { k: k, src: src }; });
      if (!views.length) views = [{ k: 0, shot: true }];
      var canOnYou = !!len;
      var main, mainCls = '';
      if (qv.view === 'onyou' && canOnYou) {
        mainCls = ' is-model';
        var zone = zoneOf(yFor(len, p.w || pickedWidth()));
        main = '<svg viewBox="0 80 400 380" role="img" aria-label="' + esc(inch(len)) + ' chain on a model, sitting at the ' + ZONE_LABEL[zone].toLowerCase() + '" data-qv-model></svg>' +
          '<span class="tcsf-qv__zone">Fit preview: ' + inch(len) + ' · ' + (st.done ? 'sits at your ' : 'sits at the ') + ZONE_LABEL[zone].toLowerCase() + '</span>';
      } else {
        var cur = views[qv.view] || views[0];
        if (cur.shot) mainCls = ' is-drawn';
        main = cur.shot ? productShot(GID, p, v.metal || 'yellow') : '<img src="' + esc(cur.src) + '" alt="' + esc(p.title) + '" width="800" height="800">';
      }
      var thumbs = views.map(function (t) {
        return '<button type="button"' + (t.shot ? ' class="is-drawn"' : '') + ' data-qv-view="' + t.k + '" aria-pressed="' + (qv.view === t.k) + '" aria-label="Photo ' + (t.k + 1) + '">' +
          (t.shot ? productShot(GID, p, v.metal || 'yellow') : '<img src="' + esc(t.src) + '" alt="" loading="lazy" width="120" height="120">') + '</button>';
      }).join('') + (canOnYou ? '<button type="button" class="is-onyou" data-qv-view="onyou" aria-pressed="' + (qv.view === 'onyou') + '" aria-label="Fit preview on a model"><svg viewBox="112 110 176 176" aria-hidden="true" data-qv-thumbmodel></svg></button>' : '');

      var fitBox;
      if (len && st.done) {
        var d = Math.round((len - mySize()) * 2) / 2;
        fitBox = '<p class="tcsf-qv__fit">' + (Math.abs(d) <= .5 ? '<b>Your size.</b> ' : '<b>' + inch(Math.abs(d)) + (d > 0 ? ' longer' : ' shorter') + ' than your ' + mySize() + '" size.</b> ') +
          'On you this ' + inch(len) + ' chain sits at your ' + ZONE_LABEL[zoneOf(yFor(len, p.w || pickedWidth()))].toLowerCase() + '. <button type="button" class="tcsf-link" data-open-fit>Edit my size</button></p>';
      } else if (len) {
        fitBox = '<p class="tcsf-qv__fit">Not sure ' + inch(len) + ' is right for you? <button type="button" class="tcsf-link" data-open-fit>Find my size</button> to see exactly where it sits.</p>';
      } else fitBox = '';

      var metalOpts = p.metals.length > 1 || p.metals.length === 1 ? '<div><p class="tcsf-qv__label">Metal: <span>' + esc(METAL_NAME[v.metal] || '') + '</span></p><div class="tcsf-qv__opts" role="radiogroup" aria-label="Metal">' +
        p.metals.map(function (m) {
          var ok = p.variants.some(function (x) { return x.metal === m && x.a; }), c = METAL[m];
          return '<label><input type="radio" name="' + ID + '-qvMetal" value="' + m + '"' + (m === v.metal ? ' checked' : '') + (ok ? '' : ' disabled') + '><span><i style="background:linear-gradient(135deg,' + c[0] + ',' + c[2] + ')"></i>' + METAL_NAME[m] + '</span></label>';
        }).join('') + '</div></div>' : '';
      var lenOpts = p.lens.length > 1 ? '<div><p class="tcsf-qv__label">Length: <span>' + inch(len) + '</span></p><div class="tcsf-qv__opts" role="radiogroup" aria-label="Length">' +
        p.lens.map(function (l) {
          var ok = p.variants.some(function (x) { return x.len === l && x.a && (!qv.metal || x.metal === qv.metal); });
          return '<label><input type="radio" name="' + ID + '-qvLen" value="' + l + '"' + (l === len ? ' checked' : '') + (ok ? '' : ' disabled') + '><span>' + inch(l) + (st.done && Math.abs(l - mySize()) <= .5 ? ' · your size' : '') + '</span></label>';
        }).join('') + '</div></div>' : '';

      var specs = [['Length', len ? inch(len) : null], ['Width', p.w ? mm(p.w) : null], ['Total carat weight', p.ct], ['Color', p.col], ['Clarity', p.cl],
        ['Diamonds', p.origin === 'lab' ? 'Lab-grown' : p.origin === 'natural' ? 'Natural' : null], ['Metal', p.metalName], ['Setting', p.setting], ['Weight', p.grams]]
        .filter(function (r) { return r[1]; }).map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('');
      var badges = [];
      if (off) badges.push('<span class="tcsf-badge tcsf-badge--sale">−' + off + '%</span>');
      if (p.best) badges.push('<span class="tcsf-badge tcsf-badge--best">Best seller</span>');
      if (p.isNew) badges.push('<span class="tcsf-badge tcsf-badge--new">New</span>');

      var buy = p.quote
        ? '<a class="tcsf-btn tcsf-qv__add" href="' + esc(p.url) + '">Request a quote</a>'
        : '<div class="tcsf-qty"><button type="button" data-qty="-1" aria-label="Decrease quantity">−</button><input type="number" id="' + ID + '-qv-qty" min="1" max="10" value="' + qv.qty + '" aria-label="Quantity" data-qv-qty><button type="button" data-qty="1" aria-label="Increase quantity">+</button></div>' +
          '<button type="button" class="tcsf-btn tcsf-qv__add" data-add="' + v.id + '"' + (v.a ? '' : ' disabled') + '>' + (v.a ? 'Add to cart · ' + money(v.p * qv.qty) : 'Sold out') + '</button>' +
          (v.a ? '<a class="tcsf-btn tcsf-btn--buy" data-buy-now href="' + esc(buyNowUrl(v)) + '">Buy now</a>' : '');
      qvBody.innerHTML = '<div class="tcsf-qv__bar"><button type="button" class="tcsf-iconbtn" data-close aria-label="Close quick view"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>' +
        '<div class="tcsf-qv">' +
        '<div class="tcsf-qv__media"><div class="tcsf-qv__main' + mainCls + '">' + main + '</div><div class="tcsf-qv__thumbs">' + thumbs + '</div>' +
          (mainCls === ' is-model' ? '<p class="tcsf-qv__note">Illustration of where this length sits' + (st.done ? ' on you, based on your size answers.' : ' on an average 16" neck.') + ' See the photos for the real piece.</p>' : '') + '</div>' +
        '<div class="tcsf-qv__info">' +
          (badges.length ? '<div class="tcsf-card__badges" style="position:static">' + badges.join('') + '</div>' : '') +
          '<h2 id="' + ID + '-qv-title">' + esc(p.title) + '</h2>' +
          priceHtml(p, v, 'tcsf-qv__price') +
          (p.quote ? '' : stockHtml(p, v, 'tcsf-qv__stock')) + fitBox + metalOpts + lenOpts +
          (specs ? '<dl class="tcsf-qv__specs">' + specs + '</dl>' : '') +
          '<div class="tcsf-qv__buy' + (p.quote ? ' is-quote' : '') + '">' + buy + '</div>' +
          '<div class="tcsf-qv__more"><a href="' + esc(p.url) + '">View full details</a>' + (len && qv.view !== 'onyou' ? '<button type="button" class="tcsf-link" data-qv-view="onyou">Fit preview on a model</button>' : '') + '</div>' +
        '</div></div>';

      var mp = modelParams(len || 20, p.w || pickedWidth(), v.metal || qv.metal || 'yellow');
      var mEl = qvBody.querySelector('[data-qv-model]');
      // Drop the chain in only when switching to the model view, not on every option change.
      if (mEl) { var qm = makeModel(mEl, ID + '-qvm', root, wearer()); mEl.parentNode.classList.toggle('is-photo', !!qm.photo); qm.set(mp, qv.lastView !== 'onyou' ? { fromTop: true } : { instant: true }); }
      qv.lastView = qv.view;
      var tEl = qvBody.querySelector('[data-qv-thumbmodel]');
      if (tEl) { mp.twinkle = false; var tm = makeModel(tEl, ID + '-qvt', root, wearer()); if (tm.photo) tEl.setAttribute('viewBox', '250 420 560 560'); tm.set(mp, { instant: true }); }
      if (focusSel) { var fEl = qvBody.querySelector(focusSel); if (fEl) fEl.focus(); }
    }

    // ---- Dialogs, drawer, scroll lock ----
    var stack = [];
    var mqDesk = window.matchMedia('(min-width: 1024px)');
    var advanceTimer, ptrAt = 0;
    function drawerOpen() { return !!(filters && filters.classList.contains('is-open')); }
    function lock() {
      var de = document.documentElement, on = !!(stack.length || drawerOpen());
      de.style.overflow = on ? 'hidden' : '';
      de.style.scrollbarGutter = on ? 'stable' : '';
    }
    function visible(el) { return !!(el && document.contains(el) && el.offsetParent !== null && !el.closest('[hidden]')); }
    function focusables(el) { return Array.prototype.slice.call(el.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select,textarea,[tabindex]:not([tabindex="-1"])')).filter(function (n) { return n.offsetParent !== null || n === document.activeElement; }); }
    function openModal(m, opener) {
      if (!m) return;
      if (stack.indexOf(m) === -1) { m._opener = opener || document.activeElement; stack.push(m); }
      m.hidden = false;
      lock();
      syncMbar();
      var f = m.querySelector('.tcsf-modal__panel [data-close]') || focusables(m)[0];
      if (f) f.focus({ preventScroll: true });
    }
    // Where focus goes back to when a dialog closes: its opener, or the same control on a re-rendered card.
    function returnTarget(o) {
      if (visible(o)) return o;
      if (o && o.dataset && o.dataset.qvOpen && grid) {
        var again = grid.querySelector('[data-qv-open="' + o.dataset.qvOpen + '"]' + (o.hasAttribute('data-onyou') ? '[data-onyou]' : '.tcsf-card__quick'));
        if (visible(again)) return again;
      }
      var fb = q('.tcsf-fitbar [data-open-fit]');
      return visible(fb) ? fb : q('[data-sort]');
    }
    function closeModal(m, o) {
      if (!m || m.hidden) return;
      if (m === fitModal) {
        clearTimeout(advanceTimer);
        // Closing half-way through "Change my answers" keeps the size already chosen.
        if (st.done && app.dataset.view !== 'result' && st.committed) {
          applySaved(st.committed);
          app.dataset.view = 'result'; form.hidden = true; res.hidden = false;
          refresh({ instant: true });
        }
      }
      m.hidden = true;
      stack = stack.filter(function (x) { return x !== m; });
      lock();
      syncMbar();
      if (!(o && o.noFocus)) { var t = returnTarget(m._opener); if (t) t.focus({ preventScroll: true }); }
    }
    function openFit(opener) {
      if (opener && qvModal.contains(opener)) opener = qvModal._opener;
      if (opener && filters && filters.contains(opener) && drawerOpen()) opener = filters._opener;
      if (!qvModal.hidden) closeModal(qvModal, { noFocus: true });
      closeFilters({ noFocus: true });
      openModal(fitModal, opener);
      updateFinder({ instant: true });
    }
    function setExpanded(v) { qa('[data-open-filters]').forEach(function (b) { b.setAttribute('aria-expanded', String(v)); }); }
    function openFilters(opener) {
      if (!filters || mqDesk.matches) { var f = facetsEl && facetsEl.querySelector('input:not([disabled])'); if (f) f.focus(); return; }
      filters._opener = opener;
      filters.classList.add('is-open');
      filters.setAttribute('role', 'dialog'); filters.setAttribute('aria-modal', 'true');
      setExpanded(true);
      q('.tcsf-filters__backdrop').hidden = false;
      lock();
      var x = filters.querySelector('.tcsf-filters__x'); if (x) x.focus();
    }
    function closeFilters(o) {
      if (!drawerOpen()) return;
      filters.classList.remove('is-open');
      filters.setAttribute('role', 'complementary'); filters.removeAttribute('aria-modal');
      setExpanded(false);
      q('.tcsf-filters__backdrop').hidden = true;
      lock();
      if (!(o && o.noFocus)) {
        var t = visible(filters._opener) ? filters._opener : q('.tcsf-toolbar__filter');
        if (visible(t)) t.focus({ preventScroll: true }); else { var s2 = q('[data-sort]'); if (s2) s2.focus({ preventScroll: true }); }
      }
    }
    // Rotating a tablet or widening the window turns the drawer back into the sidebar.
    var onMq = function (e) { if (e.matches) closeFilters({ noFocus: true }); };
    if (mqDesk.addEventListener) mqDesk.addEventListener('change', onMq); else if (mqDesk.addListener) mqDesk.addListener(onMq);

    function onKey(e) {
      if (!document.contains(root)) return;
      var top = stack[stack.length - 1] || (drawerOpen() && !mqDesk.matches ? filters : null);
      if (!top) return;
      if (e.key === 'Escape') { e.preventDefault(); if (top === filters) closeFilters(); else closeModal(top); return; }
      if (e.key === 'Tab') {
        var f = focusables(top);
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        else if (!top.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener('keydown', onKey);

    // ---- Cart ----
    function toast(html, ms) {
      var t = q('[data-toast]'), wait = ms || 5000;
      var hide = function () { t.hidden = true; };
      t.innerHTML = html; t.hidden = false;
      clearTimeout(t._h);
      t._h = setTimeout(hide, wait);
      // Pause while the pointer or keyboard focus is on the message so its links stay usable.
      t.onmouseenter = function () { clearTimeout(t._h); };
      t.onmouseleave = function () { if (!t.contains(document.activeElement)) t._h = setTimeout(hide, 3000); };
    }
    (function () {
      var t = q('[data-toast]');
      t.addEventListener('focusin', function () { clearTimeout(t._h); });
      t.addEventListener('focusout', function (e) { if (!t.contains(e.relatedTarget)) t._h = setTimeout(function () { t.hidden = true; }, 3000); });
    })();
    function addToCart(btn, qty) {
      if (btn.getAttribute('aria-disabled') === 'true') return;
      var id = +btn.dataset.add, url = (root.dataset.cartAdd || '/cart/add') + '.js', label = btn.textContent;
      var drawer = document.querySelector('cart-drawer'), bubble = document.getElementById('cart-icon-bubble');
      var body = { items: [{ id: id, quantity: qty || 1 }] };
      // Ask Shopify for the theme's cart drawer / cart icon markup so they update too (Dawn and similar themes).
      var sections = [drawer ? 'cart-drawer' : null, bubble ? 'cart-icon-bubble' : null].filter(Boolean);
      if (sections.length) { body.sections = sections.join(','); body.sections_url = location.pathname; }
      btn.setAttribute('aria-disabled', 'true'); btn.textContent = 'Adding…';
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.description || j.message || 'Could not add to cart.'); return j; }); })
        .then(function (j) {
          btn.classList.add('is-done'); btn.textContent = 'Added ✓';
          var cart = root.dataset.cart || '/cart', usedDrawer = false;
          if (j && j.sections) {
            if (drawer && typeof drawer.renderContents === 'function' && j.sections['cart-drawer']) {
              var ret = qvModal.contains(btn) ? (qvModal._opener || btn) : btn;
              closeModal(qvModal, { noFocus: true });
              drawer.classList.remove('is-empty');
              if (typeof drawer.setActiveElement === 'function') drawer.setActiveElement(ret);
              try { drawer.renderContents(j); usedDrawer = true; } catch (e) { usedDrawer = false; }
            } else if (bubble && j.sections['cart-icon-bubble']) {
              var doc = new DOMParser().parseFromString(j.sections['cart-icon-bubble'], 'text/html');
              var sec = doc.querySelector('.shopify-section');
              if (sec) bubble.innerHTML = sec.innerHTML;
            }
          }
          if (!usedDrawer) toast('<span>Added to your cart.</span><a href="' + esc(cart) + '">View cart</a><a class="tcsf-btn" href="' + esc(cart.replace(/cart$/, 'checkout')) + '">Checkout</a>', 10000);
          document.documentElement.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true }));
          fetch(cart + '.js', { headers: { Accept: 'application/json' } }).then(function (r) { return r.json(); }).then(function (c) {
            document.querySelectorAll('[data-cart-count], .cart-count-bubble span[aria-hidden="true"]').forEach(function (n) { n.textContent = c.item_count; });
          }).catch(function () {});
          setTimeout(function () { btn.classList.remove('is-done'); btn.removeAttribute('aria-disabled'); btn.textContent = btn.classList.contains('tcsf-qv__add') && qv ? 'Add to cart · ' + money(qvVariant().p * qv.qty) : label; }, 2400);
        })
        .catch(function (err) {
          btn.removeAttribute('aria-disabled'); btn.textContent = label;
          toast('<span>' + esc(err.message || 'Could not add to cart. Please try again.') + '</span>', 8000);
        });
    }

    // ---- Events ----
    // Picture cards move to the next question after a tap or click, but not while arrowing through options.
    form.addEventListener('pointerdown', function () { ptrAt = Date.now(); });
    form.addEventListener('change', function (e) {
      var n = e.target.name;
      if (n === 'unit') {
        var inp = q('[name="neck"]'), v = parseFloat(inp.value), cm = e.target.value === 'cm';
        var fits = cm ? (v >= 25 && v <= 66) : (v >= 10 && v <= 26);
        if (isFinite(v) && !fits) inp.value = cm ? Math.round(v * 2.54) : Math.round(v / 2.54 * 2) / 2;
        inp.step = cm ? 1 : 0.5; inp.min = cm ? 25 : 10; inp.max = cm ? 66 : 26;
        showNeckProblem(false);
      }
      if (n === 'wearer') setRadio('who', e.target.value);
      updateFinder();
      if ((n === 'fit' || n === 'build') && !REDUCED && Date.now() - ptrAt < 1500) {
        clearTimeout(advanceTimer);
        advanceTimer = setTimeout(function () { if (!fitModal.hidden) goStep(st.step + 1); }, 650);
      }
    });
    form.addEventListener('input', function (e) { if (e.target.name === 'neck') { showNeckProblem(false); updateFinder(); } });
    form.addEventListener('submit', function (e) { e.preventDefault(); });
    q('.tcsf__stage').addEventListener('change', function (e) {
      if (e.target.name === 'outfit') { updateFinder(); saveFit(); }
      if (e.target.name === 'who') { refresh({ instant: true }); saveFit(); }
    });
    // Dragging the length slider only moves the chain; the grid re-ranks when it's released.
    res.addEventListener('input', function (e) {
      if (!e.target.hasAttribute('data-length')) return;
      var v = parseInt(e.target.value, 10);
      st.override = v === recommended().len ? null : v;
      updateFinder();
    });
    res.addEventListener('change', function (e) {
      var n = e.target.name;
      if (e.target.hasAttribute('data-length')) { refresh({ skipModel: true }); saveFit(); }
      if (n === 'width2') { setRadio('width', e.target.value); refresh(); saveFit(); }
      if (n === 'metal') { refresh(); saveFit(); }
      if (n === 'skin') { updateFinder(); renderFitbar(); saveFit(); }
      if (e.target.hasAttribute('data-layer')) { st.layer = e.target.checked; updateFinder({ instant: true }); }
    });

    if (facetsEl) facetsEl.addEventListener('change', function (e) {
      var k = e.target.dataset.f;
      if (!k) return;
      if (typeof F[k] === 'boolean') F[k] = e.target.checked;
      else F[k][e.target.value] = e.target.checked;
      st.shown = PAGE;
      renderShop();
    });
    var sortEl = q('[data-sort]');
    if (sortEl) sortEl.addEventListener('change', function () {
      st.sort = sortEl.value; st.shown = PAGE; renderShop();
      if (sortEl.value === 'fit' && !st.done) toast('<span>Find your size to rank chains by fit.</span><button type="button" class="tcsf-link" data-open-fit>Find my size</button>', 8000);
    });

    function replaceCard(pid) {
      var card = grid && grid.querySelector('[data-pid="' + pid + '"]');
      var x = lastList.filter(function (y) { return String(y.p.id) === String(pid); })[0];
      if (!card || !x) return null;
      memo = {};
      try { x.f = fitFor(x.p); var tmp = document.createElement('div'); tmp.innerHTML = cardHtml(x); card.replaceWith(tmp.firstChild); } finally { memo = null; }
      return grid.querySelector('[data-pid="' + pid + '"]');
    }
    qvModal.addEventListener('change', function (e) {
      if (!qv) return;
      if (e.target.name === ID + '-qvMetal') { qv.metal = e.target.value; cardMetal[qv.p.id] = qv.metal; renderQV('[name="' + ID + '-qvMetal"]:checked'); replaceCard(qv.p.id); }
      if (e.target.name === ID + '-qvLen') { qv.len = +e.target.value; renderQV('[name="' + ID + '-qvLen"]:checked'); }
      if (e.target.hasAttribute('data-qv-qty')) { qv.qty = Math.max(1, Math.min(10, parseInt(e.target.value, 10) || 1)); syncQty(); }
    });

    function clearAll() {
      ['len', 'width', 'metal', 'origin', 'price', 'carat'].forEach(function (k) { F[k] = {}; });
      F.stock = F.sale = F.near = false;
      st.shown = PAGE;
      renderShop();
    }
    function focusResults() {
      var tb = q('.tcsf-toolbar');
      if (tb) tb.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
      var c = q('.tcsf-toolbar__count');
      if (c) { c.tabIndex = -1; c.focus({ preventScroll: true }); }
    }

    root.addEventListener('click', function (e) {
      var t = e.target.closest('button, a, [data-close], [data-close-filters]');
      if (!t || !root.contains(t)) return;
      var d = t.dataset;
      if (d.nudge) {
        var inp = q('[name="neck"]'), step = parseFloat(inp.step) || 0.5, cur0 = parseFloat(inp.value);
        var nv = (isFinite(cur0) ? cur0 : (val('unit') === 'cm' ? 41 : 16)) + step * parseFloat(d.nudge);
        inp.value = Math.min(parseFloat(inp.max), Math.max(parseFloat(inp.min), nv));
        showNeckProblem(false);
        updateFinder();
      }
      if (t.hasAttribute('data-to-cm')) {
        setRadio('unit', 'cm');
        var ni = q('[name="neck"]'); ni.step = 1; ni.min = 25; ni.max = 66;
        showNeckProblem(false); updateFinder(); ni.focus();
      }
      if (d.go === 'next') {
        clearTimeout(advanceTimer);
        if (st.step === 1 && showNeckProblem(true)) { q('[name="neck"]').focus(); return; }
        goStep(st.step + 1);
      }
      if (d.go === 'back') { clearTimeout(advanceTimer); goStep(st.step - 1); }
      if (d.go === 'reveal') reveal();
      if (d.go === 'restart') restart();
      if (d.go === 'shop') {
        var nearN = grid && products.length ? countWith('near', true) : 0;
        F.near = nearN > 0; st.shown = PAGE;
        closeModal(fitModal, { noFocus: true });
        markDone();
        focusResults();
        toast('<span>' + (nearN ? 'Showing ' + nearN + ' ' + (nearN === 1 ? 'chain' : 'chains') + ' within 2" of your ' + mySize() + '" size.' : 'Showing chains ranked for your ' + mySize() + '" size.') + '</span>', 4000);
      }
      if (t.hasAttribute('data-reset')) { st.override = null; refresh(); saveFit(); q('[data-length]').focus(); }
      if (t.hasAttribute('data-open-fit')) { e.preventDefault(); openFit(t); }
      if (t.hasAttribute('data-close')) { closeModal(t.closest('.tcsf-modal')); }
      if (t.hasAttribute('data-open-filters')) openFilters(t);
      if (t.hasAttribute('data-close-filters')) closeFilters();
      if (t.hasAttribute('data-clear-all')) { clearAll(); if (!visible(t)) { var s1 = q('[data-sort]'); if (s1) s1.focus(); } }
      if (t.hasAttribute('data-shop-sale')) { F.sale = true; st.shown = PAGE; renderShop(); focusResults(); }
      if (d.unchip) {
        if (typeof F[d.unchip] === 'boolean') F[d.unchip] = false; else F[d.unchip][d.v] = false;
        st.shown = PAGE; renderShop();
        var nx = q('[data-active] .tcsf-chip') || q('[data-sort]'); if (nx) nx.focus();
      }
      if (t.hasAttribute('data-more')) {
        var first = showMore();
        if (first) { var a = first.querySelector('h3 a'); if (a) a.focus({ preventScroll: false }); }
      }
      if (d.density) { st.density = d.density; qa('button[data-density]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.density === st.density)); }); grid.dataset.density = st.density; }
      if (d.cardMetal) {
        cardMetal[t.closest('[data-pid]').dataset.pid] = d.cardMetal;
        var nc = replaceCard(t.closest('[data-pid]').dataset.pid);
        var again = nc && nc.querySelector('[data-card-metal="' + d.cardMetal + '"]'); if (again) again.focus();
      }
      if (d.qvOpen) openQV(d.qvOpen, t.hasAttribute('data-onyou'), t);
      if (d.qvView != null && qv) { qv.view = d.qvView === 'onyou' ? 'onyou' : +d.qvView; renderQV('.tcsf-qv__thumbs [data-qv-view="' + d.qvView + '"]'); }
      if (d.qty && qv) { qv.qty = Math.max(1, Math.min(10, qv.qty + +d.qty)); syncQty(); }
      if (d.add) addToCart(t, t.classList.contains('tcsf-qv__add') && qv ? qv.qty : 1);
      if (d.tab) selectTab(d.tab, true);
      if (t.hasAttribute('data-open-guide')) {
        selectTab('length');
        q('[data-guide]').scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
        q('[data-tab="length"]').focus({ preventScroll: true });
      }
      if (t.hasAttribute('data-copy')) {
        var text = 'My tennis chain size: ' + mySize() + '" (' + Math.round(mySize() * 2.54) + ' cm), ' + widthLabel() + ' wide, ' + (METAL_NAME[val('metal')] || '').toLowerCase();
        var ok = function () { t.textContent = 'Copied ✓'; setTimeout(function () { t.textContent = 'Copy my size'; }, 1800); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, function () { toast('<span>' + esc(text) + '</span>', 8000); });
        else toast('<span>' + esc(text) + '</span>', 8000);
      }
    });

    // Guide tabs with arrow-key support.
    function selectTab(name, focus) {
      qa('[data-tab]').forEach(function (b) {
        var on = b.dataset.tab === name;
        b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
        if (on && focus) b.focus();
      });
      qa('[data-panel]').forEach(function (p) { p.hidden = p.dataset.panel !== name; });
    }
    var tablist = q('.tcsf-tabs');
    if (tablist) tablist.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var tabs = qa('[data-tab]'), i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      selectTab(tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length].dataset.tab, true);
    });

    // Mobile bar: shown while the product area is on screen and nothing is open.
    var mbar = q('[data-mbar]'), marketVisible = false, io = null;
    function syncMbar() { if (mbar) mbar.hidden = !(marketVisible && !stack.length); }
    if (mbar && 'IntersectionObserver' in window) {
      io = new IntersectionObserver(function (en) { marketVisible = en[0].isIntersecting; syncMbar(); }, { rootMargin: '-120px 0px -40% 0px' });
      io.observe(q('[data-market]'));
    }

    // Theme editor: clean up when this section is re-rendered or removed.
    function onUnload(e) {
      if (!e.target || !e.target.contains || !e.target.contains(root)) return;
      document.removeEventListener('shopify:section:unload', onUnload);
      stack = [];
      if (filters) filters.classList.remove('is-open');
      lock();
      document.removeEventListener('keydown', onKey);
      if (mqDesk.removeEventListener) mqDesk.removeEventListener('change', onMq);
      if (io) io.disconnect();
    }
    document.addEventListener('shopify:section:unload', onUnload);

    // Restore a size saved on this device.
    var saved = storeGet();
    if (saved && saved.v === 1) {
      applySaved(saved);
      st.done = true; st.sort = 'fit'; st.committed = saved;
      if (sortEl) sortEl.value = 'fit';
      app.dataset.view = 'result'; form.hidden = true; res.hidden = false;
    }
    qa('.tcsf__q').forEach(function (s) { s.hidden = +s.dataset.step !== st.step; });
    refresh({ instant: true });
  }

  function boot() { document.querySelectorAll('.tcsf').forEach(init); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  document.addEventListener('shopify:section:load', function (e) { var r = e.target.querySelector('.tcsf'); if (r) init(r); });
})();
