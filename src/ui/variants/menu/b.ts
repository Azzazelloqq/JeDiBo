// Меню, вариант «б» (референс 1:1): пиксельный вихрь, рамка из фигур, логотип, панель с кнопкой Play
// и нижний ряд кнопок-иконок. Навигация стрелками и Enter.
import { setMood } from '../../../render/background';
import { canvasEl, h } from '../../dom';
import { logoEl } from '../../widgets';
import { VERSION } from '../../screens/menu';
import { open } from '../registry';
import { arrowNav, cssVar, menuIcon, shapeFrame, swirlBackground, type MenuIcon } from '../shared';
import { sfx } from '../../../audio/sfx';

export function menuB(root: HTMLElement) {
  setMood('menu');
  swirlBackground('menu');

  const press = (el: HTMLButtonElement, go: () => void) => {
    el.addEventListener('mouseenter', () => sfx.hover());
    el.addEventListener('click', () => (sfx.click(), go()));
    return el;
  };
  const iconBtn = (icon: MenuIcon, label: string, id: Parameters<typeof open>[0]) =>
    press(h('button', { class: 'bm-icon' }, canvasEl(menuIcon(icon), 3, 'bm-icon-art'), h('span', {}, label)), () => open(id));

  // по решению владельца вместо плитки «Классика» — одна большая кнопка Play (дальше — выбор режима)
  const play = press(h('button', { class: 'bm-play', 'aria-label': 'Play' }, h('span', { class: 'bm-play-icon' }), 'PLAY'), () => open('modeSelect'));

  root.append(
    h(
      'div',
      { class: 'b-menu' },
      shapeFrame(cssVar('--b-frame')),
      h('div', { class: 'bm-version' }, VERSION),
      h('div', { class: 'bm-logo' }, logoEl({ variant: 'full', color: 'brand', scale: 1.2 })),
      h(
        'div',
        { class: 'bm-panel' },
        play,
        h('div', { class: 'bm-bar' }, iconBtn('codex', 'Колода', 'codex'), iconBtn('rules', 'Правила', 'rules'), iconBtn('chronicle', 'Летопись', 'chronicle'), iconBtn('settings', 'Настройки', 'settings')),
      ),
    ),
  );
  requestAnimationFrame(() => play.focus({ preventScroll: true }));
  return arrowNav(root);
}
