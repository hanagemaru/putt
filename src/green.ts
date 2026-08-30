// グリーンのハイトマップ生成・サンプリング・メッシュ構築（spec §1）。
// 正式表示ではハイトマップが表示と物理の両方の唯一の情報源。
// 比較用の「形状2×」だけは、物理と色を変えず3D形状の高さだけを一時的に誇張する。
import * as THREE from 'three';
import { CONFIG } from './config';
import type { CoursePoint, SurfaceType } from './course/course-types';

const C = CONFIG.green;

/** lil-gui から変えられる生成パラメータ。変えたら作り直す */
export interface GreenParams {
  seed: number;
  /** X方向の幅 [m] */
  width?: number;
  /** Z方向の長さ [m] */
  length?: number;
  /** うねりの振幅 [m]（±） */
  undulationAmplitude: number;
  /** 全体傾斜 [%]。向きはシードから決まる */
  tiltPercent: number;
}

export function defaultGreenParams(): GreenParams {
  return {
    seed: C.seed,
    width: C.width,
    length: C.length,
    undulationAmplitude: C.undulationAmplitude,
    tiltPercent: C.tiltPercent,
  };
}

/** mulberry32。シードから再現可能な擬似乱数 */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

interface Gaussian {
  cx: number;
  cz: number;
  /** 広がり [m] */
  sigma: number;
  /** 正規化前の重み。符号が山と谷 */
  weight: number;
}

/**
 * 長方形の地形ハイトマップ。
 * 高さと勾配をグリッドに持ち、任意座標はバイリニア補間で返す。
 */
export class Green {
  readonly width: number;
  readonly length: number;
  readonly resX: number;
  readonly resZ: number;
  readonly cellX: number;
  readonly cellZ: number;
  /** 正方形前提の green-test 互換。ゲーム本体では width / length を使う */
  readonly size: number;
  readonly res: number;
  readonly cell: number;

  private readonly heights: Float32Array;
  /** 高さと同じグリッド上の勾配。中心差分で先に求めておく（セル境界で不連続にしないため） */
  private readonly gradX: Float32Array;
  private readonly gradZ: Float32Array;

  minHeight = 0;
  maxHeight = 0;
  /** 全体傾斜 [%] */
  tiltPercent = 0;

  constructor(
    params: GreenParams,
    private readonly classifySurface?: (x: number, z: number) => SurfaceType,
  ) {
    this.width = params.width ?? C.width;
    this.length = params.length ?? C.length;
    this.resX = Math.ceil(this.width / C.heightmapCellSize) + 1;
    this.resZ = Math.ceil(this.length / C.heightmapCellSize) + 1;
    this.cellX = this.width / (this.resX - 1);
    this.cellZ = this.length / (this.resZ - 1);
    this.size = this.width;
    this.res = this.resX;
    this.cell = this.cellX;
    this.heights = new Float32Array(this.resX * this.resZ);
    this.gradX = new Float32Array(this.resX * this.resZ);
    this.gradZ = new Float32Array(this.resX * this.resZ);
    this.generate(params);
  }

  /** ハイトマップを作り直す。同じ params なら必ず同じ地形になる */
  generate(params: GreenParams): void {
    const rng = makeRng(params.seed);
    const halfWidth = this.width / 2;
    const halfLength = this.length / 2;

    // 緩やかな全体傾斜。向きだけシードから決め、大きさは params で指定する
    const tiltAngle = rng() * Math.PI * 2;
    this.tiltPercent = params.tiltPercent;
    const tilt = this.tiltPercent / 100;
    const tiltX = Math.cos(tiltAngle) * tilt;
    const tiltZ = Math.sin(tiltAngle) * tilt;

    // うねりのガウシアン
    const spreadX = this.width * C.gaussianSpread;
    const spreadZ = this.length * C.gaussianSpread;
    const gaussians: Gaussian[] = [];
    for (let i = 0; i < C.gaussianCount; i++) {
      gaussians.push({
        cx: (rng() - 0.5) * spreadX,
        cz: (rng() - 0.5) * spreadZ,
        sigma: lerp(C.gaussianSigmaMin, C.gaussianSigmaMax, rng()),
        weight: (rng() < 0.5 ? -1 : 1) * lerp(0.4, 1, rng()),
      });
    }

    // 先にうねりだけを積んで、振幅が params.undulationAmplitude ちょうどになるよう正規化する。
    // こうしておくと lil-gui の「うねりの振幅」がそのまま m 単位の意味を持つ
    const undulation = new Float32Array(this.resX * this.resZ);
    let maxAbs = 0;
    for (let j = 0; j < this.resZ; j++) {
      const z = -halfLength + j * this.cellZ;
      for (let i = 0; i < this.resX; i++) {
        const x = -halfWidth + i * this.cellX;
        let u = 0;
        for (const g of gaussians) {
          const dx = x - g.cx;
          const dz = z - g.cz;
          u += g.weight * Math.exp(-(dx * dx + dz * dz) / (2 * g.sigma * g.sigma));
        }
        undulation[j * this.resX + i] = u;
        const abs = Math.abs(u);
        if (abs > maxAbs) maxAbs = abs;
      }
    }
    const scale = maxAbs > 0 ? params.undulationAmplitude / maxAbs : 0;

    this.minHeight = Infinity;
    this.maxHeight = -Infinity;
    for (let j = 0; j < this.resZ; j++) {
      const z = -halfLength + j * this.cellZ;
      for (let i = 0; i < this.resX; i++) {
        const x = -halfWidth + i * this.cellX;
        const h = tiltX * x + tiltZ * z + undulation[j * this.resX + i] * scale;
        this.heights[j * this.resX + i] = h;
        if (h < this.minHeight) this.minHeight = h;
        if (h > this.maxHeight) this.maxHeight = h;
      }
    }

    this.computeGradients();
  }

