const STORAGE_KEY = 'putt-sound-enabled';

export type MusicScene = 'menu' | 'play' | 'roundEnd';

type MusicSettings = {
  bpm: number;
  bars: number;
  gain: number;
};

type Chord = {
  root: number;
  voicing: readonly number[];
};

/**
 * 試聴で確定した「大人っぽいゴルフ感 + チープなゲーム音色」を Web Audio で組み立てる。
 * BGMでは同時和音を前へ出さず、ベース + 単音PSG + ノイズだけで和声感を作る。
 *
 * トップは短いPSGモチーフ、プレイ中はベース + リズム中心にして、同じ世界観の別アレンジとして明確に分ける。
 */
const MUSIC: Record<MusicScene, MusicSettings> = {
  menu: { bpm: 90, bars: 8, gain: 0.18 },
  play: { bpm: 76, bars: 6, gain: 0.28 },
  roundEnd: { bpm: 88, bars: 6, gain: 0.17 },
};

const PROGRESSION: readonly Chord[] = [
  { root: 48, voicing: [55, 57, 62, 64] }, // C6/9
  { root: 45, voicing: [52, 55, 59, 62] }, // A7sus4(add9)
  { root: 50, voicing: [53, 60, 64, 65] }, // Dm9
  { root: 43, voicing: [50, 53, 57, 64] }, // G13sus4
];

const MOTIF = [55, 57, 62, 59, 57, 55, 52, 55] as const;
const LOOK_AHEAD_SEC = 10;
const SCHEDULER_MS = 2500;
const SCENE_FADE_SEC = 0.35;
const MIN_GAIN = 0.0001;
const JINGLE_GAIN = 0.58;
const JINGLE_DUCK_RATIO = 0.45;

