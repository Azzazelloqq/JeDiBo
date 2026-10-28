// Комната сетевой партии (docs/network/README.md §4–5). Чистая логика: без таймеров, сокетов и DOM.
// На вход — сообщения подключений и «текущее время», на выход — сообщения через RoomIO и nextWake().
// Источник истины — seed + лог действий; GameState держится в памяти и всегда восстановим переигрыванием.
import { createGame, dispatch } from '../core/engine';
import { CLASSIC } from '../core/modes';
import type { Action, GameState, ModeConfig, PlayerId } from '../core/types';
import { commitHash, mixSeed, randomSalt, randomSeedShare, verify } from './commit';
import { stateHash } from './hash';
import { ABANDON_MS, PROTOCOL_VERSION, type ClientMsg, type ClockSnap, type Layout, type PeerInfo, type RoomStatus, type ServerMsg } from './protocol';

export type ConnId = string;

export interface RoomIO {
  send(conn: ConnId, msg: ServerMsg): void;
  close(conn: ConnId): void;
}

export interface RoomOptions {
  mode?: ModeConfig;
  abandonMs?: number;
}

interface Seat extends PeerInfo {
  token: string;
  /** номер попытки подключения из последнего принятого hello */
  attempt: number;
  conn: ConnId | null;
  /** когда отключился (для ABANDON) */
  lastSeen: number;
}

interface PlaceSlot {
  hash: string | null;
  layout: Layout | null;
  salt: string | null;
}

/** Всё состояние комнаты — простой JSON: хост сохраняет его в sessionStorage, сервер — в storage. */
export interface RoomData {
  code: string;
  mode: ModeConfig;
  status: RoomStatus;
  seats: [Seat | null, Seat | null];
  /** доля seed со стороны комнаты (хоста) и обязательство по ней */
  seedSecret: { value: number; salt: string; hash: string } | null;
  seed: number | null;
  /** имена в партии фиксируются при старте: они входят в GameState и не меняются от повторного hello */
  names: [string, string];
  log: Action[];
  place: [PlaceSlot, PlaceSlot];
  clocks: { turnLeft: number; total: [number, number]; runningSince: number | null };
  rematch: [boolean, boolean];
}

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newRoomCode(len = 5): string {
  const r = crypto.getRandomValues(new Uint8Array(len));
  return [...r].map((b) => ROOM_ALPHABET[b % ROOM_ALPHABET.length]).join('');
}

const emptySlot = (): PlaceSlot => ({ hash: null, layout: null, salt: null });
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const SEATS: PlayerId[] = [0, 1];

export class Room {
  private d: RoomData;
  private s: GameState | null = null;
  private conns = new Map<ConnId, PlayerId | null>();
  private chain: Promise<void> = Promise.resolve();
  private readonly abandonMs: number;

  constructor(
    code: string,
    private io: RoomIO,
    opts: RoomOptions = {},
    data?: RoomData,
    now = 0,
  ) {
    this.abandonMs = opts.abandonMs ?? ABANDON_MS;
    if (data) {
      this.d = data;
      // снимок старого формата (до фиксации имён) — берём имена с мест
      this.d.names ??= [data.seats[0]?.name ?? 'Игрок 1', data.seats[1]?.name ?? 'Игрок 2'];
      // после восстановления все считаются отключёнными «с этого момента»
      for (const st of this.d.seats) if (st) Object.assign(st, { conn: null, lastSeen: now });
      if (this.d.clocks.runningSince !== null) this.d.clocks.runningSince = now;
      this.rebuild();
    } else {
      const mode = opts.mode ?? CLASSIC;
      this.d = {
        code,
        mode,
        status: 'waiting',
        seats: [null, null],
        seedSecret: null,
        seed: null,
        names: ['Игрок 1', 'Игрок 2'],
        log: [],
        place: [emptySlot(), emptySlot()],
        clocks: { turnLeft: mode.turnMs, total: [mode.totalMs, mode.totalMs], runningSince: null },
        rematch: [false, false],
      };
    }
  }

