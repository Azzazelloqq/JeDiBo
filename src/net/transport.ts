// Сетевой слой (задел под p2p). Партия синхронизируется lockstep-ом:
// пиры обмениваются только Action, движок детерминирован (seed + ГСЧ в состоянии),
// поэтому у обоих получается одинаковый GameState. stateHash() ловит рассинхрон.
import type { Action, GameState } from '../core/types';

export type NetMessage =
  | { t: 'hello'; name: string; version: string }
  | { t: 'seed'; seed: number }
  | { t: 'action'; seq: number; action: Action }
  | { t: 'hash'; seq: number; hash: number }
  | { t: 'ping'; at: number };

export interface Transport {
  send(msg: NetMessage): void;
  onMessage(cb: (msg: NetMessage) => void): void;
  close(): void;
}

/** Заглушка для локальной игры: никуда не отправляет. WebRTC-транспорт реализует тот же интерфейс. */
export class LocalTransport implements Transport {
  send() {}
  onMessage() {}
  close() {}
}

export function stateHash(s: GameState): number {
  const str = JSON.stringify([s.rng, s.turn, s.current, s.ap, s.pieces.map((p) => [p.id, p.rank, p.owner, p.x, p.y])]);
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}
