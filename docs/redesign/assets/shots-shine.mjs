import puppeteer from 'puppeteer-core';
const [url, out] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, defaultViewport: { width: 1440, height: 900 } });
const p = await b.newPage();
await p.goto(url, { waitUntil: 'networkidle0' });
await new Promise(r=>setTimeout(r,1500));
await p.evaluate(() => [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Колода').click());
await new Promise(r=>setTimeout(r,1300));
// карточка «Предательство» (роковая) в деталях
await p.evaluate(() => document.querySelectorAll('.codex-grid .kcard')[13].click());
await new Promise(r=>setTimeout(r,400));
const box = await p.evaluate(() => { const e=document.querySelector('.codex-detail .kcard').getBoundingClientRect(); return {x:e.x,y:e.y,w:e.width,h:e.height}; });
const pts = [[0.15,0.1],[0.5,0.66],[0.85,0.9],[0.6,0.3]];
let i=0;
for (const [fx,fy] of pts) {
  await p.mouse.move(box.x+box.w*fx, box.y+box.h*fy, {steps:4});
  await new Promise(r=>setTimeout(r,250));
  await p.screenshot({ path: `${out}/shine-${i++}.png`, clip: { x: box.x-30, y: box.y-30, width: box.w+60, height: box.h+60 } });
}
// сетка ×2
const gb = await p.evaluate(() => { const e=document.querySelectorAll('.codex-grid .kcard')[0].getBoundingClientRect(); return {x:e.x,y:e.y,w:e.width,h:e.height}; });
await p.mouse.move(gb.x+gb.w*0.3, gb.y+gb.h*0.2, {steps:3});
await new Promise(r=>setTimeout(r,250));
await p.screenshot({ path: `${out}/shine-grid.png`, clip: { x: gb.x-20, y: gb.y-20, width: gb.w*2+60, height: gb.h+40 } });
await b.close();
