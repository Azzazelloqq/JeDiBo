// Headless прогон: бот против бота. npm run sim
import { botAction } from '../src/ai/bot';
import { createGame, dispatch } from '../src/core/engine';
import { CLASSIC } from '../src/core/modes';
import type { CardId } from '../src/core/types';

const N = Number(process.argv[2] ?? 200);
const stats = { win0: 0, win1: 0, draw: 0, stuck: 0, turns: 0, cards: {} as Record<string, number> };
for (let g = 0; g < N; g++) {
  const s = createGame(CLASSIC, (g * 7919 + 13) | 0, ['A', 'B']);
  let steps = 0;
  while (s.phase !== 'over' && steps < 20000) {
    steps++;
    const who = s.pending ? s.pending.chooser : s.phase === 'placement' ? (s.players[0].placed ? 1 : 0) : s.current;
    const a = botAction(s, who);
    if (!a) throw new Error(`no action for ${who} at step ${steps}`);
    const r = dispatch(s, a);
    if (!r.ok) throw new Error(`game ${g}: ${r.error} ${JSON.stringify(a)} pending=${JSON.stringify(s.pending)}`);
    for (const e of r.events) if (e.type === 'cardPlayed') stats.cards[e.card] = (stats.cards[e.card] ?? 0) + 1;
    if (s.turn > 2000) break;
  }
  if (s.phase !== 'over') stats.stuck++;
  else if (s.winner === 'draw') stats.draw++;
  else stats[s.winner === 0 ? 'win0' : 'win1']++;
  stats.turns += s.turn;
}
const played = Object.keys(stats.cards) as CardId[];
console.log({ ...stats, avgTurns: Math.round(stats.turns / N), cards: undefined, cardsPlayed: played.length });
console.log(stats.cards);
