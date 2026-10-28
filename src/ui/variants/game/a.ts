// Партия, вариант «а»: наш визуал, UX референса (refs/09, HUD — refs/10), каркас как у «в» (Balatro).
// Левая колонка — строка хода, карточка своего игрока с крупным числом и сегментированной полосой,
// при расстановке — большие кнопки выбора фигуры и пресеты, в игре — Карма, карта, эффекты;
// правая — фигуры, «Ваша армия», подсказка, колода, хроника; под полем — подсказка и крупные кнопки.
// Только DOM: логика — в контроллере screens/game.ts.
import { CARDS } from '../../../core/karma/cards';
import { RANK_NAME } from '../../../core/ops';
import { homeRows, piecesOf } from '../../../core/rules';
import { Rank, type PlayerId } from '../../../core/types';
import { cardEl } from '../../card';
import { btn, h } from '../../dom';
import { PLACE_ORDER, type GameCtx, type GameLayout, type GameParts } from '../../screens/game';
import { avatarEl, pieceIcon } from '../../widgets';

const START = [12, 6, 3];
const RANKS = [Rank.Triangle, Rank.Square, Rank.Circle];

function segBar(n: number, of: number, cls = '') {
  return h('div', { class: `ga-seg ${cls}` }, ...Array.from({ length: of }, (_, i) => h('span', { class: i < n ? 'on' : '' })));
}

function legend(c: GameCtx, p: PlayerId) {
  const pl = c.s.players[p];
  const up = pl.side === 0;
  return h(
    'section',
    { class: 'slab' },
    h('div', { class: 'h-label' }, 'Фигуры'),
    c.ui.legendRow(Rank.Triangle, pl.color, up, 'Треугольник', '1 вперёд · бьёт вперёд и по диагонали'),
    c.ui.legendRow(Rank.Square, pl.color, up, 'Квадрат', '1–3 вперёд, вбок, по диагонали'),
    c.ui.legendRow(Rank.Circle, pl.color, up, 'Круг', '1–5 в любую сторону'),
  );
}

function playerCard(c: GameCtx, p: PlayerId, n: number, status: string, active: boolean) {
  const pl = c.s.players[p];
  return h(
    'section',
    { class: `slab ga-card ${active ? 'active' : ''} pl-${pl.color}` },
    h('div', { class: 'ga-who' }, avatarEl(c.ui.avatarSeed(p), 4), h('div', {}, h('div', { class: 'ga-name' }, h('span', { class: `chip chip-${pl.color}` }), pl.name), h('div', { class: 'muted small' }, c.match.cfg.controllers[p] === 'bot' ? 'бот' : 'игрок'))),
    h('div', { class: 'ga-big' }, h('b', {}, String(n)), h('span', {}, ` из 21 · ${status}`)),
    segBar(n, 21),
  );
}

