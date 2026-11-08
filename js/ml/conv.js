/* Tiny convolutional models: the frozen vision encoder and the image diffusion model. Pure JS, used in pages and workers. */
(function (global) {
  'use strict';
  const CONV = {};
  const ML = typeof module !== 'undefined' && module.exports ? require('./engine.js') : global.ML;

  // x: CHW Float32Array. w: (out, in, 3, 3) in PyTorch order. stride 1 or 2, padding 1.
  function conv2d(x, c, hh, ww, W, B, cout, stride) {
    const oh = stride === 2 ? Math.ceil(hh / 2) : hh, ow = stride === 2 ? Math.ceil(ww / 2) : ww;
    const y = new Float32Array(cout * oh * ow);
    for (let o = 0; o < cout; o++) {
      const yo = o * oh * ow;
      for (let i = 0; i < c; i++) {
        const xo = i * hh * ww, wo = (o * c + i) * 9;
        for (let ky = 0; ky < 3; ky++) for (let kx = 0; kx < 3; kx++) {
          const k = W[wo + ky * 3 + kx];
          if (k === 0) continue;
          for (let r = 0; r < oh; r++) {
            const sy = r * stride + ky - 1;
            if (sy < 0 || sy >= hh) continue;
            const rowY = yo + r * ow, rowX = xo + sy * ww;
            for (let q = 0; q < ow; q++) {
              const sx = q * stride + kx - 1;
              if (sx < 0 || sx >= ww) continue;
              y[rowY + q] += k * x[rowX + sx];
            }
          }
        }
      }
      if (B) { const b = B[o]; for (let n = 0; n < oh * ow; n++) y[yo + n] += b; }
    }
    return { y, h: oh, w: ow };
  }
  const relu = (a) => { for (let i = 0; i < a.length; i++) if (a[i] < 0) a[i] = 0; return a; };

  // ------------------------------------------------ vision
  CONV.COLORS = { red: [226, 52, 52], blue: [52, 120, 235], green: [52, 200, 90], yellow: [245, 205, 50], purple: [160, 80, 225], orange: [245, 140, 45], white: [235, 235, 235] };
  CONV.CNAMES = Object.keys(CONV.COLORS);
  CONV.SHAPES = ['circle', 'square', 'triangle'];
  CONV.POS = ['left', 'right', 'top', 'bottom', 'center'];
  CONV.HEADS = { shape: 3, color: 7, count: 6, pos: 5 };
  function put(img, n, kind, cx, cy, s, col) {
    const r = s / 2;
    for (let y = Math.max(0, Math.floor(cy - r - 1)); y < Math.min(n, Math.floor(cy + r + 2)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r - 1)); x < Math.min(n, Math.floor(cx + r + 2)); x++) {
        const dx = x - cx, dy = y - cy;
        let inside;
        if (kind === 'circle') inside = dx * dx + dy * dy <= r * r;
        else if (kind === 'square') inside = Math.abs(dx) <= r && Math.abs(dy) <= r;
        else inside = dy >= -r && dy <= r && Math.abs(dx) <= (dy + r) / 2;
        if (inside) for (let c = 0; c < 3; c++) img[c * n * n + y * n + x] = col[c] / 255;
      }
    }
  }
  // same scene generator as the Python pre-training script
  CONV.scene = function (rng, force) {
    const n = 32, img = new Float32Array(3 * n * n);
    for (let c = 0; c < 3; c++) { const b = 0.04 + rng() * 0.12; img.fill(b, c * n * n, (c + 1) * n * n); }
    const countOpts = [0, 1, 1, 1, 2, 2, 3, 3, 4, 5];
    const count = force && force.count != null ? force.count : countOpts[Math.floor(rng() * countOpts.length)];
    const kind = force && force.shape != null ? force.shape : Math.floor(rng() * 3);
    const color = force && force.color != null ? force.color : Math.floor(rng() * 7);
    let pos = 4;
    const col = CONV.COLORS[CONV.CNAMES[color]];
    const j = (a) => (rng() * 2 - 1) * a;
    if (count === 1) {
      pos = Math.floor(rng() * 5);
      const c = [[8, 16], [24, 16], [16, 8], [16, 24], [16, 16]][pos];
      put(img, n, CONV.SHAPES[kind], c[0] + j(2), c[1] + j(2), 9 + rng() * 5, col);
    } else {
      const spots = [[8, 8], [24, 8], [8, 24], [24, 24], [16, 16]];
      for (let i = spots.length - 1; i > 0; i--) { const k = Math.floor(rng() * (i + 1)); [spots[i], spots[k]] = [spots[k], spots[i]]; }
      for (let k = 0; k < count; k++) put(img, n, CONV.SHAPES[kind], spots[k][0] + j(1.5), spots[k][1] + j(1.5), 6 + rng() * 3, col);
    }
    return { x: img, shape: kind, color, count, pos };
  };
  CONV.loadVision = function (buf) {
    const { tensors: w } = ML.parseSafetensors(buf);
    return {
      w,
      feat(x) {
        let a = conv2d(x, 3, 32, 32, w.c1, w.c1b, 16, 2); relu(a.y);
        let b = conv2d(a.y, 16, a.h, a.w, w.c2, w.c2b, 32, 2); relu(b.y);
        let c = conv2d(b.y, 32, b.h, b.w, w.c3, w.c3b, 48, 2); relu(c.y);
        const out = new Float32Array(64);
        for (let o = 0; o < 64; o++) { let s = w.fcb[o]; const ro = o * 768; for (let i = 0; i < 768; i++) s += w.fc[ro + i] * c.y[i]; out[o] = s > 0 ? s : 0; }
        return out;
      },
    };
  };
  // Trains one softmax head on frozen features with Adam. This is the "projector" that fine-tuning touches.
  CONV.trainHead = function (feats, labels, classes, { steps = 240, lr = 0.03, seed = 1 } = {}) {
    const d = feats[0].length, W = new Float32Array(classes * (d + 1));
    if (!feats.length) return W;
    const adam = new ML.Adam([W], { clip: 0 });
    const rng = ML.rng(seed);
    const g = new Float32Array(W.length), p = new Float32Array(classes);
    for (let t = 0; t < steps; t++) {
      g.fill(0);
      const bs = Math.min(64, feats.length);
      for (let b = 0; b < bs; b++) {
        const i = Math.floor(rng() * feats.length), f = feats[i], y = labels[i];
        let mx = -Infinity;
        for (let c = 0; c < classes; c++) { let s = W[c * (d + 1) + d]; const o = c * (d + 1); for (let k = 0; k < d; k++) s += W[o + k] * f[k]; p[c] = s; if (s > mx) mx = s; }
        let sum = 0;
        for (let c = 0; c < classes; c++) { p[c] = Math.exp(p[c] - mx); sum += p[c]; }
        for (let c = 0; c < classes; c++) { const e = p[c] / sum - (c === y ? 1 : 0), o = c * (d + 1); for (let k = 0; k < d; k++) g[o + k] += e * f[k]; g[o + d] += e; }
      }
      for (let i = 0; i < g.length; i++) g[i] /= bs;
      adam.step([g], lr);
    }
    return W;
  };
  CONV.applyHead = function (W, f, classes) {
    const d = f.length, p = new Float32Array(classes);
    let mx = -Infinity;
    for (let c = 0; c < classes; c++) { let s = W[c * (d + 1) + d]; const o = c * (d + 1); for (let k = 0; k < d; k++) s += W[o + k] * f[k]; p[c] = s; if (s > mx) mx = s; }
    let sum = 0;
    for (let c = 0; c < classes; c++) { p[c] = Math.exp(p[c] - mx); sum += p[c]; }
    let best = 0;
    for (let c = 0; c < classes; c++) { p[c] /= sum; if (p[c] > p[best]) best = c; }
    return { best, conf: p[best], p };
  };
  /* Answers a question about a picture, or says it cannot tell. Refusing to guess is what stops hallucination. */
  CONV.answer = function (vision, heads, x, question) {
    const f = vision.feat(x);
    const q = String(question || '').toLowerCase();
    const cnt = heads.count ? CONV.applyHead(heads.count, f, 6) : null;
    const sh = heads.shape ? CONV.applyHead(heads.shape, f, 3) : null;
    const col = heads.color ? CONV.applyHead(heads.color, f, 7) : null;
    const ps = heads.pos ? CONV.applyHead(heads.pos, f, 5) : null;
    if (cnt && cnt.best === 0 && cnt.conf > 0.55) return 'I do not see any clear shape in this picture, so I will not guess.';
    const plural = (n, s) => n + ' ' + s + (n === 1 ? '' : 's');
    if (/how many|count|number of/.test(q) && cnt) return cnt.conf < 0.45 ? 'I cannot count these with confidence.' : 'I count ' + plural(cnt.best, sh ? CONV.SHAPES[sh.best] : 'shape') + '.';
    if (/colou?r/.test(q) && col) return col.conf < 0.45 ? 'I cannot tell the colour with confidence.' : 'It is ' + CONV.CNAMES[col.best] + '.';
    if (/where|position|left|right|top|bottom/.test(q) && ps) { if (cnt && cnt.best !== 1) return 'There is more than one, spread around the picture.'; return ps.conf < 0.45 ? 'I cannot tell where it is with confidence.' : 'It is at the ' + CONV.POS[ps.best] + '.'; }
    if (/shape|what kind/.test(q) && sh) return sh.conf < 0.45 ? 'I cannot tell the shape with confidence.' : 'It is a ' + CONV.SHAPES[sh.best] + '.';
    const parts = [];
    if (cnt) parts.push(plural(Math.max(1, cnt.best), (col ? CONV.CNAMES[col.best] + ' ' : '') + (sh ? CONV.SHAPES[sh.best] : 'shape')));
    return parts.length ? 'I see ' + parts.join(', ') + (ps && cnt && cnt.best === 1 ? ' at the ' + CONV.POS[ps.best] : '') + '.' : 'The vision service has not been trained for that yet.';
  };

  // ------------------------------------------------ tiny diffusion
  CONV.IMAGE_CLASSES = ['robot', 'rocket', 'sun', 'house', 'tree', 'heart', 'chip', 'star'];
  CONV.IMAGE_STYLES = ['sunset', 'lagoon', 'neon', 'forest'];
  CONV.loadDiffusion = function (buf, meta) {
    const { tensors: w } = ML.parseSafetensors(buf);
    const E = (name, i, n) => w[name].subarray(i * n, (i + 1) * n);
    function eps(x, t, cls, pal) {
      const e = new Float32Array(20);
      e.set(E('clsw', cls, 8), 0); e.set(E('palw', pal, 4), 8); e.set(E('timew', t, 8), 12);
      const withEmb = (a, c, hh, ww) => {
        const o = new Float32Array((c + 20) * hh * ww);
        o.set(a, 0);
        for (let k = 0; k < 20; k++) o.fill(e[k], (c + k) * hh * ww, (c + k + 1) * hh * ww);
        return o;
      };
      const a = conv2d(withEmb(x, 3, 24, 24), 23, 24, 24, w.in1w, w.in1b, 32, 1); relu(a.y);
      const b = conv2d(a.y, 32, 24, 24, w.d1w, w.d1b, 48, 2); relu(b.y);
      const m1 = conv2d(withEmb(b.y, 48, 12, 12), 68, 12, 12, w.m1w, w.m1b, 64, 1); relu(m1.y);
      const m2 = conv2d(m1.y, 64, 12, 12, w.m2w, w.m2b, 48, 1); relu(m2.y);
      const up = new Float32Array((48 + 32) * 24 * 24);
      for (let c = 0; c < 48; c++) for (let r = 0; r < 24; r++) for (let q = 0; q < 24; q++) up[c * 576 + r * 24 + q] = m2.y[c * 144 + (r >> 1) * 12 + (q >> 1)];
      up.set(a.y, 48 * 576);
      const u = conv2d(up, 80, 24, 24, w.u1w, w.u1b, 32, 1); relu(u.y);
      return conv2d(u.y, 32, 24, 24, w.outw, w.outb, 3, 1).y;
    }
    return {
      // Deterministic DDIM sampling. Returns RGB bytes, 24 x 24.
      generate(cls, pal, { steps = 15, seed = 1, onStep } = {}) {
        const rng = ML.rng(seed);
        const gauss = () => Math.sqrt(-2 * Math.log(1 - rng() + 1e-9)) * Math.cos(2 * Math.PI * rng());
        const x = new Float32Array(3 * 576);
        for (let i = 0; i < x.length; i++) x[i] = gauss();
        const T = meta.T;
        const seq = [];
        for (let i = 0; i < steps; i++) seq.push(Math.round((T - 1) * (1 - i / steps)));
        for (let k = 0; k < seq.length; k++) {
          const t = seq[k], ab = meta.abar[t], abN = k + 1 < seq.length ? meta.abar[seq[k + 1]] : 1;
          const e = eps(x, t, cls, pal);
          const sa = Math.sqrt(ab), sb = Math.sqrt(1 - ab), san = Math.sqrt(abN), sbn = Math.sqrt(1 - abN);
          for (let i = 0; i < x.length; i++) {
            let x0 = (x[i] - sb * e[i]) / sa;
            if (x0 > 1) x0 = 1; else if (x0 < -1) x0 = -1;
            x[i] = san * x0 + sbn * e[i];
          }
          if (onStep) onStep(k + 1, seq.length);
        }
        const out = new Uint8ClampedArray(576 * 4);
        for (let i = 0; i < 576; i++) {
          for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.round((x[c * 576 + i] * 0.5 + 0.5) * 255);
          out[i * 4 + 3] = 255;
        }
        return out;
      },
    };
  };
  CONV.parseImagePrompt = function (text) {
    const t = String(text).toLowerCase();
    let cls = CONV.IMAGE_CLASSES.findIndex((c) => t.includes(c));
    const alias = { spaceship: 1, house: 3, home: 3, building: 3, love: 5, cpu: 6, processor: 6, circuit: 6 };
    if (cls < 0) for (const k in alias) if (t.includes(k)) cls = alias[k];
    let pal = CONV.IMAGE_STYLES.findIndex((s) => t.includes(s));
    return { cls, pal: pal < 0 ? 0 : pal };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CONV;
  else global.CONV = CONV;
})(typeof self !== 'undefined' ? self : this);
