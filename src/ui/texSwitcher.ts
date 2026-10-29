// Выбор фактуры панелей (пока пользователь не выбрал окончательную): служебная вкладка «ФАКТУРА ▸» у левого края внизу,
// F2 — показать/скрыть. Выбор хранится в textures.ts (localStorage, ?tex=) и применяется перезагрузкой.
import { setTexConcept, TEX_CONCEPTS, TEX_NAMES, texConcept } from '../render/textures';
import { h } from './dom';

const HIDDEN_KEY = 'jedibo.texsw.hidden';
function isHidden() {
  try {
    return localStorage.getItem(HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}
function setHidden(v: boolean) {
  try {
    localStorage.setItem(HIDDEN_KEY, v ? '1' : '0');
  } catch {
    /* приватный режим — живём без сохранения */
  }
}

export function mountTexSwitcher() {
  let open = false;
  const host = h('div', { class: 'vsw' });
  document.body.appendChild(host);

  const opt = (label: string, active: boolean, onClick: () => void) => h('button', { class: `vsw-opt ${active ? 'on' : ''}`, onclick: onClick }, label);

  const render = () => {
    host.hidden = isHidden();
    host.classList.toggle('open', open);
    host.replaceChildren(
      h('button', { class: 'vsw-pill', onclick: () => ((open = !open), render()), title: 'F2 — скрыть/показать' }, open ? 'ФАКТУРА ◂' : 'ФАКТУРА ▸'),
      open
        ? h(
            'div',
            { class: 'vsw-panel' },
            h(
              'div',
              { class: 'vsw-list' },
              ...TEX_CONCEPTS.map((t) => opt(TEX_NAMES[t], texConcept() === t, () => texConcept() !== t && (setTexConcept(t), (location.href = location.pathname)))),
            ),
            h('button', { class: 'vsw-hide', onclick: () => (setHidden(true), render()) }, 'Скрыть плашку (вернуть — F2)'),
          )
        : '',
    );
  };

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'F2') return;
    e.preventDefault();
    if (isHidden()) {
      setHidden(false);
      open = true;
    } else open = !open;
    render();
  });
  render();
}