export class PuttMusic {
  private context: AudioContext | null = null;
  private enabled = this.loadEnabled();
  private requestedScene: MusicScene = 'menu';
  private activeScene: MusicScene | null = null;
  private bus: GainNode | null = null;
  private scheduledUntil = 0;
  private scheduler: number | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  setScene(scene: MusicScene): void {
    if (this.requestedScene === scene && this.activeScene === scene && this.bus) return;
    this.requestedScene = scene;
    if (this.context?.state === 'running' && this.enabled) this.startRequestedScene();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) {
      void this.unlock();
    } else if (this.context?.state === 'running') {
      void this.context.suspend();
    }
  }

  /** iOS Safari 向け。必ずユーザー操作から呼ぶ。 */
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
    if (context.state === 'running') {
      if (!this.bus || this.activeScene !== this.requestedScene) this.startRequestedScene();
      else this.ensureScheduled();
    }
  }

  /**
   * ホールアウトだけは選定済みB案を残す。
   * 低いピックアップ + C6/9の短いコードスタブを2回だけ鳴らす。
   * カップ音の余韻を十分に聞かせてから入るため、既定は約1秒遅らせる。
   */
  playHoleOutJingle(delay = 1): void {
    if (!this.enabled) return;
    const context = this.ensureContext();
    if (context.state !== 'running') return;

    const start = context.currentTime + delay;
    const jingleBus = context.createGain();
    jingleBus.gain.value = JINGLE_GAIN;
    jingleBus.connect(context.destination);

    this.scheduleTriangle(48, start, 0.3, 0.055, jingleBus);
    const voicing = [55, 57, 62, 64] as const;
    for (const [hit, amount] of [
      [0.1, 0.038],
      [0.34, 0.027],
    ] as const) {
      for (const note of voicing) {
        this.scheduleSquare(note, start + hit, 0.19, amount, jingleBus, 3000);
      }
    }
    this.scheduleNoise(start + 0.34, 0.03, 0.01, jingleBus, 2600, 0.8, 7);

    // ジングルだけ少し前へ出す。ただしBGMを消し切らず、曲の流れは保つ。
    if (this.bus && this.activeScene) {
      const base = MUSIC[this.activeScene].gain;
      const gain = this.bus.gain;
      const duckStart = Math.max(context.currentTime, start - 0.06);
      gain.cancelScheduledValues(duckStart);
      gain.setValueAtTime(base, duckStart);
      gain.linearRampToValueAtTime(base * JINGLE_DUCK_RATIO, start + 0.04);
      gain.setValueAtTime(base * JINGLE_DUCK_RATIO, start + 0.55);
      gain.linearRampToValueAtTime(base, start + 0.95);
    }

    window.setTimeout(() => jingleBus.disconnect(), Math.ceil((delay + 1.25) * 1000));
  }

  private startRequestedScene(): void {
    const context = this.ensureContext();
    if (context.state !== 'running') return;

    const oldBus = this.bus;
    if (oldBus) {
      const now = context.currentTime;
      oldBus.gain.cancelScheduledValues(now);
      oldBus.gain.setValueAtTime(oldBus.gain.value, now);
      oldBus.gain.linearRampToValueAtTime(0, now + SCENE_FADE_SEC);
      window.setTimeout(() => oldBus.disconnect(), Math.ceil((SCENE_FADE_SEC + 0.1) * 1000));
    }

    if (this.scheduler !== null) {
      window.clearInterval(this.scheduler);
      this.scheduler = null;
    }

    const now = context.currentTime;
    const bus = context.createGain();
    bus.gain.setValueAtTime(0, now);
    bus.gain.linearRampToValueAtTime(MUSIC[this.requestedScene].gain, now + SCENE_FADE_SEC);
    bus.connect(context.destination);

    this.bus = bus;
    this.activeScene = this.requestedScene;
    this.scheduledUntil = now + 0.05;
    this.ensureScheduled();
    this.scheduler = window.setInterval(() => this.ensureScheduled(), SCHEDULER_MS);
  }

  private ensureScheduled(): void {
    const context = this.context;
    const bus = this.bus;
    const scene = this.activeScene;
    if (!context || context.state !== 'running' || !bus || !scene) return;

    const settings = MUSIC[scene];
    const cycleSec = settings.bars * 4 * (60 / settings.bpm);
    const target = context.currentTime + LOOK_AHEAD_SEC;
    while (this.scheduledUntil < target) {
      this.scheduleCycle(scene, this.scheduledUntil, bus);
      this.scheduledUntil += cycleSec;
    }
  }

  private scheduleCycle(scene: MusicScene, start: number, bus: GainNode): void {
    const settings = MUSIC[scene];
    const beat = 60 / settings.bpm;
    const bar = 4 * beat;

    for (let b = 0; b < settings.bars; b++) {
      const chord = PROGRESSION[b % PROGRESSION.length];
      const barStart = start + b * bar;

      // ベースを曲の主軸にする。低すぎない三角波でルート・5度・経過音を動かす。
      const bassline =
        scene === 'play'
          ? [
              // プレイ中はトップと明確に分け、短いシンコペーション主体のベースにする。
              [0, chord.root, 0.056],
              [0.75, chord.root + 12, 0.031],
              [1.5, chord.root + 7, 0.043],
              [2.5, chord.root, 0.052],
              [3.25, chord.root + 7, 0.038],
              [3.75, chord.root + 12, 0.028],
            ]
          : [
              [0, chord.root, 0.064],
              [1.25, chord.root + 7, 0.038],
              [2, chord.root + 5, 0.034],
              [2.75, chord.root, 0.05],
              [3.5, chord.root + 7, 0.031],
            ];
      for (const [offset, note, amount] of bassline) {
        this.scheduleTriangle(note, barStart + offset * beat, beat * 0.5, amount, bus);
      }

      if (scene !== 'play') {
        // トップ/終了だけ、コード構成音を1音ずつ置いて和声をはっきり聞かせる。
        const sequence = [
          chord.voicing[0],
          chord.voicing[2],
          chord.voicing[1],
          chord.voicing[3],
        ];
        for (let k = 0; k < 8; k++) {
          this.scheduleSquare(
            sequence[k % sequence.length],
            barStart + k * beat * 0.5,
            beat * 0.11,
            0.0065,
            bus,
            2500,
          );
        }

        this.scheduleKick(barStart, 0.038, bus);
        this.scheduleNoise(barStart + 2 * beat, 0.075, 0.008, bus, 2400, 0.7, b + 31);
        for (let half = 1; half < 8; half++) {
          this.scheduleNoise(
            barStart + half * beat * 0.5,
            0.032,
            0.0035,
            bus,
            6200,
            1.5,
            b * 11 + half,
          );
        }
      } else {
        // プレイ中はメロディ/分散和音を外し、ベースと乾いたリズムだけに寄せる。
        this.scheduleKick(barStart, 0.032, bus);
        this.scheduleKick(barStart + 2.5 * beat, 0.022, bus);
        this.scheduleNoise(barStart + 1.5 * beat, 0.055, 0.0048, bus, 2200, 0.8, b + 41);
        this.scheduleNoise(barStart + 3.5 * beat, 0.055, 0.0048, bus, 2200, 0.8, b + 47);
        for (const half of [1, 3, 5, 7]) {
          this.scheduleNoise(
            barStart + half * beat * 0.5,
            0.028,
            0.0028,
            bus,
            5900,
            1.6,
            b * 13 + half,
          );
        }
      }
    }

    // メロディは主役にせず、短いPSGフレーズだけにする。
    if (scene === 'menu') {
      const base = start + 0.5 * bar;
      for (let k = 0; k < MOTIF.length; k++) {
        this.scheduleSquare(MOTIF[k] + 12, base + k * beat * 0.5, beat * 0.2, 0.008, bus, 3300);
      }
    } else if (scene === 'play') {
      // プレイ中はトップのモチーフを鳴らさず、同じ世界観の「伴奏版」として区別する。
    } else {
      for (let k = 0; k < MOTIF.length; k++) {
        this.scheduleSquare(MOTIF[k] + 12, start + k * beat * 0.5, beat * 0.2, 0.009, bus, 3300);
      }
      const tagStart = start + (settings.bars - 1) * bar + 0.4 * beat;
      const tag = [57, 59, 62, 59, 55] as const;
      for (let k = 0; k < tag.length; k++) {
        this.scheduleSquare(
          tag[k] + 12,
          tagStart + k * beat * 0.52,
          beat * (k < tag.length - 1 ? 0.2 : 0.52),
          0.0095,
          bus,
          3100,
        );
      }
    }
  }

  private scheduleSquare(
    note: number,
    start: number,
    duration: number,
    amount: number,
    destination: AudioNode,
    lowpassHz: number,
  ): void {
    const context = this.ensureContext();
    const oscillator = context.createOscillator();
    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(this.midi(note), start);

    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = lowpassHz;
    filter.Q.value = 0.7;

    const gain = context.createGain();
    gain.gain.setValueAtTime(MIN_GAIN, start);
    gain.gain.linearRampToValueAtTime(amount, start + 0.003);
    gain.gain.exponentialRampToValueAtTime(MIN_GAIN, start + duration);

    oscillator.connect(filter).connect(gain).connect(destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  private scheduleTriangle(
    note: number,
    start: number,
    duration: number,
    amount: number,
    destination: AudioNode,
  ): void {
    const context = this.ensureContext();
    const oscillator = context.createOscillator();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(this.midi(note), start);

    const gain = context.createGain();
    gain.gain.setValueAtTime(MIN_GAIN, start);
    gain.gain.linearRampToValueAtTime(amount, start + 0.004);
    gain.gain.exponentialRampToValueAtTime(MIN_GAIN, start + duration);

    oscillator.connect(gain).connect(destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  private scheduleKick(start: number, amount: number, destination: AudioNode): void {
    const context = this.ensureContext();
    const oscillator = context.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(78, start);
    oscillator.frequency.exponentialRampToValueAtTime(52, start + 0.085);

    const gain = context.createGain();
    gain.gain.setValueAtTime(amount, start);
    gain.gain.exponentialRampToValueAtTime(MIN_GAIN, start + 0.09);

    oscillator.connect(gain).connect(destination);
    oscillator.start(start);
    oscillator.stop(start + 0.1);
  }

  private scheduleNoise(
    start: number,
    duration: number,
    amount: number,
    destination: AudioNode,
    frequency: number,
    q: number,
    seed: number,
  ): void {
    const context = this.ensureContext();
    const source = context.createBufferSource();
    source.buffer = this.ensureNoiseBuffer(context);

    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = frequency;
    filter.Q.value = q;

    const gain = context.createGain();
    gain.gain.setValueAtTime(amount, start);
    gain.gain.exponentialRampToValueAtTime(MIN_GAIN, start + duration);

    source.connect(filter).connect(gain).connect(destination);
    const maxOffset = Math.max(0, source.buffer.duration - duration - 0.01);
    const offset = maxOffset > 0 ? ((seed * 0.137) % 1) * maxOffset : 0;
    source.start(start, offset, duration);
  }

  private ensureNoiseBuffer(context: AudioContext): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer;
    const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const data = buffer.getChannelData(0);
    let state = 0x51a7c3d9;
    for (let i = 0; i < data.length; i++) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      data[i] = ((state >>> 0) / 0xffffffff) * 2 - 1;
    }
    this.noiseBuffer = buffer;
    return buffer;
  }

  private midi(note: number): number {
    return 440 * Math.pow(2, (note - 69) / 12);
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

export const puttMusic = new PuttMusic();
