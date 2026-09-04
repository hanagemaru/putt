// ボールの転がり計算（spec §2）。
// 固定タイムステップ 1/240 秒。決定論的に保つ（後でリプレイに使う）。
import { CONFIG, FEET_TO_METERS } from './config';
import type { Green } from './green';
import type { CoursePoint, SurfaceType } from './course/course-types';

const P = CONFIG.physics;

/**
 * 旗竿とボールが接触するときのボール中心と竿の中心の距離 [m]。
 * このゲームはピンを挿したまま打つ前提なので、カップの向こう縁より先に竿が来る。
 * 表示用の `flagstickMaxRadius` ではなく実寸の `flagstickRadius` を使う
 */
const FLAGSTICK_CONTACT_RADIUS = CONFIG.hole.flagstickRadius + CONFIG.ball.radius;

/**
 * 線分 p → p+d が中心 c 半径 r の円へ入る位置 t（0〜1）。入らないなら null。
 * 1 ステップで 2cm 進む速球でもすり抜けないよう、位置のサンプルではなく線分で見る
 */
function segmentCircleEntry(
  px: number,
  pz: number,
  dx: number,
  dz: number,
  cx: number,
  cz: number,
  r: number,
): number | null {
  const a = dx * dx + dz * dz;
  if (a <= 0) return null;
  const ox = px - cx;
  const oz = pz - cz;
  const c0 = ox * ox + oz * oz - r * r;
  if (c0 <= 0) return 0; // すでに円の中
  const b = 2 * (ox * dx + oz * dz);
  const disc = b * b - 4 * a * c0;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

export type RollStatus =
  /** まだ打っていない */
  | 'idle'
  /** 転がっている */
  | 'rolling'
  /** グリーン上で停止した */
  | 'stopped'
  /** カップイン */
  | 'holed'
  /** 池へ入った */
  | 'water'
  /** OBへ出た */
  | 'outOfBounds';

/**
 * スティンプ値 [ft] から摩擦による減速 MU [m/s^2] を逆算する。
 * スティンプメーターは初速 stimpReleaseSpeed でスティンプ値ぶんの距離を転がる、と読む。
 * 減速が一定なら 距離 = v^2 / (2 * MU) なので MU = v^2 / (2 * 距離)。
 * スティンプ 10ft なら 1.83^2 / (2 * 3.048) ≈ 0.55 m/s^2。
 */
export function frictionFromStimp(stimpFeet: number): number {
  const distance = stimpFeet * FEET_TO_METERS;
  const v = P.stimpReleaseSpeed;
  return (v * v) / (2 * distance);
}

/**
 * 摩擦を勾配が上回りはじめる勾配（無次元、1 で 100%）。
 * これを超える下りではボールは止まらない（§2 の停止条件の裏返し）。
 * スティンプ 10ft なら約 7.8%。
 */
export function criticalGradient(stimpFeet: number): number {
  return frictionFromStimp(stimpFeet) / (P.slopeFactor * P.gravity);
}

/** 方向 [rad] → 速度ベクトル。0 が -Z（奥）、+ で +X（右）へ回る */
export function directionToVelocity(
  speed: number,
  direction: number,
): { vx: number; vz: number } {
  return { vx: speed * Math.sin(direction), vz: -speed * Math.cos(direction) };
}

/** 地面種別ごとの摩擦倍率。芝以外は転がらないので 1 のままでよい */
function frictionMultiplier(surface: SurfaceType): number {
  if (surface === 'rough') return P.roughFrictionMultiplier;
  if (surface === 'deepRough') return P.deepRoughFrictionMultiplier;
  return 1;
}

export class Roller {
  x = 0;
  z = 0;
  vx = 0;
  vz = 0;
  status: RollStatus = 'idle';

  /** スティンプ値 [ft]。lil-gui から書き換わる */
  stimpFeet: number = P.stimpFeet;

  /** 軌跡 [x0, z0, x1, z1, ...]。pathSampleSteps ごとに記録 */
  readonly path: number[] = [];
  /** 打ち出してから転がった道のり [m] */
  distance = 0;
  /** 転がっていた時間 [s] */
  elapsed = 0;
  /** 竿に触れずカップの口を横切って出た回数 */
  lipOuts = 0;
  /** 旗竿に当たった回数（当たって入った分も含む） */
  flagstickHits = 0;

  /** 固定タイムステップの端数 */
  private accumulator = 0;
  private stepCount = 0;
  private readonly grad = { x: 0, z: 0 };
  /** カップの口の中にいる間 true。口へ入った瞬間の判定を一度だけにする */
  private inCupMouth = false;
  /** 竿に弾かれた直後 true。口から出るまで落下判定をしない */
  private ejectedFromCup = false;
  /** 口を横切っている間の弦の長さの比（0 なら横切っていない）。口から出るときに使う */
  private grazeChord = 0;
  /** 同じく、カップ中心が進行方向のどちら側にあるか（+1 / -1） */
  private grazeSide = 0;

  constructor(
    private readonly green: Green,
    private readonly cup: CoursePoint = CONFIG.hole.position,
  ) {}

  /** 現在の摩擦 [m/s^2] */
  get friction(): number {
    return frictionFromStimp(this.stimpFeet);
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vz);
  }

  /** ボールを置き直す（打たない） */
  place(x: number, z: number): void {
    this.x = x;
    this.z = z;
    this.vx = 0;
    this.vz = 0;
    this.status = 'idle';
    this.path.length = 0;
    this.distance = 0;
    this.elapsed = 0;
    this.lipOuts = 0;
    this.flagstickHits = 0;
    this.accumulator = 0;
    this.stepCount = 0;
    this.inCupMouth = false;
    this.ejectedFromCup = false;
    this.grazeChord = 0;
    this.grazeSide = 0;
  }

  /** 初速 [m/s] と方向 [rad] で打ち出す */
  launch(x: number, z: number, speed: number, direction: number): void {
    this.place(x, z);
    const v = directionToVelocity(speed, direction);
    this.vx = v.vx;
    this.vz = v.vz;
    this.path.push(this.x, this.z);
    this.status = speed > P.stopSpeed ? 'rolling' : 'stopped';
  }

  /**
   * 実時間 dt [s] ぶん進める。中身は固定タイムステップなので、
   * フレームレートが変わっても同じ初速なら同じ軌跡になる。
   */
  advance(dt: number): RollStatus {
    if (this.status !== 'rolling') return this.status;
    this.accumulator += Math.min(dt, P.maxStepPerFrame);
    while (this.accumulator >= P.timeStep && this.status === 'rolling') {
      this.accumulator -= P.timeStep;
      this.step(P.timeStep);
    }
    return this.status;
  }

  private step(dt: number): void {
    const surface = this.green.surfaceAt(this.x, this.z);
    const mu = this.friction * frictionMultiplier(surface);
    this.green.sampleGradient(this.x, this.z, this.grad);

    // 勾配による加速度。転がる球なので 5/7
    let ax = -P.slopeFactor * P.gravity * this.grad.x;
    let az = -P.slopeFactor * P.gravity * this.grad.z;
    const slopeAccel = Math.hypot(ax, az);

    // 摩擦は速度に依らず一定。ただし 1 ステップで速度を反転させないよう頭打ちにする
    const speed = Math.hypot(this.vx, this.vz);
    if (speed > 0) {
      const decel = Math.min(mu, speed / dt);
      ax -= (decel * this.vx) / speed;
      az -= (decel * this.vz) / speed;
    }

    this.vx += ax * dt;
    this.vz += az * dt;
    const px = this.x;
    const pz = this.z;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.distance += Math.hypot(this.x - px, this.z - pz);
    this.elapsed += dt;

    this.stepCount++;
    if (this.stepCount % P.pathSampleSteps === 0) this.path.push(this.x, this.z);

    if (this.checkCup(px, pz)) return;

    const nextSurface = this.green.surfaceAt(this.x, this.z);
    if (nextSurface === 'water') {
      this.vx = 0;
      this.vz = 0;
      this.finish('water');
      return;
    }
    if (nextSurface === 'ob') {
      this.vx = 0;
      this.vz = 0;
      this.finish('outOfBounds');
      return;
    }

    // 停止判定。勾配が摩擦を上回る場所では止めずに転がり続けさせる（＝下りでは止まらない）
    if (Math.hypot(this.vx, this.vz) < P.stopSpeed && slopeAccel <= mu) {
      this.vx = 0;
      this.vz = 0;
      // 口の中で止まったら落ちる（竿に当たって力尽きた場合を含む）
      this.finish(this.distanceToCup() <= P.cupCaptureRadius ? 'holed' : 'stopped');
    }
  }

  private distanceToCup(): number {
    return Math.hypot(this.x - this.cup.x, this.z - this.cup.z);
  }

  /**
   * 横ずれ（カップ中心への最接近距離）b [m] のときに捕まえられる速度の上限 [m/s]。
   * ボールは口を横切る間しか落ちられないので、上限は横切る弦の長さに従って下がる。
   * b が口の半径に達すると 0 になる
   */
  private captureSpeedAt(b: number): number {
    const ratio = b / P.cupCaptureRadius;
    const chord = 1 - ratio * ratio;
    if (chord <= 0) return 0;
    return P.cupCaptureSpeed * Math.pow(Math.sqrt(chord), P.cupCaptureFalloff);
  }

  /**
   * カップまわりの判定（§2）。決着したら true。
   * ピンは挿したままなので、口の中には旗竿が立っている。
   *   - 横ずれが FLAGSTICK_CONTACT_RADIUS 未満  → 竿に当たる
   *   - それ以上でカップの口の中             → 竿に触れず口を横切る（なめて入る／なめて外れる）
   * カップの縁で軌道を反転させる処理は持たない。
   */
  private checkCup(px: number, pz: number): boolean {
    const dx = this.x - px;
    const dz = this.z - pz;
    const cx = this.cup.x;
    const cz = this.cup.z;
    const prevDist = Math.hypot(px - cx, pz - cz);
    const dist = this.distanceToCup();

    // 口の外へ出きったら、入った瞬間の判定と竿に弾かれた直後の抑止を解く
    if (prevDist > P.cupCaptureRadius && dist > P.cupCaptureRadius) {
      this.inCupMouth = false;
      this.ejectedFromCup = false;
    }

    // 口へ入った瞬間の判定。1ステップで通り抜ける速球も線分で拾う
    if (!this.inCupMouth && !this.ejectedFromCup && prevDist > P.cupCaptureRadius) {
      const t = segmentCircleEntry(px, pz, dx, dz, cx, cz, P.cupCaptureRadius);
      if (t !== null) {
        this.inCupMouth = true;
        const ex = px + dx * t;
        const ez = pz + dz * t;
        const len = Math.hypot(dx, dz);
        if (len > 0) {
          // 入った点から進む向きで見た、カップ中心への最接近距離
          const ux = dx / len;
          const uz = dz / len;
          const offset = Math.abs((cx - ex) * uz - (cz - ez) * ux);
          const speed = Math.hypot(this.vx, this.vz);
          if (speed < this.captureSpeedAt(offset)) {
            this.holeOut();
            return true;
          }
          if (offset >= FLAGSTICK_CONTACT_RADIUS) {
            // 竿に触れずに口を横切って出ていく。曲がりと減速は口から出るときに一度だけ与える。
            // 横切る途中で向きを変えると、竿に当たらないはずの横ずれが竿へ入ってしまう
            const ratio = offset / P.cupCaptureRadius;
            this.grazeChord = Math.sqrt(Math.max(0, 1 - ratio * ratio));
            this.grazeSide =
              this.vx * (cz - ez) - this.vz * (cx - ex) > 0 ? 1 : -1;
            this.lipOuts++;
          }
          // 横ずれが竿の当たり判定の内側なら、このあとの竿の判定に任せる
        }
      }
    }

    // 口から出た。少し減速し、カップ側へわずかに曲がってそのまま先へ流れる
    if (this.grazeSide !== 0 && dist > P.cupCaptureRadius) {
      this.grazeCup();
      return false;
    }

    // 旗竿との衝突。XZ平面の円柱として線分と円の交差で見る
    const t = segmentCircleEntry(px, pz, dx, dz, cx, cz, FLAGSTICK_CONTACT_RADIUS);
    if (t === null) return false;
    let nx = px + dx * t - cx;
    let nz = pz + dz * t - cz;
    const nlen = Math.hypot(nx, nz);
    if (nlen <= 0) return false;
    nx /= nlen;
    nz /= nlen;
    const vn = this.vx * nx + this.vz * nz;
    if (vn >= 0) return false; // 竿から離れていく向きなら当たらない

    // 法線成分は反転させて大きく落とし、接線成分は比較的残す。
    // 法線は竿の中心からボールの中心へ向くので、右に当たれば右、左に当たれば左へ出ていく
    const vtx = this.vx - vn * nx;
    const vtz = this.vz - vn * nz;
    this.vx = vtx * P.flagstickTangentKeep - vn * nx * P.flagstickRestitution;
    this.vz = vtz * P.flagstickTangentKeep - vn * nz * P.flagstickRestitution;
    this.x = cx + nx * FLAGSTICK_CONTACT_RADIUS;
    this.z = cz + nz * FLAGSTICK_CONTACT_RADIUS;
    this.path.push(this.x, this.z);
    this.flagstickHits++;

    if (Math.hypot(this.vx, this.vz) < P.flagstickCaptureSpeed) {
      this.holeOut();
      return true;
    }
    this.ejectedFromCup = true;
    return false;
  }

  /** 竿に触れずに口を横切って出ていく場合。軌道は反転させない */
  private grazeCup(): void {
    const chord = this.grazeChord;
    const angle = P.cupGrazeTurn * chord * this.grazeSide;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const scale = 1 - P.cupGrazeSpeedLoss * chord;
    const vx = (this.vx * cos - this.vz * sin) * scale;
    const vz = (this.vx * sin + this.vz * cos) * scale;
    this.vx = vx;
    this.vz = vz;
    this.grazeChord = 0;
    this.grazeSide = 0;
    this.path.push(this.x, this.z);
  }

  private holeOut(): void {
    this.x = this.cup.x;
    this.z = this.cup.z;
    this.vx = 0;
    this.vz = 0;
    this.finish('holed');
  }

  private finish(status: RollStatus): void {
    this.status = status;
    this.path.push(this.x, this.z);
  }
}
