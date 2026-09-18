// 通常ツアー全コースのホールを真上から並べた一覧を作る。
//
// **シードを選び直すたびに、9ホールが似ていないかを目で確かめるための道具。**
// 数字（全長・芝幅・遠回り率）だけでは「同じような形が続いている」が分からない。
//
// 出力は1枚の自己完結したHTML（画像はPNGをbase64で埋め込む）。
// ブラウザでもスマホでもそのまま開ける。
//
// 描き方はゲーム本体のマップと同じ考え方にしてある。
//   - 色は `CONFIG.green.surfaceColors`
//   - 芝と砂は高さで濃淡を掛ける（明るい＝高い）。池とOBは掛けない（`flatSurfaces`）
//   - 濃淡の式は `GreenMesh` と同じ（`softRamp` ＋ `heightStrength`）
//
// 実行: npm run maps  （出力先は引数で変えられる。既定は docs/course-maps.html）

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { CONFIG } from '../src/config.ts';
import { Green, defaultGreenParams } from '../src/green.ts';
import { generateCourseV2Detailed, routeMetrics } from '../src/course/course-generate-v2.ts';
import { generateCourseDetailed } from '../src/course/course-generate.ts';
import {
  bunkerBasinAt,
  plateauHeightAt,
  surfaceAt,
  teeStraightDistance,
} from '../src/course/course-map.ts';
import { validateCourse } from '../src/course/course-validate.ts';
import {
  TOUR_SETS,
  generateOptionsFor,
  setupOf,
  setupOfHole,
} from '../src/course/tour-holes.ts';
import type { TourDefinition } from '../src/course/tour-holes.ts';
import type { CourseDefinition, SurfaceType, TerrainType } from '../src/course/course-types.ts';

const G = CONFIG.green;
const SHADE = G.shade;

/**
 * 1メートルあたりのピクセル数。**全ホールで同じ**なので、
 * 画像の大きさの違いがそのままコースの広さの違いになる。
 * いちばん大きい枠が 22.5m × 44m なので、11px/m で 248 × 484px。
 * CSS 側も等倍で置く（`width: 100%` にすると縮尺が揃わなくなる）
 */
const PIXELS_PER_METER = 11;

/** ティーとカップの印の半径 [px] */
const MARKER_RADIUS = 4;

const OUT_PATH = process.argv[2] ?? 'docs/course-maps.html';

// --- PNG ------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(data.length + 8, crc32(out.subarray(4, data.length + 8)));
  return out;
}

/** RGB のバイト列（幅×高さ×3）を PNG にする */
function encodePng(rgb: Uint8Array, width: number, height: number): Uint8Array {
  // 各行の先頭にフィルタ種別（0＝なし）を付ける
  const raw = new Uint8Array(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // ビット深度
  ihdr[9] = 2; // カラータイプ（トゥルーカラー）
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(raw, { level: 9 }))),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// --- 描画 ------------------------------------------------------------------

/** `GreenMesh` と同じ濃淡。中央付近は直線、端だけ飽和させる */
function softRamp(value: number, fullRange: number): number {
  const half = fullRange / 2;
  if (half <= 0) return 0.5;
  const s = value / half;
  return 0.5 + (0.5 * s) / Math.sqrt(1 + s * s);
}

const FLAT = new Set<SurfaceType>(G.flatSurfaces as readonly SurfaceType[]);

function approachDirectionOf(course: CourseDefinition) {
  const n = course.route.length;
  const a = course.route[n - 2] ?? course.tee;
  const b = course.route[n - 1];
  const d = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return { x: (b.x - a.x) / d, z: (b.z - a.z) / d };
}

