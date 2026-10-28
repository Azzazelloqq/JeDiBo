// Анимированные примеры для Правил: мини-поле на canvas в стиле нашего геймплея (плиты поля cellTile,
// фигуры pieceSprite, вспышки и осколки) и таймлайн шагов в цикле. Настоящий Match не используется.
// Пауза вне экрана (IntersectionObserver), prefers-reduced-motion — статичный финальный кадр со стрелками,
// скорость — из настройки «Скорость анимаций».
import { Rank } from '../../core/types';
import { getSettings } from '../../profile/profile';
import { iconCanvas } from '../../render/cardArt';
import { PAL } from '../../render/palette';
import { makeCanvas, withAlpha, type C2D } from '../../render/pixel';
import { cardBack, CELL, cellTile, pieceSprite } from '../../render/sprites';
import { onFrame } from '../../render/tween';
import { canvasEl } from '../dom';

interface DPiece { id: string; rank: Rank; color: 'red' | 'black'; x: number; y: number; hidden?: boolean; flash?: boolean; mark?: boolean }
interface Particle { x: number; y: number; vx: number; vy: number; c: string; life: number }
export interface Scene {
  pieces: DPiece[];
  hi: { x: number; y: number; c: string }[];
  pips: number;
  burn: number;
  karma: number;
  card: { x: number; y: number; flip: number } | null;
  parts: Particle[];
  arrows: { x0: number; y0: number; x1: number; y1: number }[];
  counter: string;
  zone: { rows: number[]; c: string } | null;
}
interface Step { d: number; run?: (s: Scene) => void; tw?: (s: Scene, t: number) => void }
export interface Demo { w: number; h: number; hud: 'pips' | 'karma' | 'counter' | 'none'; cell?: number; init: () => Partial<Scene>; steps: Step[] }

const HL = { move: () => withAlpha(PAL.amber300, 0.55), attack: () => withAlpha(PAL.brand500, 0.5), zone: () => withAlpha(PAL.patina300, 0.45), bad: () => withAlpha(PAL.granite500, 0.45) };
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const pc = (id: string, rank: Rank, color: 'red' | 'black', x: number, y: number): DPiece => ({ id, rank, color, x, y });
const find = (s: Scene, id: string) => s.pieces.find((p) => p.id === id)!;

// ── шаги-конструкторы ──
const pause = (d: number): Step => ({ d });
const at = (run: (s: Scene) => void, d = 0): Step => ({ d, run });
function move(id: string, x: number, y: number, d = 420, jump = false): Step {
  let from = { x: 0, y: 0 };
  return {
    d,
    run: (s) => {
      const p = find(s, id);
      from = { x: p.x, y: p.y };
      s.arrows.push({ x0: p.x, y0: p.y, x1: x, y1: y });
    },
    tw: (s, t) => {
      const p = find(s, id);
      const e = easeOut(t);
      p.x = from.x + (x - from.x) * e;
      p.y = from.y + (y - from.y) * e - (jump ? Math.sin(t * Math.PI) * 0.4 : 0);
    },
  };
}
const spendPip = (): Step => at((s) => (s.pips = Math.max(0, s.pips - 1)));
function shatter(x: number, y: number, color: 'red' | 'black'): Step {
  return at((s) => {
    const cols = color === 'red' ? [PAL.granite400, PAL.granite600, PAL.granite800] : [PAL.slab500, PAL.slab700, PAL.void];
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, v = 0.02 + Math.random() * 0.05;
      s.parts.push({ x: x * CELL + 8, y: y * CELL + 8, vx: Math.cos(a) * v * 16, vy: Math.sin(a) * v * 16 - 0.6, c: cols[i % 3], life: 1 });
    }
  });
}
const hi = (cells: [number, number][], c: () => string): Step => at((s) => (s.hi = cells.map(([x, y]) => ({ x, y, c: c() }))));
const clearHi = (): Step => at((s) => (s.hi = []));

