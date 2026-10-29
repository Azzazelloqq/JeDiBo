// Общие виджеты: логотип, слайдер, шапка профиля, пиктограммы фигур, иллюстрации плиток меню.
import { Rank } from '../core/types';
import { getProfile, titleOf } from '../profile/profile';
import { PAL, type StoneColor } from '../render/palette';
import { hexToRgb, makeCanvas } from '../render/pixel';
import { surfaceTile } from '../render/stone';
import { avatar, logoMark, logoTexture, pieceSprite, pixelLogo, stoneTitle } from '../render/sprites';
import { sfx } from '../audio/sfx';
import { canvasEl, h } from './dom';
import logoSvg from '../assets/logo/jedibo-logo.svg?raw';
import markSvg from '../assets/logo/jedibo-mark.svg?raw';

const LOGO_PX = 3;
const pixelLogoCache = new Map<number, Promise<HTMLCanvasElement>>();
/** Полный логотип в пикселях: SVG из гайда растрируется в k px на модуль знака (знак — 7 модулей по высоте,
 *  так квадраты знака ложатся на сетку ровно), затем красится гранитом (pixelLogo). Кэш — по k. */
function pixelFullLogo(k: number) {
  let p = pixelLogoCache.get(k);
  if (!p) {
    p = new Promise((res, rej) => {
      const H = 7 * k;
      const W = Math.round((438 / 151) * H);
      const svg = logoSvg.replace('<svg ', `<svg width="${W}" height="${H}" `).replace('fill="currentColor"', 'fill="#fff"');
      const img = new Image();
      img.onload = () => {
        const [c, g] = makeCanvas(W, H);
        g.drawImage(img, 0, 0, W, H);
        res(pixelLogo(c));
      };
      img.onerror = rej;
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });
    pixelLogoCache.set(k, p);
  }
  return p;
}

/** Логотип из гайда. Полный красный — пиксельный гранит (`vector: true` — исходный SVG); остальные — SVG,
 *  цвет через currentColor. `scale` — 1 ≈ 151 px по высоте (как в гайде). Мелкий знак (≤ 48 px) можно взять
 *  пиксельным: `pixel: true` (только `variant: 'mark'`). */
export function logoEl(opts: { variant?: 'full' | 'mark'; color?: 'brand' | 'ink' | 'bone'; scale?: number; pixel?: boolean; plate?: boolean; vector?: boolean } = {}) {
  const variant = opts.variant ?? 'full';
  const color = opts.color ?? 'brand';
  const scale = opts.scale ?? 1;
  let art: Element;
  if (variant === 'full' && color === 'brand' && !opts.vector) {
    // место под логотип занято сразу — без скачка раскладки, пока SVG растрируется
    const k = Math.max(3, Math.round((151 * scale) / 7 / LOGO_PX));
    const H = 7 * k;
    const W = Math.round((438 / 151) * H);
    const holder = h('div', { class: 'logo-art logo-pix', style: `width:${W * LOGO_PX}px;height:${(H + 2) * LOGO_PX}px` });
    void pixelFullLogo(k).then((src) => {
      const [c, g] = makeCanvas(src.width, src.height);
      g.drawImage(src, 0, 0);
      holder.replaceChildren(canvasEl(c, LOGO_PX));
    });
    art = holder;
  } else if (variant === 'mark' && opts.pixel) {
    const k = Math.max(2, Math.round(scale * 3));
    const tone = color === 'brand' ? PAL.logo : color === 'ink' ? PAL.void : PAL.bone;
    art = canvasEl(logoMark(k, tone), 1, 'logo-art');
  } else {
    const holder = document.createElement('div');
    holder.innerHTML = variant === 'full' ? logoSvg : markSvg;
    art = holder.firstElementChild!;
    art.classList.add('logo-art');
    art.setAttribute('role', 'img');
    art.setAttribute('aria-label', 'JeDiBo');
    const H = 151 * scale;
    art.setAttribute('height', String(Math.round(H)));
    art.setAttribute('width', String(Math.round(variant === 'full' ? (H * 438) / 151 : H)));
    if (color === 'brand') graniteFill(art as SVGSVGElement, H);
  }
  return h('div', { class: `logo logo-${variant} logo-c-${color} ${opts.plate ? 'logo-plate-slab' : ''}` }, art);
}

let logoSeq = 0;
/** Заливка логотипа красным гранитом: форма остаётся векторной и уходит в маску, поверх — плитка фактуры
 *  в собственных единицах SVG (иначе у знака, масштабированного внутри SVG, пиксели фактуры были бы крупнее). */
function graniteFill(svg: SVGSVGElement, heightPx: number) {
  const NS = 'http://www.w3.org/2000/svg';
  const mk = (tag: string, attrs: Record<string, string | number>) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    return e;
  };
  const [, , vw, vh] = (svg.getAttribute('viewBox') ?? '0 0 1 1').split(/\s+/).map(Number);
  const id = `logo-granite-${++logoSeq}`;
  const tile = (128 * vh) / heightPx; // плитка 64 px фактуры ×2 = 128 CSS px
  const shape = mk('g', { fill: '#fff' });
  shape.append(...[...svg.childNodes].filter((n) => n.nodeType === Node.ELEMENT_NODE));
  const mask = mk('mask', { id: `${id}-m`, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: vw, height: vh });
  mask.append(shape);
  const pattern = mk('pattern', { id: `${id}-p`, patternUnits: 'userSpaceOnUse', width: tile, height: tile });
  pattern.append(mk('image', { href: logoTexture(), width: tile, height: tile, preserveAspectRatio: 'none', style: 'image-rendering: pixelated' }));
  const defs = mk('defs', {});
  defs.append(mask, pattern);
  svg.replaceChildren(defs, mk('rect', { width: vw, height: vh, fill: `url(#${id}-p)`, mask: `url(#${id}-m)` }));
}

