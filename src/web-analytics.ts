const token = import.meta.env.VITE_CF_BEACON_TOKEN;

/**
 * Cloudflare Web Analytics beacon.
 *
 * The site token is injected at build time via VITE_CF_BEACON_TOKEN.
 * Local/preview builds without the variable do not emit analytics traffic.
 */
export function installWebAnalytics(): void {
  if (!token) return;
  if (document.querySelector('script[data-cf-beacon]')) return;

  const script = document.createElement('script');
  script.defer = true;
  script.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  script.dataset.cfBeacon = JSON.stringify({ token });
  document.head.appendChild(script);
}
