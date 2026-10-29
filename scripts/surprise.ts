// «Неожиданности» расчёта: насколько то, что бот предсказал на 3 полухода вперёд, расходится с тем, что случилось.
// npm run surprise -- <соперник> [партий] [уровень бота]
// На каждом своём ходу бот (уровень, без бюджета времени — детерминирован) считает план; здесь тем же поиском
// восстанавливается предсказанная линия: мой ход, ответ соперника, мой следующий ход. Материал (1/3/5) после каждого
// полухода сравнивается с тем, что вышло в партии, и с материалом ещё через полуход (реализация угрозы на листе).
// Ошибка < 0 — бот был оптимистом. Крупные ошибки раскладываются по причине:
//   «ответ» — соперник сразу сыграл лучше, чем ответ в модели (на 2-м полуходе уже хуже предсказанного);
//   «горизонт» — ответ не хуже предсказанного, а потеря пришла позже.
import { createAgent } from '../src/ai/agent';
import { FastBoard, newUndo, passTurn, restoreTurn } from '../src/ai/board';
import { WIN, bestCapture } from '../src/ai/eval';
import { levelById } from '../src/ai/levels';
import { planTurn, type Step } from '../src/ai/turn';
import { opponentByName } from './lib/opponents';
import { createGame, dispatch } from '../src/core/engine';
import { CLASSIC } from '../src/core/modes';
import type { GameState, PlayerId } from '../src/core/types';

const VAL = [1, 3, 5];
const [oppName = 'turtle', nArg = '40', level = 'master', offArg = '0'] = process.argv.slice(2);
const OFF = Number(offArg);
const base = levelById(level).config;
const cfg = { ...base, budgetMs: undefined, weights: { ...base.weights, reach: !!process.env.REACH }, search: process.env.PE ? { ...base.search, personas: [{ weights: { advance: 0, threat: 1.5, myThreat: 0 }, top: 4 }, { weights: { threat: 0.5, myThreat: 0.6 }, top: 4 }] } : base.search };
const plainCfg = { ...base, budgetMs: undefined };
const w = cfg.weights;

const mat = (s: GameState, me: PlayerId) => s.pieces.reduce((a, p) => a + (p.owner === me ? 1 : -1) * VAL[p.rank], 0);
const matB = (b: FastBoard, me: PlayerId) => {
  let m = 0;
  for (let i = 0; i < b.count; i++) if (b.alive[i]) m += (b.owner[i] === me ? 1 : -1) * VAL[b.rank[i]];
  return m;
};

interface Pred {
  turn: number;
  /** предсказанный материал после 1, 2, 3 полуходов и оценка листа */
  m: [number, number, number];
  leaf: number;
  /** предсказанное взятие соперника в ответ (ценность, 0 — без взятия) */
  replyCap: number;
  /** угроза соперника на листе (SEE), которую оценка уже вычла */
  threat: number;
  /** материал до хода */
  m0: number;
  /** вне модели: Карма или повышение за эти полуходы */
  dirty: boolean;
  ascii: string;
}

/** Повтор searchTurn с записью линии лучшего плана. */
function predict(b: FastBoard, me: PlayerId): { steps: Step[]; m: [number, number, number]; leaf: number; replyCap: number; threat: number } {
  const so = cfg.search;
  const first = planTurn(b, me, w, { ...cfg.turn, top: so.reply ? so.candidates : 1 });
  const opp = (1 - me) as PlayerId;
  const mine = Array.from({ length: 10 }, newUndo);
  const theirs = Array.from({ length: 10 }, newUndo);
  const fol = Array.from({ length: 10 }, newUndo);
  let best: ReturnType<typeof predict> | null = null;
  let bestSc = -Infinity;
  const alts = [...first.alts];
  const keyOf = (st: Step[]) => st.map((x) => `${x.pi}:${x.t}`).sort().join(' ');
  const have = new Set(alts.map((a) => keyOf(a.steps)));
  for (const p of so.personas ?? [])
    for (const a of planTurn(b, me, { ...w, ...p.weights }, { ...cfg.turn, top: p.top }).alts)
      if (!have.has(keyOf(a.steps))) {
        have.add(keyOf(a.steps));
        alts.push(a);
      }
  for (const alt of alts) {
    alt.steps.forEach((st, k) => b.make(st.pi, st.t, mine[k]));
    const m1 = matB(b, me);
    let sc: number;
    let m2 = m1;
    let m3 = m1;
    let replyCap = 0;
    let threat = 0;
    if (alt.score >= WIN) sc = WIN;
    else {
      const save = passTurn(b);
      const r = planTurn(b, opp, w, so.reply!);
      r.steps.forEach((st, k) => b.make(st.pi, st.t, theirs[k]));
      m2 = matB(b, me);
      replyCap = m1 - m2;
      const save2 = passTurn(b);
      const f = planTurn(b, me, w, so.followup!);
      f.steps.forEach((st, k) => b.make(st.pi, st.t, fol[k]));
      m3 = matB(b, me);
      threat = bestCapture(b, opp, w);
      for (let k = f.steps.length - 1; k >= 0; k--) b.unmake(fol[k]);
      sc = f.score;
      restoreTurn(b, save2);
      for (let k = r.steps.length - 1; k >= 0; k--) b.unmake(theirs[k]);
      restoreTurn(b, save);
    }
    for (let k = alt.steps.length - 1; k >= 0; k--) b.unmake(mine[k]);
    // как в searchTurn: сортировка устойчивая, при равенстве — раньше в списке
    if (sc > bestSc) {
      bestSc = sc;
      best = { steps: alt.steps, m: [m1, m2, m3], leaf: sc, replyCap, threat };
    }
  }
  if (!best) return { steps: first.steps, m: [0, 0, 0], leaf: first.score, replyCap: 0, threat: 0 };
  return best;
}

