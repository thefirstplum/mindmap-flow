// Build the PWA icon set from icon-src.png.
//
// Source measured (scratchpad/png.js): 1024x1024 RGBA, background fully
// transparent, glass tile occupies x236-785 / y213-796 (550x584) with a soft
// glow + drop shadow extending to y828 — only 53.8% of the canvas.
//
// Two problems to fix:
//   1. iOS does not support transparent app icons (composites on black/white),
//      so every output is flattened onto the app's own background_color #0f1117.
//   2. The art is too small and off-centre. We crop a square around the tile
//      and re-place it at a size chosen per icon purpose.
//
// Purpose sizing:
//   any       -> 0.80  normal launcher icon, generous but not edge-to-edge
//   maskable  -> 0.60  Android crops to a circle; everything important must sit
//                      inside the inner ~80% diameter, so keep the art smaller
//   apple     -> 0.80  iOS applies its own squircle mask to the full square
const fs = require('fs');
const zlib = require('zlib');

// ---------- PNG decode (8-bit, non-interlaced) ----------
function decodePNG(path) {
  const buf = fs.readFileSync(path);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8, W = 0, H = 0, depth = 0, ctype = 0, interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      W = data.readUInt32BE(0); H = data.readUInt32BE(4);
      depth = data[8]; ctype = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8 || interlace !== 0) throw new Error('unsupported PNG variant');
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ctype];
  if (!ch) throw new Error('colour type ' + ctype);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = W * ch;
  const out = Buffer.alloc(H * stride);
  let p = 0;
  for (let y = 0; y < H; y++) {
    const filter = raw[p++];
    const line = raw.subarray(p, p + stride); p += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const A = x >= ch ? cur[x - ch] : 0;
      const B = prev ? prev[x] : 0;
      const C = (prev && x >= ch) ? prev[x - ch] : 0;
      let v = line[x];
      if (filter === 1) v += A;
      else if (filter === 2) v += B;
      else if (filter === 3) v += (A + B) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(B - C), pb = Math.abs(A - C), pc = Math.abs(A + B - 2 * C);
        v += (pa <= pb && pa <= pc) ? A : (pb <= pc ? B : C);
      } else if (filter !== 0) throw new Error('filter ' + filter);
      cur[x] = v & 0xff;
    }
  }
  return { W, H, ch, data: out };
}

// ---------- PNG encode (RGB, opaque) ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(W, H, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGB
  const stride = W * 3;
  const raw = Buffer.alloc(H * (stride + 1));
  for (let y = 0; y < H; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- build ----------
const src = decodePNG('icon-src.png');
const BG = { r: 0x0f, g: 0x11, b: 0x17 }; // app background_color / theme

// 유리 타일 실측: x236-785, y213-796 → 550 wide x 584 tall (세로가 34px 더 김).
// 타일 중심.
const cx = (236 + 785) / 2, cy = (213 + 796) / 2;

// crop 크기를 용도별로 다르게 잡는다.
//   TIGHT(550) — 타일 '폭'에 맞춘 정사각형. 세로는 타일보다 34px 짧으므로
//                타일의 위아래 둥근 모서리가 약간 잘리고, 좌우는 정확히
//                가장자리에 닿는다 → fill 1.0으로 렌더하면 남색 여백 없이
//                꽉 찬다. 왜곡(비균등 스케일) 없이 순수 crop만 사용.
//   LOOSE(620) — 타일 전체 + 글로우까지 포함. 안드로이드 maskable용으로
//                작게 배치할 때 잘린 모서리가 보이면 어색하므로 원형 그대로.
const CROP_TIGHT = 550;
const CROP_LOOSE = 620;
function cropOrigin(size) {
  const x0 = Math.round(cx - size / 2), y0 = Math.round(cy - size / 2);
  if (x0 < 0 || y0 < 0 || x0 + size > src.W || y0 + size > src.H) {
    throw new Error(`crop ${size} at ${x0},${y0} falls outside the source`);
  }
  return { x0, y0 };
}

// Bilinear sample of the cropped square, returning premultiplied-over-BG RGB.
function sampleOverBG(u, v, cx0, cy0, CROP) { // u,v in [0,1) within the crop
  const fx = cx0 + u * (CROP - 1), fy = cy0 + v * (CROP - 1);
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, src.W - 1), y1 = Math.min(y0 + 1, src.H - 1);
  const tx = fx - x0, ty = fy - y0;
  let r = 0, g = 0, b = 0, a = 0;
  for (const [px, py, w] of [
    [x0, y0, (1 - tx) * (1 - ty)], [x1, y0, tx * (1 - ty)],
    [x0, y1, (1 - tx) * ty], [x1, y1, tx * ty],
  ]) {
    const i = (py * src.W + px) * src.ch;
    const pa = src.data[i + 3] / 255;
    // premultiply so transparent pixels don't drag their RGB into the blend
    r += src.data[i] * pa * w; g += src.data[i + 1] * pa * w; b += src.data[i + 2] * pa * w;
    a += pa * w;
  }
  return {
    r: r + BG.r * (1 - a),
    g: g + BG.g * (1 - a),
    b: b + BG.b * (1 - a),
  };
}

