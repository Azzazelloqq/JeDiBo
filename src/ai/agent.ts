// Новый бот: план на ход целиком, выдача действий по одному (сессия анимирует каждое).
// Вопросы движка (карты, повышение) решаются перебором вариантов на настоящем движке.
// Бот не подсматривает будущие карты: в копиях партии для перебора колода пуста, поэтому если выбор
// заканчивает ход, соперник на копии не вытягивает настоящую следующую карту.
import { CARDS } from '../core/karma/cards';
import { dispatch } from '../core/engine';
import { PRESETS } from '../core/presets';
import { sideOf } from '../core/rules';
import { other, type Action, type GameState, type PlayerId } from '../core/types';
import { FastBoard } from './board';
import { DEFAULT_WEIGHTS, WIN, evaluate, type Weights } from './eval';
import { searchTurn, type SearchOpts } from './search';
import { boardKey, stepTo, type TurnOpts } from './turn';

export interface AgentConfig {
  weights: Weights;
  turn: TurnOpts;
  search: SearchOpts;
}

export const DEFAULT_CONFIG: AgentConfig = {
  weights: DEFAULT_WEIGHTS,
  turn: { width: 8, lookahead: 0.6 },
  search: { candidates: 6, reply: { width: 2, lookahead: 0.6 } },
};

export type BotFn = (s: GameState, me: PlayerId) => Action | null;

/** Создать бота. У каждого экземпляра свой кэш плана. */
export function createAgent(cfg: AgentConfig = DEFAULT_CONFIG): BotFn {
  let plan: { actions: Action[]; keys: number[]; at: number } | null = null;
  const board = new FastBoard(12);

  return (s, me) => {
    if (s.phase === 'placement') return s.players[me].placed ? null : placement(s, me);
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

    const b = board.n === s.mode.size ? board : new FastBoard(s.mode.size);
    b.load(s);
    // продолжаем план, если позиция ровно та, что ожидалась после прошлого действия
    if (plan && plan.at < plan.actions.length && plan.keys[plan.at] === boardKey(b)) return plan.actions[plan.at++];

    const res = searchTurn(b, me, cfg.weights, cfg.turn, cfg.search);
    const actions: Action[] = [];
    const keys: number[] = [];
    const undo = { pi: 0, from: 0, to: 0, victim: -1, ap: 0, acted: 0, jumper: 0, blitzPiece: -1, blitzDone: 0, actedThisTurn: 0 };
    for (const st of res.steps) {
      keys.push(boardKey(b));
      actions.push({ type: 'move', by: me, pieceId: b.id[st.pi], to: stepTo(b, st.t) });
      b.make(st.pi, st.t, { ...undo });
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

function placement(s: GameState, me: PlayerId): Action {
  const preset = PRESETS[Math.floor(Math.random() * PRESETS.length)];
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
