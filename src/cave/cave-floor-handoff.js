import { Vector3 } from 'three';
import { nearestRoute } from './cave-space.js';

export function routePointAt(route, along) {
  let total = 0;
  for (let i = 1; i < route.length; i++) {
    const a = new Vector3(...route[i - 1]), b = new Vector3(...route[i]), length = a.distanceTo(b);
    if (total + length >= along) return a.lerp(b, length ? Math.max(0, (along - total) / length) : 0);
    total += length;
  }
  return new Vector3(...route.at(-1));
}

export function findFloorHandoff(route, floorHeight, nativeHeight, { band = 3, spacing = .05 } = {}) {
  if (!Array.isArray(route) || route.length < 2 || typeof floorHeight !== 'function' || typeof nativeHeight !== 'function' || !Number.isFinite(band) || band <= 0 || !Number.isFinite(spacing) || spacing <= 0) throw new TypeError('Floor handoff requires a route and height samplers');
  const length = nearestRoute(route.at(-1)[0], route.at(-1)[2], route).along;
  if (!Number.isFinite(length) || length <= 0) throw new RangeError('Floor handoff requires a nonzero route');
  const count = Math.ceil(Math.min(band, length) / spacing), start = Math.max(0, length - band), samples = [];
  for (let i = 0; i <= count; i++) {
    const along = start + (length - start) * i / count, point = routePointAt(route, along);
    const body = floorHeight(point.x, point.z), native = nativeHeight(point.x, point.z);
    samples.push({ along, body, native, safe: Number.isFinite(native) && (body == null || Number.isFinite(body) && Math.abs(body - native) <= .10) });
  }
  let first = samples.length;
  while (first > 0 && samples[first - 1].safe) first--;
  if (first === samples.length || !samples.some(sample => Number.isFinite(sample.body))) return null;
  const along = samples[first].along;
  return { along, rampStart: Math.max(0, along - .5), length, band, spacing, maximumHeightDifference: .10, rampMetres: .5, edgeBurialMetres: .025, samples };
}

export function floorHandoffHeight(plan, route, x, z, body, native) {
  if (!plan || !Number.isFinite(native)) return body;
  const near = nearestRoute(x, z, route);
  if (near.along < plan.rampStart || near.distance > 1.2) return body;
  if (near.along >= plan.along || body == null) return native;
  const t = Math.max(0, Math.min(1, (near.along - plan.rampStart) / (plan.along - plan.rampStart))), blend = t * t * (3 - 2 * t);
  return body + (native - body) * blend;
}

export function useMountainFloorMaterial(mesh, plan, nativeMaterial) {
  if (!mesh?.isMesh || !plan || !nativeMaterial?.isMaterial) throw new TypeError('Floor dressing requires the cave body, handoff and native material');
  const material = nativeMaterial.clone(); material.name = 'Continuous native mountain floor'; material.vertexColors = false;
  material.defaultAttributeValues = { ...nativeMaterial.defaultAttributeValues, groundCover: [1] };
  material.onBeforeCompile = function(shader, renderer) { nativeMaterial.onBeforeCompile.call(this, shader, renderer); shader.uniforms.forceMaterial = { value: 1 }; };
  material.customProgramCacheKey = () => nativeMaterial.customProgramCacheKey() + '-cave-floor';
  const geometry = mesh.geometry, index = geometry.index, mask = geometry.attributes._cave_native_floor, keep = [], floor = [];
  if (!mask || !index) throw new TypeError('Missing indexed native floor mask');
  for (let i = 0; i < index.count; i += 3) {
    const target = [0, 1, 2].every(j => mask.getX(index.getX(i + j)) > .5) ? floor : keep;
    target.push(index.getX(i), index.getX(i + 1), index.getX(i + 2));
  }
  geometry.clearGroups(); geometry.setIndex([...keep, ...floor]); geometry.addGroup(0, keep.length, 0); geometry.addGroup(keep.length, floor.length, 1);
  mesh.material = [mesh.material, material];
  return floor.length / 3;
}
