import { setMood } from '../../render/background';
import { go } from '../app';
import { btn, canvasEl, h } from '../dom';
import { profileChip, tileArt, titleEl } from '../widgets';
import { codexScreen } from './codex';
import { gameScreen } from './game';
import { profileScreen } from './profile';
import { rulesScreen } from './rules';
import { settingsScreen } from './settings';

export const VERSION = '0.1.0-PROTO';

export function menuScreen(root: HTMLElement) {
  setMood('menu');
  const tile = (kind: 'bot' | 'hotseat' | 'net', title: string, sub: string, onClick: (() => void) | null) => {
    const el = h(
      'button',
      { class: `mode-tile slab ${onClick ? '' : 'locked'}`, disabled: !onClick, onclick: () => onClick?.() },
      canvasEl(tileArt(kind), 3, 'tile-art'),
      h('div', { class: 'tile-title' }, title),
      h('div', { class: 'tile-sub' }, sub),
      onClick ? null : h('div', { class: 'tile-lock' }, 'скоро'),
    );
    el.style.setProperty('--wob', `${(Math.random() - 0.5) * 2.4}deg`);
    return el;
  };

  root.append(
    h('div', { class: 'menu-top' }, profileChip(() => go(profileScreen)), h('div', { class: 'version' }, VERSION)),
    h(
      'div',
      { class: 'logo-wrap' },
      titleEl('JEDIBO', 6, { size: 24, depth: 4, font: 'Pixelify Sans' }),
      h('div', { class: 'logo-plate' }, 'КЛАССИКА · 12×12 · КАРМА'),
    ),
    h(
      'div',
      { class: 'mode-row' },
      tile('bot', 'Против Странника', 'один за столом · рейтинг', () => go((r) => gameScreen(r, 'bot'))),
      tile('hotseat', 'Двое за столом', 'одно устройство · без рейтинга', () => go((r) => gameScreen(r, 'hotseat'))),
      tile('net', 'По сети', 'p2p · дуэль', null),
    ),
    h(
      'div',
      { class: 'menu-bar' },
      btn('Колода', () => go(codexScreen)),
      btn('Правила', () => go(rulesScreen)),
      btn('Профиль', () => go(profileScreen)),
      btn('Настройки', () => go(settingsScreen)),
    ),
  );
}
