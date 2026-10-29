// Автотесты бота и движка. npm test (запускается и в CI перед сборкой).
// Быстрые и детерминированные: боты со своим seed, без бюджета времени. Статистика силы — npm run arena / quality.
import { createAgent, type BotFn } from '../src/ai/agent';
import { ATTACK, CELL_MASK, FastBoard, newUndo, passTurn } from '../src/ai/board';
import { DEFAULT_WEIGHTS, bestCapture, type Weights } from '../src/ai/eval';
import { LEVELS, levelById, type LevelId } from '../src/ai/levels';
import { searchTurn } from '../src/ai/search';
import { clocksAfter, expiredClock, newClocks, spendTime, type Clocks } from '../src/core/clocks';
import { createGame, dispatch } from '../src/core/engine';
import { ALL_CARDS, fullDeck } from '../src/core/karma/cards';
import { CLASSIC } from '../src/core/modes';
import { PRESETS } from '../src/core/presets';
import { tutorialEnemy, tutorialState, tutorialStep } from '../src/core/tutorial';
import { heldExpiresThisTurn, homeRows, isAttacked, legalTargets, targetsOf } from '../src/core/rules';
import { Rank, type Action, type GameState, type Piece, type PlayerId } from '../src/core/types';
import { botAction as greedy } from './greedy';
import prepCapture from './fixtures/prep-capture.json';
import { checkBoard, collectPositions, lcg } from './lib/boardcheck';
import { fuzz } from './lib/fuzz';

// ── мини-раннер ─────────────────────────────────────────────────────────────
const tests: { name: string; fn: () => void }[] = [];
const test = (name: string, fn: () => void) => tests.push({ name, fn });
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s));
const botOf = (level: LevelId, seed: number): BotFn => createAgent({ ...levelById(level).config, budgetMs: undefined }, seed);
const actor = (s: GameState): PlayerId => (s.pending ? s.pending.chooser : s.phase === 'placement' ? (s.players[0].placed ? 1 : 0) : s.current);

/** Партия двух ботов; бросает ошибку, если бот не дал действия или движок его отклонил. */
function playGame(bots: [BotFn, BotFn], seed: number, opts: { limit?: number; noKarma?: boolean } = {}) {
  const s = createGame(CLASSIC, seed, ['A', 'B']);
  if (opts.noKarma) s.deck = [];
  const log: Action[] = [];
  while (s.phase !== 'over' && s.turn <= (opts.limit ?? 1500)) {
    const who = actor(s);
    const a = bots[who](s, who);
    assert(a, `seed ${seed}, ход ${s.turn}: бот ${who} не дал действия`);
    let r;
    try {
      r = dispatch(s, a);
    } catch (e) {
      throw new Error(`seed ${seed}, ход ${s.turn}: движок упал на действии бота ${JSON.stringify(a)}: ${(e as Error).message}`);
    }
    assert(r.ok, `seed ${seed}, ход ${s.turn}: недопустимое действие ${JSON.stringify(a)}: ${r.error}`);
    log.push(a);
  }
  return { s, log };
}

const REF: Weights = { ...DEFAULT_WEIGHTS, val: [1, 3, 5], xray: true };
const cellName = (c: number) => `${'ABCDEFGHIJKL'[c % 12]}${12 - Math.floor(c / 12)}`;
const at = (name: string) => ({ x: name.charCodeAt(0) - 65, y: 12 - Number(name.slice(1)) });

/** Позиция в начале хода `current` из списка фигур [владелец, ранг, клетка «E5»]. Колода пуста. */
function position(pieces: [PlayerId, Rank, string][], current: PlayerId): GameState {
  const s = createGame(CLASSIC, 1, ['A', 'B']);
  s.phase = 'play';
  s.players.forEach((p) => (p.placed = true));
  s.players[current].ownTurns = 1;
  s.pieces = pieces.map(([owner, rank, c], i): Piece => ({ id: i + 1, owner, rank, ...at(c), acted: false, promoteNextTurn: false }));
  s.nextId = pieces.length + 1;
  s.current = current;
  s.turn = 1;
  s.ap = s.mode.ap;
  s.deck = [];
  return s;
}

/** План хода уровня (через поиск, как в игре) и что после него висит у соперника. */
function planOf(s: GameState, level: LevelId) {
  const cfg = levelById(level).config;
  const b = FastBoard.fromState(s);
  const me = s.current;
  const res = searchTurn(b, me, cfg.weights, cfg.turn, cfg.search);
  const steps = res.scored[0].steps;
  const desc = steps.map((st) => `${'tsc'[b.rank[st.pi]]}${st.t & ATTACK ? 'x' : '-'}${cellName(st.t & CELL_MASK)}`);
  for (const st of steps) b.make(st.pi, st.t, newUndo());
  passTurn(b);
  return { steps, desc, hanging: bestCapture(b, (1 - me) as PlayerId, REF) };
}

// ── тесты ───────────────────────────────────────────────────────────────────

test('быстрая доска совпадает с движком (ходы, атаки, ход и откат, эффекты Кармы)', () => {
  const rnd = lcg(777);
  const positions = collectPositions(12, (g) => [botOf('novice', g * 2 + 1), botOf('novice', g * 2 + 2)], rnd, 0.1);
  assert(positions.length >= 200, `мало позиций: ${positions.length}`);
  const { fails, stats } = checkBoard(positions, rnd, 0.3);
  assert(fails.length === 0, `расхождений ${fails.length}, первое: ${fails[0]}`);
  assert(stats.dispatchCompared > 1000, `мало проверенных ходов: ${stats.dispatchCompared}`);
});

for (const l of LEVELS) {
  const games = l.id === 'master' ? 2 : 4;
  test(`${l.name}: только допустимые действия, партии доигрываются (${games} партий)`, () => {
    for (let g = 0; g < games; g++) {
      const seed = 1000 + g * 31;
      const { s } = playGame([botOf(l.id, seed), botOf(l.id, seed + 1)], seed);
      assert(s.phase === 'over', `seed ${seed}: партия не закончилась за ${s.turn} ходов`);
    }
  });
}

test('одинаковый seed — одинаковая партия бота', () => {
  const run = () => playGame([botOf('amateur', 5), botOf('amateur', 6)], 4242).log;
  const a = JSON.stringify(run());
  const b = JSON.stringify(run());
  assert(a === b, 'партии с одинаковым seed разошлись');
});

test('бот не подсматривает будущие карты (колода и ГСЧ партии не влияют на решения)', () => {
  // точки решений из партии: начало хода и вопросы карт
  const s = createGame(CLASSIC, 9001, ['A', 'B']);
  const bots: [BotFn, BotFn] = [botOf('amateur', 1), botOf('amateur', 2)];
  const points: GameState[] = [];
  while (s.phase !== 'over' && s.turn < 400) {
    const who = actor(s);
    if (s.phase === 'play' && (s.pending || !s.actedThisTurn)) points.push(clone(s));
    const a = bots[who](s, who);
    if (!a) break;
    dispatch(s, a);
  }
  const sample = points.filter((_, i) => i % 3 === 0);
  assert(sample.length >= 20, `мало точек решений: ${sample.length}`);
  let pendings = 0;
  for (const p of sample) {
    const who = actor(p);
    const honest = botOf('amateur', 77)(clone(p), who);
    const peek = clone(p);
    peek.deck = peek.deck.map(() => 'deathLine' as const);
    peek.rng = (peek.rng ^ 0x5bd1e995) | 0;
    const other = botOf('amateur', 77)(peek, who);
    assert(JSON.stringify(honest) === JSON.stringify(other), `ход ${p.turn}: решение зависит от колоды/ГСЧ: ${JSON.stringify(honest)} ≠ ${JSON.stringify(other)}`);
    if (p.pending) pendings++;
  }
  assert(pendings > 0, 'в выборке нет вопросов карт');
});