  /** グリッド上の勾配を中心差分で求める。端は片側差分 */
  private computeGradients(): void {
    for (let j = 0; j < this.resZ; j++) {
      for (let i = 0; i < this.resX; i++) {
        const i0 = i > 0 ? i - 1 : i;
        const i1 = i < this.resX - 1 ? i + 1 : i;
        const j0 = j > 0 ? j - 1 : j;
        const j1 = j < this.resZ - 1 ? j + 1 : j;
        this.gradX[j * this.resX + i] =
          (this.heights[j * this.resX + i1] - this.heights[j * this.resX + i0]) /
          ((i1 - i0) * this.cellX);
        this.gradZ[j * this.resX + i] =
          (this.heights[j1 * this.resX + i] - this.heights[j0 * this.resX + i]) /
          ((j1 - j0) * this.cellZ);
      }
    }
  }

  /** グリーンの内側か */
  contains(x: number, z: number): boolean {
    return (
      x >= -this.width / 2 &&
      x <= this.width / 2 &&
      z >= -this.length / 2 &&
      z <= this.length / 2
    );
  }

  /** 地形上の地面種別。分類指定がない検証ページでは全面をグリーンとして扱う。 */
  surfaceAt(x: number, z: number): SurfaceType {
    if (!this.contains(x, z)) return 'ob';
    return this.classifySurface?.(x, z) ?? 'green';
  }

  /** 任意座標の高さ [m]。バイリニア補間。範囲外は端をクランプ */
  sampleHeight(x: number, z: number): number {
    return this.bilinear(this.heights, x, z);
  }

  /**
   * 任意座標の勾配 ∇h（無次元、1 で 100%）。
   * 戻り値は使い回しの一時オブジェクトではなく out へ書き込む（毎ステップ呼ぶのでゴミを出さない）
   */
  sampleGradient(x: number, z: number, out: { x: number; z: number }): { x: number; z: number } {
    out.x = this.bilinear(this.gradX, x, z);
    out.z = this.bilinear(this.gradZ, x, z);
    return out;
  }

  private bilinear(grid: Float32Array, x: number, z: number): number {
    const halfWidth = this.width / 2;
    const halfLength = this.length / 2;
    const u = (Math.min(Math.max(x, -halfWidth), halfWidth) + halfWidth) / this.cellX;
    const v = (Math.min(Math.max(z, -halfLength), halfLength) + halfLength) / this.cellZ;
    const i = Math.min(Math.max(Math.floor(u), 0), this.resX - 2);
    const j = Math.min(Math.max(Math.floor(v), 0), this.resZ - 2);
    const fx = u - i;
    const fz = v - j;
    const h00 = grid[j * this.resX + i];
    const h10 = grid[j * this.resX + i + 1];
    const h01 = grid[(j + 1) * this.resX + i];
    const h11 = grid[(j + 1) * this.resX + i + 1];
    return lerp(lerp(h00, h10, fx), lerp(h01, h11, fx), fz);
  }
}

