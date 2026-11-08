# AI Launch Lab

Build a working AI from raw data to launch, inside a 3D game. The training is real.

Based on "Building a Self-Hosted Multimodal AI Stack" (Process Guide v1.0), for the Pearl Labs AI and Robotics bootcamp.

**Play:** open `index.html` from a web server, or use the GitHub Pages link for this repo.

## What you actually do
Walk a 3D campus of 8 buildings that follow the guide's 12-week roadmap. Across 24 missions you:

1. **Design** the system: one gateway with many specialists, a router you write, and a base model chosen by licence.
2. **Seal** a test set before any data arrives, and measure the untouched base.
3. **Clean** about 3,300 real, dirty rows with a 12-stage pipeline: MinHash and LSH, PII scrubbing, decontamination, split by conversation. Then pass the quality gates.
4. **Build** a sandboxed terminal agent and record verified trajectories.
5. **Fine-tune** for real: an overfit test, LoRA SFT, failure rounds, DPO, and GRPO for the agent adapter.
6. **Give it** eyes (vision heads on a frozen CNN), a voice (browser speech with word-timed lip-sync), and an emotion-driven 3D face.
7. **Merge and quantise** real weights, re-test them, and compose and load-test the stack.
8. **Red-team** it, package a real release, and launch it behind a canary.

Then you **use your AI**: chat, agent, vision, images, documents, an OpenAI-compatible API, and feedback that retrains it into v1.1.

## What is real, and what is simulated
| Real, computed in your browser | Simulated, labelled in amber |
|---|---|
| Cleaning pipeline, kappa, WER, code execution, perceptual hashes | GPU rental and prices |
| LoRA, DPO and GRPO with hand-written backprop on CPU workers | Whisper fine-tuning curve |
| Event heads, merge, int8 and int4 quantisation, sealed-test scores | Docker Compose assembly |
| Gateway keys, rate limits, routing, retrieval, guards | Cluster load test (queue model) |
| Release zip: weights, adapters, cards, offline app, Node server | Canary traffic |

## The model, honestly
- Base: a 722,176-parameter transformer (4 layers, 128 dimensions, 1,400-token BPE). It was pre-trained here on hand-written knowledge from the guide, general Q&A, code, tool calls, and OpenAssistant oasst1 (Apache-2.0) short rows.
- Fine-tuning: LoRA on the top 2 blocks, with the learning rate scaled by 15 so a run of about 2 minutes works. A TF-IDF matcher maps rephrased questions to trained ones, and multi-LoRA routing sends known questions to the pure base. Emotion events come from 5 closed-choice heads on the final state.
- Typical result: about 90% on the sealed test, against about 60% for the base. It is strong on what it trained on and says so when it does not know. It is a working prototype of the whole pipeline, not a general assistant.

## Layout
| Path | What |
|---|---|
| `index.html`, `js/hub.js` | 3D campus |
| `blueprint`, `vault`, `refinery`, `sandbox`, `training`, `studio`, `servers`, `launch` (`.html` and `js/*.js`) | The 8 zones |
| `app.html`, `js/app.js` | Your finished AI |
| `js/ml/engine.js` | Tokenizer, transformer, LoRA backprop, Adam, quantisation, safetensors, matcher, event heads |
| `js/ml/trainer.js`, `js/ml/train-worker.js` | Data-parallel trainer, DPO and GRPO |
| `js/lab/pipeline.js` | The 12-stage cleaning pipeline and quality gates |
| `js/lab/brain.js` | Router, retrieval, tools, guards, OpenAI-compatible gateway |
| `js/lab/agent.js` | Sandboxed shell harness and agent loop |
| `js/lab/release.js` | Release builder (zip, cards, server, offline app, real-GPU kit) |
| `models/` | Base weights, tokenizer, vision encoder, image diffusion model |
| `data/` | Raw data lake (fake personal details), guide chunks, base questions |
| `tools/` | Scripts that built the corpus, pre-trained the models, and tuned the missions |
| `teacher.html` | Teacher guide |

## Rebuild the models
    node tools/build_base_corpus.js tools/oasst_short.json <out>
    python tools/train_base.py <out>/base_ids.json models/hub-base.safetensors 9000 128 4
    python tools/train_vision_image.py models both
    node tools/build_lake.js tools/oasst_short.json data/lake.json
    node tools/tune2.js models/hub-base.safetensors passes=14 show=1

All personal details in the data lake (names, emails, phone numbers, IDs, keys) are fake. They exist to teach the PII stage.
