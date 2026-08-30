// ボールの転がり計算（spec §2）。
// 固定タイムステップ 1/240 秒。決定論的に保つ（後でリプレイに使う）。
import { CONFIG, FEET_TO_METERS } from './config';
import type { Green } from './green';
import type { CoursePoint, SurfaceType } from './course/course-types';

const P = CONFIG.physics;

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
  /** リップアウトした回数 */
  lipOuts = 0;

  /** 固定タイムステップの端数 */
  private accumulator = 0;
  private stepCount = 0;
  private readonly grad = { x: 0, z: 0 };

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
    this.accumulator = 0;
    this.stepCount = 0;
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

    if (this.checkCup()) return;

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
      this.finish('stopped');
    }
  }

  /** カップイン／リップアウト判定（§2）。決着したら true */
  private checkCup(): boolean {
    const dx = this.x - this.cup.x;
    const dz = this.z - this.cup.z;
    const dist = Math.hypot(dx, dz);
    if (dist > P.cupCaptureRadius) return false;

    if (Math.hypot(this.vx, this.vz) < P.cupCaptureSpeed) {
      this.x = this.cup.x;
      this.z = this.cup.z;
      this.vx = 0;
      this.vz = 0;
      this.finish('holed');
      return true;
    }

    // リップアウト。カップの縁で速度ベクトルを反射させ、少し減速させて転がり続ける
    const nx = dist > 0 ? dx / dist : 1;
    const nz = dist > 0 ? dz / dist : 0;
    const vn = this.vx * nx + this.vz * nz;
    this.vx = (this.vx - 2 * vn * nx) * P.lipOutDamping;
    this.vz = (this.vz - 2 * vn * nz) * P.lipOutDamping;
    this.x = this.cup.x + nx * P.cupCaptureRadius;
    this.z = this.cup.z + nz * P.cupCaptureRadius;
    this.lipOuts++;
    this.path.push(this.x, this.z);
    return false;
  }

  private finish(status: RollStatus): void {
    this.status = status;
    this.path.push(this.x, this.z);
  }
}
