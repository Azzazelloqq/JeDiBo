import { LEVELS, type LevelId } from '../../ai/levels';
import { getProfile, saveProfile } from '../../profile/profile';
import { setMood } from '../../render/background';
import { btn, canvasEl, h } from '../dom';
import { go } from '../app';
import { logoEl, profileChip, tileArt } from '../widgets';
import { open } from '../nav';
import { stage } from '../stage';
import { lobbyScreen } from './lobby';

export const VERSION = '0.1.0-PROTO';

/** Выбор уровня Странника перед партией. Уровень запоминается в профиле, но в окне не подсвечивается. */
export function chooseLevel() {
  const close = () => ov.remove();
  const start = (id: LevelId) => {
    saveProfile({ botLevel: id });
    close();
    open('game', { kind: 'bot', level: id });
  };
  const ov = h(
    'div',
    { class: 'overlay in', onclick: (e: Event) => e.target === ov && close() },
    h(
      'div',
      { class: 'slab dialog level-dialog' },
      h('h2', {}, 'Уровень бота'),
      h(
        'div',
        { class: 'level-list' },
        ...LEVELS.map((l) =>
          btn(
            `Бот ${l.name.toLowerCase()}`,
            () => start(l.id),
            'btn-stone level-btn',
          ),
        ),
      ),
      h('div', { class: 'row' }, btn('Отмена', close, 'btn-dark')),
    ),
  );
  stage().appendChild(ov);
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
    el.style.setProperty('--wob', `${(Math.random() - 0.5) * 1.2}deg`);
    return el;
  };

  // логотип, режимы и второстепенное меню — одна колонка по центру экрана: меню сразу под плитками,
  // а не прижато к нижнему краю
  root.append(
    h('div', { class: 'menu-top' }, profileChip(() => open('chronicle')), h('div', { class: 'version' }, VERSION)),
    h(
      'div',
      { class: 'menu-main' },
      h('div', { class: 'logo-wrap' }, logoEl({ variant: 'full', color: 'brand', scale: 1, plate: true, carved: true })),
      h(
        'div',
        { class: 'mode-row' },
        tile('bot', 'Против Странника', 'один за столом · рейтинг', chooseLevel),
        tile('hotseat', 'Двое за столом', 'одно устройство · без рейтинга', () => open('game', 'hotseat')),
        tile('net', 'По сети', 'по коду · дуэль · рейтинг', () => go(lobbyScreen)),
      ),
      h(
        'nav',
        { class: 'menu-bar' },
        // главный вход для новичка — выделен, пока обучение не пройдено
        btn('Обучение', () => open('game', 'tutorial'), getProfile().tutorialDone ? 'btn-stone' : 'btn-amber'),
        btn('Колода', () => open('codex')),
        btn('Правила', () => open('rules')),
        btn('Профиль', () => open('chronicle')),
        btn('Настройки', () => open('settings')),
      ),
    ),
  );
}
