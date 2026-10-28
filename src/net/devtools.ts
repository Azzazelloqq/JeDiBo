// Отладочный пульт сети в консоли (только dev-сборка). Работает с той же сессией, что и экраны:
// __net.host() / __net.join('КОД') открывают лобби, __net.bots() сажает за эту вкладку бота
// (он ходит через свой Match, экран показывает партию), __net.drop() рвёт канал гостя, __net.info() — сводка.
import { botAction } from '../ai/bot';
import type { Action, GameState, PlayerId } from '../core/types';
import { Match } from '../session/match';
import { endNet, hostNet, joinNet, netSession } from '../session/netSession';
import { go } from '../ui/app';
import { lobbyScreen } from '../ui/screens/lobby';
import { menuScreen } from '../ui/screens/menu';
import type { RoomClient } from './client';
import { stableStringify, stateHash } from './hash';

const K_BOTS = 'jedibo.dev.bots';
const log = (...a: unknown[]) => console.log('%c[net]', 'color:#4f8f86', ...a);
const events: string[] = [];
let bot: { client: RoomClient; match: Match | null; delay: number } | null = null;
let tracked: RoomClient | null = null;

function track(c: RoomClient) {
  if (tracked === c) return;
  tracked = c;
  const note = (e: string) => {
    events.push(`${new Date().toISOString().slice(11, 19)} ${e}`);
    if (events.length > 200) events.shift();
    log(e);
  };
  c.listen({
    welcome: (seat, st) => note(`welcome: место ${seat}, статус ${st}`),
    opponent: (info, on) => note(`соперник: ${info?.name ?? '—'} ${on ? 'на связи' : 'нет связи'}`),
    start: (st) => {
      note(`start: seed ${st.seed}, действий ${c.appliedSeq}, фаза ${st.phase}`);
      if (bot?.client === c && !bot.match) startBot();
    },
    reject: (e) => note(`отказ: ${e}`),
    error: (code, text) => note(`ОШИБКА ${code}: ${text}`),
    abandoned: () => note('комната брошена'),
    rematch: (seat) => note(`реванш просит ${seat}`),
    action: (_a, ev) => ev.some((e) => e.type === 'gameOver') && note(`конец партии: ${c.state?.endReason}`),
  });
}

function startBot() {
  const c = bot?.client;
  if (!bot || !c?.state || c.seat === null) return;
  const seat = c.seat;
  bot.match?.stop();
  bot.match = new Match({
    names: [c.state.players[0].name, c.state.players[1].name],
    controllers: seat === 0 ? ['bot', 'remote'] : ['remote', 'bot'],
    net: c,
    botDelay: bot.delay,
    // длинные партии ботов обрезаем — для проверки сети хватает
    botAct: (gs: GameState, p: PlayerId): Action | null => (gs.phase === 'play' && gs.turn > 400 ? { type: 'resign', by: p } : botAction(gs, p)),
  });
  bot.match.onError = (e) => log('бот:', e);
  // реванш: новый seed → новый Match
  const seed = c.state.seed;
  bot.match.onReset = (st) => st.seed !== seed && startBot();
  bot.match.start();
}

const api = {
  host() {
    hostNet();
    track(netSession()!.client);
    go(lobbyScreen);
    return netSession()!.code;
  },
  join(code: string) {
    joinNet(code);
    track(netSession()!.client);
    go(lobbyScreen);
  },
  /** Пусть за эту вкладку играет бот (переживает перезагрузку вкладки). */
  bots(delay = 80) {
    const s = netSession();
    if (!s) return log('нет сессии');
    sessionStorage.setItem(K_BOTS, String(delay));
    track(s.client);
    bot = { client: s.client, match: null, delay };
    startBot();
  },
  drop() {
    netSession()?.link?.drop();
  },
  /** Хост: как будто вкладку заморозили — peer уничтожен, у брокера комнаты нет. */
  freeze() {
    (netSession()?.room as unknown as { peer?: { destroy(): void } } | undefined)?.peer?.destroy();
  },
  /** Хост: возвращение во вкладку (visibilitychange). */
  thaw() {
    document.dispatchEvent(new Event('visibilitychange'));
  },
  leave() {
    sessionStorage.removeItem(K_BOTS);
    bot?.match?.stop();
    bot = null;
    endNet(true);
    go(menuScreen);
  },
  info() {
    const ses = netSession();
    if (!ses) return null;
    const c = ses.client;
    const s = c.state;
    return {
      role: ses.role,
      code: ses.code,
      link: ses.link?.status ?? ses.room?.status,
      seat: c.seat,
      status: c.status,
      phase: s?.phase,
      turn: s?.turn,
      applied: c.appliedSeq,
      hash: s && stateHash(s),
      botInSync: bot?.match && s ? stableStringify(bot.match.state) === stableStringify(s) : null,
      opponent: c.opponent?.name,
      opponentConnected: c.opponentConnected,
      clocks: c.clockView(),
      winner: s?.winner,
      endReason: s?.endReason,
      roomLog: ses.room?.host.room.snapshot().log.length,
    };
  },
  events: () => events,
};

(window as unknown as { __net: typeof api }).__net = api;
log('пульт сети: __net.host() / __net.join(код) / __net.bots() / __net.drop() / __net.info()');

// после перезагрузки вкладки сессию уже поднял bootScreen — подхватить её и, если просили, бота
{
  const ses = netSession();
  if (ses) {
    track(ses.client);
    const d = sessionStorage.getItem(K_BOTS);
    if (d) api.bots(Number(d));
  }
}
