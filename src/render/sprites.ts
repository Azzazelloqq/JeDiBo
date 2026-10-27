// Программные спрайты: фигуры из гранита/базальта, бетонные плиты поля, рубашка Кармы, аватары.
import { Rank } from '../core/types';
import { PAL, STONE, type StoneColor } from './palette';
import { concreteTile, fromAscii, hardenAlpha, hashStr, hexToRgb, makeCanvas, outline, px, seeded, type Canvas, type Mask } from './pixel';

export const CELL = 16;
const FACE_W = 12;
const FACE_H = 10;
const DEPTH = 3;

function faceMask(rank: Rank, up: boolean): Mask {
  switch (rank) {
    case Rank.Triangle:
      return (x, y) => {
        const yy = up ? y : FACE_H - 1 - y;
        const half = ((yy + 1) / FACE_H) * 6.2;
        return Math.abs(x + 0.5 - 6) <= half;
      };
    case Rank.Square:
      // скошенные углы — «тёсаный камень»
      return (x, y) => !((x === 0 || x === FACE_W - 1) && (y === 0 || y === FACE_H - 1));
    default:
      return (x, y) => ((x + 0.5 - 6) / 6) ** 2 + ((y + 0.5 - 5) / 5) ** 2 <= 1.02;
  }
}

const spriteCache = new Map<string, Canvas>();

/** Спрайт фигуры 16×16: верхняя грань + боковая «толщина» + контур. */
export function pieceSprite(rank: Rank, color: StoneColor, up: boolean, variant: 'normal' | 'flash' = 'normal'): Canvas {
  const k = `${rank}${color}${up}${variant}`;
  const hit = spriteCache.get(k);
  if (hit) return hit;
  const st = STONE[color];
  const [c, g] = makeCanvas(CELL, CELL);
  const ox = 2;
  const oy = 1;
  const m = faceMask(rank, up);
  const inFace = (x: number, y: number) => x >= 0 && y >= 0 && x < FACE_W && y < FACE_H && m(x, y);
  const rnd = seeded(rank * 31 + (color === 'red' ? 7 : 3) + (up ? 1 : 0));

  if (variant === 'flash') {
    for (let d = DEPTH; d >= 0; d--)
      for (let y = 0; y < FACE_H; y++) for (let x = 0; x < FACE_W; x++) if (inFace(x, y)) px(g, ox + x, oy + y + d, PAL.bone);
    const out = outline(c, PAL.bone);
    spriteCache.set(k, out);
    return out;
  }

  // боковая грань
  for (let d = DEPTH; d >= 1; d--)
    for (let y = 0; y < FACE_H; y++)
      for (let x = 0; x < FACE_W; x++) {
        if (!inFace(x, y)) continue;
        let col: string = d === 1 ? st.base : st.side;
        if (d > 1 && rnd() < 0.12) col = st.speckDark;
        if (x > FACE_W * 0.6 && d === 1) col = st.side;
        px(g, ox + x, oy + y + d, col);
      }
  // верхняя грань: гранит + свет слева-сверху
  for (let y = 0; y < FACE_H; y++)
    for (let x = 0; x < FACE_W; x++) {
      if (!inFace(x, y)) continue;
      const top = !inFace(x, y - 1);
      const left = !inFace(x - 1, y);
      const right = !inFace(x + 1, y);
      const bottom = !inFace(x, y + 1);
      let col: string = st.base;
      const r = rnd();
      if (r < 0.07) col = st.speckLight;
      else if (r < 0.16) col = st.speckDark;
      else if (r < 0.32) col = st.light;
      if (top || (left && y < FACE_H * 0.7)) col = st.hi;
      else if (right || bottom) col = st.light === col ? st.base : col === st.base ? st.side : col;
      px(g, ox + x, oy + y, col);
    }
  // блик
  const hx = rank === Rank.Triangle ? 5 : 2;
  const hy = rank === Rank.Triangle ? (up ? 4 : 2) : 2;
  if (inFace(hx, hy)) px(g, ox + hx, oy + hy, PAL.bone);

  const out = outline(c, st.outline);
  spriteCache.set(k, out);
  return out;
}

