// Свитчер визуала: служебная плашка «ВИЗУАЛ ▸» (вертикальная вкладка у левого края внизу), F2 — показать/скрыть.
// Стиль нейтральный и одинаковый во всех вариантах, чтобы не путать с тестируемым UI.
import { saveSettings, type Settings } from '../../profile/profile';
import { THEME } from '../../render/palette';
import { setTexConcept, TEX_CONCEPTS, TEX_NAMES, texConcept } from '../../render/textures';
import { h } from '../dom';
import {
  AVAILABLE, cardArtMode, chosenVariant, currentScreen, onUiChange, SCREEN_NAMES, SCREENS, setCardArtMode,
  setSwitcherHidden, setVariant, switcherHidden, VARIANT_LETTERS, VARIANT_NAMES, variantOf, type VariantId,
} from './registry';

export function mountSwitcher() {
  let open = false;
  const host = h('div', { class: 'vsw' });
  document.body.appendChild(host);

  const opt = (label: string, active: boolean, onClick: () => void, title = '') =>
    h('button', { class: `vsw-opt ${active ? 'on' : ''}`, title, onclick: onClick }, label);

  const render = () => {
    host.hidden = switcherHidden();
    host.classList.toggle('open', open);
    const cur = currentScreen();
    const all: VariantId[] = ['a', 'b', 'c'];
    const allOn = (v: VariantId) => SCREENS.every((s) => chosenVariant(s) === v);
    host.replaceChildren(
      h('button', { class: 'vsw-pill', onclick: () => ((open = !open), render()), title: 'F2 — скрыть/показать' }, open ? 'ВИЗУАЛ ◂' : 'ВИЗУАЛ ▸'),
      open
        ? h(
            'div',
            { class: 'vsw-panel' },
            h('div', { class: 'vsw-row vsw-all' }, h('span', {}, 'Все экраны'), h('div', { class: 'vsw-opts' }, ...all.map((v) => opt(VARIANT_LETTERS[v], allOn(v), () => setVariant('all', v), VARIANT_NAMES[v])))),
            ...SCREENS.map((s) =>
              h(
                'div',
                { class: `vsw-row ${s === cur ? 'cur' : ''}` },
                h('span', {}, SCREEN_NAMES[s]),
                h('div', { class: 'vsw-opts' }, ...AVAILABLE[s].map((v) => opt(VARIANT_LETTERS[v], variantOf(s) === v, () => setVariant(s, v), VARIANT_NAMES[v]))),
              ),
            ),
            h('div', { class: 'vsw-sep' }),
            h(
              'div',
              { class: 'vsw-row' },
              h('span', {}, 'Тема'),
              h(
                'div',
                { class: 'vsw-opts' },
                ...([['dark', 'Тёмная'], ['light', 'Светлая']] as const).map(([t, l]) => opt(l, THEME.scheme === t, () => THEME.scheme !== t && reloadTheme(t))),
              ),
            ),
            h(
              'div',
              { class: 'vsw-row' },
              h('span', {}, 'Фактура'),
              h(
                'div',
                { class: 'vsw-opts' },
                ...TEX_CONCEPTS.map((t) => opt(TEX_NAMES[t], texConcept() === t, () => texConcept() !== t && (setTexConcept(t), (location.href = location.pathname)))),
              ),
            ),
            h(
              'div',
              { class: 'vsw-row' },
              h('span', {}, 'Карты Кармы'),
              h('div', { class: 'vsw-opts' }, opt('Иконки', cardArtMode() === 'icons', () => setCardArtMode('icons')), opt('Иллюстрации', cardArtMode() === 'illustrated', () => setCardArtMode('illustrated'))),
            ),
            h('div', { class: 'vsw-legend' }, 'А — референс·наш стиль · Б — референс 1:1 · В — текущий'),
            h('button', { class: 'vsw-hide', onclick: () => (setSwitcherHidden(true), render()) }, 'Скрыть плашку (вернуть — F2)'),
          )
        : '',
    );
  };

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'F2') return;
    e.preventDefault();
    if (switcherHidden()) {
      setSwitcherHidden(false);
      open = true;
    } else open = !open;
    render();
  });
  onUiChange(render);
  render();
}

/** Тема собирается при загрузке (палитра, спрайты) — сохраняем и перезагружаем; экран вернётся тот же (кроме партии). */
function reloadTheme(t: NonNullable<Settings['theme']>) {
  saveSettings({ theme: t });
  location.href = location.pathname;
}
