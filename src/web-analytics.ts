const token = import.meta.env.VITE_CF_BEACON_TOKEN;

/** Production page-view analytics only; no player IDs or gameplay records are sent. */
export function installWebAnalytics(): void {
  if (!import.meta.env.PROD || !token) return;
  if (window.location.hostname !== 'putt.hanage.app') return;
  const params = new URLSearchParams(window.location.search);
  if (['social', 'debug', 'ranking', 'rankingMock'].some((key) => params.has(key))) return;
  if (document.querySelector('script[data-cf-beacon]')) return;
  const script = document.createElement('script');
  script.defer = true;
  script.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  script.dataset.cfBeacon = JSON.stringify({ token });
  document.head.appendChild(script);
}
