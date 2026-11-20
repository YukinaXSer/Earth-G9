export const DEFAULT_FOV = 60;
export const MIN_FOV = 25;
export const MAX_FOV = 85;

export function setFov(camera, fov) {
  if (!Number.isFinite(fov)) return;
  camera.fov = Math.max(MIN_FOV, Math.min(MAX_FOV, fov));
  camera.updateProjectionMatrix();
}

export function scaleView(camera, factor) {
  if (!Number.isFinite(factor) || factor <= 0) return;
  setFov(camera, 360 / Math.PI * Math.atan(Math.tan(camera.fov * Math.PI / 360) * factor));
}

export function bindLookControls(canvas, world) {
  const pointers = new Map();
  let previousDistance = 0;
  const distance = () => {
    const [a, b] = [...pointers.values()];
    return b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const clear = () => {
    pointers.clear(); previousDistance = 0; world.dragging = false; world.lastPointer = null;
  };
  const enabled = () => world.active && !world.paused && !world.contextFailed;
  canvas.addEventListener('wheel', event => {
    if (!enabled() || !Number.isFinite(event.deltaY)) return;
    event.preventDefault();
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1);
    world.zoomView(Math.exp(Math.max(-500, Math.min(500, pixels)) * .0015));
  }, { passive: false });
  canvas.addEventListener('pointerdown', event => {
    if (!enabled() || event.pointerType === 'mouse' && event.button !== 0) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    previousDistance = distance();
    world.dragging = true; world.lastPointer = pointers.size === 1 ? pointers.get(event.pointerId) : null;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId)) return;
    if (!enabled()) { clear(); return; }
    const previous = pointers.get(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size > 1) {
      const nextDistance = distance();
      if (previousDistance > 0 && nextDistance > 0) world.zoomView(previousDistance / nextDistance);
      previousDistance = nextDistance;
    } else {
      world.yaw -= (event.clientX - previous.x) * .0035;
      world.pitch = Math.max(-1.05, Math.min(1.05, world.pitch - (event.clientY - previous.y) * .003));
      world.lastPointer = pointers.get(event.pointerId);
    }
  });
  const release = event => {
    if (!pointers.delete(event.pointerId)) return;
    previousDistance = distance(); world.dragging = pointers.size > 0;
    world.lastPointer = pointers.size === 1 ? [...pointers.values()][0] : null;
  };
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, release);
  return clear;
}
