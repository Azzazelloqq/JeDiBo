// Мини-движок твинов на requestAnimationFrame.

export const ease = {
  linear: (t: number) => t,
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  inCubic: (t: number) => t ** 3,
  inOut: (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  outBack: (t: number) => {
    const c = 1.9;
    return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
  },
  outBounce: (t: number) => {
    const n = 7.5625, d = 2.75;
    if (t < 1 / d) return n * t * t;
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
    return n * (t -= 2.625 / d) * t + 0.984375;
  },
};

interface Tween {
  start: number;
  dur: number;
  fn: (t: number) => void;
  done: () => void;
}

const tweens: Tween[] = [];
let speed = 1;
export const setAnimSpeed = (k: number) => (speed = k);

export function tween(dur: number, fn: (t: number) => void, delay = 0): Promise<void> {
  return new Promise((res) => {
    tweens.push({ start: performance.now() + delay / speed, dur: Math.max(1, dur / speed), fn, done: res });
  });
}

export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms / speed));

export function stepTweens(now: number) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    if (now < tw.start) continue;
    const t = Math.min(1, (now - tw.start) / tw.dur);
    tw.fn(t);
    if (t >= 1) {
      tweens.splice(i, 1);
      tw.done();
    }
  }
}

const frameHooks = new Set<(now: number, dt: number) => void>();
export const onFrame = (fn: (now: number, dt: number) => void) => {
  frameHooks.add(fn);
  return () => frameHooks.delete(fn);
};

let last = performance.now();
function loop(now: number) {
  const dt = Math.min(50, now - last);
  last = now;
  stepTweens(now);
  frameHooks.forEach((f) => f(now, dt));
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
// во фоновой вкладке rAF замирает — твины всё равно должны завершаться,
// иначе сессия (и в будущем сетевой lockstep) встанет в ожидании анимации
setInterval(() => {
  const now = performance.now();
  if (now - last > 250) stepTweens(now);
}, 100);