test('бот не подсматривает карту, которую соперник вытянет после его выбора', () => {
  // последний выбор «Двойной смерти врага» заканчивает ход; соперник на своём 7-м ходу тянет «Линию смерти»,
  // столбец которой задаёт ГСЧ партии. Бот, перебирающий варианты на копии с настоящей колодой, увидел бы столбец.
  const pieces: [PlayerId, Rank, string][] = [[0, Rank.Circle, 'F1'], [0, Rank.Triangle, 'A1']];
  for (const col of 'ABCDEFGHIJKL') pieces.push([1, Rank.Triangle, `${col}10`]);
  const base = position(pieces, 0);
  base.players[1].ownTurns = 6;
  base.deck = ['deathLine'];
  base.endAfterPending = true;
  base.pending = {
    source: 'doubleDeathEnemy',
    chooser: 0,
    beneficiary: 0,
    kind: 'cell',
    options: base.pieces.filter((q) => q.owner === 1).map((q) => `${q.x},${q.y}`),
    canSkip: false,
    prompt: 'Уничтожьте фигуру соперника 2/2',
    step: 1,
    data: {},
  };
  // разные состояния ГСЧ — разные столбцы «Линии смерти»
  const columnOf = (rng: number) => {
    const c = clone(base);
    c.rng = rng;
    dispatch(c, { type: 'choose', by: 0, option: c.pending!.options[0] });
    return c.pieces.map((q) => `${q.x},${q.y}`).sort().join(' ');
  };
  // нужны все 12 столбцов, в том числе тот, где стоит первый вариант (иначе подсматривание не меняет выбор)
  const seen = new Map<string, number>();
  for (let r = 1; r < 5000 && seen.size < 12; r++) seen.set(columnOf(r * 7919), r * 7919);
  assert(seen.size === 12, `получено столбцов «Линии смерти»: ${seen.size} из 12`);
  const choices = new Set<string>();
  for (const rng of seen.values()) {
    const s = clone(base);
    s.rng = rng;
    choices.add(JSON.stringify(botOf('master', 3)(s, 0)));
  }
  assert(choices.size === 1, `выбор зависит от будущей карты: ${[...choices].join(' | ')}`);
});

test('тактика: увести фигуру из-под удара и взять (позиция из партии)', () => {
  const state = prepCapture.state as unknown as GameState;
  const { steps, desc, hanging } = planOf(state, 'master');
  const last = steps[steps.length - 1];
  assert(last && last.t & ATTACK && cellName(last.t & CELL_MASK) === 'F2', `ожидалось взятие на F2, план: ${desc.join(' ')}`);
  assert(hanging === 0, `после плана висит ${hanging}: ${desc.join(' ')}`);
});

test('тактика: взять незащищённый круг', () => {
  const s = position(
    [
      [0, Rank.Circle, 'E3'], [0, Rank.Triangle, 'A1'], [0, Rank.Triangle, 'B1'],
      [1, Rank.Circle, 'E7'], [1, Rank.Triangle, 'A12'], [1, Rank.Triangle, 'L12'],
    ],
    0,
  );
  for (const level of ['amateur', 'master'] as LevelId[]) {
    const { desc } = planOf(s, level);
    assert(desc.includes('cxE7'), `${level}: не взял круг на E7, план: ${desc.join(' ')}`);
  }
});

test('тактика: не менять круг на защищённый треугольник', () => {
  // треугольник E7 защищён треугольником D8 (игрок 1 ходит вниз, бьёт по диагонали вперёд)
  const s = position(
    [
      [0, Rank.Circle, 'E3'], [0, Rank.Triangle, 'A1'], [0, Rank.Triangle, 'B1'],
      [1, Rank.Triangle, 'E7'], [1, Rank.Triangle, 'D8'], [1, Rank.Triangle, 'A12'], [1, Rank.Triangle, 'L12'],
    ],
    0,
  );
  for (const level of ['amateur', 'master'] as LevelId[]) {
    const { desc, hanging } = planOf(s, level);
    assert(!desc.includes('cxE7'), `${level}: отдал круг за треугольник, план: ${desc.join(' ')}`);
    assert(hanging === 0, `${level}: после хода висит ${hanging}, план: ${desc.join(' ')}`);
  }
});

// ── движок ──────────────────────────────────────────────────────────────────

/** Каждый вариант открытого вопроса принимается движком (на копии). */
function assertPendingAnswerable(s: GameState, what: string) {
  const p = s.pending;
  assert(p, `${what}: нет вопроса`);
  assert(p.options.length || p.canSkip, `${what}: вопрос без вариантов`);
  for (const option of p.options) {
    let r;
    try {
      r = dispatch(clone(s), { type: 'choose', by: p.chooser, option });
    } catch (e) {
      throw new Error(`${what}: движок упал на варианте ${option}: ${(e as Error).message}`);
    }
    assert(r.ok, `${what}: вариант ${option} отклонён: ${r.error}`);
  }
}

test('вопрос из очереди не предлагает фигуру, которой уже нет (Предательство + повышение)', () => {
  // соперник «Предательством» выводит квадрат игрока 0 на последний ряд; пока игрок 0 ставит повышенную фигуру,
  // следующий вопрос «Предательства» ждёт в очереди — квадрат к его открытию уже снят с доски
  const s = position([[0, Rank.Square, 'D11'], [0, Rank.Triangle, 'G4'], [1, Rank.Triangle, 'L1']], 1);
  s.players[0].ownTurns = 6;
  s.actedThisTurn = true;
  s.deck = ['betrayal'];
  dispatch(s, { type: 'endTurn', by: 1 });
  assert(s.pending?.source === 'betrayal', `ожидалось Предательство, вопрос: ${s.pending?.source}`);
  const square = `${at('D11').x},${at('D11').y}`;
  const lastRow = `${at('D12').x},${at('D12').y}`;
  assert(dispatch(s, { type: 'choose', by: 1, option: square }).ok, 'соперник не смог выбрать квадрат');
  assert(dispatch(s, { type: 'choose', by: 1, option: lastRow }).ok, 'соперник не смог сдвинуть квадрат на последний ряд');
  assert(s.pending?.source === 'promotion', `ожидалось повышение, вопрос: ${s.pending?.source}`);
  assert(dispatch(s, { type: 'choose', by: 0, option: s.pending.options[0] }).ok, 'повышение не применилось');
  assert(s.pending?.source === 'betrayal', `ожидалось продолжение Предательства, вопрос: ${s.pending?.source}`);
  assert(!s.pending.options.includes(lastRow), `в вариантах осталась снятая фигура ${lastRow}`);
  assertPendingAnswerable(s, 'Предательство после повышения');
});

/** Фигуры игрока на всех клетках рядов `rows` (номера рядов 1–12, как на доске), кроме `except`. */
function fillRows(owner: PlayerId, rows: number[], except: string[] = []): [PlayerId, Rank, string][] {
  const out: [PlayerId, Rank, string][] = [];
  for (const n of rows) for (const col of 'ABCDEFGHIJKL') if (!except.includes(`${col}${n}`)) out.push([owner, Rank.Triangle, `${col}${n}`]);
  return out;
}
const optionNames = (s: GameState) => s.pending!.options.map((o) => cellName(Number(o.split(',')[1]) * 12 + Number(o.split(',')[0]))).sort();

