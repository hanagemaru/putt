// 週替わりチャレンジを複数年走査する検証入口。
//
// 実行:
//   npm run validate:challenge
//   npm run validate:challenge -- --from-year 2024 --to-year 2030

import {
  CHALLENGE_PARS,
  CHALLENGE_WEEK_MS,
  challengeForDate,
  challengeWeekKey,
  challengeWeekStartTime,
  generateChallenge,
} from '../src/challenge.ts';
import { CHALLENGE_SEED_POOLS_V1 } from '../src/challenge-seeds-v1.ts';
import { generateCourseDetailed } from '../src/course/course-generate.ts';

interface Args {
  fromYear: number;
  toYear: number;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { fromYear: 2024, toYear: 2030 };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inlineValue] = argv[i].split('=', 2);
    if (flag !== '--from-year' && flag !== '--to-year') {
      throw new Error(`不明な引数です: ${argv[i]}`);
    }
    const raw = inlineValue ?? argv[++i];
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1970 || value > 9999) {
      throw new Error(`${flag} は1970〜9999の整数で指定してください: ${raw ?? ''}`);
    }
    if (flag === '--from-year') args.fromYear = value;
    else args.toYear = value;
  }
  if (args.fromYear > args.toYear) {
    throw new Error(`--from-year は --to-year 以下にしてください`);
  }
  return args;
}

function weekKeys(fromYear: number, toYear: number): string[] {
  const keys = new Set<string>();
  const firstDay = Date.UTC(fromYear, 0, 1, 3);
  const lastDay = Date.UTC(toYear, 11, 31, 3);
  for (let time = firstDay; time <= lastDay; time += 24 * 60 * 60 * 1000) {
    keys.add(challengeWeekKey(new Date(time)));
  }
  return [...keys].sort();
}

const { fromYear, toYear } = parseArgs(process.argv.slice(2));
const keys = weekKeys(fromYear, toYear);
const failures: string[] = [];
const poolSeeds = new Set<number>();

// 方式v1の候補全体を確認する。週の走査でたまたま選ばれない候補も見落とさない。
for (const par of CHALLENGE_PARS) {
  for (const seed of CHALLENGE_SEED_POOLS_V1[par]) {
    if (poolSeeds.has(seed)) failures.push(`候補シード${seed}がPAR間で重複している`);
    poolSeeds.add(seed);
    const generated = generateCourseDetailed(seed);
    if (generated.fallback) failures.push(`候補シード${seed}がfallbackになった`);
    if (generated.course.par !== par) {
      failures.push(`候補シード${seed}がPAR${par}ではなくPAR${generated.course.par}`);
    }
  }
}

for (const weekKey of keys) {
  const first = generateChallenge(weekKey);
  const second = generateChallenge(weekKey);

  if (JSON.stringify(first) !== JSON.stringify(second)) {
    failures.push(`${weekKey}: 同じ週キーで結果が一致しない`);
  }
  if (first.holes.map((hole) => hole.par).join(',') !== CHALLENGE_PARS.join(',')) {
    failures.push(`${weekKey}: PAR構成が3,4,5ではない`);
  }
  if (new Set(first.seeds).size !== first.seeds.length) {
    failures.push(`${weekKey}: シードが重複している (${first.seeds.join(', ')})`);
  }

  // 日本時間の月曜0時の1ms前までは前週、0時ちょうどから新しい週になる。
  const start = challengeWeekStartTime(weekKey);
  const previousKey = challengeWeekKey(new Date(start - 1));
  const atStartKey = challengeWeekKey(new Date(start));
  const atEndKey = challengeWeekKey(new Date(start + CHALLENGE_WEEK_MS - 1));
  const nextKey = challengeWeekKey(new Date(start + CHALLENGE_WEEK_MS));
  if (atStartKey !== weekKey || atEndKey !== weekKey) {
    failures.push(`${weekKey}: 週の開始または終了時刻が同じ週キーにならない`);
  }
  if (previousKey === weekKey || nextKey === weekKey || previousKey === nextKey) {
    failures.push(`${weekKey}: 月曜0時前後で週キーが正しく切り替わらない`);
  }

  for (const time of [start, start + 3 * 24 * 60 * 60 * 1000, start + CHALLENGE_WEEK_MS - 1]) {
    const atTime = challengeForDate(new Date(time));
    if (JSON.stringify(atTime) !== JSON.stringify(first)) {
      failures.push(`${weekKey}: 同じ週の実行時刻でチャレンジが変わった`);
      break;
    }
  }
}

console.log(
  `候補${poolSeeds.size}シードと、${fromYear}〜${toYear}年にかかる${keys.length}週を走査: ` +
    '決定論 / PAR3・4・5 / シード重複なし / fallbackなし / 月曜0時境界',
);

if (failures.length > 0) {
  for (const failure of failures.slice(0, 20)) console.error(`  ! ${failure}`);
  if (failures.length > 20) console.error(`  ! ほか ${failures.length - 20}件`);
  process.exit(1);
}

console.log('すべてOK');
