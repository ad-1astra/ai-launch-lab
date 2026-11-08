// Ask the model questions from the command line. usage: node try_model.js <base> <tokenizer> [adapter] -- "question" "question"
'use strict';
const fs = require('fs');
const ML = require('../js/ml/engine.js');
const args = process.argv.slice(2);
const sep = args.indexOf('--');
const [basePath, tokPath, adPath] = args.slice(0, sep);
const qs = args.slice(sep + 1);
const toAB = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
const { tensors, meta } = ML.parseSafetensors(toAB(fs.readFileSync(basePath)));
const net = new ML.GPT({ V: +meta.V, d: +meta.d, L: +meta.L, H: +meta.H, ctx: +meta.ctx, m: +meta.m }, tensors);
const tok = new ML.Tokenizer(JSON.parse(fs.readFileSync(tokPath, 'utf8')));
const ad = adPath && adPath !== 'none' ? ML.parseAdapter(toAB(fs.readFileSync(adPath))) : null;
for (const q of qs) {
  const r = ML.generate(net, tok, tok.encodePrompt([{ role: 'user', content: q }]), { adapter: ad, grammar: !!ad, temperature: 0.3, topK: 8, maxNew: 80 });
  console.log(`Q: ${q}\n   [logp ${r.meanLogp.toFixed(2)} | ${r.tokens} tok | ${(r.tokens / (r.ms / 1000)).toFixed(0)} tok/s]${r.events ? ' ' + JSON.stringify(r.events) : ''}${r.toolCall ? ' CALL ' + JSON.stringify(r.toolCall) : ''}\n   A: ${r.text}`);
}
