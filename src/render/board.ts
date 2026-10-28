// BoardView: низкорезный канвас поля (212×212), масштабируемый целиком.
// Получает состояние + события движка, проигрывает анимации и рисует подсказки.
import { sfx } from '../audio/sfx';
import { forward, homeRows, isBarrier } from '../core/rules';
import { Rank, type GameEvent, type GameState, type Piece, type PlayerId, type Pos } from '../core/types';
import { PAL, STONE } from './palette';
import { makeCanvas, px, tinyText, tinyWidth, withAlpha, type Canvas } from './pixel';
import { CELL, cellTile, pieceSprite } from './sprites';
import { ease, onFrame, tween, wait } from './tween';
import { shake } from './fx';

const M = 10; // поля под координаты
const N = 12;
export const BOARD_PX = N * CELL + M * 2;

interface Vis {
  id: number;
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  rank: Rank;
  owner: PlayerId;
  flash: number;
  alpha: number;
  dead: boolean;
}

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  color: string;
  size: number;
  ground: boolean;
}

export interface Overlay {
  selected: number | null;
  moves: Pos[];
  attacks: Pos[];
  options: Pos[];
  optionsTone: 'amber' | 'brand';
  lastMove: Pos[];
  zone: { side: 0 | 1 } | null;
  ghost: { pos: Pos; rank: Rank; owner: PlayerId } | null;
  hoverEnabled: boolean;
}

