// Учёт часов партии — общий для офлайн-сессии (session/match.ts) и сетевой комнаты (net/room.ts).
// Движок о времени не знает: время передаётся снаружи, а истёкшие часы превращаются в действие timeout.
import { choosingOpponent } from './rules';
import type { Action, GameEvent, GameState, ModeConfig } from './types';

export interface Clocks {
  /** остаток времени текущего хода */
  turnLeft: number;
  /** общее время игроков на партию */
  total: [number, number];
  /** остаток времени соперника на выбор по карте */
  choiceLeft: number;
}

export const newClocks = (m: ModeConfig): Clocks => ({ turnLeft: m.turnMs, total: [m.totalMs, m.totalMs], choiceLeft: m.choiceMs });

/** Прошло dt мс. Пока соперник выбирает по карте, идёт только его таймер выбора; иначе — ход и общее время ходящего. */
export function spendTime(s: GameState, c: Clocks, dt: number) {
  if (s.phase !== 'play') return;
  if (choosingOpponent(s) !== null) c.choiceLeft -= dt;
  else {
    c.turnLeft -= dt;
    c.total[s.current] -= dt;
  }
}

/** Применено действие: новый ход — таймер хода заново; выбор соперника закончился — таймер выбора заново. */
export function clocksAfter(s: GameState, c: Clocks, events: GameEvent[]) {
  if (events.some((e) => e.type === 'turnStart')) c.turnLeft = s.mode.turnMs;
  if (choosingOpponent(s) === null) c.choiceLeft = s.mode.choiceMs;
}

/** Какие часы кончились: действие таймаута или null. */
export function expiredClock(s: GameState, c: Clocks): Extract<Action, { type: 'timeout' }> | null {
  if (s.phase !== 'play') return null;
  const ch = choosingOpponent(s);
  if (ch !== null) return c.choiceLeft <= 0 ? { type: 'timeout', by: ch, total: false, choice: true } : null;
  if (c.total[s.current] <= 0) return { type: 'timeout', by: s.current, total: true };
  if (c.turnLeft <= 0) return { type: 'timeout', by: s.current, total: false };
  return null;
}

/** Через сколько мс кончатся идущие сейчас часы. */
export function msUntilExpiry(s: GameState, c: Clocks): number {
  return choosingOpponent(s) !== null ? c.choiceLeft : Math.min(c.turnLeft, c.total[s.current]);
}
