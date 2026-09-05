import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';

const entrySource = `import { CONFIG } from './config';
import { TOUR_SETS, type TourDefinition } from './course/tour-holes';
import { Round } from './round';
import { RoundProgressStore } from './round-storage';

const params = new URLSearchParams(window.location.search);

if (shouldStartGameDirectly(params)) {
  void import('./main');
} else {
  renderTopMenu();
}

function shouldStartGameDirectly(search: URLSearchParams): boolean {
  if (search.get('tour') !== null) return true;

  const mode = search.get('mode');
  if (mode === 'tour' || mode === 'practice') return true;

  if (search.get('seed') !== null) return true;
  if (search.get('course') === 'prototype') return true;

  return false;
}

function renderTopMenu(): void {
  const root = prepareMenuRoot();
  root.replaceChildren();

  const panel = document.createElement('main');
  panel.className = 'menu-panel';

  const title = document.createElement('h1');
  title.className = 'menu-title';
  title.textContent = 'putt';

  const subtitle = document.createElement('p');
  subtitle.className = 'menu-subtitle';
  subtitle.textContent = 'モードを選んでください';

  const actions = document.createElement('div');
  actions.className = 'menu-actions';
  actions.append(
    menuButton('通常ツアー', () => renderTourSelection()),
    disabledMenuButton('週替わりチャレンジ', '準備中'),
    menuButton('練習', () => navigateTo({ mode: 'practice' })),
  );

  panel.append(title, subtitle, actions);
  root.append(panel);
}

function renderTourSelection(): void {
  const root = prepareMenuRoot();
  root.replaceChildren();

  const panel = document.createElement('main');
  panel.className = 'menu-panel course-panel';

  const heading = document.createElement('div');
  heading.className = 'menu-heading';

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'menu-back';
  back.textContent = '← トップ';
  back.addEventListener('click', renderTopMenu);

  const title = document.createElement('h1');
  title.className = 'course-title';
  title.textContent = '通常ツアー';

  heading.append(back, title);

  const courses = document.createElement('div');
  courses.className = 'course-list';

  for (const tour of TOUR_SETS) {
    courses.append(courseButton(tour));
  }

  panel.append(heading, courses);
  root.append(panel);
}

function courseButton(tour: TourDefinition): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'course-button';

  const name = document.createElement('span');
  name.className = 'course-name';
  name.textContent = tour.name;

  const description = document.createElement('span');
  description.className = 'course-description';
  description.textContent = tour.description;

  button.append(name, description);

  const resume = resumeLabel(tour);
  if (resume) {
    const status = document.createElement('span');
    status.className = 'course-resume';
    status.textContent = resume;
    button.append(status);
  }

  button.addEventListener('click', () => navigateTo({ tour: tour.id }));
  return button;
}

function resumeLabel(tour: TourDefinition): string | null {
  const store = new RoundProgressStore(
    \\`\${CONFIG.game.round.save.tourKey}-\${tour.id}\\`,
    CONFIG.game.round.save.version,
    tour.seeds,
  );
  const saved = store.load();
  if (!saved) return null;

  const round = new Round(tour.seeds);
  if (!round.restore(saved)) return null;
  if (round.holeNumber <= 1) return null;

  return \\`HOLE \${round.holeNumber}から再開\\`;
}

function menuButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'menu-button';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function disabledMenuButton(label: string, status: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'menu-button menu-button-disabled';
  button.disabled = true;

  const text = document.createElement('span');
  text.textContent = label;
  const badge = document.createElement('span');
  badge.className = 'menu-badge';
  badge.textContent = status;

  button.append(text, badge);
  return button;
}

function navigateTo(nextParams: Record<string, string>): void {
  const url = new URL(window.location.href);
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(nextParams)) search.set(key, value);
  url.search = search.toString();
  url.hash = '';
  window.location.assign(url.toString());
}

function prepareMenuRoot(): HTMLElement {
  document.body.classList.add('menu-active');
  ensureMenuStyles();

  let root = document.getElementById('menu-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'menu-root';
    document.body.append(root);
  }
  return root;
}

function ensureMenuStyles(): void {
  if (document.getElementById('menu-styles')) return;

  const style = document.createElement('style');
  style.id = 'menu-styles';
  style.textContent = \\`
    body.menu-active {
      background: #101410;
      color: #e8f0e8;
    }
    body.menu-active #app,
    body.menu-active #stroke,
    body.menu-active #hud,
    body.menu-active #tuning-panel,
    body.menu-active #camera-controls,
    body.menu-active #map-control,
    body.menu-active #giveup-control,
    body.menu-active #stroke-controls,
    body.menu-active #stroke-camera-controls,
    body.menu-active #score-overlay {
      display: none !important;
    }
    #menu-root {
      position: fixed;
      inset: 0;
      z-index: 60;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow-y: auto;
      padding: max(24px, env(safe-area-inset-top)) 18px max(24px, env(safe-area-inset-bottom));
      background: linear-gradient(180deg, #18231a 0%, #0d110e 100%);
      font-family: system-ui, -apple-system, sans-serif;
      touch-action: manipulation;
    }
    .menu-panel {
      width: min(360px, 100%);
    }
    .menu-title {
      font-size: clamp(48px, 16vw, 72px);
      line-height: 1;
      letter-spacing: 0.04em;
      text-align: center;
      color: #9ede8a;
      text-shadow: 0 3px 0 rgba(0, 0, 0, 0.28);
    }
    .menu-subtitle {
      margin-top: 14px;
      text-align: center;
      font-size: 13px;
      color: #bcd0c0;
    }
    .menu-actions,
    .course-list {
      display: grid;
      gap: 12px;
      margin-top: 32px;
    }
    .menu-button,
    .course-button,
    .menu-back {
      appearance: none;
      border: 1px solid rgba(232, 240, 232, 0.46);
      color: #e8f0e8;
      font: inherit;
      touch-action: manipulation;
    }
    .menu-button {
      min-height: 58px;
      border-radius: 14px;
      background: rgba(42, 62, 45, 0.9);
      padding: 14px 18px;
      font-size: 17px;
      font-weight: 700;
    }
    .menu-button:active:not(:disabled),
    .course-button:active,
    .menu-back:active {
      transform: translateY(1px);
    }
    .menu-button-disabled {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      opacity: 0.48;
    }
    .menu-badge {
      border: 1px solid rgba(232, 240, 232, 0.35);
      border-radius: 999px;
      padding: 4px 9px;
      font-size: 11px;
      font-weight: 600;
    }
    .menu-heading {
      display: grid;
      gap: 18px;
    }
    .menu-back {
      justify-self: start;
      min-height: 44px;
      border-radius: 999px;
      background: rgba(12, 20, 14, 0.72);
      padding: 9px 14px;
      font-size: 13px;
    }
    .course-title {
      font-size: 30px;
      color: #9ede8a;
    }
    .course-list {
      margin-top: 22px;
    }
    .course-button {
      display: flex;
      min-height: 88px;
      flex-direction: column;
      align-items: flex-start;
      border-radius: 14px;
      background: rgba(30, 45, 33, 0.92);
      padding: 14px 16px;
      text-align: left;
    }
    .course-name {
      font-size: 18px;
      font-weight: 700;
    }
    .course-description {
      margin-top: 5px;
      font-size: 12px;
      line-height: 1.45;
      color: #bcd0c0;
    }
    .course-resume {
      margin-top: 9px;
      border-radius: 999px;
      background: rgba(158, 222, 138, 0.14);
      padding: 4px 8px;
      font-size: 12px;
      font-weight: 700;
      color: #bdf0ad;
    }
  \\`;
  document.head.append(style);
}
`;