/** Пиксельный слайдер: нативный range (клавиатура, доступность) + дорожка-паз и ползунок-плита.
 *  `onChange` — когда пользователь отпустил ползунок (там удобно щёлкнуть звуком и сохранить). */
export function pixelSlider(o: { value: number; min?: number; max?: number; step?: number; label?: string; onInput?: (v: number) => void; onChange?: (v: number) => void; format?: (v: number) => string }) {
  const min = o.min ?? 0, max = o.max ?? 100, step = o.step ?? 1;
  const fmt = o.format ?? ((v: number) => String(v));
  const input = h('input', { type: 'range', class: 'pslider-input', min, max, step, value: String(o.value), 'aria-label': o.label ?? '' });
  const out = h('output', { class: 'pslider-value' }, fmt(o.value));
  const wrap = h('div', { class: 'pslider' }, h('div', { class: 'pslider-track' }, input), out);
  const paint = () => {
    const v = +input.value;
    wrap.style.setProperty('--p', String((v - min) / (max - min || 1)));
    out.textContent = fmt(v);
    input.setAttribute('aria-valuetext', fmt(v));
  };
  input.addEventListener('input', () => {
    paint();
    o.onInput?.(+input.value);
  });
  input.addEventListener('change', () => {
    sfx.click();
    o.onChange?.(+input.value);
  });
  paint();
  return wrap;
}

export function pieceIcon(rank: Rank, color: StoneColor, scale = 2, up = true) {
  const src = pieceSprite(rank, color, up);
  const [c, g] = makeCanvas(src.width, src.height);
  g.drawImage(src, 0, 0);
  return canvasEl(c, scale, 'piece-icon');
}

export function avatarEl(seed: string, scale = 5) {
  return canvasEl(avatar(seed), scale, 'avatar');
}

export function titleEl(text: string, scale = 3, opts: Parameters<typeof stoneTitle>[1] = {}) {
  return canvasEl(stoneTitle(text, opts), scale, 'stone-title');
}

export function profileChip(onClick: () => void) {
  const p = getProfile();
  const t = titleOf(p.rating);
  return h(
    'button',
    { class: 'profile-chip slab', onclick: onClick },
    avatarEl(p.avatarSeed, 4),
    h('div', { class: 'pc-text' }, h('div', { class: 'pc-name' }, p.name), h('div', { class: 'pc-sub' }, `${t.name} · ${p.rating}`)),
  );
}

const tileCache = new Map<string, HTMLCanvasElement>();
/** Иллюстрации для больших плиток меню. Рисуются один раз; каждому вызову — копия (канвас в DOM один). */
export function tileArt(kind: 'bot' | 'hotseat' | 'net'): HTMLCanvasElement {
  let src = tileCache.get(kind);
  if (!src) tileCache.set(kind, (src = drawTileArt(kind)));
  const [c, g] = makeCanvas(src.width, src.height);
  g.drawImage(src, 0, 0);
  return c;
}

function drawTileArt(kind: 'bot' | 'hotseat' | 'net'): HTMLCanvasElement {
  const W = 84, H = 46;
  const [c, g] = makeCanvas(W, H);
  // ровное поле без стёртых краёв и тени по периметру — рамку даёт CSS
  g.drawImage(surfaceTile(W, H, hexToRgb(kind === 'hotseat' ? PAL.concrete400 : PAL.concrete300), W + kind.length, {}, false), 0, 0);
  // сетка клеток
  g.fillStyle = 'rgba(0,0,0,0.12)';
  for (let x = 2; x < W; x += 16) g.fillRect(x, 0, 1, H);
  for (let y = 6; y < H; y += 16) g.fillRect(0, y, W, 1);
  const put = (r: Rank, col: StoneColor, x: number, y: number, up = true) => g.drawImage(pieceSprite(r, col, up), x, y);
  if (kind === 'bot') {
    put(Rank.Triangle, 'black', 10, 4, false);
    put(Rank.Circle, 'black', 34, 2, false);
    put(Rank.Square, 'black', 58, 5, false);
    put(Rank.Triangle, 'red', 22, 26);
    put(Rank.Square, 'red', 46, 27);
  } else if (kind === 'hotseat') {
    put(Rank.Square, 'black', 18, 6, false);
    put(Rank.Triangle, 'black', 50, 6, false);
    put(Rank.Triangle, 'red', 18, 26);
    put(Rank.Circle, 'red', 50, 26);
    g.fillStyle = PAL.amber300;
    g.fillRect(40, 20, 4, 4);
  } else {
    put(Rank.Triangle, 'red', 8, 16);
    put(Rank.Triangle, 'black', 60, 16, false);
    g.fillStyle = PAL.patina500;
    for (let x = 28; x < 58; x += 4) g.fillRect(x, 23, 2, 1);
  }
  return c;
}
