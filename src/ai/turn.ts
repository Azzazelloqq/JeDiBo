// Планирование хода целиком: до `ap` действий разными фигурами (или цепочка Блицкрига), взятие — последним.
// Лучевой поиск по действиям с отсевом одинаковых позиций: тихие ходы разных фигур переставляемы,
// и без отсева луч забивается одной и той же позицией в разном порядке.
// Каждое состояние сравнивается по оценке «если закончить ход здесь» (ход переходит к сопернику),
// а в луч отбирается по лучшей оценке среди взятий, доступных следующим действием, — чтобы не терять
// подготовительные ходы, которые сами по себе ничего не дают (увести фигуру из-под удара, потом взять).
import { Rank, type PlayerId } from '../core/types';
import { ATTACK, CELL_MASK, newUndo, type FastBoard, type Undo } from './board';
import { evaluate, type Weights } from './eval';

export interface Step {
  pi: number;
  t: number;
}

export interface TurnOpts {
  /** ширина луча; 1 — жадный выбор */
  width: number;
  /** отбор в луч с учётом лучшего взятия следующим действием: 0 — без него, 1 — по оценке после взятия */
  lookahead: number;
  /** сколько лучших разных планов вернуть (для проверки ответом соперника) */
  top?: number;
  /** момент (performance.now), после которого новые уровни луча не раскрываются */
  deadline?: number;
}

export interface TurnPlan {
  steps: Step[];
  score: number;
  nodes: number;
  /** лучшие планы по убыванию оценки, первый — steps */
  alts: { steps: Step[]; score: number }[];
}

interface Node {
  steps: Step[];
  key: number;
}

const MAXM = 1024;
const mpiece = new Int16Array(MAXM);
const mtarget = new Int32Array(MAXM);
const cpiece = new Int16Array(MAXM);
const ctarget = new Int32Array(MAXM);

/** Хэш позиции внутри одного хода: фигуры, их флаги и очки действия. */
export function boardKey(b: FastBoard): number {
  let h = 2166136261 ^ b.ap;
  for (let i = 0; i < b.count; i++) {
    const v = b.alive[i] ? ((b.py[i] * 16 + b.px[i]) << 2) | (b.acted[i] << 1) | 1 : 0;
    h = Math.imul(h ^ v, 16777619);
  }
  return Math.imul(h ^ (b.jumper[0] | (b.jumper[1] << 1) | (b.blitzDone[b.current] << 2)), 16777619) >>> 0;
}

export function planTurn(b: FastBoard, me: PlayerId, w: Weights, o: TurnOpts): TurnPlan {
  const opp = (1 - me) as PlayerId;
  const undos: Undo[] = Array.from({ length: 10 }, newUndo);
  let nodes = 0;
  const seen = new Set<number>();
  const endEval = () => {
    nodes++;
    return evaluate(b, me, opp, w);
  };

  // закончить ход без действий можно, только если действие уже было или ходов нет
  const rootMoves = b.movesOf(mpiece, mtarget);
  const top = Math.max(1, o.top ?? 1);
  // кандидаты различаются по сути: планы, которые отличаются только тихими ходами треугольников, — один кандидат,
  // иначе проверка ответом соперника сравнивает почти одинаковые планы
  const alts: { steps: Step[]; score: number; sig: string }[] = [];
  const offer = (steps: Step[], score: number) => {
    const sig = signature(b, steps);
    const same = alts.findIndex((a) => a.sig === sig);
    if (same >= 0) {
      if (alts[same].score >= score) return;
      alts.splice(same, 1);
    }
    if (alts.length === top && score <= alts[top - 1].score) return;
    let k = alts.length;
    while (k > 0 && alts[k - 1].score < score) k--;
    alts.splice(k, 0, { steps, score, sig });
    if (alts.length > top) alts.pop();
  };
  if (b.actedThisTurn || rootMoves === 0) offer([], endEval());
  let beam: Node[] = [{ steps: [], key: 0 }];
  seen.add(boardKey(b));

  /**
   * Взятия, доступные следующим действием: каждое — законченный план (взятие завершает ход), он сразу
   * предлагается в кандидаты. Возвращает лучшую оценку среди них — по ней отбирается в луч подготовительный ход.
   */
  const captureChildren = (steps: Step[]): number => {
    const cu = undos[steps.length];
    const cn = b.movesOf(cpiece, ctarget);
    let best = -Infinity;
    for (let k = 0; k < cn; k++) {
      if (!(ctarget[k] & ATTACK)) continue;
      b.make(cpiece[k], ctarget[k], cu);
      const key = boardKey(b);
      let v = capVal.get(key);
      if (v === undefined) {
        v = endEval();
        capVal.set(key, v);
        seen.add(key);
        offer([...steps, { pi: cpiece[k], t: ctarget[k] }], v);
      }
      b.unmake(cu);
      if (v > best) best = v;
    }
    return best;
  };
  const capVal = new Map<number, number>();

  for (let depth = 0; depth < 8 && beam.length; depth++) {
    if (depth > 0 && o.deadline !== undefined && performance.now() > o.deadline) break;
    const next: { node: Node; pot: number }[] = [];
    for (const node of beam) {
      for (let k = 0; k < node.steps.length; k++) b.make(node.steps[k].pi, node.steps[k].t, undos[k]);
      const cnt = b.movesOf(mpiece, mtarget);
      // ходы копируются: внутренние вызовы movesOf перезапишут общий буфер
      const pcs = mpiece.slice(0, cnt);
      const tgs = mtarget.slice(0, cnt);
      const u = undos[node.steps.length];
      for (let m = 0; m < cnt; m++) {
        b.make(pcs[m], tgs[m], u);
        const key = boardKey(b);
        if (seen.has(key)) {
          b.unmake(u);
          continue;
        }
        seen.add(key);
        const steps = [...node.steps, { pi: pcs[m], t: tgs[m] }];
        const sc = endEval();
        offer(steps, sc);
        if (!(tgs[m] & ATTACK) && b.ap > 0) {
          // подготовительный ход ценен тем лучшим взятием, которое он открывает
          let pot = sc;
          if (o.lookahead > 0) {
            const cap = captureChildren(steps);
            if (cap > sc) pot = sc + o.lookahead * (cap - sc);
          }
          next.push({ node: { steps, key }, pot });
        }
        b.unmake(u);
      }
      for (let k = node.steps.length - 1; k >= 0; k--) b.unmake(undos[k]);
    }
    next.sort((x, y) => y.pot - x.pot);
    beam = next.slice(0, o.width).map((x) => x.node);
  }
  const best = alts[0] ?? { steps: [], score: endEval() };
  return { steps: best.steps, score: best.score, nodes, alts };
}

/** Суть плана: чем и что взято, и какие фигуры (кроме треугольников) ходили — без клеток, куда именно. */
function signature(b: FastBoard, steps: Step[]): string {
  const moved: number[] = [];
  let capture = '';
  for (const st of steps) {
    if (st.t & ATTACK) capture = `${st.pi}x${st.t & CELL_MASK}`;
    else if (b.rank[st.pi] !== Rank.Triangle) moved.push(st.pi);
  }
  return `${capture}|${moved.sort((x, y) => x - y).join(',')}`;
}

/** Клетка цели хода в координатах. */
export const stepTo = (b: FastBoard, t: number) => ({ x: (t & CELL_MASK) % b.n, y: ((t & CELL_MASK) / b.n) | 0 });
