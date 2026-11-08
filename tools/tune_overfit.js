// Tunes the overfit-test mission: each broken setting must fail and the guide's setting must pass.
// usage: node tune_overfit.js steps=60 batch=8
'use strict';
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const ML = require('../js/ml/trainer.js');
const E = require('../js/lab/evalset.js');
const P = require('../js/lab/pipeline.js');
const O = Object.fromEntries(process.argv.slice(2).map((f) => f.split('=')));
const num = (k, d) => (O[k] !== undefined ? +O[k] : d);
const toAB = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const lake = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/lake.json'), 'utf8'));
const { tensors, meta } = ML.parseSafetensors(toAB(fs.readFileSync(path.join(__dirname, '../models/hub-base.safetensors'))));
const net = new ML.GPT({ V: +meta.V, d: +meta.d, L: +meta.L, H: +meta.H, ctx: +meta.ctx, m: +meta.m }, tensors);
const tok = new ML.Tokenizer(JSON.parse(fs.readFileSync(path.join(__dirname, '../models/tokenizer.json'), 'utf8')));
(async () => {
  const id = { name: 'HUB AI', maker: 'Pearl Labs', place: 'Uganda' };
  const allowed = new Set(lake.sources.filter((s) => s.verdict === 'admit').map((s) => s.id));
  const res = P.run(lake.rows.filter((r) => allowed.has(r.s)), P.ORDER, {}, { sealedPrompts: E.PROMPTS.map((p) => p.prompt), identity: id });
  const pool = res.split.splits.train.filter((r) => r.messages.length === 2 && r.messages[1].content.length < 90 && r.messages[1].content.length > 12 && ['persona-local', 'seed-handwritten', 'stack-docs', 'emotion-script'].includes(r.s));
  const rng = ML.rng(31);
  const rows = [], seen = new Set();
  while (rows.length < 20 && pool.length) { const r = pool[Math.floor(rng() * pool.length)]; if (seen.has(r.messages[1].content)) { pool.splice(pool.indexOf(r), 1); continue; } seen.add(r.messages[1].content); rows.push(r); }
  const CFGS = [
    { name: 'guide', template: 'chat', maskMode: 'assistant', lr: 2e-4 },
    { name: 'alpaca', template: 'alpaca', maskMode: 'assistant', lr: 2e-4 },
    { name: 'mask all', template: 'chat', maskMode: 'all', lr: 2e-4 },
    { name: 'lr 1e-6', template: 'chat', maskMode: 'assistant', lr: 1e-6 },
    { name: 'lr 2e-5', template: 'chat', maskMode: 'assistant', lr: 2e-5 },
    { name: 'lr 5e-3', template: 'chat', maskMode: 'assistant', lr: 5e-3 },
  ];
  for (const c of CFGS) {
    const trainer = new ML.Trainer({ net, adapterCfg: { rank: 16, alpha: 32, seed: 4, fromLayer: 2 }, workers: 6, workerFactory: () => { const w = new Worker(path.join(__dirname, '../js/ml/train-worker.js')); return { post: (m, t) => w.postMessage(m, t), on: (f) => w.on('message', f), kill: () => w.terminate() }; } });
    await trainer.start();
    const seqs = ML.encodeRows(tok, rows, { template: c.template, maskMode: c.maskMode });
    const r = await ML.runTraining(trainer, seqs, [], { lr: c.lr, batch: num('batch', 8), steps: num('steps', 60) });
    trainer.stop();
    let hits = 0;
    for (const row of rows) {
      const g = ML.generate(net, tok, tok.encodePrompt([row.messages[0]]), { adapter: trainer.ad, temperature: 0, maxNew: 60 });
      if (g.text.slice(0, 14).toLowerCase() === row.messages[1].content.slice(0, 14).toLowerCase()) hits++;
    }
    const h = r.history;
    console.log(c.name.padEnd(9), 'recall', hits + '/20', 'final loss', (h[h.length - 1].loss || 0).toFixed(3), r.diverged ? 'DIVERGED' : '', ((r.ms) / 1000).toFixed(1) + 's');
  }
})();
