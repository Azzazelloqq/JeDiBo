// Получение карты Кармы («Сдача»): карта вылетает из колоды дугой, переворачивается с лучами и волной,
// по «В руку» летит со шлейфом в слот руки, слот её ловит. Карта «после получения» в руку не идёт — рассыпается искрами.
import { hiss, sfx, voice } from '../audio/sfx';
import { CARDS, tierOf } from '../core/karma/cards';
import type { CardId } from '../core/types';
import { getSettings } from '../profile/profile';
import { shake } from '../render/fx';
import { animSpeed, wait } from '../render/tween';
import type { CardEl } from './card';
import { h } from './dom';

/** Без лишнего движения — прежний показ карты (влёт сбоку и переворот). */
export const calmMotion = () => (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false) || !getSettings().shake;

// ── общие кирпичики ────────────────────────────────────────────────────────
const ms = (x: number) => x / animSpeed();
const play = (el: Element, frames: Keyframe[], dur: number, opts: KeyframeAnimationOptions = {}) =>
  el.animate(frames, { duration: ms(dur), fill: 'both', ...opts }).finished.catch(() => undefined);
const center = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

/** Цвет искр по тиру карты: смертельная — красная, редкая — янтарная, простая — кость. */
function tierColors(card: CardId) {
  const t = tierOf(CARDS[card]);
  if (t === 'fatal') return ['var(--brand-500)', 'var(--brand-100)', 'var(--amber-300)'];
  if (t === 'rare') return ['var(--amber-300)', 'var(--amber-100)', 'var(--bone)'];
  return ['var(--bone)', 'var(--amber-100)', 'var(--amber-300)'];
}

/** Пиксельные искры: квадраты летят из точки, гравитация тянет вниз (g < 0 — вверх, как угли). */
function burst(x: number, y: number, o: { n: number; colors: string[]; speed: number; size?: number[]; life?: number; g?: number; spread?: number; dir?: number }) {
  for (let i = 0; i < o.n; i++) {
    const sz = o.size ? o.size[Math.floor(Math.random() * o.size.length)] : 4 + 4 * Math.floor(Math.random() * 2);
    const p = h('div', { class: 'kd-spark', style: `left:${x}px;top:${y}px;width:${sz}px;height:${sz}px;background:${o.colors[i % o.colors.length]}` });
    document.body.appendChild(p);
    const a = (o.dir ?? 0) + (Math.random() - 0.5) * (o.spread ?? Math.PI * 2);
    const v = o.speed * (0.45 + Math.random() * 0.75);
    const life = (o.life ?? 650) * (0.7 + Math.random() * 0.5);
    const g = o.g ?? 260;
    const dx = Math.cos(a) * v, dy = Math.sin(a) * v;
    // параболу раскладываем на ключевые кадры — шаги по целым пикселям
    const frames: Keyframe[] = [];
    for (let k = 0; k <= 6; k++) {
      const t = k / 6;
      const px = Math.round(dx * t);
      const py = Math.round(dy * t + g * t * t);
      frames.push({ transform: `translate(${px - sz / 2}px, ${py - sz / 2}px)`, opacity: k < 4 ? 1 : 1 - (k - 3) / 3 });
    }
    void play(p, frames, life, { easing: 'linear' }).then(() => p.remove());
  }
}

/** Ударная волна ромбом: рамка расширяется ступеньками. */
function ring(x: number, y: number, o: { size: number; color: string; dur?: number }) {
  const r = h('div', { class: 'kd-ring', style: `left:${x}px;top:${y}px;border-color:${o.color}` });
  document.body.appendChild(r);
  void play(
    r,
    [
      { transform: 'translate(-50%, -50%) rotate(45deg) scale(0.2)', width: '40px', height: '40px', opacity: 1 },
      { transform: 'translate(-50%, -50%) rotate(45deg) scale(1)', width: `${o.size}px`, height: `${o.size}px`, opacity: 0 },
    ],
    o.dur ?? 520,
    { easing: 'steps(7, end)' },
  ).then(() => r.remove());
}

/** Белая вспышка поверх карты — на миг «засвечивает» лицо. */
function flashOn(el: HTMLElement, dur = 180) {
  const f = h('div', { class: 'kd-flash' });
  el.appendChild(f);
  void play(f, [{ opacity: 0.95 }, { opacity: 0 }], dur, { easing: 'steps(4, end)' }).then(() => f.remove());
}

