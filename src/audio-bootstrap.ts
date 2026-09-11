import { Roller } from './physics';
import { SwipeMeasure } from './swipe-measure';
import { puttAudio } from './audio';

/**
 * 音の実機比較用の薄い配線。
 * 物理やスワイプ計測の戻り値は一切変えず、公開メソッドの結果だけを観測して鳴らす。
 * 音色が確定したら main / stroke-view の明示的なコールバックへ移す前提の試聴ブランチ。
 */
const patchState = globalThis as typeof globalThis & { __puttAudioPreviewPatched?: boolean };

if (!patchState.__puttAudioPreviewPatched) {
  patchState.__puttAudioPreviewPatched = true;
  installSwipeAudio();
  installRollAudio();
}

// iOS Safari はユーザー操作なしの AudioContext 再生を止める。
// capture で最初の操作を拾い、ゲーム側の入力処理より先に resume しておく。
document.addEventListener('pointerdown', () => void puttAudio.unlock(), { capture: true });
document.addEventListener('keydown', () => void puttAudio.unlock(), { capture: true });

installMenuSoundToggle();
const menuObserver = new MutationObserver(installMenuSoundToggle);
menuObserver.observe(document.body, { childList: true, subtree: true });

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
      puttAudio.playImpact(result.gain);
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
        // 同じ物理更新内で旗竿に当たって入ったときだけ、金属音の直後に落下音を置く。
        puttAudio.playCupIn(hitFlagstick ? 0.045 : 0);
      } else if (status === 'water') {
        puttAudio.playWater();
      } else if (status === 'outOfBounds') {
        puttAudio.playOutOfBounds();
      }
    }

    return status;
  } as typeof originalAdvance;
}

/**
 * 試聴中でも消音できるよう、トップメニューだけに小さいON/OFFを追加する。
 * 選択は localStorage へ保存され、ゲームへ入ってもその設定を使う。
 */
function installMenuSoundToggle(): void {
  const panel = document.querySelector<HTMLElement>('#menu-root .menu-panel');
  if (!panel || !panel.querySelector('.menu-title')) return;
  if (panel.querySelector('[data-putt-sound-toggle]')) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.puttSoundToggle = 'true';
  button.className = 'putt-sound-toggle';
  button.addEventListener('click', () => {
    puttAudio.setEnabled(!puttAudio.isEnabled());
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
