// グリーンのハイトマップ生成・サンプリング・メッシュ構築（spec §1）。
// ハイトマップは表示テクスチャと物理の両方の唯一の情報源。見た目と挙動を別々に持たない。
import * as THREE from 'three';
import { CONFIG } from './config';

const C = CONFIG.green;

/** lil-gui から変えられる生成パラメータ。変えたら作り直す */
export interface GreenParams {
  seed: number;
  /** うねりの振幅 [m]（±） */
  undulationAmplitude: number;
  /** 全体傾斜 [%]。向きはシードから決まる */
  tiltPercent: number;
}

export function defaultGreenParams(): GreenParams {
  return {
    seed: C.seed,
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
 * 20m × 20m のグリーン。
 * 高さと勾配をグリッドに持ち、任意座標はバイリニア補間で返す。
 */
export class Green {
  /** 一辺 [m] */
  readonly size = C.size;
  /** グリッドの分割数（res × res） */
  readonly res = C.heightmapResolution;
  /** グリッド間隔 [m] */
  readonly cell: number;

  private readonly heights: Float32Array;
  /** 高さと同じグリッド上の勾配。中心差分で先に求めておく（セル境界で不連続にしないため） */
  private readonly gradX: Float32Array;
  private readonly gradZ: Float32Array;

  minHeight = 0;
  maxHeight = 0;
  /** 全体傾斜 [%] */
  tiltPercent = 0;

  constructor(params: GreenParams) {
    this.cell = this.size / (this.res - 1);
    this.heights = new Float32Array(this.res * this.res);
    this.gradX = new Float32Array(this.res * this.res);
    this.gradZ = new Float32Array(this.res * this.res);
    this.generate(params);
  }

  /** ハイトマップを作り直す。同じ params なら必ず同じ地形になる */
  generate(params: GreenParams): void {
    const rng = makeRng(params.seed);
    const half = this.size / 2;

    // 緩やかな全体傾斜。向きだけシードから決め、大きさは params で指定する
    const tiltAngle = rng() * Math.PI * 2;
    this.tiltPercent = params.tiltPercent;
    const tilt = this.tiltPercent / 100;
    const tiltX = Math.cos(tiltAngle) * tilt;
    const tiltZ = Math.sin(tiltAngle) * tilt;

    // うねりのガウシアン
    const spread = this.size * C.gaussianSpread;
    const gaussians: Gaussian[] = [];
    for (let i = 0; i < C.gaussianCount; i++) {
      gaussians.push({
        cx: (rng() - 0.5) * spread,
        cz: (rng() - 0.5) * spread,
        sigma: lerp(C.gaussianSigmaMin, C.gaussianSigmaMax, rng()),
        weight: (rng() < 0.5 ? -1 : 1) * lerp(0.4, 1, rng()),
      });
    }

    // 先にうねりだけを積んで、振幅が params.undulationAmplitude ちょうどになるよう正規化する。
    // こうしておくと lil-gui の「うねりの振幅」がそのまま m 単位の意味を持つ
    const undulation = new Float32Array(this.res * this.res);
    let maxAbs = 0;
    for (let j = 0; j < this.res; j++) {
      const z = -half + j * this.cell;
      for (let i = 0; i < this.res; i++) {
        const x = -half + i * this.cell;
        let u = 0;
        for (const g of gaussians) {
          const dx = x - g.cx;
          const dz = z - g.cz;
          u += g.weight * Math.exp(-(dx * dx + dz * dz) / (2 * g.sigma * g.sigma));
        }
        undulation[j * this.res + i] = u;
        const abs = Math.abs(u);
        if (abs > maxAbs) maxAbs = abs;
      }
    }
    const scale = maxAbs > 0 ? params.undulationAmplitude / maxAbs : 0;

    this.minHeight = Infinity;
    this.maxHeight = -Infinity;
    for (let j = 0; j < this.res; j++) {
      const z = -half + j * this.cell;
      for (let i = 0; i < this.res; i++) {
        const x = -half + i * this.cell;
        const h = tiltX * x + tiltZ * z + undulation[j * this.res + i] * scale;
        this.heights[j * this.res + i] = h;
        if (h < this.minHeight) this.minHeight = h;
        if (h > this.maxHeight) this.maxHeight = h;
      }
    }

    this.computeGradients();
  }

  /** グリッド上の勾配を中心差分で求める。端は片側差分 */
  private computeGradients(): void {
    const n = this.res;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const i0 = i > 0 ? i - 1 : i;
        const i1 = i < n - 1 ? i + 1 : i;
        const j0 = j > 0 ? j - 1 : j;
        const j1 = j < n - 1 ? j + 1 : j;
        this.gradX[j * n + i] =
          (this.heights[j * n + i1] - this.heights[j * n + i0]) / ((i1 - i0) * this.cell);
        this.gradZ[j * n + i] =
          (this.heights[j1 * n + i] - this.heights[j0 * n + i]) / ((j1 - j0) * this.cell);
      }
    }
  }

  /** グリーンの内側か */
  contains(x: number, z: number): boolean {
    const half = this.size / 2;
    return x >= -half && x <= half && z >= -half && z <= half;
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
    const n = this.res;
    const half = this.size / 2;
    const u = (Math.min(Math.max(x, -half), half) + half) / this.cell;
    const v = (Math.min(Math.max(z, -half), half) + half) / this.cell;
    const i = Math.min(Math.max(Math.floor(u), 0), n - 2);
    const j = Math.min(Math.max(Math.floor(v), 0), n - 2);
    const fx = u - i;
    const fz = v - j;
    const h00 = grid[j * n + i];
    const h10 = grid[j * n + i + 1];
    const h01 = grid[(j + 1) * n + i];
    const h11 = grid[(j + 1) * n + i + 1];
    return lerp(lerp(h00, h10, fx), lerp(h01, h11, fx), fz);
  }
}

