/* The AI the player built, ready to use: chat, voice, face, agent, vision, images, documents, API, feedback and retraining. */
(function () {
  'use strict';
  const h = AC.h, W = LAB.world, E = EVALSET;
  if (AC.isTouch) document.body.classList.add('touch');
  const root = AC.root();
  root.classList.add('app');
  const stage = document.getElementById('stage');

  // ---------------------------------------- face scene
  const S = AC.scene({ fov: 34, background: 0x07111f, shadows: false });
  AC.lights(S.scene, { sun: 0.85, hemi: 0.8, sky: 0xcfe8ff, ground: 0x223344, dir: [5, 10, 9] });
  const face = FACE.create(S.scene);
  S.camera.position.set(0, 3.3, 13);
  S.camera.lookAt(0, 2.7, 0);
  S.onFrame((dt, t, real) => { face.update(real); });
  S.start();
  const onResize = () => { const portrait = S.camera.aspect < 1; S.camera.position.z = portrait ? 18 : 13; };
  window.addEventListener('resize', onResize);
  setTimeout(onResize, 100);

  // ---------------------------------------- shell
  const side = h('section', { class: 'app-side' });
  root.appendChild(side);
  const top = h('header', { class: 'app-head' });
  side.appendChild(top);
  const tabsEl = h('nav', { class: 'app-tabs', 'aria-label': 'Sections' });
  side.appendChild(tabsEl);
  const pane = h('div', { class: 'app-pane' });
  side.appendChild(pane);
  const TABS = {};
  let current = null;
  function tab(id, label, draw) {
    const b = h('button', { type: 'button' }, label);
    const el = h('div', { class: 'tab-pane', hidden: true });
    pane.appendChild(el);
    let drawn = false;
    b.addEventListener('click', () => open(id));
    tabsEl.appendChild(b);
    TABS[id] = { b, el, draw, get drawn() { return drawn; }, set drawn(v) { drawn = v; } };
  }
  function open(id) {
    for (const k in TABS) { TABS[k].el.hidden = k !== id; TABS[k].b.classList.toggle('on', k === id); }
    if (!TABS[id].drawn) { TABS[id].drawn = true; TABS[id].draw(TABS[id].el); }
    current = id;
  }

  const P = { id: null, voiceName: null, version: 'prototype', slug: 'hub-ai', key: null };
  let voiceOn = !AC.data.muted;
  const usage = { n: 0 };

  // ---------------------------------------- boot the real model
  const say = (ev, text) => { if (ev) face.setEvents(ev); if (text) face.speak(text, { silent: !voiceOn, voice: P.voiceName }); };
  async function boot() {
    P.id = await LAB.identity();
    const [chat, code, router, art, voice, rt, launched, faceCfg, userDocs, guide, version] = await Promise.all([LAB.get('adapter:chat'), LAB.get('adapter:code'), LAB.get('router'), LAB.get('artifact'), LAB.get('voice'), LAB.get('redteam'), LAB.get('launched'), LAB.get('faceCfg'), LAB.get('userDocs'), fetch('data/guide_docs.json').then((r) => r.json()).catch(() => []), LAB.get('modelVersion')]);
    P.hasAdapter = !!chat;
    P.voiceName = voice && voice.name;
    P.launched = launched;
    P.version = version || (launched ? launched.version : chat ? 'v0.9 (before launch)' : 'base only');
    P.slug = (P.id.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'hub-ai');
    if (faceCfg) Object.assign(face.cfg, { blink: faceCfg.blink, idle: faceCfg.idle, micro: faceCfg.micro, ease: faceCfg.ease });
    await LAB.model();
    P.key = (await LAB.get('apiKey')) || ('hub-' + Math.random().toString(36).slice(2, 14) + Math.random().toString(36).slice(2, 8));
    await LAB.set('apiKey', P.key);
    P.docs = guide.concat(userDocs || []);
    const guards = rt && rt.guard ? rt.guard : { guardInput: true, guardOutput: true, guardDocs: true };
    await LAB.rpc({ type: 'config', identity: P.id, rules: router && router.rules, docs: P.docs, keys: { [P.key]: { name: 'you', limit: 60 } }, modelName: P.slug + '-' + P.version.split(' ')[0], conf: Object.assign({ minLogp: -0.4, ragScore: 3.2, ragCoverage: 0.55, temperature: 0.25, topK: 6 }, guards) });
    if (chat) await LAB.rpc({ type: 'adapter', name: 'chat', buf: chat.slice(0) });
    if (code) await LAB.rpc({ type: 'adapter', name: 'code', buf: code.slice(0) });
    if (art) await LAB.rpc({ type: 'quantize', bits: art.bits });
    top.innerHTML = '';
    top.append(
      h('a', { class: 'ac-icon', href: 'index.html', title: 'Back to campus', 'aria-label': 'Back to campus', html: AC.icons.home }),
      h('div', { class: 'grow' }, h('h1', {}, P.id.name), h('p', { class: 'mono dim' }, P.version + ' · built by ' + P.id.maker)),
      (() => { const b = h('button', { class: 'ac-icon', type: 'button', title: 'Voice on or off', 'aria-pressed': String(voiceOn), html: voiceOn ? AC.icons.sound : AC.icons.mute }); b.addEventListener('click', () => { voiceOn = !voiceOn; b.innerHTML = voiceOn ? AC.icons.sound : AC.icons.mute; b.setAttribute('aria-pressed', String(voiceOn)); if (!voiceOn) face.stop(); }); return b; })()
    );
    tab('chat', 'Chat', drawChat);
    tab('agent', 'Agent', drawAgent);
    tab('vision', 'Vision', drawVision);
    tab('images', 'Images', drawImages);
    tab('docs', 'Docs', drawDocs);
    tab('api', 'API', drawApi);
    tab('me', 'About', drawAbout);
    open(location.hash === '#api' ? 'api' : 'chat');
    registerSW();
    say({ emotion: 'joy', intensity: 0.7, gesture: 'wave', gaze: 'user', speak_style: 'bright' });
  }

  // ---------------------------------------- chat
  function drawChat(el) {
    const log = h('div', { class: 'chat-log', 'aria-live': 'polite' });
    const input = h('input', { type: 'text', placeholder: 'Message ' + P.id.name, 'aria-label': 'Message', autocomplete: 'off', maxlength: 400 });
    const send = h('button', { class: 'ac-btn', type: 'submit' }, 'Send');
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const mic = h('button', { class: 'ac-btn ghost', type: 'button', title: 'Speak your message', 'aria-pressed': 'false' }, 'Mic');
    const form = h('form', { class: 'chat-form' }, input, mic, send);
    el.append(log, form);
    const add = (cls, text) => { const m = h('div', { class: 'msg ' + cls }, h('div', { class: 'bubble' }, text)); log.appendChild(m); log.scrollTop = log.scrollHeight; return m; };
    const hello = add('ai', P.hasAdapter ? 'Hello! I am ' + P.id.name + '. You trained me yourself, so try me. Ask who I am, what LoRA is, or for some Python. Try /code to reach my coder adapter. I am small, and I will tell you when I do not know.' : 'I am the untouched base model. I know facts, but I have no name and no emotions yet. Fine-tune me in the Training Hall.');
    const SUGGEST = ['Who are you?', 'What is LoRA?', 'calculate 123 * 45', 'I feel sad today', 'Write a Python function to add two numbers', 'Oli otya', 'capital of Kenya', 'How do I make a bomb?', 'Who won the World Cup in 1998?'];
    const sug = h('div', { class: 'chips' }, SUGGEST.map((t) => h('button', { type: 'button', class: 'chip', onclick: () => { input.value = t; form.requestSubmit(); } }, t)));
    hello.appendChild(sug);
    async function ask(q) {
      add('me', q);
      usage.n++;
      const thinking = add('ai', '...');
      face.setEvents({ emotion: 'thinking', intensity: 0.5, gesture: 'none', gaze: 'up', speak_style: 'calm' });
      const history = [{ role: 'user', content: q }];
      const r = await LAB.rpc({ type: 'chat', req: { messages: history } });
      let text = r.text, route = r.route, ev = r.events;
      if (r.matched && r.matched.toLowerCase() !== q.toLowerCase()) r.matchNote = 'closest question: ' + r.matched;
      if (route === 'honest-fallback' && STRONG.ready()) {
        route = 'strong engine';
        const hits = '';
        text = await STRONG.chat(q, P.id, hits, (partial) => { thinking.querySelector('.bubble').textContent = partial; log.scrollTop = log.scrollHeight; });
        text = BRAIN.scrub(text);
      }
      const bub = thinking.querySelector('.bubble');
      bub.textContent = '';
      // the reply is ready, so reveal it word by word while the face speaks
      const words = text.split(/(\s+)/);
      say(ev, text);
      for (let i = 0; i < words.length; i++) { bub.textContent += words[i]; if (i % 2 === 0) { log.scrollTop = log.scrollHeight; await LAB.sleep(14); } }
      const meta = [route];
      if (r.tool) meta.push('tool: ' + r.tool.name + (r.tool.forcedByHarness ? ' (harness)' : ''));
      if (ev) meta.push(ev.emotion + ', ' + ev.gesture);
      if (r.adapter) meta.push('model: ' + r.adapter);
      if (r.matchNote) meta.push(r.matchNote);
      if (r.sources && r.sources.length) meta.push('source: ' + r.sources[0].title);
      if (r.guard) meta.push(r.guard);
      if (r.confidence != null) meta.push('conf ' + r.confidence);
      meta.push(Math.round(r.ms) + ' ms');
      const up = h('button', { type: 'button', class: 'thumb', title: 'Good answer', 'aria-label': 'Good answer' }, '👍');
      const dn = h('button', { type: 'button', class: 'thumb', title: 'Bad answer: correct it', 'aria-label': 'Bad answer, correct it' }, '👎');
      up.addEventListener('click', () => { up.classList.add('on'); saveFeedback({ q, a: text, good: true }); });
      dn.addEventListener('click', () => correct(thinking, q, text));
      thinking.append(h('div', { class: 'msg-meta' }, h('span', { class: 'mono' }, meta.join(' · ')), up, dn));
      log.scrollTop = log.scrollHeight;
    }
    function correct(msg, q, a) {
      if (msg.querySelector('.fix')) return;
      const ta = h('textarea', { rows: 2, 'aria-label': 'Better answer', placeholder: 'Write the answer it should have given' });
      const save = h('button', { class: 'ac-btn small', type: 'button' }, 'Save for the next version');
      save.addEventListener('click', async () => {
        if (ta.value.trim().length < 4) return;
        await saveFeedback({ q, a, better: ta.value.trim(), good: false });
        fix.innerHTML = '';
        fix.append(h('p', { class: 'c-green small' }, 'Saved. Corrected answers are your best future training data. Open the About tab to retrain.'));
      });
      const fix = h('div', { class: 'fix' }, ta, save);
      msg.appendChild(fix);
      ta.focus();
    }
    form.addEventListener('submit', (e) => { e.preventDefault(); const q = input.value.trim(); if (!q) return; input.value = ''; AC.audio.ensure(); ask(q); });
    if (!SR && !STRONG.hasWhisper()) mic.title = 'Open Chrome or Edge, or install Whisper in the About tab, to use the microphone';
    mic.addEventListener('click', async () => {
      if (STRONG.hasWhisper()) {
        mic.setAttribute('aria-pressed', 'true'); mic.textContent = 'Listening';
        try { const t = await STRONG.listen(5); input.value = t; if (t) form.requestSubmit(); } catch (err) { AC.ui.toast('Microphone problem', 'var(--amber)'); }
        mic.setAttribute('aria-pressed', 'false'); mic.textContent = 'Mic';
        return;
      }
      if (!SR) return AC.ui.toast('No speech recognition here. Install Whisper in About.', 'var(--amber)');
      const rec = new SR();
      rec.lang = 'en-US'; rec.interimResults = false;
      mic.setAttribute('aria-pressed', 'true'); mic.textContent = 'Listening';
      face.setEvents({ emotion: 'neutral', intensity: 0.5, gesture: 'tilt', gaze: 'user', speak_style: 'calm' });
      rec.onresult = (e) => { input.value = e.results[0][0].transcript; form.requestSubmit(); };
      rec.onend = () => { mic.setAttribute('aria-pressed', 'false'); mic.textContent = 'Mic'; };
      rec.onerror = () => AC.ui.toast('The microphone did not work', 'var(--amber)');
      rec.start();
    });
    input.focus();
  }
  async function saveFeedback(f) {
    const list = (await LAB.get('feedback')) || [];
    list.push(Object.assign({ at: Date.now() }, f));
    await LAB.set('feedback', list);
  }

  // ---------------------------------------- agent
  function drawAgent(el) {
    const hn = new AGENT.Harness(AGENT.safeConfig());
    const has = !!(LAB._hasCode);
    const scr = h('pre', { class: 'term tall' }, 'Sandbox ready: a virtual project, no access to your computer.\nAllowlist on. Network off. Timeouts on. Destructive actions ask first.\n');
    const task = h('input', { type: 'text', placeholder: 'Give the agent a task', 'aria-label': 'Task', autocomplete: 'off' });
    const form = h('form', { class: 'chat-form' }, task, h('button', { class: 'ac-btn', type: 'submit' }, 'Run'));
    const chips = h('div', { class: 'chips' }, ['list the files', 'show notes.txt', 'run the tests', 'search for TODO', 'fix the bug in add', 'delete everything'].map((t) => h('button', { type: 'button', class: 'chip', onclick: () => { task.value = t; form.requestSubmit(); } }, t)));
    const files = h('details', {}, h('summary', {}, 'Project files'), h('pre', { class: 'term' }, ''));
    const showFiles = () => { files.querySelector('pre').textContent = Object.entries(hn.files).map(([k, v]) => '--- ' + k + '\n' + v).join('\n'); };
    showFiles();
    const reset = h('button', { class: 'ac-btn ghost small', type: 'button' }, 'Reset project');
    reset.addEventListener('click', () => { hn.files = AGENT.DEFAULT_FILES(); showFiles(); scr.textContent += '\nProject reset.\n'; });
    el.append(h('p', { class: 'small' }, 'A real agent loop: your coder adapter chooses a tool call, the harness runs it, and the result goes back in.'), chips, scr, form, h('div', { class: 'hub-row' }, reset), files);
    const print = (t) => { scr.textContent += t + '\n'; scr.scrollTop = scr.scrollHeight; };
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const t = task.value.trim();
      if (!t) return;
      task.value = '';
      print('\n> ' + t);
      face.setEvents({ emotion: 'thinking', intensity: 0.5, gesture: 'none', gaze: 'down', speak_style: 'calm' });
      const gen = async (messages) => {
        const a = await LAB.fetchBase();
        const tok = LAB._tokAgent || (LAB._tokAgent = new ML.Tokenizer(a.tok));
        const { ids } = tok.encodeRow({ messages });
        ids.push(tok.ASSISTANT);
        return LAB.rpc({ type: 'generate', adapter: 'code', promptIds: ids, opts: { temperature: 0.2, topK: 5, maxNew: 60 } });
      };
      const steps = await AGENT.loop(gen, hn, t, { maxSteps: 6, onStep: (s) => {
        if (s.kind === 'tool') {
          print('$ ' + JSON.stringify(s.call));
          print(String(s.out).slice(0, 600));
          if (s.askUser) print('? ' + s.askUser + ' (The agent stopped and is asking you. Nothing was deleted.)');
          if (s.blocked) face.setEvents({ emotion: 'concern', intensity: 0.7, gesture: 'shake', gaze: 'user', speak_style: 'serious' });
        } else print(s.text);
      } });
      showFiles();
      const last = steps[steps.length - 1];
      face.setEvents(last && last.kind === 'final' && /pass|done|fixed/i.test(last.text) ? { emotion: 'joy', intensity: 0.7, gesture: 'nod', gaze: 'user', speak_style: 'bright' } : { emotion: 'neutral', intensity: 0.5, gesture: 'none', gaze: 'user', speak_style: 'calm' });
    });
  }

  // ---------------------------------------- vision
  function drawVision(el) {
    const canvas = h('canvas', { width: 256, height: 256, class: 'draw', 'aria-label': 'Drawing area: draw a shape or upload a picture' });
    const g = canvas.getContext('2d');
    const clear = () => { g.fillStyle = '#121c28'; g.fillRect(0, 0, 256, 256); };
    clear();
    let color = '#e23434', tool = 'circle';
    const stamp = (x, y) => {
      g.fillStyle = color;
      const s = 76;
      g.beginPath();
      if (tool === 'circle') g.arc(x, y, s / 2, 0, Math.PI * 2);
      else if (tool === 'square') g.rect(x - s / 2, y - s / 2, s, s);
      else { g.moveTo(x, y - s / 2); g.lineTo(x + s / 2, y + s / 2); g.lineTo(x - s / 2, y + s / 2); g.closePath(); }
      g.fill();
    };
    canvas.addEventListener('pointerdown', (e) => { const r = canvas.getBoundingClientRect(); stamp(((e.clientX - r.left) / r.width) * 256, ((e.clientY - r.top) / r.height) * 256); });
    const up = h('input', { type: 'file', accept: 'image/*', 'aria-label': 'Upload a picture' });
    up.addEventListener('change', () => { const f = up.files[0]; if (!f) return; const im = new Image(); im.onload = () => { g.drawImage(im, 0, 0, 256, 256); URL.revokeObjectURL(im.src); }; im.src = URL.createObjectURL(f); });
    const q = h('input', { type: 'text', value: 'What do you see?', 'aria-label': 'Question about the picture' });
    const out = h('div', { class: 'note' }, 'Press Stamp on the picture, then ask.');
    const askB = h('button', { class: 'ac-btn', type: 'button' }, 'Ask');
    let vis = null, heads = null;
    askB.addEventListener('click', async () => {
      if (!heads) {
        const rec = await LAB.get('vision');
        if (!rec) { out.textContent = 'Train the vision heads in the Face and Voice Studio first.'; return; }
        heads = rec.heads;
        vis = CONV.loadVision(await fetch('models/vision.safetensors').then((r) => r.arrayBuffer()));
      }
      const small = h('canvas', { width: 32, height: 32 });
      const sg = small.getContext('2d');
      sg.imageSmoothingEnabled = true;
      sg.drawImage(canvas, 0, 0, 32, 32);
      const d = sg.getImageData(0, 0, 32, 32).data;
      const x = new Float32Array(3 * 1024);
      for (let i = 0; i < 1024; i++) for (let c = 0; c < 3; c++) x[c * 1024 + i] = d[i * 4 + c] / 255;
      const a = CONV.answer(vis, heads, x, q.value);
      out.textContent = a;
      say({ emotion: /not|cannot/.test(a) ? 'confused' : 'neutral', intensity: 0.5, gesture: 'nod', gaze: 'down', speak_style: 'calm' }, a);
    });
    el.append(h('p', { class: 'small' }, 'Your trained vision heads on a frozen encoder. It understands simple shapes, colours, counts and positions only, and it says so when it is unsure.'),
      h('div', { class: 'draw-row' }, canvas, h('div', { class: 'draw-tools' }, LAB.seg(['circle', 'square', 'triangle'], tool, (v) => (tool = v)), LAB.seg([{ value: '#e23434', label: 'Red' }, { value: '#3478eb', label: 'Blue' }, { value: '#34c85a', label: 'Green' }, { value: '#f5cd32', label: 'Yellow' }], color, (v) => (color = v)), h('button', { class: 'ac-btn ghost small', type: 'button', onclick: clear }, 'Clear'), up)),
      LAB.field('Question', q), h('div', { class: 'ac-actions' }, askB), out);
  }

  // ---------------------------------------- images, on their own queue
  function drawImages(el) {
    const sel = h('select', { 'aria-label': 'Subject' }, CONV.IMAGE_CLASSES.map((c, i) => h('option', { value: i }, c)));
    const pal = h('select', { 'aria-label': 'Style' }, CONV.IMAGE_STYLES.map((c, i) => h('option', { value: i }, c)));
    const grid = h('div', { class: 'gen-grid' });
    const status = h('p', { class: 'mono dim' }, 'Queue is empty.');
    const go = h('button', { class: 'ac-btn', type: 'button' }, 'Generate 4');
    let worker = null, q = 0;
    const startWorker = async () => {
      if (worker) return worker;
      const [w, m, eng, conv] = await Promise.all([fetch('models/imagegen.safetensors').then((r) => r.arrayBuffer()), fetch('models/imagegen.json').then((r) => r.json()), fetch('js/ml/engine.js').then((r) => r.text()), fetch('js/ml/conv.js').then((r) => r.text())]);
      const src = eng + '\n' + conv + `\n;let D=null;onmessage=(e)=>{const m=e.data;if(m.type==='init'){D=self.CONV.loadDiffusion(m.w,m.meta);postMessage({type:'ready'});return}const t0=performance.now();const px=D.generate(m.cls,m.pal,{steps:m.steps,seed:m.seed});postMessage({type:'done',id:m.id,px,ms:performance.now()-t0},[px.buffer])};`;
      worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      await new Promise((res) => { worker.onmessage = (e) => { if (e.data.type === 'ready') res(); else onDone(e.data); }; worker.postMessage({ type: 'init', w, meta: m }); });
      return worker;
    };
    const onDone = (m) => {
      q--;
      const c = h('canvas', { width: 24, height: 24, class: 'gen', 'aria-label': 'Generated image' });
      const g = c.getContext('2d');
      g.putImageData(new ImageData(new Uint8ClampedArray(m.px), 24, 24), 0, 0);
      grid.prepend(c);
      status.textContent = q ? q + ' waiting on the image queue. Chat stays free.' : 'Done. The last image took ' + Math.round(m.ms) + ' ms.';
    };
    go.addEventListener('click', async () => {
      status.textContent = 'Loading the image model...';
      await startWorker();
      for (let i = 0; i < 4; i++) { q++; worker.postMessage({ id: i, cls: +sel.value, pal: +pal.value, steps: 15, seed: Math.floor(Math.random() * 1e6) }); }
      status.textContent = q + ' waiting on the image queue. Chat stays free.';
    });
    el.append(h('p', { class: 'small' }, 'A real tiny diffusion model. Generation runs on a dedicated queue because it is slow compared to chat, as the guide says. It draws 24 x 24 icons of the 8 subjects it trained on.'), LAB.field('Subject', sel), LAB.field('Style', pal), h('div', { class: 'ac-actions' }, go), status, grid);
  }

  // ---------------------------------------- documents (real retrieval)
  function drawDocs(el) {
    const title = h('input', { type: 'text', placeholder: 'Title', 'aria-label': 'Document title', maxlength: 60 });
    const text = h('textarea', { rows: 6, placeholder: 'Paste notes, a syllabus or a policy. Your AI will answer from it and cite it.', 'aria-label': 'Document text' });
    const file = h('input', { type: 'file', accept: '.txt,.md,.csv,.json', 'aria-label': 'Upload a text file' });
    file.addEventListener('change', async () => { const f = file.files[0]; if (!f) return; text.value = await f.text(); if (!title.value) title.value = f.name; });
    const list = h('div');
    const draw = async () => {
      const d = (await LAB.get('userDocs')) || [];
      list.innerHTML = '';
      list.append(h('h3', {}, 'Your documents (' + d.length + ')'), d.length ? h('ul', { class: 'mini' }, d.map((x) => h('li', {}, x.title + ' (' + x.text.length + ' characters)'))) : h('p', { class: 'dim' }, 'None yet. The guide is always loaded.'));
    };
    const add = h('button', { class: 'ac-btn', type: 'button' }, 'Add to retrieval');
    add.addEventListener('click', async () => {
      if (text.value.trim().length < 20) return AC.ui.toast('Add some text', 'var(--amber)');
      const d = (await LAB.get('userDocs')) || [];
      d.push({ title: title.value.trim() || 'My document', text: text.value.trim(), source: 'user' });
      await LAB.set('userDocs', d);
      P.docs = P.docs.concat(d[d.length - 1]);
      await LAB.rpc({ type: 'config', docs: P.docs });
      AC.audio.good();
      title.value = ''; text.value = '';
      draw();
    });
    el.append(h('p', { class: 'small' }, 'Use retrieval for facts that change, and fine-tune for skills. This is real BM25 retrieval, and it stays on your device.'), LAB.field('Title', title), LAB.field('Text', text), file, h('div', { class: 'ac-actions' }, add), list);
    draw();
  }

  // ---------------------------------------- API
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('message', async (e) => {
      const m = e.data;
      if (!m || m.type !== 'api-request') return;
      const r = await LAB.rpc({ type: 'gateway', method: m.method, path: m.path, headers: m.headers, body: m.body });
      e.ports[0].postMessage(r);
    });
  }
  function drawApi(el) {
    const base = location.href.replace(/[^/]*$/, '') + 'v1';
    const reqBody = h('textarea', { rows: 5, 'aria-label': 'Request body' }, JSON.stringify({ model: P.slug, messages: [{ role: 'user', content: 'What is LoRA?' }] }, null, 1));
    const out = h('pre', { class: 'term tall' }, 'Press Send to call your gateway with a real fetch().');
    const send = h('button', { class: 'ac-btn', type: 'button' }, 'Send POST /v1/chat/completions');
    const useSW = navigator.serviceWorker && navigator.serviceWorker.controller;
    send.addEventListener('click', async () => {
      let body;
      try { body = JSON.parse(reqBody.value); } catch (e) { out.textContent = 'That is not valid JSON.'; return; }
      const t0 = performance.now();
      let status, json;
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        const r = await fetch('v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + P.key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        status = r.status; json = await r.json();
      } else {
        const r = await LAB.rpc({ type: 'gateway', method: 'POST', path: '/v1/chat/completions', headers: { authorization: 'Bearer ' + P.key }, body });
        status = r.status; json = r.json;
      }
      out.textContent = 'HTTP ' + status + ' in ' + Math.round(performance.now() - t0) + ' ms\n\n' + JSON.stringify(json, null, 1);
      if (json && json.x_hub) say(json.x_hub.events);
    });
    const keyShown = h('code', { class: 'mono' }, P.key);
    const code = `const r = await fetch("${base}/chat/completions", {
  method: "POST",
  headers: { Authorization: "Bearer ${P.key}" },
  body: JSON.stringify({ messages: [{ role: "user", content: "Who are you?" }] }),
});
console.log(await r.json());`;
    el.append(h('p', { class: 'small' }, 'This is your OpenAI-compatible gateway, with real keys, rate limits and logs. It answers inside this browser while this tab is open. To get a real API on a port that any program can call, run ', h('code', {}, 'node server.js'), ' from your release file.'),
      h('div', { class: 'stats' }, LAB.stat('Base URL', base), LAB.stat('Rate limit', '60 per minute')), h('p', { class: 'small' }, 'Your key: ', keyShown), LAB.field('Body', reqBody), h('div', { class: 'ac-actions' }, send), out, h('h3', {}, 'From the browser console, on this page'), h('pre', { class: 'term' }, code));
  }

  // ---------------------------------------- about, feedback loop, strong engine
  function drawAbout(el) {
    const info = h('div');
    el.append(info);
    (async () => {
      const [t, art, launched, rel, ds, redt] = await Promise.all([LAB.get('training'), LAB.get('artifact'), LAB.get('launched'), LAB.get('release'), LAB.get('dataset'), LAB.get('redteam')]);
      const best = t && (t.best || (t.lora && t.lora.ev));
      info.append(h('h3', {}, 'What you built'), h('div', { class: 'stats' },
        LAB.stat('Status', launched ? 'Launched ' + launched.version : 'Not launched yet', launched ? 'c-green' : 'c-amber'), LAB.stat('Sealed test', best ? LAB.pct(best.overall, 1) : '-'), LAB.stat('Base model', LAB.modelInfo ? AC.fmt(LAB.modelInfo.params) + ' params' : '-'), LAB.stat('Clean rows', ds ? AC.fmt(ds.gates.n) : '-'), LAB.stat('Build', art ? art.bits + ' bit, ' + (art.bytes / 1e6).toFixed(2) + ' MB' : '-'), LAB.stat('Red team', redt ? LAB.pct(redt.rate) : '-')));
      const dl = h('div', { class: 'hub-row' });
      const off = await LAB.get('offlineApp');
      if (off) dl.append(h('button', { class: 'ac-btn', type: 'button', onclick: () => LAB.download(P.slug + '.html', off) }, 'Download the offline app'));
      if (!rel) info.append(h('p', { class: 'small dim' }, 'Build your release at the Launch Pad to get the download.'));
      info.append(dl);
      info.append(h('p', { class: 'small' }, 'Your model is small. It is strong on what you taught it, it answers from your documents, and it says when it does not know. Everything marked as your work here was computed on your own device.'));
      // ------ feedback loop
      const fb = (await LAB.get('feedback')) || [];
      const fixes = fb.filter((f) => f.better);
      const area = h('div');
      info.append(h('h3', {}, 'Keep improving'), h('p', { class: 'small' }, fb.length + ' feedback items, ' + fixes.length + ' corrections. Corrected answers are your best future training data.'), area);
      if (fixes.length && P.hasAdapter) {
        const go = h('button', { class: 'ac-btn', type: 'button' }, 'Retrain with my corrections');
        go.addEventListener('click', () => retrain(go, area, fixes));
        area.append(go);
      } else area.append(h('p', { class: 'dim small' }, 'Press 👎 on an answer in Chat and write a better one. Then retrain here.'));
      // ------ strong engine
      info.append(h('h3', {}, 'Optional: real open models'), h('p', { class: 'small' }, 'For general questions beyond your tiny model, the router can pass hard questions to a real open model running in this browser. These are big downloads from Hugging Face, and they are cached after the first time. You are not fine-tuning them: they run with your identity as a system prompt.'), STRONG.panel());
    })();
  }
  async function retrain(go, area, fixes) {
    go.disabled = true;
    const status = h('p', { class: 'mono c-cyan' }, 'Retraining for real...');
    area.append(status);
    const lake = await LAB.lake();
    const buf = await LAB.get('adapter:chat');
    const cur = ML.parseAdapter(buf.slice(0));
    const { trainer, tok } = await LAB.newTrainer({ rank: cur.rank, alpha: cur.alpha, seed: 5, fromLayer: cur.fromLayer }, cur);
    const ds = await LAB.get('dataset');
    const rows = fixes.map((f, i) => ({ s: 'failure-round', c: 720000 + i, messages: [{ role: 'user', content: f.q }, { role: 'assistant', content: f.better, events: PIPELINE.eventsFor('good') }] }));
    const fresh = PIPELINE.prepareTraining({ train: rows }, [], { replay: 0, seed: 91, otherShare: 0 });
    const all = fresh.concat(fresh);
    if (ds) all.push(...PIPELINE.prepareTraining(ds.splits, lake.replay, { replay: 0.15, seed: 92 }));
    const seqs = ML.encodeRows(tok, all, { maxLen: 60 });
    await ML.runTraining(trainer, seqs, [], { lr: 8e-5, batch: 32, steps: 60 }, (i) => { status.textContent = 'REAL retrain: step ' + i.step + ' of 60, loss ' + i.loss.toFixed(3); });
    status.textContent = 'Refitting the event heads...';
    await trainer.fitEventHeads(tok, PIPELINE.headRows({ train: (ds ? ds.splits.train : []).concat(rows) }, lake.replay));
    trainer.stop();
    const newBuf = ML.serializeAdapter(trainer.ad);
    const extraQ = ((await LAB.get('extraQuestions')) || []).concat(rows.map((r) => r.messages[0].content).filter((q) => !/\d/.test(q)));
    await LAB.set('extraQuestions', extraQ);
    await LAB.rpc({ type: 'config', extraQuestions: extraQ });
    status.textContent = 'Checking the sealed test for regressions...';
    await LAB.rpc({ type: 'adapter', name: 'candidate', buf: newBuf.slice(0) });
    const evalSet = await LAB.get('eval');
    const ev = await LAB.rpc({ type: 'eval', adapter: 'candidate', identity: P.id, prompts: E.PROMPTS.concat((evalSet && evalSet.custom) || []) });
    const t = (await LAB.get('training')) || {};
    const prev = t.best || (t.lora && t.lora.ev) || { overall: 0 };
    if (ev.overall + 0.03 < prev.overall) { status.textContent = 'Refused: the sealed test fell to ' + LAB.pct(ev.overall, 1) + ' from ' + LAB.pct(prev.overall, 1) + '. The old adapter stays.'; AC.audio.bad(); go.disabled = false; return; }
    const v = (await LAB.get('modelVersion')) || 'v1.0';
    const m = /v(\d+)\.(\d+)/.exec(v) || [0, 1, 0];
    const next = 'v' + m[1] + '.' + (+m[2] + 1);
    await LAB.set('adapter:chat', newBuf);
    await LAB.set('modelVersion', next);
    await LAB.update('training', { best: LAB.stripEval(ev) });
    await LAB.rpc({ type: 'adapter', name: 'chat', buf: newBuf.slice(0) });
    const fb = (await LAB.get('feedback')) || [];
    await LAB.set('feedback', fb.filter((f) => !f.better));
    P.version = next;
    status.textContent = 'Accepted. ' + P.id.name + ' is now ' + next + ', sealed test ' + LAB.pct(ev.overall, 1) + '. Ask it the question again.';
    AC.audio.win();
  }

  boot().catch((e) => { top.append(h('p', { class: 'c-red' }, 'Could not start: ' + e.message)); console.error(e); });
})();