  get status(): RoomStatus {
    return this.d.status;
  }
  get code() {
    return this.d.code;
  }
  /** Текущее состояние партии (только чтение). */
  get state(): Readonly<GameState> | null {
    return this.s;
  }
  snapshot(): RoomData {
    return JSON.parse(JSON.stringify(this.d));
  }

  open(conn: ConnId) {
    this.conns.set(conn, null);
  }

  message(conn: ConnId, msg: ClientMsg, now: number): Promise<void> {
    return this.enqueue(() => this.handle(conn, msg, now));
  }

  close(conn: ConnId, now: number): Promise<void> {
    return this.enqueue(async () => {
      const seat = this.conns.get(conn);
      this.conns.delete(conn);
      if (seat == null) return;
      const st = this.d.seats[seat];
      if (!st || st.conn !== conn) return;
      st.conn = null;
      st.lastSeen = now;
      this.toSeat(other(seat), { t: 'opponent', info: info(st), connected: false });
      this.expire(now);
    });
  }

  wake(now: number): Promise<void> {
    return this.enqueue(async () => this.expire(now));
  }

  /** Ближайший момент, когда комнате нужно wake(): истечение часов или срок ожидания отключившегося. */
  nextWake(): number | null {
    let t = Infinity;
    const c = this.d.clocks;
    if (this.s?.phase === 'play' && c.runningSince !== null)
      t = Math.min(t, c.runningSince + Math.max(0, Math.min(c.turnLeft, c.total[this.s.current])));
    if (this.d.status === 'seeding' || this.d.status === 'placement' || this.d.status === 'play')
      for (const st of this.d.seats) if (st && st.conn === null) t = Math.min(t, st.lastSeen + this.abandonMs);
    return t === Infinity ? null : t;
  }

  // ── обработка ──────────────────────────────────────────────────────────────

  private enqueue(fn: () => Promise<void>): Promise<void> {
    this.chain = this.chain.then(fn).catch((e) => console.error('[room]', e));
    return this.chain;
  }

  private async handle(conn: ConnId, m: ClientMsg, now: number) {
    if (!this.conns.has(conn)) return;
    this.expire(now);
    if (m.t === 'hello') return this.hello(conn, m, now);
    const seat = this.conns.get(conn);
    if (seat == null) return this.fail(conn, 'badMsg', 'Сначала hello');
    switch (m.t) {
      case 'ping':
        return this.send(conn, { t: 'pong', at: isInt(m.at) ? m.at : 0, now });
      case 'seedShare':
        return this.seedShare(conn, seat, m.value, now);
      case 'placeCommit':
        return this.placeCommit(conn, seat, m.hash);
      case 'placeReveal':
        return this.placeReveal(conn, seat, m.layout, m.salt, now);
      case 'submit': {
        const cseq = isInt(m.cseq) ? m.cseq : -1;
        if (this.d.status !== 'play') return this.send(conn, { t: 'reject', cseq, error: 'Партия не идёт' });
        const a = sanitizeAction(m.action, seat);
        if (!a) return this.send(conn, { t: 'reject', cseq, error: 'Недопустимое действие' });
        const err = this.apply(a, now);
        if (err) this.send(conn, { t: 'reject', cseq, error: err });
        return;
      }
      case 'resync':
        return this.sendStart(conn, now);
      case 'rematch':
        return this.rematch(seat, now);
      case 'leave':
        return this.leave(conn, seat, now);
    }
  }

