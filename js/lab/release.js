/* Builds the real release: quantised weights, adapters, tokenizer, data, cards, a Node server, an offline single-file app and real-GPU scripts. */
(function () {
  'use strict';
  const R = (window.RELEASE = {});

  // ------------------------------------------------- zip (store only, no dependencies)
  const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = crcTable[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const enc = new TextEncoder();
  R.zip = function (files) {
    const parts = [], central = [];
    let offset = 0;
    const d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (const [name, content] of files) {
      const data = typeof content === 'string' ? enc.encode(content) : content instanceof ArrayBuffer ? new Uint8Array(content) : content;
      const nm = enc.encode(name), crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint16(10, time, true); h.setUint16(12, date, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nm.length, true);
      parts.push(new Uint8Array(h.buffer), nm, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), nm);
      offset += 30 + nm.length + data.length;
    }
    const cdSize = central.reduce((s, a) => s + a.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(e.buffer)], { type: 'application/zip' });
  };

  // ------------------------------------------------- quantised weight file
  R.writeQuantised = function (net, bits) {
    if (bits >= 32) return ML.writeSafetensors(net.w, Object.assign({ format: 'float32' }, net.cfg));
    const q = ML.quantize(net, bits);
    const t = {}, scales = {};
    for (const k in q.stored) { t[k] = packBits(q.stored[k].q, bits); scales[k] = q.stored[k].scale; lengths[k] = q.stored[k].q.length; }
    const meta = Object.assign({ format: 'quantised', bits, scales: JSON.stringify(scales), lengths: JSON.stringify(lengths) }, net.cfg);
    return ML.writeSafetensors(t, meta);
  };
  const lengths = {};
  function packBits(int8, bits) {
    if (bits === 8) return new Uint8Array(int8.buffer.slice(int8.byteOffset, int8.byteOffset + int8.byteLength));
    const out = new Uint8Array(Math.ceil((int8.length * bits) / 8));
    let acc = 0, n = 0, o = 0;
    const mask = (1 << bits) - 1;
    for (let i = 0; i < int8.length; i++) {
      acc |= (int8[i] & mask) << n;
      n += bits;
      while (n >= 8) { out[o++] = acc & 255; acc >>>= 8; n -= 8; }
    }
    if (n > 0) out[o] = acc & 255;
    return out;
  }

  // ------------------------------------------------- text files
  const csvCell = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  R.provenanceCSV = (prov) => ['source,url,licence,date,version,consent,personal_data,share_alike,decision,reason'].concat(prov.sources.map((s) => [s.name, s.url, s.licence, s.date, s.version, s.consent, s.pii, s.shareAlike ? 'yes' : 'no', s.decision, s.why].map(csvCell).join(','))).join('\n') + '\n';
  const jsonl = (rows) => rows.map((r) => JSON.stringify({ messages: r.messages.map((m) => { const o = { role: m.role, content: m.content || '' }; if (m.tool_call) o.tool_calls = [{ type: 'function', function: { name: m.tool_call.name, arguments: JSON.stringify(m.tool_call.args) } }]; if (m.events) o.events = m.events; return o; }), source: r.s })).join('\n') + '\n';

  R.modelCard = function (ctx) {
    const { id, spec, cards, artifact, training, evalSet, voice, vision, stackCfg, redteam, version } = ctx;
    const best = training.best || training.lora.ev;
    const catRows = Object.keys(best.cats).map((c) => '| ' + (EVALSET.CATEGORIES[c] || 'Golden prompts') + ' | ' + Math.round((evalSet.baseline.cats[c] || 0) * 100) + '% | ' + Math.round(best.cats[c] * 100) + '% |').join('\n');
    return `# ${id.name} ${version}

Built by ${id.maker} in ${id.place}. Made with AI Launch Lab, following "Building a Self-Hosted Multimodal AI Stack" (Process Guide v1.0).

## Intended use
${cards.intended}

## Not intended for
${cards.notFor}

## What this model actually is
- A tiny transformer: ${AC.fmt(LAB._netMain.paramCount())} parameters, ${LAB._netMain.cfg.L} layers, ${LAB._netMain.cfg.d} dimensions. It is about 10,000 times smaller than a real 8B model.
- It was fine-tuned for real, with LoRA adapters trained on your device. The adapter sits on the top 2 of 4 blocks.
- A question matcher (TF-IDF) finds the closest question it trained on, because a tiny model memorises rather than generalises.
- Multi-LoRA routing: known questions run on the pure base, and studied questions run on the adapter.
- Emotion events come from five small closed-choice heads on the model's final state, so the JSON is always valid. A real stack would use grammar-constrained decoding.
- It is strong only on what it was trained on. Outside that it says so, or answers from retrieval.
- Real-world target plan: ${spec.base.name} (${spec.base.lic}), to fine-tune with the scripts in \`real-gpu/\`.

## Training
| Setting | Value |
|---|---|
| Method | LoRA SFT, failure rounds, DPO; coder adapter with SFT and GRPO |
| Rank / alpha | ${training.lora.cfg.rank} / ${training.lora.alpha} |
| Learning rate | ${training.lora.cfg.lr} (the simulator multiplies this by ${ML.LR_SCALE} because the run is short) |
| Epochs, batch | ${training.lora.cfg.epochs}, ${training.lora.cfg.batch} |
| Replay data | ${Math.round(training.lora.cfg.replay * 100)}% |
| Steps | ${training.lora.steps} |

## Evaluation on the sealed test
Overall: ${Math.round(evalSet.baseline.overall * 100)}% for the base, ${Math.round(best.overall * 100)}% for this model.

| Category | Base | ${id.name} |
|---|---|---|
${catRows}

Quantised build: ${artifact.bits}-bit, ${(artifact.bytes / 1e6).toFixed(2)} MB, sealed score ${Math.round(artifact.overall * 100)}% (the float build scored ${Math.round(artifact.floatOverall * 100)}%).

${vision ? 'Vision heads, accuracy on fresh synthetic images: ' + Object.entries(vision.acc).map(([k, v]) => k + ' ' + Math.round(v * 100) + '%').join(', ') + '. It understands simple shapes only.' : ''}

Simulated figures, not measured on real hardware: Whisper accent plan${voice && voice.wer ? ' (' + Object.entries(voice.wer).map(([k, v]) => k + ' ' + Math.round(v * 100) + '% WER').join(', ') + ')' : ''}${stackCfg ? '; load test p95 ' + Math.round(stackCfg.p95) + ' ms at 2x traffic, $' + stackCfg.cost.toFixed(2) + ' per 1,000 requests' : ''}.

## Known limits
${cards.limits}

## Safety
Red-team pass rate: ${redteam ? Math.round(redteam.rate * 100) + '%' : 'not run'} on ${redteam ? redteam.n : 0} real attacks through the gateway. Guards: input filter, output PII scrub, document injection filter. The agent runs inside a sandbox with an allowlist, timeouts, confirmations and audit logs.

## Licence
${cards.licence}
`;
  };
  R.dataCard = function (ctx) {
    const { ds, prov } = ctx;
    const srcs = prov.sources.filter((s) => s.decision === 'admit');
    const g = ds.gates;
    return `# Data card, version ${ds.versionHash}

Rows: ${g.n}. Train ${ds.splits.train.length}, validation ${ds.splits.val.length}, sealed data test ${ds.splits.test.length}. Split by source and conversation.

## Sources
${srcs.map((s) => '- ' + s.name + ' (' + s.licence + ', ' + s.version + ')' + (s.shareAlike ? ' [share-alike duties apply]' : '')).join('\n')}

Rejected at the provenance gate: ${prov.sources.filter((s) => s.decision !== 'admit').map((s) => s.name).join('; ')}.

## Filters, in order
${ds.report.map((r) => '- ' + r.name + ': ' + r.in + ' to ' + r.out + '. ' + r.note).join('\n')}

## Quality gates
- Manual review: ${Math.round(ds.card.reviewRate * 100)}% acceptable on ${ds.card.reviewed} rows (production target: 200 rows per source).
- Exact duplicates: ${g.exact}. Near-duplicate rate: ${(g.nearRate * 100).toFixed(1)}%.
- Secrets and PII found after scrubbing: ${g.pii}.
- Overlap with the sealed test: ${g.evalOverlap}.
- Format parse rate: ${Math.round(g.formatRate * 100)}%.
- Largest source: ${g.topSrc}, ${Math.round(g.topShare * 100)}%.

## Known gaps
${ds.card.gaps}

Fake personal details in the raw data were generated for this simulation. No real person's data is included.
`;
  };
  R.changelog = (ctx) => `# Changelog\n\n## ${ctx.version} (${new Date().toISOString().slice(0, 10)})\n- First public release of ${ctx.id.name}.\n- Quantised to ${ctx.artifact.bits} bits. Sealed test ${Math.round(ctx.artifact.overall * 100)}%.\n- Dataset version ${ctx.ds.versionHash}.\n`;
  R.license = (ctx) => (ctx.cards.licenceId === 'apache' ? `${ctx.id.name} weights and code. Copyright ${new Date().getFullYear()} ${ctx.id.maker}.

Licensed under the Apache License, Version 2.0. You may obtain a copy at
https://www.apache.org/licenses/LICENSE-2.0

Commercial use is allowed. Attribution notices must be kept.
${ctx.prov.sources.some((s) => s.decision === 'admit' && s.shareAlike) ? '\nData notice: the released dataset includes rows under CC-BY-SA-4.0. Those rows stay under that licence, with attribution and share-alike duties. The weights notice above does not change that.\n' : ''}
Base model: tiny transformer trained by AI Launch Lab on hand-written data and on OpenAssistant oasst1 (Apache-2.0).
` : `${ctx.id.name} weights and code. Copyright ${new Date().getFullYear()} ${ctx.id.maker}. Released under the MIT License.
${ctx.prov.sources.some((s) => s.decision === 'admit' && s.shareAlike) ? '\nData notice: the released dataset includes rows under CC-BY-SA-4.0. Those rows stay under that licence.\n' : ''}`);

  // Real-GPU kit: uses the player's own settings. Not executed in this simulator.
  R.gpuKit = function (ctx) {
    const c = ctx.training.lora.cfg, base = ctx.spec.base;
    const hf = { qwen8: 'Qwen/Qwen3-8B', gemma: 'google/gemma-4-14b', qwen32: 'Qwen/Qwen3-32B-MoE' }[base.id] || 'CHECK-THE-MODEL-CARD/your-base';
    const train = `"""Real LoRA fine-tune with TRL and PEFT, using your cleaned data and your settings from AI Launch Lab.
Check the base model id and its licence on Hugging Face the week you run this. Needs a GPU: ${base.gpu}.
    pip install -r requirements.txt
    python train_lora.py
This file was generated by the simulator and has not been run on a GPU. Run the tiny overfit test first (OVERFIT=1)."""
import json
import os

import torch
from datasets import Dataset
from peft import LoraConfig
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from trl import SFTConfig, SFTTrainer

BASE = os.environ.get("BASE_MODEL", "${hf}")
OVERFIT = os.environ.get("OVERFIT") == "1"


def load(path):
    rows = []
    for line in open(path, encoding="utf-8"):
        record = json.loads(line)
        msgs = []
        for m in record["messages"]:
            content = m.get("content") or ""
            if m.get("events") and m["role"] == "assistant":
                content = json.dumps({"text": content, **m["events"]}, ensure_ascii=False)
            if m.get("tool_calls"):
                content = json.dumps(m["tool_calls"], ensure_ascii=False)
            msgs.append({"role": m["role"], "content": content})
        rows.append({"messages": msgs})
    return Dataset.from_list(rows)


train = load("../data/train.jsonl")
val = load("../data/val.jsonl")
if OVERFIT:
    train = train.select(range(20))
    val = train

tok = AutoTokenizer.from_pretrained(BASE)
print("One tokenised example, check it by eye:")
print(tok.apply_chat_template(train[0]["messages"], tokenize=False))

quant = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_compute_dtype=torch.bfloat16)
model = AutoModelForCausalLM.from_pretrained(BASE, quantization_config=quant, device_map="auto")

peft_config = LoraConfig(r=${c.rank}, lora_alpha=${ctx.training.lora.alpha}, target_modules="all-linear", task_type="CAUSAL_LM")
args = SFTConfig(
    output_dir="adapter",
    learning_rate=${c.lr},
    num_train_epochs=${OVERFIT_EPOCHS(c)},
    per_device_train_batch_size=4,
    gradient_accumulation_steps=${Math.max(1, Math.round(c.batch / 4))},
    bf16=True,
    eval_strategy="steps",
    eval_steps=200,
    save_steps=200,
    logging_steps=20,
    load_best_model_at_end=True,
    metric_for_best_model="eval_loss",
    report_to="none",
)
trainer = SFTTrainer(model=model, args=args, train_dataset=train, eval_dataset=val, peft_config=peft_config, processing_class=tok)
trainer.train()
trainer.save_model("adapter")
`;
    const compose = `# One GPU server with Docker Compose (guide Part 8.4). Generated by AI Launch Lab. Not run by the simulator.
# Check image names and tags before use. Set the secrets in .env, and never commit that file.
services:
  caddy:
    image: caddy:2
    ports: ["443:443"]
    volumes: ["./Caddyfile:/etc/caddy/Caddyfile:ro"]
  gateway:
    image: ghcr.io/berriai/litellm:main-stable
    command: ["--config", "/app/config.yaml", "--port", "4000"]
    volumes: ["./litellm_config.yaml:/app/config.yaml:ro"]
    environment:
      - DATABASE_URL=postgresql://hub:\${POSTGRES_PASSWORD}@postgres:5432/hub
      - REDIS_HOST=redis
      - LITELLM_MASTER_KEY=\${LITELLM_MASTER_KEY}
  vllm:
    image: vllm/vllm-openai:latest
    command: ["--model", "${hf}", "--enable-lora", "--lora-modules", "chat=/adapters/chat", "code=/adapters/code", "--quantization", "awq"]
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    volumes: ["./adapter:/adapters/chat:ro"]
  whisper:
    image: fedirz/faster-whisper-server:latest-cpu
  kokoro:
    image: ghcr.io/remsky/kokoro-fastapi-cpu:latest
  fallback:
    image: ghcr.io/ggerganov/llama.cpp:server
    command: ["-m", "/models/small-q4.gguf", "--port", "8080"]
    volumes: ["./models:/models:ro"]
  redis:
    image: redis:7
  postgres:
    image: postgres:16
    environment:
      - POSTGRES_USER=hub
      - POSTGRES_PASSWORD=\${POSTGRES_PASSWORD}
      - POSTGRES_DB=hub
  prometheus:
    image: prom/prometheus:latest
`;
    const litellm = `model_list:
  - model_name: ${ctx.modelSlug}
    litellm_params:
      model: openai/chat
      api_base: http://vllm:8000/v1
      api_key: none
  - model_name: ${ctx.modelSlug}-code
    litellm_params:
      model: openai/code
      api_base: http://vllm:8000/v1
      api_key: none
  - model_name: ${ctx.modelSlug}-fallback
    litellm_params:
      model: openai/small
      api_base: http://fallback:8080/v1
      api_key: none
router_settings:
  fallbacks:
    - ${ctx.modelSlug}: ["${ctx.modelSlug}-fallback"]
  num_retries: 2
  timeout: 30
litellm_settings:
  cache: true
  cache_params:
    type: redis
    host: redis
general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY
  database_url: os.environ/DATABASE_URL
`;
    const caddy = `your-domain.example {\n  reverse_proxy gateway:4000\n}\n`;
    const req = `torch\ntransformers\npeft\ntrl\ndatasets\nbitsandbytes\naccelerate\n`;
    return { train, compose, litellm, caddy, req };
  };
  function OVERFIT_EPOCHS(c) { return c.epochs; }

  // ------------------------------------------------- SDKs
  R.sdk = (ctx) => ({
    py: `"""Tiny client for ${ctx.id.name}. Any OpenAI SDK also works: change only the base URL."""
import json
import urllib.request


class Client:
    def __init__(self, base_url="http://localhost:8000/v1", api_key=None):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key

    def chat(self, content, model="${ctx.modelSlug}"):
        body = json.dumps({"model": model, "messages": [{"role": "user", "content": content}]}).encode()
        req = urllib.request.Request(self.base_url + "/chat/completions", data=body, headers={"Content-Type": "application/json", "Authorization": "Bearer " + str(self.api_key)})
        with urllib.request.urlopen(req) as r:
            return json.load(r)


if __name__ == "__main__":
    import os
    reply = Client(api_key=os.environ["HUB_API_KEY"]).chat("Who are you?")
    print(reply["choices"][0]["message"]["content"], reply["x_hub"]["events"])
`,
    js: `// Tiny client for ${ctx.id.name}. Any OpenAI SDK also works: change only the base URL.
export async function chat(content, { baseURL = 'http://localhost:8000/v1', apiKey, model = '${ctx.modelSlug}' } = {}) {
  const r = await fetch(baseURL + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify({ model, messages: [{ role: 'user', content }] }),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + (await r.text()));
  return r.json();
}
`,
  });

  // ------------------------------------------------- Node server (real, no dependencies)
  R.serverJS = (ctx) => `#!/usr/bin/env node
/* ${ctx.id.name} ${ctx.version}: a real OpenAI-compatible server for your model. No dependencies.
   Run:  node server.js        then call http://localhost:8000/v1/chat/completions
   Set HUB_API_KEY to choose a key. Set PORT to change the port. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ML = require('./engine.js');
const B = require('./brain.js');
const dir = (f) => path.join(__dirname, '..', 'model', f);
const toAB = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);

function loadBase() {
  const buf = fs.readFileSync(dir('base.safetensors'));
  const { tensors, meta } = rawParse(toAB(buf));
  const cfg = { V: +meta.V, d: +meta.d, L: +meta.L, H: +meta.H, ctx: +meta.ctx, m: +meta.m };
  if (meta.format === 'quantised') {
    const scales = JSON.parse(meta.scales), lengths = JSON.parse(meta.lengths), bits = +meta.bits, w = {};
    for (const k in tensors) w[k] = unpack(tensors[k], lengths[k], bits, scales[k]);
    return new ML.GPT(cfg, w);
  }
  const w = {};
  for (const k in tensors) w[k] = new Float32Array(tensors[k].buffer, tensors[k].byteOffset, tensors[k].length / 4);
  return new ML.GPT(cfg, w);
}
function rawParse(ab) {
  const dv = new DataView(ab);
  const n = Number(dv.getBigUint64(0, true));
  const hdr = JSON.parse(new TextDecoder().decode(new Uint8Array(ab, 8, n)));
  const tensors = {};
  for (const k in hdr) { if (k === '__metadata__') continue; const [a, b] = hdr[k].data_offsets; tensors[k] = new Uint8Array(ab.slice(8 + n + a, 8 + n + b)); }
  return { tensors, meta: hdr.__metadata__ || {} };
}
function unpack(u8, count, bits, scale) {
  const out = new Float32Array(count);
  let acc = 0, have = 0, o = 0;
  const mask = (1 << bits) - 1, sign = 1 << (bits - 1);
  for (let i = 0; i < count; i++) {
    while (have < bits) { acc |= u8[o++] << have; have += 8; }
    let v = acc & mask;
    acc >>>= bits; have -= bits;
    if (v & sign) v -= 1 << bits;
    out[i] = v * scale;
  }
  return out;
}
const config = JSON.parse(fs.readFileSync(dir('config.json'), 'utf8'));
const tok = new ML.Tokenizer(JSON.parse(fs.readFileSync(dir('tokenizer.json'), 'utf8')));
const adapters = {};
for (const [name, file] of [['chat', 'adapter_chat.safetensors'], ['code', 'adapter_code.safetensors']]) {
  if (fs.existsSync(dir(file))) adapters[name] = ML.parseAdapter(toAB(fs.readFileSync(dir(file))));
}
const matcher = new ML.Matcher(config.questions || []);
matcher.add(config.extraQuestions || [], 'adapter');
const brain = new B.Brain({ net: loadBase(), tok, adapters, identity: config.identity, rules: config.rules, conf: config.conf, modelName: config.model, matcher });
if (fs.existsSync(dir('docs.json'))) for (const d of JSON.parse(fs.readFileSync(dir('docs.json'), 'utf8'))) brain.addDoc(d.title, d.text, d.source);
const key = process.env.HUB_API_KEY || 'hub-' + crypto.randomBytes(12).toString('hex');
const gateway = new B.Gateway(brain, { keys: { [key]: { name: 'local', limit: +(process.env.RATE_LIMIT || 600) } }, model: config.model });

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization,content-type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  let raw = '';
  req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
  req.on('end', () => {
    let body = null;
    if (raw) { try { body = JSON.parse(raw); } catch (e) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'Body is not valid JSON.', type: 'invalid_request_error', code: 400 } })); } }
    const chunks = [];
    const r = gateway.handle(req.method, req.url, req.headers, body, (c) => chunks.push(c));
    if (r.streamed) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      for (const c of chunks) res.write('data: ' + JSON.stringify(c) + '\\n\\n');
      res.write('data: [DONE]\\n\\n');
      return res.end();
    }
    res.writeHead(r.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(r.json));
  });
});
const port = +(process.env.PORT || 8000);
server.listen(port, () => {
  console.log(config.identity.name + ' is running at http://localhost:' + port + '/v1');
  console.log('API key: ' + key);
  console.log('Try: curl http://localhost:' + port + '/v1/chat/completions -H "Authorization: Bearer ' + key + '" -H "Content-Type: application/json" -d "{\\\\"messages\\\\":[{\\\\"role\\\\":\\\\"user\\\\",\\\\"content\\\\":\\\\"Who are you?\\\\"}]}"');
});
`;

  R.readme = (ctx) => `# ${ctx.id.name} ${ctx.version}

Your AI, built in AI Launch Lab. Everything in this folder is yours.

## Use it
**Offline app:** open \`app/${ctx.modelSlug}.html\` in a browser. No internet or server needed. You can send that one file to anyone.

**Local API:** with Node 18 or newer installed:

    cd server
    node server.js

It prints your API key. Any OpenAI-compatible SDK works by changing only the base URL:

    from openai import OpenAI
    client = OpenAI(base_url="http://localhost:8000/v1", api_key="YOUR_KEY")
    print(client.chat.completions.create(model="${ctx.modelSlug}", messages=[{"role": "user", "content": "Who are you?"}]).choices[0].message.content)

The reply also carries \`x_hub.events\` (the emotion JSON), \`x_hub.route\` and \`x_hub.sources\`.

Or with Docker: \`docker build -t ${ctx.modelSlug} server && docker run -p 8000:8000 ${ctx.modelSlug}\`

## What is inside
| Folder | What |
|---|---|
| \`model/\` | Quantised base, LoRA adapters, tokenizer, and config |
| \`app/\` | The offline single-file app |
| \`server/\` | OpenAI-compatible server with keys, rate limits and logs |
| \`sdk/\` | Python and JavaScript clients |
| \`data/\` | Your cleaned dataset as JSONL |
| \`real-gpu/\` | Scripts to repeat this on a real GPU with a real open base model |
| \`MODEL_CARD.md\`, \`DATA_CARD.md\`, \`provenance.csv\`, \`LICENSE\`, \`CHANGELOG.md\`, \`eval_report.json\` | The paperwork |

## Be honest about what this is
This model is tiny, so it knows what you trained it on and little else. It is a working prototype of the whole pipeline, not a replacement for a frontier model. To go further, run \`real-gpu/train_lora.py\` on a rented GPU using this same dataset. Those scripts were generated for you and have not been run on a GPU, so check them first.
`;

  // ------------------------------------------------- offline single-file app
  const b64 = (buf) => { const u = new Uint8Array(buf); let s = ''; const CH = 0x8000; for (let i = 0; i < u.length; i += CH) s += String.fromCharCode.apply(null, u.subarray(i, i + CH)); return btoa(s); };
  const esc = (t) => t.replace(/<\/script/gi, '<\\/script');
  R.offlineApp = async function (ctx) {
    const get = (p) => fetch(p).then((r) => { if (!r.ok) throw new Error('Could not read ' + p); return r.text(); });
    const [three, engine, brain, face, app] = await Promise.all([get('lib/three.min.js'), get('js/ml/engine.js'), get('js/lab/brain.js'), get('js/lab/face.js'), get('js/lab/offline-app.js')]);
    const data = { config: ctx.config, tok: ctx.tok, base: b64(ctx.baseFile), chat: ctx.adapterChat ? b64(ctx.adapterChat) : null, docs: ctx.docs, faceCfg: ctx.faceCfg || {} };
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${ctx.id.name}</title>
<style>
:root{--bg:#07111f;--panel:#0d1b2e;--raised:#15283f;--line:#264061;--fg:#e9f0f7;--dim:#93a7bf;--cyan:#2fe0cf;color-scheme:dark}
*{box-sizing:border-box}html,body{height:100%;margin:0;background:var(--bg);color:var(--fg);font:16px/1.45 system-ui,"Segoe UI",sans-serif}
#app{position:fixed;inset:0;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr)}#stage{position:relative;min-height:0;min-width:0}#stage canvas{display:block;width:100%;height:100%}
#side{display:flex;flex-direction:column;min-height:0;background:var(--panel);border-left:1px solid var(--line)}header{padding:12px 16px;border-bottom:1px solid var(--line)}header h1{margin:0;font-size:1.2rem;color:var(--cyan)}header p{margin:0;font-size:.8rem;color:var(--dim)}
#log{flex:1;overflow:auto;padding:12px 16px;display:flex;flex-direction:column;gap:8px}.m{padding:8px 11px;border-radius:10px;max-width:90%;white-space:pre-wrap;overflow-wrap:anywhere;font-size:.95rem}.u{align-self:flex-end;background:#16405a}.a{align-self:flex-start;background:var(--raised)}.meta{font:.68rem ui-monospace,Consolas,monospace;color:var(--dim);margin-top:3px}
form{display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--line)}input{flex:1;min-width:0;background:var(--raised);border:1px solid var(--line);color:var(--fg);border-radius:8px;padding:10px;font:inherit}button{background:var(--cyan);color:#031614;border:0;border-radius:8px;padding:10px 14px;font:700 .95rem inherit;cursor:pointer}button.ghost{background:transparent;color:var(--cyan);border:1px solid var(--cyan)}
@media(max-width:760px){#app{grid-template-columns:1fr;grid-template-rows:34% 1fr}#side{border-left:0;border-top:1px solid var(--line)}}
</style></head><body><div id="app"><div id="stage"></div><div id="side"><header><h1>${ctx.id.name}</h1><p>${ctx.version}, by ${ctx.id.maker}. Runs entirely on this device.</p></header><div id="log" aria-live="polite"></div><form id="f"><input id="i" autocomplete="off" placeholder="Message ${ctx.id.name}" aria-label="Message"><button class="ghost" type="button" id="snd" aria-pressed="true">Voice on</button><button type="submit">Send</button></form></div></div>
<script>${esc(three)}<\/script>
<script>${esc(face)}<\/script>
<script id="engine-src" type="text/plain">${esc(engine)}<\/script>
<script id="brain-src" type="text/plain">${esc(brain)}<\/script>
<script>window.HUB_DATA=${JSON.stringify(data).replace(/<\//g, '<\\/')};<\/script>
<script>${esc(app)}<\/script>
</body></html>`;
  };
})();
