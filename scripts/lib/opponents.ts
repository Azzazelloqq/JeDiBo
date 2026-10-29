// Соперники, похожие на человека: один ход за ход. Против них видно то, чего не видно в игре бота против бота —
// бот-соперник слеп так же, как сам бот, и не наказывает его рискованные размены.
import { createAgent, type AgentConfig, type BotFn } from '../../src/ai/agent';
import { ATTACK, CELL_MASK, FastBoard, newUndo, passTurn, restoreTurn } from '../../src/ai/board';
import { DEFAULT_WEIGHTS, bestCapture, type Weights } from '../../src/ai/eval';
import { levelById } from '../../src/ai/levels';
import { CARDS } from '../../src/core/karma/cards';
import type { Action, GameState, PlayerId } from '../../src/core/types';

const VAL = [1, 3, 5];
const SAFE_REF: Weights = { ...DEFAULT_WEIGHTS, val: [1, 3, 5], xray: false, see: 2 };

/** Карта на руках, которую можно сыграть сейчас. */
const heldPlayable = (s: GameState, me: PlayerId) => {
  const h = s.players[me].held;
  return !!h && (!CARDS[h.card].canPlay || CARDS[h.card].canPlay!(s, me));
};

/**
 * «Наказатель»: за ход одно действие. Есть взятие, после которого бьющую фигуру не отыграть
 * (или отыграть дешевле) — берёт лучшее; иначе случайный ход, после которого ничего не висит.
 * На вопросы карт отвечает первым вариантом, расстановка — как у бота.
 */
export function punisher(seed: number): BotFn {
  let x = seed | 0 || 1;
  const rnd = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x80000000);
  const place = createAgent(levelById('novice').config, seed);
  const P = new Int16Array(512);
  const T = new Int32Array(512);
  const u = newUndo();
  return (s, me) => {
    if (s.phase === 'placement') return place(s, me);
    if (s.pending) {
      const p = s.pending;
      return p.canSkip ? { type: 'skip', by: me } : p.options.length ? { type: 'choose', by: me, option: p.options[0] } : null;
    }
    if (heldPlayable(s, me)) return { type: 'playCard', by: me };
    if (s.actedThisTurn) return { type: 'endTurn', by: me };
    const b = FastBoard.fromState(s);
    const n = b.movesOf(P, T);
    if (!n) return { type: 'endTurn', by: me };
    const opp = (1 - me) as PlayerId;
    let best = -1;
    let bestGain = 0;
    const safe: number[] = [];
    for (let k = 0; k < n; k++) {
      if (T[k] & ATTACK) {
        const c = T[k] & CELL_MASK;
        const gain = VAL[b.rank[b.pieceAt(c % b.n, (c / b.n) | 0)]];
        b.make(P[k], T[k], u);
        const lost = b.attacked(b.px[P[k]], b.py[P[k]], opp) ? VAL[b.rank[P[k]]] : 0;
        b.unmake(u);
        if (gain - lost > bestGain) {
          bestGain = gain - lost;
          best = k;
        }
      } else {
        b.make(P[k], T[k], u);
        const save = passTurn(b);
        if (bestCapture(b, opp, SAFE_REF) === 0) safe.push(k);
        restoreTurn(b, save);
        b.unmake(u);
      }
    }
    const k = best >= 0 ? best : safe.length ? safe[Math.floor(rnd() * safe.length)] : Math.floor(rnd() * n);
    const to = T[k] & CELL_MASK;
    return { type: 'move', by: me, pieceId: b.id[P[k]], to: { x: to % b.n, y: (to / b.n) | 0 } };
  };
}

/**
 * «Снайпер»: голова уровня, но за ход одно действие — как осторожный человек, который ходит по одной фигуре.
 * Бот считает ход так, будто у него одно очко действия, и сразу заканчивает ход.
 */
export function sniper(cfg: AgentConfig, seed: number): BotFn {
  const brain = createAgent({ ...cfg, budgetMs: undefined }, seed);
  return (s, me) => {
    if (s.phase !== 'play' || s.pending || s.current !== me) return brain(s, me);
    if (s.actedThisTurn) return { type: 'endTurn', by: me };
    const one = JSON.parse(JSON.stringify(s)) as GameState;
    one.ap = 1;
    return brain(one, me);
  };
}

/** Выгоды взятий игрока `by` в позиции: ценность жертвы минус бьющая фигура, если её сразу отыграют (1/3/5). */
function captureGains(b: FastBoard, by: PlayerId): number[] {
  const out: number[] = [];
  const def = (1 - by) as PlayerId;
  for (let v = 0; v < b.count; v++) {
    if (!b.alive[v] || b.owner[v] !== def) continue;
    const a = b.attackerOf(b.px[v], b.py[v], by, false);
    if (a < 0) continue;
    const u = newUndo();
    b.make(a, (b.py[v] * b.n + b.px[v]) | ATTACK, u);
    const back = b.attacked(b.px[a], b.py[a], def) ? VAL[b.rank[a]] : 0;
    b.unmake(u);
    const g = VAL[b.rank[v]] - back;
    if (g > 0) out.push(g);
  }
  return out;
}

