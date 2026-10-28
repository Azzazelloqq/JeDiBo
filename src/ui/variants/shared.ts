// Общие виджеты вариантов «а» и «б»: тумблер, секции настроек, пиксельные иконки кнопок меню,
// иллюстрация плитки «Классика», рамка из фигур ○□△•, навигация стрелками.
import { Rank } from '../../core/types';
import { setBackgroundPalette, setBackgroundStyle } from '../../render/background';
import { cardFace } from '../../render/cardArt';
import { PAL } from '../../render/palette';
import { fromAscii, makeCanvas, outline, type Canvas } from '../../render/pixel';
import { cellTile, pieceSprite } from '../../render/sprites';
import { sfx } from '../../audio/sfx';
import { btn, h } from '../dom';
import { cardArtMode, setCardArtMode } from './registry';

/** Тумблер вкл/выкл (роль «switch» для клавиатуры и экранных дикторов). */
export function toggleEl(value: boolean, onToggle: (v: boolean) => void, label = '') {
  const b = h('button', { class: `vtoggle ${value ? 'on' : ''}`, role: 'switch', 'aria-checked': String(value), 'aria-label': label }, h('span', { class: 'vtoggle-thumb' }));
  b.addEventListener('click', () => {
    sfx.click();
    onToggle(!value);
  });
  return b;
}

/** Строка настройки: подпись, пояснение и контрол справа. */
export function setRow(label: string, control: Node, note = '') {
  return h('div', { class: 'vrow' }, h('div', { class: 'vrow-text' }, h('div', { class: 'vrow-label' }, label), note ? h('div', { class: 'vrow-note' }, note) : null), control);
}

/** Секция с заголовком-квадратиком и точечной линией. */
export function section(title: string, ...rows: (Node | null)[]) {
  return h('section', { class: 'vsec' }, h('div', { class: 'vsec-head' }, h('span', {}, title)), ...rows);
}

// ── пиксельные иконки нижних кнопок меню (16×16, ASCII как ICONS в cardArt.ts) ──
const IK: Record<string, string> = {
  w: PAL.bone, G: PAL.concrete200, g: PAL.concrete400, d: PAL.slab500, b: PAL.slab700, k: PAL.void,
  r: PAL.granite600, R: PAL.granite400, a: PAL.amber500, y: PAL.amber300, o: PAL.logo, t: PAL.patina500, T: PAL.patina300,
};
const MENU_ICONS: Record<'codex' | 'rules' | 'chronicle' | 'settings', string[]> = {
  codex: [
    '................', '..rrrrrr........', '..rRRRRr.wwwwww.', '..rRyyRr.wGGGGw.',
    '..rRyyRraaaaaaw.', '..rRRRRraYYYYaw.', '..rRyyRraYooYaw.', '..rRRRRraYooYaw.',
    '..rrrrrraYYYYaw.', '........aYooYaw.', '........aYYYYa..', '........aaaaaa..',
    '................', '................', '................', '................',
  ],
  rules: [
    '................', '................', '..GGGGGG.GGGGGG.', '.GwwwwwwGwwwwwwG',
    '.GwddddwGwddddwG', '.GwwwwwwGwwwwwwG', '.GwddddwGwdddwwG', '.GwwwwwwGwwwwwwG',
    '.GwdddwwGwddddwG', '.GwwwwwwGwwwwwwG', '.GwddddwGwdddwwG', '.GwwwwwwGwwwwwwG',
    '.ggggggggggggggg', '..ddddddddddddd.', '................', '................',
  ],
  chronicle: [
    '.....GGGGGG.....', '...GGwwwwwwGG...', '..GwwgggggggwG..', '..Gwg..oo..gwG..',
    '.Gwg..oooo..gwG.', '.Gwg.oooooo.gwG.', '.Gwg.oooooo.gwG.', '..Gwg......gwG..',
    '..GwwgggggggwG..', '...GGwwwwwwGG...', '....aGGGGGGa....', '....aay..yaa....',
    '....aay..yaa....', '....aa....aa....', '....a......a....', '................',
  ],
  settings: [
    '................', '......gGGg......', '..gg..gwwg..gg..', '..gGggGwwGggGg..',
    '...gGwwwwwwGg...', '...GwwddddwwG...', '.ggGwdd..ddwGgg.', '.gGwwd....dwwGg.',
    '.gGwwd....dwwGg.', '.ggGwdd..ddwGgg.', '...GwwddddwwG...', '...gGwwwwwwGg...',
    '..gGggGwwGggGg..', '..gg..gwwg..gg..', '......gGGg......', '................',
  ],
};
export type MenuIcon = keyof typeof MENU_ICONS;
const iconCache = new Map<string, Canvas>();
export function menuIcon(k: MenuIcon): Canvas {
  if (!iconCache.has(k)) iconCache.set(k, outline(fromAscii(MENU_ICONS[k], IK, 1), PAL.void));
  const src = iconCache.get(k)!;
  const [c, g] = makeCanvas(src.width, src.height);
  g.drawImage(src, 0, 0);
  return c;
}

