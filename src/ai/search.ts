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
  /** свой следующий ход после ответа соперника (третий полуход); не задан — оценка после ответа */
  followup?: TurnOpts;
  /**
   * Сколько лучших планов проверяется ответом всегда, даже если бюджет времени кончился (по умолчанию 3).
   * Именно эта проверка ловит «побил — и сразу потерял фигуру»; без минимума на медленном устройстве
   * бот проверял бы один план и снова зевал.
   */
  minChecked?: number;
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

const mine = Array.from({ length: 10 }, newUndo);
const theirs = Array.from({ length: 10 }, newUndo);

/**
 * deadline — момент (performance.now), после которого планы сверх обязательного минимума ответом не проверяются.
 * Первый план хода считается всегда полностью: его цена ограничена шириной луча, а обрезанный план — это ход
 * одним действием.
 */
export function searchTurn(b: FastBoard, me: PlayerId, w: Weights, turn: TurnOpts, so: SearchOpts, deadline?: number): SearchResult {
  const first = planTurn(b, me, w, { ...turn, top: so.reply ? so.candidates : 1 });
  if (!so.reply || first.alts.length <= 1) return { scored: first.alts.length ? first.alts : [{ steps: first.steps, score: first.score }], nodes: first.nodes };
  const opp = (1 - me) as PlayerId;
  let nodes = first.nodes;
  const scored: Scored[] = [];
  const minChecked = so.minChecked ?? 3;
  for (const alt of first.alts) {
    const guaranteed = scored.length < minChecked;
    if (!guaranteed && deadline !== undefined && performance.now() > deadline) break;
    // обязательные проверки — полной глубины, остальные — пока есть время
    const dl = guaranteed ? undefined : deadline;
    alt.steps.forEach((st, k) => b.make(st.pi, st.t, mine[k]));
    let sc: number;
    if (alt.score >= WIN) sc = WIN;
    else {
      const save = passTurn(b);
      const r = planTurn(b, opp, w, { ...so.reply, deadline: dl });
      nodes += r.nodes;
      r.steps.forEach((st, k) => b.make(st.pi, st.t, theirs[k]));
      if (so.followup && r.score < WIN) {
        // и мой следующий ход: видно, что ответ соперника оставил мне (или что я не успею защитить)
        const save2 = passTurn(b);
        const f = planTurn(b, me, w, { ...so.followup, deadline: dl });
        nodes += f.nodes;
        sc = f.score;
        restoreTurn(b, save2);
      } else sc = evaluate(b, me, me, w);
      for (let k = r.steps.length - 1; k >= 0; k--) b.unmake(theirs[k]);
      restoreTurn(b, save);
    }
    for (let k = alt.steps.length - 1; k >= 0; k--) b.unmake(mine[k]);
    scored.push({ steps: alt.steps, score: sc });
  }
  scored.sort((x, y) => y.score - x.score);
  return { scored, nodes };
}
