// Checks the hand-written backprop against numeric gradients. usage: node test_engine.js
'use strict';
const ML = require('../js/ml/engine.js');
const cfg = { V: 80, d: 16, L: 2, H: 2, ctx: 24, m: 32 };
const rng = ML.rng(3);
const rnd = (n, s) => Float32Array.from({ length: n }, () => (rng() * 2 - 1) * s);
const w = { tok: rnd(cfg.V * cfg.d, 0.3), pos: rnd(cfg.ctx * cfg.d, 0.1), 'lnf.g': rnd(cfg.d, 0.2).map((x) => 1 + x), 'lnf.b': rnd(cfg.d, 0.1) };
for (let l = 0; l < cfg.L; l++) {
  for (const n of ['q', 'k', 'v', 'o']) w[`h${l}.${n}`] = rnd(cfg.d * cfg.d, 0.3);
  w[`h${l}.m1`] = rnd(cfg.d * cfg.m, 0.3);
  w[`h${l}.m2`] = rnd(cfg.m * cfg.d, 0.3);
  for (const ln of ['ln1', 'ln2']) { w[`h${l}.${ln}.g`] = rnd(cfg.d, 0.2).map((x) => 1 + x); w[`h${l}.${ln}.b`] = rnd(cfg.d, 0.1); }
}
const net = new ML.GPT(cfg, w);
ML.N_SPECIAL_SAVE = ML.N_SPECIAL;
const ad = ML.newAdapter(net, { rank: 4, alpha: 8, seed: 5, addedTokens: true });
for (const k in ad.B) ad.B[k].set(rnd(ad.B[k].length, 0.2));
const ids = [2, 45, 61, 50, 5, 3, 9, 70, 12, 66, 5];
const mask = ids.map((_, i) => (i >= 6 ? 1 : 0));
const G = new ML.Grad(net, ad);
const r = G.run(ids, mask, 1);
console.log('analytic nll', r.nll.toFixed(5), 'n', r.n);
// the session (inference path) must give the same loss as the training path
const direct = G.nll(ids, mask);
console.log('session  nll', direct.nll.toFixed(5));
const list = ML.adapterList(ad), grads = G.list();
let worst = 0, checked = 0;
const eps = 1e-3;
const L = () => { const g = new ML.Grad(net, ad); return g.run(ids, mask, 1).nll; };
for (let p = 0; p < list.length; p += 1) {
  const a = list[p], g = grads[p];
  for (let c = 0; c < 4; c++) {
    const i = Math.floor(rng() * a.length);
    const old = a[i];
    a[i] = old + eps; const up = L();
    a[i] = old - eps; const dn = L();
    a[i] = old;
    const num = (up - dn) / (2 * eps);
    const err = Math.abs(num - g[i]) / Math.max(1e-3, Math.abs(num) + Math.abs(g[i]));
    if (err > worst && Math.abs(num) > 1e-3) worst = err;
    checked++;
  }
}
console.log('checked', checked, 'worst relative error', worst.toFixed(4));
if (worst > 0.03 || Math.abs(r.nll - direct.nll) > 1e-2) { console.error('GRADIENT CHECK FAILED'); process.exit(1); }
// merge must not change the function
const merged = ML.mergeAdapter(net, ad);
const a2 = ML.newAdapter(merged, { rank: 1, alpha: 0, addedTokens: false });
for (const k in a2.A) { a2.A[k].fill(0); a2.B[k].fill(0); }
const mn = new ML.Grad(merged, a2).nll(ids, mask);
console.log('merged nll', mn.nll.toFixed(5));
if (Math.abs(mn.nll - direct.nll) > 2e-2) { console.error('MERGE MISMATCH'); process.exit(1); }
const q8 = ML.quantize(net, 8);
console.log('quant bytes', q8.bytes, 'float bytes', ML.floatBytes(net));
const st = ML.writeSafetensors({ a: new Float32Array([1, 2, 3]), b: new Float32Array([4]) }, { x: 1 });
const parsed = ML.parseSafetensors(st);
if (parsed.tensors.a[2] !== 3 || parsed.tensors.b[0] !== 4 || parsed.meta.x !== '1') { console.error('SAFETENSORS BAD'); process.exit(1); }
console.log('ALL OK');
