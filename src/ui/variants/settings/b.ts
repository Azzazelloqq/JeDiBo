// Настройки, вариант «б»: панель референса, две колонки секций, изменения сохраняются сразу.
import { setVolume } from '../../../audio/sfx';
import { getSettings, saveSettings, type Settings } from '../../../profile/profile';
import { setMood } from '../../../render/background';
import { THEME } from '../../../render/palette';
import { btn, h } from '../../dom';
import { applySettings } from '../../screens/settings';
import { pixelSlider } from '../../widgets';
import { open } from '../registry';
import { arrowNav, section, setRow, swirlBackground, toggleEl } from '../shared';

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

export function settingsB(root: HTMLElement) {
  setMood('menu');
  swirlBackground('inner');
  let off: (() => void) | undefined;
  const render = () => {
    const s = getSettings();
    const m = settingsModel(render);
    const themeBtn = (t: 'dark' | 'light', l: string) => btn(l, () => m.setTheme(t), THEME.scheme === t ? 'b-sel' : '');
    root.replaceChildren(
      h(
        'div',
        { class: 'b-page' },
        h(
          'div',
          { class: 'b-panel b-settings' },
          h('div', { class: 'b-head' }, h('h1', { class: 'b-title' }, 'НАСТРОЙКИ'), h('div', { class: 'b-sub' }, 'ИЗМЕНЕНИЯ СОХРАНЯЮТСЯ СРАЗУ')),
          h(
            'div',
            { class: 'b-cols' },
            h(
              'div',
              { class: 'b-col' },
              section('ЗВУК', setRow('Общая громкость', m.volume())),
              section(
                'КАРТИНКА',
                setRow('ЭЛТ-эффект', toggleEl(s.crt, (v) => m.set({ crt: v }), 'ЭЛТ-эффект'), 'Сканлайны и лёгкое мерцание старого кинескопа.'),
                setRow('Скорость анимаций', m.speed()),
              ),
            ),
            h(
              'div',
              { class: 'b-col' },
              section('ДОСТУПНОСТЬ', setRow('Тряска экрана', toggleEl(s.shake, (v) => m.set({ shake: v }), 'Тряска экрана'), 'Экран вздрагивает при взятиях и ударах Кармы.')),
              // тема — как «ПАЛИТРА» на референсе: две большие кнопки, выбранная синяя
              section('ТЕМА', h('div', { class: 'b-seg-wide' }, themeBtn('dark', 'ТЁМНАЯ'), themeBtn('light', 'СВЕТЛАЯ'))),
            ),
          ),
          h('div', { class: 'b-foot b-foot-center' }, btn('НАЗАД', () => open('menu'), 'b-wide')),
        ),
      ),
    );
  };
  render();
  off = arrowNav(root);
  return () => off?.();
}
