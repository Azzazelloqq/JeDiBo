// Обучение «Первая кровь»: режиссированный бой (docs/tutorial/SCENARIO.md). Чистые данные и функции без DOM:
// стартовая позиция, ходы соперника по сценарию и что разрешено игроку на каждом такте.
// Такт определяется по состоянию партии (номер хода, выбор по карте), а не по счётчику нажатий.
import { createGame } from './engine';
import { CLASSIC } from './modes';
import { pieceAt } from './rules';
import { Rank, key, type Action, type GameState, type ModeConfig, type PlayerId, type Pos } from './types';

/** Карма приходит на 5-м своём ходу у обоих. Партию «начал» соперник (у него на ход больше), поэтому его карта
 *  раньше: Линия смерти на ходу 8, Карьерный лифт игрока — на ходу 9. Как в настоящей партии, где первый ход случаен. */
/** Поле не сжимается: у игрока с самого начала 3 фигуры, и сжатие сломало бы сценарий. */
export const TUTORIAL_MODE: ModeConfig = { ...CLASSIC, id: 'tutorial', karmaEvery: 5, matchDeckSize: 2, shrink: undefined };

const P = (x: number, y: number): Pos => ({ x, y });

/** Ключевые клетки сценария (игрок снизу, вперёд — вверх). */
export const TUT = {
  tri: P(5, 8),
  triTo: P(5, 7),
  square: P(7, 9),
  /** треугольник соперника идёт по столбцу 5 на твой квадрат: (5,4) → (5,5) на ходу 4 → (5,6) на ходу 6 */
  raider: P(5, 4),
  /** здесь квадрат съедает этот треугольник на ходу 7: вплотную к зоне убийцы (бьёт вниз на 3, до (5,5)), но не в ней */
  standoff: P(5, 6),
  circle: P(10, 7),
  /** сюда встанет повышенный круг соперника — и сюда же бьёт твой круг. Тот же столбец, что у квадрата после
   *  мести, но в 5 клетках: квадрат не достаёт, круг после Карьерного лифта — достаёт */
  foeCircle: P(5, 2),
  /** квадрат соперника, который съест твой круг */
  killer: P(3, 0),
  runner: P(11, 9),
  runnerTo: P(11, 11),
  /** последняя фигура соперника: после Линии смерти шагает вперёд, на lastTo */
  last: P(1, 5),
  lastTo: P(1, 6),
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
  [1, Rank.Triangle, P(6, 2)],
  [1, Rank.Triangle, TUT.last],
  [1, Rank.Triangle, TUT.raider],
];

/** Партия с середины: расстановки нет, первый ход — игрока. */
export function tutorialState(names: [string, string]): GameState {
  const s = createGame(TUTORIAL_MODE, 7, names);
  s.phase = 'play';
  s.players.forEach((p) => (p.placed = true));
  s.players[0].color = 'red';
  s.players[1].color = 'black';
  s.pieces = START.map(([owner, rank, at]) => ({ id: s.nextId++, rank, owner, ...at, acted: false, promoteNextTurn: false }));
  s.deck = ['careerUp', 'deathLine'];
  s.rig = { draws: [['careerUp'], ['deathLine']], columns: [TUT.deathX] };
  s.current = 0;
  s.turn = 1;
  s.players[0].ownTurns = 1;
  s.players[1].ownTurns = 1;
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
  // ходы по порядку; сделанный пропускается (фигуры на старой клетке уже нет)
  const plan: Record<number, [Pos, Pos][]> = {
    2: [[P(6, 6), TUT.triTo]],
    4: [[TUT.raider, P(5, 5)], [TUT.runner, TUT.runnerTo]],
    6: [[P(5, 5), TUT.standoff], [TUT.killer, TUT.foeCircle]],
    10: [[TUT.last, TUT.lastTo]],
  };
  for (const [from, to] of plan[s.turn] ?? []) {
    const a = moveFrom(s, p, from, to);
    if (a) return a;
  }
  return { type: 'endTurn', by: p };
}

/** Такт игрока: какую фигуру и куда можно, какие клетки выбрать, можно ли завершить ход, подсказка. */
export interface TutStep {
  id: 'step' | 'end' | 'revenge' | 'circle' | 'stuck' | 'karma' | 'avenge' | 'finish';
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
    return { id: 'karma', hint: 'Выбери, кого повысить', choose: s.pending.options.includes(key(TUT.standoff)) ? [TUT.standoff] : [] };
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
    case 7:
      // взятие заканчивает ход само
      return { id: 'stuck', hint: 'Этот целится в тебя. Съешь его', piece: TUT.triTo, to: TUT.standoff };
    case 9:
      return { id: 'avenge', hint: 'Бей — прикрыть его больше некому', piece: TUT.standoff, to: TUT.foeCircle };
    case 11:
      return { id: 'finish', hint: 'Последний. Добей', piece: TUT.foeCircle, to: TUT.lastTo };
  }
  return null;
}
