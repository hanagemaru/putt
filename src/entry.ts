import { installWebAnalytics } from './web-analytics';
import { CONFIG } from './config';
import { DEFAULT_TOUR, TOUR_SETS, tourById, type TourDefinition } from './course/tour-holes';
import { TourBestScoreStore, type BestScoreUpdate } from './best-score-storage';
import { Round, onRoundComplete, type RoundResult } from './round';
import { RoundProgressStore } from './round-storage';
import {
  deletePlayer,
  flushPendingSubmissions,
  loadPlayerName,
  rankingAvailable,
  readOrCreateIdentity,
  submitRecord,
  updatePlayerName,
  fetchRanking,
} from './ranking-client';
import { tourBoardId, type RankingBoard, type SubmitRecordRequest } from './ranking-shared';
import { rankingNotice, rankingTable, showNameOverlay } from './ranking-view';
import { ensurePixelFont } from './pixel-font';
import * as i18n from './i18n';
import { applyStaticUiText, language, setLanguage, t } from './i18n';
import { projectedRadiusPx } from './projection';
import {
  PUTTER_SHAPE_IDS,
  drawPutterHead,
  loadPutterShape,
  putterHeadBounds,
  savePutterShape,
  type PutterShapeId,
} from './putter-shape';
import { registerSW } from 'virtual:pwa-register';

installWebAnalytics();

const HUB_ORIGIN = 'https://hanage.app';
const HOW_TO_PATH = '/games/putt/how-to-play/';
const PRIVACY_PATH = '/privacy/';
const params = new URLSearchParams(window.location.search);

// 一度開けば、次からは電波がなくても遊べる。
// 新しい版は裏で用意されるだけで、当たるのは次の起動から。ラウンドの途中で
// 読み込み直さないため。dev サーバーでは何もしない。
registerSW({ immediate: true });

// index.html は日本語を初期値として持つ。英語ならここで一度だけ差し替える
applyStaticUiText();

// 前回送れなかった記録を送り直す（`docs/ranking.md` §6-2）。
// 積んでいるものが無ければ何もしないので、遊ぶだけの人には何も起きない
void flushPendingSubmissions();

