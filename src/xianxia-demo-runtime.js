import * as THREE from 'three';
import { Rainforest } from './world.js';
import { BOUNDS,groundHeight,riverX } from './data.js';
import { colliderContains } from './captured-collisions.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

export class XianxiaDemoRuntime extends Rainforest {
  constructor(...args){
    super(...args);
    this.animate=this.animateDemo.bind(this);
    this.demoSunOffset=this.sun.position.clone();
    this.demoComposer=new EffectComposer(this.renderer);
    this.demoRender=new RenderPass(this.scene,this.camera);this.demoFXAA=new ShaderPass(FXAAShader);
    this.demoComposer.addPass(this.demoRender);this.demoComposer.addPass(new OutputPass());this.demoComposer.addPass(this.demoFXAA);
    const resize=()=>{const ratio=this.renderer.getPixelRatio();this.demoComposer.setPixelRatio(ratio);this.demoComposer.setSize(innerWidth,innerHeight);this.demoFXAA.uniforms.resolution.value.set(1/(innerWidth*ratio),1/(innerHeight*ratio));};
    resize();window.addEventListener('resize',resize);
  }
  moveDemo(dt){
    if(!this.active||this.paused)return false;
    const forward=(this.keys.has('KeyW')||this.keys.has('ArrowUp')?1:0)-(this.keys.has('KeyS')||this.keys.has('ArrowDown')?1:0)+(this.touchMove?.y??0);
    const side=(this.keys.has('KeyD')?1:0)-(this.keys.has('KeyA')?1:0)+(this.touchMove?.x??0);
    if(this.keys.has('ArrowLeft'))this.yaw+=dt*1.3;
    if(this.keys.has('ArrowRight'))this.yaw-=dt*1.3;
    const speed=(this.keys.has('ShiftLeft')||this.keys.has('ShiftRight')?8:4.3)*dt/Math.max(1,Math.hypot(forward,side)),steps=Math.max(1,Math.ceil(dt/.035));
    for(let i=0;i<steps;i++){
      const rawX=this.position.x+(-Math.sin(this.yaw)*forward+Math.cos(this.yaw)*side)*speed/steps;
      const rawZ=this.position.z+(-Math.cos(this.yaw)*forward-Math.sin(this.yaw)*side)*speed/steps;
      const linked=this.worldLink?.owns(rawX,rawZ);
      const x=linked?rawX:THREE.MathUtils.clamp(rawX,BOUNDS.minX,Math.min(BOUNDS.maxX,riverX(rawZ)-5.3));
      const z=linked?rawZ:THREE.MathUtils.clamp(rawZ,BOUNDS.minZ,BOUNDS.maxZ);
      const floor=linked?this.worldLink.groundHeight(x,z):groundHeight(x,z);
      const blocked=linked?!this.worldLink.canWalk(x,z):this.colliders.some(c=>colliderContains(c,x,z,.4,floor));
      if(!blocked){this.position.x=x;this.position.z=z;}
    }
    return !!(forward||side);
  }
  animateDemo(){
    requestAnimationFrame(this.animate);
    const delta=this.clock.getDelta();if(document.hidden)return;
    const dt=Math.min(delta,.75);this.elapsed+=dt;const t=this.elapsed,moving=this.moveDemo(dt);
    this.sun.position.copy(this.position).add(this.demoSunOffset);this.sun.target.position.copy(this.position);
    const floor=this.worldLink?.owns(this.position.x,this.position.z)?this.worldLink.groundHeight(this.position.x,this.position.z):groundHeight(this.position.x,this.position.z);
    this.camera.position.set(this.position.x,floor+1.85+(moving?Math.sin(t*9)*.035:Math.sin(t*.8)*.012),this.position.z);
    this.camera.rotation.set(this.pitch,this.yaw+(!this.active?Math.sin(t*.09)*.075:0),0,'YXZ');
    this.waterMaterial.uniforms.time.value=t;this.motes.rotation.y=Math.sin(t*.05)*.03;this.wildlife.update(t);
    if(!this.lastUpdate||t-this.lastUpdate>.12){
      this.habitat.updateVisibility(this.camera.position);
      this.onUpdate?.({x:this.position.x,z:this.position.z,yaw:this.yaw,pitch:this.pitch,moving});this.lastUpdate=t;
    }
    if(!this.initializing){this.demoRender.scene=this.worldLink?.update(this.position,t)??this.scene;this.demoComposer.render();}
  }
}
