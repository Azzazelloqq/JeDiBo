// Карта Кармы в DOM: лёгкий 3D-наклон за курсором, пиксельный блик, «дыхание», переворот.
import { CARDS, tierOf } from '../core/karma/cards';
import type { CardId } from '../core/types';
import { getSettings } from '../profile/profile';
import { CARD_H, CARD_W, cardFace } from '../render/cardArt';
import { PAL } from '../render/palette';
import { makeCanvas, withAlpha } from '../render/pixel';
import { cardBack } from '../render/sprites';
import { h } from './dom';

let backCache: HTMLCanvasElement | null = null;
const cloneCanvas = (src: HTMLCanvasElement) => {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  c.getContext('2d')!.drawImage(src, 0, 0);
  return c;
};

/** Прямоугольник в пикселях карты (52×72), где блика быть не должно. */
export type Rect = { x: number; y: number; w: number; h: number };

/** Иконочная лицевая сторона: плашка названия и строка тира. Рамка по бокам остаётся «глянцевой». */
const ICON_FACE_SAFE: Rect[] = [{ x: 3, y: 44, w: CARD_W - 6, h: CARD_H - 44 }];

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Блик «лампа по глянцу», нарисованный в разрешении карты: узкая диагональная полоса (~115°),
 *  её положение вдоль диагонали — от курсора; кромка, обращённая к свету; искры на рамке при входе.
 *  Рисуем пиксели, а не CSS-градиенты, — края полосы ступенчатые на сетке пикселя карты. */
function drawShine(c: HTMLCanvasElement, nx: number, ny: number, safe: Rect[], sparks: [number, number][], tint: string) {
  const g = c.getContext('2d')!;
  const W = c.width, H = c.height;
  g.clearRect(0, 0, W, H);
  const blocked = (x: number, y: number) => safe.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
  // полоса: пиксели, у которых x + 0.47·y попадает в окно шириной 4 (наклон ≈ 25° от вертикали)
  const SLOPE = 0.47;
  const span = W + SLOPE * H + 8;
  const pos = -4 + (nx * 0.65 + ny * 0.35) * span;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (blocked(x, y)) continue;
      const d = Math.floor(x + SLOPE * y - pos);
      if (d >= 0 && d < 4) g.fillStyle = withAlpha(tint, d === 0 || d === 3 ? 0.22 : 0.34);
      else if (d === 6) g.fillStyle = withAlpha(tint, 0.18); // тонкий второй отблеск
      else continue;
      g.fillRect(x, y, 1, 1);
    }
  // кромка, обращённая к свету (курсор = лампа): 1 пиксель карты
  g.fillStyle = withAlpha(PAL.bone, 0.5);
  const ey = ny < 0.5 ? 0 : H - 1;
  const ex = nx < 0.5 ? 0 : W - 1;
  for (let x = 0; x < W; x++) if (!blocked(x, ey)) g.fillRect(x, ey, 1, 1);
  for (let y = 0; y < H; y++) if (!blocked(ex, y)) g.fillRect(ex, y, 1, 1);
  // искры 2×2 на рамке
  g.fillStyle = PAL.bone;
  for (const [x, y] of sparks) g.fillRect(x, y, 2, 2);
}

/** Случайная точка на рамке карты (вне окна иллюстрации). */
function framePoint(): [number, number] {
  const side = Math.floor(Math.random() * 4);
  const t = Math.random();
  if (side === 0) return [Math.floor(4 + t * (CARD_W - 10)), 1];
  if (side === 1) return [CARD_W - 3, Math.floor(4 + t * 36)];
  if (side === 2) return [1, Math.floor(4 + t * 36)];
  return [Math.floor(4 + t * (CARD_W - 10)), CARD_H - 3];
}

export interface CardEl {
  el: HTMLDivElement;
  flip(faceUp: boolean): void;
}

export function cardEl(
  id: CardId | null,
  opts: { scale?: number; faceUp?: boolean; idle?: boolean; tilt?: boolean; shineSafe?: Rect[] } = {},
): CardEl {
  const scale = opts.scale ?? 3;
  const w = CARD_W * scale;
  const hgt = CARD_H * scale;
  backCache ??= cardBack(CARD_W, CARD_H);

  const shineCanvas = () => {
    const [c] = makeCanvas(CARD_W, CARD_H);
    c.className = 'pix kcard-shine';
    return c;
  };

  const back = cloneCanvas(backCache);
  back.className = 'pix kcard-art';
  const backShine = shineCanvas();
  let front: HTMLDivElement | null = null;
  let frontShine: HTMLCanvasElement | null = null;
  let tier = 'simple';
  if (id) {
    const def = CARDS[id];
    const art = cloneCanvas(cardFace(id));
    art.className = 'pix kcard-art';
    tier = tierOf(def);
    frontShine = shineCanvas();
    front = h(
      'div',
      { class: `kcard-face kcard-front tier-${tier}` },
      art,
      frontShine,
      h('div', { class: 'kcard-name' }, def.name),
      h('div', { class: 'kcard-tier' }, def.takesTurn ? '◆ занимает ход' : def.timing === 'period' ? '◆ период' : '◆ сразу'),
    );
  }
  const backFace = h('div', { class: 'kcard-face kcard-back' }, back, backShine);
  const inner = h('div', { class: 'kcard-inner' }, front ?? '', backFace);
  const el = h('div', { class: `kcard ${opts.idle !== false ? 'idle' : ''}`, style: `width:${w}px;height:${hgt}px;--s:${scale}` }, inner);
  el.style.setProperty('--phase', `${Math.random() * -6}s`);
  if (opts.faceUp !== false && id) el.classList.add('face-up');

  if (opts.tilt !== false) {
    const safe = opts.shineSafe ?? ICON_FACE_SAFE;
    const tint = tier === 'fatal' ? PAL.brand100 : tier === 'rare' ? PAL.amber100 : PAL.bone;
    let sparks: [number, number][] = [];
    let last = { nx: 0.5, ny: 0.5 };
    let sparkTimer = 0;
    const paint = () => {
      // лицевая сторона в плоскости карты, рубашка повёрнута на 180° — блик зеркалим по X
      if (frontShine) drawShine(frontShine, last.nx, last.ny, safe, sparks, tint);
      drawShine(backShine, 1 - last.nx, last.ny, [], sparks, PAL.bone);
    };
    el.addEventListener('mouseenter', () => {
      const calm = reduceMotion() || !getSettings().shake;
      if (calm) return;
      sparks = Array.from({ length: 1 + Math.floor(Math.random() * 2) }, framePoint);
      clearTimeout(sparkTimer);
      sparkTimer = window.setTimeout(() => {
        sparks = [];
        paint();
      }, 180);
    });
    el.addEventListener('mousemove', (e) => {
      const r = el.getBoundingClientRect();
      const nx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const ny = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      // наклон ≤ 10–12° — текст почти не искажается
      el.style.setProperty('--rx', `${(-(ny - 0.5) * 20).toFixed(1)}deg`);
      el.style.setProperty('--ry', `${((nx - 0.5) * 24).toFixed(1)}deg`);
      last = { nx, ny };
      paint();
      el.classList.add('hovered');
    });
    el.addEventListener('mouseleave', () => {
      el.style.setProperty('--rx', '0deg');
      el.style.setProperty('--ry', '0deg');
      el.classList.remove('hovered');
      clearTimeout(sparkTimer);
      sparks = [];
    });
  }
  return {
    el,
    flip(faceUp) {
      el.classList.toggle('face-up', faceUp);
    },
  };
}