test('повышение: новая фигура — в стартовую зону, без места — в 4-й ряд, дальше — в ближайший ряд со свободной клеткой', () => {
  // треугольник игрока 0 с L11 выходит на последний ряд L12; соперник далеко и его не атакует
  const promote = (own: [PlayerId, Rank, string][]) => {
    const s = position([[0, Rank.Triangle, 'L11'], ...own, [1, Rank.Triangle, 'A10']], 0);
    const pc = s.pieces.find((q) => cellName(q.y * 12 + q.x) === 'L11')!;
    assert(dispatch(s, { type: 'move', by: 0, pieceId: pc.id, to: at('L12') }).ok, 'ход на последний ряд отклонён');
    assert(s.pending?.source === 'promotion', `ожидалось повышение, вопрос: ${s.pending?.source}`);
    return optionNames(s);
  };
  const home = promote(fillRows(0, [1, 2, 3], ['C2']));
  assert(home.join() === 'C2', `в стартовой зоне свободна только C2, варианты: ${home.join(' ')}`);
  const fourth = promote(fillRows(0, [1, 2, 3]));
  assert(fourth.length === 12 && fourth.every((c) => /^[A-L]4$/.test(c)), `ожидался весь 4-й ряд, варианты: ${fourth.join(' ')}`);
  const next = promote(fillRows(0, [1, 2, 3, 4, 5], ['H5']).concat(fillRows(0, [6], ['B6', 'C6'])));
  assert(next.join() === 'H5', `ожидалась единственная свободная клетка 5-го ряда H5, варианты: ${next.join(' ')}`);
  const far = promote(fillRows(0, [1, 2, 3, 4, 5, 6, 7, 8], ['E8']));
  assert(far.join() === 'E8', `ожидалась клетка E8 (8-й ряд), варианты: ${far.join(' ')}`);
});

test('Подарок: круг — в стартовую зону, без места — в следующий ряд со свободной клеткой', () => {
  // игрок 0 тянет Карму на своём 7-м ходу
  const gift = (own: [PlayerId, Rank, string][]) => {
    const s = position([...own, [1, Rank.Triangle, 'A10']], 1);
    s.players[0].ownTurns = 6;
    s.actedThisTurn = true;
    s.deck = ['gift'];
    dispatch(s, { type: 'endTurn', by: 1 });
    assert(s.pending?.source === 'gift', `ожидался Подарок, вопрос: ${s.pending?.source}`);
    return optionNames(s);
  };
  const fourth = gift(fillRows(0, [1, 2, 3]));
  assert(fourth.length === 12 && fourth.every((c) => /^[A-L]4$/.test(c)), `ожидался весь 4-й ряд, варианты: ${fourth.join(' ')}`);
  const fifth = gift(fillRows(0, [1, 2, 3, 4], []).concat(fillRows(0, [5], ['J5'])));
  assert(fifth.join() === 'J5', `ожидалась J5, варианты: ${fifth.join(' ')}`);
});

test('Предательство: каждую фигуру соперник двигает не больше одного раза', () => {
  const s = position([[0, Rank.Circle, 'F6'], [0, Rank.Triangle, 'A2'], [1, Rank.Triangle, 'L10']], 1);
  s.players[0].ownTurns = 6;
  s.actedThisTurn = true;
  s.deck = ['betrayal'];
  dispatch(s, { type: 'endTurn', by: 1 });
  const opt = (name: string) => `${at(name).x},${at(name).y}`;
  assert(s.pending?.source === 'betrayal', `ожидалось Предательство, вопрос: ${s.pending?.source}`);
  assert(dispatch(s, { type: 'choose', by: 1, option: opt('F6') }).ok, 'соперник не смог выбрать круг');
  assert(dispatch(s, { type: 'choose', by: 1, option: opt('F7') }).ok, 'соперник не смог сдвинуть круг');
  assert(s.pending?.source === 'betrayal', `ожидалось второе перемещение, вопрос: ${s.pending?.source}`);
  assert(!s.pending.options.includes(opt('F7')), `сдвинутый круг снова предложен: ${optionNames(s).join(' ')}`);
  assert(optionNames(s).join() === 'A2', `ожидался только треугольник A2, варианты: ${optionNames(s).join(' ')}`);
  assert(dispatch(s, { type: 'choose', by: 1, option: opt('A2') }).ok, 'соперник не смог выбрать треугольник');
  assert(dispatch(s, { type: 'choose', by: 1, option: opt('A3') }).ok, 'соперник не смог сдвинуть треугольник');
  // двигать больше нечего — карта закончилась, ход (Предательство занимает ход) перешёл к сопернику
  assert(!s.pending, `остался вопрос «${s.pending?.source}»: ${s.pending && optionNames(s).join(' ')}`);
  assert(s.current === 1, 'ход не перешёл к сопернику');
});

/** Игрок 0 получает карту `card` в начале своего 7-го хода; у него фигуры `own`, у соперника — треугольник L10. */
function receive(card: GameState['deck'][number], own: [PlayerId, Rank, string][], prep?: (s: GameState) => void): GameState {
  const s = position([...own, [1, Rank.Triangle, 'L10']], 1);
  prep?.(s);
  s.players[0].ownTurns = 6;
  s.actedThisTurn = true;
  s.deck = [card];
  dispatch(s, { type: 'endTurn', by: 1 });
  return s;
}
/** То же, и карта сразу задаёт вопрос. */
function drawCard(card: GameState['deck'][number], own: [PlayerId, Rank, string][], prep?: (s: GameState) => void): GameState {
  const s = receive(card, own, prep);
  assert(s.pending?.source === card, `ожидался вопрос «${card}», есть: ${s.pending?.source}`);
  return s;
}
const timeout = (s: GameState) => assert(dispatch(s, { type: 'timeout', by: s.current, total: false }).ok, 'таймаут хода отклонён');
const piecesNamed = (s: GameState, p: PlayerId) => s.pieces.filter((q) => q.owner === p).map((q) => `${'TSC'[q.rank]}${cellName(q.y * 12 + q.x)}`).sort();

test('таймаут хода во время повышения: фигура всё равно повышается', () => {
  const s = position([[0, Rank.Triangle, 'L11'], [0, Rank.Triangle, 'A1'], [1, Rank.Triangle, 'A10']], 0);
  const pc = s.pieces.find((q) => cellName(q.y * 12 + q.x) === 'L11')!;
  dispatch(s, { type: 'move', by: 0, pieceId: pc.id, to: at('L12') });
  assert(s.pending?.source === 'promotion', `ожидалось повышение, вопрос: ${s.pending?.source}`);
  timeout(s);
  const mine = piecesNamed(s, 0);
  assert(!mine.includes('TL12'), `треугольник остался на последнем ряду: ${mine.join(' ')}`);
  assert(mine.filter((n) => n.startsWith('S')).length === 1, `нет нового квадрата: ${mine.join(' ')}`);
  assert(s.current === 1 && !s.pending, 'ход не перешёл к сопернику');
});

test('таймаут хода во время Воскрешения: фигура возвращается на поле', () => {
  const s = drawCard('resurrection', [[0, Rank.Triangle, 'A2'], [0, Rank.Triangle, 'B2']], (g) => {
    g.players[0].graveyard = [{ uid: 500, rank: Rank.Circle, turn: 0 }];
  });
  timeout(s);
  assert(piecesNamed(s, 0).some((n) => n.startsWith('C')), `круг не вернулся: ${piecesNamed(s, 0).join(' ')}`);
  assert(s.players[0].graveyard.length === 0, 'круг остался на кладбище');
  assert(s.current === 1 && !s.pending, 'ход не перешёл к сопернику');
});

