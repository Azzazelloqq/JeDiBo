import { LEVELS, levelById, type LevelId } from '../../ai/levels';
import { getProfile, saveProfile } from '../../profile/profile';
import { setMood } from '../../render/background';
import { go } from '../app';
import { btn, canvasEl, h } from '../dom';
import { profileChip, tileArt, titleEl } from '../widgets';
import { codexScreen } from './codex';
import { gameScreen } from './game';
import { lobbyScreen } from './lobby';
import { profileScreen } from './profile';
import { rulesScreen } from './rules';
import { settingsScreen } from './settings';

export const VERSION = '0.1.0-PROTO';

const LEVEL_NOTE: Record<LevelId, string> = {
  novice: 'часто ошибается',
  amateur: 'не зевает простое',
  master: 'считает ответ соперника',
  grandmaster: 'думает дольше',
};

/** Выбор уровня Странника перед партией; выбранный уровень запоминается в профиле. */
function chooseLevel() {
  const current = levelById(getProfile().botLevel).id;
  const close = () => ov.remove();
  const start = (id: LevelId) => {
    saveProfile({ botLevel: id });
    close();
    go((r) => gameScreen(r, 'bot', undefined, id));
  };
  const ov = h(
    'div',
    { class: 'overlay in', onclick: (e: Event) => e.target === ov && close() },
    h(
      'div',
      { class: 'slab dialog level-dialog' },
      h('h2', {}, 'Уровень Странника'),
      h(
        'div',
        { class: 'level-list' },
        ...LEVELS.map((l) =>
          btn(
            `${l.name} · ${l.rating} — ${LEVEL_NOTE[l.id]}`,
            () => start(l.id),
            `${l.id === current ? 'btn-amber' : 'btn-stone'} level-btn`,
          ),
        ),
      ),
      h('div', { class: 'row' }, btn('Отмена', close, 'btn-stone btn-small')),
    ),
  );
  document.body.appendChild(ov);
}

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
      tile('bot', 'Против Странника', 'один за столом · рейтинг', chooseLevel),
      tile('hotseat', 'Двое за столом', 'одно устройство · без рейтинга', () => go((r) => gameScreen(r, 'hotseat'))),
      tile('net', 'По сети', 'по коду · дуэль · рейтинг', () => go(lobbyScreen)),
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
