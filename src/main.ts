// ゲーム本体。ADDRESS（読み＋方向調整）→ STROKE → FOLLOW → CUP → RESULT の状態機械（spec §3）。
//
// 部品はすでにある。ここは配線に徹する。
//   green.ts               グリーンのハイトマップと表示メッシュ（表示と物理の唯一の情報源）
//   physics.ts             転がり計算（固定 1/240 秒）
//   swipe-measure.ts       スワイプ計測（/swipe-test/ で検証済み）
//   stroke-view.ts         STROKE の 2D オーバーレイ
//   cameras.ts             各状態のカメラ姿勢と補間
//   smooth-line-overlay.ts 補助線・軌跡の高解像度表示
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
import { SmoothLineOverlay } from './smooth-line-overlay';
import { StrokeView } from './stroke-view';
import {
  CameraRig,
  READ_VIEW_LABEL,
  addressPose,
  cupPose,
  followFov,
  lerpAngle,
  lowLineAimPose,
  readPose,
  resultPose,
  projectedRadiusPx,
  strokeCupPose,
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
// 引き伸ばすときに色の段数も絞る。頂点カラーだけ段にしてもライトの陰影が連続なので、
// それだけでは段の境目がぼやける。空・木・ボールまで含めて丸めるとドット絵らしくなる。
// 丸めは sRGB の側で行う（リニアのまま丸めると暗い側だけ段が細かくなる）
const screenMaterial = new THREE.ShaderMaterial({
  uniforms: { map: { value: lowRes.texture }, levels: { value: 0 } },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `,
  fragmentShader: `
    uniform sampler2D map;
    uniform float levels;
    varying vec2 vUv;
    void main() {
      vec3 lin = texture2D(map, vUv).rgb;
      if (levels > 0.0) {
        vec3 srgb = pow(clamp(lin, 0.0, 1.0), vec3(1.0 / 2.2));
        srgb = floor(srgb * levels + 0.5) / levels;
        lin = pow(srgb, vec3(2.2));
      }
      gl_FragColor = vec4(lin, 1.0);
      #include <colorspace_fragment>
    }
  `,
});
const screenQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), screenMaterial);
screenQuad.frustumCulled = false;
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

// アンジュレーションは現在「強調」＋形状見た目1.5倍で固定して実機確認する。
// 物理と高さ色は強調版0.20m、3D形状のYだけ1.5倍。比較コードは再調整用に残す。
const shade = defaultShadeParams();
const UNDULATION_MODES = [
  { label: '地形:標準', amplitude: CONFIG.green.undulationAmplitude, visualScale: 1 },
  { label: '地形:強調', amplitude: CONFIG.green.compareEnhancedAmplitude, visualScale: 1 },
  {
    label: '地形:標準/形1.5×',
    amplitude: CONFIG.green.undulationAmplitude,
    visualScale: CONFIG.green.compareVisualHeightScale,
  },
  {
    label: '地形:強調/形1.5×',
    amplitude: CONFIG.green.compareEnhancedAmplitude,
    visualScale: CONFIG.green.compareVisualHeightScale,
  },
] as const;
let undulationMode = 3;
let visualHeightScale = UNDULATION_MODES[undulationMode].visualScale;
let seed = seedFromUrl() ?? CONFIG.green.seed;
let green = new Green({
  ...defaultGreenParams(),
  seed,
  undulationAmplitude: UNDULATION_MODES[undulationMode].amplitude,
});

function visualHeight(x: number, z: number): number {
  return green.sampleHeight(x, z) * visualHeightScale;
}

/** カメラだけが使う見た目上の高さ。物理のgreenとは分ける。 */
const visualGreen = {
  sampleHeight: (x: number, z: number) => visualHeight(x, z),
};

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
  greenMesh = new GreenMesh(green, shade, visualHeightScale);
  terrain.add(greenMesh.mesh);
  terrain.add(createHole(green, visualHeightScale));
  props.add(createSurround(green, visualHeightScale));
  props.add(createTrees(green, seed, visualHeightScale));
}

/**
 * 読み用のカップ後方視点だけ、旗竿と旗を薄くして線上の遠いボールを透かして見る。
 * カップや芝は変更せず、他の状態へ移ると完全に元へ戻す。
 */
function setReadingFlagFade(active: boolean): void {
  const opacity = active ? G.read.behindHoleFlagOpacity : 1;
  terrain.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (
        !(material instanceof THREE.MeshBasicMaterial) &&
        !(material instanceof THREE.MeshLambertMaterial)
      ) {
        continue;
      }
      const color = material.color.getHex();
      if (color !== 0xf0f0f0 && color !== CONFIG.hole.flagColor) continue;
      material.opacity = opacity;
      material.transparent = active;
      material.depthWrite = !active;
      material.needsUpdate = true;
    }
  });
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
let trailPointCount = 0;

/**
 * ADDRESS の方向調整・低い視点と STROKE のカップ確認に出す短い打ち出し方向線。
 * XZ の向きは aim だけで決め、物理の傾斜・曲がりは一切予測しない。
 */
const aimGuidePositions = new Float32Array(6);
const aimGuideGeometry = new THREE.BufferGeometry();
aimGuideGeometry.setAttribute('position', new THREE.BufferAttribute(aimGuidePositions, 3));
const aimGuide = new THREE.Line(
  aimGuideGeometry,
  new THREE.LineBasicMaterial({
    color: G.aim.guideColor,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
  }),
);
aimGuide.frustumCulled = false;
aimGuide.renderOrder = 20;
aimGuide.visible = false;
scene.add(aimGuide);

const smoothLines = new SmoothLineOverlay(
  app,
  G.aim.guideColor,
  G.result.trailColor,
  G.lineCompare.smoothOpacity,
  G.lineCompare.smoothWidthPx,
);
type LineMode = 'DOT' | 'SMOOTH';
// 滑らかな半透明ラインを正式採用。比較UIは隠すが、戻せるよう内部モードだけ残す。
let lineMode: LineMode = 'SMOOTH';

// --- 状態 -----------------------------------------------------------------

type State = 'ADDRESS' | 'STROKE' | 'FOLLOW' | 'CUP' | 'RESULT';
type AimView = 'AIM' | ReadView;
type StrokeCameraView = 'DOWN' | 'CUP';

let roller = new Roller(green);
const cup = new THREE.Vector2(CONFIG.hole.position.x, CONFIG.hole.position.z);
/** ボールの現在位置（XZ）。roller から毎フレーム写す */
const ball = new THREE.Vector2(G.ballStart.x, G.ballStart.z);
/** この一打を打つ前の位置。グリーンオーバーしたらここへ戻す */
const shotStart = new THREE.Vector2(G.ballStart.x, G.ballStart.z);

let state: State = 'ADDRESS';
/** ADDRESS の中で、方向調整か読み用定点かを切り替える。初期は方向調整。 */
let aimView: AimView = 'AIM';
/** STROKE 内で真下か、カップ確認かを切り替える。 */
let strokeCameraView: StrokeCameraView = 'DOWN';
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
/** CUPへ切り替える直前のFOLLOW固定位置。CUPから戻るときに復元する */
const followReturnPosition = new THREE.Vector3();
/**
 * 打った直後、ボールが STROKE の画面端へ近づくまでは視点を動かさない区間。
 * 画面外まで待つとボールが見えない時間ができるので、端の手前で FOLLOW へ切り替える。
 */
let holding = false;
let holdElapsed = 0;
/** この一打ですでにCUP定点を見せたか。FOLLOWへ戻ったあと再度CUPへ入るのを防ぐ */
let cupViewUsed = false;
/** RESULT に入ってから俯瞰へ動き出すまでの待ち [s] */
let settleElapsed = 0;
let resultReady = false;
/** STROKE の遷移が終わってからオーバーレイを出す。回っている最中に振らせない */
let strokeArmed = false;

function aimGuideShouldShow(): boolean {
  return (
    (state === 'ADDRESS' && (aimView === 'AIM' || aimView === 'LOW_LINE')) ||
    (state === 'STROKE' && strokeCameraView === 'CUP')
  );
}

function trailShouldShow(): boolean {
  return state === 'RESULT' && resultReady && trailPointCount > 1;
}

function syncLineVisibility(): void {
  const dotted = lineMode === 'DOT';
  aimGuide.visible = dotted && aimGuideShouldShow();
  trail.visible = dotted && trailShouldShow();
}

function updateSmoothLines(): void {
  if (lineMode !== 'SMOOTH') {
    smoothLines.clear();
    return;
  }
  smoothLines.draw(
    camera,
    aimGuidePositions,
    aimGuideShouldShow(),
    trailPositions,
    trailPointCount,
    trailShouldShow(),
  );
}

function loadPutterPowerScale(): number {
  const P = G.putterTuning;
  try {
    const raw = localStorage.getItem(P.storageKey);
    if (raw !== null) {
      const value = Number(raw);
      if (Number.isFinite(value)) {
        return THREE.MathUtils.clamp(value, P.minScale, P.maxScale);
      }
    }
  } catch {
    // localStorageが使えない環境では既定値だけ使う
  }
  return P.defaultScale;
}

let putterPowerScale = loadPutterPowerScale();

const strokeCanvas = document.getElementById('stroke') as HTMLCanvasElement;
const strokeView = new StrokeView(strokeCanvas, {
  onImpact: (m) => {
    const adjustedSpeedMs = m.speedMs * putterPowerScale;
    lastSwing =
      `スワイプ ${Math.round(m.speed)} px/s ・ 初速 ${adjustedSpeedMs.toFixed(2)} m/s ・ ` +
      `反発 ${putterPowerScale.toFixed(2)}× ・ 芯 ${m.offsetPx >= 0 ? '+' : ''}${Math.round(m.offsetPx)}px ×${m.gain.toFixed(2)}`;
    launch(adjustedSpeedMs, m.launchAngle);
  },
  onNotice: (text) => {
    notice = text;
  },
});

const tmpUp = new THREE.Vector3();
const tmpBall = new THREE.Vector3();

function ballWorld(out: THREE.Vector3): THREE.Vector3 {
  return out.set(ball.x, visualHeight(ball.x, ball.y) + CONFIG.ball.radius, ball.y);
}

function distanceToCup(): number {
  return Math.hypot(ball.x - cup.x, ball.y - cup.y);
}

/** 方向調整用の約50cmの直線を現在の aim に合わせる。 */
function updateAimGuide(): void {
  const dx = Math.sin(aim);
  const dz = -Math.cos(aim);
  // ボール中心から始めると球の中を通るので、半径ぶん少し前から描く
  const startOffset = CONFIG.ball.radius * 1.5;
  const sx = ball.x + dx * startOffset;
  const sz = ball.y + dz * startOffset;
  const ex = sx + dx * G.aim.guideLength;
  const ez = sz + dz * G.aim.guideLength;

  aimGuidePositions[0] = sx;
  aimGuidePositions[1] = visualHeight(sx, sz) + G.aim.guideLift;
  aimGuidePositions[2] = sz;
  aimGuidePositions[3] = ex;
  aimGuidePositions[4] = visualHeight(ex, ez) + G.aim.guideLift;
  aimGuidePositions[5] = ez;
  (aimGuideGeometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  syncLineVisibility();
}

// --- 状態遷移 -------------------------------------------------------------

/**
 * 読みと方向調整を統合した入口。常に現行の方向調整カメラから始める。
 * resetAim=false は STROKE から戻るとき用で、それまでの狙いを保持する。
 */
function enterAddress(cut = false, resetAim = true): void {
  state = 'ADDRESS';
  aimView = 'AIM';
  strokeCameraView = 'DOWN';
  cupViewUsed = false;
  notice = '左右スワイプで狙い、タップでストローク';
  props.visible = true;
  ballMesh.visible = roller.status !== 'holed';
  strokeView.exit();
  strokeArmed = false;
  resultReady = false;
  setReadingFlagFade(false);
  if (resetAim) {
    aimBase = Math.atan2(cup.x - ball.x, -(cup.y - ball.y));
    aim = aimBase;
  }
  updateBallMesh();
  updateAimGuide();
  const p = addressPose(ball, aim, visualGreen, distanceToCup());
  if (cut) rig.cut(p);
  else rig.transition(p, G.address.transition);
  syncLineVisibility();
}

/** ADDRESS 内の視点をボタンで切り替える。スワイプでは切り替えない。 */
function setAimView(view: AimView): void {
  if (state !== 'ADDRESS' || aimView === view) return;
  aimView = view;
  setReadingFlagFade(view === 'BEHIND_HOLE');
  updateAimGuide();

  if (view === 'AIM') {
    notice = '左右スワイプで狙い、タップでストローク';
    rig.transition(addressPose(ball, aim, visualGreen, distanceToCup()), G.address.transition);
    return;
  }

  if (view === 'LOW_LINE') {
    notice = '低い視点 ・ 左右スワイプで狙いを調整できます';
    rig.transition(
      lowLineAimPose(ball, cup, aim, visualGreen, distanceToCup()),
      G.read.transition,
    );
    return;
  }

  notice = '読み視点 ・ 下のボタンで方向調整へ戻れます';
  rig.transition(readPose(view, ball, cup, visualGreen, camera.aspect), G.read.transition);
}

function enterStroke(): void {
  state = 'STROKE';
  strokeCameraView = 'DOWN';
  cupViewUsed = false;
  notice = '';
  strokeArmed = false;
  setReadingFlagFade(false);
  syncLineVisibility();
  // 背景は見えない。ボールとカップは 3D のまま実寸で見せる（§3 / §4）。
  // 真下を向いた視野は狭いので、カップが映るのはタップインの距離だけ
  props.visible = false;
  ballMesh.visible = true;
  updateBallMesh();
  rig.transition(strokePose(ball, visualGreen), G.stroke.transition, strokeUp(aim, tmpUp));
}

/** STROKE 真下姿勢の位置を保ったまま、現在の狙い方向を見る。 */
function showCupCheck(): void {
  if (state !== 'STROKE' || strokeCameraView !== 'DOWN' || rig.transitioning) return;
  strokeCameraView = 'CUP';
  strokeArmed = false;
  strokeView.exit();
  props.visible = true;
  notice = 'カップ確認 ・ 左右スワイプで狙いを調整できます';
  updateAimGuide();
  rig.transition(
    strokeCupPose(ball, aim, visualGreen, distanceToCup()),
    G.stroke.cupCheckTransition,
  );
}

/** カップ確認から、同じ位置の真下STROKE視点へ戻る。戻り切るまでスワイプ入力は受けない。 */
function returnToStrokeView(): void {
  if (state !== 'STROKE' || strokeCameraView !== 'CUP' || rig.transitioning) return;
  strokeCameraView = 'DOWN';
  strokeArmed = false;
  notice = '';
  updateAimGuide();
  rig.transition(strokePose(ball, visualGreen), G.stroke.cupCheckTransition, strokeUp(aim, tmpUp));
}

/** STROKE から方向調整へ戻る。狙いはリセットしない。 */
function returnToAddress(): void {
  if (state !== 'STROKE') return;
  enterAddress(false, false);
}

/** インパクト（§4.6）。計測結果を初速と方向に直して打ち出す */
function launch(speedMs: number, launchAngle: number): void {
  // 画面の左＝狙い方向。スワイプが画面下へ流れた分だけ狙いの左へ出る
  const direction = aim - launchAngle;
  shotStart.copy(ball);
  cupViewUsed = false;
  roller.launch(ball.x, ball.y, speedMs, direction);
  shots++;
  enterFollow();
}

function enterFollow(): void {
  state = 'FOLLOW';
  strokeCameraView = 'DOWN';
  notice = '';
  syncLineVisibility();
  followYaw = -aim;
  followPitch = -Math.PI / 2;
  holdElapsed = 0;
  // 打った直後は真下視点を保ち、ボールが画面端へ近づいたら FOLLOW に切り替える
  holding = G.follow.holdUntilNearEdge;
  if (!holding) revealCourse();
}

/**
 * FOLLOW のカメラを現在のボールへ即座に向ける。
 * STROKE 画面から切り替える瞬間にこれを行うので、ボールが画面外に消える区間を作らない。
 */
function snapFollowCamera(): void {
  ballWorld(tmpBall);
  const dx = tmpBall.x - camera.position.x;
  const dy = tmpBall.y - camera.position.y;
  const dz = tmpBall.z - camera.position.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  followYaw = Math.atan2(-dx, -dz);
  followPitch =
    Math.asin(THREE.MathUtils.clamp(dy / len, -1, 1)) + THREE.MathUtils.degToRad(G.follow.leadDeg);
  rig.applyYawPitch(followYaw, followPitch, followFov(len));
}

/** 顔を上げて FOLLOW に切り替える。ボールがまだ STROKE 画面内にいるうちに呼ぶ */
function revealCourse(): void {
  holding = false;
  strokeView.exit();
  props.visible = true;
  ballMesh.visible = roller.status !== 'holed';
  updateBallMesh();
  snapFollowCamera();
}

function enterCup(): void {
  followReturnPosition.copy(camera.position);
  state = 'CUP';
  cupViewUsed = true;
  syncLineVisibility();
  // カット。カップ後方・芝の高さの定点（§3）
  rig.cut(cupPose(shotStart, cup, visualGreen));
}

/** CUP定点でボールが画面端へ近づいたら、見失う前にFOLLOWへ戻す。 */
function cupBallNearEdge(): boolean {
  ballWorld(tmpBall).project(camera);
  return (
    Math.abs(tmpBall.x) >= G.cup.returnNdc ||
    Math.abs(tmpBall.y) >= G.cup.returnNdc ||
    tmpBall.z > 1
  );
}

/** CUP定点を離れ、CUPへ入る直前のFOLLOW固定位置から追従を再開する。 */
function resumeFollowFromCup(): void {
  if (state !== 'CUP') return;
  state = 'FOLLOW';
  holding = false;
  notice = '';
  strokeCameraView = 'DOWN';
  syncLineVisibility();
  strokeView.exit();
  props.visible = true;
  ballMesh.visible = roller.status !== 'holed';
  updateBallMesh();
  camera.position.copy(followReturnPosition);
  snapFollowCamera();
}

/** ボールが完全に停止してから呼ぶ。ここで初めて俯瞰と軌跡を出す（§3） */
function enterResult(): void {
  state = 'RESULT';
  syncLineVisibility();
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
  enterAddress();
}

function selectedUndulation() {
  return UNDULATION_MODES[undulationMode];
}

/** 現在のシード・ボール位置を保ったまま、アンジュレーション比較モードだけ切り替える。再調整用。 */
function rebuildGreenForUndulationCompare(): void {
  const mode = selectedUndulation();
  visualHeightScale = mode.visualScale;
  green = new Green({
    ...defaultGreenParams(),
    seed,
    undulationAmplitude: mode.amplitude,
  });
  roller = new Roller(green);
  roller.place(ball.x, ball.y);
  buildTerrain();
  trailPointCount = 0;
  trailGeometry.setDrawRange(0, 0);
  updateBallMesh();
  enterAddress(true, false);
}

/**
 * 別のグリーンにする。うねりはシード次第なので、いろいろな地形で読みを試すために要る。
 * URL にも書いておくので、面白い地形が出たらその URL でもう一度出せる
 */
function newGreen(next: number): void {
  seed = next >>> 0;
  const mode = selectedUndulation();
  visualHeightScale = mode.visualScale;
  green = new Green({
    ...defaultGreenParams(),
    seed,
    undulationAmplitude: mode.amplitude,
  });
  roller = new Roller(green);
  buildTerrain();
  ball.set(G.ballStart.x, G.ballStart.z);
  shotStart.copy(ball);
  roller.place(ball.x, ball.y);
  shots = 0;
  lastResult = '';
  lastSwing = '';
  trailPointCount = 0;
  trailGeometry.setDrawRange(0, 0);
  updateBallMesh();
  const url = new URL(location.href);
  url.searchParams.set('seed', String(seed));
  history.replaceState(null, '', url);
  enterAddress(true);
}

// --- 軌跡 -----------------------------------------------------------------

function updateTrail(): void {
  const attribute = trailGeometry.attributes.position as THREE.BufferAttribute;
  const count = Math.min(roller.path.length / 2, G.result.trailMaxPoints);
  trailPointCount = count;
  for (let i = 0; i < count; i++) {
    const x = roller.path[i * 2];
    const z = roller.path[i * 2 + 1];
    trailPositions[i * 3] = x;
    trailPositions[i * 3 + 1] = visualHeight(x, z) + G.result.trailLift;
    trailPositions[i * 3 + 2] = z;
  }
  attribute.needsUpdate = true;
  trailGeometry.setDrawRange(0, count);
}

function updateBallMesh(): void {
  ballMesh.position.copy(ballWorld(tmpBall));
  ballShadow.position.set(
    tmpBall.x,
    visualHeight(ball.x, ball.y) + CONFIG.ball.shadowLift,
    tmpBall.z,
  );
  ballShadow.visible = ballMesh.visible;
}

// --- 入力 -----------------------------------------------------------------
// STROKE の通常スワイプは stroke-view.ts が受け持つ。
// renderer 側では ADDRESS と STROKEカップ確認の方向調整、RESULT のタップを見る。

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

  const adjustingAddress =
    state === 'ADDRESS' && (aimView === 'AIM' || aimView === 'LOW_LINE');
  const adjustingCupCheck =
    state === 'STROKE' && strokeCameraView === 'CUP' && !rig.transitioning;
  if (adjustingAddress || adjustingCupCheck) {
    const max = THREE.MathUtils.degToRad(G.aim.maxOffsetDeg);
    const offset = THREE.MathUtils.clamp(aim - aimBase + dx * G.aim.sensitivity, -max, max);
    aim = aimBase + offset;
    updateAimGuide();

    if (adjustingAddress && aimView === 'LOW_LINE' && !rig.transitioning) {
      rig.apply(lowLineAimPose(ball, cup, aim, visualGreen, distanceToCup()));
    }
    if (adjustingCupCheck) {
      rig.apply(strokeCupPose(ball, aim, visualGreen, distanceToCup()));
    }
  }
});

function pointerEnd(e: PointerEvent): void {
  if (e.pointerId !== pointerId) return;
  pointerId = null;
  const held = e.timeStamp - downT;
  const isTap = moved <= G.tap.moveMaxPx && held <= G.tap.holdMaxMs;

  if (state === 'ADDRESS') {
    // 読み用定点ではタップしてもストロークへ進まない。AIMだけタップでSTROKEへ進む。
    if (aimView === 'AIM' && isTap) enterStroke();
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
 * 3D のボールが実際に転がる。画面端へ近づいたら、見切れる前に true を返す。
 */
function updateHold(dt: number): boolean {
  holdElapsed += dt;
  ballWorld(tmpBall).project(camera);
  strokeView.update(dt);

  const nearEdge =
    Math.abs(tmpBall.x) >= G.follow.switchNdc ||
    Math.abs(tmpBall.y) >= G.follow.switchNdc ||
    tmpBall.z > 1;
  // ボールが画面内で止まってしまった場合と、保険の上限時間でも FOLLOW へ切り替える
  return nearEdge || roller.status !== 'rolling' || holdElapsed >= G.follow.holdMax;
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

  // 切り替え時点で一度ボールへ向けているので、その後は時定数で遅れて追う。
  // 毎フレーム画面中心へ貼りつけると相対運動がゼロになって実質静止画に見える
  const k = 1 - Math.exp(-dt / G.follow.trackingTau);
  followYaw = lerpAngle(followYaw, targetYaw, k);
  followPitch += (targetPitch - followPitch) * k;
  rig.applyYawPitch(followYaw, followPitch, followFov(len));
}

let lastTime = performance.now();

renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  const transitioning = rig.update(dt);

  switch (state) {
    case 'ADDRESS':
      if (!transitioning) {
        if (aimView === 'AIM') {
          rig.apply(addressPose(ball, aim, visualGreen, distanceToCup()));
        } else if (aimView === 'LOW_LINE') {
          // 位置は固定し、aimに合わせて視線だけ更新する。
          rig.apply(lowLineAimPose(ball, cup, aim, visualGreen, distanceToCup()));
        }
      }
      break;

    case 'STROKE':
      if (strokeCameraView === 'DOWN') {
        if (!transitioning && !strokeArmed) {
          // カップ確認から戻る遷移中は背景を残し、真下へ戻り切ってから通常STROKE表示へ戻す。
          props.visible = false;
          strokeArmed = true;
          strokeView.enter();
        }
        strokeView.update(dt);
      } else if (!transitioning) {
        // カップ確認では現在の aim 方向を見続ける。左右スワイプで aim が変われば即座に追従する。
        rig.apply(strokeCupPose(ball, aim, visualGreen, distanceToCup()));
      }
      break;

    case 'FOLLOW': {
      stepPhysics(dt);
      if (holding) {
        // ボールが STROKE 画面の端へ近づいたら、見切れる前に FOLLOW へ切り替える
        if (updateHold(dt)) revealCourse();
      } else {
        updateFollow(dt);
      }
      if (roller.status !== 'rolling') enterResult();
      // 1打につき一度だけ、カップまで約50cmを切ったらCUP定点へカットする
      else if (!holding && !cupViewUsed && distanceToCup() < G.cup.triggerDistance) enterCup();
      break;
    }

    case 'CUP':
      stepPhysics(dt);
      if (roller.status !== 'rolling') enterResult();
      else if (cupBallNearEdge()) resumeFollowFromCup();
      break;

    case 'RESULT':
      if (!resultReady) {
        settleElapsed += dt;
        if (settleElapsed >= G.result.settleDelay) {
          resultReady = true;
          // ボールが完全に停止してから俯瞰へ。軌跡もここで初めて出す
          updateTrail();
          syncLineVisibility();
          rig.transition(resultPose(shotStart, ball, cup, visualGreen), G.result.transition);
          notice = 'タップで次のパット';
        }
      }
      break;
  }

  updateHud();
  renderFrame();
  updateSmoothLines();
});

// --- デバッグ表示と画面操作 ------------------------------------------------

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
  line: document.getElementById('hud-line') as HTMLButtonElement,
  undulation: document.getElementById('hud-undulation') as HTMLButtonElement,
  adjust: document.getElementById('hud-adjust') as HTMLButtonElement,
};

const cameraControls = document.getElementById('camera-controls')!;
const cameraButtons = Array.from(
  cameraControls.querySelectorAll<HTMLButtonElement>('[data-aim-view]'),
);
const strokeControls = document.getElementById('stroke-controls')!;
const strokeBack = document.getElementById('stroke-back') as HTMLButtonElement;
const strokeCameraControls = document.getElementById('stroke-camera-controls')!;
const strokeCupCheck = document.getElementById('stroke-cup-check') as HTMLButtonElement;
const strokeCupReturn = document.getElementById('stroke-cup-return') as HTMLButtonElement;

const tuningPanel = document.getElementById('tuning-panel') as HTMLDivElement;
const putterPower = document.getElementById('putter-power') as HTMLInputElement;
const putterPowerValue = document.getElementById('putter-power-value')!;
const putterPowerDetail = document.getElementById('putter-power-detail')!;
const P = G.putterTuning;
putterPower.min = String(P.minScale);
putterPower.max = String(P.maxScale);
putterPower.step = String(P.step);
putterPower.value = String(putterPowerScale);

function updatePutterTuningUi(): void {
  putterPowerValue.textContent = `${putterPowerScale.toFixed(2)}×`;
  putterPowerDetail.textContent =
    `基準係数 ${CONFIG.swipeTest.speedK.toFixed(5)} → ` +
    `${(CONFIG.swipeTest.speedK * putterPowerScale).toFixed(5)}`;
  hud.adjust.textContent = `調整 ${putterPowerScale.toFixed(2)}×`;
}

putterPower.addEventListener('input', () => {
  const value = Number(putterPower.value);
  if (!Number.isFinite(value)) return;
  putterPowerScale = THREE.MathUtils.clamp(value, P.minScale, P.maxScale);
  try {
    localStorage.setItem(P.storageKey, String(putterPowerScale));
  } catch {
    // 保存できない環境でも、そのセッション中の調整は使える
  }
  updatePutterTuningUi();
});

hud.adjust.addEventListener('click', () => {
  tuningPanel.hidden = !tuningPanel.hidden;
});

for (const button of cameraButtons) {
  button.addEventListener('click', () => {
    const view = button.dataset.aimView as AimView | undefined;
    if (view) setAimView(view);
  });
}
strokeBack.addEventListener('click', returnToAddress);
strokeCupCheck.addEventListener('click', showCupCheck);
strokeCupReturn.addEventListener('click', returnToStrokeView);

/**
 * ドット感の切り替え。既定は 2（採用した見た目）。比較用に OFF も残す。
 * 0: そのまま / 1: 低解像度に描いて引き伸ばす / 2: それに加えて濃淡を段に丸める
 */
const PIXEL_MODES = ['ドット OFF', 'ドット', 'ドット＋色を段に'];
let pixelMode = 2;

function applyPixelMode(): void {
  pixelScale = pixelMode === 0 ? 1 : CONFIG.pixel.scale;
  screenMaterial.uniforms.levels.value = pixelMode === 2 ? CONFIG.pixel.colorLevels : 0;
  const levels = pixelMode === 2 ? CONFIG.pixel.levels : 0;
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

// 比較を戻したい場合のため内部ロジックは残すが、現在UIからは操作しない。
hud.line.addEventListener('click', () => {
  lineMode = lineMode === 'DOT' ? 'SMOOTH' : 'DOT';
  syncLineVisibility();
});

hud.undulation.addEventListener('click', () => {
  if (state !== 'ADDRESS') return;
  undulationMode = (undulationMode + 1) % UNDULATION_MODES.length;
  rebuildGreenForUndulationCompare();
});

// シードのボタン。押すと別の地形になる（ADDRESS / RESULT のときだけ）
hud.seed.addEventListener('click', () => {
  if (state !== 'ADDRESS' && state !== 'RESULT') return;
  newGreen(Math.floor(Math.random() * 100000));
});

function updateControls(): void {
  cameraControls.style.display = state === 'ADDRESS' ? 'flex' : 'none';
  const inStroke = state === 'STROKE';
  strokeControls.style.display = inStroke ? 'flex' : 'none';
  strokeCameraControls.style.display = inStroke ? 'flex' : 'none';
  hud.adjust.style.display = inStroke ? 'inline-block' : 'none';
  if (!inStroke) tuningPanel.hidden = true;

  for (const button of cameraButtons) {
    button.classList.toggle('active', button.dataset.aimView === aimView);
  }

  const checkingCup = state === 'STROKE' && strokeCameraView === 'CUP';
  strokeCupCheck.style.display = checkingCup ? 'none' : 'block';
  strokeCupReturn.style.display = checkingCup ? 'block' : 'none';
}

function updateHud(): void {
  hud.state.textContent = state;
  if (state === 'ADDRESS') {
    hud.view.textContent = aimView === 'AIM' ? '方向調整' : READ_VIEW_LABEL[aimView];
  } else if (state === 'STROKE' && strokeCameraView === 'CUP') {
    hud.view.textContent = 'カップ確認';
  } else {
    hud.view.textContent = '';
  }
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
  hud.line.textContent = lineMode === 'DOT' ? 'ライン:ドット' : 'ライン:滑らか';
  hud.undulation.textContent = selectedUndulation().label;
  hud.seed.disabled = state !== 'ADDRESS' && state !== 'RESULT';
  hud.undulation.disabled = state !== 'ADDRESS';
  updateControls();
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
  smoothLines.resize(w, h);
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
updatePutterTuningUi();
roller.place(G.ballStart.x, G.ballStart.z);
ball.set(roller.x, roller.z);
updateBallMesh();
enterAddress(true);
