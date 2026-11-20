import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createFloorIndex} from '../src/xianxia-world.js';
import {MountainTileSurface} from '../src/xianxia-mountain-surface.js';

test('mirrored captured blocks share visible support and collision without translating player coordinates',()=>{
  const geometry=new THREE.PlaneGeometry(17,12).rotateX(-Math.PI/2).translate(154.5,2,-109),index=createFloorIndex([geometry],2),surface=new MountainTileSurface();
  surface.set(0,3,[index]);surface.set(1,3,[index]);
  for(let x=162;x<=164;x+=.04){assert.ok(Math.abs(surface.heightAt(x,-109)-2)<1e-9);assert.ok(surface.canMove(x,-109,x+.04,-109));assert.ok(surface.canMove(x+.04,-109,x,-109));}
  assert.equal(surface.heightAt(1e6,-109),null);assert.equal(surface.canMove(163,-109,1e6,-109),false);
  surface.delete(1,3);assert.equal(surface.heightAt(163.1,-109),null);assert.equal(surface.canMove(162.9,-109,163.1,-109),false);
});

test('separate scanned props add actual top support and preserve body blocking across tile boundaries',()=>{
  const geometry=new THREE.PlaneGeometry(17,12).rotateX(-Math.PI/2).translate(154.5,0,-109),base=createFloorIndex([geometry],2),surface=new MountainTileSurface();
  const rock=new THREE.BoxGeometry(1,2,1).translate(162.8,1,-109),prop=createFloorIndex([rock],2);
  surface.set(0,3,[base,prop]);surface.set(1,3,[base]);
  assert.equal(surface.heightAt(163.2,-109),2);
  assert.equal(surface.heightAt(163.6,-109),0);
  assert.equal(surface.canMove(163.7,-109,163.5,-109),false);
});
