// 各状態のカメラ姿勢と、その間の補間（spec §3）。
// 姿勢は「位置・注視点・ROLL・FOV」の4つだけで表す。状態機械はここへ姿勢を要求するだけにして、
// カメラの作り方を main.ts に散らさない。
import * as THREE from 'three';
import { CONFIG } from './config';
import type { CourseBounds, CoursePoint } from './course/course-types';

const G = CONFIG.game;

/** 見た目側の高さだけを差し替えられる最小インターフェース。 */
export interface HeightSampler {
  sampleHeight(x: number, z: number): number;
}

/** カメラの姿勢。位置と注視点はワールド座標 [m]、roll は [rad]、fov は [度] */
export interface CameraPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
  /** 視線まわりの傾き [rad] */
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
  // 旧READの初期画面。ゲームフローでは使わないのでこのラベルは画面に出ない（§3）
  BEHIND_BALL: '旧ボール後方',
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
function above(green: HeightSampler, x: number, z: number, height: number): THREE.Vector3 {
  return new THREE.Vector3(x, green.sampleHeight(x, z) + height, z);
}

/** ボール → カップの水平方向の単位ベクトル（XZ） */
function towardCup(ball: THREE.Vector2, cup: THREE.Vector2): THREE.Vector2 {
  const d = new THREE.Vector2(cup.x - ball.x, cup.y - ball.y);
  if (d.lengthSq() === 0) return new THREE.Vector2(0, -1);
  return d.normalize();
}

/** 横方向の半画角の tan。縦画面は横が狭いので、収まるかどうかはこちらで決まる */
function horizontalHalfTan(fovDeg: number, aspect: number): number {
  return Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2) * aspect;
}

/**
 * READ の定点（§3）。視点高さは現実的に。
 *
 * **どの視点でもボールとカップが両方見えること。** 片方でも画面から外れると、
 * 何を映しているのか分からず読みに使えない。そのために注視点は常に
 * ボールとカップの中間に置き、横から見る視点は2点が収まる距離まで引く。
 */
export function readPose(
  view: ReadView,
  ball: THREE.Vector2,
  cup: THREE.Vector2,
  green: HeightSampler,
  aspect: number,
): CameraPose {
  const R = G.read;
  const dir = towardCup(ball, cup);
  // ラインの法線（右手側）
  const nx = -dir.y;
  const nz = dir.x;
  const mx = (ball.x + cup.x) / 2;
  const mz = (ball.y + cup.y) / 2;
  // 注視点はいつもラインの中点。どちらか一方を見ると、もう一方が画面から外れる
  const mid = above(green, mx, mz, 0);
  const span = Math.hypot(cup.x - ball.x, cup.y - ball.y);

  switch (view) {
    case 'BEHIND_BALL': {
      const x = ball.x - dir.x * R.behindBallDistance;
      const z = ball.y - dir.y * R.behindBallDistance;
      return pose(above(green, x, z, R.behindBallHeight), mid);
    }
    case 'BEHIND_HOLE': {
      // 読みやすさを優先し、ボールとカップを結ぶ線上に立つ。
      // 旗竿・旗の透過は main.ts 側でこの視点の間だけ行う。
      const x = cup.x + dir.x * R.behindHoleDistance - nx * R.behindHoleSideOffset;
      const z = cup.y + dir.y * R.behindHoleDistance - nz * R.behindHoleSideOffset;
      // 遠い実寸ボールを読みやすくするため、この視点だけFOVを狭める。
      return pose(above(green, x, z, R.behindHoleHeight), mid, 0, R.behindHoleFov);
    }
    case 'LOW_LINE': {
      const x = ball.x - dir.x * R.lowLineDistance;
      const z = ball.y - dir.y * R.lowLineDistance;
      return pose(above(green, x, z, R.lowLineHeight), mid);
    }
    case 'SIDE_MID': {
      // ラインは画面の横方向に寝るので、横の画角に 2点が収まる距離まで引く
      const need = ((span / 2) * R.sideMidFitMargin) / horizontalHalfTan(CONFIG.camera.fov, aspect);
      const offset = Math.max(R.sideMidOffset, need);
      const x = mx + nx * offset;
      const z = mz + nz * offset;
      return pose(above(green, x, z, R.sideMidHeight), mid);
    }
  }
}

