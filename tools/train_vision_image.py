"""Pre-trains the tiny vision encoder (shapes, colours, counts, positions) and the tiny image diffusion model on CPU.
   usage: python train_vision_image.py <outDir> [vision|image|both]"""
import json, math, random, struct, sys, time
import torch, torch.nn as nn, torch.nn.functional as F

out_dir = sys.argv[1]
which = sys.argv[2] if len(sys.argv) > 2 else 'both'
torch.manual_seed(3); random.seed(3)
torch.set_num_threads(6)

COLORS = {'red': (226, 52, 52), 'blue': (52, 120, 235), 'green': (52, 200, 90), 'yellow': (245, 205, 50), 'purple': (160, 80, 225), 'orange': (245, 140, 45), 'white': (235, 235, 235)}
CNAMES = list(COLORS)
SHAPES = ['circle', 'square', 'triangle']


def put(img, n, kind, cx, cy, s, col):
    r = s / 2
    for y in range(max(0, int(cy - r - 1)), min(n, int(cy + r + 2))):
        for x in range(max(0, int(cx - r - 1)), min(n, int(cx + r + 2))):
            dx, dy = x - cx, y - cy
            if kind == 'circle':
                inside = dx * dx + dy * dy <= r * r
            elif kind == 'square':
                inside = abs(dx) <= r and abs(dy) <= r
            else:
                inside = dy >= -r and dy <= r and abs(dx) <= (dy + r) / 2
            if inside:
                img[0][y][x], img[1][y][x], img[2][y][x] = col[0] / 255, col[1] / 255, col[2] / 255


def scene(n=32):
    bg = [random.uniform(0.04, 0.16) for _ in range(3)]
    img = [[[bg[c]] * n for _ in range(n)] for c in range(3)]
    img = [[list(row) for row in ch] for ch in img]
    count = random.choice([0, 1, 1, 1, 2, 2, 3, 3, 4, 5])
    kind = random.randrange(3); col = random.randrange(len(CNAMES))
    if count == 1:
        region = random.choice(['left', 'right', 'top', 'bottom', 'center'])
        c = {'left': (8, 16), 'right': (24, 16), 'top': (16, 8), 'bottom': (16, 24), 'center': (16, 16)}[region]
        put(img, n, SHAPES[kind], c[0] + random.uniform(-2, 2), c[1] + random.uniform(-2, 2), random.uniform(9, 14), COLORS[CNAMES[col]])
        pos = ['left', 'right', 'top', 'bottom', 'center'].index(region)
    else:
        pos = 4
        spots = [(8, 8), (24, 8), (8, 24), (24, 24), (16, 16)]
        random.shuffle(spots)
        for k in range(count):
            put(img, n, SHAPES[kind], spots[k][0] + random.uniform(-1.5, 1.5), spots[k][1] + random.uniform(-1.5, 1.5), random.uniform(6, 9), COLORS[CNAMES[col]])
    return img, kind, col, count, pos


def export(tensors, meta, path):
    hdr = {'__metadata__': {k: str(v) for k, v in meta.items()}}
    off = 0; blobs = []
    for k, v in tensors.items():
        b = v.detach().cpu().float().contiguous().view(-1).numpy().tobytes()
        hdr[k] = {'dtype': 'F32', 'shape': [v.numel()], 'data_offsets': [off, off + len(b)]}
        off += len(b); blobs.append(b)
    js = json.dumps(hdr).encode(); js += b' ' * ((8 - (len(js) + 8) % 8) % 8)
    with open(path, 'wb') as f:
        f.write(struct.pack('<Q', len(js))); f.write(js)
        for b in blobs:
            f.write(b)


