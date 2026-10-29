// Варианты фона главного меню — пока владелец не выбрал один (`?menubg=`, переключатель внизу слева в dev).
// Слой поверх дыма (render/background.ts), под плитками и кнопками: маленький canvas в низком разрешении,
// целочисленный масштаб, только цвета палитры. Анимация — ступенями по 12 кадров в секунду и по целым пикселям;
// при prefers-reduced-motion рисуется один неподвижный кадр.
import { Rank } from '../core/types';
import { PAL, THEME, type StoneColor } from './palette';
import { hexToRgb, makeCanvas, seeded, withAlpha, type C2D, type Canvas } from './pixel';
import { cardBack, logoMark, pieceSprite, tint } from './sprites';
import { surfaceTile } from './stone';
import { onFrame } from './tween';

export const MENU_BGS = [
  { id: 'smoke', name: 'Дым' },
  { id: 'board', name: 'Доска' },
  { id: 'pieces', name: 'Фигуры' },
  { id: 'embers', name: 'Искры' },
  { id: 'wall', name: 'Плита' },
  { id: 'scene', name: 'Пейзаж' },
] as const;
export type MenuBg = (typeof MENU_BGS)[number]['id'];

const KEY = 'jedibo.menubg';
const isBg = (s: string | null): s is MenuBg => MENU_BGS.some((b) => b.id === s);

/** Вариант из адреса (`?menubg=board`), иначе последний выбранный переключателем, иначе текущий дым. */
export function menuBg(): MenuBg {
  const q = new URLSearchParams(location.search).get('menubg');
  if (isBg(q)) return q;
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {
    /* нет хранилища */
  }
  return isBg(saved) ? saved : 'smoke';
}

export function saveMenuBg(id: MenuBg) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* нет хранилища */
  }
}

const dark = THEME.scheme === 'dark';
/** Тона относительно фона темы: sh — темнее фона, li — светлее (свет слева-сверху). */
const T = dark
  ? { sh1: PAL.ink, sh2: PAL.void, li1: PAL.slab700, li2: PAL.slab600, li3: PAL.slab500 }
  : { sh1: PAL.concrete400, sh2: PAL.concrete500, li1: PAL.concrete100, li2: PAL.bone, li3: PAL.bone };

/** Порог Байера 4×4 (0..15): ступенчатое растворение вместо мягких градиентов. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const dither = (x: number, y: number, t: number) => t * 16 > BAYER[(y & 3) * 4 + (x & 3)] + 0.5;

/** 0 — в центре (там логотип и плитки), 1 — у краёв. */
function edgeness(x: number, y: number, W: number, H: number) {
  const dx = (x - W / 2) / (W * 0.5);
  const dy = (y - H * 0.5) / (H * 0.5);
  return Math.min(1, Math.max(0, (Math.hypot(dx * 1.05, dy * 0.8) - 0.45) / 0.55));
}

type Scene = { draw: (tick: number) => void; animated: boolean };
type Make = (g: C2D, W: number, H: number) => Scene;

const RANKS = [Rank.Triangle, Rank.Square, Rank.Circle];
const COLORS: StoneColor[] = ['red', 'black'];

/** 1. Доска: поле клеток во весь экран, к центру растворяется по клеткам — сначала пропадают фигуры и заливка,
 *  потом швы. Раз в пару секунд одна из фигур у края шагает на соседнюю клетку. */
