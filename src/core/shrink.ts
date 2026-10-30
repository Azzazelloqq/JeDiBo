// Сжатие поля. Когда фигур на поле мало, внешнее кольцо клеток выделяется, оба игрока делают по ходу —
// и кольцо исчезает, а фигуры с него сдвигаются на клетку к центру. Повторяется, пока поле не станет
// minSize × minSize; после этого все фигуры атакуют в любом направлении (rules.ts: fullyShrunk).
//
// Всё сжатие происходит в одной точке — между ходами (engine.endTurn → shrinkTick → startTurn), когда
// открытых вопросов нет. Отсюда строгий порядок: эффекты хода истекают → кольцо исчезает → начинается ход
// соперника → его отложенные повышения → Карма. Посреди хода поле не меняется никогда.
import { RANK_NAME, destroy, log, type Ctx } from './ops';
import { bounds, canShrink, inBoard, isBarrier, lastRow, piecesOf, sideOf } from './rules';
import { Rank, key, type GameState, type Piece, type Pos, type ShrinkMove } from './types';

/** Ходов между предупреждением и исчезновением кольца: сначала ходит один игрок, затем другой. */
export const WARN_TURNS = 2;

/** Пора начинать сжатие: на поле мало фигур или у одного из игроков их почти не осталось. */
export function shrinkTriggered(s: GameState): boolean {
  const cfg = s.mode.shrink;
  if (!cfg) return false;
  const a = piecesOf(s, 0).length;
  const b = piecesOf(s, 1).length;
  return a + b <= cfg.total || Math.min(a, b) <= cfg.perPlayer;
}

/** Размер живого поля (сторона квадрата). */
export const liveSize = (s: GameState) => {
  const { lo, hi } = bounds(s);
  return hi - lo + 1;
};

/** Между ходами: начать сжатие, отсчитать ход предупреждения или убрать выделенное кольцо. */
export function shrinkTick(c: Ctx) {
  const s = c.s;
  const sh = s.shrink;
  if (!sh || !s.mode.shrink) return;
  if (sh.warn === 0) {
    // начавшись, сжатие идёт само (следующее кольцо выделяется сразу после исчезновения прежнего)
    if (sh.level === 0 && canShrink(s) && shrinkTriggered(s)) warnRing(c);
    return;
  }
  sh.warn--;
  if (sh.warn > 0) {
    c.ev.push({ type: 'shrinkWarn', level: sh.level, turns: sh.warn });
    log(c, 'Последний ход перед сжатием поля');
    return;
  }
  collapse(c);
  if (canShrink(s)) warnRing(c);
  else {
    const n = liveSize(s);
    c.ev.push({ type: 'shrinkFinal', size: n });
    log(c, `Поле ${n}×${n} — больше не сжимается. Все фигуры атакуют в любом направлении`);
  }
}

function warnRing(c: Ctx) {
  const sh = c.s.shrink!;
  sh.warn = WARN_TURNS;
  c.ev.push({ type: 'shrinkWarn', level: sh.level, turns: sh.warn });
  const n = liveSize(c.s) - 2;
  log(c, `Поле сжимается: край исчезнет после хода каждого игрока, останется ${n}×${n}`);
}

/** Кольцо исчезает: фигуры с него — на клетку к центру, барьер на нём пропадает. */
function collapse(c: Ctx) {
  const s = c.s;
  const sh = s.shrink!;
  sh.level++;
  sh.warn = 0;
  for (const e of s.effects) if (e.kind === 'barrier') e.cells = e.cells.filter((p) => inBoard(s, p));

  // занятые клетки нового поля: фигуры внутри + клетки, которые уже заняли сдвинутые
  const taken = new Set(s.pieces.filter((pc) => inBoard(s, pc)).map(key));
  // ждущие повышения — первыми: им важнее остаться на краю. Дальше по id — порядок одинаков у обоих пиров
  const out = s.pieces
    .filter((pc) => !inBoard(s, pc))
    .sort((a, b) => Number(b.promoteNextTurn) - Number(a.promoteNextTurn) || a.id - b.id);
  const moves: ShrinkMove[] = [];
  const lost: Piece[] = [];
  for (const pc of out) {
    const to = landing(s, pc, taken);
    if (!to) {
      lost.push(pc);
      continue;
    }
    taken.add(key(to));
    moves.push({ pieceId: pc.id, from: { x: pc.x, y: pc.y }, to });
    pc.x = to.x;
    pc.y = to.y;
  }
  c.ev.push({ type: 'shrink', level: sh.level, moves });
  const n = liveSize(s);
  log(c, `Край поля исчез: теперь ${n}×${n}${moves.length ? `, к центру сдвинуто фигур: ${moves.length}` : ''}`);
  // места нет совсем (поле забито) — фигура падает в пропасть. На практике не бывает: фигур меньше, чем клеток
  for (const pc of lost) destroy(c, pc, 'shrink');

  // край сам подошёл к фигуре — она дошла до последнего ряда: повышение в начале хода владельца, если устоит
  for (const pc of s.pieces) {
    if (pc.rank === Rank.Circle || pc.promoteNextTurn || pc.y !== lastRow(s, sideOf(s, pc.owner))) continue;
    pc.promoteNextTurn = true;
    log(c, `${RANK_NAME[pc.rank]} оказался на краю поля — повысится в начале своего хода`, pc.owner);
  }
}

/**
 * Куда встаёт фигура с исчезнувшего кольца: соседняя клетка к центру (из угла — по диагонали).
 * Занята — ближайшая свободная к ней; ждущая повышения фигура при этом держится последнего ряда.
 * null — свободных клеток на поле нет.
 */
function landing(s: GameState, pc: Piece, taken: Set<string>): Pos | null {
  const { lo, hi } = bounds(s);
  const clamp = (v: number) => Math.min(hi, Math.max(lo, v));
  const want = { x: clamp(pc.x), y: clamp(pc.y) };
  const free = (p: Pos) => !taken.has(key(p)) && !isBarrier(s, p);
  if (free(want)) return want;
  const edge = pc.promoteNextTurn ? lastRow(s, sideOf(s, pc.owner)) : null;
  let best: Pos | null = null;
  let bestK: number[] = [];
  for (let y = lo; y <= hi; y++)
    for (let x = lo; x <= hi; x++) {
      const p = { x, y };
      if (!free(p)) continue;
      const k = [
        edge !== null && y !== edge ? 1 : 0,
        Math.max(Math.abs(x - want.x), Math.abs(y - want.y)),
        Math.abs(x - want.x) + Math.abs(y - want.y),
        Math.abs(x - pc.x) + Math.abs(y - pc.y),
      ];
      if (!best || less(k, bestK)) {
        best = p;
        bestK = k;
      }
    }
  return best;
}

function less(a: number[], b: number[]) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}