function renderHole(course: CourseDefinition, undulationGain: number): { png: Uint8Array; w: number; h: number } {
  const green = new Green(
    {
      ...defaultGreenParams(),
      seed: course.seed,
      width: course.bounds.width,
      length: course.bounds.length,
      undulationAmplitude: G.compareEnhancedAmplitude * undulationGain,
      terrain: { type: course.terrain, cup: course.cup, approach: approachDirectionOf(course) },
      heightFeatures: course.heightFeatures,
      bunkerBasin: (x: number, z: number) => bunkerBasinAt(course, x, z),
      plateau: (x: number, z: number) => plateauHeightAt(course, x, z),
    },
    (x, z) => surfaceAt(course, x, z),
  );

  const w = Math.round(course.bounds.width * PIXELS_PER_METER);
  const h = Math.round(course.bounds.length * PIXELS_PER_METER);
  const rgb = new Uint8Array(w * h * 3);
  const halfW = course.bounds.width / 2;
  const halfL = course.bounds.length / 2;

  for (let py = 0; py < h; py++) {
    // 画面の上を +Z（奥）にする。ゲームのマップと同じ向き
    const z = halfL - ((py + 0.5) / h) * course.bounds.length;
    for (let px = 0; px < w; px++) {
      const x = -halfW + ((px + 0.5) / w) * course.bounds.width;
      const surface = surfaceAt(course, x, z);
      const base = G.surfaceColors[surface];
      let k = 1;
      if (!FLAT.has(surface)) {
        const height = softRamp(green.sampleHeight(x, z), SHADE.heightRange);
        k = 1 + SHADE.heightStrength * (2 * height - 1);
      }
      const at = (py * w + px) * 3;
      rgb[at] = Math.min(255, Math.max(0, Math.round(((base >> 16) & 0xff) * k)));
      rgb[at + 1] = Math.min(255, Math.max(0, Math.round(((base >> 8) & 0xff) * k)));
      rgb[at + 2] = Math.min(255, Math.max(0, Math.round((base & 0xff) * k)));
    }
  }

  // ティー（白）とカップ（旗の色）の印
  const mark = (cx: number, cz: number, color: number) => {
    const px0 = Math.round(((cx + halfW) / course.bounds.width) * w);
    const py0 = Math.round(((halfL - cz) / course.bounds.length) * h);
    for (let dy = -MARKER_RADIUS; dy <= MARKER_RADIUS; dy++) {
      for (let dx = -MARKER_RADIUS; dx <= MARKER_RADIUS; dx++) {
        if (dx * dx + dy * dy > MARKER_RADIUS * MARKER_RADIUS) continue;
        const px = px0 + dx;
        const py = py0 + dy;
        if (px < 0 || px >= w || py < 0 || py >= h) continue;
        const at = (py * w + px) * 3;
        rgb[at] = (color >> 16) & 0xff;
        rgb[at + 1] = (color >> 8) & 0xff;
        rgb[at + 2] = color & 0xff;
      }
    }
  };
  mark(course.tee.x, course.tee.z, 0xffffff);
  mark(course.cup.x, course.cup.z, CONFIG.hole.flagColor);

  return { png: encodePng(rgb, w, h), w, h };
}

// --- 集計 ------------------------------------------------------------------

const TERRAIN_LABEL: Record<TerrainType, string> = {
  random: 'ランダム',
  singleSlope: '片流れ',
  receiving: '受け',
  saddle: 'ポテチ',
  twoTier: '2段',
};

interface HoleCard {
  hole: number;
  seed: number;
  par: number;
  shape: string;
  terrain: string;
  length: number;
  turn: number;
  detour: number;
  width: number;
  water: number;
  bareShore: boolean;
  bunkers: number;
  bunkerRatio: number;
  /** ティーから真っ直ぐ転がせる距離 [m] */
  teeRun: number;
  /** 同じものをホール長で割った割合。**1/3 を下回ると1打目が打てない** */
  teeRunRatio: number;
  /** 砲台グリーンの高さ [m]。無ければ 0 */
  plateauRise: number;
  /** そのホールで試している仕掛け（LAB だけ）。無ければ空 */
  label: string;
  png: string;
  w: number;
  h: number;
}

