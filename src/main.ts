// ゲーム本体。READ → ADDRESS → STROKE → FOLLOW → CUP → RESULT の状態機械（spec §3）。
//
// 部品はすでにある。ここは配線に徹する。
//   green.ts        グリーンのハイトマップと表示メッシュ（表示と物理の唯一の情報源）
//   physics.ts      転がり計算（固定 1/240 秒）
//   swipe-measure.ts スワイプ計測（/swipe-test/ で検証済み）
//   stroke-view.ts  STROKE の 2D オーバーレイ
//   cameras.ts      各状態のカメラ姿勢と補間
//
// **走行中に俯瞰へ切り替えない。** 一人称のまま最後まで見せて、分析は止まってから（§3）。
import * as THREE from 'three';
import { CONFIG } from './config';
import {
  Green,
  GreenMesh,
  createHole,
  createSurround,
  createTrees,
  defaultGreenParams,
  defaultShadeParams,
} from './green';
import { Roller } from './physics';
import { StrokeView } from './stroke-view';
import {
  CameraRig,
  READ_VIEWS,
  READ_VIEW_LABEL,
  addressPose,
  cupPose,
  ease,
  followFov,
  lerpAngle,
  readPose,
  resultPose,
  projectedRadiusPx,
  strokePose,
  strokeUp,
  type ReadView,
} from './cameras';

const G = CONFIG.game;

// --- シーン ---------------------------------------------------------------

const app = document.getElementById('app')!;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.renderer.maxPixelRatio));
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(CONFIG.renderer.background);

/**
 * レトロなドット感（試作）。低い解像度のレンダーターゲットに描いて、
 * NearestFilter のまま全画面へ引き伸ばす。粒の大きさは pixelScale（何分の1で描くか）。
 * 1 のときは素通しで、これまで通り直接描く
 */
let pixelScale = 1;
const lowRes = new THREE.WebGLRenderTarget(1, 1, {
  minFilter: THREE.NearestFilter,
  magFilter: THREE.NearestFilter,
  depthBuffer: true,
});
const screenScene = new THREE.Scene();
const screenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const screenQuad = new THREE.Mesh(
  new THREE.PlaneGeometry(2, 2),
  new THREE.MeshBasicMaterial({ map: lowRes.texture }),
);
screenScene.add(screenQuad);

function renderFrame(): void {
  if (pixelScale <= 1) {
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    return;
  }
  renderer.setRenderTarget(lowRes);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  renderer.render(screenScene, screenCamera);
}

const camera = new THREE.PerspectiveCamera(
  CONFIG.camera.fov,
  1,
  CONFIG.camera.near,
  CONFIG.camera.far,
);
const rig = new CameraRig(camera);

// グリーン。ハイトマップが表示と物理の唯一の情報源（spec §1）。
// シードを差し替えられるように、地形にぶら下がるものはまとめて作り直す
const shade = defaultShadeParams();
let seed = seedFromUrl() ?? CONFIG.green.seed;
let green = new Green({ ...defaultGreenParams(), seed });

/** STROKE の間だけ消すもの。背景の木と外周の地面（真下を向いていれば映らない） */
const props = new THREE.Group();
scene.add(props);

/**
 * グリーンの表示メッシュと、**常に表示する**カップ・旗竿。
 * カップは実在するものなので、真下を見下ろす STROKE でも視野に入るなら見える（＝タップインの距離）。
 * 真下 1.5m・FOV 70度の視野は横 ±0.49m しかないので、遠いカップは自然に映らない
 */
const terrain = new THREE.Group();
scene.add(terrain);
let greenMesh: GreenMesh;

/** URL の ?seed=... 。同じグリーンをもう一度出したいときのため */
function seedFromUrl(): number | null {
  const raw = new URLSearchParams(location.search).get('seed');
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.floor(n) : null;
}

/** three.js のオブジェクトを畳む。作り直すたびに GPU のバッファを捨てる */
function disposeGroup(group: THREE.Group): void {
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    const mat = m.material;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat.dispose();
  });
  group.clear();
}

/** 地形と、地形にぶら下がるものを作り直す */
function buildTerrain(): void {
  disposeGroup(terrain);
  disposeGroup(props);
  greenMesh = new GreenMesh(green, shade);
  terrain.add(greenMesh.mesh);
  terrain.add(createHole(green));
  props.add(createSurround(green));
  props.add(createTrees(green, seed));
}

