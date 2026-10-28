// Сессия партии: связывает движок, контроллеры игроков (человек / бот / сеть), часы и UI.
// Офлайн действия применяются сразу. В сети (cfg.net) свои действия уходят в комнату, а применяются
// только подтверждённые ею — в том же порядке и с теми же анимациями, что и офлайн.
import { BotClient } from '../ai/botClient';
import { DEFAULT_LEVEL, type LevelId } from '../ai/levels';
import { clocksAfter, expiredClock, newClocks, spendTime, type Clocks } from '../core/clocks';
import { createGame, dispatch } from '../core/engine';
import { CLASSIC } from '../core/modes';
import { CARDS, tierOf } from '../core/karma/cards';
import { Rank, type Action, type GameEvent, type GameState, type ModeConfig, type PlayerId } from '../core/types';
import type { RoomClient } from '../net/client';

export type ControllerKind = 'human' | 'bot' | 'remote';

export interface MatchConfig {
  names: [string, string];
  controllers: [ControllerKind, ControllerKind];
  mode?: ModeConfig;
  seed?: number;
  /** пауза перед действием бота, мс (бот считает в это же время; ждём большее из двух) */
  botDelay?: number;
  /** уровень сложности бота (по умолчанию — DEFAULT_LEVEL) */
  botLevel?: LevelId;
  /** выбор хода бота вместо BotClient; тесты подменяют, чтобы бот «задумывался». clockMs — остаток часов бота */
  botAct?: (s: GameState, p: PlayerId, clockMs?: number) => Action | null | Promise<Action | null>;
  /** сетевая партия: клиент комнаты, уже получивший start. Место соперника — 'remote'. */
  net?: RoomClient;
}

export interface MatchStats {
  captures: [number, number];
  cards: [number, number];
  /** для Летописи и эмблем: сколько раз пришла Карма, повышения (и из квадрата — до круга), потери, роковые карты */
  karma: [number, number];
  promotions: [number, number];
  squarePromotions: [number, number];
  lost: [number, number];
  fatal: [number, number];
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export class Match {
  /** объект не подменяется: при переподключении содержимое обновляется на месте */
  readonly state: GameState;
  readonly cfg: MatchConfig;
  clocks: Clocks;
  stats: MatchStats = { captures: [0, 0], cards: [0, 0], karma: [0, 0], promotions: [0, 0], squarePromotions: [0, 0], lost: [0, 0], fatal: [0, 0] };
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
  /** растёт с каждым применённым действием и сбросом: ответ бота на устаревшее состояние отбрасывается */
  private version = 0;
  private bot: BotClient | null = null;
  private botRetries = 0;

  constructor(cfg: MatchConfig) {
    this.cfg = cfg;
    const net = cfg.net;
    if (net) {
      if (!net.state) throw new Error('Match: клиент комнаты ещё не получил start');
      this.state = clone(net.state);
      this.clocks = newClocks(this.state.mode);
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
      this.clocks = newClocks(mode);
    }
  }

  /** Кто сейчас принимает решение (ход или ответ на вопрос карты). */
  actor(): PlayerId {
    const s = this.state;
    return s.pending ? s.pending.chooser : s.current;
  }
  isHuman = (p: PlayerId) => this.cfg.controllers[p] === 'human';
  /** сколько подтверждённых действий ещё ждут анимации — экран может проиграть их без анимаций, чтобы догнать */
  get backlog() {
    return this.queue.length;
  }
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
    this.bot?.dispose();
    this.bot = null;
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
      this.version++;
      this.count(r.events);
      if (!this.cfg.net) clocksAfter(this.state, this.clocks, r.events);
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
    this.version++;
    Object.assign(this.state, fresh); // у GameState все поля обязательны — перезаписываются все
    this.syncClocks();
    this.onReset(this.state);
  }

  private count(events: GameEvent[]) {
    for (const e of events) {
      if (e.type === 'capture') this.stats.captures[e.victim.owner === 0 ? 1 : 0]++;
      if (e.type === 'cardPlayed') {
        this.stats.cards[e.player]++;
        if (tierOf(CARDS[e.card]) === 'fatal') this.stats.fatal[e.player]++;
      }
      if (e.type === 'cardDrawn') this.stats.karma[e.player]++;
      if (e.type === 'capture' || e.type === 'destroy') this.stats.lost[e.victim.owner]++;
      if (e.type === 'promoteRemove') {
        this.stats.promotions[e.piece.owner]++;
        if (e.piece.rank === Rank.Square) this.stats.squarePromotions[e.piece.owner]++;
      }
    }
  }

  private botAct(s: GameState, p: PlayerId): Promise<Action | null> {
    const clockMs = this.clocks.total[p];
    if (this.cfg.botAct) return Promise.resolve(this.cfg.botAct(s, p, clockMs));
    this.bot ??= new BotClient(this.cfg.botLevel ?? DEFAULT_LEVEL);
    return this.bot.act(s, p, clockMs);
  }

  private driveBots() {
    const s = this.state;
    if (s.phase === 'over' || this.stopped || this.busy) return;
    const v = this.version;
    // ответ применяется, только если за время расчёта ничего не изменилось
    const fresh = (who: PlayerId) => !this.stopped && this.version === v && !this.isBusy && this.state.phase !== 'over' && (this.state.phase === 'placement' || this.actor() === who);
    if (s.phase === 'placement') {
      // бот расставляется сразу, не дожидаясь человека
      for (const p of [0, 1] as PlayerId[])
        if (this.cfg.controllers[p] === 'bot' && !s.players[p].placed && !(this.cfg.net?.seat === p && this.cfg.net.placeCommitted)) {
          void this.botAct(s, p).then((a) => {
            if (a && fresh(p) && !this.state.players[p].placed) this.submit(a);
          });
          return;
        }
      return;
    }
    const who = this.actor();
    if (this.cfg.controllers[who] !== 'bot') return;
    // когда на часах бота мало времени, он не тянет паузу
    const base = this.cfg.botDelay ?? 420;
    const delay = (this.clocks.total[who] < 60_000 ? base * 0.25 : base) * (0.7 + Math.random() * 0.6);
    const pause = new Promise((r) => setTimeout(r, delay));
    void Promise.all([this.botAct(s, who), pause]).then(([a]) => {
      if (!fresh(who)) return;
      if (a) {
        this.botRetries = 0;
        this.submit(a);
      } else if (this.botRetries++ < 3) this.driveBots(); // воркер упал или ответа нет — повторить
    });
  }

  private syncClocks() {
    const v = this.cfg.net?.clockView();
    if (!v) return;
    this.clocks.turnLeft = v.turnLeft;
    this.clocks.total = v.total;
    this.clocks.choiceLeft = v.choiceLeft;
  }

  private tick() {
    if (this.cfg.net) return this.syncClocks();
    const now = performance.now();
    const dt = now - this.lastTick;
    this.lastTick = now;
    const s = this.state;
    if (this.paused || this.busy || s.phase !== 'play') return;
    spendTime(s, this.clocks, dt);
    const a = expiredClock(s, this.clocks);
    if (!a) return;
    // часы заводятся заново сразу: до применения таймаута тик не должен отправить его повторно
    if (a.choice) this.clocks.choiceLeft = s.mode.choiceMs;
    else if (!a.total) this.clocks.turnLeft = s.mode.turnMs;
    this.submit(a);
  }
}
