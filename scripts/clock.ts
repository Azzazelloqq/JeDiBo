// Хватает ли боту общего времени партии. npm run clock -- <уровень> [замедление] [партий] [соперник] [лимит ходов]
// Часы клиента идут у того, чей ход, и не идут во время анимаций; бот на каждое действие тратит
// max(расчёт, пауза botDelay) — так устроен Match.driveBots. Соперник ходит мгновенно (худший случай для бота).
// Замедление k имитирует слабое устройство: бюджет бота делится на k, измеренное время расчёта умножается на k.
// Соперник: staller — осторожный, не продвигается и не сближается (тянет партию); или любой уровень.
import { availableParallelism } from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { DEFAULT_CONFIG, createAgent, type AgentConfig } from '../src/ai/agent';
import { DEFAULT_WEIGHTS } from '../src/ai/eval';
import { levelById } from '../src/ai/levels';
import { createGame, dispatch } from '../src/core/engine';
import { CLASSIC } from '../src/core/modes';
import type { PlayerId } from '../src/core/types';

const BOT_DELAY = 420;

const STALLER: AgentConfig = {
  ...DEFAULT_CONFIG,
  weights: { ...DEFAULT_WEIGHTS, threat: 1.5, myThreat: 0, advance: 0, chase: 0 },
};

interface Job { level: string; k: number; opp: string; limit: number; games: number[] }
interface Res { flagged: number; finished: number; lengths: number[]; left: number[]; perTurn: number[]; thinkPerTurn: number[] }

function run(job: Job): Res {
  const res: Res = { flagged: 0, finished: 0, lengths: [], left: [], perTurn: [], thinkPerTurn: [] };
  const lvl = levelById(job.level);
  for (const g of job.games) {
    const botSeat = (g % 2) as PlayerId;
    const cfg: AgentConfig = { ...lvl.config, budgetMs: lvl.config.budgetMs! / job.k };
    const bot = createAgent(cfg, g * 2 + 1);
    const opp = createAgent(job.opp === 'staller' ? STALLER : { ...levelById(job.opp).config, budgetMs: undefined }, g * 2 + 2);
    const s = createGame(CLASSIC, (g * 2654435761 + 99) | 0, ['A', 'B']);
    let clock = CLASSIC.totalMs;
    let turnSpent = 0;
    let turnThink = 0;
    let lastTurn = -1;
    let flagged = false;
    while (s.phase !== 'over' && s.turn <= job.limit) {
      const who: PlayerId = s.pending ? s.pending.chooser : s.phase === 'placement' ? (s.players[0].placed ? 1 : 0) : s.current;
      if (who !== botSeat) {
        const oa = opp(s, who);
        if (!oa) break; // вопрос движка без вариантов — партия зависла
        dispatch(s, oa);
        continue;
      }
      const t0 = performance.now();
      // остаток часов передаётся «в масштабе устройства»: бот делит его так же, как в игре
      const a = bot(s, who, { clockMs: clock / job.k });
      const think = (performance.now() - t0) * job.k;
      if (s.phase === 'play') {
        // часы идут у s.current: если бот отвечает на вопрос в чужой ход, тратится время соперника
        const delay = (clock < 60_000 ? BOT_DELAY * 0.25 : BOT_DELAY) * (0.7 + Math.random() * 0.6);
        const spent = s.current === botSeat ? Math.max(think, delay) : 0;
        clock -= spent;
        if (s.turn !== lastTurn) {
          if (lastTurn >= 0) {
            res.perTurn.push(turnSpent);
            res.thinkPerTurn.push(turnThink);
          }
          turnSpent = 0;
          turnThink = 0;
          lastTurn = s.turn;
        }
        turnSpent += spent;
        turnThink += think;
        if (clock <= 0) {
          flagged = true;
          break;
        }
      }
      if (!a) break;
      dispatch(s, a);
    }
    res.lengths.push(s.turn);
    res.left.push(clock);
    if (flagged) res.flagged++;
    else if (s.phase === 'over') res.finished++;
  }
  return res;
}

if (!isMainThread) parentPort!.postMessage(run(workerData as Job));
else {
  const [level = 'master', kArg = '1', nArg = '100', opp = 'staller', limitArg = '3000'] = process.argv.slice(2);
  const N = Number(nArg);
  const jobs = Math.max(1, Math.min(N, availableParallelism() - 2));
  const parts: number[][] = Array.from({ length: jobs }, () => []);
  for (let g = 0; g < N; g++) parts[g % jobs].push(g);
  const rs = await Promise.all(
    parts.map(
      (games) =>
        new Promise<Res>((ok, fail) => {
          const w = new Worker(new URL(import.meta.url), { workerData: { level, k: Number(kArg), opp, limit: Number(limitArg), games } satisfies Job });
          w.once('message', ok);
          w.once('error', fail);
        }),
    ),
  );
  const t: Res = { flagged: 0, finished: 0, lengths: [], left: [], perTurn: [], thinkPerTurn: [] };
  for (const r of rs) {
    t.flagged += r.flagged;
    t.finished += r.finished;
    t.lengths.push(...r.lengths);
    t.left.push(...r.left);
    t.perTurn.push(...r.perTurn);
    t.thinkPerTurn.push(...r.thinkPerTurn);
  }
  const q = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))] ?? 0;
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const sec = (ms: number) => `${(ms / 1000).toFixed(1)} с`;
  console.log(`${level} (замедление ×${kArg}) против ${opp}, партий ${N}, лимит ${limitArg} ходов`);
  console.log(`  закончены ${t.finished}, бот просрочил время ${t.flagged}, не закончены ${N - t.finished - t.flagged}`);
  console.log(`  длина партии, ходов (оба игрока): медиана ${q(t.lengths, 0.5)}, 90% ${q(t.lengths, 0.9)}, макс ${q(t.lengths, 1)}`);
  console.log(`  часы бота на ход: среднее ${sec(avg(t.perTurn))}, 95% ${sec(q(t.perTurn, 0.95))}, макс ${sec(q(t.perTurn, 1))}`);
  console.log(`  из них расчёт: среднее ${sec(avg(t.thinkPerTurn))}, 95% ${sec(q(t.thinkPerTurn, 0.95))}, макс ${sec(q(t.thinkPerTurn, 1))}`);
  console.log(`  осталось на часах в конце: минимум ${sec(q(t.left, 0))}, 10% ${sec(q(t.left, 0.1))}, медиана ${sec(q(t.left, 0.5))}`);
  console.log(`  часов (60 мин) хватит примерно на ${Math.round(CLASSIC.totalMs / Math.max(1, avg(t.perTurn)))} ходов бота при таком темпе`);
}