if (params.get('menu') === 'ranking') {
  // **ゲームは始めない**ので、直接プレイの判定より先に見る。
  // `?tour=` はどのタブを開くかの指定で、無ければ最初のコース
  renderRanking(tourById(params.get('tour')));
} else if (shouldStartGameDirectly(params)) {
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
  /** 今回の完走結果。**自己ベストを更新したときだけ**登録に使う（§3-4） */
  let finished: RoundResult | null = null;
  /** 登録の手続きへ入ったか。カードが描き直されても二度送らない */
  let submissionStarted = false;

  const scoreTitle = document.getElementById('score-title');
  const scoreSub = document.getElementById('score-sub');
  let bestResult: HTMLParagraphElement | null = null;
  let rankingResult: HTMLParagraphElement | null = null;

  if (scoreTitle && scoreSub) {
    bestResult = document.createElement('p');
    bestResult.id = 'tour-best-result';
    bestResult.hidden = true;
    scoreSub.insertAdjacentElement('afterend', bestResult);

    // 登録の結果は BEST の下へ1行で出す（`T12 / 340人` / `あとで登録します` / `確認中`）
    rankingResult = document.createElement('p');
    rankingResult.id = 'ranking-result';
    rankingResult.hidden = true;
    bestResult.insertAdjacentElement('afterend', rankingResult);
    ensureBestScoreStyles();
  }

  // ラウンド終了カードの「ランキング」。**登録できたかに関わらず見には行ける**
  const rankingButton = rankingAvailable() ? appendRankingAction(tour) : null;

  const setRankingStatus = (text: string): void => {
    if (!rankingResult) return;
    rankingResult.textContent = text;
    rankingResult.hidden = text === '';
  };

  /** 登録する。**失敗してもここで握り潰す**（ゲームを止めない・§6-4） */
  const send = async (name: string): Promise<void> => {
    const result = finished;
    if (!result) return;
    setRankingStatus(t().rankingLoading);

    const outcome = await submitRecord(
      buildSubmission(tour, result, name),
      readOrCreateIdentity(),
    );
    if (!outcome.ok) {
      // 保留へ積んである。次の起動で送り直す
      setRankingStatus(t().rankingHeld);
      return;
    }
    const response = outcome.response;
    // **`pending`（検証待ち）でも板には載っているので、順位はそのまま出す。**
    // 順位が無いのは板から外れたとき（`suspicious`）だけで、そこで初めて「確認中」と断る
    setRankingStatus(
      response.rank === null
        ? t().rankingChecking
        : i18n.standingLabel(response.rank, response.tied, response.playerCount),
    );
  };

  /**
   * 登録へ入る。**「登録しますか？」とは聞かない**（遊ぶ側の一手間を増やさない）。
   * 聞くのは名前だけで、それも初回の1回だけ
   */
  const beginSubmission = (): void => {
    if (submissionStarted || !finished || !rankingAvailable()) return;
    submissionStarted = true;

    const name = loadPlayerName();
    if (name) {
      void send(name);
      return;
    }
    showNameOverlay({
      initial: null,
      onSave: (value) => void send(value),
      // 「あとで」なら送らない。次に更新したときにまた聞く
      onCancel: () => setRankingStatus(''),
    });
  };

  const renderBest = (): void => {
    const onRoundEnd = scoreTitle?.dataset.screen === 'round-end';
    // ホール間のカードにはランキングを出さない（ラウンドが終わってから）
    if (rankingButton) rankingButton.hidden = !onRoundEnd;
    if (!scoreTitle || !bestResult) return;
    if (!onRoundEnd) {
      bestResult.hidden = true;
      if (rankingResult) rankingResult.hidden = true;
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
    const best = i18n.bestLabel(score.strokes, i18n.formatDiff(score.strokes - score.par));
    bestResult.textContent = isNewBest ? i18n.newBestLabel(best) : best;
    bestResult.hidden = false;

    // カードが出た時点で登録へ入る。**同打数は更新扱いにしないので送らない**
    if (isNewBest) beginSubmission();
  };

  if (scoreTitle) {
    const observer = new MutationObserver(renderBest);
    observer.observe(scoreTitle, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-screen'],
    });
  }

  onRoundComplete((result) => {
    if (!matchesTour(result, tour)) return;
    finished = result;
    latest = store.record(result.totalStrokes, result.totalPar);
    renderBest();
  });
}

/**
 * ラウンド終了カードのボタンへ「ランキング」を足す（`docs/ranking.md` §6-3）。
 *
 * これで `コース選択へ / もう一度 / トップへ` と合わせて**4つ**になる。
 * 9ホールの一覧が出るカードは既に縦がぎりぎりなので、
 * **320×568 に収まるかは実機で確認する**（収まらなければ一覧の上へ1行で置く）
 */
function appendRankingAction(tour: TourDefinition): HTMLButtonElement | null {
  const actions = document.getElementById('score-actions');
  if (!actions) return null;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'score-action';
  button.id = 'score-ranking';
  button.hidden = true;
  button.textContent = t().rankingSee;
  button.addEventListener('click', () => navigateTo({ menu: 'ranking', tour: tour.id }));
  actions.append(button);
  return button;
}

/** 板ID（ランキングの単位）。**コースの作り方が変われば別の板になる** */
function boardIdFor(tour: TourDefinition): string {
  return tourBoardId(tour);
}

/**
 * スワイプ→初速の個人調整。**再現には要らない**が、分布を見たいので送る。
 * 読み方は `main.ts` の `loadPutterPowerScale` と同じ（性能差ではなく感度）
 */
function readPutterPowerScale(): number {
  const P = CONFIG.game.putterTuning;
  try {
    const raw = localStorage.getItem(P.storageKey);
    if (raw !== null) {
      const value = Number(raw);
      if (Number.isFinite(value)) return Math.min(Math.max(value, P.minScale), P.maxScale);
    }
  } catch {
    // 読めない環境では既定値を送る
  }
  return P.defaultScale;
}

