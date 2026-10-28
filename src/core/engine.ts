// Движок: createGame + dispatch(action). Детерминирован и не знает о DOM/времени —
// оба пира в p2p могут гонять один и тот же поток действий и получать одинаковое состояние.
import { CARDS, fullDeck } from './karma/cards';
import { RANK_NAME, checkPromotion, destroy, log, spawn, startPromotion, type Ctx } from './ops';
import { randInt, shuffle } from './rng';
import { anyLegalAction, canAct, hasEffect, homeRows, lastRow, legalTargets, pieceAt, piecesOf, sideOf, spawnCells } from './rules';
import { START_ARMY } from './modes';
import { Rank, key, other, unkey, type Action, type GameEvent, type GameState, type ModeConfig, type Pending, type PlayerId } from './types';

export interface Result {
  ok: boolean;
  error?: string;
  events: GameEvent[];
}

const newPlayer = (id: PlayerId, name: string): GameState['players'][number] => ({
  id,
  name,
  color: 'red',
  side: id,
  ownTurns: 0,
  graveyard: [],
  held: null,
  placed: false,
});

export function createGame(mode: ModeConfig, seed: number, names: [string, string]): GameState {
  const s: GameState = {
    mode,
    seed,
    rng: seed,
    phase: 'placement',
    nextId: 1,
    pieces: [],
    players: [newPlayer(0, names[0]), newPlayer(1, names[1])],
    current: 0,
    turn: 0,
    ap: 0,
    actedThisTurn: false,
    deck: [],
    discard: [],
    played: [],
    effects: [],
    pending: null,
    queue: [],
    endAfterPending: false,
    winner: null,
    endReason: null,
    draw: null,
  };
  // цвета — случайно; колода матча — 21 случайная карта из 34
  const redFirst = randInt(s, 2);
  s.players[0].color = redFirst ? 'red' : 'black';
  s.players[1].color = redFirst ? 'black' : 'red';
  s.deck = shuffle(s, fullDeck()).slice(0, mode.matchDeckSize);
  return s;
}

export function dispatch(s: GameState, a: Action): Result {
  const err = validate(s, a);
  if (err) return { ok: false, error: err, events: [] };
  const c: Ctx = { s, ev: [] };
  switch (a.type) {
    case 'place':
      for (const l of a.layout) spawn(c, a.by, l.rank, l);
      s.players[a.by].placed = true;
      c.ev.push({ type: 'placed', player: a.by });
      if (s.players.every((p) => p.placed)) {
        s.phase = 'play';
        c.ev.push({ type: 'start' });
        startTurn(c, randInt(s, 2) as PlayerId);
      }
      break;
    case 'move':
      doMove(c, a.pieceId, a.to);
      break;
    case 'endTurn':
      endTurn(c);
      break;
    case 'playCard':
      playHeld(c, a.by);
      break;
    case 'choose':
    case 'skip':
      resolvePending(c, a.type === 'choose' ? a.option : null);
      break;
    case 'resign':
      finish(c, other(a.by), `${s.players[a.by].name} ${a.left ? 'покинул партию' : 'сдаётся'}`);
      break;
    case 'timeout':
      if (a.total) finish(c, other(a.by), `У ${s.players[a.by].name} закончилось общее время`);
      else {
        log(c, 'Время хода истекло', a.by);
        autoResolve(c);
        endTurn(c);
      }
      break;
  }
  afterAction(c);
  return { ok: true, events: c.ev };
}

// ── validation ──────────────────────────────────────────────────────────────

