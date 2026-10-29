// Фактура потёртого камня для поверхностей UI (панели, таблички, плитки меню).
// Основа почти целая, много тонких царапин, редкие потёртости и сколы, стёртые края.
// Тёмная тема — края светлеют от износа; светлая — края стёрты до белого (bone), основа не осветляется сильно,
// чтобы белому было на чём выделяться. Утопленное поле (доска на плитке меню) в светлой теме — ровное, с тенью по краю.
// Всё считается в целых пикселях низкого разрешения и бесшовно (координаты по модулю плитки).
// Свет слева-сверху: у царапины и скола тёмная кромка сверху, светлая снизу.
import { PAL, THEME } from './palette';
import { hexToRgb, makeCanvas, scaleCanvas, seeded, type Canvas } from './pixel';

type RGB = [number, number, number];

// упорядоченный дизеринг 4×4 — для мягких краёв потёртостей без градиентов
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** kind: panel — обычная поверхность, inset — утопленное поле.
 *  whole — плитка и есть вся поверхность (табличка, плитка меню): тогда видны её края и по ним можно стереть камень.
 *  Для повторяющегося CSS-фона края плитки — не края панели, там края стирает edgeWearLayers.
 *  whiteEdges — края стёрты до белого (светлая тема), иначе — на тон в сторону износа. */
