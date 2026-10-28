// WebRTC через PeerJS (docs/network/README.md §2, §8). Хост держит комнату у себя во вкладке под peer id
// «jedibo-<КОД>», гость подключается к нему по коду. Через брокер PeerJS идёт только обмен SDP.
// Сериализация — бинарная по умолчанию: она сама режет большие сообщения (start с полным логом),
// а JSON-канал PeerJS отбрасывает всё длиннее ~16 КБ.
import Peer, { type DataConnection, type PeerError } from 'peerjs';
import { RoomClient, type ClientIdentity, type PlaceStore } from './client';
import { LoopbackTransport } from './loopback';
import { decodeServerMsg, encode, type ClientMsg, type ServerMsg } from './protocol';
import type { RoomData } from './room';
import { RoomHost, type Attached } from './roomHost';
import type { Transport, TransportStatus } from './transport';

/** STUN хватает большинству сетей; TURN для строгих NAT добавляется сюда же без правок кода. */
export const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];

const peerId = (code: string) => `jedibo-${code}`;
const peerOptions = () => ({ config: { iceServers: ICE_SERVERS }, debug: 1 as const });

const HEARTBEAT_MS = 5_000;
/** столько тишины — и соединение считается мёртвым */
const DEAD_MS = 12_000;
/** столько ждём открытия первого канала, прежде чем признать, что напрямую не соединиться */
const OPEN_TIMEOUT_MS = 15_000;
/** при переподключении ждём меньше: несколько попыток должны уложиться в 15 с до поражения */
const REOPEN_TIMEOUT_MS = 5_000;
/** живой хост отвечает на предложение соединения за 1–2 с; нет ответа столько — хоста, видимо, нет */
const ANSWER_MS = 5_000;
/** столько гость ищет хоста, прежде чем сдаться («комната не найдена»): хост на телефоне мог свернуть
 *  браузер, чтобы отправить ссылку, — мобильный браузер замораживает вкладку, и комната пропадает до возвращения */
const FIND_HOST_MS = 60_000;

// ── сохранение в sessionStorage (переживает перезагрузку вкладки) ──────────────

const K_HOST = 'jedibo.net.host';
const kToken = (code: string) => `jedibo.net.token.${code}`;

function ssGet(k: string): string | null {
  try {
    return sessionStorage.getItem(k);
  } catch {
    return null;
  }
}
function ssSet(k: string, v: string | null) {
  try {
    if (v === null) sessionStorage.removeItem(k);
    else sessionStorage.setItem(k, v);
  } catch {
    // приватный режим — без восстановления после перезагрузки
  }
}

/** token места в комнате: один на вкладку и код комнаты. */
export function seatToken(code: string): string {
  let t = ssGet(kToken(code));
  if (!t) {
    t = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
    ssSet(kToken(code), t);
  }
  return t;
}

const kPlace = (code: string) => `jedibo.net.place.${code}`;

/** Своя заявка расстановки: после перезагрузки вкладки её нужно раскрыть, новую комната не примет. */
export function placeStore(code: string): PlaceStore {
  return {
    load(seed) {
      try {
        const v = JSON.parse(ssGet(kPlace(code)) ?? 'null');
        const c = v?.c;
        return v?.seed === seed && Array.isArray(c?.value) && typeof c.salt === 'string' && typeof c.hash === 'string' ? c : null;
      } catch {
        return null;
      }
    },
    save(seed, c) {
      ssSet(kPlace(code), c ? JSON.stringify({ seed, c }) : null);
    },
  };
}

