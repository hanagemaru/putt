from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected 1 match, found {count}: {old[:80]!r}")
    file.write_text(text.replace(old, new, 1), encoding="utf-8")


# src/entry.ts: allow an internal URL to open the tour selection directly.
replace_once(
    "src/entry.ts",
    """if (shouldStartGameDirectly(params)) {
  void import('./main');
} else {
  renderTopMenu();
}
""",
    """if (shouldStartGameDirectly(params)) {
  void import('./main');
} else if (params.get('menu') === 'tour') {
  renderTourSelection();
} else {
  renderTopMenu();
}
""",
)

replace_once(
    "src/entry.ts",
    """    body.menu-active #stroke-camera-controls,
    body.menu-active #score-overlay {
""",
    """    body.menu-active #stroke-camera-controls,
    body.menu-active #score-overlay,
    body.menu-active #home-control,
    body.menu-active #home-dialog {
""",
)

# src/main.ts: add an explicit practice-end state and pause flag for the confirmation overlay.
replace_once(
    "src/main.ts",
    """/**
 * HOLE_OUT / ROUND_END はスコアを見せるだけの状態（spec §6）。
 * カメラは RESULT の俯瞰のまま止め、DOM のカードを重ねる
 */
type State =
  | 'ADDRESS'
  | 'STROKE'
  | 'FOLLOW'
  | 'CUP'
  | 'RESULT'
  | 'HOLE_OUT'
  | 'ROUND_END';
""",
    """/**
 * HOLE_OUT / ROUND_END / PRACTICE_END は結果を見せるだけの状態（spec §6）。
 * カメラは RESULT の俯瞰のまま止め、DOM のカードを重ねる
 */
type State =
  | 'ADDRESS'
  | 'STROKE'
  | 'FOLLOW'
  | 'CUP'
  | 'RESULT'
  | 'HOLE_OUT'
  | 'ROUND_END'
  | 'PRACTICE_END';
""",
)

replace_once(
    "src/main.ts",
    """let lastSwing = '';

/** FOLLOW のヨー・ピッチ。カメラは平行移動しない（§3） */
""",
    """let lastSwing = '';
/** トップへ戻る確認を出している間は、物理・カメラ遷移・入力状態を止める */
let navigationPaused = false;

/** FOLLOW のヨー・ピッチ。カメラは平行移動しない（§3） */
""",
)

replace_once(
    "src/main.ts",
    """  return (state === 'RESULT' || state === 'HOLE_OUT') && resultReady && trailPointCount > 1;
""",
    """  return (
    (state === 'RESULT' || state === 'HOLE_OUT' || state === 'PRACTICE_END') &&
    resultReady &&
    trailPointCount > 1
  );
""",
)

replace_once(
    "src/main.ts",
    """/** RESULT でタップされた。次のパットへ */
function nextPutt(): void {
  if (holeFinished()) {
    // ツアーはホールアウトでカードへ移るので、ここへ来るのは練習モードだけ。
    // 同じグリーン・同じカップでティーから打ち直す
    ball.set(course.tee.x, course.tee.z);
    shots = 0;
    lastResult = '';
  } else if (roller.status === 'water' || roller.status === 'outOfBounds') {
    // 打つ前の位置へ戻す。打数はそのまま
    ball.copy(shotStart);
  }
  roller.place(ball.x, ball.y);
  updateBallMesh();
  enterAddress();
}
""",
    """/** RESULT でタップされた。ホールが続いている場合だけ次のパットへ */
function nextPutt(): void {
  if (roller.status === 'water' || roller.status === 'outOfBounds') {
    // 打つ前の位置へ戻す。打数はそのまま
    ball.copy(shotStart);
  }
  roller.place(ball.x, ball.y);
  updateBallMesh();
  enterAddress();
}
""",
)