/** Мини-доска с анимацией: canvas в нативном разрешении × scale. */
export function demoEl(demo: Demo, scale = 3) {
  const cell = demo.cell ?? CELL;
  const hudH = demo.hud === 'none' ? 0 : 12;
  const W = demo.w * cell, H = demo.h * cell + hudH;
  const [c, g] = makeCanvas(W, H);
  const el = canvasEl(c, scale, 'rules-demo');
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const fresh = (): Scene => ({ pieces: [], hi: [], pips: 5, burn: 0, karma: 0, card: null, parts: [], arrows: [], counter: '', zone: null, ...demo.init() });

  let s = fresh();
  let i = -1, tStep = 0, visible = false;
  const startStep = () => {
    i++;
    tStep = 0;
    if (i >= demo.steps.length) return;
    demo.steps[i].run?.(s);
  };
  const finishAll = () => {
    for (i = 0; i < demo.steps.length; i++) {
      demo.steps[i].run?.(s);
      demo.steps[i].tw?.(s, 1);
    }
    s.parts = [];
  };
  if (reduced) finishAll();
  else startStep();

  const draw = () => {
    g.clearRect(0, 0, W, H);
    for (let y = 0; y < demo.h; y++)
      for (let x = 0; x < demo.w; x++) g.drawImage(cellTile(x, y), x * cell, y * cell, cell, cell);
    if (s.zone) for (const r of s.zone.rows) (g.fillStyle = s.zone.c), g.fillRect(0, r * cell, W, cell);
    for (const hc of s.hi) (g.fillStyle = hc.c), g.fillRect(hc.x * cell + 1, hc.y * cell + 1, cell - 2, cell - 2);
    if (reduced) drawArrows(g, s, cell);
    for (const p of s.pieces) {
      if (p.hidden) continue;
      const spr = pieceSprite(p.rank, p.color, p.color === 'red', p.flash ? 'flash' : 'normal');
      if (cell === CELL) g.drawImage(spr, Math.round(p.x * cell), Math.round(p.y * cell));
      else g.drawImage(spr, Math.round(p.x * cell), Math.round(p.y * cell), cell, cell);
      if (p.mark) (g.fillStyle = PAL.amber300), g.fillRect(Math.round(p.x * cell) + cell - 4, Math.round(p.y * cell), 3, 5);
    }
    for (const q of s.parts) (g.globalAlpha = Math.max(0, q.life)), (g.fillStyle = q.c), g.fillRect(Math.round(q.x), Math.round(q.y), 2, 2);
    g.globalAlpha = 1;
    if (s.card) drawCard(g, s.card);
    drawHud(g, s, demo, W, demo.h * cell);
  };

  const off = onFrame((_now, dt) => {
    if (!visible || reduced || !el.isConnected) return;
    const k = getSettings().animSpeed || 1;
    tStep += dt * k;
    // частицы
    for (const q of s.parts) (q.x += q.vx), (q.y += q.vy), (q.vy += 0.12), (q.life -= 0.03 * k);
    s.parts = s.parts.filter((q) => q.life > 0);
    const st = demo.steps[i];
    if (st) {
      const t = Math.min(1, tStep / Math.max(1, st.d));
      st.tw?.(s, t);
      if (t >= 1) startStep();
    } else if (tStep > 1200) {
      s = fresh();
      i = -1;
      startStep();
    }
    draw();
  });
  const io = new IntersectionObserver((es) => (visible = es.some((e) => e.isIntersecting)));
  io.observe(el);
  draw();
  return { el, stop: () => (off(), io.disconnect()) };
}

function drawArrows(g: C2D, s: Scene, cell: number) {
  g.fillStyle = PAL.brand500;
  for (const a of s.arrows) {
    const x0 = a.x0 * cell + cell / 2, y0 = a.y0 * cell + cell / 2, x1 = a.x1 * cell + cell / 2, y1 = a.y1 * cell + cell / 2;
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let k = 0; k < n; k += 3) g.fillRect(Math.round(x0 + ((x1 - x0) * k) / n), Math.round(y0 + ((y1 - y0) * k) / n), 2, 2);
    g.fillRect(Math.round(x1) - 2, Math.round(y1) - 2, 4, 4);
  }
}

