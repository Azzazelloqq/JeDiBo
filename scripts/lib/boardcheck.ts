// Сверка быстрой доски бота (src/ai/board.ts) с движком: цели ходов, canAct, атаки, ход против dispatch, откат.
// Используется в npm run aicheck и в npm test.
import { ATTACK, CELL_MASK, FastBoard, JUMP, newUndo } from '../../src/ai/board';
import { createGame, dispatch } from '../../src/core/engine';
import { CLASSIC } from '../../src/core/modes';
import { canAct, isAttacked, isFree, piecesOf, targetsOf } from '../../src/core/rules';
import { other, type Action, type GameState, type PlayerId } from '../../src/core/types';

type Mover = (s: GameState, me: PlayerId) => Action | null;

const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s));

/** Детерминированный ГСЧ (линейный конгруэнтный) — позиции и эффекты повторяются от прогона к прогону. */
export function lcg(seed: number): () => number {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x / 0x80000000;
  };
}

/**
 * Позиции из партий: каждая с вероятностью `share` в фазе игры; в часть подмешиваются эффекты Кармы.
 * movers(g) — боты для партии g (по месту).
 */
export function collectPositions(games: number, movers: (g: number) => [Mover, Mover], rnd: () => number, share = 0.08): GameState[] {
  const out: GameState[] = [];
  for (let g = 0; g < games; g++) {
    const bots = movers(g);
    const s = createGame(CLASSIC, g * 7919 + 1, ['A', 'B']);
    let steps = 0;
    while (s.phase !== 'over' && steps++ < 6000 && s.turn < 500) {
      const who: PlayerId = s.pending ? s.pending.chooser : s.phase === 'placement' ? (s.players[0].placed ? 1 : 0) : s.current;
      if (s.phase === 'play' && !s.pending && rnd() < share) out.push(withRandomEffects(clone(s), rnd));
      const a = bots[who](s, who);
      if (!a) break;
      dispatch(s, a);
    }
  }
  return out;
}

function withRandomEffects(s: GameState, rnd: () => number): GameState {
  if (rnd() < 0.4) return s;
  const own = (p: PlayerId) => s.players[p].ownTurns + 3;
  for (const p of [0, 1] as PlayerId[]) {
    if (rnd() < 0.3) s.effects.push({ kind: 'roundProtection', owner: p, untilOwnTurn: own(p) });
    if (rnd() < 0.2) s.effects.push({ kind: rnd() < 0.5 ? 'depression' : 'snail', owner: p, untilOwnTurn: own(p) });
    if (rnd() < 0.3) s.effects.push({ kind: 'jumper', owner: p, untilOwnTurn: own(p) });
  }
  if (rnd() < 0.3 && !s.effects.some((e) => e.kind === 'blitz' && e.owner === s.current)) {
    const mine = piecesOf(s, s.current);
    const pc = mine[Math.floor(rnd() * mine.length)];
    s.effects.push({ kind: 'blitz', owner: s.current, untilOwnTurn: own(s.current), pieceId: rnd() < 0.5 ? null : pc?.id ?? null, done: false });
  }
  if (rnd() < 0.3) {
    for (let k = 0; k < 20; k++) {
      const c = { x: Math.floor(rnd() * 11), y: Math.floor(rnd() * 12) };
      const d = { x: c.x + 1, y: c.y };
      if (isFree(s, c) && isFree(s, d)) {
        s.effects.push({ kind: 'barrier', owner: s.current, untilOwnTurn: own(s.current), cells: [c, d] });
        break;
      }
    }
  }
  return s;
}

export interface CheckStats {
  positions: number;
  pieces: number;
  targets: number;
  attackCells: number;
  moves: number;
  dispatchCompared: number;
}

