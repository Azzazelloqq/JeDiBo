// Подстройка весов оценки методом SPSA: на каждом шаге веса сдвигаются случайно в обе стороны (θ+ и θ−),
// две версии играют между собой, и веса смещаются в сторону победившей.
// npm run tune -- [шагов] [партий на шаг] [файл журнала]
// Партии на шаге — парами с одинаковым seed и сменой мест, чтобы расстановка и карты не давали перекоса.
import { appendFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { DEFAULT_CONFIG, createAgent, type AgentConfig } from '../src/ai/agent';
import { DEFAULT_WEIGHTS, type Weights } from '../src/ai/eval';
import { createGame, dispatch } from '../src/core/engine';
import { CLASSIC } from '../src/core/modes';
import type { PlayerId } from '../src/core/types';

/** Подстраиваемые параметры: имя, начальное значение, шаг возмущения, допустимый диапазон. */
const PARAMS = [
  { name: 'val1', init: DEFAULT_WEIGHTS.val[1], c: 0.3, min: 1.5, max: 6 },
  { name: 'val2', init: DEFAULT_WEIGHTS.val[2], c: 0.5, min: 2.5, max: 10 },
  { name: 'advance', init: DEFAULT_WEIGHTS.advance, c: 0.15, min: 0, max: 2 },
  { name: 'threat', init: DEFAULT_WEIGHTS.threat, c: 0.12, min: 0.2, max: 1.5 },
  { name: 'myThreat', init: DEFAULT_WEIGHTS.myThreat, c: 0.08, min: 0, max: 1 },
  { name: 'chase', init: DEFAULT_WEIGHTS.chase, c: 0.02, min: 0, max: 0.3 },
  { name: 'lookahead', init: DEFAULT_CONFIG.turn.lookahead, c: 0.15, min: 0, max: 1.5 },
] as const;

type Theta = number[];

export function configOf(t: Theta, base: AgentConfig = DEFAULT_CONFIG): AgentConfig {
  const weights: Weights = { ...DEFAULT_WEIGHTS, val: [1, t[0], t[1]], advance: t[2], threat: t[3], myThreat: t[4], chase: t[5] };
  const la = t[6];
  return {
    ...base,
    weights,
    turn: { ...base.turn, lookahead: la },
    search: { ...base.search, reply: base.search.reply ? { ...base.search.reply, lookahead: la } : null },
  };
}

/** Конфигурация для подстройки: как Мастер, но дешевле. */
const TUNE_BASE: AgentConfig = { ...DEFAULT_CONFIG, search: { candidates: 4, reply: { width: 2, lookahead: 0.6 } } };

interface Job { a: Theta; b: Theta; seeds: number[]; limit: number }

/** Очки версии a (победа 1, ничья и незаконченная 0.5). Каждый seed играется дважды со сменой мест. */
function play(job: Job): number {
  let score = 0;
  for (const seed of job.seeds)
    for (const aSeat of [0, 1] as PlayerId[]) {
      const bots = aSeat === 0 ? [createAgent(configOf(job.a, TUNE_BASE), seed), createAgent(configOf(job.b, TUNE_BASE), seed + 1)] : [createAgent(configOf(job.b, TUNE_BASE), seed + 1), createAgent(configOf(job.a, TUNE_BASE), seed)];
      const s = createGame(CLASSIC, seed, ['A', 'B']);
      let steps = 0;
      while (s.phase !== 'over' && s.turn <= job.limit && steps++ < job.limit * 40) {
        const who: PlayerId = s.pending ? s.pending.chooser : s.phase === 'placement' ? (s.players[0].placed ? 1 : 0) : s.current;
        const a = bots[who](s, who);
        if (!a) break;
        dispatch(s, a);
      }
      if (s.phase !== 'over' || s.winner === 'draw') score += 0.5;
      else if (s.winner === aSeat) score += 1;
    }
  return score;
}

if (!isMainThread) {
  parentPort!.postMessage(play(workerData as Job));
} else {
  const [stepsArg = '150', gamesArg = '88', logArg = 'tune-log.tsv'] = process.argv.slice(2);
  const STEPS = Number(stepsArg);
  const PAIRS = Math.max(1, Math.round(Number(gamesArg) / 2));
  const jobs = Math.max(1, availableParallelism() - 2);
  const R = 2.0; // скорость: сдвиг на шаге ≈ R · c · (разница очков)
  let theta: Theta = PARAMS.map((p) => p.init);
  writeFileSync(logArg, ['step', 'score+', ...PARAMS.map((p) => p.name)].join('\t') + '\n');

  const runPair = (a: Theta, b: Theta, seeds: number[]) => {
    const parts: number[][] = Array.from({ length: Math.min(jobs, seeds.length) }, () => []);
    seeds.forEach((sd, i) => parts[i % parts.length].push(sd));
    return Promise.all(
      parts.map(
        (part) =>
          new Promise<number>((resolve, reject) => {
            const w = new Worker(new URL(import.meta.url), { workerData: { a, b, seeds: part, limit: 600 } satisfies Job });
            w.once('message', resolve);
            w.once('error', reject);
          }),
      ),
    ).then((xs) => xs.reduce((x, y) => x + y, 0) / (seeds.length * 2));
  };

  for (let k = 1; k <= STEPS; k++) {
    // шаг убывает медленно, чтобы к концу веса успокоились
    const ak = R / Math.pow(1 + k / 50, 0.6);
    const delta = PARAMS.map(() => (Math.random() < 0.5 ? -1 : 1));
    const plus = theta.map((v, i) => v + PARAMS[i].c * delta[i]);
    const minus = theta.map((v, i) => v - PARAMS[i].c * delta[i]);
    const seeds = Array.from({ length: PAIRS }, (_, i) => (k * 100003 + i * 7919) | 0);
    const sPlus = await runPair(plus, minus, seeds);
    const diff = sPlus - (1 - sPlus);
    theta = theta.map((v, i) => Math.min(PARAMS[i].max, Math.max(PARAMS[i].min, v + ak * PARAMS[i].c * delta[i] * diff)));
    appendFileSync(logArg, [k, sPlus.toFixed(3), ...theta.map((v) => v.toFixed(3))].join('\t') + '\n');
    console.log(`шаг ${k}: θ+ ${(sPlus * 100).toFixed(1)}%  ${PARAMS.map((p, i) => `${p.name}=${theta[i].toFixed(3)}`).join(' ')}`);
  }
}
