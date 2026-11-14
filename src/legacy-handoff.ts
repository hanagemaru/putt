import {
  snapshotLegacyStorage,
  validateSnapshot,
  planImport,
  applyNonConflictingImport,
} from './legacy-data-migration';

// These are fixed at build time, never supplied by URL/query-string/remote data.
// Production transfer is explicitly off until both sites have been reviewed.
const MODE = import.meta.env.VITE_HANDOFF_ENV ?? 'disabled';
const IS_PREVIEW = MODE === 'preview-source' || MODE === 'preview-target';
const LEGACY_ORIGIN = IS_PREVIEW
  ? 'https://putt-legacy-preview.jibunnha.workers.dev'
  : 'https://putt.hanage.app';
const HUB_ORIGIN = IS_PREVIEW
  ? 'https://putt-hub-preview.jibunnha.workers.dev'
  : 'https://hanage.app';
const HUB_PLAY_PATH = '/games/putt/play/';
const HANDOFF_QUERY = 'legacyHandoff';
const READY = 'putt-record-handoff-ready-v1';
const REQUEST = 'putt-record-handoff-request-v1';
const TRANSFER = 'putt-record-handoff-data-v1';
const TIMEOUT_MS = 120_000;

type Status = (message: string, success?: boolean) => void;

function isLegacySite(): boolean {
  return (MODE === 'preview-source' || MODE === 'production') &&
    location.origin === LEGACY_ORIGIN && location.pathname === '/';
}

export function isLegacyHandoffPage(): boolean {
  return isLegacySite() &&
    new URLSearchParams(location.search).get(HANDOFF_QUERY) === '1';
}

export function canOfferHandoff(): boolean {
  return (MODE === 'preview-target' || MODE === 'production') &&
    location.origin === HUB_ORIGIN && location.pathname === HUB_PLAY_PATH;
}

export function canSeedPreviewRecords(): boolean {
  return MODE === 'preview-source' && isLegacySite();
}

/** Only the designated preview can generate dummy data. No real site is modified. */
export function seedPreviewRecords(storage: Storage): boolean {
  if (!canSeedPreviewRecords()) return false;
  const idKey = 'putt-player-identity-v1';
  if (storage.getItem(idKey) !== null) return false;
  const credential = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map(value => value.toString(16).padStart(2, '0')).join('');
  storage.setItem(idKey, JSON.stringify({ playerId: crypto.randomUUID(), credential }));
  if (storage.getItem('putt-player-name') === null) {
    storage.setItem('putt-player-name', '引き継ぎテスト');
  }
  return true;
}

function validNonce(candidate: unknown): candidate is string {
  return typeof candidate === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate);
}

/**
 * Source: accept a request only from the exact new origin and the opening
 * window, then require a separate explicit click before transmitting secrets.
 */
export function prepareLegacyHandoff(
  readyToApprove: (approve: () => void) => void,
  status: Status,
): void {
  if (!isLegacyHandoffPage()) return;
  const opener = window.opener;
  if (!opener) {
    status('元の画面との接続がありません。新しいPuttからSafariで開き直してください。');
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
        // Never send to the wildcard origin; never embed credentials in URLs.
        opener.postMessage({ type: TRANSFER, nonce: msg.nonce, snapshot }, HUB_ORIGIN);
        status('送信しました。新しいPuttの画面を確認してください。', true);
      } catch {
        status('端末内の記録を読み取れませんでした。旧サイトの記録は変更していません。');
      }
    });
    status('新しいPuttからの要求を確認しました。「記録を移す」で送信します。');
  });
  opener.postMessage({ type: READY }, HUB_ORIGIN);
  status('新しいPuttからの要求を確認しています。');
}

/**
 * Target: open the old origin only from the user's click, check source window,
 * exact origin and a fresh nonce. Conflicts are never overwritten, including
 * the ranking identity (which could orphan a newer score).
 */
export function startHandoffFromHub(status: Status): void {
  if (!canOfferHandoff()) {
    status('この画面からは引き継げません。');
    return;
  }
  const nonce = crypto.randomUUID();
  let source: Window | null = null;
  let finished = false;
  let requested = false;
  const cleanup = () => {
    window.removeEventListener('message', listener);
    clearTimeout(timeout);
  };
  const listener = (event: MessageEvent) => {
    if (finished || !source || event.source !== source || event.origin !== LEGACY_ORIGIN) return;
    const msg = event.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === READY && !requested) {
      requested = true;
      source.postMessage({ type: REQUEST, nonce }, LEGACY_ORIGIN);
      status('旧サイトで「記録を移す」を押してください。');
      return;
    }
    if (msg.type !== TRANSFER || !requested || msg.nonce !== nonce) return;
    finished = true;
    cleanup();
    try {
      const snapshot = validateSnapshot(msg.snapshot);
      if (Object.keys(snapshot.values).length === 0) {
        status('旧サイトに引き継げる記録がありません。');
        return;
      }
      const plan = planImport(localStorage, snapshot);
      if (plan.conflicts.length > 0) {
        status('新しいPuttに別の記録があります。上書きせずに中止しました。旧サイトの記録は残っています。');
        return;
      }
      applyNonConflictingImport(localStorage, snapshot);
      status('引き継ぎが完了しました。再読み込みして反映します。', true);
      source.close();
      window.location.reload();
    } catch {
      status('保存できませんでした。旧サイトの記録は残っています。');
    }
  };
  window.addEventListener('message', listener);
  const timeout = window.setTimeout(() => {
    if (finished) return;
    finished = true;
    cleanup();
    status('引き継ぎが時間切れになりました。必要なら再試行してください。');
  }, TIMEOUT_MS);
  source = window.open(`${LEGACY_ORIGIN}/?${HANDOFF_QUERY}=1`, '_blank');
  if (!source) {
    finished = true;
    cleanup();
    status('旧サイトを開けませんでした。Safariで新しいPuttを開いて再試行してください。');
    return;
  }
  status('旧サイトを開きました。記録の引き継ぎを続けてください。');
}