const board: Make = (g, W, H) => {
  const C = 16;
  const rnd = seeded(41);
  const cols = Math.ceil(W / C) + 1, rows = Math.ceil(H / C) + 1;
  const ox = Math.floor((W - cols * C) / 2), oy = Math.floor((H - rows * C) / 2);
  // ступень клетки: 0 — пусто, 1 — только шов, 2 — шов и заливка, 3 — можно ставить фигуру
  const level = (i: number, j: number) => Math.floor(edgeness(ox + i * C + C / 2, oy + j * C + C / 2, W, H) * 3.999);
  const [grid, gg] = makeCanvas(W, H);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const lv = level(i, j);
      if (!lv) continue;
      const x = ox + i * C, y = oy + j * C;
      if (lv >= 2 && (i + j) % 2 === 0) {
        gg.fillStyle = T.sh1;
        gg.fillRect(x, y, C, C);
      }
      // шов клетки: свет сверху-слева, тень снизу-справа
      gg.fillStyle = T.li1;
      gg.fillRect(x, y, C - 1, 1);
      gg.fillRect(x, y, 1, C - 1);
      gg.fillStyle = T.sh2;
      gg.fillRect(x, y + C - 1, C, 1);
      gg.fillRect(x + C - 1, y, 1, C);
    }
  type P = { i: number; j: number; spr: Canvas };
  const free = (i: number, j: number) => i >= 0 && j >= 0 && i < cols && j < rows && level(i, j) >= 3 && !men.some((m) => m.i === i && m.j === j);
  const men: P[] = [];
  for (let k = 0; men.length < 10 && k < 400; k++) {
    const i = Math.floor(rnd() * cols), j = Math.floor(rnd() * rows);
    if (!free(i, j)) continue;
    const col = COLORS[men.length % 2];
    men.push({ i, j, spr: pieceSprite(RANKS[Math.floor(rnd() * 3)], col, col === 'red') });
  }
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let moved = 0;
  return {
    animated: true,
    draw(tick) {
      // шаг фигуры — раз в 2 с (24 тика), детерминированно от номера шага
      const step = Math.floor(tick / 24);
      for (; moved < step; moved++) {
        const r = seeded(moved * 7 + 3);
        const m = men[Math.floor(r() * men.length)];
        const [dx, dy] = DIRS[Math.floor(r() * 4)];
        if (m && free(m.i + dx, m.j + dy)) {
          m.i += dx;
          m.j += dy;
        }
      }
      g.clearRect(0, 0, W, H);
      g.drawImage(grid, 0, 0);
      for (const m of men) g.drawImage(m.spr, ox + m.i * C, oy + m.j * C);
    },
  };
};

/** 2. Фигуры: по краям экрана всплывают камни-фигуры — дальние силуэты мелкие и медленные, ближние крупные. */
const pieces: Make = (g, W, H) => {
  const rnd = seeded(7);
  const scaled = (src: Canvas, k: number) => {
    const [c, cg] = makeCanvas(src.width * k, src.height * k);
    cg.drawImage(src, 0, 0, c.width, c.height);
    return c;
  };
  type P = { spr: Canvas; x: number; y0: number; every: number; phase: number; sway: number };
  const list: P[] = [];
  const band = Math.max(24, Math.floor(W * 0.2));
  for (let i = 0; i < 18; i++) {
    const near = i % 3 === 0;
    const k = near ? 2 : 1;
    const col = COLORS[i % 2];
    const src = pieceSprite(RANKS[i % 3], col, rnd() < 0.5);
    const spr = scaled(near ? src : tint(src, i % 2 ? T.sh1 : T.li1), k);
    const left = i % 2 === 0;
    const x = left ? Math.floor(rnd() * (band - spr.width / 2)) - 4 : W - Math.floor(rnd() * (band - spr.width / 2)) - spr.width + 4;
    list.push({ spr, x, y0: Math.floor((((i * 7) % 18) / 18) * (H + spr.height)), every: near ? 4 : 6 + (i % 2) * 3, phase: Math.floor(rnd() * 200), sway: near ? 3 : 2 });
  }
  list.sort((a, b) => a.spr.width - b.spr.width);
  return {
    animated: true,
    draw(tick) {
      g.clearRect(0, 0, W, H);
      for (const p of list) {
        const span = H + p.spr.height;
        const y = (((p.y0 - Math.floor(tick / p.every)) % span) + span) % span - p.spr.height;
        const x = p.x + Math.round(Math.sin((tick + p.phase) / 40) * p.sway);
        g.drawImage(p.spr, x, y);
      }
    },
  };
};

