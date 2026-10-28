// Концепты фактуры панелей (временный выбор через свитчер «Фактура»; после решения владельца лишние уберём).
// Все плитки бесшовные, пиксель = 2 CSS px, контраст низкий — поверх лежит текст.
import { PAL, THEME } from './palette';
import { concreteTile, hexToRgb, makeCanvas, scaleCanvas, seeded, type Canvas } from './pixel';

export type TexConcept = 'concrete' | 'cool' | 'smooth' | 'dither' | 'terrazzo';
export const TEX_CONCEPTS: TexConcept[] = ['concrete', 'cool', 'smooth', 'dither', 'terrazzo'];
export const TEX_NAMES: Record<TexConcept, string> = {
  concrete: 'Бетон',
  cool: 'Серый бетон',
  smooth: 'Гладкий',
  dither: 'Дизеринг',
  terrazzo: 'Терраццо',
};

const KEY = 'jedibo.tex.v1';
export function texConcept(): TexConcept {
  try {
    const q = new URLSearchParams(location.search).get('tex') as TexConcept | null;
    if (q && TEX_CONCEPTS.includes(q)) return q;
    const s = localStorage.getItem(KEY) as TexConcept | null;
    if (s && TEX_CONCEPTS.includes(s)) return s;
  } catch {
    /* хранилище недоступно */
  }
  return 'concrete';
}
export function setTexConcept(t: TexConcept) {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* хранилище недоступно */
  }
}

type RGB = [number, number, number];
const rgbHex = ([r, g, b]: RGB) => `rgb(${r | 0},${g | 0},${b | 0})`;

/** Серый бетон: тот же рисунок, но основа без тёплого оттенка (бежевый с пятнами читался как грязная бумага). */
function neutral([r, g, b]: RGB, k = 0.75): RGB {
  const l = 0.3 * r + 0.59 * g + 0.11 * b;
  return [r + (l - r) * k, g + (l - g) * k, b + (l - b) * k + 2 * k];
}

/** Гладкий: только крупные пятна в две ступени, без зерна и пор — матовая штукатурка. */
function smoothTile(w: number, h: number, base: RGB, seed: number): Canvas {
  const [c, g] = makeCanvas(w, h);
  const rnd = seeded(seed);
  const gw = Math.max(1, Math.round(w / 24));
  const gh = Math.max(1, Math.round(h / 24));
  const grid = Array.from({ length: gw * gh }, () => rnd() - 0.5);
  const at = (i: number, j: number) => grid[((j + gh) % gh) * gw + ((i + gw) % gw)];
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const fx = (x / w) * gw;
      const fy = (y / h) * gh;
      const i0 = Math.floor(fx);
      const j0 = Math.floor(fy);
      const tx = fx - i0;
      const ty = fy - j0;
      const v = (at(i0, j0) * (1 - tx) + at(i0 + 1, j0) * tx) * (1 - ty) + (at(i0, j0 + 1) * (1 - tx) + at(i0 + 1, j0 + 1) * tx) * ty;
      const d = v > 0.12 ? 3 : v < -0.12 ? -3 : 0;
      const i = (y * w + x) * 4;
      img.data[i] = base[0] + d;
      img.data[i + 1] = base[1] + d;
      img.data[i + 2] = base[2] + d;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return c;
}

