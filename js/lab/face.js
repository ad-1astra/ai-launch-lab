/* The robot face: a renderer, not a model (guide Part 6.5). It plays emotion events and lip-syncs to real TTS word timing.
   Idle animation, blinking, micro-movements and easing make it feel alive. */
(function () {
  'use strict';
  const FACE = (window.FACE = {});
  const POSES = {
    joy: { brow: 0.12, browTilt: 0.1, eye: 1.0, smile: 0.9, open: 0.15, color: 0x2fe0cf },
    neutral: { brow: 0, browTilt: 0, eye: 0.92, smile: 0.15, open: 0, color: 0x2fe0cf },
    thinking: { brow: 0.1, browTilt: -0.25, eye: 0.75, smile: -0.1, open: 0, color: 0x7aa2ff },
    confused: { brow: 0.05, browTilt: -0.45, eye: 0.85, smile: -0.25, open: 0.05, color: 0xffb547 },
    empathy: { brow: 0.06, browTilt: 0.45, eye: 0.7, smile: -0.2, open: 0, color: 0xb48cff },
    excited: { brow: 0.22, browTilt: 0.15, eye: 1.15, smile: 1, open: 0.4, color: 0x4be38a },
    concern: { brow: -0.08, browTilt: -0.35, eye: 0.8, smile: -0.55, open: 0, color: 0xff5a4f },
  };
  const GAZE = { user: [0, 0], away: [0.35, 0.05], down: [0, -0.28], up: [0.05, 0.3] };
  // letters to mouth shapes (visemes): open, round, closed
  function viseme(ch) {
    if ('aeiy'.includes(ch)) return { open: 0.75, wide: 1 };
    if ('ouw'.includes(ch)) return { open: 0.55, wide: 0.55 };
    if ('mbp'.includes(ch)) return { open: 0.02, wide: 0.85 };
    if ('fvtdsz'.includes(ch)) return { open: 0.18, wide: 0.95 };
    return { open: 0.32, wide: 0.9 };
  }

  FACE.create = function (scene, opts = {}) {
    const g = new THREE.Group();
    const std = (c, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.4, metalness: 0.35 }, o || {}));
    const shell = new THREE.Mesh(new THREE.BoxGeometry(4.2, 3.4, 2.8), std(0xe6edf5));
    shell.castShadow = true;
    const head = new THREE.Group();
    head.add(shell);
    const screen = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.7, 0.1), std(0x06101c, { roughness: 0.15 }));
    screen.position.z = 1.42;
    head.add(screen);
    const glowM = new THREE.MeshBasicMaterial({ color: 0x2fe0cf });
    const eyeGeo = new THREE.CircleGeometry(0.42, 28);
    const eyeL = new THREE.Mesh(eyeGeo, glowM), eyeR = new THREE.Mesh(eyeGeo, glowM);
    eyeL.position.set(-0.9, 0.35, 1.48); eyeR.position.set(0.9, 0.35, 1.48);
    head.add(eyeL, eyeR);
    const pupilM = new THREE.MeshBasicMaterial({ color: 0x06101c });
    const pGeo = new THREE.CircleGeometry(0.15, 18);
    const pupL = new THREE.Mesh(pGeo, pupilM), pupR = new THREE.Mesh(pGeo, pupilM);
    pupL.position.z = pupR.position.z = 1.5;
    head.add(pupL, pupR);
    const browGeo = new THREE.BoxGeometry(0.95, 0.12, 0.02);
    const browL = new THREE.Mesh(browGeo, glowM), browR = new THREE.Mesh(browGeo, glowM);
    browL.position.set(-0.9, 1.0, 1.48); browR.position.set(0.9, 1.0, 1.48);
    head.add(browL, browR);
    // mouth: a filled strip whose top and bottom edges are rebuilt every frame
    const SEG = 22;
    const mouthGeo = new THREE.BufferGeometry();
    const mpos = new Float32Array((SEG + 1) * 2 * 3);
    mouthGeo.setAttribute('position', new THREE.BufferAttribute(mpos, 3));
    const idx = [];
    for (let i = 0; i < SEG; i++) { const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, d = i * 2 + 3; idx.push(a, b, c, b, d, c); }
    mouthGeo.setIndex(idx);
    const mouth = new THREE.Mesh(mouthGeo, new THREE.MeshBasicMaterial({ color: 0x2fe0cf, side: THREE.DoubleSide }));
    mouth.position.set(0, -0.72, 1.48);
    mouth.frustumCulled = false;
    head.add(mouth);
    // antenna, ears, neck, shoulders
    const ant = new THREE.Group();
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.9), std(0x8fa4ba));
    stalk.position.y = 0.45;
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 12), glowM);
    tip.position.y = 1;
    ant.add(stalk, tip);
    ant.position.y = 1.7;
    head.add(ant);
    for (const sx of [-1, 1]) { const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.25, 20), std(0xb8c6d4)); ear.rotation.z = Math.PI / 2; ear.position.x = sx * 2.2; head.add(ear); }
    head.position.y = 3.4;
    g.add(head);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.65, 0.9, 16), std(0x7f93a8));
    neck.position.y = 1.3;
    g.add(neck);
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.8, 1.4, 2.6), std(0xcfd9e4));
    body.position.y = 0.3; body.castShadow = true;
    g.add(body);
    scene.add(g);

    const cfg = Object.assign({ blink: 3.5, micro: 1, ease: 7, idle: 1 }, opts);
    const cur = { brow: 0, browTilt: 0, eye: 1, smile: 0.1, open: 0, gx: 0, gy: 0, wide: 1 };
    const target = { brow: 0, browTilt: 0, eye: 0.92, smile: 0.15, open: 0, gx: 0, gy: 0, color: 0x2fe0cf, intensity: 0.5 };
    const color = new THREE.Color(0x2fe0cf), colorT = new THREE.Color(0x2fe0cf);
    let t = 0, nextBlink = 2, blinkT = -1, gesture = null, gestureT = 0, gestureDur = 1;
    let visemes = [], visT = 0, mouthOpen = 0, mouthWide = 1;
    let events = null;
    const api = {
      group: g, head, cfg,
      setEvents(e) {
        if (!e) return;
        events = e;
        const p = POSES[e.emotion] || POSES.neutral;
        const k = 0.5 + 0.5 * (e.intensity != null ? e.intensity : 0.5);
        target.brow = p.brow * k; target.browTilt = p.browTilt * k; target.eye = 1 + (p.eye - 1) * k; target.smile = p.smile * k; target.open = p.open * k;
        target.color = p.color;
        const gz = GAZE[e.gaze] || GAZE.user;
        target.gx = gz[0]; target.gy = gz[1];
        colorT.setHex(p.color);
        if (e.gesture && e.gesture !== 'none') { gesture = e.gesture; gestureT = 0; gestureDur = gesture === 'wave' ? 1.6 : 1.1; }
      },
      get events() { return events; },
      // plays mouth shapes for a word over a duration in seconds
      mouthWord(word, secs) {
        const letters = String(word).toLowerCase().replace(/[^a-z]/g, '');
        const n = Math.max(1, letters.length);
        visemes = Array.from(letters, (ch, i) => ({ at: visT + (i / n) * secs, v: viseme(ch) }));
        visemes.push({ at: visT + secs, v: { open: 0.05, wide: 1 } });
      },
      /* Speaks through the browser's real TTS, using word-boundary timing for the lips. Falls back to estimated timing if events do not fire. */
      speak(text, o = {}) {
        api.stop();
        const words = String(text).replace(/```[\s\S]*?```/g, ' code ').split(/\s+/).filter(Boolean);
        let usedBoundary = false, wi = 0, cancelled = false, timer = null;
        const started = performance.now();
        const fallback = () => {
          const step = () => {
            if (cancelled) return;
            if (wi >= words.length) { o.onEnd && o.onEnd(); return; }
            const w = words[wi++];
            const dur = Math.max(0.16, w.length * 0.065);
            api.mouthWord(w, dur);
            timer = setTimeout(step, dur * 1000);
          };
          o.onStart && o.onStart(performance.now() - started, 'estimated');
          step();
        };
        api._cancel = () => { cancelled = true; if (timer) clearTimeout(timer); };
        if (typeof speechSynthesis === 'undefined' || o.silent || !window.SpeechSynthesisUtterance) { fallback(); return; }
        const u = new SpeechSynthesisUtterance(String(text).replace(/```[\s\S]*?```/g, 'Here is the code.').slice(0, 400));
        const vs = speechSynthesis.getVoices();
        if (o.voice) { const v = vs.find((x) => x.name === o.voice); if (v) u.voice = v; }
        const style = events && events.speak_style;
        u.rate = style === 'bright' ? 1.08 : style === 'soft' ? 0.92 : style === 'serious' ? 0.96 : 1;
        u.pitch = style === 'bright' ? 1.15 : style === 'soft' ? 0.95 : style === 'serious' ? 0.85 : 1;
        let gotStart = false;
        const guard = setTimeout(() => { if (!gotStart && !cancelled) { speechSynthesis.cancel(); fallback(); } }, 1500);
        u.onstart = () => { gotStart = true; clearTimeout(guard); o.onStart && o.onStart(performance.now() - started, 'tts'); timer = setTimeout(() => { if (!usedBoundary && !cancelled) fallback(); }, 500); };
        u.onboundary = (e) => {
          if (e.name && e.name !== 'word') return;
          usedBoundary = true;
          if (timer) { clearTimeout(timer); timer = null; }
          const w = String(u.text).slice(e.charIndex, e.charIndex + (e.charLength || 6)).split(/\s/)[0];
          api.mouthWord(w, Math.max(0.14, w.length * 0.06));
        };
        u.onend = () => { if (!usedBoundary) { /* fallback timer handles the mouth */ } if (usedBoundary) o.onEnd && o.onEnd(); };
        u.onerror = () => { clearTimeout(guard); if (!cancelled && !usedBoundary) fallback(); };
        speechSynthesis.speak(u);
      },
      stop() {
        if (api._cancel) api._cancel();
        if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
        visemes = [];
      },
      update(dt) {
        t += dt;
        const k = 1 - Math.exp(-cfg.ease * dt);
        for (const key of ['brow', 'browTilt', 'eye', 'smile', 'open', 'gx', 'gy']) cur[key] += (target[key] - cur[key]) * k;
        color.lerp(colorT, k);
        glowM.color.copy(color);
        mouth.material.color.copy(color);
        // blink
        let lid = 1;
        if (cfg.blink > 0) {
          nextBlink -= dt;
          if (nextBlink <= 0) { blinkT = 0; nextBlink = cfg.blink * (0.5 + Math.random()); }
          if (blinkT >= 0) { blinkT += dt; const b = blinkT / 0.16; if (b >= 1) blinkT = -1; else lid = Math.abs(1 - 2 * b); }
        }
        const eyeY = Math.max(0.06, cur.eye * lid);
        eyeL.scale.set(1, eyeY, 1); eyeR.scale.set(1, eyeY, 1);
        const px = cur.gx * 0.55, py = cur.gy * 0.55 * lid;
        pupL.position.x = eyeL.position.x + px; pupR.position.x = eyeR.position.x + px;
        pupL.position.y = pupR.position.y = eyeL.position.y + py;
        pupL.visible = pupR.visible = lid > 0.3;
        browL.position.y = browR.position.y = 1.02 + cur.brow;
        browL.rotation.z = cur.browTilt; browR.rotation.z = -cur.browTilt;
        // visemes from word timing
        visT += dt;
        while (visemes.length && visemes[0].at <= visT) { const x = visemes.shift(); mouthOpen = x.v.open; mouthWide = x.v.wide; }
        if (!visemes.length) mouthOpen = Math.max(0, mouthOpen - dt * 4);
        cur.wide += (mouthWide - cur.wide) * (1 - Math.exp(-22 * dt));
        const open = cur.open * 0.5 + mouthOpen;
        const W = 0.95 * cur.wide;
        for (let i = 0; i <= SEG; i++) {
          const u = i / SEG, x = (u - 0.5) * 2;
          const curve = cur.smile * (x * x - 0.35) * 0.32;
          const yy = curve;
          const thick = 0.045 + open * 0.42 * (1 - x * x);
          mpos[i * 6] = x * W; mpos[i * 6 + 1] = yy + thick; mpos[i * 6 + 2] = 0;
          mpos[i * 6 + 3] = x * W; mpos[i * 6 + 4] = yy - thick; mpos[i * 6 + 5] = 0;
        }
        mouthGeo.attributes.position.needsUpdate = true;
        // gestures, idle sway and micro-movements
        let rx = 0, ry = 0, rz = 0, dy = 0;
        if (gesture) {
          gestureT += dt;
          const x = gestureT / gestureDur, env = Math.sin(Math.min(1, x) * Math.PI);
          if (gesture === 'nod') rx = Math.sin(x * Math.PI * 5) * 0.16 * env;
          if (gesture === 'shake') ry = Math.sin(x * Math.PI * 6) * 0.22 * env;
          if (gesture === 'tilt') rz = 0.22 * env;
          if (gesture === 'wave') { rz = Math.sin(x * Math.PI * 5) * 0.12 * env; ant.rotation.z = Math.sin(x * Math.PI * 9) * 0.6 * env; }
          if (gesture === 'shrug') { dy = 0.22 * env; rz = 0.08 * env; }
          if (x >= 1) { gesture = null; ant.rotation.z = 0; }
        }
        const idle = cfg.idle, m = cfg.micro;
        rx += Math.sin(t * 0.7) * 0.025 * idle + Math.sin(t * 2.3 + 1) * 0.008 * m;
        ry += Math.sin(t * 0.43) * 0.05 * idle + Math.sin(t * 1.9) * 0.012 * m + cur.gx * 0.2;
        rz += Math.sin(t * 0.31 + 2) * 0.018 * idle + Math.sin(t * 2.9) * 0.006 * m;
        rx -= cur.gy * 0.2;
        head.rotation.set(rx, ry, rz);
        head.position.y = 3.4 + dy + Math.sin(t * 1.4) * 0.03 * idle;
        tip.scale.setScalar(1 + Math.sin(t * 3) * 0.12 * idle);
      },
    };
    return api;
  };
})();
