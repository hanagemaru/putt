import { CONFIG } from './config';
import { TOUR_SETS, tourById, type TourDefinition } from './course/tour-holes';
import { TourBestScoreStore, type BestScoreUpdate } from './best-score-storage';
import { Round, formatToPar, onRoundComplete, type RoundResult } from './round';
import { RoundProgressStore } from './round-storage';

const HOW_TO_URL = 'https://hanage.app/games/putt/how-to-play/';
const PRIVACY_URL = 'https://hanage.app/privacy/';
const params = new URLSearchParams(window.location.search);

if (shouldStartGameDirectly(params)) {
  const tour = directTourFromParams(params);
  if (tour) setupTourBestTracking(tour);
  void import('./main');
} else if (params.get('menu') === 'tour') {
  renderTourSelection();
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

/** main.ts の modeFromUrl と同じ優先順で、自己ベスト対象の通常ツアーだけを返す。 */
function directTourFromParams(search: URLSearchParams): TourDefinition | null {
  const mode = search.get('mode');
  if (mode === 'practice') return null;
  if (mode === 'tour') return tourById(search.get('tour'));
  if (search.get('seed') !== null || search.get('course') === 'prototype') return null;
  if (search.get('tour') !== null) return tourById(search.get('tour'));
  return null;
}

/**
 * 通常ツアー完走時に自己ベストを保存し、ラウンド終了カードへ表示する。
 * Round はツアー名を知らないため、完走したシード列が選択中ツアーと一致することも確認する。
 */
function setupTourBestTracking(tour: TourDefinition): void {
  const store = new TourBestScoreStore(tour.id, tour.seeds);
  let latest: BestScoreUpdate | null = null;

  const scoreTitle = document.getElementById('score-title');
  const scoreSub = document.getElementById('score-sub');
  let bestResult: HTMLParagraphElement | null = null;

  if (scoreTitle && scoreSub) {
    bestResult = document.createElement('p');
    bestResult.id = 'tour-best-result';
    bestResult.hidden = true;
    scoreSub.insertAdjacentElement('afterend', bestResult);
    ensureBestScoreStyles();
  }

  const renderBest = (): void => {
    if (!scoreTitle || !bestResult) return;
    if (scoreTitle.textContent !== `${tour.name}・ラウンド終了`) {
      bestResult.hidden = true;
      return;
    }

    const update = latest ?? (() => {
      const score = store.load();
      return score ? { score, isNewBest: false } : null;
    })();
    if (!update) {
      bestResult.hidden = true;
      return;
    }

    const { score, isNewBest } = update;
    const best = `BEST ${score.strokes} (${formatToPar(score.strokes - score.par)})`;
    bestResult.textContent = isNewBest ? `NEW BEST!　${best}` : best;
    bestResult.hidden = false;
  };

  if (scoreTitle) {
    const observer = new MutationObserver(renderBest);
    observer.observe(scoreTitle, { childList: true, characterData: true, subtree: true });
  }

  onRoundComplete((result) => {
    if (!matchesTour(result, tour)) return;
    latest = store.record(result.totalStrokes, result.totalPar);
    renderBest();
  });
}

function matchesTour(result: RoundResult, tour: TourDefinition): boolean {
  return (
    result.scores.length === tour.seeds.length &&
    result.scores.every((score, index) => score.seed === tour.seeds[index])
  );
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
    menuButton('通常ツアー', renderTourSelection),
    menuButton('練習', () => navigateTo({ mode: 'practice' })),
  );

  const secondary = document.createElement('nav');
  secondary.className = 'menu-secondary';
  secondary.setAttribute('aria-label', '案内');

  const howTo = externalMenuLink('遊び方', HOW_TO_URL);
  const privacy = externalMenuLink('プライバシー', PRIVACY_URL);

  secondary.append(howTo, privacy);
  panel.append(title, subtitle, actions, secondary);
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
  for (const tour of TOUR_SETS) courses.append(courseButton(tour));

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

  const best = bestLabel(tour);
  if (best) {
    const status = document.createElement('span');
    status.className = 'course-best';
    status.textContent = best;
    button.append(status);
  }

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

function bestLabel(tour: TourDefinition): string | null {
  const score = new TourBestScoreStore(tour.id, tour.seeds).load();
  if (!score) return null;
  return `BEST ${score.strokes} (${formatToPar(score.strokes - score.par)})`;
}

function resumeLabel(tour: TourDefinition): string | null {
  const store = new RoundProgressStore(
    `${CONFIG.game.round.save.tourKey}-${tour.id}`,
    CONFIG.game.round.save.version,
    tour.seeds,
  );
  const saved = store.load();
  if (!saved) return null;

  const round = new Round(tour.seeds);
  if (!round.restore(saved) || round.holeNumber <= 1) return null;

  return `HOLE ${round.holeNumber}から再開`;
}

function menuButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'menu-button';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function externalMenuLink(label: string, href: string): HTMLAnchorElement {
  const link = document.createElement('a');
  link.className = 'menu-text-link';
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = label;
  return link;
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

function ensureBestScoreStyles(): void {
  if (document.getElementById('best-score-styles')) return;
  const style = document.createElement('style');
  style.id = 'best-score-styles';
  style.textContent = `
    #tour-best-result {
      margin: 10px 0 0;
      font-size: 14px;
      font-weight: 800;
      text-align: center;
    }
  `;
  document.head.append(style);
}


/**
 * メニューの見た目はプレイ画面のドット感（config.pixel）に合わせる。
 * 角丸・ぼかし影・アンチエイリアスの効いた装飾は使わず、
 * 等幅フォント・太い枠・段差のはっきりした影・コースと同じ色だけで作る。
 * 色は config のコース色に対応させている（fairway 0x74cf5c / rough 0x4f9844 /
 * deepRough 0x3a7332 / ob 0x27431f / flag 0xd94f3d / trail 0xffe66d / ball 0xf6f8f4）。
 * Webフォントは読み込まない（外部リクエストを増やさない）。日本語は端末のゴシックのまま、
 * 等幅指定と広い字間でドットUI寄りに見せる
 */
function ensureMenuStyles(): void {
  if (document.getElementById('menu-styles')) return;

  const style = document.createElement('style');
  style.id = 'menu-styles';
  style.textContent = `
    body.menu-active {
      background: #0f170f;
      color: #eef7ec;
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
    body.menu-active #score-overlay,
    body.menu-active #home-control,
    body.menu-active #home-dialog {
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
      padding: max(24px, env(safe-area-inset-top)) 16px max(24px, env(safe-area-inset-bottom));
      /*
       * プレイ画面は色数を段に丸めている（config.pixel.colorLevels）。
       * メニューの背景も滑らかなグラデーションにせず、はっきりした帯に区切って
       * その上へ8pxの市松を重ね、ドット絵の空と同じ作りにする
       */
      background-color: #1b2c1d;
      background-image:
        linear-gradient(180deg, #2f4a30 0 18%, #27431f 18% 38%, #1f3a1e 38% 58%, #19301a 58% 78%, #132515 78% 100%),
        linear-gradient(45deg, rgba(116, 207, 92, 0.05) 25%, transparent 25%, transparent 75%, rgba(116, 207, 92, 0.05) 75%),
        linear-gradient(45deg, rgba(116, 207, 92, 0.05) 25%, transparent 25%, transparent 75%, rgba(116, 207, 92, 0.05) 75%);
      background-size: 100% 100%, 8px 8px, 8px 8px;
      background-position: 0 0, 0 0, 4px 4px;
      /* 等幅＋広い字間でドットUIの並びに寄せる。日本語は端末のゴシックへ落ちる */
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Courier New', monospace;
      letter-spacing: 0.08em;
      image-rendering: pixelated;
      touch-action: manipulation;
    }
    .menu-panel {
      width: min(360px, 100%);
      border: 3px solid #74cf5c;
      /* 二重の枠でドット絵のウィンドウにする。ぼかさない */
      box-shadow: 0 0 0 3px #0d140d, 8px 8px 0 rgba(0, 0, 0, 0.45);
      background: rgba(15, 23, 15, 0.86);
      padding: 22px 16px 24px;
    }
    .menu-title {
      font-size: clamp(46px, 15vw, 66px);
      line-height: 1;
      letter-spacing: 0.16em;
      text-indent: 0.16em;
      text-align: center;
      text-transform: uppercase;
      color: #9ede8a;
      /* ぼかしのない段差だけで縁取りと落ち影を作る */
      text-shadow:
        3px 0 #0d140d,
        -3px 0 #0d140d,
        0 3px #0d140d,
        0 -3px #0d140d,
        6px 6px 0 #27431f;
    }
    .menu-subtitle {
      margin-top: 18px;
      text-align: center;
      font-size: 12px;
      letter-spacing: 0.18em;
      color: #bcd0c0;
    }
    .menu-actions,
    .course-list {
      display: grid;
      gap: 14px;
      margin-top: 28px;
    }
    .menu-button,
    .course-button,
    .menu-back,
    .menu-text-link {
      appearance: none;
      border-radius: 0;
      color: #eef7ec;
      font-family: inherit;
      letter-spacing: inherit;
      touch-action: manipulation;
    }
    /*
     * ドット絵のボタン。上と左を明るく、下と右を暗くしたベベルで盛り上げ、
     * 押したぶんだけ下の影が消えて沈む
     */
    .menu-button,
    .course-button,
    .menu-back {
      border-style: solid;
      border-width: 3px;
      border-color: #9ede8a #1b3318 #1b3318 #9ede8a;
      box-shadow: 0 4px 0 #0d140d;
    }
    .menu-button {
      min-height: 60px;
      background: #3a7332;
      padding: 14px 16px;
      font-size: 16px;
      font-weight: 700;
    }
    .menu-button:active,
    .course-button:active,
    .menu-back:active {
      transform: translateY(4px);
      border-color: #1b3318 #9ede8a #9ede8a #1b3318;
      box-shadow: none;
    }
    .menu-text-link:active {
      transform: translateY(2px);
    }
    .menu-button:focus-visible,
    .course-button:focus-visible,
    .menu-back:focus-visible,
    .menu-text-link:focus-visible {
      outline: 3px solid #ffe66d;
      outline-offset: 2px;
    }
    .menu-secondary {
      display: flex;
      justify-content: center;
      gap: 20px;
      margin-top: 24px;
    }
    .menu-text-link {
      min-height: 44px;
      border: 0;
      background: transparent;
      padding: 12px 2px;
      font-size: 12px;
      line-height: 20px;
      /* 下線もドットに合わせて、4px刻みの破線を2pxの高さで敷く */
      text-decoration: none;
      background-image: repeating-linear-gradient(90deg, rgba(188, 208, 192, 0.7) 0 4px, transparent 4px 8px);
      background-size: 100% 2px;
      background-repeat: no-repeat;
      background-position: 0 100%;
      color: #bcd0c0;
      cursor: pointer;
    }
    .menu-heading {
      display: grid;
      gap: 18px;
    }
    .menu-back {
      justify-self: start;
      min-height: 44px;
      background: #27431f;
      padding: 9px 14px;
      font-size: 12px;
      font-weight: 700;
    }
    .course-title {
      font-size: 24px;
      letter-spacing: 0.12em;
      color: #9ede8a;
      text-shadow: 3px 3px 0 #0d140d;
    }
    .course-list {
      margin-top: 20px;
    }
    .course-button {
      display: flex;
      min-height: 88px;
      flex-direction: column;
      align-items: flex-start;
      background: #27431f;
      padding: 13px 14px;
      text-align: left;
    }
    .course-name {
      font-size: 17px;
      font-weight: 700;
      color: #9ede8a;
    }
    .course-description {
      margin-top: 7px;
      font-size: 11px;
      line-height: 1.6;
      letter-spacing: 0.06em;
      color: #bcd0c0;
    }
    /* 自己ベストと再開はドット絵のラベル。角丸にせず枠で囲む */
    .course-best,
    .course-resume {
      margin-top: 10px;
      border: 2px solid #0d140d;
      padding: 3px 7px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.1em;
    }
    .course-best {
      background: #ffe66d;
      color: #16210f;
    }
    .course-resume {
      background: #d94f3d;
      color: #fff2ee;
    }
  `;
  document.head.append(style);
}
