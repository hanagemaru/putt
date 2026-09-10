type OscillatorShape = OscillatorType;

const STORAGE_KEY = 'putt-sound-enabled';
const EPSILON_GAIN = 0.0001;

/**
 * Putt の短い効果音を Web Audio API だけで作る。
 * 音声ファイルを配らないので、読み込み待ちや追加アセットなしで鳴らせる。
 *
 * このブランチでは音色を実機で選ぶため、合成値はここへ閉じ込めている。
 * 音が確定したら恒久ルールに従って調整値を CONFIG へ移す。
 */
export class PuttAudio {
  private context: AudioContext | null = null;
  private enabled = this.loadEnabled();
  private noiseBuffer: AudioBuffer | null = null;

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    try {
      localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
    } catch {
      // 保存できない環境では、そのページを開いている間だけ反映する。
    }

    if (enabled) void this.unlock();
    else if (this.context?.state === 'running') void this.context.suspend();
  }

  /** iOS Safari を含め、最初のユーザー操作内で AudioContext を起こす。 */
  async unlock(): Promise<void> {
    if (!this.enabled) return;
    const context = this.ensureContext();
    if (context.state === 'suspended') {
      try {
        await context.resume();
      } catch {
        // 音が許可されない環境ではゲーム自体はそのまま続ける。
      }
    }
  }

  /** 芯=1、フェース端付近≈0.55。ズレるほど鈍く小さい打撃音にする。 */
  playImpact(mishitGain: number): void {
    const context = this.readyContext();
    if (!context) return;
    const quality = this.clamp((mishitGain - 0.55) / 0.45, 0, 1);
    const now = context.currentTime;

    this.tone(context, {
      at: now,
      duration: 0.1,
      frequency: 135 + 45 * quality,
      gain: 0.19 + 0.07 * quality,
      decay: 0.03,
      shape: 'triangle',
    });
    this.tone(context, {
      at: now,
      duration: 0.06,
      frequency: 720 + 700 * quality,
      gain: 0.07 + 0.06 * quality,
      decay: 0.014,
      shape: 'sine',
    });
    this.noise(context, {
      at: now,
      duration: 0.045,
      gain: 0.025 + 0.018 * quality,
      decay: 0.01,
      filter: 'highpass',
      cutoff: 500,
    });
  }

  playWhiff(): void {
    const context = this.readyContext();
    if (!context) return;
    this.noise(context, {
      at: context.currentTime,
      duration: 0.095,
      gain: 0.12,
      decay: 0.025,
      filter: 'bandpass',
      cutoff: 1700,
      q: 0.7,
    });
  }

  playFlagstick(): void {
    const context = this.readyContext();
    if (!context) return;
    const now = context.currentTime;
    this.tone(context, {
      at: now,
      duration: 0.12,
      frequency: 1450,
      gain: 0.12,
      decay: 0.028,
      shape: 'sine',
    });
    this.tone(context, {
      at: now,
      duration: 0.1,
      frequency: 2380,
      gain: 0.055,
      decay: 0.02,
      shape: 'sine',
    });
    this.noise(context, {
      at: now,
      duration: 0.045,
      gain: 0.018,
      decay: 0.012,
      filter: 'highpass',
      cutoff: 1200,
    });
  }

  /** カップの硬い接触→少し遅れて穴へ落ちる低い音、の2段。 */
  playCupIn(delay = 0): void {
    const context = this.readyContext();
    if (!context) return;
    const now = context.currentTime + delay;
    this.tone(context, {
      at: now,
      duration: 0.065,
      frequency: 520,
      gain: 0.105,
      decay: 0.016,
      shape: 'triangle',
    });
    this.tone(context, {
      at: now,
      duration: 0.05,
      frequency: 980,
      gain: 0.038,
      decay: 0.012,
      shape: 'sine',
    });
    this.noise(context, {
      at: now,
      duration: 0.04,
      gain: 0.02,
      decay: 0.01,
      filter: 'highpass',
      cutoff: 500,
    });
    this.sweep(context, {
      at: now + 0.055,
      duration: 0.14,
      from: 190,
      to: 105,
      gain: 0.14,
      decay: 0.052,
      shape: 'sine',
    });
    this.noise(context, {
      at: now + 0.055,
      duration: 0.1,
      gain: 0.022,
      decay: 0.035,
      filter: 'lowpass',
      cutoff: 900,
    });
  }

  playWater(): void {
    const context = this.readyContext();
    if (!context) return;
    const now = context.currentTime;
    this.sweep(context, {
      at: now,
      duration: 0.18,
      from: 155,
      to: 72,
      gain: 0.13,
      decay: 0.055,
      shape: 'sine',
    });
    this.noise(context, {
      at: now,
      duration: 0.18,
      gain: 0.06,
      decay: 0.055,
      filter: 'lowpass',
      cutoff: 1300,
    });
    this.noise(context, {
      at: now,
      duration: 0.11,
      gain: 0.025,
      decay: 0.035,
      filter: 'bandpass',
      cutoff: 1600,
      q: 0.8,
    });
  }

  playOutOfBounds(): void {
    const context = this.readyContext();
    if (!context) return;
    const now = context.currentTime;
    this.sweep(context, {
      at: now,
      duration: 0.15,
      from: 115,
      to: 78,
      gain: 0.11,
      decay: 0.043,
      shape: 'sine',
    });
    this.tone(context, {
      at: now,
      duration: 0.09,
      frequency: 210,
      gain: 0.032,
      decay: 0.024,
      shape: 'triangle',
    });
    this.noise(context, {
      at: now,
      duration: 0.055,
      gain: 0.016,
      decay: 0.015,
      filter: 'lowpass',
      cutoff: 650,
    });
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

  private readyContext(): AudioContext | null {
    if (!this.enabled) return null;
    const context = this.ensureContext();
    if (context.state !== 'running') return null;
    return context;
  }

  private tone(
    context: AudioContext,
    options: {
      at: number;
      duration: number;
      frequency: number;
      gain: number;
      decay: number;
      shape: OscillatorShape;
    },
  ): void {
    const oscillator = context.createOscillator();
    oscillator.type = options.shape;
    oscillator.frequency.setValueAtTime(options.frequency, options.at);
    const gain = context.createGain();
    this.envelope(gain.gain, options.at, options.gain, options.duration, options.decay);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(options.at);
    oscillator.stop(options.at + options.duration);
  }

  private sweep(
    context: AudioContext,
    options: {
      at: number;
      duration: number;
      from: number;
      to: number;
      gain: number;
      decay: number;
      shape: OscillatorShape;
    },
  ): void {
    const oscillator = context.createOscillator();
    oscillator.type = options.shape;
    oscillator.frequency.setValueAtTime(options.from, options.at);
    oscillator.frequency.exponentialRampToValueAtTime(options.to, options.at + options.duration);
    const gain = context.createGain();
    this.envelope(gain.gain, options.at, options.gain, options.duration, options.decay);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(options.at);
    oscillator.stop(options.at + options.duration);
  }

  private noise(
    context: AudioContext,
    options: {
      at: number;
      duration: number;
      gain: number;
      decay: number;
      filter: BiquadFilterType;
      cutoff: number;
      q?: number;
    },
  ): void {
    const source = context.createBufferSource();
    source.buffer = this.ensureNoiseBuffer(context);
    const filter = context.createBiquadFilter();
    filter.type = options.filter;
    filter.frequency.setValueAtTime(options.cutoff, options.at);
    filter.Q.setValueAtTime(options.q ?? 0.7, options.at);
    const gain = context.createGain();
    this.envelope(gain.gain, options.at, options.gain, options.duration, options.decay);
    source.connect(filter).connect(gain).connect(context.destination);
    source.start(options.at, 0, options.duration);
  }

  private ensureNoiseBuffer(context: AudioContext): AudioBuffer {
    if (this.noiseBuffer && this.noiseBuffer.sampleRate === context.sampleRate) return this.noiseBuffer;
    const length = Math.ceil(context.sampleRate * 0.25);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    // 毎回音が変わらないよう、固定のLCGでノイズを作る。
    let state = 0x260910;
    for (let i = 0; i < data.length; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      data[i] = (state / 0xffffffff) * 2 - 1;
    }
    this.noiseBuffer = buffer;
    return buffer;
  }

  private envelope(
    param: AudioParam,
    at: number,
    peak: number,
    duration: number,
    decay: number,
  ): void {
    const attackEnd = at + Math.min(0.002, duration * 0.2);
    const end = at + duration;
    param.setValueAtTime(EPSILON_GAIN, at);
    param.exponentialRampToValueAtTime(Math.max(peak, EPSILON_GAIN), attackEnd);
    const decayEnd = Math.min(end, attackEnd + Math.max(decay, 0.001) * 5);
    param.exponentialRampToValueAtTime(EPSILON_GAIN, decayEnd);
    if (decayEnd < end) param.setValueAtTime(EPSILON_GAIN, end);
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }
}

export const puttAudio = new PuttAudio();
