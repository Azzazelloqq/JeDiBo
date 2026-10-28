// Пиксельные цифры JeDiBo: крошечный TTF только с 0–9 на сетке Tiny5 (em = 8 пикселей, цифра 4×5).
// У Tiny5 цифры шириной 3 px: «8» похожа на «$», «0» перечёркнут. Этот шрифт подключается перед Tiny5
// с unicode-range U+0030-0039 (src/styles/fonts.css), буквы остаются от Tiny5.
// Запуск: node scripts/pixel-digits.mjs → src/assets/fonts/jedibo-digits.ttf (результат коммитится).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 4×5, свет не нужен — это шрифт. Ширина штриха 1 px, как у Tiny5.
const DIGITS = {
  0: ['.##.', '#..#', '#..#', '#..#', '.##.'],
  1: ['..#.', '.##.', '..#.', '..#.', '.###'],
  2: ['###.', '...#', '.##.', '#...', '####'],
  3: ['###.', '...#', '.##.', '...#', '###.'],
  4: ['#..#', '#..#', '####', '...#', '...#'],
  5: ['####', '#...', '###.', '...#', '###.'],
  6: ['.##.', '#...', '###.', '#..#', '.##.'],
  7: ['####', '...#', '..#.', '.#..', '.#..'],
  8: ['.##.', '#..#', '.##.', '#..#', '.##.'],
  9: ['.##.', '#..#', '.###', '...#', '.##.'],
};

const UPM = 1000;
const P = UPM / 8; // один пиксель Tiny5
const ASC = 7 * P;
const DESC = 2 * P;
const ADV = 5 * P; // 4 px цифра + 1 px пробел, как у заглавных Tiny5

/** Контуры глифа: горизонтальные отрезки строк → прямоугольники по часовой стрелке (TrueType). */
function contours(rows) {
  const out = [];
  rows.forEach((row, r) => {
    const y0 = (rows.length - 1 - r) * P;
    for (let c = 0; c < row.length; c++) {
      if (row[c] !== '#') continue;
      let e = c;
      while (row[e + 1] === '#') e++;
      const x0 = c * P;
      const x1 = (e + 1) * P;
      out.push([[x0, y0], [x0, y0 + P], [x1, y0 + P], [x1, y0]]);
      c = e;
    }
  });
  return out;
}

class Buf {
  constructor() { this.b = []; }
  u8(v) { this.b.push(v & 255); return this; }
  u16(v) { return this.u8(v >> 8).u8(v); }
  i16(v) { return this.u16(v < 0 ? v + 65536 : v); }
  u32(v) { return this.u16(Math.floor(v / 65536) & 0xffff).u16(v & 0xffff); }
  bytes(a) { for (const x of a) this.u8(x); return this; }
  pad4() { while (this.b.length % 4) this.u8(0); return this; }
  get length() { return this.b.length; }
}

const glyphs = [{ name: '.notdef', cs: [] }, ...Object.entries(DIGITS).map(([d, rows]) => ({ name: d, cs: contours(rows) }))];

// glyf + loca (короткий формат: смещение / 2, глифы выровнены по 2 байта)
const glyf = new Buf();
const loca = [];
let maxPoints = 0;
let maxContours = 0;
for (const g of glyphs) {
  loca.push(glyf.length / 2);
  if (!g.cs.length) continue;
  const pts = g.cs.flat();
  maxPoints = Math.max(maxPoints, pts.length);
  maxContours = Math.max(maxContours, g.cs.length);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  g.bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  glyf.i16(g.cs.length).i16(g.bbox[0]).i16(g.bbox[1]).i16(g.bbox[2]).i16(g.bbox[3]);
  let end = -1;
  for (const c of g.cs) glyf.u16((end += c.length));
  glyf.u16(0); // без инструкций
  for (let i = 0; i < pts.length; i++) glyf.u8(1); // все точки на кривой, координаты int16
  let px = 0;
  for (const [x] of pts) glyf.i16(x - px), (px = x);
  let py = 0;
  for (const [, y] of pts) glyf.i16(y - py), (py = y);
  if (glyf.length % 2) glyf.u8(0);
}
loca.push(glyf.length / 2);

const head = new Buf()
  .u32(0x00010000).u32(0x00010000).u32(0).u32(0x5f0f3cf5).u16(0x000b).u16(UPM)
  .u32(0).u32(0).u32(0).u32(0) // created / modified
  .i16(0).i16(0).i16(4 * P).i16(5 * P)
  .u16(0).u16(8).i16(2).i16(0).i16(0);

