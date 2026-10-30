// Пиксель шрифта текста (--f-text, styles/text.css) — целое число пикселей экрана, около 4/3 CSS px.
// Иначе на экранах с масштабом 125–150%, при зуме браузера и при масштабе сцены столбцы букв выходят разной ширины.
import { onStageScale, stageScale } from './stage';

/** Ставит --tp и следит за сменой масштаба (зум, перенос окна на другой монитор, размер окна). */
export function trackTextPixel() {
  const apply = () => {
    const dpr = window.devicePixelRatio || 1;
    // пикселей экрана на один CSS px сцены
    const screen = dpr * stageScale();
    const want = (screen * 4) / 3;
    const px = Math.max(1, Math.round(want));
    // мелкая сцена: округление раздуло бы текст больше чем на четверть — тогда без привязки к пикселям экрана
    const tp = Math.abs(px / want - 1) > 0.25 ? 4 / 3 : px / screen;
    document.documentElement.style.setProperty('--tp', `${tp}px`);
  };
  const watchDpr = () => {
    // media-запрос на текущий масштаб срабатывает один раз — после смены вешаем заново
    matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`).addEventListener(
      'change',
      () => {
        apply();
        watchDpr();
      },
      { once: true },
    );
  };
  onStageScale(apply);
  apply();
  watchDpr();
}
