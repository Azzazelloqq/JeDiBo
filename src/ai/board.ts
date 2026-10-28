// Быстрая доска для поиска. Повторяет геометрию ходов движка (rules.ts: targetsOf, canAct),
// но без аллокаций: клетки — Int16Array, фигуры — типизированные массивы, ход делается и откатывается на месте.
// Повышение, карты и прочие «вопросы» движка здесь не моделируются: это решается на настоящем движке.
// Совпадение с движком проверяет scripts/aicheck.ts.
import { Rank, type GameState, type PlayerId } from '../core/types';

/** Ход фигуры: клетка назначения + флаги. */
export const ATTACK = 1 << 12;
export const JUMP = 1 << 13;
export const CELL_MASK = ATTACK - 1;

const BARRIER = -1;
const CAP = 128;

// направления: 0..7 — ALL8 в порядке движка
const DX = [0, 0, 1, -1, 1, 1, -1, -1];
const DY = [1, -1, 0, 0, 1, -1, 1, -1];

export interface Undo {
  pi: number;
  from: number;
  to: number;
  victim: number;
  ap: number;
  acted: number;
  jumper: number;
  blitzPiece: number;
  blitzDone: number;
  actedThisTurn: number;
}

export class FastBoard {
  readonly n: number;
  /** 0 — пусто, BARRIER — барьер, иначе индекс фигуры + 1 */
  readonly cell: Int16Array;
  readonly px = new Int8Array(CAP);
  readonly py = new Int8Array(CAP);
  readonly rank = new Int8Array(CAP);
  readonly owner = new Int8Array(CAP);
  readonly acted = new Uint8Array(CAP);
  readonly alive = new Uint8Array(CAP);
  readonly id = new Int32Array(CAP);
  count = 0;

  current: PlayerId = 0;
  ap = 0;
  actedThisTurn = 0;
  /** направление «вперёд» по y для игрока */
  readonly fwd = new Int8Array(2);
  // эффекты Кармы по игрокам
  readonly roundProtection = new Uint8Array(2);
  readonly shortRange = new Uint8Array(2);
  readonly jumper = new Uint8Array(2);
  /** Блицкриг: есть ли эффект у игрока, фигура (индекс, -1 — ещё не выбрана), закончен ли */
  readonly blitz = new Uint8Array(2);
  readonly blitzPiece = new Int16Array(2);
  readonly blitzDone = new Uint8Array(2);

  constructor(n: number) {
    this.n = n;
    this.cell = new Int16Array(n * n);
  }

  static fromState(s: GameState): FastBoard {
    const b = new FastBoard(s.mode.size);
    b.load(s);
    return b;
  }

  load(s: GameState) {
    const n = this.n;
    this.cell.fill(0);
    this.alive.fill(0);
    this.count = 0;
    for (const pc of s.pieces) {
      const i = this.count++;
      this.px[i] = pc.x;
      this.py[i] = pc.y;
      this.rank[i] = pc.rank;
      this.owner[i] = pc.owner;
      this.acted[i] = pc.acted ? 1 : 0;
      this.alive[i] = 1;
      this.id[i] = pc.id;
      this.cell[pc.y * n + pc.x] = i + 1;
    }
    this.current = s.current;
    this.ap = s.phase === 'play' && !s.pending ? s.ap : 0;
    this.actedThisTurn = s.actedThisTurn ? 1 : 0;
    for (const p of [0, 1] as PlayerId[]) {
      this.fwd[p] = s.players[p].side === 0 ? -1 : 1;
      this.roundProtection[p] = 0;
      this.shortRange[p] = 0;
      this.jumper[p] = 0;
      this.blitz[p] = 0;
      this.blitzPiece[p] = -1;
      this.blitzDone[p] = 0;
    }
    for (const e of s.effects) {
      if (e.kind === 'roundProtection') this.roundProtection[e.owner] = 1;
      else if (e.kind === 'depression' || e.kind === 'snail') this.shortRange[e.owner] = 1;
      else if (e.kind === 'jumper') this.jumper[e.owner] = 1;
      else if (e.kind === 'barrier') for (const c of e.cells) this.cell[c.y * n + c.x] = BARRIER;
      // как hasEffect движка: действует первый эффект этого вида
      else if (e.kind === 'blitz' && !this.blitz[e.owner]) {
        this.blitz[e.owner] = 1;
        this.blitzDone[e.owner] = e.done ? 1 : 0;
        this.blitzPiece[e.owner] = e.pieceId === null ? -1 : this.indexOfId(e.pieceId);
      }
    }
  }

  indexOfId(id: number): number {
    for (let i = 0; i < this.count; i++) if (this.alive[i] && this.id[i] === id) return i;
    return -1;
  }

