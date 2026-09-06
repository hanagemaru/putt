// 効果音。音源ファイルは持たず、WebAudio の発振器とノイズだけで合成する。
// **狙いはリアルさではなくコミカルさ。** 打球音や水音を実物へ寄せず、
// ピッチの滑り・跳ね・揺れで「マンガの効果音」を作る。
// 数値は全て CONFIG.audio に置く（ここにマジックナンバーを書かない）。
//
// スマホのブラウザは最初のユーザー操作までAudioContextを動かさないので、
// 最初の pointerdown / click / keydown で解錠する。ミュートは localStorage に残す。
import { CONFIG } from './config';
import type { SurfaceType } from './course/course-types';

const A = CONFIG.audio;

/** ミュート設定の保存先。localStorage が使えない環境でも落とさない */
const STORAGE_KEY = 'putt-sound-muted';

/** 転がり音のノイズ源に使う長さ [s]。継ぎ目が気にならない程度にとってある */
const NOISE_SECONDS = 2;

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

function loadMuted(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function saveMuted(muted: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, muted ? '1' : '0');
  } catch {
    // 保存できないだけなので無視する（音は鳴る）
  }
}

interface ToneOptions {
  freq: number;
  /** 終わりの周波数。省略時は freq のまま */
  endFreq?: number;
  gain: number;
  decay: number;
  /** 呼び出しから鳴りはじめるまで [s] */
  delay?: number;
  type?: OscillatorType;
  /** 揺らし（ボヨン・ブブー）の速さ [Hz] と深さ [cent]。両方あるときだけ掛かる */
  wobbleHz?: number;
  wobbleCents?: number;
}

interface NoiseOptions {
  gain: number;
  decay: number;
  freq: number;
  endFreq?: number;
  q?: number;
  delay?: number;
  filter?: BiquadFilterType;
}

/** 転がり音の地面別パラメータ。芝以外（池・OB）は転がらないので鳴らさない */
function rollVoice(surface: SurfaceType | null) {
  if (surface === 'green') return A.roll.green;
  if (surface === 'rough') return A.roll.rough;
  if (surface === 'deepRough') return A.roll.deepRough;
  return null;
}

