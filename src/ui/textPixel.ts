// Пиксель шрифта текста (--f-text, styles/text.css) — целое число пикселей экрана, около 4/3 CSS px.
// Иначе на экранах с масштабом 125–150% и при зуме браузера столбцы букв выходят разной ширины.

/** Ставит --tp и следит за сменой масштаба (зум, перенос окна на другой монитор). */
export function trackTextPixel() {
  const apply = () => {
    const dpr = window.devicePixelRatio || 1;
    const px = Math.max(1, Math.round((dpr * 4) / 3));
    document.documentElement.style.setProperty('--tp', `${px / dpr}px`);
    // media-запрос на текущий масштаб срабатывает один раз — после смены вешаем заново
    matchMedia(`(resolution: ${dpr}dppx)`).addEventListener('change', apply, { once: true });
  };
  apply();
}
