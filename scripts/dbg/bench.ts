// Время расчёта хода на позициях из партий: node bench.mjs [позиций]  (вариант — через env CFG=reach,f0,pe)
import { createAgent } from '../../src/ai/agent';
import { FastBoard } from '../../src/ai/board';
import { levelById } from '../../src/ai/levels';
import { searchTurn } from '../../src/ai/search';
import { opponentByName } from '../lib/opponents';
import { createGame, dispatch } from '../../src/core/engine';
import { CLASSIC } from '../../src/core/modes';
import type { GameState, PlayerId } from '../../src/core/types';

const N = Number(process.argv[2] ?? 60);
const base = { ...levelById('master').config, budgetMs: undefined };
const pos: { s: GameState; me: PlayerId }[] = [];
for (let g = 0; pos.length < N; g++) {
  const s = createGame(CLASSIC, (g * 2654435761 + 17) | 0, ['A', 'B']);
  s.deck = [];
  const a = createAgent(base, g * 2 + 1);
  const b = g % 2 ? opponentByName('turtle', g)! : createAgent(base, g * 2 + 2);
  let steps = 0;
  while (s.phase !== 'over' && s.turn < 80 && steps++ < 8000 && pos.length < N) {
    const who: PlayerId = s.pending ? s.pending.chooser : s.phase === 'placement' ? (s.players[0].placed ? 1 : 0) : s.current;
    if (s.phase === 'play' && !s.pending && !s.actedThisTurn && s.turn % 6 === 1) pos.push({ s: JSON.parse(JSON.stringify(s)), me: s.current });
    dispatch(s, (who === 0 ? a : b)(s, who)!);
  }
}
export function bench(name: string, cfg: typeof base) {
  const b = new FastBoard(12);
  const ts: number[] = [];
  for (const p of pos) {
    b.load(p.s);
    const t0 = performance.now();
    searchTurn(b, p.me, cfg.weights, cfg.turn, cfg.search);
    ts.push(performance.now() - t0);
  }
  ts.sort((x, y) => x - y);
  const avg = ts.reduce((x, y) => x + y, 0) / ts.length;
  console.log(`${name}: среднее ${avg.toFixed(0)} мс, 90% ${ts[Math.floor(ts.length * 0.9)].toFixed(0)}, макс ${ts[ts.length - 1].toFixed(0)}`);
}
const OLD = { ...base, weights: { ...base.weights, reach: false }, search: { candidates: 10, reply: { width: 3, lookahead: 1 }, followup: { width: 2, lookahead: 1 } } };
bench('старый Мастер', OLD);
bench('новый Мастер', base);
bench('новый, 3 обяз.', { ...base, search: { ...base.search, minChecked: 3 } });
bench('новый, без характеров', { ...base, search: { ...base.search, personas: undefined } });
