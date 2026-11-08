/* Optional real open models running in the browser through Transformers.js. Nothing downloads unless the user presses a button. */
(function () {
  'use strict';
  const h = AC.h;
  const CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.5';
  const S = (window.STRONG = {});
  const MODELS = {
    chat: { id: 'HuggingFaceTB/SmolLM2-135M-Instruct', size: 'about 100 MB', name: 'SmolLM2 135M (Apache-2.0): small general model', dtype: 'q4' },
    chatBig: { id: 'onnx-community/Qwen2.5-0.5B-Instruct', size: 'about 300 MB', name: 'Qwen2.5 0.5B: stronger, and needs more memory', dtype: 'q4' },
    stt: { id: 'Xenova/whisper-tiny.en', size: 'about 40 MB', name: 'Whisper tiny.en (Apache-2.0): real speech to text' },
  };
  const state = { chat: null, stt: null, loading: null };
  let lib = null;
  const load = async () => { if (!lib) lib = await import(CDN); return lib; };
  S.ready = () => !!state.chat;
  S.hasWhisper = () => !!state.stt;
  S.device = () => (navigator.gpu ? 'webgpu' : 'wasm');
  S.install = async function (kind, onProgress) {
    const m = MODELS[kind];
    const T = await load();
    const progress_callback = (p) => { if (p.status === 'progress' && onProgress) onProgress(Math.round(p.progress || 0), p.file); };
    if (kind === 'stt') { state.stt = await T.pipeline('automatic-speech-recognition', m.id, { progress_callback }); return; }
    let device = S.device();
    try { state.chat = await T.pipeline('text-generation', m.id, { dtype: m.dtype, device, progress_callback }); }
    catch (e) { device = 'wasm'; state.chat = await T.pipeline('text-generation', m.id, { dtype: m.dtype, device, progress_callback }); }
    state.chatName = m.name;
    state.device = device;
  };
  S.chat = async function (q, id, context, onPartial) {
    const T = await load();
    const system = 'You are ' + id.name + ', a helpful assistant built by ' + id.maker + ' in ' + id.place + '. Be brief and honest. Say when you are unsure.' + (context ? ' Use this context: ' + context : '');
    const messages = [{ role: 'system', content: system }, { role: 'user', content: q }];
    let partial = '';
    const streamer = new T.TextStreamer(state.chat.tokenizer, { skip_prompt: true, skip_special_tokens: true, callback_function: (t) => { partial += t; onPartial && onPartial(partial); } });
    const out = await state.chat(messages, { max_new_tokens: 160, do_sample: false, streamer });
    const g = out[0].generated_text;
    return (Array.isArray(g) ? g[g.length - 1].content : String(g)).trim();
  };
  S.listen = async function (seconds) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new AudioContext({ sampleRate: 16000 });
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const chunks = [];
    proc.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    src.connect(proc);
    proc.connect(ctx.destination);
    await new Promise((r) => setTimeout(r, seconds * 1000));
    proc.disconnect(); src.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    await ctx.close();
    const n = chunks.reduce((a, c) => a + c.length, 0);
    const audio = new Float32Array(n);
    let o = 0;
    for (const c of chunks) { audio.set(c, o); o += c.length; }
    const r = await state.stt(audio);
    return (r.text || '').trim();
  };
  S.panel = function () {
    const box = h('div', { class: 'cand' });
    for (const k of ['chat', 'chatBig', 'stt']) {
      const m = MODELS[k];
      const status = h('span', { class: 'mono dim small' }, m.size + '. Not installed.');
      const b = h('button', { type: 'button', class: 'cand-b' }, h('b', {}, m.name), status);
      b.addEventListener('click', async () => {
        if (state.loading) return AC.ui.toast('Another download is running', 'var(--amber)');
        state.loading = k;
        b.disabled = true;
        status.textContent = 'Starting the download...';
        try {
          await S.install(k === 'chatBig' ? 'chatBig' : k, (p, f) => { status.textContent = 'Downloading: ' + p + '% of ' + (f || '').split('/').pop(); });
          status.textContent = 'Installed. ' + (k === 'stt' ? 'The Mic button now uses Whisper.' : 'Hard questions now route here, running on ' + (state.device || 'this device') + '.');
          status.className = 'mono c-green small';
          AC.audio.good();
        } catch (e) {
          status.textContent = 'Could not install: ' + e.message;
          status.className = 'mono c-red small';
          b.disabled = false;
        }
        state.loading = null;
      });
      box.appendChild(b);
    }
    return box;
  };
})();
