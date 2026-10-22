import { CONFIG } from './config';
import { acquisitionSource, type GameplayEvent, type GameplayPayload, type AcquisitionSource } from './gameplay-analytics-shared';

const KEY = 'putt-gameplay-session-v1';
interface Session { id: string; source: AcquisitionSource; touched: number }
let memory: Session | null = null;
const sent = new Set<string>();

function enabled(): boolean {
  if (!import.meta.env.PROD || import.meta.env.VITE_GAMEPLAY_ANALYTICS !== 'true') return false;
  if (location.hostname !== 'putt.hanage.app' || !['/', '/index.html'].includes(location.pathname)) return false;
  const params = new URLSearchParams(location.search);
  return !['social', 'debug', 'ranking', 'rankingMock', 'tune', 'theme', 'seed', 'gen', 'course', 'setup'].some(key => params.has(key));
}

/** A tab visit with a 30-minute idle timeout; no cross-day visitor identity. */
function session(): Session {
  const now = Date.now();
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as Session | null;
    if (saved && /^[0-9a-f-]{36}$/.test(saved.id) && now - saved.touched < CONFIG.analytics.sessionIdleMs) memory = saved;
  } catch { /* Storage may be blocked. Use page memory instead. */ }
  if (!memory || now - memory.touched >= CONFIG.analytics.sessionIdleMs) {
    memory = { id: crypto.randomUUID(), source: acquisitionSource(location.search, document.referrer), touched: now };
  }
  memory.touched = now;
  try { sessionStorage.setItem(KEY, JSON.stringify(memory)); } catch { /* Gameplay remains available. */ }
  return memory;
}

function send(payload: GameplayPayload): void {
  const key = [payload.session, payload.event, payload.tour, payload.hole].join(':');
  if (sent.has(key)) return;
  sent.add(key);
  // No ranking credentials/cookies. A missing schema, offline device or rejected request never blocks play.
  void fetch('/api/gameplay-events', {
    method: 'POST', credentials: 'omit', keepalive: true,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  }).then(response => { if (!response.ok) sent.delete(key); }).catch(() => { sent.delete(key); });
}

export function trackGameplay(event: GameplayEvent, tour = '', hole = 0, outcome: GameplayPayload['outcome'] = 'none'): void {
  if (!enabled()) return;
  try {
    const current = session();
    const base = { session: current.id, source: current.source };
    // Always establish the denominator, including direct entry and idle-session renewal.
    send({ ...base, event: 'visit', tour: '', hole: 0, outcome: 'none' });
    if (event !== 'visit') send({ ...base, event, tour, hole, outcome });
  } catch { /* Crypto/storage/network restrictions must not affect a shot. */ }
}