function ascii(s: GameState, me: PlayerId): string {
  const n = s.mode.size;
  const rows: string[] = [];
  for (let y = 0; y < n; y++) {
    let r = '';
    for (let x = 0; x < n; x++) {
      const p = s.pieces.find((q) => q.x === x && q.y === y);
      r += p ? ('tsc'[p.rank])[p.owner === me ? 'toUpperCase' : 'toLowerCase']() : '.';
    }
    rows.push(r);
  }
  return rows.join('\n');
}

const N = Number(nArg);
const errs: number[][] = [[], [], [], []];
let big = 0;
let bigReply = 0;
let bigHorizon = 0;
let total = 0;
const lostWhere = { own: [0, 0, 0], far: [0, 0, 0] };
const examples: string[] = [];
let wins = 0;
let losses = 0;

for (let g = OFF; g < OFF + N; g++) {
  const me: PlayerId = (g % 2) as PlayerId;
  const bot = createAgent(cfg, g * 2 + 1);
  const op = oppName === 'master' ? createAgent(plainCfg, g * 2 + 2) : opponentByName(oppName, g * 2 + 2)!;
  const s = createGame(CLASSIC, (g * 2654435761 + 17) | 0, ['A', 'B']);
  if (process.env.NOKARMA) s.deck = [];
  const preds: Pred[] = [];
  const snap = new Map<number, number>();
  const dirtyTurns = new Set<number>();
  const fb = new FastBoard(12);
  let steps = 0;
  while (s.phase !== 'over' && s.turn <= 400 && steps++ < 40000) {
    if (!s.pending && !snap.has(s.turn) && s.phase === 'play') snap.set(s.turn, mat(s, me));
    const who: PlayerId = s.pending ? s.pending.chooser : s.phase === 'placement' ? (s.players[0].placed ? 1 : 0) : s.current;
    if (who === me && s.phase === 'play' && !s.pending && s.current === me && !s.actedThisTurn && !s.players[me].held) {
      fb.load(s);
      const p = predict(fb, me);
      preds.push({ turn: s.turn, m: p.m, leaf: p.leaf, replyCap: p.replyCap, threat: p.threat, m0: mat(s, me), dirty: false, ascii: ascii(s, me) });
    }
    const a = who === me ? bot(s, who) : op(s, who);
    if (!a) break;
    const t0 = s.turn;
    const r = dispatch(s, a);
    if (!r.ok) throw new Error(r.error);
    if (r.events.some((e) => e.type === 'cardDrawn' || e.type === 'spawn' || e.type === 'rankChange' || e.type === 'promoteRemove')) dirtyTurns.add(t0);
    if (s.turn !== t0) for (const e of r.events) if (e.type === 'cardDrawn') dirtyTurns.add(s.turn);
    // какие фигуры бота взяты и где
    for (const e of r.events) {
      if (e.type !== 'capture' || e.victim.owner !== me) continue;
      const side = s.players[me].side;
      const fromHome = side === 0 ? s.mode.size - 1 - e.victim.y : e.victim.y;
      (fromHome >= s.mode.size / 2 ? lostWhere.far : lostWhere.own)[e.victim.rank]++;
    }
  }
  if (s.phase === 'over') {
    if (s.winner === me) wins++;
    else if (s.winner !== 'draw') losses++;
  }
  for (const p of preds) {
    const real = [1, 2, 3, 4].map((k) => snap.get(p.turn + k));
    if (real.some((x) => x === undefined)) continue;
    if ([0, 1, 2, 3].some((k) => dirtyTurns.has(p.turn + k))) continue;
    total++;
    for (let k = 0; k < 3; k++) errs[k].push(real[k]! - p.m[k]);
    // реализация угрозы на листе: материал ещё через полуход против предсказанного после 3-го минус угроза листа
    errs[3].push(real[3]! - (p.m[2] - p.threat));
    const e3 = real[3]! - (p.m[2] - p.threat);
    if (Math.min(e3, real[2]! - p.m[2]) <= -2) {
      big++;
      const replyWorse = real[1]! - p.m[1] <= -1;
      if (replyWorse) bigReply++;
      else bigHorizon++;
      if (examples.length < 12 && (process.env.SHOW ?? '') !== '')
        examples.push(`партия ${g}, ход ${p.turn} (${replyWorse ? 'ответ' : 'горизонт'}): предсказано ${p.m.join('/')}, вышло ${real.join('/')} (было ${p.m0})\n${p.ascii}`);
    }
  }
}

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const share = (a: number[], f: (x: number) => boolean) => a.filter(f).length / Math.max(1, a.length);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
console.log(`${level} против ${oppName}: партий ${N}, побед ${wins}, поражений ${losses}; ходов с проверкой ${total}`);
['после моего хода', 'после ответа', 'после моего следующего', 'ещё через полуход'].forEach((name, k) =>
  console.log(`  ${name}: ошибка материала средняя ${mean(errs[Math.min(k, 3)]).toFixed(3)}, ≤−2: ${pct(share(errs[Math.min(k, 3)], (x) => x <= -2))}, ≥+2: ${pct(share(errs[Math.min(k, 3)], (x) => x >= 2))}`),
);
console.log(`  крупные потери против предсказания (≤−2 к 3–4-му полуходу): ${big} (${pct(big / Math.max(1, total))}), из них «ответ» ${bigReply}, «горизонт» ${bigHorizon}`);
console.log(`  фигуры бота взяты на своей половине т/к/к: ${lostWhere.own.join('/')}, на чужой: ${lostWhere.far.join('/')}`);
for (const e of examples) console.log('\n' + e);