const dir = new THREE.DirectionalLight(0xffffff, CONFIG.light.directionalIntensity);
dir.position.set(
  CONFIG.light.directionalDirection.x,
  CONFIG.light.directionalDirection.y,
  CONFIG.light.directionalDirection.z,
);
scene.add(dir);
scene.add(new THREE.AmbientLight(0xffffff, CONFIG.light.ambientIntensity));

const ballMesh = new THREE.Mesh(
  new THREE.SphereGeometry(CONFIG.ball.radius, 20, 14),
  new THREE.MeshLambertMaterial({ color: CONFIG.ball.color }),
);
scene.add(ballMesh);

/**
 * ボールの影。影の計算はせず、真下に半透明の円を1枚置くだけ。
 * 接地点が分かると、転がっている間の距離と曲がりが読める（§3 FOLLOW）
 */
const ballShadow = new THREE.Mesh(
  new THREE.CircleGeometry(CONFIG.ball.radius * CONFIG.ball.shadowScale, 16),
  new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: CONFIG.ball.shadowOpacity,
    depthWrite: false,
  }),
);
ballShadow.rotation.x = -Math.PI / 2;
scene.add(ballShadow);

/** 軌跡。走行中は表示しない。止まってから出す（§3 RESULT） */
const trailPositions = new Float32Array(G.result.trailMaxPoints * 3);
const trailGeometry = new THREE.BufferGeometry();
trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
trailGeometry.setDrawRange(0, 0);
const trail = new THREE.Line(
  trailGeometry,
  new THREE.LineBasicMaterial({ color: G.result.trailColor }),
);
trail.frustumCulled = false;
trail.visible = false;
scene.add(trail);

// --- 状態 -----------------------------------------------------------------

type State = 'READ' | 'ADDRESS' | 'STROKE' | 'FOLLOW' | 'CUP' | 'RESULT';

let roller = new Roller(green);
const cup = new THREE.Vector2(CONFIG.hole.position.x, CONFIG.hole.position.z);
/** ボールの現在位置（XZ）。roller から毎フレーム写す */
const ball = new THREE.Vector2(G.ballStart.x, G.ballStart.z);
/** この一打を打つ前の位置。グリーンオーバーしたらここへ戻す */
const shotStart = new THREE.Vector2(G.ballStart.x, G.ballStart.z);

let state: State = 'READ';
let readView: ReadView = READ_VIEWS[0];
/** 狙い [rad]。0 が -Z、+ で +X へ回る（physics と同じ約束） */
let aim = 0;
/** ボール→カップ方向。狙いの振れ幅はここから測る */
let aimBase = 0;
let shots = 0;
let lastResult = '';
let notice = '';
let lastSwing = '';

/** FOLLOW のヨー・ピッチ。カメラは平行移動しない（§3） */
let followYaw = 0;
let followPitch = -Math.PI / 2;
let riseElapsed = 0;
/**
 * 打った直後、ボールが STROKE の視界から出るまでは視点を動かさない区間（§3 FOLLOW）。
 * すぐに顔や目線を動かさないのが安定したストロークの所作
 */
let holding = false;
let holdElapsed = 0;
/** RESULT に入ってから俯瞰へ動き出すまでの待ち [s] */
let settleElapsed = 0;
let resultReady = false;
/** STROKE の遷移が終わってからオーバーレイを出す。回っている最中に振らせない */
let strokeArmed = false;

const strokeCanvas = document.getElementById('stroke') as HTMLCanvasElement;
const strokeView = new StrokeView(strokeCanvas, {
  onImpact: (m) => {
    lastSwing =
      `スワイプ ${Math.round(m.speed)} px/s ・ 初速 ${m.speedMs.toFixed(2)} m/s ・ ` +
      `芯 ${m.offsetPx >= 0 ? '+' : ''}${Math.round(m.offsetPx)}px ×${m.gain.toFixed(2)}`;
    launch(m.speedMs, m.launchAngle);
  },
  onNotice: (text) => {
    notice = text;
  },
});

const tmpUp = new THREE.Vector3();
const tmpBall = new THREE.Vector3();

function ballWorld(out: THREE.Vector3): THREE.Vector3 {
  return out.set(ball.x, green.sampleHeight(ball.x, ball.y) + CONFIG.ball.radius, ball.y);
}

