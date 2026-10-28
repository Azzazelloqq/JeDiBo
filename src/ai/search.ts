// Проверка лучших планов хода полным ответным ходом соперника (два полухода).
// Соперник отвечает тем же планировщиком, обычно с более узким лучом.
import type { PlayerId } from '../core/types';
import { newUndo, passTurn, restoreTurn, type FastBoard } from './board';
import { WIN, evaluate, type Weights } from './eval';
import { planTurn, type TurnOpts, type TurnPlan } from './turn';

export interface SearchOpts {
  /** сколько лучших своих планов проверять ответом */
  candidates: number;
  /** планировщик ответа соперника; null — без проверки */
  reply: TurnOpts | null;
}

const mine = Array.from({ length: 8 }, newUndo);
const theirs = Array.from({ length: 8 }, newUndo);

export function searchTurn(b: FastBoard, me: PlayerId, w: Weights, turn: TurnOpts, so: SearchOpts): TurnPlan {
  const first = planTurn(b, me, w, { ...turn, top: so.reply ? so.candidates : 1 });
  if (!so.reply || first.alts.length <= 1) return first;
  const opp = (1 - me) as PlayerId;
  let nodes = first.nodes;
  let best = first.alts[0];
  let bestSc = -Infinity;
  for (const alt of first.alts) {
    alt.steps.forEach((st, k) => b.make(st.pi, st.t, mine[k]));
    let sc: number;
    if (alt.score >= WIN) sc = WIN;
    else {
      const save = passTurn(b);
      const r = planTurn(b, opp, w, so.reply);
      nodes += r.nodes;
      r.steps.forEach((st, k) => b.make(st.pi, st.t, theirs[k]));
      sc = evaluate(b, me, me, w);
      for (let k = r.steps.length - 1; k >= 0; k--) b.unmake(theirs[k]);
      restoreTurn(b, save);
    }
    for (let k = alt.steps.length - 1; k >= 0; k--) b.unmake(mine[k]);
    if (sc > bestSc) {
      bestSc = sc;
      best = alt;
    }
  }
  return { steps: best.steps, score: bestSc, nodes, alts: first.alts };
}
