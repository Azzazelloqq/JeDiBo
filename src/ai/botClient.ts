// Асинхронный бот для сессии партии: расчёт в Web Worker, а где воркеров нет (Node, старые браузеры) —
// тот же агент синхронно.
import type { Action, GameState, PlayerId } from '../core/types';
import { createAgent, type BotFn } from './agent';
import { levelById, type LevelId } from './levels';

export interface BotRequest {
  id: number;
  level: LevelId;
  state: GameState;
  me: PlayerId;
  clockMs?: number;
}

export interface BotResponse {
  id: number;
  action: Action | null;
  /** время расчёта в воркере */
  ms: number;
  error?: string;
}

export class BotClient {
  private worker: Worker | null = null;
  private local: BotFn | null = null;
  private seq = 0;
  private waiting = new Map<number, (r: BotResponse) => void>();

  constructor(readonly level: LevelId) {
    try {
      if (typeof Worker === 'undefined') throw new Error('нет Worker');
      this.worker = new Worker(new URL('./botWorker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<BotResponse>) => {
        if (e.data.error) console.error('бот:', e.data.error);
        this.waiting.get(e.data.id)?.(e.data);
        this.waiting.delete(e.data.id);
      };
      this.worker.onerror = (e) => {
        console.error('воркер бота упал, считаю в основном потоке:', e.message);
        this.fallBack();
      };
    } catch {
      this.fallBack();
    }
  }

  /** Действие бота. Состояние копируется в воркер в момент вызова. */
  act(state: GameState, me: PlayerId, clockMs?: number): Promise<Action | null> {
    if (!this.worker) return Promise.resolve(this.localAgent()(state, me, { clockMs }));
    const id = ++this.seq;
    return new Promise((resolve) => {
      this.waiting.set(id, (r) => resolve(r.action));
      this.worker!.postMessage({ id, level: this.level, state, me, clockMs } satisfies BotRequest);
    });
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    for (const done of this.waiting.values()) done({ id: 0, action: null, ms: 0 });
    this.waiting.clear();
  }

  private localAgent(): BotFn {
    return (this.local ??= createAgent(levelById(this.level).config));
  }

  /** Воркер недоступен: ждущие запросы получают null (сессия повторит запрос), дальше — синхронно. */
  private fallBack() {
    this.worker?.terminate();
    this.worker = null;
    for (const done of this.waiting.values()) done({ id: 0, action: null, ms: 0 });
    this.waiting.clear();
  }
}
