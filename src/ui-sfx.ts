const STORAGE_KEY = 'putt-sound-enabled';

export type UiSoundKind = 'normal' | 'confirm' | 'back' | 'toggle';

const MIN_GAIN = 0.0001;

/**
 * トップ系メニュー専用の短い操作音。
 * 実録効果音よりかなり小さく、残響なしの単純波形だけで「乾いた樹脂クリック」寄りにする。
 * BGMのチープなゲーム音色とも馴染むが、ゲーム中の物理音より前へは出さない。
 */
class MenuSfx {
  private context: AudioContext | null = null;
  private enabled = this.loadEnabled();

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  async unlock(): Promise<void> {
    if (!this.enabled) return;
    const context = this.ensureContext();
    if (context.state === 'suspended') {
      try {
        await context.resume();
      } catch {
        return;
      }
    }
  }

  play(kind: UiSoundKind): void {
    if (!this.enabled) return;
    const context = this.ensureContext();
    if (context.state !== 'running') return;

    const now = context.currentTime;
    switch (kind) {
      case 'confirm':
        // START / 決定: 少し低く厚い「コッ」。
        this.tone(360, now, 0.065, 0.044, 'triangle', 1800);
        this.tone(720, now + 0.004, 0.042, 0.016, 'square', 2100);
        break;
      case 'back':
        // 戻る: 決定より軽く短い。
        this.tone(610, now, 0.034, 0.023, 'square', 2300);
        this.tone(305, now + 0.003, 0.036, 0.011, 'triangle', 1600);
        break;
      case 'toggle':
        // 言語 / SOUND: 小さい物理スイッチのような2段クリック。
        this.tone(900, now, 0.026, 0.020, 'square', 2600);
        this.tone(520, now + 0.034, 0.034, 0.022, 'square', 2100);
        break;
      default:
        // 通常: 一番控えめな乾いたクリック。
        this.tone(820, now, 0.032, 0.026, 'square', 2500);
        this.tone(410, now + 0.002, 0.038, 0.010, 'triangle', 1700);
        break;
    }
  }

  private tone(
    frequency: number,
    start: number,
    duration: number,
    amount: number,
    type: OscillatorType,
    lowpassHz: number,
  ): void {
    const context = this.ensureContext();
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);

    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = lowpassHz;
    filter.Q.value = Math.SQRT1_2;

    const gain = context.createGain();
    gain.gain.setValueAtTime(MIN_GAIN, start);
    gain.gain.linearRampToValueAtTime(amount, start + 0.002);
    gain.gain.exponentialRampToValueAtTime(MIN_GAIN, start + duration);

    oscillator.connect(filter).connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.01);
    oscillator.addEventListener('ended', () => {
      oscillator.disconnect();
      filter.disconnect();
      gain.disconnect();
    }, { once: true });
  }

  private loadEnabled(): boolean {
    try {
      return localStorage.getItem(STORAGE_KEY) !== '0';
    } catch {
      return true;
    }
  }

  private ensureContext(): AudioContext {
    if (!this.context) this.context = new AudioContext();
    return this.context;
  }
}

export const menuSfx = new MenuSfx();
