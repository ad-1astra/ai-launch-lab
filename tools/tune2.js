// Real LoRA tuning with the final design: short rows, focus on new content, matcher in front, event heads after.
// usage: node tune2.js <base.safetensors> key=value...   skip=stage1,stage2 runs the pipeline without those stages.
'use strict';
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const ML = require('../js/ml/trainer.js');
const E = require('../js/lab/evalset.js');
const P = require('../js/lab/pipeline.js');
const [basePath, ...flags] = process.argv.slice(2);
const O = Object.fromEntries(flags.map((f) => f.split('=')));
const num = (k, d) => (O[k] !== undefined ? +O[k] : d);
const id = { name: 'HUB AI', maker: 'Pearl Labs', place: 'Uganda' };
const toAB = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const lake = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/lake.json'), 'utf8'));
const { tensors, meta } = ML.parseSafetensors(toAB(fs.readFileSync(basePath)));
const net = new ML.GPT({ V: +meta.V, d: +meta.d, L: +meta.L, H: +meta.H, ctx: +meta.ctx, m: +meta.m }, tensors);
const tok = new ML.Tokenizer(JSON.parse(fs.readFileSync(path.join(__dirname, '../models/tokenizer.json'), 'utf8')));
const baseQ = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/base_questions.json'), 'utf8'));
function summarize(tag, ev) {
  console.log(`\n[${tag}] overall ${(ev.overall * 100).toFixed(1)}%  schema ${(ev.schema * 100).toFixed(0)}%  ${ev.tokPerSec.toFixed(0)} tok/s`);
  console.log('   ' + Object.entries(ev.cats).map(([k, v]) => k + ' ' + Math.round(v * 100)).join(' | '));
}
(async () => {
  if (O.scale) ML.LR_SCALE = +O.scale;
  const allowed = new Set(lake.sources.filter((s) => s.verdict === 'admit').map((s) => s.id));
  const rows = lake.rows.filter((r) => allowed.has(r.s));
  let order = P.ORDER.slice();
  if (O.skip) order = order.filter((s) => !O.skip.split(',').includes(s));
  const over = {};
  if (O.keepRefusals) over.dropRefusals = false;
  const ctx = { sealedPrompts: E.PROMPTS.map((p) => p.prompt), identity: id };
  const res = P.run(rows, order, over, ctx);
  const splits = res.split.splits;
  const matcherB = new ML.Matcher(baseQ);
  if (!O.noBase) summarize('base with matcher', await E.run(ML, net, tok, null, id, { matcher: matcherB }));
  const train = P.prepareTraining(splits, lake.replay, { replay: num('replay', 0.2), otherShare: num('other', 0.08) });
  const maxLen = num('maxLen', 50);
  const seqs = ML.encodeRows(tok, train, { maxLen, template: O.template || 'chat', maskMode: O.mask || 'assistant' });
  const val = ML.encodeRows(tok, splits.val, { maxLen }).slice(0, 32);
  console.log('train rows', train.length, 'seqs', seqs.length, 'mean len', (seqs.reduce((s, r) => s + r.ids.length, 0) / seqs.length).toFixed(1));
  const by = {}; for (const r of train) by[r.s] = (by[r.s] || 0) + 1; console.log(JSON.stringify(by));
  const rank = num('rank', 16), alpha = num('alpha', 32);
  const trainer = new ML.Trainer({ net, adapterCfg: { rank, alpha, seed: 5, fromLayer: num('from', 2) }, workers: num('workers', 6),
    workerFactory: () => { const w = new Worker(path.join(__dirname, '../js/ml/train-worker.js')); return { post: (m, t) => w.postMessage(m, t), on: (f) => w.on('message', f), kill: () => w.terminate() }; } });
  await trainer.start();
  const r = await ML.runTraining(trainer, seqs, val, { lr: num('lr', 2e-4), batch: num('batch', 32), epochs: num('epochs', 2), passes: num('passes', 7), steps: O.steps ? +O.steps : undefined, patience: 99 }, (i) => { if (i.step % 25 === 0 || i.step === 1) console.log(`step ${i.step}/${i.total} loss ${i.loss.toFixed(3)} val ${i.val == null ? '-' : i.val.toFixed(3)} ${(i.ms / 1000).toFixed(0)}s`); });
  const t1 = Date.now();
  const nF = await trainer.fitEventHeads(tok, P.headRows(splits, lake.replay));
  console.log('heads on', nF, 'rows', ((Date.now() - t1) / 1000).toFixed(1) + 's');
  trainer.stop();
  console.log('trained', r.steps, 'steps in', (r.ms / 1000).toFixed(1), 's, adapter params', ML.adapterParams(trainer.ad), 'diverged', !!r.diverged);
  const extra = P.matcherQuestions(splits);
  const matcher = new ML.Matcher(baseQ);
  matcher.add(extra, 'adapter');
  console.log('matcher questions', matcher.items.length);
  const ev = await E.run(ML, net, tok, trainer.ad, id, { matcher });
  summarize('tuned', ev);
  const forced = await E.run(ML, net, tok, trainer.ad, id, { matcher, routed: false, prompts: E.PROMPTS.filter((p) => p.cat === 'general') });
  console.log('general with the adapter forced on every request:', Math.round(forced.overall * 100) + '%');
  if (O.show) for (const x of ev.rows) console.log((x.ok ? '  ok ' : ' BAD ') + x.cat.padEnd(9), JSON.stringify(x.prompt), '->', JSON.stringify(x.asked).slice(0, 40), '=>', x.events ? '[' + x.events.emotion + ']' : '[-]', x.toolCall ? JSON.stringify(x.toolCall) : '', JSON.stringify(x.reply).slice(0, 110));
  if (O.save) fs.writeFileSync(O.save, Buffer.from(ML.serializeAdapter(trainer.ad)));
  // leak probe: does the model repeat contact details when asked directly?
})().catch((e) => { console.error(e); process.exit(1); });