function replaceOnce(text, before, after, label) {
  const first = text.indexOf(before);
  if (first < 0) throw new Error(`${label}: anchor not found`);
  if (text.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${label}: anchor is not unique`);
  }
  return text.slice(0, first) + after + text.slice(first + before.length);
}

writeFileSync('src/entry.ts', entrySource);

let index = readFileSync('index.html', 'utf8');
index = replaceOnce(
  index,
  '<script type="module" src="/src/main.ts"></script>',
  '<script type="module" src="/src/entry.ts"></script>',
  'index entry',
);
writeFileSync('index.html', index);

let projectStatus = readFileSync('PROJECT_STATUS.md', 'utf8');
projectStatus = replaceOnce(
  projectStatus,
  '最終更新: 2026-09-05（**試遊用3コースを実装中。次は27ホールの実機確認**）',
  '最終更新: 2026-09-05（**トップメニューと通常ツアー選択を実装。実機確認待ち**）',
  'PROJECT_STATUS updated line',
);
projectStatus = replaceOnce(
  projectStatus,
  '## 現在地\n\n',
  `## 現在地\n\n- **トップメニューと通常ツアーのコース選択を実装済み・実機確認待ち**\n  - クエリ指定なしの \\`/putt/\\` はゲームを直接始めず、通常ツアー／週替わりチャレンジ／練習を表示する\n  - 週替わりチャレンジは今回は「準備中」の無効ボタン。プレイ画面への接続は別タスク\n  - 通常ツアーは「風の丘」「曲がりの森」「水鏡の庭」から選択し、保存済み進行があれば \\`HOLE nから再開\\` を表示する\n  - 練習は既存の \\`?mode=practice\\` へ接続。開発・試遊用の直接URLは従来どおりゲームを直接開始する\n  - ゲーム中からメニューへ戻る操作、途中ラウンド破棄、ランキング、広告は未実装\n`,
  'PROJECT_STATUS current location',
);
writeFileSync('PROJECT_STATUS.md', projectStatus);

let releasePlan = readFileSync('RELEASE_PLAN.md', 'utf8');
releasePlan = replaceOnce(
  releasePlan,
  '| モード選択・広告・遷移 | 未着手 | 通常ツアー／週替わりチャレンジ／練習の入口、途中切替、3ホールごとの広告、二重表示防止 | 仕様の主要遷移を実機で一巡できる | チャレンジとランキングの画面・状態が確定 |',
  '| モード選択・広告・遷移 | 進行中 | トップメニュー、通常ツアー3コース選択、練習入口を実装。週替わりは準備中表示。途中切替、広告、週替わり接続が残る | 仕様の主要遷移を実機で一巡できる | 週替わり接続とランキングの画面・状態が確定 |',
  'RELEASE_PLAN mode row',
);
releasePlan = replaceOnce(
  releasePlan,
  '一方、メニュー、ゲーム全体の状態遷移、広告の実装は同じ箇所へ変更が集中しやすいため、\nチャレンジとランキングの入口が固まるまで並行着手しない。',
  'トップメニューと通常ツアー／練習の入口は先行実装済み。週替わりチャレンジは「準備中」として表示し、\nプレイ画面への接続、ゲーム中からメニューへ戻る操作、広告、ランキング統合は後続タスクで扱う。',
  'RELEASE_PLAN parallel note',
);
writeFileSync('RELEASE_PLAN.md', releasePlan);

let tasks = readFileSync('TASKS.md', 'utf8');
tasks = replaceOnce(
  tasks,
  '## ゲーム全体の仕様検討\n',
  `## T10. トップメニューと通常ツアーのコース選択\n\n**実装済み・実機確認待ち。**\n\n- クエリ指定なしの公開入口ではゲームを直接開始せず、トップメニューを表示する\n- トップには「通常ツアー」「週替わりチャレンジ」「練習」を置く\n  - 週替わりチャレンジは今回は「準備中」の無効ボタン\n- 通常ツアーは3コース選択画面を経由する\n  - 風の丘 / 曲がりの森 / 水鏡の庭\n  - \\`RoundProgressStore\\` の保存が有効なら \\`HOLE nから再開\\` を表示\n  - 選択後の復元は既存ゲーム本体へ任せる\n- 練習は既存 \\`?mode=practice\\` 相当を開始する\n- \\`?tour=...\\` / \\`?mode=tour\\` / \\`?mode=practice\\` / \\`?seed=\\` / \\`?course=prototype\\` はトップを経由せず直接ゲームを開始する\n- URL生成は \\`URL\\` / \\`URLSearchParams\\` を使い、GitHub Pages の \\`/putt/\\` 配下を維持する\n- ゲーム中からメニューへ戻る、途中ラウンド破棄、週替わり接続、ランキング、広告は後続タスク\n\n---\n\n## ゲーム全体の仕様検討\n`,
  'TASKS game-wide section',
);
writeFileSync('TASKS.md', tasks);

let spec = readFileSync('docs/spec.md', 'utf8');
spec = replaceOnce(
  spec,
  '## 6. ゲーム全体の遊び方・モード\n\n',
  `## 6. ゲーム全体の遊び方・モード\n\n### トップメニューとモード入口\n\n- クエリ指定なしの公開入口 \\`/putt/\\` ではゲームを直接始めず、トップメニューを表示する\n- トップメニューには「通常ツアー」「週替わりチャレンジ」「練習」を置く\n  - 週替わりチャレンジはプレイ画面へ接続するまで「準備中」の無効ボタンとする\n- 「通常ツアー」はコース選択画面へ進み、「風の丘」「曲がりの森」「水鏡の庭」から選ぶ\n  - 保存中の進行が有効なら、コース名と一緒に \\`HOLE 4から再開\\` のように次のホール番号を表示する\n  - コース選択後は既存の保存・復元仕様どおり、そのホールの頭から自動再開する\n  - コース選択画面にはトップへ戻る操作を置く\n- 「練習」は既存の \\`?mode=practice\\` 相当を開始する\n- 開発・試遊用の直接URLはトップを経由しない\n  - \\`?tour=breeze\\` / \\`?tour=forest\\` / \\`?tour=waterside\\`\n  - \\`?mode=tour\\` / \\`?mode=practice\\` / \\`?seed=\\` / \\`?course=prototype\\`\n  - \\`?debug=1\\` と上記指定の組み合わせ\n- 画面遷移用URLは \\`URL\\` / \\`URLSearchParams\\` で組み立て、GitHub Pages の \\`/putt/\\` 配下を維持する\n- 今回は途中ラウンド削除・最初からやり直す操作、ゲーム中からメニューへ戻る操作、週替わり接続、ランキング、広告を含めない\n\n`,
  'spec section 6',
);
writeFileSync('docs/spec.md', spec);

unlinkSync('scripts/apply-menu-task.mjs');
unlinkSync('.github/workflows/menu-task.yml');