function distanceToCup(): number {
  return Math.hypot(ball.x - cup.x, ball.y - cup.y);
}

// --- 状態遷移 -------------------------------------------------------------

function enterRead(cut = false): void {
  state = 'READ';
  notice = '左右スワイプで視点、タップで構える';
  props.visible = true;
  ballMesh.visible = roller.status !== 'holed';
  trail.visible = false;
  aimBase = Math.atan2(cup.x - ball.x, -(cup.y - ball.y));
  aim = aimBase;
  readView = READ_VIEWS[0];
  const p = readPose(readView, ball, cup, green, camera.aspect);
  if (cut) rig.cut(p);
  else rig.transition(p, G.read.transition);
}

function switchReadView(step: number): void {
  const i = READ_VIEWS.indexOf(readView);
  readView = READ_VIEWS[(i + step + READ_VIEWS.length) % READ_VIEWS.length];
  rig.transition(readPose(readView, ball, cup, green, camera.aspect), G.read.transition);
}

function enterAddress(): void {
  state = 'ADDRESS';
  notice = '左右スワイプで狙い、タップで構える';
  rig.transition(addressPose(ball, aim, green, distanceToCup()), G.address.transition);
}

function enterStroke(): void {
  state = 'STROKE';
  notice = '';
  strokeArmed = false;
  // 背景は見えない。ボールとカップは 3D のまま実寸で見せる（§3 / §4）。
  // 真下を向いた視野は狭いので、カップが映るのはタップインの距離だけ
  props.visible = false;
  ballMesh.visible = true;
  updateBallMesh();
  rig.transition(strokePose(ball, green), G.stroke.transition, strokeUp(aim, tmpUp));
}

/** インパクト（§4.6）。計測結果を初速と方向に直して打ち出す */
function launch(speedMs: number, launchAngle: number): void {
  // 画面の左＝狙い方向。スワイプが画面下へ流れた分だけ狙いの左へ出る
  const direction = aim - launchAngle;
  shotStart.copy(ball);
  roller.launch(ball.x, ball.y, speedMs, direction);
  shots++;
  enterFollow();
}

function enterFollow(): void {
  state = 'FOLLOW';
  notice = '';
  trail.visible = false;
  followYaw = -aim;
  followPitch = -Math.PI / 2;
  riseElapsed = 0;
  holdElapsed = 0;
  // 打った直後は視点を動かさない。ボールが STROKE の視界から出るまで真下を見下ろしたまま
  holding = G.follow.holdUntilOffscreen;
  if (!holding) revealCourse();
}

/** 顔を上げる。ここで初めてホールが視界に入る（§3） */
function revealCourse(): void {
  holding = false;
  strokeView.exit();
  props.visible = true;
  ballMesh.visible = roller.status !== 'holed';
  updateBallMesh();
}

function enterCup(): void {
  state = 'CUP';
  // カット。カップ後方・芝の高さの定点（§3）
  rig.cut(cupPose(shotStart, cup, green));
}

/** ボールが完全に停止してから呼ぶ。ここで初めて俯瞰と軌跡を出す（§3） */
function enterResult(): void {
  state = 'RESULT';
  if (holding) revealCourse();
  settleElapsed = 0;
  resultReady = false;
  lastResult = describeResult();
  ballMesh.visible = roller.status !== 'holed';
}

/** 結果テキスト（§3）。打ち出しラインへの射影で オーバー／ショート と左右のズレを出す */
function describeResult(): string {
  if (roller.status === 'holed') return `カップイン（${shots} 打）`;
  const ux = cup.x - shotStart.x;
  const uz = cup.y - shotStart.y;
  const len = Math.hypot(ux, uz) || 1;
  const fx = ux / len;
  const fz = uz / len;
  const rx = ball.x - cup.x;
  const rz = ball.y - cup.y;
  const along = rx * fx + rz * fz;
  // 進行方向に対する右手側（three.js は右手系なので right = cross(forward, up)）
  const lateral = rx * -fz + rz * fx;

  const head = along >= 0 ? `${along.toFixed(1)}m オーバー` : `${(-along).toFixed(1)}m ショート`;
  const side =
    Math.abs(lateral) < 0.05
      ? ''
      : `、${lateral >= 0 ? '右' : '左'} ${Math.abs(lateral).toFixed(1)}m`;
  const over = roller.status === 'offGreen' ? 'グリーンオーバー ・ ' : '';
  return `${over}${head}${side}`;
}

