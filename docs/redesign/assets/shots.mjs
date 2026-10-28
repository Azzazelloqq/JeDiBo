// Массовые скриншоты экранов. Ставить puppeteer-core вне проекта: npm i --prefix <scratch> puppeteer-core@23.10.4,
// запускать: node <scratch>/node_modules/... или скопировать файл в <scratch>. Нужен установленный Chrome (путь ниже).
// node shot.mjs <url> <outDir> <W> <H> [only=a,b]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const [url, out, W = '1440', H = '900', only] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const want = only ? new Set(only.split(',')) : null;
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'],
  defaultViewport: { width: +W, height: +H },
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (t) => page.evaluate((t) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(t))?.click(), t);
const snap = async (name) => {
  if (want && !want.has(name)) return;
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('shot', name);
};
await page.goto(url, { waitUntil: 'networkidle0' });
await sleep(2500);
await snap('01-menu');
for (const [n, t] of [['02-codex', 'Колода'], ['03-rules', 'Правила'], ['04-settings', 'Настройки'], ['05-profile', 'Профиль']]) {
  await click(t);
  await sleep(1300);
  if (n === '02-codex') {
    // наведение на карту в сетке — проверка блика
    const r = await page.evaluate(() => { const e = document.querySelectorAll('.codex-grid .kcard')[3].getBoundingClientRect(); return [e.x, e.y, e.width, e.height]; });
    await page.mouse.move(r[0] + r[2] * 0.3, r[1] + r[3] * 0.25);
    await sleep(400);
  }
  await snap(n);
  if (n === '02-codex') {
    const r = await page.evaluate(() => { const e = document.querySelector('.codex-detail .kcard').getBoundingClientRect(); return [e.x, e.y, e.width, e.height]; });
    await page.mouse.move(r[0] + r[2] * 0.5, r[1] + r[3] * 0.68);
    await sleep(400);
    await snap('02b-codex-hover-name');
    await page.mouse.move(5, 5);
  }
  await click('В меню');
  await sleep(1000);
}
await click('Против Странника');
await sleep(1800);
await snap('06-placement');
await page.evaluate(() => document.querySelector('.presets button')?.click());
await sleep(600);
await snap('06b-placement-filled');
await click('Готово');
await sleep(4500);
await snap('07-match-start');
// дальше пусть играет бот за обоих — ловим оверлей Кармы
await page.evaluate(() => {
  const m = window.__match;
  m.cfg.controllers[0] = 'bot';
  m.isHuman = () => false;
  m.cfg.botDelay = 40;
  m.driveBots();
});
let got = false;
for (let i = 0; i < 800 && !got; i++) {
  await sleep(250);
  got = await page.evaluate(() => !!document.querySelector('.karma-overlay .kr-name'));
}
if (got) {
  await sleep(500);
  await snap('08-karma');
}
await sleep(3500);
await snap('09-midgame');
// итог: сдаться
for (let i = 0; i < 60; i++) {
  const done = await page.evaluate(() => {
    if (document.querySelector('.result-overlay')) return true;
    document.querySelectorAll('.overlay .btn').forEach((b) => b.click());
    window.__match.submit({ type: 'resign', by: 0 });
    return false;
  });
  if (done) break;
  await sleep(500);
}
await sleep(2500);
await snap('10-result');
console.log('errors:', JSON.stringify(errs));
await browser.close();