/**
 * «Охотник»: своя простая логика, не оценка бота. Ходит всеми очками действия: тихими ходами подтягивает фигуры так,
 * чтобы на следующий ход у него было как можно больше выгодных взятий (давление), не оставляя своих фигур под
 * выгодным взятием; последним действием бьёт лучшее, что берётся без потери. Двойные угрозы получаются сами.
 */
export function hunter(seed: number): BotFn {
  let x = seed | 0 || 1;
  const rnd = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x80000000);
  const place = createAgent(levelById('novice').config, seed);
  const P = new Int16Array(512);
  const T = new Int32Array(512);
  const u = newUndo();
  return (s, me) => {
    if (s.phase === 'placement') return place(s, me);
    if (s.pending) {
      const p = s.pending;
      return p.canSkip ? { type: 'skip', by: me } : p.options.length ? { type: 'choose', by: me, option: p.options[0] } : null;
    }
    if (heldPlayable(s, me)) return { type: 'playCard', by: me };
    const b = FastBoard.fromState(s);
    const n = b.movesOf(P, T);
    if (!n) return { type: 'endTurn', by: me };
    const opp = (1 - me) as PlayerId;
    const toAction = (k: number): Action => {
      const to = T[k] & CELL_MASK;
      return { type: 'move', by: me, pieceId: b.id[P[k]], to: { x: to % b.n, y: (to / b.n) | 0 } };
    };
    // давление и безопасность позиции, если ход закончится здесь
    const score = () => {
      const save = passTurn(b);
      const danger = bestCapture(b, opp, SAFE_REF);
      restoreTurn(b, save);
      const g = captureGains(b, me);
      return g.reduce((a, c) => a + c, 0) - 10 * danger;
    };
    // лучшее взятие без потери
    let cap = -1;
    let capGain = 0;
    for (let k = 0; k < n; k++) {
      if (!(T[k] & ATTACK)) continue;
      const c = T[k] & CELL_MASK;
      const gain = VAL[b.rank[b.pieceAt(c % b.n, (c / b.n) | 0)]];
      b.make(P[k], T[k], u);
      const lost = b.attacked(b.px[P[k]], b.py[P[k]], opp) ? VAL[b.rank[P[k]]] : 0;
      b.unmake(u);
      if (gain - lost > capGain) {
        capGain = gain - lost;
        cap = k;
      }
    }
    // последнее очко действия — на взятие; пока очков больше, ищем тихий ход, усиливающий давление
    if (b.ap > 1 || cap < 0) {
      const base = score();
      let best = -1;
      let bestSc = base + 0.5;
      for (let k = 0; k < n; k++) {
        if (T[k] & ATTACK) continue;
        b.make(P[k], T[k], u);
        const sc = score() + rnd() * 0.1;
        b.unmake(u);
        if (sc > bestSc) {
          bestSc = sc;
          best = k;
        }
      }
      if (best >= 0) return toAction(best);
    }
    if (cap >= 0) return toAction(cap);
    if (!s.actedThisTurn) {
      // ход обязателен: самый безопасный
      let best = 0;
      let bestSc = -Infinity;
      for (let k = 0; k < n; k++) {
        if (T[k] & ATTACK) continue;
        b.make(P[k], T[k], u);
        const sc = score();
        b.unmake(u);
        if (sc > bestSc) {
          bestSc = sc;
          best = k;
        }
      }
      return toAction(best);
    }
    return { type: 'endTurn', by: me };
  };
}

/** Мастер с весами до исправления размена: 1/2.75/3.5, угроза 0.66, размен на один шаг — агрессивный, весь ход. */
export function oldMaster(seed: number): BotFn {
  const cfg = levelById('master').config;
  return createAgent({ ...cfg, budgetMs: undefined, weights: { ...cfg.weights, val: [1, 2.75, 3.5], threat: 0.66, see: 2 } }, seed);
}

/** Соперник по имени для скриптов: punisher, hunter, oldmaster, sniper (голова Мастера), sniper-<уровень>. */
export function opponentByName(name: string, seed: number): BotFn | undefined {
  if (name === 'punisher') return punisher(seed);
  if (name === 'hunter') return hunter(seed);
  if (name === 'oldmaster') return oldMaster(seed);
  if (name === 'sniper') return sniper(levelById('master').config, seed);
  if (name.startsWith('sniper-')) return sniper(levelById(name.slice(7)).config, seed);
  return undefined;
}

