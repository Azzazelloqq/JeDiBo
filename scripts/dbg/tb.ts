import tradeBlunders from '../fixtures/trade-blunders.json';
import { FastBoard, newUndo, passTurn, ATTACK, CELL_MASK } from '../../src/ai/board';
import { DEFAULT_WEIGHTS, bestCapture, type Weights } from '../../src/ai/eval';
import { levelById } from '../../src/ai/levels';
import { searchTurn } from '../../src/ai/search';
import type { GameState, PlayerId } from '../../src/core/types';
const idx = Number(process.argv[2] ?? 1);
const { state, me } = (tradeBlunders as { state: GameState; me: PlayerId }[])[idx];
const VAL = [1, 3, 5];
const truth: Weights = { ...DEFAULT_WEIGHTS, xray: false, see: 8 };
const lv = levelById('master').config;
const V = process.env.V ?? 'new';
const cfg = V === 'old' ? { ...lv, weights: { ...lv.weights, reach: false }, search: { candidates: 10, reply: { width: 3, lookahead: 1 }, followup: { width: 2, lookahead: 1 } } }
  : V === 'f' ? { ...lv, search: { ...lv.search, followup: { width: 2, lookahead: 1 } } }
  : V === 'nop' ? { ...lv, search: { ...lv.search, personas: undefined } }
  : V === 'nor' ? { ...lv, weights: { ...lv.weights, reach: false } } : lv;
if (process.env.ALTS) { const bb = FastBoard.fromState(state); const r = searchTurn(bb, me, cfg.weights, cfg.turn, cfg.search); for (const x of r.scored) console.log(x.score.toFixed(2), x.steps.map((y) => `${'tsc'[bb.rank[y.pi]]}(${bb.px[y.pi]},${bb.py[y.pi]})${y.t & ATTACK ? 'x' : '-'}(${(y.t & CELL_MASK) % 12},${((y.t & CELL_MASK) / 12) | 0})`).join(' ')); }
const b = FastBoard.fromState(state);
const show = () => { const r: string[] = []; for (let y = 0; y < 12; y++) { let s = y.toString().padStart(2) + ' '; for (let x = 0; x < 12; x++) { const i = b.pieceAt(x, y); s += i < 0 ? '.' : 'tsc'[b.rank[i]][b.owner[i] === me ? 'toUpperCase' : 'toLowerCase'](); } r.push(s); } return '   0123456789AB\n' + r.join('\n'); };
const fmt = (st: { pi: number; t: number }[]) => st.map((x) => `${'tsc'[b.rank[x.pi]]}(${b.px[x.pi]},${b.py[x.pi]})${x.t & ATTACK ? 'x' : '-'}(${(x.t & CELL_MASK) % 12},${((x.t & CELL_MASK) / 12) | 0})`).join(' ');
const mat = () => { let m = 0; for (let i = 0; i < b.count; i++) if (b.alive[i]) m += (b.owner[i] === me ? 1 : -1) * VAL[b.rank[i]]; return m; };
console.log(`позиция ${idx}, я — заглавные, вперёд dy=${b.fwd[me]}, материал ${mat()}\n${show()}`);
let line = '';
for (let ply = 0; ply < 4; ply++) {
  const who = (ply % 2 === 0 ? me : 1 - me) as PlayerId;
  const res = searchTurn(b, who, cfg.weights, cfg.turn, cfg.search);
  const st = res.scored[0].steps;
  line += `\n${who === me ? 'я' : 'он'}: ${fmt(st)}`;
  for (const x of st) b.make(x.pi, x.t, newUndo());
  if (ply === 0) { const save = passTurn(b); console.log(`после моего хода «правда» теста: лучшее взятие соперника ${bestCapture(b, (1 - me) as PlayerId, truth)}`); b.current = save.current; }
  passTurn(b);
  line += `  → материал ${mat()}`;
}
console.log(line + '\n' + show());
if (process.env.REPLY) {
  const { planTurn } = await import('../../src/ai/turn');
  const { evaluate } = await import('../../src/ai/eval');
  const bb = FastBoard.fromState(state);
  const r0 = searchTurn(bb, me, cfg.weights, cfg.turn, cfg.search).scored[0].steps;
  for (const x of r0) bb.make(x.pi, x.t, newUndo());
  passTurn(bb);
  const r = planTurn(bb, (1 - me) as PlayerId, cfg.weights, { ...cfg.search.reply!, top: 5 });
  for (const a of r.alts) console.log('ответ', a.score.toFixed(2), a.steps.map((y) => `${'tsc'[bb.rank[y.pi]]}(${bb.px[y.pi]},${bb.py[y.pi]})${y.t & ATTACK ? 'x' : '-'}(${(y.t & CELL_MASK) % 12},${((y.t & CELL_MASK) / 12) | 0})`).join(' '));
  for (const x of r.steps) bb.make(x.pi, x.t, newUndo());
  passTurn(bb);
  console.log('моя оценка после ответа', evaluate(bb, me, me, cfg.weights).toFixed(2), 'моё лучшее взятие', bestCapture(bb, me, cfg.weights));
}
if (process.env.SEE) {
  const bb = FastBoard.fromState(state);
  const r0 = searchTurn(bb, me, cfg.weights, cfg.turn, cfg.search).scored[0].steps;
  for (const x of r0) bb.make(x.pi, x.t, newUndo());
  const opp = (1 - me) as PlayerId;
  console.log('после моего хода: угроза соперника reach', bestCapture(bb, opp, cfg.weights), 'без', bestCapture(bb, opp, { ...cfg.weights, reach: false }));
  passTurn(bb);
  // соперник бьёт круг квадратом s(2,0)
  const sq = bb.pieceAt(2, 0);
  bb.make(sq, (1 * 12 + 2) | ATTACK, newUndo());
  passTurn(bb);
  const showB = () => { const r: string[] = []; for (let y = 0; y < 12; y++) { let s = y.toString().padStart(2) + ' '; for (let x = 0; x < 12; x++) { const i = bb.pieceAt(x, y); s += i < 0 ? '.' : 'tsc'[bb.rank[i]][bb.owner[i] === me ? 'toUpperCase' : 'toLowerCase'](); } r.push(s); } return '   0123456789AB\n' + r.join('\n'); };
  console.log(showB());
  console.log('моё лучшее взятие после s(2,0)x(2,1): reach', bestCapture(bb, me, cfg.weights), 'без', bestCapture(bb, me, { ...cfg.weights, reach: false }));
  console.log('его угроза в этой позиции: reach', bestCapture(bb, opp, cfg.weights), 'без', bestCapture(bb, opp, { ...cfg.weights, reach: false }));
}
