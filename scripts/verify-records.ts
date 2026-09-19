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
//   4. 合えば `verified`、合わなければ `suspicious` を書き戻す
//
// **分かるのは「その打ち出しの列で本当にその打数で上がれるか」だけ**（同 §4-5）。
// 最適な狙いを計算して投げるボットは物理的に正しいので弾けない。ここを越えようとしない。

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

type Verdict = 'verified' | 'suspicious' | 'skip';

interface Judgement {
  verdict: Verdict;
  reason: string;
}

/**
 * 1件を判定する。
 *
 * **判定できないものは `skip`**（`pending` のまま残す）。打ち出しの列が無い古い記録や、
 * 止まらない打ち出しが混じっていたときがこれに当たる。
 * 疑わしきは罰せず、**分からないものを `suspicious` にしない**
 */
function judge(row: PendingRow): Judgement {
  const tour = TOUR_SETS.find((t) => row.board_id.startsWith(`tour:${t.id}:`));
  if (!tour) return { verdict: 'skip', reason: '板が見つからない' };
  if (tourBoardId(tour) !== row.board_id) return { verdict: 'skip', reason: '古い板' };

  let holes: SubmittedHole[];
  let shots: ReplayShot[][];
  try {
    holes = JSON.parse(row.hole_strokes_json) as SubmittedHole[];
    shots = JSON.parse(row.shots_json) as ReplayShot[][];
  } catch {
    return { verdict: 'suspicious', reason: 'JSONが壊れている' };
  }

  if (holes.length !== tour.seeds.length) {
    return { verdict: 'suspicious', reason: `ホール数が違う（${holes.length}）` };
  }
  if (shots.length !== holes.length) return { verdict: 'skip', reason: '打ち出しの列が無い' };

  let total = 0;
  for (let i = 0; i < holes.length; i++) {
    const hole = holes[i];
    if (hole.seed !== tour.seeds[i]) {
      return { verdict: 'suspicious', reason: `H${i + 1} のシードが違う` };
    }

    const setup = tourHoleSetup(tour, hole.seed);
    const course = tourHoleCourse(tour, hole.seed);
    const green = buildHoleGreen(course, setup);
    const roller = buildHoleRoller(green, course, setup);
    const replay = replayHole(roller, course.tee, shots[i]);

    if (replay.aborted) return { verdict: 'skip', reason: `H${i + 1} が止まらない` };
    if (replay.strokes !== hole.strokes) {
      return {
        verdict: 'suspicious',
        reason: `H${i + 1} の打数が合わない（申告 ${hole.strokes} / 再生 ${replay.strokes}）`,
      };
    }
    if (replay.holedOut !== hole.holedOut) {
      return {
        verdict: 'suspicious',
        reason: `H${i + 1} のカップインが合わない（申告 ${hole.holedOut}）`,
      };
    }
    total += replay.strokes;
  }

  if (total !== row.total_strokes) {
    return { verdict: 'suspicious', reason: `合計が合わない（申告 ${row.total_strokes} / 再生 ${total}）` };
  }
  return { verdict: 'verified', reason: `${total}打` };
}

function main(): void {
  // いまの板だけを見る。差し替え前の板は作り直せないので触らない
  const boards = TOUR_SETS.map((tour) => quote(tourBoardId(tour))).join(', ');
  const rows = d1<PendingRow>(
    `SELECT player_id, board_id, total_strokes, hole_strokes_json, shots_json
     FROM records
     WHERE verification_status = 'pending' AND board_id IN (${boards})
     ORDER BY achieved_at ASC
     LIMIT ${Math.trunc(ARGS.limit)}`,
  );

  console.log(`検証待ち: ${rows.length}件（${ARGS.local ? '手元' : '本番'}のD1）`);
  if (rows.length === 0) return;

  const counts = { verified: 0, suspicious: 0, skip: 0 };
  const updates: string[] = [];

  for (const row of rows) {
    const started = Date.now();
    const { verdict, reason } = judge(row);
    counts[verdict]++;
    const mark = verdict === 'verified' ? '○' : verdict === 'suspicious' ? '✗' : '—';
    console.log(
      `${mark} ${row.board_id} ${row.player_id.slice(0, 8)} ${reason}（${Date.now() - started}ms）`,
    );
    if (verdict === 'skip') continue;
    updates.push(
      `UPDATE records SET verification_status = ${quote(verdict)}, updated_at = CURRENT_TIMESTAMP
       WHERE player_id = ${quote(row.player_id)} AND board_id = ${quote(row.board_id)};`,
    );
  }

  console.log(
    `判定: verified ${counts.verified} / suspicious ${counts.suspicious} / 保留 ${counts.skip}`,
  );
  if (updates.length === 0 || ARGS.dry) {
    if (ARGS.dry) console.log('--dry なので書き戻さない');
    return;
  }
  d1(updates.join('\n'));
  console.log(`${updates.length}件を書き戻した`);
}

main();
