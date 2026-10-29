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
  // вход — CSS-анимация (не ждёт кадров); класс снимаем, когда она отыграла
  root.addEventListener('animationend', (e) => e.target === root && root.classList.remove('screen-enter'));
  // страховка: если кадры не шли (фоновая вкладка), разовые анимации входа застревают в первом кадре —
  // экран прозрачен, колонки за краем. Доводим их до конца; бесконечные (покачивания) не трогаем.
  setTimeout(() => {
    for (const a of root.getAnimations({ subtree: true }))
      if (a.effect?.getTiming().iterations !== Infinity && a.playState !== 'finished') a.finish();
  }, 1200);
}
