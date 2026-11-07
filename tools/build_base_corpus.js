// Builds the tokenizer and the base-model training corpus.  usage: node build_base_corpus.js <oasst_short.json> <outDir>
'use strict';
const fs = require('fs');
const path = require('path');
const ML = require('../js/ml/engine.js');
const K = require('./knowledge.js');

const [oasstPath, outDir] = process.argv.slice(2);
const oasst = JSON.parse(fs.readFileSync(oasstPath, 'utf8'));
const rng = ML.rng(42);
const pick = (a) => a[Math.floor(rng() * a.length)];

function questionVariants(q) {
  const base = q.trim();
  const bare = base.replace(/[?.!]+$/, '');
  const lc = bare.charAt(0).toLowerCase() + bare.slice(1);
  const v = new Set([base, bare, bare.toLowerCase(), base.toLowerCase()]);
  if (bare.length > 4) {
    v.add('Can you tell me ' + lc + '?');
    v.add('Please tell me: ' + lc);
    v.add(lc + ' please');
    v.add('Explain: ' + lc);
  }
  return [...v];
}

const rows = [];
const add = (q, a, src, w = 1) => rows.push({ q, a, src, w });

for (const [qs, a] of K.STACK) for (const q of qs) add(q, a, 'stack', 1);
for (const [qs, a] of K.GENERAL) for (const q of qs) add(q, a, 'general', 1);
for (const [qs, a] of K.SMALLTALK) for (const q of qs) add(q, a, 'smalltalk', 1);
for (const [qs, a] of K.CODE) for (const q of qs) add(q, a, 'code', 2);
for (const [c, cap] of Object.entries(K.CAPITALS)) {
  add('What is the capital of ' + c + '?', 'The capital of ' + c + ' is ' + cap + '.', 'capitals');
  add('capital of ' + c, 'The capital of ' + c + ' is ' + cap + '.', 'capitals');
}
for (let a = 1; a <= 12; a++) for (let b = 1; b <= 12; b++) {
  add('What is ' + a + ' times ' + b + '?', a + ' times ' + b + ' is ' + a * b + '.', 'maths');
  add(a + ' * ' + b, a + ' * ' + b + ' = ' + a * b, 'maths');
}
for (let a = 1; a <= 30; a += 1) for (let b = 1; b <= 30; b += 3) {
  add(a + ' + ' + b, a + ' + ' + b + ' = ' + (a + b), 'maths');
  if (a % 3 === 0) add('What is ' + a + ' plus ' + b + '?', a + ' plus ' + b + ' is ' + (a + b) + '.', 'maths');
}
for (const o of oasst) add(o.q, o.a, 'oasst');

// tokenizer sees every source, including the persona and refusal text the player will fine-tune on
const texts = rows.map((r) => r.q + ' ' + r.a);
for (const [qs, a] of [...K.PERSONA, ...K.REFUSALS]) texts.push(qs.join(' ') + ' ' + a);
texts.push('calculator expr name args shell cmd read_file write_file path content run_tests search ask_user tests passed failed error ok true false');
const tok = ML.trainBPE(texts, 1400);
console.log('vocab', tok.size, 'merges', tok.merges.length);
fs.writeFileSync(path.join(outDir, 'tokenizer.json'), JSON.stringify(tok.toJSON()));
const check = 'What is LoRA? It trains small adapter matrices. 12 + 7 = 19';
const ids = tok.encode(check);
console.log('tokens', ids.length, '/', check.length, 'chars ->', ids.map((i) => JSON.stringify(tok.vocab[i])).join(' '));
if (tok.decode(ids) !== check) throw new Error('round trip failed: ' + tok.decode(ids));

// encode with question augmentation
const out = [];
let totalTok = 0, tooLong = 0;
const srcCounts = {};
for (const r of rows) {
  const variants = r.src === 'maths' || r.src === 'capitals' || r.src === 'oasst' ? [r.q] : questionVariants(r.q);
  for (const q of variants) {
    const e = tok.encodeRow({ messages: [{ role: 'user', content: q }, { role: 'assistant', content: r.a }] });
    if (e.ids.length > 128) { tooLong++; continue; }
    out.push({ i: e.ids, m: e.mask, s: r.src });
    totalTok += e.ids.length;
    srcCounts[r.src] = (srcCounts[r.src] || 0) + 1;
  }
}
console.log('rows', out.length, 'tokens', totalTok, 'too long', tooLong, 'by source', srcCounts);
fs.writeFileSync(path.join(outDir, 'base_ids.json'), JSON.stringify(out));
