import { puttAudio } from './audio';
import { CONFIG } from './config';
import { ACTIVE_JINGLE, puttMusic, type HoleOutResult, type JingleVariant } from './music';

/**
 * ホールアウトのジングル試聴ページ。
 *
 * 「浮いて聞こえる」（`docs/PLAYTEST_BACKLOG.md` §9）をどう直すか決めるために、
 * 本編と同じ `PuttMusic` で案を鳴らし分ける。実機（スピーカー・イヤホン）で比べる前提。
 * ここで鳴らしているのは本編と同じコードなので、採用案はそのまま既定へ移せる。
 */
type VariantCard = {
  id: JingleVariant;
  name: string;
  desc: string;
};

const VARIANTS: readonly VariantCard[] = [
  {
    id: 'current',
    name: '1. 現状',
    desc: '低いピックアップ + C6/9の同時和音スタブ2回 + ノイズ。BGMは0.78倍まで下げる。',
  },
  {
    id: 'quiet',
    name: '2. 音量だけ下げる',
    desc: '形はそのままで、ジングルの音量を0.28→0.13へ。いちばん小さい変更。',
  },
  {
    id: 'single',
    name: '3. 同時和音をやめる',
    desc: '4音を重ねず、BGMと同じ単音の動き（速い分散）で和音を出す。BGMと同じ組み方になる。',
  },
  {
    id: 'soft',
    name: '4. 柔らかい音色にする',
    desc: '矩形波とノイズをやめ、BGMのベースと同じトライアングルだけで鳴らす。角が取れる。',
  },
  {
    id: 'inTime',
    name: '5. BGMの拍とコードに合わせる',
    desc: '次の拍まで待って鳴らし、和音も進行中のコードに合わせる。別の曲が重なった感じが消える。',
  },
  {
    id: 'none',
    name: '6. ジングルをやめる',
    desc: 'カップ音の余韻に任せ、BGMをほんの少しだけ持ち上げて戻す。鳴るのはカップ音だけ。',
  },
];

type ResultCard = {
  id: HoleOutResult;
  name: string;
  desc: string;
};

const RESULTS: readonly ResultCard[] = [
  {
    id: 'eagle',
    name: 'イーグル以上',
    desc: 'ソ→ド→ミ→ソ の上行4音。ここだけ少し長く、高域に薄いきらめきを足す。',
  },
  {
    id: 'birdie',
    name: 'バーディ',
    desc: 'ソ→ド→ミ の上行3音。最後のミをオクターブ上の単音で薄く重ねて明るくする。',
  },
  {
    id: 'par',
    name: 'パー',
    desc: 'ソ→ド の2音だけ。主音で着地して終わる。5つの中で一番地味に。',
  },
  {
    id: 'bogey',
    name: 'ボギー',
    desc: 'ラ→ソ→ミ の下行3音。ベースもラへ動かす。暗くはせず、着地をずらすだけ。',
  },
  {
    id: 'double',
    name: 'ダボ以上',
    desc: 'ソ→ミ♭→ド の下行。♭が1音入って沈む。一番短く、一番小さく。',
  },
];

/**
 * 本編でスコアカードが出るまでの時間 [s]。
 * ボールが止まって（＝カップ音が鳴って）から、俯瞰へ移り、ラインを見る間を取るまで。
 */
const CARD_AT =
  CONFIG.game.result.settleDelay + CONFIG.game.result.transition + CONFIG.game.round.cardDelay;
/** カードを眺めている時間のつもり。この後にBGMが戻る [s]。 */
const CARD_HOLD = 2.5;

const startButton = document.getElementById('start') as HTMLButtonElement;
const stopButton = document.getElementById('stop') as HTMLButtonElement;
const stateLabel = document.getElementById('bgm-state') as HTMLElement;
const withCup = document.getElementById('with-cup') as HTMLInputElement;
const list = document.getElementById('variants') as HTMLElement;
const resultList = document.getElementById('results') as HTMLElement;

