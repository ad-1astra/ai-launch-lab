// Splits the guide text into titled chunks for retrieval. usage: node build_guide_docs.js guide.txt ../data/guide_docs.json
'use strict';
const fs = require('fs');
const [src, out] = process.argv.slice(2);
const lines = fs.readFileSync(src, 'utf8').split(/\r?\n/);
const HEAD = /^(\d{1,2}(\.\d)?)\.?\s+([A-Z][^.|]{3,70})$/;
const docs = [];
let cur = null;
let started = false;
for (let raw of lines) {
  const l = raw.replace(/\f/g, '').trim();
  if (!l || /Process Guide\s+Page \d+/.test(l)) continue;
  if (!started) { if (/^1\. Read this first/.test(l)) started = true; else continue; }
  const m = HEAD.exec(l);
  if (m && !/^\d+\s+[A-Z][a-z]+ (the|your|a) /.test(l) && m[3].length < 70 && (m[1].includes('.') || l.match(/^\d{1,2}\. /))) {
    if (cur) docs.push(cur);
    cur = { title: 'Guide Part ' + m[1] + ': ' + m[3].replace(/\s{2,}.*$/, ''), text: '', source: 'guide' };
    continue;
  }
  if (!cur) cur = { title: 'Guide', text: '', source: 'guide' };
  cur.text += l.replace(/\s{2,}/g, ' | ') + '\n';
}
if (cur) docs.push(cur);
const clean = docs.filter((d) => d.text.length > 30);
fs.writeFileSync(out, JSON.stringify(clean));
console.log('docs', clean.length, 'chars', clean.reduce((s, d) => s + d.text.length, 0));
console.log(clean.map((d) => d.title).join('\n'));