function validate(s: GameState, a: Action): string | null {
  if (s.phase === 'over') return 'Партия окончена';
  if (a.type === 'place') {
    if (s.phase !== 'placement' || s.players[a.by].placed) return 'Расстановка уже сделана';
    const rows = homeRows(s, sideOf(s, a.by));
    const cnt = [0, 0, 0];
    const seen = new Set<string>();
    for (const l of a.layout) {
      if (!rows.includes(l.y) || l.x < 0 || l.x >= s.mode.size) return 'Фигура вне стартовой зоны';
      if (seen.has(key(l))) return 'Две фигуры в одной клетке';
      seen.add(key(l));
      cnt[l.rank]++;
    }
    if (cnt[0] !== START_ARMY.triangles || cnt[1] !== START_ARMY.squares || cnt[2] !== START_ARMY.circles)
      return 'Неполная армия';
    return null;
  }
  if (s.phase !== 'play') return 'Партия ещё не началась';
  if (a.type === 'resign') return null;
  if (a.type === 'timeout') return a.by === s.current || a.total ? null : 'Не ваш ход';
  if (a.type === 'choose' || a.type === 'skip') {
    const p = s.pending;
    if (!p || p.chooser !== a.by) return 'Нет выбора';
    if (a.type === 'skip') return p.canSkip ? null : 'Нельзя пропустить';
    return p.options.includes(a.option) ? null : 'Недопустимый выбор';
  }
  if (a.by !== s.current) return 'Не ваш ход';
  if (s.pending) return 'Сначала завершите выбор';
  if (a.type === 'endTurn') return s.actedThisTurn || !anyLegalAction(s) ? null : 'Сделайте хотя бы одно действие';
  if (a.type === 'playCard') {
    const h = s.players[a.by].held;
    if (!h) return 'Нет карты';
    const def = CARDS[h.card];
    return !def.canPlay || def.canPlay(s, a.by) ? null : 'Сейчас карту не разыграть';
  }
  if (a.type === 'move') {
    const pc = s.pieces.find((q) => q.id === a.pieceId);
    if (!pc || !canAct(s, pc)) return 'Фигура не может действовать';
    return legalTargets(s, pc).some((t) => t.to.x === a.to.x && t.to.y === a.to.y) ? null : 'Недопустимый ход';
  }
  return 'Неизвестное действие';
}

// ── turn flow ──────────────────────────────────────────────────────────────

function startTurn(c: Ctx, p: PlayerId) {
  const s = c.s;
  s.current = p;
  s.turn++;
  const pl = s.players[p];
  pl.ownTurns++;
  s.ap = s.mode.ap;
  s.actedThisTurn = false;
  for (const pc of s.pieces) pc.acted = false;
  c.ev.push({ type: 'turnStart', player: p, ownTurn: pl.ownTurns });

  // отложенные повышения
  for (const pc of piecesOf(s, p).filter((q) => q.promoteNextTurn)) {
    if (pc.y === lastRow(s, sideOf(s, p))) {
      log(c, `${RANK_NAME[pc.rank]} пережил ход соперника — повышение`, p);
      startPromotion(c, pc, false);
    } else pc.promoteNextTurn = false;
  }

  // Карма: в начале последнего хода каждого цикла
  if (pl.ownTurns % s.mode.karmaEvery === 0 && s.deck.length) {
    const card = s.deck.splice(randInt(s, s.deck.length), 1)[0];
    c.ev.push({ type: 'cardDrawn', player: p, card });
    const def = CARDS[card];
    if (def.timing === 'period') {
      pl.held = { card, untilOwnTurn: pl.ownTurns + s.mode.karmaEvery - 1 };
      log(c, `Карма: «${def.name}» — можно сыграть до конца Периода`, p);
    } else playCard(c, p, card);
  }
}

function playCard(c: Ctx, p: PlayerId, card: GameState['deck'][number]) {
  const s = c.s;
  const def = CARDS[card];
  const ok = def.play(c, p);
  if (!ok) {
    s.discard.push(card);
    c.ev.push({ type: 'cardDiscarded', player: p, card, reason: 'Карта не может быть разыграна' });
    return;
  }
  s.played.push(card);
  c.ev.push({ type: 'cardPlayed', player: p, card });
  if (def.takesTurn) {
    if (s.pending) s.endAfterPending = true;
    else endTurn(c);
  }
}

