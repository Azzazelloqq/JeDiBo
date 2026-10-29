// Пиксельные эмблемы Летописи 16×16: подложка по тиру (знак — круг, печать — зубчатая печать, клеймо — щит)
// + глиф 8×8 (ASCII, как ICONS в cardArt.ts). Закрытая эмблема — затемнённый силуэт без глифа.
import type { EmblemTier } from '../profile/emblems';
import { PAL } from './palette';
import { makeCanvas, outline, type Canvas } from './pixel';

const GLYPHS: Record<string, string[]> = {
  student: ['...o....', '..ooo...', '........', '...x....', '..xxx...', '.xxxxx..', 'xxxxxxx.', '........'],
  firstStone: ['........', '..xxxx..', '.xxxxxx.', '.xxooxx.', '.xxooxx.', '.xxxxxx.', '..xxxx..', '........'],
  wandererWrong: ['...xx...', '..xxxx..', '..xoox..', '..xxxx..', '.xxxxxx.', 'x.xxxx.x', '..x..x..', '.xx..xx.'],
  twoAtTable: ['........', '.xx..oo.', '.xx..oo.', '........', 'xxxxxxxx', '.x....x.', '.x....x.', '........'],
  balance: ['...xx...', 'xxxxxxxx', '.x....x.', 'x.x..x.x', 'xxx..xxx', '...xx...', '..xxxx..', '........'],
  flawless: ['xxxxxxxx', 'xoxoxoxo', 'xxxxxxxx', 'oxoxoxox', 'xxxxxxxx', 'xoxoxoxo', 'xxxxxxxx', '........'],
  lastStone: ['........', '........', '...xx...', '..xxxx..', '..xxxx..', '...xx...', 'o......o', '.o....o.'],
  longBuild: ['...o....', '..xxx...', '..xxx...', '.xxxxx..', '.xxxxx..', 'xxxxxxx.', 'xxxxxxx.', '........'],
  demolition: ['x..o...x', '.x.o..x.', '..xxxx..', 'oxx..xxo', '..xxxx..', '.x....x.', 'x......x', '........'],
  sixSigns: ['.o.o.o..', '........', '.o.o.o..', '........', 'xxxxxxx.', 'x.....x.', 'xxxxxxx.', '........'],
  careerist: ['...o....', '..ooo...', '.o.o.o..', '...o....', '.xxxxx..', '.x...x..', '.xxxxx..', '........'],
  toCircle: ['..xxxx..', '.x....x.', 'x..oo..x', 'x.oooo.x', 'x.oooo.x', 'x..oo..x', '.x....x.', '..xxxx..'],
  fatalBet: ['.xxxxx..', 'xx.x.xx.', 'xxxxxxx.', '.xoxox..', '..xxx...', '........', '.o.o.o..', '........'],
  fullDeck: ['xxxx....', 'xoox....', 'xxxxxx..', 'x.xoox..', 'x.xxxxxx', '..x.xoox', '..x.xoox', '....xxxx'],
  series: ['o..o..o.', 'oo.oo.oo', 'ooooooo.', '........', 'xxxxxxx.', '.xxxxx..', '..xxx...', '........'],
  monolith: ['..xxxx..', '..xoox..', '..xxxx..', '..xxxx..', '..xoox..', '..xxxx..', '.xxxxxx.', 'xxxxxxxx'],
  hundredShards: ['x.....x.', '..x.x...', 'o..x..o.', '.x.o.x..', 'x..x..x.', '..o.x...', '.x...o..', 'x.x...x.'],
  granite: ['........', '.xxxxxx.', 'xxoxxxxx', 'xxxxxoxx', 'xoxxxxxx', 'xxxxoxxx', '.xxxxxx.', '........'],
  monolithSpirit: ['...oo...', '..oxxo..', '..xxxx..', '.xxxxxx.', '.xxxxxx.', '.xxxxxx.', 'xxxxxxxx', 'xxxxxxxx'],
};

const TIER_COL: Record<EmblemTier, { base: string; hi: string; lo: string; glyph: string; accent: string }> = {
  знак: { base: PAL.concrete400, hi: PAL.concrete200, lo: PAL.concrete600, glyph: PAL.slab800, accent: PAL.brand500 },
  печать: { base: PAL.amber500, hi: PAL.amber300, lo: PAL.amber700, glyph: PAL.slab900, accent: PAL.bone },
  клеймо: { base: PAL.brand700, hi: PAL.brand400, lo: PAL.brand800, glyph: PAL.bone, accent: PAL.amber300 },
};

function inBadge(t: EmblemTier, x: number, y: number) {
  const cx = x + 0.5 - 8, cy = y + 0.5 - 8;
  if (t === 'знак') return cx * cx + cy * cy <= 7.3 * 7.3;
  if (t === 'печать') {
    // квадрат с зубцами по краю
    const ax = Math.abs(cx), ay = Math.abs(cy);
    if (ax > 7 || ay > 7) return false;
    if ((ax > 6 || ay > 6) && (x + y) % 2 === 1) return false;
    return ax + ay <= 12;
  }
  // щит: прямой верх, сужение книзу
  if (y < 1 || y > 15) return false;
  const half = y < 9 ? 7 : 7 - (y - 8);
  return Math.abs(cx) <= half;
}

const cache = new Map<string, Canvas>();
/** Эмблема 16×16 (+контур, итого 18×18). locked — тёмный силуэт без глифа. */
export function emblemIcon(id: string, tier: EmblemTier, locked: boolean): Canvas {
  const key = `${id}${locked}`;
  if (!cache.has(key)) {
    const col = TIER_COL[tier];
    const [c, g] = makeCanvas(16, 16);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        if (!inBadge(tier, x, y)) continue;
        // фаска: свет слева-сверху, тень справа-снизу
        const edgeHi = !inBadge(tier, x - 1, y) || !inBadge(tier, x, y - 1);
        const edgeLo = !inBadge(tier, x + 1, y) || !inBadge(tier, x, y + 1);
        g.fillStyle = locked ? (edgeHi ? PAL.slab600 : edgeLo ? PAL.slab900 : PAL.slab700) : edgeHi ? col.hi : edgeLo ? col.lo : col.base;
        g.fillRect(x, y, 1, 1);
      }
    const glyph = GLYPHS[id];
    if (glyph)
      glyph.forEach((row, y) =>
        [...row].forEach((ch, x) => {
          if (ch === '.') return;
          g.fillStyle = locked ? PAL.slab800 : ch === 'o' ? col.accent : col.glyph;
          g.fillRect(4 + x, 4 + y, 1, 1);
        }),
      );
    // поле 1 px под контур
    const [pad, pg] = makeCanvas(18, 18);
    pg.drawImage(c, 1, 1);
    cache.set(key, outline(pad, PAL.void));
  }
  const src = cache.get(key)!;
  const [c, g] = makeCanvas(src.width, src.height);
  g.drawImage(src, 0, 0);
  return c;
}
