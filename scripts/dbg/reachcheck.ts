// Сверка быстрого reachAttackerOf с прямым перебором ходов на позициях из партий (ранг найденной фигуры).
import { createAgent } from '../../src/ai/agent';
import { ATTACK, CELL_MASK, FastBoard } from '../../src/ai/board';
import { levelById } from '../../src/ai/levels';
import { createGame, dispatch } from '../../src/core/engine';
import { CLASSIC } from '../../src/core/modes';
import type { PlayerId } from '../../src/core/types';
const buf = new Int32Array(256);
function slow(b: FastBoard, x: number, y: number, by: PlayerId, xray: boolean): number {
  let best = -1;
  const n = b.n;
  for (let i = 0; i < b.count; i++) {
    if (!b.alive[i] || b.owner[i] !== by) continue;
    if (best >= 0 && b.rank[i] >= b.rank[best]) continue;
    if (b.px[i] === x && b.py[i] === y) continue;
    if (b.hits(i, x, y, xray)) { best = i; continue; }
    const len = b.targets(i, buf);
    const from = b.py[i] * n + b.px[i], fx = b.px[i], fy = b.py[i];
    b.cell[from] = 0;
    let ok = false;
    for (let k = 0; k < len && !ok; k++) {
      const t = buf[k];
      if (t & ATTACK) continue;
      const c = t & CELL_MASK;
      b.px[i] = c % n; b.py[i] = (c / n) | 0; b.cell[c] = i + 1;
      ok = b.hits(i, x, y, xray);
      b.cell[c] = 0;
    }
    b.px[i] = fx; b.py[i] = fy; b.cell[from] = i + 1;
    if (ok) best = i;
  }
  return best;
}
const cfg = { ...levelById('amateur').config, budgetMs: undefined };
let checks = 0, bad = 0;
const b = new FastBoard(12);
for (let g = 0; g < 30; g++) {
  const s = createGame(CLASSIC, g * 7919 + 3, ['A', 'B']);
  const bots = [createAgent(cfg, g), createAgent(cfg, g + 100)];
  let steps = 0;
  while (s.phase !== 'over' && steps++ < 3000) {
    const who: PlayerId = s.pending ? s.pending.chooser : s.phase === 'placement' ? (s.players[0].placed ? 1 : 0) : s.current;
    if (s.phase === 'play' && !s.pending && steps % 7 === 0 && !s.effects.some((e) => e.kind === 'jumper')) {
      b.load(s);
      for (let i = 0; i < b.count; i++) {
        if (!b.alive[i]) continue;
        for (const by of [0, 1] as PlayerId[]) for (const xr of [false, true]) {
          const a = b.reachAttackerOf(b.px[i], b.py[i], by, xr), c = slow(b, b.px[i], b.py[i], by, xr);
          checks++;
          if ((a < 0 ? -1 : b.rank[a]) !== (c < 0 ? -1 : b.rank[c])) { bad++; if (bad < 5) console.log('расхождение', g, steps, i, by, xr, a, c); }
        }
      }
    }
    dispatch(s, bots[who](s, who)!);
  }
}
console.log(`проверок ${checks}, расхождений ${bad}`);
