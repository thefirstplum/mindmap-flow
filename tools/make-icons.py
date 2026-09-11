#!/usr/bin/env python3
"""icon-src.png 에서 PWA 아이콘 세트를 만든다.

  python3 tools/make-icons.py        (어디서 실행하든 프로젝트 루트를 찾는다)

원본은 정사각형 full-bleed 불투명 이미지여야 한다. 그 전제가 지켜지면 출력은
크기별 리사이즈가 전부다 — 옛 tools/gen-icons.js가 하던 '투명 배경을 앱
배경색으로 합성'과 '유리 타일 좌표로 크롭'이 모두 불필요해졌다. 그 스크립트는
특정 아트의 픽셀 좌표(x236-785 등)가 박혀 있어 아트가 바뀌면 못 쓰는 물건이었다.

전제가 깨지면 조용히 이상한 아이콘이 나오므로, 만들기 전에 검사한다:
  1) 정사각형인가
  2) 네 모서리가 불투명인가 — 투명하면 iOS가 검정으로 합성해 테두리가 생긴다
  3) 둥근 모서리를 그려 넣지 않았는가 — iOS가 또 마스킹해서 '액자 속 액자'가 된다
  4) 밝은 아트가 안드로이드 maskable 안전원(지름 80%) 안에 있는가
"""
from PIL import Image
import math, os, sys

SRC = 'icon-src.png'
MASTER = 1024

# (파일명, 크기, 모서리를 둥글게 깎을 것인가)
#
# purpose=any 만 깎는다. 이 아이콘은 플랫폼이 마스킹하지 않고 **그린 그대로** 쓰인다.
# 안드로이드 스플래시가 대표적인데, background_color(크림) 위에 이 그림을 얹으므로
# 각진 불투명 사각형이면 보라색 사각형 덩어리가 그대로 보인다(사장님 제보).
# 둥글게 깎고 바깥을 투명으로 두면 앱 아이콘처럼 떠 보인다.
#
# maskable 은 반대다 — 플랫폼이 원/스퀘어클로 잘라내므로 가장자리까지 꽉 차야 한다.
# apple-touch 도 깎지 않는다. iOS는 투명을 검정으로 합성하고, 어차피 자체 마스크를
# 씌우므로 깎아두면 모서리에 검은 자국이 남는다.
RADIUS = 0.2237          # iOS 스퀘어클과 같은 비율
OUTPUTS = [
    ('icon-512.png',             512, True),
    ('icon-192.png',             192, True),
    ('icon-512-maskable.png',    512, False),
    ('icon-192-maskable.png',    192, False),
    ('apple-touch-icon-180.png', 180, False),
]


def round_corners(im):
    """모서리를 둥글게 깎고 바깥을 투명으로. 4배 슈퍼샘플로 계단 제거."""
    from PIL import ImageDraw
    n = im.size[0]
    mask = Image.new('L', (n * 4, n * 4), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, n * 4 - 1, n * 4 - 1], radius=int(n * 4 * RADIUS), fill=255)
    out = im.convert('RGBA')
    out.putalpha(mask.resize((n, n), Image.LANCZOS))
    return out


def check(im):
    """원본이 아이콘으로 쓸 수 있는 상태인지. 치명적이면 False."""
    ok = True
    W, H = im.size
    print(f'  원본 {W}x{H}')
    if W != H:
        print('  ! 정사각형이 아닙니다 — 리사이즈에서 찌그러집니다', file=sys.stderr)
        ok = False

    px = im.load()
    pts = {'좌상': (2, 2), '우상': (W - 3, 2), '좌하': (2, H - 3), '우하': (W - 3, H - 3)}
    alphas = [px[x, y][3] for x, y in pts.values()]
    if min(alphas) < 255:
        print('  ! 모서리가 투명합니다 — iOS가 검정으로 합성해 테두리가 생깁니다', file=sys.stderr)
        ok = False
    else:
        # 모서리가 불투명이어도 '둥근 사각형을 그려 넣은' 경우가 있다.
        # 모서리 색이 그 대각 안쪽(5% 지점) 색과 크게 다르면 의심한다.
        for name, (x, y) in pts.items():
            ix = min(max(int(W * .05), 0), W - 1) if x < W / 2 else min(int(W * .95), W - 1)
            iy = min(max(int(H * .05), 0), H - 1) if y < H / 2 else min(int(H * .95), H - 1)
            d = sum(abs(a - b) for a, b in zip(px[x, y][:3], px[ix, iy][:3]))
            if d > 150:
                print(f'  ! {name} 모서리가 안쪽과 많이 다릅니다 — 둥근 모서리를 '
                      f'그려 넣었는지 확인하세요 (차이 {d})', file=sys.stderr)

    # 밝은 아트의 범위 → maskable 안전원 검사
    s = im.convert('RGB').resize((256, 256), Image.LANCZOS)
    sp = s.load()
    xs, ys = [], []
    for y in range(256):
        for x in range(256):
            r, g, b = sp[x, y]
            if r > 225 and g > 215 and b > 210:
                xs.append(x); ys.append(y)
    if xs:
        x0, x1 = min(xs) / 256 * W, max(xs) / 256 * W
        y0, y1 = min(ys) / 256 * H, max(ys) / 256 * H
        c = W / 2
        worst = max(math.hypot(px_ - c, py_ - c) for px_ in (x0, x1) for py_ in (y0, y1))
        safe = W * 0.80 / 2
        mark = 'OK' if worst <= safe else '넘침!'
        print(f'  아트 폭 {(x1 - x0) / W * 100:.1f}% · 안전원 {worst:.0f}/{safe:.0f} → {mark}')
        if worst > safe:
            print('  ! 안드로이드 원형 크롭에서 모서리가 잘립니다. 아트를 더 작게 그리세요.',
                  file=sys.stderr)
    else:
        print('  아트 범위를 못 찾았습니다 (밝은 영역 없음) — 안전원 검사 건너뜀')
    return ok


if __name__ == '__main__':
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(root)
    if not os.path.exists(SRC):
        sys.exit(f'{SRC} 가 없습니다. 1024x1024 정사각형 PNG를 그 이름으로 두세요.')

    print(f'MindFlow 아이콘 생성 ({SRC})')
    im = Image.open(SRC).convert('RGBA')
    if not check(im):
        sys.exit('원본 검사 실패 — 중단합니다.')

    # 마스터를 1024로 정규화해 되쓴다 (원본이 더 크면 줄이고, 그 결과로 파생본을 만든다)
    if im.size != (MASTER, MASTER):
        im = im.resize((MASTER, MASTER), Image.LANCZOS)
        im.convert('RGB').save(SRC, optimize=True)
        print(f'  {SRC} 를 {MASTER}x{MASTER} 로 정규화')

    master = im.convert('RGB')
    for name, size, rounded in OUTPUTS:
        out = master.resize((size, size), Image.LANCZOS)
        if rounded:
            out = round_corners(out)
        out.save(name, optimize=True)
        shape = '둥근 모서리' if rounded else 'full-bleed'
        print(f'  {name:<26} {size}x{size}  {shape:<10} {os.path.getsize(name) / 1024:6.1f} KB')
