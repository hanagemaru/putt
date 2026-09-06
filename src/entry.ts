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

function ensureMenuStyles(): void {
  if (document.getElementById('menu-styles')) return;

  const style = document.createElement('style');
  style.id = 'menu-styles';
  style.textContent = `
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
    .menu-back,
    .menu-text-link {
      appearance: none;
      color: #e8f0e8;
      font: inherit;
      touch-action: manipulation;
    }
    .menu-button,
    .course-button,
    .menu-back {
      border: 1px solid rgba(232, 240, 232, 0.46);
    }
    .menu-button {
      min-height: 58px;
      border-radius: 14px;
      background: rgba(42, 62, 45, 0.9);
      padding: 14px 18px;
      font-size: 17px;
      font-weight: 700;
    }
    .menu-button:active,
    .course-button:active,
    .menu-back:active,
    .menu-text-link:active {
      transform: translateY(1px);
    }
    .menu-secondary {
      display: flex;
      justify-content: center;
      gap: 22px;
      margin-top: 22px;
    }
    .menu-text-link {
      min-height: 44px;
      border: 0;
      background: transparent;
      padding: 12px 2px;
      font-size: 13px;
      line-height: 20px;
      text-decoration: underline;
      text-underline-offset: 3px;
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
    .course-best,
    .course-resume {
      margin-top: 9px;
      border-radius: 999px;
      background: rgba(158, 222, 138, 0.14);
      padding: 4px 8px;
      font-size: 12px;
      font-weight: 700;
      color: #bdf0ad;
    }
  `;
  document.head.append(style);
}