replace_once(
    "src/main.ts",
    """/** ツアーで、この RESULT のあとホールアウトのカードへ移る場面か */
function holeOutPending(): boolean {
  return round !== null && holeFinished();
}

/** ホールアウト（spec §6）。俯瞰と軌跡を残したままスコアカードを重ねる */
""",
    """/** ツアーで、この RESULT のあとホールアウトのカードへ移る場面か */
function holeOutPending(): boolean {
  return round !== null && holeFinished();
}

/** 練習で、この RESULT のあと終了カードへ移る場面か */
function practiceEndPending(): boolean {
  return round === null && holeFinished();
}

/** ホールアウト（spec §6）。俯瞰と軌跡を残したままスコアカードを重ねる */
""",
)

replace_once(
    "src/main.ts",
    """/** ラウンド終了（spec §6）。全ホールの一覧と合計を出す。次はボタンで進む */
function enterRoundEnd(): void {
  if (!round) return;
  state = 'ROUND_END';
  // 終わったラウンドを再開してしまわないように片付ける
  roundStore?.clear();
  notice = '';
  showRoundEndCard(round);
}

/** 同じ9ホールを最初からやり直す */
""",
    """/** ラウンド終了（spec §6）。全ホールの一覧と合計を出す。次はボタンで進む */
function enterRoundEnd(): void {
  if (!round) return;
  state = 'ROUND_END';
  // 終わったラウンドを再開してしまわないように片付ける
  roundStore?.clear();
  notice = '';
  showRoundEndCard(round);
}

/** 練習のカップイン後。結果を残したまま、打ち直すかトップへ戻るかを選ぶ */
function enterPracticeEnd(): void {
  if (round || !holeFinished()) return;
  state = 'PRACTICE_END';
  notice = '';
  showPracticeEndCard();
}

/** 同じ9ホールを最初からやり直す */
""",
)

replace_once(
    "src/main.ts",
    """renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  const transitioning = rig.update(dt);
""",
    """renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  if (navigationPaused) {
    updateHud();
    renderFrame();
    updateSmoothLines();
    return;
  }

  const transitioning = rig.update(dt);
""",
)

replace_once(
    "src/main.ts",
    """          // ツアーのホールアウトはカードへ移るので、次の一打の案内は出さない
          notice = holeOutPending() ? '' : 'タップで次の一打';
        }
      } else if (holeOutPending()) {
        // 最後の一打の軌跡を見せてからカードを重ねる
        cardElapsed += dt;
        if (cardElapsed >= G.round.cardDelay) enterHoleOut();
      }
      break;

    case 'HOLE_OUT':
    case 'ROUND_END':
""",
    """          // カップイン後は終了カードへ移るので、次の一打の案内は出さない
          notice = holeOutPending() || practiceEndPending() ? '' : 'タップで次の一打';
        }
      } else if (holeOutPending() || practiceEndPending()) {
        // 最後の一打の軌跡を見せてからカードを重ねる
        cardElapsed += dt;
        if (cardElapsed >= G.round.cardDelay) {
          if (holeOutPending()) enterHoleOut();
          else enterPracticeEnd();
        }
      }
      break;

    case 'HOLE_OUT':
    case 'ROUND_END':
    case 'PRACTICE_END':
""",
)

replace_once(
    "src/main.ts",
    """    if (holeOutPending()) enterHoleOut();
    else nextPutt();
    return;
""",
    """    if (holeOutPending()) enterHoleOut();
    else if (practiceEndPending()) enterPracticeEnd();
    else nextPutt();
    return;
""",
)