function drawCard(g: C2D, c: { x: number; y: number; flip: number }) {
  // переворот: ширина сжимается к ребру и раскрывается лицом
  const w = 26, h = 36;
  const f = Math.abs(Math.cos(c.flip * Math.PI));
  const cw = Math.max(1, Math.round(w * f));
  const x = Math.round(c.x + (w - cw) / 2), y = Math.round(c.y);
  if (c.flip < 0.5) g.drawImage(cardBack(w, h), x, y, cw, h);
  else {
    g.fillStyle = PAL.void;
    g.fillRect(x, y, cw, h);
    g.fillStyle = PAL.amber500;
    g.fillRect(x + 1, y + 1, cw - 2, h - 2);
    g.fillStyle = PAL.slab800;
    g.fillRect(x + 3, y + 3, cw - 6, h - 14);
    const ic = iconCanvas('immortal');
    if (cw > 16) g.drawImage(ic, x + Math.round((cw - ic.width) / 2), y + 5);
  }
}

function drawHud(g: C2D, s: Scene, demo: Demo, W: number, y0: number) {
  if (demo.hud === 'none') return;
  g.fillStyle = PAL.slab900;
  g.fillRect(0, y0, W, 12);
  if (demo.hud === 'pips') {
    for (let k = 0; k < 5; k++) {
      const on = k < s.pips;
      const burning = !on && k < s.pips + s.burn;
      g.fillStyle = on ? PAL.amber300 : burning ? PAL.brand500 : PAL.slab600;
      g.fillRect(3 + k * 9, y0 + 3, 7, 6);
    }
  } else if (demo.hud === 'karma') {
    for (let k = 0; k < 7; k++) {
      g.fillStyle = k < s.karma ? (k === 6 ? PAL.brand500 : PAL.amber500) : PAL.slab600;
      g.fillRect(3 + k * 9, y0 + 3, 7, 6);
    }
  } else if (demo.hud === 'counter') {
    for (let k = 0; k < 3; k++) {
      g.fillStyle = k < s.karma ? PAL.patina300 : PAL.slab600;
      g.fillRect(3 + k * 12, y0 + 3, 10, 6);
    }
  }
}

// ── сценарии ──
const T = Rank.Triangle, S = Rank.Square, C = Rank.Circle;

