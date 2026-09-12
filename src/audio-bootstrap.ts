import { Roller } from './physics';
import { SwipeMeasure } from './swipe-measure';
import { puttAudio } from './audio';
import { loadPutterShape, type PutterShapeId } from './putter-shape';

/**
 * 音の実機比較用の薄い配線。
 * 物理やスワイプ計測の戻り値は一切変えず、公開メソッドの結果だけを観測して鳴らす。
 * 音色が確定したら main / stroke-view の明示的なコールバックへ移す前提の試聴ブランチ。
 */
const patchState = globalThis as typeof globalThis & { __puttAudioPreviewPatched?: boolean };

const DIAGNOSTIC_QUERY_STORAGE_KEY = 'putt-audio-diagnostic-query';
restoreDiagnosticQuery();

const params = new URLSearchParams(location.search);
const audioDebugEnabled = params.get('audioDebug') === '1';
const impactOnly = params.get('audioOnly') === 'impact';
const impactCutMsRaw = Number(params.get('impactCutMs'));
/** 元の putt-impact 音源上で何msまで残すか。形状ごとの速度差を補正して再生時間へ換算する。 */
const impactSourceCutSeconds =
  Number.isFinite(impactCutMsRaw) && impactCutMsRaw > 0 ? impactCutMsRaw / 1000 : null;
const IMPACT_RATE: Record<PutterShapeId, number> = {
  pin: 1,
  blade: 1.85,
  mallet: 0.9,
  fang: 1.06,
};
let activeImpactCutSeconds: number | null = null;
let impactEpoch: number | null = null;
const debugLines: string[] = [];

installImpactCutDiagnostic();

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

/**
 * 診断URLからトップへ戻ると main.ts が検索パラメータを作り直すため、
 * 診断条件だけ sessionStorage に退避して同一タブ内の次ページで復元する。
 */
function restoreDiagnosticQuery(): void {
  const keys = ['audioDebug', 'audioOnly', 'impactCutMs'] as const;
  const current = new URLSearchParams(location.search);
  const hasDiagnostic = keys.some((key) => current.has(key));

  try {
    if (hasDiagnostic) {
      const saved = new URLSearchParams();
      for (const key of keys) {
        const value = current.get(key);
        if (value !== null) saved.set(key, value);
      }
      sessionStorage.setItem(DIAGNOSTIC_QUERY_STORAGE_KEY, saved.toString());
      return;
    }

    const raw = sessionStorage.getItem(DIAGNOSTIC_QUERY_STORAGE_KEY);
    if (!raw) return;
    const saved = new URLSearchParams(raw);
    let changed = false;
    for (const key of keys) {
      const value = saved.get(key);
      if (value !== null && !current.has(key)) {
        current.set(key, value);
        changed = true;
      }
    }
    if (!changed) return;

    const url = new URL(location.href);
    url.search = current.toString();
    history.replaceState(null, '', url.toString());
  } catch {
    // sessionStorage が使えない環境では、従来どおりURLに残っている間だけ診断する。
  }
}

/**
 * 診断用。元音源の同じ時刻で切るため、形状ごとの速度変換率で再生時間を補正する。
 * 例: 元音源120msまで残す場合、1.85x相当のL字は約65msで止める。
 */
function installImpactCutDiagnostic(): void {
  if (impactSourceCutSeconds === null || typeof AudioBufferSourceNode === 'undefined') return;
  const proto = AudioBufferSourceNode.prototype;
  const originalStart = proto.start;
  proto.start = function (
    this: AudioBufferSourceNode,
    when = 0,
    offset = 0,
    duration?: number,
  ): void {
    if (activeImpactCutSeconds !== null) {
      originalStart.call(this, when, offset, activeImpactCutSeconds);
      return;
    }
    if (duration === undefined) originalStart.call(this, when, offset);
    else originalStart.call(this, when, offset, duration);
  } as typeof proto.start;
}

function installSwipeAudio(): void {
  const originalAdd = SwipeMeasure.prototype.add;
  SwipeMeasure.prototype.add = function (
    this: SwipeMeasure,
    ...args: Parameters<typeof originalAdd>
  ) {
    const result = originalAdd.apply(this, args);
    if (result === 'whiff') {
      debugAudioEvent('WHIFF');
      if (!impactOnly) puttAudio.playWhiff();
    } else if (result !== null && typeof result === 'object') {
      impactEpoch = performance.now();
      const shape = loadPutterShape();
      activeImpactCutSeconds =
        impactSourceCutSeconds === null ? null : impactSourceCutSeconds / IMPACT_RATE[shape];
      const cutLabel =
        activeImpactCutSeconds === null
          ? ''
          : ` cut=${Math.round(activeImpactCutSeconds * 1000)}ms`;
      const volume = puttAudio.impactVolume(result.speedMs);
      debugAudioEvent(
        `IMPACT ${shape} v=${result.speedMs.toFixed(2)}m/s vol=${volume.toFixed(2)} gain=${result.gain.toFixed(2)}${cutLabel}`,
      );
      try {
        puttAudio.playImpact(result.gain, result.speedMs);
      } finally {
        activeImpactCutSeconds = null;
      }
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

    if (hitFlagstick) {
      debugAudioEvent(`FLAG hits=${beforeHits}->${this.flagstickHits}`);
      if (!impactOnly) puttAudio.playFlagstick();
    }

    if (status !== beforeStatus) {
      if (status === 'holed') {
        debugAudioEvent(`CUP ${beforeStatus}->${status}`);
        if (!impactOnly) puttAudio.playCupIn(hitFlagstick ? 0.045 : 0);
      } else if (status === 'water') {
        debugAudioEvent(`WATER ${beforeStatus}->${status}`);
        if (!impactOnly) puttAudio.playWater();
      } else if (status === 'outOfBounds') {
        debugAudioEvent(`OB ${beforeStatus}->${status}`);
        if (!impactOnly) puttAudio.playOutOfBounds();
      } else if (audioDebugEnabled) {
        debugAudioEvent(`STATUS ${beforeStatus}->${status}`);
      }
    }

    return status;
  } as typeof originalAdvance;
}

function debugAudioEvent(label: string): void {
  if (!audioDebugEnabled) return;
  const now = performance.now();
  const elapsed = impactEpoch === null ? 0 : now - impactEpoch;
  const prefix = impactEpoch === null || label.startsWith('IMPACT') ? '+0ms' : `+${Math.round(elapsed)}ms`;
  debugLines.push(`${prefix} ${label}`);
  while (debugLines.length > 8) debugLines.shift();
  renderAudioDebug();
}

function renderAudioDebug(): void {
  if (!audioDebugEnabled) return;
  let root = document.getElementById('putt-audio-debug');
  if (!root) {
    root = document.createElement('pre');
    root.id = 'putt-audio-debug';
    root.style.cssText = [
      'position:fixed',
      'left:8px',
      'top:8px',
      'z-index:99999',
      'margin:0',
      'padding:7px 9px',
      'max-width:calc(100vw - 16px)',
      'background:rgba(0,0,0,.82)',
      'color:#fff',
      'font:12px/1.35 monospace',
      'white-space:pre-wrap',
      'pointer-events:none',
    ].join(';');
    document.body.append(root);
  }
  const mode = impactOnly ? 'impact only' : 'all events';
  const cut =
    impactSourceCutSeconds === null
      ? ''
      : `, source cut ${Math.round(impactSourceCutSeconds * 1000)}ms`;
  root.textContent = `AUDIO DEBUG (${mode}${cut})\n${debugLines.join('\n') || 'waiting...'}`;
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

if (audioDebugEnabled) renderAudioDebug();
