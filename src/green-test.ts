// /green-test/ — グリーンの生成・描画（§1）とボールの転がり（§2）を確認する開発用ページ。
// 俯瞰固定カメラ。カメラワークもストロークも持たない。初速と方向は数値で入れる。
import * as THREE from 'three';
import GUI from 'lil-gui';
import { CONFIG } from './config';
import {
  Green,
  GreenMesh,
  createHole,
  createSurround,
  createTrees,
  defaultGreenParams,
} from './green';
import { Roller, criticalGradient, type RollStatus } from './physics';

const C = CONFIG.greenTest;

const stage = document.getElementById('stage')!;
const elStatus = document.getElementById('status')!;
const elPos = document.getElementById('pos')!;
const elSpeed = document.getElementById('speed')!;
const elDist = document.getElementById('dist')!;
const elSlope = document.getElementById('slope')!;
const elMu = document.getElementById('mu')!;
const elToCup = document.getElementById('tocup')!;
const elSevere = document.getElementById('severe')!;
const inX = document.getElementById('in-x') as HTMLInputElement;
const inZ = document.getElementById('in-z') as HTMLInputElement;
const inSpeed = document.getElementById('in-speed') as HTMLInputElement;
const inDir = document.getElementById('in-dir') as HTMLInputElement;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.renderer.maxPixelRatio));
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(CONFIG.renderer.background);

// 俯瞰固定カメラ。転がっている間も動かさない。
// 20m 四方は縦画面の横幅に透視投影では収まらないので正射影でフィットさせる
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, CONFIG.camera.near, CONFIG.camera.far);
{
  const pitch = THREE.MathUtils.degToRad(C.cameraPitchDeg);
  camera.position.set(
    0,
    Math.sin(pitch) * C.cameraDistance,
    Math.cos(pitch) * C.cameraDistance,
  );
  camera.lookAt(0, 0, 0);
}

const dirLight = new THREE.DirectionalLight(0xffffff, CONFIG.light.directionalIntensity);
dirLight.position.set(
  CONFIG.light.directionalDirection.x,
  CONFIG.light.directionalDirection.y,
  CONFIG.light.directionalDirection.z,
);
scene.add(dirLight);
const ambient = new THREE.AmbientLight(0xffffff, CONFIG.light.ambientIntensity);
scene.add(ambient);

// --- グリーン -------------------------------------------------------------

const params = defaultGreenParams();
const green = new Green(params);
const greenMesh = new GreenMesh(green, CONFIG.green.shadeStrength);
scene.add(greenMesh.mesh);

/** シードで作り直すたびに差し替えるオブジェクト（カップ・地面・木） */
let props: THREE.Object3D[] = [];

function disposeObject(object: THREE.Object3D): void {
  object.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material.dispose();
  });
}

function rebuildProps(): void {
  for (const p of props) {
    scene.remove(p);
    disposeObject(p);
  }
  props = [createSurround(green), createHole(green), createTrees(green, params.seed)];
  for (const p of props) scene.add(p);
}
rebuildProps();

// --- ボールと軌跡 ---------------------------------------------------------

const ballRadius = CONFIG.ball.radius * C.ballScale;
const ballMesh = new THREE.Mesh(
  new THREE.SphereGeometry(ballRadius, 20, 14),
  new THREE.MeshLambertMaterial({ color: CONFIG.ball.color }),
);
scene.add(ballMesh);

const trailPositions = new Float32Array(C.trailMaxPoints * 3);
const trailGeometry = new THREE.BufferGeometry();
trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
trailGeometry.setDrawRange(0, 0);
const trail = new THREE.Line(
  trailGeometry,
  new THREE.LineBasicMaterial({ color: C.trailColor }),
);
trail.frustumCulled = false;
scene.add(trail);

const roller = new Roller(green);
roller.place(C.ballStart.x, C.ballStart.z);

function updateBallMesh(): void {
  ballMesh.position.set(
    roller.x,
    green.sampleHeight(roller.x, roller.z) + ballRadius,
    roller.z,
  );
  ballMesh.visible = roller.status !== 'holed';
}