/** Комната, которую эта вкладка хостила до перезагрузки. */
export function savedHostRoom(): { code: string; data: RoomData } | null {
  const raw = ssGet(K_HOST);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ── хост ─────────────────────────────────────────────────────────────────────

export type HostStatus = 'connecting' | 'open' | 'reconnecting' | 'failed';

export class HostRoom {
  readonly host: RoomHost;
  onStatus: (s: HostStatus, detail?: string) => void = () => {};
  status: HostStatus = 'connecting';
  private peer: Peer | null = null;
  private destroyed = false;
  private watchdog: ReturnType<typeof setInterval>;
  private live = new Map<DataConnection, { attached: Attached | null; lastData: number }>();
  // закрытие/перезагрузка вкладки или уход в кэш вкладок — сразу освобождаем id у брокера (вернёмся через pageshow)
  private readonly onPageHide = () => this.peer?.destroy();
  /** вкладка снова видна или поднята из кэша: связь с брокером могла умереть, пока она была заморожена */
  private readonly onBack = () => {
    if (document.visibilityState === 'visible') this.revive();
  };

  /** data — снимок комнаты после перезагрузки вкладки (savedHostRoom). */
  constructor(
    readonly code: string,
    data?: RoomData,
  ) {
    this.host = new RoomHost(code, {}, data);
    this.host.onChange = (d) => ssSet(K_HOST, JSON.stringify({ code, data: d }));
    if (!data) ssSet(K_HOST, JSON.stringify({ code, data: this.host.room.snapshot() }));
    // гость пингует каждые 5 с; молчащий канал закрываем сами, не дожидаясь WebRTC
    this.watchdog = setInterval(() => {
      const now = Date.now();
      for (const [conn, l] of this.live) {
        if (l.attached && now - l.lastData > DEAD_MS) conn.close();
        // канал так и не открылся — PeerJS закроет его молча, запись убираем сами
        else if (!l.attached && now - l.lastData > OPEN_TIMEOUT_MS) {
          this.live.delete(conn);
          conn.close();
        }
      }
    }, 2_000);
    // при закрытии/перезагрузке вкладки сразу освобождаем id у брокера — иначе он держит его до таймаута
    addEventListener('pagehide', this.onPageHide);
    addEventListener('pageshow', this.onBack);
    document.addEventListener('visibilitychange', this.onBack);
    this.register(0);
  }

  /** Вернуть комнату к брокеру без ожидания: пересоздать peer, если его нет, или переподключить. */
  private revive() {
    const peer = this.peer;
    if (this.destroyed || !peer) return;
    if (peer.destroyed) this.register(1);
    else if (peer.disconnected) {
      this.setStatus('reconnecting');
      peer.reconnect();
    }
  }

  /** Есть ли живой канал с гостем (тогда peer не пересоздаём — каналы живут и без брокера). */
  private hasLiveGuest() {
    for (const l of this.live.values()) if (l.attached) return true;
    return false;
  }

  /** Транспорт для собственного клиента хоста: в ту же комнату, без сети. */
  localTransport(): LoopbackTransport {
    return new LoopbackTransport(this.host);
  }

  /** Закрыть комнату. forget — стереть сохранение (уход из комнаты, а не перезагрузка). */
  dispose(forget = true) {
    this.destroyed = true;
    clearInterval(this.watchdog);
    removeEventListener('pagehide', this.onPageHide);
    removeEventListener('pageshow', this.onBack);
    document.removeEventListener('visibilitychange', this.onBack);
    this.peer?.destroy();
    this.host.dispose();
    if (forget) ssSet(K_HOST, null);
  }

  private register(attempt: number) {
    if (this.destroyed) return;
    if (this.peer && !this.peer.destroyed) this.peer.destroy();
    this.setStatus(attempt ? 'reconnecting' : 'connecting');
    const peer = new Peer(peerId(this.code), peerOptions());
    this.peer = peer;
    peer.on('open', () => this.setStatus('open'));
    peer.on('connection', (conn) => this.accept(conn));
    peer.on('disconnected', () => {
      // потеряли брокер; открытые каналы с гостем живут и без него
      if (this.destroyed || peer.destroyed) return;
      this.setStatus('reconnecting');
      setTimeout(() => !this.destroyed && !peer.destroyed && peer.reconnect(), 1_000);
    });
    peer.on('error', (err: PeerError<string>) => {
      if (this.destroyed) return;
      if (err.type === 'unavailable-id') {
        // каналы с гостем живут и без брокера: peer с открытыми каналами не пересоздаём
        if (this.hasLiveGuest()) return this.setStatus('reconnecting', 'Брокер отдал id другому');
        // брокер ещё держит id прошлого подключения (перезагрузка, заморозка вкладки) — пробуем снова
        peer.destroy();
        if (attempt < 30) setTimeout(() => this.register(attempt + 1), 1_000);
        else this.setStatus('failed', 'Код комнаты занят');
      } else if (err.type === 'browser-incompatible') this.setStatus('failed', 'Браузер не поддерживает WebRTC');
      else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) this.setStatus('reconnecting', err.message);
    });
  }

  private setStatus(s: HostStatus, detail?: string) {
    this.status = s;
    this.onStatus(s, detail);
  }

  private accept(conn: DataConnection) {
    const l = { attached: null as Attached | null, lastData: Date.now() };
    this.live.set(conn, l);
    conn.on('open', () => {
      l.lastData = Date.now();
      l.attached = this.host.attach({ send: (raw) => void conn.send(raw), close: () => conn.close() });
    });
    conn.on('data', (d) => {
      l.lastData = Date.now();
      if (typeof d === 'string') void l.attached?.receive(d);
    });
    conn.on('close', () => {
      this.live.delete(conn);
      void l.attached?.closed();
      l.attached = null;
    });
    conn.on('error', () => conn.close());
  }
}

