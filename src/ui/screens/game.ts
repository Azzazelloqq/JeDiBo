// Экран партии: расстановка → игра → итог. Связывает Match, BoardView и HUD.
import { levelById, type LevelId } from '../../ai/levels';
import { sfx } from '../../audio/sfx';
import { heldBlock } from '../../core/engine';
import { CARDS } from '../../core/karma/cards';
import { RANK_NAME } from '../../core/ops';
import { PRESETS } from '../../core/presets';
import { anyLegalAction, canAct, choosingOpponent, heldExpiresThisTurn, homeRows, legalTargets, pieceAt, piecesOf, targetsOf } from '../../core/rules';
import { Rank, key, other, unkey, type CardId, type GameEvent, type GameState, type Piece, type PlayerId, type Pos } from '../../core/types';
import { ABANDON_MS } from '../../net/protocol';
import { getProfile, recordMatch, saveProfile, type MatchRecord } from '../../profile/profile';
import { checkEmblems, grantEmblem } from '../../profile/emblems';
import { tutorialEnemy, tutorialState } from '../../core/tutorial';
import { setMood } from '../../render/background';
import { PAL } from '../../render/palette';
import { BoardView } from '../../render/board';
import { banner, floatText, pop, shake } from '../../render/fx';
import { animSpeed, wait } from '../../render/tween';
import { Match } from '../../session/match';
import { endNet, type NetSession } from '../../session/netSession';
import { open } from '../nav';
import { cardEl } from '../card';
import { btn, h, toast } from '../dom';
import { avatarEl, pieceIcon, titleEl } from '../widgets';
import { tutorialDirector, type TutorialDirector } from '../tutorial';
import { chooseLevel } from './menu';

type Kind = 'bot' | 'hotseat' | 'net' | 'tutorial';
const LETTERS = 'ABCDEFGHIJKL';
const coord = (p: Pos) => `${LETTERS[p.x]}${12 - p.y}`;
const GLYPH = ['▲', '■', '●'];
const DESTRUCTIVE = new Set(['doubleDeath', 'doubleDeathEnemy', 'devaluation', 'careerDown', 'spy', 'betrayal']);
const EFFECT_NAME: Record<string, string> = {
  depression: 'Депрессия',
  snail: 'Тихоход',
  roundProtection: 'Круговая защита',
  jumper: 'Прыгун',
  barrier: 'Барьер',
  blitz: 'Блицкриг',
};
/** Отметить сетевую партию как записанную в профиль. false — уже была записана (перезагрузка вкладки). */
function markRecorded(id: string): boolean {
  try {
    const k = 'jedibo.net.recorded';
    const list: string[] = JSON.parse(sessionStorage.getItem(k) ?? '[]');
    if (list.includes(id)) return false;
    sessionStorage.setItem(k, JSON.stringify([...list, id].slice(-20)));
  } catch {
    // без sessionStorage — пишем как есть
  }
  return true;
}

/** Порядок фигур в панели расстановки — по возрастанию числа: круги (3), квадраты (6), треугольники (12). */
const PLACE_ORDER: Rank[] = [Rank.Circle, Rank.Square, Rank.Triangle];
/** Раскрыта ли Хроника — переживает перерисовки и следующие партии. */
let chronicleOpen = (() => {
  try {
    return localStorage.getItem('jedibo.chronicle.open') === '1';
  } catch {
    return false;
  }
})();