  private async hello(conn: ConnId, m: Extract<ClientMsg, { t: 'hello' }>, now: number) {
    if (m.v !== PROTOCOL_VERSION) return this.fail(conn, 'version', 'Версии игры не совпадают — обновите страницу', true);
    if (!isStr(m.token, 64) || m.token.length < 8) return this.fail(conn, 'badMsg', 'Неверный token', true);
    const attempt = isInt(m.n) ? m.n : 0;
    let seat = SEATS.find((p) => this.d.seats[p]?.token === m.token);
    if (seat !== undefined && attempt < this.d.seats[seat]!.attempt) {
      // запоздавший hello старого соединения — место остаётся за новым
      this.conns.delete(conn);
      this.io.close(conn);
      return;
    }
    if (seat === undefined) {
      seat = this.d.status === 'waiting' ? SEATS.find((p) => !this.d.seats[p]) : undefined;
      if (seat === undefined) return this.fail(conn, 'full', 'Комната занята', true);
    }
    const prev = this.d.seats[seat];
    if (prev?.conn && prev.conn !== conn) {
      this.conns.delete(prev.conn);
      this.io.close(prev.conn);
    }
    this.d.seats[seat] = {
      token: m.token,
      attempt,
      name: (isStr(m.name, 200) ? m.name.trim().slice(0, 24) : '') || `Игрок ${seat + 1}`,
      avatarSeed: isStr(m.avatarSeed, 64) ? m.avatarSeed : '',
      rating: Number.isFinite(m.rating) ? Math.round(Math.max(0, Math.min(5000, m.rating))) : 1000,
      conn,
      lastSeen: now,
    };
    this.conns.set(conn, seat);
    const opp = this.d.seats[other(seat)];
    this.send(conn, { t: 'welcome', seat, code: this.d.code, status: this.d.status, opponent: opp ? info(opp) : null });
    if (opp) this.send(conn, { t: 'opponent', info: info(opp), connected: opp.conn !== null });
    this.toSeat(other(seat), { t: 'opponent', info: info(this.d.seats[seat]!), connected: true });

    if (this.d.status === 'waiting' && this.d.seats[0] && this.d.seats[1]) return this.beginSeeding();
    // переподключение: дослать то, что нужно для продолжения
    if (this.d.status === 'seeding' && seat === 1 && this.d.seedSecret) this.send(conn, { t: 'seedCommit', hash: this.d.seedSecret.hash });
    if (this.s) {
      this.sendStart(conn, now);
      if (this.d.status === 'placement') {
        for (const p of SEATS) if (this.d.place[p].hash) this.send(conn, { t: 'placeCommitted', seat: p });
        this.sendCommitsIfReady(conn);
      }
    }
  }

  // Seed: комната (хост) обязуется долей, гость открыто присылает свою, комната раскрывает. seed = mix(обе).
  private async beginSeeding() {
    const value = randomSeedShare();
    const salt = randomSalt();
    this.d.seedSecret = { value, salt, hash: await commitHash(value, salt) };
    this.d.seed = null;
    this.d.status = 'seeding';
    this.toSeat(1, { t: 'seedCommit', hash: this.d.seedSecret.hash });
  }

  private seedShare(conn: ConnId, seat: PlayerId, value: unknown, now: number) {
    if (seat !== 1 || this.d.status !== 'seeding' || !this.d.seedSecret) return this.fail(conn, 'badMsg', 'Seed сейчас не ожидается');
    if (!isInt(value)) return this.fail(conn, 'badMsg', 'Неверная доля seed');
    const sec = this.d.seedSecret;
    this.d.seed = mixSeed(sec.value, value);
    this.send(conn, { t: 'seedReveal', value: sec.value, salt: sec.salt, share: value });
    this.startGame(now);
  }

  private startGame(now: number) {
    const mode = this.d.mode;
    this.d.names = [this.d.seats[0]?.name ?? 'Игрок 1', this.d.seats[1]?.name ?? 'Игрок 2'];
    this.d.log = [];
    this.d.place = [emptySlot(), emptySlot()];
    this.d.rematch = [false, false];
    this.d.clocks = { turnLeft: mode.turnMs, total: [mode.totalMs, mode.totalMs], runningSince: null };
    this.d.status = 'placement';
    this.rebuild();
    for (const p of SEATS) {
      const c = this.d.seats[p]?.conn;
      if (c) this.sendStart(c, now);
    }
  }

