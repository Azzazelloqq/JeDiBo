// Экран партии: расстановка → игра → итог. Связывает Match, BoardView и HUD.
import { levelById, type LevelId } from '../../ai/levels';
import { sfx } from '../../audio/sfx';
import { CARDS } from '../../core/karma/cards';
import { RANK_NAME } from '../../core/ops';
import { PRESETS } from '../../core/presets';
import { anyLegalAction, canAct, choosingOpponent, heldExpiresThisTurn, homeRows, legalTargets, pieceAt, piecesOf } from '../../core/rules';
import { Rank, key, other, unkey, type CardId, type GameEvent, type GameState, type PlayerId, type Pos } from '../../core/types';
import { ABANDON_MS } from '../../net/protocol';
import { getProfile, recordMatch } from '../../profile/profile';
import { setMood } from '../../render/background';
import { BoardView } from '../../render/board';
import { banner, floatText, pop, shake } from '../../render/fx';
import { wait } from '../../render/tween';
import { Match } from '../../session/match';
import { endNet, type NetSession } from '../../session/netSession';
import { go } from '../app';
import { cardEl } from '../card';
import { btn, h, toast } from '../dom';
import { avatarEl, pieceIcon, titleEl } from '../widgets';
import { menuScreen } from './menu';

type Kind = 'bot' | 'hotseat' | 'net';
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
    : kind === 'bot'
      ? [prof.name, 'Странник']
      : [prof.name, 'Гость'];
  const match = new Match(
    client
      ? { names, controllers: me === 0 ? ['human', 'remote'] : ['remote', 'human'], net: client }
      : { names, controllers: kind === 'bot' ? ['human', 'bot'] : ['human', 'human'], botLevel: level.id },
  );
  const s = match.state;
  const gameSeed = s.seed;
  const board = new BoardView();
  const avatarSeed = (p: PlayerId) => (p === me ? prof.avatarSeed : (client?.opponent?.avatarSeed ?? `${names[p]}#seed`));

  // ── каркас ──────────────────────────────────────────────────────────────
  const left = h('aside', { class: 'side side-left' });
  const right = h('aside', { class: 'side side-right' });
  const top = h('div', { class: 'topbar slab' });
  const bottom = h('div', { class: 'bottombar slab' });
  const boardSlot = h('div', { class: 'board-slot' }, board.el);
  const center = h('main', { class: 'center' }, top, boardSlot, bottom);
  const layout = h('div', { class: 'game' }, left, center, right);
  root.append(layout);

  const fit = () => {
    const r = boardSlot.getBoundingClientRect();
    board.fit(r.width - 8, r.height - 8);
  };
  const ro = new ResizeObserver(fit);
  ro.observe(boardSlot);

  let overlayOpen = false;
  let selected: number | null = null;
  const chronicle: { text: string; p?: PlayerId }[] = [];

  // ════════════════════════════════════════════════════════════════════════
  // РАССТАНОВКА
  // ════════════════════════════════════════════════════════════════════════
  let placingFor: PlayerId = 0;
  const layoutMap = new Map<string, Rank>();
  let placeRank: Rank = Rank.Triangle;
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

  function startPlacement(p: PlayerId) {
    placingFor = p;
    layoutMap.clear();
    selected = null;
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
        const next = [0, 1, 2].find((r) => counts()[r] < LIMIT[r]);
        if (next !== undefined) placeRank = next as Rank;
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
    left.replaceChildren(
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
      h('section', { class: 'slab hint' }, 'Клик ставит фигуру, повторный клик — убирает. Расстановка скрыта от соперника.'),
      btn('В меню', () => leave(), 'btn-dark'),
    );
    right.replaceChildren(
      h(
        'section',
        { class: 'slab place-head' },
        h('div', { class: 'ph-name' }, h('span', { class: `chip chip-${color}` }), s.players[placingFor].name),
        h('div', { class: 'ph-count' }, h('b', {}, String(total)), ' из 21 на поле'),
        h('div', { class: 'meter big' }, h('div', { class: 'meter-fill', style: `width:${(total / 21) * 100}%` })),
      ),
      ...[Rank.Triangle, Rank.Square, Rank.Circle].map((r) => {
        const left = LIMIT[r] - c[r];
        const b = h(
          'button',
          { class: `rank-pick ${placeRank === r ? 'active' : ''} ${left === 0 ? 'empty' : ''}`, onclick: () => ((placeRank = r), sfx.select(), renderPlacement()) },
          pieceIcon(r, color, 3, up),
          h('span', { class: 'rp-name' }, RANK_NAME[r]),
          h('span', { class: 'rp-left' }, String(left)),
        );
        return b;
      }),
      btn('Готово', () => ready(), `btn-amber btn-big ${total === 21 ? 'ready-pulse' : ''}`, { disabled: total !== 21 }),
    );
    top.replaceChildren(
      h('div', { class: 'tb-turn' }, h('span', { class: `chip chip-${color}` }), s.players[placingFor].name),
      h('div', { class: 'tb-title' }, 'Скрытая расстановка'),
      h('div', { class: 'tb-note' }, kind === 'bot' ? 'Странник уже расставился' : kind === 'net' ? (oppReady ? 'Соперник готов' : 'Соперник расставляется…') : `Игрок ${placingFor + 1} из 2`),
    );
    bottom.replaceChildren(
      h('div', { class: 'presets' }, ...PRESETS.map((p) => btn(p.name, () => applyPreset(p.id), 'btn-stone btn-small'))),
      btn('Очистить', () => {
        layoutMap.clear();
        board.sync(viewState());
        renderPlacement();
      }, 'btn-dark btn-small'),
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
    top.replaceChildren(
      h('div', { class: 'tb-turn' }, h('span', { class: `chip chip-${s.players[me].color}` }), s.players[me].name),
      h('div', { class: 'tb-title' }, 'Расстановка отправлена'),
      h('div', { class: 'tb-note' }, oppReady ? 'Соперник готов — начинаем…' : 'Ждём, пока соперник расставится…'),
    );
    right.replaceChildren(h('section', { class: 'slab hint' }, 'Ваша расстановка скрыта: соперник увидит её только когда закончит свою.'));
    bottom.replaceChildren(h('div', { class: 'prompt' }, 'Ждём соперника…'));
  }

  // ════════════════════════════════════════════════════════════════════════
  // ИГРА
  // ════════════════════════════════════════════════════════════════════════
  match.onError = (m) => {
    sfx.error();
    toast(m, 'red');
  };

  match.onEvents = async (events, st) => {
    if (events.some((e) => e.type === 'placed') && st.phase === 'placement') return;
    // отстали (свёрнутая вкладка, переподключение) — догоняем без анимаций
    if (match.backlog > 2) {
      for (const e of events) chronicleFrom(e, st);
      if (events.some((e) => e.type === 'start')) {
        board.ov = { ...board.ov, zone: null, ghost: null };
        board.onHover = () => {};
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
    for (const [i, e] of list.entries()) {
      chronicleFrom(e, st);
      switch (e.type) {
        case 'start':
          await beginPlay();
          break;
        case 'turnStart':
          selected = null;
          refresh();
          sfx.turn();
          if (i !== lastTurn) break;
          if (kind === 'hotseat') await banner(`Ход: ${st.players[e.player].name}`, `ход ${e.ownTurn}`, e.player === 0 ? 'red' : 'stone', 450);
          else if (e.player === me) await banner('Ваш ход', `ход ${e.ownTurn}`, 'red', 380);
          if (match.isHuman(e.player) && heldExpiresThisTurn(st, e.player))
            toast(`Последний ход Периода: сыграйте «${CARDS[st.players[e.player].held!.card].name}» до атаки и конца хода, иначе карта сгорит`, 'red');
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
          floatText(`−${GLYPH[e.victim.rank]}`, at.x, at.y, 'ft-red');
          break;
        }
        case 'gameOver':
          break;
        default:
          await board.playEvent(e);
      }
    }
    board.sync(st);
    refresh();
    const over = events.find((e) => e.type === 'gameOver');
    if (over && over.type === 'gameOver') await showResult(over.winner, over.reason);
  };

  async function beginPlay() {
    board.ov = { ...board.ov, zone: null, ghost: null };
    board.onHover = () => {};
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
    if (!humanActs()) {
      sfx.error();
      return;
    }
    const p = match.actor();
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

  function refreshBoard() {
    const ov = board.ov;
    ov.selected = null;
    ov.moves = [];
    ov.attacks = [];
    ov.options = [];
    const human = s.phase === 'play' && match.isHuman(match.actor());
    if (s.pending) {
      if (human && s.pending.kind === 'cell') {
        ov.options = s.pending.options.map(unkey);
        ov.optionsTone = DESTRUCTIVE.has(s.pending.source) ? 'red' : 'amber';
      }
      return;
    }
    const sel = selected !== null ? s.pieces.find((q) => q.id === selected) : undefined;
    if (human && sel && canAct(s, sel)) {
      ov.selected = sel.id;
      for (const t of legalTargets(s, sel)) (t.attack ? ov.attacks : ov.moves).push(t.to);
    } else selected = null;
  }

  // ── HUD ─────────────────────────────────────────────────────────────────
  let lastAp = -1;
  function refresh() {
    if (s.phase === 'placement') return;
    refreshBoard();
    renderTop();
    renderBottom();
    left.replaceChildren(playerPanel(0), effectsPanel(), controls());
    right.replaceChildren(playerPanel(1), deckPanel(), logPanel());
    if (s.pending?.kind === 'grave' && match.isHuman(s.pending.chooser) && !overlayOpen) void gravePicker();
  }

  const apPips = h('div', { class: 'ap-pips' });
  const apNum = h('div', { class: 'ap-num' });
  const turnClock = h('div', { class: 'tb-clock' });
  const turnBar = h('div', { class: 'clock-bar' }, h('div', { class: 'clock-fill' }));
  const totals = h('div', { class: 'tb-totals' });
  const choiceLabel = h('div', { class: 'tb-choice' });

  function renderTop() {
    const cur = s.players[s.current];
    apPips.replaceChildren(...Array.from({ length: s.mode.ap }, (_, i) => h('div', { class: `pip ${i < s.ap ? 'on' : ''}` })));
    apNum.textContent = `${s.ap}/${s.mode.ap}`;
    if (s.ap !== lastAp) pop(apNum);
    lastAp = s.ap;
    top.replaceChildren(
      h('div', { class: 'tb-turn' }, h('span', { class: `chip chip-${cur.color}` }), cur.name, h('span', { class: 'muted' }, ` · ход ${cur.ownTurns}`)),
      h('div', { class: 'tb-ap' }, h('span', { class: 'h-label' }, 'Очки действий'), apPips, apNum),
      h('div', { class: 'tb-time' }, choiceLabel, turnClock, turnBar, totals),
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
    let prompt = '';
    const actions: Node[] = [];
    if (s.phase === 'over') prompt = s.endReason ?? '';
    else if (s.pending) {
      const src = s.pending.source === 'promotion' ? 'Повышение' : CARDS[s.pending.source].name;
      prompt = human ? `${src}: ${s.pending.prompt}` : `${s.players[p].name} выбирает (${src})…`;
      if (human && s.pending.canSkip) actions.push(btn('Хватит', () => match.submit({ type: 'skip', by: p }), 'btn-dark'));
    } else if (human) {
      prompt = selected !== null ? 'Выберите клетку: точка — ход, рамка — атака' : s.actedThisTurn ? 'Ещё действие или завершите ход' : 'Выберите фигуру';
    } else prompt = `${s.players[p].name} думает…`;
    const canEnd = human && !s.pending && s.current === p && (s.actedThisTurn || !anyLegalAction(s)) && s.phase === 'play';
    actions.push(btn('Завершить ход', () => match.submit({ type: 'endTurn', by: s.current }), 'btn-amber', { disabled: !canEnd }));
    bottom.replaceChildren(h('div', { class: `prompt ${s.pending && human ? 'prompt-hot' : ''}` }, prompt), h('div', { class: 'bb-actions' }, ...actions));
  }

  function playerPanel(p: PlayerId) {
    const pl = s.players[p];
    const pcs = piecesOf(s, p);
    const cnt = [0, 1, 2].map((r) => pcs.filter((q) => q.rank === r).length);
    const lost = pl.graveyard.length;
    const active = s.current === p && s.phase === 'play';
    const k = s.mode.karmaEvery;
    const inCycle = pl.ownTurns % k;
    const karmaNow = pl.ownTurns > 0 && inCycle === 0 && s.current === p;
    const until = karmaNow ? 0 : k - inCycle;
    const up = pl.side === 0;
    const held = pl.held;
    const burning = heldExpiresThisTurn(s, p);
    const canPlayHeld = held && match.isHuman(p) && s.current === p && !s.pending && !match.isBusy && (!CARDS[held.card].canPlay || CARDS[held.card].canPlay!(s, p));
    return h(
      'section',
      { class: `slab player ${active ? 'active' : ''} pl-${pl.color}` },
      h(
        'div',
        { class: 'pl-head' },
        avatarEl(avatarSeed(p), 4),
        h('div', { class: 'pl-id' }, h('div', { class: 'pl-name' }, pl.name), controllerLabel(p)),
        active ? h('div', { class: 'pl-turn' }, 'ходит') : null,
      ),
      h(
        'div',
        { class: 'pl-pieces' },
        ...[0, 1, 2].map((r) => h('div', { class: 'pl-pc' }, pieceIcon(r as Rank, pl.color, 2, up), h('b', {}, String(cnt[r])))),
        h('div', { class: 'pl-lost', title: 'на кладбище' }, '✝', h('b', {}, String(lost))),
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
            cardEl(held.card, { scale: 1.4, idle: true }).el,
            h(
              'div',
              { class: 'held-info' },
              h('b', {}, CARDS[held.card].name),
              burning ? h('div', { class: 'held-burn small' }, 'сгорит в конце хода') : h('div', { class: 'muted small' }, `до хода ${held.untilOwnTurn}`),
              match.isHuman(p) ? btn('Разыграть', () => match.submit({ type: 'playCard', by: p }), 'btn-red btn-small', { disabled: !canPlayHeld }) : null,
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
    return h(
      'section',
      { class: 'slab' },
      h('div', { class: 'h-label' }, 'На поле'),
      list.length
        ? h(
            'div',
            { class: 'effects' },
            ...list.map((e) => {
              const left = e.untilOwnTurn - s.players[e.owner].ownTurns + 1;
              return h('div', { class: `effect fx-${s.players[e.owner].color}` }, h('span', {}, EFFECT_NAME[e.kind]), h('span', { class: 'muted small' }, `${s.players[e.owner].name} · ${left <= 1 ? 'этот ход' : `ещё ${left} х.`}`));
            }),
          )
        : h('div', { class: 'muted small' }, 'пока ничего не действует'),
    );
  }

  function controls() {
    return h(
      'div',
      { class: 'controls' },
      btn('Сдаться', () => confirmBox('Сдаться?', 'Партия будет засчитана как поражение.', () => match.submit({ type: 'resign', by: kind === 'hotseat' ? s.current : me })), 'btn-dark btn-small'),
      btn('В меню', () => leave(), 'btn-dark btn-small'),
    );
  }

  function deckPanel() {
    const back = cardEl(null, { scale: 1.2, tilt: false, idle: false }).el;
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

  function logPanel() {
    return h(
      'section',
      { class: 'slab log' },
      h('div', { class: 'h-label' }, 'Хроника'),
      h('div', { class: 'log-list' }, ...chronicle.slice(-40).reverse().map((l) => h('div', { class: `log-row ${l.p !== undefined ? `lr-${s.players[l.p].color}` : ''}` }, l.text))),
    );
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
    const btnHost = h('div', { class: 'kr-actions' });
    const ov = h(
      'div',
      { class: 'overlay karma-overlay' },
      h('div', { class: 'kr-head' }, h('div', { class: 'kr-title' }, mode === 'drawn' ? 'Карма' : 'Разыграна карта'), h('div', { class: 'kr-who' }, `${s.players[p].name}`)),
      h('div', { class: 'kr-card fly-in' }, c.el),
      desc,
      btnHost,
    );
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add('in'));
    await wait(550);
    c.flip(true);
    sfx.cardFlip();
    await wait(380);
    sfx.stamp();
    shake(5);
    desc.append(
      h('div', { class: 'kr-name stamp' }, def.name),
      h(
        'div',
        { class: 'tags' },
        h('span', { class: 'tag' }, def.timing === 'period' ? 'в течение периода' : 'после получения'),
        def.takesTurn ? h('span', { class: 'tag tag-red' }, 'занимает ход') : null,
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
      btnHost.append(btn(label, done, 'btn-red btn-big'));
      if (!human || kind !== 'hotseat') ov.addEventListener('click', done);
      if (!human) setTimeout(done, 2600);
    });
    ov.classList.add('out');
    setMood('game');
    await wait(260);
    ov.remove();
    overlayOpen = false;
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

  function confirmBox(title: string, text: string, yes: () => void) {
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
      h('div', { class: 'slab dialog' }, h('h2', {}, title), h('p', {}, text), h('div', { class: 'row' }, btn('Да', () => (close(), yes()), 'btn-red'), btn('Нет', close, 'btn-stone'))),
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
    // сеть: итог мог уже быть записан до перезагрузки вкладки — второй раз не пишем
    const recorded = kind === 'net' && !markRecorded(`${net!.code}:${gameSeed}`);
    const delta = recorded ? 0 : recordMatch(
      { opponent: kind === 'bot' ? `${names[opp]} · ${level.name}` : names[opp], kind, result: kind === 'hotseat' && winner !== 'draw' ? (meWon ? 'win' : 'loss') : result, turns: s.turn },
      { captures: match.stats.captures[me], cards: match.stats.cards[me] },
      kind === 'bot' ? level.rating : (client?.opponent?.rating ?? 1000),
    );
    const deltaEl = h('div', { class: `delta ${delta >= 0 ? 'good' : 'bad'}` }, '0');
    const ov = h(
      'div',
      { class: 'overlay result-overlay' },
      h(
        'div',
        { class: 'result' },
        titleEl(title, 5, title === 'ПОРАЖЕНИЕ' ? { face: '#8f8b84', side: '#303035', edge: '#1b1b1e' } : {}),
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
        h('div', { class: 'row' }, rematchBtn(), btn('В меню', () => (ov.remove(), endNet(true), go(menuScreen)), 'btn-stone btn-big')),
      ),
    );
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add('in'));
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
    if (kind !== 'net') return btn('Реванш', () => go((r) => gameScreen(r, kind, undefined, level.id)), 'btn-red btn-big');
    const alive = client!.status === 'over' && !hostGone && client!.opponentConnected && net!.link?.status !== 'failed';
    const b = btn(
      'Реванш',
      () => {
        client!.rematch();
        b.disabled = true;
        b.textContent = oppWantsRematch ? 'Начинаем…' : 'Ждём соперника…';
      },
      'btn-red btn-big',
      { disabled: !alive },
    );
    rematchButton = b;
    return b;
  }
  const stat = (l: string, v: number) => h('div', { class: 'stat' }, h('div', { class: 'stat-v' }, String(v)), h('div', { class: 'stat-l' }, l));

  function leave() {
    if (kind === 'net') {
      if (s.phase === 'over') return endNet(true), go(menuScreen);
      return confirmBox('Покинуть партию?', s.phase === 'play' ? 'Будет засчитано поражение.' : 'Партия не начнётся.', () => (endNet(true), go(menuScreen)));
    }
    if (s.phase === 'play') confirmBox('Покинуть партию?', 'Прогресс партии будет потерян.', () => go(menuScreen));
    else go(menuScreen);
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
    const ov = h('div', { class: 'overlay in' }, h('div', { class: 'slab dialog' }, h('h2', {}, title), h('p', {}, text), h('div', { class: 'row' }, btn('В меню', () => (ov.remove(), endNet(false), go(menuScreen)), 'btn-stone'))));
    document.body.appendChild(ov);
  }

  if (client && net) {
    unlisten.push(
      client.listen({
        opponent: (_info, on) => {
          if (resultShown) return on ? undefined : rematchGone();
          if (net.role === 'host') {
            lostSince = on ? null : Date.now();
            toast(on ? 'Соперник снова на связи' : 'Соперник отключился', on ? 'amber' : 'red');
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
      if (st.seed !== gameSeed) return go((r) => gameScreen(r, 'net', net));
      if (st.phase === 'placement') {
        if (client.placeCommitted || st.players[me].placed) renderWaiting();
        return;
      }
      enterPlayDirect();
    };
  }

  /** Сразу в партию без анимаций (возврат после перезагрузки или переподключения). */
  function enterPlayDirect() {
    board.ov = { ...board.ov, zone: null, ghost: null };
    board.onHover = () => {};
    board.onCell = playClick;
    board.sync(s);
    refresh();
    if (s.phase === 'over' && s.winner !== null) void showResult(s.winner, s.endReason ?? '');
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      selected = null;
      refreshBoard();
      renderBottom();
    }
    if ((e.key === ' ' || e.key === 'Enter') && humanActs() && !s.pending && (s.actedThisTurn || !anyLegalAction(s))) {
      e.preventDefault();
      match.submit({ type: 'endTurn', by: s.current });
    }
  };
  window.addEventListener('keydown', onKey);

  // отладка из консоли: __match.state, __match.submit(...)
  if (import.meta.env.DEV) Object.assign(window, { __match: match, __board: board, __dbg: () => ({ selected, overlayOpen, humanActs: humanActs() }) });

  if (s.phase !== 'placement') enterPlayDirect();
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
    document.querySelectorAll('.overlay, .banner').forEach((e) => e.remove());
  };
}
