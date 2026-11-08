/* AI Launch Lab ML engine: a real tiny transformer, real LoRA fine-tuning, real quantisation.
   No dependencies. The same file runs in a page, a Web Worker and Node. */
(function (global) {
  'use strict';
  const ML = {};

  // ------------------------------------------------------------ tokenizer (BPE)
  const EMOTIONS = ['joy', 'neutral', 'thinking', 'confused', 'empathy', 'excited', 'concern'];
  const INTENSITIES = ['0.3', '0.5', '0.7', '0.9'];
  const GESTURES = ['nod', 'shake', 'tilt', 'wave', 'shrug', 'none'];
  const GAZES = ['user', 'away', 'down', 'up'];
  const STYLES = ['bright', 'calm', 'soft', 'serious'];
  ML.SCHEMA = { emotion: EMOTIONS, intensity: INTENSITIES, gesture: GESTURES, gaze: GAZES, speak_style: STYLES };
  const FIELD_ORDER = ['emotion', 'intensity', 'gesture', 'gaze', 'speak_style'];
  ML.FIELD_ORDER = FIELD_ORDER;
  const SPECIALS = ['<pad>', '<|system|>', '<|user|>', '<|assistant|>', '<|tool|>', '<|end|>', '<unk>', '<tool_call>', '</tool_call>'];
  const ev = (f, v) => '<' + f + ':' + v + '>';
  const EVENT_TOKENS = FIELD_ORDER.flatMap((f) => ML.SCHEMA[f].map((v) => ev(f, v)));
  const RESERVED = Array.from({ length: 6 }, (_, i) => '<r' + i + '>');
  const ALL_SPECIALS = [...SPECIALS, ...EVENT_TOKENS, ...RESERVED];
  ML.N_SPECIAL = ALL_SPECIALS.length;
  const CHARS = (() => {
    const c = ['\n', '\t'];
    for (let i = 32; i < 127; i++) c.push(String.fromCharCode(i));
    return c;
  })();
  const SPLIT = / ?[A-Za-z]+|[0-9]| ?[^\sA-Za-z0-9]|\s/g;

  function cleanChars(s) {
    return String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-');
  }

  class Tokenizer {
    constructor(spec) {
      this.vocab = spec.vocab;
      this.merges = spec.merges || [];
      this.id = new Map(this.vocab.map((t, i) => [t, i]));
      this.rank = new Map(this.merges.map((m, i) => [m[0] + '\u0001' + m[1], i]));
      this.cache = new Map();
      this.UNK = this.id.get('<unk>');
      this.END = this.id.get('<|end|>');
      this.USER = this.id.get('<|user|>');
      this.ASSISTANT = this.id.get('<|assistant|>');
      this.SYSTEM = this.id.get('<|system|>');
      this.TOOL = this.id.get('<|tool|>');
      this.CALL = this.id.get('<tool_call>');
      this.ENDCALL = this.id.get('</tool_call>');
      this.size = this.vocab.length;
      this.fieldIds = {};
      for (const f of FIELD_ORDER) this.fieldIds[f] = ML.SCHEMA[f].map((v) => this.id.get(ev(f, v)));
      this.eventSet = new Set(FIELD_ORDER.flatMap((f) => this.fieldIds[f]));
    }
    toJSON() { return { vocab: this.vocab, merges: this.merges }; }
    encodeWord(w) {
      const hit = this.cache.get(w);
      if (hit) return hit;
      let parts = Array.from(w);
      while (parts.length > 1) {
        let best = -1, bestRank = Infinity;
        for (let i = 0; i < parts.length - 1; i++) {
          const r = this.rank.get(parts[i] + '\u0001' + parts[i + 1]);
          if (r !== undefined && r < bestRank) { bestRank = r; best = i; }
        }
        if (best < 0) break;
        parts.splice(best, 2, parts[best] + parts[best + 1]);
      }
      const ids = parts.map((p) => { const i = this.id.get(p); return i === undefined ? this.UNK : i; });
      if (this.cache.size < 50000) this.cache.set(w, ids);
      return ids;
    }
    encode(text) {
      const out = [];
      const t = cleanChars(text);
      const words = t.match(SPLIT) || [];
      for (const w of words) for (const i of this.encodeWord(w)) out.push(i);
      return out;
    }
    decode(ids, keepSpecial) {
      let s = '';
      for (const i of ids) {
        if (i < ML.N_SPECIAL && !keepSpecial) continue;
        s += this.vocab[i] === undefined ? '' : this.vocab[i];
      }
      return s;
    }
    /* Exact chat template of the base model.
       <|system|>..<|end|><|user|>..<|end|><|assistant|>[5 events]text<|end|>  and  <|tool|>output<|end|> for tool results. */
    encodeRow(row, opts = {}) {
      const ids = [], mask = [];
      const push = (arr, m) => { for (const a of arr) { ids.push(a); mask.push(m); } };
      const msgs = row.messages || [];
      const bad = opts.template === 'alpaca';
      for (let k = 0; k < msgs.length; k++) {
        const m = msgs[k];
        if (bad) {
          // Deliberately wrong template, used to demonstrate the silent failure the guide warns about.
          if (m.role === 'user') push(this.encode('### Instruction:\n' + m.content + '\n### Response:\n'), 0);
          else if (m.role === 'assistant') push([...this.encode(m.content), this.END], 1);
          continue;
        }
        if (m.role === 'system') { push([this.SYSTEM, ...this.encode(m.content), this.END], 0); }
        else if (m.role === 'user') { push([this.USER, ...this.encode(m.content), this.END], 0); }
        else if (m.role === 'tool') { push([this.TOOL, ...this.encode(m.content), this.END], 0); }
        else if (m.role === 'assistant') {
          push([this.ASSISTANT], 0);
          if (m.tool_call) { push([this.CALL, ...this.encode(JSON.stringify(m.tool_call)), this.ENDCALL], 1); }
          push(this.encode(m.content || ''), 1);
          push([this.END], 1);
        }
      }
      return { ids, mask };
    }
    eventIds(e) {
      if (!e) return [];
      return FIELD_ORDER.map((f) => this.id.get(ev(f, e[f]))).filter((x) => x !== undefined);
    }
    encodePrompt(messages) {
      const { ids } = this.encodeRow({ messages });
      ids.push(this.ASSISTANT);
      return ids;
    }
    parseEvents(ids) {
      const e = {};
      let n = 0;
      for (const i of ids) {
        if (!this.eventSet.has(i)) continue;
        const m = /^<([a-z_]+):(.+)>$/.exec(this.vocab[i]);
        if (!m) continue;
        if (e[m[1]] === undefined) { e[m[1]] = m[1] === 'intensity' ? parseFloat(m[2]) : m[2]; n++; }
      }
      return n === FIELD_ORDER.length ? e : null;
    }
  }
  ML.Tokenizer = Tokenizer;

  // Trains the merges. Digits and punctuation stay single tokens, so numbers can be copied exactly.
  ML.trainBPE = function (texts, vocabSize) {
    const freq = new Map();
    for (const t of texts) {
      const words = cleanChars(t).match(/ ?[A-Za-z]+/g) || [];
      for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
    }
    let words = [...freq.entries()].map(([w, f]) => ({ p: Array.from(w), f }));
    const vocab = [...ALL_SPECIALS, ...CHARS];
    const merges = [];
    while (vocab.length < vocabSize) {
      const pairs = new Map();
      for (const w of words) for (let i = 0; i < w.p.length - 1; i++) {
        const k = w.p[i] + '\u0001' + w.p[i + 1];
        pairs.set(k, (pairs.get(k) || 0) + w.f);
      }
      let best = null, bestF = 1;
      for (const [k, f] of pairs) if (f > bestF) { bestF = f; best = k; }
      if (!best) break;
      const [a, b] = best.split('\u0001');
      merges.push([a, b]);
      vocab.push(a + b);
      for (const w of words) {
        for (let i = 0; i < w.p.length - 1; i++) {
          if (w.p[i] === a && w.p[i + 1] === b) w.p.splice(i, 2, a + b);
        }
      }
    }
    return new Tokenizer({ vocab, merges });
  };

  // ------------------------------------------------------------ weights / safetensors
  ML.parseSafetensors = function (buf) {
    const dv = new DataView(buf);
    const n = Number(dv.getBigUint64(0, true));
    const hdr = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, n)));
    const out = {};
    for (const k in hdr) {
      if (k === '__metadata__') continue;
      const [a, b] = hdr[k].data_offsets;
      out[k] = new Float32Array(buf.slice(8 + n + a, 8 + n + b));
    }
    return { tensors: out, meta: hdr.__metadata__ || {} };
  };
  ML.writeSafetensors = function (tensors, meta = {}) {
    const hdr = { __metadata__: Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, String(v)])) };
    let off = 0;
    for (const k of Object.keys(tensors)) {
      const t = tensors[k];
      const dtype = t instanceof Int8Array ? 'I8' : t instanceof Uint8Array ? 'U8' : 'F32';
      hdr[k] = { dtype, shape: [t.length], data_offsets: [off, off + t.byteLength] };
      off += t.byteLength;
    }
    let js = new TextEncoder().encode(JSON.stringify(hdr));
    const pad = (8 - ((js.length + 8) % 8)) % 8;
    if (pad) { const s = JSON.stringify(hdr) + ' '.repeat(pad); js = new TextEncoder().encode(s); }
    const out = new Uint8Array(8 + js.length + off);
    new DataView(out.buffer).setBigUint64(0, BigInt(js.length), true);
    out.set(js, 8);
    let p = 8 + js.length;
    for (const k of Object.keys(tensors)) {
      const t = tensors[k];
      out.set(new Uint8Array(t.buffer, t.byteOffset, t.byteLength), p);
      p += t.byteLength;
    }
    return out.buffer;
  };

  // ------------------------------------------------------------ model
  const LN_EPS = 1e-5;
  ML.linearNames = function (cfg) {
    const out = [];
    for (let l = 0; l < cfg.L; l++) for (const n of ['q', 'k', 'v', 'o', 'm1', 'm2']) {
      const din = n === 'm2' ? cfg.m : cfg.d;
      const dout = n === 'm1' ? cfg.m : cfg.d;
      out.push({ name: 'h' + l + '.' + n, din, dout, l, n });
    }
    return out;
  };

  class GPT {
    constructor(cfg, w) {
      this.cfg = cfg;
      this.w = w;
      this.dh = cfg.d / cfg.H;
      this.linears = ML.linearNames(cfg);
    }
    paramCount() {
      let n = 0;
      for (const k in this.w) n += this.w[k].length;
      return n;
    }
    // Reading-order inference session with a KV cache.
    session(adapter) { return new Session(this, adapter || null); }
  }
  ML.GPT = GPT;

  function lnForward(x, xo, d, g, b, out, zOut, sigOut, sigO) {
    let mu = 0;
    for (let i = 0; i < d; i++) mu += x[xo + i];
    mu /= d;
    let v = 0;
    for (let i = 0; i < d; i++) { const e = x[xo + i] - mu; v += e * e; }
    const s = Math.sqrt(v / d + LN_EPS);
    if (sigOut) sigOut[sigO] = s;
    for (let i = 0; i < d; i++) {
      const z = (x[xo + i] - mu) / s;
      if (zOut) zOut[out.__o + i] = z;
      out[out.__o + i] = z * g[i] + b[i];
    }
  }

  function loraScale(ad) { return ad.alpha / ad.rank; }

  class Session {
    constructor(net, adapter) {
      this.net = net;
      this.ad = adapter;
      const c = net.cfg;
      this.t = 0;
      this.K = []; this.V = [];
      for (let l = 0; l < c.L; l++) { this.K.push(new Float32Array(c.ctx * c.d)); this.V.push(new Float32Array(c.ctx * c.d)); }
      this.x = new Float32Array(c.d); this.n = new Float32Array(c.d); this.h = new Float32Array(c.m);
      this.q = new Float32Array(c.d); this.att = new Float32Array(c.d); this.o = new Float32Array(c.d); this.tmp = new Float32Array(Math.max(c.d, c.m));
      this.scores = new Float32Array(c.ctx);
      this.logits = new Float32Array(c.V);
      this.r = new Float32Array(adapter ? adapter.rank : 1);
    }
    reset() { this.t = 0; }
    clone() {
      const s = new Session(this.net, this.ad);
      s.t = this.t;
      for (let l = 0; l < this.K.length; l++) { s.K[l].set(this.K[l]); s.V[l].set(this.V[l]); }
      return s;
    }
    copyPrefixFrom(o, n) {
      this.t = n;
      const d = this.net.cfg.d;
      for (let l = 0; l < this.K.length; l++) { this.K[l].set(o.K[l].subarray(0, n * d)); this.V[l].set(o.V[l].subarray(0, n * d)); }
    }
    lin(name, x, din, dout, y) {
      const W = this.net.w[name];
      y.fill(0, 0, dout);
      for (let i = 0; i < din; i++) {
        const xi = x[i];
        if (xi === 0) continue;
        const oi = i * dout;
        for (let j = 0; j < dout; j++) y[j] += xi * W[oi + j];
      }
      const ad = this.ad;
      if (ad && ad.A[name]) {
        const A = ad.A[name], B = ad.B[name], r = ad.rank, s = loraScale(ad), rr = this.r;
        rr.fill(0);
        for (let i = 0; i < din; i++) { const xi = x[i]; const oi = i * r; for (let k = 0; k < r; k++) rr[k] += xi * A[oi + k]; }
        for (let k = 0; k < r; k++) { const v = rr[k] * s; const ok = k * dout; for (let j = 0; j < dout; j++) y[j] += v * B[ok + j]; }
      }
    }
    // Feed one token; returns logits for the next.
    step(tok) {
      const net = this.net, c = net.cfg, d = c.d, w = net.w, H = c.H, dh = net.dh, t = this.t;
      const emb = w.tok, pos = w.pos, ad = this.ad, x = this.x;
      const tOff = tok * d, pOff = Math.min(t, c.ctx - 1) * d;
      const added = ad && ad.added && tok >= ad.addedFrom && tok < ad.addedTo ? ad.added : null;
      if (added) { const o = (tok - ad.addedFrom) * d; for (let i = 0; i < d; i++) x[i] = added[o + i] + pos[pOff + i]; }
      else for (let i = 0; i < d; i++) x[i] = emb[tOff + i] + pos[pOff + i];
      const nb = this.n, q = this.q, att = this.att, oo = this.o, h = this.h, scale = 1 / Math.sqrt(dh);
      nb.__o = 0;
      for (let l = 0; l < c.L; l++) {
        const P = 'h' + l + '.';
        lnForward(x, 0, d, w[P + 'ln1.g'], w[P + 'ln1.b'], nb);
        const K = this.K[l], V = this.V[l];
        this.lin(P + 'q', nb, d, d, q);
        this.lin(P + 'k', nb, d, d, this.tmp); K.set(this.tmp.subarray(0, d), t * d);
        this.lin(P + 'v', nb, d, d, this.tmp); V.set(this.tmp.subarray(0, d), t * d);
        const S = this.scores;
        for (let a = 0; a < H; a++) {
          const ao = a * dh;
          let mx = -Infinity;
          for (let s = 0; s <= t; s++) {
            const so = s * d + ao;
            let dot = 0;
            for (let i = 0; i < dh; i++) dot += q[ao + i] * K[so + i];
            dot *= scale;
            S[s] = dot;
            if (dot > mx) mx = dot;
          }
          let sum = 0;
          for (let s = 0; s <= t; s++) { const e = Math.exp(S[s] - mx); S[s] = e; sum += e; }
          for (let i = 0; i < dh; i++) att[ao + i] = 0;
          for (let s = 0; s <= t; s++) {
            const al = S[s] / sum, so = s * d + ao;
            for (let i = 0; i < dh; i++) att[ao + i] += al * V[so + i];
          }
        }
        this.lin(P + 'o', att, d, d, oo);
        for (let i = 0; i < d; i++) x[i] += oo[i];
        lnForward(x, 0, d, w[P + 'ln2.g'], w[P + 'ln2.b'], nb);
        this.lin(P + 'm1', nb, d, c.m, h);
        for (let i = 0; i < c.m; i++) if (h[i] < 0) h[i] = 0;
        this.lin(P + 'm2', h, c.m, d, oo);
        for (let i = 0; i < d; i++) x[i] += oo[i];
      }
      lnForward(x, 0, d, w['lnf.g'], w['lnf.b'], nb);
      const L = this.logits, V_ = c.V;
      for (let v = 0; v < V_; v++) {
        let s = 0;
        const vo = v * d;
        for (let i = 0; i < d; i++) s += nb[i] * emb[vo + i];
        L[v] = s;
      }
      if (ad && ad.added) {
        for (let v = ad.addedFrom; v < ad.addedTo; v++) {
          let s = 0;
          const vo = (v - ad.addedFrom) * d;
          for (let i = 0; i < d; i++) s += nb[i] * ad.added[vo + i];
          L[v] = s;
        }
      }
      this.t = t + 1;
      return L;
    }
  }
  ML.Session = Session;

  // ------------------------------------------------------------ generation
  function sample(logits, o, rng) {
    const n = logits.length, T = o.temperature;
    let allow = o.allow || null;
    if (T <= 0.001) {
      let best = -1, bv = -Infinity;
      for (let i = 0; i < n; i++) {
        if (allow && !allow.has(i)) continue;
        if (o.banned && o.banned.has(i)) continue;
        if (logits[i] > bv) { bv = logits[i]; best = i; }
      }
      return best;
    }
    const idx = [];
    for (let i = 0; i < n; i++) {
      if (i === 0) continue;
      if (allow && !allow.has(i)) continue;
      if (o.banned && o.banned.has(i)) continue;
      idx.push(i);
    }
    idx.sort((a, b) => logits[b] - logits[a]);
    const k = Math.min(o.topK || 20, idx.length);
    let mx = logits[idx[0]], sum = 0;
    const p = new Array(k);
    for (let i = 0; i < k; i++) { p[i] = Math.exp((logits[idx[i]] - mx) / T); sum += p[i]; }
    let r = rng() * sum;
    for (let i = 0; i < k; i++) { r -= p[i]; if (r <= 0) return idx[i]; }
    return idx[k - 1];
  }
  ML.sample = sample;

  // Seeded RNG, so runs can be reproduced.
  ML.rng = function (seed) {
    let a = seed >>> 0 || 1;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /* Generates a reply. Options:
     grammar: true forces the five event tokens into the closed schema (constrained decoding, as in vLLM JSON mode).
     onToken(id, text): streaming. Returns {ids, text, events, toolCall, logp, tokens, ttftMs, ms}. */
  ML.generate = function (net, tok, promptIds, opts = {}) {
    const o = Object.assign({ maxNew: 80, temperature: 0.5, topK: 12, grammar: false, rep: 1.15, seed: 7 }, opts);
    const c = net.cfg;
    const rng = o.rng || ML.rng(o.seed);
    const sess = o.session || net.session(o.adapter);
    const t0 = now();
    let ids = promptIds;
    if (ids.length > c.ctx - o.maxNew - 1) ids = ids.slice(ids.length - (c.ctx - o.maxNew - 1));
    let start = 0;
    if (o.prefix && o.prefix.t > 0 && o.prefix.ids) {
      let same = 0;
      while (same < o.prefix.ids.length && same < ids.length - 1 && o.prefix.ids[same] === ids[same]) same++;
      if (same > 0) { sess.copyPrefixFrom(o.prefix.sess, same); start = same; }
    } else sess.reset();
    if (!start) sess.reset();
    let L = null;
    for (let i = start; i < ids.length; i++) L = sess.step(ids[i]);
    const out = [];
    let logp = 0, firstAt = 0, nText = 0;
    const seen = new Map();
    let inCall = false;
    for (let k = 0; k < o.maxNew; k++) {
      const so = { temperature: o.temperature, topK: o.topK, banned: tok.eventSet };
      if (o.rep > 1 && !inCall) {
        for (const [id, cnt] of seen) { if (id >= ML.N_SPECIAL + 100 && cnt > 0 && L[id] > 0) L[id] /= Math.pow(o.rep, cnt); else if (id >= ML.N_SPECIAL + 100 && cnt > 0) L[id] *= Math.pow(o.rep, cnt); }
      }
      const id = sample(L, so, rng);
      if (id < 0) break;
      if (!firstAt) firstAt = now();
      // running log-probability of the words, used for confidence checks
      let mx = -Infinity, sum = 0;
      for (let v = 1; v < L.length; v++) if (L[v] > mx) mx = L[v];
      for (let v = 1; v < L.length; v++) sum += Math.exp(L[v] - mx);
      logp += L[id] - mx - Math.log(sum);
      nText++;
      if (id === tok.END) break;
      out.push(id);
      seen.set(id, (seen.get(id) || 0) + 1);
      if (id === tok.CALL) inCall = true;
      if (id === tok.ENDCALL) inCall = false;
      if (o.onToken) o.onToken(id, tok.vocab[id]);
      if (sess.t >= c.ctx) break;
      L = sess.step(id);
    }
    // The five event fields come from closed-choice heads on the model's final state, so the JSON is always valid.
    let events = null;
    const heads = o.heads || (o.adapter && o.adapter.heads);
    if (heads) events = ML.applyEventHeads(heads, ML.eventFeature(net, null, ids.concat(out)));
    const done = now();
    const callStart = out.indexOf(tok.CALL), callEnd = out.indexOf(tok.ENDCALL);
    let toolCall = null;
    if (callStart >= 0 && callEnd > callStart) {
      try { toolCall = JSON.parse(tok.decode(out.slice(callStart + 1, callEnd))); } catch (e) { toolCall = { invalid: true }; }
    }
    const textIds = callStart >= 0 ? out.filter((_, i) => i < callStart || i > callEnd) : out;
    return {
      ids: out, text: tok.decode(textIds).trim(), events, toolCall,
      logp, meanLogp: nText ? logp / nText : 0, tokens: out.length, promptTokens: ids.length,
      ttftMs: firstAt - t0, ms: done - t0, session: sess,
    };
  };
  function now() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }
  ML.now = now;

  // ------------------------------------------------------------ question matcher
  /* TF-IDF cosine over words and stems: finds the closest question the model trained on.
     A tiny model memorises rather than generalises, so this step is what lets it handle rephrasing.
     Queries with digits are left alone, because their numbers matter. */
  const NO_STEM = new Set(['evening', 'morning', 'string', 'thing', 'nothing', 'something', 'bring', 'during', 'king']);
  const mStem = (w) => (NO_STEM.has(w) ? w : w.length > 4 && w.endsWith('ing') ? w.slice(0, -3) : w.length > 4 && w.endsWith('ed') ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
  const mWords = (s) => String(s).toLowerCase().replace(/[^a-z0-9\s/]/g, ' ').split(/\s+/).filter(Boolean).map(mStem);
  class Matcher {
    constructor(questions) {
      this.items = [];
      this.df = new Map();
      this.add(questions || []);
    }
    add(questions, tag = 'base') {
      for (const q of questions) {
        const toks = mWords(q);
        if (!toks.length) continue;
        const tf = new Map();
        for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
        for (const t of tf.keys()) this.df.set(t, (this.df.get(t) || 0) + 1);
        this.items.push({ q, tf, norm: 0, tag });
      }
      this.N = this.items.length || 1;
      for (const it of this.items) { let n = 0; for (const [t, f] of it.tf) { const w = f * this.idf(t); n += w * w; } it.norm = Math.sqrt(n) || 1; }
    }
    idf(t) { return Math.log(1 + this.N / (1 + (this.df.get(t) || 0))); }
    best(text) {
      const toks = mWords(text);
      const tf = new Map();
      for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
      let qn = 0;
      for (const [t, f] of tf) { const w = f * this.idf(t); qn += w * w; }
      qn = Math.sqrt(qn) || 1;
      let best = null, bs = 0;
      for (const it of this.items) {
        let dot = 0;
        for (const [t, f] of tf) { const g = it.tf.get(t); if (g) { const i = this.idf(t); dot += f * i * g * i; } }
        // a question the adapter studied wins a tie: that is where the newest, most specific answer lives
        const s = (dot / (qn * it.norm)) * (it.tag === 'adapter' ? 1.0001 : 1); // on a tie, the question the adapter studied wins
        if (s > bs) { bs = s; best = it; }
      }
      return { q: best ? best.q : null, score: bs, tag: best ? best.tag : null };
    }
    // Returns the prompt to send to the model.
    rewrite(text, threshold = 0.42) {
      if (/\d/.test(text)) return { text, score: 0, matched: false, tag: 'base' };
      const b = this.best(text);
      if (b.q && b.score >= threshold) return { text: b.q, score: b.score, matched: true, tag: b.tag };
      return { text, score: b.score, matched: false, tag: 'base' };
    }
  }
  ML.Matcher = Matcher;

  // ------------------------------------------------------------ event heads
  // A small softmax trained on fixed features with Adam.
  ML.trainSoftmax = function (feats, labels, classes, { steps = 260, lr = 0.02, seed = 1, batch = 64 } = {}) {
    const d = feats[0].length, W = new Float32Array(classes * (d + 1));
    const adam = new ML.Adam([W], { clip: 0 });
    const rng = ML.rng(seed);
    const g = new Float32Array(W.length), p = new Float32Array(classes);
    for (let t = 0; t < steps; t++) {
      g.fill(0);
      const bs = Math.min(batch, feats.length);
      for (let b = 0; b < bs; b++) {
        const i = Math.floor(rng() * feats.length), f = feats[i], y = labels[i];
        let mx = -Infinity;
        for (let c = 0; c < classes; c++) { const o = c * (d + 1); let s = W[o + d]; for (let k = 0; k < d; k++) s += W[o + k] * f[k]; p[c] = s; if (s > mx) mx = s; }
        let sum = 0;
        for (let c = 0; c < classes; c++) { p[c] = Math.exp(p[c] - mx); sum += p[c]; }
        for (let c = 0; c < classes; c++) { const e = p[c] / sum - (c === y ? 1 : 0), o = c * (d + 1); for (let k = 0; k < d; k++) g[o + k] += e * f[k]; g[o + d] += e; }
      }
      for (let i = 0; i < g.length; i++) g[i] /= bs;
      adam.step([g], lr);
    }
    return W;
  };
  ML.applySoftmax = function (W, f, classes) {
    const d = f.length;
    let best = 0, bv = -Infinity;
    for (let c = 0; c < classes; c++) { const o = c * (d + 1); let s = W[o + d]; for (let k = 0; k < d; k++) s += W[o + k] * f[k]; if (s > bv) { bv = s; best = c; } }
    return best;
  };
  ML.applyEventHeads = function (heads, f) {
    const e = {};
    for (const field of FIELD_ORDER) {
      const vals = ML.SCHEMA[field], W = heads[field];
      if (!W) return null;
      const v = vals[ML.applySoftmax(W, f, vals.length)];
      e[field] = field === 'intensity' ? parseFloat(v) : v;
    }
    return e;
  };
  // features: [Float32Array], events: [{emotion,...}] per row
  ML.trainEventHeads = function (feats, events) {
    const heads = {};
    for (const field of FIELD_ORDER) {
      const vals = ML.SCHEMA[field].map(String);
      const labels = events.map((e) => Math.max(0, vals.indexOf(String(e[field]))));
      heads[field] = ML.trainSoftmax(feats, labels, vals.length, { seed: 3 + field.length });
    }
    return heads;
  };
  // The final state the heads read: the state after the last word, on prompt + reply.
  ML.eventFeature = function (net, adapter, ids) {
    const s = new Session(net, adapter);
    for (const i of ids.slice(0, net.cfg.ctx)) s.step(i);
    return s.n.slice(0);
  };

  // ------------------------------------------------------------ LoRA adapters
  ML.newAdapter = function (net, { rank = 16, alpha = 16, seed = 1, targets = null, addedTokens = false, fromLayer = 0 } = {}) {
    const rng = ML.rng(seed);
    const A = {}, B = {};
    for (const li of net.linears) {
      if (targets && !targets.includes(li.n)) continue;
      if (li.l < fromLayer) continue;
      const a = new Float32Array(li.din * rank);
      const span = 1 / Math.sqrt(li.din);
      for (let i = 0; i < a.length; i++) a[i] = (rng() * 2 - 1) * span; // Kaiming-uniform style, as in PEFT
      A[li.name] = a;
      B[li.name] = new Float32Array(rank * li.dout); // starts at zero: the adapter begins as a no-op
    }
    const ad = { rank, alpha, A, B, fromLayer };
    if (addedTokens) {
      // Reserved tokens (event and tool tokens) never appeared in base pretraining, so the adapter owns their embeddings.
      const from = 7, to = 9, d = net.cfg.d; // <tool_call> and </tool_call>
      ad.addedFrom = from; ad.addedTo = to;
      ad.added = new Float32Array((to - from) * d);
      ad.added.set(net.w.tok.subarray(from * d, to * d));
    }
    return ad;
  };
  ML.adapterParams = function (ad) {
    let n = 0;
    for (const k in ad.A) n += ad.A[k].length + ad.B[k].length;
    if (ad.added) n += ad.added.length;
    return n;
  };
  ML.adapterList = function (ad) {
    const list = [];
    for (const k of Object.keys(ad.A).sort()) { list.push(ad.A[k]); list.push(ad.B[k]); }
    if (ad.added) list.push(ad.added);
    return list;
  };
  ML.serializeAdapter = function (ad) {
    const t = {};
    for (const k in ad.A) { t['A.' + k] = ad.A[k]; t['B.' + k] = ad.B[k]; }
    if (ad.added) t.added = ad.added;
    if (ad.heads) for (const f in ad.heads) t['head.' + f] = ad.heads[f];
    return ML.writeSafetensors(t, { rank: ad.rank, alpha: ad.alpha, addedFrom: ad.addedFrom, addedTo: ad.addedTo, fromLayer: ad.fromLayer || 0 });
  };
  ML.parseAdapter = function (buf) {
    const { tensors, meta } = ML.parseSafetensors(buf);
    const ad = { rank: +meta.rank, alpha: +meta.alpha, A: {}, B: {}, fromLayer: +(meta.fromLayer || 0) };
    if (meta.addedFrom !== 'undefined') { ad.addedFrom = +meta.addedFrom; ad.addedTo = +meta.addedTo; }
    for (const k in tensors) {
      if (k === 'added') ad.added = tensors[k];
      else if (k.startsWith('head.')) { ad.heads = ad.heads || {}; ad.heads[k.slice(5)] = tensors[k]; }
      else if (k[0] === 'A') ad.A[k.slice(2)] = tensors[k];
      else ad.B[k.slice(2)] = tensors[k];
    }
    return ad;
  };

  // Bakes an adapter into a full copy of the base weights: W' = W + (alpha/rank) A B.
  ML.mergeAdapter = function (net, ad) {
    const w = {};
    for (const k in net.w) w[k] = net.w[k].slice();
    const s = loraScale(ad), r = ad.rank;
    for (const li of net.linears) {
      const A = ad.A[li.name], B = ad.B[li.name];
      if (!A) continue;
      const W = w[li.name], din = li.din, dout = li.dout;
      for (let i = 0; i < din; i++) for (let k = 0; k < r; k++) {
        const v = s * A[i * r + k];
        const ok = k * dout, oi = i * dout;
        for (let j = 0; j < dout; j++) W[oi + j] += v * B[ok + j];
      }
    }
    if (ad.added) w.tok.set(ad.added, ad.addedFrom * net.cfg.d);
    const merged = new GPT(net.cfg, w);
    merged.heads = ad.heads || null;
    return merged;
  };

  // Real linear quantisation. Returns the stored integers and the weights the runtime will actually use.
  ML.quantize = function (net, bits) {
    const stored = {}, w = {};
    let bytes = 0;
    const levels = Math.pow(2, bits - 1) - 1;
    for (const k in net.w) {
      const src = net.w[k];
      let mx = 1e-9;
      for (let i = 0; i < src.length; i++) { const a = Math.abs(src[i]); if (a > mx) mx = a; }
      const sc = mx / levels;
      const q = new Int8Array(src.length);
      const back = new Float32Array(src.length);
      for (let i = 0; i < src.length; i++) { const v = Math.max(-levels, Math.min(levels, Math.round(src[i] / sc))); q[i] = v; back[i] = v * sc; }
      stored[k] = { q, scale: sc };
      w[k] = back;
      bytes += Math.ceil((src.length * bits) / 8) + 4;
    }
    return { net: new GPT(net.cfg, w), stored, bytes, bits };
  };
  ML.floatBytes = (net) => net.paramCount() * 4;

  // ------------------------------------------------------------ training (hand-written backprop)
  class Grad {
    constructor(net, ad) {
      this.net = net;
      this.ad = ad;
      const c = net.cfg, T = c.ctx, d = c.d;
      const f = (n) => new Float32Array(n);
      this.layers = [];
      for (let l = 0; l < c.L; l++) {
        this.layers.push({
          x0: f(T * d), z1: f(T * d), n1: f(T * d), s1: f(T), Q: f(T * d), K: f(T * d), V: f(T * d), al: f(T * T * c.H), att: f(T * d), x1: f(T * d),
          z2: f(T * d), n2: f(T * d), s2: f(T), h1: f(T * c.m), h: f(T * c.m),
        });
      }
      this.xf = f(T * d); this.zf = f(T * d); this.nf = f(T * d); this.sf = f(T);
      this.g = f(T * d); this.g2 = f(T * d); this.gq = f(T * d); this.gk = f(T * d); this.gv = f(T * d); this.gatt = f(T * d); this.gh = f(T * c.m);
      this.tmpO = f(Math.max(d, c.m)); this.tmpR = f(ad ? ad.rank : 1);
      this.logits = f(c.V); this.probs = f(c.V);
      this.zero();
    }
    zero() {
      const ad = this.ad;
      this.gA = {}; this.gB = {};
      for (const k in ad.A) { this.gA[k] = new Float32Array(ad.A[k].length); this.gB[k] = new Float32Array(ad.B[k].length); }
      this.gAdded = ad.added ? new Float32Array(ad.added.length) : null;
    }
    list() {
      const list = [];
      for (const k of Object.keys(this.ad.A).sort()) { list.push(this.gA[k]); list.push(this.gB[k]); }
      if (this.gAdded) list.push(this.gAdded);
      return list;
    }
    fwdLin(name, X, din, Y, dout, T) {
      const W = this.net.w[name], ad = this.ad, A = ad.A[name], B = ad.B[name];
      Y.fill(0, 0, T * dout);
      for (let t = 0; t < T; t++) {
        const xo = t * din, yo = t * dout;
        for (let i = 0; i < din; i++) {
          const xi = X[xo + i], oi = i * dout;
          for (let j = 0; j < dout; j++) Y[yo + j] += xi * W[oi + j];
        }
      }
      if (A) {
        const r = ad.rank, s = ad.alpha / r, R = this.tmpR;
        for (let t = 0; t < T; t++) {
          const xo = t * din, yo = t * dout;
          R.fill(0);
          for (let i = 0; i < din; i++) { const xi = X[xo + i], oi = i * r; for (let k = 0; k < r; k++) R[k] += xi * A[oi + k]; }
          for (let k = 0; k < r; k++) { const v = R[k] * s, ok = k * dout; for (let j = 0; j < dout; j++) Y[yo + j] += v * B[ok + j]; }
        }
      }
    }
    // Adds d(loss)/d(X) into GX from d(loss)/d(Y) = GY, and accumulates the adapter gradients.
    bwdLin(name, X, din, GY, dout, T, GX, weight) {
      const W = this.net.w[name], ad = this.ad, A = ad.A[name], B = ad.B[name];
      for (let t = 0; t < T; t++) {
        const xo = t * din, yo = t * dout;
        for (let i = 0; i < din; i++) {
          let s = 0;
          const oi = i * dout;
          for (let j = 0; j < dout; j++) s += GY[yo + j] * W[oi + j];
          GX[xo + i] += s;
        }
      }
      if (A) {
        const r = ad.rank, sc = ad.alpha / r, gA = this.gA[name], gB = this.gB[name], R = this.tmpR, GBr = new Float64Array(r);
        for (let t = 0; t < T; t++) {
          const xo = t * din, yo = t * dout;
          for (let k = 0; k < r; k++) {
            let s = 0;
            const ok = k * dout;
            for (let j = 0; j < dout; j++) s += GY[yo + j] * B[ok + j];
            GBr[k] = s * sc;
          }
          R.fill(0);
          for (let i = 0; i < din; i++) {
            const xi = X[xo + i], oi = i * r;
            let s = 0;
            for (let k = 0; k < r; k++) { R[k] += xi * A[oi + k]; s += GBr[k] * A[oi + k]; gA[oi + k] += weight * xi * GBr[k]; }
            GX[xo + i] += s;
          }
          for (let k = 0; k < r; k++) {
            const v = weight * R[k] * sc, ok = k * dout;
            for (let j = 0; j < dout; j++) gB[ok + j] += v * GY[yo + j];
          }
        }
      }
    }
    lnBack(G, Z, S, GAIN, d, T, OUT) {
      for (let t = 0; t < T; t++) {
        const o = t * d, s = S[t];
        let mean = 0, dotz = 0;
        for (let i = 0; i < d; i++) { const gi = G[o + i] * GAIN[i]; mean += gi; dotz += gi * Z[o + i]; }
        mean /= d; dotz /= d;
        for (let i = 0; i < d; i++) OUT[o + i] += (G[o + i] * GAIN[i] - mean - dotz * Z[o + i]) / s;
      }
    }
    /* ids: full token sequence; mask[i]=1 means token i is a target. Adds weight*d(nll)/d(params) to the gradient.
       Returns {nll, n}. weight may be negative (GRPO, DPO). */
    run(ids, mask, weight = 1) {
      const net = this.net, c = net.cfg, d = c.d, w = net.w, H = c.H, dh = net.dh, ad = this.ad;
      const T = Math.min(ids.length - 1, c.ctx);
      if (T < 1) return { nll: 0, n: 0 };
      const emb = w.tok, pos = w.pos, sc = 1 / Math.sqrt(dh), m = c.m;
      let x = this.layers[0].x0;
      for (let t = 0; t < T; t++) {
        const tok = ids[t], to = t * d, po = t * d;
        const a = ad.added && tok >= ad.addedFrom && tok < ad.addedTo ? ad.added : null;
        if (a) { const o = (tok - ad.addedFrom) * d; for (let i = 0; i < d; i++) x[to + i] = a[o + i] + pos[po + i]; }
        else { const o = tok * d; for (let i = 0; i < d; i++) x[to + i] = emb[o + i] + pos[po + i]; }
      }
      const lnApply = (X, G, B, Oo, Zo, So) => {
        for (let t = 0; t < T; t++) {
          const o = t * d;
          let mu = 0;
          for (let i = 0; i < d; i++) mu += X[o + i];
          mu /= d;
          let v = 0;
          for (let i = 0; i < d; i++) { const e = X[o + i] - mu; v += e * e; }
          const s = Math.sqrt(v / d + LN_EPS);
          So[t] = s;
          for (let i = 0; i < d; i++) { const z = (X[o + i] - mu) / s; Zo[o + i] = z; Oo[o + i] = z * G[i] + B[i]; }
        }
      };
      for (let l = 0; l < c.L; l++) {
        const Lb = this.layers[l], P = 'h' + l + '.';
        if (l > 0) Lb.x0.set(this.layers[l - 1].x2out.subarray(0, T * d));
        lnApply(Lb.x0, w[P + 'ln1.g'], w[P + 'ln1.b'], Lb.n1, Lb.z1, Lb.s1);
        this.fwdLin(P + 'q', Lb.n1, d, Lb.Q, d, T);
        this.fwdLin(P + 'k', Lb.n1, d, Lb.K, d, T);
        this.fwdLin(P + 'v', Lb.n1, d, Lb.V, d, T);
        const Q = Lb.Q, K = Lb.K, V = Lb.V, AT = Lb.att, AL = Lb.al;
        AT.fill(0, 0, T * d);
        const row = new Float64Array(T);
        for (let a = 0; a < H; a++) {
          const ao = a * dh, alO = a * T * T;
          for (let t = 0; t < T; t++) {
            const qo = t * d + ao;
            let mx = -Infinity;
            for (let s = 0; s <= t; s++) {
              const so = s * d + ao;
              let dot = 0;
              for (let i = 0; i < dh; i++) dot += Q[qo + i] * K[so + i];
              dot *= sc;
              row[s] = dot;
              if (dot > mx) mx = dot;
            }
            let sum = 0;
            for (let s = 0; s <= t; s++) { row[s] = Math.exp(row[s] - mx); sum += row[s]; }
            const rO = alO + t * T;
            for (let s = 0; s <= t; s++) {
              const al = row[s] / sum;
              AL[rO + s] = al;
              const so = s * d + ao;
              for (let i = 0; i < dh; i++) AT[qo + i] += al * V[so + i];
            }
          }
        }
        // O = att Wo
        const Ov = this.g2;
        this.fwdLin(P + 'o', AT, d, Ov, d, T);
        const x1 = Lb.x1;
        for (let i = 0; i < T * d; i++) x1[i] = Lb.x0[i] + Ov[i];
        lnApply(x1, w[P + 'ln2.g'], w[P + 'ln2.b'], Lb.n2, Lb.z2, Lb.s2);
        this.fwdLin(P + 'm1', Lb.n2, d, Lb.h1, m, T);
        for (let i = 0; i < T * m; i++) Lb.h[i] = Lb.h1[i] > 0 ? Lb.h1[i] : 0;
        this.fwdLin(P + 'm2', Lb.h, m, Ov, d, T);
        if (!Lb.x2out) Lb.x2out = new Float32Array(c.ctx * d);
        for (let i = 0; i < T * d; i++) Lb.x2out[i] = x1[i] + Ov[i];
      }
      const last = this.layers[c.L - 1].x2out;
      lnApply(last, w['lnf.g'], w['lnf.b'], this.nf, this.zf, this.sf);
      // cross entropy on masked targets
      const g = this.g, nf = this.nf, V_ = c.V, LG = this.logits, PR = this.probs;
      g.fill(0, 0, T * d);
      let nll = 0, n = 0;
      const addA = ad.added, aFrom = ad.addedFrom, aTo = ad.addedTo;
      for (let t = 0; t < T; t++) {
        if (!mask[t + 1]) continue;
        const y = ids[t + 1], to = t * d;
        let mx = -Infinity;
        for (let v = 0; v < V_; v++) {
          let s = 0;
          const src = addA && v >= aFrom && v < aTo ? addA : emb;
          const vo = (src === addA ? v - aFrom : v) * d;
          for (let i = 0; i < d; i++) s += nf[to + i] * src[vo + i];
          LG[v] = s;
          if (s > mx) mx = s;
        }
        let sum = 0;
        for (let v = 0; v < V_; v++) { const e = Math.exp(LG[v] - mx); PR[v] = e; sum += e; }
        nll += -(LG[y] - mx - Math.log(sum));
        n++;
        for (let v = 0; v < V_; v++) {
          const p = PR[v] / sum - (v === y ? 1 : 0);
          if (Math.abs(p) < 1e-5) continue;
          const src = addA && v >= aFrom && v < aTo ? addA : emb;
          const vo = (src === addA ? v - aFrom : v) * d;
          for (let i = 0; i < d; i++) g[to + i] += p * src[vo + i];
          if (src === addA) {
            const ga = this.gAdded;
            for (let i = 0; i < d; i++) ga[vo + i] += weight * p * nf[to + i];
          }
        }
      }
      if (n === 0) return { nll: 0, n: 0 };
      // backward
      const OUT = this.g2;
      OUT.fill(0, 0, T * d);
      this.lnBack(g, this.zf, this.sf, w['lnf.g'], d, T, OUT);
      let gx = new Float32Array(T * d);
      gx.set(OUT.subarray(0, T * d));
      const stopAt = ad.fromLayer || 0;
      for (let l = c.L - 1; l >= stopAt; l--) {
        const Lb = this.layers[l], P = 'h' + l + '.';
        // x2 = x1 + M
        const gh = this.gh;
        gh.fill(0, 0, T * m);
        this.bwdLin(P + 'm2', Lb.h, m, gx, d, T, gh, weight);
        for (let i = 0; i < T * m; i++) if (Lb.h1[i] <= 0) gh[i] = 0;
        const gn2 = this.gq;
        gn2.fill(0, 0, T * d);
        this.bwdLin(P + 'm1', Lb.n2, d, gh, m, T, gn2, weight);
        const gx1 = gx.slice(0);
        this.lnBack(gn2, Lb.z2, Lb.s2, w[P + 'ln2.g'], d, T, gx1);
        // x1 = x0 + O
        const gatt = this.gatt;
        gatt.fill(0, 0, T * d);
        this.bwdLin(P + 'o', Lb.att, d, gx1, d, T, gatt, weight);
        // attention backward
        const gq = this.gq, gk = this.gk, gv = this.gv;
        gq.fill(0, 0, T * d); gk.fill(0, 0, T * d); gv.fill(0, 0, T * d);
        const Q = Lb.Q, K = Lb.K, V = Lb.V, AL = Lb.al;
        const us = new Float64Array(T);
        for (let a = 0; a < H; a++) {
          const ao = a * dh, alO = a * T * T;
          for (let t = 0; t < T; t++) {
            const go = t * d + ao, rO = alO + t * T;
            let ubar = 0;
            for (let s = 0; s <= t; s++) {
              const so = s * d + ao;
              let u = 0;
              for (let i = 0; i < dh; i++) u += gatt[go + i] * V[so + i];
              us[s] = u;
              ubar += AL[rO + s] * u;
            }
            for (let s = 0; s <= t; s++) {
              const al = AL[rO + s], so = s * d + ao;
              const ds = al * (us[s] - ubar) * sc;
              for (let i = 0; i < dh; i++) {
                gv[so + i] += al * gatt[go + i];
                gq[go + i] += ds * K[so + i];
                gk[so + i] += ds * Q[go + i];
              }
            }
          }
        }
        const gn1 = this.g2;
        gn1.fill(0, 0, T * d);
        this.bwdLin(P + 'q', Lb.n1, d, gq, d, T, gn1, weight);
        this.bwdLin(P + 'k', Lb.n1, d, gk, d, T, gn1, weight);
        this.bwdLin(P + 'v', Lb.n1, d, gv, d, T, gn1, weight);
        const gx0 = gx1; // x0 path passes straight through the residual
        this.lnBack(gn1, Lb.z1, Lb.s1, w[P + 'ln1.g'], d, T, gx0);
        gx = gx0;
      }
      if (addA && !stopAt) {
        const ga = this.gAdded;
        for (let t = 0; t < T; t++) {
          const tok = ids[t];
          if (tok >= aFrom && tok < aTo) {
            const o = (tok - aFrom) * d, to = t * d;
            for (let i = 0; i < d; i++) ga[o + i] += weight * gx[to + i];
          }
        }
      }
      return { nll, n };
    }
    // Sum of log-probabilities without touching gradients (used by DPO and evaluation).
    nll(ids, mask) {
      const sess = this.net.session(this.ad);
      const c = this.net.cfg;
      let nll = 0, n = 0;
      const T = Math.min(ids.length - 1, c.ctx);
      for (let t = 0; t < T; t++) {
        const L = sess.step(ids[t]);
        if (!mask[t + 1]) continue;
        let mx = -Infinity, sum = 0;
        for (let v = 0; v < L.length; v++) if (L[v] > mx) mx = L[v];
        for (let v = 0; v < L.length; v++) sum += Math.exp(L[v] - mx);
        nll += -(L[ids[t + 1]] - mx - Math.log(sum));
        n++;
      }
      return { nll, n };
    }
  }
  ML.Grad = Grad;

  // Adam with global gradient clipping.
  class Adam {
    constructor(params, { lr = 1e-3, b1 = 0.9, b2 = 0.999, eps = 1e-8, clip = 1 } = {}) {
      this.p = params; this.lr = lr; this.b1 = b1; this.b2 = b2; this.eps = eps; this.clip = clip; this.t = 0;
      this.m = params.map((a) => new Float32Array(a.length));
      this.v = params.map((a) => new Float32Array(a.length));
    }
    step(grads, lr) {
      this.t++;
      const rate = lr == null ? this.lr : lr;
      let norm = 0;
      for (const g of grads) for (let i = 0; i < g.length; i++) norm += g[i] * g[i];
      norm = Math.sqrt(norm);
      const scale = this.clip && norm > this.clip ? this.clip / norm : 1;
      const corr1 = 1 - Math.pow(this.b1, this.t), corr2 = 1 - Math.pow(this.b2, this.t);
      for (let k = 0; k < this.p.length; k++) {
        const p = this.p[k], g = grads[k], m = this.m[k], v = this.v[k];
        for (let i = 0; i < p.length; i++) {
          const gi = g[i] * scale;
          m[i] = this.b1 * m[i] + (1 - this.b1) * gi;
          v[i] = this.b2 * v[i] + (1 - this.b2) * gi * gi;
          p[i] -= (rate * (m[i] / corr1)) / (Math.sqrt(v[i] / corr2) + this.eps);
        }
      }
      return norm;
    }
  }
  ML.Adam = Adam;

  if (typeof module !== 'undefined' && module.exports) module.exports = ML;
  else global.ML = ML;
})(typeof self !== 'undefined' ? self : this);
