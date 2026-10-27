// Детерминированный ГСЧ (mulberry32). Состояние живёт в GameState.rng,
// поэтому оба пира при lockstep-синхронизации получают одинаковые броски.
import type { GameState } from './types';

export function nextRandom(s: GameState): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randInt(s: GameState, n: number): number {
  return Math.floor(nextRandom(s) * n);
}

export function shuffle<T>(s: GameState, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(s, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
