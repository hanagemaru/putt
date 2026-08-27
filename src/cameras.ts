// 各状態のカメラ姿勢と、その間の補間（spec §3）。
// 姿勢は「位置・注視点・ROLL・FOV」の4つだけで表す。状態機械はここへ姿勢を要求するだけにして、
// カメラの作り方を main.ts に散らさない。
import * as THREE from 'three';
import { CONFIG } from './config';
import type { Green } from './green';

const G = CONFIG.game;

/** カメラの姿勢。位置と注視点はワールド座標 [m]、roll は [rad]、fov は [度] */
export interface CameraPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
  /** 視野の傾き [rad]。ADDRESS でだけ 0 以外になる */
  roll: number;
  fov: number;
}

/** READ の4定点（§3） */
export type ReadView = 'BEHIND_BALL' | 'BEHIND_HOLE' | 'LOW_LINE' | 'SIDE_MID';

export const READ_VIEWS: readonly ReadView[] = [
  'BEHIND_BALL',
  'BEHIND_HOLE',
  'LOW_LINE',
  'SIDE_MID',
];

export const READ_VIEW_LABEL: Record<ReadView, string> = {
  BEHIND_BALL: 'ボール後方',
  BEHIND_HOLE: 'カップ後方',
  LOW_LINE: '低い視点',
  SIDE_MID: '横から',
};

function pose(
  position: THREE.Vector3,
  target: THREE.Vector3,
  roll = 0,
  fov: number = CONFIG.camera.fov,
): CameraPose {
  return { position, target, roll, fov };
}

/** グリーン面から height [m] の高さの点 */
function above(green: Green, x: number, z: number, height: number): THREE.Vector3 {
  return new THREE.Vector3(x, green.sampleHeight(x, z) + height, z);
}

/** ボール → カップの水平方向の単位ベクトル（XZ） */
function towardCup(ball: THREE.Vector2, cup: THREE.Vector2): THREE.Vector2 {
  const d = new THREE.Vector2(cup.x - ball.x, cup.y - ball.y);
  if (d.lengthSq() === 0) return new THREE.Vector2(0, -1);
  return d.normalize();
}

/**
 * READ の定点（§3）。視点高さは現実的に。
 * どれもボールとカップを結ぶラインを基準に置く。
 */
export function readPose(view: ReadView, ball: THREE.Vector2, cup: THREE.Vector2, green: Green): CameraPose {
  const R = G.read;
  const dir = towardCup(ball, cup);
  // ラインの法線（右手側）
  const nx = -dir.y;
  const nz = dir.x;

  switch (view) {
    case 'BEHIND_BALL': {
      const x = ball.x - dir.x * R.behindBallDistance;
      const z = ball.y - dir.y * R.behindBallDistance;
      return pose(above(green, x, z, R.behindBallHeight), above(green, cup.x, cup.y, 0));
    }
    case 'BEHIND_HOLE': {
      const x = cup.x + dir.x * R.behindHoleDistance;
      const z = cup.y + dir.y * R.behindHoleDistance;
      return pose(above(green, x, z, R.behindHoleHeight), above(green, ball.x, ball.y, 0));
    }
    case 'LOW_LINE': {
      const x = ball.x - dir.x * R.lowLineDistance;
      const z = ball.y - dir.y * R.lowLineDistance;
      return pose(above(green, x, z, R.lowLineHeight), above(green, cup.x, cup.y, 0));
    }
    case 'SIDE_MID': {
      const mx = (ball.x + cup.x) / 2;
      const mz = (ball.y + cup.y) / 2;
      const x = mx + nx * R.sideMidOffset;
      const z = mz + nz * R.sideMidOffset;
      return pose(above(green, x, z, R.sideMidHeight), above(green, mx, mz, 0));
    }
  }
}

/**
 * ADDRESS（§3）。ボールの後方に立ち、狙った方向をまっすぐ見る。
 *
 * 傾けた視野（ROLL）で狙いを合わせても遊びとして意味がなかったので持たない。
 * 見下ろし角も角度では決めない。注視点をボールから狙い方向へ lookDistance 進んだ芝の上に置くと、
 * ピッチは幾何から決まり、距離が変わっても狙った先が画面に入る。
 * lookDistance はふだんカップまでの距離を渡す（＝狙った先にピンが見える）。
 */
