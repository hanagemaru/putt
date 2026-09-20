// 見た目のテーマをその場で調整するパネル（`?tune=1`）。**LAB用で、通常のプレイには出ない。**
//
// 実機で「色が赤すぎる」「木が大きすぎる」のように出たとき、毎回コードを直して
// プレビューを上げ直すのは往復が長い。**実際のコースに立ったまま**色と木を動かして、
// 決まった値を書き出せるようにする。
//
// ここで触るのは見た目だけ。物理・生成器・シード・スコアには関わらない。
// lil-gui は動的に読み込むので、**パネルを出さないときはバンドルに載らない**。
import { CONFIG } from './config';
import { cloneTheme, themeById, THEME_CHOICES, type TunableTheme } from './theme';

/** パネルが値を変えたときに呼び戻す先。何を作り直せばよいかで分かれている */
export interface ThemeTunerHooks {
  /** 空の色だけ変わった */
  onSky(): void;
  /** 光の強さ・色だけ変わった */
  onLight(): void;
  /** 地面か木が変わった（作り直しが要る） */
  onTerrain(): void;
}

/** 塊で葉を作る樹種（広葉樹・低木）の形 */
interface ClumpedShape {
  trunkRatio: number;
  trunkRadius: number;
  clumpRadius: number;
  clumpSpread: number;
  flatten: number;
  clumps: { min: number; max: number };
  branches: { min: number; max: number };
}

interface ConiferShape {
  trunkRatio: number;
  baseRadius: number;
  radiusFalloff: number;
  tierOverlap: number;
  tiers: { min: number; max: number };
}

/**
 * 木の形（`CONFIG.trees`）は**テーマではなく全体の設定**なので、ここでだけ書き換える。
 * `?tune=1` のときしか読み込まれないモジュールなので、通常のプレイには影響しない
 */
interface TunableTrees {
  standSize: number;
  broadleaf: ClumpedShape;
  shrub: ClumpedShape;
  conifer: ConiferShape;
}

const TREES = CONFIG.trees as unknown as TunableTrees;

function hex(value: number): string {
  return `0x${value.toString(16).padStart(6, '0')}`;
}

/** 書き出し用。読み込んだときの値と見比べて、変えたところだけ出す */
function diffLines(before: Record<string, unknown>, after: Record<string, unknown>, path: string): string[] {
  const lines: string[] = [];
  for (const key of Object.keys(after)) {
    const a = before[key];
    const b = after[key];
    if (typeof b === 'object' && b !== null && typeof a === 'object' && a !== null) {
      lines.push(...diffLines(a as Record<string, unknown>, b as Record<string, unknown>, `${path}.${key}`));
    } else if (a !== b) {
      lines.push(`${path}.${key}: ${String(b)}`);
    }
  }
  return lines;
}

/** 決まった値を画面に出す。スマホでも選んでコピーできるように textarea で出す */
function showText(text: string): void {
  const back = document.createElement('div');
  back.style.cssText =
    'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.82);display:flex;' +
    'flex-direction:column;gap:8px;padding:12px;box-sizing:border-box';
  const area = document.createElement('textarea');
  area.readOnly = true;
  area.value = text;
  area.style.cssText =
    'flex:1;width:100%;box-sizing:border-box;font:12px/1.4 monospace;padding:8px;' +
    'background:#101810;color:#d8f0d8;border:1px solid #3a5a3a';
  const close = document.createElement('button');
  close.textContent = '閉じる';
  close.style.cssText = 'padding:10px;font-size:15px';
  close.addEventListener('click', () => back.remove());
  back.append(area, close);
  document.body.append(back);
  area.select();
  void navigator.clipboard?.writeText(text).catch(() => undefined);
}

/**
 * テーマ調整パネルを出す。`theme` を直接書き換えるので、呼ぶ側は
 * **同じオブジェクトを見ている**（作り直しのときに新しい値が使われる）
 */
