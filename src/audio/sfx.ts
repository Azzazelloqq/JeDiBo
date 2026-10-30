// Синтезированные звуки (WebAudio): камень, щелчки, карты. Без внешних ассетов.

import { masterGain, onMasterVolume } from './master';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let volume = 0.5;

/** Положение ползунка 0..1 → усиление: 50% — исходная громкость звуков (×1), 100% — ×2 (пики срезает лимитер). */
export const sfxGain = (v: number) => 2 * Math.max(0, v);

const gain = () => sfxGain(volume) * masterGain();

function ac(): AudioContext | null {
  if (gain() <= 0) return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = gain();
      // лимитер: выше ×1 наложившиеся удары иначе хрипели бы
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.1;
      master.connect(limiter).connect(ctx.destination);
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function setVolume(v: number) {
  volume = v;
  if (master) master.gain.value = gain();
}

const offMaster = onMasterVolume(() => setVolume(volume));
import.meta.hot?.dispose(offMaster);

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

/** Голос с атакой и спадом: скольжение частоты (to), вибрато (vib: [Гц, доля частоты]). Для звуков, привязанных к анимации. */
export function voice(o: { f: number; dur: number; gain: number; type?: OscillatorType; to?: number; attack?: number; delay?: number; vib?: [number, number] }) {
  const a = ac();
  if (!a || !master) return;
  const t = a.currentTime + (o.delay ?? 0);
  const end = t + o.dur;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.f, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), end);
  const att = Math.min(o.attack ?? 0.005, o.dur * 0.9);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(o.gain, t + att);
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  if (o.vib) {
    const lfo = a.createOscillator();
    const depth = a.createGain();
    lfo.frequency.value = o.vib[0];
    depth.gain.value = o.f * o.vib[1];
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(t);
    lfo.stop(end + 0.02);
  }
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(end + 0.02);
}

/** Шум через полосовой фильтр, частота фильтра может скользить (to) — свист, шорох, удар, дождь. */
export function hiss(o: { dur: number; gain: number; f: number; to?: number; q?: number; attack?: number; delay?: number }) {
  const a = ac();
  if (!a || !master) return;
  const t = a.currentTime + (o.delay ?? 0);
  const end = t + o.dur;
  const len = Math.max(1, Math.floor(a.sampleRate * o.dur));
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.setValueAtTime(o.f, t);
  if (o.to) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), end);
  f.Q.value = o.q ?? 1;
  const g = a.createGain();
  const att = Math.min(o.attack ?? 0.003, o.dur * 0.9);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(o.gain, t + att);
  g.gain.exponentialRampToValueAtTime(0.0001, end);
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
  // ── сжатие поля ──
  /** край выделен: двухтоновая сирена поверх низкого гула */
  shrinkWarn: () => {
    for (let i = 0; i < 3; i++) {
      voice({ f: 660, to: 520, dur: 0.22, gain: 0.07, type: 'square', delay: i * 0.3 });
      voice({ f: 440, to: 350, dur: 0.22, gain: 0.07, type: 'square', delay: i * 0.3 + 0.15 });
    }
    voice({ f: 55, to: 45, dur: 1.1, gain: 0.3, attack: 0.2 });
    hiss({ dur: 1, gain: 0.25, f: 120, to: 70, q: 0.8, attack: 0.3 });
  },
  /** последний ход перед сжатием: частые писки и «тук-тук» */
  shrinkLast: () => {
    for (let i = 0; i < 4; i++) voice({ f: 990, dur: 0.07, gain: 0.07, type: 'square', delay: i * 0.11 });
    voice({ f: 70, to: 50, dur: 0.14, gain: 0.4, delay: 0.5 });
    voice({ f: 62, to: 45, dur: 0.16, gain: 0.3, delay: 0.67 });
  },
  /** плиты края дрожат: нарастающий подземный гул */
  rumble: () => {
    hiss({ dur: 1.4, gain: 0.55, f: 90, to: 60, q: 0.6, attack: 0.35 });
    voice({ f: 42, to: 34, dur: 1.4, gain: 0.35, attack: 0.3, vib: [9, 0.08] });
    for (let i = 0; i < 6; i++) noise(0.05, 0.18, 700 + i * 200, 2, 0.1 + i * 0.07);
  },
  /** край обрушивается: долгий шорох камня и падение тона в пропасть */
  collapse: () => {
    hiss({ dur: 1.2, gain: 0.5, f: 500, to: 120, q: 0.7, attack: 0.05 });
    voice({ f: 120, to: 30, dur: 1.1, gain: 0.3, type: 'triangle' });
  },
  /** одна плита сорвалась */
  tileDrop: () => {
    noise(0.12, 0.35, 260 + Math.random() * 300, 1.2);
    voice({ f: 180 + Math.random() * 60, to: 60, dur: 0.18, gain: 0.12, type: 'triangle' });
  },
  /** обломки легли на дно */
  thud: () => {
    noise(0.4, 0.9, 110, 0.7);
    voice({ f: 60, to: 32, dur: 0.45, gain: 0.55 });
  },
  /** поле 6×6: аккорд «все бьют во все стороны» */
  shrinkFinal: () => {
    [262, 330, 392, 523].forEach((f, i) => voice({ f, dur: 0.9, gain: 0.05, type: 'sawtooth', attack: 0.02, delay: i * 0.05 }));
    voice({ f: 65, to: 98, dur: 0.6, gain: 0.35, attack: 0.02 });
    [1046, 1318, 1568].forEach((f, i) => tone(f, 0.25, 'square', 0.05, 0, 0.35 + i * 0.08));
  },
  /** новая эмблема Летописи: удар чекана по камню и звонкий перелив */
  emblem: () => {
    noise(0.12, 0.6, 220, 0.8);
    tone(80, 0.18, 'sine', 0.35);
    [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.22, 'square', 0.06, 0, 0.08 + i * 0.07));
    tone(2093, 0.5, 'triangle', 0.08, 0, 0.38);
  },
};
