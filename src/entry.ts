import { CONFIG } from './config';
import { TOUR_SETS, type TourDefinition } from './course/tour-holes';
import { Round } from './round';
import { RoundProgressStore } from './round-storage';

const PRIVACY_URL = 'https://hanage.app/privacy/';
const params = new URLSearchParams(window.location.search);

if (shouldStartGameDirectly(params)) {
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

  const howTo = document.createElement('button');
  howTo.type = 'button';
  howTo.className = 'menu-text-link';
  howTo.textContent = '遊び方';
  howTo.addEventListener('click', renderHowTo);

  const privacy = document.createElement('a');
  privacy.className = 'menu-text-link';
  privacy.href = PRIVACY_URL;
  privacy.target = '_blank';
  privacy.rel = 'noopener noreferrer';
  privacy.textContent = 'プライバシー';

  secondary.append(howTo, privacy);
  panel.append(title, subtitle, actions, secondary);
  root.append(panel);
}

function renderHowTo(): void {
  const root = prepareMenuRoot();
  root.replaceChildren();

  const panel = document.createElement('main');
  panel.className = 'menu-panel info-panel';

  const heading = document.createElement('div');
  heading.className = 'menu-heading';

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'menu-back';
  back.textContent = '← トップ';
  back.addEventListener('click', renderTopMenu);

  const title = document.createElement('h1');
  title.className = 'course-title';
  title.textContent = '遊び方';

  heading.append(back, title);

  const steps = document.createElement('ol');
  steps.className = 'howto-list';
  const items = [
    ['コースを見る', '視点ボタンやコースマップで、傾斜とカップまでの形を確認します。'],
    ['狙いを決める', 'ボール後方・低い視点では、左右スワイプで狙いを調整できます。'],
    ['構える', '狙いが決まったら画面をタップして、パターを構えます。'],
    ['打つ', 'パターを右へ引いてから、左へ振り抜いてボールを打ちます。'],
    ['池・OB', '入った場合は1罰打を加え、直前のショット位置から打ち直します。'],
  ] as const;

  for (const [label, description] of items) {
    const item = document.createElement('li');
    const strong = document.createElement('strong');
    strong.textContent = label;
    const text = document.createElement('span');
    text.textContent = description;
    item.append(strong, text);
    steps.append(item);
  }

  panel.append(heading, steps);
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
    .course-resume {
      margin-top: 9px;
      border-radius: 999px;
      background: rgba(158, 222, 138, 0.14);
      padding: 4px 8px;
      font-size: 12px;
      font-weight: 700;
      color: #bdf0ad;
    }
    .info-panel {
      padding-bottom: 12px;
    }
    .howto-list {
      display: grid;
      gap: 12px;
      margin: 24px 0 0;
      padding: 0;
      list-style: none;
      counter-reset: howto;
    }
    .howto-list li {
      counter-increment: howto;
      display: grid;
      grid-template-columns: 30px 1fr;
      column-gap: 10px;
      row-gap: 3px;
      border: 1px solid rgba(232, 240, 232, 0.24);
      border-radius: 12px;
      background: rgba(30, 45, 33, 0.72);
      padding: 12px 14px;
    }
    .howto-list li::before {
      content: counter(howto);
      grid-row: 1 / span 2;
      display: grid;
      place-items: center;
      align-self: start;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: rgba(158, 222, 138, 0.16);
      font-size: 13px;
      font-weight: 800;
      color: #bdf0ad;
    }
    .howto-list strong {
      font-size: 14px;
      color: #e8f0e8;
    }
    .howto-list span {
      font-size: 12px;
      line-height: 1.55;
      color: #bcd0c0;
    }
  `;
  document.head.append(style);
}
