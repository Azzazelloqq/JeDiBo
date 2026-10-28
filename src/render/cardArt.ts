// Лицевые стороны Карт Кармы: каменная плита по «тиру» + пиксельная иконка 14×14 (×2).
import { CARDS, tierOf, type Tier } from '../core/karma/cards';
import type { CardId } from '../core/types';
import { PAL, THEME } from './palette';
import { concreteTile, fromAscii, hexToRgb, makeCanvas, outline, px, scaleCanvas, type Canvas } from './pixel';

const K: Record<string, string> = {
  w: PAL.bone, G: PAL.concrete200, g: PAL.concrete400, d: PAL.slab500, b: PAL.slab700,
  r: PAL.granite600, R: PAL.granite400, x: PAL.granite800,
  a: PAL.amber500, y: PAL.amber300, Y: PAL.amber100,
  t: PAL.patina500, T: PAL.patina300, k: PAL.void,
};

const SKULL = ['.wwwww.', 'wwwwwww', 'wkkwkkw', 'wkkwkkw', 'wwwkwww', '.wwwww.', '.wkwkw.'];
const SKULL_DARK = SKULL.map((r) => r.replace(/w/g, 'd').replace(/k/g, 'R'));

function blit(dst: string[][], src: string[], ox: number, oy: number) {
  src.forEach((row, y) => [...row].forEach((ch, x) => ch !== '.' && dst[oy + y]?.[ox + x] !== undefined && (dst[oy + y][ox + x] = ch)));
}
function compose(parts: [string[], number, number][]): string[] {
  const grid = Array.from({ length: 14 }, () => Array(14).fill('.'));
  for (const [p, x, y] of parts) blit(grid, p, x, y);
  return grid.map((r) => r.join(''));
}

