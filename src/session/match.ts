// Сессия партии: связывает движок, контроллеры игроков (человек / бот / сеть), часы и UI.
import { botAction } from '../ai/bot';
import { createGame, dispatch } from '../core/engine';
import { CLASSIC } from '../core/modes';
import type { Action, GameEvent, GameState, ModeConfig, PlayerId } from '../core/types';
import type { Transport } from '../net/transport';

export type ControllerKind = 'human' | 'bot' | 'remote';

export interface MatchConfig {
  names: [string, string];
  controllers: [ControllerKind, ControllerKind];
  mode?: ModeConfig;
  seed?: number;
  transport?: Transport;
  botDelay?: number;
}

export interface Clocks {
  turnLeft: number;
  total: [number, number];
}

export interface MatchStats {
  captures: [number, number];
  cards: [number, number];
}

export class Match {
  readonly state: GameState;
  readonly cfg: MatchConfig;
  clocks: Clocks;
  stats: MatchStats = { captures: [0, 0], cards: [0, 0] };
  /** UI проигрывает события; сессия ждёт окончания анимаций перед следующим действием */
  onEvents: (events: GameEvent[], s: GameState) => Promise<void> = async () => {};
  onError: (msg: string) => void = () => {};
  private queue: Action[] = [];
  private busy = false;
  private timer: number | null = null;
  private lastTick = performance.now();
  private paused = false;
  private stopped = false;

  constructor(cfg: MatchConfig) {
    this.cfg = cfg;
    const mode = cfg.mode ?? CLASSIC;
    this.state = createGame(mode, cfg.seed ?? (Math.random() * 2 ** 31) | 0, cfg.names);
    this.clocks = { turnLeft: mode.turnMs, total: [mode.totalMs, mode.totalMs] };
  }

  /** Кто сейчас принимает решение (ход или ответ на вопрос карты). */
  actor(): PlayerId {
    const s = this.state;
    return s.pending ? s.pending.chooser : s.current;
  }
  isHuman = (p: PlayerId) => this.cfg.controllers[p] === 'human';
  get isBusy() {
    return this.busy;
  }

  start() {
    this.timer = window.setInterval(() => this.tick(), 200);
    this.driveBots();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.cfg.transport?.close();
  }

  /** Пауза часов (оверлеи Кармы, меню). */
  setPaused(v: boolean) {
    this.paused = v;
    this.lastTick = performance.now();
  }

  submit(a: Action) {
    if (this.stopped) return;
    this.queue.push(a);
    void this.pump();
  }

  private async pump() {
    if (this.busy) return;
    this.busy = true;
    while (this.queue.length && !this.stopped) {
      const a = this.queue.shift()!;
      const r = dispatch(this.state, a);
      if (!r.ok) {
        if (this.isHuman(a.by)) this.onError(r.error ?? 'Ошибка');
        continue;
      }
      this.count(r.events);
      if (r.events.some((e) => e.type === 'turnStart')) this.clocks.turnLeft = this.state.mode.turnMs;
      await this.onEvents(r.events, this.state);
      this.lastTick = performance.now();
    }
    this.busy = false;
    this.driveBots();
  }

  private count(events: GameEvent[]) {
    for (const e of events) {
      if (e.type === 'capture') this.stats.captures[e.victim.owner === 0 ? 1 : 0]++;
      if (e.type === 'cardPlayed') this.stats.cards[e.player]++;
    }
  }

  private driveBots() {
    const s = this.state;
    if (s.phase === 'over' || this.stopped) return;
    if (s.phase === 'placement') {
      // бот расставляется сразу, не дожидаясь человека
      for (const p of [0, 1] as PlayerId[])
        if (this.cfg.controllers[p] === 'bot' && !s.players[p].placed) {
          const a = botAction(s, p);
          if (a) this.submit(a);
          return;
        }
      return;
    }
    const who = this.actor();
    if (this.cfg.controllers[who] !== 'bot') return;
    const delay = this.cfg.botDelay ?? 420;
    setTimeout(() => {
      if (this.busy || this.stopped || this.state.phase === 'over' || this.actor() !== who) return;
      const a = botAction(this.state, who);
      if (a) this.submit(a);
    }, delay * (0.7 + Math.random() * 0.6));
  }

  private tick() {
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
