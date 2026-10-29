// Обучение «Первая кровь»: режиссированный бой (docs/tutorial/SCENARIO.md). Чистые данные и функции без DOM:
// стартовая позиция, ходы соперника по сценарию и что разрешено игроку на каждом такте.
// Такт определяется по состоянию партии (номер хода, выбор по карте), а не по счётчику нажатий.
import { createGame } from './engine';
import { CLASSIC } from './modes';
import { pieceAt } from './rules';
import { Rank, key, type Action, type GameState, type ModeConfig, type PlayerId, type Pos } from './types';

/** Карма приходит на 4-м своём ходу у обоих: у игрока — после потери круга, у соперника — сразу следом. */
export const TUTORIAL_MODE: ModeConfig = { ...CLASSIC, id: 'tutorial', karmaEvery: 4, matchDeckSize: 2 };

const P = (x: number, y: number): Pos => ({ x, y });

/** Ключевые клетки сценария (игрок снизу, вперёд — вверх). */
export const TUT = {
  tri: P(5, 8),
  triTo: P(5, 7),
  square: P(7, 9),
  circle: P(8, 7),
  /** сюда встанет повышенный круг соперника — и сюда же бьёт твой круг */
  foeCircle: P(8, 2),
  /** квадрат соперника, который съест твой круг */
  killer: P(10, 0),
  runner: P(11, 9),
  runnerTo: P(11, 11),
  /** вторая жертва Двойной смерти врага */
  victim2: P(2, 1),
  /** последняя фигура соперника */
  last: P(2, 4),
  /** столбец Линии смерти и столбец, на котором она «чуть не остановилась» (твой квадрат) */
  deathX: 6,
  teaseX: 5,
} as const;

const START: [PlayerId, Rank, Pos][] = [
  [0, Rank.Triangle, TUT.tri],
  [0, Rank.Square, TUT.square],
  [0, Rank.Circle, TUT.circle],
  [1, Rank.Triangle, P(6, 6)],
  [1, Rank.Square, TUT.runner],
  [1, Rank.Square, TUT.killer],
  [1, Rank.Square, P(6, 0)],
  [1, Rank.Triangle, P(6, 1)],
  [1, Rank.Triangle, TUT.victim2],
  [1, Rank.Triangle, TUT.last],
];

/** Партия с середины: расстановки нет, первый ход — игрока. */
export function tutorialState(names: [string, string]): GameState {
  const s = createGame(TUTORIAL_MODE, 7, names);
  s.phase = 'play';
  s.players.forEach((p) => (p.placed = true));
  s.players[0].color = 'red';
  s.players[1].color = 'black';
  s.pieces = START.map(([owner, rank, at]) => ({ id: s.nextId++, rank, owner, ...at, acted: false, promoteNextTurn: false }));
  s.deck = ['doubleDeathEnemy', 'deathLine'];
  s.rig = { draws: [['doubleDeathEnemy'], ['deathLine']], columns: [TUT.deathX] };
  s.current = 0;
  s.turn = 1;
  s.players[0].ownTurns = 1;
  s.ap = s.mode.ap;
  return s;
}

const moveFrom = (s: GameState, by: PlayerId, from: Pos, to: Pos): Action | null => {
  const pc = pieceAt(s, from);
  return pc && pc.owner === by ? { type: 'move', by, pieceId: pc.id, to } : null;
};

/** Ход соперника по сценарию (вызывается вместо бота). */
export function tutorialEnemy(s: GameState, p: PlayerId): Action | null {
  if (s.pending) return s.pending.options.includes(key(TUT.foeCircle)) ? { type: 'choose', by: p, option: key(TUT.foeCircle) } : { type: 'choose', by: p, option: s.pending.options[0] };
  if (s.actedThisTurn) return { type: 'endTurn', by: p };
  switch (s.turn) {
    case 2:
      return moveFrom(s, p, P(6, 6), TUT.triTo);
    case 4:
      return moveFrom(s, p, TUT.runner, TUT.runnerTo);
    case 6:
      return moveFrom(s, p, TUT.killer, TUT.foeCircle);
  }
  return { type: 'endTurn', by: p };
}

/** Такт игрока: какую фигуру и куда можно, какие клетки выбрать, можно ли завершить ход, подсказка. */
export interface TutStep {
  id: 'step' | 'end' | 'revenge' | 'circle' | 'karma' | 'finish';
  hint: string;
  piece?: Pos;
  to?: Pos;
  /** выбор клеток по карте */
  choose?: Pos[];
  endTurn?: boolean;
}

export function tutorialStep(s: GameState): TutStep | null {
  if (s.phase !== 'play' || s.current !== 0) return null;
  if (s.pending) {
    if (s.pending.chooser !== 0) return null;
    const left = [TUT.foeCircle, TUT.victim2].filter((c) => s.pending!.options.includes(key(c)));
    return { id: 'karma', hint: 'Убери две фигуры врага', choose: left };
  }
  switch (s.turn) {
    case 1:
      return s.actedThisTurn
        ? { id: 'end', hint: 'Пока хватит. Заверши ход', endTurn: true }
        : { id: 'step', hint: 'Твой ход. Треугольник шагает на 1 вперёд', piece: TUT.tri, to: TUT.triTo };
    case 3:
      return { id: 'revenge', hint: 'Квадрат бьёт на 3 клетки. Отомсти', piece: TUT.square, to: TUT.triTo };
    case 5:
      return { id: 'circle', hint: 'Твой Круг тоже так умеет. Успей первым', piece: TUT.circle, to: TUT.foeCircle };
    case 9:
      return { id: 'finish', hint: 'Последний. Добей', piece: TUT.triTo, to: TUT.last };
  }
  return null;
}
