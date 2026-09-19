// 日本語／英語の表示文言（Multicolor Sweeper の src/i18n.ts と同じ方針）。
//
// - 言語は「?lang= → localStorage → navigator.languages → en」の順で決める
// - 文言は COPY の1オブジェクトにまとめ、数値が混じる行だけ関数にする
// - **数字の並び（打数・パー差・距離・角度）は言語で変えない。** 変えるのは前後の語だけ
// - 開発用表示（?debug=1 のシード・ドット・ライン・地形）は日本語のままにする

export type Language = 'ja' | 'en';

export const LANGUAGE_STORAGE_KEY = 'putt-language';

/** ?lang= で入口だけ上書きできる。遷移では持ち回らず、読んだ時点で保存へ移す */
export const LANGUAGE_QUERY_KEY = 'lang';

const COPY = {
  ja: {
    // --- メニュー（entry.ts） ---
    menuSubtitle: 'モードを選んでください',
    modeTour: '通常ツアー',
    modePractice: '練習',
    guideLabel: '案内',
    howTo: '遊び方',
    privacy: 'プライバシー',
    language: '言語',
    japanese: '日本語',
    english: 'EN',
    backToMenu: '← トップ',
    tourTitle: '通常ツアー',
    /**
     * コース選択の開始ボタン。**続きが無いときはこれだけが出る。**
     * 「HOLE 1から」は「HOLE nから再開」と並んだときにしか意味が通らない、と実機で出た
     */
    start: 'スタート',
    /** 続きがあるときの開始ボタン。「HOLE nから再開」と並ぶので、対になる言い方にする */
    startOver: 'はじめから',
    /** パター選択（§4.4）。形の名前は日本のゴルフでの呼び方に合わせる */
    putter: 'パター',
    /** トップのボタン。「パター」だけでは何をする所か分からないので動詞まで書く */
    putterChoose: 'パターを選ぶ',
    putterSelect: '選ぶ',
    putterSelected: '選択中',
    putterShapes: {
      pin: 'ピン型',
      blade: 'L字',
      mallet: 'マレット',
      fang: 'ネオマレット',
    },

    // --- 画面共通（index.html） ---
    top: 'トップ',
    backToTop: 'トップへ戻る',
    cameraViewLabel: 'カメラ視点',
    strokeViewLabel: '見る向きの切り替え',
    map: 'マップ',
    /** 練習モードだけのコース引き直し（spec §6） */
    newCourse: 'コース変更',
    backToRead: '読みに戻る',
    checkAim: '狙いを見る',
    giveUp: '長押しでギブアップ',
    giveUpToTee: '長押しでギブアップ（打ち直し）',
    giveUpHolding: '押したまま…',
    putterPower: 'パターの強さ',
    power: '強さ',
    rotateToPortrait: 'スマホを縦にしてください',

    // --- 視点名（main.ts の HUD と視点バー） ---
    views: {
      AIM: 'ボール後方',
      MAP: 'マップ',
      BEHIND_BALL: '旧ボール後方',
      BEHIND_HOLE: 'カップ後方',
      LOW_LINE: '低い視点',
      SIDE_MID: '横から',
    },

    // --- 案内（main.ts / stroke-view.ts） ---
    noticeAim: '左右スワイプで狙い、タップで構える',
    noticeMap: 'マップ ・ タップで戻る',
    noticeLowLine: '低い視点 ・ 左右スワイプで狙い、タップで構える',
    noticeRead: '読み視点 ・ タップで構える',
    noticeCupCheck: '狙い ・ 左右スワイプで調整 ・ タップで戻る',
    noticeNextPutt: 'タップで次の一打',
    noticePullRight: '右へ引いてください',
    noticeSwingThrough: 'そのまま振り抜いてください',
    noticeNoBackswing: 'バックスイングなし — 無効',
    noticeFewSamples: 'スイングを読めません — 無効',
    noticeNotPulledRight: '右へ引いていません — 無効',
    outOfBoundsAlert: 'OB',

    // --- スコア表示（main.ts） ---
    gaveUpNote: '　* はギブアップ',
    hintNextHole: 'タップで次のホールへ',
    hintResult: 'タップでスコアへ',
    colHole: 'H',
    colPar: 'PAR',
    colStrokes: '打数',
    colTotal: '合計',

    // --- トップへ戻る確認（main.ts） ---
    homeDialogTitle: 'トップへ戻りますか？',
    homeContinue: '続ける',
    homeConfirm: 'トップへ戻る',
    homeMessageTourSaved: 'トップへ戻りますか？ ここまでの進行は保存されています。',
    homeMessageTourMid:
      'トップへ戻りますか？ このホールの途中経過は保存されません。次回はこのホールの最初から再開します。',
    homeMessagePractice: 'トップへ戻りますか？ 練習中の打数やボール位置は保存されません。',

    // --- ラウンド終了のボタン（index.html） ---
    toCourseSelect: 'コース選択へ',
    playAgain: 'もう一度',
    toTop: 'トップへ',
  },
  en: {
    menuSubtitle: 'CHOOSE A MODE',
    modeTour: 'TOUR',
    modePractice: 'PRACTICE',
    guideLabel: 'Guide',
    howTo: 'HOW TO PLAY',
    privacy: 'PRIVACY POLICY',
    language: 'Language',
    japanese: '日本語',
    english: 'EN',
    backToMenu: '← TOP',
    tourTitle: 'TOUR',
    start: 'START',
    startOver: 'FROM START',
    putter: 'PUTTER',
    putterChoose: 'CHOOSE PUTTER',
    putterSelect: 'SELECT',
    putterSelected: 'IN USE',
    putterShapes: {
      pin: 'PIN',
      blade: 'BLADE',
      mallet: 'MALLET',
      fang: 'FANG',
    },

    top: 'TOP',
    backToTop: 'Back to top',
    cameraViewLabel: 'Camera view',
    strokeViewLabel: 'Change view',
    map: 'MAP',
    newCourse: 'NEW HOLE',
    backToRead: 'BACK TO THE READ',
    checkAim: 'CHECK AIM',
    giveUp: 'HOLD TO GIVE UP',
    giveUpToTee: 'HOLD TO GIVE UP · REPLAY',
    giveUpHolding: 'KEEP HOLDING…',
    putterPower: 'PUTTER POWER',
    power: 'POWER',
    rotateToPortrait: 'HOLD YOUR PHONE UPRIGHT',

    views: {
      // 視点名は「どこから見ているか」で揃える。何をするかは案内の行が言う
      AIM: 'BALL',
      MAP: 'MAP',
      BEHIND_BALL: 'BEHIND BALL (OLD)',
      BEHIND_HOLE: 'CUP',
      LOW_LINE: 'LOW',
      SIDE_MID: 'SIDE',
    },

    noticeAim: 'Swipe left or right to aim, tap to address',
    noticeMap: 'Map · Tap to go back',
    noticeLowLine: 'Low view · Swipe to aim, tap to address',
    noticeRead: 'Green read · Tap to address',
    noticeCupCheck: 'Aim · Swipe to adjust · Tap to go back',
    noticeNextPutt: 'Tap for the next putt',
    noticePullRight: 'Take the putter back to the right',
    noticeSwingThrough: 'Now swing through',
    noticeNoBackswing: 'No backswing — no stroke',
    noticeFewSamples: "Couldn't read the swing — no stroke",
    noticeNotPulledRight: 'Not taken back — no stroke',
    outOfBoundsAlert: 'OUT OF BOUNDS',

    gaveUpNote: ' · * GAVE UP',
    hintNextHole: 'Tap for the next hole',
    hintResult: 'Tap for the scorecard',
    colHole: 'H',
    colPar: 'PAR',
    colStrokes: 'STROKES',
    colTotal: 'TOTAL',

    homeDialogTitle: 'RETURN TO TOP?',
    homeContinue: 'KEEP PLAYING',
    homeConfirm: 'GO TO TOP',
    homeMessageTourSaved: 'Return to the top menu? Your progress so far is saved.',
    homeMessageTourMid:
      'Return to the top menu? Progress within this hole is not saved — ' +
      'next time you play this hole again from the tee.',
    homeMessagePractice: 'Return to the top menu? Strokes and ball position in practice are not saved.',

    toCourseSelect: 'COURSES',
    playAgain: 'PLAY AGAIN',
    toTop: 'TOP',
  },
} as const;

