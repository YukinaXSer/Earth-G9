import { Box3, Matrix4 } from 'three';

export function holdMountainBackdrop(root, replacement) {
  const near = replacement.getObjectByName('native-mountain');
  if (!near) return () => {};
  if (!near.geometry.boundingBox) near.geometry.computeBoundingBox();
  const bounds = near.geometry.boundingBox, box = new Box3(), matrix = new Matrix4(), world = new Matrix4();
  const held = [];
  root.traverse(mesh => {
    if (!mesh.isBatchedMesh || mesh.name !== 'native-mountain-far') return;
    const count = mesh.instanceCount;
    let visited = 0;
    for (let i = 0; i < mesh.maxInstanceCount && visited < count; i++) {
      try {
        mesh.getMatrixAt(i, matrix); visited++;
        world.multiplyMatrices(mesh.matrixWorld, matrix);
        if (!world.elements.every((v, j) => Math.abs(v - near.matrixWorld.elements[j]) < 1e-8)) continue;
        mesh.getBoundingBoxAt(mesh.getGeometryIdAt(i), box);
        if (Math.abs(box.min.x - bounds.min.x) > .001 || Math.abs(box.max.x - bounds.max.x) > .001) continue;
        held.push([mesh, i, mesh.getVisibleAt(i)]); mesh.setVisibleAt(i, true);
      } catch (error) {
        if (!/Invalid instanceId/i.test(error.message)) throw error;
      }
    }
  });
  return () => { for (const [mesh, id, visible] of held) mesh.setVisibleAt(id, visible); };
}