export async function setupThemeTuner(theme: TunableTheme, hooks: ThemeTunerHooks): Promise<void> {
  const { default: GUI } = await import('lil-gui');
  const gui = new GUI({ title: 'putt / 見た目の調整', width: 260 });
  gui.domElement.style.zIndex = '9999';
  const treesAtStart = structuredClone(TREES) as unknown as Record<string, unknown>;

  const sky = gui.addFolder('空と光');
  sky.addColor(theme, 'sky').name('空の色').onChange(hooks.onSky);
  sky.add(theme.light, 'directionalIntensity', 0.5, 3, 0.05).name('平行光の強さ').onChange(hooks.onLight);
  sky.add(theme.light, 'ambientIntensity', 0, 1.5, 0.01).name('環境光の強さ').onChange(hooks.onLight);
  sky.addColor(theme.light, 'ambientColor').name('環境光の色').onChange(hooks.onLight);

  const ground = gui.addFolder('地面');
  const SURFACE_LABELS = {
    green: '芝',
    rough: 'ラフ',
    deepRough: 'セカンドカット',
    bunker: '砂',
    water: '池',
    ob: 'OB',
  } as const;
  for (const [key, label] of Object.entries(SURFACE_LABELS)) {
    ground.addColor(theme.surfaces, key as keyof typeof SURFACE_LABELS).name(label).onChange(hooks.onTerrain);
  }
  ground.addColor(theme, 'surround').name('外周の地面').onChange(hooks.onTerrain);

  const trees = gui.addFolder('木');
  trees.add(theme.trees, 'count', 0, 40, 1).name('本数').onChange(hooks.onTerrain);
  trees.add(theme.trees, 'heightMin', 1, 12, 0.1).name('高さ（最低）').onChange(hooks.onTerrain);
  trees.add(theme.trees, 'heightMax', 1, 12, 0.1).name('高さ（最高）').onChange(hooks.onTerrain);
  trees.addColor(theme.trees, 'trunkColor').name('幹の色').onChange(hooks.onTerrain);
  trees.addColor(theme.trees, 'leafColor').name('葉の色').onChange(hooks.onTerrain);
  trees.add(theme.trees.kinds, 'broadleaf', 0, 4, 1).name('広葉樹の比').onChange(hooks.onTerrain);
  trees.add(theme.trees.kinds, 'conifer', 0, 4, 1).name('針葉樹の比').onChange(hooks.onTerrain);
  trees.add(theme.trees.kinds, 'shrub', 0, 4, 1).name('低木の比').onChange(hooks.onTerrain);
  trees.add(TREES, 'standSize', 2, 60, 1).name('同じ樹種が続く広さ[m]').onChange(hooks.onTerrain);

  function clumpedFolder(title: string, shape: ClumpedShape): void {
    const f = gui.addFolder(title);
    f.add(shape, 'trunkRatio', 0.1, 0.8, 0.01).name('幹の高さ比').onChange(hooks.onTerrain);
    f.add(shape, 'trunkRadius', 0.02, 0.15, 0.005).name('幹の太さ比').onChange(hooks.onTerrain);
    f.add(shape, 'clumpRadius', 0.1, 0.5, 0.01).name('塊の半径比').onChange(hooks.onTerrain);
    f.add(shape, 'clumpSpread', 0, 1.5, 0.05).name('塊の広がり').onChange(hooks.onTerrain);
    f.add(shape, 'flatten', 0.3, 1.2, 0.02).name('塊の潰し').onChange(hooks.onTerrain);
    f.add(shape.clumps, 'min', 1, 8, 1).name('塊の数（最少）').onChange(hooks.onTerrain);
    f.add(shape.clumps, 'max', 1, 8, 1).name('塊の数（最多）').onChange(hooks.onTerrain);
    f.add(shape.branches, 'max', 0, 5, 1).name('枝の数（最多）').onChange(hooks.onTerrain);
    f.close();
  }
  clumpedFolder('形 / 広葉樹', TREES.broadleaf);
  clumpedFolder('形 / 低木', TREES.shrub);

  const conifer = gui.addFolder('形 / 針葉樹');
  conifer.add(TREES.conifer, 'trunkRatio', 0.1, 0.6, 0.01).name('幹の高さ比').onChange(hooks.onTerrain);
  conifer.add(TREES.conifer, 'baseRadius', 0.08, 0.45, 0.01).name('下段の半径比').onChange(hooks.onTerrain);
  conifer.add(TREES.conifer, 'radiusFalloff', 0.4, 0.95, 0.01).name('段ごとの細り').onChange(hooks.onTerrain);
  conifer.add(TREES.conifer, 'tierOverlap', 0, 0.8, 0.02).name('段の食い込み').onChange(hooks.onTerrain);
  conifer.add(TREES.conifer.tiers, 'min', 1, 6, 1).name('段数（最少）').onChange(hooks.onTerrain);
  conifer.add(TREES.conifer.tiers, 'max', 1, 6, 1).name('段数（最多）').onChange(hooks.onTerrain);
  conifer.close();

  const actions = {
    読み込み: 'default',
    決めた値を出す: () => {
      const treeDiff = diffLines(treesAtStart, TREES as unknown as Record<string, unknown>, 'CONFIG.trees');
      const body = [
        '// CONFIG.themes の1コース分',
        '{',
        `  sky: ${hex(theme.sky)},`,
        `  light: { directionalIntensity: ${theme.light.directionalIntensity}, ` +
          `ambientIntensity: ${theme.light.ambientIntensity}, ambientColor: ${hex(theme.light.ambientColor)} },`,
        '  surfaces: {',
        ...(Object.keys(theme.surfaces) as (keyof typeof theme.surfaces)[]).map(
          (k) => `    ${k}: ${hex(theme.surfaces[k])},`,
        ),
        '  },',
        `  surround: ${hex(theme.surround)},`,
        '  trees: {',
        `    count: ${theme.trees.count},`,
        `    heightMin: ${theme.trees.heightMin},`,
        `    heightMax: ${theme.trees.heightMax},`,
        `    trunkColor: ${hex(theme.trees.trunkColor)},`,
        `    leafColor: ${hex(theme.trees.leafColor)},`,
        `    kinds: { broadleaf: ${theme.trees.kinds.broadleaf}, ` +
          `conifer: ${theme.trees.kinds.conifer}, shrub: ${theme.trees.kinds.shrub} },`,
        '  },',
        '}',
        '',
        treeDiff.length > 0
          ? ['// 木の形（全テーマ共通）。変えたところだけ', ...treeDiff].join('\n')
          : '// 木の形（全テーマ共通）は変えていない',
      ].join('\n');
      showText(body);
    },
  };
  gui
    .add(actions, '読み込み', THEME_CHOICES)
    .name('テーマを読み込む')
    .onChange((id: string) => {
      Object.assign(theme, cloneTheme(themeById(id === 'default' ? null : id)));
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
      hooks.onSky();
      hooks.onLight();
      hooks.onTerrain();
    });
  gui.add(actions, '決めた値を出す');
  // **たたんだ状態で出す。** 縦画面ではパネルがコースを覆ってしまう
  gui.close();
}
