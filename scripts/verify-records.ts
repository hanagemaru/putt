// ランキングのリプレイ検証（段2。`docs/ranking.md` §4-4-1 の案A）。
//
// **Workerの中では回さない。** 無料枠は1リクエスト10ms CPUで、コース生成だけで
// v2は80ms/ホールかかる。ここはGitHub Actionsの定期バッチとしてNodeで回す。
// 720msはNodeでは何でもない。
//
//   npm run verify:records              … 本番のD1を見る（要 CLOUDFLARE_API_TOKEN）
//   npm run verify:records -- --local   … 手元のD1
//   npm run verify:records -- --dry     … 判定するだけで書き戻さない
//
// やること。
//
//   1. `pending` の記録を古い順に読む（**いまの板のものだけ**）
//   2. 板IDからツアーを引き、**ゲーム本体と同じ組み立て**でホールを作り直す
//      （`src/course/hole-build.ts`）
//   3. 送られてきた打ち出しの列を**同じ物理で再生**し、ホールごとの打数と一致を見る
//   4. 合えば `verified`、合わなければ `flagged` を書き戻す
//
// **合わなかった記録も板からは外さない**（`flagged` は載ったまま）。外すかどうかは人が決める。
// `flagged` が1件でも出たら**このバッチをわざと失敗させる**ので、定期実行が赤くなり、
// GitHubがリポジトリの持ち主へメールを送る。判断の手順は `DEPLOY.md`。
//
// **物理・罰打の規則を変えたら `CONFIG.game.ranking.rulesVersion` を上げること。**
// 版は板IDに入るので、上げれば古い記録は別の板へ残り、ここでは触らない。
// 上げ忘れると、古い記録が新しい規則で再生されて打数が合わず `flagged` が並ぶ
// （消えはしないが、人が判断する手間だけが増える）。
//
// **分かるのは「その打ち出しの列で本当にその打数で上がれるか」だけ**（同 §4-5）。
// 最適な狙いを計算して投げるボットは物理的に正しいので弾けない。ここを越えようとしない。

import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { CONFIG } from '../src/config.ts';
import { TOUR_SETS } from '../src/course/tour-holes.ts';
import {
  buildHoleGreen,
  buildHoleRoller,
  tourHoleCourse,
  tourHoleSetup,
} from '../src/course/hole-build.ts';
import { replayHole, type ReplayShot } from '../src/hole-sim.ts';
import { tourBoardId } from '../src/ranking-shared.ts';

const V = CONFIG.game.ranking.verify;
const RULES_VERSION = CONFIG.game.ranking.rulesVersion;
const DATABASE = 'putt-ranking';

interface Args {
  local: boolean;
  dry: boolean;
  limit: number;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { local: false, dry: false, limit: V.batchLimit };
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=');
    if (key === 'local') args.local = true;
    else if (key === 'dry') args.dry = true;
    else if (key === 'limit' && value) args.limit = Number(value);
  }
  return args;
}

const ARGS = parseArgs(process.argv.slice(2));

/** wrangler 越しにSQLを1本流す。**結果はJSONで受ける** */
function d1<T>(sql: string): T[] {
  const out = execFileSync(
    'npx',
    [
      'wrangler',
      'd1',
      'execute',
      DATABASE,
      ARGS.local ? '--local' : '--remote',
      '--json',
      '--command',
      sql,
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] },
  );
  // `--json` は配列で返る（文ごとに1つ）。最初の文の results だけ使う
  const parsed = JSON.parse(out) as { results?: T[] }[];
  return parsed[0]?.results ?? [];
}

/** SQLの文字列リテラル。**識別子と打数しか入れない**が、素通しにはしない */
function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

interface PendingRow {
  player_id: string;
  board_id: string;
  total_strokes: number;
  rules_version: number;
  hole_strokes_json: string;
  shots_json: string;
}

interface SubmittedHole {
  number: number;
  seed: number;
  par: number;
  strokes: number;
  holedOut: boolean;
}