/**
 * **いま本番（main）に載っている v1 の3コース。** 見比べるためだけに置いてある写し。
 *
 * `git show main:src/course/tour-holes.ts` の `seeds` をそのまま持ってきた値で、
 * ブランチ側の `TOUR_SETS`（v2の4コース）とは別物。
 * 仕立ては持たない＝`DEFAULT_SETUP`（うねり等倍・10ft・新しいつまみは全部オフ）。
 *
 * **風の丘は選び直す前の並び。** シードの差し替えと並べ替えは実機確認まで済んでいるが、
 * main へは入っていない（`PROJECT_STATUS.md` の「本番は未反映」）。
 *
 * 本番から v1 のコースが消えたら、この定数ごと消してよい。
 */
const LIVE_V1_TOURS: readonly TourDefinition[] = [
  {
    id: 'breeze',
    name: { ja: '風の丘', en: 'Windy Hills' },
    description: { ja: '池と大きな曲がりが少ない、比較的素直なコース', en: '' },
    seeds: [553, 848, 44, 468, 798, 354, 977, 232, 185],
  },
  {
    id: 'forest',
    name: { ja: '曲がりの森', en: 'Bending Woods' },
    description: { ja: 'ドッグレッグとS字、遠回り率の大きいホールを集めたコース', en: '' },
    seeds: [307, 299, 343, 101, 407, 549, 245, 649, 583],
  },
  {
    id: 'waterside',
    name: { ja: '水鏡の庭', en: 'Mirror Garden' },
    description: { ja: '池の数と水面積比が大きいホールを集めたコース', en: '' },
    seeds: [394, 121, 410, 235, 731, 954, 411, 421, 933],
  },
];

function cardsFor(tour: TourDefinition): HoleCard[] {
  return tour.seeds.map((seed, i) => {
    // **仕立てはホールごとに違うことがある**（LAB はホール単位で仕掛けを入れ替える）
    const setup = setupOfHole(tour, i);
    const generated =
      (tour.generator ?? 'v1') === 'v2'
        ? generateCourseV2Detailed(seed, generateOptionsFor(setup))
        : generateCourseDetailed(seed);
    const course = generated.course;
    const shape = 'plan' in generated ? generated.plan.shape : course.name;
    const metrics = routeMetrics(course.route);
    const image = renderHole(course, setup.undulationGain);
    const teeRun = teeStraightDistance(course);
    return {
      hole: i + 1,
      seed,
      par: course.par,
      shape,
      terrain: TERRAIN_LABEL[course.terrain],
      length: metrics.length,
      turn: metrics.totalTurnDeg,
      detour: metrics.detourRatio,
      width: course.greenWidth,
      water: course.hazards.length,
      bareShore: course.waterFringe === 0,
      bunkers: (course.bunkers ?? []).length,
      bunkerRatio: validateCourse(course, { cellSize: 0.2 }).areaRatio.bunker * 100,
      teeRun,
      // ホール長で切る（真っ直ぐ抜ける道ならホール長を超えて測れてしまう）
      teeRunRatio: metrics.length > 0 ? Math.min(teeRun, metrics.length) / metrics.length : 0,
      plateauRise: course.plateau?.rise ?? 0,
      label: tour.holes?.[i]?.label ?? '',
      png: Buffer.from(image.png).toString('base64'),
      w: image.w,
      h: image.h,
    };
  });
}

// --- HTML ------------------------------------------------------------------

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