const fmt = (ms: number) => {
  const t = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

/** net — сетевая сессия (kind 'net'): клиент комнаты уже получил start. botLevel — уровень Странника (kind 'bot'). */
export function gameScreen(root: HTMLElement, kind: Kind, net?: NetSession, botLevel?: LevelId) {
  setMood('game');
  const prof = getProfile();
  const level = levelById(botLevel ?? prof.botLevel);
  const client = kind === 'net' ? net!.client : null;
  // «я» — место в комнате; офлайн всегда игрок 0
  const me: PlayerId = client?.seat ?? 0;
  const opp = other(me);
  const names: [string, string] = client
    ? [client.state!.players[0].name, client.state!.players[1].name]
    : kind === 'bot' || kind === 'tutorial'
      ? [prof.name, 'Странник']
      : [prof.name, 'Гость'];
  const match = new Match(
    client
      ? { names, controllers: me === 0 ? ['human', 'remote'] : ['remote', 'human'], net: client }
      : kind === 'tutorial'
        ? { names, controllers: ['human', 'bot'], initial: tutorialState(names), botAct: tutorialEnemy, botDelay: 750 }
        : { names, controllers: kind === 'bot' ? ['human', 'bot'] : ['human', 'human'], botLevel: level.id },
  );
  const s = match.state;
  const gameSeed = s.seed;
  const board = new BoardView();
  const avatarSeed = (p: PlayerId) => (p === me ? prof.avatarSeed : (client?.opponent?.avatarSeed ?? `${names[p]}#seed`));

  // ── каркас (как в Balatro): слева колонка «своей» стороны, по центру поле, под полем — панель действий
  // с крупными кнопками, справа — соперник и общая информация. Профили обоих игроков — первыми в колонках,
  // на одном уровне; карточка хода (top) — под своим профилем
  const top = h('div', { class: 'topbar slab' });
  const left = h('div', { class: 'side-body' });
  const leftCol = h('aside', { class: 'side side-left' }, left);
  const right = h('aside', { class: 'side side-right' });
  const bottom = h('div', { class: 'bottombar' });
  const boardSlot = h('div', { class: 'board-slot' }, board.el);
  const center = h('main', { class: 'center' }, boardSlot, bottom);
  const layout = h('div', { class: 'game' }, leftCol, center, right);
  root.append(layout);

  const fit = () => {
    const r = boardSlot.getBoundingClientRect();
    board.fit(r.width - 8, r.height - 8);
  };
  /** обучение: режиссёр подсказок и тактов (null в обычной партии) */
  const tut: TutorialDirector | null = kind === 'tutorial' ? tutorialDirector(s, board, boardSlot, () => refreshBoard()) : null;
  const ro = new ResizeObserver(fit);
  ro.observe(boardSlot);

  let overlayOpen = false;
  let selected: number | null = null;
  let hoverCell: Pos | null = null;
  /** идёт проигрывание событий: выбор клеток по картам и окно кладбища ждут конца анимаций */
  let animating = false;
  const chronicle: { text: string; p?: PlayerId }[] = [];

  // ════════════════════════════════════════════════════════════════════════
  // РАССТАНОВКА
  // ════════════════════════════════════════════════════════════════════════
  let placingFor: PlayerId = 0;
  const layoutMap = new Map<string, Rank>();
  let placeRank: Rank = PLACE_ORDER[0];
  const LIMIT = [12, 6, 3];
  let fakeId = 100000;

  const viewState = (): GameState => ({
    ...s,
    pieces: [...layoutMap].map(([k, rank]) => ({ id: fakeIdFor(k, rank), rank, owner: placingFor, ...unkey(k), acted: false, promoteNextTurn: false })),
  });
  const idMap = new Map<string, number>();
  const fakeIdFor = (k: string, r: Rank) => {
    const kk = `${k}:${r}`;
    if (!idMap.has(kk)) idMap.set(kk, fakeId++);
    return idMap.get(kk)!;
  };
  const counts = () => {
    const c = [0, 0, 0];
    for (const r of layoutMap.values()) c[r]++;
    return c;
  };

  /** Чьими глазами смотрим на поле и чья панель слева: по сети и против бота — своё место,
   *  в хотсите — кто расставляется, в партии — игрок 1 (устройство одно, поле не крутится каждый ход). */
  const viewer = (): PlayerId => (kind !== 'hotseat' ? me : s.phase === 'placement' ? placingFor : 0);

  function startPlacement(p: PlayerId) {
    placingFor = p;
    layoutMap.clear();
    selected = null;
    placeRank = PLACE_ORDER[0];
    board.viewer = viewer();
    board.ov = { ...board.ov, zone: { side: s.players[p].side }, moves: [], attacks: [], options: [], lastMove: [] };
    board.sync(viewState());
    board.onCell = placeClick;
    board.onHover = (c) => {
      const zone = homeRows(s, s.players[p].side);
      board.ov.ghost = c && zone.includes(c.y) && !layoutMap.has(key(c)) && counts()[placeRank] < LIMIT[placeRank] ? { pos: c, rank: placeRank, owner: p } : null;
    };
    renderPlacement();
  }

  function placeClick(c: Pos) {
    const zone = homeRows(s, s.players[placingFor].side);
    if (!zone.includes(c.y)) {
      sfx.error();
      return;
    }
    const k = key(c);
    if (layoutMap.has(k)) {
      layoutMap.delete(k);
      sfx.crumble();
    } else {
      if (counts()[placeRank] >= LIMIT[placeRank]) {
        sfx.error();
        return;
      }
      layoutMap.set(k, placeRank);
      const vs = viewState();
      const pc = vs.pieces.find((q) => q.x === c.x && q.y === c.y)!;
      void board.playEvent({ type: 'spawn', piece: pc });
      // автопереход к следующему типу
      if (counts()[placeRank] >= LIMIT[placeRank]) {
        const next = PLACE_ORDER.find((r) => counts()[r] < LIMIT[r]);
        if (next !== undefined) placeRank = next;
      }
    }
    board.ov.ghost = null;
    board.sync(viewState());
    renderPlacement();
  }

  function applyPreset(id: string) {
    const preset = PRESETS.find((p) => p.id === id)!;
    layoutMap.clear();
    board.sync(viewState());
    const lay = preset.build(s, s.players[placingFor].side);
    for (const l of lay) layoutMap.set(key(l), l.rank);
    const vs = viewState();
    vs.pieces.forEach((pc, i) => setTimeout(() => void board.playEvent({ type: 'spawn', piece: pc }), i * 18));
    setTimeout(() => board.sync(viewState()), lay.length * 18 + 450);
    renderPlacement();
  }

  function renderPlacement() {
    const c = counts();
    const total = c[0] + c[1] + c[2];
    const color = s.players[placingFor].color;
    const up = s.players[placingFor].side === 0;
    const rows = homeRows(s, s.players[placingFor].side);
    const inRow = (y: number) => [...layoutMap.keys()].filter((k) => unkey(k).y === y).length;
    const rival = other(placingFor);
    const rivalNote =
      kind === 'bot' ? 'уже расставился' : kind === 'net' ? (oppReady ? 'готов' : 'расставляется…') : placingFor === 0 ? 'расставится следом' : 'уже расставился';
    left.replaceChildren(
      seatCard(placingFor, kind === 'hotseat' ? `расставляет · игрок ${placingFor + 1} из 2` : 'расставляет фигуры', true),
      h(
        'div',
        { class: 'rank-picks' },
        ...PLACE_ORDER.map((r) => {
          const left = LIMIT[r] - c[r];
          return h(
            'button',
            { class: `rank-pick ${placeRank === r ? 'active' : ''} ${left === 0 ? 'empty' : ''}`, onclick: () => ((placeRank = r), sfx.select(), renderPlacement()) },
            pieceIcon(r, color, 3, up),
            h('span', { class: 'rp-name' }, RANK_NAME[r]),
            h('span', { class: 'rp-left' }, String(left)),
          );
        }),
      ),
      // быстрая расстановка — внизу колонки, рядом с «Готово» под полем: меньше тянуться мышью
      presetsPanel(),
      h('div', { class: 'controls' }, btn('В меню', () => leave(), 'btn-dark btn-small')),
    );
    right.replaceChildren(
      seatCard(rival, rivalNote, false),
      h(
        'section',
        { class: 'slab' },
        h('div', { class: 'h-label' }, 'Фигуры'),
        legendRow(Rank.Triangle, color, up, 'Треугольник', '1 клетка вперёд'),
        legendRow(Rank.Square, color, up, 'Квадрат', 'до 3 вперёд, по диагонали и вбок'),
        legendRow(Rank.Circle, color, up, 'Круг', 'до 5 в любую сторону'),
      ),
      h(
        'section',
        { class: 'slab' },
        h('div', { class: 'h-label' }, 'Ваша армия'),
        ...[['Передний', rows[2]], ['Средний', rows[1]], ['Тыл', rows[0]]].map(([l, y]) =>
          h('div', { class: 'army-row' }, h('span', {}, String(l)), h('div', { class: 'meter' }, h('div', { class: 'meter-fill', style: `width:${(inRow(y as number) / 12) * 100}%` })), h('b', {}, String(inRow(y as number)))),
        ),
      ),
      h('section', { class: 'slab hint' }, 'Клик по своим трём рядам ставит фигуру, повторный клик — убирает. Расстановка скрыта от соперника.'),
    );
    // под полем: сколько стоит, полоса прогресса и что ставим сейчас — рядом с главной кнопкой
    const done = total === 21;
    bottom.replaceChildren(
      h(
        'div',
        { class: `prompt slab place-progress ${done ? 'done' : ''}` },
        h('div', { class: 'pp-count' }, h('b', {}, String(total)), h('span', {}, '/21')),
        h(
          'div',
          { class: 'pp-body' },
          done
            ? h('div', { class: 'pp-text' }, 'Армия собрана — можно начинать')
            : h(
                'div',
                { class: 'pp-text' },
                'Ставим',
                h('span', { class: 'spawn-rank' }, pieceIcon(placeRank, color, 2, up), RANK_NAME[placeRank]),
                h('span', { class: 'muted' }, `ещё ${LIMIT[placeRank] - c[placeRank]}`),
              ),
          h('div', { class: 'meter' }, h('div', { class: 'meter-fill', style: `width:${(total / 21) * 100}%` })),
        ),
      ),
      h('div', { class: 'bb-actions' }, btn('Готово', () => ready(), `btn-amber btn-big bb-main ${done ? 'ready-pulse' : ''}`, { disabled: !done })),
    );
  }

  /** Карточка игрока на расстановке — на месте его панели в партии: при старте партии профили остаются на месте. */
  function seatCard(p: PlayerId, note: string, active: boolean) {
    const pl = s.players[p];
    return h(
      'section',
      { class: `slab player seat pl-${pl.color} ${active ? 'active' : ''} ${p === viewer() ? 'pl-own' : 'pl-opp'}`, 'data-player': String(p) },
      h('div', { class: 'pl-head' }, avatarEl(avatarSeed(p), 4), h('div', { class: 'pl-id' }, h('div', { class: 'pl-name' }, pl.name), controllerLabel(p))),
      h('div', { class: 'seat-note' }, note),
    );
  }

  /** Быстрая расстановка: пресеты сеткой 2×2, «Очистить» — отдельной строкой под ними. */
  function presetsPanel() {
    return h(
      'section',
      { class: `slab presets-panel ${layoutMap.size === 0 ? 'fresh' : ''}` },
      h('div', { class: 'presets-head' }, h('div', { class: 'h-label' }, 'Быстрая расстановка'), h('div', { class: 'presets-sub' }, 'готовое построение в один клик')),
      h('div', { class: 'presets' }, ...PRESETS.map((p) => btn(p.name, () => applyPreset(p.id), 'btn-stone btn-small'))),
      btn('Очистить', () => {
        layoutMap.clear();
        board.sync(viewState());
        renderPlacement();
      }, 'btn-dark btn-small presets-clear', { disabled: layoutMap.size === 0 }),
    );
  }

  function legendRow(r: Rank, color: 'red' | 'black', up: boolean, name: string, d: string) {
    return h('div', { class: 'legend' }, pieceIcon(r, color, 3, up), h('div', {}, h('b', {}, name), h('div', { class: 'muted small' }, d)));
  }

  async function ready() {
    const lay = [...layoutMap].map(([k, rank]) => ({ ...unkey(k), rank }));
    board.ov.zone = null;
    board.ov.ghost = null;
    board.onHover = () => {};
    board.onCell = () => {};
    match.submit({ type: 'place', by: placingFor, layout: lay });
    if (kind === 'net') renderWaiting();
    if (kind === 'hotseat' && placingFor === 0) {
      await curtain(`Передайте устройство`, `${names[1]} расставляет фигуры`);
      startPlacement(1);
    }
  }

  /** Сеть: своя расстановка отправлена — ждём соперника. */
  function renderWaiting() {
    board.ov = { ...board.ov, zone: null, ghost: null };
    board.onHover = () => {};
    board.onCell = () => {};
    left.replaceChildren(
      seatCard(me, 'расстановка отправлена', false),
      h('section', { class: 'slab hint' }, 'Ваша расстановка скрыта: соперник увидит её только когда закончит свою.'),
      h('div', { class: 'controls' }, btn('В меню', () => leave(), 'btn-dark btn-small')),
    );
    right.replaceChildren(seatCard(opp, oppReady ? 'готов — начинаем…' : 'расставляется…', true));
    bottom.replaceChildren(h('div', { class: 'prompt slab' }, 'Ждём соперника…'));
  }

  // ════════════════════════════════════════════════════════════════════════
  // ИГРА
  // ════════════════════════════════════════════════════════════════════════
  match.onError = (m) => {
    sfx.error();
    toast(m, 'brand');
  };

  match.onEvents = async (events, st) => {
    if (events.some((e) => e.type === 'placed') && st.phase === 'placement') return;
    // отстали (свёрнутая вкладка, переподключение) — догоняем без анимаций
    if (match.backlog > 2) {
      for (const e of events) chronicleFrom(e, st);
      if (events.some((e) => e.type === 'start')) {
        board.viewer = viewer();
        board.ov = { ...board.ov, zone: null, ghost: null };
        board.onHover = playHover;
        board.onCell = playClick;
      }
      board.sync(st);
      refresh();
      return;
    }
    const drawnNow = new Set<CardId>();
    // спавны расстановки не анимируем по одному — армии «падают» разом в beginPlay()
    const startAt = events.findIndex((e) => e.type === 'start');
    const list = startAt >= 0 ? events.slice(startAt) : events;
    // баннер хода нужен только для последнего хода в пачке (карта могла сразу закончить ход)
    const lastTurn = list.map((e) => e.type).lastIndexOf('turnStart');
    animating = true;
    for (const [i, e] of list.entries()) {
      chronicleFrom(e, st);
      tut?.before(e);
      switch (e.type) {
        case 'start':
          await beginPlay();
          break;
        case 'turnStart':
          selected = null;
          // «Ваш ход» — когда улягутся обломки атаки, а не посреди удара
          if (i === lastTurn) await board.settle();
          refresh();
          sfx.turn();
          if (i !== lastTurn) break;
          if (kind === 'hotseat') await banner(`Ход: ${st.players[e.player].name}`, `ход ${e.ownTurn}`, e.player === 0 ? 'brand' : 'stone', 450);
          else if (e.player === me) await banner('Ваш ход', `ход ${e.ownTurn}`, 'brand', 380);
          if (match.isHuman(e.player) && heldExpiresThisTurn(st, e.player))
            toast(`Последний ход Периода: сыграйте «${CARDS[st.players[e.player].held!.card].name}» до атаки и конца хода, иначе карта сгорит`, 'brand');
          break;
        case 'cardDrawn':
          drawnNow.add(e.card);
          await karmaReveal(e.card, e.player, 'drawn');
          break;
        case 'cardPlayed':
          if (!drawnNow.has(e.card)) await karmaReveal(e.card, e.player, 'played');
          break;
        case 'cardDiscarded':
          toast(`«${CARDS[e.card].name}»: ${e.reason}`, 'amber');
          break;
        case 'skipTurn':
          await banner('Пропуск хода', st.players[e.player].name, 'stone', 500);
          break;
        case 'capture': {
          await board.playEvent(e);
          const at = board.cellToClient(e.to);
          floatText(`−${GLYPH[e.victim.rank]}`, at.x, at.y, 'ft-brand');
          break;
        }
        case 'gameOver':
          break;
        default:
          await board.playEvent(e);
      }
      if (tut) {
        await tut.after(e, st);
        refreshBoard();
      }
    }
    animating = false;
    board.sync(st);
    refresh();
    const over = events.find((e) => e.type === 'gameOver');
    if (over && over.type === 'gameOver') await (tut ? showTutorialEnd() : showResult(over.winner, over.reason));
  };

  async function beginPlay() {
    for (const el of [...left.children, ...right.children, ...bottom.children])
      if (!el.classList.contains('player')) el.classList.add('panel-out');
    board.viewer = viewer();
    board.ov = { ...board.ov, zone: null, ghost: null };
    board.onHover = playHover;
    board.onCell = playClick;
    board.clear();
    await wait(150);
    // обе армии «падают» на поле
    const order = [...s.pieces].sort((a, b) => (a.owner - b.owner) || (a.y - b.y) || (a.x - b.x));
    order.forEach((pc, i) => setTimeout(() => void board.playEvent({ type: 'spawn', piece: pc }), i * 22));
    await wait(order.length * 22 + 450);
    board.sync(s);
    const first = s.players[s.current];
    await banner(`Первым ходит ${first.name}`, `${s.players[0].name}: ${s.players[0].color === 'red' ? 'красные' : 'чёрные'} · ${s.players[1].name}: ${s.players[1].color === 'red' ? 'красные' : 'чёрные'}`, 'amber', 900);
  }

  const humanActs = () => s.phase === 'play' && !overlayOpen && !match.isBusy && match.isHuman(match.actor());

  function playClick(c: Pos) {
    // не наш ход — фигуры видно наведением, двигать нельзя
    if (!humanActs()) return sfx.error();
    const p = match.actor();
    if (tut && !tut.allows(c, selected !== null ? s.pieces.find((q) => q.id === selected) : undefined)) return tut.nudge();
    if (s.pending) {
      if (s.pending.kind === 'cell' && s.pending.options.includes(key(c))) {
        sfx.select();
        match.submit({ type: 'choose', by: p, option: key(c) });
      } else sfx.error();
      return;
    }
    const pc = pieceAt(s, c);
    if (selected !== null) {
      const sel = s.pieces.find((q) => q.id === selected);
      const t = sel && legalTargets(s, sel).find((q) => q.to.x === c.x && q.to.y === c.y);
      if (sel && t) {
        selected = null;
        board.ov.moves = [];
        board.ov.attacks = [];
        match.submit({ type: 'move', by: p, pieceId: sel.id, to: c });
        return;
      }
    }
    if (pc && pc.owner === p && canAct(s, pc)) {
      selected = pc.id === selected ? null : pc.id;
      sfx.select();
    } else {
      if (pc && pc.owner === p) toast('Эта фигура уже действовала', 'stone');
      selected = null;
    }
    refreshBoard();
    renderBottom();
  }

  function playHover(c: Pos | null) {
    hoverCell = c;
    updatePreview();
  }

  /** Подсказки под курсором: ходы и атаки любой фигуры, призрак новой фигуры на клетке выбора. */
  function updatePreview() {
    const ov = board.ov;
    ov.preview = null;
    ov.ghost = null;
    if (s.phase !== 'play' || overlayOpen) return;
    const pin = tut?.threat ?? null;
    const pinned = pin !== null ? s.pieces.find((q) => q.id === pin) : undefined;
    // во время подписей обучения — только закреплённый узор: курсор мог остаться на чужой фигуре,
    // а партия уже ушла вперёд (вопрос карты ещё не показан)
    if (animating) return showPattern(pinned);
    const pend = s.pending;
    if (pend) {
      const rank = pend.data.spawnRank as Rank | undefined;
      if (hoverCell && rank !== undefined && pend.kind === 'cell' && match.isHuman(pend.chooser) && pend.options.includes(key(hoverCell)))
        ov.ghost = { pos: hoverCell, rank, owner: pend.beneficiary };
      return;
    }
    // выбрана своя фигура — на поле её ходы, разведку не смешиваем
    if (selected !== null) return;
    showPattern((hoverCell && pieceAt(s, hoverCell)) || pinned);
  }

  function showPattern(pc: Piece | undefined) {
    if (!pc) return;
    const side = kind === 'hotseat' ? s.current : me;
    const moves: Pos[] = [];
    const attacks: Pos[] = [];
    for (const t of targetsOf(s, pc)) (t.attack ? attacks : moves).push(t.to);
    board.ov.preview = { id: pc.id, moves, attacks, foe: pc.owner !== side };
  }

  function refreshBoard() {
    const ov = board.ov;
    ov.selected = null;
    ov.moves = [];
    ov.attacks = [];
    ov.options = [];
    const human = s.phase === 'play' && match.isHuman(match.actor());
    if (s.pending) {
      // выбор клетки по карте — только после того, как карта показана и принята
      if (human && s.pending.kind === 'cell' && !animating) {
        ov.options = tut?.step?.choose ?? s.pending.options.map(unkey);
        ov.optionsTone = DESTRUCTIVE.has(s.pending.source) ? 'brand' : 'amber';
      }
    } else {
      const sel = selected !== null ? s.pieces.find((q) => q.id === selected) : undefined;
      if (human && sel && canAct(s, sel)) {
        ov.selected = sel.id;
        for (const t of legalTargets(s, sel)) (t.attack ? ov.attacks : ov.moves).push(t.to);
      } else selected = null;
    }
    if (tut) {
      // узор выбранной фигуры проступает сквозь тень — так игрок видит, как она ходит
      const lit = animating || overlayOpen ? null : tut.focus();
      ov.focus = lit && [...lit, ...ov.moves, ...ov.attacks];
      tut.render(animating || overlayOpen);
    }
    updatePreview();
  }

  // ── HUD ─────────────────────────────────────────────────────────────────
  let lastAp = -1;
  let hudShown = false;
  function refresh() {
    if (s.phase === 'placement') return;
    refreshBoard();
    renderTop();
    renderBottom();
    // плашка «ходит» до перерисовки: если ход сменился, она перелетит к другой панели
    const oldBadge = layout.querySelector<HTMLElement>('.pl-turn');
    const from = oldBadge?.getBoundingClientRect();
    const fromOwner = oldBadge?.closest('.player')?.getAttribute('data-player');
    // своя панель всегда слева, соперник — справа
    const mine = viewer();
    // «На поле» — только когда что-то действует: пустая плита с «пока ничего» лишь занимала колонку
    left.replaceChildren(...[playerPanel(mine), top, effectsPanel(), controls()].filter((n): n is HTMLElement => !!n));
    right.replaceChildren(playerPanel(other(mine)), deckPanel(), logPanel());
    if (!hudShown) {
      // первый кадр партии: всё, кроме профилей (они стояли тут и на расстановке), въезжает по очереди
      hudShown = true;
      [...left.children, ...right.children, ...bottom.children]
        .filter((el) => !el.classList.contains('player'))
        .forEach((el, i) => {
          el.classList.add('panel-in');
          (el as HTMLElement).style.animationDelay = `${i * 50}ms`;
        });
    }
    if (from && fromOwner !== undefined && fromOwner !== String(s.current) && s.phase === 'play') flyTurnBadge(from);
    // окно кладбища по карте — тоже после показа карты
    if (s.pending?.kind === 'grave' && match.isHuman(s.pending.chooser) && !overlayOpen && !animating) void gravePicker();
  }

  /** Плашка «ходит» перелетает дугой от панели одного игрока к панели другого. */
  let badgeFlying = false;
  function flyTurnBadge(from: DOMRect) {
    const to = layout.querySelector<HTMLElement>('.pl-turn');
    if (!to || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const r = to.getBoundingClientRect();
    const dx = Math.round(r.left - from.left);
    const dy = Math.round(r.top - from.top);
    const fly = h('div', { class: 'pl-turn turn-fly', style: `left:${from.left}px;top:${from.top}px` }, 'ходит');
    document.body.appendChild(fly);
    badgeFlying = true;
    to.classList.add('landing');
    const tilt = dx > 0 ? 14 : -14;
    const anim = fly.animate(
      [
        { transform: 'translate(0, 0) rotate(0deg) scale(1)' },
        { transform: `translate(${dx * 0.15}px, ${dy * 0.15 - 40}px) rotate(${-tilt}deg) scale(1.5)`, offset: 0.2 },
        { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 110}px) rotate(${tilt}deg) scale(1.9)`, offset: 0.55 },
        { transform: `translate(${dx}px, ${dy}px) rotate(0deg) scale(1)` },
      ],
      { duration: 720 / animSpeed(), easing: 'cubic-bezier(.45,.05,.4,1)' },
    );
    // в фоновой вкладке анимации стоят — плашка всё равно должна приземлиться
    const safety = setTimeout(() => land(), 720 / animSpeed() + 400);
    const land = () => {
      clearTimeout(safety);
      if (!fly.isConnected) return;
      anim.cancel();
      fly.remove();
      badgeFlying = false;
      const b = layout.querySelector<HTMLElement>('.pl-turn');
      b?.classList.remove('landing');
      pop(b);
      sfx.stamp();
    };
    anim.onfinish = land;
    anim.oncancel = land;
  }

  const apPips = h('div', { class: 'ap-pips' });
  const apNum = h('div', { class: 'ap-num' });
  const turnClock = h('div', { class: 'tb-clock' });
  const turnBar = h('div', { class: 'clock-bar' }, h('div', { class: 'clock-fill' }));
  const totals = h('div', { class: 'tb-totals' });
  const choiceLabel = h('div', { class: 'tb-choice' });

  function updatePips() {
    apPips.replaceChildren(...Array.from({ length: s.mode.ap }, (_, i) => h('div', { class: `pip ${i < s.ap ? 'on' : ''}` })));
    apNum.textContent = `${s.ap}/${s.mode.ap}`;
    if (s.ap !== lastAp) pop(apNum);
    lastAp = s.ap;
  }
  function renderTop() {
    const cur = s.players[s.current];
    updatePips();
    top.replaceChildren(
      h('div', { class: 'tb-turn' }, h('span', { class: `chip chip-${cur.color}` }), cur.name, h('span', { class: 'muted' }, ` · ход ${cur.ownTurns}`)),
      h('div', { class: 'tb-ap' }, h('span', { class: 'h-label' }, 'Действия'), apPips, apNum),
      h('div', { class: 'tb-time' }, choiceLabel, h('div', { class: 'tb-clock-row' }, turnClock, totals), turnBar),
    );
    tickClocks();
  }

  function tickClocks() {
    // пока соперник выбирает по карте, часы хода стоят — показываем его таймер выбора
    const ch = choosingOpponent(s);
    const left = ch !== null ? match.clocks.choiceLeft : match.clocks.turnLeft;
    const k = left / (ch !== null ? s.mode.choiceMs : s.mode.turnMs);
    turnClock.textContent = fmt(left);
    (turnBar.firstChild as HTMLElement).style.width = `${k * 100}%`;
    turnBar.classList.toggle('low', k < 0.2);
    turnBar.classList.toggle('choice', ch !== null);
    choiceLabel.textContent = ch !== null ? `выбор: ${s.players[ch].name}` : '';
    totals.textContent = `${fmt(match.clocks.total[0])} · ${fmt(match.clocks.total[1])}`;
  }
  const clockTimer = setInterval(tickClocks, 250);

  function renderBottom() {
    const p = match.actor();
    const human = match.isHuman(p);
    let prompt: string | Node = '';
    const actions: Node[] = [];
    if (s.phase === 'over') prompt = s.endReason ?? '';
    else if (tut) {
      // пока идут анимации, состояние уже ушло вперёд — имя ходящего не показываем; вопрос карты — тоже подсказкой такта
      prompt = (!animating && tut.step?.hint) || '…';
    } else if (s.pending) {
      const src = s.pending.source === 'promotion' ? 'Повышение' : CARDS[s.pending.source].name;
      const rank = s.pending.data.spawnRank as Rank | undefined;
      prompt = human ? `${src}: ${s.pending.prompt}` : `${s.players[p].name} выбирает (${src})…`;
      // новая фигура: какую ставим — иконкой и названием
      if (human && rank !== undefined) {
        const pl = s.players[s.pending.beneficiary];
        const up = pl.side === (board.viewer === null ? 0 : s.players[board.viewer].side);
        prompt = h(
          'span',
          { class: 'prompt-spawn' },
          `${src}: поставьте`,
          h('span', { class: 'spawn-rank' }, pieceIcon(rank, pl.color, 2, up), RANK_NAME[rank]),
          h('span', { class: 'muted' }, 'на светящуюся клетку'),
        );
      }
      if (human && s.pending.canSkip) actions.push(btn('Хватит', () => match.submit({ type: 'skip', by: p }), 'btn-dark btn-big'));
    } else if (human) {
      prompt = selected !== null ? 'Выберите клетку: точка — ход, рамка — атака' : s.actedThisTurn ? 'Ещё действие или завершите ход' : 'Выберите фигуру';
    } else prompt = `${s.players[p].name} думает…`;
    const canEnd = human && !s.pending && s.current === p && (s.actedThisTurn || !anyLegalAction(s)) && s.phase === 'play' && (!tut || !!tut.step?.endTurn);
    if (human && !s.pending && s.phase === 'play' && !tut) actions.push(btn('Отменить', () => ((selected = null), refreshBoard(), renderBottom()), 'btn-stone btn-big', { disabled: selected === null }));
    actions.push(btn('Завершить ход', () => match.submit({ type: 'endTurn', by: s.current }), `btn-amber btn-big bb-main ${tut && canEnd ? 'tut-pulse' : ''}`, { disabled: !canEnd }));
    bottom.replaceChildren(h('div', { class: `prompt slab ${s.pending && human ? 'prompt-hot' : ''}` }, prompt), h('div', { class: 'bb-actions' }, ...actions));
  }

  function playerPanel(p: PlayerId) {
    const pl = s.players[p];
    const pcs = piecesOf(s, p);
    const cnt = [0, 1, 2].map((r) => pcs.filter((q) => q.rank === r).length);
    const active = s.current === p && s.phase === 'play';
    const k = s.mode.karmaEvery;
    const inCycle = pl.ownTurns % k;
    const karmaNow = pl.ownTurns > 0 && inCycle === 0 && s.current === p;
    const until = karmaNow ? 0 : k - inCycle;
    const up = pl.side === 0;
    const held = pl.held;
    const burning = heldExpiresThisTurn(s, p);
    // isBusy здесь не учитываем: панель перерисовывается из onEvents, пока ход ещё «занят», и кнопка залипала бы
    // выключенной. Нажатие во время анимации просто встанет в очередь, движок проверит его сам.
    const block = held && match.isHuman(p) ? heldBlock(s, p) : null;
    return h(
      'section',
      { class: `slab player ${active ? 'active' : ''} pl-${pl.color} ${p === viewer() ? 'pl-own' : 'pl-opp'}`, 'data-player': String(p) },
      h(
        'div',
        { class: 'pl-head' },
        avatarEl(avatarSeed(p), 4),
        h('div', { class: 'pl-id' }, h('div', { class: 'pl-name' }, pl.name), controllerLabel(p)),
        active ? h('div', { class: `pl-turn ${badgeFlying ? 'landing' : ''}` }, 'ходит') : null,
      ),
      h(
        'div',
        { class: 'pl-pieces' },
        ...[0, 1, 2].map((r) => h('div', { class: 'pl-pc' }, pieceIcon(r as Rank, pl.color, 2, up), h('b', {}, String(cnt[r])))),
      ),
      h(
        'div',
        { class: 'karma-track' },
        h('div', { class: 'h-label' }, 'Карма'),
        h('div', { class: 'kt-cells' }, ...Array.from({ length: k }, (_, i) => h('div', { class: `kt ${i < (karmaNow ? k : inCycle) ? 'on' : ''} ${i === k - 1 ? 'last' : ''}` }))),
        h('div', { class: `kt-label ${karmaNow ? 'now' : ''}` }, karmaNow ? 'сейчас' : s.deck.length ? `через ${until}` : 'колода пуста'),
      ),
      held
        ? h(
            'div',
            { class: `held ${burning ? 'burning' : ''}` },
            cardEl(held.card, { scale: 2, idle: true }).el,
            h(
              'div',
              { class: 'held-info' },
              h('b', {}, CARDS[held.card].name),
              burning ? h('div', { class: 'held-burn small' }, 'сгорит в конце хода') : h('div', { class: 'muted small' }, `до хода ${held.untilOwnTurn}`),
              match.isHuman(p) ? btn('Разыграть', () => match.submit({ type: 'playCard', by: p }), 'btn-amber btn-small', { disabled: !!block }) : null,
              // в чужой ход и так ясно, почему кнопка погашена; в свой — говорим причину
              block && s.current === p ? h('div', { class: 'held-why muted small' }, block) : null,
            ),
          )
        : null,
    );
  }

  function controllerLabel(p: PlayerId) {
    const c = match.cfg.controllers[p];
    if (c === 'bot') return h('div', { class: 'muted small' }, `бот · ${level.name}`);
    if (c !== 'remote') return h('div', { class: 'muted small' }, kind === 'net' ? 'вы' : 'игрок');
    const on = !!client?.opponentConnected;
    return h('div', { class: `net-badge ${on ? 'on' : 'off'}` }, on ? '● на связи' : '○ нет связи');
  }

  function effectsPanel() {
    const list = s.effects.filter((e) => !(e.kind === 'blitz' && e.done));
    if (!list.length) return null;
    return h(
      'section',
      { class: 'slab' },
      h('div', { class: 'h-label' }, 'На поле'),
      h(
        'div',
        { class: 'effects' },
        ...list.map((e) => {
          const left = e.untilOwnTurn - s.players[e.owner].ownTurns + 1;
          return h('div', { class: `effect fx-${s.players[e.owner].color}` }, h('span', {}, EFFECT_NAME[e.kind]), h('span', { class: 'muted small' }, `${s.players[e.owner].name} · ${left <= 1 ? 'этот ход' : `ещё ${left} х.`}`));
        }),
      ),
    );
  }

  function controls() {
    if (tut) return h('div', { class: 'controls' }, btn('Пропустить обучение', () => (saveProfile({ tutorialDone: true }), open('menu')), 'btn-dark btn-small'));
    return h(
      'div',
      { class: 'controls' },
      btn('Сдаться', () => confirmBox('Сдаться?', 'Партия будет засчитана как поражение.', 'Сдаться', 'Играть дальше', () => match.submit({ type: 'resign', by: kind === 'hotseat' ? s.current : me })), 'btn-dark btn-small'),
      btn('В меню', () => leave(), 'btn-dark btn-small'),
    );
  }

  function deckPanel() {
    const back = cardEl(null, { scale: 1, tilt: false, idle: false }).el;
    return h(
      'section',
      { class: 'slab deck' },
      h('div', { class: 'deck-stack' }, back),
      h(
        'div',
        { class: 'deck-info' },
        h('div', { class: 'h-label' }, 'Колода Кармы'),
        h('div', { class: 'deck-n' }, h('b', {}, String(s.deck.length)), ` из ${s.mode.matchDeckSize}`),
        h('div', { class: 'muted small' }, `сыграно ${s.played.length} · в сбросе ${s.discard.length}`),
      ),
    );
  }

  /** Хроника сворачивается; свёрнутой видна последняя запись. Раскрытие запоминается. */
  function logPanel() {
    const last = chronicle[chronicle.length - 1];
    const d = h(
      'details',
      { class: 'slab log', open: chronicleOpen },
      h(
        'summary',
        { class: 'log-head' },
        h('span', { class: 'h-label' }, 'Хроника'),
        h('span', { class: 'log-count' }, String(chronicle.length)),
        h('span', { class: 'log-last' }, last?.text ?? ''),
      ),
      h('div', { class: 'log-list' }, ...chronicle.slice(-40).reverse().map((l) => h('div', { class: `log-row ${l.p !== undefined ? `lr-${s.players[l.p].color}` : ''}` }, l.text))),
    );
    d.addEventListener('toggle', () => {
      chronicleOpen = d.open;
      try {
        localStorage.setItem('jedibo.chronicle.open', d.open ? '1' : '0');
      } catch {
        /* без хранилища — до перезагрузки */
      }
    });
    return d;
  }

  function chronicleFrom(e: GameEvent, st: GameState) {
    const push = (text: string, p?: PlayerId) => chronicle.push({ text, p });
    const rankOf = (id: number) => st.pieces.find((q) => q.id === id)?.rank;
    switch (e.type) {
      case 'turnStart':
        push(`— ${st.players[e.player].name}, ход ${e.ownTurn} —`);
        break;
      case 'move': {
        const r = rankOf(e.pieceId);
        const owner = st.pieces.find((q) => q.id === e.pieceId)?.owner;
        push(`${r !== undefined ? GLYPH[r] : '·'} ${coord(e.from)}→${coord(e.to)}${e.jump ? ' прыжок' : ''}`, owner);
        break;
      }
      case 'capture': {
        const att = st.pieces.find((q) => q.id === e.attackerId);
        push(`${att ? GLYPH[att.rank] : '·'} ${coord(e.from)}×${coord(e.to)} ${GLYPH[e.victim.rank]}`, att?.owner);
        break;
      }
      case 'destroy':
        push(`✕ ${GLYPH[e.victim.rank]} ${coord(e.victim)}`, e.victim.owner);
        break;
      case 'cardDrawn':
        push(`Карма: «${CARDS[e.card].name}»`, e.player);
        break;
      case 'log':
        push(e.text, e.player);
        break;
      case 'column':
        push(`Линия смерти: столбец ${LETTERS[e.x]}`);
        break;
    }
  }

  // ── оверлеи ─────────────────────────────────────────────────────────────
  async function karmaReveal(card: CardId, p: PlayerId, mode: 'drawn' | 'played') {
    overlayOpen = true;
    const def = CARDS[card];
    setMood('karma');
    sfx.karma();
    const c = cardEl(card, { scale: 4, faceUp: false, idle: true });
    const desc = h('div', { class: 'kr-desc' });
    const note = tut && mode === 'drawn' ? tut.karmaNote(p) : null;
    const btnHost = h('div', { class: 'kr-actions' });
    const ov = h(
      'div',
      { class: 'overlay karma-overlay' },
      h('div', { class: 'kr-head' }, h('div', { class: 'kr-title' }, mode === 'drawn' ? 'Карма' : 'Разыграна карта'), h('div', { class: 'kr-who' }, `${s.players[p].name}`)),
      note ? h('div', { class: 'tut-karma-note' }, h('div', {}, note.title), h('div', { class: 'muted' }, note.sub)) : null,
      h('div', { class: 'kr-card fly-in' }, c.el),
      desc,
      btnHost,
    );
    document.body.appendChild(ov);
    await wait(550);
    if (note) {
      await roulette(c.el.parentElement!, c.el, tut!.roulette(p));
      await wait(120);
    } else {
      c.flip(true);
      sfx.cardFlip();
      await wait(380);
    }
    sfx.stamp();
    shake(5);
    desc.append(
      h('div', { class: 'kr-name stamp' }, def.name),
      h(
        'div',
        { class: 'tags' },
        h('span', { class: 'tag' }, def.timing === 'period' ? 'в течение периода' : 'после получения'),
        def.takesTurn ? h('span', { class: 'tag tag-brand' }, 'занимает ход') : null,
      ),
      h('p', { class: 'kr-text' }, def.text),
    );
    const human = match.isHuman(p);
    await new Promise<void>((res) => {
      const done = () => {
        ov.removeEventListener('click', done);
        res();
      };
      const label = def.timing === 'period' && mode === 'drawn' ? 'В руку' : 'Принять';
      // кнопка — только тому, кому выпала карта; чужая закрывается сама или кликом
      if (human) btnHost.append(btn(label, done, 'btn-amber btn-big'));
      if (!human || kind !== 'hotseat') ov.addEventListener('click', done);
      if (!human) setTimeout(done, 2600);
    });
    ov.classList.add('out');
    setMood('game');
    await wait(260);
    ov.remove();
    overlayOpen = false;
  }

  /** Обучение: лица карт мелькают, как барабан, который тормозит. Каждый щелчок чуть дольше предыдущего,
   *  на предпоследней (плохой) карте барабан почти встал — и последним щелчком приходит настоящая карта. */
  async function roulette(host: HTMLElement, real: HTMLElement, faces: CardId[]) {
    const K = 1.32;
    // интервал на предпоследней карте ~360 мс, от него вниз по геометрической прогрессии
    let delay = 360 / K ** (faces.length - 1);
    for (const [i, id] of faces.entries()) {
      host.replaceChildren(cardEl(id, { scale: 4, idle: false, tilt: false }).el);
      sfx.tick();
      if (i === faces.length - 1) sfx.heartbeat();
      await wait(delay);
      delay *= K;
    }
    // настоящая карта — тем же щелчком барабана, сразу лицом вверх, без переворота
    const inner = real.querySelector<HTMLElement>('.kcard-inner');
    if (inner) inner.style.transition = 'none';
    real.classList.add('face-up');
    host.replaceChildren(real);
    void real.offsetWidth;
    if (inner) inner.style.transition = '';
  }

  /** Конец обучения: победа, эмблема «Ученик», дорога в настоящую партию. */
  async function showTutorialEnd() {
    if (resultShown) return;
    resultShown = true;
    overlayOpen = true;
    saveProfile({ tutorialDone: true });
    await wait(500);
    setMood('win');
    sfx.win();
    shake(12);
    const em = grantEmblem('student');
    if (em)
      setTimeout(() => {
        sfx.emblem();
        toast(`Новая эмблема: ${em.name}`, 'amber');
      }, 900);
    const ov = h(
      'div',
      { class: 'overlay result-overlay' },
      h(
        'div',
        { class: 'result' },
        titleEl('ПОБЕДА', 5),
        // главное — в бой; правила тише, под ним
        h(
          'div',
          { class: 'tut-end-actions' },
          btn('Тренировочный бой', () => (ov.remove(), open('menu'), chooseLevel()), 'btn-amber btn-big'),
          btn('Правила', () => (ov.remove(), open('rules')), 'btn-stone'),
        ),
      ),
    );
    document.body.appendChild(ov);
  }

  async function gravePicker() {
    const pend = s.pending!;
    overlayOpen = true;
    const g = s.players[pend.beneficiary].graveyard;
    const pl = s.players[pend.beneficiary];
    const ov = h(
      'div',
      { class: 'overlay grave-overlay in' },
      h(
        'div',
        { class: 'slab dialog' },
        h('div', { class: 'h-label' }, CARDS[pend.source as CardId]?.name ?? ''),
        h('h2', {}, 'Кого вернуть?'),
        h(
          'div',
          { class: 'grave-list' },
          ...pend.options.map((o) => {
            const e = g.find((x) => String(x.uid) === o)!;
            return h(
              'button',
              {
                class: 'grave-item',
                onclick: () => {
                  ov.remove();
                  overlayOpen = false;
                  match.submit({ type: 'choose', by: pend.chooser, option: o });
                },
              },
              pieceIcon(e.rank, pl.color, 3, pl.side === 0),
              h('span', {}, RANK_NAME[e.rank]),
            );
          }),
        ),
      ),
    );
    document.body.appendChild(ov);
  }

  /** Подтверждение: кнопки подписаны действием («Сдаться» / «Играть дальше»), а не «Да» / «Нет». */
  function confirmBox(title: string, text: string, yesLabel: string, noLabel: string, yes: () => void) {
    overlayOpen = true;
    match.setPaused(true);
    const close = () => {
      ov.remove();
      overlayOpen = false;
      match.setPaused(false);
    };
    const ov = h(
      'div',
      { class: 'overlay in' },
      h('div', { class: 'slab dialog' }, h('h2', {}, title), h('p', {}, text), h('div', { class: 'row' }, btn(yesLabel, () => (close(), yes()), 'btn-brand'), btn(noLabel, close, 'btn-dark'))),
    );
    document.body.appendChild(ov);
  }

  function curtain(title: string, sub: string) {
    return new Promise<void>((res) => {
      const ov = h(
        'div',
        { class: 'overlay curtain in' },
        h('div', { class: 'slab dialog' }, h('h2', {}, title), h('p', {}, sub), btn('Готов', () => (ov.remove(), res()), 'btn-amber btn-big')),
      );
      document.body.appendChild(ov);
    });
  }

  let resultShown = false;
  async function showResult(winner: PlayerId | 'draw', reason: string) {
    if (resultShown) return;
    resultShown = true;
    overlayOpen = true;
    stopNetWatch();
    await wait(500);
    const meWon = winner === me;
    const rated = kind !== 'hotseat';
    let title = winner === 'draw' ? 'НИЧЬЯ' : rated ? (meWon ? 'ПОБЕДА' : 'ПОРАЖЕНИЕ') : `ПОБЕДА`;
    const sub = kind === 'hotseat' && winner !== 'draw' ? s.players[winner].name : reason;
    setMood(winner === 'draw' ? 'game' : rated && !meWon ? 'lose' : 'win');
    (winner === 'draw' || (rated && !meWon) ? sfx.lose : sfx.win)();
    const result = winner === 'draw' ? 'draw' : meWon ? 'win' : 'loss';
    const st = match.stats;
    const rec = {
      opponent: kind === 'bot' ? `${names[opp]} · ${level.name}` : names[opp],
      // обучение сюда не попадает (showTutorialEnd) и в историю не пишется
      kind: kind as MatchRecord['kind'],
      result: (kind === 'hotseat' && winner !== 'draw' ? (meWon ? 'win' : 'loss') : result) as MatchRecord['result'],
      turns: s.turn,
      // расширенная история для Летописи
      mode: 'classic' as const, ownTurns: s.players[me].ownTurns, karmaReceived: st.karma[me], piecesLost: st.lost[me], piecesTotal: 21,
      promotions: st.promotions[me], cardsPlayed: st.cards[me],
    };
    // сеть: итог мог уже быть записан до перезагрузки вкладки — второй раз не пишем (и эмблемы не выдаём)
    const recorded = kind === 'net' && !markRecorded(`${net!.code}:${gameSeed}`);
    const delta = recorded ? 0 : recordMatch(rec, { captures: st.captures[me], cards: st.cards[me] }, kind === 'bot' ? level.rating : (client?.opponent?.rating ?? 1000));
    if (!recorded) {
      const fresh = checkEmblems({
        rec: { ...rec, delta, at: Date.now() },
        piecesLeft: s.pieces.filter((pc) => pc.owner === me).length,
        fatalPlayed: st.fatal[me],
        squarePromotions: st.squarePromotions[me],
        oppWiped: s.pieces.every((pc) => pc.owner === me),
      });
      fresh.forEach((em, i) =>
        setTimeout(() => {
          // звук один на всю пачку эмблем — с первым тостом
          if (i === 0) sfx.emblem();
          toast(`Новая эмблема: ${em.name}`, 'amber');
        }, 900 + i * 700),
      );
    }
    const deltaEl = h('div', { class: `delta ${delta >= 0 ? 'good' : 'bad'}` }, '0');
    const ov = h(
      'div',
      { class: 'overlay result-overlay' },
      h(
        'div',
        { class: 'result' },
        titleEl(title, 5, title === 'ПОРАЖЕНИЕ' ? { face: PAL.concrete300, side: PAL.slab600, edge: PAL.slab800 } : {}),
        h('div', { class: 'result-sub' }, sub),
        h('div', { class: 'muted' }, reason !== sub ? reason : ''),
        h(
          'div',
          { class: 'result-stats slab' },
          stat('ходов', s.turn),
          stat('сбито', match.stats.captures[me]),
          stat('потеряно', match.stats.captures[opp]),
          stat('карт', match.stats.cards[me]),
          rated ? h('div', { class: 'stat' }, deltaEl, h('div', { class: 'stat-l' }, 'рейтинг')) : null,
        ),
        h('div', { class: 'row' }, rematchBtn(), btn('В меню', () => (ov.remove(), endNet(true), open('menu')), 'btn-dark btn-big')),
      ),
    );
    document.body.appendChild(ov);
    // счётчик рейтинга «накручивается»
    const steps = Math.abs(delta);
    for (let i = 1; i <= steps; i++) {
      await wait(40);
      deltaEl.textContent = `${delta >= 0 ? '+' : '−'}${i}`;
      sfx.tick();
    }
    if (!steps) deltaEl.textContent = '±0';
    pop(deltaEl);
  }
  /** Реванш: офлайн — новая партия сразу; в сети — просьба в комнату, новая партия придёт как start с новым seed. */
  function rematchBtn() {
    if (kind !== 'net') return btn('Реванш', () => open('game', { kind, level: level.id }), 'btn-amber btn-big');
    const alive = client!.status === 'over' && !hostGone && client!.opponentConnected && net!.link?.status !== 'failed';
    const b = btn(
      'Реванш',
      () => {
        client!.rematch();
        b.disabled = true;
        b.textContent = oppWantsRematch ? 'Начинаем…' : 'Ждём соперника…';
      },
      'btn-amber btn-big',
      { disabled: !alive },
    );
    rematchButton = b;
    return b;
  }
  const stat = (l: string, v: number) => h('div', { class: 'stat' }, h('div', { class: 'stat-v' }, String(v)), h('div', { class: 'stat-l' }, l));

  function leave() {
    if (kind === 'net') {
      if (s.phase === 'over') return endNet(true), open('menu');
      return confirmBox('Покинуть партию?', s.phase === 'play' ? 'Будет засчитано поражение.' : 'Партия не начнётся.', 'Покинуть', 'Остаться', () => (endNet(true), open('menu')));
    }
    if (tut) return saveProfile({ tutorialDone: true }), open('menu');
    if (s.phase === 'play') confirmBox('Покинуть партию?', 'Прогресс партии будет потерян.', 'Покинуть', 'Остаться', () => open('menu'));
    else open('menu');
  }

  // ════════════════════════════════════════════════════════════════════════
  // СЕТЬ: связь, переподключение, реванш, ошибки
  // ════════════════════════════════════════════════════════════════════════
  let oppReady = false;
  let oppWantsRematch = false;
  let rematchButton: HTMLButtonElement | null = null;
  let hostGone = false;
  /** когда пропала связь (у гостя — с хостом, у хоста — у соперника) */
  let lostSince: number | null = null;
  const strip = h('div', { class: 'net-strip' });
  let netTimer: ReturnType<typeof setInterval> | null = null;
  const unlisten: (() => void)[] = [];

  function stopNetWatch() {
    if (netTimer) clearInterval(netTimer);
    netTimer = null;
    strip.remove();
  }

  function showStrip() {
    if (lostSince === null || s.phase === 'over' || resultShown) return strip.remove();
    const left = Math.max(0, Math.ceil((ABANDON_MS - (Date.now() - lostSince)) / 1000));
    const actorIsOpp = s.phase === 'play' && match.actor() === opp;
    strip.textContent =
      net!.role === 'guest'
        ? `Связь с хостом потеряна — переподключаемся… ${left} с`
        : `Соперник отключился${actorIsOpp || s.phase !== 'play' ? ` — ${left} с на возвращение` : ', ждём'}`;
    if (!strip.isConnected) document.body.appendChild(strip);
  }

  /** На экране итога соперник пропал — реванша не будет. */
  function rematchGone() {
    if (!rematchButton) return;
    rematchButton.disabled = true;
    rematchButton.textContent = 'Соперник ушёл';
  }

  function fatal(title: string, text: string) {
    stopNetWatch();
    overlayOpen = true;
    const ov = h('div', { class: 'overlay in' }, h('div', { class: 'slab dialog' }, h('h2', {}, title), h('p', {}, text), h('div', { class: 'row' }, btn('В меню', () => (ov.remove(), endNet(false), open('menu')), 'btn-dark'))));
    document.body.appendChild(ov);
  }

  if (client && net) {
    unlisten.push(
      client.listen({
        opponent: (_info, on) => {
          if (resultShown) return on ? undefined : rematchGone();
          if (net.role === 'host') {
            lostSince = on ? null : Date.now();
            toast(on ? 'Соперник снова на связи' : 'Соперник отключился', on ? 'amber' : 'brand');
          }
          if (s.phase !== 'placement') refresh();
          showStrip();
        },
        placeCommitted: (seat) => {
          if (seat !== opp) return;
          oppReady = true;
          if (s.phase === 'placement') (client.placeCommitted ? renderWaiting() : renderPlacement());
        },
        rematch: (seat) => {
          if (seat !== opp) return;
          oppWantsRematch = true;
          toast('Соперник хочет реванш', 'amber');
          if (rematchButton?.disabled) rematchButton.textContent = 'Начинаем…';
        },
        abandoned: () => fatal('Партия не состоялась', 'Соперник ушёл до начала партии.'),
        error: (code, text) => {
          if (code === 'cheat') fatal('Партия остановлена', `Соперник нарушил правила: ${text}`);
          else if (code === 'desync' && client.broken) fatal('Партия остановлена', text);
          else if (code === 'version') fatal('Разные версии игры', text);
        },
      }),
    );
    // гость: связь с хостом — комната живёт у него, поэтому о его уходе гостю никто не скажет
    if (net.link) {
      net.link.onStatus = (st) => {
        if (resultShown && st !== 'open') rematchGone();
        if (st === 'open') lostSince = null;
        else if (lostSince === null) lostSince = Date.now();
        if (st === 'failed') lostSince = Date.now() - ABANDON_MS;
        showStrip();
      };
    }
    netTimer = setInterval(() => {
      showStrip();
      // хост пропал дольше окна возвращения — партия засчитывается гостю
      if (net.role === 'guest' && lostSince !== null && Date.now() - lostSince > ABANDON_MS + 2_000 && !resultShown) {
        hostGone = true;
        if (s.phase === 'play') void showResult(me, `${s.players[opp].name} покинул партию`);
        else fatal('Хост пропал', 'Соединение с хостом потеряно.');
        endNet(false);
      }
    }, 500);
    // переподключение / resync / реванш: Match уже обновил состояние — перерисовать без анимаций
    match.onReset = (st) => {
      if (st.seed !== gameSeed) return open('game', { kind: 'net', net });
      if (st.phase === 'placement') {
        if (client.placeCommitted || st.players[me].placed) renderWaiting();
        return;
      }
      enterPlayDirect();
    };
  }

  /** Сразу в партию без анимаций (возврат после перезагрузки или переподключения). */
  function enterPlayDirect() {
    board.viewer = viewer();
    board.ov = { ...board.ov, zone: null, ghost: null };
    board.onHover = playHover;
    board.onCell = playClick;
    board.sync(s);
    refresh();
    if (s.phase === 'over' && s.winner !== null) void showResult(s.winner, s.endReason ?? '');
  }

  /** Обучение: армии падают на поле, бой уже идёт. Пока идёт заставка, ввод закрыт. */
  async function tutorialIntro() {
    overlayOpen = true;
    board.viewer = viewer();
    board.onHover = playHover;
    board.onCell = playClick;
    board.clear();
    refresh();
    await wait(250);
    const order = [...s.pieces].sort((a, b) => (a.owner - b.owner) || (a.y - b.y) || (a.x - b.x));
    order.forEach((pc, i) => setTimeout(() => void board.playEvent({ type: 'spawn', piece: pc }), i * 70));
    await wait(order.length * 70 + 450);
    board.sync(s);
    await banner('Бой уже идёт', 'тебя теснят: 3 фигуры против 7', 'brand', 900);
    overlayOpen = false;
    refresh();
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      selected = null;
      refreshBoard();
      renderBottom();
    }
    if ((e.key === ' ' || e.key === 'Enter') && humanActs() && !s.pending && (s.actedThisTurn || !anyLegalAction(s)) && (!tut || tut.step?.endTurn)) {
      e.preventDefault();
      match.submit({ type: 'endTurn', by: s.current });
    }
  };
  window.addEventListener('keydown', onKey);

  // отладка из консоли: __match.state, __match.submit(...)
  if (import.meta.env.DEV) Object.assign(window, { __match: match, __board: board, __dbg: () => ({ selected, overlayOpen, humanActs: humanActs() }) });

  if (tut) void tutorialIntro();
  else if (s.phase !== 'placement') enterPlayDirect();
  else if (kind === 'net' && (client!.placeCommitted || s.players[me].placed)) renderWaiting();
  else startPlacement(me);
  match.start();
  requestAnimationFrame(fit);

  return () => {
    unlisten.forEach((u) => u());
    stopNetWatch();
    if (net?.link) net.link.onStatus = () => {};
    match.stop();
    board.destroy();
    ro.disconnect();
    clearInterval(clockTimer);
    window.removeEventListener('keydown', onKey);
    tut?.dispose();
    document.querySelectorAll('.overlay, .banner, .turn-fly').forEach((e) => e.remove());
  };
}
