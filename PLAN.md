# AI Launch Lab: build plan

Source: `AI_Stack_FineTuning_Guide (1).pdf` (Self-Hosted Multimodal AI Stack, Process Guide v1.0).
Goal from the user: a 3D game where finishing it means you really made and launched a working AI, in simulation, committed and hosted on GitHub Pages.

**Status 2026-11-07: engine and corpus stage only. Nothing playable yet, nothing pushed or hosted.**

## Core idea
Real computation wherever a browser can do it. Label every step REAL or SIMULATED in the UI.
- REAL: data cleaning, LoRA training, eval, merge, quantise, generation, gateway logic.
- SIMULATED: GPU rental, Whisper fine-tune, cluster load (numbers from the guide).

## Done
- `js/ml/engine.js`: BPE tokenizer, chat template, transformer with KV cache, LoRA with hand-written backprop, Adam, merge, int8/int4 quantise, safetensors, constrained event decoding.
- `tools/knowledge.js`: hand-written corpus (guide facts, general, small talk, code, capitals, persona, refusals).
- `tools/build_base_corpus.js`, `tools/train_base.py`, `tools/test_engine.js`, `tools/oasst_short.json` (398 Apache-2.0 rows from OpenAssistant oasst1).
- `js/core.js`, `js/arena.js`, `css/academy.css`, `arena.html`, `lib/three.min.js` copied from AI-Builder-Academy (storage key changed). Not yet adapted.

## Next steps, in order
1. Train the base in the background (about 6000 steps, d=128, L=4, CPU). Python with torch: `lerobot-launch-lab/.venv/Scripts/python.exe -I`. Save to `models/`.
2. Check JS logits match PyTorch.
3. Node tuning script: LoRA on persona, events, refusals, tool calls. Prove quality and 1-2 minute browser timing. Scale the LR so the guide's 1e-4 to 2e-4 is the working range, and disclose the scale in the UI. Calibrate star thresholds.
4. Multi-worker trainer (`js/ml/train-worker.js`), gradients averaged across Web Workers.
5. `tools/build_lake.js`: dirty raw data lake with licence traps, PII, duplicates, eval overlap.
6. Real 12-stage cleaning pipeline in JS (MinHash + LSH at 0.8 on 5-grams, regex PII, n-gram decontaminate, split by source).
7. Game: 3D walkable campus hub, then zones below. Each mission's output feeds the next. Project state in IndexedDB.
8. Final app `app.html`: chat, RAG over the guide and user docs, router log, emotion-driven 3D face, TTS/STT via Web Speech, sandboxed terminal agent, thumbs feedback into retrain. Optional real open models via Transformers.js (verified on HF: SmolLM2-135M-Instruct, Qwen3-0.6B-ONNX, Xenova/whisper-tiny.en, Kokoro-82M-v1.0-ONNX, Xenova/bge-small-en-v1.5).
9. Service worker for same-origin `/v1/*` OpenAI-shaped routes.
10. Release zip: single-file offline HTML, zero-dependency `node server.js` real local API (test with curl), model.safetensors, model card, data card, provenance.csv, JSONL data, real-GPU scripts (Unsloth/TRL, docker-compose, LiteLLM, Caddy). State clearly that GPU scripts were not run on a GPU.
11. Questions (at least 10 per lesson), teacher.html, smoke tests desktop and phone, run-steps play-through per mission, cross-check numbers against the guide.
12. Public repo `ai-launch-lab`, GitHub Pages, deliver link.

## Zones and missions (win check must measure the concept)
1. Blueprint Hall (wk 1-2, Parts 1-3): Merge Myth and wiring; Router v1 rules scored on real requests; pick base and write the spec.
2. Eval Vault (wk 1-2, 4.1, 9): write seed examples; seal the eval set and run a real baseline.
3. Data Refinery (wk 3-5, 4.2-4.6): Provenance Gate; 12-stage line with the 50 percent alarm; modality bench (WER, pHash, code execution, JSON and kappa); quality gates.
4. Agent Sandbox (wk 6-8, 6.2): harness with allowlist and confirmations; record verified trajectories.
5. Training Hall (wk 8-9, 5, 6.1, 7): GPU choice and tiny overfit test; LoRA SFT; failure rounds; DPO polish.
6. Face and Voice Studio (wk 9-10, 6.3-6.5): vision; speech; emotion face and latency budget.
7. Server Hall (wk 10-11, 7, 8): merge and quantise with re-eval; compose the stack and load test at 2x traffic.
8. Launch Pad (wk 11-12, 9, 10): red team and final eval; package; canary launch, then open the AI.

## Real consequences to demonstrate (verify each in Node first)
Skip PII scrub: model leaks fake contacts. Keep "As an AI I cannot" rows: over-refusal. Skip dedupe: memorisation. No replay: general scores fall. Wrong template (`opts.template='alpaca'`): silent failure. Eval overlap: inflated scores. 4-bit quantise without re-test: regression.

## Honesty rules
A tiny model answers only what it was trained on, plus retrieval. Never present it as Gemma or Qwen scale. Show an honest fallback when it is out of its depth.