function render(N, fill, CROP) {
  const { x0: cx0, y0: cy0 } = cropOrigin(CROP);
  const rgb = Buffer.alloc(N * N * 3);
  // fill background
  for (let i = 0; i < N * N; i++) { rgb[i * 3] = BG.r; rgb[i * 3 + 1] = BG.g; rgb[i * 3 + 2] = BG.b; }
  const artN = Math.round(N * fill);
  const off = Math.round((N - artN) / 2);
  // supersample: average SS x SS samples per output pixel (crop is downscaled a lot)
  const SS = Math.max(2, Math.min(4, Math.ceil(CROP / artN)));
  for (let y = 0; y < artN; y++) {
    for (let x = 0; x < artN; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const c = sampleOverBG((x + (sx + 0.5) / SS) / artN, (y + (sy + 0.5) / SS) / artN, cx0, cy0, CROP);
        r += c.r; g += c.g; b += c.b;
      }
      const n = SS * SS, i = ((y + off) * N + (x + off)) * 3;
      rgb[i] = Math.round(r / n); rgb[i + 1] = Math.round(g / n); rgb[i + 2] = Math.round(b / n);
    }
  }
  return encodePNG(N, N, rgb);
}

//   any / apple : TIGHT crop + fill 1.0 → 타일이 캔버스 가장자리에 정확히 닿는다.
//                 남색 배경은 타일의 둥근 모서리 안쪽에만 남고, 그마저 iOS의
//                 squircle 마스크가 잘라내므로 홈화면에선 완전히 꽉 차 보인다.
//   maskable    : LOOSE crop + fill 0.62 — 안드로이드는 지름 80% 원으로 잘라낸다.
//                 그 원에 내접하는 정사각형 한 변이 0.8/√2 ≈ 0.566이라 이보다
//                 크면 모서리가 잘린다. 단독으로 보면 작지만 이게 정상 동작.
const jobs = [
  ['icon-192.png', 192, 1.0, CROP_TIGHT],
  ['icon-512.png', 512, 1.0, CROP_TIGHT],
  ['icon-192-maskable.png', 192, 0.74, CROP_LOOSE],
  ['icon-512-maskable.png', 512, 0.74, CROP_LOOSE],
  ['apple-touch-icon-180.png', 180, 1.0, CROP_TIGHT],
];
for (const [name, N, fill, crop] of jobs) {
  fs.writeFileSync(name, render(N, fill, crop));
  console.log(`${name.padEnd(26)} ${N}x${N}  fill ${Math.round(fill * 100)}%  crop ${crop}  ${(fs.statSync(name).size / 1024).toFixed(1)} KB`);
}
