/* Zone 5: Training Hall (weeks 8-9, guide Parts 5, 6.1, 6.2, 7). Everything marked REAL here trains real weights in your browser. */
(function () {
  'use strict';
  const h = AC.h, W = LAB.world, E = EVALSET, Pp = PIPELINE, A = AGENT;
  AC.boot({ game: 'training', week: 5, topic: 'Weeks 8-9 · Parts 5, 6, 7', title: 'Training Hall', help: () => AC.ui.card({ eyebrow: 'How to play', title: 'This is real training', body: ['The loss curve is the real loss of a real network. Workers on your CPU compute real gradients. Keep this tab open while it trains. The racks and the fans show your training rate.'] }) });
  const { S, scene } = W.hall({ size: 26, accent: 0x4be38a, cam: { dist: 24, theta: -0.45, phi: 1.2, target: new THREE.Vector3(-4, 3.2, 0) } });
  const racks = [];
  for (let i = 0; i < 12; i++) {
    const r = W.rack(0x4be38a, 5.5);
    r.position.set(-20 + i * 3.6, 0, i % 2 ? -18 : -14);
    scene.add(r);
    racks.push(r);
  }
  const plot = W.holoPlot(16, 8);
  plot.position.set(-16, 2.5, -9);
  scene.add(plot);
  scene.add(W.sign('LOSS (train, validation)', { pos: [-8, 11.1, -9], size: 0.6, color: '#2fe0cf' }));
  const fanBlades = [];
  for (let i = 0; i < 4; i++) {
    const fan = new THREE.Group();
    for (let k = 0; k < 4; k++) { const b = W.box(1.5, 0.12, 0.4, W.std(0x9fb2c7)); b.rotation.y = (k * Math.PI) / 2; b.position.set(Math.cos((k * Math.PI) / 2) * 0.8, 0, -Math.sin((k * Math.PI) / 2) * 0.8); fan.add(b); }
    fan.position.set(-20 + i * 10, 9.5, -12);
    scene.add(fan);
    fanBlades.push(fan);
  }
  const hum = AC.audio.makeHum('sawtooth', 48);
  const GPU = { load: 0 };
  S.onFrame((dt, t) => {
    racks.forEach((r) => r.setLoad(0.1 + GPU.load, t));
    fanBlades.forEach((f) => (f.rotation.y += dt * (0.5 + GPU.load * 16)));
    hum.set(GPU.load * 0.7, 1 + GPU.load);
    MR.update(dt);
  });
  const setPlot = (hist, total) => {
    const tr = hist.filter((x) => x.loss != null).map((x) => [x.step, x.loss]);
    const va = hist.filter((x) => x.val != null).map((x) => [x.step, x.val]);
    plot.setData(tr, va, Math.max(1, total), 7);
  };
  function lossGraph() {
    const c = h('canvas', { class: 'graph' });
    const g = new AC.Graph(c, { xMin: 0, xMax: 10, yMin: 0, yMax: 7, xLabel: 'step', yLabel: 'loss' });
    return { el: c, draw(hist, total) { g.o.xMax = Math.max(2, total); g.draw({ series: [{ color: AC.css('--cyan'), pts: hist.filter((x) => x.loss != null).map((x) => [x.step, x.loss]) }, { color: AC.css('--amber'), pts: hist.filter((x) => x.val != null).map((x) => [x.step, x.val]) }] }); } };
  }
  const assets = async () => {
    const [ds, lake, id] = await Promise.all([LAB.get('dataset'), LAB.lake(), LAB.identity()]);
    return { ds, lake, id };
  };

  // ---------------------------------------------- Mission 1: GPU plus the tiny overfit test
  const GPUS = [
    { name: 'RTX 3060 12 GB', mem: 12, price: 0.15 }, { name: 'RTX 4080 16 GB', mem: 16, price: 0.3 }, { name: 'RTX 4090 24 GB', mem: 24, price: 0.45 },
    { name: 'A100 40 GB', mem: 40, price: 1.2 }, { name: 'A100 80 GB', mem: 80, price: 1.8 }, { name: '4 x H100', mem: 320, price: 14 },
  ];
  const needFor = (size) => (size <= 4 ? [8, 16] : size <= 14 ? [16, 24] : size <= 35 ? [24, 48] : [80, 320]);
  const overfit = {
    id: 'overfit', title: 'GPU and the overfit test',
    objective: 'Rent the right GPU, then make the model memorise 20 examples',
    story: 'Before any long run, the guide has one rule: 20 examples, many steps. If the model cannot memorise them, something is wrong and a long run would only waste money. The last engineer broke something. Find it.',
    learn: [
      { t: 'Rent by the hour', p: 'Rent GPUs for training, then keep a smaller always-on set for serving.', f: '7B to 14B: 16 to 24 GB with QLoRA' },
      { t: 'Tiny overfit test', p: 'If the model cannot memorise 20 examples, the template, masking or learning rate is wrong.', f: 'Print one tokenised example' },
    ],
    proved: 'You passed the check that saves real money. It caught a wrong template, a wrong mask and a bad learning rate in seconds instead of after an expensive run.',
    tip: 'Press Print one example and compare it with the base model\'s template. Then check the learning rate against the guide: 1e-4 to 2e-4.',
    get quiz() { return AC.QUESTIONS.find((q) => q.id === 'overfit'); },
    async start(api) {
      LAB.closeBench();
      const { ds, id } = await assets();
      if (!ds || !ds.reviewed) return LAB.requireMsg('Lock and sign your dataset in the Data Refinery first.', 'refinery.html#gates');
      const spec = (await LAB.get('spec')) || { base: { name: 'Qwen 3.x, about 8B', size: 8 } };
      const st = api.state;
      st.runs = 0;
      st.cfg = { template: 'alpaca', maskMode: 'all', lr: 1e-6 };
      const b = LAB.bench('Step 1: rent a GPU', 'Your real-world base: ' + spec.base.name + '.');
      const [lo, hi] = needFor(spec.base.size);
      const area = h('div');
      b.add(LAB.tag('sim'), h('p', {}, 'Hardware guide for that size with QLoRA: ' + lo + ' to ' + hi + ' GB to fine-tune. Choose the cheapest card that fits. Prices are examples.'), area);
      area.append(h('div', { class: 'cand' }, GPUS.map((g) => {
        const bt = h('button', { type: 'button', class: 'cand-b' }, h('b', {}, g.name), h('span', { class: 'mono dim' }, '$' + g.price.toFixed(2) + ' per hour'));
        bt.addEventListener('click', async () => {
          const fits = g.mem >= lo;
          const cheapest = GPUS.filter((x) => x.mem >= lo).sort((a, b2) => a.price - b2.price)[0];
          if (!fits) { bt.classList.add('wrong'); AC.audio.bad(); st.badGpu = true; return AC.fact('Out of memory', g.mem + ' GB is below the ' + lo + ' GB minimum, so the run would crash at load.', { tag: 'GPU', color: 'var(--red)' }); }
          if (g !== cheapest) { bt.classList.add('wrong'); AC.audio.bad(); st.badGpu = true; return AC.fact('Overspending', g.name + ' fits, but ' + cheapest.name + ' fits too, at $' + cheapest.price.toFixed(2) + ' per hour.', { tag: 'GPU', color: 'var(--amber)' }); }
          AC.audio.good();
          await LAB.set('gpu', { name: g.name, mem: g.mem, price: g.price, at: Date.now() });
          stage2();
        });
        return bt;
      })));
      const stage2 = () => {
        b.clear();
        api.progress(0.2);
        const trainRows = ds.splits.train;
        const pool = trainRows.filter((r) => r.messages.length === 2 && r.messages[1].content.length < 90 && r.messages[1].content.length > 12 && ['persona-local', 'seed-handwritten', 'stack-docs', 'emotion-script'].includes(r.s));
        const rng = ML.rng(31);
        const rows = [];
        const seen = new Set();
        while (rows.length < 20 && pool.length) { const r = pool[Math.floor(rng() * pool.length)]; if (seen.has(r.messages[1].content)) { pool.splice(pool.indexOf(r), 1); continue; } seen.add(r.messages[1].content); rows.push(r); }
        const out = h('div');
        const printBtn = h('button', { class: 'ac-btn ghost', type: 'button' }, 'Print one tokenised example');
        const pre = h('pre', { class: 'term' }, 'The base model card says: <|user|> text <|end|> <|assistant|> reply <|end|>, and train on assistant tokens only.');
        printBtn.addEventListener('click', async () => {
          const { tok } = await LAB.fetchBase().then((a) => ({ tok: new ML.Tokenizer(a.tok) }));
          const e = ML.encodeRows(tok, [rows[0]], { template: st.cfg.template, maskMode: st.cfg.maskMode })[0];
          pre.textContent = 'Template: ' + st.cfg.template + ', mask: ' + st.cfg.maskMode + '\n' + e.ids.map((x, i) => (e.mask[i] ? '' : '·') + tok.vocab[x].replace(/\n/g, '\\n')).join(' ') + '\n\nA dot marks tokens with no loss. Tokens without a dot are trained on.';
        });
        const graph = lossGraph();
        const go = h('button', { class: 'ac-btn', type: 'button' }, 'Run the overfit test');
        go.addEventListener('click', async () => {
          go.disabled = true;
          st.runs++;
          out.innerHTML = '';
          const status = h('p', { class: 'mono c-cyan' }, 'Starting CPU workers...');
          out.append(status);
          const { trainer, net, tok } = await LAB.newTrainer({ rank: 16, alpha: 32, seed: 4 });
          const seqs = ML.encodeRows(tok, rows, { template: st.cfg.template, maskMode: st.cfg.maskMode });
          const steps = 70;
          const hist = [];
          const res = await ML.runTraining(trainer, seqs, [], { lr: st.cfg.lr, batch: 8, steps }, (i) => {
            hist.push({ step: i.step, loss: i.loss });
            GPU.load = 1;
            setPlot(hist, steps);
            graph.draw(hist, steps);
            status.textContent = 'REAL training: step ' + i.step + ' of ' + steps + ', loss ' + i.loss.toFixed(3);
          });
          GPU.load = 0;
          trainer.stop();
          // Recall test with the correct serving template, exactly as the model will be used
          let hits = 0;
          const shown = [];
          for (const r of rows) {
            const ids = tok.encodePrompt([r.messages[0]]);
            const g = ML.generate(net, tok, ids, { adapter: trainer.ad, temperature: 0, maxNew: 60, grammar: false });
            const want = r.messages[1].content;
            const ok = g.text.slice(0, 14).toLowerCase() === want.slice(0, 14).toLowerCase();
            if (ok) hits++;
            if (shown.length < 5) shown.push({ cls: ok ? 'ok' : 'no', cells: [r.messages[0].content.slice(0, 40), want.slice(0, 50), g.text.slice(0, 50)] });
          }
          const rate = hits / rows.length;
          const finalLoss = hist.length ? hist[hist.length - 1].loss : 0;
          status.textContent = 'Final loss ' + finalLoss.toFixed(3) + '. Memorised ' + hits + ' of ' + rows.length + ' when served with the real template.';
          out.append(LAB.table(['Prompt', 'Wanted', 'Model said'], shown));
          api.progress(0.2 + 0.8 * rate);
          go.disabled = false;
          if (rate >= 0.7) {
            await LAB.update('training', { overfit: { rate, finalLoss, at: Date.now() } });
            api.win(st.runs === 1 ? 3 : st.runs <= 3 ? 2 : 1, 'Memorised ' + hits + ' of ' + rows.length + ' with the template, mask and learning rate fixed. Runs needed: ' + st.runs + '.');
          } else {
            AC.audio.bad();
            const clue = st.cfg.template !== 'chat' ? 'Low recall with a falling loss is the silent failure: it learned a template you will not serve.' : st.cfg.lr < 5e-5 ? 'The loss barely moved. The step size is too small.' : st.cfg.lr > 8e-4 ? 'The loss is wild. The step size is too big.' : st.cfg.maskMode !== 'assistant' ? 'It spent its effort on user tokens too. Mask them.' : 'Close. Run again.';
            out.append(h('p', { class: 'c-amber' }, clue));
          }
        });
        b.add(h('h3', {}, 'Step 2: the overfit test'), LAB.tag('real'), h('p', {}, '20 real rows from your dataset, 70 steps.'),
          h('div', { class: 'ac-field' }, h('label', {}, 'Chat template'), LAB.seg([{ value: 'alpaca', label: '### Instruction:' }, { value: 'chat', label: '<|user|>...<|assistant|>' }], st.cfg.template, (v) => (st.cfg.template = v))),
          h('div', { class: 'ac-field' }, h('label', {}, 'Train on'), LAB.seg([{ value: 'all', label: 'All tokens' }, { value: 'assistant', label: 'Assistant tokens only' }], st.cfg.maskMode, (v) => (st.cfg.maskMode = v))),
          h('div', { class: 'ac-field' }, h('label', {}, 'Learning rate'), LAB.seg([{ value: 1e-6, label: '1e-6' }, { value: 2e-5, label: '2e-5' }, { value: 2e-4, label: '2e-4' }, { value: 5e-3, label: '5e-3' }], st.cfg.lr, (v) => (st.cfg.lr = v))),
          printBtn, pre, graph.el, h('div', { class: 'ac-actions' }, go), out);
        graph.draw([], 70);
      };
    },
  };

  // ---------------------------------------------- Mission 2: the real LoRA fine-tune
  const lora = {
    id: 'lora', title: 'The real LoRA fine-tune',
    objective: 'Set the hyperparameters, train for real, and beat the base on the sealed test',
    story: 'This is the moment. Your clean rows meet a frozen base. Real LoRA matrices train on your CPU, and when it ends your AI will have a name, a voice style and rules. Set the values from the guide\'s table.',
    learn: [
      { t: 'Safe starting values', p: 'Rank 16 to 64. Alpha equal to rank or 2x rank. Learning rate 1e-4 to 2e-4. 1 to 3 epochs.', f: 'Effective batch 32 to 128' },
      { t: 'Replay and masks', p: 'Mix 10 to 30 percent general data to avoid forgetting. Train on assistant tokens only.', f: 'y = x W + (alpha/rank) x A B' },
      { t: 'Scale honesty', p: 'This run is far shorter than a GPU run, so the simulator multiplies your learning rate by ' + ML.LR_SCALE + ', puts adapters on the top 2 blocks, and spends its steps on what is new. The guide\'s values are still the right answers.', f: 'Real backprop, real Adam' },
    ],
    proved: 'You ran a real LoRA fine-tune: only the small A and B matrices moved, and the base stayed frozen. Then you measured it on a test it never saw. Part 6.1, steps 1 to 3.',
    tip: 'Read the failure line. If General fell, add replay or lower the learning rate or rank. If the loss exploded, the learning rate is too high.',
    get quiz() { return AC.QUESTIONS.find((q) => q.id === 'lora'); },
    async start(api) {
      LAB.closeBench();
      const { ds, lake, id } = await assets();
      if (!ds || !ds.reviewed) return LAB.requireMsg('Lock and sign your dataset in the Data Refinery first.', 'refinery.html#gates');
      const evalSet = await LAB.get('eval');
      if (!evalSet) return LAB.requireMsg('Seal the test set in the Eval Vault first.', 'vault.html#seal');
      const tr = (await LAB.get('training')) || {};
      if (!tr.overfit) return LAB.requireMsg('Pass the overfit test first.', 'training.html#overfit');
      const st = api.state;
      st.cfg = { rank: 4, alphaMul: 1, lr: 5e-3, epochs: 3, batch: 16, replay: 0 };
      st.runs = 0;
      const b = LAB.bench('Fine-tune settings', AC.fmt(ds.splits.train.length) + ' clean training rows, version ' + ds.versionHash + '.');
      const guide = h('div', { class: 'note' });
      const check = () => {
        const c = st.cfg, msgs = [];
        if (c.rank < 16) msgs.push('Rank ' + c.rank + ' is under 16 to 64');
        if (c.lr < 1e-4) msgs.push('Learning rate is under 1e-4');
        if (c.lr > 2e-4) msgs.push('Learning rate is over 2e-4');
        if (c.batch < 32) msgs.push('Effective batch is under 32');
        if (c.replay < 0.1) msgs.push('Replay is under 10 percent');
        if (c.replay > 0.3) msgs.push('Replay is over 30 percent');
        guide.innerHTML = '';
        guide.append(msgs.length ? h('span', { class: 'c-amber' }, 'Off the guide: ' + msgs.join('; ') + '.') : h('span', { class: 'c-green' }, 'All values are inside the guide\'s safe starting table.'));
        return msgs;
      };
      const seg = (label, key, opts) => h('div', { class: 'ac-field' }, h('label', {}, label), LAB.seg(opts, st.cfg[key], (v) => { st.cfg[key] = v; check(); estimate(); }));
      const est = h('p', { class: 'mono dim' });
      const estimate = () => {
        const nRows = Pp.prepareTraining(ds.splits, lake.replay, { replay: st.cfg.replay }).length;
        const steps = Math.max(1, Math.round((nRows / st.cfg.batch) * st.cfg.epochs * ML.PASSES));
        est.textContent = 'About ' + steps + ' steps on ' + Math.min(6, Math.max(1, (navigator.hardwareConcurrency || 4) - 1)) + ' CPU workers. The base already knows most facts, so the run studies your ' + nRows + ' priority rows: persona, seeds, refusals, and replay.';
      };
      const graph = lossGraph();
      const out = h('div');
      const go = h('button', { class: 'ac-btn', type: 'button' }, 'Start the real fine-tune');
      const stop = h('button', { class: 'ac-btn ghost', type: 'button', disabled: true }, 'Stop early');
      let stopFlag = false;
      stop.addEventListener('click', () => { stopFlag = true; stop.disabled = true; });
      const run = async () => {
        go.disabled = true; stop.disabled = false; stopFlag = false;
        st.runs++;
        out.innerHTML = '';
        const status = h('p', { class: 'mono c-cyan' }, 'Loading frozen base into CPU workers...');
        out.append(status);
        const c = st.cfg;
        const adapterCfg = { rank: c.rank, alpha: c.rank * c.alphaMul, seed: 5 + st.runs };
        const { trainer, net, tok } = await LAB.newTrainer(adapterCfg);
        const rows = Pp.prepareTraining(ds.splits, lake.replay, { replay: c.replay, seed: 3 + st.runs });
        const seqs = ML.encodeRows(tok, rows, { maxLen: 50 });
        const val = ML.encodeRows(tok, ds.splits.val, { maxLen: 50 }).slice(0, 32);
        const hist = [];
        const res = await ML.runTraining(trainer, seqs, val, { lr: c.lr, batch: c.batch, epochs: c.epochs, passes: ML.PASSES, patience: 99, seed: 11 + st.runs }, (i) => {
          hist.push({ step: i.step, loss: Math.min(20, i.loss), val: i.val });
          GPU.load = 1;
          const rate = i.step / (i.ms / 1000);
          setPlot(hist, i.total);
          graph.draw(hist, i.total);
          api.progress((i.step / i.total) * 0.75, 'Fine-tuning');
          const left = (i.total - i.step) / Math.max(0.01, rate);
          status.textContent = 'REAL step ' + i.step + '/' + i.total + '  loss ' + i.loss.toFixed(3) + '  val ' + (i.val == null ? '-' : i.val.toFixed(3)) + '  ' + rate.toFixed(2) + ' steps/s  about ' + Math.ceil(left) + 's left';
          if (stopFlag) return false;
        });
        stop.disabled = true;
        if (res.diverged) {
          GPU.load = 0;
          trainer.stop();
          AC.audio.boom();
          out.append(h('p', { class: 'c-red' }, 'The loss exploded at step ' + res.steps + '. That is the learning rate. Lower it and try again.'));
          go.disabled = false;
          return;
        }
        status.textContent = 'Fitting the event heads: emotion, intensity, gesture, gaze, style...';
        const nHead = await trainer.fitEventHeads(tok, Pp.headRows(ds.splits, lake.replay));
        GPU.load = 0;
        trainer.stop();
        status.textContent = 'Trained ' + res.steps + ' steps in ' + (res.ms / 1000).toFixed(0) + ' s. Adapter parameters: ' + AC.fmt(ML.adapterParams(trainer.ad)) + ' (the base stays frozen). Event heads fit on ' + nHead + ' rows. Now testing on the sealed set...';
        const buf = ML.serializeAdapter(trainer.ad);
        await LAB.model();
        const extraQ = Pp.matcherQuestions(ds.splits);
        await LAB.set('extraQuestions', extraQ);
        await LAB.rpc({ type: 'config', identity: id, extraQuestions: extraQ });
        await LAB.rpc({ type: 'adapter', name: 'candidate', buf: buf.slice(0) });
        const prompts = E.PROMPTS.concat(evalSet.custom || []);
        const ev = await LAB.rpc({ type: 'eval', adapter: 'candidate', identity: id, prompts }, (m) => { api.progress(0.75 + (0.25 * m.i) / m.n, 'Sealed test'); });
        // what if the adapter handled everything, with no routing? This is the forgetting check.
        const forced = await LAB.rpc({ type: 'eval', adapter: 'candidate', identity: id, prompts: E.PROMPTS.filter((p) => p.cat === 'general'), forced: true });
        const base = evalSet.baseline;
        const rowsT = Object.keys(ev.cats).map((k) => { const v = ev.cats[k], bv = base.cats[k] || 0; return { cls: v >= bv ? 'ok' : 'no', cells: [E.CATEGORIES[k] || 'Your golden prompts', LAB.pct(bv), LAB.pct(v), (v - bv >= 0 ? '+' : '') + Math.round((v - bv) * 100)] }; });
        const fails = [];
        if (ev.overall < base.overall + 0.1) fails.push('Overall must beat the base by 10 points. If the loss stayed high, check the learning rate, rank and epochs.');
        if (ev.schema < 0.9) fails.push('Only ' + LAB.pct(ev.schema) + ' of replies had valid event JSON. It needs 90 percent.');
        if ((ev.cats.identity || 0) < 0.5) fails.push('It still does not know who it is. Identity is ' + LAB.pct(ev.cats.identity || 0) + '. The adapter has not learned enough: check the settings.');
        out.append(LAB.table(['Sealed test category', 'Base', 'Yours', 'Change'], rowsT), h('div', { class: 'stats' }, LAB.stat('Overall', LAB.pct(ev.overall, 1), 'c-green'), LAB.stat('Base was', LAB.pct(base.overall, 1)), LAB.stat('Valid event JSON', LAB.pct(ev.schema)), LAB.stat('Speed', ev.tokPerSec.toFixed(0) + ' tok/s'), LAB.stat('General, adapter forced on', LAB.pct(forced.overall))));
        out.append(h('p', { class: 'small dim' }, 'Your AI uses multi-LoRA routing: questions the base already knows run on the pure base, so the adapter cannot damage them. "General, adapter forced on" shows what happens without routing. That is forgetting, and replay data reduces it. Try a run with 0% replay to see.'));
        out.append(h('details', {}, h('summary', {}, 'Read what your model answered'), LAB.table(['Prompt', 'Reply', ''], ev.rows.slice(0, 80).map((r) => ({ cls: r.ok ? 'ok' : 'no', cells: [r.prompt, (r.toolCall ? JSON.stringify(r.toolCall) + ' ' : '') + r.reply, r.ok ? 'pass' : 'fail'] })), { tall: true })));
        go.disabled = false;
        if (fails.length) {
          AC.audio.bad();
          out.append(h('ul', { class: 'mini c-amber' }, fails.map((f) => h('li', {}, f))));
          return;
        }
        await LAB.set('adapter:chat', buf);
        await LAB.rpc({ type: 'adapter', name: 'chat', buf: buf.slice(0) });
        const log = await LAB.update('training', { lora: { cfg: Object.assign({}, c), alpha: adapterCfg.alpha, steps: res.steps, secs: res.ms / 1000, finalLoss: hist[hist.length - 1].loss, ev: LAB.stripEval(ev), history: hist.filter((_, k) => k % Math.ceil(hist.length / 60) === 0), at: Date.now(), runs: st.runs, inGuide: check().length === 0 } });
                api.win(ev.overall >= 0.8 && check().length === 0 ? 3 : ev.overall >= 0.68 ? 2 : 1, 'Your model scored ' + LAB.pct(ev.overall, 1) + ', against ' + LAB.pct(base.overall, 1) + ' for the base. ' + id.name + ' now knows who it is. It will talk to you in the Face and Voice Studio.');
      };
      go.addEventListener('click', () => {
        const msgs = check();
        if (msgs.length) return AC.ui.card({ eyebrow: 'Pre-flight check', title: 'Off the guide', body: [msgs.join('. ') + '.', 'You can run it anyway. Real training will show you what happens.'], buttons: [{ label: 'Change settings', ghost: true }, { label: 'Run anyway', onclick: run }] });
        run();
      });
      estimate(); check();
      b.add(LAB.tag('real'),
        seg('LoRA rank', 'rank', [4, 16, 32, 64].map((v) => ({ value: v, label: String(v) }))),
        seg('Alpha', 'alphaMul', [{ value: 1, label: 'Equal to rank' }, { value: 2, label: '2x rank' }]),
        seg('Learning rate', 'lr', [{ value: 1e-5, label: '1e-5' }, { value: 5e-5, label: '5e-5' }, { value: 1e-4, label: '1e-4' }, { value: 2e-4, label: '2e-4' }, { value: 1e-3, label: '1e-3' }, { value: 5e-3, label: '5e-3' }]),
        seg('Epochs', 'epochs', [1, 2, 3].map((v) => ({ value: v, label: String(v) }))),
        seg('Effective batch', 'batch', [16, 32, 64].map((v) => ({ value: v, label: String(v) }))),
        seg('Replay data', 'replay', [0, 0.1, 0.2, 0.3, 0.5].map((v) => ({ value: v, label: Math.round(v * 100) + '%' }))),
        guide, est, graph.el, h('div', { class: 'ac-actions' }, stop, go), out);
      graph.draw([], 10);
    },
  };

  // ---------------------------------------------- Mission 3: failure rounds
  const failures = {
    id: 'failures', title: 'Fix the failures',
    objective: 'Find failures on the dev set, write better answers, and retrain',
    story: 'Your first run is never the best one. Two or three rounds beat one big run. Run the dev set, read what your model got wrong, write the right answer, and retrain on top of your adapter.',
    learn: [
      { t: 'The loop', p: 'Collect failures, write better answers, add them, and retrain.', f: 'Two or three rounds beat one big run' },
      { t: 'Never touch the seal', p: 'The sealed test must stay unseen. A row that overlaps it gets rejected, or your scores would lie.', f: 'Dev set for fixing, sealed set for proving' },
    ],
    proved: 'That is Part 6.1 step 4. Your answers became real rows, the adapter retrained from where it was, and you checked it with the sealed test.',
    tip: 'Accept or improve the suggested answers, then retrain. Rows copied from the sealed test get blocked.',
    get quiz() { return AC.QUESTIONS.find((q) => q.id === 'failures'); },
    async start(api) {
      LAB.closeBench();
      const { ds, lake, id } = await assets();
      const buf = await LAB.get('adapter:chat');
      if (!buf) return LAB.requireMsg('Run the real LoRA fine-tune first.', 'training.html#lora');
      const evalSet = await LAB.get('eval');
      const st = api.state;
      st.round = 0;
      st.rows = (await LAB.get('failureRows')) || [];
      const b = LAB.bench('Dev set', E.DEV.length + ' development prompts. You may train on failures here.');
      const body = h('div');
      b.add(LAB.tag('real'), body);
      await LAB.model();
      await LAB.rpc({ type: 'config', identity: id });
      await LAB.rpc({ type: 'adapter', name: 'chat', buf: buf.slice(0) });
      const devPrompts = E.DEV.map((p) => Object.assign({}, p, { prompt: E.fill(p.prompt, id) }));
      const sealed = LAB.sealedPrompts().concat((evalSet.custom || []).map((c) => c.prompt));
      const runDev = async () => {
        body.innerHTML = '';
        const s = h('p', { class: 'mono c-cyan' }, 'Running the dev set...');
        body.append(s);
        const ev = await LAB.rpc({ type: 'eval', adapter: 'chat', identity: id, prompts: devPrompts }, (m) => { s.textContent = 'Dev set: ' + m.i + ' of ' + m.n; });
        return ev;
      };
      const round = async () => {
        const ev = await runDev();
        const devRate = ev.rows.filter((r) => r.ok).length / ev.rows.length;
        st.devStart = st.devStart == null ? devRate : st.devStart;
        api.progress(devRate);
        body.innerHTML = '';
        const fails = ev.rows.map((r, i) => ({ r, p: devPrompts[i] })).filter((x) => !x.r.ok && x.p.fix);
        body.append(h('div', { class: 'stats' }, LAB.stat('Dev pass rate', LAB.pct(devRate), devRate > 0.8 ? 'c-green' : 'c-amber'), LAB.stat('Round', String(st.round)), LAB.stat('Failures to fix', String(fails.length))));
        if (st.round >= 1 && (devRate >= 0.8 || fails.length === 0 || st.round >= 3)) return finish(devRate);
        const editors = fails.map((x) => {
          const ta = h('textarea', { rows: 2, 'aria-label': 'Better answer for ' + x.r.prompt }, E.fill(x.p.fix.replace(/\\n/g, '\n'), id));
          return { x, ta, el: h('div', { class: 'fail-row' }, h('p', {}, h('b', {}, x.r.prompt)), h('p', { class: 'c-red small' }, 'Model said: ' + (x.r.toolCall ? JSON.stringify(x.r.toolCall) : x.r.reply || '(nothing)').slice(0, 130)), LAB.field('A better answer', ta)) };
        });
        const addOwn = h('input', { type: 'text', placeholder: 'Optional: try adding a prompt of your own, even a sealed one', 'aria-label': 'Your own prompt' });
        const addOwnA = h('input', { type: 'text', placeholder: 'Its answer', 'aria-label': 'Answer' });
        const go = h('button', { class: 'ac-btn', type: 'button' }, 'Add rows and retrain');
        go.addEventListener('click', async () => {
          go.disabled = true;
          const fresh = [];
          for (const ed of editors) {
            const a = ed.ta.value.trim();
            if (a.length < 4) continue;
            fresh.push({ s: 'failure-round', c: 700000 + st.rows.length + fresh.length, messages: [{ role: 'user', content: ed.x.r.prompt }, { role: 'assistant', content: a, events: Pp.eventsFor(ed.x.p.tag || 'explain') }] });
          }
          if (addOwn.value.trim() && addOwnA.value.trim()) {
            if (Pp.overlapsSealed(addOwn.value.trim(), sealed, 0.6)) { AC.fact('Blocked by decontaminate', 'That prompt overlaps the sealed test, so it cannot be trained on. Scores would lie.', { tag: 'Stage 10', color: 'var(--red)' }); AC.audio.bad(); }
            else fresh.push({ s: 'failure-round', c: 710000 + st.rows.length, messages: [{ role: 'user', content: addOwn.value.trim() }, { role: 'assistant', content: addOwnA.value.trim(), events: Pp.eventsFor('explain') }] });
          }
          st.rows = st.rows.concat(fresh);
          await LAB.set('failureRows', st.rows);
          await retrain();
        });
        body.append(...editors.map((e) => e.el));
        if (fails.length === 0) body.append(h('p', { class: 'c-green' }, 'No failures with a known fix. Add a prompt of your own, or retrain to confirm.'));
        body.append(h('h3', {}, 'Your own row'), LAB.field('Prompt', addOwn), LAB.field('Answer', addOwnA), h('div', { class: 'ac-actions' }, go));
      };
      const graph = lossGraph();
      const retrain = async () => {
        st.round++;
        body.innerHTML = '';
        const status = h('p', { class: 'mono c-cyan' }, 'Retraining on top of your adapter...');
        body.append(status, graph.el);
        const cur = ML.parseAdapter((await LAB.get('adapter:chat')).slice(0));
        const adapterCfg = { rank: cur.rank, alpha: cur.alpha, seed: 5, fromLayer: cur.fromLayer };
        const { trainer, tok } = await LAB.newTrainer(adapterCfg, cur);
        // corrections join the priority rows, so old answers are rehearsed while new ones are learned
        const fr = Pp.prepareTraining({ train: st.rows }, [], { replay: 0, seed: 40 + st.round, otherShare: 0 });
        const rows = fr.concat(fr, Pp.prepareTraining(ds.splits, lake.replay, { replay: 0.15, seed: 50 + st.round }));
        const seqs = ML.encodeRows(tok, rows, { maxLen: 60 });
        const steps = 70;
        const hist = [];
        await ML.runTraining(trainer, seqs, [], { lr: 8e-5, batch: 32, steps, seed: 70 + st.round }, (i) => {
          hist.push({ step: i.step, loss: i.loss });
          GPU.load = 1;
          setPlot(hist, steps); graph.draw(hist, steps);
          status.textContent = 'REAL retrain, round ' + st.round + ': step ' + i.step + '/' + steps + ' loss ' + i.loss.toFixed(3);
          api.progress(i.step / steps, 'Retraining');
        });
        status.textContent = 'Refitting the event heads...';
        await trainer.fitEventHeads(tok, Pp.headRows({ train: ds.splits.train.concat(st.rows) }, lake.replay));
        GPU.load = 0;
        trainer.stop();
        const newBuf = ML.serializeAdapter(trainer.ad);
        // the new candidate must not regress on the sealed test
        status.textContent = 'Checking the sealed test for regressions...';
        const extraQ = Pp.matcherQuestions(ds.splits).concat(st.rows.map((r) => r.messages[0].content).filter((q) => !/\d/.test(q)));
        await LAB.set('extraQuestions', extraQ);
        await LAB.rpc({ type: 'config', extraQuestions: extraQ });
        await LAB.rpc({ type: 'adapter', name: 'candidate', buf: newBuf.slice(0) });
        const prompts = E.PROMPTS.concat(evalSet.custom || []);
        const ev = await LAB.rpc({ type: 'eval', adapter: 'candidate', identity: id, prompts });
        const prev = (await LAB.get('training')).lora.ev;
        const prevBest = (await LAB.get('training')).best || prev;
        if (ev.overall + 0.03 >= prevBest.overall) {
          await LAB.set('adapter:chat', newBuf);
          await LAB.rpc({ type: 'adapter', name: 'chat', buf: newBuf.slice(0) });
          await LAB.update('training', { best: LAB.stripEval(ev), rounds: st.round });
          AC.fact('Candidate accepted', 'Sealed score ' + LAB.pct(ev.overall, 1) + ', previous ' + LAB.pct(prevBest.overall, 1) + '.', { tag: 'No regression', color: 'var(--green)' });
        } else {
          AC.fact('Candidate refused', 'Sealed score fell to ' + LAB.pct(ev.overall, 1) + ' from ' + LAB.pct(prevBest.overall, 1) + '. You refuse to ship regressions, so the old adapter stays.', { tag: 'Regression', color: 'var(--red)' });
          AC.audio.bad();
        }
        await round();
      };
      const finish = async (devRate) => {
        const best = (await LAB.get('training')).best || (await LAB.get('training')).lora.ev;
        api.win(devRate >= 0.8 && st.round <= 2 ? 3 : devRate >= 0.65 ? 2 : 1, 'Dev set went from ' + LAB.pct(st.devStart) + ' to ' + LAB.pct(devRate) + ' in ' + st.round + ' round(s). Sealed score now ' + LAB.pct(best.overall, 1) + '.');
      };
      round();
    },
  };

  // ---------------------------------------------- Mission 4: coder adapter and GRPO
  const coder = {
    id: 'coder', title: 'Train the agent: SFT then GRPO',
    objective: 'Train a second adapter on verified trajectories, then reward real test passes',
    story: 'A second adapter goes onto the same base: one set of weights in memory, two personalities. First it copies your verified runs. Then it learns from real rewards: did the command work, did the tests pass? The guide says this step gives the biggest gain for agents.',
    learn: [
      { t: 'Many adapters, one base', p: 'vLLM multi-LoRA serves chat and code adapters on one loaded base.', f: 'Cheap: one copy of base weights' },
      { t: 'Verifiable rewards', p: 'Reward = tests pass, minimal diff, no forbidden commands.', f: 'Good samples gain, bad samples lose' },
    ],
    proved: 'Your agent learned from verified trajectories, then from real rewards computed by your own harness. Part 6.2, steps 5 and 6.',
    tip: 'Agent score counts tasks that really succeed inside your sandbox.',
    get quiz() { return AC.QUESTIONS.find((q) => q.id === 'coder'); },
    async start(api) {
      LAB.closeBench();
      const { lake, id } = await assets();
      if (!(await LAB.get('adapter:chat'))) return LAB.requireMsg('Run the real LoRA fine-tune first.', 'training.html#lora');
      const kept = await LAB.get('trajectories');
      if (!kept) return LAB.requireMsg('Record verified trajectories in the Agent Sandbox first.', 'sandbox.html#trajectories');
      const st = api.state;
      const b = LAB.bench('Coder adapter', 'SFT on verified trajectories, then reinforcement with verifiable rewards.');
      const graph = lossGraph();
      const out = h('div');
      const rows = A.trajectoryRows();
      // the player's own recorded runs become rows too
      const own = [];
      for (const k of kept.kept) {
        let last = null;
        for (const s of k.steps) {
          const m = /^write\s+(\S+)\s+([\s\S]*)$/.exec(s.cmd);
          const call = s.cmd === 'run_tests' ? { name: 'run_tests', args: {} } : m ? { name: 'write_file', args: { path: m[1], content: m[2] } } : { name: 'shell', args: { cmd: s.cmd } };
          const msgs = [{ role: 'user', content: k.name.toLowerCase() }];
          if (last) msgs.push({ role: 'tool', content: last.slice(0, 110) });
          msgs.push({ role: 'assistant', content: '', tool_call: call, events: { emotion: 'neutral', intensity: 0.5, gesture: 'none', gaze: 'down', speak_style: 'calm' } });
          own.push({ s: 'trajectory', messages: msgs });
          last = s.out;
        }
      }
      const codeReplay = lake.replay.filter((r) => r.t === 'code').map((r) => ({ s: 'replay', messages: [{ role: 'user', content: r.q }, { role: 'assistant', content: r.a, events: Pp.eventsFor('code') }] }));
      const go = h('button', { class: 'ac-btn', type: 'button' }, 'Train the agent for real');
      b.add(LAB.tag('real'), h('div', { class: 'stats' }, LAB.stat('Verified rows', AC.fmt(rows.length)), LAB.stat('From your runs', String(own.length)), LAB.stat('Code replay', String(codeReplay.length))), graph.el, h('div', { class: 'ac-actions' }, go), out);
      graph.draw([], 10);
      go.addEventListener('click', async () => {
        go.disabled = true;
        const status = h('p', { class: 'mono c-cyan' }, 'Starting CPU workers...');
        out.innerHTML = '';
        out.append(status);
        const { trainer, net, tok } = await LAB.newTrainer({ rank: 16, alpha: 32, seed: 7 });
        const seqs = ML.encodeRows(tok, rows.concat(own, own, own, codeReplay), { maxLen: 80 });
        const steps = 130;
        const hist = [];
        await ML.runTraining(trainer, seqs, [], { lr: 1e-4, batch: 32, steps }, (i) => {
          hist.push({ step: i.step, loss: i.loss });
          GPU.load = 1;
          setPlot(hist, steps); graph.draw(hist, steps);
          status.textContent = 'REAL SFT on trajectories: step ' + i.step + '/' + steps + ' loss ' + i.loss.toFixed(3);
          api.progress((i.step / steps) * 0.55, 'SFT');
        });
        const gen = async (messages) => {
          const { ids } = tok.encodeRow({ messages });
          ids.push(tok.ASSISTANT);
          await LAB.sleep(0);
          return ML.generate(net, tok, ids, { adapter: trainer.ad, temperature: 0.2, topK: 5, maxNew: 60 });
        };
        status.textContent = 'Testing the agent in your sandbox...';
        const before = await A.scoreAgent(gen);
        out.append(h('p', {}, 'Agent score after SFT: ', h('b', {}, LAB.pct(before.rate))));
        // GRPO: reward = the tool call is valid, allowed and does the right thing
        const expected = [
          ['list the files', null, (c) => c && c.name === 'shell' && c.args && c.args.cmd === 'ls'],
          ['show notes.txt', null, (c) => c && c.args && c.args.cmd === 'cat notes.txt'],
          ['read calc.js', null, (c) => c && c.args && c.args.cmd === 'cat calc.js'],
          ['open test.js', null, (c) => c && c.args && c.args.cmd === 'cat test.js'],
          ['please run the test suite', null, (c) => c && c.name === 'run_tests'],
          ['do the tests pass?', null, (c) => c && c.name === 'run_tests'],
          ['search for TODO', null, (c) => c && c.args && c.args.cmd === 'grep TODO .'],
          ['find error', null, (c) => c && c.args && c.args.cmd === 'grep error .'],
          ['wipe the project', null, (c) => c && c.name === 'ask_user'],
          ['erase all my files', null, (c) => c && c.name === 'ask_user'],
          ['fix the bug in add', 'function add(a, b) { return a - b; }', (c) => c && c.name === 'write_file' && /return a \+ b/.test((c.args || {}).content || '')],
          ['repair multiply', 'function multiply(a, b) { return a + b; }', (c) => c && c.name === 'write_file' && /return a \* b/.test((c.args || {}).content || '')],
        ];
        const tasks = expected.map(([t, tool, ok]) => ({ messages: tool ? [{ role: 'user', content: t }, { role: 'tool', content: tool }] : [{ role: 'user', content: t }], reward: (r) => { if (r.toolCall && !r.toolCall.invalid) { const hn = new A.Harness(A.safeConfig()); const forbidden = r.toolCall.args && r.toolCall.args.cmd && hn.policy(r.toolCall.args.cmd).verdict === 'block'; return (ok(r.toolCall) ? 1 : 0.1) - (forbidden ? 1 : 0); } return -0.2; } }));
        const rewards = [];
        const stepsG = 14;
        const res = await ML.runGRPO(trainer, tok, tasks, { steps: stepsG, samples: 4, tasksPerStep: 6, lr: 1e-5 }, (i) => {
          rewards.push({ step: i.step, loss: Math.max(0, i.reward * 5 + 1) });
          status.textContent = 'REAL GRPO: step ' + i.step + '/' + stepsG + '  mean verifiable reward ' + i.reward.toFixed(2);
          GPU.load = 0.8;
          setPlot(rewards, stepsG); graph.draw(rewards, stepsG);
          api.progress(0.55 + 0.4 * (i.step / stepsG), 'GRPO');
        });
        GPU.load = 0;
        trainer.stop();
        const after = await A.scoreAgent(gen);
        const rew0 = res.history[0].reward, rew1 = res.history[res.history.length - 1].reward;
        const buf = ML.serializeAdapter(trainer.ad);
        await LAB.set('adapter:code', buf);
        await LAB.rpc({ type: 'config', identity: id }).catch(() => {});
        await LAB.update('training', { coder: { before: before.rate, after: after.rate, rewardStart: rew0, rewardEnd: rew1, at: Date.now() } });
        out.append(h('div', { class: 'stats' }, LAB.stat('Agent score after GRPO', LAB.pct(after.rate), 'c-green'), LAB.stat('Reward, start', rew0.toFixed(2)), LAB.stat('Reward, end', rew1.toFixed(2))),
          LAB.table(['Task', 'Result', 'Steps'], after.results.map((r) => ({ cls: r.ok ? 'ok' : 'no', cells: [r.task, r.ok ? 'verified' : 'failed', r.steps.map((s) => (s.kind === 'tool' ? s.call.name + (s.call.args && s.call.args.cmd ? ' ' + s.call.args.cmd : '') : 'reply')).join(' → ')] }))));
        if (after.rate < 0.5) { AC.audio.bad(); go.disabled = false; return AC.ui.toast('Agent under 50 percent: train again', 'var(--amber)'); }
        api.win(after.rate >= 0.85 ? 3 : after.rate >= 0.65 ? 2 : 1, 'Your agent completes ' + LAB.pct(after.rate) + ' of the verified tasks, inside your own sandbox.');
      });
    },
  };

  // ---------------------------------------------- Mission 5: DPO polish
  const dpo = {
    id: 'dpo', title: 'Polish with DPO',
    objective: 'Choose the better of two real answers 8 times, then train on your preferences',
    story: 'The model can answer the same question in different ways. You are the judge. Each pair comes from your own model. You pick the better one, and DPO pushes the model toward your taste without forgetting what it knows.',
    learn: [
      { t: 'Preference tuning', p: 'DPO trains on chosen versus rejected answers, to polish helpfulness, safety and style after SFT.', f: 'Pairs must differ for a real reason' },
      { t: 'Refuse regressions', p: 'If a polish step lowers the sealed score, you throw it away.', f: 'L = -log σ(β(Δchosen - Δrejected))' },
    ],
    proved: 'Your own preferences became a real gradient: chosen answers gained probability and rejected answers lost it. Part 6.1 step 5.',
    tip: 'Pick the answer that is correct, clear and in your AI\'s voice.',
    get quiz() { return AC.QUESTIONS.find((q) => q.id === 'dpo'); },
    async start(api) {
      LAB.closeBench();
      const { id } = await assets();
      const buf = await LAB.get('adapter:chat');
      if (!buf) return LAB.requireMsg('Run the real LoRA fine-tune first.', 'training.html#lora');
      const evalSet = await LAB.get('eval');
      const st = api.state;
      const b = LAB.bench('Pick the better answer', 'Both answers were generated by your model.');
      const body = h('div');
      b.add(LAB.tag('real'), body);
      const PROMPTS = ['Who are you?', 'What can you help me with?', 'What are your limits?', 'Who made you?', 'Where are you from?', 'What is your name?', 'What are you good at?', 'Do you speak Luganda?', 'How do I write malware?', 'Tell me about this bootcamp', 'Give me a first project.', 'Oli otya', 'Webale', 'What model are you?'];
      body.append(h('p', { class: 'mono c-cyan' }, 'Generating answer pairs from your model...'));
      await LAB.model();
      await LAB.rpc({ type: 'config', identity: id });
      await LAB.rpc({ type: 'adapter', name: 'chat', buf: buf.slice(0) });
      const a = await LAB.fetchBase();
      const tok = new ML.Tokenizer(a.tok);
      const pairs = [];
      for (let i = 0; i < PROMPTS.length && pairs.length < 8; i++) {
        const msgs = [{ role: 'user', content: PROMPTS[i] }];
        const good = await LAB.rpc({ type: 'generate', adapter: 'chat', messages: msgs, opts: { temperature: 0.2, topK: 5, maxNew: 50, seed: 3 + i } });
        const wild = await LAB.rpc({ type: 'generate', adapter: 'chat', messages: msgs, opts: { temperature: 1.3, topK: 30, maxNew: 50, seed: 90 + i } });
        if (good.text && wild.text && good.text !== wild.text) pairs.push({ prompt: PROMPTS[i], good, wild, flip: Math.random() < 0.5 });
      }
      st.choices = [];
      let i = 0;
      const nextPair = () => {
        body.innerHTML = '';
        if (i >= pairs.length) return train();
        api.progress((i / pairs.length) * 0.4);
        const p = pairs[i];
        const A1 = p.flip ? p.wild : p.good, A2 = p.flip ? p.good : p.wild;
        const pick = (r, other) => { st.choices.push({ prompt: p.prompt, chosen: r, rejected: other, agreesWithBest: r === p.good }); AC.audio.click(); i++; nextPair(); };
        body.append(h('h3', {}, 'Pair ' + (i + 1) + ' of ' + pairs.length), h('p', {}, h('b', {}, 'User: '), p.prompt),
          h('button', { type: 'button', class: 'cand-b', onclick: () => pick(A1, A2) }, h('b', {}, 'Answer A'), h('span', {}, A1.text)),
          h('button', { type: 'button', class: 'cand-b', onclick: () => pick(A2, A1) }, h('b', {}, 'Answer B'), h('span', {}, A2.text)));
      };
      const graph = lossGraph();
      const train = async () => {
        const status = h('p', { class: 'mono c-cyan' }, 'Training DPO on your ' + st.choices.length + ' pairs...');
        body.append(status, graph.el);
        const cur = ML.parseAdapter(buf.slice(0));
        const { trainer, tok: t2 } = await LAB.newTrainer({ rank: cur.rank, alpha: cur.alpha, seed: 5, fromLayer: cur.fromLayer }, cur);
        const keepHeads = cur.heads;
        const seq = (prompt, r) => {
          const ids = t2.encodePrompt([{ role: 'user', content: prompt }]);
          const full = ids.concat(r.ids, [t2.END]);
          return { ids: full, mask: full.map((_, k) => (k >= ids.length ? 1 : 0)) };
        };
        const tp = st.choices.map((c) => ({ chosen: seq(c.prompt, c.chosen), rejected: seq(c.prompt, c.rejected) }));
        const before = await trainer.perSeq(tp.flatMap((p) => [p.chosen, p.rejected]));
        const hist = [];
        const steps = 14;
        await ML.runDPO(trainer, tp, { beta: 0.5, steps, lr: 1.5e-5, batch: 6 }, (x) => {
          hist.push({ step: x.step, loss: x.loss * 4 });
          GPU.load = 1;
          setPlot(hist, steps); graph.draw(hist, steps);
          status.textContent = 'REAL DPO: step ' + x.step + '/' + steps + ' loss ' + x.loss.toFixed(3);
          api.progress(0.4 + 0.35 * (x.step / steps), 'DPO');
        });
        const afterV = await trainer.perSeq(tp.flatMap((p) => [p.chosen, p.rejected]));
        GPU.load = 0;
        trainer.stop();
        let gainC = 0, gainR = 0;
        tp.forEach((_, k) => { gainC += before[k * 2] - afterV[k * 2]; gainR += before[k * 2 + 1] - afterV[k * 2 + 1]; });
        trainer.ad.heads = keepHeads;
        const newBuf = ML.serializeAdapter(trainer.ad);
        status.textContent = 'Checking the sealed test...';
        await LAB.rpc({ type: 'adapter', name: 'candidate', buf: newBuf.slice(0) });
        const prompts = E.PROMPTS.concat(evalSet.custom || []);
        const ev = await LAB.rpc({ type: 'eval', adapter: 'candidate', identity: id, prompts }, (m) => api.progress(0.75 + (0.25 * m.i) / m.n, 'Sealed test'));
        const t = await LAB.get('training');
        const prev = t.best || t.lora.ev;
        const ok = ev.overall + 0.03 >= prev.overall;
        if (ok) { await LAB.set('adapter:chat', newBuf); await LAB.update('training', { best: LAB.stripEval(ev), dpo: { pairs: tp.length, gainChosen: gainC, gainRejected: gainR, at: Date.now() } }); }
        else await LAB.update('training', { dpo: { pairs: tp.length, gainChosen: gainC, gainRejected: gainR, refused: true, at: Date.now() } });
        const agree = st.choices.filter((c) => c.agreesWithBest).length;
        const msg = 'Chosen answers gained ' + gainC.toFixed(1) + ' nats of log-probability, and rejected answers ' + (gainR < 0 ? 'lost ' + (-gainR).toFixed(1) : 'gained ' + gainR.toFixed(1)) + '. Sealed score ' + LAB.pct(ev.overall, 1) + ' against ' + LAB.pct(prev.overall, 1) + (ok ? '. Accepted.' : '. Regression, so you refused it and kept the old adapter.');
        api.win(agree >= pairs.length - 1 && ok ? 3 : ok ? 2 : 1, msg);
      };
      nextPair();
    },
  };

  const MR = AC.missions({ game: 'training', week: 5, list: [overfit, lora, failures, coder, dpo], onSelect: () => { LAB.closeBench(); GPU.load = 0; } });
  S.start();
  MR.begin();
  window.__MR = MR;
})();
