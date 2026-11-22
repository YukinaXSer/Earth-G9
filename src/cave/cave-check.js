export function findWalk(start, goal, canMove, { step = .35, margin = 5, maxNodes = 200000 } = {}) {
  const minX = Math.min(start[0], goal[0]) - margin, maxX = Math.max(start[0], goal[0]) + margin;
  const minZ = Math.min(start[1], goal[1]) - margin, maxZ = Math.max(start[1], goal[1]) + margin;
  const key = (x, z) => `${x},${z}`, nodes = new Map(), heap = [];
  const push = n => { heap.push(n); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p].f <= n.f) break; heap[i] = heap[p]; i = p; } heap[i] = n; };
  const pop = () => { const first = heap[0], last = heap.pop(); if (heap.length) { let i = 0; while (i * 2 + 1 < heap.length) { let child = i * 2 + 1; if (child + 1 < heap.length && heap[child + 1].f < heap[child].f) child++; if (last.f <= heap[child].f) break; heap[i] = heap[child]; i = child; } heap[i] = last; } return first; };
  const traverse = (a, b) => {
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / .02); let previous = a;
    if (!n) return canMove(...a, ...b);
    for (let i = 1; i <= n; i++) { const t = i / n, next = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; if (!canMove(...previous, ...next)) return false; previous = next; }
    return true;
  };
  if (traverse(start, goal)) return [start, goal];
  const first = { x: 0, z: 0, p: start, g: 0, f: Math.hypot(goal[0] - start[0], goal[1] - start[1]) }; nodes.set(key(0, 0), first); push(first);
  while (heap.length && nodes.size < maxNodes) {
    const current = pop(); if (current.closed) continue; current.closed = true;
    if (Math.hypot(goal[0] - current.p[0], goal[1] - current.p[1]) < step * 1.5 && traverse(current.p, goal)) {
      const path = [goal]; for (let n = current; n; n = n.parent) path.push(n.p); return path.reverse();
    }
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      if (!dx && !dz) continue;
      const x = current.x + dx, z = current.z + dz, p = [start[0] + x * step, start[1] + z * step], id = key(x, z), old = nodes.get(id), g = current.g + Math.hypot(dx, dz) * step;
      if (p[0] < minX || p[0] > maxX || p[1] < minZ || p[1] > maxZ || old?.closed || (old && old.g <= g) || !traverse(current.p, p)) continue;
      const n = { x, z, p, g, f: g + Math.hypot(goal[0] - p[0], goal[1] - p[1]), parent: current }; nodes.set(id, n); push(n);
    }
  }
  throw new Error(`No walkable path from ${start} to ${goal}; searched ${nodes.size} nodes`);
}

export function simulateWalk(host, path, movePlayer, { speed = 4.3, dt = 1 / 60, onStep = () => {} } = {}) {
  let frames = 0, distance = 0;
  for (const [x, z] of path.slice(1)) {
    while (Math.hypot(x - host.position.x, z - host.position.z) > 1e-5) {
      const dx = x - host.position.x, dz = z - host.position.z, remaining = Math.hypot(dx, dz), step = Math.min(dt, remaining / speed);
      host.yaw = Math.atan2(-dx, -dz); const before = [host.position.x, host.position.z];
      movePlayer.call(host, step, 1, 0);
      const moved = Math.hypot(host.position.x - before[0], host.position.z - before[1]);
      if (moved < 1e-7) throw new Error(`Host blocked at ${before} towards ${[x, z]}`);
      distance += moved; frames++; onStep(host);
    }
  }
  return { frames, distance };
}
