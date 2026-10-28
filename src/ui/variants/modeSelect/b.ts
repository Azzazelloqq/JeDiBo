// Выбор режима Классики, вариант «б»: три плитки (бот / один ПК / сеть) в стиле плитки меню «б».
import { setMood } from '../../../render/background';
import { sfx } from '../../../audio/sfx';
import { btn, canvasEl, h } from '../../dom';
import { tileArt } from '../../widgets';
import { open } from '../registry';
import { arrowNav, swirlBackground } from '../shared';

export const MODES = [
  { kind: 'bot', title: 'ПРОТИВ СТРАННИКА', sub: 'БОТ • РЕЙТИНГ' },
  { kind: 'hotseat', title: 'ДВОЕ ЗА ОДНИМ ПК', sub: 'ОДНО УСТРОЙСТВО • БЕЗ РЕЙТИНГА' },
  { kind: 'net', title: 'ПО СЕТИ', sub: 'P2P • ДУЭЛЬ' },
] as const;

export function modeSelectB(root: HTMLElement) {
  setMood('menu');
  swirlBackground('menu');
  const tile = (m: (typeof MODES)[number]) => {
    const locked = m.kind === 'net';
    const el = h(
      'button',
      { class: `bm-tile bm-tile-mode ${locked ? 'locked' : ''}`, disabled: locked },
      h('div', { class: 'bm-tile-art' }, canvasEl(tileArt(m.kind), 4)),
      h('div', { class: 'bm-tile-title' }, m.title),
      h('div', { class: 'bm-tile-sub' }, m.sub),
      locked ? h('div', { class: 'bm-lock' }, 'СКОРО') : null,
    );
    if (!locked) {
      el.addEventListener('mouseenter', () => sfx.hover());
      el.addEventListener('click', () => (sfx.click(), open('game', m.kind)));
    }
    return el;
  };
  const first = tile(MODES[0]);
  root.append(
    h(
      'div',
      { class: 'b-page' },
      h(
        'div',
        { class: 'b-panel b-modes' },
        h('div', { class: 'b-head' }, h('h1', { class: 'b-title' }, 'КЛАССИКА'), h('div', { class: 'b-sub' }, 'ПОЛЕ 12×12 · 21 ФИГУРА · КАРМА — ВЫБЕРИТЕ, С КЕМ ИГРАТЬ')),
        h('div', { class: 'bms-row' }, first, tile(MODES[1]), tile(MODES[2])),
        h('div', { class: 'b-foot' }, btn('НАЗАД', () => open('menu'))),
      ),
    ),
  );
  requestAnimationFrame(() => first.focus({ preventScroll: true }));
  return arrowNav(root);
}
