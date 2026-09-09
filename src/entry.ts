import { CONFIG } from './config';
import { TOUR_SETS, tourById, type TourDefinition } from './course/tour-holes';
import { TourBestScoreStore, type BestScoreUpdate } from './best-score-storage';
import { Round, formatToPar, onRoundComplete, type RoundResult } from './round';
import { RoundProgressStore } from './round-storage';
import { ensurePixelFont } from './pixel-font';
import { projectedRadiusPx } from './projection';
import {
  PUTTER_SHAPES,
  drawPutterHead,
  loadPutterShape,
  putterHeadBounds,
  savePutterShape,
  type PutterShapeId,
} from './putter-shape';

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

  const putter = internalMenuLink('パター', renderPutterSelection);
  const howTo = externalMenuLink('遊び方', HOW_TO_URL);
  const privacy = externalMenuLink('プライバシー', PRIVACY_URL);

  secondary.append(putter, howTo, privacy);
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
  for (const tour of TOUR_SETS) courses.append(courseEntry(tour));

  panel.append(heading, courses);
  root.append(panel);
}

/**
 * パターの形状を選ぶ画面。
 *
 * **見た目だけの選択で、性能差は付けない。** どれを選んでもフェース長・芯の範囲・
 * 打ち出しの計算は同じなので、画面にもそう書いておく。
 * 枠は押さず、コース選択と同じく中のボタンだけを押させる。
 */
function renderPutterSelection(): void {
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
  title.textContent = 'パター';

  heading.append(back, title);

  const list = document.createElement('div');
  list.className = 'course-list';
  const selected = loadPutterShape();
  for (const shape of PUTTER_SHAPES) list.append(putterEntry(shape, selected));

  panel.append(heading, list);
  root.append(panel);
}

/** パター1本ぶんの枠。見本・名前と、選ぶボタンを1行に置く */
function putterEntry(
  shape: (typeof PUTTER_SHAPES)[number],
  selected: PutterShapeId,
): HTMLElement {
  const card = document.createElement('div');
  card.className = 'course-card putter-card';

  const name = document.createElement('div');
  name.className = 'course-name putter-name';
  name.textContent = shape.name;

  const action = document.createElement('div');
  action.className = 'putter-action';

  if (shape.id === selected) {
    const current = document.createElement('span');
    current.className = 'course-best';
    current.textContent = '選択中';
    action.append(current);
  } else {
    action.append(
      // 名前と横に並ぶので、狭い端末で名前が折り返さない短い言葉にする
      courseAction('選ぶ', false, () => {
        savePutterShape(shape.id);
        renderPutterSelection();
      }),
    );
  }

  card.append(putterPreview(shape.id), name, action);
  return card;
}

/**
 * 枠の中に置くヘッドの見本。
 * ゲーム本体と同じ描画（putter-shape.ts）を使い、待機中の色・向きでそのまま描く。
 * 別々に描くと、選んだ形と構えたときの形が食い違う。
 */
function putterPreview(id: PutterShapeId): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.className = 'putter-preview';
  canvas.setAttribute('aria-hidden', 'true');

  // ヘッドは実寸だと枠に収まらないので少し落とす。
  // ボールとの大小はゲーム本体のままなので、比率は構えたときと変わらない
  const scale = 0.75;
  const w = 56;
  const h = 84;

  const dpr = Math.min(window.devicePixelRatio, CONFIG.renderer.maxPixelRatio);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  /*
   * ボールは 3D を真上から見た見かけの大きさで描く。
   * /swipe-test/ の 28px は検証ページ専用の値で、実際の STROKE ではこの半分以下にしか見えない。
   * main.ts と同じ式で出すので、見本と構えたときで大小が食い違わない
   */
  const ballRadius = projectedRadiusPx(
    CONFIG.ball.radius,
    CONFIG.game.stroke.eyeHeight - CONFIG.ball.radius,
    CONFIG.camera.fov,
    window.innerHeight,
  );
  // フェースからの隙間もゲーム本体の待機位置と同じ 3px
  const gap = CONFIG.swipeTest.putterRestOffsetPx - CONFIG.swipeTest.ballRadius;
  const ballCenter = CONFIG.swipeTest.putterWidth / 2 + gap + ballRadius;

  /*
   * 置き方は形状ごとに解く。奥行きはピン型とマレットで倍ほど違うので、
   * 原点を固定すると形によって枠の中で偏る。
   * ボールの左端からヘッドの一番奥まで、シャフトの先までを枠の中央へ置く
   */
  const bounds = putterHeadBounds(id);
  const left = ballCenter + ballRadius;
  const cx = w / 2 + (scale * (left + bounds.back)) / 2;
  const cy = h / 2 + (scale * (bounds.toe + bounds.heel)) / 2;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  // ゲーム本体の待機姿勢と同じ向き。フェースは左（狙い方向）を向く
  ctx.rotate(Math.PI);

  drawPreviewBall(ctx, ballCenter, ballRadius);
  drawPutterHead(ctx, id, {
    face: 'rgba(150,175,160,0.55)',
    spot: 'rgba(18,26,22,0.7)',
    rest: true,
  });
  ctx.restore();

  return canvas;
}