/** Новая комната хоста + его собственный клиент. */
export function hostGame(code: string, me: Omit<ClientIdentity, 'token'>, data?: RoomData) {
  const room = new HostRoom(code, data);
  const client = new RoomClient(room.localTransport(), { ...me, token: seatToken(code) }, placeStore(code));
  client.hello();
  return { room, client };
}

// ── гость ────────────────────────────────────────────────────────────────────

/** Один DataChannel как Transport. Переподключение = новый PeerTransport. */
class PeerTransport implements Transport<ClientMsg, ServerMsg> {
  private cb: (m: ServerMsg) => void = () => {};
  constructor(readonly conn: DataConnection) {
    conn.on('data', (d) => {
      const m = typeof d === 'string' ? decodeServerMsg(d) : null;
      if (m) this.cb(m);
    });
  }
  send(msg: ClientMsg) {
    if (this.conn.open) void this.conn.send(encode(msg));
  }
  onMessage(cb: (m: ServerMsg) => void) {
    this.cb = cb;
  }
  close() {
    this.conn.close();
  }
}

export type GuestFailure = 'notFound' | 'ice' | 'browser';

/**
 * Подключение гостя: свой peer у брокера, канал к хосту, переподключение с нарастающей паузой,
 * heartbeat. Клиент комнаты один на всё время, транспорты под ним меняются.
 */
