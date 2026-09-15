import { puttAudio } from './audio';
import { ACTIVE_JINGLE, puttMusic, type JingleVariant } from './music';

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

const startButton = document.getElementById('start') as HTMLButtonElement;
const stopButton = document.getElementById('stop') as HTMLButtonElement;
const stateLabel = document.getElementById('bgm-state') as HTMLElement;
const withCup = document.getElementById('with-cup') as HTMLInputElement;
const list = document.getElementById('variants') as HTMLElement;

let started = false;
let highlight: number | null = null;

function buildList(): void {
  for (const variant of VARIANTS) {
    const item = document.createElement('li');
    item.dataset.id = variant.id;

    const head = document.createElement('div');
    head.className = 'head';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = variant.name;
    head.append(name);
    if (variant.id === ACTIVE_JINGLE) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = '今の音';
      head.append(tag);
    }

    const desc = document.createElement('p');
    desc.className = 'desc';
    desc.textContent = variant.desc;

    const button = document.createElement('button');
    button.textContent = '▶ 鳴らす';
    button.addEventListener('click', () => {
      void play(variant.id, item);
    });

    item.append(head, desc, button);
    list.append(item);
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

  for (const other of Array.from(list.children)) other.classList.remove('active');
  item.classList.add('active');
  if (highlight !== null) window.clearTimeout(highlight);
  highlight = window.setTimeout(() => item.classList.remove('active'), 2600);
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
