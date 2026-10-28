// Реестр Карт Кармы (ГДД, раздел 6). Каждая карта — данные + обработчики.
// Чтобы добавить карту: id в CardId (types.ts), запись здесь, иконку в render/cardArt.ts.
import { RANK_NAME_ACC, ask, askSpawn, cellOptions, checkPromotion, destroy, log, setRank, type Ctx } from '../ops';
import { randInt } from '../rng';
import { forward, inBoard, isFree, periodEnd, periodIndex, pieceAt, piecesOf, sideOf, spawnCells, targetsOf } from '../rules';
import { Rank, other, unkey, type CardId, type GameState, type Pending, type PlayerId, type Pos } from '../types';

export type Timing = 'onReceive' | 'period';
export type Tier = 'simple' | 'rare' | 'fatal';

export interface CardDef {
  id: CardId;
  name: string;
  en: string;
  count: number;
  timing: Timing;
  takesTurn: boolean;
  /** краткое описание «в игре» */
  text: string;
  /** полный классический эффект */
  rule: string;
  /** можно ли сыграть прямо сейчас (для карт «в течение периода») */
  canPlay?(s: GameState, p: PlayerId): boolean;
  /** розыгрыш; false — карта не может быть разыграна и уходит в сброс */
  play(c: Ctx, p: PlayerId): boolean;
  /** ответ на вопрос карты; option === null — игрок закончил досрочно */
  onChoice?(c: Ctx, pend: Pending, option: string | null): void;
  /** варианты вопроса заново по текущей позиции: вопрос мог ждать в очереди, пока доска менялась */
  refresh?(s: GameState, pend: Pending): string[];
}

export const tierOf = (d: CardDef): Tier => (d.takesTurn ? 'fatal' : d.count === 1 ? 'rare' : 'simple');

// ── helpers ────────────────────────────────────────────────────────────────

const pieceById = (s: GameState, id: number) => s.pieces.find((q) => q.id === id);
const pieceFromOpt = (s: GameState, opt: string) => pieceAt(s, unkey(opt));

/** «Выберите N фигур» — общая механика для карт с последовательным выбором фигур. */
function pickPieces(
  id: CardId,
  cfg: {
    chooser: (p: PlayerId) => PlayerId;
    pool: (s: GameState, p: PlayerId, data: Record<string, unknown>) => Pos[];
    max: number;
    canSkip?: boolean;
    prompt: (n: number, max: number) => string;
    apply: (c: Ctx, p: PlayerId, pc: NonNullable<ReturnType<typeof pieceAt>>, data: Record<string, unknown>) => void;
  },
): Pick<CardDef, 'play' | 'onChoice' | 'refresh'> {
  const askNext = (c: Ctx, p: PlayerId, step: number, data: Record<string, unknown>) => {
    if (step >= cfg.max) return;
    const pool = cfg.pool(c.s, p, data);
    if (!pool.length) return;
    ask(c, {
      source: id,
      chooser: cfg.chooser(p),
      beneficiary: p,
      kind: 'cell',
      options: cellOptions(pool),
      canSkip: !!cfg.canSkip,
      prompt: cfg.prompt(step + 1, cfg.max),
      step,
      data,
    });
  };
  return {
    play(c, p) {
      if (!cfg.pool(c.s, p, {}).length) return false;
      askNext(c, p, 0, {});
      return true;
    },
    onChoice(c, pend, option) {
      if (option === null) return;
      const pc = pieceFromOpt(c.s, option);
      if (!pc) return;
      const data = { ...pend.data };
      cfg.apply(c, pend.beneficiary, pc, data);
      askNext(c, pend.beneficiary, pend.step + 1, data);
    },
    refresh: (s, pend) => cellOptions(cfg.pool(s, pend.beneficiary, pend.data)),
  };
}

const posOf = (pcs: { x: number; y: number }[]) => pcs.map((q) => ({ x: q.x, y: q.y }));

