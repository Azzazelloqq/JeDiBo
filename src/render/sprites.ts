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

/** Геометрия знака логотипа в модулях сетки 7×7 (та же, что в src/assets/logo/jedibo-mark.svg). */
function inMark(x: number, y: number): boolean {
  const box = (x0: number, y0: number, w: number, h: number) => x >= x0 && x < x0 + w && y >= y0 && y < y0 + h;
  const disk = (cx: number, cy: number, r: number) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  return (
    box(3, 0, 1, 1) || box(3, 6, 1, 1) || box(1, 1, 2, 2) || box(4, 4, 2, 2) ||
    (box(4, 1, 2, 2) && disk(6, 1, 2)) || // четверть круга справа сверху
    (box(1, 4, 2, 2) && disk(1, 6, 2)) || // четверть круга слева снизу
    disk(0.5, 3.5, 0.5) || disk(6.5, 3.5, 0.5)
  );
}

const markCache = new Map<string, Canvas>();

/** Пиксельный знак логотипа для мелких размеров: модуль = k пикселей, сторона 7k.
 *  Пиксель закрашен, если его центр внутри векторной формы — кривые становятся «лесенкой» на сетке модуля. */
export function logoMark(k = 3, color: string = PAL.brand500): Canvas {
  const key = `${k}${color}`;
  const hit = markCache.get(key);
  if (hit) return hit;
  const n = 7 * k;
  const [c, g] = makeCanvas(n, n);
  g.fillStyle = color;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (inMark((x + 0.5) / k, (y + 0.5) / k)) g.fillRect(x, y, 1, 1);
  markCache.set(key, c);
  return c;
}

/** Рубашка Карты Кармы: светлая бетонная плита в базальтовой раме, по центру — пиксельный знак. */
export function cardBack(w = 52, h = 72): Canvas {
  const [c, g] = makeCanvas(w, h);
  g.drawImage(concreteTile(w, h, hexToRgb(PAL.slab700), 77, { pores: 30, amp: 6 }), 0, 0);
  // внутренняя бетонная плита
  const ix = 4, iy = 4, iw = w - 8, ih = h - 8;
  g.drawImage(concreteTile(iw, ih, hexToRgb(PAL.concrete200), 78, { pores: 40, seams: true, amp: 10 }), ix, iy);
  // фаски: рама — свет сверху/слева, тень снизу/справа; плита «утоплена» наоборот
  g.fillStyle = PAL.slab500;
  g.fillRect(1, 1, w - 2, 1);
  g.fillRect(1, 1, 1, h - 2);
  g.fillStyle = PAL.void;
  g.fillRect(1, h - 2, w - 2, 1);
  g.fillRect(w - 2, 1, 1, h - 2);
  g.fillStyle = PAL.concrete500;
  g.fillRect(ix, iy, iw, 1);
  g.fillRect(ix, iy, 1, ih);
  g.fillStyle = PAL.concrete100;
  g.fillRect(ix, iy + ih - 1, iw, 1);
  g.fillRect(ix + iw - 1, iy, 1, ih);
  // стяжки опалубки в углах плиты
  for (const [x, y] of [[ix + 3, iy + 3], [ix + iw - 5, iy + 3], [ix + 3, iy + ih - 5], [ix + iw - 5, iy + ih - 5]]) {
    px(g, x, y, PAL.slab600, 2, 2);
    px(g, x, y + 2, PAL.bone, 2, 1);
  }
  // знак: жёсткая тень + бренд-оранжевый
  const k = w >= 48 ? 4 : 3;
  const mark = logoMark(k, PAL.brand500);
  const mx = Math.floor((w - mark.width) / 2);
  const my = Math.floor((h - mark.height) / 2);
  g.drawImage(logoMark(k, PAL.brand800), mx + 1, my + 2);
  g.drawImage(mark, mx, my);
  return c;
}

/** Пиктограмма «обломки» — счётчик потерянных фигур (вместо креста). */
export function rubbleIcon(): Canvas {
  return outline(
    fromAscii(
      ['...GG....', '..GwGg...', '..GGgg.G.', '.Gw.dg.Gg', 'GGGg.GwGg', 'Ggggd.ggd', '.dddddddd'],
      { w: PAL.bone, G: PAL.concrete200, g: PAL.concrete400, d: PAL.slab500 },
      1,
    ),
    PAL.void,
  );
}

/** Аватар-идентикон 8×8 (симметричный) из имени. */
export function avatar(seedStr: string, size = 10): Canvas {
  const rnd = seeded(hashStr(seedStr));
  const [c, g] = makeCanvas(size, size);
  const bgs = [PAL.slab700, PAL.concrete500, PAL.granite700, PAL.patina700, PAL.amber700];
  const fgs = [PAL.bone, PAL.brand400, PAL.amber300, PAL.patina300, PAL.concrete200];
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

/** Крупный пиксельный текст с бетонной фактурой и экструзией (заголовок итога партии). */
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
  fg.drawImage(tint(hl, PAL.bone), 0, 0);
  fg.globalAlpha = 1;

  const [out, og] = makeCanvas(w + depth + 2, h + depth + 2);
  const side = tint(t, opts.side ?? PAL.brand700);
  const sideDark = tint(t, opts.edge ?? PAL.brand800);
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
