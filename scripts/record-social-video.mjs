import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const base = process.env.PUTT_URL ?? 'http://127.0.0.1:4173/putt';
const plan = JSON.parse(await fs.readFile(process.env.PUTT_PLAN ?? 'social-plan.json', 'utf8'));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 640 },
  deviceScaleFactor: 1,
  recordVideo: { dir: 'social-video-raw', size: { width: 390, height: 640 } },
});
const page = await context.newPage();
try {
await page.goto(`${base}/?mode=practice&tour=beginner&seed=${plan.seed}&social=1&lang=ja`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__puttSocial);
await page.waitForTimeout(900);

// Establish the whole hole first so the slope/hazard context is readable in a short clip.
await page.evaluate(() => window.__puttSocial.map());
await page.waitForTimeout(1500);
await page.evaluate(() => window.__puttSocial.map());
await page.waitForTimeout(900);

// Let the solver choose the final line, but approach it like a person reading the green.
// The small overshoot/correction is deterministic: clips remain reproducible while the cursor
// no longer snaps mechanically to the mathematically solved angle.
const aimSteps = [
  plan.direction - 0.055,
  plan.direction + 0.022,
  plan.direction - 0.010,
  plan.direction,
];
for (let i = 0; i < aimSteps.length; i++) {
  const aimed = await page.evaluate((direction) => window.__puttSocial.aim(direction), aimSteps[i]);
  if (!aimed) throw new Error('Social driver refused aim');
  await page.waitForTimeout([320, 260, 230, 420][i]);
}

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

// Use a much larger, readable stroke (about 2.5x the previous travel) with a tiny vertical
// wobble. The final 40 ms remains solver-accurate, so the production swipe fitter still launches
// the planned speed/direction instead of bypassing real input handling.
const backswing = [
  [214, 320], [236, 319], [260, 321], [286, 318],
  [312, 320], [332, 317], [345, 319],
];
for (const [x, yy] of backswing) {
  ts += 0.055;
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x, y: yy, button: 'left', buttons: 1, timestamp: ts,
  });
  await page.waitForTimeout(55);
}

// Accelerating downswing with subtle hand-like wobble. These early points are visual; the
// measurement fitter ultimately uses the precise samples near impact below.
const downswing = [
  [332, 320], [309, 322], [281, 319], [249, 321], [217, 320],
];
for (const [x, yy] of downswing) {
  ts += 0.04;
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x, y: yy, button: 'left', buttons: 1, timestamp: ts,
  });
  await page.waitForTimeout(35);
}

// Solver-accurate impact window. Four pixels per sample gives enough samples inside the 40 ms fit.
const speedK = 0.00266;
const pxPerSample = 4;
const dt = pxPerSample / (plan.speed / speedK);
for (let x = 213; x >= 155; x -= pxPerSample) {
  ts += dt;
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x, y, button: 'left', buttons: 1, timestamp: ts,
  });
  await page.waitForTimeout(10);
  if ((await page.evaluate(() => window.__puttSocial.state())) !== 'STROKE') break;
}
ts += dt;
await cdp.send('Input.dispatchMouseEvent', {
  type: 'mouseReleased', x: 151, y, button: 'left', buttons: 0, clickCount: 1, timestamp: ts,
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
// Hold the score card long enough to read in the final social clip.
await page.waitForTimeout(1800);
await context.close();
} finally {
  await browser.close();
}
