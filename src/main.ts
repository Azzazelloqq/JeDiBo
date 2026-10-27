import './styles/main.css';
import { applyCssPalette, PAL } from './render/palette';
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
  link.href = scaleCanvas(logoMark(2, PAL.brand500), 2).toDataURL();
}

async function boot() {
  applyCssPalette();
  setFavicon();
  // бетонные фактуры для CSS-панелей генерируются один раз при старте
  const root = document.documentElement.style;
  root.setProperty('--tex-concrete', `url(${concreteCss(PAL.concrete300, 9)})`);
  root.setProperty('--tex-concrete-light', `url(${concreteCss(PAL.concrete200, 13)})`);
  root.setProperty('--tex-slab', `url(${concreteCss(PAL.slab800, 3)})`);
  root.setProperty('--tex-slab-light', `url(${concreteCss(PAL.slab700, 5)})`);
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