export class BoardView {
  readonly el: HTMLDivElement;
  private canvas: Canvas;
  private g: CanvasRenderingContext2D;
  /** подложки с координатами: [обычная, перевёрнутая] */
  private bases: [Canvas | null, Canvas | null] = [null, null];
  private vis = new Map<number, Vis>();
  private parts: Particle[] = [];
  private s: GameState | null = null;
  private hover: Pos | null = null;
  private beam: { x: number; t: number } | null = null;
  private barrierDrop = new Map<string, number>();
  private unsub: () => void;
  scale = 3;
  /** Чьими глазами смотрим: его сторона всегда внизу (сторона 1 — поле повёрнуто на 180°). null — без поворота. */
  viewer: PlayerId | null = null;
  ov: Overlay = { selected: null, moves: [], attacks: [], options: [], optionsTone: 'amber', lastMove: [], zone: null, ghost: null, hoverEnabled: true };
  onCell: (p: Pos) => void = () => {};
  onHover: (p: Pos | null) => void = () => {};

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'board-wrap';
    [this.canvas, this.g] = makeCanvas(BOARD_PX, BOARD_PX);
    this.canvas.className = 'board-canvas';
    this.el.appendChild(this.canvas);
    this.canvas.addEventListener('mousemove', (e) => this.setHover(this.cellAt(e)));
    this.canvas.addEventListener('mouseleave', () => this.setHover(null));
    this.canvas.addEventListener('click', (e) => {
      const c = this.cellAt(e);
      if (c) this.onCell(c);
    });
    this.unsub = onFrame((now, dt) => this.frame(now, dt));
  }

  destroy() {
    this.unsub();
  }

  fit(maxW: number, maxH: number) {
    const raw = Math.min(maxW, maxH) / BOARD_PX;
    this.scale = raw >= 3 ? Math.floor(raw) : Math.max(1.5, Math.floor(raw * 4) / 4);
    this.canvas.style.width = `${BOARD_PX * this.scale}px`;
    this.canvas.style.height = `${BOARD_PX * this.scale}px`;
  }

  private setHover(c: Pos | null) {
    if (c?.x === this.hover?.x && c?.y === this.hover?.y) return;
    this.hover = c;
    this.onHover(c);
  }

  private cellAt(e: MouseEvent): Pos | null {
    const r = this.canvas.getBoundingClientRect();
    const lx = ((e.clientX - r.left) / r.width) * BOARD_PX - M;
    const ly = ((e.clientY - r.top) / r.height) * BOARD_PX - M;
    const x = Math.floor(lx / CELL);
    const y = Math.floor(ly / CELL);
    if (x < 0 || y < 0 || x >= N || y >= N) return null;
    return this.flipped ? { x: N - 1 - x, y: N - 1 - y } : { x, y };
  }

  /** Центр клетки в координатах страницы — для DOM-эффектов (всплывающий текст). */
  cellToClient(p: Pos): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: r.left + ((this.X(p.x) + CELL / 2) / BOARD_PX) * r.width,
      y: r.top + ((this.Y(p.y) + CELL / 2) / BOARD_PX) * r.height,
    };
  }

  /** Поле повёрнуто: зритель играет стороной 1 (верхней в координатах движка). */
  get flipped() {
    return this.viewer !== null && !!this.s && this.s.players[this.viewer].side === 1;
  }
  /** Клетка движка → пиксель канваса (левый/верхний край клетки); дробные клетки — для анимаций. */
  private X(x: number) {
    return M + (this.flipped ? N - 1 - x : x) * CELL;
  }
  private Y(y: number) {
    return M + (this.flipped ? N - 1 - y : y) * CELL;
  }
  /** Спрайт фигуры «смотрит» вверх экрана: сторона 0 — вверх, при повороте — наоборот. */
  private faceUp(owner: PlayerId, s: GameState) {
    return forward(s.players[owner].side) < 0 !== this.flipped;
  }

  // ── статичная подложка: рама + плиты + координаты ────────────────────────
  private base(flip: boolean): Canvas {
    const i = flip ? 1 : 0;
    return (this.bases[i] ??= this.buildBase(flip));
  }
  private buildBase(flip: boolean): Canvas {
    const [c, g] = makeCanvas(BOARD_PX, BOARD_PX);
    // рама — тёмный монолит
    g.fillStyle = PAL.slab800;
    g.fillRect(0, 0, BOARD_PX, BOARD_PX);
    g.fillStyle = PAL.slab600;
    g.fillRect(0, 0, BOARD_PX, 1);
    g.fillRect(0, 0, 1, BOARD_PX);
    g.fillStyle = PAL.void;
    g.fillRect(0, BOARD_PX - 1, BOARD_PX, 1);
    g.fillRect(BOARD_PX - 1, 0, 1, BOARD_PX);
    // шум рамы
    for (let i = 0; i < 900; i++) {
      const x = Math.floor(Math.random() * BOARD_PX);
      const y = Math.floor(Math.random() * BOARD_PX);
      g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.18)';
      g.fillRect(x, y, 1, 1);
    }
    // утопленный паз под плиты
    g.fillStyle = PAL.void;
    g.fillRect(M - 2, M - 2, N * CELL + 4, N * CELL + 4);
    g.fillStyle = PAL.concrete600;
    g.fillRect(M - 1, M - 1, N * CELL + 2, N * CELL + 2);
    const at = (i: number) => M + (flip ? N - 1 - i : i) * CELL;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) g.drawImage(cellTile(x, y), at(x), at(y));
    // координаты (подписи остаются за своими клетками и при повороте)
    const letters = 'ABCDEFGHIJKL';
    for (let i = 0; i < N; i++) {
      const L = letters[i];
      const cx = at(i) + Math.floor((CELL - tinyWidth(L)) / 2);
      tinyText(g, L, cx, 2, PAL.concrete500);
      tinyText(g, L, cx, BOARD_PX - 7, PAL.concrete500);
      const num = String(N - i);
      const cy = at(i) + 5;
      tinyText(g, num, Math.floor((M - tinyWidth(num)) / 2), cy, PAL.concrete500);
      tinyText(g, num, BOARD_PX - M + Math.floor((M - tinyWidth(num)) / 2), cy, PAL.concrete500);
    }
    // стяжки по углам рамы
    for (const [x, y] of [[2, 2], [BOARD_PX - 5, 2], [2, BOARD_PX - 5], [BOARD_PX - 5, BOARD_PX - 5]]) {
      px(g, x, y, PAL.void, 3, 3);
      px(g, x, y + 3, PAL.slab600, 3, 1);
    }
    return c;
  }

  // ── синхронизация с состоянием ───────────────────────────────────────────
  sync(s: GameState) {
    this.s = s;
    const alive = new Set<number>();
    for (const pc of s.pieces) {
      alive.add(pc.id);
      const v = this.vis.get(pc.id);
      if (!v) this.vis.set(pc.id, this.newVis(pc));
      else if (!v.dead) {
        v.x = pc.x;
        v.y = pc.y;
        v.rank = pc.rank;
        v.owner = pc.owner;
      }
    }
    for (const [id, v] of this.vis) if (!alive.has(id) && !v.dead) this.vis.delete(id);
  }

  private newVis(pc: Piece): Vis {
    return { id: pc.id, x: pc.x, y: pc.y, z: 0, sx: 1, sy: 1, rank: pc.rank, owner: pc.owner, flash: 0, alpha: 1, dead: false };
  }

  /** Сбросить все визуальные фигуры (смена расстановки → партия). */
  clear() {
    this.vis.clear();
    this.parts = [];
    this.ov.lastMove = [];
  }

  /** Проиграть одно событие движка. Итоговое состояние подаётся отдельно через sync(). */
  async playEvent(e: GameEvent) {
    switch (e.type) {
      case 'move': {
        const v = this.vis.get(e.pieceId);
        if (!v) return;
        await this.hop(v, e.to, e.forced ? 0.7 : 1, e.jump);
        this.ov.lastMove = [e.from, e.to];
        return;
      }
      case 'capture': {
        const a = this.vis.get(e.attackerId);
        const victim = this.vis.get(e.victim.id) ?? this.newVis(e.victim);
        this.vis.set(victim.id, victim);
        if (a) {
          // замах назад и рывок
          const dx = Math.sign(e.to.x - e.from.x) * 0.15;
          const dy = Math.sign(e.to.y - e.from.y) * 0.15;
          const ox = a.x, oy = a.y;
          await tween(90, (t) => {
            a.x = ox - dx * ease.outCubic(t);
            a.y = oy - dy * ease.outCubic(t);
            a.z = 3 * t;
          });
          const sx = a.x, sy = a.y;
          await tween(110, (t) => {
            const k = ease.inCubic(t);
            a.x = sx + (e.to.x - sx) * k;
            a.y = sy + (e.to.y - sy) * k;
            a.z = 3 * (1 - t);
          });
        }
        this.smash(victim, e.victim, 18);
        sfx.capture();
        shake(7);
        if (a) this.squash(a);
        this.ov.lastMove = [e.from, e.to];
        await wait(120);
        return;
      }
      case 'destroy': {
        const v = this.vis.get(e.victim.id);
        if (!v) return;
        v.flash = 1;
        await wait(80);
        this.smash(v, e.victim, 12);
        sfx.crumble();
        shake(3);
        await wait(90);
        return;
      }
      case 'spawn': {
        const v = this.newVis(e.piece);
        v.z = 48;
        v.alpha = 0;
        this.vis.set(v.id, v);
        sfx.spawn();
        await tween(420, (t) => {
          v.z = 48 * (1 - ease.outBounce(t));
          v.alpha = Math.min(1, t * 4);
        });
        this.dust(v.x, v.y, 8);
        this.squash(v);
        return;
      }
      case 'promoteRemove': {
        const v = this.vis.get(e.piece.id);
        if (!v) return;
        v.dead = true;
        sfx.promote();
        this.sparkle(v.x, v.y, PAL.amber300, 14);
        await tween(380, (t) => {
          v.z = 22 * ease.outCubic(t);
          v.alpha = 1 - t;
        });
        this.vis.delete(v.id);
        return;
      }
      case 'rankChange': {
        const v = this.vis.get(e.pieceId);
        if (!v) return;
        v.flash = 1;
        sfx.promote();
        this.sparkle(v.x, v.y, e.to > e.from ? PAL.amber300 : PAL.brand400, 10);
        await wait(90);
        v.rank = e.to;
        await this.pop(v);
        return;
      }
      case 'ownerChange': {
        const v = this.vis.get(e.pieceId);
        if (!v) return;
        v.flash = 1;
        this.sparkle(v.x, v.y, PAL.patina300, 12);
        sfx.cardFlip();
        await wait(100);
        v.owner = e.to;
        await this.pop(v);
        return;
      }
      case 'sidesSwap': {
        sfx.karma();
        shake(5);
        for (const v of this.vis.values()) {
          v.flash = 1;
          this.sparkle(v.x, v.y, PAL.patina300, 3);
        }
        await wait(160);
        for (const v of this.vis.values()) v.owner = v.owner === 0 ? 1 : 0;
        await wait(200);
        return;
      }
      case 'column': {
        this.beam = { x: e.x, t: 0 };
        sfx.beam();
        await tween(700, (t) => this.beam && (this.beam.t = t));
        shake(8);
        setTimeout(() => (this.beam = null), 250);
        return;
      }
      case 'barrier': {
        for (const c of e.cells) this.barrierDrop.set(`${c.x},${c.y}`, 1);
        sfx.stamp();
        await tween(350, (t) => {
          for (const c of e.cells) this.barrierDrop.set(`${c.x},${c.y}`, 1 - ease.outBounce(t));
        });
        for (const c of e.cells) this.dust(c.x, c.y, 10);
        shake(4);
        return;
      }
      default:
        return;
    }
  }

  private async hop(v: Vis, to: Pos, k: number, jump?: boolean) {
    const fx = v.x, fy = v.y;
    const dist = Math.max(Math.abs(to.x - fx), Math.abs(to.y - fy));
    const h = (jump ? 14 : 4 + dist * 1.6) * k;
    sfx.click();
    // подготовка — небольшое приседание
    await tween(60, (t) => {
      v.sy = 1 - 0.18 * t;
      v.sx = 1 + 0.12 * t;
    });
    await tween(150 + dist * 45, (t) => {
      const e = ease.inOut(t);
      v.x = fx + (to.x - fx) * e;
      v.y = fy + (to.y - fy) * e;
      v.z = Math.sin(Math.PI * t) * h;
      v.sy = 1 + 0.15 * Math.sin(Math.PI * t);
      v.sx = 1 - 0.08 * Math.sin(Math.PI * t);
    });
    v.x = to.x;
    v.y = to.y;
    v.z = 0;
    sfx.move();
    this.dust(to.x, to.y, 6);
    await this.squash(v);
  }

  private squash(v: Vis) {
    return tween(160, (t) => {
      const w = Math.sin(t * Math.PI * 2) * (1 - t);
      v.sy = 1 - 0.22 * w;
      v.sx = 1 + 0.16 * w;
    });
  }

  private pop(v: Vis) {
    return tween(260, (t) => {
      const s = 1 + 0.45 * (1 - ease.outBack(t));
      v.sx = s;
      v.sy = s;
    });
  }

  // ── частицы ─────────────────────────────────────────────────────────────
  private smash(v: Vis, pc: Piece, n: number) {
    v.dead = true;
    const st = STONE[this.s?.players[pc.owner].color ?? 'red'];
    const cols = [st.base, st.light, st.side, st.hi, st.outline];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.4 + Math.random() * 1.6;
      this.parts.push({
        x: this.X(v.x) + 8 + (Math.random() - 0.5) * 8,
        y: this.Y(v.y) + 8 + (Math.random() - 0.5) * 6,
        z: 4 + Math.random() * 4,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp * 0.6,
        vz: 1.5 + Math.random() * 2.5,
        life: 0,
        max: 700 + Math.random() * 600,
        color: cols[Math.floor(Math.random() * cols.length)],
        size: Math.random() < 0.3 ? 2 : 1,
        ground: true,
      });
    }
    this.vis.delete(v.id);
    this.dust(v.x, v.y, 10);
  }

  private dust(cx: number, cy: number, n: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      this.parts.push({
        x: this.X(cx) + 8 + Math.cos(a) * 5,
        y: this.Y(cy) + 13 + Math.sin(a) * 2,
        z: 0,
        vx: Math.cos(a) * 0.5,
        vy: Math.sin(a) * 0.2,
        vz: 0.3 + Math.random() * 0.4,
        life: 0,
        max: 300 + Math.random() * 250,
        color: Math.random() < 0.5 ? PAL.concrete100 : PAL.concrete300,
        size: 1,
        ground: false,
      });
    }
  }

  private sparkle(cx: number, cy: number, color: string, n: number) {
    for (let i = 0; i < n; i++)
      this.parts.push({
        x: this.X(cx) + 2 + Math.random() * 12,
        y: this.Y(cy) + 2 + Math.random() * 12,
        z: 0,
        vx: (Math.random() - 0.5) * 0.3,
        vy: -0.4 - Math.random() * 0.7,
        vz: 0,
        life: 0,
        max: 500 + Math.random() * 400,
        color,
        size: 1,
        ground: false,
      });
  }

  // ── кадр ────────────────────────────────────────────────────────────────
  private frame(now: number, dt: number) {
    if (!this.el.isConnected) return;
    const g = this.g;
    const s = this.s;
    g.drawImage(this.base(this.flipped), 0, 0);
    if (!s) return;
    const pulse = (Math.sin(now / 180) + 1) / 2;

    // зона расстановки
    if (this.ov.zone) {
      g.fillStyle = withAlpha(PAL.brand500, 0.1 + pulse * 0.06);
      const ys = homeRows(s, this.ov.zone.side).map((y) => this.Y(y));
      for (const y of ys) g.fillRect(M + 0, y, N * CELL, CELL);
      const top = Math.min(...ys);
      g.fillStyle = PAL.brand500;
      g.fillRect(M, top, N * CELL, 1);
      g.fillRect(M, top + 3 * CELL - 1, N * CELL, 1);
    }
    // последний ход
    for (const c of this.ov.lastMove) this.fillCell(c, withAlpha(PAL.amber300, 0.22));
    // ховер
    if (this.hover && this.ov.hoverEnabled) this.fillCell(this.hover, 'rgba(255,255,255,0.16)');

    // барьеры
    for (const e of s.effects)
      if (e.kind === 'barrier') for (const c of e.cells) this.drawBarrier(c, this.barrierDrop.get(`${c.x},${c.y}`) ?? 0);

    // цели перемещения
    for (const c of this.ov.moves) {
      const hx = this.X(c.x);
      const hy = this.Y(c.y);
      const isHover = this.hover && this.hover.x === c.x && this.hover.y === c.y;
      if (isHover) this.fillCell(c, withAlpha(PAL.amber300, 0.35));
      px(g, hx + 6, hy + 6, PAL.slab700, 4, 4);
      px(g, hx + 7, hy + 7, PAL.amber500, 2, 2);
      px(g, hx + 6, hy + 10, 'rgba(255,255,255,0.35)', 4, 1);
    }
    // цели атаки
    for (const c of this.ov.attacks) {
      this.fillCell(c, withAlpha(PAL.brand500, 0.18 + pulse * 0.22));
      this.brackets(c, PAL.brand500, Math.round(pulse));
    }
    // варианты выбора (карты, повышение)
    for (const c of this.ov.options) {
      const col = this.ov.optionsTone === 'brand' ? PAL.brand500 : PAL.amber300;
      this.fillCell(c, this.ov.optionsTone === 'brand' ? withAlpha(PAL.brand500, 0.12 + pulse * 0.18) : withAlpha(PAL.amber300, 0.1 + pulse * 0.18));
      this.brackets(c, col, Math.round(pulse));
    }

    // тени и фигуры (сортировка по y для перекрытия)
    // сортировка по экранной высоте: при повороте поля дальний ряд — с большим y
    const list = [...this.vis.values()].sort((a, b) => this.Y(a.y) - this.Y(b.y) || a.z - b.z);
    for (const v of list) {
      // у треугольника тень на земле торчит из-под острия грязной полосой — только в прыжке
      if (v.rank === Rank.Triangle && v.z < 1) continue;
      const bx = this.X(v.x);
      const by = this.Y(v.y);
      const shrink = Math.max(0.4, 1 - v.z / 30);
      g.fillStyle = withAlpha(PAL.void, 0.35 * v.alpha * shrink);
      const sw = Math.round(12 * shrink);
      g.fillRect(Math.round(bx + 8 - sw / 2), Math.round(by + 13), sw, 2);
      g.fillRect(Math.round(bx + 8 - sw / 2 + 1), Math.round(by + 15), sw - 2, 1);
    }
    for (const v of list) this.drawPiece(v, s, pulse);

    // ghost при расстановке
    if (this.ov.ghost) {
      const gh = this.ov.ghost;
      g.globalAlpha = 0.45 + pulse * 0.2;
      g.drawImage(pieceSprite(gh.rank, s.players[gh.owner].color, this.faceUp(gh.owner, s)), this.X(gh.pos.x), this.Y(gh.pos.y));
      g.globalAlpha = 1;
    }

    // выделение
    if (this.ov.selected !== null) {
      const v = this.vis.get(this.ov.selected);
      if (v) this.brackets({ x: v.x, y: v.y }, PAL.amber300, Math.round(pulse), true);
    }

    // луч Линии смерти
    if (this.beam) {
      const b = this.beam;
      const x0 = this.X(b.x);
      const w = b.t < 0.5 ? Math.floor(2 + b.t * 24) : CELL;
      const flick = Math.random() < 0.5 ? PAL.brand500 : PAL.amber300;
      g.fillStyle = withAlpha(PAL.brand500, 0.25 + Math.random() * 0.2);
      g.fillRect(x0 - 3, M, CELL + 6, N * CELL);
      g.fillStyle = flick;
      g.fillRect(x0 + Math.floor((CELL - w) / 2), M, w, N * CELL);
      g.fillStyle = PAL.amber100;
      g.fillRect(x0 + 7, M, 2, N * CELL);
      if (Math.random() < 0.6) this.sparkle(b.x, Math.floor(Math.random() * N), PAL.amber300, 1);
    }

    this.drawParticles(dt);
  }

  private drawPiece(v: Vis, s: GameState, pulse: number) {
    const g = this.g;
    const color = s.players[v.owner].color;
    const up = this.faceUp(v.owner, s);
    const sprite = pieceSprite(v.rank, color, up);
    const w = CELL * v.sx;
    const h = CELL * v.sy;
    const bx = this.X(v.x) + (CELL - w) / 2;
    const by = this.Y(v.y) + (CELL - h) - v.z + 1;
    const pc = s.pieces.find((q) => q.id === v.id);
    const dim = pc && s.phase === 'play' && pc.owner === s.current && pc.acted && !s.pending;
    g.globalAlpha = v.alpha;
    g.drawImage(sprite, Math.round(bx), Math.round(by), Math.round(w), Math.round(h));
    if (dim) {
      g.globalAlpha = 0.4 * v.alpha;
      g.drawImage(pieceSprite(v.rank, 'black', up), Math.round(bx), Math.round(by), Math.round(w), Math.round(h));
    }
    if (v.flash > 0) {
      g.globalAlpha = v.flash;
      g.drawImage(pieceSprite(v.rank, color, up, 'flash'), Math.round(bx), Math.round(by), Math.round(w), Math.round(h));
      v.flash = Math.max(0, v.flash - 0.08);
    }
    g.globalAlpha = 1;
    // отложенное повышение — мигающая стрелка
    if (pc?.promoteNextTurn && pulse > 0.4) {
      const ax = this.X(v.x) + 6;
      const ay = this.Y(v.y) - 3;
      px(g, ax + 1, ay, PAL.amber300, 2, 1);
      px(g, ax, ay + 1, PAL.amber300, 4, 1);
      px(g, ax + 1, ay + 2, PAL.amber500, 2, 2);
    }
  }

  private drawBarrier(c: Pos, drop: number) {
    const g = this.g;
    const x = this.X(c.x);
    const y = this.Y(c.y) - Math.round(drop * 40);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(x + 1, this.Y(c.y) + 12, 14, 3);
    g.fillStyle = PAL.concrete500;
    g.fillRect(x + 1, y + 2, 14, 13);
    g.fillStyle = PAL.concrete400;
    g.fillRect(x + 1, y + 1, 14, 10);
    g.fillStyle = PAL.concrete300;
    g.fillRect(x + 1, y + 1, 14, 1);
    // предупреждающие полосы
    for (let i = 0; i < 14; i += 4) {
      g.fillStyle = PAL.amber500;
      g.fillRect(x + 1 + i, y + 4, 2, 3);
      g.fillStyle = PAL.void;
      g.fillRect(x + 3 + i, y + 4, 2, 3);
    }
    g.fillStyle = PAL.void;
    g.fillRect(x, y + 1, 1, 14);
    g.fillRect(x + 15, y + 1, 1, 14);
    g.fillRect(x + 1, y + 15, 14, 1);
  }

  private drawParticles(dt: number) {
    const g = this.g;
    const k = dt / 16.7;
    this.parts = this.parts.filter((p) => (p.life += dt) < p.max);
    for (const p of this.parts) {
      p.x += p.vx * k;
      p.y += p.vy * k;
      p.z += p.vz * k;
      if (p.ground) {
        p.vz -= 0.25 * k;
        if (p.z < 0) {
          p.z = 0;
          p.vz *= -0.35;
          p.vx *= 0.6;
          p.vy *= 0.6;
        }
      } else {
        p.vx *= 0.96;
      }
      const fade = 1 - p.life / p.max;
      g.globalAlpha = Math.min(1, fade * 2);
      g.fillStyle = p.color;
      g.fillRect(Math.round(p.x), Math.round(p.y - p.z), p.size, p.size);
    }
    g.globalAlpha = 1;
  }

  private fillCell(c: Pos, color: string) {
    this.g.fillStyle = color;
    this.g.fillRect(this.X(c.x), this.Y(c.y), CELL, CELL);
  }

  private brackets(c: Pos, color: string, off: number, big = false) {
    const g = this.g;
    const x = this.X(c.x) - (big ? 1 + off : off);
    const y = this.Y(c.y) - (big ? 1 + off : off);
    const s = CELL + (big ? 2 + off * 2 : off * 2);
    const L = 4;
    g.fillStyle = PAL.void;
    for (const [dx, dy] of [[1, 1]]) {
      g.fillRect(x + dx, y + dy, L, 1);
      g.fillRect(x + dx, y + dy, 1, L);
      g.fillRect(x + s - L + dx, y + dy, L, 1);
      g.fillRect(x + s - 1 + dx, y + dy, 1, L);
      g.fillRect(x + dx, y + s - 1 + dy, L, 1);
      g.fillRect(x + dx, y + s - L + dy, 1, L);
      g.fillRect(x + s - L + dx, y + s - 1 + dy, L, 1);
      g.fillRect(x + s - 1 + dx, y + s - L + dy, 1, L);
    }
    g.fillStyle = color;
    g.fillRect(x, y, L, 1);
    g.fillRect(x, y, 1, L);
    g.fillRect(x + s - L, y, L, 1);
    g.fillRect(x + s - 1, y, 1, L);
    g.fillRect(x, y + s - 1, L, 1);
    g.fillRect(x, y + s - L, 1, L);
    g.fillRect(x + s - L, y + s - 1, L, 1);
    g.fillRect(x + s - 1, y + s - L, 1, L);
  }

  isBarrierCell(p: Pos) {
    return !!this.s && isBarrier(this.s, p);
  }
}
