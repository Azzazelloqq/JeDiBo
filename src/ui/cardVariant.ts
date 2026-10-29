// Варианты читаемости Карт Кармы — на сравнение владельцу (замечание тестировщика: «описание не читается»).
//   0 — как сейчас;
//   A «Плашка» — непрозрачная плашка под название на карте, описание везде на сплошной контрастной плашке;
//   B «Коротко и крупно» — короткая формулировка эффекта крупным пиксельным шрифтом, полный текст — ниже;
//   C «Подсказка» — чистое лицо карты, эффект — в увеличенной подсказке по наведению/тапу, текст моноширинным;
//   D «Текст на карте» — раскладка коллекционной карты: окно иллюстрации меньше, внизу светлое поле с эффектом.
// Выбор: ?karma=0|a|b|c|d в адресе, иначе — последний выбранный (localStorage). Смена — перезагрузка,
// как у темы: лицевые стороны карт генерируются один раз. Вкладка «Карты» у левого края — переключатель.
import { CARDS } from '../core/karma/cards';
import type { CardId } from '../core/types';
import { h } from './dom';

export type KarmaVariant = '0' | 'a' | 'b' | 'c' | 'd';
const ALL: KarmaVariant[] = ['0', 'a', 'b', 'c', 'd'];
const KEY = 'jedibo.dev.karmaVariant';

export const VARIANT_NAME: Record<KarmaVariant, string> = {
  '0': 'Как сейчас',
  a: 'Плашка',
  b: 'Коротко и крупно',
  c: 'Подсказка',
  d: 'Текст на карте',
};

function pick(): KarmaVariant {
  const q = new URLSearchParams(location.search).get('karma')?.toLowerCase();
  if (ALL.includes(q as KarmaVariant)) return q as KarmaVariant;
  try {
    const s = localStorage.getItem(KEY);
    if (ALL.includes(s as KarmaVariant)) return s as KarmaVariant;
  } catch {
    /* нет хранилища */
  }
  return '0';
}

/** Текущий вариант — фиксируется при загрузке. */
export const KARMA_VARIANT = pick();

/** Короткие формулировки эффектов (B, D, подсказка C). Полный текст — CardDef.text. */
export const CARD_SHORT: Record<CardId, string> = {
  immortal: 'Верните фигуру, павшую в этот Период',
  blitzkrieg: 'До 5 действий одной фигурой',
  resurrection: 'Верните любую павшую фигуру',
  doubleDeath: 'Враг убирает 2 ваши фигуры',
  doubleDeathEnemy: 'Уберите 2 фигуры врага',
  devaluation: 'Враг понижает ранг 2 ваших фигур',
  depression: 'Квадраты и Круги — на 1 клетку до конца Периода',
  barrier: '2 клетки в ряд закрыты до конца Периода',
  careerUp: '+1 ранг двум фигурам',
  careerDown: 'Понизьте ранг 2 своих фигур',
  roundProtection: 'Треугольники и Квадраты бьют во все стороны',
  deathLine: 'Случайный столбец: все фигуры гибнут',
  retreat: '3 свои фигуры — на клетку назад',
  gift: 'Получите Круг',
  betrayal: 'Враг двигает 3 ваши фигуры',
  skipMove: 'Вы пропускаете ход',
  jumper: 'Фигуры, кроме Треугольника, прыгают через клетку',
  freshBlood: 'Получите Треугольник, Квадрат и Круг',
  sideChange: 'До конца партии играете фигурами врага',
  snail: 'Квадраты и Круги — на 1 клетку до конца хода',
  spy: 'Заберите фигуру врага до конца партии',
};

/** Когда действует: короткая подпись для карты и подсказки. */
export const timingLabel = (id: CardId) => {
  const d = CARDS[id];
  return d.takesTurn ? 'занимает ход' : d.timing === 'period' ? 'в течение периода' : 'сразу';
};

/** Текст эффекта в Колоде и оверлее Кармы: по варианту — плашка, короткая + полная, моноширинный. */
export function effectText(id: CardId, cls: string): HTMLElement {
  const full = CARDS[id].text;
  if (KARMA_VARIANT === 'b')
    return h('div', { class: `${cls} kv-effect` }, h('div', { class: 'kv-short' }, CARD_SHORT[id]), h('div', { class: 'kv-full' }, full));
  return h('p', { class: `${cls} kv-effect` }, full);
}

/** Эффект карты в руке рядом с мини-картой (в «как сейчас» его нет вовсе — только название). */
export function heldText(id: CardId): HTMLElement | null {
  if (KARMA_VARIANT === 'a') return h('div', { class: 'kv-held kv-plate' }, CARDS[id].text);
  if (KARMA_VARIANT === 'b') return h('div', { class: 'kv-held kv-short' }, CARD_SHORT[id]);
  if (KARMA_VARIANT === 'c') return h('div', { class: 'kv-held muted small' }, 'наведите на карту — эффект');
  return null; // D: эффект напечатан на самой карте
}

/** Масштаб карты в руке: у D на лице текст — карта крупнее. */
export const heldScale = () => (KARMA_VARIANT === 'd' ? 3 : 2);

/** Вкладка-переключатель у левого края (dev-сборка или ?karma= в адресе). */
export function mountKarmaSwitcher() {
  document.body.classList.add(`kv-${KARMA_VARIANT}`);
  if (!import.meta.env.DEV && !new URLSearchParams(location.search).has('karma')) return;
  if (new URLSearchParams(location.search).has('shot')) return;
  const set = (v: KarmaVariant) => {
    try {
      localStorage.setItem(KEY, v);
    } catch {
      /* нет хранилища */
    }
    const u = new URL(location.href);
    u.searchParams.set('karma', v);
    location.replace(u.toString());
  };
  const tab = h(
    'div',
    { class: 'kv-switch' },
    h('div', { class: 'kv-switch-title' }, 'Карты'),
    ...ALL.map((v) =>
      h('button', { class: `kv-switch-btn ${v === KARMA_VARIANT ? 'on' : ''}`, title: VARIANT_NAME[v], onClick: () => set(v) }, v === '0' ? '0' : v.toUpperCase()),
    ),
    h('div', { class: 'kv-switch-name' }, VARIANT_NAME[KARMA_VARIANT]),
  );
  document.body.appendChild(tab);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F4') tab.classList.toggle('hidden');
  });
}