/** 濃淡の設定（§1）。lil-gui から変えられる */
export interface ShadeParams {
  /** 勾配ベース表示の振れ幅（±）。ゲーム本体は 0、green-test の比較用に残す */
  gradientStrength: number;
  /** 勾配ベース表示を使う場合のフルレンジ（無次元、0.03 で 3%） */
  gradientRange: number;
  /** 光の方位 [度]。勾配ベース表示を使うときだけ効く */
  lightAzimuthDeg: number;
  /** 高さベース表示の濃淡の振れ幅（±） */
  heightStrength: number;
  /** 高さベース表示がフルレンジで表す高低差 [m] */
  heightRange: number;
  /**
   * 明るさの係数を丸める段数（レトロ表現）。0 で丸めない。
   * 段にすると濃淡が等高線のような帯になり、1段ぶんの明暗差＝一定の高低差になる。
   */
  levels: number;
}

export function defaultShadeParams(): ShadeParams {
  return { ...C.shade };
}

/** 中央付近は傾き 1 の直線、端だけ緩やかに飽和させる。黒つぶれ・白飛びを防ぐ */
function softRamp(value: number, fullRange: number): number {
  const half = fullRange / 2;
  if (half <= 0) return 0.5;
  const s = value / half;
  return 0.5 + (0.5 * s) / Math.sqrt(1 + s * s);
}

/**
 * グリーンの表示メッシュ。PlaneGeometry の頂点をハイトマップで変位させ、頂点カラーで濃淡をつける。
 *
 * 現行のゲーム本体は **高さベース**（§1）。`heightStrength` と `heightRange` で、
 * **明るい＝高い / 暗い＝低い** を絶対スケールで表す。グリーンごとの最小最大では正規化しないので、
 * 同じ明るさはシードが変わっても同じ高さの意味を持つ。
 *
 * 勾配ベース表示も比較用として式を残しているが、ゲーム本体では `gradientStrength = 0`。
 * 実機比較で、勾配ベースはわずかな傾斜を強調できる一方、明るさが高さを意味しなくなり
 * 曲がる向きを読み違えやすかったため、正式方針から外した。
 *
 * `heightScale` は形状視認性の比較専用。色の計算と物理には元の h を使うため、
 * 2倍表示でも色が意味する高さと実際の物理は変えない。
 */
/** 高さの濃淡を掛けないサーフェスか（池・OB） */
function isFlatSurface(surface: SurfaceType): boolean {
  return (C.flatSurfaces as readonly SurfaceType[]).includes(surface);
}

export class GreenMesh {
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.PlaneGeometry;
  private readonly bases: Record<SurfaceType, THREE.Color> = {
    green: new THREE.Color(C.surfaceColors.green),
    rough: new THREE.Color(C.surfaceColors.rough),
    deepRough: new THREE.Color(C.surfaceColors.deepRough),
    water: new THREE.Color(C.surfaceColors.water),
    ob: new THREE.Color(C.surfaceColors.ob),
  };
  private readonly grad = { x: 0, z: 0 };
  private heightScale = 1;

  constructor(
    private green: Green,
    shade: ShadeParams,
    heightScale = 1,
  ) {
    this.heightScale = heightScale;
    const segmentsX = Math.ceil(green.width / C.renderCellSize);
    const segmentsZ = Math.ceil(green.length / C.renderCellSize);
    this.geometry = new THREE.PlaneGeometry(
      green.width,
      green.length,
      segmentsX,
      segmentsZ,
    );
    // XZ 平面へ倒しておく。以降は頂点の x/z がそのままワールド座標になる
    this.geometry.rotateX(-Math.PI / 2);
    const count = this.geometry.attributes.position.count;
    this.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    this.mesh = new THREE.Mesh(
      this.geometry,
      new THREE.MeshLambertMaterial({ vertexColors: true }),
    );
    this.update(green, shade, heightScale);
  }