export function addressPose(
  ball: THREE.Vector2,
  aim: number,
  green: Green,
  lookDistance: number,
): CameraPose {
  const A = G.address;
  // 狙い方向の単位ベクトル。physics と同じ約束（0 が -Z、+ で +X へ回る）
  const dx = Math.sin(aim);
  const dz = -Math.cos(aim);
  const position = above(green, ball.x - dx * A.back, ball.y - dz * A.back, A.eyeHeight);
  const reach = Math.max(lookDistance, A.lookDistanceMin);
  const tx = ball.x + dx * reach;
  const tz = ball.y + dz * reach;
  return pose(position, above(green, tx, tz, 0));
}

/**
 * STROKE（§3）。ボールの真上から真下を見下ろす。ROLL は 0（ボールを見る姿勢では視野は傾かない）。
 * 注視点はボールの真下。向きは呼び出し側が渡す up で決める（strokeUp を使う）。
 */
export function strokePose(ball: THREE.Vector2, green: Green): CameraPose {
  const position = above(green, ball.x, ball.y, G.stroke.eyeHeight);
  const target = above(green, ball.x, ball.y, 0);
  return pose(position, target);
}

/**
 * CUP（§3）。カップ後方・芝の高さの定点。ここで最後の曲がりと速度が見える。
 * 「カップ後方」はボールから見て奥側。カット（補間しない）で入る。
 */
export function cupPose(ball: THREE.Vector2, cup: THREE.Vector2, green: Green): CameraPose {
  const dir = towardCup(ball, cup);
  // ラインから少し横へずらす。真後ろだと旗竿が画面中央でボールを隠す
  const x = cup.x + dir.x * G.cup.back - dir.y * G.cup.sideOffset;
  const z = cup.y + dir.y * G.cup.back + dir.x * G.cup.sideOffset;
  return pose(above(green, x, z, G.cup.height), above(green, cup.x, cup.y, G.cup.lookAtHeight));
}

/**
 * RESULT（§3）。斜め45度の俯瞰。**ボールが完全に停止してからしか使わない。**
 * ボールとカップの中間を見下ろし、両方が入る距離まで引く。
 */
export function resultPose(
  from: THREE.Vector2,
  ball: THREE.Vector2,
  cup: THREE.Vector2,
  green: Green,
): CameraPose {
  const R = G.result;
  // 打ち出し位置・停止位置・カップの3点が入るように中心と距離を取る
  const minX = Math.min(from.x, ball.x, cup.x);
  const maxX = Math.max(from.x, ball.x, cup.x);
  const minZ = Math.min(from.y, ball.y, cup.y);
  const maxZ = Math.max(from.y, ball.y, cup.y);
  const mx = (minX + maxX) / 2;
  const mz = (minZ + maxZ) / 2;
  const span = Math.hypot(maxX - minX, maxZ - minZ);
  const distance = Math.max(span * R.distanceScale, R.distanceMin);
  const pitch = THREE.MathUtils.degToRad(R.pitchDeg);

  // 打ち出し方向の真後ろから yawDeg だけ回り込む。真後ろだと曲がりが線に潰れて読めない
  const line = towardCup(from, cup);
  const yaw = THREE.MathUtils.degToRad(R.yawDeg);
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const dirX = line.x * cos - line.y * sin;
  const dirZ = line.x * sin + line.y * cos;

  const target = above(green, mx, mz, 0);
  const position = new THREE.Vector3(
    mx - dirX * Math.cos(pitch) * distance,
    target.y + Math.sin(pitch) * distance,
    mz - dirZ * Math.cos(pitch) * distance,
  );
  return pose(position, target, 0, R.fov);
}

/** ease-in-out。遷移の頭と尻を丸める */
export function ease(t: number): number {
  const c = Math.min(Math.max(t, 0), 1);
  return c < 0.5 ? 2 * c * c : 1 - Math.pow(-2 * c + 2, 2) / 2;
}

/** [-π, π) に畳んだ差で角度を補間する */
export function lerpAngle(a: number, b: number, t: number): number {
  return a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
}

/**
 * STROKE のカメラの up（＝画面の上方向）。
 * スワイプは右から左へ振るので、**画面の左が狙った方向**になっていないと、
 * 左へ振ったボールが画面の上へ飛んでいくように見える。狙い方向が画面左に写る up は、
 * 狙いベクトル (ax, az)（physics と同じ約束で 0 が -Z、+ で +X へ回る）を XZ 平面で 90 度回した (-az, ax)。
 * 右打ちで目標が左、足元が画面手前という真上からの見え方とも一致する。
 */
export function strokeUp(aim: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(Math.cos(aim), 0, Math.sin(aim));
}

