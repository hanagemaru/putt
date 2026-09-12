import { Roller } from './physics';
import { SwipeMeasure } from './swipe-measure';
import { puttAudio } from './audio';
import { puttMusic } from './music';
import { menuSfx } from './ui-sfx';

/**
 * ゲーム本体の物理・スワイプ計測には手を入れず、確定した結果を観測して効果音を鳴らす。
 * 物理や戻り値は変更しない。
 */
const patchState = globalThis as typeof globalThis & { __puttAudioPatched?: boolean };

if (!patchState.__puttAudioPatched) {
  patchState.__puttAudioPatched = true;
  installSwipeAudio();
  installRollAudio();
}

const routeParams = new URLSearchParams(location.search);
const gameRoute = isGameRoute(routeParams);
puttMusic.setScene(gameRoute ? 'play' : 'menu');
if (gameRoute) installRoundEndMusic();

// iOS Safari はユーザー操作なしの AudioContext 再生を止める。
// capture で最初の操作を拾い、ゲーム側の入力処理より先に resume しておく。
const unlockAudio = (): void => {
  void puttAudio.unlock();
  void puttMusic.unlock();
  if (!gameRoute) void menuSfx.unlock();
};
document.addEventListener('pointerdown', unlockAudio, { capture: true });
document.addEventListener('keydown', unlockAudio, { capture: true });

installMenuButtonAudio();
installMenuSoundToggle();
const menuObserver = new MutationObserver(installMenuSoundToggle);
menuObserver.observe(document.body, { childList: true, subtree: true });

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
        // カップ音の余韻を聞かせてから約1秒後にジングルを置く。
        puttMusic.playHoleOutJingle(hitFlagstick ? 1.05 : 1);
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
  document.addEventListener(
    'click',
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
    // OFF→ON は capture 時点では無音なので、AudioContextを起こしてからON音を返す。
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
