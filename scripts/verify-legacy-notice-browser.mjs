// Confirm that the legacy Putt stays usable and links to the new version.
// Both public preview Workers use mock rankings and have no production D1.
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';

const OLD = 'https://putt-legacy-preview.jibunnha.workers.dev/';
const NEW = 'https://putt-hub-preview.jibunnha.workers.dev/games/putt/play/';
const engine = process.env.NOTICE_BROWSER === 'webkit' ? 'webkit' : 'chromium';
const browser = await (engine === 'webkit' ? webkit : chromium).launch({
  headless: true,
  ...(engine === 'chromium' ? { args: ['--no-sandbox'] } : {}),
});

try {
  const context = await browser.newContext({
    locale: 'ja-JP',
    serviceWorkers: 'block',
    ...(engine === 'webkit' ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {}),
  });
  const old = await context.newPage();
  const oldResponse = await old.goto(OLD, { waitUntil: 'domcontentloaded' });
  assert.equal(oldResponse.status(), 200);

  const link = old.getByTestId('new-putt-link');
  await link.waitFor({ timeout: 15000 });
  assert.equal(await link.getAttribute('href'), NEW);
  const notice = old.locator('.menu-legacy-notice');
  assert.match(await notice.innerText(), /こちらのPuttも引き続き遊べます/);
  assert.match(await notice.innerText(), /検証版のランキングはテストデータ/);
  assert.doesNotMatch(await notice.innerText(), /記録を移す|記録を引き継ぐ/);
  assert.equal(await old.getByRole('button', { name: '通常ツアー' }).count(), 1);
  assert.equal(await old.getByRole('button', { name: 'ランキング' }).count(), 1);

  await old.evaluate(() => localStorage.setItem('old-game-data-still-here', 'unchanged'));
  const popupPromise = old.waitForEvent('popup', { timeout: 15000 });
  await link.click({ noWaitAfter: true });
  const newTab = await popupPromise;
  await newTab.waitForLoadState('domcontentloaded');
  assert.equal(new URL(newTab.url()).pathname, '/games/putt/play/');
  assert.equal(new URL(newTab.url()).origin, new URL(NEW).origin);
  assert.equal(await newTab.getByTestId('new-putt-link').count(), 0, 'new site must not show old-site notice');
  assert.equal(await newTab.getByRole('button', { name: '通常ツアー' }).count(), 1);
  const details = newTab.getByTestId('hub-game-details');
  const howTo = newTab.getByTestId('hub-game-how-to');
  await details.waitFor();
  assert.equal(await details.getAttribute('href'), 'https://hanage.app/games/putt/');
  assert.equal(await howTo.getAttribute('href'), 'https://hanage.app/games/putt/how-to-play/');
  // In the independent preview origin, external hub links still open safely
  // in new tabs. When hosted at hanage.app, they use same-tab navigation.
  assert.equal(await details.getAttribute('target'), '_blank');
  assert.equal(await old.getByTestId('hub-game-details').count(), 0);
  assert.equal(await old.evaluate(() => localStorage.getItem('old-game-data-still-here')), 'unchanged');
  assert.equal(await newTab.evaluate(() => localStorage.getItem('old-game-data-still-here')), null);

  console.log(`PASS: ${engine} - old game remains playable, new-site notice is accurate, link works, local storage remains separate`);
} finally {
  await browser.close();
}