export class GuestLink {
  readonly client: RoomClient;
  onStatus: (s: TransportStatus, detail?: GuestFailure) => void = () => {};
  status: TransportStatus = 'connecting';
  private peer: Peer;
  private conn: DataConnection | null = null;
  private destroyed = false;
  private everOpened = false;
  private backoff = 500;
  private searchingSince = Date.now();
  /** хост не отвечает (нет у брокера или вкладка хоста заморожена) — экран показывает «ждём хоста» */
  hostMissing = false;
  private lastPong = Date.now();
  private beat: ReturnType<typeof setInterval> | null = null;
  private openTimer: ReturnType<typeof setTimeout> | null = null;
  private answerTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly code: string,
    me: Omit<ClientIdentity, 'token'>,
  ) {
    const self = this;
    // клиенту нужен транспорт с первого дня: пока канала нет, отправка просто теряется
    this.client = new RoomClient(
      { send() {}, onMessage() {}, close() {} },
      { ...me, token: seatToken(code) },
      placeStore(code),
    );
    this.client.listen({ pong: () => (self.lastPong = Date.now()) });
    this.setStatus('connecting');
    this.peer = new Peer(peerOptions());
    // 'open' приходит и после переподключения к брокеру — живой канал при этом не трогаем
    this.peer.on('open', () => !this.conn && this.dial());
    this.peer.on('disconnected', () => {
      if (!this.destroyed && !this.peer.destroyed) setTimeout(() => !this.destroyed && !this.peer.destroyed && this.peer.reconnect(), 1_000);
    });
    this.peer.on('error', (err: PeerError<string>) => {
      if (this.destroyed) return;
      if (err.type === 'browser-incompatible') return this.fail('browser');
      if (err.type === 'peer-unavailable') {
        // хоста нет у брокера: неверный код или хост перезагружает вкладку
        this.hostMissing = true;
        if (!this.everOpened && Date.now() - this.searchingSince > FIND_HOST_MS) return this.fail('notFound');
        return this.retry();
      }
    });
  }

  /** Принудительный обрыв канала (отладка переподключения). */
  drop() {
    this.conn?.close();
  }

  dispose() {
    this.destroyed = true;
    this.stopTimers();
    this.conn?.close();
    this.peer.destroy();
  }

  private dial() {
    if (this.destroyed) return;
    this.stopTimers();
    const conn = this.peer.connect(peerId(this.code), { reliable: true });
    this.conn = conn;
    const t = new PeerTransport(conn);
    this.client.attach(t);
    let opened = false;
    // Не открывшийся канал PeerJS закрывает молча, без события 'close' — поэтому повтор запускаем сами.
    this.openTimer = setTimeout(
      () => {
        if (opened || this.conn !== conn) return;
        if (this.everOpened) return this.retry();
        // хост ответил на предложение, но канал не открылся: ICE не сошёлся (строгий NAT) — без TURN не соединиться
        if (conn.peerConnection?.signalingState === 'stable') return this.fail('ice');
        this.hostNotAnswering();
      },
      this.everOpened || this.hostMissing ? REOPEN_TIMEOUT_MS : OPEN_TIMEOUT_MS,
    );
    // первый вход: не ждём 15 с, если хост даже не ответил на предложение
    if (!this.everOpened)
      this.answerTimer = setTimeout(() => {
        if (opened || this.conn !== conn || conn.peerConnection?.signalingState === 'stable') return;
        this.hostNotAnswering();
      }, ANSWER_MS);
    conn.on('open', () => {
      if (this.conn !== conn) return;
      opened = true;
      this.everOpened = true;
      this.hostMissing = false;
      this.backoff = 500;
      this.lastPong = Date.now();
      if (this.openTimer) clearTimeout(this.openTimer);
      if (this.answerTimer) clearTimeout(this.answerTimer);
      this.setStatus('open');
      this.client.hello();
      this.beat = setInterval(() => {
        if (Date.now() - this.lastPong > DEAD_MS) this.retry();
        else this.client.ping();
      }, HEARTBEAT_MS);
    });
    conn.on('close', () => this.conn === conn && this.retry());
    conn.on('error', () => this.conn === conn && this.retry());
  }

  /** Хоста с таким кодом нет (брокер не всегда сообщает об этом сам): ищем до FIND_HOST_MS, потом сдаёмся. */
  private hostNotAnswering() {
    this.hostMissing = true;
    if (Date.now() - this.searchingSince > FIND_HOST_MS) this.fail('notFound');
    else this.retry();
  }

  private retry() {
    if (this.destroyed) return;
    this.stopTimers();
    const old = this.conn;
    this.conn = null;
    old?.close();
    this.setStatus('connecting');
    // пауза растёт, но не больше 2 с: на возвращение в партию всего 15 с
    const wait = this.backoff;
    this.backoff = Math.min(this.backoff * 2, 2_000);
    setTimeout(() => {
      if (this.destroyed) return;
      if (this.peer.open) this.dial();
      // без брокера новый канал не открыть — dial() вызовется по peer 'open' после reconnect()
    }, wait);
  }

  private fail(why: GuestFailure) {
    this.stopTimers();
    this.destroyed = true;
    this.conn?.close();
    this.peer.destroy();
    this.setStatus('failed', why);
  }

  private setStatus(s: TransportStatus, detail?: GuestFailure) {
    this.status = s;
    this.onStatus(s, detail);
  }

  private stopTimers() {
    if (this.beat) clearInterval(this.beat);
    if (this.openTimer) clearTimeout(this.openTimer);
    if (this.answerTimer) clearTimeout(this.answerTimer);
    this.beat = null;
    this.openTimer = null;
    this.answerTimer = null;
  }
}
