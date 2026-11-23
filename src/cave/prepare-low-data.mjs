import { LoadingManager } from 'three';
import { Habitat } from '../habitat.js';

globalThis.createImageBitmap = async () => ({ width: 1, height: 1 });
globalThis.self = globalThis;
globalThis.ProgressEvent = class extends Event {
  constructor(type, properties) { super(type); Object.assign(this, properties); }
};
const Request = globalThis.Request;
globalThis.Request = class extends Request {
  constructor(url, options) { super(typeof url === 'string' && url.startsWith('/') ? new URL(url, process.argv[2]) : url, options); }
};
const habitat = new Habitat({ lowDetail: true, loadingManager: new LoadingManager() });
await habitat.load();
const records = [];
for (const key of ['creeper', 'sapling', 'flower', 'fern', 'broadleaf', 'groundcover']) {
  habitat.models.get(key).forEach((variant, i) => variant.children.forEach((mesh, j) => {
    const geometry = mesh.geometry, attributes = {};
    for (const name of ['position', 'normal', 'uv', 'color']) {
      const a = geometry.getAttribute(name);
      if (a) attributes[name] = Array.from({ length: a.count }, (_, k) => Array.from({ length: a.itemSize }, (_, c) => a.getComponent(k, c)));
    }
    records.push({ name: `${key}__${i}__${j}`, attributes, indices: Array.from(geometry.index.array) });
  }));
}
console.log(JSON.stringify(records));
