import darkCss from './styles/dark.css?inline';
import lightCss from './styles/light.css?inline';
import { applyCssPalette, PAL, THEME } from './render/palette';
import { startBackground } from './render/background';
import { scaleCanvas } from './render/pixel';
import { logoMark } from './render/sprites';
import { edgeWearLayers } from './render/stone';
import { panelTexture, texConcept } from './render/textures';
import { go } from './ui/app';
import { bootScreen } from './ui/screens/lobby';
import { initialScreen, screen } from './ui/variants/registry';
import { mountSwitcher } from './ui/variants/switcher';
import './styles/fonts.css';
import './styles/variants/switcher.css';
import './styles/variants/a.css';
import './styles/variants/b.css';
import './styles/variants/cards.css';
import { preloadIllustrations } from './render/cardArt';
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
  // бетонные фактуры для CSS-панелей генерируются один раз при старте
  const root = document.documentElement.style;
  const soft = THEME.scheme === 'light'; // светлая — лёгкий рельеф
  const tex = (name: string, hex: string, darker: string, seed: number, s = soft) =>
    root.setProperty(name, `url(${panelTexture(hex, darker, seed, s)})`);
  tex('--tex-concrete', PAL.concrete300, PAL.concrete400, 9);
  tex('--tex-concrete-light', PAL.concrete200, PAL.concrete300, 13);
  tex('--tex-inset', PAL.concrete400, PAL.concrete500, 17);
  tex('--tex-slab', PAL.slab800, PAL.slab900, 3, false);
  tex('--tex-slab-light', PAL.slab700, PAL.slab800, 5, false);
  // потёртые края CSS-панелей — только у концепта «края, царапины, сколы»
  root.setProperty('--tex-edges', texConcept() === 'edgeworn' ? edgeWearLayers(THEME.scheme === 'light', 21) : 'none');
}

async function boot() {
  applyTheme();
  setFavicon();
  startBackground(document.getElementById('bg') as HTMLCanvasElement);
  applySettings();
  // пиксельный шрифт нужен до генерации заголовков на canvas
  try {
    // Press Start 2P и Rubik — шрифты варианта «б» (кириллица грузится отдельным диапазоном)
    const fonts = ['24px "Tiny5"', '24px "Press Start 2P"', '500 16px "Rubik"', '700 16px "Rubik"'].map((f) => document.fonts.load(f, 'Аа'));
    fonts.push(document.fonts.load('24px "JeDiBo Digits"', '0'));
    await Promise.race([Promise.all(fonts), new Promise((r) => setTimeout(r, 1500))]);
  } catch {
    /* офлайн — останется моноширинный запасной */
  }
  preloadIllustrations();
  mountSwitcher();
  // ссылка-приглашение или возврат в сетевую комнату после перезагрузки вкладки — иначе стартовый экран
  go(bootScreen() ?? screen(initialScreen()));
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
