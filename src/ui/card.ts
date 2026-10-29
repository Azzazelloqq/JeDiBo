// Карта Кармы в DOM: лёгкий 3D-наклон за курсором, пиксельный блик, «дыхание», переворот.
import { CARDS, tierOf } from '../core/karma/cards';
import type { CardId } from '../core/types';
import { getSettings } from '../profile/profile';
import { CARD_H, CARD_W, NAME_PLATE, NAME_STRIP, TEXT_BOX, cardFace, type FaceLayout } from '../render/cardArt';
import { PAL } from '../render/palette';
import { makeCanvas, withAlpha } from '../render/pixel';
import { cardBack } from '../render/sprites';
import { CARD_SHORT, KARMA_VARIANT, timingLabel } from './cardVariant';
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

/** Лицевая сторона: плашка названия и строка тира. Рамка по бокам остаётся «глянцевой». */
const ICON_FACE_SAFE: Rect[] = [{ x: 3, y: 44, w: CARD_W - 6, h: CARD_H - 44 }];
/** D «Текст на карте»: без блика всё ниже окна иллюстрации — название и поле эффекта. */
const TEXT_FACE_SAFE: Rect[] = [{ x: 3, y: 34, w: CARD_W - 6, h: CARD_H - 34 }];

const LAYOUT: FaceLayout = KARMA_VARIANT === 'a' ? 'plate' : KARMA_VARIANT === 'd' ? 'text' : 'classic';
/** Позиция в пикселях карты → проценты (DOM-текст над канвасом точно по сетке плиты). */
const box = (r: Rect) => `left:${(r.x / CARD_W) * 100}%;top:${(r.y / CARD_H) * 100}%;width:${(r.w / CARD_W) * 100}%;height:${(r.h / CARD_H) * 100}%`;

/** Подпись-тир на лице карты по варианту. */
function faceLabels(id: CardId) {
  const def = CARDS[id];
  // когда действует — на сплошной плашке внизу карты (поверх крапчатого бетона мелкий текст не читался)
  const when = h('div', { class: 'kcard-tier' }, h('span', {}, def.timing === 'period' ? 'в течение периода' : 'после получения'), def.takesTurn ? h('span', { class: 'kcard-turn' }, 'занимает ход') : null);
  if (KARMA_VARIANT === 'a')
    return [h('div', { class: 'kcard-name kv-a-name', style: box(NAME_PLATE) }, def.name), h('div', { class: 'kcard-tier kv-a-tier' }, `◆ ${timingLabel(id)}`)];
  if (KARMA_VARIANT === 'd')
    return [
      h('div', { class: 'kcard-name kv-d-name', style: box(NAME_STRIP) }, def.name),
      h('div', { class: 'kv-d-text', style: box(TEXT_BOX) }, h('span', {}, CARD_SHORT[id])),
    ];
  if (KARMA_VARIANT === 'b' || KARMA_VARIANT === 'c') return [h('div', { class: `kcard-name kv-${KARMA_VARIANT}-name` }, def.name)];
  return [h('div', { class: 'kcard-name' }, def.name), when];
}

// ── C «Подсказка»: увеличенная карта и эффект по наведению (тап на сенсорном экране) ──────────
let peekEl: HTMLElement | null = null;
let peekOwner: HTMLElement | null = null;
let peekTimer = 0;
function hidePeek() {
  clearTimeout(peekTimer);
  peekEl?.remove();
  peekEl = peekOwner = null;
}
function showPeek(owner: HTMLElement, id: CardId) {
  hidePeek();
  const def = CARDS[id];
  const big = cardEl(id, { scale: 3, idle: false, tilt: false, peek: false }).el;
  const el = h(
    'div',
    { class: `kv-peek tier-${tierOf(def)}` },
    big,
    h(
      'div',
      { class: 'kv-peek-text' },
      h('div', { class: 'kv-peek-name' }, def.name),
      h('div', { class: 'kv-peek-when' }, timingLabel(id)),
      h('div', { class: 'kv-peek-short' }, CARD_SHORT[id]),
      h('p', { class: 'kv-peek-full' }, def.text),
    ),
  );
  document.body.appendChild(el);
  const r = owner.getBoundingClientRect();
  const pw = el.offsetWidth, ph = el.offsetHeight;
  const gap = 12;
  let x = r.right + gap;
  if (x + pw > innerWidth - 8) x = r.left - gap - pw;
  if (x < 8) x = Math.max(8, Math.min(innerWidth - pw - 8, r.left + r.width / 2 - pw / 2));
  let y = Math.min(Math.max(8, r.top + r.height / 2 - ph / 2), innerHeight - ph - 8);
  // на узком экране — под картой (или над ней), во всю ширину
  if (x < r.right && x + pw > r.left) y = r.bottom + gap + ph < innerHeight ? r.bottom + gap : Math.max(8, r.top - gap - ph);
  el.style.left = `${Math.round(x)}px`;
  el.style.top = `${Math.round(y)}px`;
  peekEl = el;
  peekOwner = owner;
  // карта могла исчезнуть при перерисовке экрана — тогда и подсказку убираем
  const watch = () => {
    if (peekOwner !== owner) return;
    if (!owner.isConnected) return hidePeek();
    requestAnimationFrame(watch);
  };
  requestAnimationFrame(watch);
}
function attachPeek(el: HTMLElement, id: CardId) {
  el.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(peekTimer);
    peekTimer = window.setTimeout(() => showPeek(el, id), 180);
  });
  el.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && hidePeek());
  el.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'mouse') return;
    if (peekOwner === el) return hidePeek();
    showPeek(el, id);
    setTimeout(() => document.addEventListener('pointerdown', hidePeek, { once: true }));
  });
}

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/** Блик «лампа по глянцу», нарисованный в разрешении карты: узкая диагональная полоса (~115°), искры на рамке
 *  при входе. Лампа неподвижна (слева сверху): курсор наклоняет карту, и отражение скользит по глянцу навстречу
 *  наклону, а не бежит за курсором; светлые кромки — верхняя и левая, обращённые к лампе.
 *  Рисуем пиксели, а не CSS-градиенты, — края полосы ступенчатые на сетке пикселя карты. */