test('таймаут хода во время Двойной смерти: обе фигуры уничтожаются', () => {
  const s = drawCard('doubleDeath', [[0, Rank.Triangle, 'A2'], [0, Rank.Triangle, 'B2'], [0, Rank.Triangle, 'C2']]);
  // соперник успел выбрать одну фигуру, на второй время кончилось
  assert(dispatch(s, { type: 'choose', by: 1, option: s.pending!.options[0] }).ok, 'первый выбор отклонён');
  timeout(s);
  assert(piecesNamed(s, 0).length === 1, `должна остаться одна фигура: ${piecesNamed(s, 0).join(' ')}`);
  assert(s.players[0].graveyard.length === 2, `на кладбище ${s.players[0].graveyard.length} фигур`);
});

test('таймаут хода во время необязательного выбора: Отступление и Предательство пропускаются', () => {
  const own: [PlayerId, Rank, string][] = [[0, Rank.Triangle, 'A2'], [0, Rank.Circle, 'F6']];
  const retreat = drawCard('retreat', own);
  const before = piecesNamed(retreat, 0).join();
  timeout(retreat);
  assert(piecesNamed(retreat, 0).join() === before, `фигуры сдвинулись: ${piecesNamed(retreat, 0).join(' ')}`);
  assert(retreat.current === 1 && !retreat.pending, 'ход не перешёл к сопернику');

  const betrayal = drawCard('betrayal', own);
  assert(dispatch(betrayal, { type: 'choose', by: 1, option: `${at('F6').x},${at('F6').y}` }).ok, 'выбор фигуры отклонён');
  timeout(betrayal);
  assert(piecesNamed(betrayal, 0).join() === before, `фигуры сдвинулись: ${piecesNamed(betrayal, 0).join(' ')}`);
  assert(betrayal.current === 1 && !betrayal.pending, 'ход не перешёл к сопернику');
});

/** Прошло ms на часах; если какие-то кончились — применить таймаут, как это делают Match и комната. */
function passTime(s: GameState, c: Clocks, ms: number) {
  spendTime(s, c, ms);
  const a = expiredClock(s, c);
  if (!a) return null;
  const r = dispatch(s, a);
  assert(r.ok, `таймаут ${JSON.stringify(a)} отклонён: ${r.error}`);
  clocksAfter(s, c, r.events);
  return a;
}

test('часы: пока соперник выбирает по карте, часы ходящего стоят; по истечении 15 с — автовыбор, ход продолжается', () => {
  const s = drawCard('devaluation', [[0, Rank.Circle, 'F6'], [0, Rank.Square, 'B2'], [0, Rank.Triangle, 'A2']]);
  assert(s.pending!.chooser === 1 && s.current === 0, 'выбирать должен соперник в ход игрока 0');
  const c = newClocks(s.mode);
  assert(passTime(s, c, 10_000) === null, 'таймаут раньше срока');
  assert(c.turnLeft === s.mode.turnMs && c.total[0] === s.mode.totalMs && c.total[1] === s.mode.totalMs, `часы игроков шли: ${JSON.stringify(c)}`);
  const a = passTime(s, c, 5_000);
  assert(a?.choice && a.by === 1, `ожидался таймаут выбора соперника, есть: ${JSON.stringify(a)}`);
  // Девальвация доиграна: круг и квадрат понижены
  assert(piecesNamed(s, 0).join() === 'SF6,TA2,TB2', `ожидались понижения, фигуры: ${piecesNamed(s, 0).join(' ')}`);
  assert(s.current === 0 && !s.pending && s.ap === s.mode.ap, 'ход игрока 0 должен продолжиться');
  passTime(s, c, 1_000);
  assert(c.turnLeft === s.mode.turnMs - 1_000 && c.choiceLeft === s.mode.choiceMs, `после выбора пошли часы хода: ${JSON.stringify(c)}`);
});

test('часы: 15 секунд — на весь выбор целиком (Двойная смерть)', () => {
  const s = drawCard('doubleDeath', [[0, Rank.Triangle, 'A2'], [0, Rank.Triangle, 'B2'], [0, Rank.Triangle, 'C2']]);
  const c = newClocks(s.mode);
  passTime(s, c, 10_000);
  const r = dispatch(s, { type: 'choose', by: 1, option: s.pending!.options[0] });
  clocksAfter(s, c, r.events);
  assert(s.pending?.chooser === 1, 'ожидался второй выбор соперника');
  assert(c.choiceLeft === 5_000, `таймер выбора сбросился после первого шага: ${c.choiceLeft}`);
  assert(passTime(s, c, 5_000)?.choice, 'ожидался таймаут выбора');
  assert(piecesNamed(s, 0).length === 1, `должна остаться одна фигура: ${piecesNamed(s, 0).join(' ')}`);
  assert(s.current === 1, 'Двойная смерть занимает ход — ход должен перейти к сопернику');
});

test('таймаут выбора: принимается только от выбирающего соперника; Предательство пропускается', () => {
  const s = drawCard('betrayal', [[0, Rank.Triangle, 'A2'], [0, Rank.Circle, 'F6']]);
  assert(!dispatch(clone(s), { type: 'timeout', by: 0, total: false, choice: true }).ok, 'таймаут выбора от ходящего принят');
  const before = piecesNamed(s, 0).join();
  assert(dispatch(s, { type: 'timeout', by: 1, total: false, choice: true }).ok, 'таймаут выбора отклонён');
  assert(piecesNamed(s, 0).join() === before, `фигуры сдвинулись: ${piecesNamed(s, 0).join(' ')}`);
  assert(s.current === 1 && !s.pending, 'ход не перешёл к сопернику');
  assert(!dispatch(s, { type: 'timeout', by: 0, total: false, choice: true }).ok, 'таймаут выбора без вопроса принят');
});

/** Сделать ходящим любое допустимое перемещение (без атаки) и, если ход не кончился сам, завершить его. */
function anyMoveAndEnd(s: GameState) {
  const p = s.current;
  const mv = s.pieces
    .filter((q) => q.owner === p)
    .flatMap((q) => legalTargets(s, q).filter((t) => !t.attack).map((t) => ({ q, t })))[0];
  assert(mv, `у игрока ${p} нет перемещения`);
  assert(dispatch(s, { type: 'move', by: p, pieceId: mv.q.id, to: mv.t.to }).ok, 'перемещение отклонено');
  if (s.current === p && !s.pending) assert(dispatch(s, { type: 'endTurn', by: p }).ok, 'завершение хода отклонено');
}

test('Смена поля: Бессмертие видит фигуры, уничтоженные в текущем Периоде, по новому кладбищу', () => {
  // игрок 0 на 7-м ходу получает Бессмертие и берёт треугольник F8; соперник на своём 7-м ходу тянет Смену поля —
  // кладбище с этим треугольником переходит к игроку 0. Фигура уничтожена в его текущем Периоде — её можно вернуть,
  // а квадрат, уничтоженный в начале партии, — нельзя.
  const s = position([[0, Rank.Circle, 'F6'], [0, Rank.Triangle, 'A2'], [1, Rank.Triangle, 'F8'], [1, Rank.Triangle, 'A10'], [1, Rank.Square, 'K11']], 1);
  s.players[0].ownTurns = 6;
  s.players[1].ownTurns = 6;
  s.players[1].graveyard = [{ uid: 900, rank: Rank.Square, turn: 0 }];
  s.actedThisTurn = true;
  s.deck = ['immortal'];
  dispatch(s, { type: 'endTurn', by: 1 });
  assert(s.players[0].held?.card === 'immortal', 'игрок 0 не получил Бессмертие');
  s.deck = ['sideChange'];
  const circle = s.pieces.find((q) => q.owner === 0 && q.rank === Rank.Circle)!;
  assert(dispatch(s, { type: 'move', by: 0, pieceId: circle.id, to: at('F8') }).ok, 'взятие F8 отклонено');
  assert(s.current === 1 && s.players[1].ownTurns === 7, 'ход не перешёл к сопернику');
  assert(s.players[0].graveyard.length === 2, 'Смена поля не поменяла кладбища');
  anyMoveAndEnd(s);
  assert(s.current === 0 && s.players[0].held?.card === 'immortal', 'Бессмертие должно остаться у игрока 0');
  assert(dispatch(s, { type: 'playCard', by: 0 }).ok, 'Бессмертие не разыгрывается');
  assert(s.pending?.kind === 'grave', `ожидался выбор с кладбища, вопрос: ${s.pending?.source}`);
  const opts = s.pending.options.map((o) => s.players[0].graveyard.find((g) => String(g.uid) === o)?.rank);
  assert(opts.length === 1 && opts[0] === Rank.Triangle, `ожидался только взятый треугольник, варианты: ${JSON.stringify(opts)}`);
});