/**
 * 見本のボール。ただの白丸だと紙のシールに見えるので、
 * ゲーム本体と同じく芝への影を敷き、光の当たらない側を暗くして球に見せる。
 * 影の大きさと濃さは CONFIG.ball のものをそのまま使う。
 *
 * 陰は円を2枚ずらして重ねるのではなく、**1枚の円の中を放射状に暗くする**。
 * 重ねる描き方だと輪郭が円からずれて、いびつな球に見えてしまう
 */
function drawPreviewBall(ctx: CanvasRenderingContext2D, centerX: number, radius: number): void {
  // 芝に落ちる影
  ctx.fillStyle = `rgba(13, 20, 13, ${CONFIG.ball.shadowOpacity})`;
  ctx.beginPath();
  ctx.arc(centerX, 0, radius * CONFIG.ball.shadowScale, 0, Math.PI * 2);
  ctx.fill();

  /*
   * 明るい側は 3D のボールに合わせて画面の左下。
   * ローカル座標は回転後なので、画面の左下は +X / -Y になる
   */
  const lightX = centerX + radius * 0.35;
  const lightY = -radius * 0.35;
  const shade = ctx.createRadialGradient(lightX, lightY, radius * 0.1, centerX, 0, radius);
  shade.addColorStop(0, '#ffffff');
  shade.addColorStop(0.5, `#${CONFIG.ball.color.toString(16).padStart(6, '0')}`);
  shade.addColorStop(1, '#9aa79d');

  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.arc(centerX, 0, radius, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * コース1つぶんの枠。
 *
 * 枠そのものは押さない。**押すところはボタンだけ**にして、
 * 「どこを押すと何が起きるか」を1段で分かるようにする。
 * 途中の保存があるときだけ「最初から」と「HOLE nから再開」を並べ、
 * 無ければ「最初から」だけを出す
 */
function courseEntry(tour: TourDefinition): HTMLElement {
  const card = document.createElement('div');
  card.className = 'course-card';

  const name = document.createElement('div');
  name.className = 'course-name';
  name.textContent = tour.name;

  const description = document.createElement('div');
  description.className = 'course-description';
  description.textContent = tour.description;

  card.append(name, description);

  const best = bestLabel(tour);
  if (best) {
    const status = document.createElement('div');
    status.className = 'course-best-row';
    const badge = document.createElement('span');
    badge.className = 'course-best';
    badge.textContent = best;
    status.append(badge);
    card.append(status);
  }

  const actions = document.createElement('div');
  actions.className = 'course-actions';

  const resume = resumeLabel(tour);
  const restart = courseAction('最初から', !resume, () => {
    // 続きを捨てて回り直す。始める前に保存を消しておく
    if (resume) progressStore(tour).clear();
    navigateTo({ tour: tour.id });
  });
  actions.append(restart);

  if (resume) {
    actions.classList.add('two');
    actions.append(courseAction(resume, true, () => navigateTo({ tour: tour.id })));
  }

  card.append(actions);
  return card;
}

/** コースの枠の中に置くボタン。`primary` は白地で、押してほしい側を示す */
function courseAction(label: string, primary: boolean, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = primary ? 'course-action primary' : 'course-action';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function bestLabel(tour: TourDefinition): string | null {
  const score = new TourBestScoreStore(tour.id, tour.seeds).load();
  if (!score) return null;
  return `BEST ${score.strokes} (${formatToPar(score.strokes - score.par)})`;
}

/** 通常ツアー1コースぶんの進行の保存場所。main.ts と同じキーの作り方をする */
function progressStore(tour: TourDefinition): RoundProgressStore {
  return new RoundProgressStore(
    `${CONFIG.game.round.save.tourKey}-${tour.id}`,
    CONFIG.game.round.save.version,
    tour.seeds,
  );
}

function resumeLabel(tour: TourDefinition): string | null {
  const store = progressStore(tour);
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

/** メニュー内の別画面へ移る。見た目は外部リンクと揃える */
function internalMenuLink(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'menu-text-link';
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
      display: inline-block;
      margin: 12px 0 0;
      border: 2px solid #0d140d;
      background: #ffe66d;
      padding: 4px 8px;
      font-size: 16px;
      color: #16210f;
    }
  `;
  document.head.append(style);
}


/**
 * メニューの見た目はプレイ画面のドット感（config.pixel）に合わせる。
 * 角丸・ぼかし影・アンチエイリアスの効いた装飾は使わず、
 * ドット絵フォント・太い枠・段差のはっきりした影・コースと同じ色だけで作る。
 * 色は config のコース色に対応させている（fairway 0x74cf5c / rough 0x4f9844 /
 * deepRough 0x3a7332 / ob 0x27431f / flag 0xd94f3d / trail 0xffe66d / ball 0xf6f8f4）。
 */
function ensureMenuStyles(): void {
  ensurePixelFont();
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
      /*
       * 中央寄せ（align-items: center）のままだと、内容が画面より高いときに
       * 上へはみ出したぶんがスクロールで戻せず切れる。
       * 揃えは先頭にして、余白があるときだけ margin で中央へ寄せる
       */
      align-items: flex-start;
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
      font-family: var(--pixel-font);
      letter-spacing: 0.08em;
      image-rendering: pixelated;
      touch-action: manipulation;
    }
    .menu-panel {
      width: min(360px, 100%);
      margin: auto;
      border: 3px solid #74cf5c;
      /* 二重の枠でドット絵のウィンドウにする。ぼかさない */
      box-shadow: 0 0 0 3px #0d140d, 8px 8px 0 rgba(0, 0, 0, 0.45);
      background: rgba(15, 23, 15, 0.86);
      padding: 22px 16px 24px;
    }
    /*
     * DotGothic16 は16px方眼で描かれているので、字の大きさは16の倍数に寄せる。
     * 中途半端な大きさにすると点がにじんでドットに見えなくなる
     */
    .menu-title {
      font-size: 48px;
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
    @media (min-width: 360px) {
      .menu-title {
        font-size: 64px;
      }
    }
    .menu-subtitle {
      margin-top: 18px;
      text-align: center;
      font-size: 16px;
      letter-spacing: 0.12em;
      color: #bcd0c0;
    }
    .menu-actions,
    .course-list {
      display: grid;
      gap: 14px;
      margin-top: 28px;
    }
    .menu-button,
    .course-action,
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
      font-weight: 400;
    }
    .menu-button:active,
    .menu-back:active {
      transform: translateY(4px);
      border-color: #1b3318 #9ede8a #9ede8a #1b3318;
      box-shadow: none;
    }
    .menu-text-link:active {
      transform: translateY(2px);
    }
    .menu-button:focus-visible,
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
      font-size: 16px;
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
      font-size: 16px;
    }
    .course-title {
      font-size: 32px;
      letter-spacing: 0.12em;
      color: #9ede8a;
      text-shadow: 3px 3px 0 #0d140d;
    }
    .course-list {
      margin-top: 20px;
    }
    /* コースの枠。押すのは中のボタンだけで、枠自体は押さない */
    .course-card {
      border-style: solid;
      border-width: 3px;
      border-color: #9ede8a #1b3318 #1b3318 #9ede8a;
      background: #27431f;
      padding: 13px 14px 14px;
      text-align: left;
    }
    .course-actions {
      display: grid;
      gap: 8px;
      margin-top: 12px;
    }
    .course-actions.two {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .course-action {
      min-height: 44px;
      border-style: solid;
      border-width: 3px;
      border-color: #9ede8a #1b3318 #1b3318 #9ede8a;
      background: #3a7332;
      box-shadow: 0 4px 0 #0d140d;
      padding: 12px 6px;
      font-size: 16px;
      white-space: nowrap;
    }
    /* 押してほしい側は白地。保存があるときは「再開」、無いときは「最初から」 */
    .course-action.primary {
      background: #eef7ec;
      border-color: #ffffff #4f9844 #4f9844 #ffffff;
      color: #16210f;
    }
    .course-action:active {
      transform: translateY(4px);
      border-color: #1b3318 #9ede8a #9ede8a #1b3318;
      box-shadow: none;
    }
    .course-action:focus-visible {
      outline: 3px solid #ffe66d;
      outline-offset: 2px;
    }
    /* 幅の狭い端末では「HOLE nから再開」が半分の幅に収まらないので落とす */
    @media (max-width: 359px) {
      .course-action {
        font-size: 12px;
      }
    }
    .course-best-row {
      margin-top: 10px;
    }
    /* パター選択 */
    /* パター1本は「見本・名前・ボタン」の1行。説明は付けず、違いは見本で見せる */
    .putter-card {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
    }
    .putter-preview {
      flex: none;
      border: 2px solid #0d140d;
      background: #3a7332;
      image-rendering: pixelated;
    }
    .putter-name {
      flex: 1;
      min-width: 0;
      white-space: nowrap;
    }
    .putter-action {
      flex: none;
    }
    .putter-action .course-action {
      padding: 12px 14px;
    }
    .course-name {
      font-size: 16px;
      color: #9ede8a;
    }
    .course-description {
      margin-top: 7px;
      font-size: 16px;
      line-height: 1.5;
      letter-spacing: 0.02em;
      color: #bcd0c0;
    }
    /* 自己ベストと再開はドット絵のラベル。角丸にせず枠で囲む */
    .course-best {
      display: inline-block;
      border: 2px solid #0d140d;
      background: #ffe66d;
      padding: 3px 7px;
      font-size: 16px;
      letter-spacing: 0.06em;
      color: #16210f;
    }
  `;
  document.head.append(style);
}
