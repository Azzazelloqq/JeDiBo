// Настройки, варианты «а» и «б»: панель референса, две колонки секций, изменения сохраняются сразу.
import { setVolume } from '../../../audio/sfx';
import { getSettings, saveSettings, type Settings } from '../../../profile/profile';
import { THEME } from '../../../render/palette';
import { btn, h } from '../../dom';
import { applySettings } from '../../screens/settings';
import { pixelSlider } from '../../widgets';
import { open } from '../registry';
import { A, arrowNav, section, setRow, toggleEl, variantBackground, type Look } from '../shared';

const SPEEDS = [1, 1.5, 2];

/** Общая модель экрана настроек для вариантов «а» и «б». */
export function settingsModel(rerender: () => void) {
  const set = (p: Partial<Settings>) => {
    saveSettings(p);
    applySettings();
    rerender();
  };
  // тема собирается при загрузке — сохраняем и перезагружаем (экран вернётся тот же)
  const setTheme = (t: NonNullable<Settings['theme']>) => {
    if (t === THEME.scheme) return;
    saveSettings({ theme: t });
    location.href = location.pathname;
  };
  const volume = () =>
    pixelSlider({
      value: Math.round(getSettings().volume * 100), min: 0, max: 100, step: 5, label: 'Общая громкость', format: (v) => `${v}%`,
      onInput: (v) => setVolume(v / 100),
      onChange: (v) => saveSettings({ volume: v / 100 }),
    });
  const speed = () =>
    pixelSlider({
      value: Math.max(0, SPEEDS.indexOf(getSettings().animSpeed)), min: 0, max: 2, step: 1, label: 'Скорость анимаций', format: (i) => `×${SPEEDS[i]}`,
      onChange: (i) => set({ animSpeed: SPEEDS[i] }),
    });
  return { set, setTheme, volume, speed };
}

export function settingsV(root: HTMLElement, v: Look) {
  variantBackground(v, 'inner');
  let off: (() => void) | undefined;
  const render = () => {
    const s = getSettings();
    const m = settingsModel(render);
    const themeBtn = (t: 'dark' | 'light', l: string) => btn(l, () => m.setTheme(t), THEME.scheme === t ? 'v-sel' : '');
    root.replaceChildren(
      h(
        'div',
        { class: 'v-page' },
        h(
          'div',
          { class: `v-panel v-settings${A(v, 'slab')}` },
          h('div', { class: `v-head${A(v, 'page-head')}` }, h('h1', { class: 'v-title' }, 'НАСТРОЙКИ'), h('div', { class: 'v-sub' }, 'ИЗМЕНЕНИЯ СОХРАНЯЮТСЯ СРАЗУ')),
          h(
            'div',
            { class: 'v-cols' },
            h(
              'div',
              { class: 'v-col' },
              section('ЗВУК', setRow('Общая громкость', m.volume())),
              section(
                'КАРТИНКА',
                setRow('ЭЛТ-эффект', toggleEl(s.crt, (v) => m.set({ crt: v }), 'ЭЛТ-эффект'), 'Сканлайны и лёгкое мерцание старого кинескопа.'),
                setRow('Скорость анимаций', m.speed()),
              ),
            ),
            h(
              'div',
              { class: 'v-col' },
              section('ДОСТУПНОСТЬ', setRow('Тряска экрана', toggleEl(s.shake, (v) => m.set({ shake: v }), 'Тряска экрана'), 'Экран вздрагивает при взятиях и ударах Кармы.')),
              // тема — как «ПАЛИТРА» на референсе: две большие кнопки, выбранная синяя
              section('ТЕМА', h('div', { class: 'v-seg-wide' }, themeBtn('dark', 'ТЁМНАЯ'), themeBtn('light', 'СВЕТЛАЯ'))),
            ),
          ),
          h('div', { class: 'v-foot v-foot-center' }, btn('НАЗАД', () => open('menu'), 'v-wide')),
        ),
      ),
    );
  };
  render();
  off = arrowNav(root);
  return () => off?.();
}
