/* Zone 7: Server Hall (weeks 10-11, guide Parts 7 and 8). Real merge, real quantisation, a real gateway. Cluster traffic is simulated from real per-request timing. */
(function () {
  'use strict';
  const h = AC.h, W = LAB.world, E = EVALSET;
  AC.boot({ game: 'servers', week: 7, topic: 'Weeks 10-11 · Parts 7 and 8', title: 'Server Hall', help: () => AC.ui.card({ eyebrow: 'How to play', title: 'From a file to a service', body: ['Merge and quantisation here change real weights, and the re-test is real. The gateway checks real keys and rate limits. Cluster traffic is simulated, using your real request time.'] }) });
  const { S, scene } = W.hall({ size: 26, accent: 0xb48cff, cam: { dist: 26, theta: -0.3, phi: 1.1, target: new THREE.Vector3(-5, 3, 0) } });
  const racks = [];
  for (let i = 0; i < 4; i++) { const r = W.rack(0xb48cff, 6); r.position.set(-14 + i * 4, 0, -14); scene.add(r); racks.push(r); }
  const blocks = {};
  const packets = W.packets(scene);
  const LAYOUT = {
    client: [-14, 8], tls: [-14, 3], gateway: [-9, 3], redis: [-9, -3], postgres: [-4, -3], router: [-4, 3], vllm: [2, 3], vllm2: [2, -3], whisper: [7, 3], kokoro: [7, -3], fallback: [12, 3], metrics: [12, -3],
  };
  const COLORS = { client: 0x93a7bf, tls: 0x4be38a, gateway: 0x2fe0cf, redis: 0xff5a4f, postgres: 0x7aa2ff, router: 0xff70d8, vllm: 0xb48cff, vllm2: 0xb48cff, whisper: 0xffb547, kokoro: 0xff8a3d, fallback: 0x9fb2c7, metrics: 0x4be38a };
  const NAMES = { client: 'Clients', tls: 'Caddy TLS', gateway: 'LiteLLM gateway', redis: 'Redis', postgres: 'Postgres', router: 'Router', vllm: 'vLLM node 1', vllm2: 'vLLM node 2', whisper: 'faster-whisper', kokoro: 'Kokoro', fallback: 'CPU fallback', metrics: 'Prometheus' };
  for (const k in LAYOUT) {
    const g = new THREE.Group();
    const m = W.box(3.4, 2, 3, W.std(0x1c2c42), 0, 1, 0);
    const lamp = W.glow(COLORS[k], 0.1);
    g.add(m, W.box(3, 0.2, 0.1, lamp, 0, 1.5, 1.52), W.sign(NAMES[k], { pos: [0, 2.7, 0], size: 0.5 }));
    g.position.set(LAYOUT[k][0], k === 'client' ? 0 : 0, LAYOUT[k][1]);
    g.visible = k === 'client';
    scene.add(g);
    blocks[k] = { g, lamp, on: k === 'client' };
  }
  const posOf = (k) => { const p = blocks[k].g.position; return new THREE.Vector3(p.x, 2, p.z); };
  const setBlock = (k, on) => { blocks[k].on = on; blocks[k].g.visible = on; };
  let load = 0;
  S.onFrame((dt, t) => {
    packets.update(dt);
    racks.forEach((r) => r.setLoad(0.1 + load, t));
    for (const k in blocks) blocks[k].lamp.emissiveIntensity = blocks[k].on ? 0.5 + 0.5 * Math.sin(t * 3 + k.length) : 0;
    MR.update(dt);
  });

  const assets = async () => {
    const [buf, id, code, evalSet] = await Promise.all([LAB.get('adapter:chat'), LAB.identity(), LAB.get('adapter:code'), LAB.get('eval')]);
    if (buf) { await LAB.model(); await LAB.rpc({ type: 'config', identity: id }); await LAB.rpc({ type: 'adapter', name: 'chat', buf: buf.slice(0) }); if (code) await LAB.rpc({ type: 'adapter', name: 'code', buf: code.slice(0) }); }
    return { buf, id, code, evalSet };
  };

  // ---------------------------------------------- Mission 1: merge and quantise
  const quantise = {
    id: 'quantise', title: 'Merge, quantise, re-test',
    objective: 'Prove the merge, shrink the model, and ship only what passes the re-test',
    story: 'Your adapter needs to become a file people can run. Merge it, quantise it, and then do what most people forget: test the exact artefact you ship. Smaller is only better if it still works.',
    learn: [
      { t: 'Merge', p: 'Bake the adapter into the base: W + (alpha/rank) A B. The function must not change.', f: 'Export safetensors' },
      { t: 'Quantise', p: 'FP8, AWQ, GPTQ or GGUF roughly halves memory or better. Always re-run your eval on the quantised model.', f: 'Run the eval on the artefact you ship' },
      { t: 'Prefix caching', p: 'Reuse system prompts and long shared context.', f: 'Less work per request' },
    ],
    proved: 'You merged and quantised real weights and measured the result on your sealed test. In a browser the speed barely changes, because JavaScript is not a GPU, but the memory drop is real. Part 6.1 step 6 and Part 8.3.',
    tip: 'If a build regresses, ship a build with more bits.',
    get quiz() { return AC.QUESTIONS.find((q) => q.id === 'quantise'); },
    async start(api) {
      LAB.closeBench();
      const { buf, id, evalSet } = await assets();
      if (!buf) return LAB.requireMsg('Run the real LoRA fine-tune first.', 'training.html#lora');
      const st = api.state;
      st.tested = {};
      for (const k in blocks) setBlock(k, k === 'client');
      const b = LAB.bench('Weights to artefact', 'Each button changes real numbers.');
      const merged = h('div');
      const mergeBtn = h('button', { class: 'ac-btn', type: 'button' }, 'Merge and compare');
      mergeBtn.addEventListener('click', async () => {
        mergeBtn.disabled = true;
        const r = await LAB.rpc({ type: 'mergeTest', adapter: 'chat', prompt: 'What is LoRA?' });
        st.maxDiff = r.maxDiff;
        st.mergedBytes = r.bytes;
        await LAB.set('artifact:merged', r.buf);
        AC.audio.good();
        merged.innerHTML = '';
        merged.append(h('p', { class: 'c-green' }, 'Largest difference in any output score between base + adapter and the merged file: ' + r.maxDiff.toExponential(2) + '. It is the same function. Merged file: ' + (r.bytes / 1e6).toFixed(2) + ' MB.'));
        api.progress(0.15);
        quant();
      });
      b.add(LAB.tag('real'), h('h3', {}, 'Step 1: merge'), mergeBtn, merged);
      const qArea = h('div');
      b.add(qArea);
      const prompts = () => E.PROMPTS.concat(evalSet.custom || []);
      const quant = () => {
        qArea.innerHTML = '';
        const tr = h('tbody');
        const table = h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['Build', 'Size', 'Sealed test', 'General', 'Speed'].map((c) => h('th', {}, c)))), tr));
        const status = h('p', { class: 'mono c-cyan' }, '');
        const opts = [{ bits: 32, name: 'Float 32 (no quantisation)' }, { bits: 8, name: 'Int 8 (like FP8)' }, { bits: 5, name: 'Int 5' }, { bits: 4, name: 'Int 4 (aggressive)' }];
        const btns = h('div', { class: 'hub-row' });
        const choice = h('div', { class: 'cand' });
        const tryBuild = async (o, bt) => {
          bt.disabled = true;
          [...btns.children].forEach((x) => (x.disabled = true));
          status.textContent = 'Quantising real weights to ' + o.bits + ' bits...';
          const q = await LAB.rpc({ type: 'quantize', bits: o.bits });
          load = 1;
          const ev = await LAB.rpc({ type: 'eval', adapter: 'chat', identity: id, prompts: prompts() }, (m) => { status.textContent = 'Re-testing that exact build on the sealed set: ' + m.i + ' of ' + m.n; });
          load = 0;
          st.tested[o.bits] = { bits: o.bits, bytes: q.bytes, overall: ev.overall, general: ev.cats.general, schema: ev.schema, tps: ev.tokPerSec };
          tr.appendChild(h('tr', {}, [o.name, (q.bytes / 1e6).toFixed(2) + ' MB', LAB.pct(ev.overall, 1), LAB.pct(ev.cats.general || 0), ev.tokPerSec.toFixed(0) + ' tok/s'].map((c) => h('td', {}, c))));
          status.textContent = '';
          [...btns.children].forEach((x) => { if (!x.dataset.used) x.disabled = false; });
          bt.dataset.used = '1'; bt.disabled = true;
          api.progress(0.15 + 0.15 * Object.keys(st.tested).length);
          drawChoices();
        };
        const drawChoices = () => {
          choice.innerHTML = '';
          if (Object.keys(st.tested).length < 3) { choice.append(h('p', { class: 'dim' }, 'Test at least three builds, then pick the one to ship.')); return; }
          const ref = st.tested[32];
          Object.values(st.tested).sort((a, c) => a.bytes - c.bytes).forEach((t) => {
            const bt = h('button', { type: 'button', class: 'cand-b' }, h('b', {}, 'Ship the ' + t.bits + '-bit build'), h('span', { class: 'mono dim' }, (t.bytes / 1e6).toFixed(2) + ' MB, sealed test ' + LAB.pct(t.overall, 1)));
            bt.addEventListener('click', async () => {
              if (!ref) return AC.ui.toast('Test the float build too, so you have a reference', 'var(--amber)');
              const drop = ref.overall - t.overall;
              if (drop > 0.05) { bt.classList.add('wrong'); AC.audio.bad(); return AC.fact('Regression', 'This build lost ' + Math.round(drop * 100) + ' points on the sealed test. You refuse to ship regressions.', { tag: 'Refused', color: 'var(--red)' }); }
              const small = Object.values(st.tested).filter((x) => ref.overall - x.overall <= 0.05).sort((a, c) => a.bytes - c.bytes)[0];
              if (t !== small) { bt.classList.add('wrong'); AC.audio.bad(); return AC.fact('You can go smaller', 'The ' + small.bits + '-bit build also passes, at ' + (small.bytes / 1e6).toFixed(2) + ' MB.', { tag: 'Too big', color: 'var(--amber)' }); }
              bt.classList.add('right');
              await LAB.rpc({ type: 'quantize', bits: t.bits });
              const pc = await LAB.rpc({ type: 'prefixTest', adapter: 'chat', system: 'You are a helpful assistant built to answer questions about AI, robotics and code. Be brief and be kind. Always say when you are unsure about something.', question: 'What is LoRA?' });
              await LAB.update('artifact', { bits: t.bits, bytes: t.bytes, overall: t.overall, schema: t.schema, general: t.general, floatBytes: ref.bytes, floatOverall: ref.overall, tps: t.tps, mergeDiff: st.maxDiff, prefixCold: pc.coldMs, prefixWarm: pc.warmMs, at: Date.now() });
              const ratio = ref.bytes / t.bytes;
              qArea.append(h('p', { class: 'c-green' }, 'Prefix cache, measured on your model: reading the shared prompt plus the question took ' + pc.coldMs.toFixed(1) + ' ms cold and ' + pc.warmMs.toFixed(1) + ' ms with the cache.'));
              api.progress(1);
              api.win(t.bits <= 8 ? 3 : 2, 'Shipping ' + t.bits + ' bits: ' + (t.bytes / 1e6).toFixed(2) + ' MB, ' + ratio.toFixed(1) + 'x smaller, sealed test ' + LAB.pct(t.overall, 1) + ' against ' + LAB.pct(ref.overall, 1) + ' before.');
            });
            choice.appendChild(bt);
          });
        };
        for (const o of opts) { const bt = h('button', { class: 'ac-btn ghost small', type: 'button' }, o.name); bt.addEventListener('click', () => tryBuild(o, bt)); btns.appendChild(bt); }
        qArea.append(h('h3', {}, 'Step 2: quantise and re-test'), LAB.tag('real'), btns, status, table, h('h3', {}, 'Step 3: ship one'), choice);
        drawChoices();
      };
    },
  };

  // ---------------------------------------------- Mission 2: stack, gateway, load test
  const PIECES = [
    { id: 'tls', name: 'Caddy with TLS', must: true, why: 'Put nginx or Caddy in front with TLS.' }, { id: 'gateway', name: 'LiteLLM gateway', must: true, why: 'Keys, budgets, rate limits, logging, fallbacks, routing.' },
    { id: 'redis', name: 'Redis', must: true, why: 'Rate limits and caches.' }, { id: 'postgres', name: 'Postgres', must: true, why: 'Keys and usage.' }, { id: 'router', name: 'Router rules', must: true, why: 'Your rule table from the Blueprint Hall.' },
    { id: 'vllm', name: 'vLLM node 1', must: true, why: 'LLM and VLM on GPU.' }, { id: 'whisper', name: 'faster-whisper', must: true, why: 'Speech to text.' }, { id: 'kokoro', name: 'Kokoro', must: true, why: 'Text to speech.' },
    { id: 'fallback', name: 'CPU fallback (llama.cpp)', must: true, why: 'So the service degrades instead of failing.' }, { id: 'metrics', name: 'Prometheus + Grafana', must: true, why: 'You cannot run what you cannot see.' }, { id: 'vllm2', name: 'vLLM node 2', must: false, why: 'Replicate when one node is not enough.' },
  ];
  const stack = {
    id: 'stack', title: 'Compose the stack',
    objective: 'Assemble the stack, pass the real gateway checks, and survive 2x traffic',
    story: 'One GPU server and Docker Compose. Keys from day one. Then the gate: real requests with bad keys, floods and dead backends, and finally a load test at twice your expected traffic.',
    learn: [
      { t: 'Start simple', p: 'One GPU server with Docker Compose: vLLM, gateway, Whisper, Kokoro, Redis, Postgres.', f: 'TLS, API keys and per-key limits from day one' },
      { t: 'Measure the system', p: 'p50 and p95 latency, throughput, error rate, GPU cost per 1,000 requests.', f: 'Load tests at 2x expected traffic' },
    ],
    proved: 'Your gateway checked real keys and enforced a real token-bucket rate limit, and your model answered through it. The cluster numbers came from a queue simulation that used your real request time. Part 8.2 and 8.4.',
    tip: 'If p95 is too high, try continuous batching, a second node, or streaming. If errors rise when a backend dies, add the fallback.',
    get quiz() { return AC.QUESTIONS.find((q) => q.id === 'stack'); },
    async start(api) {
      LAB.closeBench();
      const { buf, id } = await assets();
      if (!buf) return LAB.requireMsg('Run the real LoRA fine-tune first.', 'training.html#lora');
      const art = await LAB.get('artifact');
      if (!art) return LAB.requireMsg('Merge, quantise and re-test first.', 'servers.html#quantise');
      const router = await LAB.get('router');
      await LAB.rpc({ type: 'quantize', bits: art.bits });
      for (const k in blocks) setBlock(k, k === 'client');
      const st = api.state;
      st.on = {};
      const b = LAB.bench('Step 1: docker-compose.yml', 'Add each service. Watch it appear in the hall.');
      const yaml = h('pre', { class: 'term' }, '');
      const drawYaml = () => {
        const lines = ['services:'];
        for (const p of PIECES) if (st.on[p.id] && p.id !== 'router') lines.push('  ' + p.id + ':', '    image: ' + ({ tls: 'caddy:2', gateway: 'litellm/litellm', redis: 'redis:7', postgres: 'postgres:16', vllm: 'vllm/vllm-openai', vllm2: 'vllm/vllm-openai', whisper: 'faster-whisper-server', kokoro: 'kokoro-fastapi', fallback: 'llama.cpp-server', metrics: 'prom/prometheus' }[p.id] || p.id));
        yaml.textContent = lines.join('\n');
      };
      const chips = h('div', { class: 'chips' }, PIECES.map((p) => {
        const bt = h('button', { type: 'button', class: 'chip' }, p.name);
        bt.addEventListener('click', () => {
          st.on[p.id] = !st.on[p.id];
          bt.classList.toggle('right', st.on[p.id]);
          setBlock(p.id, st.on[p.id]);
          if (st.on[p.id]) { AC.audio.ping(); AC.fact(p.name, p.why, { tag: 'Service', ms: 4000 }); }
          drawYaml();
        });
        return bt;
      }));
      const nextBtn = h('button', { class: 'ac-btn', type: 'button' }, 'Bring it up');
      nextBtn.addEventListener('click', () => {
        const missing = PIECES.filter((p) => p.must && !st.on[p.id]);
        if (missing.length) { AC.audio.bad(); return AC.fact('Not ready', 'Missing: ' + missing.map((m) => m.name).join(', ') + '. ' + missing[0].why, { tag: 'Compose', color: 'var(--amber)' }); }
        step2();
      });
      b.add(LAB.tag('sim'), chips, yaml, h('div', { class: 'ac-actions' }, nextBtn));
      drawYaml();
      const pipeline = async (color) => {
        const path = ['client', 'tls', 'gateway', 'router', 'vllm'];
        for (let i = 0; i < path.length - 1; i++) { await new Promise((r) => packets.fire(posOf(path[i]), posOf(path[i + 1]), color, 0.16, r)); }
      };
      const step2 = async () => {
        b.clear();
        api.progress(0.25);
        const key = 'hub-' + Math.random().toString(36).slice(2, 12);
        const keys = { [key]: { name: 'developer', limit: 8 } };
        await LAB.rpc({ type: 'config', keys, rules: router && router.rules ? router.rules.concat([]) : undefined, modelName: id.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-v0.9', conf: { minLogp: -0.4 } });
        const out = h('div');
        const checks = [
          { name: 'No API key is refused', req: { method: 'POST', path: '/v1/chat/completions', headers: {}, body: { messages: [{ role: 'user', content: 'hi' }] } }, want: 401 },
          { name: 'A wrong key is refused', req: { method: 'POST', path: '/v1/chat/completions', headers: { authorization: 'Bearer nope' }, body: { messages: [{ role: 'user', content: 'hi' }] } }, want: 401 },
          { name: 'Your key gets a reply in OpenAI shape', req: { method: 'POST', path: '/v1/chat/completions', headers: { authorization: 'Bearer ' + key }, body: { messages: [{ role: 'user', content: 'Who are you?' }] } }, want: 200 },
          { name: 'GET /v1/models lists the model', req: { method: 'GET', path: '/v1/models', headers: {} }, want: 200 },
          { name: 'An unknown route gives 404', req: { method: 'POST', path: '/v1/nothing', headers: { authorization: 'Bearer ' + key }, body: {} }, want: 404 },
        ];
        const rows = [];
        let sample = null;
        for (const c of checks) {
          await pipeline(0x2fe0cf);
          const r = await LAB.rpc(Object.assign({ type: 'gateway' }, c.req));
          if (c.want === 200 && r.json && r.json.choices) sample = r.json;
          rows.push({ cls: r.status === c.want ? 'ok' : 'no', cells: [c.name, String(r.status), r.status === c.want ? 'pass' : 'expected ' + c.want] });
        }
        // real flood: limit is 8 per minute for this key
        let limited = 0;
        for (let i = 0; i < 14; i++) { const r = await LAB.rpc({ type: 'gateway', method: 'POST', path: '/v1/chat/completions', headers: { authorization: 'Bearer ' + key }, body: { messages: [{ role: 'user', content: 'hi' }] } }); if (r.status === 429) limited++; }
        rows.push({ cls: limited > 0 ? 'ok' : 'no', cells: ['A flood of 14 requests is rate limited', limited + ' got 429', limited > 0 ? 'pass' : 'fail'] });
        const passed = rows.every((r) => r.cls === 'ok');
        out.append(LAB.tag('real'), h('h3', {}, 'Step 2: real gateway checks'), LAB.table(['Check', 'Status', 'Result'], rows));
        if (sample) out.append(h('h3', {}, 'A real response from your gateway'), h('pre', { class: 'term' }, JSON.stringify(sample, null, 1).slice(0, 900)));
        b.add(out);
        await LAB.update('gateway', { key, limit: 8, sample, at: Date.now() });
        api.progress(0.5);
        if (!passed) { AC.audio.bad(); return; }
        AC.audio.good();
        step3(out);
      };
      const step3 = async (parent) => {
        // Discrete-event simulation of the cluster. Service time comes from the real model on this device, scaled to a GPU with the guide's speed factors.
        const samples = [];
        for (let i = 0; i < 8; i++) { const r = await LAB.rpc({ type: 'chat', req: { messages: [{ role: 'user', content: ['What is LoRA?', 'hello', 'What is a GPU?', 'Who made you?'][i % 4] }], seed: i } }); samples.push(r.ms); }
        const realMs = samples.reduce((a, c) => a + c, 0) / samples.length;
        const c = { nodes: st.on.vllm2 ? 2 : 1, batching: false, streaming: false, quant: true, traffic: 40, chaos: false };
        const area = h('div');
        parent.append(h('h3', {}, 'Step 3: load test at 2x traffic'), LAB.tag('sim'), h('p', { class: 'small dim' }, 'Your real request here took ' + realMs.toFixed(0) + ' ms. The queue model uses a planning figure of 480 ms for an 8B model on one GPU. Expected traffic: 20 requests per second, so the test runs at 40. Target: p95 under 1,500 ms, errors under 1 percent, at under $1 per 1,000 requests.'), area);
        const sim = () => {
          const rng = ML.rng(7);
          const service = 480 * (c.quant ? 0.7 : 1);
          const concurrency = c.batching ? 64 : 4; // continuous batching lets many users share a GPU
          const slowdown = c.batching ? 1.35 : 1;
          const servers = c.nodes * concurrency;
          const free = new Array(servers).fill(0);
          const durs = [];
          let errs = 0;
          const dur = 30000;
          let t = 0;
          const failAt = c.chaos ? 12000 : Infinity;
          let n = 0;
          while (t < dur) {
            t += -Math.log(1 - rng()) * (1000 / c.traffic);
            n++;
            const live = c.nodes === 1 && t > failAt && t < failAt + 8000 ? 0 : c.nodes === 2 && t > failAt && t < failAt + 8000 ? Math.floor(servers / 2) : servers;
            if (!live) { if (st.on.fallback) durs.push(service * 5 * (0.8 + rng() * 0.4)); else errs++; continue; }
            let best = 0;
            for (let i = 1; i < live; i++) if (free[i] < free[best]) best = i;
            const start = Math.max(t, free[best]);
            const svc = service * slowdown * (0.6 + rng() * 0.9);
            if (start - t > 8000) { errs++; continue; }
            free[best] = start + svc;
            durs.push(start + svc - t + 20);
          }
          const firstMs = (x) => (c.streaming ? x * 0.35 : x);
          const p50 = firstMs(BRAIN.percentile(durs, 50)), p95 = firstMs(BRAIN.percentile(durs, 95));
          const gpuHr = (c.nodes * 1.2) / 3600;
          const costPer1k = (gpuHr / c.traffic) * 1000 + 0.08;
          return { p50, p95, err: errs / n, throughput: durs.length / (dur / 1000), cost: costPer1k, n };
        };
        const draw = () => {
          area.innerHTML = '';
          const seg = (label, key, opts) => h('div', { class: 'ac-field' }, h('label', {}, label), LAB.seg(opts, c[key], (v) => { c[key] = v; if (key === 'nodes') setBlock('vllm2', v === 2); }));
          const res = h('div');
          const run = h('button', { class: 'ac-btn', type: 'button' }, 'Run load test');
          run.addEventListener('click', async () => {
            run.disabled = true;
            st.loadRuns = (st.loadRuns || 0) + 1;
            load = 1;
            for (let i = 0; i < 18; i++) { packets.fire(posOf('client'), posOf(c.nodes === 2 && i % 2 ? 'vllm2' : 'vllm'), 0xb48cff, 0.5); await LAB.sleep(50); }
            load = 0;
            c.chaos = false;
            const normal = sim();
            c.chaos = true;
            const chaos = sim();
            c.chaos = false;
            res.innerHTML = '';
            const okN = normal.p95 < 1500 && normal.err < 0.01 && normal.cost < 1;
            const okC = chaos.err < 0.01;
            res.append(LAB.table(['Run at 40 req/s', 'p50', 'p95', 'Errors', 'Cost per 1,000'], [
              { cls: okN ? 'ok' : 'no', cells: ['Normal', normal.p50.toFixed(0) + ' ms', normal.p95.toFixed(0) + ' ms', LAB.pct(normal.err, 1), '$' + normal.cost.toFixed(2)] },
              { cls: okC ? 'ok' : 'no', cells: ['A vLLM node dies for 8 s', chaos.p50.toFixed(0) + ' ms', chaos.p95.toFixed(0) + ' ms', LAB.pct(chaos.err, 1), '$' + chaos.cost.toFixed(2)] },
            ]));
            run.disabled = false;
            if (okN && okC) {
              await LAB.update('stackCfg', { nodes: c.nodes, batching: c.batching, streaming: c.streaming, p50: normal.p50, p95: normal.p95, err: normal.err, cost: normal.cost, chaosErr: chaos.err, at: Date.now() });
              api.progress(1);
              api.win(st.loadRuns <= 2 && c.nodes === 1 ? 3 : c.nodes === 1 ? 2 : 2, 'p95 ' + normal.p95.toFixed(0) + ' ms at 2x traffic, $' + normal.cost.toFixed(2) + ' per 1,000 requests, and it survived a backend failure.');
            } else AC.audio.bad();
          });
          area.append(seg('vLLM nodes', 'nodes', [{ value: 1, label: '1 node' }, { value: 2, label: '2 nodes' }]), seg('Continuous batching', 'batching', [{ value: false, label: 'Off' }, { value: true, label: 'On' }]), seg('Streaming', 'streaming', [{ value: false, label: 'Off' }, { value: true, label: 'On' }]), h('div', { class: 'ac-actions' }, run), res);
        };
        draw();
      };
    },
  };

  const MR = AC.missions({ game: 'servers', week: 7, list: [quantise, stack], onSelect: () => { LAB.closeBench(); load = 0; } });
  S.start();
  MR.begin();
  window.__MR = MR;
})();