test('Смена поля: повышение, ждущее выбора клетки, переходит к новому владельцу фигуры', () => {
  // треугольник игрока 0 пережил ход соперника на последнем ряду; в начале хода игрока 0 — повышение и Смена поля
  const s = position([[0, Rank.Triangle, 'L12'], [0, Rank.Triangle, 'A2'], [1, Rank.Triangle, 'A10'], [1, Rank.Triangle, 'C10']], 1);
  s.pieces.find((q) => cellName(q.y * 12 + q.x) === 'L12')!.promoteNextTurn = true;
  s.players[0].ownTurns = 6;
  s.actedThisTurn = true;
  s.deck = ['sideChange'];
  dispatch(s, { type: 'endTurn', by: 1 });
  assert(s.played.includes('sideChange'), 'Смена поля не сыграна');
  assert(s.pending?.source === 'promotion', `ожидалось повышение, вопрос: ${s.pending?.source}`);
  assert(s.pending.chooser === 1 && s.pending.beneficiary === 1, `повышение должно перейти к игроку 1: ${JSON.stringify(s.pending)}`);
  const home = homeRows(s, s.players[1].side);
  assert(s.pending.options.every((o) => home.includes(Number(o.split(',')[1]))), `клетки не в стартовой зоне нового владельца: ${optionNames(s).join(' ')}`);
  assert(dispatch(s, { type: 'choose', by: 1, option: s.pending.options[0] }).ok, 'выбор клетки отклонён');
  assert(!piecesNamed(s, 1).includes('TL12'), `треугольник остался на последнем ряду: ${piecesNamed(s, 1).join(' ')}`);
  assert(piecesNamed(s, 1).some((n) => n.startsWith('S')), `у нового владельца нет квадрата: ${piecesNamed(s, 1).join(' ')}`);
});

test('отложенная карта: «сгорит» только на последнем ходу Периода (13-м), после него — сброс', () => {
  const s = position([[0, Rank.Circle, 'A1'], [1, Rank.Circle, 'L12']], 1);
  s.players[0].ownTurns = 6;
  s.actedThisTurn = true;
  s.deck = ['jumper'];
  dispatch(s, { type: 'endTurn', by: 1 });
  assert(s.players[0].held?.card === 'jumper', 'игрок 0 не получил Прыгуна на 7-м ходу');
  for (let own = 7; own <= 13; own++) {
    assert(s.current === 0 && s.players[0].ownTurns === own, `ожидался ход ${own} игрока 0`);
    assert(heldExpiresThisTurn(s, 0) === (own === 13), `ход ${own}: признак «сгорит» = ${heldExpiresThisTurn(s, 0)}`);
    assert(!heldExpiresThisTurn(s, 1), 'у соперника нет карты');
    anyMoveAndEnd(s);
    if (own < 13) anyMoveAndEnd(s);
  }
  assert(s.players[0].held === null && s.discard.includes('jumper'), 'после 13-го хода карта должна сгореть');
});

// ── правила по ГДД: места, где легко ошибиться ─────────────────────────────

const pieceOn = (s: GameState, name: string) => s.pieces.find((q) => q.x === at(name).x && q.y === at(name).y);
const cellOpt = (name: string) => `${at(name).x},${at(name).y}`;
function moveFrom(s: GameState, from: string, to: string) {
  const pc = pieceOn(s, from);
  assert(pc, `на ${from} нет фигуры`);
  return dispatch(s, { type: 'move', by: s.current, pieceId: pc.id, to: at(to) });
}
/** Клетки, куда фигура с `name` может пойти или ударить прямо сейчас. */
const reach = (s: GameState, name: string) => legalTargets(s, pieceOn(s, name)!).map((t) => cellName(t.to.y * 12 + t.to.x));
/** Дальность фигуры прямо сейчас (в клетках по большей координате). */
const rangeOf = (s: GameState, pc: Piece) => Math.max(0, ...legalTargets(s, pc).map((t) => Math.max(Math.abs(t.to.x - pc.x), Math.abs(t.to.y - pc.y))));
/** Ходящий сдвигает свою первую фигуру на соседнюю клетку ряда (A↔B, K↔L) и завершает ход. События хода. */
function shuttle(s: GameState) {
  const p = s.current;
  const pc = s.pieces.find((q) => q.owner === p)!;
  const r = dispatch(s, { type: 'move', by: p, pieceId: pc.id, to: { x: pc.x ^ 1, y: pc.y } });
  assert(r.ok, `игрок ${p}: перемещение отклонено: ${r.error}`);
  if (s.current !== p || s.pending || s.phase !== 'play') return r.events;
  const e = dispatch(s, { type: 'endTurn', by: p });
  assert(e.ok, `игрок ${p}: завершение хода отклонено: ${e.error}`);
  return [...r.events, ...e.events];
}

test('повышение: без атаки — сразу, новая фигура уже использована; под атакой — после пережитого хода соперника', () => {
  const now = position([[0, Rank.Triangle, 'L11'], [0, Rank.Triangle, 'A2'], [1, Rank.Triangle, 'A10']], 0);
  assert(moveFrom(now, 'L11', 'L12').ok, 'ход на последний ряд отклонён');
  assert(now.pending?.source === 'promotion', `ожидалось повышение, вопрос: ${now.pending?.source}`);
  assert(dispatch(now, { type: 'choose', by: 0, option: now.pending.options[0] }).ok, 'выбор клетки отклонён');
  const sq = now.pieces.find((q) => q.owner === 0 && q.rank === Rank.Square);
  assert(sq && !pieceOn(now, 'L12'), `повышение не произошло: ${piecesNamed(now, 0).join(' ')}`);
  assert(legalTargets(now, sq).length === 0, 'фигура, повышенная в тот же ход, должна считаться использованной');
  assert(now.players[0].graveyard.length === 0, 'исходная фигура не должна попадать на кладбище');

  // квадрат соперника H12 бьёт вбок до E12: треугольник выходит на последний ряд под атакой
  const underAttack = () => {
    const s = position([[0, Rank.Triangle, 'E11'], [0, Rank.Triangle, 'A2'], [1, Rank.Square, 'H12'], [1, Rank.Triangle, 'A10']], 0);
    assert(moveFrom(s, 'E11', 'E12').ok, 'ход на последний ряд отклонён');
    assert(!s.pending && pieceOn(s, 'E12')?.rank === Rank.Triangle, 'под атакой фигура должна остаться на последнем ряду без повышения');
    assert(dispatch(s, { type: 'endTurn', by: 0 }).ok, 'завершение хода отклонено');
    return s;
  };
  const taken = underAttack();
  assert(moveFrom(taken, 'H12', 'E12').ok, 'соперник не смог взять фигуру на E12');
  assert(taken.current === 0 && !taken.pending, `взятая фигура не повышается, вопрос: ${taken.pending?.source}`);
  assert(piecesNamed(taken, 0).join() === 'TA2', `фигуры: ${piecesNamed(taken, 0).join(' ')}`);

  const survived = underAttack();
  assert(moveFrom(survived, 'A10', 'A9').ok && dispatch(survived, { type: 'endTurn', by: 1 }).ok, 'ход соперника отклонён');
  assert(survived.current === 0 && survived.pending?.source === 'promotion', `пережила ход соперника — ожидалось повышение, вопрос: ${survived.pending?.source}`);
  assert(dispatch(survived, { type: 'choose', by: 0, option: survived.pending.options[0] }).ok, 'выбор клетки отклонён');
  const late = survived.pieces.find((q) => q.owner === 0 && q.rank === Rank.Square)!;
  assert(!pieceOn(survived, 'E12') && legalTargets(survived, late).length > 0, 'после отложенного повышения новая фигура может действовать');
});

