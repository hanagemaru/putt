import { loadPutterShape, type PutterShapeId } from './putter-shape';

const STORAGE_KEY = 'putt-sound-enabled';

const SAMPLE_URLS = {
  impact: new URL('./audio-assets/putt-impact.mp3', import.meta.url).href,
  flagstick: new URL('./audio-assets/flagstick.mp3', import.meta.url).href,
  cup: new URL('./audio-assets/cup-in.mp3', import.meta.url).href,
  water: new URL('./audio-assets/water.mp3', import.meta.url).href,
} as const;

type SampleName = keyof typeof SAMPLE_URLS;

/**
 * パターの見た目による音の差。性能・当たり判定には影響しない。
 * L字だけは、選んだ違いが耳でも分かるよう意図的に高めにする。
 */
const PUTTER_PLAYBACK_RATE: Record<PutterShapeId, number> = {
  pin: 1,
  blade: 1.85,
  mallet: 0.9,
  fang: 1.06,
};

/**
 * CC0 の実録素材を Web Audio API で鳴らす。
 * 素材と出典は audio-assets/SOURCES.txt を参照。
 */
export class PuttAudio {
  private context: AudioContext | null = null;
  private enabled = this.loadEnabled();
  private readonly buffers = new Map<SampleName, AudioBuffer>();
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

  /**
   * 芯=1、フェース端付近≈0.55。
   * パター形状の音色差に加え、芯から外れるほど少し低く・小さくして実録感を保つ。
   */
  playImpact(mishitGain: number): void {
    const quality = this.clamp((mishitGain - 0.55) / 0.45, 0, 1);
    const shape = loadPutterShape();
    const shapeRate = PUTTER_PLAYBACK_RATE[shape];
    const mishitRate = 0.93 + 0.07 * quality;
    const gain = 0.62 + 0.38 * quality;
    this.playSample('impact', {
      playbackRate: shapeRate * mishitRate,
      gain,
    });
  }

  /** 空振りは実在する接触音がないため、リアル寄り版ではあえて鳴らさない。 */
  playWhiff(): void {}

  playFlagstick(): void {
    this.playSample('flagstick', { gain: 0.9 });
  }

  playCupIn(delay = 0): void {
    this.playSample('cup', { delay, gain: 0.9 });
  }

  playWater(): void {
    this.playSample('water');
  }

  /** OB 自体には物理的な音がないので、画面上の通知だけにする。 */
  playOutOfBounds(): void {}

  private playSample(
    name: SampleName,
    options: { playbackRate?: number; gain?: number; delay?: number } = {},
  ): void {
    if (!this.enabled) return;
    const context = this.ensureContext();
    if (context.state !== 'running') return;

    const buffer = this.buffers.get(name);
    if (!buffer) {
      void this.preloadSamples(context);
      return;
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = options.playbackRate ?? 1;

    const gain = context.createGain();
    gain.gain.value = options.gain ?? 1;
    source.connect(gain).connect(context.destination);
    source.start(context.currentTime + (options.delay ?? 0));
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
