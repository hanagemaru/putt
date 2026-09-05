// 週替わりチャレンジのコア（spec §6）。
//
// 日時から日本時間の週キーを作り、そのキーだけから全ユーザー共通の3シードを選ぶ。
// 画面・URL・ランキングは知らず、ここで得た seeds を既存の Round と
// RoundProgressStore へ渡せるようにする。

import { CONFIG } from './config';
import { CHALLENGE_SEED_POOLS_V1 } from './challenge-seeds-v1';
import { Round } from './round';
import { RoundProgressStore } from './round-storage';

const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const WEEK_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export const CHALLENGE_GENERATION_VERSION = 1;
export const CHALLENGE_PARS = [3, 4, 5] as const;

export type ChallengePar = (typeof CHALLENGE_PARS)[number];

export interface ChallengeHole {
  /** generateCourse(seed) へそのまま渡す元シード */
  readonly seed: number;
  readonly par: ChallengePar;
}

export interface ChallengeDefinition {
  readonly kind: 'weekly';
  /** 生成規則を変えるときに上げ、古い規則は再現用に残す */
  readonly generationVersion: number;
  /** その週の月曜日（日本時間）の YYYY-MM-DD */
  readonly weekKey: string;
  /** ランキングや保存先を週・生成方式ごとに分ける識別子 */
  readonly id: string;
  readonly holes: readonly [ChallengeHole, ChallengeHole, ChallengeHole];
  /** Round へそのまま渡せるシード列 */
  readonly seeds: readonly [number, number, number];
}

/**
 * 日時が属する、日本時間で月曜0時始まりの週キーを返す。
 * ローカルタイムのgetterを使わないため、端末のタイムゾーンには依存しない。
 */
export function challengeWeekKey(at: Date): string {
  const time = at.getTime();
  if (!Number.isFinite(time)) throw new Error('有効な日時を指定してください');

  const jst = new Date(time + JST_OFFSET_MS);
  const daysFromMonday = (jst.getUTCDay() + 6) % 7;
  jst.setUTCDate(jst.getUTCDate() - daysFromMonday);
  return formatDateKey(jst.getUTCFullYear(), jst.getUTCMonth() + 1, jst.getUTCDate());
}

/** 週キーから、指定した生成方式の全ユーザー共通3ホールを作る。 */
export function generateChallenge(
  weekKey: string,
  generationVersion = CHALLENGE_GENERATION_VERSION,
): ChallengeDefinition {
  assertMondayWeekKey(weekKey);
  if (generationVersion !== 1) {
    throw new Error(`未対応のチャレンジ生成方式です: ${generationVersion}`);
  }
  return generateChallengeV1(weekKey);
}

/** 現在日時（または指定日時）から、その週のチャレンジを作る薄い入口。 */
export function challengeForDate(at: Date = new Date()): ChallengeDefinition {
  return generateChallenge(challengeWeekKey(at));
}

/** 既存のラウンド進行をチャレンジでも使うための入口。 */
export function createChallengeRound(challenge: ChallengeDefinition): Round {
  return new Round(challenge.seeds);
}

/**
 * 既存の保存形式をチャレンジでも使うための入口。
 * キーを週・生成方式ごとに分け、シード列の照合も RoundProgressStore に任せる。
 */
export function createChallengeProgressStore(
  challenge: ChallengeDefinition,
): RoundProgressStore {
  return new RoundProgressStore(
    `${CONFIG.game.round.save.challengeKeyPrefix}:${challenge.id}`,
    CONFIG.game.round.save.version,
    challenge.seeds,
  );
}

function generateChallengeV1(weekKey: string): ChallengeDefinition {
  const holes = CHALLENGE_PARS.map((par) => {
    const pool = CHALLENGE_SEED_POOLS_V1[par];
    const index = hash32(`putt:challenge:v1:${weekKey}:par${par}`) % pool.length;
    return { seed: pool[index], par };
  }) as [ChallengeHole, ChallengeHole, ChallengeHole];
  const seeds: [number, number, number] = [holes[0].seed, holes[1].seed, holes[2].seed];
  return {
    kind: 'weekly',
    generationVersion: 1,
    weekKey,
    id: `weekly-v1-${weekKey}`,
    holes,
    seeds,
  };
}

/** FNV-1a 32bitとavalanche。文字列から端末差のない、偏りを散らしたuint32を作る。 */
function hash32(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

function assertMondayWeekKey(weekKey: string): void {
  const match = WEEK_KEY_PATTERN.exec(weekKey);
  if (!match) throw new Error(`週キーは YYYY-MM-DD で指定してください: ${weekKey}`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCDay() !== 1
  ) {
    throw new Error(`週キーは実在する月曜日を指定してください: ${weekKey}`);
  }
}

function formatDateKey(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** 検証スクリプト用。日本時間の週境界をUTCの時刻へ戻す。 */
export function challengeWeekStartTime(weekKey: string): number {
  assertMondayWeekKey(weekKey);
  const [year, month, day] = weekKey.split('-').map(Number);
  return Date.UTC(year, month - 1, day) - JST_OFFSET_MS;
}

/** 検証スクリプト用。1週間の長さ（日本には夏時間がない）。 */
export const CHALLENGE_WEEK_MS = DAY_MS * 7;
