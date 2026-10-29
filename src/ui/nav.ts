// Навигация по экранам: screen(id) — фабрика экрана по имени, open(id) — переход, initialScreen() — стартовый экран.
import type { LevelId } from '../ai/levels';
import { getProfile } from '../profile/profile';
import type { NetSession } from '../session/netSession';
import { go, type Screen } from './app';
import { codexScreen } from './screens/codex';
import { gameScreen } from './screens/game';
import { menuScreen } from './screens/menu';
import { profileScreen } from './screens/profile';
import { rulesScreen } from './screens/rules';
import { settingsScreen } from './screens/settings';

export type ScreenId = 'menu' | 'chronicle' | 'codex' | 'rules' | 'settings' | 'game';
export type GameKind = 'bot' | 'hotseat' | 'net' | 'tutorial';
/** Аргумент экрана партии: вид партии, либо с уровнем Странника / сетевой сессией. */
export type GameArg = GameKind | { kind: GameKind; level?: LevelId; net?: NetSession };
const gameArg = (a: unknown) => (typeof a === 'object' && a ? (a as Exclude<GameArg, GameKind>) : { kind: (a as GameKind | undefined) ?? 'bot' });

type Impl = (root: HTMLElement, arg?: unknown) => (() => void) | void;
const SCREENS: Record<ScreenId, Impl> = {
  menu: menuScreen,
  chronicle: profileScreen,
  codex: codexScreen,
  rules: rulesScreen,
  settings: settingsScreen,
  game: (r, a) => (({ kind, net, level }) => gameScreen(r, kind, net, level))(gameArg(a)),
};
const isScreen = (s: string | null): s is ScreenId => !!s && s in SCREENS;

/** Фабрика экрана. Запоминает экран (кроме партии), чтобы вернуться на него после перезагрузки (смена темы). */
export function screen(id: ScreenId, arg?: unknown): Screen {
  return (root) => {
    try {
      sessionStorage.setItem('jedibo.ui.screen', id === 'game' ? 'menu' : id);
    } catch {
      /* нет хранилища */
    }
    root.dataset.screen = id;
    return SCREENS[id](root, arg);
  };
}

/** Перейти на экран (короткая запись go(screen(id))). */
export const open = (id: ScreenId, arg?: unknown) => go(screen(id, arg));

/** Открыть обучение вместо стартового экрана: ?screen=tutorial или самый первый запуск (не перезагрузка страницы). */
export function wantsTutorial(): boolean {
  const q = new URLSearchParams(location.search).get('screen');
  if (q) return q === 'tutorial';
  const p = getProfile();
  if (p.tutorialDone || p.history.length) return false;
  try {
    return !sessionStorage.getItem('jedibo.ui.screen');
  } catch {
    return true;
  }
}

/** Стартовый экран: ?screen=<id> из адреса, иначе тот, где была страница до перезагрузки (смена темы); партия — в меню. */
export function initialScreen(): ScreenId {
  const q = new URLSearchParams(location.search).get('screen');
  if (isScreen(q) && q !== 'game') return q;
  try {
    const s = sessionStorage.getItem('jedibo.ui.screen');
    if (isScreen(s) && s !== 'game') return s;
  } catch {
    /* нет хранилища */
  }
  return 'menu';
}
