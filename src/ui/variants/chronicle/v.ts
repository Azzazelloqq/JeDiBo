// Летопись, варианты «а» и «б» (вместо Профиля): шапка звания с аватаром, именем, рейтингом и статистикой,
// вкладки «Летопись / Эмблемы», история партий и сетка эмблем. Функции Профиля сохранены.
import { chronicleSummary, EMBLEMS, TITLE_DESC, unlockedEmblems } from '../../../profile/emblems';
import { getProfile, saveProfile, type MatchRecord } from '../../../profile/profile';
import { emblemIcon } from '../../../render/emblemArt';
import { Rank } from '../../../core/types';
import { btn, canvasEl, h } from '../../dom';
import { avatarEl, pieceIcon } from '../../widgets';
import { open } from '../registry';
import { A, arrowNav, variantBackground, type Look } from '../shared';

let tab: 'history' | 'emblems' = 'history';

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export function dayLabel(at: number) {
  const d = new Date(at);
  const today = new Date();
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 86400000);
  if (diff === 0) return 'сегодня';
  if (diff === 1) return 'вчера';
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

const RESULT = { win: 'ПОБЕДА', loss: 'ПОРАЖЕНИЕ', draw: 'НИЧЬЯ' } as const;
export function historyTitle(r: MatchRecord) {
  const vs = r.kind === 'bot' ? 'ПРОТИВ СТРАННИКА' : 'ЗА ОДНИМ ПК';
  return `КЛАССИКА · ${vs} · ${RESULT[r.result]}`;
}
/** «ваших ходов N · Карма приходила N раз · потеряно фигур N из 21 · соперник: …»; у старых записей — что есть. */
export function historyDetails(r: MatchRecord) {
  const parts: string[] = [];
  if (r.ownTurns !== undefined) parts.push(`ваших ходов ${r.ownTurns}`);
  else parts.push(`ходов всего ${r.turns}`);
  if (r.karmaReceived !== undefined) parts.push(`Карма приходила ${r.karmaReceived} ${plural(r.karmaReceived, 'раз', 'раза', 'раз')}`);
  if (r.piecesLost !== undefined) parts.push(`потеряно фигур ${r.piecesLost} из ${r.piecesTotal ?? 21}`);
  parts.push(`соперник: ${r.opponent}`);
  return parts.join(' · ');
}
const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};