/** Повышение/понижение до двух фигур разных рангов. */
function rankShift(id: CardId, dir: 1 | -1, chooser: (p: PlayerId) => PlayerId, target: (p: PlayerId) => PlayerId) {
  return pickPieces(id, {
    chooser,
    max: 2,
    pool: (s, p, data) =>
      posOf(
        piecesOf(s, target(p)).filter(
          (q) =>
            (dir > 0 ? q.rank < Rank.Circle : q.rank > Rank.Triangle) &&
            q.rank !== data.usedRank &&
            q.id !== data.usedId,
        ),
      ),
    prompt: (n, max) => `${dir > 0 ? 'Повысьте' : 'Понизьте'} фигуру ${n}/${max} (разных рангов)`,
    apply: (c, _p, pc, data) => {
      data.usedRank = pc.rank;
      data.usedId = pc.id;
      setRank(c, pc, (pc.rank + dir) as Rank);
    },
  });
}

function addEffect(c: Ctx, e: GameState['effects'][number]) {
  c.s.effects.push(e);
}

// ── registry ───────────────────────────────────────────────────────────────

const defs: CardDef[] = [
  {
    id: 'immortal',
    name: 'Бессмертие',
    en: 'Immortal',
    count: 2,
    timing: 'period',
    takesTurn: false,
    text: 'Восстановите любую свою фигуру, уничтоженную в текущем Периоде Кармы.',
    rule: 'Вернуть одну свою фигуру, уничтоженную в текущем Периоде Кармы, в стартовую зону (или 4-й ряд). Возвращённая фигура может действовать в тот же ход.',
    canPlay: (s, p) =>
      s.players[p].graveyard.some((g) => g.period === periodIndex(s, p)) && spawnCells(s, p).length > 0,
    play(c, p) {
      const opts = c.s.players[p].graveyard.filter((g) => g.period === periodIndex(c.s, p));
      if (!opts.length || !spawnCells(c.s, p).length) return false;
      askGrave(c, 'immortal', p, opts.map((g) => g.uid));
      return true;
    },
    onChoice: (c, pend, opt) => takeFromGrave(c, pend, opt),
  },
  {
    id: 'blitzkrieg',
    name: 'Блицкриг',
    en: 'Blitzkrieg',
    count: 1,
    timing: 'onReceive',
    takesTurn: false,
    text: 'Вы можете выполнить до 5 действий подряд одной фигурой.',
    rule: 'Первая фигура, которой игрок начинает действовать, может выполнить до 5 последовательных действий. Атака расходует остаток. Переход к другой фигуре или выход на последний ряд завершает эффект.',
    play(c, p) {
      addEffect(c, { kind: 'blitz', owner: p, untilOwnTurn: c.s.players[p].ownTurns, pieceId: null, done: false });
      return true;
    },
  },
  {
    id: 'resurrection',
    name: 'Воскрешение',
    en: 'Resurrection',
    count: 3,
    timing: 'onReceive',
    takesTurn: false,
    text: 'Восстановите любую свою фигуру, уничтоженную с начала партии.',
    rule: 'Вернуть одну свою фигуру, уничтоженную с начала матча, в стартовую зону (или 4-й ряд). Если кладбище пусто — карта сбрасывается без эффекта.',
    play(c, p) {
      const g = c.s.players[p].graveyard;
      if (!g.length || !spawnCells(c.s, p).length) return false;
      askGrave(c, 'resurrection', p, g.map((e) => e.uid));
      return true;
    },
    onChoice: (c, pend, opt) => takeFromGrave(c, pend, opt),
  },
  {
    id: 'doubleDeath',
    name: 'Двойная смерть',
    en: 'Double Death',
    count: 1,
    timing: 'onReceive',
    takesTurn: true,
    text: 'Противник должен убрать с доски любые две ваши фигуры.',
    rule: 'Соперник выбирает и уничтожает две фигуры игрока, получившего карту. Занимает ход.',
    ...pickPieces('doubleDeath', {
      chooser: other,
      max: 2,
      pool: (s, p) => posOf(piecesOf(s, p)),
      prompt: (n, m) => `Уничтожьте фигуру соперника ${n}/${m}`,
      apply: (c, _p, pc) => destroy(c, pc, 'doubleDeath'),
    }),
  },
  {
    id: 'doubleDeathEnemy',
    name: 'Двойная смерть врага',
    en: 'Double Death Enemy',
    count: 1,
    timing: 'onReceive',
    takesTurn: true,
    text: 'Уберите с доски две любые фигуры противника.',
    rule: 'Игрок, получивший карту, выбирает и уничтожает любые две фигуры соперника. Занимает ход.',
    ...pickPieces('doubleDeathEnemy', {
      chooser: (p) => p,
      max: 2,
      pool: (s, p) => posOf(piecesOf(s, other(p))),
      prompt: (n, m) => `Уничтожьте фигуру соперника ${n}/${m}`,
      apply: (c, _p, pc) => destroy(c, pc, 'doubleDeathEnemy'),
    }),
  },
  {
    id: 'devaluation',
    name: 'Девальвация',
    en: 'Devaluation',
    count: 2,
    timing: 'onReceive',
    takesTurn: false,
    text: 'Понижает ранг двух ваших фигур по выбору противника.',
    rule: 'Соперник понижает на один ранг до двух фигур игрока разных рангов; треугольники выбирать нельзя. Если доступны только треугольники — карта сбрасывается.',
    ...rankShift('devaluation', -1, other, (p) => p),
  },
  {
    id: 'depression',
    name: 'Депрессия',
    en: 'Depression',
    count: 1,
    timing: 'onReceive',
    takesTurn: false,
    text: 'Дальность передвижения и атаки ваших Квадратов и Кругов снижена до одной клетки до конца Периода Кармы.',
    rule: 'До конца текущего Периода Кармы дальность движения и атаки всех квадратов и кругов игрока равна 1 клетке.',
    play(c, p) {
      addEffect(c, { kind: 'depression', owner: p, untilOwnTurn: periodEnd(c.s, p) });
      return true;
    },
  },
  {
    id: 'barrier',
    name: 'Защитный барьер',
    en: 'Protection Barrier',
    count: 1,
    timing: 'onReceive',
    takesTurn: false,
    text: 'Две свободные соседние клетки в одном ряду становятся неигровыми до конца Периода Кармы.',
    rule: 'Выбрать две соседние свободные клетки в одном ряду. До конца Периода Кармы они непроходимы. Подтверждённый выбор отменить нельзя.',
    play(c, p) {
      const first = barrierFirstCells(c.s);
      if (!first.length) return false;
      ask(c, {
        source: 'barrier',
        chooser: p,
        beneficiary: p,
        kind: 'cell',
        options: cellOptions(first),
        canSkip: false,
        prompt: 'Барьер: первая клетка',
      });
      return true;
    },
    onChoice(c, pend, opt) {
      if (!opt) return;
      const cell = unkey(opt);
      if (pend.step === 0) {
        const nb = [{ x: cell.x - 1, y: cell.y }, { x: cell.x + 1, y: cell.y }].filter((q) => isFree(c.s, q));
        ask(c, { ...pend, step: 1, options: cellOptions(nb), prompt: 'Барьер: соседняя клетка в том же ряду', data: { first: opt } });
        return;
      }
      const cells = [unkey(pend.data.first as string), cell];
      addEffect(c, { kind: 'barrier', owner: pend.beneficiary, untilOwnTurn: periodEnd(c.s, pend.beneficiary), cells });
      c.ev.push({ type: 'barrier', cells });
    },
    refresh(s, pend) {
      if (pend.step === 0) return cellOptions(barrierFirstCells(s));
      const first = unkey(pend.data.first as string);
      if (!isFree(s, first)) return [];
      return cellOptions([{ x: first.x - 1, y: first.y }, { x: first.x + 1, y: first.y }].filter((q) => isFree(s, q)));
    },
  },
  {
    id: 'careerUp',
    name: 'Карьерный лифт вверх',
    en: 'Career Up',
    count: 1,
    timing: 'onReceive',
    takesTurn: false,
    text: 'Повышает ранг двух разных фигур на 1 уровень.',
    rule: 'Повысить на один ранг до двух своих фигур разных рангов. Круги выбирать нельзя.',
    ...rankShift('careerUp', 1, (p) => p, (p) => p),
  },
  {
    id: 'careerDown',
    name: 'Карьерный лифт вниз',
    en: 'Career Down',
    count: 2,
    timing: 'onReceive',
    takesTurn: false,
    text: 'Понижает ранг двух ваших фигур по вашему выбору.',
    rule: 'Понизить на один ранг до двух своих фигур разных рангов. Треугольники выбирать нельзя.',
    ...rankShift('careerDown', -1, (p) => p, (p) => p),
  },
  {
    id: 'roundProtection',
    name: 'Круговая защита',
    en: 'Round Protection',
    count: 1,
    timing: 'onReceive',
    takesTurn: false,
    text: 'В текущий Период Кармы ваши Треугольники и Квадраты могут атаковать в любую сторону.',
    rule: 'До конца Периода Кармы треугольники и квадраты игрока атакуют во всех направлениях с обычной дальностью.',
    play(c, p) {
      addEffect(c, { kind: 'roundProtection', owner: p, untilOwnTurn: periodEnd(c.s, p) });
      return true;
    },
  },
  {
    id: 'deathLine',
    name: 'Линия смерти',
    en: 'Death Line',
    count: 2,
    timing: 'onReceive',
    takesTurn: true,
    text: 'Случайно выбирается столбец, в котором будут уничтожены все фигуры.',
    rule: 'Случайным образом выбирается столбец. Все фигуры в нём уничтожаются. Клетки Защитного барьера сохраняются. Занимает ход.',
    play(c) {
      const x = randInt(c.s, c.s.mode.size);
      c.ev.push({ type: 'column', x });
      for (const pc of c.s.pieces.filter((q) => q.x === x)) destroy(c, pc, 'deathLine');
      return true;
    },
  },
  {
    id: 'retreat',
    name: 'Отступление',
    en: 'Retreat',
    count: 3,
    timing: 'onReceive',
    takesTurn: false,
    text: 'Сместите любые три свои фигуры на одну клетку назад.',
    rule: 'Последовательно сдвинуть назад на одну клетку до трёх своих фигур. Каждую — один раз. Смещённые фигуры могут действовать в тот же ход.',
    ...pickPieces('retreat', {
      chooser: (p) => p,
      max: 3,
      canSkip: true,
      pool: (s, p, data) => {
        const moved = (data.moved as number[] | undefined) ?? [];
        const back = -forward(sideOf(s, p));
        return posOf(piecesOf(s, p).filter((q) => !moved.includes(q.id) && isFree(s, { x: q.x, y: q.y + back })));
      },
      prompt: (n, m) => `Отступление: фигура ${n}/${m}`,
      apply: (c, p, pc, data) => {
        const from = { x: pc.x, y: pc.y };
        pc.y += -forward(sideOf(c.s, p));
        data.moved = [...((data.moved as number[]) ?? []), pc.id];
        c.ev.push({ type: 'move', pieceId: pc.id, from, to: { x: pc.x, y: pc.y }, forced: true });
      },
    }),
  },
  {
    id: 'gift',
    name: 'Подарок',
    en: 'Gift',
    count: 3,
    timing: 'onReceive',
    takesTurn: false,
    text: 'Получите Круг.',
    rule: 'Добавить один круг в стартовую зону (или 4-й ряд). Новая фигура может действовать в тот же ход.',
    play(c, p) {
      if (!spawnCells(c.s, p).length) return false;
      askSpawn(c, p, Rank.Circle, 'gift', false, 'Подарок: поставьте Круг');
      return true;
    },
  },
  {
    id: 'betrayal',
    name: 'Предательство',
    en: 'Betrayal',
    count: 1,
    timing: 'onReceive',
    takesTurn: true,
    text: 'Противник может выполнить 3 передвижения вашими фигурами.',
    rule: 'Соперник выполняет до трёх перемещений фигурами игрока. Направления их движения сохраняются, эффекты Кармы на них не действуют. Занимает ход.',
    play(c, p) {
      return askBetrayalPiece(c, p, 0);
    },
    onChoice(c, pend, opt) {
      if (opt === null) return;
      const p = pend.beneficiary;
      if (pend.step % 2 === 0) {
        const pc = pieceFromOpt(c.s, opt)!;
        ask(c, {
          ...pend,
          step: pend.step + 1,
          canSkip: false,
          options: cellOptions(plainMoves(c.s, pc)),
          prompt: `Предательство: куда сдвинуть (${pend.step / 2 + 1}/3)`,
          data: { pieceId: pc.id },
        });
        return;
      }
      const pc = pieceById(c.s, pend.data.pieceId as number)!;
      const from = { x: pc.x, y: pc.y };
      const to = unkey(opt);
      pc.x = to.x;
      pc.y = to.y;
      c.ev.push({ type: 'move', pieceId: pc.id, from, to, forced: true });
      checkPromotion(c, pc, false);
      const moveNo = (pend.step + 1) / 2;
      if (moveNo < 3) askBetrayalPiece(c, p, pend.step + 1);
    },
    refresh(s, pend) {
      if (pend.step % 2 === 0) return cellOptions(posOf(betrayalPool(s, pend.beneficiary)));
      const pc = pieceById(s, pend.data.pieceId as number);
      return pc && pc.owner === pend.beneficiary ? cellOptions(plainMoves(s, pc)) : [];
    },
  },
  {
    id: 'skipMove',
    name: 'Пропуск хода',
    en: 'Skip Move',
    count: 2,
    timing: 'onReceive',
    takesTurn: true,
    text: 'Вы пропускаете свой ход.',
    rule: 'Игрок, получивший карту, пропускает текущий ход.',
    play(c, p) {
      c.ev.push({ type: 'skipTurn', player: p });
      return true;
    },
  },
  {
    id: 'jumper',
    name: 'Прыгун',
    en: 'Jumper',
    count: 3,
    timing: 'period',
    takesTurn: false,
    text: 'Любая фигура, кроме Треугольника, может перепрыгнуть препятствие размером в одну клетку.',
    rule: 'До конца Периода Кармы одна своя фигура (не треугольник) может один раз перепрыгнуть препятствие шириной в клетку. Прыжок не увеличивает дальность. Карта расходуется при первом прыжке.',
    canPlay: (s, p) => piecesOf(s, p).some((q) => q.rank !== Rank.Triangle),
    play(c, p) {
      addEffect(c, { kind: 'jumper', owner: p, untilOwnTurn: periodEnd(c.s, p) });
      return true;
    },
  },
  {
    id: 'freshBlood',
    name: 'Свежая кровь',
    en: 'Fresh Blood',
    count: 1,
    timing: 'onReceive',
    takesTurn: true,
    text: 'Получите три фигуры: Треугольник, Квадрат и Круг.',
    rule: 'Добавить треугольник, квадрат и круг в стартовую зону (или 4-й ряд). Занимает ход.',
    play(c, p) {
      if (!spawnCells(c.s, p).length) return false;
      for (const r of [Rank.Circle, Rank.Square, Rank.Triangle])
        askSpawn(c, p, r, 'freshBlood', false, `Свежая кровь: поставьте ${RANK_NAME_ACC[r]}`);
      return true;
    },
  },
  {
    id: 'sideChange',
    name: 'Смена поля',
    en: 'Side Change',
    count: 1,
    timing: 'onReceive',
    takesTurn: false,
    text: 'До конца партии вы играете фигурами противника.',
    rule: 'Игроки меняются фигурами на поле и кладбищами. Цвета, таймеры и Карты Кармы не меняются. Игрок продолжает ход.',
    play(c) {
      const [a, b] = c.s.players;
      [a.side, b.side] = [b.side, a.side];
      [a.graveyard, b.graveyard] = [b.graveyard, a.graveyard];
      for (const pc of c.s.pieces) {
        pc.owner = other(pc.owner);
        pc.acted = false;
      }
      c.ev.push({ type: 'sidesSwap' });
      return true;
    },
  },
  {
    id: 'snail',
    name: 'Тихоход',
    en: 'Snail',
    count: 1,
    timing: 'onReceive',
    takesTurn: false,
    text: 'Дальность передвижения и атаки ваших Квадратов и Кругов снижена до одной клетки до конца хода.',
    rule: 'До конца текущего хода дальность движения и атаки всех квадратов и кругов игрока равна 1 клетке.',
    play(c, p) {
      addEffect(c, { kind: 'snail', owner: p, untilOwnTurn: c.s.players[p].ownTurns });
      return true;
    },
  },
  {
    id: 'spy',
    name: 'Шпион',
    en: 'Spy',
    count: 1,
    timing: 'onReceive',
    takesTurn: false,
    text: 'Выберите любую фигуру противника, до конца партии она будет принадлежать вам.',
    rule: 'Выбрать фигуру соперника: она меняет владельца и направление. На последнем ряду нового владельца — обычное правило повышения.',
    ...pickPieces('spy', {
      chooser: (p) => p,
      max: 1,
      pool: (s, p) => posOf(piecesOf(s, other(p))),
      prompt: () => 'Шпион: выберите фигуру соперника',
      apply: (c, p, pc) => {
        pc.owner = p;
        pc.promoteNextTurn = false;
        c.ev.push({ type: 'ownerChange', pieceId: pc.id, to: p });
        checkPromotion(c, pc, pc.acted);
      },
    }),
  },
];

