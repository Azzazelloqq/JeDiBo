// Турнир: уровень бота против набора соперников разных стилей, сводная таблица.
// npm run tournament -- <уровень> [партий на соперника] [соперники через запятую]
// Пары играются по очереди через арену (каждая — во все потоки); итог — по сторонам бота.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ALL = ['random', 'rusher', 'greedy', 'punisher', 'hunter', 'noisy', 'trader', 'raider', 'turtle', 'sniper', 'oldmaster'];
const [level = 'master', nArg = '150', listArg] = process.argv.slice(2);
const opponents = listArg ? listArg.split(',') : ALL;
const arena = fileURLToPath(new URL('./arena.mjs', import.meta.url));

interface Row { opp: string; score: string; wins: string; unfinished: string; median: string; trade: string; free: string; time: string }
const rows: Row[] = [];
const num = (re: RegExp, text: string) => text.match(re)?.slice(1) ?? [];

for (const opp of opponents) {
  const out = execFileSync(process.execPath, [arena, level, opp, nArg], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const [wins, oppWins] = num(/: побед (\d+)\s+\|\s+\S+: побед (\d+)/, out);
  const [score] = num(new RegExp(`очки ${level.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: ([\\d.]+% ± [\\d.]+%)`), out);
  const [unfinished] = num(/не закончено (\d+)/, out);
  const [median] = num(/медиана (\d+)/, out);
  const mine = out.split('\n').filter((l) => l.startsWith(`  ${level}:`));
  const [trade, tradeN, free, freeN] = num(/проигранные размены — ([\d.]+) материала за партию \(([\d.]+) раза\); потеряно даром — ([\d.]+) \(([\d.]+) раза\)/, mine.join('\n'));
  const [avg, p95, max] = num(/среднее ([\d.]+), 95% ([\d.]+), макс ([\d.]+)/, mine.join('\n'));
  rows.push({ opp, score: score ?? '?', wins: `${wins}:${oppWins}`, unfinished: unfinished ?? '?', median: median ?? '?', trade: `${trade} (${tradeN})`, free: `${free} (${freeN})`, time: `${avg} / ${p95} / ${max}` });
  console.log(`  ${opp}: ${score} …`);
}

const head = ['соперник', 'очки бота', 'победы', 'не законч.', 'ходов (медиана)', 'проигр. размены', 'потеряно даром', 'мс на действие ср/95%/макс'];
console.log(`\n${level}, ${nArg} партий на соперника. Размены и потери — материала за партию (сколько раз), 1/3/5.`);
console.log('| ' + head.join(' | ') + ' |');
console.log('|' + head.map(() => '---').join('|') + '|');
for (const r of rows) console.log(`| ${r.opp} | ${r.score} | ${r.wins} | ${r.unfinished} | ${r.median} | ${r.trade} | ${r.free} | ${r.time} |`);
