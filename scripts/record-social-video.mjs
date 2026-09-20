import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const base = process.env.PUTT_URL ?? 'http://127.0.0.1:4173';
const plan = JSON.parse(await fs.readFile(process.env.PUTT_PLAN ?? 'social-plan.json', 'utf8'));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 640 },
  deviceScaleFactor: 1,
  recordVideo: { dir: 'social-video-raw', size: { width: 390, height: 640 } },
});
const page = await context.newPage();
await page.goto(`${base}/?mode=practice&tour=beginner&seed=${plan.seed}&social=1`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__puttSocial);
await page.waitForTimeout(900);

// Establish the whole hole first so the slope/hazard context is readable in a short clip.
await page.evaluate(() => window.__puttSocial.map());
await page.waitForTimeout(1500);
await page.evaluate(() => window.__puttSocial.map());
await page.waitForTimeout(900);

// Let the solver choose the line, but execute the shot through the actual STROKE canvas.
// This keeps the recorded interaction on the same swipe-measure path a player uses.
const aimed = await page.evaluate((direction) => window.__puttSocial.aim(direction), plan.direction);
if (!aimed) throw new Error('Social driver refused aim');
await page.waitForTimeout(350);

await page.mouse.click(195, 320);
await page.waitForFunction(() => {
  const el = document.getElementById('stroke');
  return window.__puttSocial.state() === 'STROKE' && el && getComputedStyle(el).display === 'block';
}, null, { timeout: 3000 });
await page.waitForTimeout(450);

// Use CDP timestamps so SwipeMeasure sees the solver's exact launch speed while the wall-clock
// pauses keep the backswing/downswing visible in the recorded clip.
const cdp = await context.newCDPSession(page);
const x0 = 195;
const y = 320;
let ts = Date.now() / 1000;
await cdp.send('Input.dispatchMouseEvent', {
  type: 'mouseMoved', x: x0, y, button: 'none', buttons: 0, timestamp: ts,
});
await cdp.send('Input.dispatchMouseEvent', {
  type: 'mousePressed', x: x0, y, button: 'left', buttons: 1, clickCount: 1, timestamp: ts,
});

// Deliberate, readable backswing: 60 px right, comfortably past the 20 px arming gate.
for (let i = 1; i <= 6; i++) {
  ts += 0.05;
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: x0 + i * 10, y, button: 'left', buttons: 1, timestamp: ts,
  });
  await page.waitForTimeout(45);
}

// Straight downswing. Event timestamps encode the target px/s from production speedK.
// Four pixels per sample gives enough samples inside the 40 ms fit window.
const speedK = 0.00266;
const pxPerSample = 4;
const dt = pxPerSample / (plan.speed / speedK) / 1000;
for (let x = x0 + 56; x >= x0 - 12; x -= pxPerSample) {
  ts += dt;
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x, y, button: 'left', buttons: 1, timestamp: ts,
  });
  await page.waitForTimeout(10);
  if ((await page.evaluate(() => window.__puttSocial.state())) !== 'STROKE') break;
}
ts += dt;
await cdp.send('Input.dispatchMouseEvent', {
  type: 'mouseReleased', x: x0 - 12, y, button: 'left', buttons: 0, clickCount: 1, timestamp: ts,
});

await page.waitForFunction(() => window.__puttSocial.lastShot() !== null, null, { timeout: 3000 });
const actual = await page.evaluate(() => window.__puttSocial.lastShot());
if (Math.abs(actual.speed - plan.speed) > 0.04) {
  throw new Error(`Swipe speed mismatch: planned ${plan.speed.toFixed(3)}, actual ${actual.speed.toFixed(3)}`);
}
if (Math.abs(actual.direction - plan.direction) > 0.01) {
  throw new Error(`Swipe direction mismatch: planned ${plan.direction.toFixed(4)}, actual ${actual.direction.toFixed(4)}`);
}

await page.waitForFunction(() => ['RESULT', 'PRACTICE_END'].includes(window.__puttSocial.state()), null, { timeout: 15000 });
await page.waitForTimeout(3200);

const finalState = await page.evaluate(() => window.__puttSocial.state());
if (finalState !== 'PRACTICE_END') throw new Error(`Expected cup-in, got ${finalState}`);
await context.close();
await browser.close();
