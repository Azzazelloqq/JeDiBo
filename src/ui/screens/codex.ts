// «Колода»: все карты Кармы с количеством, тиром и полным эффектом.
import { ALL_CARDS, tierOf, type CardDef } from '../../core/karma/cards';
import { setMood } from '../../render/background';
import { TIER_STYLE } from '../../render/cardArt';
import { go } from '../app';
import { cardEl } from '../card';
import { btn, h } from '../dom';
import { menuScreen } from './menu';

export function codexScreen(root: HTMLElement) {
  setMood('karma');
  const detail = h('div', { class: 'codex-detail slab' });
  const show = (d: CardDef) => {
    const tier = tierOf(d);
    detail.replaceChildren(
      cardEl(d.id, { scale: 4 }).el,
      h(
        'div',
        { class: 'cd-text' },
        h('div', { class: 'cd-name' }, d.name),
        h('div', { class: 'cd-en' }, d.en),
        h(
          'div',
          { class: 'tags' },
          h('span', { class: 'tag', style: `--c:${TIER_STYLE[tier].rim}` }, TIER_STYLE[tier].label),
          h('span', { class: 'tag' }, d.timing === 'period' ? 'в течение периода' : 'после получения'),
          d.takesTurn ? h('span', { class: 'tag tag-red' }, 'занимает ход') : null,
          h('span', { class: 'tag' }, `×${d.count} в колоде`),
        ),
        h('p', { class: 'cd-quote' }, d.text),
        h('div', { class: 'h-label' }, 'Классический эффект'),
        h('p', { class: 'cd-rule' }, d.rule),
      ),
    );
  };
  const grid = h(
    'div',
    { class: 'codex-grid' },
    ...ALL_CARDS.map((d) => {
      const c = cardEl(d.id, { scale: 2 });
      c.el.addEventListener('click', () => show(d));
      return h('div', { class: 'codex-cell' }, c.el, h('div', { class: 'codex-count' }, `×${d.count}`));
    }),
  );
  show(ALL_CARDS[0]);
  root.append(
    h(
      'div',
      { class: 'page' },
      h('div', { class: 'page-head' }, h('h1', {}, 'Колода Кармы'), h('div', { class: 'page-sub' }, '34 карты в общей колоде · 21 случайная в матче'), btn('В меню', () => go(menuScreen))),
      h('div', { class: 'codex' }, grid, detail),
    ),
  );
}
