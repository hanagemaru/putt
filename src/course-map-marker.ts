// コースマップのボール・カップ位置マーカー（spec §3）。
//
// 真上からの俯瞰では実寸のボール（半径21mm）もカップも点にならないので、
// **斜めの矢印とピクセル文字**で「どこか」と「そこが何か」を示す。
// ゲーム画面は 1/3 解像度＋色の量子化でドット絵にしているので、マーカーも
// アンチエイリアスのない矩形ドットだけで組み、同じ粒に揃える。
//
// 曲がりの予測線・推奨ルートはここでも描かない。示すのは2点の位置だけ。
import * as THREE from 'three';
import { CONFIG } from './config';

const M = CONFIG.game.courseMap;

/** 字形そのものの寸法。フォントのデータと一体なのでここに置く */
const GLYPH_W = 3;
const GLYPH_H = 5;
/** 字間 [アートピクセル] */
const GLYPH_GAP = 1;
/** ラベルと矢印の間隔 [アートピクセル] */
const LABEL_GAP = 1;
/** 縁取りぶんの余白 [アートピクセル] */
const PAD = 1;

/**
 * 3×5 の大文字ビットマップ。曲線を持たないので、そのままドット絵の世界観に合う。
 * 表にない文字は空白として扱う。
 */
const FONT: Record<string, readonly string[]> = {
  A: ['###', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['###', '#..', '#..', '#..', '###'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  F: ['###', '#..', '##.', '#..', '#..'],
  G: ['###', '#..', '#.#', '#.#', '###'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '###'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#.#', '###', '###', '#.#', '#.#'],
  N: ['#.#', '##.', '###', '.##', '#.#'],
  O: ['###', '#.#', '#.#', '#.#', '###'],
  P: ['##.', '#.#', '##.', '#..', '#..'],
  Q: ['###', '#.#', '#.#', '###', '..#'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['###', '#..', '###', '..#', '###'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'],
  W: ['#.#', '#.#', '###', '###', '#.#'],
  X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  Z: ['###', '..#', '.#.', '#..', '###'],
};

/** 描いたアートと、矢印の先端（＝指し示す点）の位置 */
interface Art {
  canvas: HTMLCanvasElement;
  /** 先端のドット位置。canvas 左上を原点とする */
  tipX: number;
  tipY: number;
}

function labelWidth(label: string): number {
  if (label.length === 0) return 0;
  return label.length * (GLYPH_W + GLYPH_GAP) - GLYPH_GAP;
}

function cssColor(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

/**
 * ラベルと矢印を1枚のドット絵にする。
 *
 * 既定はラベルが左上・矢印が右下（＝アートは指し示す点の左上へ伸びる）。
 * `flip` は左右を入れ替えた版で、コースの左端に近い点でもラベルが画面外へ出ない。
 * **文字自体は鏡像にしない。** 配置と矢印の向きだけを入れ替える。
 */
function buildArt(label: string, color: number, flip: boolean): Art {
  const arrow = M.markerArrowLength;
  const textW = labelWidth(label);
  const w = Math.max(textW, arrow);
  const h = GLYPH_H + LABEL_GAP + arrow;

  const on: boolean[] = new Array((w + PAD * 2) * (h + PAD * 2)).fill(false);
  const index = (x: number, y: number) => (y + PAD) * (w + PAD * 2) + (x + PAD);
  /** 左右反転はここだけで吸収する */
  const mx = (x: number) => (flip ? w - 1 - x : x);
  const set = (x: number, y: number) => {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    on[index(x, y)] = true;
  };

  // ラベル。反転時は右寄せにして、矢印の付け根の側へ寄せる
  const textX = flip ? w - textW : 0;
  for (let i = 0; i < label.length; i++) {
    const glyph = FONT[label[i]];
    if (!glyph) continue;
    const ox = textX + i * (GLYPH_W + GLYPH_GAP);
    for (let y = 0; y < GLYPH_H; y++) {
      for (let x = 0; x < GLYPH_W; x++) {
        if (glyph[y][x] === '#') set(ox + x, y);
      }
    }
  }

  // 斜めの矢印。付け根はラベルの下、先端はアートの角
  const top = GLYPH_H + LABEL_GAP;
  for (let i = 0; i < arrow; i++) set(mx(w - arrow + i), top + i);
  // 先端の返し。斜辺と合わせて45度の矢じりになる
  set(mx(w - 2), h - 1);
  set(mx(w - 3), h - 1);
  set(mx(w - 1), h - 2);
  set(mx(w - 1), h - 3);

  const cw = w + PAD * 2;
  const ch = h + PAD * 2;
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d')!;

  // 縁取り。芝の緑にも池の青にも埋もれないよう、塗りの周り1ドットを暗く敷く
  ctx.fillStyle = cssColor(M.markerOutlineColor);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      if (on[y * cw + x]) continue;
      let touches = false;
      for (let dy = -1; dy <= 1 && !touches; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
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

  return { canvas, tipX: PAD + mx(w - 1), tipY: PAD + h - 1 };
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

  /** ラベルと向きを差し替える。同じ組み合わせは作り直さない */
  setLabel(label: string, flip: boolean): void {
    const key = `${label}|${flip ? 'L' : 'R'}`;
    if (key === this.key) return;
    let entry = this.cache.get(key);
    if (!entry) {
      const art = buildArt(label, this.color, flip);
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
    // 矢印の先端が、指し示す点にちょうど載るように原点を置く
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