  pieceAt(x: number, y: number): number {
    const v = this.cell[y * this.n + x];
    return v > 0 ? v - 1 : -1;
  }

  canAct(i: number): boolean {
    if (!this.alive[i] || this.owner[i] !== this.current || this.ap <= 0) return false;
    if (!this.acted[i]) return true;
    const p = this.current;
    return this.blitz[p] === 1 && !this.blitzDone[p] && this.blitzPiece[p] === i;
  }

  // ── генерация ходов ─────────────────────────────────────────────────────

  /**
   * Все цели фигуры (как targetsOf движка) в out начиная с позиции at; возвращает новую длину.
   * Каждая цель — номер клетки | ATTACK | JUMP.
   */
  targets(i: number, out: Int32Array, at = 0): number {
    const p = this.owner[i];
    const r = this.rank[i];
    const f = this.fwd[p];
    let moveRange: number;
    let attackRange: number;
    if (r === Rank.Triangle) moveRange = attackRange = 1;
    else if (r === Rank.Square) moveRange = attackRange = 3;
    else moveRange = attackRange = 5;
    if (r !== Rank.Triangle && this.shortRange[p]) moveRange = attackRange = 1;
    const canJump = r !== Rank.Triangle && this.jumper[p] === 1;
    const x0 = this.px[i];
    const y0 = this.py[i];
    let len = at;

    // перемещения
    if (r === Rank.Triangle) len = this.walk(x0, y0, 0, f, moveRange, false, canJump, p, out, len);
    else if (r === Rank.Square) {
      len = this.walk(x0, y0, 0, f, moveRange, false, canJump, p, out, len);
      len = this.walk(x0, y0, -1, f, moveRange, false, canJump, p, out, len);
      len = this.walk(x0, y0, 1, f, moveRange, false, canJump, p, out, len);
      len = this.walk(x0, y0, -1, 0, moveRange, false, canJump, p, out, len);
      len = this.walk(x0, y0, 1, 0, moveRange, false, canJump, p, out, len);
    } else for (let d = 0; d < 8; d++) len = this.walk(x0, y0, DX[d], DY[d], moveRange, false, canJump, p, out, len);

    // атаки
    if (r === Rank.Circle || this.roundProtection[p])
      for (let d = 0; d < 8; d++) len = this.walk(x0, y0, DX[d], DY[d], attackRange, true, canJump, p, out, len);
    else {
      len = this.walk(x0, y0, 0, f, attackRange, true, canJump, p, out, len);
      len = this.walk(x0, y0, -1, f, attackRange, true, canJump, p, out, len);
      len = this.walk(x0, y0, 1, f, attackRange, true, canJump, p, out, len);
      if (r === Rank.Square) {
        len = this.walk(x0, y0, -1, 0, attackRange, true, canJump, p, out, len);
        len = this.walk(x0, y0, 1, 0, attackRange, true, canJump, p, out, len);
      }
    }
    return len;
  }

  private walk(x0: number, y0: number, dx: number, dy: number, range: number, attack: boolean, canJump: boolean, p: number, out: Int32Array, len: number): number {
    const n = this.n;
    let jumped = 0;
    let x = x0;
    let y = y0;
    for (let step = 1; step <= range; step++) {
      x += dx;
      y += dy;
      if (x < 0 || y < 0 || x >= n || y >= n) break;
      const c = y * n + x;
      const v = this.cell[c];
      if (v === 0) {
        if (!attack) out[len++] = c | jumped;
        continue;
      }
      if (attack && v > 0 && this.owner[v - 1] !== p) out[len++] = c | ATTACK | jumped;
      if (canJump && !jumped) {
        jumped = JUMP;
        continue;
      }
      break;
    }
    return len;
  }

  /** Все ходы текущего игрока: пары (фигура, цель) в pieces/out. Возвращает число ходов. */
  movesOf(pieces: Int16Array, out: Int32Array): number {
    let len = 0;
    for (let i = 0; i < this.count; i++) {
      if (!this.canAct(i)) continue;
      const before = len;
      len = this.targets(i, out, len);
      for (let k = before; k < len; k++) pieces[k] = i;
    }
    return len;
  }

  // ── атаки ───────────────────────────────────────────────────────────────

  /**
   * Атакует ли игрок `by` клетку (как isAttacked движка).
   * xray — свои фигуры атакующего не блокируют линию (соперник может увести их до удара).
   */
  attacked(x: number, y: number, by: PlayerId, xray = false): boolean {
    return this.attackerOf(x, y, by, xray) >= 0;
  }

