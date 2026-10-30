// Всплывающая подсказка у элемента: одна на сцену, сбоку от цели, не вылезает за края сцены.
// Панели игры перерисовываются через replaceChildren — цель может исчезнуть без mouseleave, поэтому пока
// подсказка видна, каждый кадр проверяем, что цель ещё в документе.
import { CARDS } from '../core/karma/cards';
import type { CardId } from '../core/types';
import { h } from './dom';
import { STAGE_H, STAGE_W, localRect, stage } from './stage';

const GAP = 12;
const EDGE = 8;

let tipEl: HTMLDivElement | null = null;
let owner: HTMLElement | null = null;
let raf = 0;

function hide() {
  cancelAnimationFrame(raf);
  owner = null;
  tipEl?.remove();
  tipEl = null;
}

function place() {
  if (!owner || !tipEl) return;
  if (!owner.isConnected) return hide();
  const r = localRect(owner);
  const w = tipEl.offsetWidth;
  const hgt = tipEl.offsetHeight;
  // справа от цели, если влезает, иначе слева
  let x = r.right + GAP;
  if (x + w > STAGE_W - EDGE) x = r.left - GAP - w;
  x = Math.max(EDGE, Math.min(x, STAGE_W - EDGE - w));
  const y = Math.max(EDGE, Math.min(r.top + r.height / 2 - hgt / 2, STAGE_H - EDGE - hgt));
  tipEl.style.left = `${Math.round(x)}px`;
  tipEl.style.top = `${Math.round(y)}px`;
  raf = requestAnimationFrame(place);
}

/** Показывать подсказку, пока курсор над элементом. content строится заново при каждом наведении. */
export function attachTip(el: HTMLElement, content: () => (Node | null)[]) {
  el.addEventListener('mouseenter', () => {
    hide();
    owner = el;
    tipEl = h('div', { class: 'tip' }, ...content());
    stage().appendChild(tipEl);
    place();
  });
  el.addEventListener('mouseleave', () => owner === el && hide());
  el.addEventListener('pointerdown', () => owner === el && hide());
}

/** Подсказка с описанием карты Кармы; возвращает тот же элемент. */
export function cardTip<E extends HTMLElement>(el: E, id: CardId): E {
  const def = CARDS[id];
  attachTip(el, () => [
    h('div', { class: 'tip-title' }, def.name),
    h('p', { class: 'tip-text' }, def.text),
    def.takesTurn ? h('span', { class: 'tag tag-brand' }, 'занимает ход') : null,
  ]);
  return el;
}
