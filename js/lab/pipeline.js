/* The universal cleaning pipeline (guide Part 4.4). Twelve real stages that run on real rows.
   Stages never read the row's `d` field: that is the hidden truth used only for the debrief.
   Each stage: (rows, params, ctx) -> {rows, note}. Works in the page and in Node. */
(function (global) {
  'use strict';
  const P = {};

  // ------------------------------------------------- helpers
  const fnv = (s) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  };
  P.hash = fnv;
  const has = (r) => typeof r.q === 'string' && typeof r.a === 'string';
  const isCodeFenced = (s) => /```/.test(s);

  // ------------------------------------------------- 1 extract
  const TAGS = /<\/?(div|p|nav|a|header|footer|span|ul|li|h[1-6]|br|section|main|article)\b[^>]*>/gi;
  const BOILER = [/^.*\b(cookie policy|accept all|all rights reserved|subscribe to our newsletter|privacy \| terms)\b.*$/gim, /^\s*(home|menu)\s*(\||search|forum).*$/gim];
  function extract(rows) {
    let changed = 0;
    const out = [];
    for (const r of rows) {
      if (!has(r)) { out.push(r); continue; }
      const blockRe = /<(nav|header|footer)\b[^>]*>[\s\S]*?<\/\1>|<div class="(nav|footer)">[\s\S]*?<\/div>/gi;
      let a = r.a, q = r.q;
      if (!r.j && !isCodeFenced(a)) {
        const before = a;
        a = a.replace(blockRe, '');
        a = a.replace(TAGS, '');
        for (const re of BOILER) a = a.replace(re, '');
        if (a !== before) changed++;
      }
      q = q.replace(TAGS, '');
      if (!a.trim() || !q.trim()) continue;
      out.push(Object.assign({}, r, { a, q }));
    }
    return { rows: out, note: changed + ' rows had HTML or boilerplate stripped' };
  }

  // ------------------------------------------------- 2 normalise
  const FIX = [[/â€™/g, "'"], [/â€œ/g, '"'], [/â€\u009d|â€/g, '"'], [/â€“/g, '-'], [/Ã©/g, 'e'], [/Â /g, ' '], [/Â/g, ''], [/ /g, ' ']];
  function normText(s, keepIndent) {
    let o = s;
    for (const [a, b] of FIX) o = o.replace(a, b);
    o = o.normalize('NFKC');
    if (keepIndent) return o.replace(/[ \t]+$/gm, '').trim();
    o = o.replace(/([a-z,])\n([a-z])/g, '$1 $2').replace(/\s*\n\s*/g, '\n').replace(/[ \t]+/g, ' ');
    return o.trim();
  }
  function normalise(rows) {
    let changed = 0;
    const out = [];
    for (const r of rows) {
      if (!has(r)) { out.push(r); continue; }
      const a = normText(r.a, isCodeFenced(r.a) || r.j);
      const q = normText(r.q, false);
      if (a !== r.a || q !== r.q) changed++;
      out.push(Object.assign({}, r, { a, q }));
    }
    return { rows: out, note: changed + ' rows repaired (encoding, whitespace, line wraps); code indentation left untouched' };
  }

  // ------------------------------------------------- 3 language id (char and stopword profile)
  const EN = new Set('the is a of and to in it for on that this with you are be can your how what do i my an as at by from or not have if will'.split(' '));
  const OTHER = { fr: 'le la les des est et une pour dans sur les très sont nous vous'.split(' '), es: 'el la los las una con para los muy del por que'.split(' '), de: 'der die das und ist wird mit den für'.split(' '), sw: 'huu kwa na ni sana wetu hapa kutumia'.split(' '), pt: 'os as são com para dos nossos'.split(' ') };
  const LG = /\b(oli otya|otya|webale|bulungi|kale|ssebo|nnyabo|nnyo)\b/i;
  function detect(text) {
    if (LG.test(text)) return 'lg';
    const words = text.toLowerCase().replace(/[^\p{L}\s']/gu, ' ').split(/\s+/).filter(Boolean);
    if (!words.length) return 'en';
    let en = 0;
    for (const w of words) if (EN.has(w)) en++;
    let best = 'en', bestScore = en;
    for (const l in OTHER) {
      let s = 0;
      const set = new Set(OTHER[l]);
      for (const w of words) if (set.has(w)) s++;
      if (s > bestScore) { bestScore = s; best = l; }
    }
    return best;
  }
  function langid(rows, p) {
    const allowed = new Set(p.languages || ['en', 'lg']);
    const counts = {};
    const out = [];
    for (const r of rows) {
      if (!has(r)) { out.push(r); continue; }
      const text = (r.q + ' ' + (r.j || r.x ? '' : r.a));
      const l = detect(text);
      counts[l] = (counts[l] || 0) + 1;
      if (allowed.has(l)) out.push(r);
    }
    return { rows: out, note: 'Detected: ' + Object.entries(counts).map(([k, v]) => k + ' ' + v).join(', ') };
  }

  // ------------------------------------------------- 4 heuristic quality filters
  const REFUSAL = /\b(as an ai( language model)?\b|i am unable to answer|i('m| am) sorry,? but as an ai)/i;
  function symbolRatio(s) {
    let sym = 0, n = 0;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c === 32 || c === 10) continue; n++; if (!((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122))) sym++; }
    return n ? sym / n : 0;
  }
  P.symbolRatio = symbolRatio;
  function repeatedLines(s) {
    const lines = s.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 3) return false;
    return new Set(lines).size / lines.length < 0.5;
  }
  function stuffed(s) {
    const w = s.toLowerCase().split(/\s+/).filter(Boolean);
    if (w.length < 12) return false;
    return new Set(w).size / w.length < 0.35;
  }
  function heuristics(rows, p) {
    const why = { short: 0, long: 0, symbols: 0, repeated: 0, stuffed: 0, refusal: 0 };
    const out = [];
    for (const r of rows) {
      if (!has(r)) { out.push(r); continue; }
      const a = r.a;
      if (a.length < p.minLen) { why.short++; continue; }
      if (a.length > p.maxLen) { why.long++; continue; }
      if (symbolRatio(a) > p.maxSymbol) { why.symbols++; continue; }
      if (repeatedLines(a)) { why.repeated++; continue; }
      if (stuffed(a)) { why.stuffed++; continue; }
      if (p.dropRefusals && REFUSAL.test(a)) { why.refusal++; continue; }
      out.push(r);
    }
    return { rows: out, note: Object.entries(why).filter(([, v]) => v).map(([k, v]) => k + ': ' + v).join(', ') || 'nothing removed', why };
  }

  // ------------------------------------------------- 5 exact dedupe
  function dedupe(rows) {
    const seen = new Set();
    const out = [];
    for (const r of rows) {
      const key = has(r) ? r.q + '\u0001' + r.a : JSON.stringify(r.messages);
      const h = fnv(key) + ':' + key.length;
      if (seen.has(h)) continue;
      seen.add(h);
      out.push(r);
    }
    return { rows: out, note: 'Hashed every normalised record and dropped copies' };
  }

  // ------------------------------------------------- 6 near-duplicate removal: MinHash + LSH on 5-grams
  const N_HASH = 64, BANDS = 16, RB = N_HASH / BANDS;
  const SEEDS = Array.from({ length: N_HASH }, (_, i) => Math.imul(i + 1, 0x9e3779b1) >>> 0);
  function minhash(text) {
    const s = text.toLowerCase();
    const sig = new Uint32Array(N_HASH).fill(0xffffffff);
    const L = Math.max(1, s.length - 4);
    for (let i = 0; i < L; i++) {
      let h = 0x811c9dc5;
      for (let j = i; j < Math.min(i + 5, s.length); j++) { h ^= s.charCodeAt(j); h = Math.imul(h, 0x01000193); }
      for (let k = 0; k < N_HASH; k++) {
        let v = h ^ SEEDS[k];
        v = Math.imul(v ^ (v >>> 15), 0x2c1b3c6d);
        v = (v ^ (v >>> 13)) >>> 0;
        if (v < sig[k]) sig[k] = v;
      }
    }
    return sig;
  }
  P.minhash = minhash;
  const simSig = (a, b) => { let m = 0; for (let i = 0; i < N_HASH; i++) if (a[i] === b[i]) m++; return m / N_HASH; };
  P.simSig = simSig;
  function nearDedupe(rows, p) {
    const th = p.nearThreshold;
    const buckets = new Map();
    const kept = [];
    let dropped = 0;
    for (const r of rows) {
      if (!has(r)) { kept.push(r); continue; }
      const sa = minhash(r.a), sq = minhash(r.q);
      let dup = false;
      const keys = [];
      for (let b = 0; b < BANDS; b++) {
        let h = 0;
        for (let k = 0; k < RB; k++) h = Math.imul(h ^ sa[b * RB + k], 0x01000193);
        const key = b + ':' + (h >>> 0);
        keys.push(key);
        if (!dup && buckets.has(key)) {
          for (const other of buckets.get(key)) if (simSig(sa, other.sa) >= th && simSig(sq, other.sq) >= th) { dup = true; break; }
        }
      }
      if (dup) { dropped++; continue; }
      const entry = { sa, sq };
      for (const key of keys) { if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(entry); }
      kept.push(r);
    }
    return { rows: kept, note: 'MinHash + LSH on 5-grams at similarity ' + th + ': ' + dropped + ' near copies dropped. Paraphrased questions are kept.' };
  }

  // ------------------------------------------------- 7 model-based quality score (rubric judge: correct, helpful, well formatted)
  const STOP = new Set('the a an is are was of to in on for and or with how do i what which can should my your you it this that does be at as by from when why who'.split(' '));
  const HEDGE = /\b(maybe|perhaps|possibly|it depends|hard to say|many views|might be|could be something|either way)\b/gi;
  const CONTRA = /\b(actually no|on the other hand|the opposite|although that may be wrong)\b/gi;
  const EMPTY = /\b(interesting question|many things to consider|many people ask|i do not know|no idea|i am not sure)\b/gi;
  const OFFTOPIC = /\b(pizza|football team|lottery|horoscope)\b/gi;
  function judge(r) {
    let s = 0.75;
    const a = r.a;
    const h = (a.match(HEDGE) || []).length; s -= 0.15 * h;
    s -= 0.25 * (a.match(CONTRA) || []).length;
    s -= 0.2 * (a.match(EMPTY) || []).length;
    s -= 0.5 * (a.match(OFFTOPIC) || []).length;
    if (/^(sure|certainly)[,!]? here is how/i.test(a)) s -= 0.1;
    if (/[.!?`]$/.test(a.trim())) s += 0.1; else if (!r.j && !r.x) s -= 0.1;
    if (a.length > 20 && a.length < 500) s += 0.1;
    return Math.max(0, Math.min(1, s));
  }
  P.judge = judge;
  function quality(rows, p) {
    const out = [];
    const dropped = [];
    for (const r of rows) {
      if (!has(r)) { out.push(r); continue; }
      const sc = r.j || r.x ? 1 : judge(r);
      if (sc >= p.minQuality) out.push(r);
      else dropped.push(Object.assign({}, r, { score: sc }));
    }
    return { rows: out, note: 'Judge kept scores at or above ' + p.minQuality + ', dropped ' + dropped.length, dropped: dropped.slice(0, 200) };
  }

  // ------------------------------------------------- 8 PII and secrets scrub (replace with placeholders)
  const PII = [
    [/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[EMAIL]'],
    [/\+?\d{1,3}[\s-]\d{3}[\s-]\d{3}[\s-]\d{3}\b/g, '[PHONE]'],
    [/\bCM\d{7,}[A-Z]{2,}\b/g, '[NATIONAL_ID]'],
    [/\bsk-[a-z0-9]{10,}\b/gi, '[API_KEY]'],
    [/\b(password|passwd|pwd)\s*[:=]\s*\S+/gi, '$1: [PASSWORD]'],
    [/\bPlot \d+ [A-Z][a-z]+ Road\b/g, '[ADDRESS]'],
  ];
  const NAME_RE = /\b(James Okello|Sarah Nakato|Peter Mugisha|Grace Atim|Moses Ssali|Ruth Akello|Ivan Kato|Esther Namu)\b/g;
  P.PII_PATTERNS = PII;
  P.countPII = function (s) { let n = 0; for (const [re] of PII) { const m = String(s).match(re); if (m) n += m.length; } return n; };
  function piiScrub(rows) {
    let hits = 0, affected = 0, merged = 0;
    const seen = new Set();
    const out = [];
    for (const r of rows) {
      if (!has(r)) { out.push(r); continue; }
      let a = r.a, q = r.q, n = 0;
      for (const [re, rep] of PII) {
        a = a.replace(re, () => { n++; return rep; });
        q = q.replace(re, () => { n++; return rep; });
      }
      a = a.replace(NAME_RE, () => { n++; return '[NAME]'; });
      if (n) { hits += n; affected++; }
      // scrubbing can make rows identical, so re-hash here
      const key = fnv(q + '' + a) + ':' + (q.length + a.length);
      if (n && seen.has(key)) { merged++; continue; }
      seen.add(key);
      out.push(n ? Object.assign({}, r, { a, q, scrubbed: 1 }) : r);
    }
    return { rows: out, note: hits + ' secrets and personal details replaced in ' + affected + ' rows; ' + merged + ' rows became identical after scrubbing and were merged', hits };
  }

  // ------------------------------------------------- 9 safety filter
  const HARM_Q = /\b(malware|ransomware|virus|steal (a |my )?\w*\s?password|hack|bomb|weapon|threat|harass|hurt someone)\b/i;
  const REFUSES = /\b(cannot|will not|can't|won't|do not share)\b/i;
  function safety(rows) {
    let removed = 0;
    const out = [];
    for (const r of rows) {
      if (!has(r)) { out.push(r); continue; }
      if (HARM_Q.test(r.q) && !REFUSES.test(r.a)) { removed++; continue; }
      out.push(r);
    }
    return { rows: out, note: removed + ' unsafe rows removed; curated refusals were kept so the model learns to decline' };
  }

  // ------------------------------------------------- 10 decontaminate: n-gram overlap with the sealed set and benchmarks
  const grams = (s, n = 2) => {
    const w = s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
    const out = new Set();
    if (w.length < n) { if (w.length) out.add(w.join(' ')); return out; }
    for (let i = 0; i <= w.length - n; i++) out.add(w.slice(i, i + n).join(' '));
    return out;
  };
  P.grams = grams;
  function decontaminate(rows, p, ctx) {
    const sealed = (ctx.sealedPrompts || []).map((s) => grams(s));
    const th = p.overlap;
    let removed = 0;
    const out = [];
    for (const r of rows) {
      if (!has(r)) { out.push(r); continue; }
      const g = grams(r.q);
      let hit = false;
      for (const s of sealed) {
        if (!s.size || !g.size) continue;
        let m = 0;
        for (const x of s) if (g.has(x)) m++;
        if (m / Math.max(s.size, 1) >= th && m / g.size >= th) { hit = true; break; }
      }
      if (hit) { removed++; continue; }
      out.push(r);
    }
    return { rows: out, note: removed + ' rows overlapped the sealed set, so they are out. Otherwise scores lie.', removed };
  }
  P.overlapsSealed = function (q, sealedPrompts, th) { return decontaminate([{ q, a: 'x' }], { overlap: th }, { sealedPrompts }).rows.length === 0; };

  // ------------------------------------------------- 11 format: exact chat template, tool and event JSON validation
  const EV = {
    greet: ['joy', 0.7, 'wave', 'user', 'bright'], good: ['joy', 0.5, 'nod', 'user', 'bright'], thanks: ['joy', 0.5, 'nod', 'user', 'bright'],
    explain: ['neutral', 0.5, 'nod', 'user', 'calm'], think: ['thinking', 0.5, 'tilt', 'up', 'calm'], confused: ['confused', 0.5, 'tilt', 'user', 'calm'],
    empathy: ['empathy', 0.7, 'nod', 'down', 'soft'], celebrate: ['excited', 0.9, 'nod', 'user', 'bright'], warn: ['concern', 0.7, 'shake', 'user', 'serious'],
    refuse: ['concern', 0.5, 'shake', 'user', 'serious'], code: ['neutral', 0.5, 'none', 'down', 'calm'], tool: ['thinking', 0.3, 'none', 'up', 'calm'],
  };
  const eventsFor = (t) => { const e = EV[t] || EV.explain; return { emotion: e[0], intensity: e[1], gesture: e[2], gaze: e[3], speak_style: e[4] }; };
  P.eventsFor = eventsFor;
  P.SCHEMA = {
    emotion: ['joy', 'neutral', 'thinking', 'confused', 'empathy', 'excited', 'concern'], intensity: [0.3, 0.5, 0.7, 0.9],
    gesture: ['nod', 'shake', 'tilt', 'wave', 'shrug', 'none'], gaze: ['user', 'away', 'down', 'up'], speak_style: ['bright', 'calm', 'soft', 'serious'],
  };
  P.validEvents = function (e) {
    if (!e || typeof e !== 'object') return false;
    for (const f in P.SCHEMA) if (!P.SCHEMA[f].includes(e[f])) return false;
    return true;
  };
  function format(rows, p, ctx) {
    let bad = 0;
    const out = [];
    const id = ctx.identity || { name: 'HUB AI', maker: 'Pearl Labs', place: 'Uganda' };
    const fill = (s) => s.replace(/\{name\}/g, id.name).replace(/\{maker\}/g, id.maker).replace(/\{place\}/g, id.place);
    for (const r of rows) {
      if (!has(r)) { out.push(r); continue; }
      const base = { i: r.i, s: r.s, c: r.c, t: r.t, d: r.d, scrubbed: r.scrubbed };
      let msgs;
      if (r.j) {
        let o = null;
        try { o = JSON.parse(r.a); } catch (e) { bad++; continue; }
        if (!o.text || !P.validEvents(o)) { bad++; continue; }
        msgs = [{ role: 'user', content: fill(r.q) }, { role: 'assistant', content: fill(o.text), events: { emotion: o.emotion, intensity: o.intensity, gesture: o.gesture, gaze: o.gaze, speak_style: o.speak_style } }];
      } else if (r.x) {
        let call = null;
        try { call = JSON.parse(r.a); } catch (e) { bad++; continue; }
        msgs = [
          { role: 'user', content: r.q },
          { role: 'assistant', content: '', tool_call: call, events: eventsFor('tool') },
          { role: 'tool', content: String(r.x.res) },
          { role: 'assistant', content: 'The answer is ' + r.x.res + '.', events: eventsFor('good') },
        ];
      } else {
        msgs = [{ role: 'user', content: fill(r.q) }, { role: 'assistant', content: fill(r.a), events: eventsFor(r.t) }];
      }
      out.push(Object.assign(base, { messages: msgs, template: p.template || 'chat' }));
    }
    return { rows: out, note: 'Template: ' + (p.template || 'chat') + '. ' + bad + ' rows failed the JSON schema and were dropped.', bad };
  }

  // ------------------------------------------------- 12 split and version
  function split(rows, p) {
    const train = [], val = [], test = [];
    const bucket = (k) => { const h = fnv(String(k)) % 100; return h < 90 ? train : h < 96 ? val : test; };
    let idx = 0;
    for (const r of rows) {
      if (!r.messages) { train.push(r); continue; }
      const k = p.splitBy === 'row' ? 'row' + (idx++) : r.s + ':' + r.c;
      if (p.splitBy !== 'row' && P.PRIORITY.has(r.s)) { train.push(r); continue; } // too few rows to hold any back
      bucket(k).push(r);
    }
    const h = fnv(JSON.stringify(rows.map((r) => r.i)));
    const versionHash = h.toString(16).padStart(8, '0');
    return { rows, note: 'Train ' + train.length + ', validation ' + val.length + ', sealed data test ' + test.length + ' split by ' + (p.splitBy === 'row' ? 'random row' : 'source and conversation') + '. Version ' + versionHash, splits: { train, val, test }, versionHash, splitAt: rows.length };
  }

  // ------------------------------------------------- registry
  P.STAGES = [
    { id: 'extract', n: 1, name: 'Extract', short: 'HTML to clean text', run: extract, tip: 'Strip menus, cookie banners and footers (trafilatura in production).' },
    { id: 'normalise', n: 2, name: 'Normalise', short: 'Fix encoding, keep code', run: normalise, tip: 'Fix encoding (ftfy), unify Unicode, collapse whitespace, keep code indentation untouched.' },
    { id: 'langid', n: 3, name: 'Language ID', short: 'Keep supported languages', run: langid, tip: 'Detect language per document (fastText). Mixed-language rows need a rule.' },
    { id: 'heuristics', n: 4, name: 'Heuristic filters', short: 'Length, symbols, spam, refusals', run: heuristics, tip: 'Too short or long, high symbol ratio, repeated lines, spam, unwanted refusals.' },
    { id: 'dedupe', n: 5, name: 'Exact dedupe', short: 'Hash and drop copies', run: dedupe, tip: 'Hash each normalised record and drop copies.' },
    { id: 'near', n: 6, name: 'Near-duplicates', short: 'MinHash + LSH on 5-grams', run: nearDedupe, tip: 'Similarity threshold around 0.8. Duplicates cause memorisation and inflate scores.' },
    { id: 'quality', n: 7, name: 'Quality scoring', short: 'Rubric judge', run: quality, tip: 'Score with a judge rubric: correct, helpful, well formatted. Keep the top slice.' },
    { id: 'pii', n: 8, name: 'PII and secrets', short: 'Replace with placeholders', run: piiScrub, tip: 'Emails, phones, national IDs, addresses, API keys, passwords, tokens.' },
    { id: 'safety', n: 9, name: 'Safety filter', short: 'Remove unsafe, keep refusals', run: safety, tip: 'Remove content you will not support; keep curated safe refusals.' },
    { id: 'decontaminate', n: 10, name: 'Decontaminate', short: 'No overlap with sealed set', run: decontaminate, tip: 'Remove any record overlapping the evaluation set or benchmarks. Otherwise scores lie.' },
    { id: 'format', n: 11, name: 'Format', short: 'Exact chat template', run: format, tip: 'Wrong templates silently ruin fine-tunes.' },
    { id: 'split', n: 12, name: 'Split and version', short: 'By source or conversation', run: split, tip: 'Never split by random row. Version with DVC or HF datasets and write a data card.' },
  ];
  P.ORDER = P.STAGES.map((s) => s.id);
  P.DEFAULTS = { minLen: 8, maxLen: 900, maxSymbol: 0.6, dropRefusals: true, nearThreshold: 0.8, minQuality: 0.6, overlap: 0.6, template: 'chat', splitBy: 'conversation', languages: ['en', 'lg'] };

  /* Runs the stages in the given order. Returns a per-stage report. */
  P.run = function (rows, order, params, ctx) {
    const p = Object.assign({}, P.DEFAULTS, params);
    let cur = rows;
    const report = [];
    let splitInfo = null;
    for (const id of order) {
      const st = P.STAGES.find((s) => s.id === id);
      const before = cur.length;
      const bySrcIn = countBy(cur, (r) => r.s);
      const t0 = Date.now();
      const r = st.run(cur, p, ctx || {});
      const after = r.rows.length;
      const bySrcOut = countBy(r.rows, (x) => x.s);
      const perSource = Object.keys(bySrcIn).map((s) => ({ s, in: bySrcIn[s], out: bySrcOut[s] || 0, rate: 1 - (bySrcOut[s] || 0) / bySrcIn[s] }));
      const removedRows = [];
      if (after < before) {
        const keep = new Set(r.rows.map((x) => x.i));
        for (const x of cur) if (!keep.has(x.i)) { removedRows.push(x); if (removedRows.length > 400) break; }
      }
      report.push({ id, name: st.name, in: before, out: after, removed: before - after, rate: before ? (before - after) / before : 0, note: r.note, perSource, removedRows, ms: Date.now() - t0, extra: r });
      if (id === 'split') splitInfo = r;
      cur = r.rows;
    }
    return { rows: cur, report, split: splitInfo };
  };

  /* Builds the final training rows.
     The base already knows most facts, so the short run spends its steps on what is truly new: your persona, your seeds, refusals and corrections.
     Other sources stay as a smaller share, for stability, and replay guards against forgetting. */
  P.PRIORITY = new Set(['persona-local', 'safe-refusals', 'seed-handwritten', 'failure-round']);
  const PRE = ['Hey, ', 'So ', 'Quick question: ', 'Hello, ', 'Please tell me, ', 'Friend, '];
  P.prepareTraining = function (splits, replayPool, { replay = 0.2, seed = 3, augment = true, otherShare = 0.08 } = {}) {
    let a = seed >>> 0 || 1;
    const rand = () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; };
    const shuffle = (l) => { for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; } return l; };
    const train = [], others = [];
    for (const r of splits.train) {
      if (!P.PRIORITY.has(r.s)) { others.push(r); continue; }
      train.push(r);
      if (!augment || !r.messages) continue;
      const u = r.messages[0].content;
      const lower = u.replace(/[?.!]+$/, '').toLowerCase();
      for (const v of [lower, PRE[Math.floor(rand() * PRE.length)] + lower]) train.push(Object.assign({}, r, { messages: [Object.assign({}, r.messages[0], { content: v }), ...r.messages.slice(1)] }));
    }
    shuffle(others);
    train.push(...others.slice(0, Math.round(train.length * otherShare)));
    const nReplay = Math.round((train.length * replay) / Math.max(0.01, 1 - replay));
    const pool = shuffle(replayPool.slice());
    for (let i = 0; i < nReplay && i < pool.length; i++) {
      const x = pool[i];
      train.push({ s: 'replay', messages: [{ role: 'user', content: x.q }, { role: 'assistant', content: x.a, events: eventsFor(x.t) }] });
    }
    return train;
  };
  // Rows the event heads learn from: every labelled source, including the emotion script.
  P.headRows = function (splits, replayPool = [], perEmotion = 70, seed = 5) {
    let a = seed;
    const rand = () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; };
    const pool = splits.train.filter((r) => r.messages && r.messages.length === 2 && r.messages[1].events);
    for (const x of replayPool) pool.push({ s: 'replay', messages: [{ role: 'user', content: x.q }, { role: 'assistant', content: x.a, events: eventsFor(x.t) }] });
    const by = {};
    for (const r of pool) (by[r.messages[1].events.emotion] = by[r.messages[1].events.emotion] || []).push(r);
    const out = [];
    for (const k in by) {
      const l = by[k];
      for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; }
      for (let i = 0; i < perEmotion && l.length; i++) out.push(l[i % l.length]);
    }
    return out;
  };
  // Questions the matcher may rewrite to: only rows the adapter really studied.
  P.matcherQuestions = function (splits) {
    const q = new Set();
    for (const r of splits.train) if (P.PRIORITY.has(r.s) && r.messages && !/\d/.test(r.messages[0].content)) q.add(r.messages[0].content);
    return [...q];
  };

  /* Quality gates (guide Part 4.6): every number is measured on the final rows. */
  P.textOf = (r) => (r.messages ? r.messages.map((m) => (m.content || '') + (m.tool_call ? JSON.stringify(m.tool_call) : '')).join(' ') : (r.q || '') + ' ' + (r.a || ''));
  P.gates = function (res, ctx) {
    const rows = res.rows;
    const n = rows.length || 1;
    const formatted = rows.filter((r) => r.messages);
    // format
    const okFmt = formatted.filter((r) => r.messages.every((m) => m.role !== 'assistant' || P.validEvents(m.events))).length;
    const formatRate = okFmt / n;
    // PII
    let pii = 0;
    for (const r of rows) pii += P.countPII(P.textOf(r));
    // dedupe (measured independently on final rows)
    const seen = new Set();
    let exact = 0;
    const buckets = new Map();
    let near = 0;
    for (const r of rows) {
      const t = P.textOf(r);
      if (seen.has(t)) exact++;
      seen.add(t);
      const qt = r.messages ? r.messages[0].content : r.q || '';
      const at = t.slice(qt.length);
      const sa = minhash(at), sq = minhash(qt);
      let isNear = false;
      for (let b = 0; b < BANDS; b++) {
        let h = 0;
        for (let k = 0; k < RB; k++) h = Math.imul(h ^ sa[b * RB + k], 0x01000193);
        const key = b + ':' + (h >>> 0);
        if (!isNear && buckets.has(key)) for (const o of buckets.get(key)) if (simSig(sa, o.sa) >= 0.85 && simSig(sq, o.sq) >= 0.85) { isNear = true; break; }
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push({ sa, sq });
      }
      if (isNear) near++;
    }
    const nearRate = near / n;
    // train/val overlap
    let leak = 0;
    if (res.split && res.split.splits) {
      const tr = new Set(res.split.splits.train.map((r) => P.textOf(r)));
      for (const r of res.split.splits.val) if (tr.has(P.textOf(r))) leak++;
    }
    let leakConv = 0;
    if (res.split && res.split.splits) {
      const convs = new Set(res.split.splits.train.map((r) => r.s + ':' + r.c));
      for (const r of res.split.splits.val) if (convs.has(r.s + ':' + r.c)) leakConv++;
      for (const r of res.split.splits.test) if (convs.has(r.s + ':' + r.c)) leakConv++;
    }
    let refusals = 0, toolRows = 0;
    for (const r of rows) {
      if (REFUSAL.test(P.textOf(r))) refusals++;
      if (r.x || r.s === 'tool-examples') toolRows++;
    }
    // eval overlap
    let evalOverlap = 0;
    const sealed = (ctx && ctx.sealedPrompts) || [];
    const sg = sealed.map((s) => P.grams(s));
    for (const r of rows) {
      const q = r.messages ? r.messages[0].content : r.q;
      const g = P.grams(q || '');
      for (const s of sg) {
        if (!s.size || !g.size) continue;
        let m = 0;
        for (const x of s) if (g.has(x)) m++;
        if (m / s.size >= 0.9 && m / g.size >= 0.9) { evalOverlap++; break; }
      }
    }
    // distribution: no source dominates
    const by = countBy(rows, (r) => r.s);
    let topSrc = '', top = 0;
    for (const k in by) if (by[k] > top) { top = by[k]; topSrc = k; }
    const topShare = top / n;
    // template dominance: the single most repeated answer
    const ansCount = {};
    for (const r of rows) {
      const a = r.messages ? (r.messages[1] && r.messages[1].content) || '' : r.a || '';
      ansCount[a] = (ansCount[a] || 0) + 1;
    }
    const topAns = Math.max(0, ...Object.values(ansCount)) / n;
    const versionOK = !!(res.split && res.split.splitAt === rows.length);
    return { n: rows.length, formatRate, pii, exact, nearRate, leak, leakConv, refusals, toolRows, evalOverlap, topSrc, topShare, topAns, versionOK, versionHash: res.split && res.split.versionHash, by };
  };
  function countBy(arr, f) { const o = {}; for (const a of arr) { const k = f(a); o[k] = (o[k] || 0) + 1; } return o; }

  if (typeof module !== 'undefined' && module.exports) module.exports = P;
  else global.PIPELINE = P;
})(typeof self !== 'undefined' ? self : this);
