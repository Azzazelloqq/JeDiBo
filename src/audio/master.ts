// Общая громкость — множитель поверх звуков (sfx.ts) и музыки (music.ts).

let volume = 1;
const listeners = new Set<() => void>();

/** Положение ползунка 0..1 → множитель: шкала в децибелах, 100% — ×1, 50% — ×0.1 (−20 дБ), 0 — тишина. */
export const masterGain = () => (volume <= 0 ? 0 : 10 ** ((-40 * (1 - Math.min(1, volume))) / 20));

export function setMasterVolume(v: number) {
  volume = v;
  for (const f of listeners) f();
}

/** Подписка на смену общей громкости; возвращает отписку. */
export function onMasterVolume(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}
