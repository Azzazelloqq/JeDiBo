// Клиент комнаты: протокол со стороны игрока, без DOM и UI.
// Держит свою копию GameState и применяет только подтверждённые комнатой действия (lockstep),
// сам проверяет честность комнаты: seed (commit-reveal), расстановку соперника, допустимость ходов, хэши.
import { createGame, dispatch } from '../core/engine';
import type { Action, GameEvent, GameState, PlayerId } from '../core/types';
import { commit, mixSeed, randomSeedShare, verify, type Commitment } from './commit';
import { stableStringify, stateHash } from './hash';
import { PROTOCOL_VERSION, type ClientMsg, type ClockSnap, type ErrorCode, type Layout, type PeerInfo, type RoomStatus, type ServerMsg } from './protocol';
import type { Transport } from './transport';

export interface ClientIdentity extends PeerInfo {
  token: string;
}

export type ClientErrorCode = ErrorCode | 'desync';

export interface RoomClientEvents {
  welcome?(seat: PlayerId, status: RoomStatus): void;
  opponent?(info: PeerInfo | null, connected: boolean): void;
  /** новое состояние партии: старт, реванш, переподключение или resync — перерисовать без анимаций */
  start?(state: GameState): void;
  placeCommitted?(seat: PlayerId): void;
  action?(action: Action, events: GameEvent[], state: GameState): void;
  reject?(error: string, cseq: number): void;
  rematch?(seat: PlayerId): void;
  abandoned?(): void;
  error?(code: ClientErrorCode, text: string): void;
  pong?(rttMs: number): void;
}

export class RoomClient {
  seat: PlayerId | null = null;
  status: RoomStatus | null = null;
  state: GameState | null = null;
  opponent: PeerInfo | null = null;
  opponentConnected = false;
  /** последний снимок часов и локальное время его получения */
  clocks: ClockSnap | null = null;
  private clocksAt = 0;
  /** комната прислала недопустимое — дальше не применяем ничего */
  broken = false;
  private listeners: RoomClientEvents[] = [];

  private t!: Transport<ClientMsg, ServerMsg>;
  private chain: Promise<void> = Promise.resolve();
  private applied = 0;
  private cseq = 0;
  private inflight: number | null = null;
  private seedHash: string | null = null;
  private myShare: number | null = null;
  private expectedSeed: number | null = null;
  private gameSeed: number | null = null;
  private myPlace: Commitment<Layout> | null = null;
  private placing = false;
  private attempt = 0;
  private revealed = false;
  private commits: [string | null, string | null] = [null, null];

  constructor(
    transport: Transport<ClientMsg, ServerMsg>,
    private me: ClientIdentity,
  ) {
    this.attach(transport);
  }

  /** Подписка на события; возвращает отписку. Слушателей может быть несколько (Match, экран). */
  listen(l: RoomClientEvents): () => void {
    this.listeners.push(l);
    return () => {
      this.listeners = this.listeners.filter((x) => x !== l);
    };
  }

  private emit<K extends keyof RoomClientEvents>(k: K, ...args: Parameters<NonNullable<RoomClientEvents[K]>>) {
    for (const l of [...this.listeners]) (l[k] as ((...a: unknown[]) => void) | undefined)?.(...args);
  }

  /** Подключить новый транспорт (переподключение) и представиться заново. */
  attach(transport: Transport<ClientMsg, ServerMsg>) {
    this.t = transport;
    transport.onMessage((m) => {
      this.chain = this.chain.then(() => this.handle(m)).catch((e) => this.emit('error', 'badMsg', String(e)));
    });
  }

  hello() {
    const { token, name, avatarSeed, rating } = this.me;
    this.send({ t: 'hello', v: PROTOCOL_VERSION, n: ++this.attempt, token, name, avatarSeed, rating });
  }

  /** Отправить действие. Применится, когда комната его подтвердит. */
  submit(a: Action): number {
    const cseq = ++this.cseq;
    this.inflight = cseq;
    this.send({ t: 'submit', action: a, cseq });
    return cseq;
  }

  /** номер последнего применённого действия */
  get appliedSeq() {
    return this.applied;
  }
  /** отладка: последние входящие сообщения */
  trace: string[] = [];

  /** Ждём ответа комнаты на своё действие — ввод стоит заблокировать. */
  get awaiting() {
    return this.inflight !== null;
  }

  /** Скрытая расстановка: сначала обязательство, раскрытие — когда соперник тоже заявит свою. */
  async place(layout: Layout) {
    // флаг ставится синхронно: повторный вызов, пока считается хэш, не создаст второе обязательство
    if (this.myPlace || this.placing) return;
    this.placing = true;
    try {
      const c = await commit(layout);
      if (this.myPlace) return;
      this.myPlace = c;
      this.revealed = false;
      this.send({ t: 'placeCommit', hash: c.hash });
    } finally {
      this.placing = false;
    }
  }
  get placeCommitted() {
    return this.myPlace !== null || this.placing;
  }

  rematch() {
    this.send({ t: 'rematch' });
  }
  leave() {
    this.send({ t: 'leave' });
  }
  ping() {
    this.send({ t: 'ping', at: Date.now() });
  }
  resync() {
    this.send({ t: 'resync' });
  }

  /** Часы на сейчас: интерполяция последнего снимка комнаты. */
  clockView(now = Date.now()): { turnLeft: number; total: [number, number]; running: PlayerId | null } | null {
    const c = this.clocks;
    if (!c) return null;
    const total: [number, number] = [c.total[0], c.total[1]];
    if (c.running === null) return { turnLeft: c.turnLeft, total, running: null };
    const dt = Math.max(0, now - this.clocksAt);
    total[c.running] -= dt;
    return { turnLeft: c.turnLeft - dt, total, running: c.running };
  }

