// Эмблемы Летописи (режим «Классика»). Проверка — после каждой партии; открытые хранятся в профиле
// (profile.emblems: id → время). Иконки — пиксельные спрайты 16×16 (render/emblemArt.ts).
import { getProfile, saveProfile, titleOf, type MatchRecord, type Profile } from './profile';

export type EmblemTier = 'знак' | 'печать' | 'клеймо';

/** Итог партии с точки зрения игрока 0 (владельца профиля) — то, что не хранится в истории. */
export interface MatchOutcome {
  rec: MatchRecord;
  /** фигур игрока осталось на поле к концу партии */
  piecesLeft: number;
  /** сыграно роковых карт */
  fatalPlayed: number;
  /** повышений квадрата до круга */
  squarePromotions: number;
}

export interface Emblem {
  id: string;
  name: string;
  desc: string;
  tier: EmblemTier;
  points: 1 | 2 | 3;
  check(o: MatchOutcome, p: Profile): boolean;
}

const POINTS: Record<EmblemTier, 1 | 2 | 3> = { знак: 1, печать: 2, клеймо: 3 };
const e = (id: string, name: string, desc: string, tier: EmblemTier, check: Emblem['check']): Emblem => ({ id, name, desc, tier, points: POINTS[tier], check });
const won = (o: MatchOutcome) => o.rec.result === 'win';

export const EMBLEMS: Emblem[] = [
  e('firstStone', 'Первый камень', 'Выиграть первую партию', 'знак', (o) => won(o)),
  e('wandererWrong', 'Странник ошибся', 'Выиграть у Странника', 'знак', (o) => won(o) && o.rec.kind === 'bot'),
  e('twoAtTable', 'Двое за столом', 'Доиграть партию за одним компьютером', 'знак', (o) => o.rec.kind === 'hotseat'),
  e('balance', 'Равновесие', 'Довести партию до ничьей', 'печать', (o) => o.rec.result === 'draw'),
  e('flawless', 'Безупречная кладка', 'Выиграть, не потеряв ни одной фигуры', 'клеймо', (o) => won(o) && (o.rec.piecesLost ?? 1) === 0),
  e('lastStone', 'Последний камень', 'Выиграть, когда у вас осталась одна фигура', 'клеймо', (o) => won(o) && o.piecesLeft === 1),
  e('longBuild', 'Долгая стройка', 'Выиграть партию длиннее 40 ваших ходов', 'знак', (o) => won(o) && (o.rec.ownTurns ?? 0) > 40),
  e('demolition', 'Снос', 'Выиграть быстрее чем за 15 ваших ходов', 'печать', (o) => won(o) && (o.rec.ownTurns ?? 99) < 15),
  e('sixSigns', 'Шесть знаков', 'Получить Карму 6 раз за партию', 'печать', (o) => (o.rec.karmaReceived ?? 0) >= 6),
  e('careerist', 'Карьерист', 'Повысить фигуры 3 раза за партию', 'печать', (o) => (o.rec.promotions ?? 0) >= 3),
  // «довести треугольник до круга двумя повышениями»: движок пересоздаёт фигуру при повышении, поэтому
  // считаем повышение квадрата до круга (второе звено той же цепочки) — см. HANDOFF
  e('toCircle', 'До круга', 'Повысить квадрат до круга', 'клеймо', (o) => o.squarePromotions >= 1),
  e('fatalBet', 'Роковая ставка', 'Выиграть партию, разыграв роковую карту', 'знак', (o) => won(o) && o.fatalPlayed > 0),
  e('fullDeck', 'Полная колода', 'Разыграть за партию 5 карт Кармы', 'печать', (o) => (o.rec.cardsPlayed ?? 0) >= 5),
  e('series', 'Серия', '3 победы подряд', 'печать', (_o, p) => p.streak >= 3),
  e('monolith', 'Монолит', '5 побед подряд', 'клеймо', (_o, p) => p.streak >= 5),
  e('hundredShards', 'Сто обломков', 'Сбить 100 фигур суммарно', 'знак', (_o, p) => p.captures >= 100),
  e('granite', 'Гранит', 'Получить звание «Гранит»', 'печать', (_o, p) => p.rating >= 1100),
  e('monolithSpirit', 'Монолит духа', 'Получить звание «Монолит»', 'клеймо', (_o, p) => p.rating >= 1500),
];

export const unlockedEmblems = (p: Profile = getProfile()) => p.emblems ?? {};

/** Проверить эмблемы после партии (профиль уже обновлён recordMatch); вернуть новые. */
export function checkEmblems(o: MatchOutcome): Emblem[] {
  const p = getProfile();
  const have = { ...unlockedEmblems(p) };
  const fresh = EMBLEMS.filter((em) => !have[em.id] && em.check(o, p));
  if (!fresh.length) return [];
  const now = Date.now();
  fresh.forEach((em) => (have[em.id] = now));
  saveProfile({ emblems: have });
  return fresh;
}

/** Сводка для шапки Летописи: звание, очки, эмблемы, прогресс до следующего звания. */
export function chronicleSummary(p: Profile = getProfile()) {
  const have = unlockedEmblems(p);
  const t = titleOf(p.rating);
  const points = EMBLEMS.reduce((s, em) => s + (have[em.id] ? em.points : 0), 0);
  const progress = t.next ? Math.min(1, Math.max(0, (p.rating - t.from) / (t.to - t.from))) : 1;
  return { title: t, points, maxPoints: EMBLEMS.reduce((s, em) => s + em.points, 0), count: Object.keys(have).length, total: EMBLEMS.length, progress };
}

/** Описание званий (TITLES из profile.ts). */
export const TITLE_DESC: Record<string, string> = {
  Щебень: 'Россыпь камней. Всё ещё впереди.',
  Бетон: 'Схватился. Держит удар и форму.',
  Гранит: 'Твёрдая порода — Странник уважает.',
  Базальт: 'Вулканическая выдержка и холодный расчёт.',
  Монолит: 'Цельный камень. Сдвинуть невозможно.',
};
