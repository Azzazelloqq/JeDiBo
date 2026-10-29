// Партия против бота из командной строки — для игрока-агента (или человека в терминале).
// Состояние — файл с seed и журналом действий; каждый вызов переигрывает журнал и делает одно действие.
//   node play.mjs new [уровень] [seed]   — новая партия (место игрока чередуется), расстановка «Клин»
//   node play.mjs show                   — доска, ваши ходы списком, вопрос карты
//   node play.mjs move <N>               — сделать ход номер N из списка
//   node play.mjs end                    — закончить ход (после хотя бы одного действия)
//   node play.mjs card                   — сыграть карту на руках
//   node play.mjs choose <N> | skip      — ответ на вопрос карты
// После вашего действия бот сразу доигрывает свой ход; вывод показывает, что он сделал.
// Итог партии дописывается строкой JSON в файл результатов (размены и потери — по событиям движка).
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createAgent, type BotFn } from '../src/ai/agent';
import { levelById } from '../src/ai/levels';
import { CARDS } from '../src/core/karma/cards';
import { createGame, dispatch } from '../src/core/engine';
import { CLASSIC } from '../src/core/modes';
import { PRESETS } from '../src/core/presets';
import { isAttacked, legalTargets, piecesOf, sideOf } from '../src/core/rules';
import { other, type Action, type GameEvent, type GameState, type PlayerId, type Pos } from '../src/core/types';
import { TradeTracker } from './lib/trades';

const FILE = process.env.PLAY_FILE ?? 'play-state.json';
const RESULTS = process.env.PLAY_RESULTS ?? 'play-results.jsonl';
const L = 'ABCDEFGHIJKL';
const RANK = ['треугольник', 'квадрат', 'круг'];
const cell = (p: Pos) => `${L[p.x]}${12 - p.y}`;

interface Saved {
  level: string;
  seed: number;
  me: PlayerId;
  log: Action[];
}

const actor = (s: GameState): PlayerId => (s.pending ? s.pending.chooser : s.phase === 'placement' ? (s.players[0].placed ? 1 : 0) : s.current);

function load(): { sv: Saved; s: GameState; trades: TradeTracker } {
  if (!existsSync(FILE)) throw new Error('Партии нет: node play.mjs new');
  const sv = JSON.parse(readFileSync(FILE, 'utf8')) as Saved;
  const s = createGame(CLASSIC, sv.seed, ['Игрок', 'Странник']);
  const trades = new TradeTracker();
  for (const a of sv.log) apply(s, a, trades);
  return { sv, s, trades };
}

function apply(s: GameState, a: Action, trades: TradeTracker): GameEvent[] {
  const cur = s.current;
  const before = s.turn;
  const r = dispatch(s, a);
  if (!r.ok) throw new Error(`Недопустимо: ${r.error}`);
  if (s.phase !== 'placement') trades.record(cur, before, r.events, s);
  return r.events;
}

function describe(e: GameEvent, s: GameState, me: PlayerId): string | null {
  const who = (p: PlayerId) => (p === me ? 'вы' : 'бот');
  switch (e.type) {
    case 'move':
      return `ход ${cell(e.from)} → ${cell(e.to)}`;
    case 'capture':
      return `взятие ${cell(e.from)} x ${cell(e.to)}: погиб ${RANK[e.victim.rank]} (${who(e.victim.owner)})`;
    case 'destroy':
      return `уничтожен ${RANK[e.victim.rank]} на ${cell(e.victim)} (${who(e.victim.owner)}), причина: ${e.cause}`;
    case 'cardPlayed':
      return `${who(e.player)} разыграл карту «${CARDS[e.card].name}»: ${CARDS[e.card].text}`;
    case 'cardDrawn':
      return `${who(e.player)} получил карту «${CARDS[e.card].name}»`;
    case 'spawn':
      return `появился ${RANK[e.piece.rank]} на ${cell(e.piece)} (${who(e.piece.owner)})`;
    case 'rankChange':
      return `фигура сменила ранг: ${RANK[e.from]} → ${RANK[e.to]}`;
    case 'gameOver':
      return `ПАРТИЯ ОКОНЧЕНА: ${e.reason}`;
    default:
      return null;
  }
}

/** Бот делает всё, что ему положено, пока не дойдёт очередь игрока. */
function botPlays(sv: Saved, s: GameState, trades: TradeTracker, bot: BotFn): string[] {
  const out: string[] = [];
  let guard = 0;
  while (s.phase !== 'over' && actor(s) !== sv.me && guard++ < 200) {
    const who = actor(s);
    const a = bot(s, who);
    if (!a) break;
    sv.log.push(a);
    for (const e of apply(s, a, trades)) {
      const d = describe(e, s, sv.me);
      if (d) out.push('  бот: ' + d);
    }
  }
  return out;
}

