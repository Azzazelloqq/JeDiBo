import type { ModeConfig } from './types';

/** Режим «Классика» из ГДД. Новые режимы — просто ещё один объект здесь. */
export const CLASSIC: ModeConfig = {
  id: 'classic',
  size: 12,
  ap: 5,
  karmaEvery: 7,
  matchDeckSize: 21,
  turnMs: 5 * 60_000,
  totalMs: 60 * 60_000,
  choiceMs: 15_000,
  shrink: { total: 10, perPlayer: 4, minSize: 6 },
};

export const START_ARMY = { triangles: 12, squares: 6, circles: 3 } as const;
