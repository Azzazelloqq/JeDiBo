// Сетевой слой. Партия синхронизируется lockstep-ом: комната (у хоста) рассылает подтверждённые Action,
// движок детерминирован (seed + ГСЧ в состоянии), поэтому у обоих получается одинаковый GameState.
// stateHash() после каждого действия ловит рассинхрон. Проект: docs/network/README.md.
import type { ClientMsg, ServerMsg } from './protocol';

export { stateHash } from './hash';

export type TransportStatus = 'connecting' | 'open' | 'closed' | 'failed';

/** Канал сообщений. Для клиента — Transport<ClientMsg, ServerMsg>, для стороны комнаты — наоборот. */
export interface Transport<Send = ClientMsg, Recv = ServerMsg> {
  send(msg: Send): void;
  onMessage(cb: (msg: Recv) => void): void;
  close(): void;
}
