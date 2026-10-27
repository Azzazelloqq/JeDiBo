// Общие виджеты: шапка профиля, пиктограммы фигур, иллюстрации плиток меню.
import { Rank } from '../core/types';
import { getProfile, titleOf } from '../profile/profile';
import { PAL, type StoneColor } from '../render/palette';
import { concreteTile, hexToRgb, makeCanvas } from '../render/pixel';
import { avatar, pieceSprite, stoneTitle } from '../render/sprites';
import { canvasEl, h } from './dom';

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
