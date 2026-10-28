// Выбор режима Классики, варианты «а» и «б»: три плитки (бот / один ПК / сеть) в стиле плиток меню варианта.
import { sfx } from '../../../audio/sfx';
import { go } from '../../app';
import { btn, canvasEl, h } from '../../dom';
import { lobbyScreen } from '../../screens/lobby';
import { chooseLevel } from '../../screens/menu';
import { tileArt } from '../../widgets';
import { open } from '../registry';
import { A, arrowNav, variantBackground, type Look } from '../shared';

export const MODES = [
  { kind: 'bot', title: 'ПРОТИВ СТРАННИКА', sub: 'БОТ • РЕЙТИНГ' },
  { kind: 'hotseat', title: 'ДВОЕ ЗА ОДНИМ ПК', sub: 'ОДНО УСТРОЙСТВО • БЕЗ РЕЙТИНГА' },
  { kind: 'net', title: 'ПО СЕТИ', sub: 'ПО КОДУ • ДУЭЛЬ • РЕЙТИНГ' },
] as const;

export function modeSelectV(root: HTMLElement, v: Look) {
  variantBackground(v, 'menu');
  const launch = { bot: chooseLevel, hotseat: () => open('game', 'hotseat'), net: () => go(lobbyScreen) };
  const tile = (m: (typeof MODES)[number]) => {
    const el = h(
      'button',
      { class: `vm-tile vm-tile-mode${A(v, 'mode-tile slab')}` },
      h('div', { class: 'vm-tile-art' }, canvasEl(tileArt(m.kind), 4)),
      h('div', { class: 'vm-tile-title' }, m.title),
      h('div', { class: 'vm-tile-sub' }, m.sub),
    );
    el.addEventListener('mouseenter', () => sfx.hover());
    el.addEventListener('click', () => (sfx.click(), launch[m.kind]()));
    return el;
  };
  const first = tile(MODES[0]);
  root.append(
    h(
      'div',
      { class: 'v-page' },
      h(
        'div',
        { class: `v-panel v-modes${A(v, 'slab')}` },
        h('div', { class: `v-head${A(v, 'page-head')}` }, h('h1', { class: 'v-title' }, 'КЛАССИКА'), h('div', { class: 'v-sub' }, 'ПОЛЕ 12×12 · 21 ФИГУРА · КАРМА — ВЫБЕРИТЕ, С КЕМ ИГРАТЬ')),
        h('div', { class: 'vms-row' }, first, tile(MODES[1]), tile(MODES[2])),
        h('div', { class: 'v-foot' }, btn('НАЗАД', () => open('menu'))),
      ),
    ),
  );
  requestAnimationFrame(() => first.focus({ preventScroll: true }));
  return arrowNav(root);
}