const ICONS: Record<CardId, string[]> = {
  immortal: [
    '..yyyyyyyyyy..', '.y..........y.', '..yyyyyyyyyy..', '..............',
    '......RR......', '.....RrrR.....', '.....rrrr.....', '....rrrrrr....',
    '....rrrrrr....', '...rrrrrrrr...', '...rrxxxxrr...', '..rrrrrrrrrr..',
    '..rrrrrrrrrr..', '..............',
  ],
  blitzkrieg: [
    '........yyy...', '.......yyY....', '......yyY.....', '.....yyY......',
    '....yyY.......', '...yyyyyyyy...', '...aaaaYyyy...', '.......yyy....',
    '......yya.....', '.....yya......', '....yya.......', '...ya.........',
    '..ya..........', '..a...........',
  ],
  resurrection: [
    '......RR......', '.....RRRR.....', '....RRRRRR....', '......RR......',
    '......RR......', '...gGGGGGGg...', '..gGGGwGGGGg..', '..gGGwwwGGGg..',
    '..gGGGwGGGGg..', '..gGGGwGGGdg..', '..gGGGGGGGdg..', '..gGGGGGGGdg..',
    '.dddddddddddd.', '..............',
  ],
  doubleDeath: compose([[SKULL.map((r) => r.replace(/k/g, 'x')), 0, 1], [SKULL, 7, 5], [['.rr...rr.', '...rrr...'], 3, 12]]),
  doubleDeathEnemy: compose([[SKULL_DARK, 0, 1], [SKULL_DARK, 7, 5], [['RR.RR', '.RRR.'], 1, 11]]),
  devaluation: [
    '....GGGGGG....', '...GwwwwwwG...', '..GwgggggggG..', '..Gwg....ggG..',
    '..Gwg....ggG..', '...GgggggggG..', '....GGGGGGG...', '......rr......',
    '......rr......', '......rr......', '...rrrrrrrr...', '....rrrrrr....',
    '.....rrrr.....', '......rr......',
  ],
  depression: [
    '..............', '....gggg......', '..ggGGGGgg....', '.gGGGGGGGGgg..',
    'gGGGGGGGGGGGg.', 'gggggggggggggg', '.dddddddddddd.', '..............',
    '..t...t...t...', '.t...t...t....', '..T...t...t...', '.t...T...t....',
    '..t...t...T...', '..............',
  ],
  barrier: [
    '..............', 'ykykykykykykyk', 'kykykykykykyky', 'GGGGGGgGGGGGGg',
    'GwGGGGgGwGGGGg', 'ggggggdgggggd.', 'GGGgGGGGGGgGGG', 'GGGgGwGGGGgGwG',
    'dddgdddddddgdd', 'GGGGGGgGGGGGGg', 'GwGGGGgGwGGGGg', 'ggggggdggggggd',
    'dddddddddddddd', '..............',
  ],
  careerUp: [
    '......yy......', '.....yyyy.....', '....yyyyyy....', '...yyyyyyyy...',
    '......yy......', '..........ww..', '......yy..ww..', '......yy..ww..',
    '..aa..yy..ww..', '..aa..aa..ww..', '..aa..aa..ww..', '..aa..aa..ww..',
    'dddddddddddddd', '..............',
  ],
  careerDown: [
    '..ww..........', '..ww..........', '..ww..rr......', '..ww..rr......',
    '..ww..rr..xx..', '..ww..rr..xx..', '..ww..rr..xx..', 'dddddddddddddd',
    '..............', '......RR......', '......RR......', '...RRRRRRRR...',
    '....RRRRRR....', '.....RRRR.....',
  ],
  roundProtection: [
    '......TT......', '...T..tt..T...', '....t....t....', '..............',
    '.T..tttttt..T.', '.t.tTTTTTTt.t.', '...tTwwwwTt...', '...tTwrrwTt...',
    '...tTwrrwTt...', '.t.tTwwwwTt.t.', '.T..tTTTTt..T.', '.....tttt.....',
    '....t....t....', '...T..TT..T...',
  ],
  deathLine: [
    '.....RYYR.....', '.....RYYR.....', '..R..RYYR..R..', '.....RYYR.....',
    '...R.RYYR.R...', '.....RYYR.....', '.....RYYR.....', '.R...RYYR...R.',
    '.....RYYR.....', '...R.RYYR.R...', '.....RYYR.....', '..R..RYYR..R..',
    'xxxxxRYYRxxxxx', '..............',
  ],
  retreat: [
    '..............', '..............', '...GGGGGGGG...', '..GwGGGGGGGg..',
    '..GGGGGGGGGg..', '...gggggggg...', '..............', '......RR......',
    '......RR......', '...RR.RR.RR...', '....RRRRRR....', '.....RRRR.....',
    '......RR......', '..............',
  ],
  gift: [
    '...yy....yy...', '..y..y..y..y..', '...yy.yy.yy...', '......yy......',
    '.rrrrryyrrrrr.', '.RRRRRyyRRRRR.', '.rrrrryyrrrrr.', '..xrrryyrrrx..',
    '..xrrryyrrrx..', '..xrrryyrrrx..', '..xrrryyrrrx..', '..xrrryyrrrx..',
    '..xxxxxaxxxx..', '..............',
  ],
  betrayal: [
    '.............w', '............wG', '...........wG.', '..........wG..',
    '.........wG...', '........wG....', '.......wG.....', '..a..awG......',
    '...aaaa.......', '....ar........', '...ara........', '..ra..a.......',
    '.rr...........', 'xr............',
  ],
  skipMove: [
    '.gggggggggggg.', '..dGGGGGGGGd..', '...dGyyyyGd...', '....dGyyGd....',
    '.....dGyd.....', '......dd......', '......dd......', '.....dGGd.....',
    '....dGGyGd....', '...dGGyyyGd...', '..dGyyyyyyGd..', '.gggggggggggg.',
    '..............', '..............',
  ],
  jumper: [
    '....yyyyyy....', '..yy......yy..', '.y..........y.', 'y............y',
    'y............y', '...........yyy', '............y.', '..............',
    '.ww......GGG..', 'wwww.....GwG..', 'wwww....GGGGG.', '.ww.....GGGGG.',
    'dddddddddddddd', '..............',
  ],
  freshBlood: [
    '......R.......', '.....RR.......', '.....Rr.......', '....RRrr......',
    '...RRrrrr.....', '...Rrrrrr.....', '...rrrrrx.....', '....rrxx......',
    '..............', '.r....rr...r..', 'rrr..rrrr.rrr.', 'rrr..rrrr.rrr.',
    '.....rrrr..r..', '..............',
  ],
  sideChange: [
    '..RRRRRRRR....', '.R.........R..', 'R...........R.', 'R..........RRR',
    'R...........R.', '..............', '..............', '..............',
    '..............', '.w...........w', 'www..........w', '.w...........w',
    '..w.........w.', '....wwwwwwww..',
  ],
  snail: [
    '..............', '...aaaaa......', '..aYyyyya.....', '.aYaaaaaya....',
    '.aya...aya....', '.ayaYa.aya.T.T', '.aya.yaaya.t.t', '.aaYaaaaya.ttt',
    '..aaaaaaaa.ttt', 'gggggggggggggg', '.GGGGGGGGGGGGg', '..............',
    '..............', '..............',
  ],
  spy: [
    '..............', '..............', '....wwwwww....', '..ww......ww..',
    '.w...rrrr...w.', 'w...rRRRRr...w', 'w..rRRkkRRr..w', 'w..rRRkkRRr..w',
    'w...rRRRRr...w', '.w...rrrr...w.', '..ww......ww..', '....wwwwww....',
    '..............', '..............',
  ],
};

export const TIER_STYLE: Record<Tier, { face: string; rim: string; dark: string; label: string; glow: string }> = {
  // простая — светлый бетон, редкая — бронза, роковая — бренд-оранжевый гранит
  simple: THEME.scheme === 'dark'
    ? { face: PAL.concrete300, rim: PAL.concrete100, dark: PAL.concrete600, label: 'простая', glow: PAL.concrete200 }
    : { face: PAL.concrete200, rim: PAL.bone, dark: PAL.concrete500, label: 'простая', glow: PAL.concrete100 },
  rare: { face: PAL.bronze500, rim: PAL.amber300, dark: PAL.amber700, label: 'редкая', glow: PAL.amber300 },
  fatal: { face: PAL.brand700, rim: PAL.brand400, dark: PAL.brand800, label: 'роковая', glow: PAL.brand400 },
};

