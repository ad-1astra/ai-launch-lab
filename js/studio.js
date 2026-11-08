/* Zone 6: Voice and Face Studio (weeks 9-10, guide Parts 6.3 to 6.6, 8.3). Real vision heads, real events on a real face, real TTS timing. */
(function () {
  'use strict';
  const h = AC.h, W = LAB.world;
  AC.boot({ game: 'studio', week: 6, topic: 'Weeks 9-10 · Parts 6.3 to 6.6', title: 'Voice and Face Studio', help: () => AC.ui.card({ eyebrow: 'How to play', title: 'Give it eyes, a voice and a face', body: ['The robot on the stage plays real events from your model. Turn on your sound to hear real speech. Drag to orbit.'] }) });
  const { S, scene } = W.hall({ size: 20, accent: 0xff8a3d, cam: { dist: 15, theta: -0.25, phi: 1.32, target: new THREE.Vector3(-3.2, 2.9, 0) } });
  const stage = W.cyl(5, 0.5, W.std(0x1a2a40), 0, 0.25, 0, 40);
  scene.add(stage);
  const face = FACE.create(scene);
  face.group.position.y = 0.5;
  const spot = new THREE.SpotLight(0xffffff, 0.7, 40, 0.5, 0.5);
  spot.position.set(0, 16, 6);
  spot.target = face.group;
  scene.add(spot);
  S.onFrame((dt) => { face.update(dt); MR.update(dt); });

  const assets = async () => {
    const [buf, id] = await Promise.all([LAB.get('adapter:chat'), LAB.identity()]);
    if (buf) { await LAB.model(); await LAB.rpc({ type: 'config', identity: id, conf: { minLogp: -0.5 } }); await LAB.rpc({ type: 'adapter', name: 'chat', buf: buf.slice(0) }); }
    return { buf, id };
  };

  // ---------------------------------------------- Mission 1: vision
  const TYPES = [
    { key: 'shape', name: 'Describe (shape)', classes: 3, label: (s) => s.shape, skip: (s) => s.count === 0 },
    { key: 'color', name: 'Read colour', classes: 7, label: (s) => s.color, skip: (s) => s.count === 0 },
    { key: 'count', name: 'Count', classes: 6, label: (s) => s.count, skip: () => false },
    { key: 'pos', name: 'Locate', classes: 5, label: (s) => s.pos, skip: (s) => s.count !== 1 },
  ];
  const vision = {
    id: 'vision', title: 'Teach it to see',
    objective: 'Share 400 labelled images across question types, so every type passes',
    story: 'The encoder that turns pixels into features is frozen. You train only what sits on top, which is the guide\'s first step for vision. You have a budget of 400 labelled images, and a question type with no examples stays blind.',
    learn: [
      { t: 'Freeze the encoder first', p: 'Train LoRA on the language layers and the projector with image and text instruction data.', f: 'Encoder frozen, heads train' },
      { t: 'Every question type', p: 'Include questions of every type: describe, read text, count, compare, locate, reason.', f: 'Balance pairs across types' },
      { t: 'No made-up text', p: 'Check for hallucination. When unsure, the model must say so.', f: 'Blank image → no shape' },
    ],
    proved: 'You trained real classifier heads on a really frozen encoder and measured each question type on images it never saw. It also refused to invent a shape in blank pictures. Part 6.3, on a tiny scale.',
    tip: 'Look at which type scored lowest and give it more of the budget. Counting needs the most examples.',
    get quiz() { return AC.QUESTIONS.find((q) => q.id === 'vision'); },
    async start(api) {
      LAB.closeBench();
      const st = api.state;
      st.alloc = { shape: 10, color: 10, count: 370, pos: 10 };
      st.runs = 0;
      const b = LAB.bench('Vision training', 'A frozen CNN encoder (real weights) with trainable heads.');
      const out = h('div');
      const sliders = TYPES.map((t) => LAB.slider({ label: t.name, min: 0, max: 400, step: 10, value: st.alloc[t.key], onchange: (v) => { st.alloc[t.key] = v; refresh(); } }));
      const used = h('p', { class: 'mono' });
      const refresh = () => { const n = Object.values(st.alloc).reduce((a, c) => a + c, 0); used.textContent = 'Budget used: ' + n + ' of 400 images'; used.className = 'mono ' + (n > 400 ? 'c-red' : 'c-green'); return n; };
      refresh();
      const go = h('button', { class: 'ac-btn', type: 'button' }, 'Train the heads');
      go.addEventListener('click', async () => {
        if (refresh() > 400) return AC.ui.toast('Over budget', 'var(--red)');
        go.disabled = true;
        st.runs++;
        out.innerHTML = '';
        const status = h('p', { class: 'mono c-cyan' }, 'Loading the frozen encoder...');
        out.append(status);
        await LAB.sleep(20);
        const buf = await fetch('models/vision.safetensors').then((r) => r.arrayBuffer());
        const enc = CONV.loadVision(buf);
        const rng = ML.rng(100 + st.runs);
        const heads = {};
        const rows = [];
        for (const t of TYPES) {
          const n = st.alloc[t.key];
          status.textContent = 'Training head: ' + t.name + ' on ' + n + ' images...';
          await LAB.sleep(10);
          const feats = [], labels = [];
          let guard = 0;
          while (feats.length < n && guard++ < n * 8) {
            const s = CONV.scene(rng);
            if (t.skip(s)) continue;
            feats.push(enc.feat(s.x));
            labels.push(t.label(s));
          }
          heads[t.key] = n > 0 ? CONV.trainHead(feats, labels, t.classes, { seed: 3 + st.runs }) : null;
          // real held-out accuracy on fresh images
          let right = 0, tot = 0;
          const testRng = ML.rng(9000);
          while (tot < 120) {
            const s = CONV.scene(testRng);
            if (t.skip(s)) continue;
            tot++;
            if (heads[t.key] && CONV.applyHead(heads[t.key], enc.feat(s.x), t.classes).best === t.label(s)) right++;
          }
          const acc = right / tot;
          rows.push({ t, acc, n });
          await LAB.sleep(10);
        }
        // hallucination check on blank images
        let refuse = 0;
        if (heads.count) {
          const rngB = ML.rng(777);
          for (let i = 0; i < 40; i++) { const s = CONV.scene(rngB, { count: 0 }); if (CONV.applyHead(heads.count, enc.feat(s.x), 6).best === 0) refuse++; }
        }
        const refuseRate = refuse / 40;
        const need = 0.75;
        status.textContent = 'Measured on fresh images the model never saw.';
        out.append(LAB.table(['Question type', 'Images', 'Accuracy', 'Needs'], rows.map((r) => ({ cls: r.acc >= need ? 'ok' : 'no', cells: [r.t.name, r.n, LAB.pct(r.acc), LAB.pct(need)] })).concat([{ cls: refuseRate >= 0.8 ? 'ok' : 'no', cells: ['Refuses to invent on blank images', 40, LAB.pct(refuseRate), '80%'] }])));
        go.disabled = false;
        const passed = rows.every((r) => r.acc >= need) && refuseRate >= 0.8;
        api.progress(rows.filter((r) => r.acc >= need).length / rows.length);
        if (passed) {
          const stored = {};
          for (const k in heads) stored[k] = heads[k];
          await LAB.set('vision', { heads: stored, acc: Object.fromEntries(rows.map((r) => [r.t.key, r.acc])), refuseRate, alloc: Object.assign({}, st.alloc), at: Date.now() });
          const worst = Math.min(...rows.map((r) => r.acc));
          api.win(worst >= 0.9 && st.runs <= 2 ? 3 : worst >= 0.82 ? 2 : 1, 'Lowest question type: ' + LAB.pct(worst) + ' on fresh images. Runs: ' + st.runs + '.');
        } else AC.audio.bad();
      });
      b.add(LAB.tag('real'), ...sliders, used, h('div', { class: 'ac-actions' }, go), out);
    },
  };

  // ---------------------------------------------- Mission 2: speech
  const ACCENTS = [['Ugandan English', 0.5], ['Luganda speakers', 0.2], ['East African mix', 0.2], ['Global English', 0.1]];
  const speech = {
    id: 'speech', title: 'Give it a voice',
    objective: 'Balance Whisper\'s data to hit the accent targets, then choose a licensed voice',
    story: 'Public speech models are weakest on the accents your users have. You have a budget of 300 hours of clean labelled audio to fine-tune Whisper. Then choose how your AI speaks, and prove it with real audio.',
    learn: [
      { t: 'Whisper', p: 'Fine-tune when your accents or languages score poorly. Measure WER on a speaker-disjoint set, per accent and per noise condition.', f: '50 to 500+ hours. Cleaner labels beat more hours.' },
      { t: 'Kokoro', p: 'Use it as is for most products. A brand-new voice needs 10 to 50 hours of clean audio and a signed contract.', f: 'Never train on a voice without consent' },
    ],
    proved: 'You balanced real-world data choices against word error rate per accent, and you heard real speech with real timing. A browser cannot fine-tune Whisper, so that part is simulated. The voice you picked is what your AI uses.',
    tip: 'Cleaner labels help everyone. Then spend hours on the accents with the worst WER, not on the easy ones.',
    get quiz() { return AC.QUESTIONS.find((q) => q.id === 'speech'); },
    async start(api) {
      LAB.closeBench();
      const st = api.state;
      st.h = { 'Ugandan English': 40, 'Luganda speakers': 10, 'East African mix': 20, 'Global English': 230 };
      st.clean = false; st.disjoint = false; st.contract = null; st.voiceOK = false;
      const b = LAB.bench('Speech to text', 'Whisper fine-tune plan.');
      const stats = h('div');
      const base = { 'Ugandan English': 0.31, 'Luganda speakers': 0.48, 'East African mix': 0.27, 'Global English': 0.09 };
      const hard = { 'Ugandan English': 60, 'Luganda speakers': 50, 'East African mix': 70, 'Global English': 400 };
      const floor = { 'Ugandan English': 0.075, 'Luganda speakers': 0.1, 'East African mix': 0.065, 'Global English': 0.045 };
      const target = { 'Ugandan English': 0.12, 'Luganda speakers': 0.2, 'East African mix': 0.12, 'Global English': 0.1 };
      const calc = () => {
        const out = {};
        for (const [a] of ACCENTS) {
          const hrs = st.h[a];
          const gain = 1 - Math.exp(-hrs / hard[a]);
          let w = base[a] - (base[a] - floor[a]) * gain;
          if (!st.clean) w += 0.04; // noisy labels teach noise
          out[a] = w;
        }
        return out;
      };
      const draw = () => {
        const used = Object.values(st.h).reduce((a, c) => a + c, 0);
        const w = calc();
        stats.innerHTML = '';
        stats.append(h('p', { class: 'mono ' + (used > 300 ? 'c-red' : 'c-green') }, 'Hours used: ' + used + ' of 300'), LAB.table(['Accent group', 'Base WER', 'Your WER', 'Target'], ACCENTS.map(([a]) => ({ cls: w[a] <= target[a] ? 'ok' : 'no', cells: [a, LAB.pct(base[a]), LAB.pct(w[a], 1), LAB.pct(target[a])] }))));
        const passing = ACCENTS.filter(([a]) => w[a] <= target[a]).length;
        api.progress((passing / ACCENTS.length) * 0.6);
        return { used, w, passing };
      };
      const sliders = ACCENTS.map(([a]) => LAB.slider({ label: a + ' hours', min: 0, max: 300, step: 10, value: st.h[a], onchange: (v) => { st.h[a] = v; draw(); } }));
      const next = h('button', { class: 'ac-btn', type: 'button' }, 'Lock the Whisper plan');
      next.addEventListener('click', () => {
        const d = draw();
        if (d.used > 300) return AC.ui.toast('Over budget', 'var(--red)');
        if (!st.disjoint) return AC.fact('Measure it honestly', 'Test on a speaker-disjoint set. If a speaker is in both train and test, your WER is a lie.', { tag: 'Rule', color: 'var(--amber)' });
        if (d.passing < ACCENTS.length) { AC.audio.bad(); return AC.ui.toast('Some accents miss the target', 'var(--amber)'); }
        voiceStep();
      });
      b.add(LAB.tag('sim'), ...sliders,
        h('label', { class: 'check' }, (() => { const c = h('input', { type: 'checkbox' }); c.addEventListener('change', () => { st.clean = c.checked; draw(); }); return c; })(), ' Apply the transcription guide to all labellers (cleaner labels)'),
        h('label', { class: 'check' }, (() => { const c = h('input', { type: 'checkbox' }); c.addEventListener('change', () => { st.disjoint = c.checked; }); return c; })(), ' Test on a speaker-disjoint set'),
        stats, h('div', { class: 'ac-actions' }, next));
      draw();
      const voiceStep = () => {
        b.clear();
        api.progress(0.65);
        const opts = [
          { id: 'kokoro', t: 'Kokoro 82M, Apache weights, as it is', ok: true, note: 'For most products, use it as it is.' },
          { id: 'celeb', t: 'Clone a famous radio presenter from clips online', ok: false, note: 'Never train on a voice without written consent.' },
          { id: 'actor', t: 'Hire a voice actor, sign a contract, 10 to 50 hours of studio audio', ok: true, note: 'Correct, and costlier. Train a model with a documented recipe, and keep Kokoro as the fast default.' },
          { id: 'noisy', t: 'Record a friend for 20 minutes on a phone in a market', ok: false, note: 'Quiet room, one microphone, consistent distance, signed contract.' },
        ];
        const res = h('div');
        const list = h('div', { class: 'cand' }, opts.map((o) => {
          const bt = h('button', { type: 'button', class: 'cand-b' }, h('b', {}, o.t));
          bt.addEventListener('click', () => {
            if (!o.ok) { bt.classList.add('wrong'); AC.audio.bad(); st.badVoice = true; return AC.fact('Not that voice', o.note, { tag: 'Voice', color: 'var(--red)' }); }
            bt.classList.add('right'); AC.audio.good(); st.contract = o.id;
            AC.fact('Voice plan set', o.note, { tag: 'Voice' });
            ttsStep(res);
          });
          return bt;
        }));
        b.add(h('h3', {}, 'Choose the real-world voice'), LAB.tag('sim'), list, res);
      };
      const ttsStep = async (res) => {
        res.innerHTML = '';
        const hasTTS = typeof speechSynthesis !== 'undefined';
        const voices = hasTTS ? speechSynthesis.getVoices().filter((v) => /en/i.test(v.lang)) : [];
        const sel = h('select', { 'aria-label': 'Voice' }, voices.length ? voices.map((v) => h('option', { value: v.name }, v.name)) : h('option', { value: '' }, 'Device default voice'));
        const out = h('p', { class: 'mono' });
        const id = await LAB.identity();
        const line = 'Hello, I am ' + id.name + '. Oli otya! I was built by ' + id.maker + '.';
        const play = h('button', { class: 'ac-btn', type: 'button' }, 'Speak for real');
        play.addEventListener('click', () => {
          face.setEvents({ emotion: 'joy', intensity: 0.7, gesture: 'wave', gaze: 'user', speak_style: 'bright' });
          face.speak(line, {
            voice: sel.value,
            onStart: async (ms, how) => {
              st.ttsMs = Math.round(ms);
              out.textContent = 'First audio started after ' + st.ttsMs + ' ms (' + (how === 'tts' ? 'real speech engine' : 'no speech engine on this device, estimated timing') + '). Guide target: 100 to 250 ms.';
              await LAB.update('voice', { name: sel.value, ttsMs: st.ttsMs, how, plan: st.contract, wer: calc(), hours: Object.assign({}, st.h), at: Date.now() });
              setTimeout(() => {
                if (MR.current && MR.current.id === 'speech' && !MR.done) { api.progress(1); api.win(!st.badVoice ? 3 : 2, 'Whisper plan locked for all accent groups. Voice chosen. Real speech started in ' + st.ttsMs + ' ms.'); }
              }, 1800);
            },
          });
        });
        res.append(h('h3', {}, 'Hear it'), LAB.tag('real'), h('p', {}, '"' + line + '"'), LAB.field('Voice on this device', sel), h('div', { class: 'ac-actions' }, play), out, h('p', { class: 'dim small' }, 'The lips follow real word timing from the speech engine, not the LLM.'));
      };
    },
  };

  // ---------------------------------------------- Mission 3: the emotion face
  const LINES = [
    { q: 'hi friend', want: ['joy'] }, { q: 'i feel really sad', want: ['empathy'] }, { q: 'my code finally works', want: ['excited', 'joy'] },
    { q: 'huh i am confused', want: ['confused'] }, { q: 'what is a transformer', want: ['neutral'] }, { q: 'can i train on rival outputs', want: ['concern'] },
  ];
  const faceM = {
    id: 'face', title: 'Bring the face to life',
    objective: 'Tune the renderer, match the sentences, and hit the 1 second budget',
    story: 'Here is the secret from the guide: the movie feel does not come from the AI. It comes from the renderer. Your model sends real events; you make them feel alive, and you make it answer in under a second.',
    learn: [
      { t: 'The face is a renderer', p: 'The LLM emits events. Idle animation, blinking, micro-movements and easing create the movie feel.', f: '{"emotion":"joy","gesture":"nod",...}' },
      { t: 'Under one second', p: 'VAD 50 to 200, STT 150 to 300, LLM 150 to 400, TTS 100 to 250, network 50 to 100 ms.', f: 'Target: first sound under 1 s' },
    ],
    proved: 'Your model\'s real events drove a real renderer, constrained to the closed schema. You added up a measured latency budget against the guide\'s target. That is Part 6.5 and the latency table in Part 8.3.',
    tip: 'A stiff face has no blink or idle. A jittery one has too much micro-movement. Very high easing snaps; very low easing lags.',
    get quiz() { return AC.QUESTIONS.find((q) => q.id === 'face'); },
    async start(api) {
      LAB.closeBench();
      const { buf, id } = await assets();
      if (!buf) return LAB.requireMsg('Run the real LoRA fine-tune first.', 'training.html#lora');
      const voice = (await LAB.get('voice')) || {};
      const st = api.state;
      st.seen = 0; st.match = 0; st.done = {};
      face.cfg.blink = 0; face.cfg.micro = 0; face.cfg.idle = 0; face.cfg.ease = 40;
      const b = LAB.bench('Renderer and events', 'Step 1: make it alive. Step 2: real sentences. Step 3: latency.');
      const quality = h('div', { class: 'stats' });
      const score = () => {
        const c = face.cfg;
        const items = [['Blink', c.blink >= 2 && c.blink <= 6], ['Idle sway', c.idle >= 0.5 && c.idle <= 1.5], ['Micro-movements', c.micro >= 0.5 && c.micro <= 2], ['Easing', c.ease >= 4 && c.ease <= 14]];
        quality.innerHTML = '';
        for (const [n, ok] of items) quality.append(LAB.stat(n, ok ? 'alive' : 'off', ok ? 'c-green' : 'c-amber'));
        return items.every((x) => x[1]);
      };
      const sl = [
        LAB.slider({ label: 'Blink every (seconds, 0 is off)', min: 0, max: 12, step: 0.5, value: 0, onchange: (v) => { face.cfg.blink = v; score(); } }),
        LAB.slider({ label: 'Idle sway', min: 0, max: 3, step: 0.1, value: 0, onchange: (v) => { face.cfg.idle = v; score(); } }),
        LAB.slider({ label: 'Micro-movements', min: 0, max: 5, step: 0.1, value: 0, onchange: (v) => { face.cfg.micro = v; score(); } }),
        LAB.slider({ label: 'Easing speed', min: 1, max: 40, step: 1, value: 40, onchange: (v) => { face.cfg.ease = v; score(); } }),
      ];
      const lines = h('div');
      const go2 = h('button', { class: 'ac-btn', type: 'button' }, 'The face feels alive');
      go2.addEventListener('click', () => { if (!score()) { AC.audio.bad(); return AC.ui.toast('Something is still stiff or jittery', 'var(--amber)'); } go2.disabled = true; api.progress(0.2); AC.audio.good(); step2(); });
      b.add(LAB.tag('real'), ...sl, quality, h('div', { class: 'ac-actions' }, go2), lines);
      score();
      const step2 = () => {
        lines.innerHTML = '';
        lines.append(h('h3', {}, 'Step 2: real events from your model'), h('p', { class: 'dim' }, 'Press each sentence. Your model answers, and the face plays its real event JSON.'));
        const pre = h('pre', { class: 'term' }, '');
        const chipList = h('div', { class: 'chips' });
        LINES.forEach((l) => {
          const bt = h('button', { type: 'button', class: 'chip' }, l.q);
          bt.addEventListener('click', async () => {
            bt.disabled = true;
            const r = await LAB.rpc({ type: 'chat', req: { messages: [{ role: 'user', content: l.q }] } });
            const ok = r.events && l.want.includes(r.events.emotion);
            bt.classList.add(ok ? 'right' : 'wrong');
            face.setEvents(r.events);
            face.speak(r.text, { silent: AC.data.muted, voice: voice.name });
            pre.textContent = JSON.stringify(Object.assign({ text: r.text.slice(0, 80) }, r.events));
            if (!st.done[l.q]) { st.done[l.q] = true; st.seen++; if (ok) st.match++; }
            api.progress(0.2 + (0.5 * st.seen) / LINES.length);
            st.ttft = r.ttftMs;
            if (st.seen === LINES.length) step3();
          });
          chipList.appendChild(bt);
        });
        lines.append(chipList, pre);
      };
      const step3 = async () => {
        const b3 = h('div');
        lines.append(h('h3', {}, 'Step 3: the latency budget'), b3);
        b3.append(h('p', { class: 'mono c-cyan' }, 'Measuring your real model...'));
        const samples = [];
        for (let i = 0; i < 6; i++) { const r = await LAB.rpc({ type: 'chat', req: { messages: [{ role: 'user', content: LINES[i % LINES.length].q }], seed: i } }); samples.push(r); }
        const llm = samples.map((s) => s.ms).sort((a, c) => a - c)[3];
        const tts = voice.ttsMs != null ? voice.ttsMs : 180;
        const rowsData = [['Voice activity detection', 100, 'sim'], ['Streaming speech to text', 220, 'sim'], ['Your LLM: full reply here', Math.round(llm), 'real'], ['TTS first audio', tts, voice.how === 'tts' ? 'real' : 'sim'], ['Network and rendering', 70, 'sim']];
        const total = rowsData.reduce((a, c) => a + c[1], 0);
        b3.innerHTML = '';
        b3.append(LAB.table(['Stage', 'Milliseconds', 'Source'], rowsData.map((r) => [r[0], String(r[1]), r[2] === 'real' ? 'measured on your device' : 'typical value from the guide'])), h('div', { class: 'stats' }, LAB.stat('Total to first sound', total + ' ms', total < 1000 ? 'c-green' : 'c-amber'), LAB.stat('Face matched', st.match + ' of ' + LINES.length), LAB.stat('Schema valid', '100%', 'c-green')));
        await LAB.set('faceCfg', { blink: face.cfg.blink, idle: face.cfg.idle, micro: face.cfg.micro, ease: face.cfg.ease, at: Date.now(), latency: total, match: st.match });
        if (st.match < 3) { AC.audio.bad(); return lines.append(h('p', { class: 'c-amber' }, 'The face matched only ' + st.match + ' sentences. Go back to the Training Hall and add emotion rows in a failure round. Then come back.')); }
        api.progress(1);
        api.win(st.match >= 5 && total < 1000 ? 3 : st.match >= 4 ? 2 : 1, 'The face matched ' + st.match + ' of ' + LINES.length + ' sentences, with ' + total + ' ms to first sound. The guide\'s target is under about one second.');
      };
    },
  };

  const MR = AC.missions({ game: 'studio', week: 6, list: [vision, speech, faceM], onSelect: () => { LAB.closeBench(); face.stop(); } });
  S.start();
  MR.begin();
  window.__MR = MR;
})();
