// Общие виджеты: логотип, слайдер, шапка профиля, пиктограммы фигур, иллюстрации плиток меню.
import { Rank } from '../core/types';
import { getProfile, titleOf } from '../profile/profile';
import { PAL, type StoneColor } from '../render/palette';
import { concreteTile, hexToRgb, makeCanvas } from '../render/pixel';
import { avatar, logoMark, pieceSprite, rubbleIcon, stoneTitle } from '../render/sprites';
import { sfx } from '../audio/sfx';
import { canvasEl, h } from './dom';
import logoSvg from '../assets/logo/jedibo-logo.svg?raw';
import markSvg from '../assets/logo/jedibo-mark.svg?raw';

/** Логотип из гайда. Векторный (SVG, цвет через currentColor) — без пикселизации и искажений пропорций.
 *  `scale` — высота знака в модулях×px: 1 ≈ 151 px по высоте (как в гайде). Для мелкого знака (≤ 48 px)
 *  можно взять пиксельную версию: `pixel: true` (только `variant: 'mark'`). */
export function logoEl(opts: { variant?: 'full' | 'mark'; color?: 'brand' | 'ink' | 'bone'; scale?: number; pixel?: boolean; plate?: boolean } = {}) {
  const variant = opts.variant ?? 'full';
  const color = opts.color ?? 'brand';
  const scale = opts.scale ?? 1;
  let art: Element;
  if (variant === 'mark' && opts.pixel) {
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
  }
  return h('div', { class: `logo logo-${variant} logo-c-${color} ${opts.plate ? 'logo-plate-slab' : ''}` }, art);
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

export const rubbleEl = (scale = 2) => canvasEl(rubbleIcon(), scale, 'rubble-icon');

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

/** Иллюстрации для больших плиток меню. */
export function tileArt(kind: 'bot' | 'hotseat' | 'net'): HTMLCanvasElement {
  const W = 84, H = 46;
  const [c, g] = makeCanvas(W, H);
  g.drawImage(concreteTile(W, H, hexToRgb(kind === 'bot' ? PAL.concrete300 : kind === 'hotseat' ? PAL.concrete400 : PAL.slab600), W + kind.length, { pores: 60, seams: true, amp: 10 }), 0, 0);
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
    g.fillStyle = PAL.patina300;
    for (let x = 28; x < 58; x += 4) g.fillRect(x, 23, 2, 1);
  }
  return c;
}
