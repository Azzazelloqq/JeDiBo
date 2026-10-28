// Арена: бот против бота. npm run arena -- <A> <B> [партий] [лимит ходов] [потоков]
// Боты меняются местами через партию. Незаконченные к лимиту партии считаются отдельно (и как ничьи в очках).
// Партии раскладываются по потокам (worker_threads); у партии фиксированный seed, так что результат не зависит
// от числа потоков (кроме случайности самих ботов).
import { availableParallelism } from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { DEFAULT_CONFIG, createAgent } from '../src/ai/agent';
import { LEVELS } from '../src/ai/levels';
import { botAction } from './greedy';
import { createGame, dispatch } from '../src/core/engine';
import { CLASSIC } from '../src/core/modes';
import type { Action, GameState, PlayerId } from '../src/core/types';

type BotFn = (s: GameState, me: PlayerId) => Action | null;

// фабрики получают seed: случайность бота воспроизводима (партия + место)
const BOTS: Record<string, (seed: number) => BotFn> = {
  greedy: () => botAction,
  planner: (seed) => createAgent(DEFAULT_CONFIG, seed),
  planner1: (seed) => createAgent({ ...DEFAULT_CONFIG, search: { candidates: 1, reply: null } }, seed),
};
// уровни сложности: novice, amateur, … — расчёт ограничен шириной поиска; с суффиксом @time — ещё и бюджетом времени
for (const l of LEVELS) {
  BOTS[l.id] = (seed) => createAgent({ ...l.config, budgetMs: undefined }, seed);
  BOTS[`${l.id}@time`] = (seed) => createAgent(l.config, seed);
  BOTS[`${l.id}@randcards`] = (seed) => createAgent({ ...l.config, budgetMs: undefined, randomChoices: true }, seed);
}

// planner:w=8,c=12,r=4,f=2,la=1 — планировщик с параметрами (w — луч, c — кандидатов, r — луч ответа, 0 — без ответа,
// f — луч своего следующего хода после ответа, 0 — без него)
function botFactory(name: string): ((seed: number) => BotFn) | undefined {
  if (BOTS[name]) return BOTS[name];
  if (!name.startsWith('planner:')) return undefined;
  const o = Object.fromEntries(name.slice(8).split(',').map((kv) => kv.split('=')));
  const turn = { width: Number(o.w ?? DEFAULT_CONFIG.turn.width), lookahead: Number(o.la ?? DEFAULT_CONFIG.turn.lookahead) };
  const r = Number(o.r ?? DEFAULT_CONFIG.search.reply?.width ?? 0);
  const f = Number(o.f ?? 0);
  const search = { candidates: Number(o.c ?? DEFAULT_CONFIG.search.candidates), reply: r > 0 ? { width: r, lookahead: turn.lookahead } : null, followup: f > 0 ? { width: f, lookahead: turn.lookahead } : undefined };
  // веса оценки: v1, v2 — ценность квадрата и круга, adv, th, my, ch — advance, threat, myThreat, chase
  const dw = DEFAULT_CONFIG.weights;
  const weights = {
    ...dw,
    val: [1, Number(o.v1 ?? dw.val[1]), Number(o.v2 ?? dw.val[2])] as [number, number, number],
    advance: Number(o.adv ?? dw.advance),
    threat: Number(o.th ?? dw.threat),
    myThreat: Number(o.my ?? dw.myThreat),
    chase: Number(o.ch ?? dw.chase),
  };
  return (seed) => createAgent({ ...DEFAULT_CONFIG, weights, turn, search }, seed);
}

interface Job { nameA: string; nameB: string; games: number[]; limit: number }
interface Res { wins: [number, number]; draws: number; unfinished: number; stuck: number; lengths: number[]; times: [number[], number[]] }