function stoneTile(w: number, h: number, base: RGB, seed: number, kind: 'panel' | 'inset', whole: boolean, whiteEdges: boolean): Canvas {
  const rnd = seeded(seed * 7 + 3);
  const d = new Float32Array(w * h); // сдвиг яркости каждого пикселя
  const lum = 0.3 * base[0] + 0.59 * base[1] + 0.11 * base[2];
  const light = lum > 128;
  // на светлом камне следы темнее основы, на тёмном — светлее (стёртая поверхность светлеет)
  const wear = light ? -1 : 1;
  const k = light ? 2.4 : 2; // общая сила следов
  const idx = (x: number, y: number) => (((y % h) + h) % h) * w + (((x % w) + w) % w);
  const add = (x: number, y: number, v: number) => (d[idx(x, y)] += v);
  const white = new Uint8Array(w * h); // пиксели, стёртые до белого (bone)

  // бесшовный шум значений: решётка по модулю, сглаженная интерполяция
  const noise = (cell: number) => {
    const gw = Math.max(1, Math.round(w / cell));
    const gh = Math.max(1, Math.round(h / cell));
    const g = Array.from({ length: gw * gh }, () => rnd() - 0.5);
    const at = (i: number, j: number) => g[((j + gh) % gh) * gw + ((i + gw) % gw)];
    const sm = (t: number) => t * t * (3 - 2 * t);
    return (x: number, y: number) => {
      const fx = (x / w) * gw;
      const fy = (y / h) * gh;
      const i0 = Math.floor(fx);
      const j0 = Math.floor(fy);
      const tx = sm(fx - i0);
      const ty = sm(fy - j0);
      return (at(i0, j0) * (1 - tx) + at(i0 + 1, j0) * tx) * (1 - ty) + (at(i0, j0 + 1) * (1 - tx) + at(i0 + 1, j0 + 1) * tx) * ty;
    };
  };

  /** Неровность камня: крупные пятна в 3 ступени. */
  const mottle = (amp: number) => {
    const n = noise(20);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) add(x, y, Math.round(n(x, y) * 3) * amp * k);
  };

  /** Царапина: прямая или чуть изогнутая; канавка тёмная, кромка под ней светлая. */
  const scratch = (len: number, depth: number, angle?: number) => {
    let x = rnd() * w;
    let y = rnd() * h;
    let a = angle ?? rnd() * Math.PI;
    const bend = (rnd() - 0.5) * 0.04;
    for (let s = 0; s < len; s++) {
      const px = Math.round(x);
      const py = Math.round(y);
      add(px, py, -depth * k);
      if (rnd() < 0.8) add(px + 1, py + 1, depth * 0.6);
      x += Math.cos(a);
      y += Math.sin(a);
      a += bend;
      if (rnd() < 0.05) s += 2; // царапина рвётся
    }
  };

  /** Сетка царапин: половина — пучком в одну сторону, как от износа. */
  const scratches = (count: number, depth: number, depthRange: number, maxLen: number) => {
    const dir = rnd() * Math.PI;
    for (let i = 0; i < count; i++) scratch(5 + rnd() * maxLen, depth + rnd() * depthRange, rnd() < 0.5 ? dir + (rnd() - 0.5) * 0.3 : undefined);
  };

  /** Потёртости: стёртые участки с дизеринговым краем. */
  const scuffs = (amp: number, cover: number) => {
    const n = noise(14);
    const m = noise(5);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v = n(x, y) + m(x, y) * 0.35 + cover;
        const dens = Math.max(0, Math.min(1, (v - 0.12) * 4));
        if (BAYER[(y % 4) * 4 + (x % 4)] / 16 < dens) add(x, y, wear * amp * k);
      }
  };

  /** Сколы: ямка 1–3 px, тёмная, со светлой кромкой снизу-справа. */
  const chips = (count: number) => {
    for (let i = 0; i < count; i++) {
      const x = Math.floor(rnd() * w);
      const y = Math.floor(rnd() * h);
      const big = rnd() < 0.3;
      add(x, y, -9 * k);
      if (big) add(x + 1, y, -7 * k), add(x, y + 1, -6 * k);
      add(x + (big ? 2 : 1), y + (big ? 1 : 0), 5);
      add(x + (big ? 1 : 0), y + (big ? 2 : 1), 6);
    }
  };

  /** Стёртые края: у кромки плотно, вглубь — неровно, дизерингом. toWhite — до белого, иначе на amp в сторону износа. */
  const edgeWear = (amp: number, depth: number, toWhite: boolean) => {
    const n = noise(8);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const e = Math.min(x, y, w - 1 - x, h - 1 - y);
        const reach = depth * (0.6 + (n(x, y) + 0.5) * 0.9);
        const dens = Math.max(0, Math.min(1, 1 - e / reach));
        if (BAYER[(y % 4) * 4 + (x % 4)] / 16 >= dens * dens) continue;
        if (toWhite) white[idx(x, y)] = 1;
        else add(x, y, wear * amp * k);
      }
  };

  /** Сколы у кромки: чаще всего по краям поверхности. */
  const edgeChips = (count: number) => {
    for (let i = 0; i < count; i++) {
      const side = Math.floor(rnd() * 4);
      const t = rnd();
      const inset = Math.floor(rnd() * rnd() * 6);
      const x = side === 0 ? inset : side === 1 ? w - 1 - inset : Math.floor(t * w);
      const y = side === 2 ? inset : side === 3 ? h - 1 - inset : Math.floor(t * h);
      const sz = 1 + Math.floor(rnd() * 3);
      for (let a = 0; a < sz; a++) for (let b = 0; b < sz; b++) if (rnd() < 0.8) add(x + a, y + b, -8 * k);
      add(x + sz, y + sz - 1, 6);
      add(x + sz - 1, y + sz, 6);
    }
  };

  const grain = (amp: number) => {
    for (let i = 0; i < d.length; i++) d[i] += (rnd() - 0.5) * amp * k;
  };

  if (kind === 'inset') {
    // утопленное поле: ровный камень, тонкие царапины и тень одинаковой силы по всему периметру — без пятен и осветлений
    scratches(16, 2, 3, 24);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const e = Math.min(x, y, w - 1 - x, h - 1 - y);
        if (e < 2) add(x, y, -7 * k);
        else if (e < 3) add(x, y, -3.5 * k);
      }
  } else {
    mottle(1);
    scuffs(4, -0.22);
    scratches(34, 3, 5, 30);
    chips(Math.floor((w * h) / 1100));
    if (whole) {
      edgeWear(7, 7, whiteEdges);
      edgeChips(Math.floor((w + h) / 9));
    }
    grain(2);
  }

  const [c, g] = makeCanvas(w, h);
  const img = g.createImageData(w, h);
  const bone = hexToRgb(PAL.bone);
  for (let i = 0; i < d.length; i++) {
    if (white[i]) {
      img.data.set([bone[0], bone[1], bone[2], 255], i * 4);
      continue;
    }
    const v = Math.round(d[i]);
    img.data[i * 4] = base[0] + v;
    img.data[i * 4 + 1] = base[1] + v;
    img.data[i * 4 + 2] = base[2] + v * 0.92;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Поверхность UI (табличка, плитка меню, рубашка карты) — вся поверхность целиком, со стёртыми краями.
 *  inset — утопленное поле (доска на плитке меню). whole = false — бесшовная плитка для повтора. */
export function surfaceTile(w: number, h: number, base: RGB, seed: number, opts: { inset?: boolean } = {}, whole = true): Canvas {
  const light = THEME.scheme === 'light';
  // светлая тема: основа чуть светлее палитры, но не белая — белыми остаются только стёртые края
  const lift = light ? 0.1 : 0;
  const b: RGB = [base[0] + (255 - base[0]) * lift, base[1] + (255 - base[1]) * lift, base[2] + (253 - base[2]) * lift];
  return stoneTile(w, h, b, seed, opts.inset && light ? 'inset' : 'panel', whole, light);
}

/** Плитка камня для CSS-фона панелей (data URL). Пиксель фактуры = 2 CSS px — та же сетка, что у рамок и шрифта.
 *  Плитка крупная (320 CSS px): царапины на маленькой плитке складываются в заметный повтор. */
export function panelTexture(hex: string, seed: number): string {
  return scaleCanvas(surfaceTile(160, 160, hexToRgb(hex), seed, {}, false), 2).toDataURL();
}

/** Стёртые края для CSS-панелей (их фон — повторяющаяся плитка, края которой не совпадают с краями панели).
 *  Четыре полосы — сверху, снизу, слева, справа — накладываются слоями фона поверх фактуры.
 *  Светлая тема — стёрто до белого (bone), тёмная — полупрозрачный светлый износ. Возвращает значение для CSS `background`. */
export function edgeWearLayers(seed: number): string {
  const L = 160; // длина полосы в пикселях фактуры
  const D = 9; // глубина потёртости от кромки
  const rnd = seeded(seed);
  const wearCol = THEME.scheme === 'light' ? PAL.bone : 'rgba(255,255,255,0.09)';
  const strip = () => {
    // полоса «сверху»: кромка на y = 0
    const [c, g] = makeCanvas(L, D);
    const gw = 20;
    const lv = Array.from({ length: gw }, () => rnd());
    const reachAt = (x: number) => {
      const f = (x / L) * gw;
      const i = Math.floor(f);
      const t = f - i;
      return 2 + (lv[i % gw] * (1 - t) + lv[(i + 1) % gw] * t) * (D - 2);
    };
    g.fillStyle = wearCol;
    for (let x = 0; x < L; x++)
      for (let y = 0; y < D; y++) {
        const dens = Math.max(0, 1 - y / reachAt(x));
        if (BAYER[(y % 4) * 4 + (x % 4)] / 16 < dens * dens) g.fillRect(x, y, 1, 1);
      }
    // сколы у кромки
    for (let i = 0; i < 5; i++) {
      const x = Math.floor(rnd() * (L - 3));
      const sz = 1 + Math.floor(rnd() * 3);
      g.fillStyle = 'rgba(0,0,0,0.28)';
      for (let a = 0; a < sz; a++) for (let b = 0; b < sz - (a === sz - 1 ? 1 : 0); b++) g.fillRect(x + a, b, 1, 1);
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(x, sz, sz, 1);
    }
    return c;
  };
  // поворот полосы в нужную сторону и масштаб ×2 (пиксель фактуры = 2 CSS px)
  const orient = (src: Canvas, rot: 0 | 1 | 2 | 3) => {
    const vertical = rot % 2 === 1;
    const [c, g] = makeCanvas(vertical ? D * 2 : L * 2, vertical ? L * 2 : D * 2);
    g.imageSmoothingEnabled = false;
    g.translate(c.width / 2, c.height / 2);
    g.rotate((rot * Math.PI) / 2);
    g.drawImage(src, -L, -D, L * 2, D * 2);
    return c.toDataURL();
  };
  const top = orient(strip(), 0);
  const right = orient(strip(), 1);
  const bottom = orient(strip(), 2);
  const left = orient(strip(), 3);
  return `url(${top}) left top repeat-x, url(${bottom}) left bottom repeat-x, url(${left}) left top repeat-y, url(${right}) right top repeat-y`;
}
