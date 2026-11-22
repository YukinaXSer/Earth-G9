import { BasicShadowMap } from 'three';

export function enableCaveShadows(host) {
  host.renderer.shadowMap.enabled = true;
  host.sun.castShadow = true;
  if (host.lowDetail) {
    host.renderer.shadowMap.type = BasicShadowMap;
    host.sun.shadow.mapSize.set(256, 256);
    Object.assign(host.sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22 });
  }
  host.sun.shadow.camera.updateProjectionMatrix();
}