// ── card-specific helpers ──────────────────────────────────────────────────

function askGrave(c: Ctx, id: CardId, p: PlayerId, uids: number[]) {
  ask(c, {
    source: id,
    chooser: p,
    beneficiary: p,
    kind: 'grave',
    options: uids.map(String),
    canSkip: false,
    prompt: 'Выберите фигуру с кладбища',
  });
}

function takeFromGrave(c: Ctx, pend: Pending, opt: string | null) {
  if (opt === null) return;
  const g = c.s.players[pend.beneficiary].graveyard;
  const i = g.findIndex((e) => String(e.uid) === opt);
  if (i < 0) return;
  const [entry] = g.splice(i, 1);
  log(c, `С кладбища возвращается ${RANK_NAME_ACC[entry.rank]}`, pend.beneficiary);
  askSpawn(c, pend.beneficiary, entry.rank, pend.source, false);
}

function barrierFirstCells(s: GameState): Pos[] {
  const out: Pos[] = [];
  for (let y = 0; y < s.mode.size; y++)
    for (let x = 0; x < s.mode.size; x++) {
      const p = { x, y };
      if (isFree(s, p) && (isFree(s, { x: x - 1, y }) || isFree(s, { x: x + 1, y }))) out.push(p);
    }
  return out;
}

