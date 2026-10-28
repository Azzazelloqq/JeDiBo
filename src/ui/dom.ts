// Мини-хелперы DOM без фреймворка.
import { sfx } from '../audio/sfx';

type Child = Node | string | null | undefined | false;
type Props = Record<string, unknown> & { class?: string; style?: string };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'style') el.setAttribute('style', String(v));
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k in el) (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

/** Кнопка-«плита» со звуком и случайным покачиванием на ховере. */
export function btn(label: string | Node, onClick: () => void, cls = 'btn-stone', extra: Props = {}) {
  const b = h('button', { class: `btn ${cls}`, ...extra }, label);
  b.style.setProperty('--wob', `${(Math.random() - 0.5) * 1.5}deg`);
  b.addEventListener('mouseenter', () => !b.disabled && sfx.hover());
  b.addEventListener('click', () => {
    if (b.disabled) return;
    sfx.click();
    onClick();
  });
  return b;
}

export function canvasEl(c: HTMLCanvasElement, scale: number, cls = '') {
  c.className = `pix ${cls}`;
  c.style.width = `${c.width * scale}px`;
  c.style.height = `${c.height * scale}px`;
  return c;
}

export function clear(el: Element) {
  while (el.firstChild) el.firstChild.remove();
}

export function toast(text: string, tone: 'stone' | 'brand' | 'amber' = 'stone') {
  let host = document.querySelector('.toasts');
  if (!host) {
    host = h('div', { class: 'toasts' });
    document.body.appendChild(host);
  }
  const t = h('div', { class: `toast toast-${tone}` }, text);
  host.appendChild(t);
  setTimeout(() => t.classList.add('out'), 2200);
  setTimeout(() => t.remove(), 2600);
}