let started = false;
let highlight: number | null = null;

function addCard(
  parent: HTMLElement,
  card: { id: string; name: string; desc: string },
  tag: string | null,
  onPlay: (item: HTMLElement) => void,
): void {
  const item = document.createElement('li');
  item.dataset.id = card.id;

  const head = document.createElement('div');
  head.className = 'head';
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = card.name;
  head.append(name);
  if (tag) {
    const mark = document.createElement('span');
    mark.className = 'tag';
    mark.textContent = tag;
    head.append(mark);
  }

  const desc = document.createElement('p');
  desc.className = 'desc';
  desc.textContent = card.desc;

  const button = document.createElement('button');
  button.textContent = '▶ 鳴らす';
  button.addEventListener('click', () => onPlay(item));

  item.append(head, desc, button);
  parent.append(item);
}

function buildList(): void {
  for (const result of RESULTS) {
    addCard(resultList, result, null, (item) => {
      void playResult(result.id, item);
    });
  }
  for (const variant of VARIANTS) {
    addCard(list, variant, variant.id === ACTIVE_JINGLE ? '今の音' : null, (item) => {
      void play(variant.id, item);
    });
  }
}

/** iOS Safari は最初のユーザー操作の中でしか音を出せないので、必ずボタンから呼ぶ。 */
async function start(): Promise<void> {
  // 本編の音設定がOFFのままだと何も鳴らないので、このページでは音を有効にする。
  if (!puttAudio.isEnabled()) puttAudio.setEnabled(true);
  puttMusic.setEnabled(true);
  puttMusic.setScene('play');

  await Promise.all([puttMusic.unlock(), puttAudio.unlock()]);
  started = true;
  stateLabel.textContent = 'プレイ中のBGMを鳴らしています。案を選んで比べてください。';
}

function stop(): void {
  puttMusic.setEnabled(false);
  started = false;
  stateLabel.textContent = '止めました。もう一度「BGMを鳴らす」で戻ります。';
}

/**
 * 新案の通し再生。
 * カップ音 → 間（俯瞰でラインを見る）→ カードと同時にBGMを引いてジングル →
 * 無音 → 次のホールが始まったつもりでBGMを戻す、という流れをそのまま鳴らす。
 */
async function playResult(result: HoleOutResult, item: HTMLElement): Promise<void> {
  if (!started) await start();

  const cardAt = withCup.checked ? CARD_AT : 0.15;
  if (withCup.checked) puttAudio.playCupIn(0);
  puttMusic.playHoleOutCue(result, cardAt);
  puttMusic.resumeAfterHoleOut(cardAt + CARD_HOLD);

  highlightCard(item, (cardAt + CARD_HOLD + 1) * 1000);
}

async function play(variant: JingleVariant, item: HTMLElement): Promise<void> {
  if (!started) await start();

  // 本編は、カップ音（ボールが落ちた瞬間）の約1秒後にジングルを置く。
  // カップ音なしのときだけ、待たずに短い間で鳴らす。
  if (withCup.checked) {
    puttAudio.playCupIn(0);
    puttMusic.playHoleOutJingle(1, variant);
  } else {
    puttMusic.playHoleOutJingle(0.15, variant);
  }

  highlightCard(item, 2600);
}

/** どれを鳴らしているか分かるよう、鳴っている間だけ枠を明るくする。 */
function highlightCard(item: HTMLElement, durationMs: number): void {
  for (const other of [...Array.from(list.children), ...Array.from(resultList.children)]) {
    other.classList.remove('active');
  }
  item.classList.add('active');
  if (highlight !== null) window.clearTimeout(highlight);
  highlight = window.setTimeout(() => item.classList.remove('active'), durationMs);
}

buildList();
startButton.addEventListener('click', () => void start());
stopButton.addEventListener('click', stop);

// 画面を離れて戻ったとき、iOS で止まったままにならないよう鳴らし直す。
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !started) return;
  void puttMusic.revive();
  void puttAudio.revive();
});
