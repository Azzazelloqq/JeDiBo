// Офлайн-партия переживает перезагрузку ради смены темы: перед ней экран партии кладёт снимок в sessionStorage,
// после неё стартовый экран — эта партия. Снимок одноразовый: обычная перезагрузка партию не возвращает.
// Сетевая партия возвращается сама (netSession), обучение не сохраняется — его режиссёра не восстановить.
import type { LevelId } from '../ai/levels';
import type { Clocks } from '../core/clocks';
import type { GameState, PlayerId, Rank } from '../core/types';
import type { MatchStats } from '../session/match';

export interface ChronicleEntry {
  text: string;
  p?: PlayerId;
  color?: GameState['players'][number]['color'];
}

export interface GameResume {
  kind: 'bot' | 'hotseat';
  level?: LevelId;
  state: GameState;
  clocks: Clocks;
  stats: MatchStats;
  chronicle: ChronicleEntry[];
  /** расстановка не закончена: кто расставляется и что уже стоит (ключ клетки → ранг) */
  placement?: { for: PlayerId; layout: [string, Rank][] };
}

const K = 'jedibo.game.resume';

export function saveResume(r: GameResume) {
  try {
    sessionStorage.setItem(K, JSON.stringify(r));
  } catch {
    // нет хранилища — после перезагрузки будет меню
  }
}

/** Забрать снимок (и стереть его). */
export function takeResume(): GameResume | null {
  try {
    const raw = sessionStorage.getItem(K);
    sessionStorage.removeItem(K);
    return raw ? (JSON.parse(raw) as GameResume) : null;
  } catch {
    return null;
  }
}
