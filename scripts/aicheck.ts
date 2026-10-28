// Сверка быстрой доски бота с движком и замер скорости. npm run aicheck [-- партий]
// Позиции берутся из партий жадного бота; в часть из них подмешиваются эффекты Кармы.
import { FastBoard, newUndo } from '../src/ai/board';
import { canAct, isAttacked, piecesOf, targetsOf } from '../src/core/rules';
import { other, type GameState, type PlayerId } from '../src/core/types';
import { botAction } from './greedy';
import { checkBoard, collectPositions, lcg } from './lib/boardcheck';

const GAMES = Number(process.argv[2] ?? 60);
const rnd = lcg(12345);
const positions = collectPositions(GAMES, () => [botAction, botAction], rnd);
const { fails, stats } = checkBoard(positions, rnd);
for (const f of fails.slice(0, 15)) console.log('  РАСХОЖДЕНИЕ:', f);
console.log(stats);
console.log(fails.length ? `РАСХОЖДЕНИЙ: ${fails.length}` : 'расхождений нет');

const buf = new Int32Array(512);
const pbuf = new Int16Array(512);
const u = newUndo();

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
