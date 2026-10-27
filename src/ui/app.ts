// Роутер экранов с переходами.
import { clear } from './dom';

/** Экран рисует себя в root и возвращает функцию очистки. */
export type Screen = (root: HTMLElement) => (() => void) | void;

let cleanup: (() => void) | void;
let current: HTMLElement | null = null;

export function go(screen: Screen) {
  const app = document.getElementById('app')!;
  cleanup?.();
  const old = current;
  if (old) {
    old.classList.add('screen-leave');
    setTimeout(() => old.remove(), 260);
  } else clear(app);
  const root = document.createElement('div');
  root.className = 'screen screen-enter';
  app.appendChild(root);
  current = root;
  cleanup = screen(root);
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('screen-enter')));
}