# Navigation UI wiring goes next to the existing screen-control DOM wiring.
replace_once(
    "src/main.ts",
    """const strokeCameraControls = document.getElementById('stroke-camera-controls')!;
const strokeCupCheck = document.getElementById('stroke-cup-check') as HTMLButtonElement;

/**
 * スコア表示（spec §6）。ホール間は俯瞰と軌跡の上にカードを重ね、
""",
    """const strokeCameraControls = document.getElementById('stroke-camera-controls')!;
const strokeCupCheck = document.getElementById('stroke-cup-check') as HTMLButtonElement;

const homeControl = document.getElementById('home-control') as HTMLDivElement;
const homeButton = document.getElementById('home-button') as HTMLButtonElement;
const homeDialog = document.getElementById('home-dialog') as HTMLDivElement;
const homeDialogMessage = document.getElementById('home-dialog-message')!;
const homeCancel = document.getElementById('home-cancel') as HTMLButtonElement;
const homeConfirm = document.getElementById('home-confirm') as HTMLButtonElement;

homeControl.style.display = 'block';
homeButton.addEventListener('click', openHomeDialog);
homeCancel.addEventListener('click', closeHomeDialog);
homeConfirm.addEventListener('click', () => navigateToMenu());
homeDialog.addEventListener('click', (event) => {
  if (event.target === homeDialog) closeHomeDialog();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && navigationPaused) closeHomeDialog();
});

function navigateToMenu(target?: 'tour'): void {
  const url = new URL(location.href);
  const search = new URLSearchParams();
  if (target === 'tour') search.set('menu', 'tour');
  url.search = search.toString();
  url.hash = '';
  location.assign(url.toString());
}

function openHomeDialog(): void {
  if (navigationPaused) return;
  if (state === 'ROUND_END' || state === 'PRACTICE_END') {
    navigateToMenu();
    return;
  }

  if (mode === 'tour') {
    homeDialogMessage.textContent =
      state === 'HOLE_OUT'
        ? 'トップへ戻りますか？ ここまでの進行は保存されています。'
        : 'トップへ戻りますか？ このホールの途中経過は保存されません。次回はこのホールの最初から再開します。';
  } else {
    homeDialogMessage.textContent =
      'トップへ戻りますか？ 練習中の打数やボール位置は保存されません。';
  }

  navigationPaused = true;
  homeDialog.hidden = false;
  homeCancel.focus({ preventScroll: true });
}

function closeHomeDialog(): void {
  if (!navigationPaused) return;
  homeDialog.hidden = true;
  navigationPaused = false;
  lastTime = performance.now();
  homeButton.focus({ preventScroll: true });
}

/**
 * スコア表示（spec §6）。ホール間は俯瞰と軌跡の上にカードを重ね、
""",
)

replace_once(
    "src/main.ts",
    """const scoreRows = document.getElementById('score-rows')!;
const scoreHint = document.getElementById('score-hint') as HTMLDivElement;
const scoreAgain = document.getElementById('score-again') as HTMLButtonElement;

scoreAgain.addEventListener('click', restartRound);

function hideScoreOverlay(): void {
  scoreOverlay.hidden = true;
}
""",
    """const scoreRows = document.getElementById('score-rows')!;
const scoreHint = document.getElementById('score-hint') as HTMLDivElement;
const scoreActions = document.getElementById('score-actions') as HTMLDivElement;
const scoreCourse = document.getElementById('score-course') as HTMLButtonElement;
const scoreAgain = document.getElementById('score-again') as HTMLButtonElement;
const scoreHome = document.getElementById('score-home') as HTMLButtonElement;

scoreCourse.addEventListener('click', () => navigateToMenu('tour'));
scoreAgain.addEventListener('click', () => {
  if (state === 'ROUND_END') restartRound();
  else if (state === 'PRACTICE_END') {
    hideScoreOverlay();
    restartPracticeHole();
  }
});
scoreHome.addEventListener('click', () => navigateToMenu());

function hideScoreOverlay(): void {
  scoreOverlay.hidden = true;
  scoreActions.hidden = true;
}
""",
)

replace_once(
    "src/main.ts",
    """  scoreHint.hidden = false;
  scoreHint.textContent = current.hasNext ? 'タップで次のホールへ' : 'タップで結果へ';
  scoreAgain.hidden = true;
  scoreOverlay.hidden = false;
}
""",
    """  scoreHint.hidden = false;
  scoreHint.textContent = current.hasNext ? 'タップで次のホールへ' : 'タップで結果へ';
  scoreActions.hidden = true;
  scoreOverlay.hidden = false;
}
""",
)