function sectionFor(tour: TourDefinition): string {
  const setup = setupOf(tour);
  const cards = cardsFor(tour);
  const total = cards.reduce((n, c) => n + c.length, 0);
  const holes = cards
    .map((c) => {
      const tags = [
        c.label ? `<span class="tag feat">${escapeHtml(c.label)}</span>` : '',
        c.detour >= 1.15 ? '<span class="tag turn">回り込む</span>' : '',
        c.bareShore && c.water > 0 ? '<span class="tag bare">岸なし池</span>' : '',
        // ティーショットがホール長の1/3も転がせないホールは、1打目が意味を失う
        c.teeRunRatio < 1 / 3 ? '<span class="tag short">1打目が短い</span>' : '',
      ].join('');
      const plateau = c.plateauRise > 0 ? ` ・ 砲台 ${(c.plateauRise * 100).toFixed(0)}cm` : '';
      return `      <figure>
        <img src="data:image/png;base64,${c.png}" width="${c.w}" height="${c.h}" alt="ホール${c.hole}を真上から">
        <figcaption>
          <span class="hole-no">H${c.hole}</span> <span class="par">PAR ${c.par}</span> ${c.length.toFixed(1)}m${tags}
          <span class="facts">seed ${c.seed} ・ ${escapeHtml(c.shape)} ・ ${escapeHtml(c.terrain)}<br>
          芝幅 ${c.width.toFixed(1)}m ・ 曲がり ${c.turn.toFixed(0)}° ・ 遠回り ${c.detour.toFixed(2)}<br>
          1打目 ${c.teeRun.toFixed(1)}m（${(c.teeRunRatio * 100).toFixed(0)}%）${plateau}<br>
          池 ${c.water} ・ 砂 ${c.bunkers}（${c.bunkerRatio.toFixed(1)}%）</span>
        </figcaption>
      </figure>`;
    })
    .join('\n');
  const avg = (pick: (c: HoleCard) => number) => cards.reduce((n, c) => n + pick(c), 0) / cards.length;
  const generator = tour.generator ?? 'v1';
  const setupLine =
    generator !== 'v2'
      ? `仕立て: 生成器v1（バンカーも高さのハザードも無い）・うねり×${setup.undulationGain} ・ ${setup.stimpFeet}ft`
      : tour.holes
        ? // ホールごとに仕掛けを入れ替えるコースは、コース単位の値を並べても意味がない
          `仕立て: ホールごとに違う（各ホールの札を見る）・うねり×${setup.undulationGain} ・ ${setup.stimpFeet}ft
        ・ ティー側の直線 ${(setup.teeStraightRun * 100).toFixed(0)}%`
        : `仕立て: うねり×${setup.undulationGain} ・ ${setup.stimpFeet}ft ・ 曲率半径×${setup.turnRadiusScale}
        ・ S字${setup.wideSCurve ? '大' : '標準'} ・ 岸なし池 ${setup.bareWaterChance} ・ 砂の幅${setup.variedBunkers ? '広' : '標準'}`;
  const title = generator === 'v2' ? tour.name.en : `${tour.name.ja}`;
  return `  <section>
    <div class="course-head">
      <h2>${escapeHtml(title)}<em>${escapeHtml(tour.description.ja)}</em></h2>
      <p class="summary">
        全長 ${total.toFixed(0)}m ・ 平均芝幅 ${avg((c) => c.width).toFixed(2)}m ・
        平均曲がり ${avg((c) => c.turn).toFixed(0)}° ・ 遠回り最大 ${Math.max(...cards.map((c) => c.detour)).toFixed(2)} ・
        池 ${cards.reduce((n, c) => n + c.water, 0)}個 ・ 砂 ${cards.reduce((n, c) => n + c.bunkers, 0)}個<br>
        1打目の最短 ${Math.min(...cards.map((c) => c.teeRunRatio * 100)).toFixed(0)}% ・
        平均 ${avg((c) => c.teeRunRatio * 100).toFixed(0)}%（ホール長に対して真っ直ぐ転がせる割合）<br>
        <span class="setup">${setupLine}</span>
      </p>
    </div>
    <div class="holes">
${holes}
    </div>
  </section>`;
}

const newSections = TOUR_SETS.map(sectionFor).join('\n');
const liveSections = LIVE_V1_TOURS.map(sectionFor).join('\n');

