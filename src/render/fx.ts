// «Сок»: тряска экрана, всплывающий текст, баннеры, поп чисел.
import { stage } from '../ui/stage';
import { onFrame, wait } from './tween';

let trauma = 0;
let shakeEnabled = true;
export const setShakeEnabled = (v: boolean) => (shakeEnabled = v);

export function shake(amount: number) {
  if (!shakeEnabled) return;
  trauma = Math.min(14, trauma + amount);
}

onFrame((now) => {
  const el = document.getElementById('shake');
  if (!el) return;
  if (trauma <= 0.05) {
    if (el.style.transform) el.style.transform = '';
    trauma = 0;
    return;
  }
  const t = trauma * trauma * 0.08;
  const x = Math.sin(now * 0.09) * t + (Math.random() - 0.5) * t;
  const y = Math.cos(now * 0.11) * t + (Math.random() - 0.5) * t;
  const r = Math.sin(now * 0.05) * t * 0.08;
  el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${r.toFixed(2)}deg)`;
  trauma *= 0.88;
});

/** x, y — в координатах сцены (ui/stage.ts). */
export function floatText(text: string, x: number, y: number, cls = '') {
  const el = document.createElement('div');
  el.className = `float-text ${cls}`;
  el.textContent = text;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  stage().appendChild(el);
  setTimeout(() => el.remove(), 1300);
}

/** Большой баннер поперёк экрана (как «блайнды» в Балатро). */
export async function banner(text: string, sub = '', tone: 'brand' | 'amber' | 'stone' = 'brand', hold = 750) {
  const el = document.createElement('div');
  el.className = `banner banner-${tone}`;
  el.innerHTML = `<div class="banner-strip"><div class="banner-text">${text}</div>${sub ? `<div class="banner-sub">${sub}</div>` : ''}</div>`;
  stage().appendChild(el);
  await wait(hold + 300);
  el.classList.add('out');
  await wait(320);
  el.remove();
}

export function pop(el: Element | null) {
  if (!el) return;
  el.classList.remove('pop');
  void (el as HTMLElement).offsetWidth;
  el.classList.add('pop');
}
