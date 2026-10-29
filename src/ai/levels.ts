// Уровни сложности. Слабость задаётся не только глубиной расчёта, но и тем, что бот «не видит»
// (атаки сквозь фигуры, ответ соперника), случайностью выбора среди хороших планов и редкими зевками —
// так слабый бот ошибается похоже на человека.
// Рейтинги — по арене (с Кармой): Новичок закреплён на 800, Любитель — 75.8% против Новичка (1000).
// Мастер с подкреплениями и характерами — 63.7% против прежнего Мастера (1160), отсюда 1260. Между уровнями
// бот против бота нетранзитивен: в паре Мастер — Любитель сейчас 68.3%, но прежний Мастер слабее нынешнего.
// Любитель с подкреплениями против прежнего — 52.8% (в пределах шума), рейтинг прежний; его выигрыш — против
// оборонительной игры (67% против 35% у прежнего против «черепахи», без Кармы).
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
      // видит подкрепления в разменах: без этого оборонительная игра («черепаха») обыгрывает его 2:1
      weights: { ...DEFAULT_WEIGHTS, reach: true },
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
    rating: 1260,
    config: {
      weights: { ...DEFAULT_WEIGHTS, reach: true },
      turn: { width: 8, lookahead: 1 },
      // свой ход и ответ соперника. Третий полуход (свой следующий ход) вредил: расчёт кончался после своего хода,
      // своё взятие уже засчитано, а ответ на него — только статической оценкой (без него сильнее, 58%).
      // Кандидаты — от основной оценки и от двух «характеров» (осторожного и азартного): иначе все лучшие планы
      // бывают вариациями одной идеи, и проверке ответом не из чего выбрать.
      search: {
        candidates: 10,
        reply: { width: 3, lookahead: 1 },
        minChecked: 4,
        personas: [
          { weights: { advance: 0, threat: 1.5, myThreat: 0 }, top: 3, width: 4 },
          { weights: { threat: 0.5, myThreat: 0.6 }, top: 3, width: 4 },
        ],
      },
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
