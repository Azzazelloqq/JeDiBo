// Палитра «Дневной бетон»: светлый литой бетон, тёплый базальт-графит, фирменный оранжевый.
// Источник правды — здесь; CSS получает те же значения через applyCssPalette()
// (slab900 → --slab-900, brand500 → --brand-500).

export const PAL = {
  // самое тёмное: контуры, жёсткие тени, текст на светлом. Тёплый графит, не чистый чёрный
  void: '#1a1918',
  ink: '#24221f',

  // базальт: рамы, поле, вложенные «утопленные» поверхности, тёмные кнопки
  slab900: '#2e2d2b',
  slab800: '#383633',
  slab700: '#46433f',
  slab600: '#57534e',
  slab500: '#6a6762',

  // бетон: панели и кнопки. Основной цвет панелей ≈ concrete200/300
  concrete600: '#7d786f',
  concrete500: '#938e84',
  concrete400: '#a9a499',
  concrete300: '#bdb8ac',
  concrete200: '#d2cdc1',
  concrete100: '#ebe6db',
  // светлый: текст на тёмном, «бумага», блики
  bone: '#f4f0e6',

  // бренд / сигнал: акценты UI, главное действие, выделение. 500 — цвет логотипа (#FF3600)
  brand800: '#7a1c00',
  brand700: '#b82600',
  brand500: '#ff3600',
  brand400: '#ff6a3a',
  brand100: '#ffd2bf',

  // гранит красных фигур (и всё, что относится к красной стороне): глубже и темнее бренда
  granite900: '#3a0e08',
  granite800: '#5c160c',
  granite700: '#7e2112',
  granite600: '#a52f1a',
  granite500: '#c43d22',
  granite400: '#e2502e',

  // Карма: тёплое золото
  amber700: '#7a4512',
  amber500: '#d4862a',
  amber300: '#f0b45a',
  amber100: '#ffe0a0',
  // бронза: плита редких Карт Кармы
  bronze500: '#a07a4a',

  // инфо / «хорошо»
  patina700: '#2f5e57',
  patina500: '#5a9e94',
  patina300: '#9fd3c8',
} as const;

/** Цвета камня фигур: [контур, тень, основа, свет, блик, крапинка светлая, крапинка тёмная].
 *  Как в 3D-версии: красные — гранит, чёрные — графит; обе читаются на светлом бетонном поле. */
export const STONE = {
  red: {
    outline: '#2a0a05',
    side: '#6b1a0e',
    base: '#a52f1a',
    light: '#c43d22',
    hi: '#e85a38',
    speckLight: '#e69a85',
    speckDark: '#6e1b10',
  },
  black: {
    outline: '#141312',
    side: '#2a2826',
    base: '#3d3a37',
    light: '#504c48',
    hi: '#78736c',
    speckLight: '#8e8982',
    speckDark: '#26241f',
  },
} as const;

export type StoneColor = keyof typeof STONE;

export function applyCssPalette() {
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(PAL)) root.setProperty(`--${k.replace(/([a-z])(\d)/g, '$1-$2')}`, v);
}
