// Уровни сложности. Слабость задаётся не только глубиной расчёта, но и тем, что бот «не видит»
// (атаки сквозь фигуры, ответ соперника), случайностью выбора среди хороших планов и редкими зевками —
// так слабый бот ошибается похоже на человека.
// Рейтинги — по арене (600 партий на пару, с Кармой): Новичок закреплён на 800, остальные — по разнице Эло
// с соседним уровнем (71.3%, 65.1%, 53.7%). Наверху разрыв мал: удача с картами Кармы решает ~11% партий,
// без Кармы Гроссмейстер выигрывает у Мастера ~62%.
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
      weights: { ...DEFAULT_WEIGHTS, xray: false, threat: 0.5 },
      turn: { width: 1, lookahead: 0 },
      search: { candidates: 1, reply: null },
      temperature: 1.5,
      blunder: 0.25,
      budgetMs: 60,
    },
  },
  {
    id: 'amateur',
    name: 'Любитель',
    rating: 960,
    config: {
      weights: DEFAULT_WEIGHTS,
      turn: { width: 3, lookahead: 1 },
      search: { candidates: 1, reply: null },
      temperature: 0.5,
      blunder: 0.08,
      budgetMs: 150,
    },
  },
  {
    id: 'master',
    name: 'Мастер',
    rating: 1070,
    config: {
      weights: DEFAULT_WEIGHTS,
      turn: { width: 8, lookahead: 1 },
      search: { candidates: 6, reply: { width: 2, lookahead: 1 } },
      temperature: 0.05,
      blunder: 0,
      budgetMs: 400,
    },
  },
  {
    id: 'grandmaster',
    name: 'Гроссмейстер',
    rating: 1095,
    config: {
      weights: DEFAULT_WEIGHTS,
      turn: { width: 8, lookahead: 1 },
      // три полухода: свой ход, ответ соперника, свой следующий ход
      search: { candidates: 10, reply: { width: 3, lookahead: 1 }, followup: { width: 2, lookahead: 1 } },
      temperature: 0,
      blunder: 0,
      budgetMs: 1500,
    },
  },
];

export const DEFAULT_LEVEL: LevelId = 'amateur';

export const levelById = (id: string | undefined): Level => LEVELS.find((l) => l.id === id) ?? LEVELS.find((l) => l.id === DEFAULT_LEVEL)!;
