import { loadPutterShape, type PutterShapeId } from './putter-shape';

const STORAGE_KEY = 'putt-sound-enabled';

const SAMPLE_URLS = {
  impact: new URL('./audio-assets/putt-impact.mp3', import.meta.url).href,
  flagstick: new URL('./audio-assets/flagstick.mp3', import.meta.url).href,
  cup: new URL('./audio-assets/cup-in.mp3', import.meta.url).href,
  water: new URL('./audio-assets/water.mp3', import.meta.url).href,
} as const;

type SampleName = keyof typeof SAMPLE_URLS;

const IMPACT_VARIANTS: Record<
  PutterShapeId,
  { rate: number; filter?: { type: 'highpass' | 'lowpass'; frequency: number }; peakScale: number }
> = {
  pin: { rate: 1, peakScale: 1 },
  blade: { rate: 1.85, filter: { type: 'highpass', frequency: 700 }, peakScale: 0.72 / 0.76 },
  mallet: { rate: 0.9, filter: { type: 'lowpass', frequency: 5200 }, peakScale: 0.78 / 0.76 },
  fang: { rate: 1.06, peakScale: 1 },
};

/**
 * putt-impact.mp3 は主打音の後に小さい二次振動が複数残っている。
 * 波形上は主ピークが約30ms、その後33/38/48ms付近にも小ピークがあるため、
 * 主打音の直後から滑らかに減衰させて「コッ」の後の別音感を消す。
 * 形状ごとの速度変換後も元音源上の同じ位置で減衰するよう rate で割る。
 */
const IMPACT_TAIL = {
  fadeStartSec: 0.032,
  fadeEndSec: 0.044,
};

/**
 * 打球初速 [m/s] を音量へ変換する試聴用カーブ。
 * 前版より弱打〜強打のゲイン比を約2倍広げ、実機で差を評価しやすくする。
 */
const IMPACT_VOLUME = {
  fullAtSpeedMs: 3,
  minGain: 0.05,
  exponent: 1.75,
};

// 旗竿/カップはBGMを遮らない補助音として、前版からさらに約半分まで下げる。
const FLAGSTICK_GAIN = 0.055;
const FLAGSTICK_LOWPASS_HZ = 3200;
const CUP_GAIN = 0.14;

/**
 * CC0 の実録素材を Web Audio API で鳴らす。
 * 素材と出典は audio-assets/SOURCES.txt を参照。
 *
 * パター音は再生時に playbackRate を変えない。
 * iPhone / Safari の補間でザラつくのを避けるため、読み込み時に高品質な sinc 補間で
 * 4形状ぶんの短い AudioBuffer を一度だけ作り、打つときは 1.0x で再生する。
 */