function updateTrail(): void {
  const attribute = trailGeometry.attributes.position as THREE.BufferAttribute;
  const count = Math.min(roller.path.length / 2, C.trailMaxPoints);
  for (let i = 0; i < count; i++) {
    const x = roller.path[i * 2];
    const z = roller.path[i * 2 + 1];
    trailPositions[i * 3] = x;
    trailPositions[i * 3 + 1] = green.sampleHeight(x, z) + C.trailLift;
    trailPositions[i * 3 + 2] = z;
  }
  attribute.needsUpdate = true;
  trailGeometry.setDrawRange(0, count);
}

// --- 操作 -----------------------------------------------------------------

function readNumber(input: HTMLInputElement, fallback: number): number {
  const value = Number.parseFloat(input.value);
  return Number.isFinite(value) ? value : fallback;
}

inX.value = String(C.ballStart.x);
inZ.value = String(C.ballStart.z);
inSpeed.value = String(C.initialSpeed);
inDir.value = String(C.initialDirectionDeg);

/** 入力欄のボール位置へ置き直す（打たない） */
function placeFromInputs(): void {
  const half = green.size / 2;
  const x = Math.min(Math.max(readNumber(inX, C.ballStart.x), -half), half);
  const z = Math.min(Math.max(readNumber(inZ, C.ballStart.z), -half), half);
  inX.value = x.toFixed(2);
  inZ.value = z.toFixed(2);
  roller.place(x, z);
  updateBallMesh();
  updateTrail();
}

function roll(): void {
  const half = green.size / 2;
  const x = Math.min(Math.max(readNumber(inX, C.ballStart.x), -half), half);
  const z = Math.min(Math.max(readNumber(inZ, C.ballStart.z), -half), half);
  const speed = Math.max(readNumber(inSpeed, C.initialSpeed), 0);
  const direction = THREE.MathUtils.degToRad(readNumber(inDir, C.initialDirectionDeg));
  roller.launch(x, z, speed, direction);
  updateBallMesh();
  updateTrail();
}

document.getElementById('btn-roll')!.addEventListener('click', roll);
document.getElementById('btn-reset')!.addEventListener('click', placeFromInputs);
for (const input of [inX, inZ]) input.addEventListener('change', placeFromInputs);

// グリーンをタップしてボールを置き直す
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
renderer.domElement.addEventListener('pointerdown', (event) => {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(greenMesh.mesh, false)[0];
  if (!hit) return;
  inX.value = hit.point.x.toFixed(2);
  inZ.value = hit.point.z.toFixed(2);
  placeFromInputs();
});

// --- lil-gui --------------------------------------------------------------

const G = C.gui;
/** CONFIG は as const なのでリテラル型になる。書き換えるので number で受け直す */
const tuning: {
  stimpFeet: number;
  seed: number;
  undulationAmplitude: number;
  tiltPercent: number;
  shadeStrength: number;
  directionalIntensity: number;
  ambientIntensity: number;
} = {
  stimpFeet: CONFIG.physics.stimpFeet,
  seed: params.seed,
  undulationAmplitude: params.undulationAmplitude,
  tiltPercent: params.tiltPercent,
  shadeStrength: CONFIG.green.shadeStrength,
  directionalIntensity: CONFIG.light.directionalIntensity,
  ambientIntensity: CONFIG.light.ambientIntensity,
};

/** ハイトマップを作り直す。ボールは今の入力位置へ戻す */
function regenerate(): void {
  green.generate({
    seed: tuning.seed,
    undulationAmplitude: tuning.undulationAmplitude,
    tiltPercent: tuning.tiltPercent,
  });
  greenMesh.update(green, tuning.shadeStrength);
  rebuildProps();
  updateSeverity();
  placeFromInputs();
}

const gui = new GUI({ title: 'putt / green' });
gui.add(tuning, 'stimpFeet', G.stimpMin, G.stimpMax, G.stimpStep)
  .name('スティンプ [ft]')
  .onChange((v: number) => {
    roller.stimpFeet = v;
    updateSeverity();
  });
gui.add(tuning, 'seed', G.seedMin, G.seedMax, G.seedStep).name('シード').onChange(regenerate);
gui
  .add(tuning, 'tiltPercent', G.tiltMin, G.tiltMax, G.tiltStep)
  .name('全体傾斜 [%]')
  .onChange(regenerate);
