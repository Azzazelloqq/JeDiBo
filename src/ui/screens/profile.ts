// Профиль: слева — карточка игрока (аватар, имя, звание, рейтинг) и история партий,
// справа — статистика и эмблемы Летописи (profile/emblems.ts).
import { chronicleSummary, EMBLEMS, unlockedEmblems } from '../../profile/emblems';
import { getProfile, saveProfile, type MatchRecord } from '../../profile/profile';
import { emblemIcon } from '../../render/emblemArt';
import { setMood } from '../../render/background';
import { open } from '../nav';
import { btn, canvasEl, h } from '../dom';
import { avatarEl } from '../widgets';

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
function dayLabel(at: number) {
  const d = new Date(at);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(new Date()) - start(d)) / 86400000);
  if (diff === 0) return 'сегодня';
  if (diff === 1) return 'вчера';
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

const RESULT = { win: 'Победа', loss: 'Поражение', draw: 'Ничья' } as const;
/** Вид партии вместо имени соперника: против бота имя не нужно, по сети — живой соперник. */
const modeLabel = (r: MatchRecord) => (r.kind === 'bot' ? 'против Странника' : r.kind === 'net' ? `по сети · ${r.opponent}` : 'двое за столом');

export function profileScreen(root: HTMLElement) {
  setMood('menu');
  const render = () => {
    const p = getProfile();
    const sum = chronicleSummary(p);
    const t = sum.title;
    const games = p.wins + p.losses + p.draws;
    const wr = games ? Math.round((p.wins / games) * 100) : 0;
    const name = h('input', { class: 'name-input', value: p.name, maxLength: 16, spellcheck: false, 'aria-label': 'Имя' });
    name.addEventListener('change', () => {
      saveProfile({ name: name.value.trim() || p.name });
    });
    const stat = (label: string, v: string | number, cls = '') => h('div', { class: `stat ${cls}` }, h('div', { class: 'stat-v' }, String(v)), h('div', { class: 'stat-l' }, label));
    const have = unlockedEmblems(p);
    // открытые — первыми, внутри — в порядке списка
    const emblems = [...EMBLEMS].sort((a, b) => Number(!have[a.id]) - Number(!have[b.id]));
    root.replaceChildren(
      h(
        'div',
        { class: 'page' },
        h('div', { class: 'page-head' }, h('h1', {}, 'Профиль'), h('div', { class: 'page-sub' }, 'Хранится в этом браузере'), btn('В меню', () => open('menu'))),
        h(
          'div',
          { class: 'profile-grid' },
          h(
            'div',
            { class: 'profile-col' },
            h(
              'section',
              { class: 'slab profile-card' },
              h('div', { class: 'avatar-frame' }, avatarEl(p.avatarSeed, 12)),
              btn('Новый аватар', () => {
                saveProfile({ avatarSeed: `${p.name}${Math.random()}` });
                render();
              }, 'btn-dark btn-small'),
              name,
              h('div', { class: 'rank-title' }, t.name),
              h('div', { class: 'rating' }, String(p.rating)),
              h('div', { class: 'rank-bar' }, h('div', { class: 'rank-fill', style: `width:${sum.progress * 100}%` })),
              h('div', { class: 'muted small' }, t.next ? `до «${t.next}»: ${t.to - p.rating}` : 'высшее звание'),
            ),
            h(
              'section',
              { class: 'slab' },
              h('div', { class: 'h-label' }, 'Последние партии'),
              p.history.length
                ? h(
                    'div',
                    { class: 'history' },
                    ...p.history.map((r) =>
                      h(
                        'div',
                        { class: `hist hist-${r.result}` },
                        h('span', { class: 'hist-res' }, RESULT[r.result]),
                        h('span', { class: 'hist-mode' }, modeLabel(r)),
                        h('span', { class: 'muted hist-date' }, dayLabel(r.at)),
                        h('span', { class: 'hist-delta' }, r.kind !== 'hotseat' ? `${r.delta > 0 ? '+' : r.delta < 0 ? '−' : '±'}${Math.abs(r.delta)}` : '—'),
                      ),
                    ),
                  )
                : h('p', { class: 'muted' }, 'Пока пусто. Сыграйте против Странника.'),
            ),
          ),
          h(
            'div',
            { class: 'profile-col' },
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
            ),
            h(
              'section',
              { class: 'slab' },
              h('div', { class: 'emb-head' }, h('div', { class: 'h-label' }, 'Эмблемы'), h('div', { class: 'muted small' }, `открыто ${sum.count} из ${sum.total} · очков ${sum.points} из ${sum.maxPoints}`)),
              h(
                'div',
                { class: 'emblems' },
                ...emblems.map((em) =>
                  h(
                    'div',
                    { class: `emb ${have[em.id] ? 'got' : 'locked'}`, title: have[em.id] ? `открыта ${dayLabel(have[em.id])}` : 'ещё не открыта' },
                    canvasEl(emblemIcon(em.id, em.tier, !have[em.id]), 3, 'emb-icon'),
                    h('div', { class: 'emb-body' }, h('div', { class: 'emb-name' }, em.name), h('div', { class: 'emb-desc' }, em.desc)),
                    h('div', { class: `emb-tier t-${em.points}` }, em.tier),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  };
  render();
}
