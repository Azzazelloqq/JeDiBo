// Незаконченные партии: доска и материал на ходах 100/200/300 (бот — заглавные).
import { createAgent } from '../../src/ai/agent';
import { levelById } from '../../src/ai/levels';
import { opponentByName } from '../lib/opponents';
import { createGame, dispatch } from '../../src/core/engine';
import { CLASSIC } from '../../src/core/modes';
import type { GameState, PlayerId } from '../../src/core/types';
const [opp = 'turtle', nArg = '12'] = process.argv.slice(2);
const base = levelById('master').config;
const cfg = { ...base, budgetMs: undefined, weights: { ...base.weights, reach: true }, search: { ...base.search, followup: undefined, minChecked: 4, personas: [{ weights: { advance: 0, threat: 1.5, myThreat: 0 }, top: 3, width: 4 }, { weights: { threat: 0.5, myThreat: 0.6 }, top: 3, width: 4 }] } };
const show = (s: GameState, me: PlayerId) => {
  const rows: string[] = [];
  for (let y = 0; y < 12; y++) { let r = ''; for (let x = 0; x < 12; x++) { const p = s.pieces.find((q) => q.x === x && q.y === y); r += p ? 'tsc'[p.rank][p.owner === me ? 'toUpperCase' : 'toLowerCase']() : '.'; } rows.push(r); }
  return rows.join('\n');
};
const VAL = [1, 3, 5];
for (let g = 0; g < Number(nArg); g++) {
  const me = (g % 2) as PlayerId;
  const s = createGame(CLASSIC, (g * 2654435761 + 17) | 0, ['A', 'B']);
  s.deck = [];
  const a = createAgent(cfg, g * 2 + 1), b = opponentByName(opp, g * 2 + 2)!;
  const snaps: string[] = [];
  let steps = 0, lastCap = 0;
  while (s.phase !== 'over' && s.turn <= 300 && steps++ < 20000) {
    const who: PlayerId = s.pending ? s.pending.chooser : s.phase === 'placement' ? (s.players[0].placed ? 1 : 0) : s.current;
    const r = dispatch(s, (who === me ? a : b)(s, who)!);
    if (r.events.some((e) => e.type === 'capture')) lastCap = s.turn;
    if ([100, 200, 300].includes(s.turn) && !snaps[s.turn]) {
      const m = (p: PlayerId) => s.pieces.filter((q) => q.owner === p).reduce((x, q) => x + VAL[q.rank], 0);
      const cnt = (p: PlayerId) => [0, 1, 2].map((k) => s.pieces.filter((q) => q.owner === p && q.rank === k).length).join('/');
      snaps[s.turn] = `ход ${s.turn}: материал бот ${m(me)} (${cnt(me)}) — соп. ${m((1 - me) as PlayerId)} (${cnt((1 - me) as PlayerId)}), последнее взятие на ходу ${lastCap}\n${show(s, me)}`;
    }
  }
  console.log(`партия ${g}: ${s.phase === 'over' ? `итог ${s.winner === me ? 'победа' : s.winner === 'draw' ? 'ничья' : 'поражение'} на ходу ${s.turn}` : 'не закончена'}`);
  if (s.phase !== "over") console.log(snaps[300]);
}
