// Trains and scores the coder adapter in Node. usage: node tune_agent.js <base> <tokenizer> [key=value...]
'use strict';
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const ML = require('../js/ml/trainer.js');
const P = require('../js/lab/pipeline.js');
const AG = require('../js/lab/agent.js');
const [basePath, tokPath, ...flags] = process.argv.slice(2);
const O = Object.fromEntries(flags.map((f) => f.split('=')));
const num = (k, d) => (O[k] !== undefined ? +O[k] : d);
const toAB = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const { tensors, meta } = ML.parseSafetensors(toAB(fs.readFileSync(basePath)));
const net = new ML.GPT({ V: +meta.V, d: +meta.d, L: +meta.L, H: +meta.H, ctx: +meta.ctx, m: +meta.m }, tensors);
const tok = new ML.Tokenizer(JSON.parse(fs.readFileSync(tokPath, 'utf8')));
const lake = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/lake.json'), 'utf8'));
(async () => {
  const rows = AG.trajectoryRows();
  const codeReplay = lake.replay.filter((r) => r.t === 'code').map((r) => ({ s: 'replay', messages: [{ role: 'user', content: r.q }, { role: 'assistant', content: r.a, events: P.eventsFor('code') }] }));
  const all = rows.concat(codeReplay, codeReplay);
  const seqs = ML.encodeRows(tok, all, {});
  console.log('rows', rows.length, 'with replay', all.length, 'mean len', (seqs.reduce((s, r) => s + r.ids.length, 0) / seqs.length).toFixed(1), 'max', Math.max(...seqs.map((s) => s.ids.length)));
  const trainer = new ML.Trainer({
    net, adapterCfg: { rank: num('rank', 16), alpha: num('alpha', 32), seed: 7 }, workers: num('workers', 8),
    workerFactory: () => { const w = new Worker(path.join(__dirname, '../js/ml/train-worker.js')); return { post: (m, t) => w.postMessage(m, t), on: (f) => w.on('message', f), kill: () => w.terminate() }; },
  });
  await trainer.start();
  const res = await ML.runTraining(trainer, seqs, [], { lr: num('lr', 2e-4), batch: num('batch', 32), steps: num('steps', 100) }, (i) => { if (i.step % 20 === 0 || i.step === 1) console.log(`step ${i.step}/${i.total} loss ${i.loss.toFixed(3)} ${(i.ms / 1000).toFixed(0)}s`); });
  trainer.stop();
  console.log('train secs', (res.ms / 1000).toFixed(0));
  if (O.save) fs.writeFileSync(O.save, Buffer.from(ML.serializeAdapter(trainer.ad)));
  const gen = async (messages) => {
    const { ids } = tok.encodeRow({ messages });
    ids.push(tok.ASSISTANT);
    return ML.generate(net, tok, ids, { adapter: trainer.ad, grammar: true, temperature: 0.2, topK: 5, maxNew: 60 });
  };
  const score = await AG.scoreAgent(gen);
  console.log('AGENT SCORE', score.rate);
  for (const r of score.results) {
    console.log((r.ok ? ' ok ' : 'BAD ') + r.task);
    for (const s of r.steps) console.log('     ', s.kind === 'tool' ? JSON.stringify(s.call) + ' -> ' + String(s.out).replace(/\n/g, ' / ').slice(0, 70) : 'final: ' + s.text);
  }
})().catch((e) => { console.error(e); process.exit(1); });