/** RESULT でタップされた。次のパットへ */
function nextPutt(): void {
  if (roller.status === 'holed') {
    // 同じグリーン・同じカップで打ち直し
    ball.set(G.ballStart.x, G.ballStart.z);
    shots = 0;
    lastResult = '';
  } else if (roller.status === 'offGreen') {
    // 打つ前の位置へ戻す。打数はそのまま
    ball.copy(shotStart);
  }
  roller.place(ball.x, ball.y);
  updateBallMesh();
  enterRead();
}

/**
 * 別のグリーンにする。うねりはシード次第なので、いろいろな地形で読みを試すために要る。
 * URL にも書いておくので、面白い地形が出たらその URL でもう一度出せる
 */
function newGreen(next: number): void {
  seed = next >>> 0;
  green = new Green({ ...defaultGreenParams(), seed });
  roller = new Roller(green);
  buildTerrain();
  ball.set(G.ballStart.x, G.ballStart.z);
  shotStart.copy(ball);
  roller.place(ball.x, ball.y);
  shots = 0;
  lastResult = '';
  lastSwing = '';
  trail.visible = false;
  updateBallMesh();
  const url = new URL(location.href);
  url.searchParams.set('seed', String(seed));
  history.replaceState(null, '', url);
  enterRead(true);
}

// --- 軌跡 -----------------------------------------------------------------

function updateTrail(): void {
  const attribute = trailGeometry.attributes.position as THREE.BufferAttribute;
  const count = Math.min(roller.path.length / 2, G.result.trailMaxPoints);
  for (let i = 0; i < count; i++) {
    const x = roller.path[i * 2];
    const z = roller.path[i * 2 + 1];
    trailPositions[i * 3] = x;
    trailPositions[i * 3 + 1] = green.sampleHeight(x, z) + G.result.trailLift;
    trailPositions[i * 3 + 2] = z;
  }
  attribute.needsUpdate = true;
  trailGeometry.setDrawRange(0, count);
}

function updateBallMesh(): void {
  ballMesh.position.copy(ballWorld(tmpBall));
  ballShadow.position.set(
    tmpBall.x,
    green.sampleHeight(ball.x, ball.y) + CONFIG.ball.shadowLift,
    tmpBall.z,
  );
  ballShadow.visible = ballMesh.visible;
}

// --- 入力 -----------------------------------------------------------------
// STROKE のスワイプは stroke-view.ts が受け持つ。ここは READ / ADDRESS / RESULT のタップと
// 左右スワイプだけを見る。

let pointerId: number | null = null;
let downX = 0;
let downY = 0;
let downT = 0;
let lastX = 0;
let moved = 0;

const surface = renderer.domElement;

surface.addEventListener('pointerdown', (e) => {
  if (pointerId !== null) return;
  pointerId = e.pointerId;
  try {
    surface.setPointerCapture(e.pointerId);
  } catch {
    // 捕捉できないだけなので無視する
  }
  downX = e.clientX;
  downY = e.clientY;
  downT = e.timeStamp;
  lastX = e.clientX;
  moved = 0;
});

surface.addEventListener('pointermove', (e) => {
  if (e.pointerId !== pointerId) return;
  const dx = e.clientX - lastX;
  lastX = e.clientX;
  moved = Math.max(moved, Math.hypot(e.clientX - downX, e.clientY - downY));
  // ADDRESS だけは指の動きに追従して狙いが変わる。補助線は一切出さない（§3）
  if (state === 'ADDRESS') {
    const max = THREE.MathUtils.degToRad(G.aim.maxOffsetDeg);
    const offset = THREE.MathUtils.clamp(aim - aimBase + dx * G.aim.sensitivity, -max, max);
    aim = aimBase + offset;
  }
});

