import * as T from 'three';
import data from './cave-data.json';
import { loadCaveAssets, warmCaveAssets } from './cave-assets.js';

const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(1280, 800); renderer.setPixelRatio(1);
renderer.outputColorSpace = T.SRGBColorSpace;
renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
document.body.append(renderer.domElement);
const scene = new T.Scene(); scene.background = new T.Color('#bddcf5');
scene.add(new T.AmbientLight(0xffffff, 2.3));
const sun = new T.DirectionalLight(0xfffaf0, 2.5); sun.position.set(-20, 60, -15); scene.add(sun);
const fill = new T.DirectionalLight(0xecf4ff, 1.5); fill.position.set(30, 15, 40); scene.add(fill);
const camera = new T.PerspectiveCamera(75, 1280 / 800, .025, 500);
const p = data.route[Math.floor(data.route.length / 2)]; camera.position.set(p[0], p[1] + 1.7, p[2]);
renderer.render(scene, camera);
const assets = await loadCaveAssets({ renderer, data });
await warmCaveAssets(assets, renderer, camera, scene);
scene.add(assets.root); scene.updateMatrixWorld(true);
const sample = fraction => {
  const i = Math.min(data.route.length - 2, Math.floor(fraction * (data.route.length - 1)));
  return [new T.Vector3(...data.route[i]), new T.Vector3(...data.route[Math.min(i + 8, data.route.length - 1)])];
};
window.caveView = (fraction, close = false) => {
  const [floor, ahead] = sample(fraction), eye = floor.clone().add(new T.Vector3(0, 1.7, 0));
  let target = ahead.clone().setY(eye.y), wallDistance = null;
  if (close) {
    const forward = ahead.clone().sub(floor).setY(0).normalize(), side = new T.Vector3(forward.z, 0, -forward.x);
    let hit = new T.Raycaster(eye, side, .01, 40).intersectObject(assets.root, true)[0];
    if (!hit || hit.distance < .8) { side.negate(); hit = new T.Raycaster(eye, side, .01, 40).intersectObject(assets.root, true)[0]; }
    if (!hit || hit.distance < .8) throw new Error('No clear close-up wall target');
    eye.addScaledVector(side, hit.distance - .6);
    for (let i = 0; i < 8; i++) {
      const ground = new T.Raycaster(eye.clone().add(new T.Vector3(0, .1, 0)), new T.Vector3(0, -1, 0), 0, 8).intersectObject(assets.root, true)[0];
      if (!ground) throw new Error('No floor at close-up camera');
      eye.y = ground.point.y + 1.7;
      const wall = new T.Raycaster(eye, side, .01, 40).intersectObject(assets.root, true)[0];
      if (!wall) throw new Error('No wall at eye height');
      eye.addScaledVector(side, wall.distance - .6);
    }
    target = eye.clone().add(side); wallDistance = .6;
  }
  camera.position.copy(eye); camera.lookAt(target);
  document.querySelector('#label').textContent = `Bageshawe real scan | ${close ? 'wall close-up, 0.60 m' : 'interior, route ' + Math.round(fraction * 100) + '%'}\nEye 1.70 m above scanned floor | daylight lighting | no fog\nPhotographed Poly Haven PBR / scan vertex tint / 1.8 m repeats`;
  renderer.render(scene, camera);
  const floorHit = new T.Raycaster(eye, new T.Vector3(0, -1, 0), 0, 5).intersectObject(assets.root, true)[0];
  return { position: eye.toArray(), target: target.toArray(), wallDistance,
    eyeHeight: floorHit ? eye.y - floorHit.point.y : null, calls: renderer.info.render.calls };
};
window.caveView(.5);
window.caveReady = true;
