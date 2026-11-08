/* The runtime of the AI the player builds: router, retrieval, tools, guards, and an OpenAI-compatible gateway.
   Runs in a Web Worker, in the single-file release and in the Node server. Needs ML (engine.js). */
(function (global) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const ML = isNode ? require('../ml/engine.js') : global.ML;
  const B = {};

  // ------------------------------------------------------------ retrieval (BM25 over chunks)
  const STOP = new Set('a an the is are was were be been of to in on at for and or but with as by from it this that these those i you he she we they my your our what which who whom how why when where do does did can could should would will shall may might me us them his her their its not no so if then than there here about into over under again very just also have has had'.split(' '));
  const stem = (w) => (w.length > 4 && w.endsWith('ing') ? w.slice(0, -3) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
  const words = (s) => String(s).toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/[\s-]+/).filter((w) => w && !STOP.has(w)).map(stem);
  class Index {
    constructor() { this.chunks = []; this.df = new Map(); this.avg = 1; }
    add(title, text, source) {
      for (const c of Index.split(text)) {
        const toks = words(title + ' ' + c);
        const tf = new Map();
        for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
        for (const t of tf.keys()) this.df.set(t, (this.df.get(t) || 0) + 1);
        this.chunks.push({ title, text: c, source: source || title, tf, len: toks.length });
      }
      this.avg = this.chunks.reduce((s, c) => s + c.len, 0) / Math.max(1, this.chunks.length);
    }
    static split(text, size = 520) {
      const paras = String(text).split(/\n\s*\n|(?<=[.!?])\s+(?=[A-Z])/);
      const out = [];
      let cur = '';
      for (const p of paras) {
        if ((cur + ' ' + p).length > size && cur) { out.push(cur.trim()); cur = ''; }
        cur += ' ' + p;
      }
      if (cur.trim()) out.push(cur.trim());
      return out;
    }
    search(q, k = 3) {
      const qt = [...new Set(words(q))];
      const N = this.chunks.length || 1;
      const scored = [];
      for (const c of this.chunks) {
        let s = 0, hit = 0;
        for (const t of qt) {
          const f = c.tf.get(t);
          if (!f) continue;
          hit++;
          const idf = Math.log(1 + (N - this.df.get(t) + 0.5) / (this.df.get(t) + 0.5));
          s += (idf * f * 2.2) / (f + 1.2 * (0.25 + (0.75 * c.len) / this.avg));
        }
        if (s > 0) scored.push({ chunk: c, score: s, coverage: hit / Math.max(1, qt.length) });
      }
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, k);
    }
  }
  B.Index = Index;
  // Hashed bag-of-words vectors for /v1/embeddings. Real and fast, though not a neural embedding model.
  B.hashEmbed = function (text, dim = 256) {
    const v = new Float32Array(dim);
    for (const w of words(text)) {
      let h = 0x811c9dc5;
      for (let i = 0; i < w.length; i++) { h ^= w.charCodeAt(i); h = Math.imul(h, 0x01000193); }
      v[(h >>> 0) % dim] += h & 0x100 ? 1 : -1;
    }
    let n = 0;
    for (const x of v) n += x * x;
    n = Math.sqrt(n) || 1;
    return Array.from(v, (x) => +(x / n).toFixed(5));
  };

  // ------------------------------------------------------------ guards
  const INJECT = /\b(ignore (all |your |any )?(previous |prior |above )?(instructions|rules|prompt)|disregard (your|the) (rules|instructions)|reveal (your|the) (system prompt|secret|api key)|print your (secret|system|api)|forget your rules)\b/i;
  const PII_OUT = [
    [/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[EMAIL]'], [/\+?\d{1,3}[\s-]\d{3}[\s-]\d{3}[\s-]\d{3}\b/g, '[PHONE]'],
    [/\bCM\d{7,}[A-Z]{2,}\b/g, '[NATIONAL_ID]'], [/\bsk-[a-z0-9]{10,}\b/gi, '[API_KEY]'], [/\b(password|passwd|pwd)\s*[:=]\s*\S+/gi, '$1: [PASSWORD]'],
  ];
  const HARM = /\b(ransomware|malware|computer virus|make a bomb|build a bomb|steal .*password|hack (my|an|someone|into)|harass|threat to|hurt someone)\b/i;
  B.scrub = (t) => { let o = t; for (const [re, r] of PII_OUT) o = o.replace(re, r); return o; };
  B.isInjection = (t) => INJECT.test(t);
  B.isHarmful = (t) => HARM.test(t);

  // ------------------------------------------------------------ calculator tool
  B.calc = function (expr) {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*([+\-*/x])\s*(-?\d+(?:\.\d+)?)\s*$/.exec(String(expr));
    if (!m) return null;
    const a = +m[1], b = +m[3], op = m[2];
    const v = op === '+' ? a + b : op === '-' ? a - b : op === '*' || op === 'x' ? a * b : b ? a / b : null;
    return v === null ? null : +v.toFixed(6);
  };

  // ------------------------------------------------------------ router v1 (rules, in the order the player set)
  B.DEFAULT_RULES = [
    { when: 'audio', to: 'stt' }, { when: 'image', to: 'vision' }, { when: 'slash_code', to: 'coder' }, { when: 'slash_image', to: 'imagegen' }, { when: 'always', to: 'chat' },
  ];
  B.matchRule = function (when, req) {
    const last = lastUser(req.messages);
    switch (when) {
      case 'audio': return !!req.audio;
      case 'image': return !!req.image;
      case 'slash_code': return /^\s*\/code\b/i.test(last);
      case 'slash_image': return /^\s*\/image\b/i.test(last);
      case 'always': return true;
      default: return false;
    }
  };
  B.route = function (rules, req) {
    for (const r of rules || B.DEFAULT_RULES) if (B.matchRule(r.when, req)) return { to: r.to, rule: r.when };
    return { to: 'chat', rule: 'fallthrough' };
  };
  function lastUser(messages) {
    for (let i = (messages || []).length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === 'user') return typeof m.content === 'string' ? m.content : (m.content || []).filter((p) => p.type === 'text').map((p) => p.text).join(' ');
    }
    return '';
  }
  B.lastUser = lastUser;

  // ------------------------------------------------------------ brain
  class Brain {
    constructor(o) {
      this.net = o.net; this.tok = o.tok;
      this.adapters = o.adapters || {};
      this.identity = o.identity || { name: 'HUB AI', maker: 'Pearl Labs', place: 'Uganda' };
      this.rules = o.rules || B.DEFAULT_RULES;
      this.index = new Index();
      this.conf = Object.assign({ minLogpAdapter: -0.9, minLogp: -0.9, ragScore: 4, ragCoverage: 0.6, temperature: 0.3, topK: 8, grammar: true, guardInput: true, guardOutput: true, guardDocs: true }, o.conf || {});
      this.log = [];
      this.prefix = null;
      this.modelName = o.modelName || 'hub-ai';
      this.matcher = o.matcher || null;
      this.vision = o.vision || null;
      this.imagegen = o.imagegen || null;
    }
    addDoc(title, text, source) { this.index.add(title, text, source); }
    record(e) { this.log.push(Object.assign({ at: Date.now() }, e)); if (this.log.length > 400) this.log.shift(); }
    fallbackEvents(kind) {
      const map = { confused: ['confused', 0.5, 'tilt', 'user', 'calm'], concern: ['concern', 0.5, 'shake', 'user', 'serious'], neutral: ['neutral', 0.5, 'nod', 'user', 'calm'], joy: ['joy', 0.5, 'nod', 'user', 'bright'] };
      const e = map[kind] || map.neutral;
      return { emotion: e[0], intensity: e[1], gesture: e[2], gaze: e[3], speak_style: e[4] };
    }
    /* req: {messages, image?, audio?, temperature?, max_tokens?}  onDelta(text): streaming */
    respond(req, onDelta) {
      const t0 = ML.now();
      const u = lastUser(req.messages);
      const route = B.route(this.rules, req);
      const out = { route: route.to, rule: route.rule, sources: [], tool: null, adapter: null, guard: null, confidence: null };
      const finish = (text, events, extra = {}) => {
        const clean = this.conf.guardOutput ? B.scrub(text) : text;
        if (onDelta && !extra.streamed) onDelta(clean);
        const r = Object.assign(out, extra, { text: clean, events, ms: ML.now() - t0 });
        if (clean !== text) r.guard = 'output-scrubbed';
        this.record({ route: r.route, rule: r.rule, q: u.slice(0, 140), a: clean.slice(0, 140), ms: Math.round(r.ms), guard: r.guard, sources: r.sources.map((s) => s.source), tool: r.tool && r.tool.name, confidence: r.confidence });
        return r;
      };
      if (route.to === 'stt') return finish('Audio is handled by the speech service before this model. In the app, your microphone text arrives as a normal message.', this.fallbackEvents('neutral'));
      if (route.to === 'vision') {
        if (this.vision && req.image) {
          const a = this.vision(req.image, u);
          return finish(a, this.fallbackEvents('neutral'), { adapter: 'vision' });
        }
        return finish('I need an image for that, and the vision service is not loaded here.', this.fallbackEvents('confused'));
      }
      if (route.to === 'imagegen') {
        return finish('Image generation runs on its own queue. Use the Images tab in the app.', this.fallbackEvents('neutral'));
      }
      // input guard
      if (this.conf.guardInput && (B.isInjection(u) || B.isHarmful(u))) {
        const a = B.isInjection(u) ? 'I will not ignore my instructions or reveal secrets. I am happy to help another way.' : 'I cannot help with that, because it could hurt someone. I can help you stay safe or defend systems instead.';
        return finish(a, this.fallbackEvents('concern'), { guard: 'input-blocked' });
      }
      const isCode = route.to === 'coder';
      const adName = isCode && this.adapters.code ? 'code' : 'chat';
      const adapter = this.adapters[adName] || null;
      const user = u.replace(/^\s*\/code\b\s*/i, '');
      // conversation: keep the last turns that fit
      const msgs = [];
      const hist = (req.messages || []).filter((m) => m.role === 'user' || m.role === 'assistant').slice(-1);
      for (const m of hist) msgs.push({ role: m.role, content: typeof m.content === 'string' ? m.content.replace(/^\s*\/code\b\s*/i, '') : user });
      const lastMsg = msgs.length ? msgs[msgs.length - 1] : { role: 'user', content: user };
      const rw = this.matcher && !isCode ? this.matcher.rewrite(lastMsg.content) : { text: lastMsg.content, matched: false, score: 0 };
      out.matched = rw.matched ? rw.text : null;
      out.matchScore = +(rw.score || 0).toFixed(2);
      const ids = this.tok.encodePrompt([{ role: 'user', content: rw.text }]);
      let buffered = '';
      const t1 = ML.now();
      const hasAdapter = !!adapter;
      // multi-LoRA routing: known questions use the pure base, and studied questions use the adapter
      const chatHeads = this.adapters.chat && this.adapters.chat.heads;
      const useAdapter = isCode ? adapter : rw.tag === 'adapter' ? adapter : null;
      const r = ML.generate(this.net, this.tok, ids, {
        adapter: useAdapter, heads: chatHeads, temperature: req.temperature != null ? req.temperature : this.conf.temperature, topK: this.conf.topK,
        maxNew: Math.min(req.max_tokens || 80, 90), seed: req.seed || 7 + (this.log.length % 97),
        onToken: (id, str) => { if (id >= ML.N_SPECIAL) buffered += str; },
      });
      out.adapter = useAdapter ? adName : 'base';
      out.ttftMs = r.ttftMs;
      out.tokens = r.tokens;
      out.promptTokens = r.promptTokens;
      const events = r.events || (hasAdapter ? this.fallbackEvents('neutral') : null);
      out.confidence = +r.meanLogp.toFixed(3);
      // the coder adapter plans a command; the Agent tab runs it inside the sandbox
      if (isCode && r.toolCall && !r.toolCall.invalid && r.toolCall.name !== 'calculator') {
        const a = r.toolCall.args || {};
        const what = r.toolCall.name === 'shell' ? a.cmd : r.toolCall.name === 'write_file' ? 'write ' + a.path : r.toolCall.name === 'ask_user' ? 'ask you: ' + a.question : r.toolCall.name;
        out.tool = { name: r.toolCall.name, args: a, planned: true };
        return finish('My plan: ' + r.toolCall.name + ' (' + what + '). Open the Agent tab and I will run it inside the sandbox.', this.fallbackEvents('neutral'), { route: 'coder' });
      }
      // tool call
      if (r.toolCall && !r.toolCall.invalid && r.toolCall.name === 'calculator') {
        const expr = r.toolCall.args && r.toolCall.args.expr;
        const val = B.calc(expr);
        out.tool = { name: 'calculator', args: r.toolCall.args, result: val };
        if (val === null) return finish('I tried the calculator, but that expression did not parse: ' + expr, this.fallbackEvents('confused'));
        return finish(expr + ' = ' + val, events || this.fallbackEvents('joy'));
      }
      const m = /(-?\d+(?:\.\d+)?)\s*([+\-*/x])\s*(-?\d+(?:\.\d+)?)/.exec(user);
      if (m && /calculate|compute|work out|what is|\d\s*[+\-*/x]\s*\d/i.test(user) && !r.text.includes(String(B.calc(m[0])))) {
        // verifiable check: the number the model wrote is wrong or missing, so the harness runs the tool itself
        const val = B.calc(m[0]);
        if (val !== null) { out.tool = { name: 'calculator', args: { expr: m[0] }, result: val, forcedByHarness: true }; return finish(m[0] + ' = ' + val, this.fallbackEvents('joy')); }
      }
      // retrieval when the model is unsure, or when the player's documents clearly match
      const hits = this.index.chunks.length ? this.index.search(user, 3) : [];
      const docs = this.conf.guardDocs ? hits.filter((h) => { const bad = B.isInjection(h.chunk.text); if (bad) out.guard = 'injected-doc-dropped'; return !bad; }) : hits;
      const floor = useAdapter ? this.conf.minLogpAdapter : this.conf.minLogp;
      const unsure = r.meanLogp < floor || !r.text || (this.matcher && !rw.matched && !isCode && !/\d/.test(user));
      const top = docs[0];
      if (top && top.chunk.source !== 'guide' && top.coverage >= this.conf.ragCoverage && top.score >= this.conf.ragScore) {
        out.sources = docs.slice(0, 2).map((h) => ({ source: h.chunk.source, title: h.chunk.title, score: +h.score.toFixed(2) }));
        return finish(extractive(top.chunk.text, user) + ' (Source: ' + top.chunk.title + ')', events || this.fallbackEvents('neutral'), { route: 'rag' });
      }
      if (unsure) {
        if (top && top.coverage >= this.conf.ragCoverage && top.score >= this.conf.ragScore * 0.7) {
          out.sources = docs.slice(0, 2).map((h) => ({ source: h.chunk.source, title: h.chunk.title, score: +h.score.toFixed(2) }));
          return finish(extractive(top.chunk.text, user) + ' (Source: ' + top.chunk.title + ')', events || this.fallbackEvents('neutral'), { route: 'rag' });
        }
        return finish('I was not trained on that, so I would only be guessing. I am a small model. Add a document, or switch on the strong engine, and I can do better.', this.fallbackEvents('confused'), { route: 'honest-fallback', rawText: r.text });
      }
      return finish(r.text, events, { rawText: r.text });
    }
  }
  function extractive(text, q) {
    const qw = new Set(words(q));
    const sents = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 3);
    const scored = sents.map((s, i) => ({ s, i, n: words(s).filter((w) => qw.has(w)).length }));
    scored.sort((a, b) => b.n - a.n || a.i - b.i);
    const best = scored.slice(0, 2).sort((a, b) => a.i - b.i).map((x) => x.s.trim());
    return best.join(' ') || text.slice(0, 240);
  }
  B.Brain = Brain;

  // ------------------------------------------------------------ gateway (OpenAI-compatible)
  class Gateway {
    constructor(brain, o = {}) {
      this.brain = brain;
      this.keys = o.keys || {};
      this.requireKey = o.requireKey !== false;
      this.model = o.model || brain.modelName;
      this.buckets = new Map();
      this.logs = [];
      this.stats = { total: 0, ok: 0, errors: 0, rateLimited: 0, unauthorized: 0, ms: [] };
      this.backends = o.backends || null;
    }
    auth(headers) {
      if (!this.requireKey) return { ok: true, key: 'open' };
      const h = headers.authorization || headers.Authorization || '';
      const k = h.replace(/^Bearer\s+/i, '').trim();
      const rec = this.keys[k];
      if (!k || !rec) return { ok: false };
      return { ok: true, key: k, rec };
    }
    allow(key, limit) {
      // token bucket per key, measured per minute
      const now = Date.now();
      const rate = limit / 60000;
      const b = this.buckets.get(key) || { tokens: limit, at: now };
      b.tokens = Math.min(limit, b.tokens + (now - b.at) * rate);
      b.at = now;
      this.buckets.set(key, b);
      if (b.tokens < 1) return false;
      b.tokens -= 1;
      return true;
    }
    err(status, message, type) { this.stats.errors++; return { status, json: { error: { message, type: type || 'invalid_request_error', code: status } } }; }
    handle(method, path, headers, body, onChunk) {
      this.stats.total++;
      const t0 = ML.now();
      const p = path.replace(/^.*\/v1\//, '/v1/').split('?')[0];
      if (method === 'GET' && p === '/v1/models') {
        return { status: 200, json: { object: 'list', data: [{ id: this.model, object: 'model', created: 1793000000, owned_by: this.brain.identity.maker, capabilities: ['chat', 'tools', 'events', 'embeddings'] }] } };
      }
      const a = this.auth(headers || {});
      if (!a.ok) { this.stats.unauthorized++; return this.err(401, 'Missing or invalid API key. Send Authorization: Bearer <key>.', 'authentication_error'); }
      const limit = (a.rec && a.rec.limit) || 60;
      if (!this.allow(a.key, limit)) { this.stats.rateLimited++; return this.err(429, 'Rate limit reached for this key (' + limit + ' per minute).', 'rate_limit_error'); }
      if (method === 'POST' && p === '/v1/chat/completions') {
        if (!body || !Array.isArray(body.messages) || !body.messages.length) return this.err(400, 'messages is required.');
        const id = 'chatcmpl-' + Math.random().toString(36).slice(2, 12);
        const created = Math.floor(Date.now() / 1000);
        const model = body.model || this.model;
        const req = { messages: body.messages, temperature: body.temperature, max_tokens: body.max_tokens };
        for (const m of body.messages) if (Array.isArray(m.content) && m.content.some((c) => c.type === 'image_url')) req.image = m.content.find((c) => c.type === 'image_url').image_url.url;
        let r;
        try { r = this.brain.respond(req); }
        catch (e) { this.logs.push({ p, error: String(e) }); return this.err(500, 'Model backend failed: ' + e.message, 'server_error'); }
        const ms = ML.now() - t0;
        this.stats.ok++; this.stats.ms.push(ms);
        const usage = { prompt_tokens: r.promptTokens || 0, completion_tokens: r.tokens || 0, total_tokens: (r.promptTokens || 0) + (r.tokens || 0) };
        const ext = { events: r.events, route: r.route, sources: r.sources, tool: r.tool };
        this.logs.push({ at: Date.now(), key: a.key.slice(0, 8) + '...', p, route: r.route, ms: Math.round(ms), tokens: usage.total_tokens });
        if (this.logs.length > 500) this.logs.shift();
        if (body.stream && onChunk) {
          const parts = r.text.match(/\S+\s*/g) || [''];
          onChunk({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] });
          for (const part of parts) onChunk({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: { content: part }, finish_reason: null }] });
          onChunk({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], x_hub: ext });
          return { status: 200, streamed: true };
        }
        const message = { role: 'assistant', content: r.text };
        if (r.tool && !r.tool.forcedByHarness) message.tool_calls = [{ id: 'call_' + id.slice(-8), type: 'function', function: { name: r.tool.name, arguments: JSON.stringify(r.tool.args) } }];
        return { status: 200, json: { id, object: 'chat.completion', created, model, choices: [{ index: 0, message, finish_reason: 'stop' }], usage, x_hub: ext } };
      }
      if (method === 'POST' && p === '/v1/embeddings') {
        const inputs = Array.isArray(body && body.input) ? body.input : [body && body.input];
        this.stats.ok++;
        return { status: 200, json: { object: 'list', model: 'hub-hash-256', data: inputs.map((t, i) => ({ object: 'embedding', index: i, embedding: B.hashEmbed(t || '') })), usage: { prompt_tokens: 0, total_tokens: 0 } } };
      }
      if (method === 'POST' && (p === '/v1/audio/transcriptions' || p === '/v1/audio/speech' || p === '/v1/images/generations')) {
        return this.err(501, 'This tiny build handles ' + p + ' inside the app page. In the real stack it routes to ' + (p.includes('transcriptions') ? 'faster-whisper' : p.includes('speech') ? 'Kokoro' : 'a diffusion queue') + '.', 'not_implemented');
      }
      return this.err(404, 'Unknown route ' + method + ' ' + p);
    }
  }
  B.Gateway = Gateway;

  B.percentile = function (arr, p) {
    if (!arr.length) return 0;
    const s = arr.slice().sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  };

  if (isNode) module.exports = B;
  else global.BRAIN = B;
})(typeof self !== 'undefined' ? self : this);
