// コースマップのボール・カップ位置マーカー（spec §3）。
//
// 真上からの俯瞰では実寸のボール（半径21mm）もカップも点にならないので、
// マーカーを重ねて「どこか」と「そこが何か」を示す。
// ボールは**斜めの矢印とピクセル文字**、カップは**旗の絵**。
// ゲーム画面は 1/3 解像度＋色の量子化でドット絵にしているので、マーカーも
// アンチエイリアスのない矩形ドットだけで組み、同じ粒に揃える。
//
// 曲がりの予測線・推奨ルートはここでも描かない。示すのは2点の位置だけ。
import * as THREE from 'three';
import { CONFIG } from './config';

const M = CONFIG.game.courseMap;

/** 字形そのものの寸法。フォントのデータと一体なのでここに置く */
const GLYPH_W = 5;
const GLYPH_H = 7;
/** 字間 [アートピクセル] */
const GLYPH_GAP = 1;
/** ラベルと矢印の間隔 [アートピクセル] */
const LABEL_GAP = 2;

/**
 * 5×7 の大文字ビットマップ。曲線を持たないので、そのままドット絵の世界観に合う。
 * 表にない文字は空白として扱う。
 */
const FONT: Record<string, readonly string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
};

/** 描いたアートと、指し示す点の位置（矢印の先端 / 旗竿の根元） */
interface Art {
  canvas: HTMLCanvasElement;
  /** 指し示すドット位置。canvas 左上を原点とする */
  tipX: number;
  tipY: number;
}

/**
 * ドットを立てるための下書き。左右反転と縁取りの扱いを1箇所へ集める。
 * 座標は縁取りの余白を含まない「絵の中」の座標で、`flip` は左右だけを入れ替える。
 */
class Bitmap {
  private readonly on: boolean[];
  private readonly pad = M.markerOutlineWidth;
  readonly canvasW: number;
  readonly canvasH: number;

  constructor(
    readonly w: number,
    readonly h: number,
    private readonly flip: boolean,
  ) {
    this.canvasW = w + this.pad * 2;
    this.canvasH = h + this.pad * 2;
    this.on = new Array(this.canvasW * this.canvasH).fill(false);
  }

  /** 左右反転はここだけで吸収する。**文字自体は鏡像にしない** */
  mx(x: number): number {
    return this.flip ? this.w - 1 - x : x;
  }

  set(x: number, y: number): void {
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return;
    this.on[(y + this.pad) * this.canvasW + (x + this.pad)] = true;
  }

  /** キャンバス座標（縁取りの余白を含む）へ変換する */
  canvasX(x: number): number {
    return x + this.pad;
  }
  canvasY(y: number): number {
    return y + this.pad;
  }

  /**
   * 塗りと縁取りを描く。
   * 縁取りは、塗りから `markerOutlineWidth` ドット以内の空きを暗く敷いたもの。
   * 芝の緑にも池の青にも埋もれないようにするために要る
   */
  render(color: number): HTMLCanvasElement {
    const { canvasW: cw, canvasH: ch, on, pad } = this;
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = cssColor(M.markerOutlineColor);
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        if (on[y * cw + x]) continue;
        let touches = false;
        for (let dy = -pad; dy <= pad && !touches; dy++) {
          for (let dx = -pad; dx <= pad; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= cw || ny < 0 || ny >= ch) continue;
            if (on[ny * cw + nx]) {
              touches = true;
              break;
            }
          }
        }
        if (touches) ctx.fillRect(x, y, 1, 1);
      }
    }

    ctx.fillStyle = cssColor(color);
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        if (on[y * cw + x]) ctx.fillRect(x, y, 1, 1);
      }
    }
    return canvas;
  }
}

function labelWidth(label: string): number {
  if (label.length === 0) return 0;
  return label.length * (GLYPH_W + GLYPH_GAP) - GLYPH_GAP;
}

