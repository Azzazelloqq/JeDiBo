// Реестр вариантов визуала: какой вариант (а/б/в) у какого экрана, режим Карт Кармы, текущий экран.
// Навигация между экранами идёт только через screen(id) — он выбирает реализацию нужного варианта.
// Хранение: localStorage['jedibo.ui.v1']; переопределение из адреса: ?ui=b или ?ui=menu:a,codex:b.
import { go, type Screen } from '../app';
import { toast } from '../dom';
import { codexScreen } from '../screens/codex';
import { gameScreen } from '../screens/game';
import { menuScreen } from '../screens/menu';
import { profileScreen } from '../screens/profile';
import { rulesScreen } from '../screens/rules';
import { settingsScreen } from '../screens/settings';
import { chronicleV } from './chronicle/v';
import { codexV } from './codex/v';
import { menuV } from './menu/v';
import { modeSelectV } from './modeSelect/v';
import { settingsV } from './settings/v';

/** а — «Референс · наш стиль», б — «Референс 1:1», в — «Текущий» (утверждённый дизайн A). */
export type VariantId = 'a' | 'b' | 'c';
export type ScreenId = 'menu' | 'modeSelect' | 'chronicle' | 'codex' | 'rules' | 'settings' | 'game';
export type CardArtMode = 'icons' | 'illustrated';
export type GameKind = 'bot' | 'hotseat';

export const SCREENS: ScreenId[] = ['menu', 'modeSelect', 'chronicle', 'codex', 'rules', 'settings', 'game'];
export const SCREEN_NAMES: Record<ScreenId, string> = {
  menu: 'Меню', modeSelect: 'Выбор режима', chronicle: 'Летопись', codex: 'Колода', rules: 'Правила', settings: 'Настройки', game: 'Партия',
};
export const VARIANT_NAMES: Record<VariantId, string> = { a: 'Референс · наш стиль', b: 'Референс 1:1', c: 'Текущий' };
export const VARIANT_LETTERS: Record<VariantId, string> = { a: 'А', b: 'Б', c: 'В' };

export const AVAILABLE: Record<ScreenId, VariantId[]> = {
  menu: ['a', 'b', 'c'], modeSelect: ['a', 'b'], chronicle: ['a', 'b', 'c'],
  codex: ['a', 'b', 'c'], rules: ['a', 'b', 'c'], settings: ['a', 'b', 'c'], game: ['a', 'c'],
};

type Impl = (root: HTMLElement, arg?: unknown) => (() => void) | void;
/** Реализации, которые уже есть. Если варианта ещё нет — откат на «в» (или первый существующий). */
const IMPL: Partial<Record<ScreenId, Partial<Record<VariantId, Impl>>>> = {
  menu: { a: (r) => menuV(r, 'a'), b: (r) => menuV(r, 'b'), c: menuScreen },
  modeSelect: { a: (r) => modeSelectV(r, 'a'), b: (r) => modeSelectV(r, 'b') },
  chronicle: { a: (r) => chronicleV(r, 'a'), b: (r) => chronicleV(r, 'b'), c: profileScreen },
  codex: { a: (r) => codexV(r, 'a'), b: (r) => codexV(r, 'b'), c: codexScreen },
  rules: { c: rulesScreen },
  settings: { a: (r) => settingsV(r, 'a'), b: (r) => settingsV(r, 'b'), c: settingsScreen },
  game: { c: (r, kind) => gameScreen(r, (kind as GameKind) ?? 'bot') },
};

interface Stored {
  v: Partial<Record<ScreenId, VariantId>>;
  cards: CardArtMode;
  hidden: boolean;
}

const KEY = 'jedibo.ui.v1';
const isVariant = (x: unknown): x is VariantId => x === 'a' || x === 'b' || x === 'c';

function load(): Stored {
  let s: Partial<Stored> = {};
  try {
    s = JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {};
  } catch {
    /* нет хранилища — значения по умолчанию */
  }
  // по умолчанию — «Текущий», как до свитчера
  return { v: s.v ?? {}, cards: s.cards === 'illustrated' ? 'illustrated' : 'icons', hidden: !!s.hidden };
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* приватный режим — живём без сохранения */
  }
}

const state = load();

