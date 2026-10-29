// Концепты фактуры панелей (временный выбор через свитчер «Фактура»; после решения владельца лишние уберём).
// Все плитки бесшовные, пиксель = 2 CSS px, контраст низкий — поверх лежит текст.
import { PAL, THEME } from './palette';
import { stoneTile, type StoneStyle } from './stone';
import { concreteTile, hexToRgb, makeCanvas, scaleCanvas, seeded, type Canvas } from './pixel';

// пятна: светлая основа (lift — насколько основа осветлена к белому) и только тёмные пятна (amp — их глубина);
// details — мелкое зерно и поры поверх
const BLOTS = {
  l1s1: { lift: 0.45, amp: 10, details: false },
  l1s2: { lift: 0.45, amp: 16, details: false },
  l1s3: { lift: 0.45, amp: 24, details: false },
  l1s2d: { lift: 0.45, amp: 16, details: true },
  l2s2: { lift: 0.8, amp: 16, details: false },
  l2s3: { lift: 0.8, amp: 24, details: false },
  l2s3d: { lift: 0.8, amp: 24, details: true },
} as const;
type Blot = keyof typeof BLOTS;

const STONES: StoneStyle[] = ['wornscratch', 'edgeworn', 'edgeworn4', 'edgeworn5', 'edgeworn6', 'edgeworn2', 'edgeworn3', 'worn', 'strata', 'scratch', 'slate', 'vein'];
export type TexConcept = 'concrete' | 'cool' | 'smooth' | 'dither' | 'terrazzo' | Blot | StoneStyle;
export const TEX_CONCEPTS: TexConcept[] = ['concrete', ...STONES, 'l1s1', 'l1s2', 'l1s3', 'l1s2d', 'l2s2', 'l2s3', 'l2s3d', 'cool', 'smooth', 'dither', 'terrazzo'];
export const TEX_NAMES: Record<TexConcept, string> = {
  l1s1: 'Светлее · пятна 1',
  l1s2: 'Светлее · пятна 2',
  l1s3: 'Светлее · пятна 3',
  l1s2d: 'Светлее · пятна 2 + детали',
  l2s2: 'Почти белый · пятна 2',
  l2s3: 'Почти белый · пятна 3',
  l2s3d: 'Почти белый · пятна 3 + детали',
  wornscratch: 'Потёртый + царапины',
  edgeworn: 'Края, царапины, сколы',
  edgeworn4: 'То же · белые края',
  edgeworn5: 'То же · все потёртости белые',
  edgeworn6: 'То же · контрастные белые края',
  edgeworn2: 'То же · светлые края',
  edgeworn3: 'То же · только сколы',
  worn: 'Потёртый',
  strata: 'Слоистый',
  scratch: 'Исцарапанный',
  slate: 'Сланец',
  vein: 'Прожилки',
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

/** Пятна схватывания: чистая основа и тёмные пятна ступенями (как у тёмного бетона), рисунок по сиду.
 *  amp — глубина пятен; details — мелкое зерно и поры поверх. */
function blotTile(w: number, h: number, base: RGB, seed: number, amp: number, details: boolean): Canvas {
  const [c, g] = makeCanvas(w, h);
  const rnd = seeded(seed);
  const gw = Math.max(1, Math.round(w / 12));
  const gh = Math.max(1, Math.round(h / 12));
  const grid = Array.from({ length: gw * gh }, () => rnd() - 0.5);
  const at = (i: number, j: number) => grid[((j + gh) % gh) * gw + ((i + gw) % gw)];
  const sm = (t: number) => t * t * (3 - 2 * t);
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
      // только затемнение: светлее среднего — чистая основа, дальше 3 ступени вглубь
      const t = Math.max(0, Math.min(1, (0.08 - v) / 0.42));
      let n = -(Math.ceil(t * 3) / 3) * amp;
      if (details) n += (rnd() - 0.5) * 5;
      const i = (y * w + x) * 4;
      img.data[i] = base[0] + n;
      img.data[i + 1] = base[1] + n;
      img.data[i + 2] = base[2] + n * 0.9;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  if (details) {
    const pores = Math.floor((w * h) / 150);
    for (let k = 0; k < pores; k++) {
      const x = Math.floor(rnd() * w);
      const y = Math.floor(rnd() * h);
      g.fillStyle = `rgba(0,0,0,${0.1 + rnd() * 0.12})`;
      g.fillRect(x, y, rnd() < 0.2 ? 2 : 1, 1);
      if (rnd() < 0.35) {
        g.fillStyle = 'rgba(255,255,255,0.12)';
        g.fillRect(x, (y + 1) % h, 1, 1);
      }
    }
  }
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
export function surfaceTile(w: number, h: number, base: RGB, seed: number, opts: Opts = {}, darker?: RGB, whole = true): Canvas {
  const concept = texConcept();
  const dark = darker ?? ([base[0] - 14, base[1] - 14, base[2] - 14] as RGB);
  if ((STONES as string[]).includes(concept)) {
    // светлая тема — камень светлее, чтобы тёмные следы читались как на тёмном
    // у «белых краёв» основа почти не осветляется — иначе белому не на чем выделяться
    const lift = THEME.scheme !== 'light' ? 0 : ['edgeworn4', 'edgeworn5', 'edgeworn6'].includes(concept) ? 0.1 : 0.4;
    return stoneTile(w, h, [base[0] + (255 - base[0]) * lift, base[1] + (255 - base[1]) * lift, base[2] + (253 - base[2]) * lift], seed, concept as StoneStyle, whole);
  }
  if (concept in BLOTS) {
    const b = BLOTS[concept as Blot];
    // осветляем только в светлой теме: в тёмной пятна и так тёмные на тёмном
    const k = THEME.scheme === 'light' ? b.lift : 0;
    const lifted: RGB = [base[0] + (255 - base[0]) * k, base[1] + (255 - base[1]) * k, base[2] + (253 - base[2]) * k];
    return blotTile(w, h, lifted, seed, b.amp, b.details);
  }
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
  // у камня крупнее плитка: царапины и слои на маленькой плитке складываются в заметный повтор
  const n = (STONES as string[]).includes(texConcept()) ? 160 : 96;
  return scaleCanvas(surfaceTile(n, n, hexToRgb(hex), seed, opts, hexToRgb(darkerHex), false), 2).toDataURL();
}