  // Скрытая расстановка: сначала оба обязательства, потом раскрытия; применяются строго в порядке 0, 1.
  private placeCommit(conn: ConnId, seat: PlayerId, hash: unknown) {
    const slot = this.d.place[seat];
    if (this.d.status === 'placement' && slot.hash && slot.hash === hash) return; // повтор после переподключения
    if (this.d.status !== 'placement' || slot.hash) return this.fail(conn, 'badMsg', 'Расстановка уже заявлена');
    if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) return this.fail(conn, 'badMsg', 'Неверный хэш');
    slot.hash = hash;
    this.broadcast({ t: 'placeCommitted', seat });
    this.sendCommitsIfReady();
  }

  private sendCommitsIfReady(conn?: ConnId) {
    const [a, b] = this.d.place;
    if (!a.hash || !b.hash) return;
    const msg: ServerMsg = { t: 'placeCommits', hashes: [a.hash, b.hash] };
    if (conn) this.send(conn, msg);
    else this.broadcast(msg);
  }

  private async placeReveal(conn: ConnId, seat: PlayerId, rawLayout: unknown, salt: unknown, now: number) {
    const slot = this.d.place[seat];
    const [a, b] = this.d.place;
    if (slot.layout) return; // повтор после переподключения
    if (this.d.status !== 'placement' || !a.hash || !b.hash) return this.fail(conn, 'badMsg', 'Раскрытие сейчас не ожидается');
    const layout = sanitizeLayout(rawLayout);
    if (!layout || typeof salt !== 'string' || !(await verify(layout, salt, slot.hash!)))
      return this.fail(conn, 'cheat', 'Расстановка не совпадает с заявленной');
    // проверка допустимости на копии: расстановки сторон не зависят друг от друга
    const probe = dispatch(JSON.parse(JSON.stringify(this.s)), { type: 'place', by: seat, layout });
    if (!probe.ok) return this.fail(conn, 'cheat', probe.error ?? 'Недопустимая расстановка');
    Object.assign(slot, { layout, salt });
    if (!a.layout || !b.layout) return;
    for (const p of SEATS) this.apply({ type: 'place', by: p, layout: this.d.place[p].layout! }, now, this.d.place[p].salt!);
  }

  private rematch(seat: PlayerId, _now: number) {
    if (this.d.status !== 'over' || this.d.rematch[seat]) return;
    this.d.rematch[seat] = true;
    this.broadcast({ t: 'rematch', seat });
    if (this.d.rematch[0] && this.d.rematch[1]) return this.beginSeeding();
  }

  private leave(conn: ConnId, seat: PlayerId, now: number) {
    const st = this.d.status;
    if (st === 'play') this.apply({ type: 'resign', by: seat }, now);
    else if (st === 'seeding' || st === 'placement') this.abandon();
    else if (st === 'waiting') this.d.seats[seat] = null;
    if (this.d.seats[seat]?.conn === conn) Object.assign(this.d.seats[seat]!, { conn: null, lastSeen: now });
    this.conns.delete(conn);
    this.io.close(conn);
    this.toSeat(other(seat), { t: 'opponent', info: this.d.seats[seat] ? info(this.d.seats[seat]!) : null, connected: false });
  }

  private abandon() {
    this.d.status = 'abandoned';
    this.d.clocks.runningSince = null;
    this.broadcast({ t: 'abandoned' });
  }

  // ── партия и часы ──────────────────────────────────────────────────────────

  /** Применить действие от имени комнаты. Возвращает текст ошибки или null. */
  private apply(a: Action, now: number, salt?: string): string | null {
    const s = this.s;
    if (!s) return 'Партия не идёт';
    this.settle(now);
    let r;
    try {
      r = dispatch(s, a);
    } catch (e) {
      // исключение посреди мутации — состояние могло испортиться: восстанавливаем из лога
      console.error('[room] dispatch threw', e, a);
      this.rebuild();
      return 'Внутренняя ошибка движка';
    }
    if (!r.ok) return r.error ?? 'Ошибка';
    this.d.log.push(a);
    const c = this.d.clocks;
    if (r.events.some((e) => e.type === 'turnStart')) c.turnLeft = this.d.mode.turnMs;
    c.runningSince = s.phase === 'play' ? now : null;
    if (s.phase === 'play') this.d.status = 'play';
    if (s.phase === 'over') this.d.status = 'over';
    this.broadcast({ t: 'action', seq: this.d.log.length, action: a, hash: stateHash(s), clocks: this.snap(now), ...(salt ? { salt } : {}) });
    return null;
  }

  private settle(now: number) {
    const c = this.d.clocks;
    if (this.s?.phase !== 'play' || c.runningSince === null) return;
    const dt = Math.max(0, now - c.runningSince);
    c.turnLeft -= dt;
    c.total[this.s.current] -= dt;
    c.runningSince = now;
  }

  /** Таймауты и ожидание отключившихся — всё, что должно было случиться к моменту now. */
  private expire(now: number) {
    for (let guard = 0; guard < 8 && this.s?.phase === 'play'; guard++) {
      this.settle(now);
      const p = this.s.current;
      const c = this.d.clocks;
      if (c.total[p] <= 0) this.apply({ type: 'timeout', by: p, total: true }, now);
      else if (c.turnLeft <= 0) this.apply({ type: 'timeout', by: p, total: false }, now);
      else break;
    }
    const st = this.d.status;
    if (st === 'play' && this.s) {
      const actor = this.s.pending ? this.s.pending.chooser : this.s.current;
      if (this.gone(actor, now)) this.apply({ type: 'resign', by: actor, left: true }, now);
    } else if ((st === 'seeding' || st === 'placement') && SEATS.some((p) => this.gone(p, now))) this.abandon();
  }

  private gone(p: PlayerId, now: number) {
    const st = this.d.seats[p];
    return !!st && st.conn === null && now - st.lastSeen >= this.abandonMs;
  }

  private snap(now: number): ClockSnap {
    this.settle(now);
    const c = this.d.clocks;
    return {
      turnLeft: c.turnLeft,
      total: [c.total[0], c.total[1]],
      running: this.s?.phase === 'play' && c.runningSince !== null ? this.s.current : null,
      now,
    };
  }

  private rebuild() {
    if (this.d.seed === null) {
      this.s = null;
      return;
    }
    const s = createGame(this.d.mode, this.d.seed, this.names());
    for (const a of this.d.log) {
      const r = dispatch(s, a);
      if (!r.ok) throw new Error(`room ${this.d.code}: log replay failed: ${r.error}`);
    }
    this.s = s;
  }

  private names(): [string, string] {
    return [this.d.names[0], this.d.names[1]];
  }

  // ── отправка ───────────────────────────────────────────────────────────────

  private sendStart(conn: ConnId, now: number) {
    if (this.d.seed === null) return;
    this.send(conn, { t: 'start', mode: this.d.mode, seed: this.d.seed, names: this.names(), log: this.d.log, clocks: this.snap(now) });
  }

  private send(conn: ConnId, msg: ServerMsg) {
    this.io.send(conn, msg);
  }
  private toSeat(p: PlayerId, msg: ServerMsg) {
    const c = this.d.seats[p]?.conn;
    if (c) this.send(c, msg);
  }
  private broadcast(msg: ServerMsg) {
    for (const p of SEATS) this.toSeat(p, msg);
  }
  private fail(conn: ConnId, code: Extract<ServerMsg, { t: 'error' }>['code'], text: string, close = false) {
    this.send(conn, { t: 'error', code, text });
    if (close) {
      this.conns.delete(conn);
      this.io.close(conn);
    }
  }
}

