// Сверка быстрой доски бота с движком и замер скорости. npm run aicheck [-- партий]
// Позиции берутся из партий жадного бота; в часть из них подмешиваются эффекты Кармы.
import { FastBoard, ATTACK, JUMP, CELL_MASK, newUndo } from '../src/ai/board';
import { botAction } from '../src/ai/bot';
import { createGame, dispatch } from '../src/core/engine';
import { CLASSIC } from '../src/core/modes';
import { canAct, isAttacked, isFree, piecesOf, targetsOf } from '../src/core/rules';
import { other, type GameState, type PlayerId } from '../src/core/types';

const GAMES = Number(process.argv[2] ?? 60);
const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s));

// детерминированный ГСЧ для выбора позиций и эффектов
let seed = 12345;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x80000000;
};
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];

// ── позиции ─────────────────────────────────────────────────────────────────
const positions: GameState[] = [];
for (let g = 0; g < GAMES; g++) {
  const s = createGame(CLASSIC, g * 7919 + 1, ['A', 'B']);
  let steps = 0;
  while (s.phase !== 'over' && steps++ < 6000 && s.turn < 500) {
    const who = s.pending ? s.pending.chooser : s.phase === 'placement' ? (s.players[0].placed ? 1 : 0) : s.current;
    if (s.phase === 'play' && !s.pending && rnd() < 0.08) positions.push(withRandomEffects(clone(s)));
    dispatch(s, botAction(s, who)!);
  }
}

function withRandomEffects(s: GameState): GameState {
  if (rnd() < 0.4) return s;
  const own = (p: PlayerId) => s.players[p].ownTurns + 3;
  for (const p of [0, 1] as PlayerId[]) {
    if (rnd() < 0.3) s.effects.push({ kind: 'roundProtection', owner: p, untilOwnTurn: own(p) });
    if (rnd() < 0.2) s.effects.push({ kind: rnd() < 0.5 ? 'depression' : 'snail', owner: p, untilOwnTurn: own(p) });
    if (rnd() < 0.3) s.effects.push({ kind: 'jumper', owner: p, untilOwnTurn: own(p) });
  }
  if (rnd() < 0.3 && !s.effects.some((e) => e.kind === 'blitz' && e.owner === s.current)) {
    const pc = pick(piecesOf(s, s.current));
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

// ── сверка ──────────────────────────────────────────────────────────────────
let fails = 0;
const fail = (msg: string) => {
  if (fails++ < 15) console.log('  РАСХОЖДЕНИЕ:', msg);
};
const stats = { positions: positions.length, pieces: 0, targets: 0, attackCells: 0, moves: 0, dispatchCompared: 0 };
const buf = new Int32Array(512);
const pbuf = new Int16Array(512);
const u = newUndo();

const snapshot = (b: FastBoard) => {
  const pcs: string[] = [];
  for (let i = 0; i < b.count; i++) if (b.alive[i]) pcs.push(`${b.id[i]}:${b.px[i]},${b.py[i]},${b.rank[i]},${b.owner[i]},${b.acted[i]}`);
  pcs.sort();
  const bp = (p: number) => (b.blitzPiece[p] >= 0 ? b.id[b.blitzPiece[p]] : -1);
  const barriers: number[] = [];
  b.cell.forEach((v, c) => v < 0 && barriers.push(c));
  return `${pcs.join(' ')}|ap${b.ap}|a${b.actedThisTurn}|j${b.jumper[0]}${b.jumper[1]}|bl${b.blitz[0]}${b.blitz[1]}:${bp(0)},${bp(1)}:${b.blitzDone[0]}${b.blitzDone[1]}|bar${barriers.join(',')}`;
};

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
    if (eng.join() !== fast.join()) fail(`targets id=${pc.id} rank=${pc.rank}: движок [${eng}] быстрая [${fast}]`);
    if (canAct(s, pc) !== b.canAct(i)) fail(`canAct id=${pc.id}: движок ${canAct(s, pc)}`);
  }
  // атаки: движок считает атакованной только клетку с фигурой соперника атакующего
  for (const pc of s.pieces) {
    const by = other(pc.owner);
    stats.attackCells++;
    if (isAttacked(s, pc, by) !== b.attacked(pc.x, pc.y, by)) fail(`attacked ${pc.x},${pc.y} by ${by}`);
  }
  // ход и откат: сравнение с dispatch движка
  const before = snapshot(b);
  const cnt = b.movesOf(pbuf, buf);
  for (let k = 0; k < cnt; k++) {
    if (rnd() > 0.25) continue;
    stats.moves++;
    const i = pbuf[k];
    const t = buf[k];
    b.make(i, t, u);
    const after = snapshot(b);
    b.unmake(u);
    if (snapshot(b) !== before) fail('unmake не вернул позицию');
    const e = clone(s);
    const to = t & CELL_MASK;
    const r = dispatch(e, { type: 'move', by: e.current, pieceId: b.id[i], to: { x: to % n, y: (to / n) | 0 } });
    if (!r.ok) {
      fail(`движок отклонил ход: ${r.error}`);
      continue;
    }
    // повышение, конец хода и вопросы карт быстрая доска не моделирует
    const promoted = r.events.some((ev) => ev.type === 'log' && /повышение|Повышение/.test(ev.text));
    if (e.pending || e.turn !== s.turn || promoted || e.phase !== 'play') continue;
    stats.dispatchCompared++;
    const eb = FastBoard.fromState(e);
    if (snapshot(eb) !== after) fail(`make ≠ dispatch\n    быстрая ${after}\n    движок  ${snapshot(eb)}`);
  }
}
console.log(stats);
console.log(fails ? `РАСХОЖДЕНИЙ: ${fails}` : 'расхождений нет');

// ── скорость ────────────────────────────────────────────────────────────────
const play = positions.filter((s) => !s.pending);
const T = (name: string, iters: number, fn: (s: GameState, b: FastBoard) => void) => {
  const boards = play.map((s) => FastBoard.fromState(s));
  const t0 = performance.now();
  for (let k = 0; k < iters; k++) fn(play[k % play.length], boards[k % boards.length]);
  console.log(`  ${name}: ${(((performance.now() - t0) / iters) * 1000).toFixed(2)} мкс`);
};
console.log('скорость (на позицию):');
T('движок: все ходы стороны', 20000, (s) => {
  for (const pc of piecesOf(s, s.current)) if (canAct(s, pc)) targetsOf(s, pc);
});
T('быстрая: все ходы стороны', 200000, (_s, b) => b.movesOf(pbuf, buf));
T('движок: isAttacked одной фигуры', 20000, (s) => isAttacked(s, s.pieces[0], other(s.pieces[0].owner)));
T('быстрая: attacked одной фигуры', 200000, (_s, b) => b.attacked(b.px[0], b.py[0], (1 - b.owner[0]) as PlayerId));
T('быстрая: атакованы ли все фигуры', 100000, (_s, b) => {
  for (let i = 0; i < b.count; i++) if (b.alive[i]) b.attacked(b.px[i], b.py[i], (1 - b.owner[i]) as PlayerId);
});
T('быстрая: все ходы + make/unmake каждого', 20000, (_s, b) => {
  const c = b.movesOf(pbuf, buf);
  for (let k = 0; k < c; k++) {
    b.make(pbuf[k], buf[k], u);
    b.unmake(u);
  }
});
T('быстрая: загрузка из GameState', 50000, (s, b) => b.load(s));
