// Звуки анимаций Карт Кармы. Каждый звук — под свою стадию анимации на поле (render/board.ts):
// падение, удар, вспышка. Длительности и задержки идут за скоростью анимаций, чтобы звук не убегал от картинки.
import { animSpeed } from '../render/tween';
import { hiss, sfx, voice } from './sfx';

/** секунды анимации → секунды звука при текущей скорости */
const s = (sec: number) => sec / animSpeed();
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** короткий удар по камню: глухой тон + щелчок шума */
function knock(gain: number, delay = 0, pitch = 1) {
  voice({ f: 170 * pitch, to: 95 * pitch, dur: 0.09, gain: 0.3 * gain, type: 'triangle', delay });
  hiss({ f: 1100 * pitch, dur: 0.045, gain: 0.35 * gain, q: 1.4, delay });
}

export const ksfx = {
  // ── Подарок: коробка падает и отскакивает, дрожит, лопается ──
  giftFall() {
    voice({ f: 1500, to: 480, dur: s(0.16), gain: 0.04, attack: s(0.12) });
    // удары outBounce за 440 мс: 160, 320, 400, 440
    [0.16, 0.32, 0.4, 0.44].forEach((t, i) => knock([1, 0.55, 0.3, 0.18][i], s(t), 1.25));
  },
  giftRattle() {
    for (let i = 0; i < 4; i++) {
      hiss({ f: rnd(1300, 1800), dur: 0.035, gain: 0.25, q: 2, delay: s(i * 0.075) });
      voice({ f: rnd(240, 300), dur: 0.03, gain: 0.04, type: 'square', delay: s(i * 0.075) });
    }
  },
  giftPop() {
    hiss({ f: 2200, dur: 0.07, gain: 0.8, q: 0.8 });
    voice({ f: 380, to: 1500, dur: 0.07, gain: 0.08 });
    [784, 988, 1175, 1568].forEach((f, i) => voice({ f, dur: 0.22, gain: 0.07, type: 'triangle', delay: 0.05 + i * 0.055 }));
    for (let i = 0; i < 7; i++) voice({ f: rnd(2600, 4200), dur: 0.05, gain: 0.025, delay: rnd(0.1, 0.6) });
  },

  // ── Свежая кровь: тихий низкий выдох, когда карта начала действовать; густая вязкая капля в момент удара ──
  bloodCue() {
    hiss({ f: 600, to: 240, dur: 0.7, gain: 0.32, q: 2, attack: 0.45 });
    voice({ f: 65, dur: 0.7, gain: 0.14, type: 'triangle', attack: 0.4 });
  },
  splat() {
    voice({ f: 150, to: 48, dur: 0.2, gain: 0.55 });
    hiss({ f: 260, dur: 0.18, gain: 0.5, q: 2.5 });
    hiss({ f: 1800, dur: 0.03, gain: 0.12, q: 1.5 });
  },

  // ── Воскрешение: столп света с хором, фигура опускается, колокол ──
  holyPillar() {
    const d = s(1.15);
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => voice({ f, dur: d, gain: 0.04, type: 'triangle', attack: s(0.3), delay: i * 0.02, vib: [5, 0.006] }));
    voice({ f: 2093, dur: d, gain: 0.018, attack: s(0.45), vib: [9, 0.01] });
    voice({ f: 130.8, dur: d, gain: 0.12, attack: s(0.2) });
    hiss({ f: 6000, dur: d, gain: 0.06, q: 0.6, attack: s(0.4) });
  },
  holyLand() {
    voice({ f: 1046.5, dur: 1.1, gain: 0.11 });
    voice({ f: 2093, dur: 0.7, gain: 0.05 });
    voice({ f: 3136, dur: 0.4, gain: 0.025 });
  },

  // ── Бессмертие: души слетаются вихрем, фигура собирается со звоном стекла ──
  soulSwirl() {
    const d = s(0.72);
    hiss({ f: 300, to: 2800, dur: d, gain: 0.45, q: 3, attack: d * 0.85 });
    voice({ f: 330, to: 990, dur: d, gain: 0.06, attack: d * 0.8, vib: [7, 0.03] });
    voice({ f: 495, to: 1485, dur: d, gain: 0.03, attack: d * 0.8, vib: [6, 0.03] });
  },
  soulForm() {
    [880, 1318.5, 1760].forEach((f, i) => voice({ f, dur: 0.7, gain: 0.07, delay: i * 0.03 }));
    hiss({ f: 4200, dur: 0.12, gain: 0.25, q: 4 });
    voice({ f: 110, dur: 0.5, gain: 0.12, attack: 0.05 });
  },

  // ── Двойная смерть: прицел пищит, стягиваясь, два взмаха косой, разлом ──
  lockOn() {
    [1300, 1500, 1700].forEach((f, i) => voice({ f, dur: 0.035, gain: 0.04, type: 'square', delay: s(i * 0.09) }));
    voice({ f: 2400, dur: 0.07, gain: 0.05, type: 'square', delay: s(0.27) });
    voice({ f: 2400, dur: 0.07, gain: 0.05, type: 'square', delay: s(0.27) + 0.09 });
  },
  slash() {
    for (const delay of [0, s(0.085)]) {
      hiss({ f: 5200, to: 1100, dur: 0.13, gain: 0.7, q: 1.5, attack: 0.03, delay });
      voice({ f: 1500, to: 280, dur: 0.11, gain: 0.03, type: 'sawtooth', delay });
    }
  },
  reapBreak() {
    hiss({ f: 190, dur: 0.45, gain: 0.9, q: 0.8 });
    voice({ f: 72, to: 34, dur: 0.5, gain: 0.5 });
    for (let i = 0; i < 4; i++) hiss({ f: 450 + i * 320, dur: 0.08, gain: 0.3, q: 1.2, delay: 0.04 + i * 0.045 });
  },

  // ── Карьерный лифт вверх: подъём, звонок «приехали», мягкая посадка ──
  liftRise() {
    voice({ f: 220, to: 440, dur: s(0.26), gain: 0.045, type: 'square' });
    hiss({ f: 600, to: 1600, dur: s(0.26), gain: 0.15, q: 2, attack: s(0.1) });
  },
  liftDing() {
    voice({ f: 1318.5, dur: 0.55, gain: 0.1 });
    voice({ f: 1046.5, dur: 0.75, gain: 0.1, delay: s(0.14) });
  },
  liftLand() {
    knock(0.7, 0, 0.9);
  },

  // ── Понижение: шевроны со свистом падают, тяжёлый удар, фигура оседает ──
  pressFall() {
    for (let i = 0; i < 3; i++) voice({ f: 950, to: 320, dur: s(0.3) - s(i * 0.04), gain: 0.025, type: 'square', delay: s(i * 0.04) });
  },
  pressHit(enemy: boolean) {
    hiss({ f: 140, dur: 0.28, gain: 0.95, q: 0.7 });
    voice({ f: 84, to: 40, dur: 0.32, gain: 0.5 });
    hiss({ f: 2600, dur: 0.05, gain: 0.3, q: 3 });
    // оседание: «уа-а» вниз; у Девальвации — с недобрым тритоном
    voice({ f: 230, to: 92, dur: s(0.36), gain: 0.05, type: 'sawtooth', delay: 0.04 });
    if (enemy) voice({ f: 325, to: 130, dur: s(0.36), gain: 0.03, type: 'sawtooth', delay: 0.04 });
  },

  // ── Шпион: помехи на каждом мерцании, щелчок переключения ──
  glitchTick() {
    voice({ f: rnd(300, 1900), dur: 0.035, gain: 0.045, type: 'square' });
    hiss({ f: 6500, dur: 0.02, gain: 0.15 });
  },
  turnSide() {
    voice({ f: 392, to: 784, dur: 0.12, gain: 0.05, type: 'square' });
    voice({ f: 784, to: 1175, dur: 0.14, gain: 0.04, type: 'square', delay: 0.09 });
    hiss({ f: 1500, dur: 0.1, gain: 0.2, q: 1.5 });
  },

  // ── Отступление: фигура скребёт по камню, отъезжая назад ──
  scrape() {
    hiss({ f: 1150, to: 340, dur: s(0.3), gain: 0.45, q: 1.2, attack: 0.03 });
    voice({ f: 140, to: 88, dur: s(0.3), gain: 0.05, type: 'triangle' });
  },

  // ── Предательство: щипок нитей, скрип при подъёме и раскачке ──
  twang(up = false) {
    const f = up ? 262 : 196;
    voice({ f, to: f * 0.97, dur: 0.35, gain: 0.16, type: 'triangle' });
    voice({ f: f * 2, dur: 0.22, gain: 0.05 });
    voice({ f: f * 3.01, dur: 0.12, gain: 0.025 });
  },
  creak(sec: number, after = 0) {
    voice({ f: 120, to: 190, dur: s(sec), gain: 0.04, type: 'sawtooth', vib: [14, 0.08], delay: s(after) });
  },

  // ── Блицкриг: треск каждой молнии, гром, рывки фигуры ──
  bolts() {
    [0, 0.126, 0.252].forEach((t) => {
      hiss({ f: 3600, dur: 0.18, gain: 0.7, q: 0.7, delay: s(t) });
      voice({ f: 2500, to: 280, dur: 0.15, gain: 0.05, type: 'square', delay: s(t) });
      for (let i = 0; i < 4; i++) hiss({ f: 5200, dur: 0.02, gain: 0.3, q: 2, delay: s(t) + rnd(0, 0.12) });
    });
    hiss({ f: 110, to: 70, dur: 1.1, gain: 0.9, q: 0.6, attack: 0.06, delay: s(0.3) });
  },
  dash() {
    hiss({ f: 800, to: 3200, dur: 0.18, gain: 0.35, q: 1.5, attack: 0.02 });
    voice({ f: 600, to: 1300, dur: 0.1, gain: 0.03, type: 'square' });
    hiss({ f: 5000, dur: 0.03, gain: 0.2, q: 2, delay: rnd(0.02, 0.1) });
  },

  // ── Депрессия: нарастающий дождь, далёкий гром, минорный аккорд оседает ──
  rain() {
    const d = s(1.3);
    hiss({ f: 5500, dur: d, gain: 0.4, q: 0.5, attack: d * 0.3 });
    hiss({ f: 2400, dur: d, gain: 0.18, q: 0.7, attack: d * 0.35 });
    [220, 261.6, 329.6].forEach((f) => voice({ f, to: f * 0.92, dur: d, gain: 0.045, type: 'triangle', attack: d * 0.25 }));
    hiss({ f: 85, dur: 0.9, gain: 0.5, q: 0.5, attack: 0.1, delay: s(0.15) });
  },

  // ── Тихоход: тягучее оседание с медленным вибрато, хлюп ──
  snail() {
    const d = s(0.95);
    voice({ f: 420, to: 175, dur: d, gain: 0.11, vib: [4, 0.06] });
    voice({ f: 210, to: 88, dur: d, gain: 0.05, type: 'triangle', vib: [4, 0.06] });
    hiss({ f: 420, to: 260, dur: 0.3, gain: 0.2, q: 2, delay: s(0.1) });
  },

  // ── Круговая защита: щит раскрывается со свистом, звон, восемь искр ──
  shield() {
    hiss({ f: 400, to: 3000, dur: s(0.3), gain: 0.3, q: 1, attack: s(0.1) });
    [523.25, 659.25, 783.99].forEach((f) => voice({ f, to: f * 1.03, dur: 0.5, gain: 0.035, type: 'square' }));
    voice({ f: 1568, dur: 1.1, gain: 0.06, vib: [6, 0.004] });
    for (let i = 0; i < 8; i++) voice({ f: rnd(2600, 3600), dur: 0.04, gain: 0.025, delay: s(0.05 + i * 0.025) });
  },

  // ── Прыгун: «боинг» на каждый треугольник волны (до 8, дальше сливается) ──
  boings(n: number) {
    for (let i = 0; i < Math.min(n, 8); i++)
      voice({ f: 170 + i * 18, to: 620 + i * 40, dur: 0.16, gain: 0.08, vib: [28, 0.05], delay: s(i * 0.045) });
  },
  // прыжок-атака: пружина сжимается со скрипом…
  vaultCoil() {
    voice({ f: 520, to: 150, dur: s(0.15), gain: 0.07, type: 'triangle', vib: [34, 0.06] });
    hiss({ f: 2400, to: 900, dur: s(0.12), gain: 0.06, q: 4 });
  },
  // …выстреливает «боингом», и в полёте нарастает свист…
  vaultLaunch() {
    voice({ f: 150, to: 760, dur: 0.24, gain: 0.11, vib: [26, 0.07] });
    knock(0.5, 0, 0.8);
    hiss({ f: 500, to: 2600, dur: s(0.24), gain: 0.16, q: 1.2, attack: s(0.2) });
    hiss({ f: 2600, to: 700, dur: s(0.24), gain: 0.12, q: 1.2, delay: s(0.24) });
  },
  // …удар сверху в верхней точке: хлёсткий щелчок и тяжёлый раскол камня…
  vaultStrike() {
    hiss({ f: 4200, dur: 0.035, gain: 0.5, q: 0.9 });
    voice({ f: 1300, to: 320, dur: 0.06, gain: 0.08, type: 'square' });
    sfx.capture();
  },
  // …и пружинистое приземление
  vaultLand() {
    knock(1, 0, 0.75);
    voice({ f: 240, to: 400, dur: 0.12, gain: 0.05, vib: [30, 0.05], delay: 0.03 });
  },

  // ── Пропуск хода: зевок, затем сонное «з-з-з» под каждой Z ──
  snooze() {
    voice({ f: 520, to: 250, dur: s(0.7), gain: 0.09, type: 'triangle', attack: s(0.2), vib: [5, 0.02] });
    [0.4, 0.62, 0.84].forEach((t, i) => {
      hiss({ f: 320 - i * 30, dur: 0.22, gain: 0.13, q: 3, attack: 0.05, delay: s(t) });
      voice({ f: 92 - i * 6, dur: 0.2, gain: 0.02, type: 'sawtooth', attack: 0.05, delay: s(t) });
    });
  },

  // ── Барьер: пыльная волна от упавших плит ──
  dustWave() {
    hiss({ f: 320, to: 120, dur: s(0.32), gain: 0.35, q: 0.8 });
  },
};