function runGames(job: Job): Res {
  const res: Res = { wins: [0, 0], draws: 0, unfinished: 0, stuck: 0, lengths: [], times: [[], []] };
  for (const g of job.games) {
    // бот A сидит на месте 0 в чётных партиях, на месте 1 — в нечётных
    const seatOf: [number, number] = g % 2 === 0 ? [0, 1] : [1, 0];
    const fns = [botFactory(job.nameA)!(g * 2 + 1), botFactory(job.nameB)!(g * 2 + 2)];
    const s = createGame(CLASSIC, (g * 2654435761 + 17) | 0, ['A', 'B']);
    // NOKARMA=1 — партия без карт Кармы: сколько результата решает удача с картами
    if (process.env.NOKARMA) s.deck = [];
    let steps = 0;
    while (s.phase !== 'over' && s.turn <= job.limit && steps++ < job.limit * 40) {
      const who: PlayerId = s.pending ? s.pending.chooser : s.phase === 'placement' ? (s.players[0].placed ? 1 : 0) : s.current;
      const bot = seatOf[who];
      const t0 = performance.now();
      let a: Action | null;
      try {
        a = fns[bot](s, who);
      } catch (e) {
        throw new Error(`партия ${g}: бот ${bot === 0 ? job.nameA : job.nameB} упал: ${(e as Error).stack}
pending=${JSON.stringify(s.pending)}`);
      }
      res.times[bot].push(performance.now() - t0);
      const name = bot === 0 ? job.nameA : job.nameB;
      // вопрос без вариантов и без пропуска — партия зависла по вине движка
      if (!a && s.pending && !s.pending.options.length && !s.pending.canSkip) {
        res.stuck++;
        break;
      }
      if (!a) throw new Error(`партия ${g}: бот ${name} не дал действия; pending=${JSON.stringify(s.pending)} current=${s.current}`);
      const r = dispatch(s, a);
      if (!r.ok) throw new Error(`партия ${g}: бот ${name} — ${r.error} ${JSON.stringify(a)}`);
    }
    res.lengths.push(s.turn);
    if (s.phase !== 'over') res.unfinished++;
    else if (s.winner === 'draw') res.draws++;
    else res.wins[seatOf[s.winner!]]++;
  }
  return res;
}

if (!isMainThread) {
  parentPort!.postMessage(runGames(workerData as Job));
} else {
  const [nameA = 'greedy', nameB = 'greedy', nArg = '200', limitArg = '1000', jobsArg] = process.argv.slice(2);
  for (const n of [nameA, nameB]) if (!botFactory(n)) throw new Error(`Нет бота «${n}». Есть: ${Object.keys(BOTS).join(', ')}`);
  const N = Number(nArg);
  const limit = Number(limitArg);
  const jobs = Math.max(1, Math.min(N, Number(jobsArg ?? Math.max(1, availableParallelism() - 2))));
  const parts: number[][] = Array.from({ length: jobs }, () => []);
  for (let g = 0; g < N; g++) parts[g % jobs].push(g);

  const results = await Promise.all(
    parts.map(
      (games) =>
        new Promise<Res>((resolve, reject) => {
          const w = new Worker(new URL(import.meta.url), { workerData: { nameA, nameB, games, limit } satisfies Job });
          w.once('message', resolve);
          w.once('error', reject);
        }),
    ),
  );
  const t: Res = { wins: [0, 0], draws: 0, unfinished: 0, stuck: 0, lengths: [], times: [[], []] };
  for (const r of results) {
    t.wins[0] += r.wins[0];
    t.wins[1] += r.wins[1];
    t.draws += r.draws;
    t.unfinished += r.unfinished;
    t.stuck += r.stuck;
    t.lengths.push(...r.lengths);
    t.times[0].push(...r.times[0]);
    t.times[1].push(...r.times[1]);
  }

  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const quant = (a: number[], q: number) => {
    const b = [...a].sort((x, y) => x - y);
    return b[Math.min(b.length - 1, Math.floor(q * b.length))] ?? 0;
  };
  // очки A: победа 1, ничья и незаконченная 0.5; 95% интервал по нормальному приближению
  const score = (t.wins[0] + 0.5 * (t.draws + t.unfinished)) / N;
  const se = Math.sqrt((score * (1 - score)) / N);
  console.log(`${nameA} против ${nameB}, партий ${N}, лимит ${limit} ходов, потоков ${jobs}`);
  console.log(`  ${nameA}: побед ${t.wins[0]}  |  ${nameB}: побед ${t.wins[1]}  |  ничьих ${t.draws}  |  не закончено ${t.unfinished} (${pct(t.unfinished / N)})${t.stuck ? `, из них зависли на вопросе движка ${t.stuck}` : ''}`);
  console.log(`  очки ${nameA}: ${pct(score)} ± ${pct(1.96 * se)}`);
  console.log(`  длина партии, ходов: медиана ${quant(t.lengths, 0.5)}, 90% ${quant(t.lengths, 0.9)}`);
  [nameA, nameB].forEach((name, i) => {
    const ts = t.times[i];
    const avg = ts.reduce((x, y) => x + y, 0) / Math.max(1, ts.length);
    console.log(`  ${name}: время на действие, мс — среднее ${avg.toFixed(2)}, 95% ${quant(ts, 0.95).toFixed(2)}, макс ${quant(ts, 1).toFixed(1)}`);
  });
}
