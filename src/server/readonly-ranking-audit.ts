/**
 * One-off read-only adapter for production D1 connectivity verification.
 * This is not a public-facing game Worker. It intentionally removes auth and
 * exposes only anonymous GET health + rankings; all writes/other paths are 405.
 * In particular, no gameplay analytics or player deletion can be called.
 */
import { handleRequest } from './worker';

type ReadOnlyEnv = Parameters<typeof handleRequest>[1];

export default {
  async fetch(request: Request, env: ReadOnlyEnv): Promise<Response> {
    const { pathname } = new URL(request.url);
    const allowed = pathname === '/games/putt/play/api/health' ||
      pathname === '/games/putt/play/api/rankings';
    if (request.method !== 'GET' || !allowed) {
      return new Response('Method or path not permitted', { status: 405 });
    }
    const headers = new Headers(request.headers);
    // This audit only checks public leaderboard data. Don't accept credentials.
    headers.delete('Authorization');
    headers.delete('Cookie');
    const safeRequest = new Request(request.url, { method: 'GET', headers });
    return handleRequest(safeRequest, { DB: env.DB, GAMEPLAY_ANALYTICS: 'false' });
  },
};
