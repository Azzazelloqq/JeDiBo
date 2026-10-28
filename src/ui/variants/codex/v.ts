// Колода, варианты «а» и «б»: сетка всех карт слева (бейдж «×N», выбранная — с подсветкой), детали справа,
// снизу пояснение о редкости, «Назад», «Правила» и переключатель «Карты: иконки / иллюстрации».
import { ALL_CARDS, tierOf, type CardDef } from '../../../core/karma/cards';
import { TIER_STYLE } from '../../../render/cardArt';
import { cardEl } from '../../card';
import { btn, h } from '../../dom';
import { open } from '../registry';
import { A, arrowNav, cardArtToggle, codexState, variantBackground, type Look } from '../shared';

export function codexV(root: HTMLElement, v: Look) {
  variantBackground(v, 'inner');
  const total = ALL_CARDS.reduce((s, d) => s + d.count, 0);
  const detail = h('div', { class: 'vx-detail' });
  const cells: HTMLElement[] = [];
  const show = (d: CardDef) => {
    codexState.pick = ALL_CARDS.indexOf(d);
    cells.forEach((c, i) => c.classList.toggle('on', i === codexState.pick));
    const tier = tierOf(d);
    detail.replaceChildren(
      h('div', { class: 'vx-big' }, cardEl(d.id, { scale: 3 }).el),
      h(
        'div',
        { class: 'vx-info' },
        h('div', { class: 'vx-name' }, d.name.toUpperCase()),
        h('div', { class: 'vx-en' }, d.en),
        h(
          'div',
          { class: 'vx-tags' },
          h('span', { class: `vx-tag tier-${tier}` }, TIER_STYLE[tier].label.toUpperCase()),
          h('span', { class: 'vx-meta' }, d.timing === 'period' ? 'период' : 'сразу'),
          d.takesTurn ? h('span', { class: 'vx-meta vx-turn' }, 'занимает ход') : null,
          h('span', { class: 'vx-meta' }, `${d.count} ${d.count === 1 ? 'копия' : d.count < 5 ? 'копии' : 'копий'}`),
        ),
      ),
      h('div', { class: 'vx-text' }, h('p', { class: 'vx-quote' }, d.text), h('div', { class: 'vx-label' }, 'КЛАССИЧЕСКИЙ ЭФФЕКТ'), h('p', { class: 'vx-rule' }, d.rule)),
    );
  };
  const grid = h(
    'div',
    { class: 'vx-grid' },
    ...ALL_CARDS.map((d) => {
      const c = cardEl(d.id, { scale: 2, idle: false });
      const cell = h('button', { class: 'vx-cell', 'aria-label': d.name }, h('div', { class: 'vx-count' }, `×${d.count}`), c.el);
      cell.addEventListener('click', () => show(d));
      cell.addEventListener('focus', () => show(d));
      cells.push(cell);
      return cell;
    }),
  );
  show(ALL_CARDS[codexState.pick] ?? ALL_CARDS[0]);
  root.append(
    h(
      'div',
      { class: 'v-page' },
      h(
        'div',
        { class: `v-panel v-codex${A(v, 'slab')}` },
        h('div', { class: `v-head vx-head${A(v, 'page-head')}` }, h('h1', { class: 'v-title' }, 'КОЛОДА'), h('div', { class: 'vx-sub' }, `${ALL_CARDS.length} ТИП · ${total} КАРТЫ · 21 В МАТЧЕ`)),
        h(
          'div',
          { class: 'vx-body' },
          h(
            'div',
            { class: 'vx-left' },
            grid,
            h(
              'div',
              { class: 'vx-note' },
              h('div', { class: 'vx-label' }, 'РЕДКОСТЬ'),
              h('p', {}, 'Тир виден по рамке карты: простая — светлый бетон, редкая — бронза, роковая — красный гранит. Роковые карты занимают ход: после розыгрыша ход заканчивается.'),
            ),
          ),
          detail,
        ),
        h('div', { class: 'v-foot vx-foot' }, btn('НАЗАД', () => open('menu')), btn('ПРАВИЛА', () => open('rules')), h('div', { class: 'vx-spacer' }), cardArtToggle('')),
      ),
    ),
  );
  return arrowNav(root, '.vx-cell, button.btn');
}
