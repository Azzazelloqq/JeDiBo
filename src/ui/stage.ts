// Сцена: игра свёрстана под высоту STAGE_H и целиком масштабируется под окно. Ширина сцены следует
// пропорциям окна, но не уже 4:3 и не шире 21:9 — внутри этого диапазона раскладка не разваливается.
// Окно ещё уже или шире — по краям остаются поля, через них виден живой фон (#bg за сценой, на всё окно).
// У сцены transform: элементы с position: fixed внутри неё отсчитываются от сцены, а getBoundingClientRect
// по-прежнему отдаёт координаты окна — для позиционирования в сцене их переводит localRect/toStage.

export const STAGE_H = 900;
const MIN_W = (STAGE_H * 4) / 3;
const MAX_W = (STAGE_H * 21) / 9;
/** Текущая ширина сцены (живая привязка: меняется вместе с окном). */
export let STAGE_W = 1600;

let k = 1;
let ox = 0;
let oy = 0;
const subs = new Set<() => void>();

/** Корень сцены — сюда, а не в body, добавляются оверлеи, тосты и эффекты. */
export const stage = () => document.getElementById('stage')!;

/** Во сколько раз сцена увеличена (или уменьшена) относительно CSS px. */
export const stageScale = () => k;

/** Подписка на смену масштаба сцены. */
export function onStageScale(fn: () => void) {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function initStage() {
  const el = stage();
  const fit = () => {
    STAGE_W = Math.round(Math.min(MAX_W, Math.max(MIN_W, (innerWidth / innerHeight) * STAGE_H)));
    el.style.width = `${STAGE_W}px`;
    k = Math.min(innerWidth / STAGE_W, innerHeight / STAGE_H);
    ox = Math.round((innerWidth - STAGE_W * k) / 2);
    oy = Math.round((innerHeight - STAGE_H * k) / 2);
    el.style.transform = `translate(${ox}px, ${oy}px) scale(${k})`;
    subs.forEach((f) => f());
  };
  addEventListener('resize', fit);
  fit();
}

/** Прямоугольник окна → координаты сцены. */
export const toStage = (r: DOMRect) => new DOMRect((r.left - ox) / k, (r.top - oy) / k, r.width / k, r.height / k);

/** Точка окна → координаты сцены. */
export const pointToStage = (p: { x: number; y: number }) => ({ x: (p.x - ox) / k, y: (p.y - oy) / k });

/** Прямоугольник элемента в координатах сцены. */
export const localRect = (el: Element) => toStage(el.getBoundingClientRect());
