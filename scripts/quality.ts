// Качество игры бота: оставляет ли он фигуры под выгодным взятием и сколько теряет «даром».
// npm run quality -- <уровень> [соперник] [партий] [примеров]
// Соперник: greedy (старый бот), staller (осторожный, не идёт вперёд), или уровень (novice, amateur, master).
//
// Метрики по ходам бота:
//  - «висит»: после хода бота у соперника есть выгодное взятие (ценность жертвы минус ответное взятие > 0),
//    с учётом того, что соперник может увести свою фигуру с линии атаки. Считается по эталонным ценностям 1/3/5.
//  - «зевок»: висящее после хода минус взятое ботом за ход больше, чем висело бы, закончи бот ход сразу
//    (то есть ход ухудшил баланс материала, а не был равным разменом).
//  - «потеряно даром»: соперник взял фигуру бота, а бот в следующий ход не отыграл столько же.
import { writeFileSync } from 'node:fs';
import { createAgent, DEFAULT_CONFIG, type AgentConfig, type BotFn } from '../src/ai/agent';
import { FastBoard, newUndo, passTurn, restoreTurn } from '../src/ai/board';
import { DEFAULT_WEIGHTS, bestCapture, type Weights } from '../src/ai/eval';
import { planTurn } from '../src/ai/turn';
import { levelById } from '../src/ai/levels';
import { createGame, dispatch } from '../src/core/engine';
import { CLASSIC } from '../src/core/modes';
import type { GameState, PlayerId } from '../src/core/types';
import { botAction } from './greedy';

const REF: Weights = { ...DEFAULT_WEIGHTS, val: [1, 3, 5], xray: true };
const VAL = [1, 3, 5];

const STALLER: AgentConfig = { ...DEFAULT_CONFIG, weights: { ...DEFAULT_WEIGHTS, threat: 1.5, myThreat: 0, advance: 0, chase: 0 } };

const [level = 'master', oppName = 'master', nArg = '100', exArg = '0'] = process.argv.slice(2);
const N = Number(nArg);
let examples = Number(exArg);

const makeOpp = (seed: number): BotFn =>
  oppName === 'greedy' ? botAction : oppName === 'staller' ? createAgent(STALLER, seed) : createAgent({ ...levelById(oppName).config, budgetMs: undefined }, seed);

const st = { botTurns: 0, hang: 0, hang3: 0, avoidable: 0, hangSum: 0, worse: 0, worse3: 0, worseSum: 0, lostFree: 0, lostFreeTurns: 0, gainedFree: 0, wins: 0, losses: 0, other: 0 };
const fb = new FastBoard(12);

/** Выгодное взятие соперника `opp`, если сейчас его ход. */
function oppGain(s: GameState, opp: PlayerId): number {
  fb.load(s);
  // загрузка берёт очки действия текущего; для расчёта угроз важна только геометрия
  return bestCapture(fb, opp, REF);
}

/** Сколько висело бы, закончи бот ход в исходной позиции (до своих действий). */
function hangIfPass(s: GameState, me: PlayerId): number {
  fb.load(s);
  const save = passTurn(fb);
  const g = bestCapture(fb, (1 - me) as PlayerId, REF);
  restoreTurn(fb, save);
  return g;
}

const SAFE: Weights = { ...REF, threat: 20, myThreat: 0, advance: 0, chase: 0 };
/** Сколько висит после самого осторожного плана хода (почти только безопасность), минус взятое этим планом. */
function safestHang(s0: GameState, me: PlayerId): number {
  const b = new FastBoard(12);
  b.load(s0);
  const plan = planTurn(b, me, SAFE, { width: 8, lookahead: 0 });
  for (const stp of plan.steps) b.make(stp.pi, stp.t, newUndo());
  // загружены только живые фигуры, так что погибшие соперника — взятые этим планом
  let taken = 0;
  for (let i = 0; i < b.count; i++) if (!b.alive[i] && b.owner[i] !== me) taken += VAL[b.rank[i]];
  passTurn(b);
  return bestCapture(b, (1 - me) as PlayerId, REF) - taken;
}

function ascii(s: GameState, mark?: { x: number; y: number }) {
  const rows: string[] = [];
  for (let y = 0; y < 12; y++) {
    let r = `${String(12 - y).padStart(2)} `;
    for (let x = 0; x < 12; x++) {
      const p = s.pieces.find((q) => q.x === x && q.y === y);
      const ch = p ? (p.owner === 0 ? 'tsc' : 'TSC')[p.rank] : '.';
      r += mark && mark.x === x && mark.y === y ? `[${ch}]`.slice(0, 2) : ` ${ch}`;
    }
    rows.push(r);
  }
  rows.push('    A B C D E F G H I J K L   (строчные — игрок 0 ходит вверх, ЗАГЛАВНЫЕ — игрок 1)');
  return rows.join('\n');
}

