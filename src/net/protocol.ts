// Протокол комнаты (docs/network/README.md §7). Без DOM: общий для вкладки хоста, гостя и будущего сервера.
import type { Action, ModeConfig, PlayerId } from '../core/types';

/** Меняется при любой несовместимой правке протокола или правил движка. */
export const PROTOCOL_VERSION = 1;
/** лимит сообщения клиента; сообщения комнаты (start с полным логом) бывают намного больше */
export const MAX_MSG_BYTES = 8 * 1024;
export const MAX_SERVER_MSG_BYTES = 4 * 1024 * 1024;
/** сколько ждать отключившегося игрока, прежде чем засчитать ему поражение */
export const ABANDON_MS = 15_000;

export type Layout = Extract<Action, { type: 'place' }>['layout'];

export type RoomStatus = 'waiting' | 'seeding' | 'placement' | 'play' | 'over' | 'abandoned';

export interface PeerInfo {
  name: string;
  avatarSeed: string;
  rating: number;
}

export interface ClockSnap {
  turnLeft: number;
  total: [number, number];
  /** чьи часы идут; null — стоят (расстановка, конец партии) */
  running: PlayerId | null;
  /** время комнаты в момент снимка — для интерполяции на клиенте */
  now: number;
}

/** клиент → комната */
export type ClientMsg =
  /** n — растущий номер попытки подключения (от времени): запоздавший hello старого соединения не отнимет место у нового */
  | { t: 'hello'; v: number; n: number; token: string; name: string; avatarSeed: string; rating: number }
  | { t: 'seedShare'; value: number }
  | { t: 'placeCommit'; hash: string }
  | { t: 'placeReveal'; layout: Layout; salt: string }
  /** `action.by` комната игнорирует и подставляет место отправителя */
  | { t: 'submit'; action: Action; cseq: number }
  | { t: 'resync' }
  | { t: 'rematch' }
  | { t: 'leave' }
  | { t: 'ping'; at: number };

export type ErrorCode = 'version' | 'full' | 'badMsg' | 'cheat';

/** комната → клиент */
export type ServerMsg =
  | { t: 'welcome'; seat: PlayerId; code: string; status: RoomStatus; opponent: PeerInfo | null }
  | { t: 'opponent'; info: PeerInfo | null; connected: boolean }
  | { t: 'seedCommit'; hash: string }
  | { t: 'seedReveal'; value: number; salt: string; share: number }
  | { t: 'start'; mode: ModeConfig; seed: number; names: [string, string]; log: Action[]; clocks: ClockSnap }
  | { t: 'placeCommitted'; seat: PlayerId }
  /** оба обязательства получены — можно раскрывать */
  | { t: 'placeCommits'; hashes: [string, string] }
  /** seq — номер действия в логе (с 1); salt — у раскрытой расстановки, для проверки обязательства */
  | { t: 'action'; seq: number; action: Action; hash: number; clocks: ClockSnap; salt?: string }
  | { t: 'reject'; cseq: number; error: string }
  /** игрок seat просит реванш */
  | { t: 'rematch'; seat: PlayerId }
  /** партия не состоялась: кто-то ушёл до её начала */
  | { t: 'abandoned' }
  | { t: 'error'; code: ErrorCode; text: string }
  | { t: 'pong'; at: number; now: number };

const CLIENT_TYPES = new Set<ClientMsg['t']>(['hello', 'seedShare', 'placeCommit', 'placeReveal', 'submit', 'resync', 'rematch', 'leave', 'ping']);
const SERVER_TYPES = new Set<ServerMsg['t']>([
  'welcome', 'opponent', 'seedCommit', 'seedReveal', 'start', 'placeCommitted', 'placeCommits', 'action', 'reject', 'rematch', 'abandoned', 'error', 'pong',
]);

function decode<T extends { t: string }>(raw: string, types: Set<string>, max: number): T | null {
  if (typeof raw !== 'string' || raw.length > max) return null;
  try {
    const m = JSON.parse(raw);
    return m && typeof m === 'object' && !Array.isArray(m) && types.has(m.t) ? (m as T) : null;
  } catch {
    return null;
  }
}

/** Разбор входящего сообщения с проверкой размера и типа. Поля внутри проверяет получатель. */
export const decodeClientMsg = (raw: string) => decode<ClientMsg>(raw, CLIENT_TYPES, MAX_MSG_BYTES);
export const decodeServerMsg = (raw: string) => decode<ServerMsg>(raw, SERVER_TYPES, MAX_SERVER_MSG_BYTES);
export const encode = (m: ClientMsg | ServerMsg) => JSON.stringify(m);
