// Транспорт в памяти до RoomHost: так хост играет со своей же комнатой, а тесты гоняют сеть без сети.
// Сообщения проходят через JSON (как по проводу); порядок сохраняется даже со случайной задержкой.
import { decodeServerMsg, encode, type ClientMsg, type ServerMsg } from './protocol';
import type { Attached, RoomHost } from './roomHost';
import type { Transport, TransportStatus } from './transport';

export interface LoopbackOptions {
  /** задержка доставки в мс; без неё — микрозадачи */
  delay?: () => number;
}

export class LoopbackTransport implements Transport<ClientMsg, ServerMsg> {
  private cb: (m: ServerMsg) => void = () => {};
  private statusCb: (s: TransportStatus) => void = () => {};
  private side: Attached;
  private open = true;
  private lastAt = 0;
  private q: { at: number; fn: () => void }[] = [];
  private scheduled = false;

  constructor(host: RoomHost, private opts: LoopbackOptions = {}) {
    this.side = host.attach({
      send: (raw) =>
        this.deliver(() => {
          const m = decodeServerMsg(raw);
          if (this.open && m) this.cb(m);
        }),
      close: () => this.cut(),
    });
  }

  send(msg: ClientMsg) {
    if (!this.open) return;
    const raw = encode(msg);
    this.deliver(() => void this.side.receive(raw));
  }
  onMessage(cb: (m: ServerMsg) => void) {
    this.cb = cb;
  }
  onStatus(cb: (s: TransportStatus) => void) {
    this.statusCb = cb;
  }
  get isOpen() {
    return this.open;
  }

  /** Закрыть со стороны клиента. */
  close() {
    this.cut();
  }

  /** Обрыв связи (для тестов): обе стороны узнают о разрыве. */
  drop() {
    this.cut();
  }

  private cut() {
    if (!this.open) return;
    this.open = false;
    this.deliver(() => void this.side.closed());
    this.statusCb('closed');
  }

  private deliver(fn: () => void) {
    if (!this.opts.delay) {
      queueMicrotask(fn);
      return;
    }
    const at = Math.max(this.lastAt, Date.now() + this.opts.delay());
    this.lastAt = at;
    this.q.push({ at, fn });
    this.pump();
  }

  // одна FIFO-очередь на оба направления: порядок не зависит от того, как среда сортирует таймеры
  private pump() {
    if (this.scheduled || !this.q.length) return;
    this.scheduled = true;
    const flush = () => {
      this.scheduled = false;
      const now = Date.now();
      while (this.q.length && this.q[0].at <= now) this.q.shift()!.fn();
      this.pump();
    };
    const wait = this.q[0].at - Date.now();
    if (wait > 0) setTimeout(flush, wait);
    else queueMicrotask(flush);
  }
}
