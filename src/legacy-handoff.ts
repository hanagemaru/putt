import {
  snapshotLegacyStorage,
  validateSnapshot,
  planImport,
  applyNonConflictingImport,
} from './legacy-data-migration';

const LEGACY_ORIGIN = 'https://putt.hanage.app';
const HUB_ORIGIN = 'https://hanage.app';
const HUB_PLAY_PATH = '/games/putt/play/';
const HANDOFF_QUERY = 'legacyHandoff';

const READY = 'putt-record-handoff-ready-v1';
const REQUEST = 'putt-record-handoff-request-v1';
const TRANSFER = 'putt-record-handoff-data-v1';

type Status = (text: string, success?: boolean) => void;

export function isLegacyHandoffPage(): boolean {
  return location.origin === LEGACY_ORIGIN &&
    new URLSearchParams(location.search).get(HANDOFF_QUERY) === '1';
}

export function canOfferHandoff(): boolean {
  return location.origin === HUB_ORIGIN && location.pathname === HUB_PLAY_PATH;
}

function validNonce(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && /^[0-9a-f-]{36}$/i.test(candidate);
}

/**
 * Runs only in the old site, opened from the new site by explicit user action.
 * No key or credential is included in a URL, and no data is sent before the
 * user clicks the old page's approval button.
 */
export function prepareLegacyHandoff(
  readyToApprove: (approve: () => void) => void,
  status: Status,
): void {
  if (!isLegacyHandoffPage()) return;
  const opener = window.opener;
  if (!opener) {
    status('元の画面との接続がありません。新しいPuttから開き直してください。');
    return;
  }
  let handled = false;
  window.addEventListener('message', (event: MessageEvent) => {
    if (handled || event.origin !== HUB_ORIGIN || event.source !== opener) return;
    const msg = event.data;
    if (!msg || msg.type !== REQUEST || !validNonce(msg.nonce)) return;
    handled = true;
    readyToApprove(() => {
      try {
        const snapshot = snapshotLegacyStorage(localStorage);
        // Only send to the exact hanage.app origin after explicit user approval.
        opener.postMessage({ type: TRANSFER, nonce: msg.nonce, snapshot }, HUB_ORIGIN);
        status('記録を送りました。新しいPuttの画面を確認してください。', true);
      } catch {
        status('記録の読み取りに失敗しました。元のPuttの記録は変更していません。');
      }
    });
  });
  opener.postMessage({ type: READY }, HUB_ORIGIN);
  status('新しいPuttからの引き継ぎ要求を確認しています。');
}

/**
 * Opens the old, top-level site from a user click. No credentials are copied
 * to the clipboard, URL or server. The popup has to match the exact source
 * WindowProxy and origin. Imports never overwrite existing localStorage.
 */
export function startHandoffFromHub(status: Status): void {
  if (!canOfferHandoff()) {
    status('この画面では記録を引き継げません。');
    return;
  }
  const nonce = crypto.randomUUID();
  let source: Window | null = null;
  let finished = false;
  const listener = (event: MessageEvent): void => {
    if (finished || !source || event.source !== source || event.origin !== LEGACY_ORIGIN) return;
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === READY) {
      source.postMessage({ type: REQUEST, nonce }, LEGACY_ORIGIN);
      status('旧サイトで「記録を移す」を押してください。');
      return;
    }
    if (msg.type !== TRANSFER || msg.nonce !== nonce) return;
    try {
      const snapshot = validateSnapshot(msg.snapshot);
      if (Object.keys(snapshot.values).length === 0) {
        status('旧サイトに引き継げる記録がありません。');
        return;
      }
      const plan = planImport(localStorage, snapshot);
      if (plan.conflicts.length > 0) {
        status('新サイトに別の記録があります。上書きせずに中止しました。');
        return;
      }
      applyNonConflictingImport(localStorage, snapshot);
      finished = true;
      window.removeEventListener('message', listener);
      status('記録を引き継ぎました。画面を更新して反映します。', true);
      source.close();
      window.location.reload();
    } catch {
      status('記録の形式が正しくないか、端末内に保存できませんでした。');
    }
  };
  window.addEventListener('message', listener);
  // Popup creation is inside the caller's direct click handler.
  source = window.open(`${LEGACY_ORIGIN}/?${HANDOFF_QUERY}=1`, '_blank');
  if (!source) {
    window.removeEventListener('message', listener);
    status('旧サイトを開けませんでした。ポップアップの設定を確認してください。');
    return;
  }
  status('旧サイトを開きました。引き継ぎ操作を続けてください。');
}
