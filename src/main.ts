import * as THREE from 'three';
import { CONFIG } from './config';
import { Green, GreenMesh, createHole, createSurround, createTrees, defaultGreenParams } from './green';

const app = document.getElementById('app')!;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.renderer.maxPixelRatio));
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(CONFIG.renderer.background);

const camera = new THREE.PerspectiveCamera(
  CONFIG.camera.fov,
  1,
  CONFIG.camera.near,
  CONFIG.camera.far,
);
camera.position.set(0, CONFIG.camera.eyeHeight, CONFIG.camera.distance);
camera.lookAt(0, 0, 0);

// グリーン。ハイトマップが表示と物理の唯一の情報源（spec §1）
const params = defaultGreenParams();
const green = new Green(params);
scene.add(new GreenMesh(green, CONFIG.green.shadeStrength).mesh);
scene.add(createSurround(green));
scene.add(createHole(green));
scene.add(createTrees(green, params.seed));

const dir = new THREE.DirectionalLight(0xffffff, CONFIG.light.directionalIntensity);
dir.position.set(
  CONFIG.light.directionalDirection.x,
  CONFIG.light.directionalDirection.y,
  CONFIG.light.directionalDirection.z,
);
scene.add(dir);
scene.add(new THREE.AmbientLight(0xffffff, CONFIG.light.ambientIntensity));

function resize() {
  const w = app.clientWidth;
  const h = app.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
resize();
window.addEventListener('resize', resize);

renderer.setAnimationLoop(() => {
  renderer.render(scene, camera);
});
