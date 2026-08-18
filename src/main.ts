import * as THREE from 'three';
import { CONFIG } from './config';

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

// グリーン（今は平らな緑の面を1枚置くだけ）
const green = new THREE.Mesh(
  new THREE.PlaneGeometry(
    CONFIG.green.size,
    CONFIG.green.size,
    CONFIG.green.segments,
    CONFIG.green.segments,
  ),
  new THREE.MeshLambertMaterial({ color: CONFIG.green.color }),
);
green.rotation.x = -Math.PI / 2;
scene.add(green);

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