/** Лучи за картой — ступенчатые лопасти, медленно вращаются, пока открыт оверлей. */
function rays(host: HTMLElement, card: CardId) {
  const r = h('div', { class: 'kd-rays', style: `--ray:${tierColors(card)[0]}` });
  host.prepend(r);
  void play(r, [{ opacity: 0, transform: 'translate(-50%, -50%) scale(0.3) rotate(0deg)' }, { opacity: 1, transform: 'translate(-50%, -50%) scale(1) rotate(25deg)' }], 420, {
    easing: 'cubic-bezier(0.2, 1.4, 0.4, 1)',
  }).then(() => r.classList.add('spin'));
}

// ── звуки ─────────────────────────────────────────────────────────────────
const snd = {
  whoosh(d: number) {
    hiss({ f: 500, to: 3200, dur: ms(d * 1000) / 1000, gain: 0.35, q: 1.6, attack: ms(d * 700) / 1000 });
  },
  reveal(card: CardId) {
    const t = tierOf(CARDS[card]);
    const base = t === 'fatal' ? 220 : t === 'rare' ? 392 : 330;
    [1, 1.25, 1.5, 2].forEach((k, i) => voice({ f: base * k, dur: 0.35, gain: 0.07, type: 'triangle', delay: i * 0.05 }));
    hiss({ f: 6000, dur: 0.25, gain: 0.12, q: 0.7 });
    if (t === 'fatal') voice({ f: 55, to: 40, dur: 0.6, gain: 0.35 });
  },
  catch_() {
    voice({ f: 190, to: 110, dur: 0.1, gain: 0.3, type: 'triangle' });
    hiss({ f: 1800, dur: 0.05, gain: 0.35, q: 1.5 });
    voice({ f: 1046, dur: 0.18, gain: 0.05, type: 'triangle', delay: 0.04 });
    voice({ f: 1568, dur: 0.22, gain: 0.04, type: 'triangle', delay: 0.09 });
  },
  dissolve() {
    hiss({ f: 3000, to: 300, dur: ms(300) / 1000, gain: 0.4, q: 2.5, attack: ms(90) / 1000 });
    voice({ f: 880, to: 220, dur: ms(300) / 1000, gain: 0.06, type: 'square' });
  },
};

