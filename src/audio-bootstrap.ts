import { Roller } from './physics';
import { SwipeMeasure } from './swipe-measure';
import { puttAudio } from './audio';
import { puttMusic, type HoleOutResult } from './music';
import { menuSfx } from './ui-sfx';

/**
 * ゲーム本体の物理・スワイプ計測には手を入れず、確定した結果を観測して効果音を鳴らす。
 * 物理や戻り値は変更しない。
 */
const patchState = globalThis as typeof globalThis & { __puttAudioPatched?: boolean };

/** 復帰時は visibilitychange / pageshow / focus が続けて飛ぶため、まとめて1回にする。 */
const REVIVE_DEBOUNCE_MS = 80;

if (!patchState.__puttAudioPatched) {
  patchState.__puttAudioPatched = true;
  installSwipeAudio();
  installRollAudio();
}

const routeParams = new URLSearchParams(location.search);
const gameRoute = isGameRoute(routeParams);
puttMusic.setScene(gameRoute ? 'play' : 'menu');
if (gameRoute) {
  installRoundEndMusic();
  installHoleOutMusic();
}

// ブラウザ側が許可している環境では、読み込み直後から再生開始を試す。
// iOS Safariなど自動再生を禁止する環境では失敗してもそのまま待ち、最初の操作で解除する。
void puttAudio.unlock();
void puttMusic.unlock();
if (!gameRoute) void menuSfx.unlock();

// iOS Safari はユーザー操作なしの AudioContext 再生を止める。
// 最初のタッチ/ポインタ操作をcaptureで拾い、画面遷移より前にresumeを開始する。
const unlockAudio = (): void => {
  void puttAudio.unlock();
  void puttMusic.unlock();
  if (!gameRoute) void menuSfx.unlock();
};
document.addEventListener('pointerdown', unlockAudio, { capture: true });
document.addEventListener('touchstart', unlockAudio, { capture: true, passive: true });
document.addEventListener('keydown', unlockAudio, { capture: true });

// ブラウザを一度閉じる・他アプリへ切り替えるなどで、iOS SafariはAudioContextを中断する。
// 画面が戻った時点でresumeを試し、それでも戻らないcontextだけ作り直す。
// ここで復帰できない環境でも、上のタッチ経路で次の操作から鳴り直す。
let reviveTimer: number | null = null;
let reviving = false;

const scheduleRevive = (): void => {
  if (document.visibilityState === 'hidden') return;
  if (reviveTimer !== null) window.clearTimeout(reviveTimer);
  reviveTimer = window.setTimeout(() => {
    reviveTimer = null;
    void reviveAudio();
  }, REVIVE_DEBOUNCE_MS);
};

document.addEventListener('visibilitychange', scheduleRevive);
window.addEventListener('pageshow', scheduleRevive);
window.addEventListener('focus', scheduleRevive);

installMenuButtonAudio();
installMenuSoundToggle();
const menuObserver = new MutationObserver(installMenuSoundToggle);
menuObserver.observe(document.body, { childList: true, subtree: true });

/** 復帰処理は生存確認の待ち時間を含むため、重ねて走らせない。 */
async function reviveAudio(): Promise<void> {
  if (reviving) return;
  reviving = true;
  try {
    await Promise.all([
      puttAudio.revive(),
      puttMusic.revive(),
      gameRoute ? Promise.resolve() : menuSfx.revive(),
    ]);
  } finally {
    reviving = false;
  }
}

function isGameRoute(search: URLSearchParams): boolean {
  if (search.get('tour') !== null) return true;
  const mode = search.get('mode');
  if (mode === 'tour' || mode === 'practice') return true;
  if (search.get('seed') !== null) return true;
  if (search.get('course') === 'prototype') return true;
  return false;
}

/** 9ホール完走カードへ入ったときだけ、プレイ曲からラウンド終了曲へ切り替える。 */
function installRoundEndMusic(): void {
  const scoreTitle = document.getElementById('score-title');
  if (!scoreTitle) return;

  const sync = (): void => {
    puttMusic.setScene(scoreTitle.dataset.screen === 'round-end' ? 'roundEnd' : 'play');
  };
  sync();

  const observer = new MutationObserver(sync);
  observer.observe(scoreTitle, {
    attributes: true,
    attributeFilter: ['data-screen'],
  });
}

/**
 * ホールアウトの音。**スコアカードが出るのと同時に**鳴らす。
 *
 * BGMとジングルが重なって聞こえるのをやめ、カードの合図でBGMを引いてから
 * 結果別のジングルを鳴らす。BGMは次のホールが始まる（カードが消える）ときに戻す。
 * ギブアップはカップインしていないので鳴らさない。
 */
function installHoleOutMusic(): void {
  const scoreTitle = document.getElementById('score-title');
  const scoreOverlay = document.getElementById('score-overlay');
  if (!scoreTitle || !scoreOverlay) return;

  const results: readonly HoleOutResult[] = ['eagle', 'birdie', 'par', 'bogey', 'double'];

  const cue = new MutationObserver(() => {
    const result = scoreTitle.dataset.result as HoleOutResult | undefined;
    if (!result || !results.includes(result)) return;
    puttMusic.playHoleOutCue(result);
  });
  cue.observe(scoreTitle, { attributes: true, attributeFilter: ['data-result'] });

  const resume = new MutationObserver(() => {
    // カードが消える＝次のホールが始まる。引いていたBGMをここで戻す
    if (scoreOverlay.hasAttribute('hidden')) puttMusic.resumeAfterHoleOut();
  });
  resume.observe(scoreOverlay, { attributes: true, attributeFilter: ['hidden'] });
}