replace_once(
    "src/main.ts",
    """  scoreTable.hidden = false;
  scoreHint.hidden = true;
  scoreAgain.hidden = false;
  scoreOverlay.hidden = false;
}

function scoreCell(tag: 'td' | 'th', text: string, className = ''): HTMLTableCellElement {
""",
    """  scoreTable.hidden = false;
  scoreHint.hidden = true;
  scoreCourse.hidden = false;
  scoreAgain.hidden = false;
  scoreHome.hidden = false;
  scoreActions.hidden = false;
  scoreOverlay.hidden = false;
}

/** 練習のカップイン後。結果と、打ち直すかトップへ戻るかの選択を出す */
function showPracticeEndCard(): void {
  scoreTitle.textContent = '練習終了';
  scoreHeadline.textContent = strokesHeadline(shots, course.par);
  scoreSub.textContent = `PAR ${course.par}`;
  scoreTable.hidden = true;
  scoreRows.replaceChildren();
  scoreHint.hidden = true;
  scoreCourse.hidden = true;
  scoreAgain.hidden = false;
  scoreHome.hidden = false;
  scoreActions.hidden = false;
  scoreOverlay.hidden = false;
}

function scoreCell(tag: 'td' | 'th', text: string, className = ''): HTMLTableCellElement {
""",
)

# index.html: gameplay home button, confirmation overlay, and end-screen actions.
replace_once(
    "index.html",
    """      #debug-controls[hidden] {
        display: none;
      }

      /*
       * スコア表示（spec §6）。ホール間はRESULTの俯瞰と軌跡を背景に残したままカードを重ね、
""",
    """      #debug-controls[hidden] {
        display: none;
      }

      /* プレイ中の出口。誤タップで離脱しないよう、押した後に確認画面を挟む */
      #home-control {
        position: fixed;
        top: max(10px, env(safe-area-inset-top));
        right: max(10px, env(safe-area-inset-right));
        z-index: 34;
        display: none;
        font-family: system-ui, -apple-system, sans-serif;
      }
      #home-button {
        appearance: none;
        min-width: 62px;
        min-height: 44px;
        border: 1px solid rgba(232, 240, 232, 0.55);
        border-radius: 999px;
        background: rgba(12, 20, 14, 0.78);
        color: #e8f0e8;
        padding: 8px 13px;
        font: inherit;
        font-size: 12px;
        font-weight: 700;
        touch-action: manipulation;
      }
      #home-dialog {
        position: fixed;
        inset: 0;
        z-index: 80;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        background: rgba(0, 0, 0, 0.58);
        font-family: system-ui, -apple-system, sans-serif;
        color: #e8f0e8;
        touch-action: manipulation;
      }
      #home-dialog[hidden] {
        display: none;
      }
      #home-dialog-card {
        width: min(320px, calc(100vw - 40px));
        padding: 20px;
        border: 1px solid rgba(232, 240, 232, 0.55);
        border-radius: 16px;
        background: rgba(12, 20, 14, 0.96);
        text-align: center;
      }
      #home-dialog-title {
        font-size: 18px;
        font-weight: 700;
      }
      #home-dialog-message {
        margin-top: 10px;
        color: #cfe0d2;
        font-size: 13px;
        line-height: 1.55;
      }
      #home-dialog-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        margin-top: 18px;
      }
      .home-dialog-button {
        appearance: none;
        min-height: 44px;
        border: 1px solid rgba(232, 240, 232, 0.55);
        border-radius: 999px;
        background: rgba(30, 45, 33, 0.92);
        color: #e8f0e8;
        padding: 9px 12px;
        font: inherit;
        font-size: 13px;
        font-weight: 700;
        touch-action: manipulation;
      }
      #home-confirm {
        background: rgba(232, 240, 232, 0.92);
        color: #162018;
      }

      /*
       * スコア表示（spec §6）。ホール間はRESULTの俯瞰と軌跡を背景に残したままカードを重ね、
""",
)

