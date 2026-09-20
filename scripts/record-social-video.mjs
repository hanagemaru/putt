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
await page.goto(`${base}/?mode=practice&seed=${plan.seed}&social=1`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__puttSocial);
await page.waitForTimeout(1700);

// Establish the game in one glance: show the full hole, then return to the playing view.
await page.evaluate(() => window.__puttSocial.map());
await page.waitForTimeout(1800);
await page.evaluate(() => window.__puttSocial.map());
await page.waitForTimeout(1100);

// The launch goes through the production launch/follow/result path.
const started = await page.evaluate(({ speed, direction }) => window.__puttSocial.launch(speed, direction), plan);
if (!started) throw new Error('Social driver refused launch');
await page.waitForFunction(() => ['RESULT', 'PRACTICE_END'].includes(window.__puttSocial.state()), null, { timeout: 15000 });
await page.waitForTimeout(4500);

const finalState = await page.evaluate(() => window.__puttSocial.state());
if (finalState !== 'PRACTICE_END') throw new Error(`Expected cup-in, got ${finalState}`);
await context.close();
await browser.close();
