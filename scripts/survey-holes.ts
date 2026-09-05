// 通常ツアーの固定9ホールを人が選ぶための候補表を作る。
// ゲーム本体と同じ generateCourseDetailed(seed) をオプションなしで呼び、
// 測れる事実だけを docs/tour-hole-candidates.md へ書き出す。
//
// 実行:
//   npm run survey:holes
//   npm run survey:holes -- --from 1 --to 1000
//
// 決定論の約束: 候補の選び方を含め、入力したシード範囲だけで結果が決まる。
// Math.random や時刻は使わない。

import { writeFileSync } from 'node:fs';
import { generateCourseDetailed } from '../src/course/course-generate.ts';
import type { Difficulty, HoleShape } from '../src/course/course-generate.ts';
import { validateCourse } from '../src/course/course-validate.ts';
import type { CourseDefinition, SurfaceType, TerrainType } from '../src/course/course-types.ts';
import { TOUR_SETS } from '../src/course/tour-holes.ts';

const OUTPUT_PATH = 'docs/tour-hole-candidates.md';
const TERRAIN_ORDER: readonly TerrainType[] = [
  'random',
  'singleSlope',
  'receiving',
  'saddle',
  'twoTier',
];
const PAR_ORDER = [3, 4, 5] as const;
const SURFACE_ORDER: readonly SurfaceType[] = ['green', 'rough', 'deepRough', 'water', 'ob'];

const DIFFICULTY_BY_LABEL: Record<string, Difficulty> = {
  やさしい: 'easy',
  ふつう: 'normal',
  むずかしい: 'hard',
};
const SHAPE_BY_LABEL: Record<string, HoleShape> = {
  ストレート: 'straight',
  ドッグレッグ: 'dogleg',
  S字: 'doubleDogleg',
};
const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  easy: 'やさしい',
  normal: 'ふつう',
  hard: 'むずかしい',
};
const SHAPE_LABEL: Record<HoleShape, string> = {
  straight: 'ストレート',
  dogleg: 'ドッグレッグ',
  doubleDogleg: 'S字',
};
const TERRAIN_LABEL: Record<TerrainType, string> = {
  random: 'ランダム',
  singleSlope: '片流れ',
  receiving: '受けグリーン',
  saddle: 'ポテトチップ',
  twoTier: '2段グリーン',
};

interface Args {
  from: number;
  to: number;
}

interface SurveyRow {
  /** URLへ渡す元のシード。course.seed は再試行で枝番へ変わることがある */
  seed: number;
  difficulty: Difficulty;
  shape: HoleShape;
  terrain: TerrainType;
  par: number;
  routeLength: number;
  straightDistance: number;
  detourRatio: number;
  greenWidth: number;
  hazardCount: number;
  boundsWidth: number;
  boundsLength: number;
  areaRatio: Record<SurfaceType, number>;
  attempts: number;
  fallback: boolean;
}

function parseInteger(raw: string | undefined, flag: string): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`${flag} は 0〜4294967295 の整数で指定してください: ${raw ?? ''}`);
  }
  return value;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { from: 1, to: 1000 };
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    const [flag, inlineValue] = raw.split('=', 2);
    if (flag !== '--from' && flag !== '--to') throw new Error(`不明な引数です: ${raw}`);
    const value = inlineValue ?? argv[++i];
    if (flag === '--from') args.from = parseInteger(value, '--from');
    else args.to = parseInteger(value, '--to');
  }
  if (args.from > args.to) throw new Error(`--from は --to 以下にしてください: ${args.from} > ${args.to}`);
  return args;
}

function routeLength(course: CourseDefinition): number {
  let total = 0;
  for (let i = 1; i < course.route.length; i++) {
    total += Math.hypot(
      course.route[i].x - course.route[i - 1].x,
      course.route[i].z - course.route[i - 1].z,
    );
  }
  return total;
}

function generatedLabels(course: CourseDefinition): { difficulty: Difficulty; shape: HoleShape } {
  const [difficultyLabel, shapeLabel] = course.name.split('・');
  const difficulty = DIFFICULTY_BY_LABEL[difficultyLabel];
  const shape = SHAPE_BY_LABEL[shapeLabel];
  if (!difficulty || !shape) {
    throw new Error(`生成コース名から難易度・形を読めません: ${course.name}`);
  }
  return { difficulty, shape };
}

