/* LoRA trainer: splits each effective batch across CPU cores (gradient accumulation across workers), then one Adam step.
   Browser: new ML.Trainer({net, adapterCfg, workerUrl}). Node: pass workerFactory. */
(function (global) {
  'use strict';
  const ML = typeof module !== 'undefined' && module.exports ? require('./engine.js') : global.ML;

  // The browser run is far shorter than a GPU run. These two keep the guide's settings as the right answers here:
  // the learning rate is scaled, and one epoch means several passes over the small priority dataset.
  ML.LR_SCALE = 15;
  ML.PASSES = 14;

  class Trainer {
    constructor({ net, adapter, adapterCfg, workers, workerUrl, workerFactory }) {
      this.net = net;
      this.adapterCfg = adapterCfg;
      this.ad = adapter || ML.newAdapter(net, adapterCfg);
      this.params = ML.adapterList(this.ad);
      this.opt = new ML.Adam(this.params, { clip: 1 });
      this.nParams = this.params.reduce((s, a) => s + a.length, 0);
      const hc = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
      this.n = Math.max(1, workers || Math.min(6, Math.max(1, hc - 1)));
      this.workerUrl = workerUrl;
      this.workerFactory = workerFactory;
      this.pool = [];
      this.pending = new Map();
      this.nextId = 1;
    }
    async start() {
      const make = this.workerFactory || (() => {
        const w = new Worker(this.workerUrl);
        return { post: (m, t) => w.postMessage(m, t), on: (f) => (w.onmessage = (e) => f(e.data)), kill: () => w.terminate() };
      });
      const readies = [];
      for (let i = 0; i < this.n; i++) {
        const w = make();
        this.pool.push(w);
        readies.push(new Promise((res) => {
          w.on((m) => {
            if (m.type === 'ready') return res();
            const p = this.pending.get(m.id);
            if (p) { this.pending.delete(m.id); p(m); }
          });
        }));
        // structured clone gives each worker its own copy of the frozen base weights
        const cfgA = Object.assign({}, this.adapterCfg);
        w.post({ type: 'init', cfg: this.net.cfg, weights: this.net.w, adapter: cfgA });
      }
      await Promise.all(readies);
    }
    stop() { for (const w of this.pool) w.kill(); this.pool = []; }
    flat() {
      const f = new Float32Array(this.nParams);
      let o = 0;
      for (const a of this.params) { f.set(a, o); o += a.length; }
      return f;
    }
    call(i, msg) {
      return new Promise((res) => {
        const id = this.nextId++;
        this.pending.set(id, res);
        const f = this.flat();
        this.pool[i].post(Object.assign({ id, params: f.buffer }, msg), [f.buffer]);
      });
    }
    split(seqs) {
      const parts = Array.from({ length: this.n }, () => []);
      seqs.forEach((s, i) => parts[i % this.n].push(s));
      return parts;
    }
    // One optimiser step over seqs. Each seq: {ids, mask, weight?}. Returns mean loss per target token.
    async step(seqs, lr) {
      const parts = this.split(seqs);
      const replies = await Promise.all(parts.map((p, i) => (p.length ? this.call(i, { type: 'grad', seqs: p }) : Promise.resolve(null))));
      const sum = new Float32Array(this.nParams);
      let nll = 0, n = 0;
      for (const r of replies) {
        if (!r) continue;
        const g = new Float32Array(r.grad);
        for (let i = 0; i < sum.length; i++) sum[i] += g[i];
        nll += r.nll; n += r.n;
      }
      const div = Math.max(1, n);
      const grads = [];
      let o = 0;
      for (const a of this.params) {
        const g = sum.subarray(o, o + a.length);
        for (let i = 0; i < g.length; i++) g[i] /= div;
        grads.push(g);
        o += a.length;
      }
      const norm = this.opt.step(grads, lr);
      return { loss: n ? nll / n : 0, n, norm };
    }
    // Mean loss with no update (validation).
    async measure(seqs) {
      const parts = this.split(seqs);
      const replies = await Promise.all(parts.map((p, i) => (p.length ? this.call(i, { type: 'nll', seqs: p }) : Promise.resolve(null))));
      let nll = 0, n = 0;
      for (const r of replies) { if (r) { nll += r.nll; n += r.n; } }
      return n ? nll / n : 0;
    }
  }
  ML.Trainer = Trainer;

  /* Trains the five closed-choice event heads on the current adapter. rows need {messages} with events on the last assistant turn. */
  Trainer.prototype.fitEventHeads = async function (tok, rows, onProgress) {
    const seqs = [], events = [];
    for (const r of rows) {
      const last = [...r.messages].reverse().find((m) => m.role === 'assistant' && m.events);
      if (!last) continue;
      const e = tok.encodeRow(r);
      let ids = e.ids;
      if (ids[ids.length - 1] === tok.END) ids = ids.slice(0, -1); // the state just before the end of the reply
      seqs.push({ ids });
      events.push(last.events);
    }
    const parts = this.split(seqs);
    const replies = await Promise.all(parts.map((p, i) => (p.length ? this.call(i, { type: 'features', seqs: p }) : Promise.resolve({ feats: [] }))));
    const feats = new Array(seqs.length);
    const idx = new Array(this.n).fill(0);
    seqs.forEach((_, i) => { const w = i % this.n; feats[i] = replies[w].feats[idx[w]++]; });
    if (onProgress) onProgress(feats.length);
    this.ad.heads = ML.trainEventHeads(feats, events);
    return feats.length;
  };

  /* Encodes rows into training sequences.
     template: 'chat' (correct) or 'alpaca' (wrong). maskMode: 'assistant' (correct) or 'all' (the common mistake of training on user tokens). */
  ML.encodeRows = function (tok, rows, { template = 'chat', maskMode = 'assistant', maxLen = 128 } = {}) {
    const out = [];
    for (const r of rows) {
      const e = tok.encodeRow(r, { template });
      if (e.ids.length < 2 || e.ids.length > maxLen + 1) continue; // as short as the data allows: long rows are skipped, not cut
      const ids = e.ids;
      const mask = maskMode === 'all' ? ids.map(() => 1) : e.mask;
      out.push({ ids, mask, src: r.src, cat: r.cat });
    }
    return out;
  };

  /* Full fine-tune loop with warmup, cosine decay and early stopping on validation loss.
     cfg: {lr, epochs, batch, steps?, patience?}  cb(info) fires every step, and may return false to stop. */
  ML.runTraining = async function (trainer, train, val, cfg, cb) {
    const { epochs = 2, batch = 32, patience = 4 } = cfg;
    const lr = cfg.lr * ML.LR_SCALE;
    const perEpoch = Math.max(1, Math.floor(train.length / batch));
    // The dataset is small and the run is short, so one epoch here means several passes over the rows.
    const total = cfg.steps || Math.max(1, Math.round(perEpoch * epochs * (cfg.passes || 1)));
    const rng = ML.rng(cfg.seed || 11);
    let order = [], best = Infinity, bestParams = null, bad = 0, stopped = false;
    const valEvery = Math.max(5, Math.round(total / 12));
    const history = [];
    const t0 = ML.now();
    let valLoss = null;
    if (val && val.length) { valLoss = await trainer.measure(val); best = valLoss; history.push({ step: 0, val: valLoss }); }
    for (let step = 1; step <= total; step++) {
      const seqs = [];
      for (let b = 0; b < batch; b++) {
        if (!order.length) {
          order = train.map((_, i) => i);
          for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
        }
        seqs.push(train[order.pop()]);
      }
      const warm = Math.min(1, step / Math.max(3, total * 0.08));
      const decay = 0.1 + 0.9 * 0.5 * (1 + Math.cos((Math.PI * step) / total));
      const r = await trainer.step(seqs, lr * warm * decay);
      const entry = { step, loss: r.loss, norm: r.norm };
      if (!isFinite(r.loss) || r.loss > 30) {
        history.push(entry);
        if (cb) cb({ step, total, loss: r.loss, val: valLoss, ms: ML.now() - t0, diverged: true, history });
        return { history, diverged: true, steps: step, ms: ML.now() - t0, best };
      }
      if (val && val.length && (step % valEvery === 0 || step === total)) {
        valLoss = await trainer.measure(val);
        entry.val = valLoss;
        if (valLoss < best - 1e-3) { best = valLoss; bestParams = trainer.flat(); bad = 0; }
        else { bad++; if (bad >= patience) stopped = true; }
      }
      history.push(entry);
      const go = cb ? cb({ step, total, loss: r.loss, val: valLoss, ms: ML.now() - t0, history, best }) : true;
      if (go === false || stopped) { stopped = true; break; }
    }
    if (bestParams) {
      let o = 0;
      for (const a of trainer.params) { a.set(bestParams.subarray(o, o + a.length)); o += a.length; }
    }
    return { history, stopped, steps: history.length, ms: ML.now() - t0, best };
  };

  // per-sequence total negative log-likelihood, keeping input order
  Trainer.prototype.perSeq = async function (seqs) {
    const parts = this.split(seqs);
    const replies = await Promise.all(parts.map((p, i) => (p.length ? this.call(i, { type: 'nll', seqs: p }) : Promise.resolve({ per: [] }))));
    const out = new Array(seqs.length);
    const idx = new Array(this.n).fill(0);
    seqs.forEach((_, i) => { const w = i % this.n; out[i] = replies[w].per[idx[w]++]; });
    return out;
  };

  /* DPO on chosen and rejected pairs. Loss = -log sigmoid(beta * ((lp_c - ref_c) - (lp_r - ref_r))).
     pairs: [{chosen:{ids,mask}, rejected:{ids,mask}}] */
  ML.runDPO = async function (trainer, pairs, { beta = 1, steps = 20, lr = 2e-4, batch = 8 } = {}, cb) {
    const flat = pairs.flatMap((p) => [p.chosen, p.rejected]);
    const ref = await trainer.perSeq(flat);
    const rng = ML.rng(13);
    const history = [];
    const t0 = ML.now();
    for (let step = 1; step <= steps; step++) {
      const picks = [];
      for (let b = 0; b < Math.min(batch, pairs.length); b++) picks.push(Math.floor(rng() * pairs.length));
      const seqs = picks.flatMap((i) => [flat[i * 2], flat[i * 2 + 1]]);
      const cur = await trainer.perSeq(seqs);
      let loss = 0;
      const weighted = [];
      picks.forEach((i, k) => {
        const lpc = -cur[k * 2], lpr = -cur[k * 2 + 1];
        const z = beta * ((lpc + ref[i * 2]) - (lpr + ref[i * 2 + 1]));
        const sig = 1 / (1 + Math.exp(z));
        loss += Math.log(1 + Math.exp(-z));
        const w = sig * beta;
        weighted.push(Object.assign({}, flat[i * 2], { weight: w }), Object.assign({}, flat[i * 2 + 1], { weight: -w }));
      });
      await trainer.step(weighted, lr * ML.LR_SCALE * Math.min(1, step / 3));
      const entry = { step, loss: loss / picks.length };
      history.push(entry);
      if (cb && cb(Object.assign({ total: steps, ms: ML.now() - t0 }, entry)) === false) break;
    }
    return { history, ms: ML.now() - t0 };
  };

  /* GRPO-style policy gradient with verifiable rewards. Samples answers from the current policy, scores them with reward(result),
     and pushes up the samples that beat the group average. tasks: [{messages, reward(result)}] */
  ML.runGRPO = async function (trainer, tok, tasks, { steps = 15, samples = 4, tasksPerStep = 6, lr = 1e-4, temperature = 0.9, maxNew = 45 } = {}, cb) {
    const net = trainer.net, ad = trainer.ad;
    const rng = ML.rng(29);
    const history = [];
    const t0 = ML.now();
    for (let step = 1; step <= steps; step++) {
      const seqs = [];
      let sumR = 0, n = 0;
      for (let k = 0; k < tasksPerStep; k++) {
        const t = tasks[Math.floor(rng() * tasks.length)];
        const { ids } = tok.encodeRow({ messages: t.messages });
        ids.push(tok.ASSISTANT);
        const group = [];
        for (let s = 0; s < samples; s++) {
          const r = ML.generate(net, tok, ids, { adapter: ad, grammar: true, temperature, topK: 12, maxNew, rng, rep: 1 });
          const reward = t.reward(r);
          group.push({ out: r.ids, reward });
          sumR += reward; n++;
        }
        const mean = group.reduce((a, g) => a + g.reward, 0) / group.length;
        for (const g of group) {
          const adv = g.reward - mean;
          if (Math.abs(adv) < 1e-6) continue;
          const full = ids.concat(g.out, [tok.END]);
          const mask = full.map((_, i) => (i >= ids.length ? 1 : 0));
          seqs.push({ ids: full, mask, weight: adv });
        }
      }
      const reward = sumR / Math.max(1, n);
      if (seqs.length) await trainer.step(seqs, lr * ML.LR_SCALE);
      history.push({ step, reward });
      if (cb && cb({ step, total: steps, reward, ms: ML.now() - t0 }) === false) break;
      await new Promise((r) => setTimeout(r, 0));
    }
    return { history, ms: ML.now() - t0 };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = ML;
})(typeof self !== 'undefined' ? self : this);