def train_vision():
    class Enc(nn.Module):
        def __init__(s):
            super().__init__()
            s.c1 = nn.Conv2d(3, 16, 3, 2, 1); s.c2 = nn.Conv2d(16, 32, 3, 2, 1); s.c3 = nn.Conv2d(32, 48, 3, 2, 1)
            s.fc = nn.Linear(48 * 4 * 4, 64)
            s.heads = nn.ModuleDict({'shape': nn.Linear(64, 3), 'color': nn.Linear(64, 7), 'count': nn.Linear(64, 6), 'pos': nn.Linear(64, 5)})

        def feat(s, x):
            x = F.relu(s.c1(x)); x = F.relu(s.c2(x)); x = F.relu(s.c3(x))
            return F.relu(s.fc(x.view(x.shape[0], -1)))

    net = Enc()
    opt = torch.optim.Adam(net.parameters(), 2e-3)
    t0 = time.time()
    # Build a pool first: rasterising in Python is the slow part.
    pool = [scene() for _ in range(6000)]
    X = torch.tensor([p[0] for p in pool]); Y = {k: torch.tensor([p[i + 1] for p in pool]) for i, k in enumerate(['shape', 'color', 'count', 'pos'])}
    print('vision data', time.time() - t0, flush=True)
    for step in range(1, 2501):
        i = torch.randint(0, len(pool) - 500, (64,))
        f = net.feat(X[i])
        has = Y['count'][i] > 0
        one = Y['count'][i] == 1
        loss = F.cross_entropy(net.heads['count'](f), Y['count'][i])
        if has.any():
            loss = loss + F.cross_entropy(net.heads['shape'](f[has]), Y['shape'][i][has]) + F.cross_entropy(net.heads['color'](f[has]), Y['color'][i][has])
        if one.any():
            loss = loss + F.cross_entropy(net.heads['pos'](f[one]), Y['pos'][i][one])
        opt.zero_grad(); loss.backward(); opt.step()
        if step % 500 == 0:
            with torch.no_grad():
                f = net.feat(X[-500:])
                acc = {k: (net.heads[k](f).argmax(1) == Y[k][-500:]).float().mean().item() for k in ['count']}
                has = Y['count'][-500:] > 0
                acc['shape'] = (net.heads['shape'](f[has]).argmax(1) == Y['shape'][-500:][has]).float().mean().item()
                acc['color'] = (net.heads['color'](f[has]).argmax(1) == Y['color'][-500:][has]).float().mean().item()
            print('vision', step, round(loss.item(), 3), acc, round(time.time() - t0), flush=True)
    sd = net.state_dict()
    t = {'c1': sd['c1.weight'], 'c1b': sd['c1.bias'], 'c2': sd['c2.weight'], 'c2b': sd['c2.bias'], 'c3': sd['c3.weight'], 'c3b': sd['c3.bias'], 'fc': sd['fc.weight'], 'fcb': sd['fc.bias']}
    export(t, {'kind': 'vision-encoder', 'feat': 64}, out_dir + '/vision.safetensors')
    print('vision saved', flush=True)


# ---------------------------------------------- tiny diffusion on 24x24 pixel icons
def icon(cls, pal):
    n = 24
    PALS = [((245, 140, 45), (20, 26, 44), (47, 224, 207)), ((47, 224, 207), (10, 30, 40), (255, 112, 216)), ((255, 112, 216), (30, 16, 44), (245, 205, 50)), ((75, 227, 138), (12, 34, 28), (240, 240, 240))]
    fg, bg, ac = PALS[pal]
    img = [[[bg[c] / 255] * n for _ in range(n)] for c in range(3)]
    img = [[list(r) for r in ch] for ch in img]
    j = lambda a=1.2: random.uniform(-a, a)

    def rect(x0, y0, x1, y1, col):
        for y in range(max(0, int(y0)), min(n, int(y1))):
            for x in range(max(0, int(x0)), min(n, int(x1))):
                img[0][y][x], img[1][y][x], img[2][y][x] = col[0] / 255, col[1] / 255, col[2] / 255

    def disc(cx, cy, r, col):
        put(img, n, 'circle', cx, cy, r * 2, col)

    ox, oy = j(), j()
    if cls == 0:  # robot
        rect(6 + ox, 6 + oy, 18 + ox, 17 + oy, fg); rect(8 + ox, 9 + oy, 11 + ox, 12 + oy, ac); rect(13 + ox, 9 + oy, 16 + ox, 12 + oy, ac); rect(9 + ox, 14 + oy, 15 + ox, 15.5 + oy, ac); rect(11 + ox, 2 + oy, 13 + ox, 6 + oy, fg); disc(12 + ox, 2.5 + oy, 1.5, ac); rect(8 + ox, 17 + oy, 16 + ox, 22 + oy, fg)
    elif cls == 1:  # rocket
        rect(9 + ox, 6 + oy, 15 + ox, 18 + oy, fg); put(img, n, 'triangle', 12 + ox, 4 + oy, 6, ac); disc(12 + ox, 10 + oy, 1.8, ac); put(img, n, 'triangle', 7.5 + ox, 18 + oy, 5, ac); put(img, n, 'triangle', 16.5 + ox, 18 + oy, 5, ac); rect(10 + ox, 18 + oy, 14 + ox, 21 + oy, (245, 205, 50))
    elif cls == 2:  # sun
        for k in range(8):
            a = k * math.pi / 4
            disc(12 + ox + math.cos(a) * 8.5, 12 + oy + math.sin(a) * 8.5, 1.4, ac)
        disc(12 + ox, 12 + oy, 5.5, fg)
    elif cls == 3:  # house
        rect(6 + ox, 11 + oy, 18 + ox, 21 + oy, fg); put(img, n, 'triangle', 12 + ox, 7 + oy, 15, ac); rect(10.5 + ox, 15 + oy, 13.5 + ox, 21 + oy, bg)
    elif cls == 4:  # tree
        rect(10.5 + ox, 14 + oy, 13.5 + ox, 22 + oy, ac); disc(12 + ox, 9 + oy, 6.5, fg)
    elif cls == 5:  # heart
        disc(9 + ox, 9 + oy, 4, fg); disc(15 + ox, 9 + oy, 4, fg)
        for y in range(10, 20):
            w = (20 - y) * 0.85
            rect(12 + ox - w, y + oy, 12 + ox + w, y + 1 + oy, fg)
    elif cls == 6:  # chip
        rect(7 + ox, 7 + oy, 17 + ox, 17 + oy, fg); rect(10 + ox, 10 + oy, 14 + ox, 14 + oy, ac)
        for k in range(3):
            rect(4 + ox, 8.5 + k * 3 + oy, 7 + ox, 9.5 + k * 3 + oy, ac); rect(17 + ox, 8.5 + k * 3 + oy, 20 + ox, 9.5 + k * 3 + oy, ac); rect(8.5 + k * 3 + ox, 4 + oy, 9.5 + k * 3 + ox, 7 + oy, ac); rect(8.5 + k * 3 + ox, 17 + oy, 9.5 + k * 3 + ox, 20 + oy, ac)
    elif cls == 7:  # star
        for k in range(5):
            a = -math.pi / 2 + k * 2 * math.pi / 5
            for t in range(0, 10):
                d = t * 0.95
                disc(12 + ox + math.cos(a) * d, 12 + oy + math.sin(a) * d, 2.2 * (1 - t / 11) + 0.4, fg)
        disc(12 + ox, 12 + oy, 3, fg)
    return img


