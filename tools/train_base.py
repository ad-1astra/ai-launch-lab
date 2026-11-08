"""Pre-trains the tiny open base model on CPU and exports safetensors for the browser engine.
   usage: python train_base.py <base_ids.json> <out.safetensors> [steps] [d] [L]"""
import json, math, random, struct, sys, time
import torch, torch.nn as nn, torch.nn.functional as F

src, out = sys.argv[1], sys.argv[2]
STEPS = int(sys.argv[3]) if len(sys.argv) > 3 else 6000
D = int(sys.argv[4]) if len(sys.argv) > 4 else 128
L = int(sys.argv[5]) if len(sys.argv) > 5 else 4
H, CTX, V = 4, 128, 1400
M = 2 * D
BATCH, LR = 48, 2e-3
DROP, SMOOTH = 0.08, 0.08
torch.manual_seed(1); random.seed(1)
torch.set_num_threads(11)

rows = json.load(open(src))
weights = {'stack': 3.0, 'general': 2.0, 'smalltalk': 3.0, 'code': 2.0, 'capitals': 1.0, 'maths': 0.25, 'oasst': 0.7, 'tool': 0.9}
probs = [weights.get(r['s'], 1.0) for r in rows]
print('rows', len(rows), flush=True)


class Block(nn.Module):
    def __init__(s):
        super().__init__()
        s.ln1 = nn.LayerNorm(D, eps=1e-5); s.ln2 = nn.LayerNorm(D, eps=1e-5)
        s.q = nn.Linear(D, D, bias=False); s.k = nn.Linear(D, D, bias=False); s.v = nn.Linear(D, D, bias=False); s.o = nn.Linear(D, D, bias=False)
        s.m1 = nn.Linear(D, M, bias=False); s.m2 = nn.Linear(M, D, bias=False)

    def forward(s, x, mask):
        B, T, _ = x.shape
        n = s.ln1(x)
        shape = (B, T, H, D // H)
        q, k, v = s.q(n).view(shape).transpose(1, 2), s.k(n).view(shape).transpose(1, 2), s.v(n).view(shape).transpose(1, 2)
        a = (q @ k.transpose(-1, -2)) / math.sqrt(D // H)
        a = a.masked_fill(mask[:, None, :, :] == 0, float('-inf'))
        a = a.softmax(-1)
        o = (a @ v).transpose(1, 2).reshape(B, T, D)
        x = x + F.dropout(s.o(o), DROP, s.training)
        x = x + F.dropout(s.m2(F.relu(s.m1(s.ln2(x)))), DROP, s.training)
        return x


class GPT(nn.Module):
    def __init__(s):
        super().__init__()
        s.tok = nn.Embedding(V, D); s.pos = nn.Embedding(CTX, D)
        s.blocks = nn.ModuleList(Block() for _ in range(L))
        s.lnf = nn.LayerNorm(D, eps=1e-5)
        nn.init.normal_(s.tok.weight, std=0.02); nn.init.normal_(s.pos.weight, std=0.02)
        for p in s.parameters():
            if p.dim() == 2 and p.shape[0] != V and p.shape[0] != CTX:
                nn.init.normal_(p, std=0.02)

    def forward(s, ids):
        T = ids.shape[1]
        x = s.tok(ids) + s.pos(torch.arange(T))
        mask = torch.tril(torch.ones(T, T, dtype=torch.uint8))[None]
        for b in s.blocks:
            x = b(x, mask)
        return s.lnf(x) @ s.tok.weight.T


net = GPT()
n_params = sum(p.numel() for p in net.parameters())
print('params', n_params, flush=True)
opt = torch.optim.AdamW(net.parameters(), lr=LR, weight_decay=0.0, betas=(0.9, 0.98))


def batch():
    picks = random.choices(rows, probs, k=BATCH)
    T = max(len(r['i']) for r in picks)
    ids = torch.zeros(BATCH, T, dtype=torch.long)
    tgt = torch.full((BATCH, T), -100, dtype=torch.long)
    for b, r in enumerate(picks):
        n = len(r['i'])
        ids[b, :n] = torch.tensor(r['i'])
        t = torch.tensor(r['i'])
        m = torch.tensor(r['m'], dtype=torch.bool)
        t = t.masked_fill(~m, -100)
        tgt[b, :n] = t
    return ids[:, :-1], tgt[:, 1:]


def export():
    t = {}
    sd = net.state_dict()
    t['tok'] = sd['tok.weight']; t['pos'] = sd['pos.weight']
    for l in range(L):
        for n in ['q', 'k', 'v', 'o', 'm1', 'm2']:
            t[f'h{l}.{n}'] = sd[f'blocks.{l}.{n}.weight'].T  # engine stores din x dout
        for ln in ['ln1', 'ln2']:
            t[f'h{l}.{ln}.g'] = sd[f'blocks.{l}.{ln}.weight']; t[f'h{l}.{ln}.b'] = sd[f'blocks.{l}.{ln}.bias']
    t['lnf.g'] = sd['lnf.weight']; t['lnf.b'] = sd['lnf.bias']
    hdr = {'__metadata__': {'V': str(V), 'd': str(D), 'L': str(L), 'H': str(H), 'ctx': str(CTX), 'm': str(M)}}
    off = 0; blobs = []
    for k, v in t.items():
        b = v.detach().cpu().float().contiguous().view(-1).numpy().tobytes()
        hdr[k] = {'dtype': 'F32', 'shape': [v.numel()], 'data_offsets': [off, off + len(b)]}
        off += len(b); blobs.append(b)
    js = json.dumps(hdr).encode()
    js += b' ' * ((8 - (len(js) + 8) % 8) % 8)
    with open(out, 'wb') as f:
        f.write(struct.pack('<Q', len(js))); f.write(js)
        for b in blobs:
            f.write(b)


t0 = time.time(); ema = None
for step in range(1, STEPS + 1):
    lr = LR * min(1, step / 200) * (0.05 + 0.95 * 0.5 * (1 + math.cos(math.pi * step / STEPS)))
    for g in opt.param_groups:
        g['lr'] = lr
    x, y = batch()
    loss = F.cross_entropy(net(x).reshape(-1, V), y.reshape(-1), ignore_index=-100, label_smoothing=SMOOTH)
    opt.zero_grad(); loss.backward()
    nn.utils.clip_grad_norm_(net.parameters(), 1.0)
    opt.step()
    ema = loss.item() if ema is None else 0.98 * ema + 0.02 * loss.item()
    if step % 100 == 0 or step == 1:
        print(f'step {step} loss {ema:.3f} lr {lr:.5f} {time.time()-t0:.0f}s', flush=True)
    if step % 1000 == 0:
        export()
export()
print('DONE', flush=True)
