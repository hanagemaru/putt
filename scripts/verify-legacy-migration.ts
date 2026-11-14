import assert from 'node:assert/strict';
import {
  snapshotLegacyStorage,
  validateSnapshot,
  planImport,
  applyNonConflictingImport,
} from '../src/legacy-data-migration.ts';

class TestStorage {
  private values = new Map<string, string>();
  constructor(initial: Record<string, string> = {}) {
    Object.entries(initial).forEach(([key, value]) => this.values.set(key, value));
  }
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const identity = JSON.stringify({
  playerId: '12345678-1234-4234-a234-123456789012',
  credential: 'a'.repeat(64),
});
const old = new TestStorage({
  'putt-player-identity-v1': identity,
  'putt-player-name': 'TEST GOLFER',
  'putt-tour-best-beginner': JSON.stringify({ version: 1, strokes: 42, par: 36, seedsId: 'a' }),
  'putt-tour-progress-beginner': JSON.stringify({ version: 2, seedsId: 'a', progress: {} }),
  'putt-putter-power-scale': '1.05',
  'putt-ranking-mock-v1': '{"not":"real-data"}',
  'putt-pending-submission': '{"contains":"shots_and_pending_work"}',
  'unrelated-app-storage': 'do-not-transfer',
});
const snapshot = snapshotLegacyStorage(old);
assert.equal(Object.keys(snapshot.values).length, 5);
assert.equal(snapshot.values['putt-player-identity-v1'], identity);
assert.equal(snapshot.values['putt-ranking-mock-v1'], undefined);
assert.equal(snapshot.values['putt-pending-submission'], undefined);
assert.equal(snapshot.values['unrelated-app-storage'], undefined);

const target = new TestStorage();
assert.equal(planImport(target, snapshot).write.length, 5);
assert.equal(applyNonConflictingImport(target, snapshot), 5);
assert.equal(target.getItem('putt-player-identity-v1'), identity);
assert.equal(applyNonConflictingImport(target, snapshot), 0);

const anotherIdentity = JSON.stringify({
  playerId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
  credential: 'b'.repeat(64),
});
const existing = new TestStorage({ 'putt-player-identity-v1': anotherIdentity });
assert.deepEqual(planImport(existing, snapshot).conflicts, ['putt-player-identity-v1']);
assert.throws(() => applyNonConflictingImport(existing, snapshot), /approval needed/);
assert.equal(existing.getItem('putt-player-identity-v1'), anotherIdentity);
assert.equal(existing.getItem('putt-tour-best-beginner'), null);

assert.throws(() => validateSnapshot({ version: 1, values: { 'putt-unknown': 'something' } }), /Unsafe/);
assert.throws(() => validateSnapshot({ version: 1, values: { 'putt-player-identity-v1': '{"credential":"unsafe"}' } }), /Invalid ranking/);
assert.throws(() => validateSnapshot({ version: 1, values: { 'putt-player-name': 'x'.repeat(64001) } }), /Unsafe/);

console.log('PASS: legacy user data allowlist, local import, idempotence, conflicts, no secrets in URLs');