def train_image():
    T = 60
    betas = torch.linspace(1e-4, 0.12, T)
    abar = torch.cumprod(1 - betas, 0)

    class Unet(nn.Module):
        def __init__(s):
            super().__init__()
            s.cls = nn.Embedding(8, 8); s.pal = nn.Embedding(4, 4); s.time = nn.Embedding(T, 8)
            s.in1 = nn.Conv2d(3 + 20, 32, 3, 1, 1); s.d1 = nn.Conv2d(32, 48, 3, 2, 1); s.m1 = nn.Conv2d(48 + 20, 64, 3, 1, 1); s.m2 = nn.Conv2d(64, 48, 3, 1, 1)
            s.u1 = nn.Conv2d(48 + 32, 32, 3, 1, 1); s.out = nn.Conv2d(32, 3, 3, 1, 1)

        def forward(s, x, t, c, p):
            e = torch.cat([s.cls(c), s.pal(p), s.time(t)], 1)[:, :, None, None]
            a = F.relu(s.in1(torch.cat([x, e.expand(-1, -1, 24, 24)], 1)))
            b = F.relu(s.d1(a))
            m = F.relu(s.m1(torch.cat([b, e.expand(-1, -1, 12, 12)], 1)))
            m = F.relu(s.m2(m))
            u = F.interpolate(m, scale_factor=2, mode='nearest')
            u = F.relu(s.u1(torch.cat([u, a], 1)))
            return s.out(u)

    net = Unet()
    print('image params', sum(p.numel() for p in net.parameters()), flush=True)
    t0 = time.time()
    X, C, P = [], [], []
    for i in range(4800):
        c, p = i % 8, random.randrange(4)
        X.append(icon(c, p)); C.append(c); P.append(p)
    X = torch.tensor(X) * 2 - 1; C = torch.tensor(C); P = torch.tensor(P)
    print('image data', round(time.time() - t0), flush=True)
    opt = torch.optim.Adam(net.parameters(), 2e-3)
    STEPS = 9000
    for step in range(1, STEPS + 1):
        for g in opt.param_groups:
            g['lr'] = 2e-3 * (0.05 + 0.95 * 0.5 * (1 + math.cos(math.pi * step / STEPS)))
        i = torch.randint(0, len(X), (64,))
        t = torch.randint(0, T, (64,))
        eps = torch.randn_like(X[i])
        a = abar[t][:, None, None, None]
        xt = a.sqrt() * X[i] + (1 - a).sqrt() * eps
        loss = F.mse_loss(net(xt, t, C[i], P[i]), eps)
        opt.zero_grad(); loss.backward(); opt.step()
        if step % 1000 == 0:
            print('image', step, round(loss.item(), 4), round(time.time() - t0), flush=True)
    sd = net.state_dict()
    t = {k.replace('.weight', 'w').replace('.bias', 'b'): v for k, v in sd.items()}
    export(t, {'kind': 'tiny-diffusion', 'T': T, 'size': 24}, out_dir + '/imagegen.safetensors')
    # fixed noise schedule goes with the file
    json.dump({'abar': abar.tolist(), 'T': T}, open(out_dir + '/imagegen.json', 'w'))
    print('image saved', flush=True)


if which in ('vision', 'both'):
    train_vision()
if which in ('image', 'both'):
    train_image()
print('DONE', flush=True)
