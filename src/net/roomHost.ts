// Запуск Room в живом окружении: подключения как строковые каналы, будильник на setTimeout,
// лимит частоты сообщений, уведомление о смене состояния (для сохранения в sessionStorage).
// Используется вкладкой хоста (через PeerJS и loopback) и тестами; на сервере его заменит адаптер DO.
import { Room, type ConnId, type RoomData, type RoomOptions } from './room';
import { decodeClientMsg, encode, type ServerMsg } from './protocol';

/** Канал до одного клиента: отправка строки и разрыв. */
export interface Link {
  send(raw: string): void;
  close(): void;
}

export interface Attached {
  receive(raw: string): Promise<void>;
  closed(): Promise<void>;
}

export interface RoomHostOptions extends RoomOptions {
  /** лимит сообщений в секунду на подключение (по умолчанию 20) */
  ratePerSec?: number;
}

export class RoomHost {
  readonly room: Room;
  /** вызывается после каждого изменения — хост сохраняет снимок */
  onChange: (data: RoomData) => void = () => {};
  private links = new Map<ConnId, Link>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  private disposed = false;

  private readonly rate: number;

  constructor(code: string, opts: RoomHostOptions = {}, data?: RoomData, private now: () => number = () => Date.now()) {
    this.rate = opts.ratePerSec ?? 20;
    this.room = new Room(
      code,
      {
        send: (conn, msg: ServerMsg) => this.links.get(conn)?.send(encode(msg)),
        close: (conn) => {
          const l = this.links.get(conn);
          this.links.delete(conn);
          l?.close();
        },
      },
      opts,
      data,
      this.now(),
    );
    this.schedule();
  }

  attach(link: Link): Attached {
    const id = `c${++this.seq}`;
    this.links.set(id, link);
    this.room.open(id);
    let windowStart = 0;
    let count = 0;
    return {
      receive: (raw) => {
        const t = this.now();
        if (t - windowStart >= 1000) {
          windowStart = t;
          count = 0;
        }
        if (++count > this.rate) {
          link.send(encode({ t: 'error', code: 'badMsg', text: 'Слишком много сообщений' }));
          return Promise.resolve();
        }
        const m = decodeClientMsg(raw);
        if (!m) {
          link.send(encode({ t: 'error', code: 'badMsg', text: 'Неразборчивое сообщение' }));
          return Promise.resolve();
        }
        return this.room.message(id, m, t).then(() => this.after());
      },
      closed: () => {
        this.links.delete(id);
        return this.room.close(id, this.now()).then(() => this.after());
      },
    };
  }

  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    for (const l of this.links.values()) l.close();
    this.links.clear();
  }

  private after() {
    if (this.disposed) return;
    this.schedule();
    this.onChange(this.room.snapshot());
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const w = this.room.nextWake();
    if (w === null || this.disposed) return;
    this.timer = setTimeout(() => void this.room.wake(this.now()).then(() => this.after()), Math.max(0, w - this.now()) + 1);
  }
}
