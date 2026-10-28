// Headless прогон: бот против бота. npm run sim
// Заодно проверка детерминизма для сети: лог действий, прогнанный через JSON (как по проводу),
// переигрывается с того же seed и должен дать тот же stateHash на каждом шаге.
import { createAgent } from '../src/ai/agent';
import { levelById } from '../src/ai/levels';
import { createGame, dispatch } from '../src/core/engine';
import { CLASSIC } from '../src/core/modes';
import type { Action, CardId } from '../src/core/types';
import { stateHash } from '../src/net/hash';

const N = Number(process.argv[2] ?? 200);
const stats = { win0: 0, win1: 0, draw: 0, stuck: 0, turns: 0, cards: {} as Record<string, number> };
for (let g = 0; g < N; g++) {
  const seed = (g * 7919 + 13) | 0;
  const s = createGame(CLASSIC, seed, ['A', 'B']);
  const bots = [0, 1].map((p) => createAgent({ ...levelById('amateur').config, budgetMs: undefined }, seed * 2 + p));
  const log: Action[] = [];
  const hashes: number[] = [];
  let steps = 0;
  while (s.phase !== 'over' && steps < 20000) {
    steps++;
    const who = s.pending ? s.pending.chooser : s.phase === 'placement' ? (s.players[0].placed ? 1 : 0) : s.current;
    const a = bots[who](s, who);
    if (!a) throw new Error(`no action for ${who} at step ${steps}`);
    const r = dispatch(s, a);
    if (!r.ok) throw new Error(`game ${g}: ${r.error} ${JSON.stringify(a)} pending=${JSON.stringify(s.pending)}`);
    log.push(a);
    hashes.push(stateHash(s));
    for (const e of r.events) if (e.type === 'cardPlayed') stats.cards[e.card] = (stats.cards[e.card] ?? 0) + 1;
    if (s.turn > 2000) break;
  }
  replay(g, seed, log, hashes);
  if (s.phase !== 'over') stats.stuck++;
  else if (s.winner === 'draw') stats.draw++;
  else stats[s.winner === 0 ? 'win0' : 'win1']++;
  stats.turns += s.turn;
}
const played = Object.keys(stats.cards) as CardId[];
console.log({ ...stats, avgTurns: Math.round(stats.turns / N), cards: undefined, cardsPlayed: played.length });
console.log(stats.cards);

function replay(g: number, seed: number, log: Action[], hashes: number[]) {
  const r = createGame(CLASSIC, seed, ['A', 'B']);
  const wire: Action[] = JSON.parse(JSON.stringify(log));
  wire.forEach((a, i) => {
    const res = dispatch(r, a);
    if (!res.ok) throw new Error(`replay ${g}: step ${i} rejected: ${res.error}`);
    if (stateHash(r) !== hashes[i]) throw new Error(`replay ${g}: desync at step ${i} (${a.type})`);
  });
}
console.log('determinism: ok');