function playHeld(c: Ctx, p: PlayerId) {
  const h = c.s.players[p].held!;
  c.s.players[p].held = null;
  playCard(c, p, h.card);
}

function endTurn(c: Ctx) {
  const s = c.s;
  if (s.phase !== 'play') return;
  const p = s.current;
  const own = s.players[p].ownTurns;
  s.endAfterPending = false;

  for (const e of s.effects.filter((e) => e.owner === p && e.untilOwnTurn <= own))
    c.ev.push({ type: 'effectEnd', kind: e.kind, owner: e.owner });
  s.effects = s.effects.filter((e) => !(e.owner === p && e.untilOwnTurn <= own));

  const held = s.players[p].held;
  if (held && held.untilOwnTurn <= own) {
    s.players[p].held = null;
    s.discard.push(held.card);
    c.ev.push({ type: 'cardDiscarded', player: p, card: held.card, reason: 'Период Кармы истёк' });
  }

  if (checkWin(c)) return;
  if (checkDraw(c)) return;
  startTurn(c, other(p));
}

/** После каждого действия: очередь вопросов, автозавершение хода, победа. */
function afterAction(c: Ctx) {
  const s = c.s;
  if (s.phase !== 'play') return;
  if (checkWin(c)) return;
  let guard = 0;
  while (guard++ < 64) {
    if (!s.pending && s.queue.length) s.pending = s.queue.shift()!;
    if (s.pending) {
      // вопрос мог ждать в очереди или устареть в том же действии — варианты по текущей позиции
      s.pending.options = liveOptions(s, s.pending);
      if (s.pending.options.length) return;
      s.pending = null;
      continue;
    }
    if (s.endAfterPending) {
      endTurn(c);
      continue;
    }
    if (s.phase !== 'play') return;
    if (s.ap <= 0 || (!anyLegalAction(s) && !heldPlayable(s))) {
      if (!s.actedThisTurn && s.ap > 0) log(c, 'Нет доступных действий — ход передан', s.current);
      const before = s.turn;
      endTurn(c);
      if (s.turn === before) return;
      continue;
    }
    return;
  }
}

/**
 * Время вышло, а вопросы открыты: они не отменяются, а доигрываются. Обязательный выбор (куда поставить
 * фигуру, чью фигуру уничтожить…) делается случайно, необязательный (Отступление, Предательство) пропускается.
 */
function autoResolve(c: Ctx) {
  const s = c.s;
  for (let guard = 0; guard < 64; guard++) {
    if (!s.pending && s.queue.length) s.pending = s.queue.shift()!;
    const p = s.pending;
    if (!p) return;
    p.options = liveOptions(s, p);
    if (!p.options.length) {
      s.pending = null;
      continue;
    }
    const skip = p.canSkip || p.source === 'betrayal';
    resolvePending(c, skip ? null : p.options[randInt(s, p.options.length)]);
  }
}

function liveOptions(s: GameState, p: Pending): string[] {
  if (p.source === 'promotion') {
    const pc = s.pieces.find((q) => q.id === p.data.promoteId);
    if (!pc || pc.owner !== p.beneficiary) return [];
  }
  if (p.data.spawnRank !== undefined) return spawnCells(s, p.beneficiary).map(key);
  if (p.kind === 'grave') {
    const uids = new Set(s.players[p.beneficiary].graveyard.map((g) => String(g.uid)));
    return p.options.filter((o) => uids.has(o));
  }
  return p.source === 'promotion' ? p.options : CARDS[p.source].refresh?.(s, p) ?? p.options;
}

const heldPlayable = (s: GameState) => {
  const h = s.players[s.current].held;
  if (!h) return false;
  const d = CARDS[h.card];
  return !d.canPlay || d.canPlay(s, s.current);
};

// ── actions ────────────────────────────────────────────────────────────────