test('очки действий: перемещение — 1 очко, фигура действует раз за ход, атака и нехватка фигур завершают ход', () => {
  const six: [PlayerId, Rank, string][] = [...'ABCDEF'].map((c): [PlayerId, Rank, string] => [0, Rank.Triangle, `${c}3`]);
  const s = position([...six, [1, Rank.Triangle, 'L10']], 0);
  assert(!dispatch(clone(s), { type: 'endTurn', by: 0 }).ok, 'ход завершён вручную без единого действия');
  assert(moveFrom(s, 'A3', 'A4').ok && s.ap === 4, `перемещение должно стоить 1 очко, осталось ${s.ap}`);
  assert(!moveFrom(s, 'A4', 'A5').ok, 'фигура сходила второй раз за ход');
  assert(dispatch(s, { type: 'endTurn', by: 0 }).ok && s.current === 1, 'после действия ход должен завершаться вручную');

  const five = position([...six, [1, Rank.Triangle, 'L10']], 0);
  for (const c of 'ABCDE') {
    assert(five.current === 0, `ход кончился раньше пяти действий (перед ${c}3)`);
    assert(moveFrom(five, `${c}3`, `${c}4`).ok, `перемещение ${c}3 отклонено`);
  }
  assert(five.current === 1, 'очки кончились — ход должен перейти');

  const attack = position([[0, Rank.Triangle, 'A3'], [0, Rank.Triangle, 'B3'], [0, Rank.Triangle, 'E5'], [1, Rank.Triangle, 'F6'], [1, Rank.Triangle, 'L10']], 0);
  assert(moveFrom(attack, 'A3', 'A4').ok && moveFrom(attack, 'E5', 'F6').ok, 'атака отклонена');
  assert(attack.current === 1, 'атака расходует все очки — ход должен перейти, хотя B3 ещё могла ходить');

  const lone = position([[0, Rank.Triangle, 'A3'], [1, Rank.Triangle, 'L10']], 0);
  assert(moveFrom(lone, 'A3', 'A4').ok && lone.current === 1, 'остальные очки потратить нечем — ход должен перейти');
});

test('Карма: карта — в начале 7-го, 14-го… собственного хода, первым — у ходившего первым; колода кончилась — карт нет', () => {
  const s = position([[0, Rank.Circle, 'A1'], [1, Rank.Square, 'K12']], 0);
  s.deck = ['snail', 'snail', 'snail'];
  const drawn: string[] = [];
  let own = 0;
  for (let i = 0; i < 2 * 25; i++)
    for (const e of shuttle(s)) {
      if (e.type === 'turnStart') own = e.ownTurn;
      if (e.type === 'cardDrawn') drawn.push(`${e.player}:${own}`);
    }
  assert(drawn.join() === '0:7,1:7,0:14', `получения карт (игрок:ход): ${drawn.join(' ')}`);
});

test('Карма: Депрессия действует до конца Периода (ходы 7–13), Тихоход — только в ход получения', () => {
  const s = position([[0, Rank.Circle, 'A1'], [1, Rank.Square, 'K12']], 0);
  for (let i = 0; i < 2 * 15; i++) {
    const p = s.current;
    const own = s.players[p].ownTurns;
    const range = rangeOf(s, s.pieces.find((q) => q.owner === p)!);
    if (p === 0 && own >= 7) assert(range === (own <= 13 ? 1 : 5), `ход ${own} игрока 0: дальность круга ${range}`);
    if (p === 1 && (own === 7 || own === 8)) assert(range === (own === 7 ? 1 : 3), `ход ${own} игрока 1: дальность квадрата ${range}`);
    // следующий ход начнётся с этой карты
    if (p === 1 && s.players[0].ownTurns === 6) s.deck = ['depression'];
    if (p === 0 && own === 7) s.deck = ['snail'];
    shuttle(s);
  }
});

test('ничья: 1×1 одного ранга или 2×2 одного набора — через три Периода без изменений; иначе игра идёт', () => {
  const run = (pieces: [PlayerId, Rank, string][], rounds: number) => {
    const s = position(pieces, 0);
    for (let i = 0; i < 2 * rounds && s.phase === 'play'; i++) shuttle(s);
    return s;
  };
  const C = Rank.Circle;
  const S = Rank.Square;
  const draws: [PlayerId, Rank, string][][] = [
    [[0, C, 'A1'], [1, C, 'K12']],
    [[0, C, 'A1'], [0, S, 'F1'], [1, C, 'K12'], [1, S, 'F12']],
  ];
  // три Периода — 21 собственный ход каждого; отсчёт — со следующего раунда
  for (const d of draws) {
    assert(run(d, 20).phase === 'play', `ничья раньше трёх Периодов: ${JSON.stringify(d)}`);
    const s = run(d, 23);
    assert(s.winner === 'draw', `ожидалась ничья после трёх Периодов: ${JSON.stringify(d)}, итог ${s.phase} ${s.winner}`);
  }
  const noDraws: [PlayerId, Rank, string][][] = [
    [[0, C, 'A1'], [1, S, 'K12']],
    [[0, C, 'A1'], [0, C, 'F1'], [1, C, 'K12'], [1, S, 'F12']],
  ];
  for (const d of noDraws) assert(run(d, 40).phase === 'play', `ничьи быть не должно: ${JSON.stringify(d)}`);
});

test('Блицкриг: первая фигура — до 5 действий подряд; другая фигура, атака или последний ряд завершают эффект', () => {
  const own: [PlayerId, Rank, string][] = [[0, Rank.Circle, 'A6'], [0, Rank.Triangle, 'L2'], [0, Rank.Triangle, 'K2']];
  const blitz = (extra: [PlayerId, Rank, string][] = []) => {
    const s = receive('blitzkrieg', [...own, ...extra]);
    assert(s.current === 0 && s.played.includes('blitzkrieg'), 'Блицкриг не сыгран');
    return s;
  };
  const five = blitz();
  const path = ['A6', 'B6', 'C6', 'D6', 'E6', 'F6'];
  for (let i = 1; i < path.length; i++) {
    assert(five.current === 0, `ход кончился после ${i - 1} действий`);
    assert(moveFrom(five, path[i - 1], path[i]).ok, `действие ${i} круга отклонено`);
  }
  assert(five.current === 1, 'пять действий израсходовали очки — ход должен перейти');

  const other = blitz();
  assert(moveFrom(other, 'A6', 'B6').ok && moveFrom(other, 'B6', 'C6').ok && moveFrom(other, 'L2', 'L3').ok, 'действия отклонены');
  assert(other.current === 0 && reach(other, 'C6').length === 0, 'после перехода к другой фигуре круг не должен действовать');

  const hit = blitz([[1, Rank.Triangle, 'D8']]);
  assert(moveFrom(hit, 'A6', 'B6').ok && moveFrom(hit, 'B6', 'D8').ok, 'атака отклонена');
  assert(hit.current === 1, 'атака расходует остаток очков — ход должен перейти');

  const edge = blitz();
  assert(moveFrom(edge, 'A6', 'A10').ok && moveFrom(edge, 'A10', 'A12').ok, 'перемещения отклонены');
  assert(edge.current === 0 && reach(edge, 'A12').length === 0, 'выход на последний ряд завершает действия круга');
});