function cssColor(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

/**
 * ボール側のマーカー。ラベルと斜めの矢印を1枚のドット絵にする。
 *
 * 既定はラベルが左上・矢印が右下（＝アートは指し示す点の左上へ伸びる）。
 * `flip` は左右を入れ替えた版で、画面の左半分にある点でもラベルが画面外へ出ない。
 * **文字自体は鏡像にしない。** 配置と矢印の向きだけを入れ替える。
 */
function buildArrowArt(label: string, color: number, flip: boolean): Art {
  const arrow = M.markerArrowLength;
  const head = M.markerArrowHeadLength;
  const textW = labelWidth(label);
  const w = Math.max(textW, arrow);
  const h = GLYPH_H + LABEL_GAP + arrow;
  const bmp = new Bitmap(w, h, flip);

  // ラベル。反転時は右寄せにして、矢印の付け根の側へ寄せる
  const textX = flip ? w - textW : 0;
  for (let i = 0; i < label.length; i++) {
    const glyph = FONT[label[i]];
    if (!glyph) continue;
    const ox = textX + i * (GLYPH_W + GLYPH_GAP);
    for (let y = 0; y < GLYPH_H; y++) {
      for (let x = 0; x < GLYPH_W; x++) {
        if (glyph[y][x] === '#') bmp.set(ox + x, y);
      }
    }
  }

  // 斜めの矢印。付け根はラベルの下、先端はアートの角
  const top = GLYPH_H + LABEL_GAP;
  for (let i = 0; i < arrow; i++) bmp.set(bmp.mx(w - arrow + i), top + i);
  // 先端の返し。斜辺と合わせて45度の矢じりになる
  for (let i = 1; i <= head; i++) {
    bmp.set(bmp.mx(w - 1 - i), h - 1);
    bmp.set(bmp.mx(w - 1), h - 1 - i);
  }

  return {
    canvas: bmp.render(color),
    tipX: bmp.canvasX(bmp.mx(w - 1)),
    tipY: bmp.canvasY(h - 1),
  };
}

/**
 * カップ側のマーカー。旗の絵にする。
 *
 * **旗竿の根元が指し示す点（＝カップ）にちょうど載る。** 根元には左右対称の足を付けて、
 * どの点を指しているかを矢印と同じ精度で読めるようにする。
 * `flip` の意味は矢印と揃える（＝画面の左半分にある点では、アートを右へ伸ばす）。
 * 旗はここでは既定で右へ張り出すので、`Bitmap` へは反転して渡す。
 */
function buildFlagArt(color: number, flip: boolean): Art {
  const poleH = M.markerFlagPoleHeight;
  const flagW = M.markerFlagWidth;
  const flagH = M.markerFlagHeight;
  // 足は指し示す点を跨ぐので、旗と反対側にも張り出す
  const foot = Math.floor((M.markerFlagFootWidth - 1) / 2);
  const w = foot + 1 + Math.max(flagW, foot);
  const bmp = new Bitmap(w, poleH, !flip);

  // 旗竿。根元（下端）が指し示す点
  const poleX = foot;
  for (let y = 0; y < poleH; y++) bmp.set(bmp.mx(poleX), y);
  // 根元の足
  for (let i = -foot; i <= foot; i++) bmp.set(bmp.mx(poleX + i), poleH - 1);

  // 旗。竿の先から横へ張り出し、下へ向かって細くなる三角旗
  for (let y = 0; y < flagH; y++) {
    const len = Math.max(1, Math.round((flagW * (flagH - y)) / flagH));
    for (let x = 1; x <= len; x++) bmp.set(bmp.mx(poleX + x), y);
  }

  return {
    canvas: bmp.render(color),
    tipX: bmp.canvasX(bmp.mx(poleX)),
    tipY: bmp.canvasY(poleH - 1),
  };
}

/**
 * 1枚のマーカー。スプライトなので俯瞰の視距離が変わっても画面上の大きさは変わらない。
 * 大きさはゲームのドット何個ぶんかで決めるので、粒が揃う。
 */
export class CourseMapMarker {
  readonly sprite: THREE.Sprite;
  private readonly material: THREE.SpriteMaterial;
  private readonly cache = new Map<string, { texture: THREE.Texture; art: Art }>();
  private current: Art | null = null;
  private key = '';

  constructor(private readonly color: number) {
    this.material = new THREE.SpriteMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      // 遠近で縮めない。俯瞰の視距離が変わっても画面上の大きさとドットの粒を保つ
      sizeAttenuation: false,
    });
    this.sprite = new THREE.Sprite(this.material);
    // 芝より必ず手前に描く。深度ではなく描画順で重ねる
    this.sprite.renderOrder = 30;
  }

  /** ボール側。ラベルと向きを差し替える */
  setArrow(label: string, flip: boolean): void {
    this.setArt(`arrow:${label}|${flip ? 'L' : 'R'}`, () => buildArrowArt(label, this.color, flip));
  }

  /** カップ側。旗の向きを差し替える */
  setFlag(flip: boolean): void {
    this.setArt(`flag|${flip ? 'L' : 'R'}`, () => buildFlagArt(this.color, flip));
  }

  /** 同じ絵は作り直さない */
  private setArt(key: string, build: () => Art): void {
    if (key === this.key) return;
    let entry = this.cache.get(key);
    if (!entry) {
      const art = build();
      const texture = new THREE.CanvasTexture(art.canvas);
      // ドットをぼかさない。引き伸ばしも縮小も最近傍
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      texture.colorSpace = THREE.SRGBColorSpace;
      entry = { texture, art };
      this.cache.set(key, entry);
    }
    this.material.map = entry.texture;
    this.material.needsUpdate = true;
    this.current = entry.art;
    this.key = key;
    // 指し示す点が、示したい位置にちょうど載るように原点を置く
    const { canvas, tipX, tipY } = entry.art;
    this.sprite.center.set((tipX + 0.5) / canvas.width, 1 - (tipY + 0.5) / canvas.height);
  }

  /**
   * 画面上の大きさを決める。
   *
   * スプライトは `sizeAttenuation: false` なので、ビュー空間のオフセットに
   * 距離が掛かって遠近が打ち消される。結果、画面上の高さは
   * `scale / tan(fov/2) × 画面高さ/2` で、視距離によらない。
   * 1アートピクセルはゲームのドット `markerArtPixelDots` 個ぶんにする。
   */
  layout(fovDeg: number, viewportHeightPx: number, pixelRatio: number): void {
    if (!this.current) return;
    // 1ドットの実寸 [CSS px]。低解像度ターゲットの1テクセルが画面上で占める大きさ
    const dotPx = CONFIG.pixel.scale / pixelRatio;
    const artPx = dotPx * M.markerArtPixelDots;
    const k = (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2)) / viewportHeightPx;
    const { canvas } = this.current;
    this.sprite.scale.set(canvas.width * artPx * k, canvas.height * artPx * k, 1);
  }

  dispose(): void {
    for (const { texture } of this.cache.values()) texture.dispose();
    this.cache.clear();
    this.material.dispose();
  }
}
