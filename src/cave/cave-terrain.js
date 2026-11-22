import { BufferAttribute } from 'three';
import cuts from './cave-terrain-cuts.json' with { type: 'json' };

export function terrainCutWriter(geometry) {
  if (geometry.attributes.position.count !== cuts.vertexCount || geometry.index.count !== cuts.indexCount) throw new Error('Cave contact requires the original host terrain topology');
  const records = new Map(cuts.triangles), attributes = Object.fromEntries(Object.entries(geometry.attributes).map(([name, attribute]) => [name, Array.from(attribute.array)]));
  return {
    records,
    append(ids, weights) {
      const id = attributes.position.length / 3;
      for (const [name, attribute] of Object.entries(geometry.attributes)) for (let k = 0; k < attribute.itemSize; k++) {
        attributes[name].push(ids.reduce((sum, vertex, j) => sum + attribute.array[vertex * attribute.itemSize + k] * weights[j], 0));
      }
      return id;
    },
    finish() {
      for (const [name, values] of Object.entries(attributes)) {
        const attribute = geometry.getAttribute(name);
        geometry.setAttribute(name, new BufferAttribute(new attribute.array.constructor(values), attribute.itemSize, attribute.normalized));
      }
    },
  };
}
