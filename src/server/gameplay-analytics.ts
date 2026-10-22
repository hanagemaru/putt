import { CONFIG } from '../config';
import { ACQUISITION_SOURCES, GAMEPLAY_EVENTS, type GameplayPayload } from '../gameplay-analytics-shared';

interface Statement {
  bind(...values: unknown[]): Statement;
  run(): Promise<unknown>;
}
interface Database { prepare(sql: string): Statement; batch(statements: Statement[]): Promise<unknown> }

function valid(value: unknown): value is GameplayPayload {
  if (!value || typeof value !== 'object') return false;
  const p = value as GameplayPayload;
  if (typeof p.session !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(p.session)) return false;
  if (!ACQUISITION_SOURCES.includes(p.source) || !GAMEPLAY_EVENTS.includes(p.event)) return false;
  if (p.event === 'visit') return p.tour === '' && p.hole === 0 && p.outcome === 'none';
  if (!['beginner', 'standard', 'advanced', 'expert'].includes(p.tour)) return false;
  if (p.event === 'hole_complete') return Number.isInteger(p.hole) && p.hole >= 1 && p.hole <= 9 && ['holed', 'gave_up'].includes(p.outcome);
  return p.hole === 0 && p.outcome === 'none';
}

export async function receiveGameplay(request: Request, db: Database | undefined, enabled: boolean): Promise<Response> {
  if (!enabled) return new Response(null, { status: 204 });
  const origin = new URL(request.url).origin;
  if (origin !== 'https://putt.hanage.app' || request.headers.get('Origin') !== origin) return new Response(null, { status: 403 });
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) return new Response(null, { status: 415 });
  if (!db) return new Response(null, { status: 503 });
  try {
    // Bound the stream, not only Content-Length (which may be missing or forged).
    const reader = request.body?.getReader();
    if (!reader) return new Response(null, { status: 400 });
    let bytes = 0;
    let body = '';
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > CONFIG.analytics.maxBodyBytes) {
        await reader.cancel();
        return new Response(null, { status: 413 });
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    let payload: unknown;
    try { payload = JSON.parse(body); } catch { return new Response(null, { status: 400 }); }
    if (!valid(payload)) return new Response(null, { status: 400 });
    const now = Date.now();
    await db.batch([
      db.prepare('DELETE FROM gameplay_events WHERE received_at < ?').bind(now - CONFIG.analytics.retentionDays * 86400000),
      db.prepare(`INSERT OR IGNORE INTO gameplay_events
        (session_id, event, source, tour, hole, outcome, received_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(
        payload.session, payload.event, payload.source, payload.tour, payload.hole, payload.outcome, now,
      ),
    ]);
    return new Response(null, { status: 204 });
  } catch {
    // No raw payloads, identifiers, URLs or IPs in application logs.
    return new Response(null, { status: 503 });
  }
}
