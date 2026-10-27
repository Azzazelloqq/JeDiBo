// Геометрия поля и генерация ходов. Чистые функции без мутаций.
import { Rank, key, other, type Effect, type GameState, type Piece, type PlayerId, type Pos, type Side } from './types';

export const forward = (side: Side) => (side === 0 ? -1 : 1);

export const inBoard = (s: GameState, p: Pos) => p.x >= 0 && p.y >= 0 && p.x < s.mode.size && p.y < s.mode.size;

/** Ряды стартовой зоны (1-3 ряд со стороны игрока). */
export function homeRows(s: GameState, side: Side): number[] {
  const n = s.mode.size;
  return side === 0 ? [n - 1, n - 2, n - 3] : [0, 1, 2];
}
export const fourthRow = (s: GameState, side: Side) => (side === 0 ? s.mode.size - 4 : 3);
export const lastRow = (s: GameState, side: Side) => (side === 0 ? 0 : s.mode.size - 1);

export const sideOf = (s: GameState, p: PlayerId) => s.players[p].side;
export const pieceAt = (s: GameState, p: Pos) => s.pieces.find((q) => q.x === p.x && q.y === p.y);
export const piecesOf = (s: GameState, p: PlayerId) => s.pieces.filter((q) => q.owner === p);

export function isBarrier(s: GameState, p: Pos): boolean {
  return s.effects.some((e) => e.kind === 'barrier' && e.cells.some((c) => c.x === p.x && c.y === p.y));
}
export const isFree = (s: GameState, p: Pos) => inBoard(s, p) && !pieceAt(s, p) && !isBarrier(s, p);

export function hasEffect<K extends Effect['kind']>(s: GameState, kind: K, owner: PlayerId) {
  return s.effects.find((e) => e.kind === kind && e.owner === owner) as Extract<Effect, { kind: K }> | undefined;
}

/** Номер текущего Периода Кармы игрока и последний ход этого периода. */
export const periodIndex = (s: GameState, p: PlayerId) => Math.floor(s.players[p].ownTurns / s.mode.karmaEvery);
export const periodEnd = (s: GameState, p: PlayerId) => periodIndex(s, p) * s.mode.karmaEvery + s.mode.karmaEvery - 1;

type Dir = [number, number];
const ALL8: Dir[] = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]];

interface Pattern {
  move: Dir[];
  attack: Dir[];
  moveRange: number;
  attackRange: number;
}

export interface PatternOpts {
  /** игнорировать модификаторы Кармы (Предательство) */
  plain?: boolean;
}

export function patternOf(s: GameState, pc: Piece, opts: PatternOpts = {}): Pattern {
  const f = forward(sideOf(s, pc.owner));
  const fwd: Dir[] = [[0, f]];
  const fwdDiag: Dir[] = [[0, f], [-1, f], [1, f]];
  let pat: Pattern;
  switch (pc.rank) {
    case Rank.Triangle:
      pat = { move: fwd, attack: fwdDiag, moveRange: 1, attackRange: 1 };
      break;
    case Rank.Square: {
      const d: Dir[] = [...fwdDiag, [-1, 0], [1, 0]];
      pat = { move: d, attack: d, moveRange: 3, attackRange: 3 };
      break;
    }
    default:
      pat = { move: ALL8, attack: ALL8, moveRange: 5, attackRange: 5 };
  }
  if (opts.plain) return pat;
  if (pc.rank !== Rank.Circle && hasEffect(s, 'roundProtection', pc.owner)) pat.attack = ALL8;
  if (pc.rank !== Rank.Triangle && (hasEffect(s, 'depression', pc.owner) || hasEffect(s, 'snail', pc.owner))) {
    pat.moveRange = 1;
    pat.attackRange = 1;
  }
  return pat;
}

export interface Target {
  to: Pos;
  attack: boolean;
  jump: boolean;
}

/** Все цели фигуры: перемещения и атаки с учётом препятствий и Прыгуна. */
export function targetsOf(s: GameState, pc: Piece, opts: PatternOpts = {}): Target[] {
  const pat = patternOf(s, pc, opts);
  const canJump = !opts.plain && pc.rank !== Rank.Triangle && !!hasEffect(s, 'jumper', pc.owner);
  const out: Target[] = [];
  const seen = new Set<string>();

  const walk = (dirs: Dir[], range: number, attack: boolean) => {
    for (const [dx, dy] of dirs) {
      let jumped = false;
      for (let step = 1; step <= range; step++) {
        const c = { x: pc.x + dx * step, y: pc.y + dy * step };
        if (!inBoard(s, c)) break;
        const occ = pieceAt(s, c);
        const blocked = !!occ || isBarrier(s, c);
        if (!blocked) {
          if (!attack) push({ to: c, attack: false, jump: jumped });
          continue;
        }
        if (attack && occ && occ.owner !== pc.owner) push({ to: c, attack: true, jump: jumped });
        // одно препятствие шириной в клетку можно перепрыгнуть
        if (canJump && !jumped) {
          jumped = true;
          continue;
        }
        break;
      }
    }
  };
  const push = (t: Target) => {
    const k = key(t.to) + (t.attack ? 'a' : 'm');
    if (seen.has(k)) return;
    // предпочитаем вариант без прыжка
    seen.add(k);
    out.push(t);
  };
  walk(pat.move, pat.moveRange, false);
  walk(pat.attack, pat.attackRange, true);
  return out;
}

/** Атакует ли игрок `by` клетку `cell` (для правила повышения). */
export function isAttacked(s: GameState, cell: Pos, by: PlayerId): boolean {
  return piecesOf(s, by).some((pc) => targetsOf(s, pc).some((t) => t.attack && t.to.x === cell.x && t.to.y === cell.y));
}

export function canAct(s: GameState, pc: Piece): boolean {
  if (s.phase !== 'play' || s.pending || pc.owner !== s.current || s.ap <= 0) return false;
  if (!pc.acted) return true;
  const b = hasEffect(s, 'blitz', pc.owner);
  return !!b && !b.done && b.pieceId === pc.id;
}

export function legalTargets(s: GameState, pc: Piece): Target[] {
  return canAct(s, pc) ? targetsOf(s, pc) : [];
}

export function anyLegalAction(s: GameState): boolean {
  return piecesOf(s, s.current).some((pc) => legalTargets(s, pc).length > 0);
}

/** Свободные клетки для новой фигуры: стартовая зона, иначе 4-й ряд, иначе любая своя половина. */
export function spawnCells(s: GameState, owner: PlayerId): Pos[] {
  const side = sideOf(s, owner);
  const rowsFree = (rows: number[]) => {
    const out: Pos[] = [];
    for (const y of rows) for (let x = 0; x < s.mode.size; x++) if (isFree(s, { x, y })) out.push({ x, y });
    return out;
  };
  let cells = rowsFree(homeRows(s, side));
  if (!cells.length) cells = rowsFree([fourthRow(s, side)]);
  if (!cells.length) {
    const half = Array.from({ length: s.mode.size / 2 }, (_, i) => (side === 0 ? s.mode.size - 1 - i : i));
    cells = rowsFree(half);
  }
  return cells;
}

export const opponentOf = (s: GameState) => other(s.current);