/** 送る中身を組み立てる（同 §6-2） */
function buildSubmission(
  tour: TourDefinition,
  result: RoundResult,
  displayName: string,
): SubmitRecordRequest {
  const R = CONFIG.game.ranking;
  return {
    submissionId:
      typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    boardId: boardIdFor(tour),
    displayName,
    totalStrokes: result.totalStrokes,
    totalPar: result.totalPar,
    gaveUp: result.scores.some((hole) => !hole.holedOut),
    holes: result.scores.map((hole) => ({
      number: hole.number,
      seed: hole.seed,
      par: hole.par,
      strokes: hole.strokes,
      holedOut: hole.holedOut,
    })),
    // 打ち出しの列（`docs/ranking.md` §4-1）。**後から再生するためだけに送る。**
    // 途中保存から再開したラウンドでは揃わないホールがあるので、その穴は空で送る
    shots: result.scores.map((hole) => hole.shots ?? []),
    generator: tour.generator ?? 'v1',
    rulesVersion: R.rulesVersion,
    appVersion: R.appVersion,
    putterPowerScale: readPutterPowerScale(),
  };
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

  const copy = t();

  const subtitle = document.createElement('p');
  subtitle.className = 'menu-subtitle';
  subtitle.textContent = copy.menuSubtitle;

  /*
   * ボタンは「通常ツアー」「練習」「パターを選ぶ」の縦1列。
   * 横に並べると、日本語も英語も名前が折り返してボタンの高さが変わる。
   * パターは遊び始めるボタンではないので色を落として、押す前に区別できるようにする
   */
  const actions = document.createElement('div');
  actions.className = 'menu-actions';

  const putter = menuButton(copy.putterChoose, renderPutterSelection);
  putter.classList.add('menu-button-sub');

  actions.append(
    menuButton(copy.modeTour, renderTourSelection),
    menuButton(copy.modePractice, () => navigateTo({ mode: 'practice' })),
    putter,
  );

  // ランキングも遊び始めるボタンではないので、パターと同じく色を落とす。
  // **APIの無い配信先（GitHub Pages）では入口ごと出さない**（`docs/ranking.md` §6-4）
  if (rankingAvailable()) {
    const ranking = menuButton(copy.ranking, () => renderRanking());
    ranking.classList.add('menu-button-sub');
    actions.append(ranking);
  }

  const secondary = document.createElement('nav');
  secondary.className = 'menu-secondary';
  secondary.setAttribute('aria-label', copy.guideLabel);

  const howTo = externalMenuLink(copy.howTo, hubUrl(HOW_TO_PATH));
  const privacy = externalMenuLink(copy.privacy, hubUrl(PRIVACY_PATH));

  secondary.append(howTo, privacy);
  panel.append(title, subtitle, actions, secondary, languageToggle(renderTopMenu));
  root.append(panel);
}

function renderTourSelection(): void {
  const root = prepareMenuRoot();
  root.replaceChildren();
  // 見出しを上へ貼り付けるため、スクロール領域の上余白をパネル側へ移す（下の CSS）
  root.classList.add('tour-scroll');

  const panel = document.createElement('main');
  panel.className = 'menu-panel course-panel tour-panel';

  const heading = document.createElement('div');
  heading.className = 'menu-heading';

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'menu-back';
  back.textContent = t().backToMenu;
  back.addEventListener('click', renderTopMenu);

  const title = document.createElement('h1');
  title.className = 'course-title';
  title.textContent = t().tourTitle;

  heading.append(back, title);

  const courses = document.createElement('div');
  courses.className = 'course-list';
  for (const tour of TOUR_SETS) courses.append(courseEntry(tour));

  panel.append(heading, courses, languageToggle(renderTourSelection));
  root.append(panel);
}

/**
 * ランキング（`docs/ranking.md` §6-3）。**トップから1枚で着く。**
 *
 * コースごとに別の板だが、**画面は分けずタブで切り替える**（スイーパーと同じ作り）。
 * ボタンを何度も押させないことのほうが、画面を分ける整理より大事。
 *
 * 並びは上から「タブ → あなた → 表」。**自分の順位を表の中から探させない**ので、
 * 圏外でも、まだ登録していなくても、自分の立ち位置は常に同じ場所に出る。
 * 言語の切り替えはここに置かない（パター選択と同じで、トップにだけ置く）
 */
