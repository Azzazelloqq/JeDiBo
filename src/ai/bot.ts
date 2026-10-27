// Простой жадный бот «Странник». Выдаёт по одному действию за вызов —
// так сессия может анимировать каждое действие отдельно.
import { CARDS } from '../core/karma/cards';
import { canAct, forward, homeRows, isAttacked, lastRow, pieceAt, piecesOf, sideOf, targetsOf } from '../core/rules';
import { Rank, other, unkey, type Action, type GameState, type Pending, type Piece, type PlayerId, type Pos } from '../core/types';
import { PRESETS } from '../core/presets';

const VALUE = [1, 3, 5];

export function botPlacement(s: GameState, me: PlayerId): Action {
  const preset = PRESETS[Math.floor(Math.random() * PRESETS.length)];
  return { type: 'place', by: me, layout: preset.build(s, sideOf(s, me)) };
}

export function botAction(s: GameState, me: PlayerId): Action | null {
  if (s.phase === 'placement') return s.players[me].placed ? null : botPlacement(s, me);
  if (s.phase !== 'play') return null;
  if (s.pending) return s.pending.chooser === me ? choose(s, me, s.pending) : null;
  if (s.current !== me) return null;

  const held = s.players[me].held;
  if (held) {
    const d = CARDS[held.card];
    if (!d.canPlay || d.canPlay(s, me)) return { type: 'playCard', by: me };
  }

  let best: { score: number; a: Action } | null = null;
  for (const pc of piecesOf(s, me)) {
    if (!canAct(s, pc)) continue;
    for (const t of targetsOf(s, pc)) {
      const sc = scoreMove(s, pc, t.to, t.attack) + Math.random() * 0.6;
      if (!best || sc > best.score) best = { score: sc, a: { type: 'move', by: me, pieceId: pc.id, to: t.to } };
    }
  }
  if (best && (best.score > 0 || !s.actedThisTurn)) return best.a;
  return { type: 'endTurn', by: me };
}

function withMoved<T>(s: GameState, pc: Piece, to: Pos, victim: Piece | undefined, fn: () => T): T {
  const from = { x: pc.x, y: pc.y };
  const saved = s.pieces;
  if (victim) s.pieces = s.pieces.filter((q) => q !== victim);
  pc.x = to.x;
  pc.y = to.y;
  try {
    return fn();
  } finally {
    pc.x = from.x;
    pc.y = from.y;
    s.pieces = saved;
  }
}

function scoreMove(s: GameState, pc: Piece, to: Pos, attack: boolean): number {
  const me = pc.owner;
  const enemy = other(me);
  const victim = attack ? pieceAt(s, to) : undefined;
  const dangerBefore = isAttacked(s, pc, enemy);
  const dangerAfter = withMoved(s, pc, to, victim, () => isAttacked(s, to, enemy));
  const f = forward(sideOf(s, me));
  let sc = 0;
  if (victim) sc += 6 + VALUE[victim.rank] * 6;
  sc += (to.y - pc.y) * f * 0.6;
  if (pc.rank !== Rank.Circle && to.y === lastRow(s, sideOf(s, me))) sc += 7;
  if (dangerAfter) sc -= VALUE[pc.rank] * 4;
  if (dangerBefore && !dangerAfter) sc += VALUE[pc.rank] * 3;
  // не уходить из стартовой зоны всеми кругами сразу
  if (!attack && pc.rank === Rank.Circle) sc -= 0.8;
  return sc;
}

function choose(s: GameState, me: PlayerId, p: Pending): Action {
  if (p.kind === 'grave') {
    const g = s.players[p.beneficiary].graveyard;
    const best = [...p.options].sort((a, b) => rankOfGrave(g, b) - rankOfGrave(g, a))[0];
    return { type: 'choose', by: me, option: best };
  }
  if (p.source === 'retreat' && p.canSkip) return { type: 'skip', by: me };

  const scored = p.options.map((o) => ({ o, sc: scoreCell(s, me, p, unkey(o)) + Math.random() * 0.3 }));
  scored.sort((a, b) => b.sc - a.sc);
  if (p.canSkip && scored[0].sc < 0) return { type: 'skip', by: me };
  return { type: 'choose', by: me, option: scored[0].o };
}

const rankOfGrave = (g: GameState['players'][number]['graveyard'], uid: string) =>
  g.find((e) => String(e.uid) === uid)?.rank ?? 0;

function scoreCell(s: GameState, me: PlayerId, p: Pending, c: Pos): number {
  const pc = pieceAt(s, c);
  const side = sideOf(s, me);
  if (p.data.spawnRank !== undefined) {
    // ставим поближе к фронту
    const rows = homeRows(s, side);
    return rows.indexOf(c.y) - Math.abs(c.x - s.mode.size / 2) * 0.05;
  }
  if (p.source === 'betrayal') {
    // ходим фигурой соперника под наш удар
    if (pc) return VALUE[pc.rank];
    return isAttacked(s, c, me) ? 5 : 0;
  }
  if (p.source === 'barrier') return Math.random();
  if (!pc) return 0;
  const mine = pc.owner === me;
  if (p.source === 'careerUp') return pc.rank === Rank.Square ? 2 : 1;
  if (p.source === 'careerDown') return mine ? -VALUE[pc.rank] + 10 : 0;
  // уничтожение / понижение / шпион — самое ценное у соперника
  return mine ? -VALUE[pc.rank] : VALUE[pc.rank] + Math.abs(c.y - lastRow(s, sideOf(s, pc.owner))) * -0.05 + 1;
}
