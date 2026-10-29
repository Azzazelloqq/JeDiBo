// Потери по событиям движка, в ценностях 1/3/5 (без модели бота — честная мера). Две меры:
//  - проигранный размен: X бьёт фигурой A, соперник в ответный ход забирает A, и X в свой следующий ход
//    не отыгрывает столько же;
//  - потеряно даром (шире, по любой причине): соперник взял фигуры X, а X ни в свой ход перед этим, ни в свой
//    следующий ход не взял столько же. Сюда входят и подставленные обычным ходом фигуры, и вскрытые атаки, и
//    неубранные из-под удара; равный размен (взял — отдал) потерей не считается.
import type { GameEvent, GameState, PlayerId } from '../../src/core/types';

const VAL = [1, 3, 5];

export class TradeTracker {
  /** потери на проигранных разменах и их число, по местам */
  readonly loss: [number, number] = [0, 0];
  readonly count: [number, number] = [0, 0];
  /** потеряно даром: всего материала и число таких ходов */
  readonly free: [number, number] = [0, 0];
  readonly freeCount: [number, number] = [0, 0];
  /** взято соперником у стороны за его последний ход и сколько сторона уже отыграла */
  private owed: [number, number] = [0, 0];
  private back: [number, number] = [0, 0];
  private owedPrev: [number, number] = [0, 0];
  /** взято стороной в её предыдущий ход — засчитывается в размен, если соперник потом взял у неё */
  private tookBefore: [number, number] = [0, 0];
  private lastCap: ({ id: number; took: number } | null)[] = [null, null];
  private open: ({ took: number; lost: number } | null)[] = [null, null];

  /** Учесть действие: cur — чей был ход до действия, turnBefore — s.turn до действия, s — состояние после. */
  record(cur: PlayerId, turnBefore: number, events: GameEvent[], s: GameState) {
    for (const e of events) {
      if (e.type !== 'capture') continue;
      const v = VAL[e.victim.rank];
      if (e.victim.owner !== cur) {
        this.owed[e.victim.owner] += v;
        this.back[cur] += v;
      }
      const o = this.open[cur];
      if (o) o.took += v;
      const lc = this.lastCap[e.victim.owner];
      if (lc && lc.id === e.victim.id) this.open[e.victim.owner] = { took: lc.took, lost: v };
      this.lastCap[cur] = { id: e.attackerId, took: v };
    }
    if (s.turn === turnBefore) return;
    // ход cur закончился: всё, что соперник взял у cur до этого хода, сравнивается с тем, что cur взял в этот ход
    if (this.owedPrev[cur] > 0) {
      const lost = this.owedPrev[cur] - this.back[cur] - this.tookBefore[cur];
      if (lost > 0) {
        this.free[cur] += lost;
        this.freeCount[cur]++;
      }
    }
    this.owedPrev[cur] = 0;
    this.tookBefore[cur] = this.back[cur];
    this.back[cur] = 0;
    // взятое у соперника в этот ход он сможет отыграть в свой следующий
    const opp = (1 - cur) as PlayerId;
    this.owedPrev[opp] += this.owed[opp];
    this.owed[opp] = 0;
    const o = this.open[cur];
    if (o) {
      if (o.took < o.lost) {
        this.loss[cur] += o.lost - o.took;
        this.count[cur]++;
      }
      this.open[cur] = null;
    }
    // окно ответа на взятие соперника закрылось вместе с этим ходом
    this.lastCap[1 - cur] = null;
  }
}