function renderRanking(tour: TourDefinition = DEFAULT_TOUR): void {
  const root = prepareMenuRoot();
  root.replaceChildren();
  const copy = t();

  const panel = document.createElement('main');
  panel.className = 'menu-panel course-panel ranking-panel';
  panel.append(menuHeading(copy.rankingTitle, renderTopMenu));

  // 板の切り替え。押した先も同じ画面なので、戻る道が増えない
  const tabs = document.createElement('div');
  tabs.className = 'ranking-tabs';
  for (const board of TOUR_SETS) {
    const selected = board.id === tour.id;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = selected ? 'ranking-tab selected' : 'ranking-tab';
    button.textContent = board.name[language()];
    button.setAttribute('aria-pressed', String(selected));
    if (!selected) button.addEventListener('click', () => renderRanking(board));
    tabs.append(button);
  }

  const you = playerCard(() => renderRanking(tour));
  const slot = document.createElement('div');

  const load = (): void => {
    slot.replaceChildren(rankingNotice(copy.rankingLoading));
    you.pending();
    void fetchRanking(boardIdFor(tour), readOrCreateIdentity()).then(
      (board: RankingBoard) => {
        you.show(board);
        slot.replaceChildren(rankingTable(board));
      },
      () => {
        you.failed();
        slot.replaceChildren(rankingNotice(copy.rankingUnavailable, load));
      },
    );
  };

  panel.append(tabs, you.element, slot, dataNotice(), deleteRecordsLink());
  root.append(panel);
  load();
}

interface PlayerCard {
  element: HTMLElement;
  /** 取りに行っている間 */
  pending: () => void;
  show: (board: RankingBoard) => void;
  failed: () => void;
}

/**
 * 表の上に置く「あなた」の一枚（`docs/ranking.md` §6-3）。
 *
 * **自分の順位を表の中から探させないための行。** 名前・順位・打数をいつも同じ場所に出し、
 * 名前を決める入口もここに置く（トップのボタンをこれ以上増やさない）
 */
function playerCard(rerender: () => void): PlayerCard {
  const copy = t();

  const element = document.createElement('div');
  element.className = 'ranking-you';

  const head = document.createElement('div');
  head.className = 'ranking-you-head';

  const label = document.createElement('span');
  label.className = 'ranking-you-label';
  label.textContent = copy.you;

  const name = document.createElement('span');
  name.className = 'ranking-you-name';

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'ranking-button';

  const renderName = (): void => {
    const current = loadPlayerName();
    name.textContent = current ?? copy.nameUnset;
    // まだ決めていない人には「決める」と出す。変えるものが無い状態で「変える」と言わない
    edit.textContent = current ? copy.nameEdit : copy.nameSet;
  };
  edit.addEventListener('click', () => {
    showNameOverlay({
      initial: loadPlayerName(),
      onSave: (value) => {
        // 端末側は先に保存する。サーバへの反映は失敗してもよい（次の登録で送り直る）
        void updatePlayerName(value, readOrCreateIdentity()).catch(() => {});
        rerender();
      },
      onCancel: () => {},
    });
  });
  renderName();

  head.append(label, name, edit);

  const readouts = document.createElement('div');
  readouts.className = 'ranking-you-readouts';
  const rank = readoutPair(copy.colRank);
  const strokes = readoutPair(copy.colStrokes);
  readouts.append(rank.element, strokes.element);

  element.append(head, readouts);

  const set = (rankText: string, strokesText: string): void => {
    rank.value.textContent = rankText;
    strokes.value.textContent = strokesText;
  };

  return {
    element,
    pending: () => set('…', '…'),
    failed: () => set('--', '--'),
    show: (board) => {
      // 板に載っていないのに自己ベストがある＝段2の検証待ち
      const checking = board.yourRank === null && board.yourBest !== null;
      set(
        board.yourRank === null
          ? checking
            ? copy.rankingChecking
            : '--'
          : `${i18n.rankLabel(board.yourRank, board.yourTied)} / ${i18n.playerCountLabel(board.playerCount)}`,
        board.yourBest
          ? `${i18n.rankingStrokes(board.yourBest.strokes, board.yourBest.gaveUp)} (${i18n.formatDiff(board.yourBest.toPar)})`
          : '--',
      );
    },
  };
}

/** 見出しを沈めて値を明るく出す1組。HUDと同じ組み方 */
function readoutPair(label: string): { element: HTMLElement; value: HTMLElement } {
  const element = document.createElement('span');
  element.className = 'ranking-readout';

  const labelNode = document.createElement('span');
  labelNode.className = 'ranking-readout-label';
  labelNode.textContent = label;

  const value = document.createElement('span');
  value.className = 'ranking-readout-value';

  element.append(labelNode, value);
  return { element, value };
}

