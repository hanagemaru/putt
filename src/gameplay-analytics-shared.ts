/** Fixed categories only: never send raw URLs, UTM values, referrers or ranking identity. */
export const ACQUISITION_SOURCES = ['x_ads', 'x_share', 'x_other', 'hub', 'search', 'other', 'direct'] as const;
export type AcquisitionSource = typeof ACQUISITION_SOURCES[number];
export const GAMEPLAY_EVENTS = ['visit', 'first_shot', 'hole_complete', 'round_complete'] as const;
export type GameplayEvent = typeof GAMEPLAY_EVENTS[number];
export interface GameplayPayload {
  session: string;
  source: AcquisitionSource;
  event: GameplayEvent;
  tour: string;
  hole: number;
  outcome: 'none' | 'holed' | 'gave_up';
}
export function acquisitionSource(search: string, referrer: string): AcquisitionSource {
  const params = new URLSearchParams(search);
  const source = params.get('utm_source')?.toLowerCase();
  const medium = params.get('utm_medium')?.toLowerCase();
  if (source === 'x' || source === 'twitter') {
    if (['cpc', 'paid_social'].includes(medium ?? '')) return 'x_ads';
    if (medium === 'share') return 'x_share';
    return 'x_other';
  }
  let host = '';
  try { host = new URL(referrer).hostname; } catch { /* No usable referrer. */ }
  if (host === 't.co' || host === 'x.com' || host === 'twitter.com') return 'x_other';
  if (host === 'hanage.app' || host === 'www.hanage.app') return 'hub';
  if (/^(www\.)?(google\.(com|co\.jp)|bing\.com|search\.yahoo\.co\.jp)$/.test(host)) return 'search';
  return host && host !== 'putt.hanage.app' ? 'other' : 'direct';
}