for (let g = 0; g < N; g++) {
  const botSeat = (g % 2) as PlayerId;
  const opp = (1 - botSeat) as PlayerId;
  const bots: BotFn[] = [];
  bots[botSeat] = level === 'greedy' ? botAction : createAgent({ ...levelById(level).config, budgetMs: undefined }, g * 2 + 1);
  bots[opp] = makeOpp(g * 2 + 2);
  const s = createGame(CLASSIC, (g * 2654435761 + 555) | 0, ['A', 'B']);
  let steps = 0;
  let turnStartHang = 0;
  let turnStartState: GameState | null = null;
  // взятие соперником, ждущее ответа бота: ценность потерянного
  let owed = 0;
  let gotBack = 0;
  // взято ботом за текущий ход
  let gainedThisTurn = 0;
  while (s.phase !== 'over' && s.turn < 1500 && steps++ < 60000) {
    const who: PlayerId = s.pending ? s.pending.chooser : s.phase === 'placement' ? (s.players[0].placed ? 1 : 0) : s.current;
    if (s.phase === 'play' && who === botSeat && s.current === botSeat && !s.pending && !s.actedThisTurn && !turnStartState) {
      turnStartState = JSON.parse(JSON.stringify(s));
      turnStartHang = hangIfPass(s, botSeat);
    }
    const a = bots[who](s, who);
    if (!a) break;
    const turnBefore = s.turn;
    const curBefore = s.current;
    const r = dispatch(s, a);
    if (!r.ok) throw new Error(r.error);
    for (const e of r.events) {
      if (e.type !== 'capture' && e.type !== 'destroy') continue;
      if (e.type === 'destroy' && e.cause !== 'attack') continue;
      const victim = e.victim;
      if (victim.owner === botSeat && curBefore === opp) owed += VAL[victim.rank];
      if (victim.owner === opp && curBefore === botSeat) {
        gotBack += VAL[victim.rank];
        gainedThisTurn += VAL[victim.rank];
      }
    }
    // ход бота закончился
    if (curBefore === botSeat && s.phase === 'play' && s.turn !== turnBefore && turnStartState) {
      st.botTurns++;
      const h = oppGain(s, opp);
      if (h > 0) st.hang++;
      if (h >= 3) {
        st.hang3++;
        // можно ли было этого избежать: лучший по безопасности план из позиции начала хода
        const safe = safestHang(turnStartState, botSeat);
        if (safe + 3 <= h - gainedThisTurn) {
          st.avoidable++;
          if (examples > 0) {
            examples--;
            console.log(`\n── партия ${g}, ход ${turnBefore}: бот (игрок ${botSeat}) оставил висеть ${h} (взял ${gainedThisTurn}), а можно было ${safe}`);
            console.log('до хода бота:\n' + ascii(turnStartState));
            console.log('после хода бота:\n' + ascii(s));
            if (process.env.DUMP) writeFileSync(`${process.env.DUMP}-${g}-${turnBefore}.json`, JSON.stringify({ state: turnStartState, me: botSeat }));
          }
        }
      }
      st.hangSum += h;
      const worse = h - gainedThisTurn - turnStartHang;
      if (worse > 0) {
        st.worse++;
        st.worseSum += worse;
        if (worse >= 3) st.worse3++;
        if (examples > 0 && worse >= 3) {
          examples--;
          console.log(`\n── партия ${g}, ход ${turnBefore}: бот (игрок ${botSeat}) — висело ${turnStartHang}, взял ${gainedThisTurn}, висит ${h}`);
          console.log('до хода бота:\n' + ascii(turnStartState));
          console.log('после хода бота:\n' + ascii(s));
        }
      }
      // соперник что-то взял в свой прошлый ход: отыграл ли бот в этот
      if (owed > 0) {
        const net = owed - gotBack;
        if (net > 0) {
          st.lostFree += net;
          st.lostFreeTurns++;
        } else st.gainedFree += -net;
      } else st.gainedFree += gotBack;
      owed = 0;
      gotBack = 0;
      turnStartState = null;
      gainedThisTurn = 0;
    }
  }
  if (s.phase !== 'over') st.other++;
  else if (s.winner === botSeat) st.wins++;
  else if (s.winner === opp) st.losses++;
  else st.other++;
}

const pct = (x: number) => `${((x / Math.max(1, st.botTurns)) * 100).toFixed(1)}%`;
console.log(`\n${level} против ${oppName}, партий ${N}: побед ${st.wins}, поражений ${st.losses}, прочее ${st.other}; ходов бота ${st.botTurns}`);
console.log(`  после хода у соперника выгодное взятие: ${pct(st.hang)} ходов (≥ квадрата: ${pct(st.hang3)}, из них можно было избежать: ${pct(st.avoidable)}), в среднем ${(st.hangSum / st.botTurns).toFixed(2)}`);
console.log(`  зевки (ход ухудшил баланс): ${pct(st.worse)} ходов, из них на ≥ квадрат ${pct(st.worse3)}; в среднем −${(st.worseSum / Math.max(1, st.worse)).toFixed(2)}`);
console.log(`  потеряно даром за партию: ${(st.lostFree / N).toFixed(2)} (в ${(st.lostFreeTurns / N).toFixed(1)} ходах); получено даром: ${(st.gainedFree / N).toFixed(2)}`);