/**
 * 半径 radius [m] の球が distance [m] 先にあるときの画面上の半径 [px]。
 * ストローク画面のインパクトラインを実寸に合わせるために使う（§4.2）。
 * 3D で描いているボールと同じ大きさになるので、px の定数を別に持たない
 */
export function projectedRadiusPx(
  radius: number,
  distance: number,
  fovDeg: number,
  viewportHeightPx: number,
): number {
  const half = Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2) * distance;
  return (radius / half) * (viewportHeightPx / 2);
}

const UP_Y = new THREE.Vector3(0, 1, 0);
const tmpMatrix = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const ROLL_AXIS = new THREE.Vector3(0, 0, 1);

/**
 * 姿勢を回転に直す。
 * up は「画面の上方向」。真下を見下ろす STROKE では lookAt が縮退するので、
 * 呼び出し側から up を渡す（STROKE は strokeUp。画面左方向＝狙った方向、§4.1）。
 * ROLL は視線まわりの回転なので、向きを決めたあとにローカル Z 軸で回す。
 */
export function poseQuaternion(p: CameraPose, out: THREE.Quaternion, up?: THREE.Vector3): THREE.Quaternion {
  tmpMatrix.lookAt(p.position, p.target, up ?? UP_Y);
  out.setFromRotationMatrix(tmpMatrix);
  if (p.roll !== 0) out.multiply(tmpQuat.setFromAxisAngle(ROLL_AXIS, p.roll));
  return out;
}

/**
 * カメラの姿勢を持ち、状態遷移の間だけ補間する。
 * 状態機械はここへ「この姿勢へ、この秒数で」と言うだけにして、補間を散らさない。
 */
export class CameraRig {
  private readonly fromPos = new THREE.Vector3();
  private readonly fromQuat = new THREE.Quaternion();
  private fromFov: number = CONFIG.camera.fov;
  private readonly toPos = new THREE.Vector3();
  private readonly toQuat = new THREE.Quaternion();
  private toFov: number = CONFIG.camera.fov;
  private elapsed = 0;
  private duration = 0;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  get transitioning(): boolean {
    return this.elapsed < this.duration;
  }

  /** 補間せずに切り替える（カット） */
  cut(p: CameraPose, up?: THREE.Vector3): void {
    this.duration = 0;
    this.elapsed = 0;
    this.apply(p, up);
  }

  /** duration [s] かけて姿勢を寄せる */
  transition(p: CameraPose, duration: number, up?: THREE.Vector3): void {
    this.fromPos.copy(this.camera.position);
    this.fromQuat.copy(this.camera.quaternion);
    this.fromFov = this.camera.fov;
    this.toPos.copy(p.position);
    poseQuaternion(p, this.toQuat, up);
    this.toFov = p.fov;
    this.elapsed = 0;
    this.duration = duration;
  }

  /** 遷移中でなければ即座に反映する。ADDRESS で狙いを動かしている間などに使う */
  apply(p: CameraPose, up?: THREE.Vector3): void {
    this.camera.position.copy(p.position);
    poseQuaternion(p, this.camera.quaternion, up);
    this.setFov(p.fov);
  }

  /** ヨーとピッチだけで向きを作る。FOLLOW はカメラを平行移動させない（§3） */
  applyYawPitch(yaw: number, pitch: number, fov: number): void {
    this.camera.rotation.set(pitch, yaw, 0, 'YXZ');
    this.setFov(fov);
  }

  /** 遷移中なら進める。戻り値は遷移が続いているか */
  update(dt: number): boolean {
    if (!this.transitioning) return false;
    this.elapsed = Math.min(this.elapsed + dt, this.duration);
    const t = ease(this.elapsed / this.duration);
    this.camera.position.lerpVectors(this.fromPos, this.toPos, t);
    this.camera.quaternion.slerpQuaternions(this.fromQuat, this.toQuat, t);
    this.setFov(this.fromFov + (this.toFov - this.fromFov) * t);
    return true;
  }

  private setFov(fov: number): void {
    if (this.camera.fov === fov) return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }
}

/**
 * FOLLOW の FOV（§3）。ボールが遠ざかるにつれて絞る（目を凝らす表現）。
 * 距離が近いうちは fovNear、fovFarDistance 以遠で fovFar。
 */
export function followFov(distance: number): number {
  const F = G.follow;
  const t = THREE.MathUtils.clamp(
    (distance - F.fovNearDistance) / (F.fovFarDistance - F.fovNearDistance),
    0,
    1,
  );
  return F.fovNear + (F.fovFar - F.fovNear) * ease(t);
}
