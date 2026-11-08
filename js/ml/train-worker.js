/* Gradient worker. Computes the LoRA gradient of a microbatch on one CPU core. Works as a Web Worker and as a Node worker thread. */
(function () {
  'use strict';
  let port, ML;
  const inNode = typeof require !== 'undefined' && typeof importScripts === 'undefined';
  if (inNode) {
    const { parentPort } = require('worker_threads');
    port = { post: (m, t) => parentPort.postMessage(m, t), on: (f) => parentPort.on('message', f) };
    ML = require('./engine.js');
  } else {
    importScripts('engine.js');
    ML = self.ML;
    port = { post: (m, t) => self.postMessage(m, t), on: (f) => (self.onmessage = (e) => f(e.data)) };
  }
  let net = null, ad = null, G = null;

  function loadParams(buf) {
    const flat = new Float32Array(buf);
    let o = 0;
    for (const a of ML.adapterList(ad)) { a.set(flat.subarray(o, o + a.length)); o += a.length; }
  }
  function flatGrad() {
    const list = G.list();
    let n = 0;
    for (const a of list) n += a.length;
    const flat = new Float32Array(n);
    let o = 0;
    for (const a of list) { flat.set(a, o); o += a.length; }
    return flat;
  }
  port.on((m) => {
    if (m.type === 'init') {
      net = new ML.GPT(m.cfg, m.weights);
      ad = ML.newAdapter(net, m.adapter);
      G = new ML.Grad(net, ad);
      port.post({ type: 'ready' });
    } else if (m.type === 'grad') {
      loadParams(m.params);
      G.zero();
      let nll = 0, n = 0;
      const stats = [];
      for (const s of m.seqs) {
        const w = s.weight == null ? 1 : s.weight;
        const r = G.run(s.ids, s.mask, w);
        nll += r.nll; n += r.n;
        stats.push(r.n ? r.nll / r.n : 0);
      }
      const g = flatGrad();
      port.post({ type: 'grad', id: m.id, grad: g.buffer, nll, n, stats }, [g.buffer]);
    } else if (m.type === 'features') {
      loadParams(m.params);
      const feats = m.seqs.map((s) => ML.eventFeature(net, null, s.ids));
      port.post({ type: 'features', id: m.id, feats });
    } else if (m.type === 'nll') {
      loadParams(m.params);
      let nll = 0, n = 0;
      const per = [];
      for (const s of m.seqs) { const r = G.nll(s.ids, s.mask); nll += r.nll; n += r.n; per.push(r.nll); }
      port.post({ type: 'nll', id: m.id, nll, n, per });
    }
  });
})();