export const layoutA: GameLayout = {
  cls: 'game-a',

  placement(c): GameParts {
    const s = c.s;
    const p = c.placingFor;
    const pl = s.players[p];
    const cnt = c.counts();
    const total = cnt[0] + cnt[1] + cnt[2];
    const rows = homeRows(s, pl.side);
    const up = pl.side === 0;
    return {
      top: [
        h('div', { class: 'tb-turn' }, h('span', { class: `chip chip-${pl.color}` }), pl.name),
        h('div', { class: 'tb-title' }, 'Скрытая расстановка'),
        h('div', { class: 'tb-note' }, c.kind === 'bot' ? 'Странник уже расставился' : c.kind === 'net' ? 'Соперник расставляется сам' : `Игрок ${p + 1} из 2`),
      ],
      left: [
        playerCard(c, p, total, total === 21 ? 'армия собрана' : 'на поле', true),
        h(
          'div',
          { class: 'rank-picks' },
          ...PLACE_ORDER.map((r) => {
            const left = c.LIMIT[r] - cnt[r];
            return h(
              'button',
              { class: `rank-pick ga-pick ${c.placeRank === r ? 'active' : ''} ${left === 0 ? 'empty' : ''}`, onclick: () => c.act.pickRank(r) },
              pieceIcon(r, pl.color, 3, up),
              h('span', { class: 'rp-name' }, RANK_NAME[r]),
              h('span', { class: 'rp-left' }, String(left)),
            );
          }),
        ),
        c.ui.presetsPanel(),
        h('div', { class: 'controls' }, btn('В меню', () => c.act.leave(), 'btn-dark btn-small')),
      ],
      right: [
        legend(c, p),
        h(
          'section',
          { class: 'slab' },
          h('div', { class: 'h-label' }, 'Ваша армия'),
          ...([['Передний', rows[2]], ['Средний', rows[1]], ['Тыл', rows[0]]] as const).map(([l, y]) =>
            h('div', { class: 'army-row' }, h('span', {}, l), h('div', { class: 'meter' }, h('div', { class: 'meter-fill', style: `width:${(c.inRow(y) / 12) * 100}%` })), h('b', {}, String(c.inRow(y)))),
          ),
        ),
        h('section', { class: 'slab hint' }, 'Клик ставит фигуру, повторный клик — убирает. Расстановка скрыта от соперника.'),
      ],
      bottom: [
        h('div', { class: 'prompt slab' }, total === 21 ? 'Армия собрана — можно начинать' : `Осталось поставить ${21 - total}`),
        h('div', { class: 'bb-actions' }, btn('Готово', () => c.act.ready(), `btn-amber btn-big bb-main ${total === 21 ? 'ready-pulse' : ''}`, { disabled: total !== 21 })),
      ],
    };
  },

  play(c): GameParts {
    const s = c.s;
    const me = c.me;
    const opp: PlayerId = me === 0 ? 1 : 0;
    const cur = s.players[s.current];
    const mine = s.players[me];
    const pcs = piecesOf(s, me);
    const alive = [0, 1, 2].map((r) => pcs.filter((q) => q.rank === r).length);
    const lost = [0, 1, 2].map((r) => mine.graveyard.filter((g) => g.rank === r).length);
    const k = s.mode.karmaEvery;
    const inCycle = mine.ownTurns % k;
    const karmaNow = mine.ownTurns > 0 && inCycle === 0 && s.current === me;
    const held = mine.held;
    const humanMe = c.match.isHuman(me);
    const canPlayHeld = !!held && humanMe && s.current === me && !s.pending && !c.match.isBusy && (!CARDS[held.card].canPlay || CARDS[held.card].canPlay!(s, me));
    const pr = c.prompt();
    const oppAlive = piecesOf(s, opp).length;
    return {
      // компактная строка как в 3D-версии: чей ход · действий · период Кармы · таймер хода · таймер партии
      top: [
        h('div', { class: 'tb-turn' }, h('span', { class: `chip chip-${cur.color}` }), cur.name, h('span', { class: 'muted' }, ` · ход ${cur.ownTurns}`)),
        h('div', { class: 'tb-ap' }, h('span', { class: 'h-label' }, 'Действий'), c.ui.apPips, c.ui.apNum),
        h('div', { class: 'ga-period' }, h('span', { class: 'h-label' }, 'Период Кармы'), h('b', {}, `${karmaNow ? k : inCycle}/${k}`)),
        h('div', { class: 'tb-time' }, c.ui.turnClock, c.ui.turnBar, c.ui.totals),
      ],
      left: [
        playerCard(c, me, pcs.length, pcs.length === 21 ? 'армия цела' : `соперник: ${oppAlive}`, s.current === me),
        h(
          'section',
          { class: 'slab ga-karma' },
          h('div', { class: 'h-label' }, `Карма ${karmaNow ? k : inCycle}/${k}`),
          segBar(karmaNow ? k : inCycle, k, 'ga-seg-karma'),
          h('div', { class: `kt-label ${karmaNow ? 'now' : ''}` }, karmaNow ? 'сейчас' : s.deck.length ? `через ${k - inCycle}` : 'колода пуста'),
          held
            ? h(
                'div',
                { class: 'held' },
                cardEl(held.card, { scale: 1.4, idle: true }).el,
                h('div', { class: 'held-info' }, h('b', {}, CARDS[held.card].name), h('div', { class: 'muted small' }, `до хода ${held.untilOwnTurn}`), humanMe ? btn('Разыграть', () => c.act.playCard(me), 'btn-brand btn-small', { disabled: !canPlayHeld }) : null),
              )
            : h('div', { class: 'muted small' }, 'карты на руках нет'),
        ),
        c.ui.effectsPanel(),
        h('div', { class: 'controls' }, btn('Сдаться', () => c.act.resign(), 'btn-dark btn-small'), btn('В меню', () => c.act.leave(), 'btn-dark btn-small')),
      ],
      bottom: [
        h('div', { class: `prompt slab ${pr.hot ? 'prompt-hot' : ''}` }, pr.text),
        h(
          'div',
          { class: 'bb-actions' },
          c.canSkip() ? btn('Хватит', () => c.act.skip(), 'btn-dark btn-big') : null,
          btn('Отменить', () => c.act.deselect(), 'btn-stone btn-big', { disabled: c.selected === null }),
          btn('Завершить ход', () => c.act.endTurn(), 'btn-amber btn-big bb-main', { disabled: !c.canEnd() }),
        ),
      ],
      right: [
        h(
          'section',
          { class: 'slab' },
          h('div', { class: 'h-label' }, c.kind !== 'hotseat' ? 'Ваша армия' : `Армия: ${mine.name}`),
          ...RANKS.map((r) =>
            h(
              'div',
              { class: 'army-row ga-army' },
              pieceIcon(r, mine.color, 2, mine.side === 0),
              h('div', { class: 'meter' }, h('div', { class: 'meter-fill', style: `width:${Math.min(1, alive[r] / START[r]) * 100}%` })),
              h('b', {}, String(alive[r])),
              h('span', { class: 'muted small' }, lost[r] ? `−${lost[r]}` : ''),
            ),
          ),
        ),
        legend(c, me),
        h('section', { class: 'slab hint' }, 'Клик по фигуре — выбрать, по клетке — ход или атака. Пробел — завершить ход, Esc — отменить выбор.'),
        c.ui.deckPanel(),
        c.ui.logPanel(),
      ],
    };
  },
};
