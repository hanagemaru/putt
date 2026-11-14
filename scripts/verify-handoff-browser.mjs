// End-to-end, real HTTPS two-origin test using independent, D1-free Workers.
// No production data, player identifiers, secrets, or token values are logged.
// Expected environments: putt-legacy-preview / putt-hub-preview.
import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';

const OLD = 'https://putt-legacy-preview.jibunnha.workers.dev/';
const NEW = 'https://putt-hub-preview.jibunnha.workers.dev/games/putt/play/';
const browserName = process.env.HANDOFF_BROWSER === 'webkit' ? 'webkit' : 'chromium';
const browserType = browserName === 'webkit' ? webkit : chromium;
const browser = await browserType.launch({ headless: true, ...(browserName === 'chromium' ? { args: ['--no-sandbox'] } : {}) });

async function seedOld(context) {
  const old = await context.newPage();
  const response = await old.goto(OLD, { waitUntil: 'domcontentloaded' });
  assert.equal(response.status(), 200, 'isolated old origin must serve the game');
  await old.getByRole('button', { name: '引き継ぎ用テスト記録を作る' }).click();
  await old.getByRole('status').filter({ hasText: 'テスト記録を保存しました' }).waitFor();
  const result = await old.evaluate(() => ({
    id: localStorage.getItem('putt-player-identity-v1'),
    name: localStorage.getItem('putt-player-name'),
    best: localStorage.getItem('putt-tour-best-beginner'),
  }));
  assert.ok(result.id && result.name && result.best, 'test-only data must be present on the old origin');
  return { old, result };
}

async function openLegacyPopup(target) {
  const popupResult = target.waitForEvent('popup', { timeout: 12000 }).catch(() => null);
  const button = target.getByRole('button', { name: '以前の記録を引き継ぐ' });
  try {
    await button.click({ noWaitAfter: true, timeout: 12000 });
  } catch (error) {
    console.log('DIAGNOSTIC: click did not complete', String(error).slice(0, 500));
  }
  const popup = await popupResult;
  if (!popup) {
    console.log('DIAGNOSTIC: target URL', target.url());
    console.log('DIAGNOSTIC: target status', await target.locator('[role=status]').allTextContents());
    console.log('DIAGNOSTIC: browser tabs', target.context().pages().map(page => page.url()));
    throw new Error('No popup created by browser handoff UI');
  }
  assert.ok(popup.url().startsWith(OLD), 'popup must use isolated old origin');
  return popup;
}

async function runHandoff(target) {
  await target.goto(NEW, { waitUntil: 'domcontentloaded' });
  const popup = await openLegacyPopup(target);
  const approve = popup.getByRole('button', { name: '記録を移す' });
  await approve.waitFor({ state: 'visible', timeout: 15000 });
  await approve.click();
  return popup;
}

try {
  {
    const context = await browser.newContext({ serviceWorkers: 'block', locale: 'ja-JP' });
    const { old, result } = await seedOld(context);
    const target = await context.newPage();
    await runHandoff(target);
    await target.waitForFunction(() =>
      localStorage.getItem('putt-player-name') === '引き継ぎテスト',
      { timeout: 15000 },
    );
    const copied = await target.evaluate(() => ({
      id: localStorage.getItem('putt-player-identity-v1'),
      name: localStorage.getItem('putt-player-name'),
      best: localStorage.getItem('putt-tour-best-beginner'),
    }));
    assert.deepEqual(copied, result, 'all allowed data must transfer unchanged');
    const retained = await old.evaluate(() => localStorage.getItem('putt-player-identity-v1'));
    assert.equal(retained, result.id, 'old origin must preserve its original data');
    console.log('PASS: user-approved record handoff between separate HTTPS origins');
    await context.close();
  }
  {
    const context = await browser.newContext({ serviceWorkers: 'block', locale: 'ja-JP' });
    await seedOld(context);
    const target = await context.newPage();
    await target.goto(NEW, { waitUntil: 'domcontentloaded' });
    await target.evaluate(() => localStorage.setItem(
      'putt-player-identity-v1',
      JSON.stringify({ playerId: '99999999-9999-4999-8999-999999999999', credential: 'b'.repeat(64) }),
    ));
    const popup = await openLegacyPopup(target);
    await popup.getByRole('button', { name: '記録を移す' }).waitFor({ state: 'visible', timeout: 15000 });
    await popup.getByRole('button', { name: '記録を移す' }).click();
    await target.getByRole('status').filter({ hasText: '上書きせずに中止' }).waitFor({ timeout: 15000 });
    const remains = await target.evaluate(() => localStorage.getItem('putt-player-identity-v1'));
    assert.ok(remains.includes('99999999'), 'conflicting identity must not be overwritten');
    const noBest = await target.evaluate(() => localStorage.getItem('putt-tour-best-beginner'));
    assert.equal(noBest, null, 'conflicting import must not partially write a best score');
    console.log('PASS: conflicts abort atomically without overwriting or partial import');
    await context.close();
  }
  {
    const context = await browser.newContext({ serviceWorkers: 'block', locale: 'ja-JP' });
    const old = await context.newPage();
    await old.goto(OLD + '?legacyHandoff=1');
    await old.getByRole('status').filter({ hasText: '接続がありません' }).waitFor();
    assert.equal(await old.getByRole('button', { name: '記録を移す' }).count(), 0);
    console.log('PASS: direct old-origin access cannot transfer records without opener');
    await context.close();
  }
  console.log(`PASS: all cross-origin Putt handoff browser checks (${browserName})`);
} finally {
  await browser.close();
}