// ?ui=b — все экраны; ?ui=menu:a,codex:b — по экранам; ?cards=illustrated|icons. Выбор из адреса запоминается, как ручной.
(function applyUrl() {
  const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
  const cards = params.get('cards');
  if (cards === 'icons' || cards === 'illustrated') state.cards = cards;
  const q = params.get('ui');
  if (!q) return save();
  for (const part of q.split(',')) {
    const [a, b] = part.split(':');
    if (b === undefined && isVariant(a)) SCREENS.forEach((s) => (state.v[s] = a));
    else if (isVariant(b) && SCREENS.includes(a as ScreenId)) state.v[a as ScreenId] = b;
  }
  save();
})();

/** Вариант экрана с откатом на доступный: недоступный «б» у партии → «в», «в» у выбора режима → «а». */
export function variantOf(s: ScreenId): VariantId {
  const want = state.v[s] ?? 'c';
  const av = AVAILABLE[s];
  if (av.includes(want)) return want;
  return av.includes('c') ? 'c' : av[0];
}

/** Реально показываемая реализация: если вариант ещё не свёрстан — ближайший существующий. */
function implOf(s: ScreenId): [VariantId, Impl] {
  const v = variantOf(s);
  const impls = IMPL[s] ?? {};
  if (impls[v]) return [v, impls[v]!];
  const order: VariantId[] = [v, 'c', 'a', 'b'];
  for (const o of order) if (impls[o]) return [o, impls[o]!];
  return ['c', IMPL.menu!.c!];
}

let current: { id: ScreenId; arg?: unknown } = { id: 'menu' };
export const currentScreen = () => current.id;

/** Фабрика экрана нужного варианта. Ставит на body класс ui-a/ui-b/ui-c (по нему скоупятся стили вариантов). */
export function screen(id: ScreenId, arg?: unknown): Screen {
  return (root) => {
    const [v, impl] = implOf(id);
    current = { id, arg };
    document.body.classList.remove('ui-a', 'ui-b', 'ui-c');
    document.body.classList.add(`ui-${v}`);
    try {
      sessionStorage.setItem('jedibo.ui.screen', id === 'game' ? 'menu' : id);
    } catch {
      /* нет хранилища */
    }
    root.dataset.screen = id;
    root.dataset.variant = v;
    const off = impl(root, arg);
    listeners.forEach((f) => f());
    return off;
  };
}

/** Перейти на экран (короткая запись go(screen(id))). */
export const open = (id: ScreenId, arg?: unknown) => go(screen(id, arg));

const listeners = new Set<() => void>();
/** Подписка на смену экрана/варианта/режима карт (для панели свитчера). */
export function onUiChange(f: () => void) {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** Сменить вариант и перерисовать текущий экран на месте. Партия меняет вид со следующей партии. */
export function setVariant(s: ScreenId | 'all', v: VariantId) {
  if (s === 'all') SCREENS.forEach((x) => (state.v[x] = v));
  else state.v[s] = v;
  save();
  if (current.id === 'game') {
    if (s === 'all' || s === 'game') toast('Вид партии сменится со следующей партии');
    listeners.forEach((f) => f());
    return;
  }
  if (s === 'all' || s === current.id || (current.id === 'modeSelect' && s === 'menu')) go(screen(current.id, current.arg));
  else listeners.forEach((f) => f());
}

/** Сохранённый выбор (без отката) — чтобы свитчер подсвечивал «Все: Б», даже если у партии «б» нет. */
export const chosenVariant = (s: ScreenId) => state.v[s] ?? 'c';

export const cardArtMode = (): CardArtMode => state.cards;
export function setCardArtMode(m: CardArtMode) {
  state.cards = m;
  save();
  if (current.id !== 'game') go(screen(current.id, current.arg));
  else listeners.forEach((f) => f());
}

export const switcherHidden = () => state.hidden;
export function setSwitcherHidden(v: boolean) {
  state.hidden = v;
  save();
}

/** Стартовый экран: ?screen=<id> из адреса (ссылки на сравнение), иначе тот, где была страница до перезагрузки
 *  (смена темы); партия — в меню. */
export function initialScreen(): ScreenId {
  const q = new URLSearchParams(location.search).get('screen') as ScreenId | null;
  if (q && SCREENS.includes(q) && q !== 'game') return q;
  try {
    const s = sessionStorage.getItem('jedibo.ui.screen') as ScreenId | null;
    if (s && SCREENS.includes(s) && s !== 'game') return s;
  } catch {
    /* нет хранилища */
  }
  return 'menu';
}
