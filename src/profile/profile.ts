// Мини-профиль игрока: имя, аватар, рейтинг, статистика, история. Хранится в localStorage.

export interface MatchRecord {
  at: number;
  opponent: string;
  kind: 'bot' | 'hotseat' | 'net';
  result: 'win' | 'loss' | 'draw';
  delta: number;
  turns: number;
  /** Расширенная история для Летописи (задача B); у старых записей полей нет — они валидны. */
  ownTurns?: number;
  karmaReceived?: number;
  piecesLost?: number;
  piecesTotal?: number;
  promotions?: number;
  cardsPlayed?: number;
  mode?: 'classic';
}

export interface Profile {
  name: string;
  avatarSeed: string;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
  streak: number;
  bestStreak: number;
  captures: number;
  cardsPlayed: number;
  history: MatchRecord[];
  /** последний выбранный уровень Странника */
  botLevel?: string;
  /** Открытые эмблемы Летописи: id → время открытия (profile/emblems.ts). */
  emblems?: Record<string, number>;
  /** обучение пройдено или пропущено — само больше не открывается */
  tutorialDone?: boolean;
}

export interface Settings {
  /** общая громкость, множитель поверх звуков и музыки, 0..1 */
  masterVolume: number;
  volume: number;
  /** громкость фоновой музыки меню, 0..1 */
  musicVolume: number;
  crt: boolean;
  /** Тема применяется при загрузке (render/palette.ts); смена — перезагрузка страницы. */
  theme?: 'dark' | 'light';
  shake: boolean;
  animSpeed: number;
  /** версия шкал громкости (audio/sfx.ts, audio/music.ts): при смене шкалы ползунки сбрасываются на 50% */
  audioScale?: number;
}

const AUDIO_SCALE = 2;

const PKEY = 'jedibo.profile.v1';
const SKEY = 'jedibo.settings.v1';

const NAMES = ['Каменщик', 'Прораб', 'Гранит', 'Монолит', 'Арматура', 'Опалубка', 'Щебень', 'Брусчатка'];

function read<T>(k: string): T | null {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
function write(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    // приватный режим — живём без сохранения
  }
}

export function defaultProfile(): Profile {
  const name = NAMES[Math.floor(Math.random() * NAMES.length)];
  return { name, avatarSeed: name + Date.now(), rating: 1000, wins: 0, losses: 0, draws: 0, streak: 0, bestStreak: 0, captures: 0, cardsPlayed: 0, history: [] };
}

const stored = read<Profile>(PKEY);
let profile: Profile = { ...defaultProfile(), ...(stored ?? {}) };
if (!stored) write(PKEY, profile);
let settings: Settings = { masterVolume: 1, volume: 0.5, musicVolume: 0.5, crt: true, shake: true, animSpeed: 1, ...(read<Settings>(SKEY) ?? {}) };
// прежние значения ползунков на новой шкале звучали бы иначе — 50/50 теперь и есть выверенный баланс
if (settings.audioScale !== AUDIO_SCALE) settings = { ...settings, volume: 0.5, musicVolume: 0.5, audioScale: AUDIO_SCALE };

export const getProfile = () => profile;
export const getSettings = () => settings;

export function saveProfile(p: Partial<Profile>) {
  profile = { ...profile, ...p };
  write(PKEY, profile);
}
export function saveSettings(s: Partial<Settings>) {
  settings = { ...settings, ...s };
  write(SKEY, settings);
}

export const TITLES: [number, string][] = [
  [0, 'Щебень'],
  [900, 'Бетон'],
  [1100, 'Гранит'],
  [1300, 'Базальт'],
  [1500, 'Монолит'],
];

export function titleOf(r: number) {
  let i = 0;
  TITLES.forEach((t, j) => r >= t[0] && (i = j));
  const next = TITLES[i + 1];
  return { name: TITLES[i][1], from: TITLES[i][0], to: next?.[0] ?? TITLES[i][0] + 200, next: next?.[1] ?? null };
}

/** Эло: против бота — его фиксированный рейтинг, по сети — рейтинг соперника из его профиля; хотсит рейтинг не меняет. Возвращает дельту. */
export function recordMatch(rec: Omit<MatchRecord, 'delta' | 'at'>, stats: { captures: number; cards: number }, oppRating = 1000): number {
  const p = profile;
  let delta = 0;
  if (rec.kind !== 'hotseat') {
    const exp = 1 / (1 + 10 ** ((oppRating - p.rating) / 400));
    const score = rec.result === 'win' ? 1 : rec.result === 'draw' ? 0.5 : 0;
    delta = Math.round(32 * (score - exp));
  }
  const streak = rec.result === 'win' ? p.streak + 1 : 0;
  saveProfile({
    rating: p.rating + delta,
    wins: p.wins + (rec.result === 'win' ? 1 : 0),
    losses: p.losses + (rec.result === 'loss' ? 1 : 0),
    draws: p.draws + (rec.result === 'draw' ? 1 : 0),
    streak,
    bestStreak: Math.max(p.bestStreak, streak),
    captures: p.captures + stats.captures,
    cardsPlayed: p.cardsPlayed + stats.cards,
    history: [{ ...rec, delta, at: Date.now() }, ...p.history].slice(0, 40),
  });
  return delta;
}