const hhea = new Buf()
  .u32(0x00010000).i16(ASC).i16(-DESC).i16(0).u16(ADV).i16(0).i16(P).i16(4 * P)
  .i16(1).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0).i16(0).u16(glyphs.length);

const maxp = new Buf().u32(0x00010000).u16(glyphs.length).u16(maxPoints).u16(maxContours)
  .u16(0).u16(0).u16(2).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0).u16(0);

const os2 = new Buf()
  .u16(4).i16(ADV).u16(400).u16(5).u16(0)
  .i16(P * 4).i16(P * 4).i16(0).i16(P).i16(P * 4).i16(P * 4).i16(0).i16(P * 3).i16(P).i16(P * 2)
  .i16(0).bytes([0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  .u32(1).u32(0).u32(0).u32(0).bytes([...'JDBO'].map((c) => c.charCodeAt(0)))
  .u16(0x40).u16(0x30).u16(0x39).i16(ASC).i16(-DESC).i16(0).u16(ASC).u16(DESC)
  .u32(1).u32(0).i16(4 * P).i16(5 * P).u16(0).u16(32).u16(1);

const hmtx = new Buf();
for (const g of glyphs) hmtx.u16(ADV).i16(g.bbox ? g.bbox[0] : 0);

// cmap: один сегмент 0x30–0x39 → глифы 1–10
const cmap = new Buf().u16(0).u16(1).u16(3).u16(1).u32(12)
  .u16(4).u16(32).u16(0).u16(4).u16(4).u16(1).u16(0)
  .u16(0x39).u16(0xffff).u16(0).u16(0x30).u16(0xffff).i16(1 - 0x30).i16(1).u16(0).u16(0);

const NAMES = { 1: 'JeDiBo Digits', 2: 'Regular', 3: 'JeDiBo Digits Regular', 4: 'JeDiBo Digits', 5: 'Version 1.0', 6: 'JeDiBoDigits-Regular' };
const strs = Object.entries(NAMES).map(([id, s]) => [Number(id), [...s].flatMap((ch) => [0, ch.charCodeAt(0)])]);
const name = new Buf().u16(0).u16(strs.length).u16(6 + 12 * strs.length);
let off = 0;
for (const [id, b] of strs) name.u16(3).u16(1).u16(0x409).u16(id).u16(b.length).u16(off), (off += b.length);
for (const [, b] of strs) name.bytes(b);

const post = new Buf().u32(0x00030000).u32(0).i16(-P).i16(P).u32(0).u32(0).u32(0).u32(0).u32(0);

const locaBuf = new Buf();
for (const o of loca) locaBuf.u16(o);

const tables = { 'OS/2': os2, cmap, glyf, head, hhea, hmtx, loca: locaBuf, maxp, name, post };
const tags = Object.keys(tables).sort();
const sum = (bytes) => {
  let s = 0;
  for (let i = 0; i < bytes.length; i += 4) s = (s + ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3])) >>> 0;
  return s;
};

const n = tags.length;
const es = Math.floor(Math.log2(n));
const font = new Buf().u32(0x00010000).u16(n).u16(16 * 2 ** es).u16(es).u16(16 * n - 16 * 2 ** es);
let offset = 12 + 16 * n;
const bodies = [];
let headOffset = 0;
for (const t of tags) {
  const raw = tables[t].b;
  const padded = [...raw];
  while (padded.length % 4) padded.push(0);
  if (t === 'head') headOffset = offset;
  font.bytes([...t.padEnd(4, ' ')].map((c) => c.charCodeAt(0))).u32(sum(padded)).u32(offset).u32(raw.length);
  bodies.push(padded);
  offset += padded.length;
}
for (const b of bodies) font.bytes(b);
const all = font.b;
const adj = (0xb1b0afba - sum(all)) >>> 0;
all[headOffset + 8] = adj >>> 24;
all[headOffset + 9] = (adj >>> 16) & 255;
all[headOffset + 10] = (adj >>> 8) & 255;
all[headOffset + 11] = adj & 255;

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../src/assets/fonts/jedibo-digits.ttf');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Uint8Array.from(all));
console.log(`${out}: ${all.length} байт, глифов ${glyphs.length}`);
