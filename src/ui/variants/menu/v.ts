// Меню, варианты «а» и «б» (раскладка референса; вид — стили a.css / b.css): пиксельный вихрь, рамка из фигур, логотип, панель с кнопкой «Играть»
// и нижний ряд кнопок-иконок. Навигация стрелками и Enter.
import { Rank } from '../../../core/types';
import { pieceSprite } from '../../../render/sprites';
import { canvasEl, h } from '../../dom';
import { logoEl } from '../../widgets';
import { VERSION } from '../../screens/menu';
import { open } from '../registry';
import { A, arrowNav, cssVar, menuIcon, shapeFrame, variantBackground, type Look, type MenuIcon } from '../shared';
import { sfx } from '../../../audio/sfx';

export function menuV(root: HTMLElement, v: Look) {
  variantBackground(v, 'menu');

  const press = (el: HTMLButtonElement, go: () => void) => {
    el.addEventListener('mouseenter', () => sfx.hover());
    el.addEventListener('click', () => (sfx.click(), go()));
    return el;
  };
  const iconBtn = (icon: MenuIcon, label: string, id: Parameters<typeof open>[0]) =>
    press(h('button', { class: 'vm-icon' }, canvasEl(menuIcon(icon), 3, 'vm-icon-art'), h('span', {}, label)), () => open(id));

  // по решению владельца вместо плитки «Классика» — одна кнопка «Играть» (дальше — выбор режима);
  // значок — наш красный треугольник из партии
  const tri = canvasEl(pieceSprite(Rank.Triangle, 'red', true), 5, 'vm-play-tri');
  const play = press(
    h('button', { class: 'vm-play' }, h('span', { class: 'vm-play-sheen' }), h('span', { class: 'vm-play-piece' }, tri), h('span', { class: 'vm-play-text' }, 'ИГРАТЬ')),
    () => open('modeSelect'),
  );

  root.append(
    h(
      'div',
      { class: 'v-menu' },
      shapeFrame(cssVar('--v-frame')),
      h('div', { class: 'vm-version' }, VERSION),
      h('div', { class: 'vm-logo' }, logoEl({ variant: 'full', color: 'brand', scale: v === 'a' ? 1 : 1.2, plate: v === 'a' })),
      h(
        'div',
        { class: `vm-panel${A(v, 'slab')}` },
        play,
        h('div', { class: 'vm-bar' }, iconBtn('codex', 'Колода', 'codex'), iconBtn('rules', 'Правила', 'rules'), iconBtn('chronicle', 'Летопись', 'chronicle'), iconBtn('settings', 'Настройки', 'settings')),
      ),
    ),
  );
  requestAnimationFrame(() => play.focus({ preventScroll: true }));
  return arrowNav(root);
}