replace_once(
    "index.html",
    """      #score-again {
        margin-top: 14px;
        pointer-events: auto;
        appearance: none;
        border: 1px solid rgba(232, 240, 232, 0.55);
        border-radius: 999px;
        background: rgba(232, 240, 232, 0.92);
        color: #162018;
        min-height: 40px;
        padding: 8px 22px;
        font: inherit;
        font-size: 13px;
        font-weight: 700;
        touch-action: manipulation;
      }
      #score-again[hidden] {
        display: none;
      }
""",
    """      #score-actions {
        display: grid;
        gap: 8px;
        margin-top: 14px;
        pointer-events: auto;
      }
      #score-actions[hidden],
      .score-action[hidden] {
        display: none;
      }
      .score-action {
        appearance: none;
        border: 1px solid rgba(232, 240, 232, 0.55);
        border-radius: 999px;
        background: rgba(30, 45, 33, 0.92);
        color: #e8f0e8;
        min-height: 44px;
        padding: 9px 18px;
        font: inherit;
        font-size: 13px;
        font-weight: 700;
        touch-action: manipulation;
      }
      #score-course,
      #score-again {
        background: rgba(232, 240, 232, 0.92);
        color: #162018;
      }
""",
)

replace_once(
    "index.html",
    """    <div id="tuning-panel" hidden>
""",
    """    <div id="home-control">
      <button type="button" id="home-button" aria-label="トップへ戻る">トップ</button>
    </div>

    <div id="tuning-panel" hidden>
""",
)

replace_once(
    "index.html",
    """        <div id="score-hint"></div>
        <button type="button" id="score-again" hidden>もう一度</button>
      </div>
    </div>

    <div id="rotate-overlay">
""",
    """        <div id="score-hint"></div>
        <div id="score-actions" hidden>
          <button type="button" class="score-action" id="score-course">コース選択へ</button>
          <button type="button" class="score-action" id="score-again">もう一度</button>
          <button type="button" class="score-action" id="score-home">トップへ</button>
        </div>
      </div>
    </div>

    <div
      id="home-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="home-dialog-title"
      hidden
    >
      <div id="home-dialog-card">
        <div id="home-dialog-title">トップへ戻りますか？</div>
        <div id="home-dialog-message"></div>
        <div id="home-dialog-actions">
          <button type="button" class="home-dialog-button" id="home-cancel">ゲームを続ける</button>
          <button type="button" class="home-dialog-button" id="home-confirm">トップへ戻る</button>
        </div>
      </div>
    </div>

    <div id="rotate-overlay">
""",
)

# PROJECT_STATUS.md
replace_once(
    "PROJECT_STATUS.md",
    "最終更新: 2026-09-05（**トップメニューと通常ツアー選択を実装。実機確認待ち**）",
    "最終更新: 2026-09-05（**トップメニューとゲーム内の戻り動線を実装。実機確認待ち**）",
)
replace_once(
    "PROJECT_STATUS.md",
    """  - ゲーム中からメニューへ戻る操作、途中ラウンド破棄、ランキング、広告は未実装
""",
    """  - プレイ中は右上の「トップ」から確認画面を経て戻れる。通常ツアー途中では現在ホールの途中経過が保存されないことを明示する
  - 通常ツアー終了は「コース選択へ / もう一度 / トップへ」、練習カップイン後は「もう一度 / トップへ」を表示する
  - 途中ラウンド破棄、ランキング、広告は未実装
""",
)

# RELEASE_PLAN.md
replace_once(
    "RELEASE_PLAN.md",
    "| モード選択・広告・遷移 | 進行中 | トップメニュー、通常ツアー3コース選択、練習入口を実装。週替わりは準備中表示。途中切替、広告、週替わり接続が残る | 仕様の主要遷移を実機で一巡できる | 週替わり接続とランキングの画面・状態が確定 |",
    "| モード選択・広告・遷移 | 進行中 | トップメニュー、通常ツアー3コース選択、練習入口、プレイ中の確認付きトップ復帰、ツアー/練習終了後の戻り動線を実装。週替わりは準備中表示。別ゲームへの途中切替、広告、週替わり接続が残る | 仕様の主要遷移を実機で一巡できる | 週替わり接続とランキングの画面・状態が確定 |",
)
replace_once(
    "RELEASE_PLAN.md",
    """トップメニューと通常ツアー／練習の入口は先行実装済み。週替わりチャレンジは「準備中」として表示し、
プレイ画面への接続、ゲーム中からメニューへ戻る操作、広告、ランキング統合は後続タスクで扱う。
""",
    """トップメニューと通常ツアー／練習の入口、ゲーム中の確認付きトップ復帰、ツアー／練習終了後の戻り動線は実装済み。
週替わりチャレンジは「準備中」として表示し、プレイ画面への接続、別ゲームへの途中切替、広告、ランキング統合は後続タスクで扱う。
""",
)

