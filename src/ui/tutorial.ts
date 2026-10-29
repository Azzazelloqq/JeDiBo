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
/** зона удара убийцы вниз по столбцу: квадрат подходит вплотную к ней */
const KILLER_ZONE: Pos[] = [1, 2, 3].map((d) => ({ x: TUT.foeCircle.x, y: TUT.foeCircle.y + d }));

/** Что мелькает в рулетке Кармы перед настоящей картой. Последняя — «почти выпала»: игроку чуть не выпадает
 *  Линия смерти, которая потом достанется сопернику. */
const ROULETTE: Record<PlayerId, CardId[]> = {
  0: ['retreat', 'jumper', 'gift', 'snail', 'depression', 'barrier', 'skipMove', 'deathLine'],
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
  /** фигура, чей узор показать на поле без наведения: круг соперника после повышения, твой квадрат «не достаёт» */
  threat: number | null;
  dispose(): void;
}

/** redraw — перерисовать подсветку поля, когда режиссёр меняет её посреди подписи */
export function tutorialDirector(s: GameState, board: BoardView, slot: HTMLElement, redraw: () => void): TutorialDirector {
  const bubble = h('div', { class: 'tut-hint' });
  const cap = h('div', { class: 'tut-cap' });
  slot.append(bubble, cap);
  let lastId: string | null = null;
  let lineKills = 0;

  /** low — подпись под фигурой, чтобы не закрыть лучи над ней */
  async function caption(text: string, sub = '', tone: 'brand' | 'amber' | 'stone' = 'brand', hold = 1300, low = false) {
    cap.className = `tut-cap tut-cap-${tone}${low ? ' tut-cap-low' : ''}`;
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
      // «подойди, но не под удар»: видно убийцу и докуда он бьёт
      if (st.id === 'stuck') return [st.piece!, st.to!, TUT.foeCircle, ...KILLER_ZONE];
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
        if (st.id === 'stuck') d.threat = s.pieces.find((q) => same(q, TUT.foeCircle))?.id ?? null;
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
            await caption('Залетел слишком глубоко', 'у тебя один квадрат против шести', 'stone', 1500);
            // убийца — в том же столбце, но в 5 клетках: узор квадрата обрывается на 3
            d.threat = st.pieces.find((q) => q.owner === 0)?.id ?? null;
            redraw();
            await caption('Квадрат не достаёт', 'бьёт на 3, а до убийцы — 5', 'stone', 1800, true);
          } else if (e.victim.owner === 1 && same(e.to, TUT.standoff)) {
            d.threat = null;
            await caption('Оба не достают', 'ему до тебя — 4, а бьёт он на 3', 'stone', 1500, true);
          } else if (e.victim.owner === 1 && e.victim.rank === Rank.Square) {
            d.threat = null;
            shake(10);
            await caption('Круг вернулся', 'и отомстил за себя', 'amber', 1300);
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
        case 'rankChange':
          if (e.to === Rank.Circle && st.pieces.find((q) => q.id === e.pieceId)?.owner === 0) {
            d.threat = e.pieceId;
            shake(6);
            redraw();
            await caption('Теперь достаёт!', 'круг бьёт на 5', 'amber', 1500, true);
          }
          break;
        case 'destroy':
          // после третьей жертвы Линии смерти — выдох
          if (e.cause === 'deathLine' && ++lineKills === 3) await caption('Фух, мимо!', 'Карма слепа — соперник сам потерял троих', 'amber', 1700);
          break;
      }
    },
    roulette: (p) => ROULETTE[p],
    karmaNote: (p) =>
      p === 0
        ? { title: 'Теперь твоя Карма', sub: 'в партии — раз в 7 ходов' }
        : { title: 'Карма приходит обоим', sub: 'соперник начал партию — его карта раньше' },
    dispose() {
      bubble.remove();
      cap.remove();
    },
  };
  return d;
}