/**
 * 何を預かるかの一行（`docs/ranking.md` §5-3）。
 * **消し方のすぐ上に置く。** 預ける話と消す話を同じ場所で読めるようにするため。
 * 詳しい条文はハブのプライバシーポリシー（`hanage.app/privacy/`）に置く
 */
function dataNotice(): HTMLElement {
  const copy = t();
  const box = document.createElement('div');
  box.className = 'ranking-privacy';

  const note = document.createElement('p');
  note.className = 'name-note';
  note.textContent = copy.dataNote;

  box.append(note, externalMenuLink(copy.privacy, hubUrl(PRIVACY_PATH)));
  return box;
}

/**
 * 記録の削除（`docs/ranking.md` §5-3）。**消し方が無い状態で公開しない。**
 * めったに押さないので画面の一番下に文字だけで置き、押されたその場で確かめる
 */
function deleteRecordsLink(): HTMLElement {
  const copy = t();
  const box = document.createElement('div');
  box.className = 'ranking-danger';

  const note = document.createElement('div');
  note.className = 'name-note';
  note.hidden = true;
  note.textContent = copy.dataDeleteNote;

  const actions = document.createElement('div');
  actions.className = 'ranking-danger-actions';

  const start = document.createElement('button');
  start.type = 'button';
  start.className = 'menu-text-link';
  start.textContent = copy.dataDelete;

  const reset = (): void => {
    note.hidden = true;
    actions.classList.remove('two');
    actions.replaceChildren(start);
  };

  start.addEventListener('click', () => {
    note.hidden = false;
    actions.classList.add('two');

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'ranking-button';
    cancel.textContent = copy.dataDeleteCancel;
    cancel.addEventListener('click', reset);

    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'ranking-button primary';
    confirm.textContent = copy.dataDeleteConfirm;
    confirm.addEventListener('click', () => {
      void deletePlayer(readOrCreateIdentity()).then(
        () => {
          reset();
          note.hidden = false;
          note.textContent = copy.dataDeleted;
        },
        () => {
          reset();
          note.hidden = false;
          note.textContent = copy.dataDeleteFailed;
        },
      );
    });

    actions.replaceChildren(cancel, confirm);
  });

  actions.append(start);
  box.append(note, actions);
  return box;
}

/**
 * 画面の頭（戻るボタンと見出し）。
 * **戻る先はその画面の1つ手前**なので、文言も呼ぶ側が決める（既定はトップ）
 */
function menuHeading(title: string, back: () => void, backLabel?: string): HTMLElement {
  const heading = document.createElement('div');
  heading.className = 'menu-heading';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'menu-back';
  button.textContent = backLabel ?? t().backToMenu;
  button.addEventListener('click', back);

  const label = document.createElement('h1');
  label.className = 'course-title';
  label.textContent = title;

  heading.append(button, label);
  return heading;
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
  const copy = t();

  // 4本を一覧で見せる画面。**スクロールさせない**（下へ送ると「← トップ」が画面から消えて、
  // 戻れないように見える）。そのぶん余白を詰めた putter-panel を使う
  const panel = document.createElement('main');
  panel.className = 'menu-panel course-panel putter-panel';

  const heading = document.createElement('div');
  heading.className = 'menu-heading';

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'menu-back';
  back.textContent = copy.backToMenu;
  back.addEventListener('click', renderTopMenu);

  const title = document.createElement('h1');
  title.className = 'course-title';
  title.textContent = copy.putter;

  heading.append(back, title);

  const list = document.createElement('div');
  list.className = 'course-list';
  const selected = loadPutterShape();
  for (const id of PUTTER_SHAPE_IDS) list.append(putterEntry(id, selected));

  panel.append(heading, list);
  root.append(panel);
}

