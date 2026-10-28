import darkCss from './styles/dark.css?inline';
import lightCss from './styles/light.css?inline';
import flatCss from './styles/flat.css?inline';
import { applyCssPalette, FLAT, PAL, THEME } from './render/palette';
import { startBackground } from './render/background';
import { scaleCanvas } from './render/pixel';
import { concreteCss, logoMark } from './render/sprites';
import { go } from './ui/app';
import { menuScreen } from './ui/screens/menu';
import { applySettings } from './ui/screens/settings';

/** Favicon — пиксельный знак логотипа (модуль 2 px → 14×14, ×2 для чёткости). */
function setFavicon() {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? document.head.appendChild(document.createElement('link'));
  link.rel = 'icon';
  link.type = 'image/png';
  link.href = scaleCanvas(logoMark(2, PAL.logo), 2).toDataURL();
}

/** Стили темы: тёмная — исходный дизайн, светлая — красный акцент на светлом камне; плоская поверхность — поверх. */
function applyTheme() {
  const style = document.createElement('style');
  style.textContent = (THEME.scheme === 'dark' ? darkCss : lightCss) + (FLAT ? flatCss : '');
  document.head.appendChild(style);
  document.body.classList.add(`theme-${THEME.scheme}`, `surface-${THEME.surface}`);
  applyCssPalette();
  // бетонные фактуры для CSS-панелей генерируются один раз при старте; у плоской поверхности их нет
  const root = document.documentElement.style;
  const tex = (name: string, hex: string, seed: number, soft = false) =>
    root.setProperty(name, FLAT ? 'none' : `url(${concreteCss(hex, seed, 96, 96, soft)})`);
  const soft = THEME.scheme === 'light'; // светлая — лёгкий рельеф
  tex('--tex-concrete', PAL.concrete300, 9, soft);
  tex('--tex-concrete-light', PAL.concrete200, 13, soft);
  tex('--tex-inset', PAL.concrete400, 17, soft);
  tex('--tex-slab', PAL.slab800, 3);
  tex('--tex-slab-light', PAL.slab700, 5);
}

async function boot() {
  applyTheme();
  setFavicon();
  startBackground(document.getElementById('bg') as HTMLCanvasElement);
  applySettings();
  // пиксельный шрифт нужен до генерации заголовков на canvas
  try {
    await Promise.race([document.fonts.load('24px "Tiny5"'), new Promise((r) => setTimeout(r, 1500))]);
  } catch {
    /* офлайн — останется моноширинный запасной */
  }
  go(menuScreen);
}

void boot();