/**
 * LOW_LINE での方向調整。
 * 通常の方向調整と同じく、ボールを旋回中心として現在の aim の真後ろへカメラを回す。
 * 高さとボールからの距離だけ LOW_LINE 専用値を使い、低い位置から地形を見ながら狙える。
 */
export function lowLineAimPose(
  ball: THREE.Vector2,
  _cup: THREE.Vector2,
  aim: number,
  green: HeightSampler,
  lookDistance: number,
): CameraPose {
  const R = G.read;
  const dx = Math.sin(aim);
  const dz = -Math.cos(aim);
  const position = above(
    green,
    ball.x - dx * R.lowLineDistance,
    ball.y - dz * R.lowLineDistance,
    R.lowLineHeight,
  );
  const reach = Math.max(lookDistance, G.address.lookDistanceMin);
  return pose(position, above(green, ball.x + dx * reach, ball.y + dz * reach, 0));
}

/**
 * 視点の高さと水平距離から、その点が水平線より何ラジアン下に見えるかを返す。
 */
function depression(position: THREE.Vector3, x: number, y: number, z: number): number {
  return Math.atan2(position.y - y, Math.hypot(x - position.x, z - position.z));
}

/**
 * 注視点を「ボールが画面内に残る」ところまで下げ直す。
 *
 * ピッチを注視点だけで決めると、ホールが長いほど視線が水平に近づき、
 * 足元のボールが画面下端から外れる。ADDRESS の立ち位置（後方 1.5m・目線 1.5m）では
 * ボールは視点から約45度下にあり、縦の半画角35度より大きいので、
 * 遠いカップを見るほど必ず外れる。
 *
 * 注視点の距離に上限を置く手もあるが、その上限は画角・立ち位置・目線の高さが
 * 変わるたびに合わなくなる。ここでは「ボールの接地点が画面高さの
 * `ballScreenMaxFraction` より下へは行かない」という要求そのものを幾何で解き、
 * **足りない分だけ**視線を下げる。近いホールでは何も変わらず、
 * 狙った先（＝ピン）は画角の中に残る。
 */
