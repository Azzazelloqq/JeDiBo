// Отладочный пульт сети в консоли (только dev-сборка): __net.host(), __net.join('КОД'), __net.bots(), __net.info().
// Позволяет сыграть партию ботами между двумя вкладками через настоящий PeerJS до появления экранов (этап 4).
import { botAction } from '../ai/bot';
import type { Action, GameState, PlayerId } from '../core/types';
import { getProfile } from '../profile/profile';
import { Match } from '../session/match';
import type { RoomClient } from './client';
import { stableStringify, stateHash } from './hash';
import { GuestLink, hostGame, savedHostRoom, type HostRoom } from './peer';
import { newRoomCode } from './room';

interface Session {
  role: 'host' | 'guest';
  code: string;
  client: RoomClient;
  room?: HostRoom;
  link?: GuestLink;
  match?: Match;
  botDelay?: number;
  events: string[];
}

let cur: Session | null = null;
const K_JOIN = 'jedibo.dev.join';
const K_BOTS = 'jedibo.dev.bots';
const log = (...a: unknown[]) => console.log('%c[net]', 'color:#4f8f86', ...a);

const me = (name?: string) => {
  const p = getProfile();
  return { name: name ?? p.name, avatarSeed: p.avatarSeed, rating: p.rating };
};

function track(s: Session) {
  const note = (e: string) => {
    s.events.push(`${new Date().toISOString().slice(11, 19)} ${e}`);
    if (s.events.length > 200) s.events.shift();
    log(e);
  };
  s.client.listen({
    welcome: (seat, st) => note(`welcome: место ${seat}, статус ${st}`),
    opponent: (info, on) => note(`соперник: ${info?.name ?? '—'} ${on ? 'на связи' : 'нет связи'}`),
    start: (st) => {
      note(`start: seed ${st.seed}, действий ${s.client.appliedSeq}, фаза ${st.phase}`);
      if (s.botDelay !== undefined) startBots(s);
    },
    reject: (e) => note(`отказ: ${e}`),
    error: (code, text) => note(`ОШИБКА ${code}: ${text}`),
    abandoned: () => note('комната брошена'),
    rematch: (seat) => note(`реванш просит ${seat}`),
    action: (a, ev) => {
      if (ev.some((e) => e.type === 'gameOver')) note(`конец партии: ${s.client.state?.endReason}`);
      void a;
    },
  });
}

function startBots(s: Session) {
  if (s.match || !s.client.state || s.client.seat === null) return;
  const seat = s.client.seat;
  const st = s.client.state;
  s.match = new Match({
    names: [st.players[0].name, st.players[1].name],
    controllers: seat === 0 ? ['bot', 'remote'] : ['remote', 'bot'],
    net: s.client,
    botDelay: s.botDelay,
    // длинные партии ботов обрезаем — для проверки сети хватает
    botAct: (gs: GameState, p: PlayerId): Action | null => (gs.phase === 'play' && gs.turn > 400 ? { type: 'resign', by: p } : botAction(gs, p)),
  });
  s.match.onError = (e) => log('Match:', e);
  s.match.start();
}

const api = {
  /** Создать комнату (или поднять сохранённую после перезагрузки вкладки). Возвращает код. */
  host(name?: string): string {
    api.leave();
    const saved = savedHostRoom();
    const code = saved?.code ?? newRoomCode();
    const { room, client } = hostGame(code, me(name), saved?.data);
    room.onStatus = (st, d) => log(`хост: ${st}${d ? ` (${d})` : ''}`);
    cur = { role: 'host', code, client, room, events: [] };
    track(cur);
    log(saved ? `комната ${code} восстановлена` : `комната ${code} создана`);
    return code;
  },
  /** Войти в комнату по коду. */
  join(code: string, name?: string) {
    api.leave();
    const c = code.trim().toUpperCase();
    sessionStorage.setItem(K_JOIN, c);
    const link = new GuestLink(c, me(name));
    link.onStatus = (st, d) => log(`гость: ${st}${d ? ` (${d})` : ''}`);
    cur = { role: 'guest', code: c, client: link.client, link, events: [] };
    track(cur);
  },
  /** Пусть за эту вкладку играет бот (через настоящий Match). */
  bots(delay = 80) {
    if (!cur) return log('нет сессии');
    cur.botDelay = delay;
    sessionStorage.setItem(K_BOTS, String(delay));
    startBots(cur);
  },
  /** Оборвать канал гостя — проверка переподключения. */
  drop() {
    cur?.link?.drop();
  },
  /** Выйти: сдаться/покинуть комнату и закрыть соединения. */
  leave() {
    sessionStorage.removeItem(K_JOIN);
    sessionStorage.removeItem(K_BOTS);
    if (!cur) return;
    cur.client.leave();
    cur.match?.stop();
    cur.link?.dispose();
    cur.room?.dispose();
    cur = null;
  },
  info() {
    if (!cur) return null;
    const c = cur.client;
    const s = c.state;
    return {
      role: cur.role,
      code: cur.code,
      link: cur.link?.status ?? cur.room?.status,
      seat: c.seat,
      status: c.status,
      phase: s?.phase,
      turn: s?.turn,
      applied: c.appliedSeq,
      hash: s && stateHash(s),
      matchInSync: cur.match && s ? stableStringify(cur.match.state) === stableStringify(s) : null,
      opponent: c.opponent?.name,
      opponentConnected: c.opponentConnected,
      clocks: c.clockView(),
      winner: s?.winner,
      endReason: s?.endReason,
      roomLog: cur.room?.host.room.snapshot().log.length,
    };
  },
  events: () => cur?.events ?? [],
  get session() {
    return cur;
  },
};

(window as unknown as { __net: typeof api }).__net = api;

// после перезагрузки вкладки сразу возвращаемся в комнату — так же будет делать лобби
{
  const bots = sessionStorage.getItem(K_BOTS);
  const join = sessionStorage.getItem(K_JOIN);
  const resume = savedHostRoom() ? () => api.host() : join ? () => api.join(join) : null;
  if (resume) {
    // leave() внутри host()/join() стирает флаги — сохраняем и восстанавливаем
    resume();
    if (join) sessionStorage.setItem(K_JOIN, join);
    if (bots) api.bots(Number(bots));
    (window as unknown as { __netResumedAt: number }).__netResumedAt = Date.now();
  }
}
log('пульт сети: __net.host() / __net.join(код) / __net.bots() / __net.info()');
