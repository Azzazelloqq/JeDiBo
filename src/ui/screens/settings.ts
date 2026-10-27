import { setVolume } from '../../audio/sfx';
import { getSettings, saveSettings, type Settings } from '../../profile/profile';
import { setMood } from '../../render/background';
import { setShakeEnabled } from '../../render/fx';
import { setAnimSpeed } from '../../render/tween';
import { go } from '../app';
import { btn, h } from '../dom';
import { menuScreen } from './menu';

export function applySettings(s: Settings = getSettings()) {
  setVolume(s.volume);
  setShakeEnabled(s.shake);
  setAnimSpeed(s.animSpeed);
  document.body.classList.toggle('no-crt', !s.crt);
}

export function settingsScreen(root: HTMLElement) {
  setMood('menu');
  const render = () => {
    const s = getSettings();
    const set = (p: Partial<Settings>) => {
      saveSettings(p);
      applySettings();
      render();
    };
    const toggle = (label: string, v: boolean, on: () => void) =>
      h('div', { class: 'set-row' }, h('span', {}, label), btn(v ? 'ВКЛ' : 'ВЫКЛ', on, v ? 'btn-red btn-small' : 'btn-dark btn-small'));
    const choice = (label: string, opts: [string, number][], v: number, on: (x: number) => void) =>
      h('div', { class: 'set-row' }, h('span', {}, label), h('div', { class: 'seg' }, ...opts.map(([l, x]) => btn(l, () => on(x), x === v ? 'btn-amber btn-small' : 'btn-dark btn-small'))));
    root.replaceChildren(
      h(
        'div',
        { class: 'page narrow' },
        h('div', { class: 'page-head' }, h('h1', {}, 'Настройки'), btn('В меню', () => go(menuScreen))),
        h(
          'section',
          { class: 'slab settings' },
          choice('Громкость', [['0', 0], ['25', 0.25], ['50', 0.5], ['100', 1]], s.volume, (x) => set({ volume: x })),
          toggle('ЭЛТ-эффект', s.crt, () => set({ crt: !s.crt })),
          toggle('Тряска экрана', s.shake, () => set({ shake: !s.shake })),
          choice('Скорость анимаций', [['×1', 1], ['×1.5', 1.5], ['×2', 2]], s.animSpeed, (x) => set({ animSpeed: x })),
        ),
      ),
    );
  };
  render();
}