/** Бетонная плитка клетки. Небольшие вариации и трещины по сиду. */
export function cellTile(x: number, y: number): Canvas {
  const seed = x * 97 + y * 13 + 5;
  const rnd = seeded(seed);
  const shade = (x + y) % 2 === 0 ? 0 : -8;
  const base = hexToRgb(PAL.concrete200).map((v) => v + shade + Math.floor(rnd() * 6 - 3)) as [number, number, number];
  const t = concreteTile(CELL, CELL, base, seed, { pores: 3 + Math.floor(rnd() * 3), amp: 9 });
  const g = t.getContext('2d')!;
  // фаска плиты: свет сверху/слева, тень справа/снизу
  g.fillStyle = 'rgba(255,255,255,0.18)';
  g.fillRect(0, 0, CELL, 1);
  g.fillRect(0, 0, 1, CELL);
  g.fillStyle = 'rgba(40,36,32,0.35)';
  g.fillRect(0, CELL - 1, CELL, 1);
  g.fillRect(CELL - 1, 0, 1, CELL);
  // редкая волосяная трещина
  if (rnd() < 0.1) {
    let cx = 2 + Math.floor(rnd() * 10);
    let cy = 2 + Math.floor(rnd() * 4);
    g.fillStyle = 'rgba(60,55,50,0.22)';
    for (let i = 0; i < 6; i++) {
      g.fillRect(cx, cy, 1, 1);
      cx += Math.round(rnd() * 2 - 1);
      cy += 1;
    }
  }
  return t;
}

/** Рубашка Карты Кармы: базальт + красная руна-глаз. */
export function cardBack(w = 52, h = 72): Canvas {
  const [c, g] = makeCanvas(w, h);
  const slab = concreteTile(w, h, hexToRgb(PAL.slab800), 77, { pores: 40, seams: true, amp: 8 });
  g.drawImage(slab, 0, 0);
  // рамка
  g.fillStyle = PAL.slab600;
  g.fillRect(2, 2, w - 4, 1);
  g.fillRect(2, 2, 1, h - 4);
  g.fillStyle = PAL.void;
  g.fillRect(2, h - 3, w - 4, 1);
  g.fillRect(w - 3, 2, 1, h - 4);
  g.fillStyle = PAL.blood700;
  g.fillRect(4, 4, w - 8, 1);
  g.fillRect(4, h - 5, w - 8, 1);
  g.fillRect(4, 4, 1, h - 8);
  g.fillRect(w - 5, 4, 1, h - 8);
  // стяжки опалубки в углах
  for (const [x, y] of [[7, 7], [w - 9, 7], [7, h - 9], [w - 9, h - 9]]) {
    px(g, x, y, PAL.void, 2, 2);
    px(g, x, y + 2, PAL.slab600, 2, 1);
  }
  const rune = fromAscii(RUNE, { R: PAL.blood500, r: PAL.blood400, y: PAL.amber300, d: PAL.blood700 }, 3);
  // пиксельное свечение: несколько расширенных слоёв с малой альфой
  const rx = Math.floor((w - rune.width) / 2);
  const ry = Math.floor((h - rune.height) / 2);
  g.globalAlpha = 0.25;
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-2, 0], [2, 0], [0, -2], [0, 2]]) g.drawImage(rune, rx + dx, ry + dy);
  g.globalAlpha = 1;
  g.drawImage(outline(rune, PAL.blood900), rx, ry);
  return c;
}

const RUNE = [
  '.......R.......',
  '......R.R......',
  '.....R...R.....',
  '....R.ddd.R....',
  '...R.d...d.R...',
  '..R.d.RRR.d.R..',
  '.R.d.RryrR.d.R.',
  'R..d.RyyyR.d..R',
  '.R.d.RryrR.d.R.',
  '..R.d.RRR.d.R..',
  '...R.d...d.R...',
  '....R.ddd.R....',
  '.....R...R.....',
  '......R.R......',
  '.......R.......',
];

