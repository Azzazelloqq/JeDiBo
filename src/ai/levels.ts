// Уровни сложности. Слабость задаётся не только глубиной расчёта, но и тем, что бот «не видит»
// (атаки сквозь фигуры, ответ соперника), случайностью выбора среди хороших планов и редкими зевками —
// так слабый бот ошибается похоже на человека. Рейтинги — по калибровке на арене (scripts/arena.ts).
import type { AgentConfig } from './agent';
import { DEFAULT_WEIGHTS } from './eval';

export type LevelId = 'novice' | 'amateur' | 'master' | 'grandmaster';

export interface Level {
  id: LevelId;
  name: string;
  /** рейтинг Эло для профиля игрока */
  rating: number;
  config: AgentConfig;
}

export const LEVELS: Level[] = [
  {
    id: 'novice',
    name: 'Новичок',
    rating: 800,
    config: {
      weights: { ...DEFAULT_WEIGHTS, xray: false, threat: 0.6 },
      turn: { width: 2, lookahead: 0.3 },
      search: { candidates: 1, reply: null },
      temperature: 1.0,
      blunder: 0.15,
      budgetMs: 60,
    },
  },
  {
    id: 'amateur',
    name: 'Любитель',
    rating: 1000,
    config: {
      weights: DEFAULT_WEIGHTS,
      turn: { width: 4, lookahead: 0.6 },
      search: { candidates: 3, reply: { width: 1, lookahead: 0.6 } },
      temperature: 0.4,
      blunder: 0.05,
      budgetMs: 150,
    },
  },
  {
    id: 'master',
    name: 'Мастер',
    rating: 1200,
    config: {
      weights: DEFAULT_WEIGHTS,
      turn: { width: 8, lookahead: 0.6 },
      search: { candidates: 6, reply: { width: 2, lookahead: 0.6 } },
      temperature: 0.1,
      blunder: 0,
      budgetMs: 400,
    },
  },
  {
    id: 'grandmaster',
    name: 'Гроссмейстер',
    rating: 1400,
    config: {
      weights: DEFAULT_WEIGHTS,
      turn: { width: 8, lookahead: 0.6 },
      search: { candidates: 12, reply: { width: 4, lookahead: 0.6 } },
      temperature: 0,
      blunder: 0,
      budgetMs: 900,
    },
  },
];

export const DEFAULT_LEVEL: LevelId = 'amateur';

export const levelById = (id: string | undefined): Level => LEVELS.find((l) => l.id === id) ?? LEVELS.find((l) => l.id === DEFAULT_LEVEL)!;
