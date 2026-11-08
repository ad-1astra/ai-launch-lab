/* Learning Academy — shared engine (UI, input, audio, 3D helpers, missions, progress).
   Template from the turning-notes-into-learning-games skill. Set KEY to a unique name per project. */
(function () {
  'use strict';
  const AC = (window.AC = {});

  // ---------------------------------------------------------------- math
  AC.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  AC.lerp = (a, b, t) => a + (b - a) * t;
  AC.damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
  AC.rad = (d) => (d * Math.PI) / 180;
  AC.deg = (r) => (r * 180) / Math.PI;
  AC.fmt = (n, d = 0) => (isFinite(n) ? Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '--');
  AC.rand = (a, b) => a + Math.random() * (b - a);
  AC.G = 9.81;
  AC.UNIT = window.AC_UNIT || 'Week'; // what one block of the course is called: Week, Lesson, Unit, Chapter…

  // ---------------------------------------------------------------- DOM
  AC.h = function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) {
      for (const k in props) {
        const v = props[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.appendChild(typeof kid === 'string' || typeof kid === 'number' ? document.createTextNode(String(kid)) : kid);
    }
    return el;
  };
  const h = AC.h;
  AC.css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#fff';
  AC.root = () => document.querySelector('.game') || document.body;

  // ---------------------------------------------------------------- storage & players
  const KEY = 'ai-launch-lab-v1';
  function load() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || null;
    } catch (e) {
      return null;
    }
  }
  function blankPilot(name) {
    return { name, xp: 0, stars: {}, log: {}, best: {} };
  }
  AC.data = load() || { v: 1, pilots: [blankPilot('Player 1'), blankPilot('Player 2')], cur: 0, muted: false };
  if (!AC.data.pilots || !AC.data.pilots.length) AC.data.pilots = [blankPilot('Player 1')];
  AC.save = function () {
    try {
      localStorage.setItem(KEY, JSON.stringify(AC.data));
    } catch (e) {
      /* storage blocked: progress lasts for this visit only */
    }
  };
  AC.pilot = () => AC.data.pilots[AC.clamp(AC.data.cur | 0, 0, AC.data.pilots.length - 1)];
  AC.blankPilot = blankPilot;
  AC.starsFor = (game, mission) => AC.pilot().stars[game + ':' + mission] || 0;
  AC.award = function (game, mission, stars) {
    const p = AC.pilot();
    const k = game + ':' + mission;
    const old = p.stars[k] || 0;
    if (stars > old) {
      p.stars[k] = stars;
      p.xp += (stars - old) * 10;
    }
    AC.save();
    return Math.max(0, stars - old) * 10;
  };
  AC.addXP = function (n) {
    AC.pilot().xp += n;
    AC.save();
  };
  AC.setBest = function (key, val, higherIsBetter = true) {
    const p = AC.pilot();
    const old = p.best[key];
    if (old == null || (higherIsBetter ? val > old : val < old)) {
      p.best[key] = val;
      AC.save();
      return true;
    }
    return false;
  };

  // ---------------------------------------------------------------- audio (WebAudio synth, no files)
  AC.audio = (function () {
    let ctx = null, master = null;
    function ensure() {
      if (!ctx) {
        try {
          ctx = new (window.AudioContext || window.webkitAudioContext)();
          master = ctx.createGain();
          master.gain.value = AC.data.muted ? 0 : 0.5;
          master.connect(ctx.destination);
        } catch (e) {
          ctx = null;
        }
      }
      if (ctx && ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    window.addEventListener('pointerdown', ensure);
    window.addEventListener('keydown', ensure);
    function tone(freq, dur = 0.12, type = 'sine', vol = 0.25, when = 0, slideTo = 0) {
      if (!ctx || AC.data.muted) return;
      const t0 = ctx.currentTime + when;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(master);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    }
    function noise(dur = 0.4, vol = 0.3, freq = 800) {
      if (!ctx || AC.data.muted) return;
      const len = Math.floor(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = vol;
      src.connect(f).connect(g).connect(master);
      src.start();
    }
    // continuous engine / rotor hum
    function makeHum(type = 'sawtooth', base = 60) {
      let o = null, g = null, f = null;
      return {
        set(level, pitch = 1) {
          if (!ctx) return;
          if (!o) {
            o = ctx.createOscillator();
            o.type = type;
            f = ctx.createBiquadFilter();
            f.type = 'lowpass';
            f.frequency.value = 600;
            g = ctx.createGain();
            g.gain.value = 0;
            o.connect(f).connect(g).connect(master);
            o.start();
          }
          const t = ctx.currentTime;
          o.frequency.setTargetAtTime(base * pitch, t, 0.08);
          f.frequency.setTargetAtTime(300 + 900 * level, t, 0.1);
          g.gain.setTargetAtTime(AC.data.muted ? 0 : 0.04 + 0.1 * level, t, 0.1);
        },
        stop() {
          if (g && ctx) g.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
        },
      };
    }
    function setMuted(m) {
      AC.data.muted = m;
      AC.save();
      if (master) master.gain.value = m ? 0 : 0.5;
    }
    return {
      ensure, tone, noise, makeHum, setMuted,
      click: () => tone(1200, 0.04, 'square', 0.05),
      good: () => { tone(660, 0.1, 'triangle', 0.22); tone(990, 0.18, 'triangle', 0.22, 0.09); },
      bad: () => { tone(260, 0.14, 'sawtooth', 0.12); tone(180, 0.3, 'sawtooth', 0.12, 0.12); },
      ping: () => tone(1320, 0.09, 'sine', 0.18),
      win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'triangle', 0.22, i * 0.11)),
      boom: () => noise(0.9, 0.5, 500),
      whoosh: () => noise(0.5, 0.2, 1800),
    };
  })();

  // ---------------------------------------------------------------- input
  AC.isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  AC.keys = {};
  const BLOCK = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'PageUp', 'PageDown'];
  window.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    AC.keys[e.code] = true;
    if (BLOCK.includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => (AC.keys[e.code] = false));
  window.addEventListener('blur', () => (AC.keys = {}));
  AC.key = (...codes) => codes.some((c) => AC.keys[c]);
  // -1..1 from two key groups plus an optional analog value
  AC.axis = (neg, pos, analog = 0) => AC.clamp((AC.key(...pos) ? 1 : 0) - (AC.key(...neg) ? 1 : 0) + analog, -1, 1);
  AC.onKey = function (code, fn) {
    window.addEventListener('keydown', (e) => {
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.code === code && !e.repeat) fn(e);
    });
  };

  // on-screen sticks & buttons (touch devices only; desktop gets inert stand-ins)
  AC.touch = {
    layer: null,
    ensureLayer() {
      if (!this.layer) {
        this.layer = h('div', { class: 'ac-touch' });
        AC.root().appendChild(this.layer);
        document.body.classList.add('touch');
      }
      return this.layer;
    },
    stick(side, label, o = {}) {
      const st = { x: 0, y: o.initY || 0, active: false, opts: o, set(x, y) { st.x = x; st.y = y; } };
      if (!AC.isTouch) return st;
      const knob = h('i');
      const el = h('div', { class: 'ac-stick ' + side }, h('span', {}, label), knob);
      this.ensureLayer().appendChild(el);
      let id = null, cx = 0, cy = 0, R = 50;
      const place = () => (knob.style.transform = `translate(${st.x * R}px, ${-st.y * R}px)`);
      const move = (e) => {
        let dx = (e.clientX - cx) / R, dy = -(e.clientY - cy) / R;
        const m = Math.hypot(dx, dy);
        if (m > 1) { dx /= m; dy /= m; }
        st.x = dx; st.y = dy; place();
      };
      el.addEventListener('pointerdown', (e) => {
        id = e.pointerId;
        el.setPointerCapture(id);
        const r = el.getBoundingClientRect();
        cx = r.left + r.width / 2; cy = r.top + r.height / 2; R = r.width / 2 - 14;
        st.active = true; move(e); e.preventDefault();
      });
      el.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
      const end = (e) => {
        if (e.pointerId !== id) return;
        id = null; st.active = false;
        if (o.springX !== false) st.x = 0;
        if (o.springY !== false) st.y = 0;
        place();
      };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      st.opts = o;
      st.set = (x, y) => { st.x = x; st.y = y; place(); };
      place();
      return st;
    },
    buttons: null,
    button(label, onDown, onUp) {
      const st = { down: false };
      if (!AC.isTouch) return st;
      if (!this.buttons) {
        this.buttons = h('div', { class: 'ac-tbtns' });
        this.ensureLayer().appendChild(this.buttons);
      }
      const b = h('button', { type: 'button' }, label);
      b.addEventListener('pointerdown', (e) => { st.down = true; b.setPointerCapture(e.pointerId); onDown && onDown(); e.preventDefault(); });
      const up = () => { if (st.down) { st.down = false; onUp && onUp(); } };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      this.buttons.appendChild(b);
      return st;
    },
  };

  // ---------------------------------------------------------------- icons
  const I = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
    sound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14"/></svg>',
    mute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>',
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 015.8 1c0 2-3 3-3 3M12 17h.01"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 016.5 17H20V3H6.5A2.5 2.5 0 004 5.5z"/><path d="M4 19.5A2.5 2.5 0 006.5 22H20v-5"/></svg>',
  };
  AC.icons = I;

  // ---------------------------------------------------------------- UI
  AC.paused = false;
  AC.ui = {};
  let topCfg = {};

  AC.ui.top = function (cfg) {
    topCfg = cfg;
    const soundBtn = h('button', { class: 'ac-icon', type: 'button', title: 'Sound on/off', 'aria-label': 'Sound on or off', html: AC.data.muted ? I.mute : I.sound });
    soundBtn.addEventListener('click', () => {
      AC.audio.setMuted(!AC.data.muted);
      soundBtn.innerHTML = AC.data.muted ? I.mute : I.sound;
    });
    const missionsBtn = h('button', { class: 'ac-icon ac-mtoggle', type: 'button', title: 'Missions', 'aria-label': 'Show missions', html: I.list });
    missionsBtn.addEventListener('click', () => {
      const m = document.querySelector('.ac-missions');
      if (m) m.classList.toggle('open');
    });
    const bar = h('header', { class: 'ac-top' },
      h('a', { class: 'ac-icon', href: 'index.html', title: 'Back to the Academy hub', 'aria-label': 'Back to hub', html: I.home }),
      missionsBtn,
      h('div', { class: 'title' }, h('span', {}, cfg.week ? AC.UNIT + ' ' + cfg.week + ' · ' + (cfg.topic || '') : cfg.topic || ''), h('h1', {}, cfg.title)),
      h('div', { class: 'spacer' }),
      h('span', { class: 'ac-pilot', title: 'Change player on the hub' }, 'Player: ' + AC.pilot().name),
      h('button', { class: 'ac-icon', type: 'button', title: 'Logbook', 'aria-label': 'Open logbook', html: I.book, onclick: () => AC.ui.logbook() }),
      soundBtn,
      cfg.help ? h('button', { class: 'ac-icon', type: 'button', title: 'How to play', 'aria-label': 'How to play', html: I.help, onclick: cfg.help }) : null
    );
    AC.root().appendChild(bar);
    return bar;
  };

  AC.ui.modal = function (content, { dismiss = false, onClose } = {}) {
    const wrap = h('div', { class: 'ac-modal', role: 'dialog', 'aria-modal': 'true' }, content);
    AC.paused = true;
    function close() {
      if (!wrap.parentNode) return;
      wrap.remove();
      AC.paused = !!document.querySelector('.ac-modal');
      onClose && onClose();
    }
    if (dismiss) {
      wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
      const esc = (e) => { if (e.key === 'Escape') { close(); window.removeEventListener('keydown', esc); } };
      window.addEventListener('keydown', esc);
    }
    AC.root().appendChild(wrap);
    const firstBtn = wrap.querySelector('.ac-btn:not(.ghost), button');
    if (firstBtn) setTimeout(() => firstBtn.focus(), 30);
    return { el: wrap, close };
  };

  // simple card modal: {eyebrow, title, body:[nodes|strings], buttons:[{label, ghost, onclick}]}
  AC.ui.card = function ({ eyebrow, title, body = [], buttons = [{ label: 'Got it' }], dismiss = true, width } = {}) {
    const actions = h('div', { class: 'ac-actions' });
    const card = h('div', { class: 'ac-card', style: width ? { width: 'min(' + width + ', 100%)' } : null },
      eyebrow ? h('div', { class: 'eyebrow' }, eyebrow) : null,
      title ? h('h2', {}, title) : null,
      body.map((b) => (typeof b === 'string' ? h('p', {}, b) : b)),
      actions);
    const m = AC.ui.modal(card, { dismiss });
    for (const b of buttons) {
      const btn = h('button', { class: 'ac-btn' + (b.ghost ? ' ghost' : ''), type: 'button' }, b.label);
      btn.addEventListener('click', () => { m.close(); b.onclick && b.onclick(); });
      actions.appendChild(btn);
    }
    return m;
  };

  AC.ui.toast = function (text, color = 'var(--green)') {
    const t = h('div', { class: 'ac-toast', style: { color } }, text);
    AC.root().appendChild(t);
    setTimeout(() => t.remove(), 1700);
  };

  // learning cards: [{t:'Title', p:'text', f:'formula'}]
  AC.ui.learnGrid = (cards) =>
    h('div', { class: 'ac-learn' }, cards.map((c) => h('div', {}, h('b', {}, c.t), h('p', {}, c.p), c.f ? h('div', { class: 'f' }, c.f) : null)));

  // fact pop-up + logbook entry
  let factBox = null;
  AC.fact = function (title, text, { tag = 'Fact', color = 'var(--cyan)', ms = 9000, game } = {}) {
    if (!factBox) {
      factBox = h('div', { class: 'ac-facts', 'aria-live': 'polite' });
      AC.root().appendChild(factBox);
    }
    const card = h('div', { class: 'ac-fact ac-panel', style: { borderLeftColor: color } }, h('div', { class: 'ft', style: { color } }, tag), h('h4', {}, title), h('p', {}, text));
    factBox.appendChild(card);
    while (factBox.children.length > 2) factBox.firstChild.remove();
    setTimeout(() => card.classList.add('out'), ms);
    setTimeout(() => card.remove(), ms + 500);
    const g = game || topCfg.game || 'misc';
    const log = (AC.pilot().log[g] = AC.pilot().log[g] || []);
    if (!log.some((e) => e.t === title)) {
      log.push({ t: title, p: text });
      AC.save();
    }
  };

  AC.ui.logbook = function () {
    const p = AC.pilot();
    const entries = [];
    for (const g in p.log) for (const e of p.log[g]) entries.push(h('div', { class: 'entry' }, h('b', {}, e.t), h('p', {}, e.p)));
    const panel = h('aside', { class: 'ac-log ac-panel' },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' } },
        h('h2', { style: { fontSize: '1.3rem' } }, 'Logbook'),
        h('button', { class: 'ac-btn ghost small', type: 'button', onclick: () => m.close() }, 'Close')),
      h('p', { class: 'dim', style: { fontSize: '0.88rem' } }, p.name + ' has collected ' + entries.length + ' facts. Every fact you unlock in a game is saved here.'),
      entries.length ? entries : h('p', {}, 'No facts yet. Play a mission to start filling your logbook.')
    );
    const m = AC.ui.modal(panel, { dismiss: true });
    m.el.style.placeItems = 'stretch end';
    m.el.style.padding = '0';
  };

  // quiz modal: q = {q, a:[...], c: correctIndex, x: explanation}
  AC.ui.quiz = function (q0, { title = 'Quick check', onDone } = {}) {
    // answer order is shuffled, so the right answer is never always in the same place
    const order = q0.a.map((_, i) => i).sort(() => Math.random() - 0.5);
    const q = Object.assign({}, q0, { a: order.map((i) => q0.a[i]), c: order.indexOf(q0.c) });
    const answers = h('div', { class: 'ac-answers' });
    const explain = h('p', { class: 'ac-explain' });
    const cont = h('button', { class: 'ac-btn', type: 'button', hidden: true }, 'Continue');
    let answered = false, right = false;
    q.a.forEach((txt, i) => {
      const b = h('button', { type: 'button' }, h('span', { class: 'L' }, 'ABCD'[i]), h('span', {}, txt));
      b.addEventListener('click', () => {
        if (answered) return;
        answered = true;
        right = i === q.c;
        b.classList.add(right ? 'right' : 'wrong');
        answers.children[q.c].classList.add('right');
        explain.textContent = (right ? 'Correct. ' : 'Not quite. ') + (q.x || '');
        right ? AC.audio.good() : AC.audio.bad();
        if (right) AC.addXP(5);
        cont.hidden = false;
        cont.focus();
      });
      answers.appendChild(b);
    });
    const card = h('div', { class: 'ac-card' }, h('div', { class: 'eyebrow' }, title + (q.w ? ' · ' + AC.UNIT + ' ' + q.w : '')), h('div', { class: 'ac-q' }, q.q), answers, explain, h('div', { class: 'ac-actions' }, cont));
    const m = AC.ui.modal(card);
    cont.addEventListener('click', () => { m.close(); onDone && onDone(right); });
    return m;
  };

  // HUD builder (right panel)
  AC.ui.hud = function (opts = {}) {
    const el = h('aside', { class: 'ac-hud ac-panel' + (window.innerWidth < 700 ? ' collapsed' : '') });
    // on small screens the data panel starts folded; tap its first heading to open or close it
    el.addEventListener('click', (e) => { if (e.target === el.querySelector('h3')) el.classList.toggle('collapsed'); });
    AC.root().appendChild(el);
    const rows = {}, meters = {}, formulas = {};
    const api = {
      el,
      section(title) {
        el.appendChild(h('h3', {}, title));
        return api;
      },
      row(id, label, v = '--') {
        const vEl = h('span', { class: 'v' }, v);
        el.appendChild(h('div', { class: 'ac-row' }, h('span', { class: 'k' }, label), vEl));
        rows[id] = vEl;
        return api;
      },
      meter(id) {
        const i = h('i');
        el.appendChild(h('div', { class: 'ac-meter' }, i));
        meters[id] = i;
        return api;
      },
      formula(id, text) {
        const f = h('div', { class: 'ac-formula' }, text);
        el.appendChild(f);
        formulas[id] = f;
        return api;
      },
      canvas(id) {
        const c = h('canvas', { id });
        el.appendChild(c);
        return c;
      },
      add(node) {
        el.appendChild(node);
        return api;
      },
      set(id, v, cls = '') {
        const r = rows[id];
        if (!r) return;
        if (r._v !== v) { r.textContent = v; r._v = v; }
        if (r._c !== cls) { r.className = 'v ' + cls; r._c = cls; }
      },
      setMeter(id, frac, color) {
        const m = meters[id];
        if (!m) return;
        m.style.width = AC.clamp(frac, 0, 1) * 100 + '%';
        if (color) m.style.background = color;
      },
      setFormula(id, text) {
        const f = formulas[id];
        if (f && f._t !== text) { f.textContent = text; f._t = text; }
      },
    };
    return api;
  };

  AC.ui.hint = function (html) {
    let el = document.querySelector('.ac-hint');
    if (!el) {
      el = h('div', { class: 'ac-hint ac-panel' });
      AC.root().appendChild(el);
    }
    el.innerHTML = html;
    return el;
  };

  AC.ui.tools = function (buttons) {
    const el = h('div', { class: 'ac-tools' });
    for (const b of buttons) {
      const btn = h('button', { class: 'ac-btn ghost small', type: 'button', title: b.title || b.label }, b.label);
      btn.addEventListener('click', () => { AC.audio.click(); b.onclick(btn); });
      el.appendChild(btn);
    }
    AC.root().appendChild(el);
    return el;
  };

  // ---------------------------------------------------------------- missions
  // cfg: {game, week, list:[mission], onSelect(m)}
  // mission: {id, title, objective, story, learn:[cards], controls:[...], proved, quiz:q, start(api), update(dt, api)}
  AC.missions = function (cfg) {
    const panel = h('nav', { class: 'ac-missions ac-panel', 'aria-label': 'Missions' }, h('h2', {}, 'Missions'));
    const btns = [];
    cfg.list.forEach((m, i) => {
      const b = h('button', { class: 'ac-mbtn', type: 'button' }, h('span', { class: 'n' }, String(i + 1).padStart(2, '0')), h('span', { class: 't' }, m.title), h('span', { class: 's' }));
      b.addEventListener('click', () => { panel.classList.remove('open'); select(i); });
      panel.appendChild(b);
      btns.push(b);
    });
    AC.root().appendChild(panel);

    const obj = h('div', { class: 'ac-objective ac-panel' }, h('div', { class: 'lbl' }, 'Objective'), h('div', { class: 'txt' }), h('div', { class: 'bar' }, h('i')));
    AC.root().appendChild(obj);
    const objTxt = obj.querySelector('.txt'), objLbl = obj.querySelector('.lbl'), objBar = obj.querySelector('.bar i');

    const R = { index: -1, current: null, done: false, t: 0, state: {} };

    function refreshStars() {
      cfg.list.forEach((m, i) => {
        const s = AC.starsFor(cfg.game, m.id);
        btns[i].querySelector('.s').innerHTML = '★'.repeat(s) + '<span class="off">' + '★'.repeat(3 - s) + '</span>';
        btns[i].classList.toggle('active', i === R.index);
      });
    }
    const api = {
      get t() { return R.t; },
      get state() { return R.state; },
      objective(text) { objTxt.textContent = text; },
      progress(frac, label) {
        objBar.style.width = AC.clamp(frac, 0, 1) * 100 + '%';
        if (label != null) objLbl.textContent = label;
      },
      win(stars, msg) { if (!R.done) finish(true, AC.clamp(stars | 0, 1, 3), msg); },
      fail(msg) { if (!R.done) finish(false, 0, msg); },
      restart() { select(R.index, true); },
    };
    function briefing(m, onGo) {
      const ctr = (m.controls || cfg.controls || []).map((c) => h('span', { html: c }));
      const card = h('div', { class: 'ac-card' },
        h('div', { class: 'eyebrow' }, 'Mission ' + (R.index + 1) + ' of ' + cfg.list.length + (m.week || cfg.week ? ' · ' + AC.UNIT + ' ' + (m.week || cfg.week) : '')),
        h('h2', {}, m.title),
        m.story ? h('p', { class: 'story' }, m.story) : null,
        m.learn ? AC.ui.learnGrid(m.learn) : null,
        ctr.length ? h('div', { class: 'ac-controls' }, ctr) : null,
        h('div', { class: 'ac-actions' }, h('button', { class: 'ac-btn', type: 'button', onclick: () => { md.close(); onGo(); } }, 'Start mission'))
      );
      const md = AC.ui.modal(card);
    }
    function select(i, skipBrief) {
      document.querySelectorAll('.ac-modal').forEach((m) => m.remove());
      AC.paused = false;
      R.index = i;
      R.current = cfg.list[i];
      R.done = false;
      R.t = 0;
      R.state = {};
      objTxt.textContent = R.current.objective || R.current.title;
      objLbl.textContent = 'Objective';
      objBar.style.width = '0%';
      refreshStars();
      cfg.onSelect && cfg.onSelect(R.current, api);
      const go = () => { R.current.start && R.current.start(api); };
      if (skipBrief) go();
      else briefing(R.current, go);
    }
    function finish(ok, stars, msg) {
      R.done = true;
      const m = R.current;
      const last = R.index >= cfg.list.length - 1;
      let gained = 0;
      if (ok) { gained = AC.award(cfg.game, m.id, stars); AC.audio.win(); }
      else AC.audio.bad();
      refreshStars();
      const s = ok ? '★'.repeat(stars) + '<span class="off">' + '★'.repeat(3 - stars) + '</span>' : '';
      const actions = h('div', { class: 'ac-actions' });
      const card = h('div', { class: 'ac-card' },
        h('div', { class: 'eyebrow', style: { color: ok ? 'var(--green)' : 'var(--amber)' } }, ok ? 'Mission complete' : 'Mission failed'),
        h('h2', {}, ok ? m.title : 'Try again'),
        ok ? h('div', { class: 'ac-stars', html: s, 'aria-label': stars + ' of 3 stars' }) : null,
        msg ? h('p', { class: 'story' }, msg) : null,
        ok && m.proved ? h('div', { class: 'ac-proved' }, h('b', {}, 'What you just proved'), h('p', {}, m.proved)) : null,
        !ok && m.tip ? h('div', { class: 'ac-proved', style: { borderLeftColor: 'var(--amber)' } }, h('b', { style: { color: 'var(--amber)' } }, 'Tip'), h('p', {}, m.tip)) : null,
        ok && gained ? h('p', { class: 'dim mono', style: { fontSize: '0.8rem' } }, '+' + gained + ' XP for ' + AC.pilot().name) : null,
        actions
      );
      const md = AC.ui.modal(card);
      actions.appendChild(h('button', { class: 'ac-btn ghost', type: 'button', onclick: () => { md.close(); select(R.index, true); } }, 'Retry'));
      const wk = m.week || cfg.week || 1;
      const testUrl = 'arena.html#w' + wk;
      const next = () => {
        md.close();
        if (!last) select(R.index + 1);
        else window.location.href = testUrl;
      };
      const nextBtn = h('button', { class: 'ac-btn', type: 'button' }, last ? 'Take the ' + AC.UNIT + ' ' + wk + ' test' : 'Next mission');
      nextBtn.addEventListener('click', () => {
        if (ok && m.quiz) {
          md.close();
          AC.ui.quiz(m.quiz, { onDone: () => (last ? (window.location.href = testUrl) : select(R.index + 1)) });
        } else next();
      });
      if (ok) actions.appendChild(nextBtn);
      setTimeout(() => (ok ? nextBtn : actions.firstChild).focus(), 40);
    }
    R.update = function (dt) {
      if (!R.current || R.done || AC.paused) return;
      R.t += dt;
      R.current.update && R.current.update(dt, api);
    };
    R.select = select;
    R.api = api;
    R.panel = panel;
    R.refresh = refreshStars;
    // first unfinished mission
    const firstOpen = cfg.list.findIndex((m) => !AC.starsFor(cfg.game, m.id));
    // game.html#missionId opens that mission (the hub links each module straight to its missions)
    const fromHash = cfg.list.findIndex((m) => m.id === location.hash.slice(1));
    R.begin = () => select(fromHash >= 0 ? fromHash : firstOpen < 0 ? 0 : firstOpen);
    refreshStars();
    return R;
  };

  // ---------------------------------------------------------------- graph (2D canvas)
  AC.Graph = class {
    constructor(canvas, o = {}) {
      this.c = canvas;
      this.o = Object.assign({ xMin: 0, xMax: 10, yMin: 0, yMax: 1, xLabel: '', yLabel: '', xTicks: 5, yTicks: 4 }, o);
    }
    draw({ series = [], marks = [], hlines = [], vlines = [] } = {}) {
      const c = this.c, o = this.o;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = c.clientWidth || 240, H = c.clientHeight || 120;
      if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
      const g = c.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      const L = 30, R = 8, T = 8, B = 20;
      const X = (x) => L + ((x - o.xMin) / (o.xMax - o.xMin)) * (W - L - R);
      const Y = (y) => T + (1 - (y - o.yMin) / (o.yMax - o.yMin)) * (H - T - B);
      const dim = AC.css('--dim'), line = AC.css('--line');
      g.font = '9px "B612 Mono", monospace';
      g.lineWidth = 1;
      g.strokeStyle = line;
      g.fillStyle = dim;
      for (let i = 0; i <= o.yTicks; i++) {
        const v = o.yMin + ((o.yMax - o.yMin) * i) / o.yTicks;
        const y = Y(v);
        g.beginPath(); g.moveTo(L, y); g.lineTo(W - R, y); g.stroke();
        g.textAlign = 'right'; g.fillText(+v.toFixed(2), L - 3, y + 3);
      }
      for (let i = 0; i <= o.xTicks; i++) {
        const v = o.xMin + ((o.xMax - o.xMin) * i) / o.xTicks;
        g.textAlign = 'center'; g.fillText(+v.toFixed(1), X(v), H - B + 11);
      }
      if (o.xLabel) { g.textAlign = 'right'; g.fillText(o.xLabel, W - R, H - 1); }
      if (o.yLabel) { g.textAlign = 'left'; g.fillText(o.yLabel, L + 3, T + 8); }
      for (const hl of hlines) {
        g.strokeStyle = hl.color; g.setLineDash([4, 3]);
        g.beginPath(); g.moveTo(L, Y(hl.y)); g.lineTo(W - R, Y(hl.y)); g.stroke();
        g.setLineDash([]);
        if (hl.label) { g.fillStyle = hl.color; g.textAlign = 'right'; g.fillText(hl.label, W - R - 2, Y(hl.y) - 3); }
      }
      for (const vl of vlines) {
        g.strokeStyle = vl.color; g.setLineDash([4, 3]);
        g.beginPath(); g.moveTo(X(vl.x), T); g.lineTo(X(vl.x), H - B); g.stroke();
        g.setLineDash([]);
        if (vl.label) { g.fillStyle = vl.color; g.textAlign = 'left'; g.fillText(vl.label, X(vl.x) + 3, T + 18); }
      }
      g.save();
      g.beginPath(); g.rect(L, T, W - L - R, H - T - B); g.clip();
      for (const s of series) {
        if (!s.pts.length) continue;
        g.strokeStyle = s.color; g.lineWidth = s.width || 2;
        g.beginPath();
        s.pts.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))));
        g.stroke();
      }
      for (const m of marks) {
        g.fillStyle = m.color;
        g.beginPath(); g.arc(X(m.x), Y(m.y), m.r || 4, 0, Math.PI * 2); g.fill();
      }
      g.restore();
    }
  };

  // ---------------------------------------------------------------- 3D helpers (need THREE)
  AC.scene = function (opts = {}) {
    if (!window.THREE) {
      AC.ui.modal(h('div', { class: 'ac-card' }, h('h2', {}, '3D engine did not load'), h('p', {}, 'This game needs an internet connection the first time, or the file lib/three.min.js next to this page. Check the connection and reload.')));
      throw new Error('THREE missing');
    }
    const host = opts.host || document.getElementById('stage');
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: !!opts.alpha, powerPreference: 'high-performance', logarithmicDepthBuffer: !!opts.logDepth });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    if (opts.shadows) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; }
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    if (opts.background != null) scene.background = new THREE.Color(opts.background);
    const camera = new THREE.PerspectiveCamera(opts.fov || 60, 1, opts.near || 0.1, opts.far || 5000);
    const tags = [];
    function resize() {
      const w = host.clientWidth || window.innerWidth, hh = host.clientHeight || window.innerHeight;
      renderer.setSize(w, hh, false);
      camera.aspect = w / hh;
      camera.updateProjectionMatrix();
    }
    if (window.ResizeObserver) new ResizeObserver(resize).observe(host);
    window.addEventListener('resize', resize);
    resize();
    const frameFns = [];
    let last = 0, time = 0;
    const v = new THREE.Vector3();
    function updateTags() {
      const w = renderer.domElement.clientWidth, hh = renderer.domElement.clientHeight;
      for (const t of tags) {
        if (!t.visible) { if (t._shown) { t.el.style.display = 'none'; t._shown = false; } continue; }
        v.copy(t.pos).project(camera);
        const on = v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2;
        if (!on) { if (t._shown) { t.el.style.display = 'none'; t._shown = false; } continue; }
        if (!t._shown) { t.el.style.display = ''; t._shown = true; }
        t.el.style.left = ((v.x + 1) / 2) * w + 'px';
        t.el.style.top = ((1 - v.y) / 2) * hh + 'px';
      }
    }
    let skip = 0;
    function loop(ts) {
      requestAnimationFrame(loop);
      // while real training runs, draw about 10 frames a second so the CPU goes to the training
      if (AC.throttle && ts - last < 95) return;
      const real = Math.min(0.1, Math.max(0, (ts - last) / 1000)); // slow PCs: games sub-step this
      last = ts;
      const dt = AC.paused ? 0 : real;
      time += dt;
      for (const f of frameFns) f(dt, time, real);
      renderer.render(scene, camera);
      updateTags();
    }
    return {
      renderer, scene, camera, host,
      onFrame(f) { frameFns.push(f); },
      start() { requestAnimationFrame((ts) => { last = ts; loop(ts); }); },
      // DOM label that follows a 3D point
      tag(text, color = 'var(--fg)') {
        const el = h('div', { class: 'ac-tag', style: { color } }, text);
        host.parentNode.appendChild(el);
        const t = { el, pos: new THREE.Vector3(), visible: true, _shown: true, set(txt) { if (txt !== t._txt) { el.textContent = txt; t._txt = txt; } } };
        tags.push(t);
        return t;
      },
    };
  };

  AC.lights = function (scene, o = {}) {
    const hemi = new THREE.HemisphereLight(o.sky || 0xcfe8ff, o.ground || 0x4a5a3a, o.hemi != null ? o.hemi : 0.75);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(o.sunColor || 0xfff3dd, o.sun != null ? o.sun : 0.9);
    sun.position.set(...(o.dir || [60, 100, 40]));
    scene.add(sun);
    if (o.shadows) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      const s = o.shadowSize || 60;
      Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 400 });
      scene.add(sun.target);
    }
    return { hemi, sun };
  };

  // radius must stay inside the camera's far plane; the dome follows the camera each frame
  AC.skyDome = function (scene, top = 0x1f63b0, horizon = 0xcde8f6, bottom = 0x5b7a4a, radius = 1200) {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(top) }, hor: { value: new THREE.Color(horizon) }, bot: { value: new THREE.Color(bottom) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 hor; uniform vec3 bot; varying vec3 vP; void main(){ float y = vP.y; vec3 c = y > 0.0 ? mix(hor, top, pow(y, 0.55)) : mix(hor, bot, pow(-y, 0.35)); gl_FragColor = vec4(c, 1.0); }',
    });
    const m = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), mat);
    m.renderOrder = -10;
    m.frustumCulled = false;
    scene.add(m);
    return m;
  };

  AC.starfield = function (scene, n = 2500, r = 4000, size = 1.6) {
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      pos.set([r * s * Math.cos(th), r * u, r * s * Math.sin(th)], i * 3);
      const b = 0.55 + Math.random() * 0.45, warm = Math.random();
      col.set([b, b * (0.9 + warm * 0.1), b * (0.85 + (1 - warm) * 0.15)], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, depthWrite: false, fog: false }));
    pts.frustumCulled = false;
    scene.add(pts);
    return pts;
  };

  // solid arrow for force vectors (always drawn on top)
  AC.Arrow = class {
    constructor(scene, color, opts = {}) {
      const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 });
      this.group = new THREE.Group();
      this.shaft = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10), mat);
      this.head = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 14), mat);
      this.shaft.renderOrder = this.head.renderOrder = 20;
      this.group.add(this.shaft, this.head);
      this.width = opts.width || 0.08;
      this.group.visible = false;
      scene.add(this.group);
      this._y = new THREE.Vector3(0, 1, 0);
      this._d = new THREE.Vector3();
    }
    set(origin, vec, scale = 1, maxLen = Infinity) {
      let len = vec.length() * scale;
      if (len < 1e-4) { this.group.visible = false; return this; }
      len = Math.min(len, maxLen);
      this.group.visible = true;
      this.group.position.copy(origin);
      this._d.copy(vec).normalize();
      this.group.quaternion.setFromUnitVectors(this._y, this._d);
      const w = this.width, hl = Math.min(len * 0.35, w * 6);
      this.shaft.scale.set(w, Math.max(0.001, len - hl), w);
      this.shaft.position.y = (len - hl) / 2;
      this.head.scale.set(w * 2.6, hl, w * 2.6);
      this.head.position.y = len - hl / 2;
      this.tip = this.tip || new THREE.Vector3();
      this.tip.copy(this._d).multiplyScalar(len).add(origin);
      return this;
    }
    hide() { this.group.visible = false; }
  };

  // orbit camera controller (drag / wheel / pinch)
  AC.OrbitCam = class {
    constructor(camera, dom, o = {}) {
      this.cam = camera;
      this.target = o.target || new THREE.Vector3();
      this.dist = o.dist || 10;
      this.min = o.min || 1;
      this.max = o.max || 1000;
      this.theta = o.theta != null ? o.theta : 0.6;
      this.phi = o.phi != null ? o.phi : 1.1;
      this.minPhi = o.minPhi != null ? o.minPhi : 0.05;
      this.maxPhi = o.maxPhi != null ? o.maxPhi : Math.PI - 0.05;
      this.enabled = true;
      this.lastUser = -1e9;
      this.autoRotate = o.autoRotate || 0;
      const ptrs = new Map();
      let pinch0 = 0, dist0 = 0;
      dom.addEventListener('pointerdown', (e) => {
        if (!this.enabled) return;
        ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
        dom.setPointerCapture(e.pointerId);
        if (ptrs.size === 2) {
          const [a, b] = [...ptrs.values()];
          pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
          dist0 = this.dist;
        }
      });
      dom.addEventListener('pointermove', (e) => {
        if (!ptrs.has(e.pointerId) || !this.enabled) return;
        const p = ptrs.get(e.pointerId);
        const dx = e.clientX - p.x, dy = e.clientY - p.y;
        p.x = e.clientX; p.y = e.clientY;
        if (ptrs.size === 1) {
          this.theta -= dx * 0.006;
          this.phi = AC.clamp(this.phi - dy * 0.006, this.minPhi, this.maxPhi);
        } else if (ptrs.size === 2) {
          const [a, b] = [...ptrs.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (pinch0 > 0) this.dist = AC.clamp((dist0 * pinch0) / d, this.min, this.max);
        }
        this.lastUser = performance.now();
      });
      const up = (e) => { ptrs.delete(e.pointerId); pinch0 = 0; };
      dom.addEventListener('pointerup', up);
      dom.addEventListener('pointercancel', up);
      dom.addEventListener('wheel', (e) => {
        if (!this.enabled) return;
        e.preventDefault();
        this.dist = AC.clamp(this.dist * Math.pow(1.0012, e.deltaY), this.min, this.max);
        this.lastUser = performance.now();
      }, { passive: false });
    }
    get userActive() { return performance.now() - this.lastUser < 2500; }
    update(dt = 0) {
      if (this.autoRotate && !this.userActive) this.theta += this.autoRotate * dt;
      const s = Math.sin(this.phi);
      // portrait screens (phones) see less sideways, so step back a little to keep the scene in view
      const asp = this.cam.aspect || 1, d = this.dist * (asp < 1 ? Math.min(1.7, Math.pow(asp, -0.7)) : 1);
      this.cam.position.set(
        this.target.x + d * s * Math.sin(this.theta),
        this.target.y + d * Math.cos(this.phi),
        this.target.z + d * s * Math.cos(this.theta)
      );
      this.cam.lookAt(this.target);
    }
  };

  // canvas-text sprite for labels that live in the world
  AC.textSprite = function (text, { color = '#ffffff', bg = 'rgba(5,12,22,0.7)', size = 1, font = 'bold 44px "Chakra Petch", sans-serif', depthTest = true } = {}) {
    const c = document.createElement('canvas');
    const g = c.getContext('2d');
    g.font = font;
    const w = Math.ceil(g.measureText(text).width) + 28;
    c.width = w; c.height = 64;
    g.font = font;
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, 64); }
    g.fillStyle = color; g.textBaseline = 'middle'; g.textAlign = 'center';
    g.fillText(text, w / 2, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.minFilter = THREE.LinearFilter;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest, transparent: true }));
    s.scale.set((size * w) / 64, size, 1);
    return s;
  };

  // smooth chase camera behind a moving object
  AC.chase = function (camera, pos, quat, offset, lookAhead, k, dt, yawOnly) {
    const off = offset.clone();
    if (yawOnly) {
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
      const yaw = Math.atan2(fwd.x, fwd.z);
      off.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    } else off.applyQuaternion(quat);
    const want = pos.clone().add(off);
    if (!camera._chaseInit) { camera.position.copy(want); camera._chaseInit = true; }
    camera.position.lerp(want, 1 - Math.exp(-k * dt));
    const look = new THREE.Vector3(0, 0, lookAhead).applyQuaternion(quat).add(pos);
    camera.lookAt(look);
  };

  // procedural canvas texture
  AC.canvasTex = function (w, hgt, draw, repeat) {
    const c = document.createElement('canvas');
    c.width = w; c.height = hgt;
    draw(c.getContext('2d'), w, hgt);
    const t = new THREE.CanvasTexture(c);
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
    t.anisotropy = 4;
    return t;
  };

  // value noise for terrain and planets
  AC.noise2 = (function () {
    const P = new Uint8Array(512);
    const p = [...Array(256).keys()].sort(() => Math.random() - 0.5);
    for (let i = 0; i < 512; i++) P[i] = p[i & 255];
    const fade = (t) => t * t * (3 - 2 * t);
    const val = (x, y) => P[(P[x & 255] + y) & 511] / 255;
    function n(x, y) {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      const a = val(xi, yi), b = val(xi + 1, yi), c = val(xi, yi + 1), d = val(xi + 1, yi + 1);
      const u = fade(xf), v = fade(yf);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    }
    return function fbm(x, y, oct = 4) {
      let s = 0, amp = 0.5, f = 1;
      for (let i = 0; i < oct; i++) { s += amp * n(x * f, y * f); amp *= 0.5; f *= 2; }
      return s;
    };
  })();

  // standard game page boot: top bar + help
  AC.boot = function (cfg) {
    if (AC.isTouch) document.body.classList.add('touch');
    AC.ui.top(cfg);
  };
})();
