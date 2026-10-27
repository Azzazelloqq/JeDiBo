// Палитра «бруталистский бетон»: холодный бетон, базальт, красный гранит.
// Источник правды — здесь; CSS получает те же значения через applyCssPalette().

export const PAL = {
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

  blood900: '#2a0707',
  blood800: '#4a0d0d',
  blood700: '#741515',
  blood600: '#9c1e1c',
  blood500: '#c22b24',
  blood400: '#e0493a',
  signal: '#ff4a36',

  amber700: '#7a4512',
  amber500: '#d4862a',
  amber300: '#f0b45a',
  amber100: '#ffe0a0',

  patina700: '#28504b',
  patina500: '#4f8f86',
  patina300: '#8cc4b9',
} as const;

/** Цвета гранита фигур: [контур, тень, основа, свет, блик, крапинка светлая, крапинка тёмная] */
export const STONE = {
  red: {
    outline: '#1e0505',
    side: '#5a0f0f',
    base: '#9c1e1c',
    light: '#bd2b25',
    hi: '#e05040',
    speckLight: '#d98a7c',
    speckDark: '#5e1010',
  },
  black: {
    outline: '#060607',
    side: '#141417',
    base: '#2b2b30',
    light: '#3d3d44',
    hi: '#62626c',
    speckLight: '#7a7a84',
    speckDark: '#121214',
  },
} as const;

export type StoneColor = keyof typeof STONE;

export function applyCssPalette() {
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(PAL)) root.setProperty(`--${k.replace(/([a-z])(\d)/g, '$1-$2')}`, v);
}