test('Прыгун: одно препятствие в клетку, дальность не растёт, один прыжок за Период', () => {
  const s = receive('jumper', [
    [0, Rank.Circle, 'A1'], [0, Rank.Triangle, 'A2'],
    [0, Rank.Circle, 'E1'], [0, Rank.Triangle, 'E2'],
    [0, Rank.Square, 'H1'], [0, Rank.Triangle, 'H2'], [0, Rank.Triangle, 'H3'],
  ]);
  assert(s.players[0].held?.card === 'jumper', 'Прыгун должен остаться на руках');
  assert(!reach(s, 'A1').includes('A3'), 'до розыгрыша карты прыгать нельзя');
  assert(dispatch(s, { type: 'playCard', by: 0 }).ok, 'Прыгун не разыгрывается');
  const up = reach(s, 'A1').filter((c) => c[0] === 'A').sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  assert(up.join() === 'A3,A4,A5,A6', `круг через A2 — до A6 (дальность 5 с учётом препятствия), есть: ${up.join(' ')}`);
  assert(!reach(s, 'H1').includes('H4'), 'два препятствия подряд не перепрыгнуть');
  assert(moveFrom(s, 'A1', 'A4').ok, 'прыжок отклонён');
  assert(!reach(s, 'E1').includes('E3'), 'карта расходуется при первом прыжке — второй фигуре прыгать нельзя');
});

test('Девальвация и Карьерный лифт: до двух фигур разных рангов; треугольник не понижается, круг не повышается', () => {
  const dv = drawCard('devaluation', [[0, Rank.Circle, 'F6'], [0, Rank.Circle, 'G6'], [0, Rank.Square, 'B2'], [0, Rank.Triangle, 'A2']]);
  assert(dv.pending!.chooser === 1, 'выбирать должен соперник');
  assert(optionNames(dv).join() === 'B2,F6,G6', `треугольник не предлагается, варианты: ${optionNames(dv).join(' ')}`);
  assert(dispatch(dv, { type: 'choose', by: 1, option: cellOpt('F6') }).ok, 'выбор круга отклонён');
  assert(optionNames(dv).join() === 'B2', `второй — только другого ранга, варианты: ${optionNames(dv).join(' ')}`);
  assert(dispatch(dv, { type: 'choose', by: 1, option: cellOpt('B2') }).ok, 'выбор квадрата отклонён');
  assert(!dv.pending && piecesNamed(dv, 0).join() === 'CG6,SF6,TA2,TB2', `итог: ${piecesNamed(dv, 0).join(' ')}`);

  const one = drawCard('devaluation', [[0, Rank.Circle, 'F6'], [0, Rank.Circle, 'G6'], [0, Rank.Triangle, 'A2']]);
  assert(dispatch(one, { type: 'choose', by: 1, option: cellOpt('F6') }).ok, 'выбор круга отклонён');
  assert(!one.pending && piecesNamed(one, 0).join() === 'CG6,SF6,TA2', `доступен один ранг — понижается одна фигура: ${piecesNamed(one, 0).join(' ')}`);

  const none = receive('devaluation', [[0, Rank.Triangle, 'A2'], [0, Rank.Triangle, 'B2']]);
  assert(!none.pending && none.discard.includes('devaluation'), 'только треугольники — карта сбрасывается');

  const up = drawCard('careerUp', [[0, Rank.Circle, 'F6'], [0, Rank.Square, 'B2'], [0, Rank.Triangle, 'A2']]);
  assert(up.pending!.chooser === 0 && optionNames(up).join() === 'A2,B2', `круг не повышается, варианты: ${optionNames(up).join(' ')}`);
});

test('Шпион: фигура меняет владельца и направление; на последнем ряду нового владельца — обычное повышение', () => {
  const s = drawCard('spy', [[0, Rank.Triangle, 'A2'], [1, Rank.Triangle, 'F8']]);
  assert(dispatch(s, { type: 'choose', by: 0, option: cellOpt('F8') }).ok, 'выбор отклонён');
  assert(pieceOn(s, 'F8')!.owner === 0, 'фигура не сменила владельца');
  assert(reach(s, 'F8').join() === 'F9', `треугольник должен ходить вперёд для нового владельца, цели: ${reach(s, 'F8').join(' ')}`);

  const edge = drawCard('spy', [[0, Rank.Triangle, 'A2'], [1, Rank.Triangle, 'D12']]);
  assert(dispatch(edge, { type: 'choose', by: 0, option: cellOpt('D12') }).ok, 'выбор отклонён');
  assert(edge.pending?.source === 'promotion' && edge.pending.chooser === 0, `ожидалось повышение у игрока 0, вопрос: ${edge.pending?.source}`);

  // квадрат соперника G12 бьёт вбок до D12 — повышение откладывается
  const hit = drawCard('spy', [[0, Rank.Triangle, 'A2'], [1, Rank.Triangle, 'D12'], [1, Rank.Square, 'G12']]);
  assert(dispatch(hit, { type: 'choose', by: 0, option: cellOpt('D12') }).ok, 'выбор отклонён');
  assert(!hit.pending && pieceOn(hit, 'D12')!.promoteNextTurn, 'под атакой повышение должно быть отложено');
});

test('Линия смерти: уничтожает все фигуры столбца, клетки Защитного барьера остаются; ход переходит', () => {
  const barrier = { kind: 'barrier' as const, owner: 1 as PlayerId, untilOwnTurn: 99, cells: [at('A6'), at('B6')] };
  const s = receive('deathLine', [...fillRows(0, [2]), ...fillRows(1, [11])], (g) => g.effects.push(barrier));
  const cols = [...'ABCDEFGHIJKL'].filter((c) => !pieceOn(s, `${c}2`));
  assert(cols.length === 1, `ожидался один выбитый столбец, пустые: ${cols.join(' ')}`);
  assert(!pieceOn(s, `${cols[0]}11`), `в столбце ${cols[0]} уцелела фигура соперника`);
  assert([...'ABCDEFGHIJKL'].every((c) => c === cols[0] || (pieceOn(s, `${c}2`) && pieceOn(s, `${c}11`))), 'пострадали другие столбцы');
  assert(s.effects.some((e) => e.kind === 'barrier'), 'барьер исчез');
  assert(s.current === 1, 'Линия смерти занимает ход — ход должен перейти');
});

