// Core data model. Everything here is plain serializable data:
// the whole GameState can be JSON-cloned, hashed and sent over the wire,
// which is what a future p2p lockstep / resync will rely on.

export type PlayerId = 0 | 1;
/** 0 — нижняя сторона (вперёд = вверх, y уменьшается), 1 — верхняя. */
export type Side = 0 | 1;

export enum Rank {
  Triangle = 0,
  Square = 1,
  Circle = 2,
}

export interface Pos {
  x: number;
  y: number;
}

export interface Piece {
  id: number;
  rank: Rank;
  owner: PlayerId;
  x: number;
  y: number;
  /** фигура уже действовала в этом ходу */
  acted: boolean;
  /** дошла до последнего ряда под атакой — повысится в начале хода владельца */
  promoteNextTurn: boolean;
}

export interface GraveEntry {
  uid: number;
  rank: Rank;
  /** номер Периода Кармы владельца в момент гибели (floor(ownTurns / 7)) */
  period: number;
}

export type CardId =
  | 'immortal' | 'blitzkrieg' | 'resurrection' | 'doubleDeath' | 'doubleDeathEnemy'
  | 'devaluation' | 'depression' | 'barrier' | 'careerUp' | 'careerDown'
  | 'roundProtection' | 'deathLine' | 'retreat' | 'gift' | 'betrayal'
  | 'skipMove' | 'jumper' | 'freshBlood' | 'sideChange' | 'snail' | 'spy';

export interface HeldCard {
  card: CardId;
  /** последний собственный ход владельца, когда её ещё можно сыграть */
  untilOwnTurn: number;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  /** цвет не меняется даже после «Смены поля» */
  color: 'red' | 'black';
  side: Side;
  ownTurns: number;
  graveyard: GraveEntry[];
  held: HeldCard | null;
  placed: boolean;
}

/** Длящиеся эффекты. Срок — до конца собственного хода владельца с номером `untilOwnTurn`. */
export type Effect =
  | { kind: 'depression'; owner: PlayerId; untilOwnTurn: number }
  | { kind: 'snail'; owner: PlayerId; untilOwnTurn: number }
  | { kind: 'roundProtection'; owner: PlayerId; untilOwnTurn: number }
  | { kind: 'jumper'; owner: PlayerId; untilOwnTurn: number }
  | { kind: 'barrier'; owner: PlayerId; untilOwnTurn: number; cells: Pos[] }
  | { kind: 'blitz'; owner: PlayerId; untilOwnTurn: number; pieceId: number | null; done: boolean };

/** Что сейчас ждёт выбора игрока. Выбор всегда одиночный: клетка/фигура или запись кладбища. */
export interface Pending {
  /** источник: карта или системное правило (повышение) */
  source: CardId | 'promotion';
  chooser: PlayerId;
  /** игрок, «владеющий» эффектом (получивший карту) */
  beneficiary: PlayerId;
  kind: 'cell' | 'grave';
  /** допустимые варианты: ключи клеток "x,y" или uid записей кладбища */
  options: string[];
  canSkip: boolean;
  prompt: string;
  step: number;
  /** произвольные данные шага (сериализуемые) */
  data: Record<string, unknown>;
}

export type Phase = 'placement' | 'play' | 'over';

export interface ModeConfig {
  id: string;
  size: number;
  ap: number;
  karmaEvery: number;
  matchDeckSize: number;
  turnMs: number;
  totalMs: number;
  /** время соперника на выбор по карте в чужой ход (целиком на весь выбор); часы ходящего в это время стоят */
  choiceMs: number;
}

export interface GameState {
  mode: ModeConfig;
  seed: number;
  rng: number;
  phase: Phase;
  nextId: number;
  pieces: Piece[];
  players: [PlayerState, PlayerState];
  current: PlayerId;
  /** общий счётчик ходов (оба игрока) */
  turn: number;
  ap: number;
  /** было ли действие фигурой в этом ходу (нужно для ручного завершения) */
  actedThisTurn: boolean;
  deck: CardId[];
  discard: CardId[];
  played: CardId[];
  effects: Effect[];
  pending: Pending | null;
  /** очередь отложенных шагов (например, несколько повышений) */
  queue: Pending[];
  /** ход должен закончиться, как только разрешится pending */
  endAfterPending: boolean;
  winner: PlayerId | 'draw' | null;
  endReason: string | null;
  draw: { signature: string; turns: number } | null;
}

export type Action =
  | { type: 'place'; by: PlayerId; layout: { x: number; y: number; rank: Rank }[] }
  | { type: 'move'; by: PlayerId; pieceId: number; to: Pos }
  | { type: 'endTurn'; by: PlayerId }
  | { type: 'playCard'; by: PlayerId }
  | { type: 'choose'; by: PlayerId; option: string }
  | { type: 'skip'; by: PlayerId }
  /** left — игрок покинул сетевую партию (выставляет только комната) */
  | { type: 'resign'; by: PlayerId; left?: boolean }
  /** choice — у соперника кончилось время на выбор по карте (by — выбирающий) */
  | { type: 'timeout'; by: PlayerId; total: boolean; choice?: boolean };

/** События — то, что видит слой представления (анимации, звук, хроника). */
export type GameEvent =
  | { type: 'placed'; player: PlayerId }
  | { type: 'start' }
  | { type: 'turnStart'; player: PlayerId; ownTurn: number }
  | { type: 'move'; pieceId: number; from: Pos; to: Pos; jump?: boolean; forced?: boolean }
  | { type: 'capture'; attackerId: number; victim: Piece; from: Pos; to: Pos }
  | { type: 'destroy'; victim: Piece; cause: string }
  | { type: 'spawn'; piece: Piece }
  | { type: 'rankChange'; pieceId: number; from: Rank; to: Rank }
  | { type: 'promoteRemove'; piece: Piece }
  | { type: 'ownerChange'; pieceId: number; to: PlayerId }
  | { type: 'sidesSwap' }
  | { type: 'cardDrawn'; player: PlayerId; card: CardId }
  | { type: 'cardPlayed'; player: PlayerId; card: CardId }
  | { type: 'cardDiscarded'; player: PlayerId; card: CardId; reason: string }
  | { type: 'column'; x: number }
  | { type: 'barrier'; cells: Pos[] }
  | { type: 'effectEnd'; kind: Effect['kind']; owner: PlayerId }
  | { type: 'skipTurn'; player: PlayerId }
  | { type: 'log'; text: string; player?: PlayerId }
  | { type: 'gameOver'; winner: PlayerId | 'draw'; reason: string };

export const key = (p: Pos) => `${p.x},${p.y}`;
export const unkey = (k: string): Pos => {
  const [x, y] = k.split(',').map(Number);
  return { x, y };
};
export const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);
