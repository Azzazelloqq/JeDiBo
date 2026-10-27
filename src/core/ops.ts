// Мутирующие операции над состоянием. Каждая пишет событие для слоя представления.
import { isAttacked, lastRow, periodIndex, sideOf, spawnCells } from './rules';
import { Rank, key, other, type GameEvent, type GameState, type Pending, type Piece, type PlayerId, type Pos } from './types';

export interface Ctx {
  s: GameState;
  ev: GameEvent[];
}

export const RANK_NAME = ['Треугольник', 'Квадрат', 'Круг'] as const;
export const RANK_NAME_ACC = ['треугольник', 'квадрат', 'круг'] as const;

export function log(c: Ctx, text: string, player?: PlayerId) {
  c.ev.push({ type: 'log', text, player });
}

export function destroy(c: Ctx, pc: Piece, cause: string) {
  const s = c.s;
  s.pieces = s.pieces.filter((q) => q.id !== pc.id);
  s.players[pc.owner].graveyard.push({ uid: s.nextId++, rank: pc.rank, period: periodIndex(s, pc.owner) });
  c.ev.push({ type: 'destroy', victim: { ...pc }, cause });
}

export function spawn(c: Ctx, owner: PlayerId, rank: Rank, at: Pos, acted = false): Piece {
  const pc: Piece = { id: c.s.nextId++, rank, owner, x: at.x, y: at.y, acted, promoteNextTurn: false };
  c.s.pieces.push(pc);
  c.ev.push({ type: 'spawn', piece: { ...pc } });
  return pc;
}

export function setRank(c: Ctx, pc: Piece, to: Rank) {
  const from = pc.rank;
  pc.rank = to;
  c.ev.push({ type: 'rankChange', pieceId: pc.id, from, to });
}

/** Поставить вопрос игроку. Если уже есть открытый вопрос — встаём в очередь. */
export function ask(c: Ctx, p: Omit<Pending, 'step' | 'data'> & { step?: number; data?: Record<string, unknown> }) {
  const full: Pending = { step: 0, data: {}, ...p };
  if (c.s.pending) c.s.queue.push(full);
  else c.s.pending = full;
}

export const cellOptions = (cells: Pos[]) => cells.map(key);

/** Спросить, куда поставить новую фигуру. Если места нет совсем — фигура теряется. */
export function askSpawn(c: Ctx, owner: PlayerId, rank: Rank, source: Pending['source'], acted: boolean, prompt?: string) {
  const cells = spawnCells(c.s, owner);
  if (!cells.length) {
    log(c, `Нет места для фигуры: ${RANK_NAME_ACC[rank]} потерян`, owner);
    return;
  }
  ask(c, {
    source,
    chooser: owner,
    beneficiary: owner,
    kind: 'cell',
    options: cellOptions(cells),
    canSkip: false,
    prompt: prompt ?? `Поставьте: ${RANK_NAME[rank]}`,
    data: { spawnRank: rank, acted },
  });
}

/**
 * Правило повышения: фигура на последнем ряду соперника.
 * Не под атакой — повышается сразу (исходная снимается, новая ставится в стартовую зону),
 * под атакой — помечается и повысится в начале следующего хода владельца.
 */
export function checkPromotion(c: Ctx, pc: Piece, immediateActed: boolean) {
  const s = c.s;
  if (pc.rank === Rank.Circle) return;
  if (pc.y !== lastRow(s, sideOf(s, pc.owner))) return;
  if (isAttacked(s, pc, other(pc.owner))) {
    if (!pc.promoteNextTurn) {
      pc.promoteNextTurn = true;
      log(c, `${RANK_NAME[pc.rank]} дошёл до края под атакой — повышение отложено`, pc.owner);
    }
    return;
  }
  startPromotion(c, pc, immediateActed);
}

export function startPromotion(c: Ctx, pc: Piece, acted: boolean) {
  pc.promoteNextTurn = false;
  const rank = (pc.rank + 1) as Rank;
  const cells = spawnCells(c.s, pc.owner);
  if (!cells.length) {
    setRank(c, pc, rank);
    return;
  }
  // исходная фигура остаётся на месте до выбора клетки, чтобы игрок не «остался без фигур»
  ask(c, {
    source: 'promotion',
    chooser: pc.owner,
    beneficiary: pc.owner,
    kind: 'cell',
    options: cellOptions(cells),
    canSkip: false,
    prompt: `Повышение: поставьте ${RANK_NAME_ACC[rank]} в стартовую зону`,
    data: { promoteId: pc.id, spawnRank: rank, acted },
  });
}
