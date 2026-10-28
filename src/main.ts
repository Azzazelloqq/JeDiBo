import './styles/main.css';
import { applyCssPalette, PAL } from './render/palette';
import { startBackground } from './render/background';
import { concreteCss } from './render/sprites';
import { go } from './ui/app';
import { bootScreen } from './ui/screens/lobby';
import { menuScreen } from './ui/screens/menu';
import { applySettings } from './ui/screens/settings';

async function boot() {
  applyCssPalette();
  // бетонные фактуры для CSS-панелей генерируются один раз при старте
  const root = document.documentElement.style;
  root.setProperty('--tex-slab', `url(${concreteCss(PAL.slab900, 3)})`);
  root.setProperty('--tex-slab-light', `url(${concreteCss(PAL.slab700, 5)})`);
  root.setProperty('--tex-concrete', `url(${concreteCss(PAL.concrete300, 9)})`);
  startBackground(document.getElementById('bg') as HTMLCanvasElement);
  applySettings();
  // пиксельный шрифт нужен до генерации логотипа
  try {
    await Promise.race([
      Promise.all([document.fonts.load('700 24px "Pixelify Sans"'), document.fonts.load('24px "Tiny5"')]),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
  } catch {
    /* офлайн — останется моноширинный запасной */
  }
  // ссылка-приглашение или возврат в сетевую комнату после перезагрузки вкладки — иначе меню
  go(bootScreen() ?? menuScreen);
  // отладочный пульт сети: в прод-сборку не попадает
  if (import.meta.env.DEV) void import('./net/devtools');
}

void boot();