export type Copy = (typeof COPY)[Language];

export function resolveLanguage(
  urlValue: string | null,
  storedLanguage: string | null,
  browserLanguages: readonly string[],
): Language {
  if (urlValue === 'ja' || urlValue === 'en') return urlValue;
  if (storedLanguage === 'ja' || storedLanguage === 'en') return storedLanguage;
  return browserLanguages.some((language) => language.toLowerCase().startsWith('ja')) ? 'ja' : 'en';
}

function readStoredLanguage(): string | null {
  try {
    return window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function persistLanguage(language: Language): void {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // 保存できない環境でも、そのセッション中の表示は切り替わる
  }
}

function readInitialLanguage(): Language {
  const urlValue = new URLSearchParams(window.location.search).get(LANGUAGE_QUERY_KEY);
  const browserLanguages =
    navigator.languages && navigator.languages.length > 0
      ? navigator.languages
      : [navigator.language];
  const language = resolveLanguage(urlValue, readStoredLanguage(), browserLanguages);
  // 入口で指定された言語はここで保存へ移す。以後の遷移はクエリを持ち回らない
  if (urlValue === 'ja' || urlValue === 'en') persistLanguage(language);
  return language;
}

let current: Language | null = null;

export function language(): Language {
  if (current === null) {
    current = readInitialLanguage();
    document.documentElement.lang = current;
  }
  return current;
}

/** 言語を切り替えて保存する。表示の描き直しは呼び出し側で行う */
export function setLanguage(next: Language): void {
  current = next;
  document.documentElement.lang = next;
  persistLanguage(next);
}

export function t(): Copy {
  return COPY[language()];
}

const en = (value: string, jaValue: string): string => (language() === 'en' ? value : jaValue);

// --- 数値が混じる行 -------------------------------------------------------
// 数字の書式（打数・パー差・距離・角度）は言語で変えない。変えるのは前後の語だけ

/**
 * カードの打数。「6 STROKES」。1打だけ単数にする（ホールインワンで出る）。
 * **判定語（BIRDIE など）と同じく日本語でも英語のまま**にして、HUDと語を揃える
 */
export function strokesText(strokes: number): string {
  return `${strokes} ${strokes === 1 ? 'STROKE' : 'STROKES'}`;
}

/**
 * ホールの結果を表す語。中継と同じで、**スコアはまず語で言う**。
 * バーディ・ボギーは日本のゴルフでもそのまま使う語なので、日本語版でも英語のまま出す。
 * +4以上と−4以下は英語圏でも語で言わないので、数字をそのまま出す
 */
export function holeVerdict(strokes: number, par: number, holedOut: boolean): string {
  if (!holedOut) return 'GAVE UP';
  if (strokes === 1) return 'HOLE IN ONE';
  const diff = strokes - par;
  if (diff === -3) return 'ALBATROSS';
  if (diff === -2) return 'EAGLE';
  if (diff === -1) return 'BIRDIE';
  if (diff === 0) return 'PAR';
  if (diff === 1) return 'BOGEY';
  if (diff === 2) return 'DOUBLE BOGEY';
  if (diff === 3) return 'TRIPLE BOGEY';
  return formatDiff(diff);
}

/**
 * パー差の表示。**ゲーム中で唯一の書き方**にする。
 * 英語のゴルフ表記に合わせ、イーブンは `±0` ではなく `E`
 */
export function formatDiff(diff: number): string {
  if (diff === 0) return 'E';
  return diff > 0 ? `+${diff}` : String(diff);
}

/** ホール間カードの1行目。「HOLE 5 / 9   PAR 4」。PARはそのホールの素性なのでここへ置く */
export function holeCardTitle(holeNumber: number, holeCount: number, par: number): string {
  return `HOLE ${holeNumber} / ${holeCount}   ${LABEL_PAR} ${par}`;
}

/**
 * プレイ中に常時出す進行表示。ゴルフ中継と同じように、**役割ごとに別の欄へ分ける**。
 * 見た目の大きさと色は index.html の `#hud .progress` が受け持つ。
 * **帯は折り返さず切り落とす**ので、語を足して横幅を増やさない。
 *
 * ここだけは**日本語でも英語のまま**にする。中継のスコア表示と同じ短い語なので
 * そのまま通じ、幅も一定になる（`SHOT` / `TOTAL` / `LEFT` / `PAR`）
 */

/** ホール表示の大きい数字。何ホール目か */
export function holeBadgeNumber(holeNumber: number): string {
  return String(holeNumber);
}

/** ホール表示の下段。「PAR 4」 */
export function holeBadgePar(par: number): string {
  return `${LABEL_PAR} ${par}`;
}

/** 打数の見出し。中継の「第2打」に当たる */
export const LABEL_SHOT = 'SHOT';

/**
 * パー差の見出し。**このホールの成績ではなく、ホールアウト済みのぶんの合計**。
 * 英語のリーダーボードと同じで、`TOTAL` が指すのは打数の合計ではなくパー差
 */
export const LABEL_TOTAL = 'TOTAL';

/**
 * カップまでの残りの見出し。中継の「152 YDS TO PIN」と同じ言い方にする
 * （`LEFT` は会話では使うが、表示の語ではない）
 */
export const LABEL_PIN = 'TO PIN';

/** PARの見出し。HUDのホール表示とカードで共通 */
export const LABEL_PAR = 'PAR';

/** ラウンド終了のカードで使うホール数の見出し */
export const LABEL_HOLES = 'HOLES';

/**
 * 打数の合計の見出し。英語のリーダーボードでは `TOTAL` はパー差の列で、
 * **打数の合計は別列の `STROKES`**。ここを取り違えると意味が逆になる
 */
export const LABEL_STROKES = 'STROKES';

/** ホール入り口の紹介（中継のホール紹介）。上段は「HOLE 3」 */
export function holeIntroNumber(holeNumber: number): string {
  return `HOLE ${holeNumber}`;
}

/** ホール入り口の紹介。下段は「PAR 4・12.4m」 */
export function holeIntroDetail(par: number, distance: string): string {
  return en(`PAR ${par} · ${distance}`, `PAR ${par}・${distance}`);
}

export function resumeNotice(tourName: string, holeNumber: number): string {
  return en(
    `${tourName} · Resuming from hole ${holeNumber}`,
    `${tourName}・ホール${holeNumber}から再開します`,
  );
}

/** コース選択の「再開」ボタン。半分の幅に収める必要があるので短くする */
export function resumeLabel(holeNumber: number): string {
  return en(`RESUME H${holeNumber}`, `HOLE ${holeNumber}から再開`);
}

export function bestLabel(strokes: number, toPar: string): string {
  return `BEST ${strokes} (${toPar})`;
}

export function newBestLabel(best: string): string {
  return en(`NEW BEST!  ${best}`, `NEW BEST!　${best}`);
}

export function roundEndTitle(tourName: string): string {
  return en(`${tourName} · FINAL`, `${tourName}・ラウンド終了`);
}

export function holedResult(strokes: number): string {
  return en(`HOLED IN ${strokes}`, `${strokes} 打でカップイン`);
}

export function waterResult(strokes: number): string {
  return en(`IN THE WATER (+1) · ${strokes}`, `池（1罰打）・${strokes} 打`);
}

export function outOfBoundsResult(strokes: number): string {
  return en(`OUT OF BOUNDS (+1) · ${strokes}`, `OB（1罰打）・${strokes} 打`);
}

/** 打ち出しラインへの射影で出す「1.2m オーバー、右 0.3m」 */
export function missResult(along: number, lateral: number): string {
  const distance = Math.abs(along).toFixed(1);
  const head =
    along >= 0
      ? en(`${distance}m PAST`, `${distance}m オーバー`)
      : en(`${distance}m SHORT`, `${distance}m ショート`);
  if (Math.abs(lateral) < 0.05) return head;
  const side = Math.abs(lateral).toFixed(1);
  return lateral >= 0
    ? en(`${head}, ${side}m RIGHT`, `${head}、右 ${side}m`)
    : en(`${head}, ${side}m LEFT`, `${head}、左 ${side}m`);
}

export function whiffNotice(offsetPx: number): string {
  return en(
    `Whiff — ${offsetPx}px off the sweet spot`,
    `空振り — 芯から ${offsetPx}px 外れました`,
  );
}

export function powerButtonText(scale: string): string {
  return `${t().power} ${scale}×`;
}

export function putterPowerDetail(baseK: string, adjustedK: string): string {
  return en(`BASE ${baseK} → ${adjustedK}`, `基準係数 ${baseK} → ${adjustedK}`);
}

// --- index.html の静的文言 ------------------------------------------------

function setText(id: string, text: string): void {
  const element = document.getElementById(id);
  if (element) element.textContent = text;
}

function setAria(id: string, label: string): void {
  document.getElementById(id)?.setAttribute('aria-label', label);
}

/**
 * index.html は日本語を初期値として持つ。英語のときだけ差し替える。
 * メニューもゲームも同じ document なので、入口で一度呼べば足りる
 */
export function applyStaticUiText(): void {
  if (language() === 'ja') return;
  const copy = t();

  setText('home-button', copy.top);
  setAria('home-button', copy.backToTop);
  setText('map-toggle', copy.map);
  setText('course-shuffle', copy.newCourse);
  setText('giveup-label', copy.giveUp);
  setText('stroke-back', copy.backToRead);
  setText('stroke-cup-check', copy.checkAim);
  setAria('camera-controls', copy.cameraViewLabel);
  setAria('stroke-camera-controls', copy.strokeViewLabel);
  setText('putter-power-title', copy.putterPower);
  setText('putter-power-label', copy.power);
  setText('score-course', copy.toCourseSelect);
  setText('score-again', copy.playAgain);
  setText('score-home', copy.toTop);
  setText('home-dialog-title', copy.homeDialogTitle);
  setText('home-cancel', copy.homeContinue);
  setText('home-confirm', copy.homeConfirm);
  setText('rotate-message', copy.rotateToPortrait);

  for (const button of document.querySelectorAll<HTMLElement>('.camera-button')) {
    const view = button.dataset.aimView;
    if (view && view in copy.views) {
      button.textContent = copy.views[view as keyof Copy['views']];
    }
  }
}