function board(s: GameState, me: PlayerId): string {
  const rows: string[] = [];
  for (let y = 0; y < 12; y++) {
    let r = `${String(12 - y).padStart(2)} `;
    for (let x = 0; x < 12; x++) {
      const p = s.pieces.find((q) => q.x === x && q.y === y);
      const barrier = s.effects.some((e) => e.kind === 'barrier' && e.cells.some((c) => c.x === x && c.y === y));
      r += ' ' + (p ? (p.owner === me ? 'tsc' : 'TSC')[p.rank] : barrier ? '#' : '.');
    }
    rows.push(r);
  }
  rows.push('    A B C D E F G H I J K L');
  return rows.join('\n');
}

interface Choice {
  label: string;
  action: Action;
}

function choices(s: GameState, me: PlayerId): Choice[] {
  const out: Choice[] = [];
  if (s.pending) {
    const p = s.pending;
    p.options.forEach((o) => {
      if (p.kind === 'grave') out.push({ label: `вернуть с кладбища запись ${o}`, action: { type: 'choose', by: me, option: o } });
      else {
        const [x, y] = o.split(',').map(Number);
        const pc = s.pieces.find((q) => q.x === x && q.y === y);
        out.push({ label: `клетка ${cell({ x, y })}${pc ? ` (${RANK[pc.rank]} ${pc.owner === me ? 'ваш' : 'бота'})` : ''}`, action: { type: 'choose', by: me, option: o } });
      }
    });
    return out;
  }
  const opp = other(me);
  for (const pc of piecesOf(s, me)) {
    for (const t of legalTargets(s, pc)) {
      // что видит человек на доске: куда встаёт фигура и под ударом ли она там
      const victim = t.attack ? s.pieces.find((q) => q.x === t.to.x && q.y === t.to.y) : undefined;
      const sim = JSON.parse(JSON.stringify(s)) as GameState;
      sim.deck = [];
      dispatch(sim, { type: 'move', by: me, pieceId: pc.id, to: t.to });
      const moved = sim.pieces.find((q) => q.id === pc.id);
      const danger = moved && isAttacked(sim, moved, opp) ? ', там под ударом' : '';
      const label = t.attack
        ? `${RANK[pc.rank]} ${cell(pc)} бьёт ${RANK[victim!.rank]} на ${cell(t.to)}${danger}`
        : `${RANK[pc.rank]} ${cell(pc)} → ${cell(t.to)}${danger}`;
      out.push({ label, action: { type: 'move', by: me, pieceId: pc.id, to: t.to } });
    }
  }
  return out;
}

function show(sv: Saved, s: GameState) {
  const me = sv.me;
  const opp = other(me);
  const lines: string[] = [];
  lines.push(`Вы — игрок ${me}: строчные t/s/c (треугольник/квадрат/круг), ходите ${sideOf(s, me) === 0 ? 'вверх (к ряду 12)' : 'вниз (к ряду 1)'}. Бот — ЗАГЛАВНЫЕ. # — барьер.`);
  lines.push(board(s, me));
  if (s.phase === 'over') {
    lines.push(`Партия окончена: ${s.endReason}. Победитель: ${s.winner === me ? 'вы' : s.winner === 'draw' ? 'ничья' : 'бот'}.`);
    console.log(lines.join('\n'));
    return;
  }
  const count = (p: PlayerId) => piecesOf(s, p).map((q) => 'tsc'[q.rank]).sort().join('');
  lines.push(`Ход ${s.turn}. Ваши фигуры: ${count(me)} (${piecesOf(s, me).length}), у бота: ${count(opp).toUpperCase()} (${piecesOf(s, opp).length}).`);
  const hanging = piecesOf(s, me).filter((q) => isAttacked(s, q, opp)).map((q) => `${RANK[q.rank]} ${cell(q)}`);
  lines.push(`Ваши фигуры под ударом: ${hanging.length ? hanging.join(', ') : 'нет'}.`);
  if (s.effects.length) lines.push(`Эффекты: ${s.effects.map((e) => `${e.kind} (${e.owner === me ? 'ваш' : 'бота'})`).join(', ')}.`);
  const held = s.players[me].held;
  if (held) lines.push(`У вас на руках карта «${CARDS[held.card].name}»: ${CARDS[held.card].text} Сыграть: card.`);
  if (actor(s) !== me) lines.push('Сейчас не ваш черёд.');
  else if (s.pending) lines.push(`ВОПРОС КАРТЫ: ${s.pending.prompt}${s.pending.canSkip ? ' (можно skip)' : ''}`);
  else lines.push(`Ваш ход: очков действия ${s.ap}. Каждая фигура ходит раз за ход; взятие заканчивает ход. ${s.actedThisTurn ? 'Можно закончить ход: end.' : 'Нужно сделать хотя бы одно действие.'}`);
  if (actor(s) === me) choices(s, me).forEach((c, i) => lines.push(`  ${i + 1}. ${c.label}`));
  console.log(lines.join('\n'));
}

