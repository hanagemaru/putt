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
    startOver: 'HOLE 1から',
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

    // --- スコア表示（main.ts） ---
    gaveUpMark: '・ギブアップ',
    gaveUpNote: '　* はギブアップ',
    hintNextHole: 'タップで次のホールへ',
    hintResult: 'タップでスコアへ',
    practiceEnd: '練習終了',
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
    startOver: 'FROM HOLE 1',
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

    gaveUpMark: ' · GAVE UP',
    gaveUpNote: ' · * GAVE UP',
    hintNextHole: 'Tap for the next hole',
    hintResult: 'Tap for the scorecard',
    practiceEnd: 'PRACTICE OVER',
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

/** 「3 打」。カード見出しの打数。英語は1打だけ単数にする（ホールインワンで出る） */
export function strokesText(strokes: number): string {
  return en(`${strokes} ${strokes === 1 ? 'STROKE' : 'STROKES'}`, `${strokes} 打`);
}

/** ホール間・ラウンド終了カードの見出し。「3 打  ±0」 */
export function strokesHeadline(strokes: number, toPar: string): string {
  return `${strokesText(strokes)}  ${toPar}`;
}

/**
 * プレイ中に常時出す1行（ツアー）。
 * **HUDの帯は折り返さず切り落とす**（index.html の `#hud .row`）ので、
 * 区切りは日本語と同じく空白だけにして横幅を増やさない
 */
export function progressText(
  holeNumber: number,
  holeCount: number,
  par: number,
  strokes: number,
  toPar: string,
  distance: string,
): string {
  return en(
    `HOLE ${holeNumber}/${holeCount}  PAR ${par}  ${strokes} ${toPar}  ${distance}`,
    `HOLE ${holeNumber}/${holeCount}  PAR ${par}  ${strokes}打 ${toPar}  ${distance}`,
  );
}

/** 練習の1行。ホールを進めないので PAR と打数と距離だけ */
export function practiceProgressText(par: number, strokes: number, distance: string): string {
  return en(
    `PAR ${par}  ${strokes}  ${distance}`,
    `PAR ${par}  ${strokes}打  ${distance}`,
  );
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

export function roundEndSub(holeCount: number, totalPar: number, gaveUp: boolean): string {
  const head = en(
    `${holeCount} HOLES · PAR ${totalPar}`,
    `${holeCount} ホール ・ PAR ${totalPar}`,
  );
  return head + (gaveUp ? t().gaveUpNote : '');
}

export function holeOutSub(
  par: number,
  holedOut: boolean,
  totalStrokes: number,
  toPar: string,
): string {
  const mark = holedOut ? '' : t().gaveUpMark;
  return en(
    `PAR ${par}${mark} · TOTAL ${totalStrokes} ${toPar}`,
    `PAR ${par}${mark}　ここまで ${totalStrokes} 打 ${toPar}`,
  );
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