/** Аватар-идентикон 8×8 (симметричный) из имени. */
export function avatar(seedStr: string, size = 10): Canvas {
  const rnd = seeded(hashStr(seedStr));
  const [c, g] = makeCanvas(size, size);
  const bgs = [PAL.slab700, PAL.concrete500, PAL.blood800, PAL.patina700, PAL.amber700];
  const fgs = [PAL.bone, PAL.blood400, PAL.amber300, PAL.patina300, PAL.concrete200];
  const bg = bgs[Math.floor(rnd() * bgs.length)];
  const fg = fgs[Math.floor(rnd() * fgs.length)];
  g.fillStyle = bg;
  g.fillRect(0, 0, size, size);
  const inner = size - 2;
  const half = Math.ceil(inner / 2);
  for (let y = 0; y < inner; y++)
    for (let x = 0; x < half; x++)
      if (rnd() < 0.5) {
        px(g, 1 + x, 1 + y, fg);
        px(g, 1 + inner - 1 - x, 1 + y, fg);
      }
  return c;
}

/** Крупный пиксельный текст с бетонной фактурой и красной экструзией (логотип, баннеры). */
export function stoneTitle(text: string, opts: { size?: number; depth?: number; face?: string; side?: string; edge?: string; font?: string } = {}): Canvas {
  const size = opts.size ?? 22;
  const depth = opts.depth ?? 3;
  const font = opts.font ? `700 ${size}px "${opts.font}", monospace` : `${size}px "Tiny5", monospace`;
  const [, mg] = makeCanvas(4, 4);
  mg.font = font;
  const w = Math.ceil(mg.measureText(text).width) + 4;
  const h = Math.ceil(size * 1.2);
  const [t, tg] = makeCanvas(w, h);
  tg.font = font;
  tg.textBaseline = 'top';
  tg.fillStyle = '#fff';
  tg.fillText(text, 2, Math.floor(size * 0.08));
  hardenAlpha(tg, w, h);

  // лицевая сторона — бетон
  const [face, fg] = makeCanvas(w, h);
  fg.drawImage(concreteTile(w, h, hexToRgb(opts.face ?? PAL.concrete100), hashStr(text), { pores: Math.floor(w * h / 30), amp: 14 }), 0, 0);
  fg.globalCompositeOperation = 'destination-in';
  fg.drawImage(t, 0, 0);
  fg.globalCompositeOperation = 'source-over';
  // светлый верхний кант
  const [hl, hg] = makeCanvas(w, h);
  hg.drawImage(t, 0, 0);
  hg.globalCompositeOperation = 'destination-out';
  hg.drawImage(t, 0, 1);
  fg.globalAlpha = 0.6;
  fg.drawImage(tint(hl, '#ffffff'), 0, 0);
  fg.globalAlpha = 1;

  const [out, og] = makeCanvas(w + depth + 2, h + depth + 2);
  const side = tint(t, opts.side ?? PAL.blood600);
  const sideDark = tint(t, opts.edge ?? PAL.blood800);
  for (let d = depth; d >= 1; d--) og.drawImage(d === depth ? sideDark : side, 1 + d, 1 + d);
  og.drawImage(face, 1, 1);
  return outline(out, PAL.void, true);
}

export function tint(src: Canvas, color: string): Canvas {
  const [c, g] = makeCanvas(src.width, src.height);
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, src.width, src.height);
  return c;
}

/** Плитка бетона для CSS-фона панелей (data URL). */
export function concreteCss(hex: string, seed: number, w = 96, h = 96): string {
  return concreteTile(w, h, hexToRgb(hex), seed, { pores: 70, seams: true, amp: 7 }).toDataURL();
}
