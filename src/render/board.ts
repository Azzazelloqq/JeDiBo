// BoardView: низкорезный канвас поля (212×212), масштабируемый целиком.
// Получает состояние + события движка, проигрывает анимации и рисует подсказки.
import { ksfx } from '../audio/karmaSfx';
import { sfx } from '../audio/sfx';
import { canAct, forward, homeRows, isBarrier } from '../core/rules';
import { Rank, type CardId, type GameEvent, type GameState, type Piece, type PlayerId, type PlayerState, type Pos, type Side } from '../core/types';
import { PAL, STONE } from './palette';
import { makeCanvas, px, tinyText, tinyWidth, withAlpha, type Canvas } from './pixel';
import { CELL, cellTile, pieceSprite } from './sprites';
import { animSpeed, ease, onFrame, tween, wait } from './tween';
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

interface Seat {
  color: PlayerState['color'];
  side: Side;
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

/** Слой эффекта: рисуется каждый кадр, пока его не снимут; under — под фигурами. */
interface Layer {
  draw: (now: number) => void;
  under: boolean;
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
  /** Разведка (как в Balatro): ходы и атаки фигуры под курсором — своей или чужой. foe — фигура соперника смотрящего. */
  preview: { id: number; moves: Pos[]; attacks: Pos[]; foe: boolean } | null;
  /** Обучение: светлыми остаются только эти клетки, остальное поле притушено. null — без притушения. */
  focus?: Pos[] | null;
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
  /** Цвет и сторона игроков, какими их видит зритель. Движок меняет состояние сразу, а «Смена поля»
   *  должна случиться на поле только в своей анимации — после «Принять», поэтому их не читаем из живого `s`. */
  private seats: Seat[] = [];
  private hover: Pos | null = null;
  private beam: { x: number; t: number } | null = null;
  /** Линия смерти «прочёсывает» поле: pos — экранный столбец (дробный), lock — вспышки на выбранном столбце */
  private scan: { pos: number; lock: number } | null = null;
  private barrierDrop = new Map<string, number>();
  private layers: Layer[] = [];
  /** Карта, чьи события сейчас проигрываются: от неё зависит «почерк» появления, смерти, смены ранга.
   *  game.ts ставит её на розыгрыш карты и на ответы на её вопросы. */
  cardCtx: CardId | null = null;
  private unsub: () => void;
  scale = 3;
  /** Обучение: Линия смерти сначала «замирает» на этом столбце и лишь потом щёлкает на выбранный */
  columnTease: number | null = null;
  /** Чьими глазами смотрим: его сторона всегда внизу (сторона 1 — поле повёрнуто на 180°). null — без поворота. */
  viewer: PlayerId | null = null;
  ov: Overlay = { selected: null, moves: [], attacks: [], options: [], optionsTone: 'amber', lastMove: [], zone: null, ghost: null, hoverEnabled: true, preview: null };
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
    return this.viewer !== null && this.seat(this.viewer)?.side === 1;
  }
  private seat(p: PlayerId): Seat | undefined {
    return this.seats[p] ?? this.s?.players[p];
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
    return forward((this.seat(owner) ?? s.players[owner]).side) < 0 !== this.flipped;
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
    this.seats = s.players.map((p) => ({ color: p.color, side: p.side }));
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

  /** Дождаться, пока улягутся обломки удара и всплывающий текст (не дольше maxMs). */
  async settle(maxMs = 1000) {
    const end = performance.now() + maxMs;
    const busy = () => this.beam || this.scan || this.layers.length || this.parts.some((p) => !p.ground || p.z > 0.5) || document.querySelector('.float-text');
    while (busy() && performance.now() < end) await new Promise((r) => setTimeout(r, 50));
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
        if (e.forced && this.cardCtx === 'retreat') await this.retreat(v, e.to);
        else if (e.forced && this.cardCtx === 'betrayal') await this.puppet(v, e.to);
        else await this.hop(v, e.to, e.forced ? 0.7 : 1, e.jump);
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
        if (e.cause === 'doubleDeath' || e.cause === 'doubleDeathEnemy') return this.reap(v, e.victim);
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
        if (this.cardCtx === 'gift') return this.giftSpawn(v);
        if (this.cardCtx === 'freshBlood') return this.bloodSpawn(v);
        if (this.cardCtx === 'resurrection') return this.holySpawn(v);
        if (this.cardCtx === 'immortal') return this.soulSpawn(v);
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
        if (this.cardCtx === 'careerUp') return this.liftUp(v, e.to);
        if (this.cardCtx === 'careerDown' || this.cardCtx === 'devaluation')
          return this.pressDown(v, e.to, this.cardCtx === 'devaluation' ? PAL.brand500 : PAL.bone);
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
        if (this.cardCtx === 'spy') return this.turncoat(v, e.to);
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
        // игроки пересаживаются: каждая армия со своим цветом и направлением достаётся другому игроку
        const swap = () => {
          this.seats.reverse();
          for (const v of this.vis.values()) v.owner = v.owner === 0 ? 1 : 0;
        };
        // стороны зрителя меняются местами — значит, поле повернётся на 180°
        if (this.viewer !== null && this.el.isConnected) {
          // поле поворачивается к зрителю его новой армией; в конце поворота подменяем картинку тем же видом без поворота
          const spin = this.canvas.animate(
            [{ transform: 'rotate(0deg) scale(1)' }, { transform: 'rotate(90deg) scale(0.72)' }, { transform: 'rotate(180deg) scale(1)' }],
            { duration: 620 / animSpeed(), easing: 'ease-in-out', fill: 'forwards' },
          );
          await spin.finished.catch(() => {});
          swap();
          this.frame(performance.now(), 0);
          spin.cancel();
        } else swap();
        await wait(200);
        return;
      }
      case 'column': {
        const screen = (x: number) => (this.flipped ? N - 1 - x : x);
        const target = screen(e.x);
        const tease = this.columnTease === null ? null : screen(this.columnTease);
        this.columnTease = null;
        if (tease === null) {
          // линия проходит всё поле слева направо, возвращается и замирает на выбранном столбце
          const dist = N - 1 + (N - 1 - target);
          this.scan = { pos: 0, lock: 0 };
          let lastCol = -1;
          await tween(900 + dist * 25, (t) => {
            const d = ease.outCubic(t) * dist;
            const pos = d <= N - 1 ? d : 2 * (N - 1) - d;
            if (this.scan) this.scan.pos = pos;
            const col = Math.round(pos);
            if (col !== lastCol) {
              lastCol = col;
              sfx.tick();
            }
          });
        } else {
          // обучение: барабан щёлкает по столбцам, каждый щелчок дольше предыдущего. Подходит к выбранному
          // столбцу через «столбец-приманку» — дольше всех стоит на нём (сердцебиение) и последним щелчком переходит
          const dir = Math.sign(target - tease) || 1;
          const far = dir > 0 ? N - 1 : 0;
          const path: number[] = [];
          for (let c = far; c !== N - 1 - far; c -= dir) path.push(c);
          path.push(N - 1 - far);
          for (let c = N - 1 - far + dir; c !== target + dir; c += dir) path.push(c);
          const K = 1.2;
          let delay = 620 / K ** (path.length - 2);
          this.scan = { pos: path[0], lock: 0 };
          for (let i = 1; i < path.length; i++) {
            const from = path[i - 1];
            const to = path[i];
            const slide = Math.min(110, delay * 0.45);
            await tween(slide, (t) => this.scan && (this.scan.pos = from + (to - from) * ease.outCubic(t)));
            sfx.tick();
            if (to === tease) sfx.heartbeat();
            if (i < path.length - 1) await wait(Math.max(0, delay - slide));
            delay *= K;
          }
        }
        sfx.stamp();
        await tween(360, (t) => this.scan && (this.scan.lock = t));
        this.scan = null;
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
        // от упавших плит по полу расходится пыльная волна
        ksfx.dustWave();
        await this.layer(320, (t) => {
          const xs = e.cells.map((c) => this.X(c.x));
          const ys = e.cells.map((c) => this.Y(c.y));
          const r = Math.round(2 + t * 7);
          this.rectRing(Math.min(...xs) - r, Math.min(...ys) - r, Math.max(...xs) + CELL + r, Math.max(...ys) + CELL + r, withAlpha(PAL.amber300, 0.7 * (1 - t)));
        });
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
    // Блицкриг: фигура-исполнитель оставляет за собой шлейф отражений
    const blitz = this.s?.effects.some((q) => q.kind === 'blitz' && !q.done && q.owner === v.owner && (q.pieceId === null || q.pieceId === v.id));
    const trail: { x: number; y: number; z: number }[] = [];
    const stopTrail = blitz
      ? this.persist(() => {
          trail.push({ x: v.x, y: v.y, z: v.z });
          if (trail.length > 7) trail.shift();
          const sprite = pieceSprite(v.rank, this.seat(v.owner)?.color ?? 'red', this.s ? this.faceUp(v.owner, this.s) : true);
          trail.forEach((q, i) => {
            this.g.globalAlpha = 0.08 * i;
            this.g.drawImage(sprite, Math.round(this.X(q.x)), Math.round(this.Y(q.y) - q.z + 1));
          });
          this.g.globalAlpha = 1;
        }, true)
      : null;
    if (blitz) ksfx.dash();
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
    if (blitz) this.sparkle(to.x, to.y, PAL.amber300, 6);
    await this.squash(v);
    stopTrail?.();
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

  // ── Карты Кармы: слои эффектов ──────────────────────────────────────────
  /** Повесить рисовалку на каждый кадр; вернёт функцию «снять». */
  private persist(draw: (now: number) => void, under = false): () => void {
    const L: Layer = { draw, under };
    this.layers.push(L);
    return () => (this.layers = this.layers.filter((q) => q !== L));
  }

  /** Слой на время dur: draw получает прогресс 0..1. Время идёт по твинам — не зависит от того, виден ли канвас. */
  private layer(dur: number, draw: (t: number, now: number) => void, under = false): Promise<void> {
    let t = 0;
    const off = this.persist((now) => draw(t, now), under);
    return tween(dur, (k) => (t = k)).then(off);
  }

  private line(x0: number, y0: number, x1: number, y1: number, color: string, w = 1) {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    this.g.fillStyle = color;
    for (;;) {
      this.g.fillRect(x0, y0, w, w);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  private rectRing(x0: number, y0: number, x1: number, y1: number, color: string) {
    const g = this.g;
    g.fillStyle = color;
    g.fillRect(x0, y0, x1 - x0, 1);
    g.fillRect(x0, y1 - 1, x1 - x0, 1);
    g.fillRect(x0, y0, 1, y1 - y0);
    g.fillRect(x1 - 1, y0, 1, y1 - y0);
  }

  /** Пиксельный эллипс-кольцо на полу (rx×ry); dots — пунктир, spin — его вращение. */
  private groundRing(cx: number, cy: number, rx: number, ry: number, color: string, dots = 0, spin = 0) {
    const n = Math.max(12, Math.round(rx * 5));
    this.g.fillStyle = color;
    for (let i = 0; i < n; i++) {
      if (dots && (i + Math.floor(spin)) % dots !== 0) continue;
      const a = (i / n) * Math.PI * 2;
      this.g.fillRect(Math.round(cx + Math.cos(a) * rx), Math.round(cy + Math.sin(a) * ry), 1, 1);
    }
  }

  /** Шеврон 5×3 с тёмной подложкой (читается и на светлых плитах, и на фигурах): dir −1 смотрит вверх, 1 — вниз. */
  private chevron(x: number, y: number, dir: 1 | -1, color: string) {
    const g = this.g;
    const r = (i: number) => (dir < 0 ? i : 2 - i);
    const mark = (dx: number, dy: number) => {
      g.fillRect(x + dx + 2, y + dy + r(0), 1, 1);
      g.fillRect(x + dx + 1, y + dy + r(1), 1, 1);
      g.fillRect(x + dx + 3, y + dy + r(1), 1, 1);
      g.fillRect(x + dx, y + dy + r(2), 1, 1);
      g.fillRect(x + dx + 4, y + dy + r(2), 1, 1);
    };
    g.fillStyle = withAlpha(PAL.void, 0.75);
    mark(0, 1);
    mark(1, 0);
    g.fillStyle = color;
    mark(0, 0);
  }

  private emit(n: number, f: (i: number) => Partial<Particle> & { x: number; y: number }) {
    for (let i = 0; i < n; i++)
      this.parts.push({ z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 600, color: PAL.bone, size: 1, ground: false, ...f(i) });
  }

  private confetti(cx: number, cy: number, n: number, colors: string[], power = 1) {
    this.emit(n, () => {
      const a = Math.random() * Math.PI * 2;
      const sp = (0.3 + Math.random() * 1.3) * power;
      return {
        x: cx + (Math.random() - 0.5) * 6,
        y: cy + (Math.random() - 0.5) * 4,
        z: 4,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp * 0.6,
        vz: (2 + Math.random() * 2.5) * power,
        max: 800 + Math.random() * 600,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: Math.random() < 0.35 ? 2 : 1,
        ground: true,
      };
    });
  }

  private smoke(cx: number, cy: number, n: number, colors: string[]) {
    this.emit(n, () => ({
      x: cx + (Math.random() - 0.5) * 10,
      y: cy + (Math.random() - 0.5) * 6,
      vx: (Math.random() - 0.5) * 0.5,
      vy: -0.25 - Math.random() * 0.45,
      max: 500 + Math.random() * 500,
      color: colors[Math.floor(Math.random() * colors.length)],
      size: Math.random() < 0.5 ? 2 : 1,
    }));
  }

  // ── появление фигуры ──
  /** Подарок: коробка с бантом падает, вздрагивает и лопается конфетти, внутри — Круг. */
  private async giftSpawn(v: Vis) {
    v.alpha = 0;
    this.vis.set(v.id, v);
    let z = 56, wob = 0, lid = 0;
    const off = this.persist(() => this.drawGift(v, z, wob, lid));
    ksfx.giftFall();
    await tween(440, (t) => (z = 56 * (1 - ease.outBounce(t))));
    this.dust(v.x, v.y, 8);
    ksfx.giftRattle();
    await tween(300, (t) => (wob = Math.sin(t * Math.PI * 5) * (1 - t * 0.5)));
    await tween(90, (t) => (lid = t));
    off();
    ksfx.giftPop();
    shake(3);
    this.confetti(this.X(v.x) + 8, this.Y(v.y) + 8, 30, [PAL.amber300, PAL.amber100, PAL.brand500, PAL.patina300, PAL.bone], 1.1);
    v.alpha = 1;
    v.flash = 1;
    await this.pop(v);
  }

  private drawGift(v: Vis, z: number, wob: number, lid: number) {
    const g = this.g;
    const x = this.X(v.x) + 3 + Math.round(wob * 1.5);
    const base = this.Y(v.y) + 14;
    g.fillStyle = withAlpha(PAL.void, 0.35 * Math.max(0.4, 1 - z / 40));
    g.fillRect(this.X(v.x) + 3, base - 1, 10, 2);
    const y = Math.round(base - 8 - z);
    // короб
    px(g, x - 1, y - 1, PAL.void, 12, 10);
    px(g, x, y, PAL.amber500, 10, 8);
    px(g, x, y, PAL.amber300, 10, 1);
    px(g, x, y, PAL.amber300, 1, 8);
    px(g, x + 9, y + 1, PAL.amber700, 1, 7);
    px(g, x, y + 7, PAL.amber700, 10, 1);
    px(g, x + 4, y, PAL.brand500, 2, 8);
    // крышка с бантом — в момент «пах» отлетает вверх
    const ly = y - 3 - Math.round(lid * 6);
    px(g, x - 2, ly - 1, PAL.void, 14, 5);
    px(g, x - 1, ly, PAL.amber300, 12, 3);
    px(g, x - 1, ly + 2, PAL.amber500, 12, 1);
    px(g, x + 4, ly, PAL.brand500, 2, 3);
    px(g, x + 2, ly - 2, PAL.brand500, 2, 2);
    px(g, x + 6, ly - 2, PAL.brand500, 2, 2);
    px(g, x + 2, ly - 2, PAL.brand400, 1, 1);
  }

  /** Свежая кровь: тяжёлая капля падает, брызги и лужа, фигура вырастает из неё. */
  private async bloodSpawn(v: Vis) {
    v.alpha = 0;
    v.sy = 0.05;
    this.vis.set(v.id, v);
    const cx = this.X(v.x) + 8;
    const floor = this.Y(v.y) + 13;
    let z = 90;
    const off = this.persist(() => {
      const y = Math.round(floor - 4 - z);
      const g = this.g;
      px(g, cx - 1, y - 8, withAlpha(PAL.granite500, 0.4), 1, 6);
      px(g, cx - 1, y - 2, PAL.granite400, 1, 2);
      px(g, cx - 2, y, PAL.granite500, 3, 3);
      px(g, cx - 1, y + 3, PAL.granite600, 1, 1);
      px(g, cx - 2, y, PAL.brand100, 1, 1);
    });
    ksfx.dropFall();
    await tween(260, (t) => (z = 90 * (1 - ease.inCubic(t))));
    off();
    ksfx.splat();
    shake(3);
    this.confetti(cx, floor - 2, 18, [PAL.granite500, PAL.granite400, PAL.brand500, PAL.granite700], 0.8);
    // лужа расползается и медленно уходит в камень
    void this.layer(900, (t) => {
      const r = 2 + ease.outCubic(Math.min(1, t * 3)) * 6;
      const a = t < 0.4 ? 0.85 : 0.85 * (1 - (t - 0.4) / 0.6);
      this.g.fillStyle = withAlpha(PAL.granite700, a);
      for (let yy = -2; yy <= 2; yy++) {
        const w = Math.round(r * Math.sqrt(1 - (yy / 2.6) ** 2));
        this.g.fillRect(Math.round(cx - w), floor + yy, w * 2, 1);
      }
      this.groundRing(cx, floor, r + 1, (r + 1) / 2.6, withAlpha(PAL.granite500, a));
    }, true);
    v.alpha = 1;
    v.flash = 1;
    ksfx.bloodGrow();
    await tween(340, (t) => {
      v.sy = 0.05 + 0.95 * ease.outBack(t);
      v.sx = 1.35 - 0.35 * ease.outCubic(t);
    });
    v.sx = v.sy = 1;
  }

  /** Воскрешение: с неба бьёт столп света, фигура медленно опускается в нём на кольцо рун. */
  private async holySpawn(v: Vis) {
    v.alpha = 0;
    v.z = 26;
    this.vis.set(v.id, v);
    ksfx.holyPillar();
    const cx = this.X(v.x) + 8;
    const floor = this.Y(v.y) + 13;
    const pillar = this.layer(1150, (t, now) => {
      const g = this.g;
      const w = t < 0.18 ? (t / 0.18) * 12 : t > 0.78 ? ((1 - t) / 0.22) * 12 : 12;
      const half = Math.round(w / 2);
      if (half <= 0) return;
      g.fillStyle = withAlpha(PAL.amber300, 0.22);
      g.fillRect(cx - half - 2, M, half * 2 + 4, floor - M);
      g.fillStyle = withAlpha(PAL.amber100, 0.55);
      g.fillRect(cx - half, M, half * 2, floor - M);
      const core = Math.max(1, half - 3);
      g.fillStyle = withAlpha(PAL.bone, 0.85);
      g.fillRect(cx - core, M, core * 2, floor - M);
      this.groundRing(cx, floor, 9, 3.5, PAL.amber300, 3, now / 60);
      this.groundRing(cx, floor, 6, 2.3, withAlpha(PAL.amber100, 0.8), 2, -now / 90);
      if (Math.random() < 0.5)
        this.emit(1, () => ({ x: cx - 5 + Math.random() * 10, y: floor - Math.random() * 6, vy: -0.6 - Math.random() * 0.5, color: Math.random() < 0.5 ? PAL.bone : PAL.amber100 }));
    }, true);
    await wait(220);
    await tween(680, (t) => {
      v.z = 26 * (1 - ease.outCubic(t));
      v.alpha = Math.min(1, t * 2);
    });
    v.flash = 1;
    ksfx.holyLand();
    this.dust(v.x, v.y, 6);
    await pillar;
  }

  /** Бессмертие: души погибшей фигуры слетаются по спирали и собирают её заново. */
  private async soulSpawn(v: Vis) {
    v.alpha = 0;
    this.vis.set(v.id, v);
    ksfx.soulSwirl();
    const cx = this.X(v.x) + 8;
    const cy = this.Y(v.y) + 8;
    const motes = Array.from({ length: 16 }, () => ({ a: Math.random() * Math.PI * 2, r: 18 + Math.random() * 16, d: Math.random() * 0.25 }));
    await this.layer(720, (t) => {
      for (const m of motes) {
        const k = Math.min(1, Math.max(0, (t - m.d) / (1 - m.d)));
        const r = m.r * (1 - ease.inCubic(k));
        const a = m.a + k * 4;
        const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r * 0.7);
        px(this.g, Math.round(cx + Math.cos(a - 0.35) * r * 1.08), Math.round(cy + Math.sin(a - 0.35) * r * 0.75), PAL.patina500, 1, 1);
        // тёмная подложка — душа видна и на светлых плитах
        px(this.g, x, y + 1, withAlpha(PAL.void, 0.6), 2, 1);
        px(this.g, x, y, k > 0.85 ? PAL.bone : PAL.patina300, 2, 1);
      }
      // ядро разгорается
      const s = Math.round(t * 4);
      if (s) px(this.g, cx - s, cy - s, withAlpha(PAL.patina300, 0.35 * t), s * 2, s * 2);
    });
    ksfx.soulForm();
    v.alpha = 1;
    v.flash = 1;
    this.sparkle(v.x, v.y, PAL.patina300, 14);
    void this.layer(300, (t) => this.groundRing(cx, cy + 5, 4 + t * 10, (4 + t * 10) / 2.4, withAlpha(PAL.patina300, 1 - t)), true);
    await this.pop(v);
  }

  // ── смерть ──
  /** Двойная смерть: прицел стягивается на фигуре, крест-накрест удар косой, дым. */
  private async reap(v: Vis, victim: Piece) {
    ksfx.lockOn();
    await this.layer(300, (t) => this.brackets({ x: v.x, y: v.y }, PAL.brand500, Math.round((1 - ease.outCubic(t)) * 9), true));
    const x0 = this.X(v.x), y0 = this.Y(v.y);
    const cut = (t: number, second: number) => {
      const k = Math.min(1, Math.max(0, t * 2 - second));
      if (!k) return;
      const [sx, sy, ex, ey] = second ? [x0 + 15, y0 - 1, x0, y0 + 14] : [x0, y0 - 1, x0 + 15, y0 + 14];
      this.line(sx - 1, sy, sx + (ex - sx) * k - 1, sy + (ey - sy) * k, PAL.brand500, 2);
      this.line(sx, sy, sx + (ex - sx) * k, sy + (ey - sy) * k, PAL.bone);
    };
    ksfx.slash();
    await this.layer(170, (t) => {
      this.brackets({ x: v.x, y: v.y }, PAL.brand500, 0, true);
      cut(t, 0);
      cut(t, 1);
    });
    shake(6);
    ksfx.reapBreak();
    void this.layer(320, (t) => {
      this.g.globalAlpha = 1 - t;
      cut(1, 0);
      cut(1, 1);
      this.g.globalAlpha = 1;
    });
    this.smash(v, victim, 16);
    this.smoke(x0 + 8, y0 + 8, 10, [PAL.void, PAL.slab600, PAL.brand800]);
    await wait(140);
  }

  // ── ранг ──
  /** Карьерный лифт вверх: столб света с бегущими вверх шевронами поднимает фигуру, наверху она перерождается. */
  private async liftUp(v: Vis, to: Rank) {
    ksfx.liftRise();
    const cx = this.X(v.x) + 8;
    const floor = this.Y(v.y) + 14;
    const column = this.layer(820, (t) => {
      const fade = t < 0.15 ? t / 0.15 : t > 0.8 ? (1 - t) / 0.2 : 1;
      const top = floor - 30;
      this.g.fillStyle = withAlpha(PAL.amber300, 0.18 * fade);
      this.g.fillRect(cx - 7, top, 14, floor - top);
      for (let i = 0; i < 3; i++) {
        const y = Math.round(floor - 4 - ((t * 60 + i * 10) % 30));
        this.chevron(cx - 3, y, -1, withAlpha(PAL.amber100, fade * Math.min(1, 0.3 + (y - top) / 30)));
      }
    }, true);
    await tween(260, (t) => {
      v.z = 10 * ease.outCubic(t);
      v.sy = 1 + 0.2 * Math.sin(Math.PI * t);
      v.sx = 1 - 0.1 * Math.sin(Math.PI * t);
    });
    ksfx.liftDing();
    v.flash = 1;
    v.rank = to;
    this.sparkle(v.x, v.y, PAL.amber300, 12);
    await this.pop(v);
    await tween(180, (t) => (v.z = 10 * (1 - ease.inCubic(t))));
    v.z = 0;
    ksfx.liftLand();
    this.dust(v.x, v.y, 6);
    await Promise.all([this.squash(v), column]);
  }

  /** Понижение (Карьерный лифт вниз, Девальвация): сверху обрушиваются шевроны и вдавливают фигуру. */
  private async pressDown(v: Vis, to: Rank, color: string) {
    const cx = this.X(v.x) + 8;
    const top = this.Y(v.y) - v.z;
    ksfx.pressFall();
    await this.layer(300, (t) => {
      const k = ease.inCubic(t);
      for (let i = 0; i < 3; i++) this.chevron(cx - 3, Math.round(top - 26 * (1 - k) - i * 4), 1, i ? withAlpha(color, 0.6 - i * 0.15) : color);
    });
    ksfx.pressHit(color === PAL.brand500);
    shake(4);
    v.flash = 1;
    v.rank = to;
    this.confetti(cx, this.Y(v.y) + 12, 10, [PAL.concrete300, PAL.concrete500, PAL.void], 0.5);
    this.dust(v.x, v.y, 10);
    void this.layer(260, (t) => {
      for (let i = 0; i < 3; i++) this.chevron(cx - 3 + (i - 1) * 6, Math.round(top + 1 + t * 4), 1, withAlpha(color, 1 - t));
    });
    await tween(360, (t) => {
      const w = Math.sin(t * Math.PI) * (1 - t * 0.6);
      v.sy = 1 - 0.38 * w;
      v.sx = 1 + 0.26 * w;
    });
    v.sx = v.sy = 1;
  }

  // ── хозяин и перемещения ──
  /** Шпион: фигуру охватывают помехи, цвет мерцает между сторонами — и она уже чужая. */
  private async turncoat(v: Vis, to: PlayerId) {
    const from = v.owner;
    const ox = v.x;
    const x0 = this.X(v.x), y0 = this.Y(v.y);
    this.smoke(x0 + 8, y0 + 10, 12, [PAL.void, PAL.slab600, PAL.slab500]);
    const noise = this.persist(() => {
      for (let i = 0; i < 4; i++) {
        const w = 3 + Math.floor(Math.random() * 8);
        const x = x0 + Math.floor(Math.random() * (16 - w)) + (Math.random() < 0.5 ? -2 : 2);
        px(this.g, x, y0 + Math.floor(Math.random() * 16), Math.random() < 0.5 ? PAL.patina300 : PAL.void, w, 1);
      }
    });
    for (let i = 0; i < 7; i++) {
      v.owner = i % 2 ? from : to;
      v.x = ox + (i < 6 ? (i % 2 ? 1 : -1) / CELL : 0);
      ksfx.glitchTick();
      await wait(55 + i * 12);
    }
    noise();
    v.owner = to;
    v.x = ox;
    v.flash = 1;
    ksfx.turnSide();
    this.sparkle(v.x, v.y, PAL.patina300, 12);
    await this.pop(v);
  }

  /** Отступление: фигура отъезжает назад низко, по полу, оставляя пыльный след. */
  private async retreat(v: Vis, to: Pos) {
    const fx = v.x, fy = v.y;
    await tween(90, (t) => {
      v.sx = 1 + 0.1 * t;
      v.sy = 1 - 0.1 * t;
    });
    ksfx.scrape();
    await tween(300, (t) => {
      const e = ease.outCubic(t);
      v.x = fx + (to.x - fx) * e;
      v.y = fy + (to.y - fy) * e;
      v.z = Math.sin(Math.PI * t) * 2;
      if (Math.random() < 0.6)
        this.emit(1, () => ({ x: this.X(v.x) + 3 + Math.random() * 10, y: this.Y(v.y) + 14, vz: 0.4, vx: (Math.random() - 0.5) * 0.3, max: 400, color: Math.random() < 0.5 ? PAL.concrete300 : PAL.concrete100 }));
    });
    v.x = to.x;
    v.y = to.y;
    v.z = 0;
    sfx.move();
    this.dust(to.x, to.y, 5);
    await this.squash(v);
  }

  /** Предательство: сверху опускаются нити кукловода, фигуру поднимают и переставляют, она болтается. */
  private async puppet(v: Vis, to: Pos) {
    ksfx.twang();
    let len = 0;
    const strings = this.persist(() => {
      const bx = this.X(v.x);
      const top = this.Y(v.y) + 2 - v.z;
      const lean = Math.round((v.sx - 1) * 20);
      for (const ax of [bx + 4, bx + 11]) {
        const endY = M + (top - M) * len;
        for (let y = M; y < endY; y += 2) {
          const k = (y - M) / Math.max(1, top - M);
          px(this.g, Math.round(ax + lean * k), y, withAlpha(PAL.brand400, 0.85), 1, 1);
        }
      }
      px(this.g, bx + 3, M - 2, PAL.brand500, 10, 1);
    });
    await tween(180, (t) => (len = t));
    const fx = v.x, fy = v.y;
    ksfx.creak(0.16);
    await tween(160, (t) => (v.z = 9 * ease.outCubic(t)));
    ksfx.creak(0.23);
    ksfx.creak(0.23, 0.23);
    await tween(460, (t) => {
      const e = ease.inOut(t);
      v.x = fx + (to.x - fx) * e;
      v.y = fy + (to.y - fy) * e;
      v.z = 9 + Math.sin(t * Math.PI) * 3;
      v.sx = 1 + Math.sin(t * Math.PI * 4) * 0.08;
    });
    v.x = to.x;
    v.y = to.y;
    v.sx = 1;
    await tween(130, (t) => (v.z = 9 * (1 - ease.inCubic(t))));
    v.z = 0;
    sfx.move();
    this.dust(to.x, to.y, 6);
    void this.squash(v);
    ksfx.twang(true);
    await tween(160, (t) => (len = 1 - t));
    strings();
  }

  // ── розыгрыш карты без событий на поле ──
  /** Эффект на всё поле в момент розыгрыша (после оверлея Кармы). */
  async cast(card: CardId, p: PlayerId) {
    if (!this.s || !this.el.isConnected) return;
    const mine = [...this.vis.values()].filter((v) => !v.dead && v.owner === p);
    const slowed = mine.filter((v) => v.rank !== Rank.Triangle);
    switch (card) {
      case 'blitzkrieg':
        return this.castBlitz(mine);
      case 'depression':
        return this.castRain(slowed);
      case 'snail':
        return this.castSnail(slowed);
      case 'roundProtection':
        return this.castShield(mine.filter((v) => v.rank !== Rank.Circle));
      case 'jumper':
        return this.castJumper(slowed);
    }
  }

  /** Блицкриг: поле прошивают молнии, у всех фигур игрока — искры. */
  private async castBlitz(mine: Vis[]) {
    const W = N * CELL;
    const bolts = Array.from({ length: 3 }, (_, i) => {
      const y0 = M + 20 + i * 62 + Math.random() * 30;
      const pts: [number, number][] = [];
      for (let x = M; x < M + W; x += 6 + Math.random() * 6) pts.push([x, y0 + (Math.random() - 0.5) * 14]);
      pts.push([M + W, y0]);
      return { pts, delay: i * 0.18 };
    });
    ksfx.bolts();
    shake(5);
    await this.layer(700, (t) => {
      const flash = Math.max(0, 1 - t * 4);
      if (flash) {
        this.g.fillStyle = withAlpha(PAL.amber100, 0.3 * flash);
        this.g.fillRect(M, M, W, W);
      }
      for (const b of bolts) {
        const k = (t - b.delay) / 0.45;
        if (k < 0 || k > 1 || Math.floor(k * 10) % 3 === 2) continue;
        const n = Math.ceil(b.pts.length * Math.min(1, k * 2.5));
        for (let i = 1; i < n; i++) {
          const [ax, ay] = b.pts[i - 1], [bx, by] = b.pts[i];
          this.line(ax, ay + 2, bx, by + 2, withAlpha(PAL.void, 0.6));
          this.line(ax, ay - 1, bx, by - 1, PAL.amber300);
          this.line(ax, ay + 1, bx, by + 1, PAL.amber500);
          this.line(ax, ay, bx, by, PAL.bone);
        }
      }
    });
    for (const v of mine) {
      this.sparkle(v.x, v.y, PAL.amber300, 4);
      v.flash = 0.8;
    }
  }

  /** Депрессия: поле темнеет, идёт дождь, над Квадратами и Кругами игрока собираются тучки, фигуры понуро оседают. */
  private async castRain(slowed: Vis[]) {
    const W = N * CELL;
    ksfx.rain();
    // фигуры оседают волной, но вся волна укладывается в дождь: анимация не переживает пачку событий
    const step = Math.min(40, 400 / Math.max(1, slowed.length));
    const sag = slowed.map((v, i) =>
      tween(700, (t) => {
        const w = Math.sin(t * Math.PI);
        v.sy = 1 - 0.16 * w;
        v.sx = 1 + 0.08 * w;
      }, 150 + i * step),
    );
    const rain = this.layer(1300, (t) => {
      const a = Math.sin(t * Math.PI);
      this.g.fillStyle = withAlpha(PAL.void, 0.32 * a);
      this.g.fillRect(M, M, W, W);
      if (t < 0.8)
        this.emit(4, () => ({ x: M + Math.random() * W, y: M + Math.random() * W * 0.6, vx: -0.35, vy: 2.6, max: 260 + Math.random() * 200, color: Math.random() < 0.7 ? PAL.concrete400 : PAL.patina300 }));
      for (const v of slowed) this.drawCloud(this.X(v.x) + 1, this.Y(v.y) - 2 - v.z, Math.min(1, t * 3), Math.floor(t * 20));
    });
    await Promise.all([rain, ...sag]);
  }

  /** Тучка над фигурой (Депрессия): k — непрозрачность, f — кадр капели. */
  private drawCloud(x: number, y: number, k: number, f: number) {
    const g = this.g;
    g.globalAlpha = k;
    px(g, x + 3, y - 1, PAL.slab500, 2, 1);
    px(g, x + 1, y, PAL.slab500, 4, 1);
    px(g, x, y + 1, PAL.slab500, 6, 2);
    px(g, x, y + 3, PAL.slab700, 6, 1);
    px(g, x + 1 + (f % 3) * 2, y + 4 + (f % 2), PAL.patina300, 1, 1);
    g.globalAlpha = 1;
  }

  /** Тихоход: над фигурами раскручиваются спирали, фигуры вязко покачиваются. */
  private async castSnail(slowed: Vis[]) {
    ksfx.snail();
    const wobble = slowed.map((v) =>
      tween(900, (t) => {
        const w = Math.sin(t * Math.PI * 2) * (1 - t);
        v.sx = 1 + 0.14 * w;
        v.sy = 1 - 0.1 * w;
      }),
    );
    await this.layer(950, (t) => {
      for (const v of slowed) {
        const cx = this.X(v.x) + 8, cy = this.Y(v.y) + 8 - v.z;
        const n = 22;
        for (let i = 0; i < n; i++) {
          const k = i / n;
          if (k > t * 1.6) break;
          const a = k * Math.PI * 4 - t * 6;
          const r = 2 + k * 9 * (1 - Math.max(0, t - 0.6) / 0.4);
          px(this.g, Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r * 0.8), withAlpha(PAL.patina300, 1 - k * 0.6), 1, 1);
        }
      }
    });
    await Promise.all(wobble);
  }

  /** Круговая защита: вокруг Треугольников и Квадратов раскрывается щит, искры летят во все 8 сторон. */
  private async castShield(guards: Vis[]) {
    ksfx.shield();
    await this.layer(650, (t) => {
      const k = ease.outCubic(t);
      for (const v of guards) {
        const x0 = this.X(v.x), y0 = this.Y(v.y);
        const r = Math.round(k * 8);
        this.rectRing(x0 - r, y0 - r, x0 + CELL + r, y0 + CELL + r, withAlpha(PAL.amber300, 1 - t));
        for (let d = 0; d < 8; d++) {
          const a = (d / 8) * Math.PI * 2;
          const dist = 4 + k * 14;
          px(this.g, Math.round(x0 + 8 + Math.cos(a) * dist) - 1, Math.round(y0 + 8 + Math.sin(a) * dist) - 1, withAlpha(PAL.amber100, 1 - t * 0.8), 2, 2);
        }
      }
    });
    for (const v of guards) v.flash = 0.7;
  }

  /** Прыгун: фигуры игрока (кроме Треугольников) волной подпрыгивают, как на пружинах. */
  private async castJumper(jumpers: Vis[]) {
    const order = [...jumpers].sort((a, b) => a.x - b.x || a.y - b.y);
    ksfx.boings(order.length);
    await Promise.all(
      order.map((v, i) =>
        tween(300, (t) => {
          v.z = Math.sin(Math.PI * t) * 10;
          v.sy = 1 + 0.18 * Math.sin(Math.PI * t);
          v.sx = 1 - 0.1 * Math.sin(Math.PI * t);
        }, i * 45).then(() => {
          v.z = 0;
          v.sx = v.sy = 1;
          this.dust(v.x, v.y, 4);
        }),
      ),
    );
  }

  /** Пропуск хода: поле на миг гаснет, над фигурами игрока поднимаются «Z». */
  async snooze(p: PlayerId) {
    if (!this.el.isConnected) return;
    const zs = [...this.vis.values()].filter((v) => !v.dead && v.owner === p).map((v) => ({ v, d: Math.random() * 0.4 }));
    ksfx.snooze();
    await this.layer(1100, (t) => {
      this.g.fillStyle = withAlpha(PAL.void, 0.28 * Math.sin(t * Math.PI));
      this.g.fillRect(M, M, N * CELL, N * CELL);
      for (const { v, d } of zs) {
        const k = (t - d) / 0.6;
        if (k < 0 || k > 1) continue;
        const x = this.X(v.x) + 10 + Math.round(Math.sin(k * 6) * 2);
        const y = this.Y(v.y) - Math.round(k * 10);
        this.g.globalAlpha = 1 - k;
        px(this.g, x, y, PAL.bone, 3, 1);
        px(this.g, x + 1, y + 1, PAL.bone, 1, 1);
        px(this.g, x, y + 2, PAL.bone, 3, 1);
        this.g.globalAlpha = 1;
      }
    });
  }

  // ── постоянные отметки действующих эффектов ──
  /** Мелкие знаки на фигурах, пока действует эффект Кармы: тучка (Депрессия), раковина (Тихоход),
   *  бегущие по краю клетки точки (Круговая защита), искры (Блицкриг). */
  private drawAuras(s: GameState, now: number) {
    const g = this.g;
    for (const e of s.effects) {
      if (e.kind === 'barrier' || e.kind === 'jumper') continue;
      for (const v of this.vis.values()) {
        if (v.dead || v.owner !== e.owner || v.alpha < 0.5) continue;
        const x0 = this.X(v.x), y0 = this.Y(v.y) - Math.round(v.z);
        if (e.kind === 'depression' && v.rank !== Rank.Triangle) this.drawCloud(x0 + 1, y0 - 2, 0.9, Math.floor(now / 160));
        else if (e.kind === 'snail' && v.rank !== Rank.Triangle) {
          // раковина 5×4 в правом верхнем углу
          const x = x0 + 11, y = y0 - 1;
          px(g, x, y, PAL.patina700, 5, 4);
          px(g, x + 1, y, PAL.patina300, 3, 1);
          px(g, x, y + 1, PAL.patina300, 1, 2);
          px(g, x + 4, y + 1, PAL.patina300, 1, 2);
          px(g, x + 2, y + 2, PAL.patina300, 1, 1);
          px(g, x + 1, y + 3, PAL.patina500, 4, 1);
        } else if (e.kind === 'roundProtection' && v.rank !== Rank.Circle) {
          // две «кометы» бегут по краю клетки: щит смотрит во все стороны
          const at = (p: number) => {
            const q = ((p % 56) + 56) % 56;
            return q < 14 ? [q, 0] : q < 28 ? [14, q - 14] : q < 42 ? [42 - q, 14] : [0, 56 - q];
          };
          for (const k of [0, 28]) {
            const head = Math.floor(now / 55) + k;
            const tail = [3, 2, 1, 0].map((i) => ({ i, p: at(head - i * 2) }));
            for (const { p } of tail) px(g, x0 + p[0] - 1, this.Y(v.y) + p[1] - 1, withAlpha(PAL.void, 0.35), 4, 4);
            for (const { i, p } of tail) px(g, x0 + p[0], this.Y(v.y) + p[1], i ? withAlpha(PAL.amber500, 1 - i * 0.25) : PAL.amber100, 2, 2);
          }
        } else if (e.kind === 'blitz' && !e.done && e.pieceId === v.id && Math.random() < 0.12) {
          this.emit(1, () => ({ x: x0 + 2 + Math.random() * 12, y: y0 + 4 + Math.random() * 8, vy: -0.8, vx: (Math.random() - 0.5) * 0.6, max: 300, color: Math.random() < 0.5 ? PAL.amber300 : PAL.bone }));
        }
      }
    }
  }

  // ── частицы ─────────────────────────────────────────────────────────────
  private smash(v: Vis, pc: Piece, n: number) {
    v.dead = true;
    const st = STONE[this.seat(pc.owner)?.color ?? 'red'];
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
    for (const L of this.layers) if (L.under) L.draw(now);

    // разведка: куда может пойти и кого бьёт фигура под курсором (своя — янтарь, чужая — красный)
    const pv = this.ov.preview;
    if (pv) {
      const dot = pv.foe ? PAL.brand500 : PAL.amber300;
      for (const c of pv.moves) {
        const hx = this.X(c.x);
        const hy = this.Y(c.y);
        this.fillCell(c, withAlpha(dot, 0.14));
        px(g, hx + 6, hy + 6, PAL.void, 4, 4);
        px(g, hx + 7, hy + 7, dot, 2, 2);
      }
      for (const c of pv.attacks) this.fillCell(c, withAlpha(PAL.brand500, 0.16 + pulse * 0.12));
    }

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
    this.drawAuras(s, now);

    // ghost при расстановке
    if (this.ov.ghost) {
      const gh = this.ov.ghost;
      g.globalAlpha = 0.45 + pulse * 0.2;
      g.drawImage(pieceSprite(gh.rank, (this.seat(gh.owner) ?? s.players[gh.owner]).color, this.faceUp(gh.owner, s)), this.X(gh.pos.x), this.Y(gh.pos.y));
      g.globalAlpha = 1;
    }

    // обучение: всё, кроме нужных клеток, уходит в тень
    if (this.ov.focus) {
      const lit = new Set(this.ov.focus.map((c) => `${c.x},${c.y}`));
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!lit.has(`${x},${y}`)) this.fillCell({ x, y }, withAlpha(PAL.void, 0.5));
    }

    // разведка: рамки поверх фигур — под атакой и сама фигура
    if (pv) {
      for (const c of pv.attacks) this.brackets(c, PAL.brand500, 0);
      const v = this.vis.get(pv.id);
      if (v && pv.id !== this.ov.selected) this.brackets({ x: v.x, y: v.y }, pv.foe ? PAL.brand500 : PAL.amber300, 0, true);
    }

    // выделение
    if (this.ov.selected !== null) {
      const v = this.vis.get(this.ov.selected);
      if (v) this.brackets({ x: v.x, y: v.y }, PAL.amber300, Math.round(pulse), true);
    }

    // Линия смерти прочёсывает поле: яркая черта с хвостом, на выбранном столбце — вспышки
    if (this.scan) {
      const sc = this.scan;
      const x = Math.round(M + sc.pos * CELL + CELL / 2);
      // столбец, над которым сейчас линия, тлеет красным
      g.fillStyle = withAlpha(PAL.brand500, sc.lock > 0 ? 0.2 : 0.14);
      g.fillRect(M + Math.round(sc.pos) * CELL, M, CELL, N * CELL);
      for (let i = 1; i <= 3; i++) {
        g.fillStyle = withAlpha(PAL.brand500, 0.42 - i * 0.11);
        g.fillRect(x - 2 - i * 2, M, 2, N * CELL);
        g.fillRect(x + i * 2, M, 2, N * CELL);
      }
      g.fillStyle = PAL.brand500;
      g.fillRect(x - 2, M, 4, N * CELL);
      g.fillStyle = PAL.amber100;
      g.fillRect(x - 1, M, 2, N * CELL);
      // засечки на раме — «прицел»
      g.fillStyle = PAL.amber300;
      g.fillRect(x - 3, M - 3, 6, 2);
      g.fillRect(x - 3, M + N * CELL + 1, 6, 2);
      if (sc.lock > 0 && Math.floor(sc.lock * 6) % 2 === 0) {
        g.fillStyle = withAlpha(PAL.brand500, 0.4);
        g.fillRect(M + Math.round(sc.pos) * CELL, M, CELL, N * CELL);
      }
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

    for (const L of this.layers) if (!L.under) L.draw(now);
    this.drawParticles(dt);
  }

  private drawPiece(v: Vis, s: GameState, pulse: number) {
    const g = this.g;
    const color = (this.seat(v.owner) ?? s.players[v.owner]).color;
    const up = this.faceUp(v.owner, s);
    const sprite = pieceSprite(v.rank, color, up);
    const w = CELL * v.sx;
    const h = CELL * v.sy;
    const bx = this.X(v.x) + (CELL - w) / 2;
    const by = this.Y(v.y) + (CELL - h) - v.z + 1;
    const pc = s.pieces.find((q) => q.id === v.id);
    // походившая фигура «призрак»: утоплена на пиксель и просвечивает — одинаково читается у обоих цветов
    const dim = pc && s.phase === 'play' && pc.owner === s.current && pc.acted && !s.pending && !canAct(s, pc);
    g.globalAlpha = (dim ? 0.38 : 1) * v.alpha;
    g.drawImage(sprite, Math.round(bx), Math.round(by) + (dim ? 1 : 0), Math.round(w), Math.round(h));
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
