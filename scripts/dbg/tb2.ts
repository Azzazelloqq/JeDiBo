// Доигрывание позиций trade-blunders: первый ход — новой или старой настройкой, дальше обе стороны — новый/старый Мастер.
import tradeBlunders from '../fixtures/trade-blunders.json';
import { FastBoard, newUndo, passTurn } from '../../src/ai/board';
import { levelById } from '../../src/ai/levels';
import { searchTurn } from '../../src/ai/search';
import type { GameState, PlayerId } from '../../src/core/types';
const VAL = [1, 3, 5];
const lv = levelById('master').config;
const NEW = lv;
const OLD = { ...lv, weights: { ...lv.weights, reach: false }, search: { candidates: 10, reply: { width: 3, lookahead: 1 }, followup: { width: 2, lookahead: 1 } } };
for (const [i, { state, me }] of (tradeBlunders as { state: GameState; me: PlayerId }[]).entries()) {
  const row: string[] = [];
  for (const [fn, first] of [['новый', NEW], ['старый', OLD]] as const)
    for (const [rn, rest] of [['новый', NEW], ['старый', OLD]] as const) {
      const b = FastBoard.fromState(state);
      const mat = () => { let m = 0; for (let k = 0; k < b.count; k++) if (b.alive[k]) m += (b.owner[k] === me ? 1 : -1) * VAL[b.rank[k]]; return m; };
      const m0 = mat();
      const ms: number[] = [];
      for (let ply = 0; ply < 6; ply++) {
        const who = (ply % 2 === 0 ? me : 1 - me) as PlayerId;
        const c = ply === 0 ? first : rest;
        const st = searchTurn(b, who, c.weights, c.turn, c.search).scored[0].steps;
        for (const x of st) b.make(x.pi, x.t, newUndo());
        passTurn(b);
        ms.push(mat() - m0);
      }
      row.push(`1-й ход ${fn}, дальше ${rn}: ${ms.join(' ')}`);
    }
  console.log(`позиция ${i}\n  ${row.join('\n  ')}`);
}
