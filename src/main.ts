import darkCss from './styles/dark.css?inline';
import lightCss from './styles/light.css?inline';
import { applyCssPalette, PAL, THEME } from './render/palette';
import { startBackground } from './render/background';
import { scaleCanvas } from './render/pixel';
import { logoMark } from './render/sprites';
import { edgeWearLayers, panelTexture } from './render/stone';
import { go } from './ui/app';
import { bootScreen } from './ui/screens/lobby';
import { initialScreen, resumedGame, screen, wantsTutorial } from './ui/nav';
import './styles/game-layout.css';
import './styles/fonts.css';
import './styles/tutorial.css';
import './styles/karma-draw.css';
import { applySettings } from './ui/screens/settings';

/** Favicon — пиксельный знак логотипа (модуль 2 px → 14×14, ×2 для чёткости). */
function setFavicon() {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? document.head.appendChild(document.createElement('link'));
  link.rel = 'icon';
  link.type = 'image/png';
  link.href = scaleCanvas(logoMark(2, PAL.logo), 2).toDataURL();
}

/** Стили темы: тёмная — исходный дизайн, светлая — красный акцент на светлом камне. */
function applyTheme() {
  const style = document.createElement('style');
  style.textContent = THEME.scheme === 'dark' ? darkCss : lightCss;
  document.head.appendChild(style);
  document.body.classList.add(`theme-${THEME.scheme}`);
  applyCssPalette();
  // фактуры камня для CSS-панелей генерируются один раз при старте
  const root = document.documentElement.style;
  const tex = (name: string, hex: string, seed: number) => root.setProperty(name, `url(${panelTexture(hex, seed)})`);
  tex('--tex-concrete', PAL.concrete300, 9);
  tex('--tex-concrete-light', PAL.concrete200, 13);
  tex('--tex-inset', PAL.concrete400, 17);
  tex('--tex-slab', PAL.slab800, 3);
  tex('--tex-slab-light', PAL.slab700, 5);
  // стёртые края CSS-панелей — отдельные слои фона поверх фактуры
  root.setProperty('--tex-edges', edgeWearLayers(21));
}

async function boot() {
  applyTheme();
  setFavicon();
  startBackground(document.getElementById('bg') as HTMLCanvasElement);
  applySettings();
  // пиксельный шрифт нужен до генерации заголовков на canvas
  try {
    const fonts = [document.fonts.load('24px "Tiny5"', 'Аа')];
    fonts.push(document.fonts.load('24px "JeDiBo Digits"', '0'));
    await Promise.race([Promise.all(fonts), new Promise((r) => setTimeout(r, 1500))]);
  } catch {
    /* офлайн — останется моноширинный запасной */
  }
  // ссылка-приглашение или возврат в сетевую комнату после перезагрузки вкладки, партия после смены темы — иначе стартовый экран
  go(bootScreen() ?? resumedGame() ?? (wantsTutorial() ? screen('game', 'tutorial') : screen(initialScreen())));
  // отладочный пульт сети: в прод-сборку не попадает
  if (import.meta.env.DEV) void import('./net/devtools');
  // ?shot — для скриншотов headless-браузером: без анимаций входа (только dev)
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('shot')) {
    const st = document.createElement('style');
    st.textContent = '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition:none!important}.screen{opacity:1!important;transform:none!important}';
    document.head.appendChild(st);
  }
}

void boot();