# TASKS.md
replace_once(
    "TASKS.md",
    """- ゲーム中からメニューへ戻る、途中ラウンド破棄、週替わり接続、ランキング、広告は後続タスク

---

## ゲーム全体の仕様検討
""",
    """- ゲーム中〜終了後の戻り動線は T10.1 で実装。途中ラウンド破棄、週替わり接続、ランキング、広告は後続タスク

---

## T10.1. プレイ中と終了後のメニュー動線

**実装済み・実機確認待ち。**

- プレイ中は右上に44px以上の「トップ」ボタンを常設する
- 誤タップ一発で離脱しないよう、押すと確認画面を出してゲーム進行を一時停止する
  - 通常ツアー途中では、現在ホールのボール位置・打数は保存されず、そのホールの頭から再開することを明示する
  - HOLE_OUTでは、そこまでの進行が保存済みであることを明示する
  - 練習では打数・ボール位置を保存しないことを明示する
- 通常ツアーのROUND_ENDは「コース選択へ / もう一度 / トップへ」の3択
  - `?menu=tour` を内部遷移専用として使い、公開パスを保ったままコース選択へ直接戻す
- 練習はカップイン後にPRACTICE_ENDを挟み、「もう一度 / トップへ」の2択にする
  - ギブアップは従来どおり、その場で同じホールを打ち直す
- 広告、別ゲーム開始前の途中ラウンド破棄、週替わりチャレンジ接続はこのタスクに含めない

---

## ゲーム全体の仕様検討
""",
)

# docs/spec.md
replace_once(
    "docs/spec.md",
    """- 画面遷移用URLは `URL` / `URLSearchParams` で組み立て、GitHub Pages の `/putt/` 配下を維持する
- 今回は途中ラウンド削除・最初からやり直す操作、ゲーム中からメニューへ戻る操作、週替わり接続、ランキング、広告を含めない
""",
    """- 画面遷移用URLは `URL` / `URLSearchParams` で組み立て、GitHub Pages の `/putt/` 配下を維持する
- プレイ中は右上に「トップ」を置く。誤タップ一発で離脱しないよう、必ず確認画面を挟む
  - 確認中は物理・カメラ遷移・ゲーム入力を止める
  - 通常ツアーの進行中は、現在ホールの途中経過（ボール位置・打数・狙い）は保存されず、そのホールの頭から再開することを明示する
  - HOLE_OUTでは、そこまでの進行が保存済みであることを明示する
  - 練習では進行を保存しないことを明示する
- 通常ツアーの9ホール終了後は「コース選択へ / もう一度 / トップへ」を表示する
  - コース選択へ戻す内部遷移には `?menu=tour` を使う。これはゲームを直接開始するURLではない
- 練習のカップイン後は「もう一度 / トップへ」を表示する。誤タップで自動的に次の練習を始めない
- 途中ラウンド削除、別ゲーム開始前の切替、週替わり接続、ランキング、広告はこの変更に含めない
""",
)
replace_once(
    "docs/spec.md",
    """- **同じホールを打ち直せる。** カップインしてもギブアップしてもティーへ戻るだけで、ホールを進めない
  - 練習でのギブアップは打ち直しの入口を兼ねる。スコアは記録しない（ランキング対象外）
""",
    """- **同じホールを打ち直せる。** ホールは進めない
  - カップイン後は結果カードを出し、「もう一度」でティーへ戻る。「トップへ」でトップメニューへ戻る
  - 練習でのギブアップは従来どおり即座に打ち直す入口を兼ねる。スコアは記録しない（ランキング対象外）
""",
)

print("navigation exits implementation applied")
