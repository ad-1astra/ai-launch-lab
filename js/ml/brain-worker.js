/* Runs the model off the main thread so the 3D scene stays smooth during evaluation and chat. */
importScripts('engine.js', '../lab/evalset.js', '../lab/brain.js');
(function () {
  'use strict';
  const ML = self.ML, E = self.EVALSET, B = self.BRAIN;
  const S = { base: null, tok: null, adapters: {}, brain: null, identity: null, quant: null, bits: 32, gateway: null };

  function serving() { return S.quant ? S.quant.net : S.base; }
  function rebuild(conf) {
    S.matcher = new ML.Matcher(S.questions || []);
    S.matcher.add(S.extraQuestions || [], 'adapter');
    S.brain = new B.Brain({ net: serving(), tok: S.tok, adapters: S.adapters, identity: S.identity, rules: S.rules, conf: Object.assign({}, S.conf, conf || {}), modelName: S.modelName, matcher: S.matcher });
    for (const d of S.docs || []) S.brain.addDoc(d.title, d.text, d.source);
    S.gateway = new B.Gateway(S.brain, { keys: S.keys || {}, requireKey: true, model: S.modelName });
  }
  const send = (m, t) => self.postMessage(m, t);

  self.onmessage = async (ev) => {
    const m = ev.data;
    try {
      if (m.type === 'init') {
        const { tensors, meta } = ML.parseSafetensors(m.base);
        const cfg = { V: +meta.V, d: +meta.d, L: +meta.L, H: +meta.H, ctx: +meta.ctx, m: +meta.m };
        S.base = new ML.GPT(cfg, tensors);
        S.tok = new ML.Tokenizer(m.tok);
        S.identity = m.identity;
        S.modelName = m.modelName || 'hub-ai';
        S.docs = m.docs || [];
        S.rules = m.rules || B.DEFAULT_RULES;
        S.conf = m.conf || {};
        S.keys = m.keys || {};
        S.questions = m.questions || [];
        rebuild();
        send({ id: m.id, type: 'done', result: { cfg, params: S.base.paramCount(), vocab: S.tok.size } });
      } else if (m.type === 'adapter') {
        if (m.buf) S.adapters[m.name] = ML.parseAdapter(m.buf);
        else delete S.adapters[m.name];
        rebuild();
        send({ id: m.id, type: 'done', result: { adapters: Object.keys(S.adapters) } });
      } else if (m.type === 'config') {
        if (m.identity) S.identity = m.identity;
        if (m.rules) S.rules = m.rules;
        if (m.docs) S.docs = m.docs;
        if (m.keys) S.keys = m.keys;
        if (m.extraQuestions) S.extraQuestions = m.extraQuestions;
        if (m.modelName) S.modelName = m.modelName;
        if (m.conf) S.conf = Object.assign({}, S.conf, m.conf);
        rebuild();
        send({ id: m.id, type: 'done', result: true });
      } else if (m.type === 'quantize') {
        if (m.bits >= 32) { S.quant = null; S.bits = 32; }
        else { S.quant = ML.quantize(S.base, m.bits); S.bits = m.bits; }
        rebuild();
        send({ id: m.id, type: 'done', result: { bits: S.bits, bytes: S.quant ? S.quant.bytes : ML.floatBytes(S.base) } });
      } else if (m.type === 'chat') {
        const r = S.brain.respond(m.req);
        send({ id: m.id, type: 'done', result: r });
      } else if (m.type === 'gateway') {
        const chunks = [];
        const r = S.gateway.handle(m.method, m.path, m.headers || {}, m.body, (c) => chunks.push(c));
        send({ id: m.id, type: 'done', result: Object.assign({}, r, { chunks: chunks.length ? chunks : undefined, stats: S.gateway.stats }) });
      } else if (m.type === 'generate') {
        const ad = m.adapter ? S.adapters[m.adapter] : null;
        let msgs = m.messages;
        if (msgs && m.useMatcher && S.matcher) msgs = [{ role: 'user', content: S.matcher.rewrite(msgs[msgs.length - 1].content).text }];
        const ids = m.promptIds || S.tok.encodePrompt(msgs);
        const r = ML.generate(serving(), S.tok, ids, Object.assign({ adapter: ad }, m.opts));
        delete r.session;
        send({ id: m.id, type: 'done', result: r });
      } else if (m.type === 'eval') {
        const ad = m.adapter ? S.adapters[m.adapter] : null;
        let net = serving();
        const res = await E.run(ML, net, S.tok, ad, m.identity || S.identity, {
          grammar: !!m.grammar, prompts: m.prompts, matcher: m.noMatcher ? null : S.matcher, routed: !m.forced,
          onProgress: (i, n, row) => { if (i % 2 === 0 || i === n) send({ id: m.id, type: 'progress', i, n, row }); },
        });
        send({ id: m.id, type: 'done', result: res });
      } else if (m.type === 'mergeTest') {
        // merged weights must give the same answer as base + adapter
        const ad = S.adapters[m.adapter];
        const merged = ML.mergeAdapter(S.base, ad);
        const ids = S.tok.encodePrompt([{ role: 'user', content: m.prompt }]);
        const a = S.base.session(ad), b = merged.session(null);
        let maxDiff = 0, La, Lb;
        for (const i of ids) { La = a.step(i); Lb = b.step(i); }
        for (let v = 0; v < La.length; v++) maxDiff = Math.max(maxDiff, Math.abs(La[v] - Lb[v]));
        const buf = ML.writeSafetensors(merged.w, Object.assign({ format: 'merged' }, S.base.cfg));
        send({ id: m.id, type: 'done', result: { maxDiff, buf, bytes: buf.byteLength } }, [buf]);
      } else if (m.type === 'prefixTest') {
        // real cost of re-reading a long shared prompt, with and without a prefix cache
        const ad = m.adapter ? S.adapters[m.adapter] : null;
        const net = serving();
        const sys = S.tok.encode(m.system);
        const pre = [S.tok.SYSTEM, ...sys, S.tok.END];
        const sessA = net.session(ad);
        let t0 = ML.now();
        for (const i of pre) sessA.step(i);
        const coldPrefix = ML.now() - t0;
        const q = S.tok.encode(m.question);
        const tail = [S.tok.USER, ...q, S.tok.END, S.tok.ASSISTANT];
        t0 = ML.now();
        const cold = net.session(ad);
        for (const i of [...pre, ...tail]) cold.step(i);
        const coldMs = ML.now() - t0;
        t0 = ML.now();
        const warm = net.session(ad);
        warm.copyPrefixFrom(sessA, pre.length);
        for (const i of tail) warm.step(i);
        const warmMs = ML.now() - t0;
        send({ id: m.id, type: 'done', result: { coldMs, warmMs, prefixTokens: pre.length, coldPrefix } });
      } else if (m.type === 'nll') {
        // per-token loss on rows, used by DPO reference values and failure ranking
        const ad = m.adapter ? S.adapters[m.adapter] : null;
        const G = new ML.Grad(S.base, ad || ML.newAdapter(S.base, { rank: 1, alpha: 0, addedTokens: false }));
        const per = m.seqs.map((s) => G.nll(s.ids, s.mask).nll);
        send({ id: m.id, type: 'done', result: per });
      }
    } catch (e) {
      send({ id: m.id, type: 'error', error: e.message + '\n' + e.stack });
    }
  };
})();