const html = `<title>Putt ツアーマップ</title>
<style>
  /*
   * 色はゲーム本体のパレットをそのまま使う（CONFIG.green.surfaceColors と
   * メニューの枠の色）。片テーマに寄せた作りで、地の色も文字色も明示する。
   * 暗い地形の画像を並べる紙なので、明るい地に置くと画像だけが沈む
   */
  :root {
    --ground: #10180f;
    --panel: #1b2c1d;
    --edge: #2f4a30;
    --ink: #dfe9dc;
    --ink-dim: #93a890;
    --ink-quiet: #6f8a6e;
    --accent: #9ede8a;
    --turn: #ffd9a8;
    --turn-bg: #6b4118;
    --bare: #a8d6ff;
    --bare-bg: #18456b;
    --feat: #e8ffb0;
    --feat-bg: #3d5210;
    --short: #ffb0b0;
    --short-bg: #6b1818;
    /* ゲーム本体と同じドット絵フォント。無ければ等幅へ落とす */
    --pixel: "DotGothic16", "Hiragino Sans", system-ui, sans-serif;
    --data: ui-monospace, "SFMono-Regular", Menlo, "Hiragino Sans", monospace;
  }
  body {
    margin: 0;
    padding-block: 28px 48px;
    padding-inline: 16px;
    background: var(--ground);
    color: var(--ink);
    font-family: var(--data);
    font-variant-numeric: tabular-nums;
  }
  .wrap { max-width: 1160px; margin-inline: auto; }
  h1 {
    font-family: var(--pixel);
    font-size: 26px;
    letter-spacing: 0.08em;
    margin: 0 0 10px;
    color: var(--accent);
    text-shadow: 3px 3px 0 #0a100a;
    text-wrap: balance;
  }
  .lead { color: var(--ink-dim); font-size: 13px; margin: 0 0 18px; line-height: 1.8; max-width: 62ch; }
  .lead b { color: var(--ink); font-weight: 600; }
  /* グループの見出し。v2の新しい4コースと、本番のv1の3コースを分ける */
  h2.group {
    font-family: var(--pixel);
    font-size: 15px;
    letter-spacing: 0.14em;
    color: var(--ground);
    background: var(--accent);
    display: inline-block;
    padding: 4px 12px;
    margin: 8px 0 6px;
  }
  h2.group.live { background: var(--bare); }
  .group-note { font-size: 12px; color: var(--ink-dim); margin: 0 0 22px; line-height: 1.8; max-width: 62ch; }
  .group-note code { font-family: var(--data); color: var(--ink); }
  .group-note b { color: var(--ink); }
  .legend {
    display: flex; flex-wrap: wrap; gap: 6px 16px;
    font-size: 12px; color: var(--ink-dim); margin: 0 0 32px;
  }
  .legend span { white-space: nowrap; }
  .swatch {
    display: inline-block; width: 11px; height: 11px;
    vertical-align: -1px; margin-right: 5px; border: 1px solid #0a100a;
  }
  section { margin-bottom: 44px; }
  /* コース名は帯にする。一覧を縦にたどるとき、どこからが次のコースかが要る */
  .course-head {
    border-top: 3px solid var(--accent);
    padding-top: 10px;
    margin-bottom: 14px;
  }
  h2 {
    font-family: var(--pixel);
    font-size: 20px;
    letter-spacing: 0.1em;
    margin: 0 0 4px;
    color: var(--accent);
  }
  h2 em { font-style: normal; color: var(--ink-dim); font-size: 13px; letter-spacing: 0; margin-left: 10px; }
  .summary { font-size: 12px; color: var(--ink-dim); margin: 0; line-height: 1.9; }
  .summary .setup { color: var(--ink-quiet); }
  /* 画像は等倍で置く。いちばん大きい枠が248pxなので、列幅はそれに余白を足した固定値 */
  .holes {
    display: grid;
    grid-template-columns: repeat(auto-fill, 264px);
    justify-content: start;
    gap: 16px;
    align-items: start;
    margin-top: 14px;
  }
  figure {
    margin: 0;
    background: var(--panel);
    border: 2px solid var(--edge);
    padding: 8px 8px 10px;
  }
  img {
    display: block;
    margin: 0 auto 8px;
    max-width: 100%;
    height: auto;
    image-rendering: pixelated;
    background: #0a100a;
  }
  figcaption { font-size: 12px; line-height: 1.6; }
  .hole-no { font-family: var(--pixel); font-size: 14px; letter-spacing: 0.06em; color: var(--ink); }
  .par { color: var(--accent); }
  .facts { display: block; color: var(--ink-quiet); font-size: 11px; margin-top: 5px; line-height: 1.7; }
  .tag {
    display: inline-block; font-size: 10px; padding: 1px 6px; margin-left: 5px;
    vertical-align: 1px; letter-spacing: 0.04em;
  }
  .tag.turn { background: var(--turn-bg); color: var(--turn); }
  .tag.bare { background: var(--bare-bg); color: var(--bare); }
  .tag.feat { background: var(--feat-bg); color: var(--feat); }
  .tag.short { background: var(--short-bg); color: var(--short); }
  @media (max-width: 300px) { .holes { grid-template-columns: 1fr; } }
</style>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DotGothic16&display=swap">
<div class="wrap">
<h1>Putt ツアーマップ</h1>
<p class="lead">
  ブランチの新しい${TOUR_SETS.length}コースと、いま本番で遊べる${LIVE_V1_TOURS.length}コース。
  合わせて${[...TOUR_SETS, ...LIVE_V1_TOURS].reduce((n, t) => n + t.seeds.length, 0)}ホールを真上から。<br>
  <b>すべて縮尺が同じ</b>なので、画像の大きさの違いがそのままコースの広さの違いになる。
  明るいほど高く、暗いほど低い（ゲーム本体のマップと同じ濃淡）。
  <b>白い丸がティー、赤い丸がカップ。</b>
</p>
<p class="legend">
  <span><i class="swatch" style="background:#${G.surfaceColors.green.toString(16).padStart(6, '0')}"></i>通常芝</span>
  <span><i class="swatch" style="background:#${G.surfaceColors.rough.toString(16).padStart(6, '0')}"></i>ラフ</span>
  <span><i class="swatch" style="background:#${G.surfaceColors.deepRough.toString(16).padStart(6, '0')}"></i>セカンドカット</span>
  <span><i class="swatch" style="background:#${G.surfaceColors.bunker.toString(16).padStart(6, '0')}"></i>砂</span>
  <span><i class="swatch" style="background:#${G.surfaceColors.water.toString(16).padStart(6, '0')}"></i>池</span>
  <span><i class="swatch" style="background:#${G.surfaceColors.ob.toString(16).padStart(6, '0')}"></i>OB</span>
</p>
<h2 class="group">ブランチ / 生成器v2の4コース</h2>
<p class="group-note"><code>claude/remaining-tasks-9foyzw</code> にある新しいツアー。本番はまだこれではない。</p>
${newSections}

<h2 class="group live">本番 / 生成器v1の3コース</h2>
<p class="group-note">
  いま <b>putt.hanage.app</b> で遊べるツアー（<code>main</code> の <code>TOUR_SETS</code>）。
  v1にはバンカーも高さのハザードも無い。<br>
  <b>風の丘は選び直す前の並び</b>のまま（差し替えと並べ替えは実機確認済みだが main へ入っていない）。
</p>
${liveSections}
</div>
`;

writeFileSync(OUT_PATH, html);
console.log(
  `${OUT_PATH} を書き出した（新しい${TOUR_SETS.length}コース ＋ 本番の${LIVE_V1_TOURS.length}コース / ` +
    `${[...TOUR_SETS, ...LIVE_V1_TOURS].reduce((n, t) => n + t.seeds.length, 0)}ホール` +
      ` / ${(html.length / 1024).toFixed(0)}KB）`,
);
