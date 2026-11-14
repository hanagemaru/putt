/**
 * A future, opt-in handoff from putt.hanage.app to hanage.app.
 * This module only reads/validates localStorage. It does not transmit anything.
 * The caller must use an exact-origin, explicitly user-initiated postMessage
 * exchange; NEVER put a ranking credential into a URL, QR code or log.
 */
export interface LegacySnapshot {
  version: 1;
  values: Record<string, string>;
}

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

const EXACT_KEYS = new Set([
  'putt-player-identity-v1',
  'putt-player-name',
  'putt-putter-power-scale',
]);

const PREFIXES = ['putt-tour-best-', 'putt-tour-progress-'];
const MAX_KEYS = 20;
const MAX_BYTES = 128_000;
const MAX_ITEM_LENGTH = 64_000;

export function permittedMigrationKey(key: string): boolean {
  return EXACT_KEYS.has(key) || PREFIXES.some(prefix =>
    key.startsWith(prefix) && /^[a-z][a-z0-9-]{0,49}$/.test(key.slice(prefix.length)),
  );
}

function validIdentity(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object') return false;
    const item = parsed as Record<string, unknown>;
    return typeof item.playerId === 'string' &&
      /^[a-z0-9-]{8,80}$/i.test(item.playerId) &&
      typeof item.credential === 'string' &&
      /^[0-9a-f]{64}$/i.test(item.credential);
  } catch {
    return false;
  }
}

export function snapshotLegacyStorage(storage: StorageLike): LegacySnapshot {
  const values: Record<string, string> = Object.create(null);
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key || !permittedMigrationKey(key)) continue;
    const value = storage.getItem(key);
    if (value === null || value.length > MAX_ITEM_LENGTH) continue;
    if (key === 'putt-player-identity-v1' && !validIdentity(value)) continue;
    values[key] = value;
  }
  return validateSnapshot({ version: 1, values });
}

export function validateSnapshot(candidate: unknown): LegacySnapshot {
  if (!candidate || typeof candidate !== 'object') throw new Error('Invalid migration payload');
  const data = candidate as Partial<LegacySnapshot>;
  if (data.version !== 1 || !data.values || typeof data.values !== 'object' || Array.isArray(data.values)) {
    throw new Error('Unsupported migration payload');
  }
  const values: Record<string, string> = Object.create(null);
  const entries = Object.entries(data.values);
  if (entries.length > MAX_KEYS) throw new Error('Too many migration fields');
  let size = 0;
  for (const [key, value] of entries) {
    if (!permittedMigrationKey(key) || typeof value !== 'string' || value.length > MAX_ITEM_LENGTH) {
      throw new Error('Unsafe migration field');
    }
    if (key === 'putt-player-identity-v1' && !validIdentity(value)) {
      throw new Error('Invalid ranking identity');
    }
    size += key.length + value.length;
    if (size > MAX_BYTES) throw new Error('Migration payload too large');
    values[key] = value;
  }
  return { version: 1, values };
}

export interface ImportPlan {
  write: string[];
  identical: string[];
  conflicts: string[];
}

/**
 * No silent overwrite. Conflicts are surfaced before importing.
 * In particular, replacing ranking identity may detach existing scores.
 */
export function planImport(storage: StorageLike, candidate: unknown): ImportPlan {
  const snapshot = validateSnapshot(candidate);
  const plan: ImportPlan = { write: [], identical: [], conflicts: [] };
  for (const [key, value] of Object.entries(snapshot.values)) {
    const existing = storage.getItem(key);
    if (existing === null) plan.write.push(key);
    else if (existing === value) plan.identical.push(key);
    else plan.conflicts.push(key);
  }
  return plan;
}

/** Returns only counts. Never log keys that could include player details or values. */
export function applyNonConflictingImport(storage: StorageLike, candidate: unknown): number {
  const snapshot = validateSnapshot(candidate);
  const plan = planImport(storage, snapshot);
  if (plan.conflicts.length) throw new Error('Destination has existing data; user approval needed');
  // Best effort rollback on a quota/security exception.
  const written: string[] = [];
  try {
    for (const key of plan.write) {
      storage.setItem(key, snapshot.values[key]);
      written.push(key);
    }
  } catch {
    for (const key of written) storage.removeItem(key);
    throw new Error('Local migration write failed');
  }
  return written.length;
}