export function chronicleV(root: HTMLElement, v: Look) {
  variantBackground(v, 'inner');
  let off: (() => void) | undefined;
  const render = () => {
    const p = getProfile();
    const sum = chronicleSummary(p);
    const games = p.wins + p.losses + p.draws;
    const wr = games ? Math.round((p.wins / games) * 100) : 0;

    const name = h('input', { class: 'vc-name', value: p.name, maxLength: 16, spellcheck: false, 'aria-label': 'Имя' });
    name.addEventListener('change', () => saveProfile({ name: name.value.trim() || p.name }));
    const avatarBtn = h('button', { class: 'vc-avatar', title: 'Новый аватар' }, avatarEl(p.avatarSeed, 6));
    avatarBtn.addEventListener('click', () => {
      saveProfile({ avatarSeed: `${p.name}${Math.random()}` });
      render();
    });
    // сегментированная полоса до следующего звания: 20 сегментов
    const SEG = 20;
    const filled = Math.round(sum.progress * SEG);
    const bar = h('div', { class: 'vc-bar' }, ...Array.from({ length: SEG }, (_, i) => h('span', { class: i < filled ? 'on' : '' })));
    const stat = (l: string, val: string | number) => h('span', { class: 'vc-stat' }, h('b', {}, String(val)), ` ${l}`);

    const head = h(
      'section',
      { class: 'vc-rank' },
      avatarBtn,
      h(
        'div',
        { class: 'vc-who' },
        name,
        h('div', { class: 'vc-label' }, 'ЗВАНИЕ'),
        h('div', { class: 'vc-title' }, sum.title.name.toUpperCase()),
        h('div', { class: 'vc-desc' }, TITLE_DESC[sum.title.name] ?? ''),
      ),
      h(
        'div',
        { class: 'vc-right' },
        h('div', { class: 'vc-count' }, `ЭМБЛЕМ ${sum.count} / ${sum.total} · ОЧКОВ ${sum.points}`),
        bar,
        h('div', { class: 'vc-next' }, sum.title.next ? `${sum.title.to - p.rating} до звания «${sum.title.next.toUpperCase()}»` : 'высшее звание'),
        h('div', { class: 'vc-rating' }, h('span', {}, 'РЕЙТИНГ'), h('b', {}, String(p.rating))),
      ),
      h(
        'div',
        { class: 'vc-stats' },
        stat('побед', p.wins), stat('поражений', p.losses), stat('ничьих', p.draws), stat('винрейт', `${wr}%`),
        stat('серия', p.streak), stat('лучшая серия', p.bestStreak), stat('фигур сбито', p.captures), stat('карт сыграно', p.cardsPlayed),
      ),
    );

    const tabBtn = (id: typeof tab, label: string) => btn(label, () => ((tab = id), render()), `vc-tab ${tab === id ? 'v-tab-on' : ''}`);
    let list: HTMLElement;
    if (tab === 'history') {
      list = p.history.length
        ? h(
            'div',
            { class: 'vc-list' },
            ...p.history.map((r) =>
              h(
                'div',
                { class: `vc-hist vc-${r.result}` },
                h('div', { class: 'vc-hist-icon' }, pieceIcon(r.result === 'loss' ? Rank.Triangle : r.result === 'win' ? Rank.Circle : Rank.Square, r.result === 'loss' ? 'black' : 'red', 3)),
                h('div', { class: 'vc-hist-body' }, h('div', { class: 'vc-hist-title' }, historyTitle(r)), h('div', { class: 'vc-hist-text' }, historyDetails(r))),
                h('div', { class: 'vc-hist-side' }, h('div', { class: 'vc-hist-date' }, dayLabel(r.at)), h('div', { class: `vc-hist-delta ${r.delta > 0 ? 'up' : r.delta < 0 ? 'down' : ''}` }, r.kind === 'bot' ? `${r.delta > 0 ? '+' : r.delta < 0 ? '−' : '±'}${Math.abs(r.delta)}` : '—')),
              ),
            ),
          )
        : h(
            'div',
            { class: 'vc-empty' },
            h('div', { class: 'vc-empty-title' }, 'Летопись пока пуста'),
            h('div', { class: 'vc-empty-text' }, 'Здесь появятся ваши партии: с кем, сколько ходов, как часто приходила Карма.'),
            btn('Сыграть', () => open('modeSelect'), 'v-sel'),
          );
    } else {
      const have = unlockedEmblems(p);
      list = h(
        'div',
        { class: 'vc-list vc-emblems' },
        ...EMBLEMS.map((em) =>
          h(
            'div',
            { class: `vc-emb ${have[em.id] ? 'got' : 'locked'}` },
            canvasEl(emblemIcon(em.id, em.tier, !have[em.id]), 4, 'vc-emb-icon'),
            h('div', { class: 'vc-emb-body' }, h('div', { class: 'vc-emb-name' }, em.name.toUpperCase()), h('div', { class: 'vc-emb-desc' }, em.desc)),
            h('div', { class: `vc-emb-tier t-${em.points}` }, em.tier.toUpperCase()),
          ),
        ),
      );
    }

    root.replaceChildren(
      h(
        'div',
        { class: 'v-page' },
        h(
          'div',
          { class: `v-panel v-chron${A(v, 'slab')}` },
          h('h1', { class: 'v-title vc-h1' }, 'ЛЕТОПИСЬ'),
          head,
          h('div', { class: 'vc-tabs' }, tabBtn('history', 'ЛЕТОПИСЬ'), tabBtn('emblems', 'ЭМБЛЕМЫ')),
          list,
          h('div', { class: 'v-foot' }, btn('НАЗАД', () => open('menu'))),
        ),
      ),
    );
  };
  render();
  off = arrowNav(root);
  return () => off?.();
}