function plainMoves(s: GameState, pc: NonNullable<ReturnType<typeof pieceAt>>): Pos[] {
  return targetsOf(s, pc, { plain: true })
    .filter((t) => !t.attack && inBoard(s, t.to))
    .map((t) => t.to);
}

const betrayalPool = (s: GameState, p: PlayerId) => piecesOf(s, p).filter((q) => plainMoves(s, q).length > 0);

function askBetrayalPiece(c: Ctx, p: PlayerId, step: number): boolean {
  const pool = betrayalPool(c.s, p);
  if (!pool.length) return false;
  ask(c, {
    source: 'betrayal',
    chooser: other(p),
    beneficiary: p,
    kind: 'cell',
    options: cellOptions(posOf(pool)),
    canSkip: step > 0,
    prompt: `Предательство: выберите фигуру соперника (${step / 2 + 1}/3)`,
    step,
  });
  return true;
}

// ── exports ────────────────────────────────────────────────────────────────

export const CARDS: Record<CardId, CardDef> = Object.fromEntries(defs.map((d) => [d.id, d])) as Record<CardId, CardDef>;
export const ALL_CARDS = defs;

/** Общая колода с повторами (34 карты). */
export function fullDeck(): CardId[] {
  return defs.flatMap((d) => Array.from({ length: d.count }, () => d.id));
}