/** 3. Искры: от раскалённого низа поднимаются искры Кармы, по краям плывут рубашки карт. */
const embers: Make = (g, W, H) => {
  const rnd = seeded(13);
  // цвета по возрасту искры: от горячего к остывшему
  const heat = dark
    ? [PAL.amber100, PAL.amber300, PAL.amber500, PAL.brand500, PAL.brand700, PAL.granite800]
    : [PAL.amber300, PAL.amber500, PAL.brand400, PAL.brand500, PAL.granite600, PAL.granite700];
  const glowCols = dark ? [PAL.granite900, PAL.brand800] : [PAL.brand100, PAL.amber100];
  const [glow, gg] = makeCanvas(W, H);
  const gh = Math.max(12, Math.floor(H * 0.16));
  for (let y = H - gh; y < H; y++)
    for (let x = 0; x < W; x++) {
      const t = (y - (H - gh)) / gh;
      const e = 0.5 + 0.5 * Math.abs(x / W - 0.5) * 2; // по краям жарче
      if (dither(x, y, Math.round(t * e * 4) / 4)) {
        gg.fillStyle = dither(x + 2, y + 1, t * t) ? glowCols[1] : glowCols[0];
        gg.fillRect(x, y, 1, 1);
      }
    }
  type E = { x: number; y: number; age: number; life: number; every: number; ph: number; big: boolean };
  const spawn = (e: E, any: boolean) => {
    e.x = Math.floor(rnd() * W);
    e.y = any ? Math.floor(H * 0.3 + rnd() * H * 0.7) : H + Math.floor(rnd() * 8);
    e.age = 0;
    e.life = 60 + Math.floor(rnd() * 120);
    e.every = 1 + Math.floor(rnd() * 3);
    e.ph = rnd() * 6.28;
    e.big = rnd() < 0.15;
  };
  const sparks: E[] = Array.from({ length: Math.min(90, Math.floor(W / 4)) }, () => {
    const e = { x: 0, y: 0, age: 0, life: 1, every: 1, ph: 0, big: false };
    spawn(e, true);
    e.age = Math.floor(rnd() * e.life * 0.6);
    return e;
  });
  const back = cardBack(26, 36);
  const m = Math.max(2, Math.floor(W * 0.025));
  const cards = [0, 1, 2].map((i) => ({ x: i === 1 ? W - m - back.width : m, y0: Math.floor(H * (0.2 + i * 0.37)), every: 7 + i * 2 }));
  let last = -1;
  return {
    animated: true,
    draw(tick) {
      g.clearRect(0, 0, W, H);
      g.drawImage(glow, 0, 0);
      for (const c of cards) {
        const span = H + back.height;
        const y = (((c.y0 - Math.floor(tick / c.every)) % span) + span) % span - back.height;
        g.drawImage(back, c.x + Math.round(Math.sin((tick + c.y0) / 50) * 2), y);
      }
      const steps = last < 0 ? 0 : Math.min(4, tick - last);
      last = tick;
      for (const e of sparks) {
        for (let s = 0; s < steps; s++) {
          e.age++;
          if (e.age % e.every === 0) e.y--;
          if (e.age % 9 === 0) e.x += Math.sin(e.ph + e.age / 14) > 0 ? 1 : -1;
          if (e.age >= e.life || e.y < -2) spawn(e, false);
        }
        g.fillStyle = heat[Math.min(heat.length - 1, Math.floor((e.age / e.life) * heat.length))];
        g.fillRect(e.x, e.y, e.big ? 2 : 1, e.big ? 2 : 1);
      }
    },
  };
};

