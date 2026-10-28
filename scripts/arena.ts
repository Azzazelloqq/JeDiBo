// Арена: бот против бота. npm run arena -- <A> <B> [партий] [лимит ходов]
// Боты меняются местами через партию. Незаконченные к лимиту партии считаются отдельно (и как ничьи в очках).
import { botAction } from '../src/ai/bot';
import { createGame, dispatch } from '../src/core/engine';
import { CLASSIC } from '../src/core/modes';
import type { Action, GameState, PlayerId } from '../src/core/types';

type BotFn = (s: GameState, me: PlayerId) => Action | null;

const BOTS: Record<string, () => BotFn> = {
  greedy: () => botAction,
};

const [nameA = 'greedy', nameB = 'greedy', nArg = '200', limitArg = '1000'] = process.argv.slice(2);
for (const n of [nameA, nameB]) if (!BOTS[n]) throw new Error(`Нет бота «${n}». Есть: ${Object.keys(BOTS).join(', ')}`);
const N = Number(nArg);
const LIMIT = Number(limitArg);

interface Side { name: string; wins: number; times: number[] }
const sides: [Side, Side] = [
  { name: nameA, wins: 0, times: [] },
  { name: nameB, wins: 0, times: [] },
];
let draws = 0;
let unfinished = 0;
const lengths: number[] = [];

for (let g = 0; g < N; g++) {
  // бот A сидит на месте 0 в чётных партиях, на месте 1 — в нечётных
  const seatOf: [number, number] = g % 2 === 0 ? [0, 1] : [1, 0];
  const fns = [BOTS[nameA](), BOTS[nameB]()];
  const s = createGame(CLASSIC, (g * 2654435761 + 17) | 0, ['A', 'B']);
  let steps = 0;
  while (s.phase !== 'over' && s.turn <= LIMIT && steps++ < LIMIT * 40) {
    const who: PlayerId = s.pending ? s.pending.chooser : s.phase === 'placement' ? (s.players[0].placed ? 1 : 0) : s.current;
    const bot = seatOf[who];
    const t0 = performance.now();
    const a = fns[bot](s, who);
    sides[bot].times.push(performance.now() - t0);
    if (!a) throw new Error(`партия ${g}: бот ${sides[bot].name} не дал действия`);
    const r = dispatch(s, a);
    if (!r.ok) throw new Error(`партия ${g}: бот ${sides[bot].name} — ${r.error} ${JSON.stringify(a)}`);
  }
  lengths.push(s.turn);
  if (s.phase !== 'over') unfinished++;
  else if (s.winner === 'draw') draws++;
  else sides[seatOf[s.winner!]].wins++;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const quant = (a: number[], q: number) => {
  const b = [...a].sort((x, y) => x - y);
  return b[Math.min(b.length - 1, Math.floor(q * b.length))] ?? 0;
};
// очки A: победа 1, ничья и незаконченная 0.5; 95% интервал по нормальному приближению
const score = (sides[0].wins + 0.5 * (draws + unfinished)) / N;
const se = Math.sqrt((score * (1 - score)) / N);
console.log(`${nameA} против ${nameB}, партий ${N}, лимит ${LIMIT} ходов`);
console.log(`  ${nameA}: побед ${sides[0].wins}  |  ${nameB}: побед ${sides[1].wins}  |  ничьих ${draws}  |  не закончено ${unfinished} (${pct(unfinished / N)})`);
console.log(`  очки ${nameA}: ${pct(score)} ± ${pct(1.96 * se)}`);
console.log(`  длина партии, ходов: медиана ${quant(lengths, 0.5)}, 90% ${quant(lengths, 0.9)}`);
for (const sd of sides) {
  const avg = sd.times.reduce((x, y) => x + y, 0) / Math.max(1, sd.times.length);
  console.log(`  ${sd.name}: время на действие, мс — среднее ${avg.toFixed(2)}, 95% ${quant(sd.times, 0.95).toFixed(2)}, макс ${quant(sd.times, 1).toFixed(1)}`);
}
