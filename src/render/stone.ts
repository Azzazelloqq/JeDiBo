// Фактуры потёртого камня (концепты): слои, царапины, потёртости, сколы, прожилки.
// Всё считается в целых пикселях низкого разрешения и бесшовно (координаты по модулю плитки).
// Свет слева-сверху: у царапины и скола тёмная кромка сверху, светлая снизу.
import { makeCanvas, seeded, type Canvas } from './pixel';

export type StoneStyle = 'worn' | 'strata' | 'scratch' | 'slate' | 'vein';
type RGB = [number, number, number];

// упорядоченный дизеринг 4×4 — для мягких краёв потёртостей без градиентов
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export function stoneTile(w: number, h: number, base: RGB, seed: number, style: StoneStyle): Canvas {
  const rnd = seeded(seed * 7 + 3);
  const d = new Float32Array(w * h); // сдвиг яркости каждого пикселя
  const lum = 0.3 * base[0] + 0.59 * base[1] + 0.11 * base[2];
  const light = lum > 128;
  // на светлом камне следы темнее основы, на тёмном — светлее (стёртая поверхность светлеет)
  const wear = light ? -1 : 1;
  const k = light ? 2.4 : 2; // общая сила следов
  const idx = (x: number, y: number) => (((y % h) + h) % h) * w + (((x % w) + w) % w);
  const add = (x: number, y: number, v: number) => (d[idx(x, y)] += v);

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

  /** Слои: полосы разной толщины, волнистые (синусы с целым числом периодов — плитка бесшовная). */
  const strata = (amp: number) => {
    const th: number[] = [];
    let sum = 0;
    while (sum < h) {
      const t = Math.min(h - sum, 3 + Math.floor(rnd() * 12));
      th.push(t);
      sum += t;
    }
    const tones = th.map(() => [0, -1, 1, -2, 2, -1][Math.floor(rnd() * 6)] * amp * k);
    // у части слоёв — тонкий шов-граница
    const seam = th.map(() => rnd() < 0.35);
    const edges: number[] = [];
    th.reduce((a, t) => (edges.push(a), a + t), 0);
    const k1 = 1 + Math.floor(rnd() * 2);
    const k2 = 2 + Math.floor(rnd() * 3);
    const p1 = rnd() * 6.28;
    const p2 = rnd() * 6.28;
    const wob = noise(10);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const off = 4 * Math.sin((x / w) * 6.283 * k1 + p1) + 1.5 * Math.sin((x / w) * 6.283 * k2 + p2) + wob(x, y) * 3;
        const yy = (((Math.round(y + off) % h) + h) % h);
        let b = 0;
        while (b + 1 < edges.length && edges[b + 1] <= yy) b++;
        add(x, y, tones[b]);
        if (seam[b] && yy === edges[b]) add(x, y, -amp * 1.6 * k);
      }
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

  /** Прожилки: длинные извилистые жилы, на тёмном камне светлые, на светлом — тёмные. */
  const veins = (count: number, amp: number) => {
    for (let v = 0; v < count; v++) {
      let x = rnd() * w;
      let y = rnd() * h;
      let a = rnd() * Math.PI * 2;
      const len = w * (0.8 + rnd());
      for (let s = 0; s < len; s++) {
        add(Math.round(x), Math.round(y), wear * amp * k);
        if (rnd() < 0.18) add(Math.round(x) + 1, Math.round(y), wear * amp * 0.5 * k); // утолщение
        // ветка
        if (rnd() < 0.01) {
          let bx = x;
          let by = y;
          const ba = a + (rnd() < 0.5 ? 0.9 : -0.9);
          for (let t = 0; t < 10 + rnd() * 14; t++) {
            add(Math.round(bx), Math.round(by), wear * amp * 0.6 * k);
            bx += Math.cos(ba);
            by += Math.sin(ba);
          }
        }
        a += (rnd() - 0.5) * 0.5;
        x += Math.cos(a);
        y += Math.sin(a);
      }
    }
  };

  const grain = (amp: number) => {
    for (let i = 0; i < d.length; i++) d[i] += (rnd() - 0.5) * amp * k;
  };

  switch (style) {
    case 'worn': // потёртый: стёртые участки, редкие царапины и сколы
      mottle(1.5);
      scuffs(6, 0);
      for (let i = 0; i < 5; i++) scratch(8 + rnd() * 18, 6);
      chips(Math.floor((w * h) / 500));
      grain(3);
      break;
    case 'strata': // слоистый: волнистые пласты разной толщины
      strata(2.5);
      chips(Math.floor((w * h) / 900));
      grain(2.5);
      break;
    case 'scratch': { // исцарапанный: ровный камень и сетка царапин, часть — пучками в одну сторону
      mottle(1);
      const dir = rnd() * Math.PI;
      for (let i = 0; i < 26; i++) scratch(6 + rnd() * 30, 3 + rnd() * 5, rnd() < 0.5 ? dir + (rnd() - 0.5) * 0.3 : undefined);
      grain(2);
      break;
    }
    case 'slate': // сланец: слои + потёртости + царапины + сколы
      strata(2);
      scuffs(4, -0.08);
      for (let i = 0; i < 10; i++) scratch(6 + rnd() * 20, 5);
      chips(Math.floor((w * h) / 600));
      grain(2.5);
      break;
    case 'vein': // прожилки: тёмный/светлый мрамор с жилами
      mottle(1.2);
      veins(3, 7);
      for (let i = 0; i < 4; i++) scratch(8 + rnd() * 14, 4);
      grain(2);
      break;
  }

  const [c, g] = makeCanvas(w, h);
  const img = g.createImageData(w, h);
  for (let i = 0; i < d.length; i++) {
    const v = Math.round(d[i]);
    img.data[i * 4] = base[0] + v;
    img.data[i * 4 + 1] = base[1] + v;
    img.data[i * 4 + 2] = base[2] + v * 0.92;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}