const faceCache = new Map<CardId, Canvas>();
export const CARD_W = 52;
export const CARD_H = 72;

export function iconCanvas(id: CardId): Canvas {
  return outline(fromAscii(ICONS[id], K, 1), PAL.void);
}

export function cardFace(id: CardId): Canvas {
  const hit = faceCache.get(id);
  if (hit) return hit;
  const tier = TIER_STYLE[tierOf(CARDS[id])];
  const [c, g] = makeCanvas(CARD_W, CARD_H);
  g.drawImage(concreteTile(CARD_W, CARD_H, hexToRgb(tier.face), id.length * 31, { pores: 50, amp: 12, cracks: true }), 0, 0);
  const wx = 5, wy = 5, ww = CARD_W - 10, wh = 38;
  // фаска плиты
  g.fillStyle = tier.rim;
  g.fillRect(1, 1, CARD_W - 2, 1);
  g.fillRect(1, 1, 1, CARD_H - 2);
  g.fillStyle = tier.dark;
  g.fillRect(1, CARD_H - 2, CARD_W - 2, 1);
  g.fillRect(CARD_W - 2, 1, 1, CARD_H - 2);
  // окно иллюстрации, «утопленное» в плиту
  g.fillStyle = tier.dark;
  g.fillRect(wx - 1, wy - 1, ww + 2, wh + 2);
  const win = concreteTile(ww, wh, hexToRgb(PAL.slab800), 11 + id.length, { pores: 20, amp: 6 });
  g.drawImage(win, wx, wy);
  // световое пятно за иконкой
  for (let r = 15; r > 0; r -= 3) {
    g.globalAlpha = 0.06;
    g.fillStyle = tier.glow;
    g.beginPath();
    g.arc(wx + ww / 2, wy + wh / 2, r, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  g.fillStyle = 'rgba(255,255,255,0.12)';
  g.fillRect(wx, wy + wh, ww, 1);
  const icon = scaleCanvas(iconCanvas(id), 2);
  g.drawImage(icon, Math.floor(wx + (ww - icon.width) / 2), Math.floor(wy + (wh - icon.height) / 2));
  // стяжки в углах
  for (const [x, y] of [[2, CARD_H - 6], [CARD_W - 4, CARD_H - 6]]) {
    px(g, x, y, 'rgba(0,0,0,0.55)', 2, 2);
    px(g, x, y + 2, 'rgba(255,255,255,0.18)', 2, 1);
  }
  faceCache.set(id, c);
  return c;
}

// ── иллюстрированная лицевая сторона (режим «Иллюстрации», задача B) ──
// Пиксельные иллюстрации 48×68 из public/cards/pixel (scripts/pixelize-cards.py) в рамке-плите 2 px по тиру.
export const ILLUS_X = 2;
export const ILLUS_Y = 2;
const illusImg = new Map<CardId, HTMLImageElement>();
function illusImage(id: CardId) {
  let img = illusImg.get(id);
  if (!img) {
    img = new Image();
    img.src = `${import.meta.env.BASE_URL}cards/pixel/${id}.png`;
    illusImg.set(id, img);
  }
  return img;
}
/** Заранее загрузить все иллюстрации (чтобы карта в руке не появлялась пустой). */
export function preloadIllustrations() {
  (Object.keys(CARDS) as CardId[]).forEach(illusImage);
}

/** Новый канвас 52×72: рамка по тиру и иллюстрация (дорисуется, когда картинка загрузится). */
export function illusFace(id: CardId): Canvas {
  const tier = TIER_STYLE[tierOf(CARDS[id])];
  const [c, g] = makeCanvas(CARD_W, CARD_H);
  g.fillStyle = tier.face;
  g.fillRect(0, 0, CARD_W, CARD_H);
  // фаска рамки: свет сверху/слева, тень снизу/справа
  g.fillStyle = tier.rim;
  g.fillRect(0, 0, CARD_W, 1);
  g.fillRect(0, 0, 1, CARD_H);
  g.fillStyle = tier.dark;
  g.fillRect(0, CARD_H - 1, CARD_W, 1);
  g.fillRect(CARD_W - 1, 0, 1, CARD_H);
  g.fillStyle = PAL.slab800;
  g.fillRect(ILLUS_X, ILLUS_Y, CARD_W - 4, CARD_H - 4);
  const img = illusImage(id);
  const draw = () => g.drawImage(img, ILLUS_X, ILLUS_Y);
  if (img.complete && img.naturalWidth) draw();
  else img.addEventListener('load', draw, { once: true });
  return c;
}