gui
  .add(tuning, 'undulationAmplitude', G.amplitudeMin, G.amplitudeMax, G.amplitudeStep)
  .name('うねりの振幅 [m]')
  .onChange(regenerate);
gui
  .add(tuning, 'shadeStrength', G.shadeMin, G.shadeMax, G.shadeStep)
  .name('濃淡の強さ')
  .onChange((v: number) => greenMesh.setShadeStrength(v));
gui
  .add(tuning, 'directionalIntensity', G.lightMin, G.lightMax, G.lightStep)
  .name('ライト強度')
  .onChange((v: number) => {
    dirLight.intensity = v;
  });
gui
  .add(tuning, 'ambientIntensity', G.lightMin, G.lightMax, G.lightStep)
  .name('環境光')
  .onChange((v: number) => {
    ambient.intensity = v;
  });
gui.add({ roll }, 'roll').name('打つ');

// --- 表示 -----------------------------------------------------------------

const STATUS_LABEL: Record<RollStatus, string> = {
  idle: '構え中',
  rolling: '転がり中',
  stopped: '停止',
  holed: 'カップイン',
  offGreen: 'グリーンオーバー',
};

const grad = { x: 0, z: 0 };

/**
 * 勾配が摩擦を上回る面の割合 [%]。ここに止まったボールは止まれずに転がり続ける。
 * 「下りで止まらない」がグリーン全体で起きているのか、きつい所だけなのかの目安。
 * グリーンかスティンプが変わったときだけ測り直す
 */
let severityPercent = 0;

function updateSeverity(): void {
  const critical = criticalGradient(roller.stimpFeet);
  const n = C.severitySamples;
  const half = green.size / 2;
  let over = 0;
  for (let j = 0; j < n; j++) {
    const z = -half + (j / (n - 1)) * green.size;
    for (let i = 0; i < n; i++) {
      green.sampleGradient(-half + (i / (n - 1)) * green.size, z, grad);
      if (Math.hypot(grad.x, grad.z) > critical) over++;
    }
  }
  severityPercent = (100 * over) / (n * n);
}
updateSeverity();

function updateReadout(): void {
  elStatus.textContent = STATUS_LABEL[roller.status];
  elPos.textContent = `${roller.x.toFixed(2)}, ${roller.z.toFixed(2)}`;
  elSpeed.textContent = `${roller.speed.toFixed(2)} m/s`;
  elDist.textContent = `${roller.distance.toFixed(2)} m`;
  green.sampleGradient(roller.x, roller.z, grad);
  // 臨界勾配を併記する。これを超える下りではボールは止まらない
  const slope = Math.hypot(grad.x, grad.z) * 100;
  const critical = criticalGradient(roller.stimpFeet) * 100;
  elSlope.textContent = `${slope.toFixed(1)} % / 臨界 ${critical.toFixed(1)} %`;
  elSevere.textContent = `${severityPercent.toFixed(1)} %`;
  elMu.textContent = `${roller.friction.toFixed(2)} m/s²`;
  const toCup = Math.hypot(
    roller.x - CONFIG.hole.position.x,
    roller.z - CONFIG.hole.position.z,
  );
  elToCup.textContent = `${toCup.toFixed(2)} m`;
}

function resize(): void {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  renderer.setSize(w, h, false);
  // 横幅に viewWidth を収める。縦は画面比に合わせて自然に広くなる
  const viewHeight = (C.viewWidth * h) / w;
  camera.left = -C.viewWidth / 2;
  camera.right = C.viewWidth / 2;
  camera.top = viewHeight / 2;
  camera.bottom = -viewHeight / 2;
  camera.updateProjectionMatrix();
}
resize();
window.addEventListener('resize', resize);

let lastTime = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = (now - lastTime) / 1000;
  lastTime = now;
  if (roller.status === 'rolling') {
    roller.advance(dt);
    updateBallMesh();
    updateTrail();
  }
  updateReadout();
  renderer.render(scene, camera);
});

updateBallMesh();
updateReadout();
