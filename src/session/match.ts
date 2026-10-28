// Сессия партии: связывает движок, контроллеры игроков (человек / бот / сеть), часы и UI.
// Офлайн действия применяются сразу. В сети (cfg.net) свои действия уходят в комнату, а применяются
// только подтверждённые ею — в том же порядке и с теми же анимациями, что и офлайн.
import { botAction } from '../ai/bot';
import { createGame, dispatch } from '../core/engine';
import { CLASSIC } from '../core/modes';
import type { Action, GameEvent, GameState, ModeConfig, PlayerId } from '../core/types';
import type { RoomClient } from '../net/client';

export type ControllerKind = 'human' | 'bot' | 'remote';

export interface MatchConfig {
  names: [string, string];
  controllers: [ControllerKind, ControllerKind];
  mode?: ModeConfig;
  seed?: number;
  botDelay?: number;
  /** выбор хода бота (по умолчанию — «Странник»); тесты подменяют, чтобы бот «задумывался» */
  botAct?: (s: GameState, p: PlayerId) => Action | null;
  /** сетевая партия: клиент комнаты, уже получивший start. Место соперника — 'remote'. */
  net?: RoomClient;
}

export interface Clocks {
  turnLeft: number;
  total: [number, number];
}

export interface MatchStats {
  captures: [number, number];
  cards: [number, number];
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export class Match {
  /** объект не подменяется: при переподключении содержимое обновляется на месте */
  readonly state: GameState;
  readonly cfg: MatchConfig;
  clocks: Clocks;
  stats: MatchStats = { captures: [0, 0], cards: [0, 0] };
  /** UI проигрывает события; сессия ждёт окончания анимаций перед следующим действием */
  onEvents: (events: GameEvent[], s: GameState) => Promise<void> = async () => {};
  onError: (msg: string) => void = () => {};
  /** сеть: состояние заменено целиком (переподключение, resync, реванш) — перерисовать без анимаций */
  onReset: (s: GameState) => void = () => {};
  private queue: Action[] = [];
  private busy = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTick = performance.now();
  private paused = false;
  private stopped = false;
  private resetTo: GameState | null = null;
  private unlisten: (() => void) | null = null;

  constructor(cfg: MatchConfig) {
    this.cfg = cfg;
    const net = cfg.net;
    if (net) {
      if (!net.state) throw new Error('Match: клиент комнаты ещё не получил start');
      this.state = clone(net.state);
      this.clocks = { turnLeft: this.state.mode.turnMs, total: [this.state.mode.totalMs, this.state.mode.totalMs] };
      this.syncClocks();
      this.unlisten = net.listen({
        action: (a) => {
          this.queue.push(a);
          void this.pump();
        },
        start: (s) => this.reset(s),
        reject: (e) => {
          this.onError(e);
          this.driveBots();
        },
      });
    } else {
      const mode = cfg.mode ?? CLASSIC;
      this.state = createGame(mode, cfg.seed ?? (Math.random() * 2 ** 31) | 0, cfg.names);
      this.clocks = { turnLeft: mode.turnMs, total: [mode.totalMs, mode.totalMs] };
    }
  }

  /** Кто сейчас принимает решение (ход или ответ на вопрос карты). */
  actor(): PlayerId {
    const s = this.state;
    return s.pending ? s.pending.chooser : s.current;
  }
  isHuman = (p: PlayerId) => this.cfg.controllers[p] === 'human';
  /** идёт анимация или ждём подтверждения своего действия от комнаты — ввод заблокирован */
  get isBusy() {
    return this.busy || this.queue.length > 0 || !!this.cfg.net?.awaiting;
  }

  start() {
    this.timer = setInterval(() => this.tick(), 200);
    this.driveBots();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unlisten?.();
    this.unlisten = null;
  }

  /** Пауза часов (оверлеи Кармы, меню). В сети часы ведёт комната — пауза не действует. */
  setPaused(v: boolean) {
    this.paused = v;
    this.lastTick = performance.now();
  }

  submit(a: Action) {
    if (this.stopped) return;
    const net = this.cfg.net;
    if (!net) {
      this.queue.push(a);
      void this.pump();
      return;
    }
    if (a.by !== net.seat || this.cfg.controllers[a.by] === 'remote') return;
    if (a.type === 'place') void net.place(a.layout);
    else if (a.type !== 'timeout' && !net.awaiting) net.submit(a);
  }

  private async pump() {
    if (this.busy) return;
    this.busy = true;
    while (!this.stopped) {
      if (this.resetTo) {
        this.applyReset();
        continue;
      }
      const a = this.queue.shift();
      if (!a) break;
      const r = dispatch(this.state, a);
      if (!r.ok) {
        // в сети сюда не попадаем (клиент уже проверил действие); если всё же — берём состояние клиента
        if (this.cfg.net?.state) this.resetTo = clone(this.cfg.net.state);
        else if (this.isHuman(a.by)) this.onError(r.error ?? 'Ошибка');
        continue;
      }
      this.count(r.events);
      if (!this.cfg.net && r.events.some((e) => e.type === 'turnStart')) this.clocks.turnLeft = this.state.mode.turnMs;
      await this.onEvents(r.events, this.state);
      this.lastTick = performance.now();
    }
    this.busy = false;
    this.driveBots();
  }

  private reset(fresh: GameState) {
    this.resetTo = clone(fresh);
    if (!this.busy) void this.pump();
  }

  private applyReset() {
    const fresh = this.resetTo!;
    this.resetTo = null;
    this.queue = [];
    Object.assign(this.state, fresh); // у GameState все поля обязательны — перезаписываются все
    this.syncClocks();
    this.onReset(this.state);
  }

  private count(events: GameEvent[]) {
    for (const e of events) {
      if (e.type === 'capture') this.stats.captures[e.victim.owner === 0 ? 1 : 0]++;
      if (e.type === 'cardPlayed') this.stats.cards[e.player]++;
    }
  }

  private driveBots() {
    const s = this.state;
    if (s.phase === 'over' || this.stopped || this.busy) return;
    const act = this.cfg.botAct ?? botAction;
    if (s.phase === 'placement') {
      // бот расставляется сразу, не дожидаясь человека
      for (const p of [0, 1] as PlayerId[])
        if (this.cfg.controllers[p] === 'bot' && !s.players[p].placed && !(this.cfg.net?.seat === p && this.cfg.net.placeCommitted)) {
          const a = act(s, p);
          if (a) this.submit(a);
          return;
        }
      return;
    }
    const who = this.actor();
    if (this.cfg.controllers[who] !== 'bot') return;
    const delay = this.cfg.botDelay ?? 420;
    setTimeout(() => {
      if (this.isBusy || this.stopped || this.state.phase === 'over' || this.actor() !== who) return;
      const a = act(this.state, who);
      if (a) this.submit(a);
    }, delay * (0.7 + Math.random() * 0.6));
  }

  private syncClocks() {
    const v = this.cfg.net?.clockView();
    if (!v) return;
    this.clocks.turnLeft = v.turnLeft;
    this.clocks.total = v.total;
  }

  private tick() {
    if (this.cfg.net) return this.syncClocks();
    const now = performance.now();
    const dt = now - this.lastTick;
    this.lastTick = now;
    const s = this.state;
    if (this.paused || this.busy || s.phase !== 'play') return;
    const p = s.current;
    this.clocks.turnLeft -= dt;
    this.clocks.total[p] -= dt;
    if (this.clocks.total[p] <= 0) this.submit({ type: 'timeout', by: p, total: true });
    else if (this.clocks.turnLeft <= 0) {
      this.clocks.turnLeft = s.mode.turnMs;
      this.submit({ type: 'timeout', by: p, total: false });
    }
  }
}
