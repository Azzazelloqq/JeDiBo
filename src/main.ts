import './styles/main.css';
import { applyCssPalette, PAL } from './render/palette';
import { setBackgroundStyle, startBackground } from './render/background';
import { scaleCanvas } from './render/pixel';
import { concreteCss, logoMark, stoneTile } from './render/sprites';
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

/** Пробные варианты на выбор владельцу: ?bg=0..4 — фон партии, ?stone=0..3 — камень UI-панелей.
 *  0 — текущий дизайн A. После выбора лишнее удалить. */
function applyTrialVariants() {
  const q = new URLSearchParams(location.search);
  setBackgroundStyle(Number(q.get('bg') ?? 0) || 0);
  const stone = Number(q.get('stone') ?? 0) || 0;
  if (!stone) return;
  document.body.classList.add(`stone-${stone}`);
  const root = document.documentElement.style;
  const tex = (c: HTMLCanvasElement) => `url(${c.toDataURL()})`;
  const set: Record<number, [string, string, string]> = {
    1: ['cast', PAL.concrete400, PAL.concrete300],
    2: ['board', PAL.concrete400, PAL.concrete300],
    3: ['cast', PAL.slab600, PAL.concrete400],
  };
  const [kind, panel, light] = set[stone] ?? set[1];
  root.setProperty('--tex-concrete', tex(stoneTile(kind as 'cast' | 'board', panel, 21)));
  root.setProperty('--tex-concrete-light', tex(stoneTile(kind as 'cast' | 'board', light, 22)));
  root.setProperty('--tex-btn', tex(stoneTile(kind as 'cast' | 'board', stone === 3 ? PAL.concrete400 : PAL.concrete300, 23, 64, 32)));
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
  applyTrialVariants();
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