/** 4. Плита: стена из щитов опалубки — шов, фаска, стяжки в углах (как на рубашке карты), края притенены растром. */
const wall: Make = (g, W, H) => {
  const base = hexToRgb(dark ? PAL.slab800 : PAL.concrete300);
  g.drawImage(surfaceTile(W, H, base, 61), 0, 0);
  const PW = 64, PH = 40;
  const ox = Math.floor(((W / 2) % PW) - PW / 2), oy = Math.floor(((H / 2) % PH) - PH / 2);
  for (let y = oy; y < H; y += PH)
    for (let x = ox; x < W; x += PW) {
      g.fillStyle = T.sh2;
      g.fillRect(x, y + PH - 1, PW, 1);
      g.fillRect(x + PW - 1, y, 1, PH);
      g.fillStyle = dark ? PAL.slab600 : PAL.bone;
      g.fillRect(x, y, PW - 1, 1);
      g.fillRect(x, y, 1, PH - 1);
      for (const [hx, hy] of [[x + 5, y + 5], [x + PW - 7, y + 5], [x + 5, y + PH - 7], [x + PW - 7, y + PH - 7]]) {
        g.fillStyle = dark ? PAL.void : PAL.slab600;
        g.fillRect(hx, hy, 2, 2);
        g.fillStyle = dark ? PAL.slab500 : PAL.bone;
        g.fillRect(hx, hy + 2, 2, 1);
      }
    }
  // знак логотипа, высеченный в углах стены
  const k = Math.max(3, Math.floor(Math.min(W, H) / 40));
  const markSh = logoMark(k, dark ? PAL.void : PAL.concrete500);
  const markLi = logoMark(k, dark ? PAL.slab600 : PAL.bone);
  for (const [mx, my] of [[8, H - markSh.height - 8], [W - markSh.width - 8, 8]]) {
    g.drawImage(markLi, mx + 1, my + 1);
    g.drawImage(markSh, mx, my);
  }
  // притенение к краям — целыми щитами, 3 ступени
  for (let y = oy; y < H; y += PH)
    for (let x = ox; x < W; x += PW) {
      const e = Math.floor(edgeness(x + PW / 2, y + PH / 2, W, H) * 3.999);
      if (!e) continue;
      g.fillStyle = withAlpha(dark ? PAL.void : PAL.concrete600, e * (dark ? 0.16 : 0.12));
      g.fillRect(x, y, PW, PH);
    }
  return { animated: false, draw() {} };
};

