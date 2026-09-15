import { discardContext, isContextDead, resumeContext } from './audio-context';

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
 * プレイ中は音数を減らしているため、バス側で十分に持ち上げて効果音の下でも存在感を保つ。
 * トップも同じ方向で前へ出すが、音数が多いためプレイ中より低いバス音量で聴感を揃える。
 */
const MUSIC: Record<MusicScene, MusicSettings> = {
  menu: { bpm: 90, bars: 8, gain: 0.55 },
  play: { bpm: 76, bars: 6, gain: 0.90 },
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
const JINGLE_GAIN = 0.28;
const JINGLE_DUCK_RATIO = 0.78;
/** 「音量を下げる」案だけで使う、現状より小さいジングル音量。 */
const JINGLE_QUIET_GAIN = 0.13;
/** ジングルを鳴らさない案で、カップ音の余韻に重ねてBGMを少しだけ持ち上げる倍率。 */
const JINGLE_LIFT_RATIO = 1.18;
/** ジングルの和音。BGMの1つ目のコード（C6/9）と同じ。 */
const JINGLE_VOICING = [55, 57, 62, 64] as const;
/** 中断明けに、過去へずれた予約位置を現在時刻の少し先まで引き戻す余裕。 */
const RESUME_LEAD_SEC = 0.05;

/**
 * ホールアウトのジングル案。試遊で「浮いて聞こえる」と出たため、
 * `docs/PLAYTEST_BACKLOG.md` §9 の方向をそれぞれ1軸だけ変えた形で持つ。
 * 試聴用ページ（`/jingle-test/`）から選んで鳴らし、採用が決まったら `ACTIVE_JINGLE` を差し替える。
 */
export type JingleVariant =
  /** 現状。低いピックアップ + C6/9の同時和音スタブ2回 + ノイズ */
  | 'current'
  /** 音量だけ下げる */
  | 'quiet'
  /** 同時和音をやめ、BGMと同じ単音の動きにする */
  | 'single'
  /** 矩形波 + ノイズをやめ、トライアングル中心の柔らかい音にする */
  | 'soft'
  /** 鳴らす位置をBGMの拍へ、和音を進行中のコードへ合わせる */
  | 'inTime'
  /** ジングルをやめ、カップ音の余韻 + BGMのわずかな持ち上げだけにする */
  | 'none';

/** 現在ゲーム本編で鳴らしている案。実機試聴で決めるまでは現状のまま。 */
export const ACTIVE_JINGLE: JingleVariant = 'current';

/**
 * ホールアウトの結果。ジングルはこの5段階で鳴らし分ける。
 * 判定の語（BIRDIE / BOGEY …）はスコアカードと同じ区切り方にしてある。
 */
export type HoleOutResult = 'eagle' | 'birdie' | 'par' | 'bogey' | 'double';

type CueNote = {
  note: number;
  /** ジングルの先頭からの位置 [s] */
  at: number;
  duration: number;
  amount: number;
};

type HoleOutCue = {
  /** 下で支える三角波。BGMのベースと同じ音色 */
  bass: readonly CueNote[];
  /** 上の旋律。BGMのPSGと同じ音色で、和音は同時に鳴らさない */
  melody: readonly CueNote[];
  /** ごく薄い高域のきらめきを置く位置 [s]。イーグル以上だけ */
  shimmer?: number;
};

/**
 * 結果別のジングル。BGMを止めてから鳴らす前提なので、今より小さくても十分に聞こえる。
 *
 * 5つとも「2〜4音の同じ形」で、**上へ行くか下へ行くか、途中に♭が入るか**だけが違う。
 * 別々の曲に聞こえないので、9ホール続けて聞いても結果の違いだけが伝わる。
 * 音色はBGMと同じ（三角波のベース + 単音のPSG）。同時和音とノイズヒットは使わない。
 */
const HOLE_OUT_CUES: Record<HoleOutResult, HoleOutCue> = {
  // ソ→ド→ミ→ソ と駆け上がる。滅多に出ないので、ここだけ少し長く贅沢にする
  eagle: {
    bass: [
      { note: 48, at: 0, duration: 0.9, amount: 0.05 },
      { note: 55, at: 0.45, duration: 0.95, amount: 0.036 },
    ],
    melody: [
      { note: 67, at: 0, duration: 0.15, amount: 0.028 },
      { note: 72, at: 0.13, duration: 0.15, amount: 0.03 },
      { note: 76, at: 0.26, duration: 0.15, amount: 0.032 },
      { note: 79, at: 0.39, duration: 1.1, amount: 0.036 },
      // 最後の音だけ1オクターブ上に薄く重ねる（和音ではなく単音）
      { note: 91, at: 0.39, duration: 0.7, amount: 0.01 },
    ],
    shimmer: 0.39,
  },
  // ソ→ド→ミ の上行。最後のミを伸ばし、オクターブ上の単音で明るさを足す
  birdie: {
    bass: [{ note: 48, at: 0, duration: 1.05, amount: 0.05 }],
    melody: [
      { note: 67, at: 0, duration: 0.16, amount: 0.028 },
      { note: 72, at: 0.14, duration: 0.16, amount: 0.031 },
      { note: 76, at: 0.28, duration: 0.9, amount: 0.034 },
      { note: 88, at: 0.28, duration: 0.55, amount: 0.011 },
    ],
  },
  // ソ→ド の2音だけ。主音で着地して「ちゃんと終わった」で終わる。一番地味に
  par: {
    bass: [{ note: 48, at: 0, duration: 0.95, amount: 0.05 }],
    melody: [
      { note: 67, at: 0, duration: 0.18, amount: 0.03 },
      { note: 72, at: 0.16, duration: 0.75, amount: 0.034 },
    ],
  },
  // ラ→ソ→ミ の下行。ベースもラへ動かす（BGMの2つ目のコードと同じ音なので外れない）
  bogey: {
    bass: [{ note: 45, at: 0, duration: 1, amount: 0.048 }],
    melody: [
      { note: 69, at: 0, duration: 0.17, amount: 0.03 },
      { note: 67, at: 0.15, duration: 0.17, amount: 0.028 },
      { note: 64, at: 0.3, duration: 0.8, amount: 0.026 },
    ],
  },
  // ソ→ミ♭→ド の下行。♭が1音入るだけで沈む。一番短く、一番小さく
  double: {
    bass: [{ note: 48, at: 0, duration: 0.75, amount: 0.042 }],
    melody: [
      { note: 67, at: 0, duration: 0.15, amount: 0.026 },
      { note: 63, at: 0.13, duration: 0.15, amount: 0.024 },
      { note: 60, at: 0.26, duration: 0.6, amount: 0.022 },
    ],
  },
};

/** 結果別ジングルの音量。BGMを止めてから鳴らすので、従来（0.28）より小さくてよい。 */
const HOLE_OUT_GAIN = 0.22;
/** カードが出る合図でBGMを引くフェード [s]。 */
const HOLE_OUT_MUTE_FADE = 0.35;
/** 次のホールの開始でBGMを戻すフェード [s]。 */
const HOLE_OUT_RESUME_FADE = 0.7;

export class PuttMusic {
  private context: AudioContext | null = null;
  private enabled = this.loadEnabled();
  private requestedScene: MusicScene = 'menu';
  private activeScene: MusicScene | null = null;
  private bus: GainNode | null = null;
  private scheduledUntil = 0;
  private scheduler: number | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  /** 直近に予約した1周の開始時刻。拍とコードの位置を逆算するために持つ。 */
  private cycleAnchor = 0;
  /** ホールアウトでBGMを引いている間だけ true。曲自体は裏で進み続ける。 */
  private muted = false;

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
    if (!(await resumeContext(context))) return;

    if (!this.bus || this.activeScene !== this.requestedScene) {
      this.startRequestedScene();
      return;
    }
    this.ensureScheduled();
    this.ensureScheduler();
  }

  /**
   * バックグラウンドから戻ったときに呼ぶ。
   * まず resume を試し、それでも復帰しない context だけ作り直して同じシーンを鳴らし直す。
   */
  async revive(): Promise<void> {
    if (!this.enabled) return;
    await this.unlock();

    const context = this.context;
    if (!context) return;
    if (!(await isContextDead(context))) return;

    this.discard();
    await this.unlock();
  }

  private discard(): void {
    this.stopScheduler();
    discardContext(this.context);
    this.context = null;
    this.bus = null;
    this.activeScene = null;
    this.scheduledUntil = 0;
    this.noiseBuffer = null;
    this.cycleAnchor = 0;
    this.muted = false;
  }

  /**
   * ホールアウトの合図（新案）。**スコアカードが出るのと同じ瞬間に呼ぶ。**
   *
   * BGMを速めのフェードで引いてから、結果別のジングルを重ねる。
   * 別々の曲が重なることが「浮く」原因だったので、重なり自体をなくす。
   * BGMは止めずに音量だけ引くので、曲は裏で進み続け、戻したとき毎回同じ出だしにならない。
   *
   * 戻すのは次のホールが始まるとき。`resumeAfterHoleOut()` を呼ぶこと。
   */
  playHoleOutCue(result: HoleOutResult, delay = 0): void {
    if (!this.enabled) return;
    const context = this.ensureContext();
    if (context.state !== 'running') return;

    const start = context.currentTime + delay;
    this.fadeBus(start, MIN_GAIN, HOLE_OUT_MUTE_FADE);
    this.muted = true;

    const cueBus = context.createGain();
    cueBus.gain.value = HOLE_OUT_GAIN;
    cueBus.connect(context.destination);

    const cue = HOLE_OUT_CUES[result];
    let end = 0;
    for (const note of cue.bass) {
      this.scheduleTriangle(note.note, start + note.at, note.duration, note.amount, cueBus);
      end = Math.max(end, note.at + note.duration);
    }
    for (const note of cue.melody) {
      this.scheduleSquare(note.note, start + note.at, note.duration, note.amount, cueBus, 3000);
      end = Math.max(end, note.at + note.duration);
    }
    if (cue.shimmer !== undefined) {
      this.scheduleNoise(start + cue.shimmer, 0.5, 0.0035, cueBus, 7200, 1.2, 13);
      end = Math.max(end, cue.shimmer + 0.5);
    }

    window.setTimeout(
      () => cueBus.disconnect(),
      Math.ceil((start - context.currentTime + end + 0.2) * 1000),
    );
  }

  /** 次のホールの開始で呼ぶ。引いていたBGMを戻す。 */
  resumeAfterHoleOut(delay = 0): void {
    if (!this.muted) return;
    this.muted = false;

    const context = this.context;
    const scene = this.activeScene;
    if (!context || context.state !== 'running' || !scene) return;
    this.fadeBus(context.currentTime + delay, MUSIC[scene].gain, HOLE_OUT_RESUME_FADE);
  }

  /** BGMのバスを、指定時刻から目標音量へ滑らかに動かす。 */
  private fadeBus(at: number, target: number, fade: number): void {
    const context = this.context;
    if (!this.bus || !context) return;
    const gain = this.bus.gain;
    const from = Math.max(context.currentTime, at);
    const current = Math.max(gain.value, MIN_GAIN);
    gain.cancelScheduledValues(from);
    gain.setValueAtTime(current, from);
    gain.exponentialRampToValueAtTime(Math.max(target, MIN_GAIN), from + fade);
  }

  /**
   * ホールアウトのジングル。
   * カップ音の余韻を十分に聞かせてから入るため、既定は約1秒遅らせる。
   * 案の比較中なので、どの形で鳴らすかは `variant` で選べるようにしてある。
   */
  playHoleOutJingle(delay = 1, variant: JingleVariant = ACTIVE_JINGLE): void {
    if (!this.enabled) return;
    const context = this.ensureContext();
    if (context.state !== 'running') return;

    const requested = context.currentTime + delay;
    if (variant === 'none') {
      this.liftMusic(context, requested);
      return;
    }

    // 拍へ合わせる案だけ、BGMの次の拍まで待ち、和音も進行中のコードへ合わせる。
    const spot = variant === 'inTime' ? this.beatAt(requested) : null;
    const start = spot ? spot.time : requested;
    const voicing = spot ? spot.chord.voicing : JINGLE_VOICING;
    const root = spot ? spot.chord.root : 48;
    const beat = this.beatSec();

    const jingleBus = context.createGain();
    jingleBus.gain.value = variant === 'quiet' ? JINGLE_QUIET_GAIN : JINGLE_GAIN;
    jingleBus.connect(context.destination);

    let tail = 0.6;
    if (variant === 'single') {
      // 同時に鳴らさず、BGMのPSGと同じ単音の動きで和声を出す。
      this.scheduleTriangle(root, start, 0.3, 0.055, jingleBus);
      const step = 0.085;
      for (let k = 0; k < voicing.length; k++) {
        this.scheduleSquare(voicing[k], start + 0.1 + k * step, 0.19, 0.034, jingleBus, 3000);
      }
      const last = 0.1 + (voicing.length - 1) * step;
      this.scheduleNoise(start + last, 0.03, 0.01, jingleBus, 2600, 0.8, 7);
      tail = last + 0.3;
    } else if (variant === 'soft') {
      // 矩形波とノイズをやめ、BGMのベースと同じトライアングルだけで組む。
      this.scheduleTriangle(root, start, 0.34, 0.05, jingleBus);
      const step = 0.1;
      for (let k = 0; k < voicing.length; k++) {
        this.scheduleTriangle(voicing[k] - 12, start + 0.12 + k * step, 0.36, 0.042, jingleBus);
      }
      tail = 0.12 + (voicing.length - 1) * step + 0.4;
    } else {
      // 現状の形。ピックアップ + 同時和音スタブ2回 + ノイズ。
      // 拍へ合わせる案では、ピックアップを拍の前へ置き、スタブを拍の上に乗せる。
      const pickup = spot ? -beat * 0.5 : 0;
      const hits = spot
        ? ([
            [0, 0.038],
            [beat * 0.5, 0.027],
          ] as const)
        : ([
            [0.1, 0.038],
            [0.34, 0.027],
          ] as const);
      this.scheduleTriangle(root, start + pickup, 0.3, 0.055, jingleBus);
      for (const [hit, amount] of hits) {
        for (const note of voicing) {
          this.scheduleSquare(note, start + hit, 0.19, amount, jingleBus, 3000);
        }
      }
      const last = hits[hits.length - 1][0];
      this.scheduleNoise(start + last, 0.03, 0.01, jingleBus, 2600, 0.8, 7);
      tail = last + 0.3;
    }

    this.duckMusic(context, start);
    const stop = start - context.currentTime + tail;
    window.setTimeout(() => jingleBus.disconnect(), Math.ceil(stop * 1000));
  }

  /** ジングル時もプレイBGMを大きく引っ込めず、曲の流れを保つ。 */
  private duckMusic(context: AudioContext, start: number): void {
    if (!this.bus || !this.activeScene) return;
    const base = MUSIC[this.activeScene].gain;
    const gain = this.bus.gain;
    const duckStart = Math.max(context.currentTime, start - 0.06);
    gain.cancelScheduledValues(duckStart);
    gain.setValueAtTime(base, duckStart);
    gain.linearRampToValueAtTime(base * JINGLE_DUCK_RATIO, start + 0.04);
    gain.setValueAtTime(base * JINGLE_DUCK_RATIO, start + 0.55);
    gain.linearRampToValueAtTime(base, start + 0.95);
  }

  /** ジングルを鳴らさない案。入った合図はカップ音に任せ、BGMをわずかに持ち上げるだけにする。 */
  private liftMusic(context: AudioContext, start: number): void {
    if (!this.bus || !this.activeScene) return;
    const base = MUSIC[this.activeScene].gain;
    const gain = this.bus.gain;
    const from = Math.max(context.currentTime, start - 0.4);
    gain.cancelScheduledValues(from);
    gain.setValueAtTime(base, from);
    gain.linearRampToValueAtTime(base * JINGLE_LIFT_RATIO, start + 0.3);
    gain.setValueAtTime(base * JINGLE_LIFT_RATIO, start + 1.6);
    gain.linearRampToValueAtTime(base, start + 2.5);
  }

  private beatSec(): number {
    return 60 / MUSIC[this.activeScene ?? this.requestedScene].bpm;
  }

  /**
   * 指定時刻以降で最初に来るBGMの拍と、そこで鳴っているコードを返す。
   * 1周の開始時刻からの位置で求めるので、予約済みの先の拍でも逆算できる。
   */
  private beatAt(time: number): { time: number; chord: Chord } | null {
    const scene = this.activeScene;
    if (!scene || !this.bus || this.cycleAnchor === 0) return null;

    const settings = MUSIC[scene];
    const beat = 60 / settings.bpm;
    const bar = 4 * beat;
    const cycle = settings.bars * bar;

    const steps = Math.ceil((time - this.cycleAnchor) / beat - 1e-6);
    const beatTime = this.cycleAnchor + steps * beat;
    const phase = (((beatTime - this.cycleAnchor) % cycle) + cycle) % cycle;
    const barIndex = Math.floor(phase / bar);
    return { time: beatTime, chord: PROGRESSION[barIndex % PROGRESSION.length] };
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

    this.stopScheduler();

    const now = context.currentTime;
    const bus = context.createGain();
    bus.gain.setValueAtTime(0, now);
    bus.gain.linearRampToValueAtTime(MUSIC[this.requestedScene].gain, now + SCENE_FADE_SEC);
    bus.connect(context.destination);

    this.bus = bus;
    this.muted = false;
    this.activeScene = this.requestedScene;
    this.scheduledUntil = now + RESUME_LEAD_SEC;
    this.ensureScheduled();
    this.ensureScheduler();
  }

  private ensureScheduler(): void {
    if (this.scheduler !== null) return;
    this.scheduler = window.setInterval(() => this.ensureScheduled(), SCHEDULER_MS);
  }

  private stopScheduler(): void {
    if (this.scheduler === null) return;
    window.clearInterval(this.scheduler);
    this.scheduler = null;
  }

  private ensureScheduled(): void {
    const context = this.context;
    const bus = this.bus;
    const scene = this.activeScene;
    if (!context || context.state !== 'running' || !bus || !scene) return;

    // 中断中に時計だけ進んだ場合、過去ぶんをまとめて鳴らさずに現在位置から続ける。
    if (this.scheduledUntil < context.currentTime) {
      this.scheduledUntil = context.currentTime + RESUME_LEAD_SEC;
    }

    const settings = MUSIC[scene];
    const cycleSec = settings.bars * 4 * (60 / settings.bpm);
    const target = context.currentTime + LOOK_AHEAD_SEC;
    while (this.scheduledUntil < target) {
      this.scheduleCycle(scene, this.scheduledUntil, bus);
      this.scheduledUntil += cycleSec;
    }
  }

  private scheduleCycle(scene: MusicScene, start: number, bus: GainNode): void {
    this.cycleAnchor = start;
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