function installSwipeAudio(): void {
  const originalAdd = SwipeMeasure.prototype.add;
  SwipeMeasure.prototype.add = function (
    this: SwipeMeasure,
    ...args: Parameters<typeof originalAdd>
  ) {
    const result = originalAdd.apply(this, args);
    if (result === 'whiff') {
      puttAudio.playWhiff();
    } else if (result !== null && typeof result === 'object') {
      puttAudio.playImpact(result.gain, result.speedMs);
    }
    return result;
  } as typeof originalAdd;
}

function installRollAudio(): void {
  const originalAdvance = Roller.prototype.advance;
  Roller.prototype.advance = function (
    this: Roller,
    ...args: Parameters<typeof originalAdvance>
  ) {
    const beforeHits = this.flagstickHits;
    const beforeStatus = this.status;
    const status = originalAdvance.apply(this, args);
    const hitFlagstick = this.flagstickHits > beforeHits;

    if (hitFlagstick) puttAudio.playFlagstick();

    if (status !== beforeStatus) {
      if (status === 'holed') {
        // 同じ物理更新内で旗竿に当たって入ったときだけ、旗竿音の直後に落下音を置く。
        puttAudio.playCupIn(hitFlagstick ? 0.045 : 0);
        // ジングルはここでは鳴らさない。スコアカードが出るのに合わせて鳴らす
        // （`installHoleOutMusic`）。カップ音 → ラインを見る間 → カード＋音、の順にする
      } else if (status === 'water') {
        puttAudio.playWater();
      } else if (status === 'outOfBounds') {
        puttAudio.playOutOfBounds();
      }
    }

    return status;
  } as typeof originalAdvance;
}

/** トップ・コース選択・パター選択のボタンへ、軽い操作音を共通で付ける。 */
function installMenuButtonAudio(): void {
  // clickより早いpointerdownで鳴らし始め、初回操作や別画面への遷移でも音を落としにくくする。
  document.addEventListener(
    'pointerdown',
    (event) => {
      const target = event.target instanceof Element
        ? event.target.closest<HTMLElement>('#menu-root button, #menu-root a')
        : null;
      if (!target) return;

      // 選択済み言語は押しても状態が変わらないため鳴らさない。
      if (target.matches('.language-button[aria-pressed="true"]')) return;

      if (target.matches('[data-putt-sound-toggle], .language-button')) {
        menuSfx.play('toggle');
      } else if (target.matches('.menu-back')) {
        menuSfx.play('back');
      } else if (target.matches('.course-action, .menu-button:not(.menu-button-sub)')) {
        menuSfx.play('confirm');
      } else {
        menuSfx.play('normal');
      }
    },
    { capture: true },
  );
}

/** トップメニューに音のON/OFFを置き、選択はゲーム中も維持する。 */
function installMenuSoundToggle(): void {
  const panel = document.querySelector<HTMLElement>('#menu-root .menu-panel');
  if (!panel || !panel.querySelector('.menu-title')) return;
  if (panel.querySelector('[data-putt-sound-toggle]')) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.puttSoundToggle = 'true';
  button.className = 'putt-sound-toggle';
  button.addEventListener('click', () => {
    const enabled = !puttAudio.isEnabled();
    puttAudio.setEnabled(enabled);
    puttMusic.setEnabled(enabled);
    menuSfx.setEnabled(enabled);
    // OFF→ON はpointerdown時点では無音なので、AudioContextを起こしてからON音を返す。
    if (enabled) void menuSfx.unlock().then(() => menuSfx.play('toggle'));
    updateSoundToggle(button);
  });
  updateSoundToggle(button);

  const languageControl = panel.querySelector('.language-toggle');
  if (languageControl) languageControl.insertAdjacentElement('afterend', button);
  else panel.append(button);

  ensureSoundToggleStyle();
}

function updateSoundToggle(button: HTMLButtonElement): void {
  const english = document.documentElement.lang === 'en';
  const enabled = puttAudio.isEnabled();
  button.textContent = english
    ? `SOUND ${enabled ? 'ON' : 'OFF'}`
    : `音 ${enabled ? 'ON' : 'OFF'}`;
  button.setAttribute('aria-pressed', String(enabled));
}

function ensureSoundToggleStyle(): void {
  if (document.getElementById('putt-sound-toggle-style')) return;
  const style = document.createElement('style');
  style.id = 'putt-sound-toggle-style';
  style.textContent = `
    .putt-sound-toggle {
      display: block;
      margin: 14px auto 0;
      min-height: 40px;
      appearance: none;
      border-style: solid;
      border-width: 3px;
      border-color: #9ede8a #1b3318 #1b3318 #9ede8a;
      border-radius: 0;
      background: #27431f;
      box-shadow: 0 4px 0 #0d140d;
      padding: 8px 14px;
      color: #bcd0c0;
      font: inherit;
      font-size: 12px;
      line-height: 1;
      letter-spacing: 0.04em;
      touch-action: manipulation;
    }
    .putt-sound-toggle:active {
      transform: translateY(4px);
      border-color: #1b3318 #9ede8a #9ede8a #1b3318;
      box-shadow: none;
    }
    .putt-sound-toggle:focus-visible {
      outline: 3px solid #ffe66d;
      outline-offset: 2px;
    }
  `;
  document.head.append(style);
}
