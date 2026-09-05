import { CONFIG } from './config';
import { TOUR_SETS, type TourDefinition } from './course/tour-holes';
import { Round } from './round';
import { RoundProgressStore } from './round-storage';

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
  `;
  document.head.append(style);
}
