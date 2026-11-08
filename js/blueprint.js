/* Zone 1: Blueprint Hall (weeks 1-2, guide Parts 1-3). Real output: identity, router rules and the stack plan used by the final AI. */
(function () {
  'use strict';
  const h = AC.h, W = LAB.world;
  AC.boot({ game: 'blueprint', week: 1, topic: 'Weeks 1-2 · Parts 1-3', title: 'Blueprint Hall', help: () => help() });
  function help() { AC.ui.card({ eyebrow: 'How to play', title: 'Design before you build', body: ['Drag to orbit the hall. Use the panel on the right to do the work. Press the glowing pods in the hall to read about them. Everything you decide here is saved and used by your AI later.'] }); }

  const { S, scene, oc } = W.hall({ size: 26, accent: 0x2fe0cf, cam: { dist: 24, theta: 0.0, phi: 1.05, target: new THREE.Vector3(-4, 3, 0) } });
  const clicks = W.clicks(S);
  const packets = W.packets(scene);

  // Gateway in the middle, specialists in an arc
  const SPEC = [
    { id: 'chat', name: 'Chat LLM', run: 'vLLM on GPU', c: 0x2fe0cf, why: 'General chat and reasoning. A strong base with LoRA adapters.' },
    { id: 'coder', name: 'Coder LLM', run: 'vLLM on GPU', c: 0x7aa2ff, why: 'Code and terminal agent. Needs native tool calling.' },
    { id: 'vision', name: 'Vision (VLM)', run: 'vLLM on GPU', c: 0xb48cff, why: 'Images and documents, from a natively multimodal base.' },
    { id: 'stt', name: 'STT', run: 'faster-whisper', c: 0xffb547, why: 'Whisper turns audio into text.' },
    { id: 'tts', name: 'TTS', run: 'Kokoro', c: 0xff8a3d, why: 'Kokoro turns text into streamed audio.' },
    { id: 'imagegen', name: 'Image gen', run: 'Diffusion queue', c: 0xff70d8, why: 'Slow, so it gets a dedicated GPU queue.' },
    { id: 'embed', name: 'Embeddings', run: 'CPU or shared GPU', c: 0x4be38a, why: 'BGE, E5 or GTE class, for retrieval over docs.' },
    { id: 'face', name: 'Face renderer', run: 'WebGL or Unity', c: 0xff5a4f, why: 'A renderer, not a model. It plays the LLM\'s emotion events.' },
  ];
  const gw = new THREE.Group();
  gw.add(W.box(5, 2.4, 2.4, W.std(0x16304e), 0, 1.2, 0));
  gw.add(W.box(4.4, 0.2, 0.05, W.glow(0x2fe0cf, 1.2), 0, 2, 1.23));
  gw.add(W.sign('API GATEWAY', { pos: [0, 3, 0], size: 0.9, color: '#2fe0cf' }));
  gw.position.set(0, 0, 8);
  scene.add(gw);
  const rtr = new THREE.Group();
  rtr.add(W.cyl(1.3, 1.2, W.std(0x24405f), 0, 0.6, 0));
  rtr.add(W.sign('ROUTER', { pos: [0, 1.8, 0], size: 0.8, color: '#ff70d8' }));
  rtr.position.set(0, 0, 3);
  scene.add(rtr);
  const pods = {};
  SPEC.forEach((s, i) => {
    const a = -1.2 + (i / (SPEC.length - 1)) * 2.4;
    const g = new THREE.Group();
    const base = W.cyl(1.25, 0.5, W.std(0x1a2a40), 0, 0.25, 0);
    const core = W.cyl(0.8, 2.2, W.glow(s.c, 0.25), 0, 1.6, 0);
    g.add(base, core);
    g.add(W.sign(s.name, { pos: [0, 3.5, 0], size: 0.62 }));
    g.position.set(Math.sin(a) * 15, 0, 2 - Math.cos(a) * 13);
    scene.add(g);
    pods[s.id] = { g, core, s, wired: false };
    clicks.add(g, () => AC.fact(s.name, s.why + ' Runtime: ' + s.run + '.', { tag: 'Specialist' }));
  });
  function podPos(id) { const p = pods[id].g.position; return new THREE.Vector3(p.x, 1.8, p.z); }
  const robot = W.robot(); robot.position.set(0, 0, 13); robot.rotation.y = Math.PI; scene.add(robot);
  const gwPos = new THREE.Vector3(0, 1.6, 8), rtPos = new THREE.Vector3(0, 1.4, 3);
  let time = 0;
  S.onFrame((dt, t) => {
    time = t;
    packets.update(dt);
    for (const id in pods) { const p = pods[id]; p.core.material.emissiveIntensity = p.wired ? 0.8 + 0.3 * Math.sin(t * 3) : 0.15; }
    robot.head.rotation.y = Math.sin(t * 0.7) * 0.4;
    MR.update(dt);
  });

  // ---------------------------------------------- Mission 1: the merge myth and the wiring
  const JOBS = [
    { q: 'Answer a question in chat', a: 'chat' }, { q: 'Write a function and run shell commands', a: 'coder' }, { q: 'Read a photo of a document', a: 'vision' },
    { q: 'Turn a voice note into text', a: 'stt' }, { q: 'Speak the reply out loud', a: 'tts' }, { q: 'Create a poster image', a: 'imagegen' },
    { q: 'Search your docs by meaning', a: 'embed' }, { q: 'Make the robot smile and blink', a: 'face' },
  ];
  const myth = {
    id: 'myth', title: 'The merge myth',
    objective: 'Try the merge, then wire all 8 jobs to the right specialist',
    story: 'Your first idea is the popular one: fuse Gemma, Qwen and Kokoro into one super model. Try it, see why it cannot work, then design what the guide says to build instead.',
    learn: [
      { t: 'One gateway, many specialists', p: 'To the developer it looks like one AI. Inside, a router sends each request to the right model.', f: 'Client → Gateway → Router → Specialist' },
      { t: 'The honest target', p: 'Fine-tuning shapes behaviour. It does not create frontier intelligence.', f: 'Best for your tasks, low cost, low latency' },
    ],
    proved: 'Models with different architectures cannot be merged. You designed a system of specialists behind one API, which is the architecture in Part 2 of your guide.',
    tip: 'Press a pod in the hall to read what it does.',
    quiz: () => AC.QUESTIONS.find((q) => q.id === 'merge-myth'),
    start(api) {
      LAB.closeBench();
      for (const id in pods) pods[id].wired = false;
      const st = api.state;
      st.misses = 0; st.placed = 0;
      const b = LAB.bench('The merge attempt', 'Press the lever and read what the checker finds.');
      st.b = b;
      const mergeOut = h('pre', { class: 'term' }, 'Waiting for the merge...');
      const go = h('button', { class: 'ac-btn amber', type: 'button' }, 'Pull the merge lever');
      go.addEventListener('click', () => {
        go.disabled = true;
        AC.audio.boom();
        mergeOut.textContent = [
          '$ merge --models gemma qwen kokoro',
          'gemma : language transformer, token embeddings -> vocabulary logits',
          'qwen  : language transformer, different layer shapes and tokenizer',
          'kokoro: text to speech, 82M, phonemes + style vector -> audio frames',
          '',
          'ERROR  tensor shapes do not match: gemma.h0.attn != kokoro.decoder.conv1',
          'ERROR  outputs differ: vocabulary logits != audio frames',
          'MERGE REFUSED. mergekit only works on fine-tunes of the same base.',
        ].join('\n');
        AC.fact('You cannot merge these', 'Kokoro is a small text-to-speech model. Gemma and Qwen are language models. Merging needs the same architecture.', { tag: 'Part 1', color: 'var(--amber)' });
        setTimeout(() => wiring(api), 900);
      });
      b.add(LAB.tag('real'), h('p', {}, 'Each model has a different job, so its weights have different shapes. The checker compares them.'), go, mergeOut);
      api.progress(0, 'Objective');
    },
  };
  function wiring(api) {
    const st = api.state;
    const b = st.b;
    b.clear();
    b.add(h('h3', {}, 'Wire each job to its specialist'), h('p', { class: 'dim' }, 'Mistakes are counted. Three stars needs no mistakes.'));
    const list = h('div', { class: 'wire-list' });
    b.add(list);
    JOBS.forEach((job) => {
      const row = h('div', { class: 'wire' }, h('b', {}, job.q));
      const opts = h('div', { class: 'chips' });
      SPEC.forEach((s) => {
        const bt = h('button', { type: 'button', class: 'chip' }, s.name);
        bt.addEventListener('click', () => {
          if (row.classList.contains('ok')) return;
          if (s.id === job.a) {
            bt.classList.add('right');
            row.classList.add('ok');
            pods[s.id].wired = true;
            st.placed++;
            AC.audio.good();
            packets.fire(gwPos, rtPos, s.c, 0.4, () => packets.fire(rtPos, podPos(s.id), s.c, 0.6));
            opts.querySelectorAll('button').forEach((x) => (x.disabled = true));
            api.progress(st.placed / JOBS.length);
            if (st.placed === JOBS.length) api.win(st.misses === 0 ? 3 : st.misses <= 2 ? 2 : 1, 'All 8 jobs reach a specialist. Mistakes: ' + st.misses + '.');
          } else {
            bt.classList.add('wrong');
            st.misses++;
            AC.audio.bad();
            AC.ui.toast(s.name + ': ' + s.why.split('.')[0], 'var(--amber)');
          }
        });
        opts.appendChild(bt);
      });
      row.appendChild(opts);
      list.appendChild(row);
    });
  }

  // ---------------------------------------------- Mission 2: router v1 with real test requests
  const RULE_LIB = [
    { when: 'audio', label: 'Request has audio' }, { when: 'image', label: 'Request has an image' }, { when: 'slash_code', label: 'Text starts with /code' }, { when: 'slash_image', label: 'Text starts with /image' }, { when: 'always', label: 'Anything else' },
  ];
  const TARGETS = [{ id: 'chat', label: 'Chat LLM' }, { id: 'coder', label: 'Coder LLM' }, { id: 'vision', label: 'Vision' }, { id: 'stt', label: 'STT' }, { id: 'imagegen', label: 'Image gen' }];
  const TESTS = [
    { messages: [{ role: 'user', content: 'hello there' }], want: 'chat' }, { messages: [{ role: 'user', content: 'what is lora?' }], want: 'chat' },
    { messages: [{ role: 'user', content: '/code write a sort function' }], want: 'coder' }, { messages: [{ role: 'user', content: '/code fix my failing test' }], want: 'coder' },
    { messages: [{ role: 'user', content: 'what is in this picture?' }], image: 'photo.png', want: 'vision' }, { messages: [{ role: 'user', content: 'read this receipt' }], image: 'scan.png', want: 'vision' },
    { messages: [{ role: 'user', content: '' }], audio: 'voice.wav', want: 'stt' }, { messages: [{ role: 'user', content: 'transcribe this' }], audio: 'call.wav', want: 'stt' },
    { messages: [{ role: 'user', content: '/image a robot in Kampala' }], want: 'imagegen' }, { messages: [{ role: 'user', content: 'tell me a joke' }], want: 'chat' },
    { messages: [{ role: 'user', content: '/code explain this photo' }], image: 'code.png', want: 'vision' }, { messages: [{ role: 'user', content: 'what does /code do?' }], want: 'chat' },
  ];
  const router = {
    id: 'router', title: 'Write router v1',
    objective: 'Order the rules and set targets so all 12 test requests route correctly',
    story: 'A developer sends one request to one URL. Your router decides who answers. Version 1 is plain rules, checked in order. This table is the real router your finished AI will use.',
    learn: [
      { t: 'Rules first', p: 'Audio goes to STT, an image goes to the vision model, /code goes to the coder, and everything else goes to chat.', f: 'Add a small classifier later' },
      { t: 'Log every decision', p: 'Routing logs improve the router and reveal new training data.', f: 'Order matters: first match wins' },
    ],
    proved: 'Your router is real code now. The first rule that matches wins, which is why "anything else" must come last. Your final AI uses the rule table you just wrote.',
    tip: 'Look at which request failed. A rule above it probably caught it first.',
    quiz: () => AC.QUESTIONS.find((q) => q.id === 'router-v1'),
    start(api) {
      LAB.closeBench();
      for (const id in pods) pods[id].wired = false;
      const st = api.state;
      st.runs = 0;
      st.rules = [{ when: 'always', to: 'chat' }, { when: 'slash_code', to: 'chat' }, { when: 'image', to: 'chat' }, { when: 'audio', to: 'chat' }, { when: 'slash_image', to: 'chat' }];
      const b = LAB.bench('Router rule table', 'First match wins. Use the arrows to reorder and pick where each rule sends the request.');
      st.b = b;
      const holder = h('div');
      const results = h('div');
      const draw = () => {
        holder.innerHTML = '';
        st.rules.forEach((r, i) => {
          const row = h('div', { class: 'rule' },
            h('span', { class: 'mono dim' }, String(i + 1)),
            h('b', {}, RULE_LIB.find((x) => x.when === r.when).label),
            h('span', { class: 'dim' }, 'to'),
          );
          const sel = h('select', { 'aria-label': 'Target' }, TARGETS.map((t) => h('option', { value: t.id, selected: t.id === r.to }, t.label)));
          sel.addEventListener('change', () => { r.to = sel.value; });
          row.appendChild(sel);
          const up = h('button', { class: 'ac-btn ghost small', type: 'button', 'aria-label': 'Move up' }, '↑');
          const dn = h('button', { class: 'ac-btn ghost small', type: 'button', 'aria-label': 'Move down' }, '↓');
          up.addEventListener('click', () => { if (i > 0) { [st.rules[i - 1], st.rules[i]] = [st.rules[i], st.rules[i - 1]]; AC.audio.click(); draw(); } });
          dn.addEventListener('click', () => { if (i < st.rules.length - 1) { [st.rules[i + 1], st.rules[i]] = [st.rules[i], st.rules[i + 1]]; AC.audio.click(); draw(); } });
          row.append(up, dn);
          holder.appendChild(row);
        });
      };
      draw();
      const go = h('button', { class: 'ac-btn', type: 'button' }, 'Send 12 test requests');
      go.addEventListener('click', async () => {
        st.runs++;
        go.disabled = true;
        results.innerHTML = '';
        let ok = 0;
        const rows = [];
        for (let i = 0; i < TESTS.length; i++) {
          const t = TESTS[i];
          const r = BRAIN.route(st.rules, t);
          const good = r.to === t.want;
          if (good) ok++;
          rows.push({ cls: good ? 'ok' : 'no', cells: [BRAIN.lastUser(t.messages) || '(audio only)', (t.image ? 'image ' : '') + (t.audio ? 'audio' : ''), r.to, good ? 'correct' : 'should be ' + t.want] });
          const pod = pods[r.to === 'stt' ? 'stt' : r.to];
          if (pod) packets.fire(gwPos, rtPos, good ? 0x4be38a : 0xff5a4f, 0.3, () => packets.fire(rtPos, podPos(r.to), good ? 0x4be38a : 0xff5a4f, 0.5, () => { if (good) pod.wired = true; }));
          await LAB.sleep(110);
        }
        api.progress(ok / TESTS.length);
        results.append(h('p', { class: ok === TESTS.length ? 'c-green' : 'c-amber' }, ok + ' of ' + TESTS.length + ' routed correctly.'), LAB.table(['Request', 'Has', 'Sent to', 'Result'], rows));
        go.disabled = false;
        if (ok === TESTS.length) {
          await LAB.set('router', { rules: st.rules.map((r) => ({ when: r.when, to: r.to })), savedAt: Date.now() });
          api.win(st.runs === 1 ? 3 : st.runs <= 3 ? 2 : 1, 'Runs needed: ' + st.runs + '. The rule table is saved into your project.');
        } else AC.audio.bad();
      });
      b.add(LAB.tag('real'), holder, go, results);
    },
  };

  // ---------------------------------------------- Mission 3: spec and base choice
  const CANDIDATES = [
    { id: 'qwen8', name: 'Qwen 3.x, about 8B', lic: 'Apache-2.0', size: 8, tools: true, vis: false, gpu: '16 to 24 GB', note: 'Strong general model, native tool calling.' },
    { id: 'gemma', name: 'Gemma 4, multimodal', lic: 'Apache-2.0', size: 14, tools: true, vis: true, gpu: '16 to 24 GB', note: 'Natively multimodal, so vision fine-tunes more simply.' },
    { id: 'qwen32', name: 'Qwen 3.x MoE, about 32B', lic: 'Apache-2.0', size: 32, tools: true, vis: false, gpu: '24 to 48 GB', note: 'MoE: few active parameters per token.' },
    { id: 'star', name: 'Leaderboard Star 70B', lic: 'Research only', size: 70, tools: true, vis: true, gpu: '80 GB or multi-GPU', note: 'Tops the public leaderboard. Non-commercial licence.' },
    { id: 'tiny', name: 'Tiny 1B chat model', lic: 'MIT', size: 1, tools: false, vis: false, gpu: '8 to 16 GB', note: 'Cheap, but no native tool calling and weak raw ability.' },
    { id: 'deep', name: 'DeepSeek, large', lic: 'MIT', size: 120, tools: true, vis: false, gpu: 'many GPUs', note: 'Very strong, but needs many GPUs.' },
  ];
  const base = {
    id: 'base', title: 'Name it and pick the base',
    objective: 'Name your AI, then choose a base that meets every requirement',
    story: 'Time to commit. Give your AI an identity, because it goes into the real training data. Then choose the real-world base you would rent a GPU for. Your simulator trains a tiny base with the same steps.',
    learn: [
      { t: 'Selection rules', p: 'One strong general model of about 8B to 32B. Add specialists only when measurements show a gap.', f: 'Apache-2.0 or MIT for commercial use' },
      { t: 'Leaderboards lie', p: 'Public leaderboards do not predict your tasks. Compare on your own test set.', f: 'Agents need native tool calling' },
    ],
    proved: 'You chose by licence, size, tools and GPU budget, not by leaderboard rank. You also met your real tiny base: a transformer that actually runs in this browser.',
    tip: 'Read the requirements: licence, about 8B to 32B, native tool calling, and a GPU you can rent.',
    quiz: () => AC.QUESTIONS.find((q) => q.id === 'base-choice'),
    async start(api) {
      LAB.closeBench();
      const st = api.state;
      st.tries = 0;
      const id = await LAB.identity();
      const b = LAB.bench('Your AI\'s identity and base', 'These words become real training data.');
      const nameI = h('input', { type: 'text', value: id.name, maxlength: 24, autocomplete: 'off', 'aria-label': 'AI name' });
      const makerI = h('input', { type: 'text', value: id.maker, maxlength: 28, autocomplete: 'off', 'aria-label': 'Maker' });
      const placeI = h('input', { type: 'text', value: id.place, maxlength: 28, autocomplete: 'off', 'aria-label': 'Place' });
      const personaI = h('textarea', { rows: 2, maxlength: 140, 'aria-label': 'Purpose' }, id.persona);
      b.add(LAB.field('AI name', nameI), LAB.field('Built by', makerI), LAB.field('Built in', placeI), LAB.field('One sentence: who is it for, and what is a perfect answer?', personaI));
      b.add(h('h3', {}, 'Requirements'), h('ul', { class: 'mini' }, h('li', {}, 'Developers can build commercial products on it'), h('li', {}, 'About 8B to 32B'), h('li', {}, 'Native tool calling, for the terminal agent'), h('li', {}, 'Natively multimodal is a bonus, for vision')));
      const list = h('div', { class: 'cand' });
      CANDIDATES.forEach((c) => {
        const bt = h('button', { type: 'button', class: 'cand-b' }, h('b', {}, c.name), h('span', { class: 'mono dim' }, c.lic + ' · tools: ' + (c.tools ? 'yes' : 'no') + ' · vision: ' + (c.vis ? 'yes' : 'no') + ' · fine-tune GPU ' + c.gpu), h('span', {}, c.note));
        bt.addEventListener('click', () => choose(c, bt));
        list.appendChild(bt);
      });
      b.add(h('h3', {}, 'Choose the base'), list);
      const info = h('div', { class: 'note' }, 'Loading your simulator base model...');
      b.add(info);
      LAB.model().then((m) => {
        info.innerHTML = '';
        info.append(LAB.tag('real'), ' Simulator base: a real transformer with ' + AC.fmt(m.params) + ' parameters (' + m.cfg.L + ' layers, ' + m.cfg.d + ' dimensions, ' + m.vocab + ' tokens). It runs on this device. A real 8B model has about 10,000 times more.');
      }).catch((e) => { info.textContent = 'Could not load the model: ' + e.message; });
      async function choose(c, bt) {
        const problems = [];
        if (c.lic === 'Research only') problems.push('The licence forbids commercial use, so developers could not build on it.');
        if (c.size > 32) problems.push('Too big: ' + c.gpu + ' to fine-tune. Start with about 8B to 32B.');
        if (c.size < 8) problems.push('Too weak: pick the strongest raw ability you can afford to host, then specialise it.');
        if (!c.tools) problems.push('No native tool calling, so the terminal agent would suffer.');
        if (!nameI.value.trim()) problems.push('Give your AI a name first.');
        st.tries++;
        if (problems.length) {
          bt.classList.add('wrong');
          AC.audio.bad();
          AC.fact(c.name + ' fails', problems.join(' '), { tag: 'Rejected', color: 'var(--red)' });
          return;
        }
        bt.classList.add('right');
        const identity = { name: nameI.value.trim().slice(0, 24), maker: makerI.value.trim() || 'Pearl Labs', place: placeI.value.trim() || 'Uganda', persona: personaI.value.trim() };
        await LAB.set('identity', identity);
        await LAB.set('spec', { base: c, savedAt: Date.now() });
        api.win(st.tries === 1 ? (c.vis ? 3 : 3) : st.tries === 2 ? 2 : 1, identity.name + ' is born, on paper. Real-world base: ' + c.name + '.');
      }
    },
  };

  const missions = [myth, router, base];
  missions.forEach((m) => { const q = m.quiz; Object.defineProperty(m, 'quiz', { get: () => q() }); });
  const MR = AC.missions({ game: 'blueprint', week: 1, list: missions, onSelect: () => LAB.closeBench() });
  S.start();
  MR.begin();
  window.__MR = MR;
})();
