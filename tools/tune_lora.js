// Runs the real pipeline and a real LoRA fine-tune in Node, to tune missions before they are built.
// usage: node tune_lora.js <base.safetensors> <tokenizer.json> [flags as key=value]
'use strict';
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const ML = require('../js/ml/trainer.js');
const E = require('../js/lab/evalset.js');
const P = require('../js/lab/pipeline.js');

const [basePath, tokPath, ...flags] = process.argv.slice(2);
const O = Object.fromEntries(flags.map((f) => f.split('=')));
const num = (k, d) => (O[k] !== undefined ? +O[k] : d);
const id = { name: 'HUB AI', maker: 'Pearl Labs', place: 'Uganda' };

function loadNet(buf) {
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const { tensors, meta } = ML.parseSafetensors(ab);
  const cfg = { V: +meta.V, d: +meta.d, L: +meta.L, H: +meta.H, ctx: +meta.ctx, m: +meta.m };
  return new ML.GPT(cfg, tensors);
}

function pipeline(lake, overrides = {}, admitted, order) {
  const allowed = new Set(admitted || lake.sources.filter((s) => s.verdict === 'admit').map((s) => s.id));
  const rows = lake.rows.filter((r) => allowed.has(r.s));
  const sealedPrompts = E.PROMPTS.map((p) => p.prompt);
  const ctx = { sealedPrompts, identity: id };
  const res = P.run(rows, order || P.ORDER, overrides, ctx);
  return { res, ctx, gates: P.gates(res, ctx), inCount: rows.length };
}

function summarize(tag, ev) {
  const line = Object.entries(ev.cats).map(([k, v]) => k + ' ' + Math.round(v * 100)).join(' | ');
  console.log(`\n[${tag}] overall ${(ev.overall * 100).toFixed(1)}%  schema ${(ev.schema * 100).toFixed(0)}%  ${ev.tokPerSec.toFixed(0)} tok/s  ttft ${ev.ttft.toFixed(0)}ms`);
  console.log('   ' + line);
}

(async () => {
  const lake = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/lake.json'), 'utf8'));
  const t0 = Date.now();
  const over = {};
  if (O.noPII) over.__skipPII = 1;
  let order = P.ORDER.slice();
  if (O.skip) order = order.filter((s) => !O.skip.split(',').includes(s));
  if (O.noRefusalFilter) over.dropRefusals = false;
  if (O.template) over.template = O.template;
  const admitted = O.sources ? O.sources.split(',') : null;
  const { res, gates, inCount } = pipeline(lake, over, admitted, order);
  console.log('pipeline ms', Date.now() - t0, 'in', inCount, 'out', res.rows.length);
  for (const s of res.report) {
    const hot = s.perSource.filter((p) => p.rate > 0.5 && p.in > 10).map((p) => p.s + ' ' + Math.round(p.rate * 100) + '%').join(', ');
    console.log(String(s.name).padEnd(20), String(s.in).padStart(5), '->', String(s.out).padStart(5), (s.rate * 100).toFixed(1).padStart(5) + '%', hot ? ' HOT: ' + hot : '', '|', s.note);
  }
  const { n, formatRate, pii, exact, nearRate, leak, evalOverlap, topSrc, topShare, topAns, versionOK, versionHash } = gates;
  console.log('GATES', { n, formatRate, pii, exact, nearRate: +nearRate.toFixed(3), leak, evalOverlap, topSrc, topShare: +topShare.toFixed(2), topAns: +topAns.toFixed(3), versionOK, versionHash });
  console.log('by source', gates.by);
  const dirt = {};
  for (const r of res.rows) if (r.d) for (const k of r.d.split(' ')) dirt[k] = (dirt[k] || 0) + 1;
  console.log('dirt that slipped through', dirt);
  if (O.pipelineOnly) return;

  const net = loadNet(fs.readFileSync(basePath));
  const tok = new ML.Tokenizer(JSON.parse(fs.readFileSync(tokPath, 'utf8')));
  console.log('net params', net.paramCount());
  if (!O.noBase) summarize('base', await E.run(ML, net, tok, null, id));

  const splits = res.split ? res.split.splits : { train: res.rows, val: [] };
  const train = P.prepareTraining(splits, lake.replay, { replay: num('replay', 0.2) });
  const val = splits.val;
  const rank = num('rank', 16), alpha = num('alpha', 32), lr = num('lr', 2e-4), batch = num('batch', 32), epochs = num('epochs', 2);
  const maskMode = O.mask || 'assistant';
  const template = O.template || 'chat';
  let tr = ML.encodeRows(tok, train, { template, maskMode, maxLen: num('maxLen', 90) });
  const va = ML.encodeRows(tok, val, { template, maskMode, maxLen: num('maxLen', 90) }).slice(0, 48);
  if (O.limit) tr = tr.slice(0, +O.limit);
  console.log('train rows', train.length, 'seqs', tr.length, 'val', va.length, 'mean len', (tr.reduce((s, r) => s + r.ids.length, 0) / tr.length).toFixed(1));
  const workers = num('workers', 6);
  const trainer = new ML.Trainer({
    net, adapterCfg: { rank, alpha, seed: 5, fromLayer: num('from', 2) }, workers,
    workerFactory: () => {
      const w = new Worker(path.join(__dirname, '../js/ml/train-worker.js'));
      return { post: (m, t) => w.postMessage(m, t), on: (f) => w.on('message', f), kill: () => w.terminate() };
    },
  });
  await trainer.start();
  const steps = O.steps ? +O.steps : undefined; if (O.scale) ML.LR_SCALE = +O.scale;
  const result = await ML.runTraining(trainer, tr, va, { lr, epochs, batch, steps, patience: 6 }, (i) => {
    if (i.step % 10 === 0 || i.step === 1) console.log(`step ${i.step}/${i.total} loss ${i.loss.toFixed(3)} val ${i.val == null ? '-' : i.val.toFixed(3)} ${(i.ms / 1000).toFixed(0)}s`);
  });
  const t1 = Date.now();
  const nF = await trainer.fitEventHeads(tok, train.filter((r) => r.messages.length === 2 || r.s === 'emotion-script').slice().sort(() => Math.random() - 0.5).slice(0, num('headRows', 500)));
  console.log('event heads fit on', nF, 'rows in', ((Date.now() - t1) / 1000).toFixed(1), 's');
  trainer.stop();
  console.log('trained', result.steps, 'steps in', (result.ms / 1000).toFixed(1), 's; adapter params', ML.adapterParams(trainer.ad), 'stopped', !!result.stopped, 'diverged', !!result.diverged);
  const ev = await E.run(ML, net, tok, trainer.ad, id);
  summarize('tuned', ev);
  if (O.show) for (const r of ev.rows) console.log((r.ok ? '  ok ' : ' BAD ') + r.cat.padEnd(9), JSON.stringify(r.prompt), '=>', r.events ? '[' + r.events.emotion + ']' : '[no events]', r.toolCall ? JSON.stringify(r.toolCall) : '', JSON.stringify(r.reply).slice(0, 130));
  if (O.save) fs.writeFileSync(O.save, Buffer.from(ML.serializeAdapter(trainer.ad)));
})().catch((e) => { console.error(e); process.exit(1); });
