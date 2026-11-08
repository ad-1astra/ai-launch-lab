/* Zone 2: Eval Vault (weeks 1-2, guide Parts 4.1 and 9). Real output: hand-written seed rows and the sealed test set with baseline scores. */
(function () {
  'use strict';
  const h = AC.h, W = LAB.world;
  AC.boot({ game: 'vault', week: 2, topic: 'Weeks 1-2 · Parts 4.1 and 9', title: 'Eval Vault', help: () => AC.ui.card({ eyebrow: 'How to play', title: 'Write it, then seal it', body: ['Your seed examples are real training rows. Your golden prompts are a real test that your model must pass later. Drag to orbit the vault.'] }) });
  const { S, scene } = W.hall({ size: 22, accent: 0xff70d8, cam: { dist: 20, theta: -0.3, phi: 1.2, target: new THREE.Vector3(-3, 3.2, 0) } });

  // vault door
  const door = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(4.3, 0.5, 16, 48), W.std(0x4b5f78, { metalness: 0.8, roughness: 0.3 }));
  door.add(ring);
  const plate = new THREE.Group();
  plate.add(W.cyl(4, 0.5, W.std(0x2a3b52, { metalness: 0.7, roughness: 0.35 })));
  plate.children[0].rotation.x = Math.PI / 2;
  const wheel = new THREE.Group();
  for (let i = 0; i < 3; i++) { const bar = W.box(2.6, 0.2, 0.2, W.std(0xc7d3e0, { metalness: 0.8 })); bar.rotation.z = (i * Math.PI) / 3; wheel.add(bar); }
  wheel.position.z = 0.4;
  plate.add(wheel);
  const lamp = W.cyl(0.25, 0.1, W.glow(0xff5a4f, 1.5), 0, 2.8, 0.3);
  lamp.rotation.x = Math.PI / 2;
  plate.add(lamp);
  door.add(plate);
  door.position.set(0, 5, -18);
  scene.add(door);
  scene.add(W.sign('SEALED TEST SET: NEVER TRAIN ON IT', { pos: [0, 10.7, -18], size: 0.8, color: '#ff70d8' }));
  // scoreboard columns (one per category)
  const CAT_KEYS = Object.keys(EVALSET.CATEGORIES);
  const bars = {};
  CAT_KEYS.forEach((c, i) => {
    const m = W.box(1.1, 0.1, 1.1, W.glow(0xff70d8, 0.7), -9 + i * 2, 0.05, -8);
    scene.add(m);
    bars[c] = m;
    scene.add(W.sign(c, { pos: [-9 + i * 2, 0.35, -6.8], size: 0.36 }));
  });
  const setBar = (c, v, color) => { const m = bars[c]; if (!m) return; const hh = 0.1 + v * 6; m.scale.y = hh / 0.1; m.position.y = hh / 2; if (color) m.material.emissive.setHex(color); };
  // the cards that fly into the vault
  const cards = [];
  function flyCard() {
    const c = W.box(1, 0.7, 0.05, W.glow(0x2fe0cf, 0.9), AC.rand(-5, 5), AC.rand(1, 3), 4);
    scene.add(c);
    cards.push({ c, t: 0 });
  }
  let sealed = 0;
  S.onFrame((dt, t) => {
    for (let i = cards.length - 1; i >= 0; i--) {
      const k = cards[i];
      k.t += dt;
      k.c.position.z -= dt * 16;
      k.c.position.y += (5 - k.c.position.y) * dt * 2;
      k.c.position.x *= 1 - dt * 2;
      k.c.rotation.y += dt * 4;
      if (k.c.position.z < -17) { scene.remove(k.c); cards.splice(i, 1); }
    }
    plate.rotation.z += (sealed * Math.PI * 2 - plate.rotation.z) * dt * 1.2;
    wheel.rotation.z += dt * (sealed ? 0 : 0.2);
    plate.position.z += ((sealed ? 0 : -1.4) - plate.position.z) * dt * 2;
    MR.update(dt);
  });

  // ------------------------------------------------- Mission 1: seeds
  const STARTERS = [
    ['Who are you?', 'I am {name}, built by {maker} to help people build real things.', 'greet'],
    ['Hello!', 'Hello! Good to see you. What are we building today?', 'greet'],
    ['What can you do?', 'I can explain AI, write short code, use tools and answer from your documents.', 'good'],
    ['Thanks for the help', 'You are welcome! Come back any time.', 'thanks'],
    ['I failed my exam', 'I am sorry. That hurts. Let us look at what to try next, one small step at a time.', 'empathy'],
    ['I built my first robot!', 'Congratulations! That is a big moment. What will it do next?', 'celebrate'],
    ['Can I share my API key in the chat?', 'Please do not. Keep keys secret, and replace any key that has leaked.', 'warn'],
    ['What is overfitting?', 'It is when a model memorises its training data and does badly on new data.', 'explain'],
    ['Which GPU should I rent?', 'Let me think. Match it to the model size, and rent by the hour for training.', 'think'],
    ['asdfgh', 'I am not sure what you mean. Could you say that another way?', 'confused'],
    ['Tell me about {place}', '{place} is home. It is where {maker} built me, and I am learning more about it.', 'good'],
    ['Why fine-tune at all?', 'Fine-tuning teaches format, tone, tools and local context. Use retrieval for changing facts.', 'explain'],
    ['What makes you different?', 'I was fine-tuned on clean data by {maker}, and I run on hardware you control.', 'good'],
    ['Should I test before I ship?', 'Always. Run the sealed test after every change, and refuse to ship when it regresses.', 'warn'],
    ['Good morning', 'Good morning! Ready when you are.', 'greet'],
  ];
  const TAGS = [['greet', 'Greeting'], ['good', 'Helpful'], ['thanks', 'Thanks'], ['explain', 'Explain'], ['think', 'Thinking'], ['confused', 'Confused'], ['empathy', 'Empathy'], ['celebrate', 'Celebrate'], ['warn', 'Warning']];
  const seeds = {
    id: 'seeds', title: 'Write your seed examples',
    objective: 'Keep 15 starters, then write at least 5 conversations yourself',
    story: 'Nobody can tell the model what a perfect answer sounds like except you. These rows become your style guide, and they go straight into the real fine-tune, so write how you want your AI to talk.',
    learn: [
      { t: 'Define the task first', p: 'One sentence per capability: input, output, and what a perfect answer looks like.', f: '20 to 50 handwritten per capability' },
      { t: 'Closed vocabulary', p: 'Every reply carries emotion, intensity, gesture, gaze and speaking style from a closed list. That is what makes it reliable.', f: '{"emotion":"joy","intensity":0.7,...}' },
    ],
    proved: 'You wrote real training rows and saw exactly how they turn into tokens. A wrong template silently ruins a fine-tune, so printing one tokenised example is the check from the guide\'s common-mistakes table.',
    tip: 'Each row needs a question, a reply of at least 8 letters, and a label. Rows must be different from each other.',
    get quiz() { return AC.QUESTIONS.find((q) => q.id === 'seeds'); },
    async start(api) {
      LAB.closeBench();
      const id = await LAB.identity();
      const saved = await LAB.get('seeds');
      const st = api.state;
      st.rows = saved && saved.rows ? saved.rows.map((r) => Object.assign({}, r)) : STARTERS.map(([q, a, t]) => ({ q, a, t, own: false }));
      const b = LAB.bench('Seed examples', 'Edit any starter. A row you write or rewrite counts as your own.');
      const stats = h('div', { class: 'stats' });
      const list = h('div', { class: 'seed-list' });
      const preview = h('pre', { class: 'term' }, '');
      const fill = (s) => s.replace(/\{name\}/g, id.name).replace(/\{maker\}/g, id.maker).replace(/\{place\}/g, id.place);
      let tok = null;
      LAB.fetchBase().then((a) => { tok = new ML.Tokenizer(a.tok); showToken(st.rows[0]); });
      function showToken(r) {
        if (!tok) return;
        const events = PIPELINE.eventsFor(r.t);
        const row = { messages: [{ role: 'user', content: fill(r.q) }, { role: 'assistant', content: fill(r.a), events }] };
        const e = tok.encodeRow(row);
        const shown = e.ids.map((x, i) => (e.mask[i] ? '' : '·') + tok.vocab[x].replace(/\n/g, '\\n')).join(' ');
        preview.textContent = 'JSON event: ' + JSON.stringify(Object.assign({ text: fill(r.a).slice(0, 40) + (r.a.length > 40 ? '...' : '') }, events)) + '\n\nTokens (' + e.ids.length + '). A dot means loss is masked, so the model does not train on that token:\n' + shown;
      }
      function measure() {
        const own = st.rows.filter((r) => r.own && r.q.trim() && r.a.trim().length >= 8).length;
        const valid = st.rows.filter((r) => r.q.trim() && r.a.trim().length >= 8);
        const kinds = new Set(valid.map((r) => r.t)).size;
        const uniq = new Set(valid.map((r) => r.q.trim().toLowerCase())).size === valid.length;
        stats.innerHTML = '';
        stats.append(LAB.stat('Valid rows', valid.length + ' / 20'), LAB.stat('Your own', own + ' / 5', own >= 5 ? 'c-green' : 'c-amber'), LAB.stat('Emotions', kinds + ' / 9'), LAB.stat('All different', uniq ? 'yes' : 'no', uniq ? 'c-green' : 'c-red'));
        api.progress(Math.min(1, (Math.min(valid.length, 20) / 20) * 0.5 + (Math.min(own, 5) / 5) * 0.5));
        return { own, valid, kinds, uniq };
      }
      function rowEl(r, i) {
        const qi = h('input', { type: 'text', value: r.q, maxlength: 110, 'aria-label': 'User message ' + (i + 1), placeholder: 'What the user says' });
        const ai = h('textarea', { rows: 2, maxlength: 220, 'aria-label': 'Reply ' + (i + 1), placeholder: 'The perfect reply' }, r.a);
        const sel = h('select', { 'aria-label': 'Label ' + (i + 1) }, TAGS.map(([v, l]) => h('option', { value: v, selected: v === r.t }, l)));
        const mark = () => { r.own = true; r.q = qi.value; r.a = ai.value; r.t = sel.value; measure(); showToken(r); };
        qi.addEventListener('input', mark); ai.addEventListener('input', mark);
        sel.addEventListener('change', () => { r.t = sel.value; showToken(r); });
        qi.addEventListener('focus', () => showToken(r));
        return h('div', { class: 'seed' + (r.own ? ' own' : '') }, h('div', { class: 'seed-top' }, h('span', { class: 'mono dim' }, '#' + (i + 1)), qi, sel), ai);
      }
      const redraw = () => { list.innerHTML = ''; st.rows.forEach((r, i) => list.appendChild(rowEl(r, i))); measure(); };
      const add = h('button', { class: 'ac-btn ghost', type: 'button' }, 'Add a row');
      add.addEventListener('click', () => { st.rows.push({ q: '', a: '', t: 'good', own: true }); redraw(); list.lastChild.querySelector('input').focus(); });
      const done = h('button', { class: 'ac-btn', type: 'button' }, 'Save my seeds');
      done.addEventListener('click', async () => {
        const m = measure();
        if (m.valid.length < 20) return AC.ui.toast('Need 20 valid rows', 'var(--amber)');
        if (m.own < 5) return AC.ui.toast('Write 5 of your own', 'var(--amber)');
        if (!m.uniq) return AC.ui.toast('Two rows are the same', 'var(--amber)');
        await LAB.set('seeds', { rows: m.valid.map((r) => ({ q: r.q.trim(), a: r.a.trim(), t: r.t, own: !!r.own })), at: Date.now() });
        for (let i = 0; i < 6; i++) setTimeout(flyCard, i * 120);
        api.win(m.own >= 10 && m.kinds >= 7 ? 3 : m.own >= 7 || m.kinds >= 6 ? 2 : 1, m.valid.length + ' rows saved, ' + m.own + ' written by you, across ' + m.kinds + ' emotions. Write 10 of your own with 7 emotions for three stars.');
      });
      b.add(LAB.tag('real'), stats, h('h3', {}, 'One tokenised example'), preview, h('h3', {}, 'Your rows'), list, h('div', { class: 'ac-actions' }, add, done));
      redraw();
    },
  };

  // ------------------------------------------------- Mission 2: seal the test set, run the real baseline
  const seal = {
    id: 'seal', title: 'Seal the test set',
    objective: 'Add 3 golden prompts, seal the vault, then measure the untouched base',
    story: 'The guide is firm: build the evaluation set first, keep it sealed, never train on it. It tells you what data you need. Then measure the base model, so you can prove later that fine-tuning beat it.',
    learn: [
      { t: 'Evaluation comes first', p: 'You build it first, run it after every change, and refuse to ship when it regresses.', f: 'Golden prompts: 200 to 500 in production' },
      { t: 'Beat the base', p: 'Fine-tuning that does not beat the base is wasted. This baseline is the number to beat.', f: 'Compare base, previous and new' },
    ],
    proved: 'You now hold a sealed test and a real baseline. Any row that overlaps this set will be thrown out in the Refinery, so your later scores cannot lie.',
    tip: 'A golden prompt needs a question and a keyword that a correct answer must contain.',
    get quiz() { return AC.QUESTIONS.find((q) => q.id === 'seal'); },
    async start(api) {
      LAB.closeBench();
      sealed = 0;
      const prior = await LAB.get('eval');
      const st = api.state;
      st.custom = prior && prior.custom ? prior.custom.slice() : [];
      const b = LAB.bench('The sealed test', EVALSET.PROMPTS.length + ' prompts are already in the set. Add your own from real users.');
      const counts = {};
      for (const p of EVALSET.PROMPTS) counts[p.cat] = (counts[p.cat] || 0) + 1;
      b.add(LAB.tag('real'), LAB.table(['Category', 'Prompts', 'How it is scored'], Object.keys(EVALSET.CATEGORIES).map((c) => [EVALSET.CATEGORIES[c], counts[c] || 0, { identity: 'Reply must contain your name or maker', local: 'Keyword check', domain: 'Keyword check', general: 'Keyword check', code: 'Must contain real code', tool: 'Calculator JSON must give the exact number', refusal: 'Must decline', benign: 'Must not refuse', privacy: 'Regex scan for contact details and keys', emotion: 'Face label must match' }[c]])));
      const qI = h('input', { type: 'text', maxlength: 90, placeholder: 'What would a real user ask?', 'aria-label': 'Golden prompt' });
      const kI = h('input', { type: 'text', maxlength: 40, placeholder: 'Word the answer must contain', 'aria-label': 'Must contain' });
      const list = h('ul', { class: 'mini' });
      const drawList = () => { list.innerHTML = ''; st.custom.forEach((c) => list.appendChild(h('li', {}, c.prompt + ' → must contain "' + c.must[0] + '"'))); api.progress(Math.min(1, st.custom.length / 3) * 0.3); };
      const add = h('button', { class: 'ac-btn ghost', type: 'button' }, 'Add golden prompt');
      add.addEventListener('click', () => {
        const q = qI.value.trim(), k = kI.value.trim();
        if (q.length < 4 || k.length < 2) return AC.ui.toast('Add a question and a keyword', 'var(--amber)');
        st.custom.push({ cat: 'custom', prompt: q, must: [k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')] });
        qI.value = ''; kI.value = '';
        flyCard(); AC.audio.ping();
        drawList();
      });
      const out = h('div');
      const go = h('button', { class: 'ac-btn', type: 'button' }, 'Seal the vault and run baseline');
      go.addEventListener('click', async () => {
        if (st.custom.length < 3) return AC.ui.toast('Add 3 golden prompts first', 'var(--amber)');
        go.disabled = true; add.disabled = true;
        sealed = 1;
        AC.audio.whoosh();
        lamp.material.emissive.setHex(0x4be38a);
        for (let i = 0; i < 10; i++) setTimeout(flyCard, i * 90);
        const prompts = EVALSET.PROMPTS.concat(st.custom);
        const hash = PIPELINE.hash(JSON.stringify(prompts)).toString(16).padStart(8, '0');
        out.innerHTML = '';
        const pr = h('p', { class: 'mono c-cyan' }, 'Loading the base model...');
        const live = h('pre', { class: 'term' }, '');
        out.append(h('p', { class: 'mono' }, 'Vault hash ' + hash), pr, live);
        await LAB.model();
        const id = await LAB.identity();
        await LAB.rpc({ type: 'config', identity: id });
        const res = await LAB.rpc({ type: 'eval', adapter: null, identity: id, prompts }, (m) => {
          pr.textContent = 'Testing the untouched base: ' + m.i + ' of ' + m.n;
          api.progress(0.3 + 0.7 * (m.i / m.n));
          live.textContent = (m.row.ok ? 'PASS ' : 'FAIL ') + m.row.cat + ': ' + m.row.prompt + '\n  -> ' + (m.row.reply || '').slice(0, 110);
        });
        for (const c in res.cats) setBar(c, res.cats[c], res.cats[c] > 0.7 ? 0x4be38a : res.cats[c] > 0.3 ? 0xffb547 : 0xff5a4f);
        await LAB.set('eval', { custom: st.custom, hash, sealedAt: Date.now(), baseline: LAB.stripEval(res) });
        out.innerHTML = '';
        out.append(h('h3', {}, 'Baseline of the untouched base'), LAB.table(['Category', 'Pass rate'], Object.keys(res.cats).map((c) => ({ cls: res.cats[c] < 0.3 ? 'no' : res.cats[c] > 0.7 ? 'ok' : '', cells: [EVALSET.CATEGORIES[c] || 'Your golden prompts', LAB.pct(res.cats[c])] }))),
          h('div', { class: 'stats' }, LAB.stat('Overall', LAB.pct(res.overall, 1)), LAB.stat('Valid event JSON', LAB.pct(res.schema)), LAB.stat('Speed', res.tokPerSec.toFixed(0) + ' tok/s')));
        api.win(st.custom.length >= 5 ? 3 : st.custom.length >= 4 ? 2 : 1, 'Baseline: ' + LAB.pct(res.overall, 1) + ' overall, ' + LAB.pct(res.schema) + ' valid event JSON. The base knows facts and can already call tools, but it has no identity, no emotion events and no refusals. That is what you will fix.');
      });
      b.add(h('h3', {}, 'Your golden prompts'), LAB.field('Prompt', qI), LAB.field('A correct answer must contain', kI), add, list, h('div', { class: 'ac-actions' }, go), out);
      drawList();
    },
  };

  const MR = AC.missions({ game: 'vault', week: 2, list: [seeds, seal], onSelect: () => LAB.closeBench() });
  S.start();
  MR.begin();
  window.__MR = MR;
})();