class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  /**
   * 転がり音。1本のノイズ源を鳴らしっぱなしにして、音量と帯域だけ動かす。
   * さらに LFO で音量を刻んで「ガサガサ」にする
   */
  private rollGain: GainNode | null = null;
  private rollFilter: BiquadFilterNode | null = null;
  private rollTremoloOsc: OscillatorNode | null = null;
  private rollTremoloDepth: GainNode | null = null;
  private rollTremoloBase: GainNode | null = null;

  private muted = loadMuted();
  private unlockBound = false;

  /** 効果音が有効か（＝ミュートしていないか） */
  get enabled(): boolean {
    return !this.muted;
  }

  /**
   * 最初のユーザー操作で鳴らせるようにする。何度呼んでもよい。
   * 音を鳴らす関数の入口からも呼ぶので、解錠を取りこぼさない
   */
  unlock(): void {
    this.ensureContext();
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** ページ内のボタンとタップで自動的に解錠する。エントリから一度だけ呼ぶ */
  install(): void {
    if (this.unlockBound) return;
    this.unlockBound = true;
    const unlock = (): void => this.unlock();
    document.addEventListener('pointerdown', unlock, { capture: true, passive: true });
    document.addEventListener('keydown', unlock, { capture: true });
    // ボタンの操作音は1か所でまとめて鳴らす。画面ごとに配線しない
    document.addEventListener(
      'click',
      (event) => {
        const target = event.target as Element | null;
        if (target?.closest('button')) this.button();
      },
      { capture: true },
    );
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.stopRoll();
    });
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    saveMuted(muted);
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(muted ? 0 : A.masterGain, t, A.muteFade);
    if (muted) this.stopRoll();
  }

  /** ミュートを切り替えて、切り替え後の状態（true = 鳴る）を返す */
  toggleMuted(): boolean {
    this.unlock();
    this.setMuted(!this.muted);
    return !this.muted;
  }

  // --- 個別の音 -----------------------------------------------------------

  /** ボタンを押した。上へ跳ねる「ピッ」 */
  button(): void {
    this.tone({
      freq: A.ui.buttonFreq,
      endFreq: A.ui.buttonEndFreq,
      gain: A.ui.buttonGain,
      decay: A.ui.buttonDecay,
      type: 'square',
    });
  }

  /** 画面タップで次へ進んだ。ボタンより低く小さい */
  tap(): void {
    this.tone({
      freq: A.ui.tapFreq,
      endFreq: A.ui.tapEndFreq,
      gain: A.ui.tapGain,
      decay: A.ui.tapDecay,
      type: 'square',
    });
  }

  /**
   * インパクト。栓を抜くような「ポンッ」。
   * 強く打つほど高く大きくなるので、音だけで強さが分かる
   */
  impact(speedMs: number): void {
    const ratio = Math.min(1, Math.max(0, speedMs) / A.impact.fullSpeed);
    const scale = A.impact.minGainRatio + (1 - A.impact.minGainRatio) * ratio;
    const endFreq = A.impact.endFreqMin + (A.impact.endFreqMax - A.impact.endFreqMin) * ratio;
    this.tone({
      freq: A.impact.startFreq,
      endFreq,
      gain: A.impact.gain * scale,
      decay: A.impact.decay,
      type: 'sine',
    });
    // 当たった瞬間の「コッ」だけノイズで足す。長く鳴らすと現実の打球音に寄る
    this.noise({
      gain: A.impact.tickGain * scale,
      decay: A.impact.tickDecay,
      freq: A.impact.tickFreq,
      filter: 'highpass',
    });
  }

  /** 旗竿に当たった。金属音ではなく跳ね返る「ボヨン」 */
  flagstick(): void {
    this.tone({
      freq: A.flagstick.startFreq,
      endFreq: A.flagstick.endFreq,
      gain: A.flagstick.gain,
      decay: A.flagstick.decay,
      type: 'square',
      wobbleHz: A.flagstick.wobbleHz,
      wobbleCents: A.flagstick.wobbleCents,
    });
  }

  /** カップの縁をなめて出ていった。かすめる「ヒュッ」 */
  lipOut(): void {
    this.tone({
      freq: A.lipOut.startFreq,
      endFreq: A.lipOut.endFreq,
      gain: A.lipOut.gain,
      decay: A.lipOut.decay,
      type: 'sine',
    });
  }

  /** カップイン。「ポコン」のあとにごほうびの3音 */
  holed(): void {
    this.tone({
      freq: A.holed.popStartFreq,
      endFreq: A.holed.popEndFreq,
      gain: A.holed.popGain,
      decay: A.holed.popDecay,
      type: 'sine',
    });
    A.holed.chimeRatios.forEach((ratio, i) => {
      this.tone({
        freq: A.holed.chimeBaseFreq * ratio,
        gain: A.holed.chimeGain,
        decay: A.holed.chimeDecay,
        delay: A.holed.chimeDelay + A.holed.chimeInterval * i,
        type: 'square',
      });
    });
  }

  /** 池へ入った。落ちる「ヒュ〜」→「ポチャン」→泡 */
  water(): void {
    this.tone({
      freq: A.water.slideStartFreq,
      endFreq: A.water.slideEndFreq,
      gain: A.water.slideGain,
      decay: A.water.slideDecay,
      type: 'sine',
    });
    this.tone({
      freq: A.water.plopStartFreq,
      endFreq: A.water.plopEndFreq,
      gain: A.water.plopGain,
      decay: A.water.plopDecay,
      delay: A.water.plopDelay,
      type: 'sine',
    });
    this.tone({
      freq: A.water.bubbleStartFreq,
      endFreq: A.water.bubbleEndFreq,
      gain: A.water.bubbleGain,
      decay: A.water.bubbleDecay,
      delay: A.water.bubbleDelay,
      type: 'sine',
    });
  }

  /** OBへ出た。ずっこける「ブブー」 */
  outOfBounds(): void {
    this.tone({
      freq: A.ob.firstFreq,
      gain: A.ob.gain,
      decay: A.ob.decay,
      type: 'sawtooth',
      wobbleHz: A.ob.wobbleHz,
      wobbleCents: A.ob.wobbleCents,
    });
    // 2音目は最後に滑り落ちる。ここが「ずっこけ」の芯
    this.tone({
      freq: A.ob.secondFreq,
      endFreq: A.ob.endFreq,
      gain: A.ob.gain,
      decay: A.ob.decay * 1.6,
      delay: A.ob.interval,
      type: 'sawtooth',
      wobbleHz: A.ob.wobbleHz,
      wobbleCents: A.ob.wobbleCents,
    });
  }

  /** ホールアウトのカード */
  holeOutJingle(): void {
    this.jingle(A.jingle.holeOut);
  }

  /** ラウンド終了・練習終了のカード */
  roundEndJingle(): void {
    this.jingle(A.jingle.roundEnd);
  }

  // --- 転がり音 -----------------------------------------------------------

  /**
   * 転がっている間、毎フレーム呼ぶ。地面と速度で音量と音色が変わる。
   * ラフでは「ガサガサ」と鳴り、芝の上ではほとんど聞こえない
   */
  setRoll(surface: SurfaceType | null, speedMs: number): void {
    const voice = rollVoice(surface);
    if (!voice || this.muted) {
      this.stopRoll();
      return;
    }
    if (!this.ensureRoll()) return;
    const ctx = this.ctx!;
    const ratio = Math.min(1, Math.max(0, speedMs) / A.roll.fullSpeed);
    const t = ctx.currentTime;
    this.rollGain!.gain.setTargetAtTime(voice.gain * ratio, t, A.roll.tau);
    this.rollFilter!.frequency.setTargetAtTime(voice.freq, t, A.roll.tau);
    this.rollFilter!.Q.value = voice.q;
    // 芝の上（tremoloHz = 0）は刻まない。ラフだけ「ガサガサ」と途切れて鳴る。
    // 刻みは音量の**上限を 1 に保ったまま**下へ掘るので、揺らしても音量は上がらない
    const swing = voice.tremoloHz > 0 ? A.roll.tremoloDepth / 2 : 0;
    this.rollTremoloOsc!.frequency.setTargetAtTime(voice.tremoloHz, t, A.roll.tau);
    this.rollTremoloDepth!.gain.setTargetAtTime(swing, t, A.roll.tau);
    this.rollTremoloBase!.gain.setTargetAtTime(1 - swing, t, A.roll.tau);
  }

  /** 転がり音を止める。ボールが止まった・画面を離れたときに呼ぶ */
  stopRoll(): void {
    if (!this.ctx || !this.rollGain) return;
    this.rollGain.gain.setTargetAtTime(0, this.ctx.currentTime, A.roll.tau);
  }

  // --- 合成の下ごしらえ ---------------------------------------------------

  private jingle(notes: readonly number[]): void {
    notes.forEach((ratio, i) => {
      this.tone({
        freq: A.jingle.baseFreq * ratio,
        gain: A.jingle.gain,
        decay: A.jingle.decay,
        delay: A.jingle.noteInterval * i,
        type: 'square',
      });
    });
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = audioContextCtor();
    if (!Ctor) return null;
    try {
      this.ctx = new Ctor();
    } catch {
      return null;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : A.masterGain;
    // コンプレッサは挟まない。Chrome の DynamicsCompressor は閾値以下でも
    // 全体を約 10dB 削り、インパクトの立ち上がりまで鈍らせる。
    // 音量は個々の gain の合計が 1 を超えないように配分してある
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  /** ホワイトノイズ。生成は一度だけで、以後は使い回す */
  private ensureNoise(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer;
    const length = Math.floor(ctx.sampleRate * NOISE_SECONDS);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;
    return buffer;
  }

  /** 転がり音の常時ノイズ源。初回だけ作って鳴らしっぱなしにする */
  private ensureRoll(): boolean {
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return false;
    if (ctx.state === 'suspended') void ctx.resume();
    if (this.rollGain) return true;

    const source = ctx.createBufferSource();
    source.buffer = this.ensureNoise(ctx);
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = A.roll.green.freq;
    filter.Q.value = A.roll.green.q;

    const gain = ctx.createGain();
    gain.gain.value = 0;

    // 音量を刻む LFO。深さぶんだけ音量を上下させる（深さ 0 なら素通し）
    const tremolo = ctx.createGain();
    tremolo.gain.value = 1;
    this.rollTremoloBase = tremolo;
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = A.roll.rough.tremoloHz;
    const depth = ctx.createGain();
    depth.gain.value = 0;
    lfo.connect(depth).connect(tremolo.gain);
    lfo.start();

    source.connect(filter).connect(gain).connect(tremolo).connect(this.master);
    source.start();

    this.rollFilter = filter;
    this.rollGain = gain;
    this.rollTremoloOsc = lfo;
    this.rollTremoloDepth = depth;
    return true;
  }

  /** 単音。周波数は始めから終わりへ指数で動かす */
  private tone(options: ToneOptions): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.master || this.muted) return;
    if (ctx.state === 'suspended') void ctx.resume();

    const t0 = ctx.currentTime + (options.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = options.type ?? 'sine';
    osc.frequency.setValueAtTime(options.freq, t0);
    if (options.endFreq !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, options.endFreq), t0 + options.decay);
    }

    const gain = ctx.createGain();
    // 立ち上がりを一瞬だけなだらかにする（0 から始めないとプツッと鳴る）
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(options.gain, t0 + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + options.decay);

    if (options.wobbleHz && options.wobbleCents) {
      // 音程を細かく揺らす。バネの「ボヨン」やずっこけの「ブブー」はこれで出る
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(options.wobbleHz, t0);
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(options.wobbleCents, t0);
      lfo.connect(depth).connect(osc.detune);
      lfo.start(t0);
      lfo.stop(t0 + options.decay + 0.02);
    }

    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + options.decay + 0.02);
  }

  /** ノイズを1発。帯域を動かすと「シャッ」「ポチャン」になる */
  private noise(options: NoiseOptions): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.master || this.muted) return;
    if (ctx.state === 'suspended') void ctx.resume();

    const t0 = ctx.currentTime + (options.delay ?? 0);
    const source = ctx.createBufferSource();
    source.buffer = this.ensureNoise(ctx);
    // 同じ波形が続けて鳴っても同じに聞こえないよう、読み出し位置をずらす
    const offset = Math.random() * (NOISE_SECONDS - options.decay - 0.05);

    const filter = ctx.createBiquadFilter();
    filter.type = options.filter ?? 'bandpass';
    filter.frequency.setValueAtTime(options.freq, t0);
    if (options.endFreq !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(
        Math.max(1, options.endFreq),
        t0 + options.decay,
      );
    }
    if (options.q !== undefined) filter.Q.value = options.q;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(options.gain, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + options.decay);

    source.connect(filter).connect(gain).connect(this.master);
    source.start(t0, Math.max(0, offset), options.decay + 0.05);
  }
}

export const audio = new GameAudio();
