import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {loadCompressedModel} from '../src/xianxia-model.js';

test('compressed models use native browser gzip and preserve the glTF resource base without a second HTTP request',async t=>{
  const source=new TextEncoder().encode('glTF embedded image fixture'),requests=[];
  t.mock.method(globalThis,'fetch',async url=>{requests.push(url);return new Response(gzipSync(source));});
  const loader={parseAsync:async(bytes,path)=>{assert.deepEqual(new Uint8Array(bytes),source);assert.equal(path,'/xianxia/surface/');return 'parsed';}};
  assert.equal(await loadCompressedModel(loader,'/xianxia/surface/tree.glb.gz','/xianxia/surface/'),'parsed');
  assert.deepEqual(requests,['/xianxia/surface/tree.glb.gz']);
});

test('compressed model HTTP or corrupt-stream errors reject instead of hiding a broken asset',async t=>{
  const loader={parseAsync:()=>{throw new Error('unexpected parse');}};
  t.mock.method(globalThis,'fetch',async()=>new Response('',{status:404}));
  await assert.rejects(loadCompressedModel(loader,'/missing','/'),/unavailable/);
  globalThis.fetch=async()=>new Response('not gzip');
  await assert.rejects(loadCompressedModel(loader,'/broken','/'),error=>error.message!=='unexpected parse');
});

test('models already decompressed by HTTP Content-Encoding are not decompressed twice',async t=>{
  const source=new TextEncoder().encode('glTF container fixture');
  t.mock.method(globalThis,'fetch',async()=>new Response(source,{headers:{'Content-Encoding':'gzip'}}));
  const loader={parseAsync:async bytes=>{assert.deepEqual(new Uint8Array(bytes),source);return 'parsed';}};
  assert.equal(await loadCompressedModel(loader,'/tree.glb.gz','/'),'parsed');
});