/** 濃淡の設定（§1）。lil-gui から変えられる */
export interface ShadeParams {
  /** 勾配の濃淡の振れ幅（±）。0 で単色 */
  gradientStrength: number;
  /** 濃淡がフルレンジで表す勾配（無次元、0.08 で 8%）。読みの単位 */
  gradientRange: number;
  /** 光の方位 [度]。固定方向 */
  lightAzimuthDeg: number;
  /** 高さの濃淡の振れ幅（±） */
  heightStrength: number;
  /** 高さの濃淡がフルレンジで表す高低差 [m] */
  heightRange: number;
  /**
   * 明るさの係数を丸める段数（レトロ表現の試作）。0 で丸めない。
   * 段にすると濃淡が等高線のような帯になる。1段ぶんの明暗差＝一定の勾配差なので、
   * 「絶対スケール」の約束とも噛み合う（段の数がそのまま勾配の目盛りになる）
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
 * **濃淡が表すのは「高さ」ではなく「斜面の向きと強さ」**（§1）。固定方位の光ベクトルと勾配 ∇h の
 * 内積で明暗を決める。一人称の視野に入るのは半径数メートルで、そこの高低差は数センチしかないので、
 * 高さベースでは明度差が出ない（実測：4.5m のライン上で 1.6cm ＝ 明度差 3%）。
 * 読みに要るのは勾配なので、勾配を直接出す。
 *
 * **絶対スケール。** フルレンジは gradientRange で、グリーンごとの最小最大では正規化しない。
 * 同じ明暗差はどのシードでも同じ勾配 % を意味する。ここを正規化に戻すと読みゲームとして成立しない。
 *
 * 明暗は基準の明るさ（係数 1）を中心に上下へ振る。片側だけ暗くしていた頃は、
 * 濃くするほど平均が下がって（実測 45/255）暗い場所では全体が沈み、読めなくなっていた。
 */
export class GreenMesh {
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.PlaneGeometry;
  private readonly base = new THREE.Color(C.color);
  private readonly grad = { x: 0, z: 0 };

  constructor(
    private green: Green,
    shade: ShadeParams,
  ) {
    this.geometry = new THREE.PlaneGeometry(green.size, green.size, C.segments, C.segments);
    // XZ 平面へ倒しておく。以降は頂点の x/z がそのままワールド座標になる
    this.geometry.rotateX(-Math.PI / 2);
    const count = this.geometry.attributes.position.count;
    this.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    this.mesh = new THREE.Mesh(
      this.geometry,
      new THREE.MeshLambertMaterial({ vertexColors: true }),
    );
    this.update(green, shade);
  }

  /** ハイトマップか濃淡の設定が変わったら呼ぶ。頂点の高さと色を貼り直す */
  update(green: Green, shade: ShadeParams): void {
    this.green = green;
    const position = this.geometry.attributes.position as THREE.BufferAttribute;
    const color = this.geometry.attributes.color as THREE.BufferAttribute;
    // 光の方位。プレイヤーが回っても地形の見え方が変わらないよう固定方向にする
    const azimuth = (shade.lightAzimuthDeg * Math.PI) / 180;
    const lx = Math.cos(azimuth);
    const lz = Math.sin(azimuth);

    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const z = position.getZ(i);
      const h = green.sampleHeight(x, z);
      position.setY(i, h);

      // 光の方向へ下っている面は暗く、光の方へ登っている面は明るい
      green.sampleGradient(x, z, this.grad);
      const towardLight = this.grad.x * lx + this.grad.z * lz;
      const gradient = softRamp(towardLight, shade.gradientRange);
      const height = softRamp(h, shade.heightRange);

      // 1 を中心に両方向へ振る。上りは明るく、下りは暗く。
      // 片側だけ暗くする式だと、濃くするほど画面全体が沈んで暗いところで真っ先に潰れる
      const k =
        1 +
        shade.gradientStrength * (2 * gradient - 1) +
        shade.heightStrength * (2 * height - 1);
      // 段に丸める（レトロ表現）。0 なら連続のまま
      const q = shade.levels > 0 ? Math.round(k * shade.levels) / shade.levels : k;
      color.setXYZ(i, this.base.r * q, this.base.g * q, this.base.b * q);
    }
    position.needsUpdate = true;
    color.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();
  }