const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);
const info = (st: Seat): PeerInfo => ({ name: st.name, avatarSeed: st.avatarSeed, rating: st.rating });

/** Пересобрать действие клиента из проверенных полей; by — всегда место отправителя. */
export function sanitizeAction(raw: unknown, by: PlayerId): Action | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, any>;
  switch (o.type) {
    case 'move':
      if (!isInt(o.pieceId) || !o.to || !isInt(o.to.x) || !isInt(o.to.y)) return null;
      return { type: 'move', by, pieceId: o.pieceId, to: { x: o.to.x, y: o.to.y } };
    case 'endTurn':
    case 'playCard':
    case 'skip':
      return { type: o.type, by };
    case 'choose':
      return isStr(o.option, 32) ? { type: 'choose', by, option: o.option } : null;
    case 'resign':
      return { type: 'resign', by };
    default:
      // place — только через commit-reveal, timeout — только от комнаты
      return null;
  }
}

export function sanitizeLayout(raw: unknown): Layout | null {
  if (!Array.isArray(raw) || raw.length > 64) return null;
  const out: Layout = [];
  for (const l of raw) {
    if (!l || !isInt(l.x) || !isInt(l.y) || ![0, 1, 2].includes(l.rank)) return null;
    out.push({ x: l.x, y: l.y, rank: l.rank });
  }
  return out;
}