  /** ハイトマップか濃淡の設定が変わったら呼ぶ。頂点の高さと色を貼り直す */
  update(green: Green, shade: ShadeParams, heightScale = this.heightScale): void {
    this.green = green;
    this.heightScale = heightScale;
    const position = this.geometry.attributes.position as THREE.BufferAttribute;
    const color = this.geometry.attributes.color as THREE.BufferAttribute;
    // 勾配ベース表示を比較するときの固定方位。ゲーム本体は gradientStrength=0 なので色には寄与しない
    const azimuth = (shade.lightAzimuthDeg * Math.PI) / 180;
    const lx = Math.cos(azimuth);
    const lz = Math.sin(azimuth);

    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const z = position.getZ(i);
      const h = green.sampleHeight(x, z);
      const surface = green.surfaceAt(x, z);
      // 池だけ見た目を一段下げる。ハイトマップ自体は変えないので物理は同じ
      const drop = surface === 'water' ? C.waterSurfaceDrop : 0;
      position.setY(i, h * this.heightScale - drop);
      const base = this.bases[surface];

      // 池とOBは高さを読む対象ではないので、濃淡を掛けず単色で塗る
      if (isFlatSurface(surface)) {
        color.setXYZ(i, base.r, base.g, base.b);
        continue;
      }

      // 勾配ベース比較用の値と、正式採用している高さベースの値を同じ式で合成できるよう保持する
      green.sampleGradient(x, z, this.grad);
      const towardLight = this.grad.x * lx + this.grad.z * lz;
      const gradient = softRamp(towardLight, shade.gradientRange);
      const height = softRamp(h, shade.heightRange);

      // 1 を中心に両方向へ振る。現行は gradientStrength=0 なので、明るいほど高く・暗いほど低い。
      const k =
        1 +
        shade.gradientStrength * (2 * gradient - 1) +
        shade.heightStrength * (2 * height - 1);
      // 段に丸める（レトロ表現）。0 なら連続のまま
      const q = shade.levels > 0 ? Math.round(k * shade.levels) / shade.levels : k;
      color.setXYZ(i, base.r * q, base.g * q, base.b * q);
    }
    position.needsUpdate = true;
    color.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();
  }

  /** 濃淡の設定だけを変える。現在の形状倍率は保つ */
  setShade(shade: ShadeParams): void {
    this.update(this.green, shade, this.heightScale);
  }
}

/**
 * カップ（§1）。直径 108mm、深さ 100mm の円筒。見た目は暗い円で十分。
 * 旗竿は必ず鉛直に立てる。傾き表現の基準になる。
 */
export function createHole(
  green: Green,
  heightScale = 1,
  position: CoursePoint = CONFIG.hole.position,
): THREE.Group {
  const h = CONFIG.hole;
  const group = new THREE.Group();
  const surfaceY = green.sampleHeight(position.x, position.z) * heightScale;
  const radius = h.diameter / 2;
  const dark = new THREE.MeshBasicMaterial({ color: h.cupColor });

  // 芝の面に開いた穴。表示メッシュ（20m を 128 分割 ＝ 1マス 15.6cm）に直径 10.8cm の穴は
  // 開けられないので、芝の上に濃い円を1枚置いて穴に見せる。
  // これがないとカップの内側は芝に隠れて、どこにカップがあるのか分からない
  const mouth = new THREE.Mesh(new THREE.CircleGeometry(radius, 24), dark);
  mouth.rotation.x = -Math.PI / 2;
  mouth.position.set(position.x, surfaceY + h.mouthLift, position.z);
  group.add(mouth);

  // 内壁。上端をグリーン面に合わせる
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, h.depth, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: h.cupColor, side: THREE.BackSide }),
  );
  wall.position.set(position.x, surfaceY - h.depth / 2, position.z);
  group.add(wall);

  // 底
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(radius, 24), dark);
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.set(position.x, surfaceY - h.depth, position.z);
  group.add(bottom);

  // 旗竿。近くでは自然な細さにし、遠くでは低解像度レンダー上の最低幅だけを確保する。
  // 高さは変えず XZ 方向だけ拡大するので、鉛直の基準としての役割は保たれる。
  const stick = new THREE.Mesh(
    new THREE.CylinderGeometry(h.flagstickRadius, h.flagstickRadius, h.flagstickHeight, 8),
    new THREE.MeshLambertMaterial({ color: 0xf0f0f0 }),
  );
  stick.position.set(position.x, surfaceY - h.depth + h.flagstickHeight / 2, position.z);

  const renderSize = new THREE.Vector2();
  const stickWorld = new THREE.Vector3();
  const cameraWorld = new THREE.Vector3();
  stick.onBeforeRender = (renderer, _scene, camera) => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;

    const target = renderer.getRenderTarget();
    const viewportHeightPx = target ? target.height : renderer.getDrawingBufferSize(renderSize).y;
    stick.getWorldPosition(stickWorld);
    camera.getWorldPosition(cameraWorld);
    const distance = Math.max(cameraWorld.distanceTo(stickWorld), 0.001);
    const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);

    // 円柱の直径がレンダーターゲット上で何 px に見えるか。
    // diameterPx = (2r / (2 d tan(fov/2))) * viewportHeight
    const diameterPx =
      (h.flagstickRadius * viewportHeightPx) / Math.max(distance * tanHalfFov, 0.0001);
    const neededScale = h.flagstickMinPixelWidth / Math.max(diameterPx, 0.0001);
    const maxScale = h.flagstickMaxRadius / h.flagstickRadius;
    const scaleXZ = THREE.MathUtils.clamp(neededScale, 1, maxScale);

    if (Math.abs(stick.scale.x - scaleXZ) > 0.0001) {
      stick.scale.set(scaleXZ, 1, scaleXZ);
      stick.updateMatrixWorld(true);
    }
  };
  group.add(stick);

  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(h.flagWidth, h.flagHeight),
    new THREE.MeshBasicMaterial({ color: h.flagColor, side: THREE.DoubleSide }),
  );
  flag.position.set(
    position.x + h.flagWidth / 2,
    surfaceY - h.depth + h.flagstickHeight - h.flagHeight,
    position.z,
  );
  group.add(flag);

  return group;
}

