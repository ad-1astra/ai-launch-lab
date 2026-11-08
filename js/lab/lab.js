/* Project store and page services shared by every zone: IndexedDB state, model worker RPC, bench panel, 3D props. */
(function () {
  'use strict';
  const LAB = (window.LAB = {});
  const h = AC.h;

  // ------------------------------------------------------------ persistent project (IndexedDB, one project per player slot)
  const DBN = 'ai-launch-lab';
  let dbp = null;
  const mem = new Map();
  LAB.persistent = true;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((res) => {
      try {
        const r = indexedDB.open(DBN, 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => res(r.result);
        r.onerror = () => { LAB.persistent = false; res(null); };
      } catch (e) { LAB.persistent = false; res(null); }
    });
    return dbp;
  }
  const slot = () => 'p' + (AC.data.cur | 0) + ':';
  LAB.get = async function (key, dflt) {
    const d = await db();
    if (!d) return mem.has(slot() + key) ? mem.get(slot() + key) : dflt;
    return new Promise((res) => {
      const q = d.transaction('kv').objectStore('kv').get(slot() + key);
      q.onsuccess = () => res(q.result === undefined ? dflt : q.result);
      q.onerror = () => res(dflt);
    });
  };
  LAB.set = async function (key, val) {
    const d = await db();
    if (!d) { mem.set(slot() + key, val); return; }
    return new Promise((res) => {
      const tx = d.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(val, slot() + key);
      tx.oncomplete = () => res();
      tx.onerror = () => res();
    });
  };
  LAB.del = async function (key) {
    const d = await db();
    if (!d) { mem.delete(slot() + key); return; }
    return new Promise((res) => { const tx = d.transaction('kv', 'readwrite'); tx.objectStore('kv').delete(slot() + key); tx.oncomplete = () => res(); tx.onerror = () => res(); });
  };
  LAB.update = async function (key, patch) {
    const cur = (await LAB.get(key, {})) || {};
    const next = Object.assign(cur, patch);
    await LAB.set(key, next);
    return next;
  };
  LAB.identity = async () => (await LAB.get('identity')) || { name: 'HUB AI', maker: 'Pearl Labs', place: 'Uganda', persona: 'A friendly AI for builders in Uganda.' };

  // ------------------------------------------------------------ campaign map
  LAB.ZONES = [
    { id: 'blueprint', url: 'blueprint.html', name: 'Blueprint Hall', weeks: '1-2', parts: 'Parts 1-3', blurb: 'Accept what is realistic, design one gateway with many specialists, write the router, pick your base.', missions: ['myth', 'router', 'base'], color: 0x2fe0cf, lesson: 1 },
    { id: 'vault', url: 'vault.html', name: 'Eval Vault', weeks: '1-2', parts: 'Parts 4.1 and 9', blurb: 'Write your AI\'s seed examples by hand, then seal the test set before any data comes in.', missions: ['seeds', 'seal'], color: 0xff70d8, lesson: 2 },
    { id: 'refinery', url: 'refinery.html', name: 'Data Refinery', weeks: '3-5', parts: 'Part 4', blurb: 'Check every licence, run the 12-stage cleaning line on real rows, pass the quality gates.', missions: ['provenance', 'line', 'bench', 'gates'], color: 0xffb547, lesson: 3 },
    { id: 'sandbox', url: 'sandbox.html', name: 'Agent Sandbox', weeks: '6-8', parts: 'Part 6.2', blurb: 'Build the terminal agent\'s cage, then record verified trajectories it will learn from.', missions: ['harness', 'trajectories'], color: 0x7aa2ff, lesson: 4 },
    { id: 'training', url: 'training.html', name: 'Training Hall', weeks: '8-9', parts: 'Parts 5, 6.1, 6.2, 7', blurb: 'Rent the GPU, pass the overfit test, run the real LoRA fine-tune, iterate on failures, train the agent, polish with DPO.', missions: ['overfit', 'lora', 'failures', 'coder', 'dpo'], color: 0x4be38a, lesson: 5 },
    { id: 'studio', url: 'studio.html', name: 'Face and Voice Studio', weeks: '9-10', parts: 'Parts 6.3 to 6.6', blurb: 'Vision, speech and the emotion-driven face, with a sub-second budget to first sound.', missions: ['vision', 'speech', 'face'], color: 0xff8a3d, lesson: 6 },
    { id: 'servers', url: 'servers.html', name: 'Server Hall', weeks: '10-11', parts: 'Parts 7 and 8', blurb: 'Merge and quantise for real, re-test, compose the stack, survive a load test at 2x traffic.', missions: ['quantise', 'stack'], color: 0xb48cff, lesson: 7 },
    { id: 'launch', url: 'launch.html', name: 'Launch Pad', weeks: '11-12', parts: 'Parts 9 to 11', blurb: 'Red-team your model, package the release, roll out behind a canary, and launch.', missions: ['redteam', 'package', 'launch'], color: 0xff5a4f, lesson: 8 },
  ];
  LAB.zoneDone = (z) => z.missions.every((m) => AC.starsFor(z.id, m) > 0);
  LAB.zoneUnlocked = (i) => i === 0 || LAB.ZONES.slice(0, i).every(LAB.zoneDone);
  LAB.progress = function () {
    let done = 0, total = 0;
    for (const z of LAB.ZONES) for (const m of z.missions) { total++; if (AC.starsFor(z.id, m) > 0) done++; }
    return { done, total, frac: done / total };
  };

  // ------------------------------------------------------------ model worker RPC
  let worker = null, nextId = 1;
  const waiting = new Map();
  function rpc(msg, onProgress, transfer) {
    return new Promise((res, rej) => {
      const id = nextId++;
      waiting.set(id, { res, rej, onProgress });
      worker.postMessage(Object.assign({ id }, msg), transfer || []);
    });
  }
  LAB.rpc = rpc;
  let loaded = null;
  LAB.TOP_LAYER = 2; // adapters sit on the top blocks, so a short browser run does not disturb what the base knows
  LAB.fetchBase = async function () {
    if (LAB._assets) return LAB._assets;
    const [b, t] = await Promise.all([fetch('models/hub-base.safetensors').then((r) => { if (!r.ok) throw new Error('model download failed'); return r.arrayBuffer(); }), fetch('models/tokenizer.json').then((r) => r.json())]);
    LAB._assets = { base: b, tok: t };
    return LAB._assets;
  };
  LAB.model = function () {
    if (loaded) return loaded;
    loaded = (async () => {
      worker = new Worker('js/ml/brain-worker.js');
      worker.onmessage = (e) => {
        const m = e.data, w = waiting.get(m.id);
        if (!w) return;
        if (m.type === 'progress') { w.onProgress && w.onProgress(m); return; }
        waiting.delete(m.id);
        if (m.type === 'error') w.rej(new Error(m.error));
        else w.res(m.result);
      };
      const { base, tok } = await LAB.fetchBase();
      const identity = await LAB.identity();
      const questions = await fetch('data/base_questions.json').then((r) => r.json());
      const info = await rpc({ type: 'init', base: base.slice(0), tok, identity, modelName: 'hub-base', questions });
      const extra = await LAB.get('extraQuestions');
      if (extra) await rpc({ type: 'config', extraQuestions: extra });
      LAB.modelInfo = info;
      return info;
    })();
    return loaded;
  };
  LAB.loadAdapter = async function (name, key) {
    await LAB.model();
    const buf = await LAB.get(key || 'adapter:' + name);
    if (!buf) { await rpc({ type: 'adapter', name, buf: null }); return false; }
    await rpc({ type: 'adapter', name, buf: buf.slice(0) });
    return true;
  };
  LAB.evalModel = async function (adapterName, onProgress, opts = {}) {
    await LAB.model();
    return rpc({ type: 'eval', adapter: adapterName, identity: await LAB.identity(), grammar: !!opts.grammar }, (m) => onProgress && onProgress(m.i, m.n, m.row));
  };

  // ------------------------------------------------------------ fine-tuning from a page
  LAB.newTrainer = async function (adapterCfg, resume) {
    const { base, tok } = await LAB.fetchBase();
    if (!LAB._netMain) {
      const { tensors, meta } = ML.parseSafetensors(base);
      LAB._netMain = new ML.GPT({ V: +meta.V, d: +meta.d, L: +meta.L, H: +meta.H, ctx: +meta.ctx, m: +meta.m }, tensors);
      LAB._tokMain = new ML.Tokenizer(tok);
    }
    const cfg = Object.assign({ fromLayer: LAB.TOP_LAYER }, adapterCfg, resume ? { fromLayer: resume.fromLayer } : {});
    const trainer = new ML.Trainer({ net: LAB._netMain, adapterCfg: cfg, adapter: resume || undefined, workerUrl: 'js/ml/train-worker.js' });
    await trainer.start();
    AC.throttle = true;
    const stop = trainer.stop.bind(trainer);
    trainer.stop = () => { AC.throttle = false; stop(); };
    return { trainer, net: LAB._netMain, tok: LAB._tokMain };
  };

  // ------------------------------------------------------------ data files
  LAB.lake = async function () {
    if (!LAB._lake) LAB._lake = await fetch('data/lake.json').then((r) => r.json());
    return LAB._lake;
  };
  LAB.sealedPrompts = () => EVALSET.PROMPTS.map((p) => p.prompt);

  // ------------------------------------------------------------ bench panel (the mission workspace beside the 3D view)
  LAB.bench = function (title, sub) {
    const body = h('div', { class: 'bench-body' });
    const el = h('section', { class: 'bench ac-panel' },
      h('header', {}, h('div', {}, h('h2', {}, title), sub ? h('p', { class: 'dim' }, sub) : null), h('button', { class: 'ac-btn ghost small bench-fold', type: 'button', onclick: () => el.classList.toggle('folded') }, 'Fold')),
      body);
    AC.root().appendChild(el);
    const api = {
      el, body,
      clear() { body.innerHTML = ''; return api; },
      add(...nodes) { for (const n of nodes.flat()) if (n) body.appendChild(typeof n === 'string' ? h('p', {}, n) : n); return api; },
      close() { el.remove(); },
    };
    return api;
  };
  LAB.closeBench = () => document.querySelectorAll('.bench').forEach((b) => b.remove());

  LAB.tag = (kind) => h('span', { class: 'rs-tag ' + (kind === 'real' ? 'real' : 'sim'), title: kind === 'real' ? 'This computation really runs on your device.' : 'Your browser cannot do this for real, so the numbers come from the guide.' }, kind === 'real' ? 'REAL' : 'SIMULATED');
  LAB.stat = (label, value, cls) => h('div', { class: 'stat' }, h('span', {}, label), h('b', { class: cls || '' }, value));
  LAB.table = function (cols, rows, o = {}) {
    return h('div', { class: 'tbl-wrap' + (o.tall ? ' tall' : '') }, h('table', { class: 'tbl' },
      h('thead', {}, h('tr', {}, cols.map((c) => h('th', {}, c)))),
      h('tbody', {}, rows.map((r) => h('tr', { class: r.cls || '' }, (r.cells || r).map((v) => h('td', {}, v == null ? '' : v)))))));
  };
  LAB.field = function (label, input, help) {
    return h('label', { class: 'fld' }, h('span', {}, label), input, help ? h('small', { class: 'dim' }, help) : null);
  };
  LAB.slider = function ({ label, min, max, step, value, fmt, help, onchange }) {
    const out = h('output', {}, fmt ? fmt(value) : value);
    const inp = h('input', { type: 'range', min, max, step, value });
    inp.addEventListener('input', () => { out.textContent = fmt ? fmt(+inp.value) : inp.value; onchange && onchange(+inp.value); });
    const el = h('div', { class: 'ac-field' }, h('label', {}, h('span', {}, label), out), inp, help ? h('small', { class: 'dim' }, help) : null);
    el.input = inp;
    el.set = (v) => { inp.value = v; out.textContent = fmt ? fmt(+v) : v; };
    return el;
  };
  LAB.seg = function (options, value, onchange) {
    const el = h('div', { class: 'ac-seg', role: 'group' });
    const btns = options.map((o) => {
      const v = o.value !== undefined ? o.value : o, label = o.label || String(o);
      const b = h('button', { type: 'button', class: v === value ? 'on' : '', 'aria-pressed': v === value ? 'true' : 'false' }, label);
      b.addEventListener('click', () => {
        btns.forEach((x) => { x.classList.remove('on'); x.setAttribute('aria-pressed', 'false'); });
        b.classList.add('on'); b.setAttribute('aria-pressed', 'true');
        AC.audio.click();
        onchange && onchange(v);
      });
      el.appendChild(b);
      return b;
    });
    return el;
  };
  LAB.needs = function (mr, list) {
    // list: [{key, test(value), msg, url}]. Shows a card and returns false when an earlier step is missing.
    return (async () => {
      for (const n of list) {
        const v = await LAB.get(n.key);
        if (v === undefined || (n.test && !n.test(v))) {
          AC.ui.card({ eyebrow: 'Earlier step missing', title: n.title || 'Finish the earlier step first', body: [n.msg], dismiss: false, buttons: [{ label: 'Go there', onclick: () => (location.href = n.url) }, { label: 'Back to campus', ghost: true, onclick: () => (location.href = 'index.html') }] });
          return false;
        }
      }
      return true;
    })();
  };
  LAB.stripEval = (res) => ({ overall: res.overall, cats: res.cats, schema: res.schema, tokPerSec: res.tokPerSec, ttft: res.ttft, rows: res.rows.map((r) => ({ cat: r.cat, prompt: r.prompt, reply: (r.reply || '').slice(0, 160), ok: r.ok, emotion: r.events && r.events.emotion })) });
  LAB.requireMsg = function (msg, url) {
    AC.ui.card({ eyebrow: 'Earlier step missing', title: 'Not yet', body: [msg], dismiss: false, buttons: [{ label: 'Go there', onclick: () => { const same = location.pathname.endsWith(url.split('#')[0]); location.href = url; if (same) location.reload(); } }, { label: 'Campus', ghost: true, onclick: () => (location.href = 'index.html') }] });
  };
  LAB.pct = (x, d = 0) => (x * 100).toFixed(d) + '%';
  LAB.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  LAB.download = function (name, content, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: type || 'application/octet-stream' });
    const a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 8000);
  };

  // ------------------------------------------------------------ 3D props
  const W = (LAB.world = {});
  const raycaster = () => (W._rc = W._rc || new THREE.Raycaster());
  W.std = (color, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.65, metalness: 0.25 }, o));
  W.glow = (color, i = 1) => new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: i, roughness: 0.4 });
  W.box = (w, hh, d, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; return m; };
  W.cyl = (r, hh, mat, x = 0, y = 0, z = 0, seg = 20) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, hh, seg), mat); m.position.set(x, y, z); m.castShadow = true; return m; };
  W.sign = function (text, o = {}) {
    const s = AC.textSprite(text, Object.assign({ size: 0.7, color: '#e9f0f7', bg: 'rgba(5,12,22,0.8)', font: 'bold 40px "Chakra Petch", sans-serif' }, o));
    if (o.pos) s.position.set(...o.pos);
    return s;
  };
  // A scene with a lit hall and an orbit camera
  W.hall = function ({ size = 40, wall = 0x10223a, floor = 0x0c1a2d, accent = 0x2fe0cf, cam = {}, walls = true } = {}) {
    const S = AC.scene({ fov: 45, background: 0x050b14, shadows: true });
    S.scene.fog = new THREE.Fog(0x050b14, size * 1.6, size * 4);
    AC.lights(S.scene, { shadows: true, sun: 0.75, hemi: 0.6, sky: 0xbcd7ff, ground: 0x16243a, dir: [18, 30, 14], shadowSize: size });
    const tex = AC.canvasTex(256, 256, (g, w, hh) => {
      g.fillStyle = '#0c1a2d'; g.fillRect(0, 0, w, hh);
      g.strokeStyle = 'rgba(47,224,207,0.18)'; g.lineWidth = 2; g.strokeRect(0, 0, w, hh);
      g.strokeStyle = 'rgba(147,167,191,0.08)'; g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, hh); g.moveTo(0, hh / 2); g.lineTo(w, hh / 2); g.stroke();
    }, [size / 2, size / 2]);
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(size * 2, size * 2), new THREE.MeshStandardMaterial({ map: tex, color: floor === 0x0c1a2d ? 0xffffff : floor, roughness: 0.85 }));
    fl.rotation.x = -Math.PI / 2; fl.receiveShadow = true;
    S.scene.add(fl);
    if (walls) {
      const m = W.std(wall, { roughness: 0.9 });
      const hh = 12;
      for (const [x, z, ww, dd] of [[0, -size, size * 2, 0.5], [-size, 0, 0.5, size * 2], [size, 0, 0.5, size * 2]]) {
        const b = W.box(ww, hh, dd, m, x, hh / 2, z);
        b.castShadow = false;
        S.scene.add(b);
      }
      const strip = W.glow(accent, 0.9);
      S.scene.add(W.box(size * 2, 0.15, 0.2, strip, 0, 8, -size + 0.4));
      S.scene.add(W.box(0.2, 0.15, size * 2, strip, -size + 0.4, 8, 0));
      S.scene.add(W.box(0.2, 0.15, size * 2, strip, size - 0.4, 8, 0));
    }
    const oc = new AC.OrbitCam(S.camera, S.renderer.domElement, Object.assign({ dist: size * 0.6, min: 4, max: size * 1.5, theta: 0.5, phi: 1.1, minPhi: 0.25, maxPhi: 1.5, target: new THREE.Vector3(0, 2, 0) }, cam));
    S.onFrame((dt) => oc.update(dt));
    return { S, oc, scene: S.scene };
  };
  // click detection on 3D objects
  W.clicks = function (S) {
    const targets = [];
    const v = new THREE.Vector2();
    let down = null;
    const dom = S.renderer.domElement;
    const pick = (e) => {
      const r = dom.getBoundingClientRect();
      v.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      const rc = raycaster();
      rc.setFromCamera(v, S.camera);
      const hits = rc.intersectObjects(targets.map((t) => t.obj), true);
      if (!hits.length) return null;
      let o = hits[0].object;
      while (o) { const t = targets.find((x) => x.obj === o); if (t) return t; o = o.parent; }
      return null;
    };
    dom.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    dom.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
      const t = pick(e);
      if (t) { AC.audio.click(); t.fn(t.obj); }
    });
    dom.addEventListener('pointermove', (e) => { dom.style.cursor = pick(e) ? 'pointer' : 'grab'; });
    return { add(obj, fn) { targets.push({ obj, fn }); return obj; } };
  };
  // Glowing packets that fly from one point to another
  W.packets = function (scene) {
    const list = [];
    const geo = new THREE.SphereGeometry(0.22, 12, 10);
    const api = {
      fire(from, to, color = 0x2fe0cf, dur = 0.9, onDone) {
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color }));
        m.position.copy(from);
        scene.add(m);
        list.push({ m, from: from.clone(), to: to.clone(), t: 0, dur, onDone });
      },
      update(dt) {
        for (let i = list.length - 1; i >= 0; i--) {
          const p = list[i];
          p.t += dt / p.dur;
          const k = Math.min(1, p.t);
          p.m.position.lerpVectors(p.from, p.to, k);
          p.m.position.y += Math.sin(k * Math.PI) * 1.4;
          if (p.t >= 1) { scene.remove(p.m); p.m.material.dispose(); list.splice(i, 1); p.onDone && p.onDone(); }
        }
      },
    };
    return api;
  };
  // A server rack with blinking lights
  W.rack = function (color = 0x2fe0cf, hgt = 5) {
    const g = new THREE.Group();
    g.add(W.box(1.8, hgt, 1.2, W.std(0x1a2a40), 0, hgt / 2, 0));
    const leds = [];
    for (let i = 0; i < 8; i++) {
      const m = W.glow(color, 0.3);
      g.add(W.box(1.4, 0.06, 0.04, m, 0, 0.6 + (i * (hgt - 1)) / 8, 0.62));
      leds.push(m);
    }
    g.leds = leds;
    g.setLoad = (x, t) => { leds.forEach((m, i) => { m.emissiveIntensity = 0.15 + x * (0.5 + 0.5 * Math.sin(t * (5 + i) + i)); }); };
    return g;
  };
  // Three.js line plot that lives in the world (the hologram loss curve)
  W.holoPlot = function (w = 8, hh = 4, color = 0x2fe0cf) {
    const g = new THREE.Group();
    const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(w, hh)), new THREE.LineBasicMaterial({ color: 0x264061 }));
    frame.position.set(w / 2, hh / 2, 0);
    g.add(frame);
    const make = (c) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(600 * 3), 3));
      geo.setDrawRange(0, 0);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: c }));
      g.add(line);
      return geo;
    };
    const a = make(color), b = make(0xffb547);
    const set = (geo, pts, xMax, yMax) => {
      const arr = geo.attributes.position.array;
      const n = Math.min(600, pts.length);
      for (let i = 0; i < n; i++) { arr[i * 3] = (pts[i][0] / xMax) * w; arr[i * 3 + 1] = Math.min(1, pts[i][1] / yMax) * hh; arr[i * 3 + 2] = 0.02; }
      geo.attributes.position.needsUpdate = true;
      geo.setDrawRange(0, n);
    };
    g.setData = (train, val, xMax, yMax) => { set(a, train, xMax, yMax); set(b, val, xMax, yMax); };
    return g;
  };
  // A friendly robot used as the player avatar and as a mascot
  W.robot = function (color = 0x2fe0cf) {
    const g = new THREE.Group();
    const body = W.std(0xdfe8f2, { metalness: 0.4, roughness: 0.35 });
    const dark = W.std(0x14202f);
    g.add(W.box(0.9, 1, 0.65, body, 0, 1.15, 0));
    const head = new THREE.Group();
    head.position.y = 2.05;
    head.add(W.box(0.95, 0.72, 0.75, body, 0, 0, 0));
    head.add(W.box(0.8, 0.45, 0.04, dark, 0, 0.02, 0.38));
    const e1 = W.box(0.13, 0.17, 0.03, W.glow(color, 1.4), -0.2, 0.04, 0.41), e2 = W.box(0.13, 0.17, 0.03, W.glow(color, 1.4), 0.2, 0.04, 0.41);
    head.add(e1, e2);
    g.add(head);
    const legL = W.box(0.26, 0.6, 0.3, dark, -0.24, 0.32, 0), legR = W.box(0.26, 0.6, 0.3, dark, 0.24, 0.32, 0);
    const armL = W.box(0.2, 0.75, 0.24, body, -0.6, 1.2, 0), armR = W.box(0.2, 0.75, 0.24, body, 0.6, 1.2, 0);
    g.add(legL, legR, armL, armR);
    g.walk = (t, speed) => {
      const a = Math.sin(t * 10) * 0.55 * speed;
      legL.rotation.x = a; legR.rotation.x = -a; armL.rotation.x = -a * 0.8; armR.rotation.x = a * 0.8;
      head.position.y = 2.05 + Math.abs(Math.sin(t * 10)) * 0.03 * speed;
    };
    g.head = head;
    return g;
  };
})();
