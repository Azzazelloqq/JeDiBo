// Правила, варианты «а» и «б»: слева список разделов (подсвечивается по прокрутке, клик — плавная прокрутка),
// справа текст карточками «мини-доска с анимированным примером + крупная формулировка», под ней пояснение.
// Текст — из текущих правил Классики (screens/rules.ts) и описаний карт, механика не выдумывается.
import { Rank } from '../../../core/types';
import { canvasEl, btn, h } from '../../dom';
import { pieceIcon, tileArt } from '../../widgets';
import { open } from '../registry';
import { DEMOS, demoEl } from '../rulesDemo';
import { A, variantBackground, type Look } from '../shared';

type Item = { demo?: keyof typeof DEMOS; art?: () => Node; big: string; text: string[] };
type Section = { id: string; title: string; items: Item[] };

const SECTIONS: Section[] = [
  {
    id: 'field', title: 'Поле и армия',
    items: [{ demo: 'field', big: 'Поле 12×12. У каждого 12 треугольников, 6 квадратов и 3 круга.', text: ['Расстановка — скрытно, в своих первых трёх рядах. Цвета и первый ход — случайно.'] }],
  },
  {
    id: 'turn', title: 'Ход и очки действий',
    items: [{ demo: 'actions', big: '5 очков действий за ход. Перемещение стоит 1 очко.', text: ['Каждая фигура действует не больше одного раза за ход.', 'Завершить ход вручную можно после хотя бы одного действия.'] }],
  },
  {
    id: 'pieces', title: 'Фигуры и взятие',
    items: [
      {
        demo: 'pieces', big: 'Треугольник — шаг вперёд. Квадрат — 1–3 вперёд, вбок, по диагонали вперёд. Круг — 1–5 в любую сторону.',
        text: ['Треугольник бьёт на 1 вперёд или по диагонали вперёд; квадрат — в те же направления на 1–3; круг — на 1–5 в любую сторону.', 'Промежуточные клетки должны быть свободны: фигура на пути блокирует ход.'],
      },
      { demo: 'attack', big: 'Атака уничтожает фигуру и сжигает все оставшиеся очки.', text: ['Атакующая фигура занимает клетку сбитой. После атаки ход фактически окончен — очков больше нет.'] },
    ],
  },
  {
    id: 'promotion', title: 'Повышение',
    items: [{ demo: 'promotion', big: 'Дошёл до последнего ряда соперника: треугольник → квадрат, квадрат → круг.', text: ['Новая фигура ставится в вашу стартовую зону.', 'Если клетка под ударом — повышение откладывается до вашего следующего хода.'] }],
  },
  {
    id: 'karma', title: 'Карма',
    items: [{ demo: 'karma', big: 'Каждый 7-й собственный ход вы получаете Карту Кармы.', text: ['Карты берутся из колоды матча (21 карта) и открыты обоим игрокам.', '«Сразу» — разыгрываются после получения; «в течение периода» — до конца текущего Периода (7 ходов). Роковые карты занимают ход.'] }],
  },
  {
    id: 'end', title: 'Победа и ничья',
    items: [
      { demo: 'win', big: 'Победа — уничтожить все фигуры соперника.', text: ['Ещё партия заканчивается, если соперник сдался или у него вышло время партии.'] },
      { demo: 'draw', big: 'Ничья — по одной фигуре одного ранга (или по две одинаковых) и три Периода Кармы без изменений.', text: ['Счётчик под полем — прошедшие Периоды без изменений.'] },
    ],
  },
  {
    id: 'time', title: 'Время',
    items: [{ art: () => pieceIcon(Rank.Circle, 'black', 6), big: '5 минут на ход, 60 минут на партию.', text: ['Ход, на который не хватило времени, заканчивается сам. Кончилось время партии — поражение.'] }],
  },
  {
    id: 'modes', title: 'Режимы',
    items: [
      { art: () => canvasEl(tileArt('bot'), 3), big: 'Против Странника — бот, партия идёт в рейтинг.', text: ['Рейтинг и звание видны в Летописи.'] },
      { art: () => canvasEl(tileArt('hotseat'), 3), big: 'Двое за одним компьютером — одно устройство, без рейтинга.', text: ['Перед расстановкой второго игрока экран закрывается шторкой — передайте устройство.'] },
      { art: () => canvasEl(tileArt('net'), 3), big: 'По сети — скоро.', text: ['Дуэль p2p в разработке.'] },
    ],
  },
  {
    id: 'words', title: 'Словарь',
    items: [
      {
        big: 'Короткие определения',
        text: [
          'Очки действий — 5 за ход; перемещение — 1 очко, атака сжигает оставшиеся.',
          'Стартовая зона — ваши первые три ряда; 4-й ряд — следующий за ней.',
          'Период Кармы — 7 ваших ходов; в начале каждого приходит карта.',
          'Колода матча — 21 карта из общей колоды в 34 карты.',
          'Роковая карта — занимает ход: после розыгрыша ход заканчивается.',
        ],
      },
    ],
  },
];