/** Иллюстрация плитки «Классика»: кусок поля с фигурами и карта Кармы. */
export function classicArt(): Canvas {
  const W = 286, H = 92; // ×2 = внутренняя ширина плитки (ряд из 4 кнопок по 136 px)
  const [c, g] = makeCanvas(W, H);
  for (let y = 0; y < 7; y++) for (let x = 0; x < 19; x++) g.drawImage(cellTile(x, y), x * 16 - 6, y * 16 - 10);
  const put = (r: Rank, col: 'red' | 'black', cx: number, cy: number, up: boolean) => g.drawImage(pieceSprite(r, col, up), cx * 16 - 6, cy * 16 - 12);
  put(Rank.Square, 'black', 1, 1, false);
  put(Rank.Triangle, 'black', 3, 1, false);
  put(Rank.Circle, 'black', 5, 1, false);
  put(Rank.Triangle, 'black', 7, 1, false);
  put(Rank.Square, 'black', 9, 1, false);
  put(Rank.Triangle, 'black', 4, 2, false);
  put(Rank.Triangle, 'red', 6, 3, true);
  put(Rank.Circle, 'red', 2, 4, true);
  put(Rank.Square, 'red', 8, 4, true);
  put(Rank.Triangle, 'red', 10, 4, true);
  put(Rank.Triangle, 'red', 4, 5, true);
  // карта Кармы «вылетает» над полем
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(222, 14, 52, 72);
  g.drawImage(cardFace('immortal'), 218, 9);
  return c;
}

// ── рамка из наших фигур по периметру (меню «б») ──
const SHAPES: Record<string, string[]> = {
  o: ['..xxx..', '.x...x.', 'x.....x', 'x.....x', 'x.....x', '.x...x.', '..xxx..'],
  s: ['xxxxxx.', 'x....x.', 'x....x.', 'x....x.', 'x....x.', 'xxxxxx.', '.......'],
  t: ['...x...', '..x.x..', '..x.x..', '.x...x.', '.x...x.', 'xxxxxxx', '.......'],
  d: ['.......', '.......', '..xx...', '..xx...', '.......', '.......', '.......'],
};
const ORDER = ['o', 'o', 's', 't', 'd', 'o', 'o', 'o', 's', 't', 'd'];
/** Полоса-узор фигур для CSS-фона (горизонтальная или вертикальная), цвет — из CSS-переменной варианта. */
export function shapeStrip(color: string, vertical: boolean): string {
  const step = 11;
  const [c, g] = vertical ? makeCanvas(9, step * ORDER.length) : makeCanvas(step * ORDER.length, 9);
  g.fillStyle = color;
  ORDER.forEach((k, i) =>
    SHAPES[k].forEach((row, y) =>
      [...row].forEach((ch, x) => {
        if (ch !== 'x') return;
        if (vertical) g.fillRect(1 + x, i * step + 2 + y, 1, 1);
        else g.fillRect(i * step + 2 + x, 1 + y, 1, 1);
      }),
    ),
  );
  return c.toDataURL();
}
export function shapeFrame(color: string, scale = 3) {
  const hz = shapeStrip(color, false), vt = shapeStrip(color, true);
  const st = (side: string, url: string) => h('div', { class: `vframe vframe-${side}`, style: `background-image:url(${url});background-size:${(url === hz ? 11 * ORDER.length : 9) * scale}px ${(url === hz ? 9 : 11 * ORDER.length) * scale}px;--fs:${9 * scale}px` });
  return h('div', { class: 'vframe-host' }, st('top', hz), st('bottom', hz), st('left', vt), st('right', vt));
}

/** Пиксельный вихрь варианта «б»: цвета берутся из CSS-переменных темы (--b-bg-<kind>-a/b/c). */
export function swirlBackground(kind: 'menu' | 'inner') {
  const cs = getComputedStyle(document.body);
  const v = (k: string) => cs.getPropertyValue(`--b-bg-${kind}-${k}`).trim();
  setBackgroundStyle('swirl');
  setBackgroundPalette({ a: v('a'), b: v('b'), c: v('c') });
}
export const cssVar = (name: string) => getComputedStyle(document.body).getPropertyValue(name).trim();

/** Навигация стрелками между кнопками экрана (клавиатура/геймпад): ближайшая кнопка в направлении стрелки. */
export function arrowNav(root: HTMLElement, selector = 'button:not(:disabled)') {
  const onKey = (e: KeyboardEvent) => {
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!dir) return;
    const t = e.target as HTMLElement;
    if (t instanceof HTMLInputElement) return;
    const items = [...root.querySelectorAll<HTMLElement>(selector)].filter((el) => el.offsetParent);
    if (!items.length) return;
    e.preventDefault();
    const cur = items.includes(document.activeElement as HTMLElement) ? (document.activeElement as HTMLElement) : null;
    if (!cur) return items[0].focus();
    const a = cur.getBoundingClientRect();
    const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best: HTMLElement | null = null, bestD = Infinity;
    for (const el of items) {
      if (el === cur) continue;
      const b = el.getBoundingClientRect();
      const dx = b.left + b.width / 2 - ax, dy = b.top + b.height / 2 - ay;
      const along = dx * dir[0] + dy * dir[1];
      if (along <= 4) continue;
      const across = Math.abs(dx * dir[1]) + Math.abs(dy * dir[0]);
      const d = along + across * 2;
      if (d < bestD) (bestD = d), (best = el);
    }
    if (best) {
      best.focus();
      sfx.hover();
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}

/** Выбранная карта Колоды — переживает перерисовку экрана при смене режима карт и варианта. */
export const codexState = { pick: 0 };

/** Переключатель «Карты: Иконки / Иллюстрации» (Колода во всех вариантах). */
export function cardArtToggle(cls = 'btn-small') {
  const ill = cardArtMode() === 'illustrated';
  return btn(ill ? 'Карты: иллюстрации' : 'Карты: иконки', () => setCardArtMode(ill ? 'icons' : 'illustrated'), cls, { title: 'Переключить вид Карт Кармы' });
}
