import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('production server allows embedded glTF textures and serves models with their MIME type', async t => {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, PORT: '0', STATIC_DIR: 'public' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server did not start')), 10000);
    let output = '';
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Server exited: ${code}`)); });
    child.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/listening on (\d+)/);
      if (match) { clearTimeout(timeout); resolve(Number(match[1])); }
    });
  });
  const url = `http://127.0.0.1:${port}/models/canopy-tree.glb`;
  const response = await fetch(url, { method: 'HEAD', headers: { 'Accept-Encoding': 'identity' } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'model/gltf-binary');
  assert.ok(Number(response.headers.get('content-length')) > 0);
  const policy = response.headers.get('content-security-policy');
  assert.ok(policy.includes("connect-src 'self' blob:"));
  assert.ok(policy.includes("script-src 'self';"));
  assert.ok(policy.includes("object-src 'none'"));
  const compressed = await fetch(url, { headers: { 'Accept-Encoding': 'gzip;q=0.5' } });
  assert.equal(compressed.headers.get('content-encoding'), 'gzip');
  assert.equal(compressed.headers.get('vary'), 'Accept-Encoding');
  const identity = await fetch(url, { headers: { 'Accept-Encoding': 'gzip;q=0, identity' } });
  assert.equal(identity.headers.get('content-encoding'), null);
  assert.deepEqual(await compressed.arrayBuffer(), await identity.arrayBuffer());
  const cached = await fetch(url, { headers: { 'If-None-Match': response.headers.get('etag') } });
  assert.equal(cached.status, 304);
  assert.equal((await cached.arrayBuffer()).byteLength, 0);
  const detail = await fetch(`http://127.0.0.1:${port}/textures/near-banyan-normal.ktx`, { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(detail.status, 200);
  assert.equal(detail.headers.get('content-type'), 'image/ktx');
  assert.equal(detail.headers.get('content-encoding'), 'gzip');
  assert.equal(detail.headers.get('content-security-policy'), policy);
  assert.ok((await detail.arrayBuffer()).byteLength > 0);
});
