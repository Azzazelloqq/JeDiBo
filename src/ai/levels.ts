// Уровни сложности. Слабость задаётся не только глубиной расчёта, но и тем, что бот «не видит»
// (атаки сквозь фигуры, ответ соперника), случайностью выбора среди хороших планов и редкими зевками —
// так слабый бот ошибается похоже на человека.
// Рейтинги — по арене (600 партий на пару, с Кармой): Новичок закреплён на 800, остальные — по разнице Эло
// с соседним уровнем (Любитель — Новичок 75.8%, Мастер — Любитель 71.8%).
// Четвёртого уровня нет: более глубокий расчёт почти не прибавлял силы — удача с картами Кармы решает ~11% партий.
import type { AgentConfig } from './agent';
import { DEFAULT_WEIGHTS } from './eval';

export type LevelId = 'novice' | 'amateur' | 'master';

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
      // не видит атак сквозь фигуры и длинных разменов, угрозы недооценивает
      weights: { ...DEFAULT_WEIGHTS, xray: false, threat: 0.5, see: 2 },
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
    rating: 1000,
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
    rating: 1160,
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

/** Уровень по id; бывший четвёртый уровень (Гроссмейстер) из старых профилей — это нынешний Мастер. */
export const levelById = (id: string | undefined): Level =>
  LEVELS.find((l) => l.id === (id === 'grandmaster' ? 'master' : id)) ?? LEVELS.find((l) => l.id === DEFAULT_LEVEL)!;
