// Карта Кармы в DOM: 3D-наклон за курсором, блик, «дыхание», переворот.
import { CARDS, tierOf } from '../core/karma/cards';
import type { CardId } from '../core/types';
import { CARD_H, CARD_W, TIER_STYLE, cardFace } from '../render/cardArt';
import { cardBack } from '../render/sprites';
import { h } from './dom';

let backCache: HTMLCanvasElement | null = null;
const cloneCanvas = (src: HTMLCanvasElement) => {
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  c.getContext('2d')!.drawImage(src, 0, 0);
  return c;
};

export interface CardEl {
  el: HTMLDivElement;
  flip(faceUp: boolean): void;
}

export function cardEl(id: CardId | null, opts: { scale?: number; faceUp?: boolean; idle?: boolean; tilt?: boolean } = {}): CardEl {
  const scale = opts.scale ?? 3;
  const w = CARD_W * scale;
  const hgt = CARD_H * scale;
  backCache ??= cardBack(CARD_W, CARD_H);

  const back = cloneCanvas(backCache);
  back.className = 'pix kcard-art';
  const faces: Node[] = [back];
  let front: HTMLDivElement | null = null;
  if (id) {
    const def = CARDS[id];
    const art = cloneCanvas(cardFace(id));
    art.className = 'pix kcard-art';
    const tier = tierOf(def);
    front = h(
      'div',
      { class: `kcard-face kcard-front tier-${tier}` },
      art,
      h('div', { class: 'kcard-name' }, def.name),
      h('div', { class: 'kcard-tier', style: `color:${TIER_STYLE[tier].rim}` }, def.takesTurn ? '◆ занимает ход' : def.timing === 'period' ? '◆ период' : '◆ сразу'),
      h('div', { class: 'kcard-shine' }),
    );
  }
  const backFace = h('div', { class: 'kcard-face kcard-back' }, ...faces, h('div', { class: 'kcard-shine' }));
  const inner = h('div', { class: 'kcard-inner' }, front ?? '', backFace);
  const el = h('div', { class: `kcard ${opts.idle !== false ? 'idle' : ''}`, style: `width:${w}px;height:${hgt}px;--s:${scale}` }, inner);
  el.style.setProperty('--phase', `${Math.random() * -6}s`);
  if (opts.faceUp !== false && id) el.classList.add('face-up');

  if (opts.tilt !== false) {
    el.addEventListener('mousemove', (e) => {
      const r = el.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width - 0.5;
      const ny = (e.clientY - r.top) / r.height - 0.5;
      el.style.setProperty('--rx', `${(-ny * 22).toFixed(1)}deg`);
      el.style.setProperty('--ry', `${(nx * 26).toFixed(1)}deg`);
      el.style.setProperty('--mx', `${((nx + 0.5) * 100).toFixed(0)}%`);
      el.style.setProperty('--my', `${((ny + 0.5) * 100).toFixed(0)}%`);
      el.classList.add('hovered');
    });
    el.addEventListener('mouseleave', () => {
      el.style.setProperty('--rx', '0deg');
      el.style.setProperty('--ry', '0deg');
      el.classList.remove('hovered');
    });
  }
  return {
    el,
    flip(faceUp) {
      el.classList.toggle('face-up', faceUp);
    },
  };
}
