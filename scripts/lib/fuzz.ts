// Фаззер движка: партии из случайных действий среди тех, что движок сам предлагает.
// Боты обходят странные варианты, поэтому прячут ошибки движка; случайный игрок жмёт всё подряд.
// Проверяются свойства, не зависящие от реализации: предложенное действие принимается без исключения,
// фигуры не накладываются и не выходят за поле, вопрос всегда можно закрыть.
// Используется в npm test и в npm run fuzz.
import { createGame, dispatch } from '../../src/core/engine';
import { CARDS } from '../../src/core/karma/cards';
import { CLASSIC } from '../../src/core/modes';
import { PRESETS } from '../../src/core/presets';
import { anyLegalAction, choosingOpponent, isBarrier, legalTargets, piecesOf, sideOf } from '../../src/core/rules';
import { key, type Action, type GameState, type ModeConfig, type PlayerId } from '../../src/core/types';
import { lcg } from './boardcheck';

const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s));

/** Все действия, которые движок сейчас считает допустимыми (кроме сдачи). */
export function offeredActions(s: GameState): Action[] {
  if (s.phase === 'over') return [];
  if (s.phase === 'placement') {
    const by: PlayerId = s.players[0].placed ? 1 : 0;
    return PRESETS.filter((p) => p.id !== 'random').map((p) => ({ type: 'place', by, layout: p.build(s, sideOf(s, by)) }));
  }
  const p = s.pending;
  if (p) {
    const out: Action[] = p.options.map((o) => ({ type: 'choose', by: p.chooser, option: o }));
    if (p.canSkip) out.push({ type: 'skip', by: p.chooser });
    return out;
  }
  const by = s.current;
  const out: Action[] = [];
  for (const pc of piecesOf(s, by)) for (const t of legalTargets(s, pc)) out.push({ type: 'move', by, pieceId: pc.id, to: t.to });
  if (s.actedThisTurn || !anyLegalAction(s)) out.push({ type: 'endTurn', by });
  const h = s.players[by].held;
  if (h && (!CARDS[h.card].canPlay || CARDS[h.card].canPlay!(s, by))) out.push({ type: 'playCard', by });
  return out;
}

/** Нарушения инвариантов состояния; пустой список — всё в порядке. */
export function invariantErrors(s: GameState): string[] {
  const errs: string[] = [];
  const cells = new Set<string>();
  const ids = new Set<number>();
  for (const pc of s.pieces) {
    const k = key(pc);
    if (pc.x < 0 || pc.y < 0 || pc.x >= s.mode.size || pc.y >= s.mode.size) errs.push(`фигура ${pc.id} вне поля (${k})`);
    if (cells.has(k)) errs.push(`две фигуры на клетке ${k}`);
    if (ids.has(pc.id)) errs.push(`повтор id ${pc.id}`);
    if (isBarrier(s, pc)) errs.push(`фигура ${pc.id} на клетке барьера ${k}`);
    cells.add(k);
    ids.add(pc.id);
  }
  if (s.ap < 0 || s.ap > s.mode.ap) errs.push(`очки действия ${s.ap}`);
  const p = s.pending;
  if (s.phase === 'play' && p && !p.options.length && !p.canSkip) errs.push(`вопрос «${p.source}» без вариантов`);
  return errs;
}

export interface FuzzOpts {
  games: number;
  seed?: number;
  /** лимит общих ходов на партию */
  turns?: number;
}

/**
 * Прогон: половина партий в обычной Классике, половина — с Кармой каждые 2 хода и полной колодой,
 * чтобы карты и их сочетания (повышение + вопрос карты, очередь вопросов) встречались чаще.
 * Каждый вариант открытого вопроса пробуется на копии. Возвращает первую найденную ошибку или null.
 */
export function fuzz(opts: FuzzOpts): { error: string | null; steps: number; questions: number } {
  const rnd = lcg(opts.seed ?? 12345);
  const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  let steps = 0;
  let questions = 0;
  for (let g = 0; g < opts.games; g++) {
    const seed = (g * 2654435761 + (opts.seed ?? 0)) | 0;
    const mode: ModeConfig = g % 2 ? { ...CLASSIC, karmaEvery: 2, matchDeckSize: 34 } : CLASSIC;
    const s = createGame(mode, seed, ['A', 'B']);
    const where = () => `партия ${g} (seed ${seed}, Карма раз в ${mode.karmaEvery}), ход ${s.turn}`;
    while (s.phase !== 'over' && s.turn <= (opts.turns ?? 300)) {
      const acts = offeredActions(s);
      if (!acts.length) return { error: `${where()}: нет ни одного действия`, steps, questions };
      if (s.pending) {
        questions++;
        for (const a of acts) {
          const c = clone(s);
          try {
            const r = dispatch(c, a);
            if (!r.ok) return { error: `${where()}: вариант ${JSON.stringify(a)} вопроса «${s.pending.source}» отклонён: ${r.error}`, steps, questions };
          } catch (e) {
            return { error: `${where()}: движок упал на варианте ${JSON.stringify(a)} вопроса «${s.pending.source}»: ${(e as Error).message}`, steps, questions };
          }
          const errs = invariantErrors(c);
          if (errs.length) return { error: `${where()}: после ${JSON.stringify(a)}: ${errs.join('; ')}`, steps, questions };
        }
      }
      // ход завершаем реже, иначе партии почти не продвигаются; изредка — таймаут хода
      const ends = acts.filter((a) => a.type === 'endTurn');
      const rest = acts.filter((a) => a.type !== 'endTurn');
      const r0 = rnd();
      const ch = choosingOpponent(s);
      const a: Action =
        s.phase === 'play' && r0 < 0.02
          ? ch !== null
            ? { type: 'timeout', by: ch, total: false, choice: true }
            : { type: 'timeout', by: s.current, total: false }
          : ends.length && (!rest.length || r0 < 0.25)
            ? ends[0]
            : pick(rest);
      let r;
      try {
        r = dispatch(s, a);
      } catch (e) {
        return { error: `${where()}: движок упал на ${JSON.stringify(a)}: ${(e as Error).message}`, steps, questions };
      }
      if (!r.ok) return { error: `${where()}: предложенное действие ${JSON.stringify(a)} отклонено: ${r.error}`, steps, questions };
      steps++;
      const errs = invariantErrors(s);
      if (errs.length) return { error: `${where()}: после ${JSON.stringify(a)}: ${errs.join('; ')}`, steps, questions };
    }
  }
  return { error: null, steps, questions };
}