  /** 濃淡の設定だけを変える（高さは変わらないので色だけ貼り直す） */
  setShade(shade: ShadeParams): void {
    this.update(this.green, shade);
  }
}

/**
 * カップ（§1）。直径 108mm、深さ 100mm の円筒。見た目は暗い円で十分。
 * 旗竿は必ず鉛直に立てる。傾き表現の基準になる。
 */
export function createHole(green: Green): THREE.Group {
  const h = CONFIG.hole;
  const group = new THREE.Group();
  const surfaceY = green.sampleHeight(h.position.x, h.position.z);
  const radius = h.diameter / 2;
  const dark = new THREE.MeshBasicMaterial({ color: h.cupColor });

  // 芝の面に開いた穴。表示メッシュ（20m を 128 分割 ＝ 1マス 15.6cm）に直径 10.8cm の穴は
  // 開けられないので、芝の上に濃い円を1枚置いて穴に見せる。
  // これがないとカップの内側は芝に隠れて、どこにカップがあるのか分からない
  const mouth = new THREE.Mesh(new THREE.CircleGeometry(radius, 24), dark);
  mouth.rotation.x = -Math.PI / 2;
  mouth.position.set(h.position.x, surfaceY + h.mouthLift, h.position.z);
  group.add(mouth);

  // カップの縁。切り口が白く見えるので、遠くからでもカップだと分かる
  const rim = new THREE.Mesh(
    new THREE.RingGeometry(radius, radius + h.rimWidth, 24),
    new THREE.MeshBasicMaterial({ color: h.rimColor }),
  );
  rim.rotation.x = -Math.PI / 2;
  rim.position.set(h.position.x, surfaceY + h.mouthLift, h.position.z);
  group.add(rim);

  // 内壁。上端をグリーン面に合わせる
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, h.depth, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: h.cupColor, side: THREE.BackSide }),
  );
  wall.position.set(h.position.x, surfaceY - h.depth / 2, h.position.z);
  group.add(wall);

  // 底
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(radius, 24), dark);
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.set(h.position.x, surfaceY - h.depth, h.position.z);
  group.add(bottom);

  // 旗竿。鉛直
  const stick = new THREE.Mesh(
    new THREE.CylinderGeometry(h.flagstickRadius, h.flagstickRadius, h.flagstickHeight, 8),
    new THREE.MeshLambertMaterial({ color: 0xf0f0f0 }),
  );
  stick.position.set(h.position.x, surfaceY - h.depth + h.flagstickHeight / 2, h.position.z);
  group.add(stick);

  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(h.flagWidth, h.flagHeight),
    new THREE.MeshBasicMaterial({ color: h.flagColor, side: THREE.DoubleSide }),
  );
  flag.position.set(
    h.position.x + h.flagWidth / 2,
    surfaceY - h.depth + h.flagstickHeight - h.flagHeight,
    h.position.z,
  );
  group.add(flag);

  return group;
}

/** グリーンの外に敷く地面。グリーンが宙に浮いて見えないようにするだけ */
export function createSurround(green: Green): THREE.Mesh {
  const s = CONFIG.surround;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(s.size, s.size),
    new THREE.MeshLambertMaterial({ color: s.color }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = green.minHeight - s.drop;
  return mesh;
}

/** 背景の木を数本。これも傾きの基準になるので必ず鉛直に立てる */
export function createTrees(green: Green, seed: number): THREE.Group {
  const t = CONFIG.trees;
  const rng = makeRng(seed);
  const group = new THREE.Group();
  const baseY = green.minHeight - CONFIG.surround.drop;
  const trunkMat = new THREE.MeshLambertMaterial({ color: t.trunkColor });
  const leafMat = new THREE.MeshLambertMaterial({ color: t.leafColor });

  for (let i = 0; i < t.count; i++) {
    const angle = ((i + rng() * 0.6) / t.count) * Math.PI * 2;
    const radius = lerp(t.radiusMin, t.radiusMax, rng());
    const height = lerp(t.heightMin, t.heightMax, rng());
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;

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
