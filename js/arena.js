/* Test Arena — tests delivered as games.
   Streak Run: solo, 10 questions, 3 lives, faster answers and streaks score more.
   Quiz Duel: two players share one keyboard or tablet (A S D F vs H J K L), first right answer scores.
   arena.html#w3 preselects lesson 3, arena.html#all selects every lesson. */
(function () {
  'use strict';
  const { h } = AC;
  AC.boot({ game: 'arena', topic: 'Tests you play', title: 'Test Arena', help: () => menu() });
  const board = document.getElementById('board');
  const LESSONS = [...new Set(AC.QUESTIONS.map((q) => q.w))].sort((a, b) => a - b);
  const unit = (w) => AC.UNIT + ' ' + w;
  const shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
  // shuffle the answers too, so nobody learns "it's always B"
  const prep = (q) => { const order = shuffle([0, 1, 2, 3]); return { ...q, a: order.map((i) => q.a[i]), c: order.indexOf(q.c) }; };
  const pick = (lessons, n) => shuffle(AC.QUESTIONS.filter((q) => lessons.includes(q.w))).slice(0, n).map(prep);
  const name = (i) => (AC.data.pilots[i] || { name: 'Player ' + (i + 1) }).name;
  let G = null, tick = null;
  const stop = () => { if (tick) cancelAnimationFrame(tick); tick = null; };

  // ---------------------------------------------------------------- menu
  function menu() {
    stop();
    board.innerHTML = '';
    document.querySelectorAll('.ac-modal').forEach((m) => m.remove());
    const hash = location.hash.replace('#', '');
    const sel = new Set(hash === 'all' ? LESSONS : hash.startsWith('w') && LESSONS.includes(+hash.slice(1)) ? [+hash.slice(1)] : [LESSONS[0]]);
    const chips = h('div', { class: 'chips' }, LESSONS.map((w) => {
      const b = h('button', { type: 'button', class: sel.has(w) ? 'on' : '' }, unit(w));
      b.addEventListener('click', () => { sel.has(w) ? sel.delete(w) : sel.add(w); b.classList.toggle('on', sel.has(w)); });
      return b;
    }));
    let md;
    const go = (mode) => { if (!sel.size) return AC.ui.toast('Pick at least one ' + AC.UNIT.toLowerCase(), 'var(--amber)'); md.close(); (mode === 'run' ? startRun : startDuel)([...sel]); };
    md = AC.ui.modal(h('div', { class: 'ac-card' },
      h('div', { class: 'eyebrow' }, 'Test Arena'), h('h2', {}, 'Choose your test'),
      h('p', { class: 'dim' }, 'Questions from:'), chips,
      h('div', { class: 'modes' },
        h('button', { type: 'button', onclick: () => go('run') }, h('b', {}, 'Streak Run'), h('span', {}, 'Solo · 10 questions · 3 lives. Fast answers and streaks score more.')),
        h('button', { type: 'button', onclick: () => go('duel') }, h('b', {}, 'Quiz Duel'), h('span', {}, name(0) + ' vs ' + name(1) + ' on one keyboard or tablet. First right answer scores.')))));
  }

  // ---------------------------------------------------------------- shared question view
  function view(q, { onPick, keysHint }) {
    board.innerHTML = '';
    const status = h('div', { class: 'status' });
    const timer = h('div', { class: 'timer' }, h('i'));
    const opts = h('div', { class: 'opts' }, q.a.map((t, i) => h('button', { type: 'button', onclick: () => onPick && onPick(i) }, h('span', { class: 'L' }, keysHint ? keysHint[i] : String(i + 1)), h('span', {}, t))));
    const why = h('p', { class: 'why' });
    board.append(status, timer, h('div', { class: 'qtext' }, q.q), opts, why);
    return {
      status, why, opts,
      bar: (f) => { timer.firstChild.style.width = Math.max(0, f) * 100 + '%'; timer.firstChild.style.background = f < 0.3 ? 'var(--amber)' : 'var(--cyan)'; },
      reveal(chosen) { [...opts.children].forEach((b, i) => { b.disabled = true; if (i === q.c) b.classList.add('right'); else if (i === chosen) b.classList.add('wrong'); }); why.textContent = q.x || ''; },
    };
  }
  function nextButton(label, fn) {
    const b = h('button', { class: 'ac-btn', type: 'button' }, label);
    const key = (e) => { if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); done(); } };
    const done = () => { window.removeEventListener('keydown', key); b.remove(); fn(); };
    b.addEventListener('click', done);
    setTimeout(() => window.addEventListener('keydown', key), 250);
    board.appendChild(h('div', { class: 'ac-actions' }, b));
    b.focus();
  }

  // ---------------------------------------------------------------- Streak Run
  const TIME = 20;
  function startRun(lessons) {
    G = { mode: 'run', lessons, qs: pick(lessons, 10), i: 0, score: 0, right: 0, lives: 3, streak: 0, missed: [] };
    askRun();
  }
  function askRun() {
    const q = G.qs[G.i];
    let left = TIME, answered = false, last = performance.now();
    const v = view(q, { onPick: (i) => answer(i) });
    const paint = () => { v.status.innerHTML = ''; v.status.append(h('span', {}, 'Q ' + (G.i + 1) + ' / ' + G.qs.length), h('span', { class: 'grow' }), h('span', {}, 'Streak ×' + (1 + Math.min(G.streak, 4) * 0.5)), h('span', {}, '♥'.repeat(G.lives) + '♡'.repeat(3 - G.lives)), h('b', {}, AC.fmt(G.score))); };
    paint();
    const keys = (e) => { const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code); if (n >= 0) answer(n); };
    window.addEventListener('keydown', keys);
    function answer(i) {
      if (answered) return;
      answered = true;
      window.removeEventListener('keydown', keys);
      stop();
      v.reveal(i);
      if (i === q.c) {
        G.streak++; G.right++;
        G.score += Math.round((100 + left * 5) * (1 + Math.min(G.streak - 1, 4) * 0.5));
        AC.audio.good();
      } else {
        G.streak = 0; G.lives--; G.missed.push(q);
        AC.audio.bad();
        if (i < 0) v.why.textContent = 'Time up. ' + (q.x || '');
      }
      paint();
      const over = G.lives <= 0 || G.i >= G.qs.length - 1;
      nextButton(over ? 'See results' : 'Next question', () => (over ? endRun() : (G.i++, askRun())));
    }
    const loop = (t) => {
      tick = requestAnimationFrame(loop);
      left -= AC.paused ? 0 : (t - last) / 1000;
      last = t;
      v.bar(left / TIME);
      if (left <= 0) answer(-1);
    };
    tick = requestAnimationFrame(loop);
  }
  function endRun() {
    const key = 'arena:run:' + G.lessons.join('-');
    const best = AC.setBest(key, G.score);
    AC.addXP(G.right * 5);
    if (G.right === G.qs.length) AC.audio.win();
    results(G.lives > 0 ? 'Run complete' : 'Out of lives', AC.fmt(G.score) + ' points', [
      G.right + ' of ' + G.qs.length + ' right' + (best ? ' · new best for ' + name(AC.data.cur | 0) + '!' : ''),
      G.missed.length ? missed(G.missed) : 'Perfect run: every question right.',
    ]);
  }

  // ---------------------------------------------------------------- Quiz Duel
  const PADS = [['KeyA', 'KeyS', 'KeyD', 'KeyF'], ['KeyH', 'KeyJ', 'KeyK', 'KeyL']];
  function startDuel(lessons) {
    G = { mode: 'duel', lessons, qs: pick(lessons, 10), i: 0, pts: [0, 0], missed: [] };
    askDuel();
  }
  function askDuel() {
    const q = G.qs[G.i];
    const locked = [false, false];
    let done = false, left = 25, last = performance.now();
    const v = view(q, { keysHint: ['1', '2', '3', '4'] });
    v.status.append(h('span', {}, 'Round ' + (G.i + 1) + ' / ' + G.qs.length), h('span', { class: 'grow' }), h('b', {}, name(0) + ' ' + G.pts[0] + ' : ' + G.pts[1] + ' ' + name(1)));
    const pads = [0, 1].map((p) => h('div', { class: 'pad' }, h('h3', {}, h('span', {}, name(p)), h('span', { class: 'mono dim' }, PADS[p].map((k) => k.slice(3)).join(' '))),
      h('div', { class: 'keys' }, [0, 1, 2, 3].map((i) => h('button', { type: 'button', onpointerdown: (e) => { e.preventDefault(); press(p, i); } }, String(i + 1))))));
    board.insertBefore(h('div', { class: 'pads' }, pads), v.why);
    const keys = (e) => { if (e.repeat) return; for (const p of [0, 1]) { const i = PADS[p].indexOf(e.code); if (i >= 0) press(p, i); } };
    window.addEventListener('keydown', keys);
    function press(p, i) {
      if (done || locked[p]) return;
      if (i === q.c) { G.pts[p]++; pads[p].classList.add('scored'); AC.audio.good(); finish(i, name(p) + ' scores! '); }
      else { locked[p] = true; pads[p].classList.add('locked'); AC.audio.bad(); if (locked[0] && locked[1]) finish(i, 'Both wrong. '); }
    }
    function finish(i, msg) {
      done = true;
      stop();
      window.removeEventListener('keydown', keys);
      if (!msg.includes('scores')) G.missed.push(q);
      v.reveal(i);
      v.why.textContent = msg + (q.x || '');
      const final = G.i >= G.qs.length - 1;
      nextButton(final ? 'See the winner' : 'Next round', () => (final ? endDuel() : (G.i++, askDuel())));
    }
    const loop = (t) => {
      tick = requestAnimationFrame(loop);
      left -= AC.paused ? 0 : (t - last) / 1000;
      last = t;
      v.bar(left / 25);
      if (left <= 0) finish(-1, 'Time up. ');
    };
    tick = requestAnimationFrame(loop);
  }
  function endDuel() {
    const [a, b] = G.pts;
    AC.audio.win();
    results('Quiz Duel', a === b ? 'It\'s a draw!' : name(a > b ? 0 : 1) + ' wins!', [
      name(0) + ' ' + a + ' : ' + b + ' ' + name(1),
      G.missed.length ? missed(G.missed) : 'Every round was answered correctly.',
    ]);
  }

  // ---------------------------------------------------------------- results
  function missed(list) {
    return h('div', {}, h('p', {}, h('b', {}, 'Review these:')), h('div', { class: 'missed' }, list.map((q) => h('div', {}, h('b', {}, q.q), h('p', {}, 'Answer: ' + q.a[q.c] + '. ' + (q.x || ''))))));
  }
  function results(eyebrow, title, body) {
    board.innerHTML = '';
    const again = G.mode === 'run' ? () => startRun(G.lessons) : () => startDuel(G.lessons);
    AC.ui.card({ eyebrow, title, body, dismiss: false, buttons: [{ label: 'Play again', onclick: again }, { label: 'Change test', ghost: true, onclick: menu }, { label: 'Back to hub', ghost: true, onclick: () => (location.href = 'index.html') }] });
  }

  window.addEventListener('hashchange', menu);
  menu();
})();