// ── выход карты ───────────────────────────────────────────────────────────
/** Карта вылетает из from (колода или рука) в оверлей и переворачивается лицом. host — обёртка .kr-card. */
export async function entrance(host: HTMLElement, c: CardEl, card: CardId, from: DOMRect | null) {
  const el = c.el;
  const box = el.getBoundingClientRect();
  const mid = center(box);
  const colors = tierColors(card);
  const src = from ? center(from) : { x: innerWidth + 120, y: innerHeight * 0.3 };
  const dx = src.x - mid.x, dy = src.y - mid.y;
  const s0 = from ? Math.max(0.18, from.width / box.width) : 0.4;
  snd.whoosh(0.42);
  await play(
    el,
    [
      { transform: `translate(${dx}px, ${dy}px) rotate(-30deg) scale(${s0})` },
      { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 180}px) rotate(-200deg) scale(0.75)`, offset: 0.45 },
      { transform: 'translate(0, -12px) rotate(-345deg) scale(1.18)', offset: 0.82 },
      { transform: 'translate(0, 0) rotate(-360deg) scale(1)' },
    ],
    560,
    { easing: 'cubic-bezier(0.3, 0.1, 0.3, 1)', fill: 'none' },
  );
  shake(3);
  burst(mid.x, box.bottom, { n: 10, colors: ['var(--slab-500)', 'var(--slab-600)'], speed: 110, g: 60, dir: -Math.PI / 2, spread: Math.PI, life: 420 });
  await wait(160);
  c.flip(true);
  sfx.cardFlip();
  await wait(170);
  flashOn(el);
  rays(host, card);
  ring(mid.x, mid.y, { size: 520, color: colors[0] });
  burst(mid.x, mid.y, { n: 28, colors, speed: 320, life: 760, g: 220 });
  snd.reveal(card);
  shake(4);
  await wait(200);
}

// ── в руку ────────────────────────────────────────────────────────────────
/** Вынимает карту из оверлея в отдельный слой поверх всего — оверлей можно убирать, карта остаётся на месте. */
export function lift(c: CardEl) {
  const r = c.el.getBoundingClientRect();
  const layer = h('div', { class: 'kd-fly', style: `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px` });
  document.body.appendChild(layer);
  layer.appendChild(c.el);
  c.el.classList.remove('idle');
  return layer;
}

/** Полёт поднятой карты в слот руки. target — уже отрисованная карта в панели игрока (её прячем до приземления). */
export async function toHand(fly: HTMLElement, target: HTMLElement | null, card: CardId) {
  const from = fly.getBoundingClientRect();
  if (!target) {
    await play(fly, [{ opacity: 1 }, { opacity: 0, transform: 'scale(0.6)' }], 260);
    fly.remove();
    return;
  }
  target.style.visibility = 'hidden';
  const to = target.getBoundingClientRect();
  const a = center(from), b = center(to);
  const dx = b.x - a.x, dy = b.y - a.y;
  const k = to.width / from.width;
  const side = Math.sign(dx) || -1;
  const colors = tierColors(card);
  // замах: чуть приподнять, потом дугой со шлейфом
  await play(fly, [{ transform: 'none' }, { transform: `translateY(-14px) rotate(${-side * 4}deg) scale(1.08)` }], 140, { easing: 'ease-out' });
  snd.whoosh(0.36);
  const anim = fly.animate(
    [
      { transform: `translateY(-14px) rotate(${-side * 4}deg) scale(1.08)` },
      { transform: `translate(${dx * 0.35}px, ${dy * 0.35 - 150}px) rotate(${side * 14}deg) scale(${0.5 + k * 0.5})`, offset: 0.45 },
      { transform: `translate(${dx}px, ${dy}px) rotate(0deg) scale(${k})` },
    ],
    { duration: ms(440), easing: 'cubic-bezier(0.45, 0, 0.55, 1)', fill: 'forwards' },
  );
  trail(fly, from, anim, colors[0]);
  await anim.finished.catch(() => undefined);
  target.style.visibility = '';
  fly.remove();
  land(target, colors);
}

/** Шлейф: контуры карты остаются на пути и гаснут ступеньками. */
function trail(fly: HTMLElement, from: DOMRect, anim: Animation, color: string) {
  const id = setInterval(() => {
    if (anim.playState !== 'running') return clearInterval(id);
    const g = h('div', { class: 'kd-ghost', style: `left:${from.left}px;top:${from.top}px;width:${from.width}px;height:${from.height}px;border-color:${color};transform:${getComputedStyle(fly).transform}` });
    document.body.appendChild(g);
    void play(g, [{ opacity: 0.8 }, { opacity: 0 }], 260, { easing: 'steps(4, end)' }).then(() => g.remove());
  }, ms(34));
}

/** Слот руки ловит карту: сплющивание, вспышка рамки, волна и искры. */
function land(target: HTMLElement, colors: string[]) {
  const r = target.getBoundingClientRect();
  const c = center(r);
  const slot = target.closest<HTMLElement>('.held');
  snd.catch_();
  shake(2);
  void play(target, [{ transform: 'scale(1.25, 0.82)' }, { transform: 'scale(0.9, 1.12)' }, { transform: 'scale(1.04, 0.97)' }, { transform: 'none' }], 320, { easing: 'steps(8, end)', fill: 'none' });
  ring(c.x, c.y, { size: r.width * 2.2, color: colors[0], dur: 380 });
  burst(c.x, c.y, { n: 14, colors, speed: 170, life: 520, g: 160 });
  flashOn(target, 220);
  if (slot) {
    slot.classList.remove('kd-caught');
    void slot.offsetWidth;
    slot.classList.add('kd-caught');
  }
}

/** Карта, которая действует сразу (не в руку): рассыпается искрами и уходит. */
export async function dissolve(fly: HTMLElement, card: CardId) {
  const r = fly.getBoundingClientRect();
  const c = center(r);
  const colors = tierColors(card);
  snd.dissolve();
  burst(c.x, c.y, { n: 36, colors, speed: 360, g: -80, life: 800 });
  ring(c.x, c.y, { size: r.height * 2, color: colors[0] });
  await play(fly, [{ transform: 'scale(1)', opacity: 1, filter: 'brightness(1)' }, { transform: 'scale(1.18)', opacity: 1, filter: 'brightness(2.5)', offset: 0.4 }, { transform: 'scale(0.2, 1.6)', opacity: 0, filter: 'brightness(3)' }], 320, {
    easing: 'steps(7, end)',
  });
  fly.remove();
}