/** 5. Пейзаж: небо ступенями, луна (тёмная) или полосатое солнце (светлая), холмы и монолиты-фигуры у горизонта. */
const scene: Make = (g, W, H) => {
  const rnd = seeded(5);
  const horizon = Math.floor(H * 0.74);
  const sky = dark ? [PAL.void, PAL.ink, PAL.slab900, PAL.slab800] : [PAL.bone, PAL.concrete100, PAL.brand100, PAL.amber100];
  const [skyC, sg] = makeCanvas(W, H);
  for (let y = 0; y < horizon; y++)
    for (let x = 0; x < W; x++) {
      const t = (y / horizon) * (sky.length - 1);
      const i = Math.floor(t);
      sg.fillStyle = sky[Math.min(sky.length - 1, i + (dither(x, y, t - i) ? 1 : 0))];
      sg.fillRect(x, y, 1, 1);
    }
  // светило
  const R = Math.max(10, Math.floor(Math.min(W, H) * 0.13));
  const cx = Math.floor(W * 0.8), cy = Math.floor(H * 0.3);
  for (let y = -R; y <= R; y++)
    for (let x = -R; x <= R; x++) {
      if (x * x + y * y > R * R) continue;
      let col: string;
      if (dark) {
        const lit = x + y < -R * 0.4;
        col = lit ? PAL.bone : PAL.concrete200;
        if ((x - R * 0.3) ** 2 + (y - R * 0.1) ** 2 < (R * 0.22) ** 2) col = PAL.concrete300;
        if ((x + R * 0.35) ** 2 + (y + R * 0.4) ** 2 < (R * 0.12) ** 2) col = PAL.concrete300;
        if (x * x + y * y > (R - 1) * (R - 1) && x + y > 0) col = PAL.concrete400;
      } else {
        // ретро-солнце: нижняя половина нарезана полосами, полосы к низу толще
        const v = (y + R) / (2 * R);
        col = v < 0.45 ? PAL.amber300 : v < 0.7 ? PAL.brand400 : PAL.brand500;
        if (y > 0 && (y + Math.floor(y / 4)) % 6 < Math.floor(1 + (y / R) * 3)) continue;
      }
      sg.fillStyle = col;
      sg.fillRect(cx + x, cy + y, 1, 1);
    }
  const stars = dark ? Array.from({ length: Math.floor((W * horizon) / 900) }, () => ({ x: Math.floor(rnd() * W), y: Math.floor(rnd() * horizon * 0.8), ph: Math.floor(rnd() * 64) })) : [];
  const clouds = dark ? [] : Array.from({ length: 4 }, (_, i) => ({ x: Math.floor(rnd() * W), y: Math.floor(H * (0.08 + i * 0.12)), w: 18 + Math.floor(rnd() * 24), every: 6 + i * 3 }));

  // земля: дальние холмы, монолиты-фигуры, ближний склон
  const [ground, gg] = makeCanvas(W, H);
  const far = dark ? PAL.slab700 : PAL.concrete400;
  const mid = dark ? PAL.slab900 : PAL.concrete500;
  const near = dark ? PAL.void : PAL.concrete600;
  const ridge = (base: number, amp: number, freq: number, seed: number, col: string) => {
    gg.fillStyle = col;
    for (let x = 0; x < W; x++) {
      const y = Math.floor(base - amp * (0.5 + 0.3 * Math.sin(x / freq + seed) + 0.2 * Math.sin(x / (freq * 0.37) + seed * 2)));
      gg.fillRect(x, y, 1, H - y);
    }
  };
  ridge(horizon + 2, H * 0.12, W / 9, 1, far);
  // монолиты: треугольник, квадрат, круг — силуэтами, один — красным гранитом
  const stones: [Rank, number, number, string][] = [
    [Rank.Triangle, 0.14, 1, dark ? PAL.granite800 : PAL.granite500],
    [Rank.Square, 0.27, 0.7, mid],
    [Rank.Circle, 0.7, 0.8, mid],
    [Rank.Triangle, 0.9, 0.6, mid],
  ];
  const unit = Math.max(3, Math.floor(H / 60));
  for (const [rank, fx, k, col] of stones) {
    const w = Math.floor(unit * 7 * k), hh = Math.floor(unit * 9 * k);
    const x0 = Math.floor(W * fx - w / 2), y0 = horizon + 4 - hh;
    gg.fillStyle = col;
    for (let y = 0; y < hh; y++)
      for (let x = 0; x < w; x++) {
        const u = (x + 0.5) / w, v = (y + 0.5) / hh;
        const inside = rank === Rank.Triangle ? Math.abs(u - 0.5) <= v * 0.5 : rank === Rank.Square ? true : (u - 0.5) ** 2 + (v - 0.55) ** 2 * 0.8 <= 0.25;
        if (inside) gg.fillRect(x0 + x, y0 + y, 1, 1);
      }
    // свет слева-сверху: светлая кромка по левому краю
    gg.fillStyle = dark ? PAL.slab600 : PAL.concrete300;
    for (let y = 0; y < hh; y++)
      for (let x = 0; x < w; x++) {
        const u = (x + 0.5) / w, v = (y + 0.5) / hh;
        const ul = (x - 0.5) / w;
        const inS = (uu: number) => (rank === Rank.Triangle ? Math.abs(uu - 0.5) <= v * 0.5 : rank === Rank.Square ? uu >= 0 : (uu - 0.5) ** 2 + (v - 0.55) ** 2 * 0.8 <= 0.25);
        if (col === mid && inS(u) && !inS(ul)) gg.fillRect(x0 + x, y0 + y, 1, 1);
      }
  }
  ridge(horizon + 10, H * 0.08, W / 6, 4, mid);
  ridge(H - 2, H * 0.1, W / 4, 9, near);

  return {
    animated: dark ? stars.length > 0 : clouds.length > 0,
    draw(tick) {
      g.clearRect(0, 0, W, H);
      g.drawImage(skyC, 0, 0);
      for (const s of stars) {
        const p = (tick + s.ph) % 64;
        g.fillStyle = p < 4 ? PAL.bone : p < 40 ? PAL.slab500 : PAL.slab600;
        g.fillRect(s.x, s.y, 1, 1);
        if (p < 2) {
          g.fillRect(s.x - 1, s.y, 3, 1);
          g.fillRect(s.x, s.y - 1, 1, 3);
        }
      }
      for (const c of clouds) {
        const x = ((c.x + Math.floor(tick / c.every)) % (W + c.w * 2)) - c.w;
        g.fillStyle = PAL.bone;
        g.fillRect(x, c.y, c.w, 3);
        g.fillRect(x + 4, c.y - 2, Math.floor(c.w * 0.5), 2);
        g.fillRect(x + Math.floor(c.w * 0.4), c.y - 4, Math.floor(c.w * 0.3), 2);
        g.fillStyle = PAL.concrete300;
        g.fillRect(x + 2, c.y + 3, c.w - 2, 1);
      }
      g.drawImage(ground, 0, 0);
    },
  };
};