function keepBallOnScreen(
  position: THREE.Vector3,
  target: THREE.Vector3,
  ball: THREE.Vector2,
  green: HeightSampler,
  fovDeg: number,
): THREE.Vector3 {
  const ballY = green.sampleHeight(ball.x, ball.y);
  // 視線に対してボールが何ラジアン下に見えてよいか。
  // 画面高さの割合 f は ndc へ直すと 2f - 1。three.js の fov は縦なのでアスペクトは要らない
  const ndc = G.address.ballScreenMaxFraction * 2 - 1;
  const allowBelowAxis = Math.atan(ndc * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
  const ballDepression = depression(position, ball.x, ballY, ball.y);
  const requiredPitch = ballDepression - allowBelowAxis;
  const naturalPitch = depression(position, target.x, target.y, target.z);
  if (naturalPitch >= requiredPitch) return target;

  // 向きだけ下へ倒す。注視点の水平方向と距離は変えない（＝狙っている方向はそのまま）
  const length = position.distanceTo(target);
  const hx = target.x - position.x;
  const hz = target.z - position.z;
  const horizontal = Math.hypot(hx, hz) || 1;
  const cos = Math.cos(requiredPitch);
  return new THREE.Vector3(
    position.x + (hx / horizontal) * cos * length,
    position.y - Math.sin(requiredPitch) * length,
    position.z + (hz / horizontal) * cos * length,
  );
}

/**
 * ADDRESS（§3）。ボールの後方に立ち、狙った方向をまっすぐ見る。
 *
 * 傾けた視野（ROLL）で狙いを合わせても遊びとして意味がなかったので持たない。
 * 見下ろし角も角度では決めない。注視点をボールから狙い方向へ lookDistance 進んだ芝の上に置くと、
 * ピッチは幾何から決まり、距離が変わっても狙った先が画面に入る。
 * lookDistance はふだんカップまでの距離を渡す（＝狙った先にピンが見える）。
 * ただし長いホールでは視線が寝すぎて足元のボールが画面から外れるので、
 * そのときだけ `keepBallOnScreen` が視線を下げ直す。
 */
export function addressPose(
  ball: THREE.Vector2,
  aim: number,
  green: HeightSampler,
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
  const target = above(green, tx, tz, 0);
  return pose(position, keepBallOnScreen(position, target, ball, green, CONFIG.camera.fov));
}

/**
 * STROKE（§3）。ボールの真上から真下を見下ろす。ROLL は 0（ボールを見る姿勢では視野は傾かない）。
 * 注視点はボールの真下。向きは呼び出し側が渡す up で決める（strokeUp を使う）。
 */
export function strokePose(ball: THREE.Vector2, green: HeightSampler): CameraPose {
  const position = above(green, ball.x, ball.y, G.stroke.eyeHeight);
  const target = above(green, ball.x, ball.y, 0);
  return pose(position, target);
}

/**
 * STROKE 中の「カップ確認」。カメラ位置は真下視点と同じボール真上のまま、
 * 視線だけ現在の aim 方向へ向ける。カップ中心そのものへ固定しないので、この画面でも狙いを調整できる。
 * 傾きROLLは不採用。視野は常に水平基準のまま。
 */
export function strokeCupPose(
  ball: THREE.Vector2,
  aim: number,
  green: HeightSampler,
  lookDistance: number,
): CameraPose {
  const dx = Math.sin(aim);
  const dz = -Math.cos(aim);
  const reach = Math.max(lookDistance, G.address.lookDistanceMin);
  const position = above(green, ball.x, ball.y, G.stroke.eyeHeight);
  const target = above(
    green,
    ball.x + dx * reach,
    ball.y + dz * reach,
    G.stroke.cupCheckLookAtHeight,
  );
  return pose(position, target);
}

/**
 * STROKEカップ確認で、0.5mガイドをボールから狙い方向へ進める距離 [m]。
 *
 * この視点はボール真上から前を見るので、ボール直後のガイドは視線のはるか下にあって入らない。
 * 視線を下げるとカップと旗竿が画面から出てしまうため、代わりにガイドを前へ滑らせる。
 * 手前端が画面高さの `cupCheckGuideScreenFraction` に来る距離を見下ろし角から解くので、
 * ホールの長さが変わっても画面上のガイドの位置は動かない。
 */
export function cupCheckGuideOffset(
  ball: THREE.Vector2,
  aim: number,
  green: HeightSampler,
  lookDistance: number,
  guideLift: number,
  minOffset: number,
  screenFraction: number = G.stroke.cupCheckGuideScreenFraction,
): number {
  const p = strokeCupPose(ball, aim, green, lookDistance);
  const pitch = depression(p.position, p.target.x, p.target.y, p.target.z);
  const frac = screenFraction;
  // 置きたい点の伏角。視線から下へ、画面の割合ぶんだけ倒したところ。
  // frac が 1 を超えると画面下端より下、つまり画面の外になる
  const target = pitch + Math.atan((frac * 2 - 1) * Math.tan(THREE.MathUtils.degToRad(CONFIG.camera.fov) / 2));
  const drop = p.position.y - (green.sampleHeight(ball.x, ball.y) + guideLift);
  const offset = drop / Math.tan(target);
  return Number.isFinite(offset) ? Math.max(minOffset, offset) : minOffset;
}

/**
 * CUP（§3）。カップ後方・芝の高さの定点。ここで最後の曲がりと速度が見える。
 * 「カップ後方」はボールから見て奥側。カット（補間しない）で入る。
 */
export function cupPose(ball: THREE.Vector2, cup: THREE.Vector2, green: HeightSampler): CameraPose {
  const dir = towardCup(ball, cup);
  // ラインから少し横へずらす。真後ろだと旗竿が画面中央でボールを隠す
  const x = cup.x + dir.x * G.cup.back - dir.y * G.cup.sideOffset;
  const z = cup.y + dir.y * G.cup.back + dir.x * G.cup.sideOffset;
  return pose(above(green, x, z, G.cup.height), above(green, cup.x, cup.y, G.cup.lookAtHeight));
}

/**
 * RESULT（§3）。ほぼ真上の俯瞰。**ボールが完全に停止してからしか使わない。**
 * 打ち出し位置・停止位置・カップが入る距離まで引く。
 */
export function resultPose(
  from: THREE.Vector2,
  ball: THREE.Vector2,
  cup: THREE.Vector2,
  green: HeightSampler,
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

/**
 * マップでコースを 180 度回すか（§3）。
 *
 * ゴルフのコース図の約束どおり、**常にカップが画面上・ティーが画面下**にする。
 * カメラを枠の +Z 側に置くと画面の上は -Z なので、カップが +Z 側にあるホールだけ
 * カメラを -Z 側へ置き換える。向きはホールごとに tee → cup で決まり、
 * **ホールの途中でボールが動いても変わらない**（基準は常にティーとカップ）。
 *
 * 回すのはワールドの ±Z のどちらを画面上にするかだけで、斜めには回さない。
 * コース枠は原点中心の軸並行な長方形なので、枠取りの計算はそのまま使える。
 */
export function courseMapRotated(tee: CoursePoint, cup: CoursePoint): boolean {
  return cup.z > tee.z;
}

/**
 * マップで、ワールドの +X が画面のどちら向きに写るか（+1 なら右、-1 なら左）。
 * 180 度回すと左右も入れ替わるので、マーカーが画面のどちら半分にいるかの判定に使う。
 */
export function courseMapScreenXSign(tee: CoursePoint, cup: CoursePoint): number {
  return courseMapRotated(tee, cup) ? -1 : 1;
}

/**
 * コースマップ（§3）。コース全体（幅 X・長さ Z の長方形）を真上から見渡す。
 * **ボールが止まっている間しか使わない。**
 *
 * RESULT の俯瞰との違いは枠取りだけ。3点ではなく `course.bounds` が収まる距離まで引く。
 * 縦画面は横の画角が横幅ぶんだけ狭いので、「横が収まる距離」と「縦が収まる距離」の
 * 遠いほうを採らないと、幅の広いコースが左右にはみ出す。
 *
 * コース座標系は枠の中心が原点（`surfaceAt` の判定と同じ約束）。
 * 見下ろす向きは `courseMapRotated` で決まり、**カップが必ず画面上**に来る。
 */
export function courseMapPose(
  bounds: CourseBounds,
  tee: CoursePoint,
  cup: CoursePoint,
  green: HeightSampler,
  aspect: number,
): CameraPose {
  const M = G.courseMap;
  const halfTan = Math.tan(THREE.MathUtils.degToRad(M.fov) / 2);
  // 縦（Z）が縦画面に収まる距離と、横（X）が収まる距離
  const needLength = ((bounds.length / 2) * M.fitMargin) / halfTan;
  const needWidth = ((bounds.width / 2) * M.fitMargin) / (halfTan * aspect);
  const distance = Math.max(needLength, needWidth, M.distanceMin);
  const pitch = THREE.MathUtils.degToRad(M.pitchDeg);
  // カメラを置く側。ここに置いた側と反対の向きが画面の上になる
  const side = courseMapRotated(tee, cup) ? -1 : 1;

  const target = above(green, 0, 0, 0);
  const position = new THREE.Vector3(
    0,
    target.y + Math.sin(pitch) * distance,
    // カメラを引く側と反対（ティー→カップの向き）が画面の上に写る
    side * Math.cos(pitch) * distance,
  );
  return pose(position, target, 0, M.fov);
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
