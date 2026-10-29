// Калибровка оценки по партиям: насколько члены оценки предсказывают будущий материал.
// npm run calib -- [партий на пару] [пары A:B через запятую] [потоков]
// В начале каждого хода (без вопроса движка) с точки зрения ходящего считаются: материал, продвижение
// (прирост от повышения × прогресс², без веса), его лучшее взятие и лучшее взятие соперника (SEE, как в оценке).
// Цель — изменение материала ходящего (1/3/5, повышения включены) через k полуходов. Линейная регрессия
// показывает, какую долю каждого члена партия «реализует»: это и есть честный вес члена в оценке,
// если бы оценка предсказывала будущее, — без самоигры и подбора по победам.
import { availableParallelism } from 'node:os';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { createAgent } from '../src/ai/agent';
import { FastBoard } from '../src/ai/board';
import { DEFAULT_WEIGHTS, bestCapture } from '../src/ai/eval';
import { levelById } from '../src/ai/levels';
import { opponentByName } from './lib/opponents';
import { createGame, dispatch } from '../src/core/engine';
import { CLASSIC } from '../src/core/modes';
import { Rank, type GameState, type PlayerId } from '../src/core/types';

const VAL = [1, 3, 5];
const KS = [1, 2, 4, 8];

interface Row {
  f: number[];
  /** изменение материала через k полуходов */
  y: number[];
  /** победа ходящего (1), поражение (0), иначе 0.5 */
  res: number;
}

function botByName(name: string, seed: number) {
  if (name === 'master' || name === 'amateur' || name === 'novice') return createAgent({ ...levelById(name).config, budgetMs: undefined }, seed);
  return opponentByName(name, seed)!;
}

function features(s: GameState, b: FastBoard, me: PlayerId): number[] {
  b.load(s);
  const opp = (1 - me) as PlayerId;
  let mat = 0;
  let adv = 0;
  let deep = 0;
  for (let i = 0; i < b.count; i++) {
    if (!b.alive[i]) continue;
    const p = b.owner[i];
    const sg = p === me ? 1 : -1;
    mat += sg * VAL[b.rank[i]];
    if (b.rank[i] !== Rank.Circle) {
      const d = b.fwd[p] < 0 ? b.py[i] : b.n - 1 - b.py[i];
      const pr = 1 - d / (b.n - 1);
      adv += sg * (VAL[b.rank[i] + 1] - VAL[b.rank[i]]) * pr * pr;
      // фигура в чужой половине, которая не может отступить: квадрат или треугольник
      if (pr > 0.5) deep += sg * VAL[b.rank[i]];
    }
  }
  const w = DEFAULT_WEIGHTS;
  return [1, adv, bestCapture(b, me, w), bestCapture(b, opp, w), deep, mat];
}

function runGames(job: { pairs: string[]; games: number[] }): Row[] {
  const rows: Row[] = [];
  const b = new FastBoard(12);
  for (const pair of job.pairs) {
    const [na, nb] = pair.split(':');
    for (const g of job.games) {
      const seatA: PlayerId = (g % 2) as PlayerId;
      const bots = [botByName(na, g * 2 + 1), botByName(nb, g * 2 + 2)];
      const fnOf = (p: PlayerId) => (p === seatA ? bots[0] : bots[1]);
      const s = createGame(CLASSIC, (g * 2654435761 + 17) | 0, ['A', 'B']);
      if (process.env.NOKARMA) s.deck = [];
      const snaps: { turn: number; me: PlayerId; f: number[]; m: number }[] = [];
      const matAt = new Map<number, number>();
      let steps = 0;
      while (s.phase !== 'over' && s.turn <= 300 && steps++ < 12000) {
        if (s.phase === 'play' && !s.pending && !matAt.has(s.turn)) {
          const m0 = s.pieces.reduce((a, p) => a + (p.owner === 0 ? 1 : -1) * VAL[p.rank], 0);
          matAt.set(s.turn, m0);
          if (!s.actedThisTurn) snaps.push({ turn: s.turn, me: s.current, f: features(s, b, s.current), m: m0 });
        }
        const who: PlayerId = s.pending ? s.pending.chooser : s.phase === 'placement' ? (s.players[0].placed ? 1 : 0) : s.current;
        const a = fnOf(who)(s, who);
        if (!a) break;
        if (!dispatch(s, a).ok) throw new Error('недопустимое действие');
      }
      const endM = s.pieces.reduce((a, p) => a + (p.owner === 0 ? 1 : -1) * VAL[p.rank], 0);
      const last = s.turn;
      for (const sn of snaps) {
        const sg = sn.me === 0 ? 1 : -1;
        const y = KS.map((k) => {
          const m = sn.turn + k > last && s.phase === 'over' ? endM : matAt.get(sn.turn + k);
          return m === undefined ? NaN : sg * (m - sn.m);
        });
        if (y.some(Number.isNaN)) continue;
        const res = s.phase === 'over' && s.winner !== 'draw' ? (s.winner === sn.me ? 1 : 0) : 0.5;
        rows.push({ f: sn.f, y, res });
      }
    }
  }
  return rows;
}