function doMove(c: Ctx, id: number, to: { x: number; y: number }) {
  const s = c.s;
  const pc = s.pieces.find((q) => q.id === id)!;
  const t = legalTargets(s, pc).find((q) => q.to.x === to.x && q.to.y === to.y)!;
  const from = { x: pc.x, y: pc.y };

  const blitz = hasEffect(s, 'blitz', pc.owner);
  if (blitz && !blitz.done) {
    if (blitz.pieceId === null) blitz.pieceId = pc.id;
    else if (blitz.pieceId !== pc.id) blitz.done = true;
  }
  if (t.jump) {
    s.effects = s.effects.filter((e) => !(e.kind === 'jumper' && e.owner === pc.owner));
    log(c, 'Прыгун: прыжок через препятствие', pc.owner);
  }

  pc.acted = true;
  s.actedThisTurn = true;
  if (t.attack) {
    const victim = pieceAt(s, to)!;
    destroy(c, victim, 'attack');
    c.ev.pop(); // заменяем generic destroy на capture
    c.ev.push({ type: 'capture', attackerId: pc.id, victim: { ...victim }, from, to });
    pc.x = to.x;
    pc.y = to.y;
    s.ap = 0;
  } else {
    pc.x = to.x;
    pc.y = to.y;
    c.ev.push({ type: 'move', pieceId: pc.id, from, to, jump: t.jump });
    s.ap -= 1;
  }
  if (blitz && pc.y === lastRow(s, sideOf(s, pc.owner))) blitz.done = true;
  checkPromotion(c, pc, true);
}

function resolvePending(c: Ctx, option: string | null) {
  const s = c.s;
  const pend = s.pending!;
  s.pending = null;
  // общий шаг «поставить фигуру» (повышение, Подарок, Воскрешение…)
  if (pend.data.spawnRank !== undefined && option !== null) {
    if (pend.data.promoteId !== undefined) {
      const old = s.pieces.find((q) => q.id === pend.data.promoteId);
      if (old) {
        s.pieces = s.pieces.filter((q) => q.id !== old.id);
        c.ev.push({ type: 'promoteRemove', piece: { ...old } });
      }
    }
    const pc = spawn(c, pend.beneficiary, pend.data.spawnRank as Rank, unkey(option), !!pend.data.acted);
    if (pend.source === 'promotion') log(c, `Повышение: ${RANK_NAME[pc.rank]}`, pc.owner);
    return;
  }
  if (pend.source !== 'promotion') CARDS[pend.source].onChoice?.(c, pend, option);
}

// ── end of game ────────────────────────────────────────────────────────────

function finish(c: Ctx, winner: PlayerId | 'draw', reason: string) {
  const s = c.s;
  s.phase = 'over';
  s.winner = winner;
  s.endReason = reason;
  s.pending = null;
  s.queue = [];
  c.ev.push({ type: 'gameOver', winner, reason });
}

function checkWin(c: Ctx): boolean {
  const s = c.s;
  if (s.phase !== 'play') return true;
  const a = piecesOf(s, 0).length;
  const b = piecesOf(s, 1).length;
  if (a && b) return false;
  if (!a && !b) finish(c, 'draw', 'Фигуры уничтожены у обоих');
  else finish(c, a ? 0 : 1, `Все фигуры ${s.players[a ? 1 : 0].name} уничтожены`);
  return true;
}

/** Ничья: 1×1 одного ранга или 2×2 с одинаковым набором — 3 Периода Кармы без изменений. */
function checkDraw(c: Ctx): boolean {
  const s = c.s;
  const sig = (p: PlayerId) => piecesOf(s, p).map((q) => q.rank).sort().join('');
  const a = sig(0);
  const b = sig(1);
  if (a !== b || a.length > 2) {
    s.draw = null;
    return false;
  }
  if (!s.draw || s.draw.signature !== a) {
    s.draw = { signature: a, turns: 0 };
    return false;
  }
  s.draw.turns++;
  if (s.draw.turns >= s.mode.karmaEvery * 3 * 2) {
    finish(c, 'draw', 'Состав не менялся три Периода Кармы');
    return true;
  }
  return false;
}

export { canAct, legalTargets };
