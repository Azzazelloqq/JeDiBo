// Проверка лучших планов хода полным ответным ходом соперника (два полухода).
// Соперник отвечает тем же планировщиком, обычно с более узким лучом.
import type { PlayerId } from '../core/types';
import { newUndo, passTurn, restoreTurn, type FastBoard } from './board';
import { WIN, evaluate, type Weights } from './eval';
import { planTurn, type Step, type TurnOpts } from './turn';

export interface SearchOpts {
  /** сколько лучших своих планов проверять ответом */
  candidates: number;
  /** планировщик ответа соперника; null — без проверки */
  reply: TurnOpts | null;
}

export interface Scored {
  steps: Step[];
  score: number;
}

export interface SearchResult {
  /** оценённые планы по убыванию оценки */
  scored: Scored[];
  nodes: number;
}

const mine = Array.from({ length: 8 }, newUndo);
const theirs = Array.from({ length: 8 }, newUndo);

/** deadline — момент (performance.now), после которого новые планы ответом не проверяются. */
export function searchTurn(b: FastBoard, me: PlayerId, w: Weights, turn: TurnOpts, so: SearchOpts, deadline?: number): SearchResult {
  const first = planTurn(b, me, w, { ...turn, top: so.reply ? so.candidates : 1, deadline });
  if (!so.reply || first.alts.length <= 1) return { scored: first.alts.length ? first.alts : [{ steps: first.steps, score: first.score }], nodes: first.nodes };
  const opp = (1 - me) as PlayerId;
  let nodes = first.nodes;
  const scored: Scored[] = [];
  for (const alt of first.alts) {
    if (scored.length > 0 && deadline !== undefined && performance.now() > deadline) break;
    alt.steps.forEach((st, k) => b.make(st.pi, st.t, mine[k]));
    let sc: number;
    if (alt.score >= WIN) sc = WIN;
    else {
      const save = passTurn(b);
      const r = planTurn(b, opp, w, { ...so.reply, deadline });
      nodes += r.nodes;
      r.steps.forEach((st, k) => b.make(st.pi, st.t, theirs[k]));
      sc = evaluate(b, me, me, w);
      for (let k = r.steps.length - 1; k >= 0; k--) b.unmake(theirs[k]);
      restoreTurn(b, save);
    }
    for (let k = alt.steps.length - 1; k >= 0; k--) b.unmake(mine[k]);
    scored.push({ steps: alt.steps, score: sc });
  }
  scored.sort((x, y) => y.score - x.score);
  return { scored, nodes };
}
