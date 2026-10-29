// отладка: линия предсказания Мастера в партии g на ходу T против соперника
import { createAgent } from '../../src/ai/agent';
import { FastBoard, newUndo, passTurn, restoreTurn, CELL_MASK, ATTACK } from '../../src/ai/board';
import { WIN, bestCapture, evaluate } from '../../src/ai/eval';
import { levelById } from '../../src/ai/levels';
import { planTurn, type Step } from '../../src/ai/turn';
import { opponentByName } from '../lib/opponents';
import { createGame, dispatch } from '../../src/core/engine';
import { CLASSIC } from '../../src/core/modes';
import type { GameState, PlayerId } from '../../src/core/types';
const [oppName, gArg, tArg] = process.argv.slice(2);
const g = Number(gArg), T = Number(tArg);
const cfg = { ...levelById('master').config, budgetMs: undefined };
const w = { ...cfg.weights, reach: !!process.env.REACH };
const me = (g % 2) as PlayerId;
const bot = createAgent(cfg, g * 2 + 1);
const op = opponentByName(oppName, g * 2 + 2)!;
const s = createGame(CLASSIC, (g * 2654435761 + 17) | 0, ['A', 'B']);
s.deck = [];
const show = (b: FastBoard, marks: number[] = []) => {
  const rows: string[] = [];
  for (let y = 0; y < b.n; y++) { let r = ''; for (let x = 0; x < b.n; x++) { const i = b.pieceAt(x, y); const c = y * b.n + x; r += i < 0 ? (marks.includes(c) ? '*' : '.') : ('tsc'[b.rank[i]])[b.owner[i] === me ? 'toUpperCase' : 'toLowerCase'](); } rows.push(y.toString().padStart(2) + ' ' + r); }
  return '   ' + '0123456789AB\n' + rows.join('\n');
};
const fmt = (b: FastBoard, st: Step[]) => st.map((x) => `${'tsc'[b.rank[x.pi]]}(${b.px[x.pi]},${b.py[x.pi]})${x.t & ATTACK ? 'x' : '-'}(${(x.t & CELL_MASK) % b.n},${((x.t & CELL_MASK) / b.n) | 0})`).join(' ');
let steps = 0;
while (s.phase !== 'over' && steps++ < 40000) {
  const who: PlayerId = s.pending ? s.pending.chooser : s.phase === 'placement' ? (s.players[0].placed ? 1 : 0) : s.current;
  if (s.turn === T && who === me && !s.pending && !s.actedThisTurn) break;
  const a = who === me ? bot(s, who) : op(s, who);
  dispatch(s, a!);
}
const b = FastBoard.fromState(s);
console.log(`ход ${T}, я = ${me} (заглавные), вперёд у меня dy=${b.fwd[me]}`);
console.log(show(b));
const opp = (1 - me) as PlayerId;
const first = planTurn(b, me, w, { ...cfg.turn, top: cfg.search.candidates });
const u1 = Array.from({ length: 10 }, newUndo), u2 = Array.from({ length: 10 }, newUndo), u3 = Array.from({ length: 10 }, newUndo);
for (const alt of first.alts) {
  const l1 = fmt(b, alt.steps);
  alt.steps.forEach((st, k) => b.make(st.pi, st.t, u1[k]));
  const save = passTurn(b);
  const r = planTurn(b, opp, w, cfg.search.reply!);
  const l2 = fmt(b, r.steps);
  r.steps.forEach((st, k) => b.make(st.pi, st.t, u2[k]));
  const save2 = passTurn(b);
  const f = planTurn(b, me, w, cfg.search.followup!);
  const l3 = fmt(b, f.steps);
  console.log(`\nплан ${alt.score.toFixed(2)} -> ${f.score.toFixed(2)}\n  я: ${l1}\n  он: ${l2} (его оценка ${r.score.toFixed(2)})\n  я: ${l3}`);
  if (process.env.V && alt === first.alts[0]) console.log(show(b));
  restoreTurn(b, save2);
  for (let k = r.steps.length - 1; k >= 0; k--) b.unmake(u2[k]);
  restoreTurn(b, save);
  for (let k = alt.steps.length - 1; k >= 0; k--) b.unmake(u1[k]);
}