  /** Самая дешёвая фигура игрока `by`, атакующая клетку; -1 — нет такой. */
  attackerOf(x: number, y: number, by: PlayerId, xray = false): number {
    let best = -1;
    for (let i = 0; i < this.count; i++) {
      if (!this.alive[i] || this.owner[i] !== by) continue;
      if (best >= 0 && this.rank[i] >= this.rank[best]) continue;
      if (this.hits(i, x, y, xray)) best = i;
    }
    return best;
  }

  /** Бьёт ли фигура i клетку (x, y) по геометрии атаки, с учётом препятствий. */
  hits(i: number, x: number, y: number, xray = false): boolean {
    const p = this.owner[i];
    const r = this.rank[i];
    const dx = x - this.px[i];
    const dy = y - this.py[i];
    if (dx === 0 && dy === 0) return false;
    const adx = dx < 0 ? -dx : dx;
    const ady = dy < 0 ? -dy : dy;
    if (adx !== 0 && ady !== 0 && adx !== ady) return false;
    const dist = adx > ady ? adx : ady;
    const sx = Math.sign(dx);
    const sy = Math.sign(dy);
    let range = r === Rank.Triangle ? 1 : r === Rank.Square ? 3 : 5;
    if (r !== Rank.Triangle && this.shortRange[p]) range = 1;
    if (dist > range) return false;
    if (r !== Rank.Circle && !this.roundProtection[p]) {
      const f = this.fwd[p];
      const forwardish = sy === f; // вперёд или по диагонали вперёд
      const sideways = r === Rank.Square && sy === 0;
      if (!forwardish && !sideways) return false;
    }
    // путь: все клетки до цели свободны (или одно препятствие при Прыгуне)
    let jumps = r !== Rank.Triangle && this.jumper[p] ? 1 : 0;
    const n = this.n;
    for (let k = 1; k < dist; k++) {
      const v = this.cell[(this.py[i] + sy * k) * n + this.px[i] + sx * k];
      if (v === 0) continue;
      if (xray && v > 0 && this.owner[v - 1] === p) continue;
      if (jumps > 0) {
        jumps--;
        continue;
      }
      return false;
    }
    return true;
  }

  // ── ход и откат ─────────────────────────────────────────────────────────

  /** Сделать ход фигурой i в цель t (из targets). Повышение не выполняется. */
  make(i: number, t: number, u: Undo): void {
    const n = this.n;
    const p = this.owner[i];
    const to = t & CELL_MASK;
    const from = this.py[i] * n + this.px[i];
    u.pi = i;
    u.from = from;
    u.to = to;
    u.ap = this.ap;
    u.acted = this.acted[i];
    u.jumper = this.jumper[p];
    u.blitzPiece = this.blitzPiece[p];
    u.blitzDone = this.blitzDone[p];
    u.actedThisTurn = this.actedThisTurn;
    u.victim = -1;

    if (this.blitz[p] && !this.blitzDone[p]) {
      if (this.blitzPiece[p] < 0) this.blitzPiece[p] = i;
      else if (this.blitzPiece[p] !== i) this.blitzDone[p] = 1;
    }
    if (t & JUMP) this.jumper[p] = 0;
    this.acted[i] = 1;
    this.actedThisTurn = 1;
    if (t & ATTACK) {
      const v = this.cell[to] - 1;
      u.victim = v;
      this.alive[v] = 0;
      this.ap = 0;
    } else this.ap -= 1;
    this.cell[from] = 0;
    this.cell[to] = i + 1;
    this.px[i] = to % n;
    this.py[i] = (to / n) | 0;
    if (this.blitz[p] && this.py[i] === (this.fwd[p] < 0 ? 0 : n - 1)) this.blitzDone[p] = 1;
  }

  unmake(u: Undo): void {
    const n = this.n;
    const i = u.pi;
    const p = this.owner[i];
    this.cell[u.to] = 0;
    if (u.victim >= 0) {
      this.alive[u.victim] = 1;
      this.cell[u.to] = u.victim + 1;
    }
    this.cell[u.from] = i + 1;
    this.px[i] = u.from % n;
    this.py[i] = (u.from / n) | 0;
    this.ap = u.ap;
    this.acted[i] = u.acted;
    this.jumper[p] = u.jumper;
    this.blitzPiece[p] = u.blitzPiece;
    this.blitzDone[p] = u.blitzDone;
    this.actedThisTurn = u.actedThisTurn;
  }
}

export const newUndo = (): Undo => ({ pi: 0, from: 0, to: 0, victim: -1, ap: 0, acted: 0, jumper: 0, blitzPiece: -1, blitzDone: 0, actedThisTurn: 0 });
