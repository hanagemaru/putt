// PWA アイコンをドット絵として生成する。
//
// 32x32 のグリッドで図案を持ち、最近傍で目的サイズへ拡大する。
// 192 / 512 はセル数の整数倍なのでドットの境界がそのまま出る。
//
//   node scripts/generate-icons.mjs [--preview <出力先>]
//
// 既定の出力先は public/icons/。--preview を渡すと採用前の比較用に
// 2案ぶんを大きめのPNGで書き出すだけで、public/ は触らない。

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

// コースと同じ色を使う（src/config.ts）。日陰だけは fairway から作った暗い緑
const COLOR = {
  fairway: '#74cf5c',
  fairwayShade: '#4f9e42',
  ob: '#27431f',
  flag: '#d94f3d',
  ball: '#f6f8f4',
};

const GRID = 32;

// ---------------------------------------------------------------- 図案

// マスカブル用は安全領域（中央80%の円）へ収めたいので、
// 図の各要素を中央基準で縮める。背景は全面に残す。
function scaler(scale) {
  const c = GRID / 2;
  return {
    x: (v) => c + (v - c) * scale,
    r: (v) => v * scale,
  };
}

// 案A: 俯瞰のカップとボール。旗を使わず「入れる」だけを見せる
function designCupTop(g, scale) {
  const s = scaler(scale);
  fill(g, COLOR.fairway);
  disc(g, s.x(18.6), s.x(13.8), s.r(7), COLOR.fairwayShade);
  disc(g, s.x(17.8), s.x(13), s.r(6.4), COLOR.ob);
  disc(g, s.x(11.4), s.x(23), s.r(3.4), COLOR.fairwayShade);
  disc(g, s.x(10.8), s.x(22.2), s.r(3.4), COLOR.ball);
}

// 案B: 丘の上の旗。遠目のシルエットが強く、コースの3色が全部出る
function designFlagHill(g, scale) {
  const s = scaler(scale);
  fill(g, COLOR.ob);
  disc(g, s.x(16), s.x(45), s.r(27), COLOR.fairway);
  disc(g, s.x(16), s.x(19.5), s.r(2.6), COLOR.ob);
  rect(g, s.x(15), s.x(4), s.r(2), s.r(15.5), COLOR.ball);
  banner(g, s.x(16.8), s.x(4.8), s.r(9.8), s.r(6.4), s.r(2.3), COLOR.flag);
  disc(g, s.x(10.2), s.x(24), s.r(3), COLOR.fairwayShade);
  disc(g, s.x(9.6), s.x(23.2), s.r(3), COLOR.ball);
}

const DESIGNS = {
  a: designCupTop,
  b: designFlagHill,
};

// ---------------------------------------------------------------- 描画

function makeGrid() {
  return new Array(GRID * GRID).fill(COLOR.ob);
}

function put(g, x, y, color) {
  if (x < 0 || y < 0 || x >= GRID || y >= GRID) return;
  g[y * GRID + x] = color;
}

function fill(g, color) {
  g.fill(color);
}

function disc(g, cx, cy, r, color) {
  const rr = r * r;
  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < GRID; x += 1) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= rr) put(g, x, y, color);
    }
  }
}

function rect(g, x0, y0, w, h, color) {
  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < GRID; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      if (px >= x0 && px <= x0 + w && py >= y0 && py <= y0 + h) put(g, x, y, color);
    }
  }
}

// たなびいている四角い旗。竿の側は水平のまま、先へ行くほど下へ流す。
// ドット絵なので段差がそのまま風のニュアンスになる
function banner(g, x0, y0, w, h, amp, color) {
  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < GRID; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      if (px < x0 || px > x0 + w) continue;
      const t = (px - x0) / w;
      const shift = amp * t * t;
      if (py >= y0 + shift && py <= y0 + h + shift) put(g, x, y, color);
    }
  }
}

// ---------------------------------------------------------------- PNG

function rgba(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
    255,
  ];
}

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

// グリッドを最近傍で size へ拡大して PNG バイト列にする
function encodePng(grid, size) {
  const row = Buffer.alloc(1 + size * 4);
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const gy = Math.min(GRID - 1, Math.floor((y * GRID) / size));
    row.fill(0);
    for (let x = 0; x < size; x += 1) {
      const gx = Math.min(GRID - 1, Math.floor((x * GRID) / size));
      const [r, g, b, a] = rgba(grid[gy * GRID + gx]);
      const at = 1 + x * 4;
      row[at] = r;
      row[at + 1] = g;
      row[at + 2] = b;
      row[at + 3] = a;
    }
    rows.push(Buffer.from(row));
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function render(design, scale, size) {
  const grid = makeGrid();
  DESIGNS[design](grid, scale);
  return encodePng(grid, size);
}

function write(path, bytes) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  console.log(`${path} (${bytes.length} bytes)`);
}

// ---------------------------------------------------------------- 実行

const args = process.argv.slice(2);
const previewAt = args.indexOf('--preview');

if (previewAt >= 0) {
  const out = args[previewAt + 1] ?? join(ROOT, 'icon-preview');
  for (const design of Object.keys(DESIGNS)) {
    write(join(out, `${design}-normal.png`), render(design, 1, 256));
    write(join(out, `${design}-maskable.png`), render(design, 0.72, 256));
  }
} else {
  // 採用案。--preview で比べたうえで決める
  const design = process.env.PUTT_ICON_DESIGN ?? 'b';
  const out = join(ROOT, 'public', 'icons');
  write(join(out, 'icon-192.png'), render(design, 1, 192));
  write(join(out, 'icon-512.png'), render(design, 1, 512));
  write(join(out, 'icon-maskable-192.png'), render(design, 0.72, 192));
  write(join(out, 'icon-maskable-512.png'), render(design, 0.72, 512));
  write(join(out, 'apple-touch-icon-180.png'), render(design, 1, 180));
}