type Verdict = 'verified' | 'flagged' | 'skip';

interface Judgement {
  verdict: Verdict;
  reason: string;
}

/**
 * 1件を判定する。
 *
 * **判定できないものは `skip`**（`pending` のまま残す）。打ち出しの列が無い古い記録や、
 * 止まらない打ち出しが混じっていたときがこれに当たる。
 * 疑わしきは罰せず、**分からないものを `flagged` にしない**。
 *
 * そして `flagged` も板から外す判定ではない。**外すのは人だけ**
 */
function judge(row: PendingRow): Judgement {
  const tour = TOUR_SETS.find((t) => row.board_id.startsWith(`tour:${t.id}:`));
  if (!tour) return { verdict: 'skip', reason: '板が見つからない' };
  if (tourBoardId(tour) !== row.board_id) return { verdict: 'skip', reason: '古い板' };
  // 規則の版が違うものは**別の物理・別の罰打で出した打数**なので再生しても合わない。
  // 板IDにも版が入っているので普通は届かないが、取り違えたら判定せずに残す
  if (row.rules_version !== RULES_VERSION) {
    return { verdict: 'skip', reason: `規則の版が違う（記録 r${row.rules_version}）` };
  }

  let holes: SubmittedHole[];
  let shots: ReplayShot[][];
  try {
    holes = JSON.parse(row.hole_strokes_json) as SubmittedHole[];
    shots = JSON.parse(row.shots_json) as ReplayShot[][];
  } catch {
    return { verdict: 'flagged', reason: 'JSONが壊れている' };
  }

  if (holes.length !== tour.seeds.length) {
    return { verdict: 'flagged', reason: `ホール数が違う（${holes.length}）` };
  }
  if (shots.length !== holes.length) return { verdict: 'skip', reason: '打ち出しの列が無い' };

  let total = 0;
  for (let i = 0; i < holes.length; i++) {
    const hole = holes[i];
    if (hole.seed !== tour.seeds[i]) {
      return { verdict: 'flagged', reason: `H${i + 1} のシードが違う` };
    }

    const setup = tourHoleSetup(tour, hole.seed);
    const course = tourHoleCourse(tour, hole.seed);
    const green = buildHoleGreen(course, setup);
    const roller = buildHoleRoller(green, course, setup);
    const replay = replayHole(roller, course.tee, shots[i]);

    if (replay.aborted) return { verdict: 'skip', reason: `H${i + 1} が止まらない` };
    if (replay.strokes !== hole.strokes) {
      return {
        verdict: 'flagged',
        reason: `H${i + 1} の打数が合わない（申告 ${hole.strokes} / 再生 ${replay.strokes}）`,
      };
    }
    if (replay.holedOut !== hole.holedOut) {
      return {
        verdict: 'flagged',
        reason: `H${i + 1} のカップインが合わない（申告 ${hole.holedOut}）`,
      };
    }
    total += replay.strokes;
  }

  if (total !== row.total_strokes) {
    return {
      verdict: 'flagged',
      reason: `合計が合わない（申告 ${row.total_strokes} / 再生 ${total}）`,
    };
  }
  return { verdict: 'verified', reason: `${total}打` };
}

/**
 * 結果をGitHub Actionsの実行結果（Summary）へも残す。
 * **メールで気づいた人が、開いてすぐ何件・なぜかを読めるように**
 */
function writeSummary(lines: readonly string[]): void {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  try {
    appendFileSync(path, `${lines.join('\n')}\n`, 'utf8');
  } catch {
    // Summaryが書けなくてもログには出ているので、ここで止めない
  }
}

interface FlaggedRow {
  player_id: string;
  board_id: string;
  total_strokes: number;
  updated_at: string;
}