const snapshot = (b: FastBoard) => {
  const pcs: string[] = [];
  for (let i = 0; i < b.count; i++) if (b.alive[i]) pcs.push(`${b.id[i]}:${b.px[i]},${b.py[i]},${b.rank[i]},${b.owner[i]},${b.acted[i]}`);
  pcs.sort();
  const bp = (p: number) => (b.blitzPiece[p] >= 0 ? b.id[b.blitzPiece[p]] : -1);
  const barriers: number[] = [];
  b.cell.forEach((v, c) => v < 0 && barriers.push(c));
  return `${pcs.join(' ')}|ap${b.ap}|a${b.actedThisTurn}|j${b.jumper[0]}${b.jumper[1]}|bl${b.blitz[0]}${b.blitz[1]}:${bp(0)},${bp(1)}:${b.blitzDone[0]}${b.blitzDone[1]}|bar${barriers.join(',')}`;
};

/** Сверить быструю доску с движком на позициях. moveShare — доля ходов, проверяемых через dispatch. */
export function checkBoard(positions: GameState[], rnd: () => number, moveShare = 0.25): { fails: string[]; stats: CheckStats } {
  const fails: string[] = [];
  const stats: CheckStats = { positions: positions.length, pieces: 0, targets: 0, attackCells: 0, moves: 0, dispatchCompared: 0 };
  const buf = new Int32Array(512);
  const pbuf = new Int16Array(512);
  const u = newUndo();
  for (const s of positions) {
    const b = FastBoard.fromState(s);
    const n = s.mode.size;
    for (const pc of s.pieces) {
      stats.pieces++;
      const i = b.indexOfId(pc.id);
      const eng = targetsOf(s, pc).map((t) => (t.to.y * n + t.to.x) | (t.attack ? ATTACK : 0) | (t.jump ? JUMP : 0)).sort((a, c) => a - c);
      const len = b.targets(i, buf);
      const fast = Array.from(buf.subarray(0, len)).sort((a, c) => a - c);
      stats.targets += eng.length;
      if (eng.join() !== fast.join()) fails.push(`targets id=${pc.id} rank=${pc.rank}: движок [${eng}] быстрая [${fast}]`);
      if (canAct(s, pc) !== b.canAct(i)) fails.push(`canAct id=${pc.id}: движок ${canAct(s, pc)}`);
    }
    // атаки: движок считает атакованной только клетку с фигурой соперника атакующего
    for (const pc of s.pieces) {
      const by = other(pc.owner);
      stats.attackCells++;
      if (isAttacked(s, pc, by) !== b.attacked(pc.x, pc.y, by)) fails.push(`attacked ${pc.x},${pc.y} by ${by}`);
    }
    // ход и откат: сравнение с dispatch движка
    const before = snapshot(b);
    const cnt = b.movesOf(pbuf, buf);
    for (let k = 0; k < cnt; k++) {
      if (rnd() > moveShare) continue;
      stats.moves++;
      const i = pbuf[k];
      const t = buf[k];
      b.make(i, t, u);
      const after = snapshot(b);
      b.unmake(u);
      if (snapshot(b) !== before) fails.push('unmake не вернул позицию');
      const e = clone(s);
      const to = t & CELL_MASK;
      const r = dispatch(e, { type: 'move', by: e.current, pieceId: b.id[i], to: { x: to % n, y: (to / n) | 0 } });
      if (!r.ok) {
        fails.push(`движок отклонил ход: ${r.error}`);
        continue;
      }
      // повышение, конец хода и вопросы карт быстрая доска не моделирует
      const promoted = r.events.some((ev) => ev.type === 'log' && /повышение|Повышение/.test(ev.text));
      if (e.pending || e.turn !== s.turn || promoted || e.phase !== 'play') continue;
      stats.dispatchCompared++;
      const eb = FastBoard.fromState(e);
      if (snapshot(eb) !== after) fails.push(`make ≠ dispatch\n    быстрая ${after}\n    движок  ${snapshot(eb)}`);
    }
  }
  return { fails, stats };
}
