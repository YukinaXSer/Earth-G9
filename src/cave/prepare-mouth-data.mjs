import { readFileSync } from 'node:fs';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CaveLink } from './cave-link.js';
import { fitCaveFloor } from './cave-physics.js';
import { MOUNTAIN_ENTRANCE } from '../xianxia-mountain.js';
import { TERRAIN } from '../ground-relief.js';
import { groundHeight } from '../data.js';

if (process.argv.includes('--terrain')) {
  const link = new CaveLink({ scene: new T.Scene(), lowDetail: false });
  const g = new T.PlaneGeometry(TERRAIN.width, TERRAIN.depth, TERRAIN.width / TERRAIN.step, TERRAIN.depth / TERRAIN.step);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position, m = link.mouths[0], o = new T.Vector3(...m.floorCenter), f = new T.Vector3(...m.outward), side = new T.Vector3(f.z, 0, -f.x), inverse = link.transform.clone().invert(), triangles = [];
  for (let i = 0; i < g.index.count; i += 3) {
    const ids = [0, 1, 2].map(j => g.index.getX(i + j));
    const x = ids.reduce((s, id) => s + p.getX(id), 0) / 3, z = ids.reduce((s, id) => s + p.getZ(id) + TERRAIN.centerZ, 0) / 3;
    const delta = new T.Vector3(x, o.y, z).sub(o), d = delta.dot(f);
    if (d < -8 || d > 4 || Math.abs(delta.dot(side)) > 14) continue;
    triangles.push([i / 3, ids.map(id => {
      const x = p.getX(id), z = p.getZ(id) + TERRAIN.centerZ;
      return new T.Vector3(x, groundHeight(x, z), z).applyMatrix4(inverse).toArray();
    })]);
  }
  process.stdout.write(JSON.stringify({ vertexCount: p.count, indexCount: g.index.count, triangles }));
  process.exit(0);
}

const bytes = readFileSync(new URL('../../public/cave/cave.glb', import.meta.url));
const { scene } = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
scene.updateMatrixWorld(true);
const link = new CaveLink({ scene: new T.Scene(), lowDetail: false });
const mesh = scene.getObjectByProperty('isMesh', true), point = new T.Vector3();
const input = process.argv.includes('--vertices') ? readFileSync(0) : null;
const positions = input ? new Float32Array(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength)) : new Float32Array(mesh.geometry.attributes.position.count * 3);
for (let i = 0; i < positions.length / 3; i++) {
  if (input) point.fromArray(positions, i * 3);
  else point.fromBufferAttribute(mesh.geometry.attributes.position, i).applyMatrix4(mesh.matrixWorld);
  point.applyMatrix4(link.transform).toArray(positions, i * 3);
}
const before = positions.slice();
fitCaveFloor(positions, link.route, link.mouths, MOUNTAIN_ENTRANCE.approach.grade);
if (input) for (let i = 1; i < positions.length; i += 3) positions[i] = before[i] + .97 * (positions[i] - before[i]);
const inverse = link.transform.clone().invert();
for (let i = 0; i < positions.length / 3; i++) point.fromArray(positions, i * 3).applyMatrix4(inverse).toArray(positions, i * 3);
process.stdout.write(Buffer.from(positions.buffer));