/** Наименьшие квадраты: решение нормальных уравнений методом Гаусса. */
function ols(X: number[][], y: number[]): number[] {
  const n = X[0].length;
  const A = Array.from({ length: n }, () => new Array(n + 1).fill(0));
  for (let r = 0; r < X.length; r++)
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) A[i][j] += X[r][i] * X[r][j];
      A[i][n] += X[r][i] * y[r];
    }
  for (let i = 0; i < n; i++) {
    let p = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]];
    for (let r = 0; r < n; r++) {
      if (r === i || A[i][i] === 0) continue;
      const k = A[r][i] / A[i][i];
      for (let j = i; j <= n; j++) A[r][j] -= k * A[i][j];
    }
  }
  return A.map((row, i) => row[n] / row[i]);
}

if (!isMainThread) {
  parentPort!.postMessage(runGames(workerData));
} else {
  const [nArg = '24', pairsArg = 'master:master,master:oldmaster,master:turtle,master:trader,master:hunter,master:rusher', jobsArg] = process.argv.slice(2);
  const N = Number(nArg);
  const pairs = pairsArg.split(',');
  const jobs = Math.max(1, Math.min(N, Number(jobsArg ?? Math.max(1, availableParallelism() - 2))));
  const parts: number[][] = Array.from({ length: jobs }, () => []);
  for (let g = 0; g < N; g++) parts[g % jobs].push(g);
  const all: Row[] = (
    await Promise.all(
      parts.map(
        (games) =>
          new Promise<Row[]>((resolve, reject) => {
            const w = new Worker(new URL(import.meta.url), { workerData: { pairs, games } });
            w.once('message', resolve);
            w.once('error', reject);
          }),
      ),
    )
  ).flat();
  const names = ['своб.', 'продвиж.', 'моё взятие', 'взятие соп.', 'глубоко', 'материал'];
  console.log(`позиций ${all.length} (пары: ${pairs.join(', ')}, по ${N} партий)`);
  const fit = (cols: number[], label: string) => {
    for (let ki = 0; ki < KS.length; ki++) {
      const X = all.map((r) => cols.map((c) => r.f[c]));
      const beta = ols(X, all.map((r) => r.y[ki]));
      console.log(`  ${label}, через ${KS[ki]} полух.: ${cols.map((c, i) => `${names[c]} ${beta[i].toFixed(3)}`).join(', ')}`);
    }
  };
  fit([0, 1, 2, 3], 'Δматериала');
  fit([0, 1, 2, 3, 4], 'Δматериала с «глубоко»');
  // итог партии: какой член сильнее всего связан с победой (линейная вероятностная модель)
  const X = all.map((r) => r.f);
  const beta = ols(X, all.map((r) => r.res));
  console.log(`  победа (лин.): ${names.map((n, i) => `${n} ${beta[i].toFixed(4)}`).join(', ')}`);
  // во сколько материала исход оценивает каждый член: коэффициент, делённый на коэффициент материала
  console.log(`  в единицах материала: ${names.slice(1, 5).map((n, i) => `${n} ${(beta[i + 1] / beta[5]).toFixed(2)}`).join(', ')}`);
}
