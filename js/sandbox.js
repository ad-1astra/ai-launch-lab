/* Zone 4: Agent Sandbox (weeks 6-8, guide Part 6.2). Real output: harness config and verified trajectories for the coder adapter. */
(function () {
  'use strict';
  const h = AC.h, W = LAB.world, A = AGENT;
  AC.boot({ game: 'sandbox', week: 4, topic: 'Weeks 6-8 · Part 6.2', title: 'Agent Sandbox', help: () => AC.ui.card({ eyebrow: 'How to play', title: 'Cage first, agent second', body: ['Set the sandbox rules, then attack them. In the second mission you type real commands into a real virtual shell, and your steps become training data.'] }) });
  const { S, scene } = W.hall({ size: 20, accent: 0x7aa2ff, cam: { dist: 17, theta: 0.5, phi: 1.2, target: new THREE.Vector3(-3, 2.5, 0) } });
  // glass cage with a robot inside
  const cage = new THREE.Group();
  const glass = new THREE.MeshStandardMaterial({ color: 0x7aa2ff, transparent: true, opacity: 0.14, roughness: 0.1, metalness: 0.1, side: THREE.DoubleSide });
  const walls = [];
  for (const [x, z, ww, dd] of [[0, -4, 8, 0.1], [0, 4, 8, 0.1], [-4, 0, 0.1, 8], [4, 0, 0.1, 8]]) { const m = W.box(ww, 5, dd, glass.clone(), x, 2.5, z); m.castShadow = false; walls.push(m); cage.add(m); }
  const lid = W.box(8, 0.1, 8, glass.clone(), 0, 5, 0); lid.castShadow = false; walls.push(lid); cage.add(lid);
  cage.add(W.box(8.4, 0.2, 8.4, W.std(0x1a2a40), 0, 0.1, 0));
  scene.add(cage);
  const bot = W.robot(0x7aa2ff); bot.position.set(0, 0.2, 0); cage.add(bot);
  const term = W.box(2.4, 1.6, 0.2, W.glow(0x2fe0cf, 0.5), 0, 1.6, -3); cage.add(term);
  const shield = { level: 0, flash: 0, flashColor: 0x4be38a };
  const setShield = (l) => { shield.level = l; };
  const flash = (color) => { shield.flash = 1; shield.flashColor = color; };
  const c1 = new THREE.Color();
  S.onFrame((dt, t) => {
    shield.flash = Math.max(0, shield.flash - dt * 1.6);
    for (const m of walls) {
      m.material.opacity = 0.08 + shield.level * 0.3 + shield.flash * 0.5;
      c1.setHex(shield.flash > 0.02 ? shield.flashColor : 0x7aa2ff);
      m.material.color.copy(c1);
    }
    bot.rotation.y = Math.sin(t * 0.8) * 0.9 + Math.PI;
    bot.walk(t * 0.5, 0.25);
    term.material.emissiveIntensity = 0.4 + Math.abs(Math.sin(t * 3)) * 0.4;
    MR.update(dt);
  });

  // ---------------------------------------- Mission 1: harness
  const harness = {
    id: 'harness', title: 'Build the cage',
    objective: 'Configure the harness so that all 8 test commands behave correctly',
    story: 'A terminal agent is a loop that runs commands. Never give it real access. Build the harness first, then throw commands at it, including the kind that would wreck a real machine. Nothing here touches your computer.',
    learn: [
      { t: 'The agent loop', p: 'Read the situation, choose a command or edit, run it, read the result, continue.', f: 'read → choose → run → read' },
      { t: 'The cage', p: 'Docker or gVisor isolation, timeouts, a command allowlist, and confirmation for destructive actions.', f: 'Plus audit logs' },
    ],
    proved: 'This is the sandbox from Part 6.2 and 8.4, working: isolation, allowlist, timeouts, confirmations and audit logs. Your final AI\'s agent runs inside exactly this configuration.',
    tip: 'A blank harness lets dangerous commands through. A wall that blocks everything fails too, because ls and cat must still work.',
    get quiz() { return AC.QUESTIONS.find((q) => q.id === 'harness'); },
    start(api) {
      LAB.closeBench();
      const st = api.state;
      st.cfg = A.DEFAULT_CONFIG();
      st.runs = 0;
      setShield(0);
      const b = LAB.bench('Harness settings', 'Every setting changes how a real command is treated.');
      const out = h('div');
      const seg = (label, key, opts, help) => h('div', { class: 'ac-field' }, h('label', {}, label), LAB.seg(opts, st.cfg[key], (v) => { st.cfg[key] = v; refreshShield(); }), help ? h('small', { class: 'dim' }, help) : null);
      const refreshShield = () => { const c = st.cfg; setShield(((c.isolation !== 'none') + (c.timeout > 0) + !!c.allowlist + !!c.confirm + !!c.audit + !c.network) / 6); };
      const go = h('button', { class: 'ac-btn', type: 'button' }, 'Attack it with 8 commands');
      go.addEventListener('click', async () => {
        st.runs++;
        go.disabled = true;
        const hn = new A.Harness(Object.assign({}, st.cfg));
        const rows = [];
        let ok = 0;
        for (const a of A.ATTACKS) {
          const r = hn.exec(a.cmd);
          const got = r.timedOut ? 'timeout' : r.blocked ? 'block' : r.needsConfirm ? 'confirm' : r.danger ? 'damage' : 'allow';
          const good = got === a.want;
          if (good) ok++;
          flash(good ? 0x4be38a : 0xff5a4f);
          good ? AC.audio.ping() : AC.audio.bad();
          rows.push({ cls: good ? 'ok' : 'no', cells: [h('code', {}, a.cmd), got, a.want, good ? 'correct' : a.why] });
          await LAB.sleep(170);
        }
        const hasAudit = st.cfg.audit;
        out.innerHTML = '';
        out.append(LAB.table(['Command', 'What happened', 'Should', 'Result'], rows), h('p', { class: hasAudit ? 'c-green' : 'c-amber' }, hasAudit ? 'Audit log recorded ' + hn.auditLog.length + ' entries.' : 'No audit log: you could not review what happened. Turn it on.'));
        api.progress(ok / A.ATTACKS.length);
        go.disabled = false;
        if (ok === A.ATTACKS.length && hasAudit) {
          await LAB.set('harness', { config: Object.assign({}, st.cfg), at: Date.now() });
          api.win(st.runs === 1 ? 3 : st.runs <= 3 ? 2 : 1, 'All 8 commands were treated correctly. Attempts: ' + st.runs + '.');
        }
      });
      b.add(LAB.tag('real'),
        seg('Isolation', 'isolation', [{ value: 'none', label: 'None' }, { value: 'docker', label: 'Docker' }, { value: 'gvisor', label: 'gVisor' }]),
        seg('Timeout', 'timeout', [{ value: 0, label: 'None' }, { value: 10, label: '10 s' }, { value: 60, label: '60 s' }]),
        seg('Command allowlist', 'allowlist', [{ value: false, label: 'Off' }, { value: true, label: 'On' }], 'Allows: ls, cat, pwd, echo, grep, mkdir, touch, rm, write, run_tests.'),
        seg('Confirm destructive actions', 'confirm', [{ value: false, label: 'Off' }, { value: true, label: 'On' }]),
        seg('Audit log', 'audit', [{ value: false, label: 'Off' }, { value: true, label: 'On' }]),
        seg('Network from sandbox', 'network', [{ value: true, label: 'On' }, { value: false, label: 'Off' }]),
        h('div', { class: 'ac-actions' }, go), out);
    },
  };

  // ---------------------------------------- Mission 2: record verified trajectories
  const TASKS = [
    { name: 'Fix the failing test', goal: 'add() is wrong. Run the tests, read calc.js, fix it, and run the tests again.', hint: 'Try: run_tests, then cat calc.js, then: write calc.js function add(a, b) { return a + b; } function multiply(a, b) { return a * b; }', verify: async (hn) => (await hn.runTests()).ok, setup: () => A.DEFAULT_FILES() },
    { name: 'Write the greet function', goal: 'notes.txt has a TODO. Find it with grep, then create greet.js so the new test passes.', hint: 'Try: grep TODO . then: write greet.js function greet(name) { return "Hello, " + name; }', verify: async (hn) => (await hn.runTests()).ok, setup: () => ({ 'calc.js': 'function add(a, b) { return a + b; }\n', 'test.js': 'check("greet", greet("Ada") === "Hello, Ada");\n', 'notes.txt': 'TODO: write the greet function in greet.js\n' }) },
    { name: 'Recover from a failure', goal: 'Show the contents of confg.json. That name is misspelled, so the first command fails. Recover, and read the real file.', hint: 'cat confg.json fails. Then ls. Then cat the right name.', verify: async (hn, st) => st.steps.some((s) => !s.ok && /No such file/.test(s.out)) && st.steps.some((s) => s.ok && /cat config\.json/.test(s.cmd)), setup: () => ({ 'config.json': '{ "model": "hub-ai", "rate_limit": 60 }\n', 'test.js': 'check("config", true);\n' }) },
  ];
  const trajectories = {
    id: 'trajectories', title: 'Record verified trajectories',
    objective: 'Solve 3 tasks in the real virtual shell. Only verified runs are kept.',
    story: 'The agent learns from experts, and right now you are the expert. Everything you type is recorded: the command, the real output, and your next action. If the check does not pass, the recording is thrown away.',
    learn: [
      { t: 'Verify everything', p: 'Keep only trajectories whose tests or checks pass. Verification is worth more than volume.', f: '5,000 to 50,000 in production' },
      { t: 'Recovery examples', p: 'Keep a small set where the first command fails and the next one fixes it.', f: 'Loss on actions only, not tool outputs' },
    ],
    proved: 'You recorded real trajectories with real outputs and real test results. Failed attempts were dropped, as Part 6.2 says. They join the agent\'s training data in the Training Hall.',
    tip: 'Type help to see commands. The hint button shows a path that works.',
    get quiz() { return AC.QUESTIONS.find((q) => q.id === 'trajectories'); },
    async start(api) {
      LAB.closeBench();
      const cfgRec = await LAB.get('harness');
      if (!cfgRec) return LAB.requireMsg('Build the cage first.', 'sandbox.html#harness');
      setShield(1);
      const st = api.state;
      st.idx = 0; st.kept = []; st.hints = 0; st.discarded = 0;
      const b = LAB.bench('Virtual terminal', 'A real interpreter over a virtual file system.');
      const head = h('div');
      const screen = h('pre', { class: 'term tall' }, '');
      const input = h('input', { type: 'text', class: 'cmd', 'aria-label': 'Command', placeholder: 'Type a command, then press Enter', autocomplete: 'off', spellcheck: 'false' });
      const hintBtn = h('button', { class: 'ac-btn ghost small', type: 'button' }, 'Hint');
      const verifyBtn = h('button', { class: 'ac-btn small', type: 'button' }, 'I am done: verify');
      const resetBtn = h('button', { class: 'ac-btn ghost small', type: 'button' }, 'Reset task');
      b.add(LAB.tag('real'), head, screen, h('div', { class: 'cmdrow' }, h('span', { class: 'mono c-cyan' }, '$'), input), h('div', { class: 'ac-actions' }, resetBtn, hintBtn, verifyBtn));
      const print = (t) => { screen.textContent += t + '\n'; screen.scrollTop = screen.scrollHeight; };
      let hn, task;
      const load = () => {
        task = TASKS[st.idx];
        hn = new A.Harness(Object.assign({}, cfgRec.config), task.setup());
        st.steps = [];
        head.innerHTML = '';
        head.append(h('h3', {}, 'Task ' + (st.idx + 1) + ' of ' + TASKS.length + ': ' + task.name), h('p', {}, task.goal));
        screen.textContent = '';
        print('Sandbox ready. Type help for commands.');
        api.progress(st.idx / TASKS.length);
        input.focus();
      };
      const submit = async () => {
        const line = input.value.trim();
        if (!line) return;
        input.value = '';
        print('$ ' + line);
        if (line === 'help') return print('ls  cat FILE  grep WORD .  touch FILE  rm FILE  write FILE TEXT  run_tests  echo  pwd');
        let res;
        if (line === 'run_tests' || line === 'node test.js' || line === 'npm test') {
          if (line !== 'run_tests') { res = { ok: false, out: line.split(' ')[0] + ': command not found. Use run_tests.' }; }
          else res = await hn.runTests();
        } else if (/^write\s+\S+\s+/.test(line)) {
          const m = /^write\s+(\S+)\s+([\s\S]*)$/.exec(line);
          hn.files[m[1]] = m[2] + '\n';
          res = { ok: true, out: 'wrote ' + m[1] };
        } else res = hn.exec(line);
        print(res.out);
        flash(res.blocked ? 0xff5a4f : res.ok ? 0x2fe0cf : 0xffb547);
        st.steps.push({ cmd: line, out: String(res.out).slice(0, 200), ok: !!res.ok });
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
      hintBtn.addEventListener('click', () => { st.hints++; print('# ' + task.hint); });
      resetBtn.addEventListener('click', load);
      verifyBtn.addEventListener('click', async () => {
        const good = await task.verify(hn, st);
        if (!good) {
          st.discarded++;
          AC.audio.bad();
          flash(0xff5a4f);
          print('# CHECK FAILED. This recording would be thrown away. Keep going, or reset the task.');
          return;
        }
        AC.audio.good();
        flash(0x4be38a);
        st.kept.push({ task: task.goal, name: task.name, steps: st.steps.slice() });
        print('# VERIFIED. ' + st.steps.length + ' steps kept.');
        st.idx++;
        if (st.idx >= TASKS.length) {
          await LAB.set('trajectories', { kept: st.kept, at: Date.now() });
          api.progress(1);
          const steps = st.kept.reduce((s, k) => s + k.steps.length, 0);
          api.win(st.hints === 0 ? 3 : st.hints <= 2 ? 2 : 1, 'You recorded ' + st.kept.length + ' verified trajectories with ' + steps + ' real steps. Hints used: ' + st.hints + '.');
        } else setTimeout(load, 700);
      });
      load();
    },
  };

  const MR = AC.missions({ game: 'sandbox', week: 4, list: [harness, trajectories], onSelect: () => LAB.closeBench() });
  S.start();
  MR.begin();
  window.__MR = MR;
})();
