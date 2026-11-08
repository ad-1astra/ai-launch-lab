/* Runs inside the exported single-file app: the player's model in a Blob worker, plus the face and browser speech. */
(function () {
  'use strict';
  const D = window.HUB_DATA;
  const fromB64 = (s) => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u.buffer; };
  const workerSrc = document.getElementById('engine-src').textContent + '\n' + document.getElementById('brain-src').textContent + `
;(function(){
  var ML=self.ML,B=self.BRAIN,brain=null;
  function unpack(u8,count,bits,scale){var out=new Float32Array(count),acc=0,have=0,o=0,mask=(1<<bits)-1,sign=1<<(bits-1);for(var i=0;i<count;i++){while(have<bits){acc|=u8[o++]<<have;have+=8}var v=acc&mask;acc>>>=bits;have-=bits;if(v&sign)v-=1<<bits;out[i]=v*scale}return out}
  self.onmessage=function(e){var m=e.data;try{
    if(m.type==='init'){
      var dv=new DataView(m.base),n=Number(dv.getBigUint64(0,true)),hdr=JSON.parse(new TextDecoder().decode(new Uint8Array(m.base,8,n))),meta=hdr.__metadata__,w={};
      var cfg={V:+meta.V,d:+meta.d,L:+meta.L,H:+meta.H,ctx:+meta.ctx,m:+meta.m};
      var scales=meta.scales?JSON.parse(meta.scales):null,lens=meta.lengths?JSON.parse(meta.lengths):null;
      for(var k in hdr){if(k==='__metadata__')continue;var o=hdr[k].data_offsets,raw=m.base.slice(8+n+o[0],8+n+o[1]);w[k]=meta.format==='quantised'?unpack(new Uint8Array(raw),lens[k],+meta.bits,scales[k]):new Float32Array(raw)}
      var adapters={};if(m.chat)adapters.chat=ML.parseAdapter(m.chat);
      var matcher=new ML.Matcher(m.config.questions||[]);matcher.add(m.config.extraQuestions||[],'adapter');
      brain=new B.Brain({net:new ML.GPT(cfg,w),tok:new ML.Tokenizer(m.tok),adapters:adapters,identity:m.config.identity,rules:m.config.rules,conf:m.config.conf,modelName:m.config.model,matcher:matcher});
      (m.docs||[]).forEach(function(d){brain.addDoc(d.title,d.text,d.source)});
      self.postMessage({id:m.id,result:true});
    } else if(m.type==='chat'){self.postMessage({id:m.id,result:brain.respond(m.req)})}
  }catch(err){self.postMessage({id:m.id,error:err.message})}};
})();`;
  const worker = new Worker(URL.createObjectURL(new Blob([workerSrc], { type: 'text/javascript' })));
  let nid = 1;
  const wait = new Map();
  worker.onmessage = (e) => { const w = wait.get(e.data.id); if (!w) return; wait.delete(e.data.id); e.data.error ? w.rej(new Error(e.data.error)) : w.res(e.data.result); };
  const rpc = (m, t) => new Promise((res, rej) => { const id = nid++; wait.set(id, { res, rej }); worker.postMessage(Object.assign({ id }, m), t || []); });

  // face
  const host = document.getElementById('stage');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07111f);
  scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x223344, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 0.8);
  sun.position.set(4, 10, 8);
  scene.add(sun);
  const cam = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  cam.position.set(0, 3.2, 12);
  cam.lookAt(0, 2.8, 0);
  const face = FACE.create(scene, D.faceCfg && D.faceCfg.blink ? D.faceCfg : {});
  const size = () => { const w = host.clientWidth, h = host.clientHeight; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); };
  addEventListener('resize', size);
  size();
  let last = performance.now();
  (function loop(t) { requestAnimationFrame(loop); const dt = Math.min(0.1, (t - last) / 1000 || 0); last = t; face.update(dt); renderer.render(scene, cam); })(last);

  // chat
  const log = document.getElementById('log');
  const form = document.getElementById('f');
  const input = document.getElementById('i');
  const snd = document.getElementById('snd');
  let voice = true;
  snd.addEventListener('click', () => { voice = !voice; snd.textContent = voice ? 'Voice on' : 'Voice off'; snd.setAttribute('aria-pressed', String(voice)); if (!voice) face.stop(); });
  const add = (cls, text, meta) => {
    const d = document.createElement('div');
    d.className = 'm ' + cls;
    d.textContent = text;
    if (meta) { const s = document.createElement('div'); s.className = 'meta'; s.textContent = meta; d.appendChild(s); }
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    return d;
  };
  add('a', 'Loading...');
  rpc({ type: 'init', base: fromB64(D.base), chat: D.chat ? fromB64(D.chat) : null, tok: D.tok, config: D.config, docs: D.docs }).then(() => {
    log.innerHTML = '';
    add('a', 'Hello! I am ' + D.config.identity.name + '. I run on this device. I am a small model, so I know what ' + D.config.identity.maker + ' trained me on, and I will tell you when I do not know.');
    face.setEvents({ emotion: 'joy', intensity: 0.7, gesture: 'wave', gaze: 'user', speak_style: 'bright' });
    input.focus();
  }).catch((e) => { log.innerHTML = ''; add('a', 'Could not load the model: ' + e.message); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    input.value = '';
    add('u', q);
    const r = await rpc({ type: 'chat', req: { messages: [{ role: 'user', content: q }] } });
    const ev = r.events || { emotion: 'neutral', intensity: 0.5, gesture: 'none', gaze: 'user', speak_style: 'calm' };
    add('a', r.text, r.route + (r.tool ? ' · tool: ' + r.tool.name : '') + ' · ' + ev.emotion + ' · ' + Math.round(r.ms) + ' ms');
    face.setEvents(ev);
    face.speak(r.text, { silent: !voice });
  });
})();
