/* The campus: walk a small robot between the 8 buildings of the 12-week roadmap. */
(function () {
  'use strict';
  const h = AC.h, W = LAB.world, Z = LAB.ZONES;
  if (AC.isTouch) document.body.classList.add('touch');
  const root = AC.root();

  // -------------- left panel
  const left = h('div', { class: 'panel-left' });
  root.appendChild(left);
  const pr = LAB.progress();
  const first = Z.findIndex((z) => !LAB.zoneDone(z));
  const brand = h('div', { class: 'brand ac-panel' }, h('h1', {}, 'AI Launch Lab'), h('p', {}, 'Make a working AI from raw data to launch, in 12 simulated weeks. The training is real and happens on your device.'));
  const ready = h('div', { class: 'readiness' }, h('div', { class: 'mono small', id: 'readyTxt' }, pr.done + ' of ' + pr.total + ' steps done · ' + AC.pilot().name), h('div', { class: 'bar' }, h('i', { style: { width: pr.frac * 100 + '%' } })));
  brand.appendChild(ready);
  left.appendChild(brand);
  const list = h('div', { class: 'zones ac-panel' });
  left.appendChild(list);
  Z.forEach((z, i) => {
    const unlocked = LAB.zoneUnlocked(i);
    const stars = z.missions.reduce((s, m) => s + AC.starsFor(z.id, m), 0);
    const max = z.missions.length * 3;
    const b = h(unlocked ? 'a' : 'button', Object.assign({ class: 'zone-b' + (unlocked ? '' : ' locked') + (i === first ? ' next' : '') }, unlocked ? { href: z.url } : { type: 'button', 'aria-disabled': 'true', title: 'Finish the zone before this one' }),
      h('span', { class: 'num' }, String(i + 1)),
      h('span', {}, h('b', {}, z.name), h('small', {}, 'Weeks ' + z.weeks + ' · ' + z.parts)),
      h('span', { class: 'st' }, unlocked ? (stars ? stars + '/' + max + ' ★' : i === first ? 'Next' : '') : 'Locked'));
    list.appendChild(b);
  });
  const row = h('div', { class: 'hub-row' });
  const cont = first >= 0 ? h('a', { class: 'ac-btn', href: Z[first].url }, first === 0 && !pr.done ? 'Start building' : 'Continue') : h('a', { class: 'ac-btn green', href: 'app.html' }, 'Open my AI');
  row.append(cont);
  left.appendChild(row);
  const row2 = h('div', { class: 'hub-row' }, h('a', { class: 'ac-btn ghost small', href: 'app.html' }, 'My AI'), h('a', { class: 'ac-btn ghost small', href: 'arena.html#all' }, 'Test arena'), h('a', { class: 'ac-btn ghost small', href: 'teacher.html' }, 'Teacher'));
  const playerBtn = h('button', { class: 'ac-btn ghost small', type: 'button', onclick: () => players() }, 'Player');
  row2.appendChild(playerBtn);
  left.appendChild(row2);

  function players() {
    const wrap = h('div', { class: 'cand' });
    AC.data.pilots.forEach((p, i) => {
      const b = h('button', { type: 'button', class: 'cand-b' + (i === (AC.data.cur | 0) ? ' right' : '') }, h('b', {}, p.name), h('span', { class: 'dim mono' }, p.xp + ' XP. Each player has their own AI on this device.'));
      b.addEventListener('click', () => { AC.data.cur = i; AC.save(); location.reload(); });
      wrap.appendChild(b);
    });
    const name = h('input', { type: 'text', placeholder: 'New player name', maxlength: 20, 'aria-label': 'New player name' });
    AC.ui.card({ eyebrow: 'Players on this device', title: 'Who is building?', body: [wrap, name], buttons: [{ label: 'Close', ghost: true }, { label: 'Add player', onclick: () => { if (name.value.trim()) { AC.data.pilots.push(AC.blankPilot(name.value.trim())); AC.data.cur = AC.data.pilots.length - 1; AC.save(); location.reload(); } } }] });
  }

  // -------------- first-time welcome
  if (!pr.done && !AC.data.seenWelcome) {
    AC.data.seenWelcome = true;
    AC.save();
    setTimeout(() => AC.ui.card({ eyebrow: 'Welcome', title: 'You are going to build a real AI', body: [
      'This is not a quiz. You will clean real data, fine-tune real weights on your own computer, test the result, and launch an AI you can talk to and download.',
      AC.ui.learnGrid([
        { t: 'REAL means real', p: 'Green REAL tags mark work that truly runs on your device: cleaning, training, testing, serving.' },
        { t: 'SIMULATED is labelled', p: 'A browser cannot rent a GPU cluster. Amber SIMULATED tags mark those steps, using numbers from your guide.' },
        { t: 'It will be small', p: 'Your model is tiny, so it will be strong only on what it learned. That honest limit is part of the lesson.' },
      ]),
      'A full run takes a few hours. Your progress saves on this device.',
    ], buttons: [{ label: 'Let us build' }] }), 300);
  }

  // -------------- 3D campus
  const S = AC.scene({ fov: 48, background: 0x07111f, shadows: true });
  S.scene.fog = new THREE.Fog(0x07111f, 50, 130);
  AC.lights(S.scene, { shadows: true, sun: 0.85, hemi: 0.65, sky: 0xbcd7ff, ground: 0x1a2c22, dir: [30, 44, 20], shadowSize: 50 });
  AC.starfield(S.scene, 900, 300, 1.4);
  const grass = AC.canvasTex(256, 256, (g, w, hh) => {
    g.fillStyle = '#10261f'; g.fillRect(0, 0, w, hh);
    for (let i = 0; i < 700; i++) { g.fillStyle = 'rgba(' + (30 + Math.random() * 30) + ',' + (70 + Math.random() * 40) + ',' + (50 + Math.random() * 20) + ',0.5)'; g.fillRect(Math.random() * w, Math.random() * hh, 2, 2); }
  }, [40, 40]);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(120, 64), new THREE.MeshStandardMaterial({ map: grass, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  S.scene.add(ground);
  // ring road
  const road = new THREE.Mesh(new THREE.RingGeometry(21, 26, 96), new THREE.MeshStandardMaterial({ color: 0x25313f, roughness: 0.95 }));
  road.rotation.x = -Math.PI / 2; road.position.y = 0.02; road.receiveShadow = true;
  S.scene.add(road);
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const dash = W.box(1.5, 0.02, 0.2, new THREE.MeshBasicMaterial({ color: 0xc9d5e2 }), Math.sin(a) * 23.5, 0.04, Math.cos(a) * 23.5);
    dash.rotation.y = a + Math.PI / 2; dash.castShadow = false;
    S.scene.add(dash);
  }
  // Central robot statue: your AI, growing as you finish zones
  const statue = W.robot(0x2fe0cf);
  statue.scale.setScalar(2 + pr.frac * 3);
  S.scene.add(statue);
  const plinth = W.cyl(4, 0.8, W.std(0x24405f), 0, 0.4, 0, 32);
  S.scene.add(plinth);
  statue.position.y = 0.8;
  LAB.identity().then((id) => {
    const s = W.sign(id.name, { pos: [0, 9 + pr.frac * 8, 0], size: 1.1, color: '#2fe0cf' });
    S.scene.add(s);
  });

  const blds = [];
  Z.forEach((z, i) => {
    const a = (i / Z.length) * Math.PI * 2 + 0.2;
    const r = 37;
    const g = new THREE.Group();
    const unlocked = LAB.zoneUnlocked(i), done = LAB.zoneDone(z);
    const col = unlocked ? z.color : 0x2d3a4a;
    const wMat = W.std(unlocked ? 0x1b2e47 : 0x141c27);
    const shape = i % 4;
    const hh = 9 + (i % 3) * 3;
    g.add(W.box(11, hh, 10, wMat, 0, hh / 2, 0));
    g.add(W.box(11.2, 0.5, 10.2, W.glow(col, unlocked ? 0.9 : 0.15), 0, hh + 0.2, 0));
    const door = W.box(3.6, 4.6, 0.3, W.glow(col, unlocked ? 0.8 : 0.1), 0, 2.3, 5.05);
    g.add(door);
    for (let w = 0; w < 3; w++) for (let f = 0; f < Math.floor(hh / 3); f++) g.add(W.box(1.4, 1, 0.1, W.glow(col, unlocked ? 0.25 + Math.random() * 0.4 : 0.03), -3.4 + w * 3.4, 5.6 + f * 2.6, 5.05));
    if (shape === 1) g.add(W.cyl(3, 3, W.std(0x24405f), 0, hh + 1.7, 0, 24));
    if (shape === 2) { const c = new THREE.Mesh(new THREE.ConeGeometry(5.5, 4, 4), W.std(0x24405f)); c.position.y = hh + 2.4; c.rotation.y = Math.PI / 4; c.castShadow = true; g.add(c); }
    g.add(W.sign((i + 1) + '. ' + z.name, { pos: [0, hh + (shape ? 5.8 : 2.2), 0], size: 1.3, color: unlocked ? '#e9f0f7' : '#6d7d90' }));
    if (done) g.add(W.sign('✓', { pos: [0, hh + (shape ? 7.6 : 4), 0], size: 1.3, color: '#4be38a', bg: null }));
    g.position.set(Math.sin(a) * r, 0, Math.cos(a) * r);
    g.rotation.y = a + Math.PI;
    S.scene.add(g);
    const doorPos = new THREE.Vector3(Math.sin(a) * (r - 7), 0, Math.cos(a) * (r - 7));
    blds.push({ z, i, g, doorPos, unlocked, door });
  });

  // -------------- avatar
  const bot = W.robot(0xff8a3d);
  const startAt = first >= 0 ? blds[first].doorPos : blds[0].doorPos;
  bot.position.set(startAt.x * 0.65, 0, startAt.z * 0.65);
  S.scene.add(bot);
  let yaw = Math.atan2(startAt.x, startAt.z);
  let tgt = null;
  const stick = AC.touch.stick('r', 'WALK');
  const cam = S.camera;
  let camYaw = yaw + Math.PI;
  const camPos = new THREE.Vector3();
  const clicks = W.clicks(S);
  blds.forEach((b) => clicks.add(b.g, () => { tgt = b.doorPos.clone(); }));
  // drag rotates the view
  let dragging = false, lastX = 0;
  const dom = S.renderer.domElement;
  dom.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; });
  window.addEventListener('pointerup', () => (dragging = false));
  window.addEventListener('pointermove', (e) => { if (dragging) { camYaw -= (e.clientX - lastX) * 0.006; lastX = e.clientX; } });

  const enter = h('div', { class: 'enter-card ac-panel', style: { display: 'none' } });
  root.appendChild(enter);
  const hint = h('div', { class: 'hub-hint' }, h('span', { html: AC.isTouch ? 'Use the stick to walk, or tap a building.' : '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> to walk. Click a building to go there. <kbd>E</kbd> to enter. Drag to look.' }));
  root.appendChild(hint);
  let near = null;
  const showEnter = (b) => {
    enter.innerHTML = '';
    if (!b) { enter.style.display = 'none'; return; }
    enter.style.display = '';
    enter.append(h('h3', {}, b.z.name), h('p', {}, b.z.blurb), b.unlocked ? h('a', { class: 'ac-btn', href: b.z.url }, 'Enter (E)') : h('p', { class: 'c-amber small' }, 'Locked. Finish ' + Z[b.i - 1].name + ' first.'));
  };
  AC.onKey('KeyE', () => { if (near && near.unlocked) location.href = near.z.url; });
  AC.onKey('Enter', () => { if (near && near.unlocked) location.href = near.z.url; });

  S.onFrame((dt, t, real) => {
    const ix = AC.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight'], stick.x);
    const iz = AC.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp'], stick.y);
    let mx = 0, mz = 0, moving = false;
    if (Math.abs(ix) > 0.05 || Math.abs(iz) > 0.05) {
      tgt = null;
      const sin = Math.sin(camYaw), cos = Math.cos(camYaw);
      mx = -iz * sin + ix * cos; mz = -iz * cos - ix * sin;
      const l = Math.hypot(mx, mz); if (l > 1) { mx /= l; mz /= l; }
      moving = true;
    } else if (tgt) {
      const dx = tgt.x - bot.position.x, dz = tgt.z - bot.position.z, d = Math.hypot(dx, dz);
      if (d < 0.5) tgt = null;
      else { mx = dx / d; mz = dz / d; moving = true; }
    }
    if (moving) {
      const sp = 13;
      bot.position.x += mx * sp * real; bot.position.z += mz * sp * real;
      yaw = Math.atan2(mx, mz);
      const rad = Math.hypot(bot.position.x, bot.position.z);
      if (rad > 48) { bot.position.x *= 48 / rad; bot.position.z *= 48 / rad; }
      if (rad < 5.2) { bot.position.x *= 5.2 / rad; bot.position.z *= 5.2 / rad; }
    }
    bot.rotation.y = AC.damp(bot.rotation.y, yaw, 12, real);
    bot.walk(t, moving ? 1 : 0.05);
    camPos.set(bot.position.x + Math.sin(camYaw) * 17, 12, bot.position.z + Math.cos(camYaw) * 17);
    if (Math.hypot(camPos.x, camPos.z) < 8) { const k = 8 / Math.hypot(camPos.x, camPos.z); camPos.x *= k; camPos.z *= k; }
    cam.position.lerp(camPos, 1 - Math.exp(-5 * real));
    cam.lookAt(bot.position.x, 2.5, bot.position.z);
    statue.head.rotation.y = Math.sin(t * 0.5) * 0.5;
    // proximity
    let best = null, bd = 9;
    for (const b of blds) {
      const d = Math.hypot(b.doorPos.x - bot.position.x, b.doorPos.z - bot.position.z);
      if (d < bd) { bd = d; best = b; }
      if (b.unlocked) b.door.material.emissiveIntensity = 0.6 + 0.4 * Math.sin(t * 2.5 + b.i);
    }
    if (best !== near) { near = best; showEnter(near); }
  });
  cam.position.set(bot.position.x + Math.sin(camYaw) * 17, 12, bot.position.z + Math.cos(camYaw) * 17);
  S.start();
})();