// упорядоченный дизеринг 4×4 (Байер)
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Дизеринг: пятна рисуются сеткой Байера между двумя соседними тонами палитры — классическая пиксельная штриховка. */
function ditherTile(w: number, h: number, base: RGB, dark: RGB, seed: number): Canvas {
  const [c, g] = makeCanvas(w, h);
  const rnd = seeded(seed);
  const gw = Math.max(1, Math.round(w / 16));
  const gh = Math.max(1, Math.round(h / 16));
  const grid = Array.from({ length: gw * gh }, () => rnd());
  const at = (i: number, j: number) => grid[((j + gh) % gh) * gw + ((i + gw) % gw)];
  const sm = (t: number) => t * t * (3 - 2 * t);
  // второй тон — 2/3 пути к соседнему тону палитры: точки видны, но не рябят
  const mid: RGB = [base[0] + (dark[0] - base[0]) * 0.66, base[1] + (dark[1] - base[1]) * 0.66, base[2] + (dark[2] - base[2]) * 0.66];
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const fx = (x / w) * gw;
      const fy = (y / h) * gh;
      const i0 = Math.floor(fx);
      const j0 = Math.floor(fy);
      const tx = sm(fx - i0);
      const ty = sm(fy - j0);
      const v = (at(i0, j0) * (1 - tx) + at(i0 + 1, j0) * tx) * (1 - ty) + (at(i0, j0 + 1) * (1 - tx) + at(i0 + 1, j0 + 1) * tx) * ty;
      const density = Math.max(0, (v - 0.3) * 1.4); // часть плитки остаётся чистой
      const on = BAYER[(y % 4) * 4 + (x % 4)] / 16 < density;
      const col = on ? mid : base;
      const i = (y * w + x) * 4;
      img.data[i] = col[0];
      img.data[i + 1] = col[1];
      img.data[i + 2] = col[2];
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return c;
}

/** Терраццо: ровная основа и редкая крошка цветов палитры (1–2 px), как полированный камень с заполнителем. */
function terrazzoTile(w: number, h: number, base: RGB, seed: number, darkTheme: boolean): Canvas {
  const [c, g] = makeCanvas(w, h);
  const rnd = seeded(seed);
  g.fillStyle = rgbHex(base);
  g.fillRect(0, 0, w, h);
  const chips = darkTheme
    ? [PAL.slab600, PAL.slab500, PAL.slab900, PAL.granite700]
    : [PAL.concrete500, PAL.concrete600, PAL.bone, PAL.concrete100, PAL.granite400];
  const count = Math.floor((w * h) / 70);
  for (let i = 0; i < count; i++) {
    const r = rnd();
    // акцентная крошка (последний цвет) — редко
    const col = r < 0.06 ? chips[chips.length - 1] : chips[Math.floor(rnd() * (chips.length - 1))];
    const x = Math.floor(rnd() * w);
    const y = Math.floor(rnd() * h);
    g.globalAlpha = 0.55;
    g.fillStyle = col;
    const s = rnd();
    g.fillRect(x, y, 1, 1);
    if (s < 0.3) g.fillRect((x + 1) % w, y, 1, 1);
    if (s < 0.12) g.fillRect(x, (y + 1) % h, 1, 1);
  }
  g.globalAlpha = 1;
  return c;
}

type Opts = { pores?: number; cracks?: boolean; amp?: number };

/** Поверхность UI (панель, табличка, плитка меню) в выбранном концепте. opts — параметры бетона;
 *  darker — соседний более тёмный тон палитры для дизеринга (по умолчанию основа −14). */
export function surfaceTile(w: number, h: number, base: RGB, seed: number, opts: Opts = {}, darker?: RGB): Canvas {
  const concept = texConcept();
  const dark = darker ?? ([base[0] - 14, base[1] - 14, base[2] - 14] as RGB);
  switch (concept) {
    case 'cool':
      return concreteTile(w, h, neutral(base), seed, opts);
    case 'smooth':
      return smoothTile(w, h, base, seed);
    case 'dither':
      return ditherTile(w, h, base, dark, seed);
    case 'terrazzo':
      return terrazzoTile(w, h, base, seed, THEME.scheme === 'dark');
    default:
      return concreteTile(w, h, base, seed, opts);
  }
}

/** CSS-фон панели (data URL), пиксель = 2 CSS px. */
export function panelTexture(hex: string, darkerHex: string, seed: number, soft: boolean): string {
  const opts = soft ? { pores: 40, amp: 8 } : { pores: 60, amp: 9 };
  return scaleCanvas(surfaceTile(96, 96, hexToRgb(hex), seed, opts, hexToRgb(darkerHex)), 2).toDataURL();
}