test('Смена поля: фигуры и кладбища меняются, цвета и карты — нет; получивший продолжает ход фигурами соперника', () => {
  const s = receive('sideChange', [[0, Rank.Triangle, 'A2'], [0, Rank.Circle, 'F6']], (g) => {
    g.players[0].graveyard = [{ uid: 1, rank: Rank.Triangle, turn: 0 }];
    g.players[1].graveyard = [{ uid: 2, rank: Rank.Square, turn: 0 }, { uid: 3, rank: Rank.Square, turn: 0 }];
    g.players[1].held = { card: 'jumper', untilOwnTurn: 12 };
  });
  const colors = s.players.map((p) => p.color).join();
  assert(s.played.includes('sideChange'), 'Смена поля не сыграна');
  assert(piecesNamed(s, 0).join() === 'TL10' && piecesNamed(s, 1).join() === 'CF6,TA2', `фигуры: ${piecesNamed(s, 0)} / ${piecesNamed(s, 1)}`);
  assert(s.players[0].graveyard.length === 2 && s.players[1].graveyard.length === 1, 'кладбища не поменялись');
  assert(s.players.map((p) => p.color).join() === colors && s.players[1].held?.card === 'jumper', 'цвета и карты не должны меняться');
  assert(s.current === 0 && s.ap === s.mode.ap, 'получивший карту должен продолжить ход');
  assert(moveFrom(s, 'L10', 'L9').ok, 'треугольник соперника должен ходить в своём прежнем направлении');
});

test('реестр Карт Кармы совпадает с таблицей ГДД: 34 карты, количество, момент розыгрыша, занимает ли ход', () => {
  // ГДД, раздел 6: [название, шт, «в течение периода», занимает ход]
  const gdd: [string, number, boolean, boolean][] = [
    ['Бессмертие', 2, true, false], ['Блицкриг', 1, false, false], ['Воскрешение', 3, false, false],
    ['Двойная смерть', 1, false, true], ['Двойная смерть врага', 1, false, true], ['Девальвация', 2, false, false],
    ['Депрессия', 1, false, false], ['Защитный барьер', 1, false, false], ['Карьерный лифт вверх', 1, false, false],
    ['Карьерный лифт вниз', 2, false, false], ['Круговая защита', 1, false, false], ['Линия смерти', 2, false, true],
    ['Отступление', 3, false, false], ['Подарок', 3, false, false], ['Предательство', 1, false, true],
    ['Пропуск хода', 2, false, true], ['Прыгун', 3, true, false], ['Свежая кровь', 1, false, true],
    ['Смена поля', 1, false, false], ['Тихоход', 1, false, false], ['Шпион', 1, false, false],
  ];
  const ours = ALL_CARDS.map((d) => `${d.name}:${d.count}:${d.timing === 'period'}:${d.takesTurn}`).sort();
  const want = gdd.map((r) => r.join(':')).sort();
  assert(ours.join() === want.join(), `расхождения: есть ${ours.filter((x) => !want.includes(x)).join(', ')}; по ГДД ${want.filter((x) => !ours.includes(x)).join(', ')}`);
  assert(fullDeck().length === 34, `в общей колоде ${fullDeck().length} карт`);
  for (let seed = 1; seed <= 20; seed++) {
    const deck = createGame(CLASSIC, seed, ['A', 'B']).deck;
    assert(deck.length === 21, `колода матча: ${deck.length} карт`);
    for (const d of ALL_CARDS) assert(deck.filter((c) => c === d.id).length <= d.count, `«${d.name}» в колоде матча больше, чем в общей`);
  }
});

test('пресеты расстановки: полная армия в стартовой зоне — за обе стороны', () => {
  for (const pr of PRESETS)
    for (let seed = 1; seed <= (pr.id === 'random' ? 20 : 1); seed++) {
      const s = createGame(CLASSIC, seed, ['A', 'B']);
      for (const p of [0, 1] as PlayerId[]) {
        const r = dispatch(s, { type: 'place', by: p, layout: pr.build(s, s.players[p].side) });
        assert(r.ok, `«${pr.name}», игрок ${p}: ${r.error}`);
      }
      assert(s.phase === 'play', `«${pr.name}»: партия не началась`);
    }
});

test('фаззер: случайные допустимые действия не ломают движок (120 партий)', () => {
  const r = fuzz({ games: 120, seed: 7 });
  assert(!r.error, r.error!);
  assert(r.questions > 300, `мало вопросов карт и повышений: ${r.questions}`);
});

test('Мастер обыгрывает старого жадного бота без Кармы (10 партий)', () => {
  let wins = 0;
  for (let g = 0; g < 10; g++) {
    const seed = 500 + g * 17;
    const masterSeat = (g % 2) as PlayerId;
    const bots: [BotFn, BotFn] = masterSeat === 0 ? [botOf('master', seed), greedy] : [greedy, botOf('master', seed)];
    const { s } = playGame(bots, seed, { noKarma: true, limit: 600 });
    if (s.winner === masterSeat) wins++;
  }
  assert(wins >= 9, `Мастер выиграл только ${wins} из 10`);
});

test('обучение: сценарий проходится от первого шага до победы', () => {
  const s = tutorialState(['Я', 'Соперник']);
  const steps: string[] = [];
  for (let guard = 0; s.phase === 'play' && guard < 60; guard++) {
    let a: Action | null;
    if ((s.pending ? s.pending.chooser : s.current) === 1) a = tutorialEnemy(s, 1);
    else {
      const st = tutorialStep(s);
      assert(st, `ход ${s.turn}: у игрока нет такта`);
      steps.push(st.id);
      // саспенс такта Кармы: квадрат видит убийцу, но не достаёт — достаёт только после повышения
      if (st.id === 'karma') {
        const sq = s.pieces.find((q) => q.owner === 0)!;
        assert(sq.rank === Rank.Square && !targetsOf(s, sq).some((t) => t.attack), 'до повышения квадрат не должен никого доставать');
      }
      if (st.choose) a = { type: 'choose', by: 0, option: `${st.choose[0].x},${st.choose[0].y}` };
      else if (st.endTurn) a = { type: 'endTurn', by: 0 };
      else {
        const pc = s.pieces.find((q) => q.x === st.piece!.x && q.y === st.piece!.y)!;
        assert(pc && legalTargets(s, pc).some((t) => t.to.x === st.to!.x && t.to.y === st.to!.y), `ход ${s.turn}: такт «${st.id}» недостижим`);
        a = { type: 'move', by: 0, pieceId: pc.id, to: st.to! };
      }
    }
    assert(a, `ход ${s.turn}: соперник без действия`);
    const r = dispatch(s, a);
    assert(r.ok, `ход ${s.turn}: ${JSON.stringify(a)} — ${r.error}`);
    // взятие на ходу 7 сразу передаёт ход — проверяем уже на 8-м
    if (a.type === 'move' && a.by === 0 && s.turn === 8) assert(!isAttacked(s, { x: 5, y: 6 }, 1), 'съел, но встал под удар');
    // месть уводит круг вглубь — там его уже никто не должен бить
    if (a.type === 'move' && a.by === 0 && s.turn === 10) assert(!isAttacked(s, { x: 5, y: 2 }, 1), 'после мести круг под ударом');
    if (s.turn === 11 && s.phase === 'play') assert(s.pieces.filter((q) => q.owner === 1).length === 1, 'перед добиванием у соперника не одна фигура');
  }
  assert(s.winner === 0, `итог: ${s.winner} (${s.endReason})`);
  assert(steps.join(' ') === 'step end revenge circle stuck karma avenge finish', `такты: ${steps.join(' ')}`);
});

// ── запуск ──────────────────────────────────────────────────────────────────
let failed = 0;
const t00 = performance.now();
// TEST=подстрока — запустить только подходящие тесты
const only = process.env.TEST;
for (const t of tests.filter((x) => !only || x.name.includes(only))) {
  const t0 = performance.now();
  try {
    t.fn();
    console.log(`  ✓ ${t.name} (${((performance.now() - t0) / 1000).toFixed(1)} с)`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${t.name}\n      ${(e as Error).message}`);
  }
}
const ran = tests.filter((x) => !only || x.name.includes(only)).length;
console.log(`\n${ran - failed} из ${ran} прошли за ${((performance.now() - t00) / 1000).toFixed(1)} с`);
process.exit(failed ? 1 : 0);