export function rulesV(root: HTMLElement, v: Look) {
  variantBackground(v, 'inner');
  const stops: (() => void)[] = [];
  const navBtns = new Map<string, HTMLElement>();
  const content = h('div', { class: 'vr-content' });
  const nav = h(
    'nav',
    { class: 'vr-nav' },
    ...SECTIONS.map((sec) => {
      const b = btn(sec.title, () => content.querySelector(`#vr-${sec.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 'vr-nav-btn');
      navBtns.set(sec.id, b);
      return b;
    }),
  );
  for (const sec of SECTIONS) {
    content.append(
      h(
        'section',
        { class: 'vr-sec', id: `vr-${sec.id}` },
        h('h2', { class: 'vr-h2' }, sec.title.toUpperCase()),
        ...sec.items.map((it) => {
          let fig: Node | null = null;
          if (it.demo) {
            const d = demoEl(DEMOS[it.demo], it.demo === 'field' ? 3 : 3);
            stops.push(d.stop);
            fig = d.el;
          } else if (it.art) fig = it.art();
          return h(
            'div',
            { class: `vr-card${fig ? '' : ' no-fig'}` },
            fig ? h('div', { class: 'vr-fig' }, fig) : null,
            h('div', { class: 'vr-body' }, h('div', { class: 'vr-big' }, it.big), ...it.text.map((t) => h('p', { class: 'vr-text' }, t))),
          );
        }),
      ),
    );
  }
  // scrollspy: подсвечиваем раздел, чей заголовок ближе всего к верху области прокрутки
  const spy = () => {
    const top = content.getBoundingClientRect().top;
    let cur = SECTIONS[0].id;
    for (const sec of SECTIONS) {
      const el = content.querySelector<HTMLElement>(`#vr-${sec.id}`)!;
      if (el.getBoundingClientRect().top - top < 80) cur = sec.id;
    }
    if (content.scrollTop + content.clientHeight >= content.scrollHeight - 4) cur = SECTIONS[SECTIONS.length - 1].id;
    navBtns.forEach((b, id) => b.classList.toggle('v-tab-on', id === cur));
  };
  content.addEventListener('scroll', spy, { passive: true });

  root.append(
    h(
      'div',
      { class: 'v-page' },
      h(
        'div',
        { class: `v-panel v-rules${A(v, 'slab')}` },
        h('div', { class: `v-head vr-head${A(v, 'page-head')}` }, h('h1', { class: 'v-title' }, 'ПРАВИЛА'), h('div', { class: 'v-sub' }, 'КЛАССИКА · УНИЧТОЖЬТЕ ВСЕ ФИГУРЫ СОПЕРНИКА')),
        h('div', { class: 'vr-body-grid' }, nav, content),
        h('div', { class: 'v-foot' }, btn('НАЗАД', () => open('menu')), btn('КОЛОДА', () => open('codex'))),
      ),
    ),
  );
  requestAnimationFrame(spy);
  return () => stops.forEach((f) => f());
}
