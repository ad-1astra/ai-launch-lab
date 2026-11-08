# AI Launch Lab: build notes

Source: `AI_Stack_FineTuning_Guide (1).pdf` (Self-Hosted Multimodal AI Stack, Process Guide v1.0).
Goal: a 3D game where finishing it means you really made and launched a working AI, in simulation.

## Status
Built: 8 zones, 24 missions, the finished-AI app, the arena, the teacher guide and the release builder. See README.md for what is real and what is simulated.

## Model design, and why
- **Base:** 722K params (d128, L4, ctx128, BPE 1400), label smoothing and dropout 0.08, with native tool calling pre-trained in (the guide says to pick a base with tool calling). It ships as `models/hub-base.safetensors`.
- **LoRA:** on the top 2 blocks only, LR x15, 14 passes (about 170 steps, about 100 s on 6 workers). Training spends its steps on PRIORITY sources: persona, refusals, seeds and failure rounds.
- **TF-IDF matcher:** maps rephrased questions to trained ones. A tiny model memorises; it does not generalise.
- **Multi-LoRA routing:** known questions run on the pure base, so the adapter cannot damage them. "General, adapter forced on" shows the forgetting that replay reduces.
- **Event heads:** 5 closed-choice softmax heads read the base's final state, so the event JSON is always valid.
- **What failed:** events inline in the token stream, all-layer LoRA, and an over-memorised base (loss 0.001). Each one wrecked the base's text.

## Typical result
About 90% on the sealed test for the tuned model, about 60% for the base (`node tools/tune2.js models/hub-base.safetensors passes=14 show=1`).

## Regression checks
- `node tools/test_engine.js`: gradients, merge, safetensors.
- `node tools/tune2.js ...`: a real fine-tune and the sealed test.
- Browser play-through script (kept outside the repo) drives all 24 missions in headless Chrome.