  // ── входящие ───────────────────────────────────────────────────────────────

  private send(m: ClientMsg) {
    this.t.send(m);
  }

  private cheat(text: string) {
    this.broken = true;
    this.emit('error', 'cheat', text);
  }

  private setClocks(c: ClockSnap) {
    this.clocks = c;
    this.clocksAt = Date.now();
  }

  private async handle(m: ServerMsg) {
    if (this.broken) return;
    this.trace.push(m.t === 'action' ? `a${m.seq}:${m.action.type}` : m.t === 'start' ? `start${m.log.length}` : m.t);
    if (this.trace.length > 40) this.trace.shift();
    switch (m.t) {
      case 'welcome':
        this.seat = m.seat;
        this.status = m.status;
        this.opponent = m.opponent;
        this.emit('welcome', m.seat, m.status);
        return;
      case 'opponent':
        this.opponent = m.info;
        this.opponentConnected = m.connected;
        this.emit('opponent', m.info, m.connected);
        return;
      case 'seedCommit':
        this.seedHash = m.hash;
        this.expectedSeed = null;
        this.myShare = randomSeedShare();
        this.status = 'seeding';
        this.send({ t: 'seedShare', value: this.myShare });
        return;
      case 'seedReveal':
        if (m.share !== this.myShare || !this.seedHash || !(await verify(m.value, m.salt, this.seedHash)))
          return this.cheat('Комната подменила seed');
        this.expectedSeed = mixSeed(m.value, m.share);
        return;
      case 'start':
        return this.start(m);
      case 'placeCommitted':
        this.emit('placeCommitted', m.seat);
        return;
      case 'placeCommits':
        this.commits = [m.hashes[0], m.hashes[1]];
        if (this.seat === null || !this.myPlace) return;
        if (m.hashes[this.seat] !== this.myPlace.hash) return this.cheat('Комната подменила обязательство расстановки');
        if (!this.revealed && this.state && !this.state.players[this.seat].placed) {
          this.revealed = true;
          this.send({ t: 'placeReveal', layout: this.myPlace.value, salt: this.myPlace.salt });
        }
        return;
      case 'action':
        return this.action(m);
      case 'reject':
        if (m.cseq === this.inflight) this.inflight = null;
        this.emit('reject', m.error, m.cseq);
        return;
      case 'rematch':
        this.emit('rematch', m.seat);
        return;
      case 'abandoned':
        this.status = 'abandoned';
        this.emit('abandoned');
        return;
      case 'error':
        this.emit('error', m.code, m.text);
        return;
      case 'pong':
        this.emit('pong', Date.now() - m.at);
        return;
    }
  }

  private async start(m: Extract<ServerMsg, { t: 'start' }>) {
    // гость проверяет, что seed — честная смесь долей (если только что проходил commit-reveal)
    if (this.seat === 1 && this.expectedSeed !== null && m.seed !== this.expectedSeed) return this.cheat('Seed партии не совпадает с договорённым');
    if (m.seed !== this.gameSeed) {
      // новая партия (первая или реванш): прошлая расстановка не в счёт
      this.gameSeed = m.seed;
      this.myPlace = null;
      this.revealed = false;
      this.commits = [null, null];
    }
    const s = createGame(m.mode, m.seed, m.names);
    for (const a of m.log) {
      const r = dispatch(s, a);
      if (!r.ok) return this.cheat(`Лог комнаты не проигрывается: ${r.error}`);
    }
    // переподключение посреди расстановки: повторить обязательство и раскрытие (комната игнорирует дубли)
    if (this.myPlace && this.seat !== null && !s.players[this.seat].placed) {
      this.revealed = false;
      this.send({ t: 'placeCommit', hash: this.myPlace.hash });
    }
    this.state = s;
    this.applied = m.log.length;
    this.inflight = null;
    this.status = s.phase === 'placement' ? 'placement' : s.phase === 'play' ? 'play' : 'over';
    this.setClocks(m.clocks);
    this.emit('start', s);
  }

  private async action(m: Extract<ServerMsg, { t: 'action' }>) {
    const s = this.state;
    if (!s || this.seat === null) return;
    if (m.seq <= this.applied) return; // дубль после переподключения
    if (m.seq !== this.applied + 1) return this.resync();
    const a = m.action;
    if (a.type === 'place') {
      if (a.by === this.seat) {
        if (!this.myPlace || stableStringify(a.layout) !== stableStringify(this.myPlace.value)) return this.cheat('Комната подменила вашу расстановку');
      } else {
        const h = this.commits[a.by];
        if (!h || !m.salt || !(await verify(a.layout, m.salt, h))) return this.cheat('Расстановка соперника не совпадает с заявленной');
      }
    }
    const r = dispatch(s, a);
    if (!r.ok) return this.cheat(`Комната прислала недопустимое действие: ${r.error}`);
    this.applied = m.seq;
    if (a.by === this.seat && a.type !== 'timeout') this.inflight = null;
    this.setClocks(m.clocks);
    this.status = s.phase === 'over' ? 'over' : s.phase === 'play' ? 'play' : this.status;
    if (stateHash(s) !== m.hash) {
      this.emit('error', 'desync', 'Рассинхрон состояния — восстанавливаемся');
      return this.resync();
    }
    this.emit('action', a, r.events, s);
  }
}