function main(): void {
  // いまの板だけを見る。差し替え前の板は作り直せないので触らない
  const boards = TOUR_SETS.map((tour) => quote(tourBoardId(tour))).join(', ');
  const rows = d1<PendingRow>(
    `SELECT player_id, board_id, total_strokes, rules_version, hole_strokes_json, shots_json
     FROM records
     WHERE verification_status = 'pending' AND board_id IN (${boards})
     ORDER BY achieved_at ASC
     LIMIT ${Math.trunc(ARGS.limit)}`,
  );

  console.log(`検証待ち: ${rows.length}件（${ARGS.local ? '手元' : '本番'}のD1）`);

  const counts = { verified: 0, flagged: 0, skip: 0 };
  const updates: string[] = [];
  /** この回で `flagged` にしたものの理由。**理由は表に残らないのでここでしか出せない** */
  const reasons = new Map<string, string>();

  for (const row of rows) {
    const started = Date.now();
    const { verdict, reason } = judge(row);
    counts[verdict]++;
    const mark = verdict === 'verified' ? '○' : verdict === 'flagged' ? '✗' : '—';
    console.log(
      `${mark} ${row.board_id} ${row.player_id.slice(0, 8)} ${reason}（${Date.now() - started}ms）`,
    );
    if (verdict === 'flagged') reasons.set(`${row.board_id}\u0000${row.player_id}`, reason);
    if (verdict === 'skip') continue;
    updates.push(
      `UPDATE records SET verification_status = ${quote(verdict)}, updated_at = CURRENT_TIMESTAMP
       WHERE player_id = ${quote(row.player_id)} AND board_id = ${quote(row.board_id)};`,
    );
  }

  if (rows.length > 0) {
    console.log(`判定: verified ${counts.verified} / flagged ${counts.flagged} / 保留 ${counts.skip}`);
  }
  if (updates.length > 0 && !ARGS.dry) {
    d1(updates.join('\n'));
    console.log(`${updates.length}件を書き戻した`);
  } else if (ARGS.dry && updates.length > 0) {
    console.log('--dry なので書き戻さない');
  }

  // **判断が済んでいない `flagged` は、この回で出したものも前の回のものも全部数える。**
  // 1通のメールを見落としても、次のバッチがまた赤くなる
  const outstanding = ARGS.dry
    ? []
    : d1<FlaggedRow>(
        `SELECT player_id, board_id, total_strokes, updated_at
         FROM records
         WHERE verification_status = 'flagged' AND board_id IN (${boards})
         ORDER BY updated_at ASC`,
      );

  if (outstanding.length === 0 && counts.flagged === 0) {
    if (rows.length > 0) {
      writeSummary([`検証: ${rows.length}件（verified ${counts.verified} / 保留 ${counts.skip}）`]);
    }
    return;
  }

  const listed = outstanding.length > 0
    ? outstanding.map((row) => {
        const reason = reasons.get(`${row.board_id}\u0000${row.player_id}`) ?? '前の回の判定（理由は過去の実行ログ）';
        return `| \`${row.board_id}\` | \`${row.player_id}\` | ${row.total_strokes} | ${reason} |`;
      })
    : [...reasons].map(([key, reason]) => {
        const [boardId, playerId] = key.split('\u0000');
        return `| \`${boardId}\` | \`${playerId}\` | - | ${reason} |`;
      });

  // **ここで失敗させる。** 定期実行が赤くなると、GitHubが持ち主へメールを送る。
  // 記録は板に載ったままなので急ぐ必要はない。**人が見て決めるまで、毎回赤いままにする**
  writeSummary([
    `## 要確認: ${listed.length}件が \`flagged\``,
    '',
    '記録は**板に載ったまま**です（順位も出ています）。中身を見て `verified`（問題なし）か',
    '`suspicious`（板から外す）へ書き換えてください。**書き換えるまで、このワークフローは毎回失敗します。**',
    '手順は `DEPLOY.md`。',
    '',
    '| 板 | プレイヤー | 打数 | 理由 |',
    '| --- | --- | --- | --- |',
    ...listed,
  ]);
  console.error(`\n要確認: ${listed.length}件が flagged（板には載ったまま・判断待ち）`);
  process.exitCode = 1;
}

main();