export class PuttAudio {
  private context: AudioContext | null = null;
  private enabled = this.loadEnabled();
  private readonly buffers = new Map<SampleName, AudioBuffer>();
  private readonly impactBuffers = new Map<PutterShapeId, AudioBuffer>();
  private loading: Promise<void> | null = null;

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
        return;
      }
    }
    if (context.state === 'running') void this.preloadSamples(context);
  }

  /** 打球初速から、実際に使う打音の音量係数を返す。 */
  impactVolume(speedMs: number): number {
    const normalized = this.clamp(speedMs / IMPACT_VOLUME.fullAtSpeedMs, 0, 1);
    return (
      IMPACT_VOLUME.minGain +
      (1 - IMPACT_VOLUME.minGain) * Math.pow(normalized, IMPACT_VOLUME.exponent)
    );
  }

  /**
   * 芯=1、フェース端付近≈0.55。
   * 音量は打球初速で変え、ミスヒットは主に音色（ローパス）で表す。
   * 形状差は事前生成したバッファで固定し、再生時の速度変更はしない。
   */
  playImpact(mishitGain: number, speedMs: number): void {
    if (!this.enabled) return;
    const context = this.ensureContext();
    if (context.state !== 'running') return;

    const quality = this.clamp((mishitGain - 0.55) / 0.45, 0, 1);
    const shape = loadPutterShape();
    const prepared = this.impactBuffers.get(shape);
    const buffer = prepared ?? this.buffers.get('impact');
    if (!buffer) {
      void this.preloadSamples(context);
      return;
    }

    const rate = prepared ? IMPACT_VARIANTS[shape].rate : 1;
    this.playBuffer(buffer, {
      gain: this.impactVolume(speedMs),
      lowpassHz: quality < 0.995 ? 2200 + 6200 * quality : undefined,
      fadeOutStart: IMPACT_TAIL.fadeStartSec / rate,
      fadeOutEnd: IMPACT_TAIL.fadeEndSec / rate,
    });
  }

  /** 空振りは実在する接触音がないため、リアル寄り版ではあえて鳴らさない。 */
  playWhiff(): void {}

  playFlagstick(): void {
    this.playSample('flagstick', {
      gain: FLAGSTICK_GAIN,
      lowpassHz: FLAGSTICK_LOWPASS_HZ,
    });
  }

  playCupIn(delay = 0): void {
    this.playSample('cup', { delay, gain: CUP_GAIN });
  }

  playWater(): void {
    this.playSample('water');
  }

  /** OB 自体には物理的な音がないので、画面上の通知だけにする。 */
  playOutOfBounds(): void {}

  private playSample(
    name: SampleName,
    options: {
      gain?: number;
      delay?: number;
      lowpassHz?: number;
      fadeOutStart?: number;
      fadeOutEnd?: number;
    } = {},
  ): void {
    if (!this.enabled) return;
    const context = this.ensureContext();
    if (context.state !== 'running') return;

    const buffer = this.buffers.get(name);
    if (!buffer) {
      void this.preloadSamples(context);
      return;
    }

    this.playBuffer(buffer, options);
  }

  private playBuffer(
    buffer: AudioBuffer,
    options: {
      gain?: number;
      delay?: number;
      lowpassHz?: number;
      fadeOutStart?: number;
      fadeOutEnd?: number;
    } = {},
  ): void {
    const context = this.ensureContext();
    if (context.state !== 'running') return;

    const source = context.createBufferSource();
    source.buffer = buffer;

    const gain = context.createGain();
    const startTime = context.currentTime + (options.delay ?? 0);
    const baseGain = options.gain ?? 1;
    gain.gain.setValueAtTime(baseGain, startTime);

    if (
      options.fadeOutStart !== undefined &&
      options.fadeOutEnd !== undefined &&
      options.fadeOutEnd > options.fadeOutStart
    ) {
      const fadeStart = startTime + options.fadeOutStart;
      const fadeEnd = startTime + options.fadeOutEnd;
      gain.gain.setValueAtTime(baseGain, fadeStart);
      gain.gain.linearRampToValueAtTime(0, fadeEnd);
    }

    if (options.lowpassHz !== undefined) {
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = options.lowpassHz;
      filter.Q.value = Math.SQRT1_2;
      source.connect(filter).connect(gain).connect(context.destination);
    } else {
      source.connect(gain).connect(context.destination);
    }

    source.start(startTime);
  }

  private preloadSamples(context: AudioContext): Promise<void> {
    if (this.loading) return this.loading;

    this.loading = Promise.all(
      (Object.entries(SAMPLE_URLS) as Array<[SampleName, string]>).map(async ([name, url]) => {
        if (this.buffers.has(name)) return;
        try {
          const response = await fetch(url);
          if (!response.ok) return;
          const data = await response.arrayBuffer();
          const buffer = await context.decodeAudioData(data);
          this.buffers.set(name, buffer);
          if (name === 'impact') this.prepareImpactBuffers(context, buffer);
        } catch {
          // 音源が読めなくてもゲーム本体はそのまま続ける。
        }
      }),
    )
      .then(() => undefined)
      .finally(() => {
        this.loading = null;
      });

    return this.loading;
  }

  private prepareImpactBuffers(context: AudioContext, source: AudioBuffer): void {
    if (this.impactBuffers.size > 0) return;
    const sourcePeak = this.peakOf(source);

    for (const [shape, variant] of Object.entries(IMPACT_VARIANTS) as Array<
      [PutterShapeId, (typeof IMPACT_VARIANTS)[PutterShapeId]]
    >) {
      if (shape === 'pin') {
        this.impactBuffers.set(shape, source);
        continue;
      }

      const rendered = this.resampleSinc(context, source, variant.rate);
      if (variant.filter) {
        this.applyBiquad(rendered, variant.filter.type, variant.filter.frequency);
      }
      this.scalePeak(rendered, sourcePeak * variant.peakScale);
      this.impactBuffers.set(shape, rendered);
    }
  }

  /**
   * 短い打音専用の windowed-sinc 補間。
   * AudioBufferSourceNode.playbackRate に任せず、ここで一度だけPCMを作る。
   */
  private resampleSinc(context: AudioContext, source: AudioBuffer, rate: number): AudioBuffer {
    if (Math.abs(rate - 1) < 1e-6) return source;

    const outLength = Math.max(1, Math.round(source.length / rate));
    const output = context.createBuffer(source.numberOfChannels, outLength, source.sampleRate);
    const halfWidth = 18;
    const cutoff = rate > 1 ? 0.96 / rate : 0.96;

    for (let channel = 0; channel < source.numberOfChannels; channel++) {
      const input = source.getChannelData(channel);
      const out = output.getChannelData(channel);

      for (let i = 0; i < out.length; i++) {
        const position = i * rate;
        const center = Math.floor(position);
        let total = 0;
        let weightSum = 0;

        for (let tap = center - halfWidth + 1; tap <= center + halfWidth; tap++) {
          if (tap < 0 || tap >= input.length) continue;
          const x = position - tap;
          if (Math.abs(x) >= halfWidth) continue;

          const sinc =
            Math.abs(x) < 1e-8
              ? cutoff
              : Math.sin(Math.PI * x * cutoff) / (Math.PI * x);
          const window = 0.5 * (1 + Math.cos((Math.PI * x) / halfWidth));
          const weight = sinc * window;
          total += input[tap] * weight;
          weightSum += weight;
        }

        out[i] = weightSum !== 0 ? total / weightSum : 0;
      }
    }

    return output;
  }

  /** 2次 Butterworth 相当の biquad。プレビューで使った高域/低域寄せだけ再現する。 */
  private applyBiquad(
    buffer: AudioBuffer,
    type: 'highpass' | 'lowpass',
    frequency: number,
  ): void {
    const q = Math.SQRT1_2;
    const omega = (2 * Math.PI * frequency) / buffer.sampleRate;
    const cos = Math.cos(omega);
    const sin = Math.sin(omega);
    const alpha = sin / (2 * q);

    let b0: number;
    let b1: number;
    let b2: number;
    if (type === 'lowpass') {
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
    } else {
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
    }

    const a0 = 1 + alpha;
    const a1 = -2 * cos;
    const a2 = 1 - alpha;
    b0 /= a0;
    b1 /= a0;
    b2 /= a0;
    const na1 = a1 / a0;
    const na2 = a2 / a0;

    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const data = buffer.getChannelData(channel);
      let x1 = 0;
      let x2 = 0;
      let y1 = 0;
      let y2 = 0;
      for (let i = 0; i < data.length; i++) {
        const x0 = data[i];
        const y0 = b0 * x0 + b1 * x1 + b2 * x2 - na1 * y1 - na2 * y2;
        data[i] = y0;
        x2 = x1;
        x1 = x0;
        y2 = y1;
        y1 = y0;
      }
    }
  }

  private peakOf(buffer: AudioBuffer): number {
    let peak = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
    }
    return peak;
  }

  private scalePeak(buffer: AudioBuffer, targetPeak: number): void {
    const peak = this.peakOf(buffer);
    if (peak <= 0 || targetPeak <= 0) return;
    const scale = targetPeak / peak;
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < data.length; i++) data[i] *= scale;
    }
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

  private clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }
}

export const puttAudio = new PuttAudio();
