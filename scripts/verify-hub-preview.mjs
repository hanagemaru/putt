import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const prefix = '/games/putt/play/';
const html = readFileSync('dist/index.html', 'utf8');
const manifest = JSON.parse(readFileSync('dist/manifest.webmanifest', 'utf8'));

assert.ok(html.includes(`${prefix}manifest.webmanifest`), 'manifest URL must be under hub path');
assert.ok(html.includes(`${prefix}assets/`), 'Vite asset URLs must be under hub path');
assert.ok(
  html.includes('<link rel="canonical" href="https://hanage.app/games/putt/play/" />'),
  'hub Putt build needs a canonical root-domain game URL',
);
assert.equal(manifest.start_url, prefix);
assert.equal(manifest.scope, prefix);
assert.equal(manifest.id, prefix);
assert.equal(manifest.display, 'standalone');
for (const icon of manifest.icons) {
  assert.ok(icon.src.startsWith(`${prefix}icons/`), `icon escaped prefix: ${icon.src}`);
}
assert.ok(existsSync('dist/sw.js'), 'service worker output is missing');
console.log('PASS: subpath assets, PWA manifest, and service worker');
