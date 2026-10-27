// Низкоуровневые инструменты программного пиксель-арта.

export type Canvas = HTMLCanvasElement;
export type C2D = CanvasRenderingContext2D;

export function makeCanvas(w: number, h: number): [Canvas, C2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  return [c, g];
}

/** Детерминированный ГСЧ для текстур (не путать с ГСЧ партии). */
export function seeded(seed: number) {
  let t = seed | 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export const hashStr = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

export function px(g: C2D, x: number, y: number, color: string, w = 1, h = 1) {
  g.fillStyle = color;
  g.fillRect(Math.round(x), Math.round(y), w, h);
}

/** Маска -> массив bool. */
export type Mask = (x: number, y: number) => boolean;

/** Обводка по альфа-каналу: прозрачные пиксели рядом с непрозрачными красятся в color. */
export function outline(src: Canvas, color: string, diagonal = false): Canvas {
  const w = src.width;
  const h = src.height;
  const [c, g] = makeCanvas(w, h);
  const data = src.getContext('2d')!.getImageData(0, 0, w, h).data;
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3] > 10;
  g.fillStyle = color;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (solid(x, y)) continue;
      const n = solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1);
      const d = diagonal && (solid(x - 1, y - 1) || solid(x + 1, y - 1) || solid(x - 1, y + 1) || solid(x + 1, y + 1));
      if (n || d) g.fillRect(x, y, 1, 1);
    }
  g.drawImage(src, 0, 0);
  return c;
}

/** ASCII-спрайт: каждая буква — цвет из палитры, '.' — пусто. */
export function fromAscii(rows: string[], colors: Record<string, string>, pad = 1): Canvas {
  const w = Math.max(...rows.map((r) => r.length));
  const [c, g] = makeCanvas(w + pad * 2, rows.length + pad * 2);
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const col = colors[ch];
      if (col) px(g, x + pad, y + pad, col);
    }),
  );
  return c;
}

export function scaleCanvas(src: Canvas, k: number): Canvas {
  const [c, g] = makeCanvas(src.width * k, src.height * k);
  g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

/** Порог альфы: убирает сглаживание шрифтов, превращая текст в честные пиксели. */
export function hardenAlpha(g: C2D, w: number, h: number, threshold = 110) {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] > threshold ? 255 : 0;
  g.putImageData(img, 0, 0);
}

// ── крошечный шрифт 3×5 для координат ──────────────────────────────────────
const FONT: Record<string, string> = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111',
  '4': '101101111001001', '5': '111100111001111', '6': '111100111101111', '7': '111001010010010',
  '8': '111101111101111', '9': '111101111001111',
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110',
  E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101',
  I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
};

export function tinyText(g: C2D, text: string, x: number, y: number, color: string) {
  g.fillStyle = color;
  let cx = x;
  for (const ch of text) {
    const f = FONT[ch];
    if (f) for (let i = 0; i < 15; i++) if (f[i] === '1') g.fillRect(cx + (i % 3), y + Math.floor(i / 3), 1, 1);
    cx += 4;
  }
}
export const tinyWidth = (text: string) => text.length * 4 - 1;

/** Бетонная текстура: шум, поры, следы опалубки. Используется и в канвасе, и как CSS-фон. */
export function concreteTile(w: number, h: number, base: [number, number, number], seed: number, opts: { pores?: number; seams?: boolean; amp?: number } = {}): Canvas {
  const [c, g] = makeCanvas(w, h);
  const rnd = seeded(seed);
  const img = g.createImageData(w, h);
  const amp = opts.amp ?? 10;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // низкочастотная «облачность» + мелкий шум
      const cloud = Math.sin(x * 0.11 + seed) * Math.cos(y * 0.07 - seed * 0.3) * amp * 0.5;
      const n = (rnd() - 0.5) * amp + cloud;
      img.data[i] = base[0] + n;
      img.data[i + 1] = base[1] + n;
      img.data[i + 2] = base[2] + n * 0.9;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const pores = opts.pores ?? Math.floor((w * h) / 90);
  for (let i = 0; i < pores; i++) {
    const x = Math.floor(rnd() * w);
    const y = Math.floor(rnd() * h);
    g.fillStyle = `rgba(0,0,0,${0.25 + rnd() * 0.3})`;
    g.fillRect(x, y, 1, 1);
    if (rnd() < 0.3) {
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fillRect(x, y + 1, 1, 1);
    }
  }
  if (opts.seams) {
    // горизонтальные швы опалубки
    for (let y = 8 + Math.floor(rnd() * 6); y < h; y += 14 + Math.floor(rnd() * 8)) {
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fillRect(0, y, w, 1);
      g.fillStyle = 'rgba(255,255,255,0.05)';
      g.fillRect(0, y + 1, w, 1);
    }
  }
  return c;
}

export const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
