import bpy
from pathlib import Path

root = Path(__file__).resolve().parents[1] / 'public' / 'models'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(root / 'captured-banyan-low.glb'))
for obj in list(bpy.context.scene.objects):
    if obj.type != 'MESH':
        continue
    bpy.context.view_layer.objects.active = obj
    modifier = obj.modifiers.new('Distant capture', 'DECIMATE')
    modifier.ratio = .065
    modifier.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=modifier.name)
bpy.ops.export_scene.gltf(
    filepath=str(root / 'captured-banyan-far.glb'), export_format='GLB',
    export_materials='NONE', export_animations=False,
    export_normals=False, export_texcoords=True,
)
