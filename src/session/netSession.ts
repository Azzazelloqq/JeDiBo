// Сетевая сессия: комната (у хоста) или канал до хоста (у гостя) + клиент комнаты.
// Живёт дольше одного экрана: лобби → партия → реванш → … → «В меню». Переживает перезагрузку вкладки.
import type { RoomClient } from '../net/client';
import { GuestLink, hostGame, savedHostRoom, type HostRoom } from '../net/peer';
import { newRoomCode } from '../net/room';
import { getProfile } from '../profile/profile';

export interface NetSession {
  role: 'host' | 'guest';
  code: string;
  client: RoomClient;
  room?: HostRoom;
  link?: GuestLink;
}

const K_JOIN = 'jedibo.net.join';
let current: NetSession | null = null;

const me = () => {
  const p = getProfile();
  return { name: p.name, avatarSeed: p.avatarSeed, rating: p.rating };
};

function ss(k: string, v?: string | null): string | null {
  try {
    if (v === undefined) return sessionStorage.getItem(k);
    if (v === null) sessionStorage.removeItem(k);
    else sessionStorage.setItem(k, v);
  } catch {
    // приватный режим — без восстановления после перезагрузки
  }
  return null;
}

export const netSession = () => current;

/** Создать комнату. resume — поднять ту, что эта вкладка хостила до перезагрузки. */
export function hostNet(resume = false): NetSession {
  endNet(false);
  const saved = resume ? savedHostRoom() : null;
  const code = saved?.code ?? newRoomCode();
  const { room, client } = hostGame(code, me(), saved?.data);
  current = { role: 'host', code, client, room };
  return current;
}

/** Войти в комнату по коду. */
export function joinNet(code: string): NetSession {
  endNet(false);
  const c = normalizeCode(code);
  ss(K_JOIN, c);
  const link = new GuestLink(c, me());
  current = { role: 'guest', code: c, client: link.client, link };
  return current;
}

/** Закрыть сессию. leave — сообщить комнате (сдача в партии / уход до начала). */
export function endNet(leave = true) {
  const s = current;
  current = null;
  ss(K_JOIN, null);
  if (!s) return;
  const close = () => {
    s.link?.dispose();
    s.room?.dispose(true);
  };
  if (!leave) return close();
  s.client.leave();
  // дать «leave» уйти по каналу, прежде чем рвать соединение
  setTimeout(close, 300);
}

/** После перезагрузки вкладки: вернуться в комнату, где эта вкладка была. */
export function resumeNet(): NetSession | null {
  if (current) return current;
  if (savedHostRoom()) return hostNet(true);
  const join = ss(K_JOIN);
  return join ? joinNet(join) : null;
}

export const normalizeCode = (s: string) => s.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);

/** Ссылка-приглашение: открытие сразу входит в комнату. */
export const inviteLink = (code: string) => `${location.origin}${location.pathname}#room=${code}`;

/** Код из ссылки-приглашения (и убрать его из адреса, чтобы перезагрузка не входила повторно). */
export function takeInviteCode(): string | null {
  const m = /^#room=([A-Za-z0-9]{5})$/.exec(location.hash);
  if (!m) return null;
  history.replaceState(null, '', location.pathname + location.search);
  return normalizeCode(m[1]);
}