function finishIfOver(sv: Saved, s: GameState, trades: TradeTracker) {
  if (s.phase !== 'over') return;
  const me = sv.me;
  const bot = other(me);
  const rec = {
    at: new Date().toISOString(),
    level: sv.level,
    seed: sv.seed,
    winner: s.winner === me ? 'игрок' : s.winner === 'draw' ? 'ничья' : 'бот',
    reason: s.endReason,
    turns: s.turn,
    botTradeLoss: trades.loss[bot],
    botTradeCount: trades.count[bot],
    botFreeLoss: trades.free[bot],
    playerTradeLoss: trades.loss[me],
    playerFreeLoss: trades.free[me],
    log: sv.log,
  };
  appendFileSync(RESULTS, JSON.stringify(rec) + '\n');
  console.log(`Итог записан. Размены, проигранные ботом: ${rec.botTradeLoss} (${rec.botTradeCount} раз); бот потерял даром: ${rec.botFreeLoss}.`);
}

const [cmd = 'show', arg1, arg2] = process.argv.slice(2);
try {
  if (cmd === 'new') {
    const level = arg1 ?? 'master';
    const seed = Number(arg2 ?? Date.now() % 1_000_000);
    const games = existsSync(RESULTS) ? readFileSync(RESULTS, 'utf8').trim().split('\n').filter(Boolean).length : 0;
    const sv: Saved = { level, seed, me: (games % 2) as PlayerId, log: [] };
    const s = createGame(CLASSIC, seed, ['Игрок', 'Странник']);
    const trades = new TradeTracker();
    const bot = createAgent({ ...levelById(level).config, budgetMs: undefined }, seed + 1);
    for (const p of [0, 1] as PlayerId[]) {
      const a: Action = p === sv.me ? { type: 'place', by: p, layout: PRESETS[0].build(s, sideOf(s, p)) } : bot(s, p)!;
      sv.log.push(a);
      apply(s, a, trades);
    }
    const out = botPlays(sv, s, trades, bot);
    writeFileSync(FILE, JSON.stringify(sv));
    console.log(`Новая партия против уровня «${levelById(level).name}», seed ${seed}.`);
    if (out.length) console.log(out.join('\n'));
    show(sv, s);
  } else {
    const { sv, s, trades } = load();
    if (cmd !== 'show') {
      if (s.phase === 'over') throw new Error('Партия окончена — начните новую: new');
      if (actor(s) !== sv.me) throw new Error('Сейчас не ваш черёд');
      let a: Action;
      if (cmd === 'move' || cmd === 'choose') {
        const list = choices(s, sv.me);
        const c = list[Number(arg1) - 1];
        if (!c) throw new Error(`Нет варианта ${arg1}; всего ${list.length}`);
        a = c.action;
      } else if (cmd === 'end') a = { type: 'endTurn', by: sv.me };
      else if (cmd === 'card') a = { type: 'playCard', by: sv.me };
      else if (cmd === 'skip') a = { type: 'skip', by: sv.me };
      else throw new Error(`Неизвестная команда ${cmd}`);
      sv.log.push(a);
      const mine = apply(s, a, trades).map((e) => describe(e, s, sv.me)).filter(Boolean);
      if (mine.length) console.log(mine.map((d) => '  вы: ' + d).join('\n'));
      const bot = createAgent({ ...levelById(sv.level).config, budgetMs: undefined }, sv.seed + sv.log.length);
      const out = botPlays(sv, s, trades, bot);
      if (out.length) console.log(out.join('\n'));
      writeFileSync(FILE, JSON.stringify(sv));
      finishIfOver(sv, s, trades);
    }
    show(sv, s);
  }
} catch (e) {
  console.log(`ОШИБКА: ${(e as Error).message}`);
  process.exitCode = 1;
}