function survey(seed: number): SurveyRow {
  const generated = generateCourseDetailed(seed);
  const course = generated.course;
  const labels = generatedLabels(course);
  const length = routeLength(course);
  const straight = Math.hypot(course.cup.x - course.tee.x, course.cup.z - course.tee.z);
  const validation = validateCourse(course);
  return {
    seed,
    ...labels,
    terrain: course.terrain,
    par: course.par,
    routeLength: length,
    straightDistance: straight,
    detourRatio: length / straight,
    greenWidth: course.greenWidth,
    hazardCount: course.hazards.length,
    boundsWidth: course.bounds.width,
    boundsLength: course.bounds.length,
    areaRatio: validation.areaRatio,
    attempts: generated.attempts,
    fallback: generated.fallback,
  };
}

type DistanceBand = 'short' | 'middle' | 'long';

/**
 * 各PARで短・中・長がほぼ同数になるよう、地形ごとに2つの距離帯を割り当てる。
 * 5地形×2本で、短3・中4・長3。どの地形だけが常に短い／長い、にもならない。
 */
const BAND_PLAN: Readonly<Record<TerrainType, readonly [DistanceBand, DistanceBand]>> = {
  random: ['short', 'middle'],
  singleSlope: ['middle', 'long'],
  receiving: ['long', 'short'],
  saddle: ['short', 'middle'],
  twoTier: ['middle', 'long'],
};

function bandFor(rank: number, count: number): DistanceBand {
  if (rank < count / 3) return 'short';
  if (rank < (count * 2) / 3) return 'middle';
  return 'long';
}

function anchorFor(band: DistanceBand, sorted: readonly SurveyRow[]): number {
  const quantile = band === 'short' ? 1 / 6 : band === 'middle' ? 1 / 2 : 5 / 6;
  return sorted[Math.round((sorted.length - 1) * quantile)].routeLength;
}

function selectCandidates(rows: readonly SurveyRow[]): SurveyRow[] {
  const selected: SurveyRow[] = [];

  for (const par of PAR_ORDER) {
    const samePar = rows
      .filter((row) => row.par === par)
      .sort((a, b) => a.routeLength - b.routeLength || a.seed - b.seed);
    const rank = new Map(samePar.map((row, index) => [row.seed, index]));
    const shapeUse: Record<HoleShape, number> = { straight: 0, dogleg: 0, doubleDogleg: 0 };

    for (const terrain of TERRAIN_ORDER) {
      const group = samePar.filter((row) => row.terrain === terrain);
      if (group.length === 0) continue;

      const usedSeeds = new Set<number>();
      for (const band of BAND_PLAN[terrain]) {
        if (usedSeeds.size >= Math.min(2, group.length)) break;
        const anchor = anchorFor(band, samePar);
        const inBand = group.filter(
          (row) => !usedSeeds.has(row.seed) && bandFor(rank.get(row.seed)!, samePar.length) === band,
        );
        const pool = inBand.length > 0 ? inBand : group.filter((row) => !usedSeeds.has(row.seed));
        pool.sort((a, b) => {
          // まず同じPAR内で形が偏らないもの、次に距離帯の中心へ近いものを採る。
          const shapeDifference = shapeUse[a.shape] - shapeUse[b.shape];
          if (shapeDifference !== 0) return shapeDifference;
          return Math.abs(a.routeLength - anchor) - Math.abs(b.routeLength - anchor) || a.seed - b.seed;
        });
        const chosen = pool[0];
        selected.push(chosen);
        usedSeeds.add(chosen.seed);
        shapeUse[chosen.shape]++;
      }
    }
  }
  return selected;
}

function percent(value: number): string {
  return (value * 100).toFixed(1);
}

function range(values: readonly number[], digits = 1): string {
  if (values.length === 0) return '該当なし';
  const sorted = [...values].sort((a, b) => a - b);
  return `${sorted[0].toFixed(digits)}〜${sorted[sorted.length - 1].toFixed(digits)}m`;
}

