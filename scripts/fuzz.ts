// Фаззер движка: npm run fuzz -- <партий> [seed]. Короткий прогон входит в npm test.
import { fuzz } from './lib/fuzz';

const games = Number(process.argv[2] ?? 200);
const seed = Number(process.argv[3] ?? 1);
const t0 = performance.now();
const r = fuzz({ games, seed });
console.log(`партий ${games}, действий ${r.steps}, вопросов ${r.questions}, ${((performance.now() - t0) / 1000).toFixed(1)} с`);
if (r.error) {
  console.log(`ОШИБКА: ${r.error}`);
  process.exit(1);
}
console.log('ok');
