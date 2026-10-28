// Палитры тем. Тема и поверхность выбираются один раз при загрузке (до генерации спрайтов):
// ?theme=dark|light в адресе, иначе — из настроек (localStorage). Смена — перезагрузка.
// Источник правды для цветов — здесь; CSS получает те же значения через applyCssPalette()
// (slab900 → --slab-900, brand500 → --brand-500).

export type Scheme = 'dark' | 'light';

/** Роли токенов одинаковы в обеих темах:
 *  void/ink — самое тёмное (контуры, тени) · slab* — базальт (рамы, поле, тёмные поверхности) ·
 *  concrete* — бетон (панели, кнопки) · bone — самое светлое · brand* — акцент UI, главное действие ·
 *  granite* — красные фигуры и «красная сторона» · amber* — Карма · bronze500 — редкие карты · patina* — инфо. */
const DARK = {
  // исходный тёмный дизайн: холодный бетон, базальт, красный гранит
  void: '#0b0b0c',
  ink: '#141416',
  slab900: '#1b1b1e',
  slab800: '#242428',
  slab700: '#303035',
  slab600: '#3f3f45',
  slab500: '#55555c',
  concrete600: '#5f5c57',
  concrete500: '#76726b',
  concrete400: '#918c84',
  concrete300: '#aca79d',
  concrete200: '#c4bfb4',
  concrete100: '#d9d4c9',
  bone: '#e8e3d7',
  brand800: '#4a0d0d',
  brand700: '#9c1e1c',
  brand500: '#ff4a36',
  brand400: '#e0493a',
  brand100: '#ffd2c8',
  granite900: '#2a0707',
  granite800: '#4a0d0d',
  granite700: '#741515',
  granite600: '#9c1e1c',
  granite500: '#c22b24',
  granite400: '#e0493a',
  amber700: '#7a4512',
  amber500: '#d4862a',
  amber300: '#f0b45a',
  amber100: '#ffe0a0',
  bronze500: '#a07a4a',
  patina700: '#28504b',
  patina500: '#4f8f86',
  patina300: '#8cc4b9',
  // фирменный цвет логотипа из гайда — одинаковый во всех темах
  logo: '#ff3600',
};

const LIGHT: typeof DARK = {
  // светлая: тёплый светлый камень, мягкий графит, красный акцент
  void: '#2a1d1a',
  ink: '#3a2a26',
  slab900: '#3b2c28',
  slab800: '#4a3833',
  slab700: '#5e4841',
  slab600: '#78625b',
  slab500: '#958178',
  concrete600: '#b6a79c',
  concrete500: '#cbbdb1',
  concrete400: '#ddd0c4',
  concrete300: '#e9dfd4',
  concrete200: '#f2eae1',
  concrete100: '#f9f4ee',
  bone: '#fffaf5',
  brand800: '#6e1414',
  brand700: '#a81f1f',
  brand500: '#d8352a',
  brand400: '#ee5a48',
  brand100: '#ffd9d2',
  granite900: '#3a0e0b',
  granite800: '#5c1610',
  granite700: '#7e2116',
  granite600: '#b0301f',
  granite500: '#cc3f2a',
  granite400: '#e85a40',
  amber700: '#8a4d10',
  amber500: '#d98c2b',
  amber300: '#f2b95e',
  amber100: '#ffe4ab',
  bronze500: '#b98a55',
  patina700: '#2f5e57',
  patina500: '#4e9488',
  patina300: '#9fd3c8',
  logo: '#ff3600',
};

/** Цвета камня фигур: [контур, тень, основа, свет, блик, крапинка светлая, крапинка тёмная] */
const STONES = {
  dark: {
    red: { outline: '#1e0505', side: '#5a0f0f', base: '#9c1e1c', light: '#bd2b25', hi: '#e05040', speckLight: '#d98a7c', speckDark: '#5e1010' },
    black: { outline: '#060607', side: '#141417', base: '#2b2b30', light: '#3d3d44', hi: '#62626c', speckLight: '#7a7a84', speckDark: '#121214' },
  },
  light: {
    red: { outline: '#2a0a05', side: '#6b1a0e', base: '#b0301f', light: '#cc3f2a', hi: '#ee6447', speckLight: '#eaa08a', speckDark: '#701c10' },
    black: { outline: '#1c1412', side: '#2e2624', base: '#433a37', light: '#574d49', hi: '#7f736d', speckLight: '#968a83', speckDark: '#2a2220' },
  },
};

function pick(): { scheme: Scheme } {
  let saved: { theme?: string } = {};
  try {
    saved = JSON.parse(localStorage.getItem('jedibo.settings.v1') ?? '{}') ?? {};
  } catch {
    /* нет хранилища — значения по умолчанию */
  }
  const q = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
  const t = q.get('theme') ?? saved.theme;
  return { scheme: t === 'light' ? 'light' : 'dark' };
}

/** Текущая тема — фиксируется при загрузке модуля. */
export const THEME = pick();

export const PAL: typeof DARK = { ...(THEME.scheme === 'light' ? LIGHT : DARK) };
export const STONE = STONES[THEME.scheme];

export type StoneColor = keyof typeof STONE;

export function applyCssPalette() {
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(PAL)) root.setProperty(`--${k.replace(/([a-z])(\d)/g, '$1-$2')}`, v);
}