/** グリーンの外に敷く地面。グリーンが宙に浮いて見えないようにするだけ */
export function createSurround(green: Green, heightScale = 1): THREE.Mesh {
  const s = CONFIG.surround;
  const span = Math.max(green.width, green.length, s.size / 3);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(span * 3, span * 3),
    new THREE.MeshLambertMaterial({ color: s.color }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = green.minHeight * heightScale - s.drop;
  return mesh;
}

/**
 * OBエリアの中から木を置ける点を探す。
 * 見つかった数が count に満たない場合もあるので、呼ぶ側で枠の外へ回す。
 */
function pickTreeSpotsInBounds(green: Green, rng: () => number, count: number): CoursePoint[] {
  const t = CONFIG.trees.inBounds;
  const spots: CoursePoint[] = [];
  const halfWidth = green.width / 2 - t.edgeMargin;
  const halfLength = green.length / 2 - t.edgeMargin;
  if (halfWidth <= 0 || halfLength <= 0) return spots;

  for (let i = 0; i < count; i++) {
    for (let attempt = 0; attempt < t.maxAttemptsPerTree; attempt++) {
      const x = (rng() * 2 - 1) * halfWidth;
      const z = (rng() * 2 - 1) * halfLength;
      if (green.surfaceAt(x, z) !== 'ob') continue;
      // 幹の周りが芝に食い込まないよう、四方も OB であることを確かめる
      const c = t.playableClearance;
      if (
        green.surfaceAt(x + c, z) !== 'ob' ||
        green.surfaceAt(x - c, z) !== 'ob' ||
        green.surfaceAt(x, z + c) !== 'ob' ||
        green.surfaceAt(x, z - c) !== 'ob'
      ) {
        continue;
      }
      if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < t.minSpacing)) continue;
      spots.push({ x, z });
      break;
    }
  }
  return spots;
}

/**
 * 木を数本。これも傾きの基準になるので必ず鉛直に立てる。
 * OBエリアが取れるコースでは枠内のOBへ置き、OBの位置そのものを見て分かるようにする。
 * OBが狭い（検証ページのように分類がない）場合だけ、従来どおり枠の外へ並べる。
 */
export function createTrees(green: Green, seed: number, heightScale = 1): THREE.Group {
  const t = CONFIG.trees;
  const rng = makeRng(seed);
  const group = new THREE.Group();
  const outsideBaseY = green.minHeight * heightScale - CONFIG.surround.drop;
  const radiusMin = Math.max(t.radiusMin, Math.max(green.width, green.length) / 2 + 1);
  const radiusMax = radiusMin + (t.radiusMax - t.radiusMin);
  const trunkMat = new THREE.MeshLambertMaterial({ color: t.trunkColor });
  const leafMat = new THREE.MeshLambertMaterial({ color: t.leafColor });
  const spots = pickTreeSpotsInBounds(green, rng, t.count);

  for (let i = 0; i < t.count; i++) {
    const spot = spots[i];
    const height = lerp(t.heightMin, t.heightMax, rng());
    let x: number;
    let z: number;
    let baseY: number;
    if (spot) {
      x = spot.x;
      z = spot.z;
      // 枠内では地面に立たせる。池の見た目の段下げは芝の高さと別なのでここでは使わない
      baseY = green.sampleHeight(x, z) * heightScale;
    } else {
      const angle = ((i + rng() * 0.6) / t.count) * Math.PI * 2;
      const radius = lerp(radiusMin, radiusMax, rng());
      x = Math.cos(angle) * radius;
      z = Math.sin(angle) * radius;
      baseY = outsideBaseY;
    }

    const trunkHeight = height * 0.35;
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(height * 0.05, height * 0.07, trunkHeight, 6),
      trunkMat,
    );
    trunk.position.set(x, baseY + trunkHeight / 2, z);
    group.add(trunk);

    const leafHeight = height * 0.75;
    const leaves = new THREE.Mesh(
      new THREE.ConeGeometry(height * 0.28, leafHeight, 7),
      leafMat,
    );
    leaves.position.set(x, baseY + trunkHeight + leafHeight / 2, z);
    group.add(leaves);
  }
  return group;
}
