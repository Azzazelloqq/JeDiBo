// Оценка позиции на быстрой доске и модель ответа соперника.
// За ход возможно только одно взятие (взятие обнуляет очки действия), поэтому угроза соперника —
// это его лучшее одно взятие с учётом размена, а не перебор его цепочек действий.
import { Rank, type PlayerId } from '../core/types';
import { ATTACK, newUndo, type FastBoard } from './board';

export interface Weights {
  /** ценность фигур по рангу */
  val: [number, number, number];
  /** доля прироста от повышения, которая засчитывается по мере продвижения к последнему ряду */
  advance: number;
  /** штраф за лучшее взятие соперника на его ходу */
  threat: number;
  /** бонус за собственную угрозу на следующий ход (соперник успеет ответить, поэтому меньше) */
  myThreat: number;
  /** при перевесе — сближение кругов с фигурами соперника (на клетку расстояния) */
  chase: number;
  /** видеть атаки «сквозь свои фигуры» (соперник уводит блокирующую фигуру и бьёт); слабые уровни не видят */
  xray: boolean;
  /**
   * Глубина размена на клетке (взятий подряд, по одному за ход): 2 — «возьмёт, и я возьму в ответ»,
   * больше — полная цепочка, где каждая сторона бьёт самой дешёвой фигурой и может остановиться.
   */
  see: number;
}

// Ценности 1/3/5 и полный штраф за угрозу: веса, подобранные в игре бота против самого себя (1/2.75/3.5, угроза 0.66),
// учили рискованным разменам, которые бот-соперник не наказывает, а человек наказывает. Остальное — из того подбора.
export const DEFAULT_WEIGHTS: Weights = {
  val: [1, 3, 5],
  advance: 0.65,
  threat: 1,
  myThreat: 0.11,
  chase: 0.093,
  xray: true,
  see: 8,
};

export const WIN = 1e6;

const seeUndo = Array.from({ length: 16 }, newUndo);
const gain = new Float64Array(16);

/**
 * Итог размена на клетке фигуры v для игрока `by`, который бьёт первым фигурой a: обе стороны по очереди бьют
 * на этой клетке самой дешёвой фигурой и могут остановиться (классический подсчёт размена, SEE).
 * За ход возможно одно взятие, так что каждое следующее взятие — следующий ход; между ними стороны могут
 * отвести блокирующие фигуры, поэтому атакующие ищутся с учётом x-ray (если он включён).
 */
function exchange(b: FastBoard, v: number, a: number, by: PlayerId, w: Weights): number {
  const x = b.px[v];
  const y = b.py[v];
  const cell = y * b.n + x;
  const depth = Math.min(w.see, seeUndo.length);
  gain[0] = w.val[b.rank[v]];
  let d = 0;
  let made = 0;
  let attacker = a;
  let side = by;
  for (;;) {
    b.make(attacker, cell | ATTACK, seeUndo[made++]);
    side = (1 - side) as PlayerId;
    if (d + 1 >= depth) break;
    const next = b.attackerOf(x, y, side, w.xray);
    if (next < 0) break;
    d++;
    gain[d] = w.val[b.rank[attacker]] - gain[d - 1];
    attacker = next;
  }
  while (made > 0) b.unmake(seeUndo[--made]);
  for (; d > 0; d--) gain[d - 1] = -Math.max(-gain[d - 1], gain[d]);
  return gain[0];
}

/** Лучшее одно взятие игрока `by` в позиции с учётом размена; 0 — взять нечего выгодно. */
export function bestCapture(b: FastBoard, by: PlayerId, w: Weights): number {
  const def = (1 - by) as PlayerId;
  let best = 0;
  for (let v = 0; v < b.count; v++) {
    if (!b.alive[v] || b.owner[v] !== def) continue;
    if (w.val[b.rank[v]] <= best) continue;
    const a = b.attackerOf(b.px[v], b.py[v], by, w.xray);
    if (a < 0) continue;
    const g = exchange(b, v, a, by, w);
    if (g > best) best = g;
  }
  return best;
}

/**
 * Оценка с точки зрения `me`. toMove — чей ход следующий: от этого зависит, чья угроза реализуется первой.
 */
export function evaluate(b: FastBoard, me: PlayerId, toMove: PlayerId, w: Weights): number {
  const n = b.n;
  let score = 0;
  const mat = [0, 0];
  let alive0 = 0;
  let alive1 = 0;
  for (let i = 0; i < b.count; i++) {
    if (!b.alive[i]) continue;
    const p = b.owner[i];
    const r = b.rank[i];
    let v = w.val[r];
    mat[p] += v;
    if (r !== Rank.Circle) {
      const d = b.fwd[p] < 0 ? b.py[i] : n - 1 - b.py[i];
      const progress = 1 - d / (n - 1);
      v += (w.val[r + 1] - w.val[r]) * w.advance * progress * progress;
    }
    if (p === 0) alive0++;
    else alive1++;
    score += p === me ? v : -v;
  }
  const opp = (1 - me) as PlayerId;
  if ((me === 0 ? alive1 : alive0) === 0) return WIN;
  if ((me === 0 ? alive0 : alive1) === 0) return -WIN;

  const oppThreat = bestCapture(b, opp, w);
  const myThreat = bestCapture(b, me, w);
  if (toMove === opp) score += -w.threat * oppThreat + w.myThreat * myThreat;
  else score += w.threat * myThreat - w.myThreat * oppThreat;

  // эндшпиль: перевес — сближаться, чтобы партия заканчивалась
  if (alive0 + alive1 <= 14 && mat[me] > mat[opp]) score -= w.chase * chaseDistance(b, me);
  return score;
}

/** Сумма расстояний от каждого своего круга до ближайшей фигуры соперника (по Чебышёву). */
function chaseDistance(b: FastBoard, me: PlayerId): number {
  let sum = 0;
  for (let i = 0; i < b.count; i++) {
    if (!b.alive[i] || b.owner[i] !== me || b.rank[i] !== Rank.Circle) continue;
    let best = 99;
    for (let j = 0; j < b.count; j++) {
      if (!b.alive[j] || b.owner[j] === me) continue;
      const d = Math.max(Math.abs(b.px[i] - b.px[j]), Math.abs(b.py[i] - b.py[j]));
      if (d < best) best = d;
    }
    sum += best;
  }
  return sum;
}