function pointerEnd(e: PointerEvent): void {
  if (e.pointerId !== pointerId) return;
  pointerId = null;
  const dx = e.clientX - downX;
  const held = e.timeStamp - downT;
  const isTap = moved <= G.tap.moveMaxPx && held <= G.tap.holdMaxMs;

  if (state === 'READ') {
    if (Math.abs(dx) >= G.tap.swipeMinPx) switchReadView(dx < 0 ? 1 : -1);
    else if (isTap) enterAddress();
    return;
  }
  if (state === 'ADDRESS') {
    if (isTap) enterStroke();
    return;
  }
  if (state === 'RESULT') {
    if (isTap && resultReady) nextPutt();
  }
}
surface.addEventListener('pointerup', pointerEnd);
surface.addEventListener('pointercancel', pointerEnd);

// --- 毎フレーム -----------------------------------------------------------

function stepPhysics(dt: number): void {
  roller.advance(dt);
  ball.set(roller.x, roller.z);
  ballMesh.visible = roller.status !== 'holed';
  updateBallMesh();
}

/**
 * 打った直後（視点を動かさない区間）。カメラは真下を向いたまま、
 * 3D のボールが実際に転がって画面から出ていくのを見せる。出たら true
 */
function updateHold(dt: number): boolean {
  holdElapsed += dt;
  ballWorld(tmpBall).project(camera);
  strokeView.update(dt);

  const m = 1 + G.follow.offscreenMargin;
  const offscreen = Math.abs(tmpBall.x) > m || Math.abs(tmpBall.y) > m || tmpBall.z > 1;
  // ボールが画面内で止まってしまった場合と、保険の上限時間でも顔を上げる
  return offscreen || roller.status !== 'rolling' || holdElapsed >= G.follow.holdMax;
}

/** FOLLOW（§3）。カメラ位置は固定。ヨーとピッチだけでボールを追い、遠ざかるほど FOV を絞る */
function updateFollow(dt: number): void {
  ballWorld(tmpBall);
  const dx = tmpBall.x - camera.position.x;
  const dy = tmpBall.y - camera.position.y;
  const dz = tmpBall.z - camera.position.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  const targetYaw = Math.atan2(-dx, -dz);
  // ボールを画面中央より下に置く。進む先が見えるように、ボールより少し上を見る
  const targetPitch =
    Math.asin(THREE.MathUtils.clamp(dy / len, -1, 1)) + THREE.MathUtils.degToRad(G.follow.leadDeg);

  riseElapsed = Math.min(riseElapsed + dt, G.follow.riseTime);
  if (riseElapsed < G.follow.riseTime) {
    // ボールが視界から出たあと、0.15 秒かけて視点が上がる
    const t = ease(riseElapsed / G.follow.riseTime);
    followYaw = lerpAngle(-aim, targetYaw, t);
    followPitch = -Math.PI / 2 + (targetPitch + Math.PI / 2) * t;
  } else {
    // 顔が上がったあとは時定数で遅れて追う。
    // 毎フレーム画面中心へ貼りつけると相対運動がゼロになって実質静止画に見える
    const k = 1 - Math.exp(-dt / G.follow.trackingTau);
    followYaw = lerpAngle(followYaw, targetYaw, k);
    followPitch += (targetPitch - followPitch) * k;
  }
  rig.applyYawPitch(followYaw, followPitch, followFov(len));
}

let lastTime = performance.now();

renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  const transitioning = rig.update(dt);

  switch (state) {
    case 'ADDRESS':
      // 遷移が終わったら、狙いの変化に追従させる
      if (!transitioning) rig.apply(addressPose(ball, aim, green, distanceToCup()));
      break;

    case 'STROKE':
      if (!transitioning && !strokeArmed) {
        strokeArmed = true;
        strokeView.enter();
      }
      strokeView.update(dt);
      break;

    case 'FOLLOW': {
      stepPhysics(dt);
      if (holding) {
        // 打った直後は視点を動かさない。ボールが視界から出たら顔を上げる
        if (updateHold(dt)) revealCourse();
      } else {
        updateFollow(dt);
      }
      if (roller.status !== 'rolling') enterResult();
      // カップまで 1.5m を切ったらカット（§3）。顔を上げるまではカメラを動かさない
      else if (!holding && distanceToCup() < G.cup.triggerDistance) enterCup();
      break;
    }

    case 'CUP':
      stepPhysics(dt);
      if (roller.status !== 'rolling') enterResult();
      break;

    case 'RESULT':
      if (!resultReady) {
        settleElapsed += dt;
        if (settleElapsed >= G.result.settleDelay) {
          resultReady = true;
          // ボールが完全に停止してから俯瞰へ。軌跡もここで初めて出す
          updateTrail();
          trail.visible = true;
          rig.transition(resultPose(shotStart, ball, cup, green), G.result.transition);
          notice = 'タップで次のパット';
        }
      }
      break;
  }

  updateHud();
  renderFrame();
});