function drawShine(c: HTMLCanvasElement, nx: number, ny: number, safe: Rect[], sparks: [number, number][], tint: string) {
  const g = c.getContext('2d')!;
  const W = c.width, H = c.height;
  g.clearRect(0, 0, W, H);
  const blocked = (x: number, y: number) => safe.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
  // полоса: пиксели, у которых x + 0.47·y попадает в окно шириной 4 (наклон ≈ 25° от вертикали)
  const SLOPE = 0.47;
  const span = W + SLOPE * H + 8;
  // nx, ny = 0.5 — карта ровно, полоса посередине; наклон к правому нижнему углу уводит её влево вверх
  const t = 0.5 + ((0.5 - nx) * 0.65 + (0.5 - ny) * 0.35) * 0.9;
  const pos = -4 + t * span;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (blocked(x, y)) continue;
      const d = Math.floor(x + SLOPE * y - pos);
      if (d >= 0 && d < 4) g.fillStyle = withAlpha(tint, d === 0 || d === 3 ? 0.22 : 0.34);
      else if (d === 6) g.fillStyle = withAlpha(tint, 0.18); // тонкий второй отблеск
      else continue;
      g.fillRect(x, y, 1, 1);
    }
  // кромки, обращённые к лампе: ярче, когда карта повёрнута этой стороной к свету
  g.fillStyle = withAlpha(PAL.bone, 0.25 + 0.35 * ny);
  for (let x = 0; x < W; x++) if (!blocked(x, 0)) g.fillRect(x, 0, 1, 1);
  g.fillStyle = withAlpha(PAL.bone, 0.2 + 0.3 * nx);
  for (let y = 1; y < H; y++) if (!blocked(0, y)) g.fillRect(0, y, 1, 1);
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
  opts: { scale?: number; faceUp?: boolean; idle?: boolean; tilt?: boolean; shineSafe?: Rect[]; peek?: boolean } = {},
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
    const art = cloneCanvas(cardFace(id, LAYOUT));
    art.className = 'pix kcard-art';
    tier = tierOf(def);
    frontShine = shineCanvas();
    front = h(
      'div',
      { class: `kcard-face kcard-front tier-${tier}` },
      art,
      frontShine,
      ...faceLabels(id),
    );
  }
  const backFace = h('div', { class: 'kcard-face kcard-back' }, back, backShine);
  const inner = h('div', { class: 'kcard-inner' }, front ?? '', backFace);
  const el = h('div', { class: `kcard ${opts.idle !== false ? 'idle' : ''} ${scale <= 2 ? 'kcard-small' : ''}`, style: `width:${w}px;height:${hgt}px;--s:${scale}` }, inner);
  // подсказка — у мелких карт (рука, сетка Колоды); крупная карта в оверлее и так с текстом рядом
  if (KARMA_VARIANT === 'c' && id && opts.peek !== false && scale <= 2) attachPeek(el, id);
  el.style.setProperty('--phase', `${Math.random() * -6}s`);
  if (opts.faceUp !== false && id) el.classList.add('face-up');

  if (opts.tilt !== false) {
    const safe = opts.shineSafe ?? (LAYOUT === 'text' ? TEXT_FACE_SAFE : ICON_FACE_SAFE);
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
