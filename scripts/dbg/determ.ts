import { createAgent } from '../../src/ai/agent';
import { levelById } from '../../src/ai/levels';
import { createGame, dispatch } from '../../src/core/engine';
import { CLASSIC } from '../../src/core/modes';
import type { PlayerId } from '../../src/core/types';
const lvl = process.argv[2] ?? 'amateur';
const cfg = { ...levelById(lvl).config, budgetMs: undefined };
function play(g: number) {
  const s = createGame(CLASSIC, g * 7919 + 3, ['A', 'B']);
  const bots = [createAgent(cfg, g), createAgent(cfg, g + 100)];
  const log: string[] = [];
  let steps = 0;
  while (s.phase !== 'over' && steps++ < 3000) {
    const who: PlayerId = s.pending ? s.pending.chooser : s.phase === 'placement' ? (s.players[0].placed ? 1 : 0) : s.current;
    const a = bots[who](s, who)!;
    log.push(JSON.stringify(a));
    dispatch(s, a);
  }
  return log;
}
for (let g = 0; g < 30; g++) {
  const a = play(g), b = play(g);
  const k = a.findIndex((x, i) => x !== b[i]);
  if (k >= 0 || a.length !== b.length) console.log(`партия ${g}: расходится на действии ${k} из ${a.length}/${b.length}: ${a[k]} | ${b[k]}`);
}
console.log('готово');
