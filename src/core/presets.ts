// Пресеты расстановки. Ряды описаны от переднего (ближе к центру) к заднему.
import { shuffle } from './rng';
import { homeRows } from './rules';
import { Rank, type GameState, type Side } from './types';

export interface Preset {
  id: string;
  name: string;
  build(s: GameState, side: Side): { x: number; y: number; rank: Rank }[];
}

const R: Record<string, Rank> = { T: Rank.Triangle, S: Rank.Square, C: Rank.Circle };

function fromRows(id: string, name: string, rows: [string, string, string]): Preset {
  return {
    id,
    name,
    build(s, side) {
      const ys = homeRows(s, side); // [задний, средний, передний] для нижней стороны
      const front = [ys[2], ys[1], ys[0]];
      const out: { x: number; y: number; rank: Rank }[] = [];
      rows.forEach((row, ri) =>
        [...row].forEach((ch, i) => {
          // верхний игрок смотрит на поле «с другой стороны» — зеркалим по x
          const x = side === 0 ? i : s.mode.size - 1 - i;
          if (R[ch] !== undefined) out.push({ x, y: front[ri], rank: R[ch] });
        }),
      );
      return out;
    },
  };
}

export const PRESETS: Preset[] = [
  fromRows('wedge', 'Клин', ['....TTTT....', '..TTSCCSTT..', 'TTSS..C.SSTT']),
  fromRows('wall', 'Стена', ['TTTTTTTTTTTT', 'S.S.S..S.S.S', '..C..C...C..']),
  fromRows('flanks', 'Фланги', ['TTT......TTT', 'TSS.C..C.SST', 'TTS..C...STT']),
  {
    id: 'random',
    name: 'Случайно',
    build(s, side) {
      const ys = homeRows(s, side);
      const cells = ys.flatMap((y) => Array.from({ length: s.mode.size }, (_, x) => ({ x, y })));
      // отдельная копия ГСЧ, чтобы не сдвигать общий поток бросков партии
      const tmp = { ...s, rng: (s.rng ^ (Date.now() & 0xffff)) | 0 };
      shuffle(tmp, cells);
      const ranks = [...Array(12).fill(Rank.Triangle), ...Array(6).fill(Rank.Square), ...Array(3).fill(Rank.Circle)];
      return ranks.map((rank, i) => ({ ...cells[i], rank }));
    },
  },
];