const MAKERS: Record<Exclude<MenuBg, 'smoke'>, Make> = { board, pieces, embers, wall, scene };

/** Масштаб пикселя фона — как у пиксель-арта интерфейса: 3 на десктопе, 2 на телефоне. */
const pixScale = (w: number, h: number) => Math.max(2, Math.floor(Math.min(w, h) / 300));

/** Повесить вариант фона в контейнер экрана меню. Возвращает cleanup (снять кадр и слушатель). */
export function mountMenuBackdrop(host: HTMLElement, id: MenuBg): () => void {
  if (id === 'smoke') return () => {};
  const wrap = document.createElement('div');
  wrap.className = 'menu-bg';
  host.prepend(wrap);
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  let stop = () => {};
  const build = () => {
    stop();
    const w = wrap.clientWidth || window.innerWidth, h = wrap.clientHeight || window.innerHeight;
    const S = pixScale(w, h);
    const W = Math.ceil(w / S), H = Math.ceil(h / S);
    const [c, g] = makeCanvas(W, H);
    c.className = 'pix';
    c.style.width = `${W * S}px`;
    c.style.height = `${H * S}px`;
    wrap.replaceChildren(c);
    const sc = MAKERS[id](g, W, H);
    sc.draw(0);
    if (!sc.animated || reduce) {
      stop = () => {};
      return;
    }
    let tick = 0;
    let acc = 0;
    const off = onFrame((_, dt) => {
      acc += dt;
      if (acc < 1000 / 12) return;
      tick += Math.min(4, Math.floor(acc / (1000 / 12)));
      acc %= 1000 / 12;
      sc.draw(tick);
    });
    stop = () => void off();
  };
  // сразу — по размеру окна (экран может быть ещё не в DOM), потом пересборка при смене размера слоя (поворот телефона, окно)
  build();
  let timer = 0;
  let size = '';
  const ro = new ResizeObserver(() => {
    const k = `${wrap.clientWidth}x${wrap.clientHeight}`;
    const first = !size;
    if (k === size) return;
    size = k;
    clearTimeout(timer);
    if (!first || wrap.clientWidth !== window.innerWidth || wrap.clientHeight !== window.innerHeight) timer = window.setTimeout(build, first ? 0 : 150);
  });
  ro.observe(wrap);
  return () => {
    stop();
    clearTimeout(timer);
    ro.disconnect();
    wrap.remove();
  };
}
