// Геометрия поля и генерация ходов. Чистые функции без мутаций.
import { Rank, key, other, type Effect, type GameState, type Piece, type PlayerId, type Pos, type Side } from './types';

export const forward = (side: Side) => (side === 0 ? -1 : 1);

/** Сколько внешних колец поля уже исчезло при сжатии. */
export const ringOf = (s: GameState) => s.shrink?.level ?? 0;

/** Живое поле: клетки с координатами lo…hi по обеим осям (при сжатии внешние кольца исчезают). */
export function bounds(s: GameState): { lo: number; hi: number } {
  const lo = ringOf(s);
  return { lo, hi: s.mode.size - 1 - lo };
}

export const inBoard = (s: GameState, p: Pos) => {
  const lo = ringOf(s);
  const hi = s.mode.size - 1 - lo;
  return p.x >= lo && p.y >= lo && p.x <= hi && p.y <= hi;
};

/** Ряды стартовой зоны: три крайних ряда живого поля со стороны игрока (при сжатии зона сдвигается вместе с краем). */
export function homeRows(s: GameState, side: Side): number[] {
  const { lo, hi } = bounds(s);
  return side === 0 ? [hi, hi - 1, hi - 2] : [lo, lo + 1, lo + 2];
}
export const lastRow = (s: GameState, side: Side) => (side === 0 ? bounds(s).lo : bounds(s).hi);

/** Можно ли ещё сжать поле: живое поле больше минимального. */
export function canShrink(s: GameState): boolean {
  const cfg = s.mode.shrink;
  return !!cfg && !!s.shrink && s.mode.size - 2 * ringOf(s) > cfg.minSize;
}

/** Поле сжато до предела: все фигуры атакуют в любом направлении (дальность прежняя). */
export const fullyShrunk = (s: GameState) => ringOf(s) > 0 && !canShrink(s);

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
  // поле сжато до предела — атака во все стороны; это правило поля, а не Карма, поэтому и для plain
  if (fullyShrunk(s)) pat.attack = ALL8;
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
  /** прыжок Прыгуна: треугольник перелетает соседнюю фигуру соперника и бьёт её; to — клетка приземления */
  jump: boolean;
}

/** Кого бьёт цель: обычная атака — фигуру на клетке to, прыжок — фигуру между фигурой и клеткой приземления. */
export const victimCell = (from: Pos, t: Target): Pos => (t.jump ? { x: (from.x + t.to.x) / 2, y: (from.y + t.to.y) / 2 } : t.to);

/** Все цели фигуры: перемещения и атаки с учётом препятствий и Прыгуна. */
export function targetsOf(s: GameState, pc: Piece, opts: PatternOpts = {}): Target[] {
  const pat = patternOf(s, pc, opts);
  const out: Target[] = [];
  const seen = new Set<string>();

  const walk = (dirs: Dir[], range: number, attack: boolean) => {
    for (const [dx, dy] of dirs) {
      for (let step = 1; step <= range; step++) {
        const c = { x: pc.x + dx * step, y: pc.y + dy * step };
        if (!inBoard(s, c)) break;
        const occ = pieceAt(s, c);
        const blocked = !!occ || isBarrier(s, c);
        if (!blocked) {
          if (!attack) push({ to: c, attack: false, jump: false });
          continue;
        }
        if (attack && occ && occ.owner !== pc.owner) push({ to: c, attack: true, jump: false });
        break;
      }
    }
  };
  // Прыгун: треугольник в любую сторону перепрыгивает соседнюю фигуру соперника на свободную клетку за ней
  const jumps = () => {
    for (const [dx, dy] of ALL8) {
      const over = pieceAt(s, { x: pc.x + dx, y: pc.y + dy });
      const to = { x: pc.x + dx * 2, y: pc.y + dy * 2 };
      if (over && over.owner !== pc.owner && isFree(s, to)) push({ to, attack: true, jump: true });
    }
  };
  const push = (t: Target) => {
    const k = key(t.to) + (t.attack ? 'a' : 'm');
    if (seen.has(k)) return;
    seen.add(k);
    out.push(t);
  };
  walk(pat.move, pat.moveRange, false);
  walk(pat.attack, pat.attackRange, true);
  if (!opts.plain && pc.rank === Rank.Triangle && hasEffect(s, 'jumper', pc.owner)) jumps();
  return out;
}

/** Атакует ли игрок `by` клетку `cell` (для правила повышения). */
export function isAttacked(s: GameState, cell: Pos, by: PlayerId): boolean {
  return piecesOf(s, by).some((pc) =>
    targetsOf(s, pc).some((t) => {
      if (!t.attack) return false;
      const v = victimCell(pc, t);
      return v.x === cell.x && v.y === cell.y;
    }),
  );
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

/**
 * Свободные клетки для новой фигуры: стартовая зона, иначе 4-й ряд, иначе ближайший к игроку ряд
 * со свободной клеткой (5-й, 6-й… до последнего). Пусто — только если занято всё поле.
 */
export function spawnCells(s: GameState, owner: PlayerId): Pos[] {
  const side = sideOf(s, owner);
  const { lo, hi } = bounds(s);
  const rowsFree = (rows: number[]) => {
    const out: Pos[] = [];
    for (const y of rows) for (let x = lo; x <= hi; x++) if (isFree(s, { x, y })) out.push({ x, y });
    return out;
  };
  const cells = rowsFree(homeRows(s, side));
  if (cells.length) return cells;
  for (let i = 3; i <= hi - lo; i++) {
    const row = rowsFree([side === 0 ? hi - i : lo + i]);
    if (row.length) return row;
  }
  return [];
}

export const opponentOf = (s: GameState) => other(s.current);

/** Последний ход Периода у игрока с отложенной картой на руках: не сыграет сейчас — карта сгорит. */
export function heldExpiresThisTurn(s: GameState, p: PlayerId): boolean {
  const h = s.players[p].held;
  return s.phase === 'play' && s.current === p && !!h && h.untilOwnTurn <= s.players[p].ownTurns;
}

/** Соперник отвечает на вопрос карты в чужой ход (Двойная смерть, Девальвация, Предательство) — кто именно. */
export function choosingOpponent(s: GameState): PlayerId | null {
  return s.phase === 'play' && s.pending && s.pending.chooser !== s.current ? s.pending.chooser : null;
}
