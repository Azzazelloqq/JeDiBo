import { setVolume } from '../../audio/sfx';
import { getSettings, saveSettings, type Settings } from '../../profile/profile';
import { setMood } from '../../render/background';
import { THEME } from '../../render/palette';
import { setShakeEnabled } from '../../render/fx';
import { setAnimSpeed } from '../../render/tween';
import { open } from '../nav';
import { btn, h } from '../dom';
import { pixelSlider } from '../widgets';

export function applySettings(s: Settings = getSettings()) {
  setVolume(s.volume);
  setShakeEnabled(s.shake);
  setAnimSpeed(s.animSpeed);
  document.body.classList.toggle('no-crt', !s.crt);
}

export interface SettingsOpts {
  /** перед перезагрузкой ради смены темы: партия сохраняет себя, чтобы продолжиться после неё */
  beforeReload?: () => void;
  /** тему сейчас сменить нельзя — вместо переключателя пояснение */
  themeLocked?: string;
}

/** Панель настроек — на экране «Настройки» и в окне поверх партии. Перерисовывает себя на месте. */
export function settingsPanel(opts: SettingsOpts = {}): HTMLElement {
  const el = h('section', { class: 'slab settings' });
  const render = () => {
    const s = getSettings();
    const set = (p: Partial<Settings>) => {
      saveSettings(p);
      applySettings();
      render();
    };
    // вкл/выкл — такой же переключатель из двух кнопок, как выбор темы и скорости: выбранное — янтарное
    const toggle = (label: string, v: boolean, on: () => void) =>
      h('div', { class: 'set-row' }, h('span', {}, label), h('div', { class: 'seg' }, ...([['Вкл', true], ['Выкл', false]] as const).map(([l, x]) => btn(l, () => x !== v && on(), x === v ? 'btn-amber btn-small' : 'btn-dark btn-small'))));
    const choice = (label: string, opts: [string, number][], v: number, on: (x: number) => void) =>
      h('div', { class: 'set-row' }, h('span', {}, label), h('div', { class: 'seg' }, ...opts.map(([l, x]) => btn(l, () => on(x), x === v ? 'btn-amber btn-small' : 'btn-dark btn-small'))));
    const choiceStr = (label: string, opts: [string, string][], v: string, on: (x: string) => void) =>
      h('div', { class: 'set-row' }, h('span', {}, label), h('div', { class: 'seg' }, ...opts.map(([l, x]) => btn(l, () => x !== v && on(x), x === v ? 'btn-amber btn-small' : 'btn-dark btn-small'))));
    // тема собирается при загрузке (палитра, спрайты, стили, кэши картинок) — сохраняем и перезагружаем без параметров в адресе
    const reloadWith = (p: Partial<Settings>) => {
      saveSettings({ theme: THEME.scheme, ...p });
      opts.beforeReload?.();
      location.href = location.pathname;
    };
    el.replaceChildren(
      h(
        'div',
        { class: 'set-row' },
        h('span', {}, 'Громкость'),
        pixelSlider({
          value: Math.round(s.volume * 100),
          min: 0,
          max: 100,
          step: 5,
          label: 'Громкость',
          format: (v) => `${v}%`,
          // громкость меняется сразу, сохраняется — когда ползунок отпустили (без перерисовки панели)
          onInput: (v) => setVolume(v / 100),
          onChange: (v) => saveSettings({ volume: v / 100 }),
        }),
      ),
      opts.themeLocked
        ? h('div', { class: 'set-row' }, h('span', {}, 'Тема'), h('span', { class: 'set-note' }, opts.themeLocked))
        : choiceStr('Тема', [['Тёмная', 'dark'], ['Светлая', 'light']], THEME.scheme, (x) => reloadWith({ theme: x as Settings['theme'] })),
      toggle('ЭЛТ-эффект', s.crt, () => set({ crt: !s.crt })),
      toggle('Тряска экрана', s.shake, () => set({ shake: !s.shake })),
      choice('Скорость анимаций', [['×1', 1], ['×1.5', 1.5], ['×2', 2]], s.animSpeed, (x) => set({ animSpeed: x })),
    );
  };
  render();
  return el;
}

export function settingsScreen(root: HTMLElement) {
  setMood('menu');
  root.replaceChildren(h('div', { class: 'page narrow' }, h('div', { class: 'page-head' }, h('h1', {}, 'Настройки'), btn('В меню', () => open('menu'), 'btn-dark')), settingsPanel()));
}
