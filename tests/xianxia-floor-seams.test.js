import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createFloorIndex} from '../src/xianxia-world.js';

test('adjacent visible terrain tiles share foot support without hiding their own wall collision',()=>{
  const left=new THREE.PlaneGeometry(2,4).rotateX(-Math.PI/2).translate(-1,0,0),right=new THREE.PlaneGeometry(2,4).rotateX(-Math.PI/2).translate(1,0,0);
  const a=createFloorIndex([left],1),b=createFloorIndex([right],1);
  const height=(x,z)=>{const h=[a.heightAt(x,z),b.heightAt(x,z)].filter(h=>h!=null);return h.length?Math.max(...h):null;};
  assert.equal(a.canMove(-.1,0,.1,0),false);
  assert.equal(a.canMove(-.1,0,.1,0,.35,height),true);
  assert.equal(b.canMove(-.1,0,.1,0,.35,height),true);
  const wall=new THREE.PlaneGeometry(4,2).rotateY(Math.PI/2).translate(.3,1,0),blocked=createFloorIndex([right,wall],1);
  assert.equal(blocked.canMove(-.1,0,.1,0,.35,height),false);
});