// --- デバッグ表示（§5 の一部。全項目と lil-gui は T4） ---------------------

const hud = {
  state: document.getElementById('hud-state')!,
  view: document.getElementById('hud-view')!,
  aim: document.getElementById('hud-aim')!,
  dist: document.getElementById('hud-dist')!,
  shots: document.getElementById('hud-shots')!,
  swing: document.getElementById('hud-swing')!,
  result: document.getElementById('hud-result')!,
  notice: document.getElementById('hud-notice')!,
  seed: document.getElementById('hud-seed') as HTMLButtonElement,
  pixel: document.getElementById('hud-pixel') as HTMLButtonElement,
};

/**
 * ドット感の切り替え。既定は 2（採用した見た目）。比較用に OFF も残す。
 * 0: そのまま / 1: 低解像度に描いて引き伸ばす / 2: それに加えて濃淡を段に丸める
 */
const PIXEL_MODES = ['ドット OFF', 'ドット', 'ドット＋色を段に'];
let pixelMode = 2;

function applyPixelMode(): void {
  pixelScale = pixelMode === 0 ? 1 : CONFIG.pixel.scale;
  const levels = pixelMode === 2 ? CONFIG.pixel.levels : CONFIG.green.shade.levels;
  if (shade.levels !== levels) {
    shade.levels = levels;
    greenMesh.setShade(shade);
  }
  resizeLowRes();
}

hud.pixel.addEventListener('click', () => {
  pixelMode = (pixelMode + 1) % PIXEL_MODES.length;
  applyPixelMode();
});

// シードのボタン。押すと別の地形になる（READ / RESULT のときだけ）
hud.seed.addEventListener('click', () => {
  if (state !== 'READ' && state !== 'RESULT') return;
  newGreen(Math.floor(Math.random() * 100000));
});

function updateHud(): void {
  hud.state.textContent = state;
  hud.view.textContent = state === 'READ' ? READ_VIEW_LABEL[readView] : '';
  // 狙いはボール→カップ方向からのズレで出す。+ が右
  const offsetDeg = THREE.MathUtils.radToDeg(aim - aimBase);
  hud.aim.textContent = `狙い ${offsetDeg >= 0 ? '+' : ''}${offsetDeg.toFixed(1)}°`;
  hud.dist.textContent = `カップまで ${distanceToCup().toFixed(2)}m`;
  hud.shots.textContent = `${shots} 打`;
  hud.swing.textContent = lastSwing;
  hud.result.textContent = lastResult;
  hud.notice.textContent = notice;
  hud.seed.textContent = `シード ${seed} ⟳`;
  hud.pixel.textContent = PIXEL_MODES[pixelMode];
  hud.seed.disabled = state !== 'READ' && state !== 'RESULT';
}

// --- 画面サイズ -----------------------------------------------------------

/** 低解像度ターゲットを画面サイズに合わせる。粒の大きさは pixelScale で決まる */
function resizeLowRes(): void {
  const dpr = renderer.getPixelRatio();
  const w = Math.max(1, Math.round((app.clientWidth * dpr) / Math.max(pixelScale, 1)));
  const h = Math.max(1, Math.round((app.clientHeight * dpr) / Math.max(pixelScale, 1)));
  lowRes.setSize(w, h);
}

function resize(): void {
  const w = app.clientWidth;
  const h = app.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  resizeLowRes();
  strokeView.resize();
  // インパクトラインをボールの見かけの大きさに合わせる（§4.2）。
  // 真下から見たボールまでの距離は、視点高さから半径を引いたぶん
  strokeView.setBallRadiusPx(
    projectedRadiusPx(
      CONFIG.ball.radius,
      G.stroke.eyeHeight - CONFIG.ball.radius,
      CONFIG.camera.fov,
      h,
    ),
  );
}
resize();
window.addEventListener('resize', resize);

// --- 開始 -----------------------------------------------------------------

buildTerrain();
applyPixelMode();
roller.place(G.ballStart.x, G.ballStart.z);
ball.set(roller.x, roller.z);
updateBallMesh();
enterRead(true);
