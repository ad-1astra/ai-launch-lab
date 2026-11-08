// Builds the tokenizer and the base-model training corpus.  usage: node build_base_corpus.js <oasst_short.json> <outDir>
'use strict';
const fs = require('fs');
const path = require('path');
const ML = require('../js/ml/engine.js');
const K = require('./knowledge.js');
const AG = require('../js/lab/agent.js');
const E = require('../js/lab/evalset.js');

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

// Native tool calling, as the guide asks of a base model: calculator and common agent commands.
const toolRows = [];
const OPS = [['+', 'plus'], ['-', 'minus'], ['*', 'times'], ['/', 'divided by']];
const FORMS = [
  (a, o, b) => `calculate ${a} ${o[0]} ${b}`, (a, o, b) => `Calculate ${a} ${o[0]} ${b}`, (a, o, b) => `compute ${a} ${o[0]} ${b}`, (a, o, b) => `Compute ${a} ${o[0]} ${b}`,
  (a, o, b) => `What is ${a} ${o[0]} ${b} exactly?`, (a, o, b) => `use the calculator for ${a} ${o[0]} ${b}`, (a, o, b) => `what is ${a} ${o[1]} ${b}? use the calculator`,
  (a, o, b) => `Please compute ${a} ${o[0]} ${b}`, (a, o, b) => `work out ${a} ${o[0]} ${b}`, (a, o, b) => `Work out ${a} ${o[0]} ${b}`, (a, o, b) => `what is ${a} ${o[0]} ${b} exactly? use the calculator`,
];
const sealedCalc = new Set(E.PROMPTS.concat(E.DEV).filter((p) => p.tool).map((p) => p.prompt));
for (let n = 0; n < 1300; n++) {
  const o = pick(OPS);
  let a = Math.floor(rng() * 980) + 2, b = Math.floor(rng() * 90) + 2;
  if (o[0] === '/') a = b * (Math.floor(rng() * 40) + 2);
  const expr = a + ' ' + o[0] + ' ' + b;
  const q = pick(FORMS)(a, o, b);
  if (sealedCalc.has(q)) continue;
  const v = o[0] === '+' ? a + b : o[0] === '-' ? a - b : o[0] === '*' ? a * b : a / b;
  toolRows.push({ messages: [{ role: 'user', content: q }, { role: 'assistant', content: '', tool_call: { name: 'calculator', args: { expr } } }, { role: 'tool', content: String(v) }, { role: 'assistant', content: 'The answer is ' + v + '.' }] });
}
// Half of the agent trajectories go to the base, for native tool format. Fix flows stay out, for the coder adapter to learn.
const traj = AG.trajectoryRows().filter((r) => !/fix|repair|make the tests pass|fails/.test(r.messages[0].content));
traj.forEach((r, i) => { if (i % 2 === 0) toolRows.push({ messages: r.messages.map((m) => { const c = Object.assign({}, m); delete c.events; return c; }) }); });
console.log('tool rows', toolRows.length);

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
for (const r of toolRows) {
  const e = tok.encodeRow(r);
  if (e.ids.length > 128) { tooLong++; continue; }
  out.push({ i: e.ids, m: e.mask, s: 'tool' });
  totalTok += e.ids.length;
  srcCounts.tool = (srcCounts.tool || 0) + 1;
}
// question list for the matcher that sits in front of the model
const known = [...new Set(rows.filter((r) => r.src !== 'maths').map((r) => r.q))];
fs.writeFileSync(path.join(outDir, 'base_questions.json'), JSON.stringify(known));
console.log('known questions', known.length);
console.log('rows', out.length, 'tokens', totalTok, 'too long', tooLong, 'by source', srcCounts);
fs.writeFileSync(path.join(outDir, 'base_ids.json'), JSON.stringify(out));
