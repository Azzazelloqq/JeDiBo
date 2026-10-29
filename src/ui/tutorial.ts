// Режиссёр обучения поверх экрана партии: пузырь подсказки, подписи после событий, тень на поле,
// рулетки Кармы. Что разрешено на такте — core/tutorial.ts; здесь только подача (docs/tutorial/SCENARIO.md).
import { sfx } from '../audio/sfx';
import { TUT, tutorialStep, type TutStep } from '../core/tutorial';
import { Rank, type CardId, type GameEvent, type GameState, type Piece, type PlayerId, type Pos } from '../core/types';
import type { BoardView } from '../render/board';
import { banner, pop, shake } from '../render/fx';
import { wait } from '../render/tween';
import { h, toast } from './dom';

const same = (a: Pos | undefined, b: Pos) => !!a && a.x === b.x && a.y === b.y;

/** Что мелькает в рулетке Кармы перед настоящей картой. Последняя — «почти выпала». */
const ROULETTE: Record<PlayerId, CardId[]> = {
  0: ['retreat', 'jumper', 'gift', 'snail', 'depression', 'barrier', 'gift', 'skipMove'],
  1: ['spy', 'careerUp', 'freshBlood', 'blitzkrieg', 'resurrection'],
};

export interface TutorialDirector {
  readonly step: TutStep | null;
  /** клик по клетке разрешён на этом такте (selected — выбранная фигура игрока) */
  allows(c: Pos, selected: Piece | undefined): boolean;
  /** клик мимо — мягко напомнить подсказку */
  nudge(): void;
  /** клетки, которые остаются светлыми; null — поле без тени */
  focus(): Pos[] | null;
  /** обновить пузырь под текущий такт; при смене такта — короткий «поп». busy — идут анимации, пузырь прячется */
  render(busy?: boolean): void;
  before(e: GameEvent): void;
  after(e: GameEvent, st: GameState): Promise<void>;
  roulette(p: PlayerId): CardId[];
  karmaNote(p: PlayerId): { title: string; sub: string };
  /** фигура соперника, чьи атаки показать «разведкой» (круг после повышения) */
  threat: number | null;
  dispose(): void;
}

export function tutorialDirector(s: GameState, board: BoardView, slot: HTMLElement): TutorialDirector {
  const bubble = h('div', { class: 'tut-hint' });
  const cap = h('div', { class: 'tut-cap' });
  slot.append(bubble, cap);
  let lastId: string | null = null;

  async function caption(text: string, sub = '', tone: 'brand' | 'amber' | 'stone' = 'brand', hold = 1300) {
    cap.className = `tut-cap tut-cap-${tone}`;
    cap.replaceChildren(h('div', { class: 'tut-cap-text' }, text), sub ? h('div', { class: 'tut-cap-sub' }, sub) : '');
    void cap.offsetWidth;
    cap.classList.add('on');
    sfx.stamp();
    await wait(hold);
    cap.classList.remove('on');
    await wait(200);
  }

  const d: TutorialDirector = {
    threat: null,
    get step() {
      return tutorialStep(s);
    },
    allows(c, selected) {
      const st = d.step;
      if (!st) return false;
      if (st.choose) return st.choose.some((q) => same(q, c));
      if (!st.piece || !st.to) return false;
      return same(st.piece, c) || (!!selected && same(st.piece, selected) && same(st.to, c));
    },
    nudge() {
      sfx.error();
      bubble.classList.remove('nudge');
      void bubble.offsetWidth;
      bubble.classList.add('nudge');
    },
    focus() {
      const st = d.step;
      if (!st) return null;
      if (st.choose) return st.choose;
      if (st.endTurn) return [];
      return [st.piece!, st.to!];
    },
    render(busy = false) {
      const st = busy ? null : d.step;
      bubble.classList.toggle('on', !!st);
      if (!st) return;
      if (st.id === lastId && !st.choose) return;
      const fresh = st.id !== lastId;
      lastId = st.id;
      bubble.replaceChildren(h('span', { class: 'tut-hint-mark' }, '▶'), st.hint);
      if (fresh) {
        pop(bubble);
        if (st.id === 'end') toast('5 действий за ход — разными фигурами', 'amber');
      }
    },
    before(e) {
      if (e.type === 'column') board.columnTease = TUT.teaseX;
    },
    async after(e, st) {
      switch (e.type) {
        case 'capture':
          if (e.victim.owner === 0 && e.victim.rank === Rank.Triangle) await caption('Треугольник бьёт наискосок', 'на клетку вперёд-вбок');
          else if (e.victim.owner === 0 && e.victim.rank === Rank.Circle) {
            d.threat = null;
            await caption('Залетел слишком глубоко', 'у тебя один квадрат против пяти', 'stone', 1700);
          } else if (e.victim.owner === 1 && e.victim.rank === Rank.Triangle && st.phase === 'play') toast('Взятие сразу заканчивает ход', 'amber');
          else if (e.victim.owner === 1 && e.victim.rank === Rank.Circle) {
            d.threat = null;
            shake(10);
            await caption('Круг съел круг!', '', 'amber', 900);
          }
          break;
        case 'promoteRemove':
          if (e.piece.owner === 1) await banner('Повышение!', 'дошёл до последнего ряда', 'amber', 700);
          break;
        case 'spawn':
          if (e.piece.owner === 1 && e.piece.rank === Rank.Circle) {
            d.threat = e.piece.id;
            await caption('Круг бьёт на 5 во все стороны', 'и целится в тебя', 'brand', 1700);
          }
          break;
        case 'destroy':
          if (e.cause === 'doubleDeathEnemy') {
            shake(9);
            if (!st.pending || st.pending.source !== 'doubleDeathEnemy') toast('Карта заняла твой ход', 'amber');
          }
          break;
        case 'cardPlayed':
          if (e.card === 'deathLine') await caption('Карма бьёт вслепую', 'у соперника осталась одна фигура', 'amber', 1500);
          break;
      }
    },
    roulette: (p) => ROULETTE[p],
    karmaNote: (p) =>
      p === 0
        ? { title: 'Когда тяжело — приходит Карма', sub: 'в партии — раз в 7 ходов' }
        : { title: 'Карма соперника', sub: 'случайный столбец — умрут все, и твои тоже' },
    dispose() {
      bubble.remove();
      cap.remove();
    },
  };
  return d;
}
