#!/usr/bin/env python3
"""MindFlow 아이콘 세트 생성기 — 코드가 곧 원본이다.

옛 tools/gen-icons.js는 손으로 만든 icon-src.png(유리 재질 3D) 안에서 타일 위치를
좌표로 박아두고 잘라내는 구조였다. 아트가 바뀌면 그 좌표가 전부 틀어져서 못 쓴다.
지금 아이콘(레이어드 카드)은 순수 도형이라 아예 그려서 만든다. 색이나 비율을
바꾸고 싶으면 아래 상수만 고치고 다시 돌리면 된다.

  python3 tools/make-icons.py      (프로젝트 루트에서)

full-bleed 불투명 배경이라 출력은 크기별 리사이즈가 전부다. 옛 스크립트가 하던
'투명 배경을 앱 배경색으로 합성'과 'maskable용 축소 배치'가 필요 없어졌다:
  - iOS는 투명 아이콘을 지원하지 않는데, 이제 배경이 불투명이라 문제가 없다.
  - 안드로이드 maskable은 지름 80% 원으로 잘라내는데, 아트가 이미 중앙 55%
    안에 있어 그 원 안에 들어간다(아래 SAFE 검사가 매번 확인한다).
"""
from PIL import Image, ImageDraw
import math, os, sys

# ── 디자인 상수 (1024 기준) ──────────────────────────────────────
S = 1024
SS = 4                      # 슈퍼샘플 배율 — 4096에서 그려 1024로 줄인다

BG_FROM = (0x6E, 0x5B, 0xD0)   # 좌상단 바이올렛
BG_TO   = (0xB8, 0x5E, 0x94)   # 우하단 로즈 (앱 --accent와 동일)
CARD    = (0xFF, 0xFF, 0xFF)
FRONT   = (0xFF, 0xFC, 0xF6)   # 앞 카드는 살짝 크림 — 앱 --surface 결
LINE    = (0xB8, 0x5E, 0x94)   # 앞 카드 위의 줄

# (x0, y0, x1, y1, 반지름, 알파)  뒤 → 앞 순서
CARDS = [
    (300, 240, 756, 540, 52, 0.32),
    (264, 336, 760, 656, 56, 0.55),
    (228, 444, 796, 788, 60, 1.00),
]
LINES = [((304, 572), (660, 572)), ((304, 688), (504, 688))]
LINE_W = 44

OUTPUTS = [
    ('icon-src.png',              1024),   # 마스터 — 다른 도구용 원본
    ('icon-512.png',               512),
    ('icon-192.png',               192),
    ('icon-512-maskable.png',      512),
    ('icon-192-maskable.png',      192),
    ('apple-touch-icon-180.png',   180),
]


def check_safe_zone():
    """아트가 안드로이드 maskable 안전 원(지름 80%) 안에 있는지 검사.

    상수를 건드린 뒤 조용히 모서리가 잘리는 걸 막는다. 카드는 모서리가 둥글어
    실제로는 조금 더 여유가 있지만, 보수적으로 사각 꼭짓점으로 잰다.
    """
    c = S / 2
    safe_r = S * 0.80 / 2
    worst = 0.0
    for x0, y0, x1, y1, *_ in CARDS:
        for px, py in ((x0, y0), (x1, y0), (x0, y1), (x1, y1)):
            worst = max(worst, math.hypot(px - c, py - c))
    ok = worst <= safe_r
    print(f'  안전원 검사: 최대 반경 {worst:.0f} / 허용 {safe_r:.0f}  → {"OK" if ok else "넘침!"}')
    if not ok:
        print('  ! 안드로이드에서 카드 모서리가 잘립니다. CARDS를 안쪽으로 옮기세요.', file=sys.stderr)
    return ok


def make_master():
    n = S * SS

    # 대각 그라디언트 — 작게 만들고 확대한다 (부드러워서 손실이 없다)
    g = 96
    grad = Image.new('RGB', (g, g))
    gp = grad.load()
    for y in range(g):
        for x in range(g):
            t = (x + y) / (2 * (g - 1))
            gp[x, y] = tuple(round(a + (b - a) * t) for a, b in zip(BG_FROM, BG_TO))
    img = grad.resize((n, n), Image.BICUBIC).convert('RGBA')

    # 카드 — 반투명이라 각자 레이어에 그려 알파 합성한다
    for x0, y0, x1, y1, r, alpha in CARDS:
        layer = Image.new('RGBA', (n, n), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        rgb = FRONT if alpha >= 1.0 else CARD
        d.rounded_rectangle(
            [x0 * SS, y0 * SS, x1 * SS, y1 * SS], radius=r * SS,
            fill=(*rgb, round(255 * alpha)))
        img = Image.alpha_composite(img, layer)

    # 앞 카드 위의 줄 — 둥근 끝
    d = ImageDraw.Draw(img)
    for (ax, ay), (bx, by) in LINES:
        d.line([ax * SS, ay * SS, bx * SS, by * SS],
               fill=(*LINE, 255), width=LINE_W * SS)
        for px, py in ((ax, ay), (bx, by)):   # 둥근 캡
            rr = LINE_W * SS / 2
            d.ellipse([px * SS - rr, py * SS - rr, px * SS + rr, py * SS + rr],
                      fill=(*LINE, 255))

    return img.resize((S, S), Image.LANCZOS).convert('RGB')


if __name__ == '__main__':
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(root)
    print('MindFlow 아이콘 생성')
    check_safe_zone()
    master = make_master()
    for name, size in OUTPUTS:
        out = master if size == S else master.resize((size, size), Image.LANCZOS)
        out.save(name, optimize=True)
        kb = os.path.getsize(name) / 1024
        print(f'  {name:<26} {size}x{size}  {kb:6.1f} KB')