/** パター1本ぶんの枠。見本・名前と、選ぶボタンを1行に置く */
function putterEntry(id: PutterShapeId, selected: PutterShapeId): HTMLElement {
  const copy = t();
  const card = document.createElement('div');
  card.className = 'course-card putter-card';

  const name = document.createElement('div');
  name.className = 'course-name putter-name';
  name.textContent = copy.putterShapes[id];

  const action = document.createElement('div');
  action.className = 'putter-action';

  if (id === selected) {
    const current = document.createElement('span');
    current.className = 'course-best';
    current.textContent = copy.putterSelected;
    action.append(current);
  } else {
    action.append(
      // 名前と横に並ぶので、狭い端末で名前が折り返さない短い言葉にする
      courseAction(copy.putterSelect, false, () => {
        savePutterShape(id);
        renderPutterSelection();
      }),
    );
  }

  card.append(putterPreview(id), name, action);
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
  const preview = CONFIG.game.stroke.putterPreview;
  const { scale, width: w, height: h } = preview;

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
  // シャフトは根元だけ見せて枠の外へ逃がす。全部入れると枠が縦に伸びて一覧が画面に収まらない
  const bounds = putterHeadBounds(id, preview.shaftVisiblePx);
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
  name.textContent = tour.name[language()];

  // **説明は出さない。** 実機で「コース選択の説明はなしでいい」と出た。
  // 名前と自己ベストだけのほうが、4枠が縦に並んだときに読み比べやすい
  card.append(name);

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
  // **続きが無いときは「スタート」。** 「はじめから」は「HOLE nから再開」と
  // 並んで初めて意味が通る言い方なので、並ばないときは使わない
  const restart = courseAction(resume ? t().startOver : t().start, !resume, () => {
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
  return i18n.bestLabel(score.strokes, i18n.formatDiff(score.strokes - score.par));
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

  return i18n.resumeLabel(round.holeNumber);
}

function menuButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'menu-button';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

/**
 * ハブ（hanage.app）のページURL。**言語からパスを組み立てるのはここだけ。**
 * 日本語は接頭辞なし、英語は `/en/` 配下。ハブ側の `src/lib/i18n.ts` の規則に合わせる。
 * 言語を切り替えると画面ごと描き直すので、リンクもそのたびに作り直される
 */
function hubUrl(path: string): string {
  return `${HUB_ORIGIN}${language() === 'en' ? '/en' : ''}${path}`;
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

/**
 * 日本語 / EN の切り替え。押すとその場で保存し、今の画面を描き直す。
 * **ゲーム画面には置かない**（プレイ中の一手間を増やさない）。
 * 英語表示では仮名と漢字のフォントを読み込まないので、切り替えでフォントも入れ直す
 */
function languageToggle(rerender: () => void): HTMLElement {
  const copy = t();
  const nav = document.createElement('nav');
  nav.className = 'language-toggle';
  nav.setAttribute('aria-label', copy.language);

  const option = (value: i18n.Language, label: string): HTMLButtonElement => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = language() === value ? 'language-button selected' : 'language-button';
    button.textContent = label;
    button.setAttribute('aria-pressed', String(language() === value));
    button.addEventListener('click', () => {
      if (language() === value) return;
      setLanguage(value);
      ensurePixelFont(value);
      applyStaticUiText();
      rerender();
    });
    return button;
  };

  nav.append(option('ja', copy.japanese), option('en', copy.english));
  return nav;
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
  // 画面ごとの指定は毎回落とす。コース一覧だけが `tour-scroll` を足す
  root.classList.remove('tour-scroll');
  return root;
}

function ensureBestScoreStyles(): void {
  if (document.getElementById('best-score-styles')) return;
  const style = document.createElement('style');
  style.id = 'best-score-styles';
  style.textContent = `
    /*
     * **id セレクタで display を指定すると hidden 属性が効かなくなる。**
     * ここを閉じておかないと、中身が空の黄色い箱がカードに残り、
     * 一度ラウンド終了で出したベストがホール間のカードにも出続ける
     */
    #tour-best-result[hidden] {
      display: none;
    }
    #tour-best-result {
      display: inline-block;
      margin: 12px 0 0;
      border: 2px solid #0d140d;
      background: #ffe66d;
      padding: 4px 8px;
      font-size: 16px;
      color: #16210f;
    }
    /*
     * 登録の結果（「T12 / 340人」など）。**BESTの下に1行。**
     * ベストの黄色い札と違って、押せないただの知らせなので枠は付けない
     */
    #ranking-result[hidden] {
      display: none;
    }
    #ranking-result {
      display: block;
      margin: 8px 0 0;
      font-size: 16px;
      color: #9ede8a;
    }
  `;
  document.head.append(style);
}


/**
 * メニューの見た目はプレイ画面のドット感（config.pixel）に合わせる。
 * 角丸・ぼかし影・アンチエイリアスの効いた装飾は使わず、
 * ドット絵フォント・太い枠・段差のはっきりした影・コースと同じ色だけで作る。
 * 色は config のコース色に対応させている（fairway 0x74cf5c / rough 0x4f9844 /
 * deepRough 0x3a7332 / bunker 0xd8c48a / ob 0x27431f / flag 0xd94f3d / trail 0xffe66d / ball 0xf6f8f4）。
 */
function ensureMenuStyles(): void {
  ensurePixelFont(language());
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
    .course-list {
      display: grid;
      gap: 14px;
      margin-top: 28px;
    }
    .menu-actions {
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
    /*
     * 遊び始めるボタンではないもの（パター）は、同じ形のまま色だけ落とす。
     * ベベルと大きさは揃えたままにして、押せることは分かるようにする
     */
    .menu-button-sub {
      /* 遊ぶ2つと続けて並ぶので、間を少し空けて区切りを作る */
      margin-top: 6px;
      background: #27431f;
      color: #bcd0c0;
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
      /*
       * 高さを揃えない。英語は行数が項目ごとに変わるので、
       * 揃えると1行の項目だけ下線が段違いに落ちる
       */
      align-items: flex-start;
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
    /* 言語の切り替え。押すところは他のボタンと同じベベルで作る */
    .language-toggle {
      display: flex;
      justify-content: center;
      gap: 8px;
      margin-top: 26px;
    }
    .language-button {
      appearance: none;
      min-height: 44px;
      border-style: solid;
      border-width: 3px;
      border-color: #9ede8a #1b3318 #1b3318 #9ede8a;
      border-radius: 0;
      background: #27431f;
      box-shadow: 0 4px 0 #0d140d;
      padding: 10px 16px;
      font: inherit;
      font-size: 16px;
      line-height: 1;
      color: #bcd0c0;
      touch-action: manipulation;
      cursor: pointer;
    }
    /* 今の言語は反転して見せる。視点バーの選択中と同じ約束 */
    .language-button.selected {
      background: #eef7ec;
      border-color: #ffffff #4f9844 #4f9844 #ffffff;
      color: #16210f;
    }
    .language-button:active {
      transform: translateY(4px);
      border-color: #1b3318 #9ede8a #9ede8a #1b3318;
      box-shadow: none;
    }
    .language-button:focus-visible {
      outline: 3px solid #ffe66d;
      outline-offset: 2px;
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
    /*
     * コース一覧。**4コースはどの端末でも1画面に収まらない**（390x844 で 1008px）。
     * 1枚は「名前・説明・44pxのボタン」なので、これ以上は詰められない。
     *
     * 収めるのを諦めるかわりに、**「← トップ」を上へ貼り付けて画面から消さない**。
     * スクロールで戻る道が消えたように見えるのがいちばん困る（パター選択と同じ理由）。
     * 貼り付けた帯は下をくぐるカードが透けないよう、枠と同じ色で塗って境目を引く
     */
    /*
     * 上余白はスクロール領域（#menu-root）ではなくパネルの外側マージンへ移す。
     * 領域側に padding があると、貼り付けた見出しはその内側で止まり、
     * **上の24pxをカードが素通りして見える**
     */
    #menu-root.tour-scroll {
      padding-top: 0;
    }
    #menu-root.tour-scroll .menu-panel {
      margin-top: max(24px, env(safe-area-inset-top));
    }
    .tour-panel .menu-heading {
      position: sticky;
      top: 0;
      z-index: 1;
      gap: 12px;
      background: #0f170f;
      border-bottom: 3px solid #1b3318;
      margin: -22px -16px 0;
      padding: 22px 16px 12px;
    }
    .tour-panel .course-title {
      font-size: 24px;
    }
    .tour-panel .course-list {
      gap: 10px;
      margin-top: 14px;
    }
    /* パター選択 */
    /*
     * 4本を1画面に収める。スクロールさせると「← トップ」が上へ消えて、
     * 戻る道が無くなったように見える。そのために余白を詰める
     */
    .putter-panel {
      padding: 14px 12px 16px;
    }
    .putter-panel .menu-heading {
      gap: 12px;
    }
    .putter-panel .course-title {
      font-size: 24px;
    }
    .putter-panel .course-list {
      gap: 10px;
      margin-top: 14px;
    }
    /* パター1本は「見本・名前・ボタン」の1行。説明は付けず、違いは見本で見せる */
    .putter-card {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 10px;
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
