// Автотесты бота и движка. npm test (запускается и в CI перед сборкой).
// Быстрые и детерминированные: боты со своим seed, без бюджета времени. Статистика силы — npm run arena / quality.
import { createAgent, type BotFn } from '../src/ai/agent';
import { ATTACK, CELL_MASK, FastBoard, newUndo, passTurn } from '../src/ai/board';
import { DEFAULT_WEIGHTS, bestCapture, type Weights } from '../src/ai/eval';
import { LEVELS, levelById, type LevelId } from '../src/ai/levels';
import { searchTurn } from '../src/ai/search';
import { createGame, dispatch } from '../src/core/engine';
import { CLASSIC } from '../src/core/modes';
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
