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
}

export const DEFAULT_WEIGHTS: Weights = {
  val: [1, 3, 5],
  advance: 0.8,
  threat: 0.9,
  myThreat: 0.3,
  chase: 0.05,
};

export const WIN = 1e6;

const u = newUndo();

/** Лучшее одно взятие игрока `by` в позиции с учётом ответного взятия; 0 — взять нечего выгодно. */
export function bestCapture(b: FastBoard, by: PlayerId, w: Weights): number {
  const def = (1 - by) as PlayerId;
  let best = 0;
  for (let v = 0; v < b.count; v++) {
    if (!b.alive[v] || b.owner[v] !== def) continue;
    const gainMax = w.val[b.rank[v]];
    if (gainMax <= best) continue;
    const a = b.attackerOf(b.px[v], b.py[v], by, true);
    if (a < 0) continue;
    // размен: после взятия может ли защитник взять атакующего на той же клетке
    const cell = b.py[v] * b.n + b.px[v];
    b.make(a, cell | ATTACK, u);
    const recaptured = b.attacked(b.px[a], b.py[a], def, true);
    b.unmake(u);
    const gain = gainMax - (recaptured ? w.val[b.rank[a]] : 0);
    if (gain > best) best = gain;
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
