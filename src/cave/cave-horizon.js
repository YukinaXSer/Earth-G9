export async function warmMountainHorizon(mountain, warm) {
  const horizon = await mountain.loadHorizon();
  horizon.visible = false;
  const parent = horizon.parent;
  parent?.remove(horizon);
  try { await warm(horizon); }
  finally { parent?.add(horizon); }
  horizon.visible = true;
  return horizon;
}
