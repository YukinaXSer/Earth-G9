import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { terrainCutWriter } from '../src/cave/cave-terrain.js';
import cuts from '../src/cave/cave-terrain-cuts.json' with { type: 'json' };

function terrain() {
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.BufferAttribute(new Float32Array(cuts.vertexCount * 3), 3));
  geometry.setIndex(new T.BufferAttribute(new Uint32Array(cuts.indexCount), 1));
  return geometry;
}

test('terrain contact interpolates existing positions and material coordinates', () => {
  const geometry = terrain(), position = geometry.attributes.position;
  position.setXYZ(0, 0, 1, 0); position.setXYZ(1, 2, 2, 0); position.setXYZ(2, 0, 3, 2);
  geometry.setAttribute('uv', new T.BufferAttribute(new Float32Array(cuts.vertexCount * 2), 2));
  geometry.attributes.uv.setXY(1, 1, 0); geometry.attributes.uv.setXY(2, 0, 1);
  const writer = terrainCutWriter(geometry), id = writer.append([0, 1, 2], [.25, .5, .25]);
  writer.finish();
  assert.deepEqual(new T.Vector3().fromBufferAttribute(geometry.attributes.position, id).toArray(), [1, 2, .5]);
  assert.deepEqual(new T.Vector2().fromBufferAttribute(geometry.attributes.uv, id).toArray(), [.5, .25]);
  assert.ok(cuts.triangles.length > 0);
  for (const [, triangles] of cuts.triangles) {
    assert.equal(triangles.length % 3, 0);
    for (const weights of triangles) {
      assert.ok(Math.abs(weights.reduce((a, b) => a + b, 0) - 1) < 1e-8);
      assert.ok(weights.every(value => value >= -1e-8 && value <= 1 + 1e-8));
    }
  }
});

test('an empty terrain contact write preserves all attributes and topology', () => {
  const geometry = terrain(), before = geometry.attributes.position.array.slice(), index = geometry.index;
  terrainCutWriter(geometry).finish();
  assert.deepEqual(geometry.attributes.position.array, before);
  assert.equal(geometry.index, index);
});

test('terrain contact rejects a different host mesh topology', () => {
  assert.throws(() => terrainCutWriter(new T.PlaneGeometry(2, 2)), /original host terrain topology/);
});
