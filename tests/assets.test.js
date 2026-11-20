import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('startup assets keep the captured tree and environment lighting within their transfer budgets', () => {
  assert.ok(readFileSync(new URL('../public/models/captured-banyan-low.glb', import.meta.url)).length < 10_000_000);
  for (const name of ['rainforest-light', 'overcast-sky', 'sunny-sky']) {
    const data = readFileSync(new URL(`../public/textures/${name}.hdr`, import.meta.url));
    assert.ok(data.length < 600_000, name);
    assert.ok(data.subarray(0, 100).toString().includes('-Y 256 +X 512'), name);
  }
});

function readModel(name) {
  const bytes = readFileSync(new URL(`../public/models/${name}.glb`, import.meta.url));
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const model = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  model.binary = bytes.subarray(28 + bytes.readUInt32LE(12));
  return model;
}

function triangles(model) {
  return model.meshes.reduce((sum, mesh) => sum + mesh.primitives.reduce((count, primitive) => count + model.accessors[primitive.indices].count / 3, 0), 0);
}

test('the locally bundled butterfly retains authored anatomy, opposite wing textures and attribution under 1MB', () => {
  const model = readModel('morpho-butterfly');
  assert.ok(readFileSync(new URL('../public/models/morpho-butterfly.glb', import.meta.url)).length < 1_000_000);
  assert.equal(model.extras.author, 'QweenH');
  assert.equal(model.extras.license, 'CC-BY-4.0');
  for (const side of ['left', 'right']) for (const wing of ['up', 'under']) assert.ok(model.nodes.some(node => node.name === `wing-${side}-${wing}`));
  assert.ok(model.nodes.some(node => node.name === 'body'));
  assert.ok(triangles(model) > 20000 && triangles(model) < 25000);
  assert.ok(model.materials.some(material => material.name === 'front_wing'));
  assert.ok(model.materials.some(material => material.name === 'back_wing'));
  assert.equal(model.images.length, 3);
  assert.ok(model.images.every(image => Number.isInteger(image.bufferView) && !image.uri));
  assert.ok(model.buffers.every(buffer => !buffer.uri));
});

test('photographic foliage cutouts retain alpha masks in their embedded textures', () => {
  for (const name of ['canopy-tree', 'forest-tree', 'forest-distant', 'forest-horizon', 'fern', 'calathea', 'pachira', 'anthurium', 'shrub-02', 'shrub-03', 'shrub-04']) {
    const model = readModel(name), cutouts = model.materials.filter(material => material.alphaMode === 'MASK');
    assert.ok(cutouts.length > 0, name);
    for (const material of cutouts) {
      const texture = model.textures[material.pbrMetallicRoughness.baseColorTexture.index];
      const image = model.images[texture.extensions?.EXT_texture_webp?.source ?? texture.source];
      const view = model.bufferViews[image.bufferView];
      const bytes = model.binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
      assert.equal(bytes.toString('ascii', 12, 16), 'VP8X', name);
      assert.ok(bytes[20] & 16, `${name}: WebP must contain transparency, not an opaque JPEG conversion`);
    }
  }
});

function leafArea(model) {
  const accessor = (id, size) => {
    const value = model.accessors[id], view = model.bufferViews[value.bufferView];
    const bytes = value.componentType === 5123 ? 2 : 4;
    const method = value.componentType === 5126 ? 'readFloatLE' : value.componentType === 5123 ? 'readUInt16LE' : 'readUInt32LE';
    return (i, component = 0) => model.binary[method]((view.byteOffset ?? 0) + (value.byteOffset ?? 0) + i * (view.byteStride ?? size * bytes) + component * bytes);
  };
  let area = 0;
  for (const mesh of model.meshes) for (const primitive of mesh.primitives) {
    if (!model.materials[primitive.material].name.includes('leaves')) continue;
    const position = accessor(primitive.attributes.POSITION, 3), index = accessor(primitive.indices, 1);
    for (let i = 0; i < model.accessors[primitive.indices].count; i += 3) {
      const a = index(i), b = index(i + 1), c = index(i + 2);
      const u = [0, 1, 2].map(k => position(b, k) - position(a, k));
      const v = [0, 1, 2].map(k => position(c, k) - position(a, k));
      area += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
    }
  }
  return area;
}

test('distant forest LODs retain leaf area with a fraction of the native geometry', () => {
  const native = readModel('forest-tree'), area = leafArea(native);
  for (const [name, ratio] of [['forest-distant', .12], ['forest-horizon', .06]]) {
    const model = readModel(name);
    assert.ok(triangles(model) < triangles(native) * ratio, name);
    assert.ok(Math.abs(leafArea(model) / area - 1) < .02, name);
    assert.ok(model.buffers.every(buffer => !buffer.uri));
    assert.ok(model.images.every(image => Number.isInteger(image.bufferView) && !image.uri));
  }
});

test('both captured-tree quality levels embed their textures and geometry locally', () => {
  for (const name of ['captured-banyan', 'captured-banyan-low']) {
    const model = readModel(name);
    assert.ok(model.scenes.length && model.meshes.length);
    assert.ok(model.buffers.every(buffer => !buffer.uri));
    assert.ok(model.images.length > 0);
    assert.ok(model.images.every(image => Number.isInteger(image.bufferView) && !image.uri));
  }
});

test('rebaked capture gives surface detail useful UV atlas space', () => {
  const model = readModel('captured-banyan-low');
  const accessor = (id, size) => {
    const value = model.accessors[id], view = model.bufferViews[value.bufferView];
    const bytes = value.componentType === 5123 ? 2 : 4;
    const method = value.componentType === 5126 ? 'readFloatLE' : value.componentType === 5123 ? 'readUInt16LE' : 'readUInt32LE';
    return (i, component = 0) => model.binary[method]((view.byteOffset ?? 0) + (value.byteOffset ?? 0) + i * (view.byteStride ?? size * bytes) + component * bytes);
  };
  let area = 0;
  for (const mesh of model.meshes) for (const primitive of mesh.primitives) {
    const uv = accessor(primitive.attributes.TEXCOORD_0, 2), index = accessor(primitive.indices, 1);
    for (let i = 0; i < model.accessors[primitive.indices].count; i += 3) {
      const a = index(i), b = index(i + 1), c = index(i + 2);
      area += Math.abs((uv(b) - uv(a)) * (uv(c, 1) - uv(a, 1)) - (uv(b, 1) - uv(a, 1)) * (uv(c) - uv(a))) / 2;
    }
  }
  assert.ok(Number.isFinite(area) && area > .15);
});

test('software/mobile tree uses a substantially smaller geometry budget', () => {
  const high = triangles(readModel('captured-banyan'));
  const low = triangles(readModel('captured-banyan-low'));
  assert.ok(low > 0 && low < 150000);
  assert.ok(low < high * .3);
});
