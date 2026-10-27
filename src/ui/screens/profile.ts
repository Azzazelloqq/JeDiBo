// Мини-профиль: аватар, имя, звание, рейтинг, статистика, последние партии.
import { getProfile, saveProfile, titleOf } from '../../profile/profile';
import { setMood } from '../../render/background';
import { go } from '../app';
import { btn, h } from '../dom';
import { avatarEl } from '../widgets';
import { menuScreen } from './menu';

export function profileScreen(root: HTMLElement) {
  setMood('menu');
  const render = () => {
    const p = getProfile();
    const t = titleOf(p.rating);
    const games = p.wins + p.losses + p.draws;
    const wr = games ? Math.round((p.wins / games) * 100) : 0;
    const prog = Math.max(0, Math.min(1, (p.rating - t.from) / (t.to - t.from)));
    const name = h('input', { class: 'name-input', value: p.name, maxLength: 16, spellcheck: false });
    name.addEventListener('change', () => {
      saveProfile({ name: name.value.trim() || p.name });
    });
    const stat = (label: string, v: string | number, cls = '') => h('div', { class: `stat ${cls}` }, h('div', { class: 'stat-v' }, String(v)), h('div', { class: 'stat-l' }, label));
    root.replaceChildren(
      h(
        'div',
        { class: 'page' },
        h('div', { class: 'page-head' }, h('h1', {}, 'Профиль'), h('div', { class: 'page-sub' }, 'Хранится в этом браузере'), btn('В меню', () => go(menuScreen))),
        h(
          'div',
          { class: 'profile-grid' },
          h(
            'section',
            { class: 'slab profile-card' },
            h('div', { class: 'avatar-frame' }, avatarEl(p.avatarSeed, 14)),
            btn('Новый аватар', () => {
              saveProfile({ avatarSeed: `${p.name}${Math.random()}` });
              render();
            }, 'btn-dark btn-small'),
            name,
            h('div', { class: 'rank-title' }, t.name),
            h('div', { class: 'rating' }, String(p.rating)),
            h('div', { class: 'rank-bar' }, h('div', { class: 'rank-fill', style: `width:${prog * 100}%` })),
            h('div', { class: 'muted small' }, t.next ? `до «${t.next}»: ${t.to - p.rating}` : 'высшее звание'),
          ),
          h(
            'section',
            { class: 'slab' },
            h('div', { class: 'h-label' }, 'Статистика'),
            h(
              'div',
              { class: 'stats' },
              stat('побед', p.wins, 'good'),
              stat('поражений', p.losses, 'bad'),
              stat('ничьих', p.draws),
              stat('винрейт', `${wr}%`),
              stat('серия', p.streak),
              stat('лучшая серия', p.bestStreak),
              stat('фигур сбито', p.captures),
              stat('карт сыграно', p.cardsPlayed),
            ),
            h('div', { class: 'h-label' }, 'Последние партии'),
            p.history.length
              ? h(
                  'div',
                  { class: 'history' },
                  ...p.history.map((r) =>
                    h(
                      'div',
                      { class: `hist hist-${r.result}` },
                      h('span', { class: 'hist-res' }, r.result === 'win' ? 'ПОБЕДА' : r.result === 'loss' ? 'ПОРАЖЕНИЕ' : 'НИЧЬЯ'),
                      h('span', {}, `vs ${r.opponent}`),
                      h('span', { class: 'muted' }, `${r.turns} ход.`),
                      h('span', { class: 'hist-delta' }, r.kind === 'bot' ? `${r.delta >= 0 ? '+' : ''}${r.delta}` : '—'),
                    ),
                  ),
                )
              : h('p', { class: 'muted' }, 'Пока пусто. Сыграйте против Странника.'),
          ),
        ),
      ),
    );
  };
  render();
}
