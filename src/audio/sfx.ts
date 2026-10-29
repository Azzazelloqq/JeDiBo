// Синтезированные звуки (WebAudio): камень, щелчки, карты. Без внешних ассетов.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let volume = 0.5;

function ac(): AudioContext | null {
  if (volume <= 0) return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function setVolume(v: number) {
  volume = v;
  if (master) master.gain.value = v;
}

function tone(freq: number, dur: number, type: OscillatorType, gain: number, slide = 0, delay = 0) {
  const a = ac();
  if (!a || !master) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, gain: number, freq: number, q = 1, delay = 0) {
  const a = ac();
  if (!a || !master) return;
  const t = a.currentTime + delay;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(master);
  src.start(t);
}

export const sfx = {
  hover: () => tone(880, 0.03, 'square', 0.03),
  click: () => {
    tone(420, 0.05, 'square', 0.08, -120);
    noise(0.03, 0.15, 2500, 2);
  },
  select: () => tone(660, 0.07, 'triangle', 0.12, 220),
  move: () => {
    noise(0.09, 0.5, 300, 1.4);
    tone(110, 0.08, 'sine', 0.25, -40);
  },
  capture: () => {
    noise(0.35, 0.9, 180, 0.8);
    noise(0.18, 0.5, 1400, 1.5, 0.02);
    tone(70, 0.3, 'sine', 0.5, -30);
  },
  crumble: () => {
    for (let i = 0; i < 4; i++) noise(0.08, 0.35, 400 + i * 300, 1.2, i * 0.04);
  },
  spawn: () => {
    tone(220, 0.12, 'triangle', 0.15, 220);
    noise(0.12, 0.4, 260, 1);
  },
  promote: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.18, 'triangle', 0.12, 0, i * 0.06)),
  cardFlip: () => {
    noise(0.06, 0.3, 3000, 3);
    tone(300, 0.08, 'square', 0.05, 300, 0.03);
  },
  karma: () => {
    [196, 247, 294, 392].forEach((f, i) => tone(f, 0.6, 'sawtooth', 0.04, 0, i * 0.05));
    tone(98, 0.8, 'sine', 0.25);
  },
  stamp: () => {
    noise(0.15, 0.7, 150, 0.7);
    tone(60, 0.2, 'sine', 0.4);
  },
  turn: () => {
    tone(330, 0.1, 'square', 0.06);
    tone(495, 0.14, 'square', 0.06, 0, 0.08);
  },
  error: () => tone(140, 0.15, 'square', 0.08, -40),
  beam: () => {
    tone(1200, 0.6, 'sawtooth', 0.06, -1000);
    noise(0.6, 0.3, 900, 0.6);
  },
  win: () => [392, 523, 659, 784, 1046].forEach((f, i) => tone(f, 0.3, 'square', 0.07, 0, i * 0.09)),
  lose: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.35, 'triangle', 0.1, 0, i * 0.14)),
  tick: () => tone(1500, 0.02, 'square', 0.03),
  /** «тук-тук» в момент ожидания (рулетка почти остановилась) */
  heartbeat: () => {
    tone(70, 0.14, 'sine', 0.4, -20);
    tone(62, 0.16, 'sine', 0.3, -20, 0.17);
  },
  /** новая эмблема Летописи: удар чекана по камню и звонкий перелив */
  emblem: () => {
    noise(0.12, 0.6, 220, 0.8);
    tone(80, 0.18, 'sine', 0.35);
    [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.22, 'square', 0.06, 0, 0.08 + i * 0.07));
    tone(2093, 0.5, 'triangle', 0.08, 0, 0.38);
  },
  // ── Карты Кармы ──
  /** Блицкриг: треск разряда */
  zap: () => {
    for (let i = 0; i < 3; i++) noise(0.07, 0.45, 2600 + i * 900, 2, i * 0.06);
    tone(1800, 0.25, 'sawtooth', 0.05, -1500);
  },
  /** Депрессия: шум дождя и опускающийся гул */
  rain: () => {
    noise(1.1, 0.35, 5200, 0.4);
    tone(196, 0.9, 'triangle', 0.08, -90);
  },
  /** Тихоход: тягучее «вяз-з» */
  slow: () => tone(260, 0.7, 'triangle', 0.12, -180),
  /** Круговая защита: щит раскрывается */
  shield: () => [392, 523, 784].forEach((f, i) => tone(f, 0.25, 'square', 0.05, 40, i * 0.05)),
  /** Прыгун: пружина */
  spring: () => tone(180, 0.22, 'square', 0.07, 520),
  /** Двойная смерть: прицел захватывает цель, затем удар косой */
  lock: () => tone(2200, 0.05, 'square', 0.04, -600),
  slash: () => {
    noise(0.16, 0.7, 3200, 1.2);
    tone(900, 0.18, 'sawtooth', 0.06, -800);
  },
  /** Подарок: коробка лопается */
  pop: () => {
    noise(0.05, 0.6, 1800, 1);
    [784, 1046, 1318].forEach((f, i) => tone(f, 0.14, 'triangle', 0.08, 0, 0.03 + i * 0.05));
  },
  /** Свежая кровь: тяжёлая капля */
  splat: () => {
    noise(0.2, 0.7, 500, 0.9);
    tone(140, 0.16, 'sine', 0.3, -70);
  },
  /** Воскрешение и Карьерный лифт вверх: восходящий свет */
  rise: () => [262, 330, 392, 523, 659].forEach((f, i) => tone(f, 0.4, 'triangle', 0.06, 0, i * 0.07)),
  /** Бессмертие: души слетаются */
  soul: () => {
    noise(0.5, 0.25, 900, 0.5);
    tone(440, 0.5, 'sine', 0.1, 440);
  },
  /** Понижение ранга: груз падает */
  thud: () => {
    noise(0.18, 0.8, 120, 0.7);
    tone(90, 0.22, 'sine', 0.4, -50);
  },
  /** Шпион: помехи */
  glitch: () => {
    for (let i = 0; i < 5; i++) tone(300 + Math.random() * 1200, 0.04, 'square', 0.05, 0, i * 0.06);
  },
  /** Предательство: скрип нитей кукловода */
  creak: () => tone(150, 0.4, 'sawtooth', 0.05, 90),
};
