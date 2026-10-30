// Фоновая музыка: у меню и у партии свои списки треков (src/assets/music/menu и src/assets/music/game),
// каждый играет по кругу. Переходы — мягкие: между треками и между списками — кроссфейд.
// Новый трек — просто положить .mp3/.ogg в нужную папку.

import { masterGain, onMasterVolume } from './master';

export type Playlist = 'menu' | 'game';

const FILES = import.meta.glob<string>('../assets/music/*/*.{mp3,ogg}', { eager: true, query: '?url', import: 'default' });
const list = (name: Playlist) =>
  Object.entries(FILES)
    .filter(([path]) => path.includes(`/music/${name}/`))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, url]) => url);
// пока у партии нет своих треков, она играет музыку меню
const TRACKS: Record<Playlist, string[]> = { menu: list('menu'), game: list('game').length ? list('game') : list('menu') };

const XFADE = 4; // с — переход между треками: конец одного уходит в начало следующего
const SWITCH = 2; // с — смена списка (меню ↔ партия)
const TICK = 50; // мс — шаг громкостных огибающих (setInterval, а не rAF: тот замирает в фоновой вкладке)

/** Играющий трек со своей огибающей: level 0..1 идёт к target со скоростью rate (в долю за секунду). */
interface Voice {
  el: HTMLAudioElement;
  playlist: Playlist;
  level: number;
  target: number;
  rate: number;
}

let voices: Voice[] = [];
let volume = 0.5;
let wanted: Playlist | null = null;
// каждый список начинается со случайного трека, дальше — по порядку
const next: Record<Playlist, number> = { menu: Math.floor(Math.random() * Math.max(1, TRACKS.menu.length)), game: Math.floor(Math.random() * Math.max(1, TRACKS.game.length)) };
let timer = 0;
let waitingGesture = false;
// музыку играет только одна вкладка — видимая и последней тронутая; остальные (другие окна, превью) молчат
let silenced = document.hidden;
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('jedibo-music') : null;

/** Положение ползунка 0..1 → громкость: шкала в децибелах, 100% — полная, 50% — 0.05 (−26 дБ), 0 — тишина. */
export const musicGain = (v: number) => (v <= 0 ? 0 : 10 ** ((-52 * (1 - Math.min(1, v))) / 20));

const apply = (v: Voice) => (v.el.volume = Math.min(1, v.level * musicGain(volume) * masterGain()));

function play(v: Voice) {
  if (silenced) return;
  v.el.play().catch(() => {
    // автозапуск звука браузер разрешает только после действия пользователя — ждём первого клика/клавиши
    if (waitingGesture) return;
    waitingGesture = true;
    const retry = () => {
      waitingGesture = false;
      removeEventListener('pointerdown', retry, true);
      removeEventListener('keydown', retry, true);
      for (const x of voices) if (x.target > 0 && x.el.paused) play(x);
    };
    addEventListener('pointerdown', retry, true);
    addEventListener('keydown', retry, true);
  });
}

/** Все играющие треки уходят за fade с. */
function fadeAll(fade: number) {
  for (const v of voices) {
    v.target = 0;
    v.rate = 1 / fade;
  }
}

/** Следующий трек списка: появляется за fade с, все прежние за то же время уходят. Пустой список — просто тишина. */
function startNext(playlist: Playlist, fade: number) {
  fadeAll(fade);
  const tracks = TRACKS[playlist];
  if (tracks.length) {
    const el = new Audio(tracks[next[playlist]]);
    next[playlist] = (next[playlist] + 1) % tracks.length;
    el.preload = 'auto';
    const v: Voice = { el, playlist, level: 0, target: 1, rate: 1 / fade };
    apply(v);
    voices.push(v);
    play(v);
  }
  run();
}

function tick() {
  const dt = TICK / 1000;
  for (const v of voices) {
    // пока браузер не дал начать воспроизведение, огибающая стоит — иначе трек стартует сразу громко
    if (v.el.paused && v.target > v.level) continue;
    v.level = v.target > v.level ? Math.min(v.target, v.level + v.rate * dt) : Math.max(v.target, v.level - v.rate * dt);
    apply(v);
  }
  const cur = voices[voices.length - 1];
  if (cur && cur.playlist === wanted && cur.target > 0 && !cur.el.paused && Number.isFinite(cur.el.duration) && cur.el.duration - cur.el.currentTime <= XFADE) startNext(cur.playlist, XFADE);
  voices = voices.filter((v) => {
    if (v.target > 0 || v.level > 0) return true;
    v.el.pause();
    v.el.removeAttribute('src');
    v.el.load();
    return false;
  });
  if (!voices.length) {
    clearInterval(timer);
    timer = 0;
  }
}

function run() {
  if (!timer) timer = window.setInterval(tick, TICK);
}

/** Сменить список (мягко); null — тишина. Повторный вызов с тем же списком ничего не делает. */
export function setMusic(playlist: Playlist | null) {
  if (playlist === wanted) return;
  wanted = playlist;
  if (!playlist) {
    fadeAll(SWITCH);
    return;
  }
  const cur = voices[voices.length - 1];
  // трек есть и в новом списке (общая музыка) или вернулись, пока он ещё затихал, — он и продолжает звучать, без перезапуска
  if (cur && cur.level > 0 && (cur.playlist === playlist || TRACKS[playlist].includes(cur.el.getAttribute('src') ?? ''))) {
    fadeAll(SWITCH);
    cur.playlist = playlist;
    cur.target = 1;
    run();
  } else startNext(playlist, SWITCH);
}

function silence(on: boolean) {
  if (silenced === on) return;
  silenced = on;
  for (const v of voices) {
    if (on) v.el.pause();
    else if (v.target > 0) play(v);
  }
}

/** Эта вкладка забирает музыку себе — остальные замолкают. */
function claim() {
  if (document.hidden) return;
  channel?.postMessage('claim');
  silence(false);
}

channel?.addEventListener('message', () => silence(true));
const onVisibility = () => (document.hidden ? silence(true) : claim());
document.addEventListener('visibilitychange', onVisibility);
addEventListener('focus', claim);
addEventListener('pointerdown', claim, true);
claim();

export function setMusicVolume(v: number) {
  volume = v;
  for (const x of voices) apply(x);
}

const offMaster = onMasterVolume(() => setMusicVolume(volume));

// при правке этого файла Vite подменяет модуль на лету — старые треки иначе остались бы играть без хозяина
import.meta.hot?.dispose(() => {
  offMaster();
  clearInterval(timer);
  channel?.close();
  document.removeEventListener('visibilitychange', onVisibility);
  removeEventListener('focus', claim);
  removeEventListener('pointerdown', claim, true);
  for (const v of voices) {
    v.el.pause();
    v.el.removeAttribute('src');
  }
  voices = [];
});