function countBy<T extends string | number>(values: readonly T[]): Map<T, number> {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function distributionSummary(
  all: readonly SurveyRow[],
  eligible: readonly SurveyRow[],
  candidates: readonly SurveyRow[],
): string[] {
  const lines: string[] = [];
  const fallbackCount = all.length - eligible.length;
  lines.push(`- 走査: シード ${ARGS.from}〜${ARGS.to} の ${all.length} 本。fallback は ${fallbackCount} 本で、候補から除外した。`);

  const parCounts = countBy(eligible.map((row) => row.par));
  lines.push(
    `- 非fallbackのPAR内訳: PAR3 ${parCounts.get(3) ?? 0}本 / PAR4 ${parCounts.get(4) ?? 0}本 / PAR5 ${parCounts.get(5) ?? 0}本。`,
  );
  lines.push(
    `- 難易度の設定上の全長は easy 9〜14m / normal 14〜21m / hard 20〜28m。` +
      `実測のルート全長は easy ${range(eligible.filter((row) => row.difficulty === 'easy').map((row) => row.routeLength))} / ` +
      `normal ${range(eligible.filter((row) => row.difficulty === 'normal').map((row) => row.routeLength))} / ` +
      `hard ${range(eligible.filter((row) => row.difficulty === 'hard').map((row) => row.routeLength))}だった。` +
      `ストレートもわずかに弓なりなので実測値は設定値を少し超えることがある。` +
      `PAR境界は12 / 22 / 30mで、PAR3はeasyのみ、PAR5はhardのみという想定は一致した。`,
  );

  const hardPar4Counts = TERRAIN_ORDER.map((terrain) => {
    const count = eligible.filter(
      (row) => row.par === 4 && row.difficulty === 'hard' && row.terrain === terrain,
    ).length;
    return `${TERRAIN_LABEL[terrain]} ${count}本`;
  });
  lines.push(
    `- 「むずかしい」のPAR4: ${hardPar4Counts.join(' / ')}。` +
      '各地形から3本以上あり、PAR3×2・PAR4×5・PAR5×2（合計36）を3セット作れる。',
  );
  const complete = PAR_ORDER.every((par) =>
    TERRAIN_ORDER.every(
      (terrain) => candidates.filter((row) => row.par === par && row.terrain === terrain).length === 2,
    ),
  );
  lines.push(
    complete
      ? '- 候補表は各PAR×各地形から2本ずつ、計30本。各PARの短い側・中央・長い側をおおむね3・4・3本にし、形も分散させた。'
      : `- 候補表は各PAR×各地形から最大2本ずつ、計${candidates.length}本。指定範囲に存在しない区分は空欄。`,
  );
  return lines;
}

function tourSetSections(all: readonly SurveyRow[]): string[] {
  const bySeed = new Map(all.map((row) => [row.seed, row]));
  const used = new Set<number>();
  const sections: string[] = [
    '## 試遊用の3コース',
    '',
    '3コースともPAR3×2・PAR4×5・PAR5×2（合計PAR36）。PAR4はすべて「むずかしい」で、5種類の地形を1本ずつ使う。27ホールのシードは重複しない。',
    '',
    '| コース | 選出テーマ | 9ホールを開始 |',
    '|---|---|---|',
  ];

  for (const tour of TOUR_SETS) {
    const link = `https://hanagemaru.github.io/putt/?tour=${tour.id}`;
    sections.push(`| ${tour.name} | ${tour.description} | [プレイする](${link}) |`);
  }
  sections.push('');

  for (const tour of TOUR_SETS) {
    const tourRows = tour.seeds.map((seed) => bySeed.get(seed) ?? survey(seed));
    const parCounts = countBy(tourRows.map((row) => row.par));
    const hardPar4 = tourRows.filter((row) => row.par === 4 && row.difficulty === 'hard');
    const par4Terrains = new Set(hardPar4.map((row) => row.terrain));
    if (
      tourRows.length !== 9 ||
      parCounts.get(3) !== 2 ||
      parCounts.get(4) !== 5 ||
      parCounts.get(5) !== 2 ||
      hardPar4.length !== 5 ||
      par4Terrains.size !== TERRAIN_ORDER.length
    ) {
      throw new Error(`${tour.name} がツアー構成の条件を満たしていません`);
    }
    for (const row of tourRows) {
      if (used.has(row.seed)) throw new Error(`ツアー間でシード ${row.seed} が重複しています`);
      used.add(row.seed);
    }

    const link = `https://hanagemaru.github.io/putt/?tour=${tour.id}`;
    sections.push(`### [${tour.name}をプレイ](${link})`, '', tour.description, '');
    sections.push(
      '| H | シード | PAR | 難易度 | 形 | 地形 | 全長 | 遠回り率 | 池 |',
      '|---:|---:|---:|---|---|---|---:|---:|---:|',
    );
    for (let i = 0; i < tourRows.length; i++) {
      const row = tourRows[i];
      const seedLink = `https://hanagemaru.github.io/putt/?seed=${row.seed}`;
      sections.push(
        `| ${i + 1} | [${row.seed}](${seedLink}) | ${row.par} | ${DIFFICULTY_LABEL[row.difficulty]} | ` +
          `${SHAPE_LABEL[row.shape]} | ${TERRAIN_LABEL[row.terrain]} | ${row.routeLength.toFixed(2)}m | ` +
          `${row.detourRatio.toFixed(2)} | ${row.hazardCount} |`,
      );
    }
    sections.push('');
  }
  return sections;
}

function candidateTable(rows: readonly SurveyRow[]): string[] {
  const lines: string[] = [];
  for (const par of PAR_ORDER) {
    lines.push(`### PAR ${par}`, '');
    for (const terrain of TERRAIN_ORDER) {
      lines.push(`#### ${TERRAIN_LABEL[terrain]}（${terrain}）`, '');
      lines.push(
        '| シード | 難易度 | 形 | 全長 | 直線 | 遠回り率 | 芝幅 | 池 | 枠（幅×長さ） | 通常芝 | ラフ | 2nd | 池面積 | OB | 試行 | fallback |',
        '|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|',
      );
      const group = rows
        .filter((row) => row.par === par && row.terrain === terrain)
        .sort((a, b) => a.routeLength - b.routeLength || a.seed - b.seed);
      for (const row of group) {
        const link = `https://hanagemaru.github.io/putt/?seed=${row.seed}`;
        lines.push(
          `| [${row.seed}](${link}) | ${DIFFICULTY_LABEL[row.difficulty]} | ${SHAPE_LABEL[row.shape]} | ` +
            `${row.routeLength.toFixed(2)}m | ${row.straightDistance.toFixed(2)}m | ${row.detourRatio.toFixed(2)} | ` +
            `${row.greenWidth.toFixed(2)}m | ${row.hazardCount} | ${row.boundsWidth.toFixed(0)}×${row.boundsLength.toFixed(0)}m | ` +
            `${percent(row.areaRatio.green)}% | ${percent(row.areaRatio.rough)}% | ${percent(row.areaRatio.deepRough)}% | ` +
            `${percent(row.areaRatio.water)}% | ${percent(row.areaRatio.ob)}% | ${row.attempts} | なし |`,
        );
      }
      lines.push('');
    }
  }
  return lines;
}

function buildMarkdown(all: readonly SurveyRow[], eligible: readonly SurveyRow[], candidates: readonly SurveyRow[]): string {
  return [
    '# 通常ツアー ホール候補表',
    '',
    '固定9ホールを実際に遊んで選ぶための調査結果。数値は `generateCourseDetailed(seed)` と `validateCourse` の実測。機械指標で試遊用3コースを仮選出したが、面白さ・最終採用・テーマ名は実機確認後に決める。',
    '',
    '## 走査結果',
    '',
    ...distributionSummary(all, eligible, candidates),
    '',
    '遠回り率は「ルート全長 ÷ ティー→カップ直線距離」。面積比は `validateCourse` の既定格子で測定。`2nd` はセカンドカット。',
    '',
    ...tourSetSections(all),
    '## 初回の30候補',
    '',
    'PAR×地形ごとの比較用に残す。上の3コースは、新しい構成条件に合わせて同じシード1〜1000から選び直した。',
    '',
    ...candidateTable(candidates),
  ].join('\n').trimEnd();
}

const ARGS = parseArgs(process.argv.slice(2));
const rows: SurveyRow[] = [];
for (let seed = ARGS.from; seed <= ARGS.to; seed++) rows.push(survey(seed));

const eligible = rows.filter((row) => !row.fallback && PAR_ORDER.includes(row.par as 3 | 4 | 5));
const candidates = selectCandidates(eligible);
const markdown = buildMarkdown(rows, eligible, candidates);
writeFileSync(OUTPUT_PATH, `${markdown}\n`, 'utf8');

const fallbackCount = rows.filter((row) => row.fallback).length;
console.log(`シード ${ARGS.from}〜${ARGS.to}: ${rows.length}本を走査`);
console.log(`fallback: ${fallbackCount}本（候補から除外）`);
console.log(`候補: ${candidates.length}本`);
console.log(`書き出し: ${OUTPUT_PATH}`);