export const DEMOS: Record<string, Demo> = {
  // поле 12×12 и зоны расстановки: подсветка трёх своих рядов, фигуры встают скрытно
  field: {
    w: 12, h: 12, cell: 8, hud: 'none',
    init: () => ({ zone: { rows: [9, 10, 11], c: HL.zone() } }),
    steps: [
      pause(500),
      ...Array.from({ length: 12 }, (_, k) => at((s) => s.pieces.push(pc(`r${k}`, k % 4 === 0 ? S : k === 5 ? C : T, 'red', (k * 5) % 12, 9 + (k % 3))), 110)),
      pause(600),
      at((s) => (s.zone = { rows: [0, 1, 2], c: HL.bad() })),
      ...Array.from({ length: 12 }, (_, k) => at((s) => s.pieces.push(pc(`b${k}`, k % 4 === 1 ? S : k === 7 ? C : T, 'black', (k * 7) % 12, k % 3)), 110)),
      pause(900),
    ],
  },
  // 5 очков действий: каждое перемещение тратит одно
  actions: {
    w: 6, h: 4, hud: 'pips',
    init: () => ({ pieces: [pc('a', S, 'red', 1, 3), pc('b', T, 'red', 3, 3), pc('c', C, 'red', 4, 3)] }),
    steps: [pause(500), move('a', 1, 1), spendPip(), pause(250), move('b', 3, 2), spendPip(), pause(250), move('c', 5, 0, 520), spendPip(), pause(900)],
  },
  // треугольник — шаг вперёд; квадрат — 1–3 вперёд, вбок, по диагонали; круг — до 5, промежуточная клетка блокирует
  pieces: {
    w: 6, h: 6, hud: 'none',
    init: () => ({ pieces: [pc('t', T, 'red', 0, 5), pc('s', S, 'red', 5, 5), pc('c', C, 'red', 3, 5), pc('x', T, 'black', 3, 2)] }),
    steps: [
      pause(400),
      hi([[0, 4]], HL.move), pause(350), move('t', 0, 4), clearHi(), pause(300),
      hi([[5, 4], [5, 3], [5, 2], [4, 5], [4, 4], [3, 3], [2, 2]], HL.move), pause(450), move('s', 2, 2, 480), clearHi(), pause(300),
      hi([[3, 4], [3, 3], [2, 4], [1, 3], [0, 2], [4, 4], [5, 3], [2, 5], [1, 5], [0, 5], [4, 5], [5, 5]], HL.move), pause(350),
      at((s) => s.hi.push({ x: 3, y: 1, c: HL.bad() }, { x: 3, y: 0, c: HL.bad() })), pause(600), move('c', 0, 2, 560), clearHi(),
      pause(1000),
    ],
  },
  // атака: рывок, осколки, оставшиеся очки сгорают
  attack: {
    w: 6, h: 4, hud: 'pips',
    init: () => ({ pieces: [pc('s', S, 'red', 1, 3), pc('t', T, 'red', 4, 3), pc('e', T, 'black', 1, 0)], pips: 5 }),
    steps: [
      pause(400), move('t', 4, 2), spendPip(), pause(350),
      hi([[1, 0]], HL.attack), pause(450),
      move('s', 1, 0.15, 260), shatter(1, 0, 'black'), at((s) => (find(s, 'e').hidden = true)), move('s', 1, 0, 120),
      at((s) => ((s.burn = s.pips), (s.pips = 0), (s.hi = []))), pause(500), at((s) => (s.burn = 0)), pause(900),
    ],
  },
  // повышение: дошёл до последнего ряда → вспышка → квадрат в стартовой зоне; отложенное — под атакой
  promotion: {
    w: 6, h: 6, hud: 'none',
    init: () => ({ pieces: [pc('t', T, 'red', 1, 1), pc('b', S, 'black', 5, 0), pc('t2', T, 'red', 3, 1)] }),
    steps: [
      pause(400), move('t', 1, 0), at((s) => (find(s, 't').flash = true)), pause(220), at((s) => (find(s, 't').hidden = true)),
      at((s) => (s.zone = { rows: [5], c: HL.zone() })), pause(200), at((s) => s.pieces.push(pc('n', S, 'red', 1, 5))), pause(700), at((s) => (s.zone = null)),
      // отложенное: клетка под ударом чёрного квадрата (бьёт вбок)
      move('t2', 3, 0), hi([[3, 0]], HL.bad), at((s) => (find(s, 't2').mark = true)), pause(1100),
      clearHi(), at((s) => (find(s, 'b').hidden = true)), shatter(5, 0, 'black'), pause(400),
      at((s) => (find(s, 't2').flash = true)), pause(220), at((s) => ((find(s, 't2').hidden = true), s.pieces.push(pc('n2', S, 'red', 3, 5)))), pause(1000),
    ],
  },
  // Карма: трек из 7 ходов заполняется — карта вылетает и переворачивается
  karma: {
    w: 6, h: 4, hud: 'karma',
    init: () => ({ karma: 0 }),
    steps: [
      pause(300),
      ...Array.from({ length: 7 }, () => at((s) => s.karma++, 260)),
      at((s) => (s.card = { x: 4, y: 64, flip: 0 })),
      { d: 520, tw: (s, t) => s.card && ((s.card.x = 4 + 30 * easeOut(t)), (s.card.y = 64 - 50 * easeOut(t))) },
      { d: 420, tw: (s, t) => s.card && (s.card.flip = t) },
      pause(1200),
    ],
  },
  // ничья: у обоих по одинаковой фигуре, три Периода Кармы без изменений
  draw: {
    w: 6, h: 4, hud: 'counter',
    init: () => ({ pieces: [pc('r', C, 'red', 1, 3), pc('b', C, 'black', 4, 0)], karma: 0 }),
    steps: [
      pause(400), move('r', 2, 2), move('b', 3, 1), at((s) => s.karma++, 400),
      move('r', 1, 3), move('b', 4, 0), at((s) => s.karma++, 400),
      move('r', 2, 2), move('b', 3, 1), at((s) => s.karma++, 400),
      hi([[2, 2], [3, 1]], HL.zone), pause(1200),
    ],
  },
  // победа: последняя фигура соперника сбита
  win: {
    w: 6, h: 4, hud: 'none',
    init: () => ({ pieces: [pc('c', C, 'red', 0, 3), pc('t', T, 'red', 3, 3), pc('e', S, 'black', 4, 0)] }),
    steps: [pause(400), hi([[4, 0]], HL.attack), pause(400), move('c', 4, 0, 520), shatter(4, 0, 'black'), at((s) => ((find(s, 'e').hidden = true), (s.hi = []))), pause(400), hi([[4, 0]], HL.zone), pause(1100)],
  },
};
