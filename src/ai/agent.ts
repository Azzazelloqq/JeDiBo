// Бот: план на ход целиком, выдача действий по одному (сессия анимирует каждое).
// Вопросы движка (карты, повышение) решаются перебором вариантов на настоящем движке.
// Бот не подсматривает будущие карты: в копиях партии для перебора колода пуста, поэтому если выбор
// заканчивает ход, соперник на копии не вытягивает настоящую следующую карту.
import { CARDS } from '../core/karma/cards';
import { dispatch } from '../core/engine';
import { PRESETS } from '../core/presets';
import { sideOf } from '../core/rules';
import { other, type Action, type GameState, type PlayerId } from '../core/types';
import { FastBoard, newUndo } from './board';
import { DEFAULT_WEIGHTS, WIN, evaluate, type Weights } from './eval';
import { searchTurn, type Scored, type SearchOpts } from './search';
import { boardKey, stepTo, type TurnOpts } from './turn';

export interface AgentConfig {
  weights: Weights;
  turn: TurnOpts;
  search: SearchOpts;
  /** случайность выбора среди оценённых планов (в единицах оценки, треугольник = 1); 0 — всегда лучший */
  temperature: number;
  /** доля ходов, в которых бот не замечает угроз соперника */
  blunder: number;
  /** бюджет на расчёт хода, мс; не задан — расчёт ограничен только шириной поиска (для арены) */
  budgetMs?: number;
}

export const DEFAULT_CONFIG: AgentConfig = {
  weights: DEFAULT_WEIGHTS,
  turn: { width: 8, lookahead: 0.6 },
  search: { candidates: 6, reply: { width: 2, lookahead: 0.6 } },
  temperature: 0,
  blunder: 0,
};

export interface BotContext {
  /** сколько осталось на общих часах бота, мс */
  clockMs?: number;
}

export type BotFn = (s: GameState, me: PlayerId, ctx?: BotContext) => Action | null;

/** Бюджет на ход: не больше уровня и не больше доли оставшегося времени (с запасом на долгую партию). */
export function turnBudget(budgetMs: number | undefined, clockMs: number | undefined): number | undefined {
  if (budgetMs === undefined) return undefined;
  if (clockMs === undefined) return budgetMs;
  return Math.max(10, Math.min(budgetMs, clockMs / 150));
}

/** Создать бота. У каждого экземпляра свой кэш плана и свой ГСЧ (seed — для воспроизводимости на арене). */
export function createAgent(cfg: AgentConfig = DEFAULT_CONFIG, seed = (Math.random() * 2 ** 31) | 0): BotFn {
  let plan: { actions: Action[]; keys: number[]; at: number } | null = null;
  let board = new FastBoard(12);
  const rnd = mulberry32(seed);

  return (s, me, ctx) => {
    if (s.phase === 'placement') return s.players[me].placed ? null : placement(s, me, rnd);
    if (s.phase !== 'play') return null;
    if (s.pending) {
      plan = null;
      return s.pending.chooser === me ? choosePending(s, me, cfg.weights) : null;
    }
    if (s.current !== me) return null;

    const held = s.players[me].held;
    if (held) {
      const d = CARDS[held.card];
      if (!d.canPlay || d.canPlay(s, me)) {
        plan = null;
        return { type: 'playCard', by: me };
      }
    }

    if (board.n !== s.mode.size) board = new FastBoard(s.mode.size);
    const b = board;
    b.load(s);
    // продолжаем план, если позиция ровно та, что ожидалась после прошлого действия
    if (plan && plan.at < plan.actions.length && plan.keys[plan.at] === boardKey(b)) return plan.actions[plan.at++];

    const budget = turnBudget(cfg.budgetMs, ctx?.clockMs);
    const deadline = budget === undefined ? undefined : performance.now() + budget;
    const w = cfg.blunder > 0 && rnd() < cfg.blunder ? { ...cfg.weights, threat: 0, xray: false } : cfg.weights;
    const res = searchTurn(b, me, w, cfg.turn, cfg.search, deadline);
    const steps = pick(res.scored, cfg.temperature, rnd).steps;

    const actions: Action[] = [];
    const keys: number[] = [];
    for (const st of steps) {
      keys.push(boardKey(b));
      actions.push({ type: 'move', by: me, pieceId: b.id[st.pi], to: stepTo(b, st.t) });
      b.make(st.pi, st.t, newUndo());
    }
    // ход заканчивается сам, когда кончились очки действия; иначе — явно
    if (b.ap > 0) {
      keys.push(boardKey(b));
      actions.push({ type: 'endTurn', by: me });
    }
    plan = { actions, keys, at: 1 };
    return actions[0];
  };
}

/** Выбор плана: при температуре 0 — лучший, иначе случайно с весами exp(оценка / температура). */
function pick(scored: Scored[], temperature: number, rnd: () => number): Scored {
  if (temperature <= 0 || scored.length === 1) return scored[0];
  const top = scored[0].score;
  const ws = scored.map((x) => Math.exp((x.score - top) / temperature));
  let r = rnd() * ws.reduce((a, c) => a + c, 0);
  for (let i = 0; i < scored.length; i++) if ((r -= ws[i]) <= 0) return scored[i];
  return scored[0];
}

/** Расстановка: случайный пресет. */
export function placement(s: GameState, me: PlayerId, rnd: () => number = Math.random): Action {
  const preset = PRESETS[Math.floor(rnd() * PRESETS.length)];
  return { type: 'place', by: me, layout: preset.build(s, sideOf(s, me)) };
}

const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s));

/** Перебор ответов на вопрос движка: каждый вариант прогоняется через dispatch и оценивается. */
function choosePending(s: GameState, me: PlayerId, w: Weights): Action | null {
  const p = s.pending!;
  const candidates: Action[] = p.options.map((o) => ({ type: 'choose', by: me, option: o }));
  if (p.canSkip) candidates.push({ type: 'skip', by: me });
  if (candidates.length <= 1) return candidates[0] ?? null;
  const b = new FastBoard(s.mode.size);
  let best = candidates[0];
  let bestSc = -Infinity;
  for (const a of candidates) {
    const c = clone(s);
    c.deck = [];
    // вариант может оказаться устаревшим (движок падает на нём) — такой не выбираем
    try {
      if (!dispatch(c, a).ok) continue;
    } catch {
      continue;
    }
    const sc = scoreState(c, me, w, b);
    if (sc > bestSc) {
      bestSc = sc;
      best = a;
    }
  }
  return best;
}

function scoreState(s: GameState, me: PlayerId, w: Weights, b: FastBoard): number {
  if (s.phase === 'over') return s.winner === me ? WIN : s.winner === 'draw' ? 0 : -WIN;
  b.load(s);
  return evaluate(b, me, s.current === me ? me : other(me), w);
}

function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
