import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { Habitat } from './habitat.js';
import { Wildlife } from './wildlife.js';
import { TERRAIN } from './ground-relief.js';
import { colliderContains } from './captured-collisions.js';
import { SPECIES, PLANT_SITES, START, BOUNDS, groundHeight, riverX, RIVER_LEVEL } from './data.js';

function seededRandom(seed = 2718) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
}

export class Rainforest {
  constructor(container, onUpdate, onLoading) {
    this.container = container;
    this.onUpdate = onUpdate;
    this.onLoading = onLoading;
    this.initializing = true;
    this.loadingManager = new THREE.LoadingManager();
    this.loadingManager.onStart = this.loadingManager.onProgress = (url, loaded, total) => onLoading?.({ phase: 'download', loaded, total });
    this.random = seededRandom();
    this.keys = new Set();
    this.position = new THREE.Vector3(START.x, 0, START.z);
    this.yaw = -0.09;
    this.pitch = 0.035;
    this.active = false;
    this.paused = false;
    this.rainy = false;
    this.moisture = 0;
    this.elapsed = 0;
    this.colliders = [];
    this.markers = [];
    this.seedlings = new Map();
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#496c59');
    this.scene.fog = new THREE.FogExp2('#8ca18c', 0.0045);
    this.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 220);
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    const gl = this.renderer.getContext();
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : '';
    const preference = new URLSearchParams(location.search).get('quality');
    this.lowDetail = preference === 'low' || (preference !== 'high' && (/swiftshader|llvmpipe|software/i.test(gpu) || innerWidth < 700));
    this.renderer.setSize(innerWidth, innerHeight);
    this.pixelRatio = () => this.lowDetail ? Math.min(0.8, Math.sqrt(600000 / (innerWidth * innerHeight))) : Math.min(devicePixelRatio, 1.4);
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.96;
    this.renderer.shadowMap.enabled = !this.lowDetail;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.canvas = this.renderer.domElement;
    this.canvas.setAttribute('aria-label', '雨林场景：使用 WASD 移动，按住鼠标拖动环顾四周');
    this.canvas.tabIndex = 0;
    this.makeMaterials();
    this.makeLighting();
    this.makeTerrain();
    this.habitat = new Habitat(this);
    this.wildlife = new Wildlife(this);
    this.ready = this.loadHabitat();
    this.makeParticles();
    this.setupControls();
    this.clock = new THREE.Clock();
    this.animate();
  }

  rand(a, b) { return a + this.random() * (b - a); }

  makeMaterials() {
    this.textureLoads = [];
    const loader = new THREE.TextureLoader(this.loadingManager);
    const texture = (name, color = false) => {
      let resolve, reject;
      this.textureLoads.push(new Promise((yes, no) => { resolve = yes; reject = no; }));
      const map = loader.load('/textures/' + name, resolve, undefined, reject);
      if (color) map.colorSpace = THREE.SRGBColorSpace;
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.repeat.set(TERRAIN.width / 8, TERRAIN.depth / 8);
      map.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
      return map;
    };
    this.floorMap = texture('wet-floor.jpg', true);
    this.floorNormal = texture('wet-floor-normal.jpg');
    this.floorRoughness = texture('forest-litter-roughness.jpg');
  }

  async loadHabitat() {
    await Promise.all([this.habitat.load(), this.wildlife.load(), this.environmentReady, ...this.textureLoads]);
    this.onLoading?.({ phase: 'compose' });
    await new Promise(resolve => setTimeout(resolve, 0));
    this.habitat.compose();
    this.habitat.flush();
    this.makeLandmarks();
    this.makeGroundShadows();
    this.onLoading?.({ phase: 'prepare' });
    await this.renderer.compileAsync(this.scene, this.camera);
    this.renderer.render(this.scene, this.camera);
    this.initializing = false;
  }

  makeLighting() {
    this.scene.add(new THREE.HemisphereLight('#b8cda4', '#65503b', this.lowDetail ? 1.35 : .85));
    if (this.lowDetail) this.scene.add(new THREE.AmbientLight('#dbe2d3', 1.1));
    this.sun = new THREE.DirectionalLight('#fff0ce', 3);
    this.sun.position.set(-24, 30, 12);
    this.sun.castShadow = !this.lowDetail;
    Object.assign(this.sun.shadow.camera, { left: -50, right: 50, top: 55, bottom: -70, near: 1, far: 150 });
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.bias = -0.001;
    this.scene.add(this.sun);
    const hdrLoader = new HDRLoader(this.loadingManager);
    this.environmentReady = Promise.all([
      hdrLoader.loadAsync('/textures/rainforest-light.hdr'),
      hdrLoader.loadAsync('/textures/overcast-sky.hdr'),
      hdrLoader.loadAsync('/textures/sunny-sky.hdr'),
    ]).then(([hdr, sky, sunnySky]) => {
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      this.scene.environment = hdr; this.scene.environmentIntensity = this.rainy ? .45 : .85;
      sky.mapping = THREE.EquirectangularReflectionMapping;
      sunnySky.mapping = THREE.EquirectangularReflectionMapping;
      this.rainySky = sky; this.sunnySky = sunnySky;
      this.updateSky();
    });
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const beam = ctx.createLinearGradient(0, 0, 64, 0);
    beam.addColorStop(0, '#ffffff00'); beam.addColorStop(0.45, '#ffffff'); beam.addColorStop(1, '#ffffff00');
    ctx.fillStyle = beam; ctx.fillRect(0, 0, 64, 256);
    ctx.globalCompositeOperation = 'destination-in';
    const fade = ctx.createLinearGradient(0, 0, 0, 256);
    fade.addColorStop(0, '#ffffff00'); fade.addColorStop(0.4, '#ffffffff'); fade.addColorStop(1, '#ffffff00');
    ctx.fillStyle = fade; ctx.fillRect(0, 0, 64, 256);
    const rayMaterial = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), color: '#f7edcc', transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    this.sunRays = new THREE.Group();
    this.sunRays.visible = !this.lowDetail;
    for (let i = 0; i < (this.lowDetail ? 5 : 9); i++) {
      const ray = new THREE.Mesh(new THREE.PlaneGeometry(this.rand(1.2, 2.8), 32), rayMaterial);
      ray.position.set(this.rand(-9, 14), 10, this.rand(-50, 26));
      ray.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.sun.position.clone().normalize());
      ray.rotateY(.15);
      this.sunRays.add(ray);
    }
    this.scene.add(this.sunRays);
  }

  makeTerrain() {
    const step = TERRAIN.step;
    const geometry = new THREE.PlaneGeometry(TERRAIN.width, TERRAIN.depth, TERRAIN.width / step, TERRAIN.depth / step);
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.attributes.position;
    const colors = [];
    const forest = new THREE.Color('#ded2b6'), path = new THREE.Color('#c7bca4');
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), z = positions.getZ(i) + TERRAIN.centerZ;
      positions.setZ(i, z); positions.setY(i, groundHeight(x, z));
      const pathX = Math.sin(z * 0.06) * 1.4;
      const mix = Math.max(0, 1 - Math.abs(x - pathX) / 1.2);
      const color = forest.clone().lerp(path, mix * 0.7).multiplyScalar(this.rand(0.9, 1.05));
      colors.push(color.r, color.g, color.b);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.computeVertexNormals();
    this.ground = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ map: this.floorMap, normalMap: this.floorNormal, roughnessMap: this.floorRoughness, normalScale: new THREE.Vector2(1.2, 1.2), vertexColors: true, roughness: .9, envMapIntensity: .22 }));
    this.ground.receiveShadow = true; this.scene.add(this.ground);
    const vertices = [], indices = [], waterUvs = [], depths = [], segments = Math.ceil(TERRAIN.depth / 1.7), across = 20;
    for (let i = 0; i <= segments; i++) {
      const z = TERRAIN.centerZ + TERRAIN.depth / 2 - i / segments * TERRAIN.depth;
      for (let column = 0; column <= across; column++) {
        const x = riverX(z) + (column / across - .5) * 20;
        vertices.push(x, RIVER_LEVEL, z); waterUvs.push(column / across, z);
        depths.push(RIVER_LEVEL - groundHeight(x, z));
        if (i < segments && column < across) {
          const j = i * (across + 1) + column;
          indices.push(j, j + 1, j + across + 1, j + 1, j + across + 2, j + across + 1);
        }
      }
    }
    const waterGeometry = new THREE.BufferGeometry();
    waterGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    waterGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(waterUvs, 2));
    waterGeometry.setAttribute('waterDepth', new THREE.Float32BufferAttribute(depths, 1));
    waterGeometry.setIndex(indices); waterGeometry.computeVertexNormals();
    this.waterMaterial = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 }, rain: { value: 0 }, fogColor: { value: new THREE.Color('#9eafa4') } },
      transparent: true,
      vertexShader: 'attribute float waterDepth; varying float vWaterDepth; varying vec3 vPos; varying vec2 vUv; varying float vDepth; void main(){vWaterDepth=waterDepth;vPos=position;vUv=uv;vec4 mv=modelViewMatrix*vec4(position,1.);vDepth=-mv.z;gl_Position=projectionMatrix*mv;}',
      fragmentShader: `uniform float time; uniform float rain; uniform vec3 fogColor;
        varying vec3 vPos; varying vec2 vUv; varying float vDepth; varying float vWaterDepth;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
        void main(){
          vec2 flow=vPos.xz*vec2(1.7,.55)+vec2(0.,time*.55);
          float n=noise(flow)+noise(flow*2.13+3.1)*.5;
          float streak=pow(max(0.,sin(n*12.+vPos.z*.9+time*1.2)),16.);
          vec3 c=mix(vec3(.065,.12,.09),vec3(.21,.29,.22),n*.6)+streak*.065;
          vec2 cell=floor(vPos.xz*1.2),local=fract(vPos.xz*1.2);
          float age=fract(time*1.1+hash(cell));
          float d=length(local-vec2(hash(cell+3.),hash(cell+7.)));
          float ring=(1.-smoothstep(.012,.035,abs(d-age*.65)))*(1.-age)*rain;
          c+=ring*.15;
          float bank=1.-smoothstep(.03,.3,vWaterDepth);
          c=mix(c,vec3(.19,.17,.11),bank*.55);
          float f=1.-exp(-.000324*vDepth*vDepth);
          float edgeFade=1.-smoothstep(.46,.5,abs(vUv.x-.5));
          gl_FragColor=vec4(mix(c,fogColor,f),mix(.94,.4,bank)*smoothstep(0.,.1,vWaterDepth)*edgeFade);
        }`,
    });
    this.scene.add(new THREE.Mesh(waterGeometry, this.waterMaterial));
  }

  makeGroundShadows() {
    const canvas = document.createElement('canvas'), size = 2048; canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#d9d9d9'; ctx.fillRect(0, 0, size, size);
    const random = seededRandom(42);
    const shade = (x, z, radius, opacity) => {
      const px = (x + TERRAIN.width / 2) / TERRAIN.width * size;
      const py = (z - TERRAIN.centerZ + TERRAIN.depth / 2) / TERRAIN.depth * size, r = radius / TERRAIN.width * size;
      const gradient = ctx.createRadialGradient(px, py, 0, px, py, r);
      gradient.addColorStop(0, `rgba(5,12,7,${opacity})`); gradient.addColorStop(1, 'rgba(5,12,7,0)');
      ctx.fillStyle = gradient; ctx.fillRect(px - r, py - r, r * 2, r * 2);
    };
    for (const tree of [...this.colliders, ...this.habitat.groundOccluders]) {
      shade(tree.x, tree.z, (tree.shadeRadius ?? tree.radius) * 3 + 0.7, 0.85);
      for (let i = 0; i < 8; i++) shade(tree.x + 4 + (random() - 0.5) * 12, tree.z - 6 + (random() - 0.5) * 14, 2 + random() * 4, 0.24);
    }
    const shadow = new THREE.CanvasTexture(canvas);
    this.ground.material.onBeforeCompile = shader => {
      shader.uniforms.forestShade = { value: shadow };
      shader.vertexShader = 'varying vec2 vForestUv; varying vec3 vForestGround;\n' + shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvForestUv = uv; vForestGround = position;');
      shader.fragmentShader = 'uniform sampler2D forestShade; varying vec2 vForestUv; varying vec3 vForestGround;\n' + shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        float riverDistance = abs(vForestGround.x - (24. + sin(vForestGround.z * .036) * 8.));
        float shoreWetness = (1. - smoothstep(10., 12., riverDistance)) * (1. - smoothstep(.02, .48, vForestGround.y - (${RIVER_LEVEL})));
        diffuseColor.rgb *= mix(vec3(1.), vec3(.62, .58, .48), shoreWetness);
        float forestOcclusion = clamp(texture2D(forestShade, vForestUv).r, 0.55, 1.0);
        diffuseColor.rgb *= forestOcclusion;`).replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, clamp(roughnessFactor * .85, .62, .85), shoreWetness);')
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        reflectedLight.indirectSpecular *= forestOcclusion;
        ${this.lowDetail ? 'reflectedLight.directSpecular *= forestOcclusion;' : ''}`);
    };
  }

  makeLandmarks() {
    for (const point of SPECIES.filter(s => ['fern', 'flower'].includes(s.id))) this.colliders.push({ x: point.x, z: point.z, radius: 1.1 });
    for (const point of [...SPECIES, ...PLANT_SITES]) {
      const isSeed = point.id.startsWith('seed');
      const group = new THREE.Group();
      group.position.set(point.x, groundHeight(point.x, point.z), point.z);
      const ring = new THREE.Mesh(new THREE.RingGeometry(isSeed ? 0.55 : 0.8, isSeed ? 0.61 : 0.85, 40), new THREE.MeshBasicMaterial({ color: isSeed ? '#e4ca86' : '#def1bb', transparent: true, opacity: 0.65, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; group.add(ring);
      const gem = new THREE.Mesh(new THREE.OctahedronGeometry(isSeed ? 0.12 : 0.17), new THREE.MeshBasicMaterial({ color: isSeed ? '#edd59b' : '#e9ffcd', transparent: true, opacity: 0.9 }));
      gem.position.y = isSeed ? 0.8 : 2.4; group.add(gem);
      this.scene.add(group); this.markers.push({ id: point.id, group, gem, ring, isSeed });
      if (isSeed) {
        const seedling = this.habitat.seedling();
        seedling.position.copy(group.position);
        seedling.visible = false; this.seedlings.set(point.id, seedling); this.scene.add(seedling);
      }
    }
  }

  makeParticles() {
    const points = [];
    for (let i = 0; i < 150; i++) points.push(this.rand(-45, 45), this.rand(0.7, 14), this.rand(-110, 50));
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    this.motes = new THREE.Points(g, new THREE.PointsMaterial({ color: '#f6e9a6', size: 0.065, transparent: true, opacity: 0.7 })); this.scene.add(this.motes);
    const drops = [];
    for (let i = 0; i < 1800; i++) {
      const x = this.rand(-22, 22), y = this.rand(0, 24), z = this.rand(-22, 22);
      drops.push(x, y, z, x - 0.03, y - 0.5, z);
    }
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(drops, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: '#c4d9ce', transparent: true, opacity: 0.3 }));
    this.rain.visible = false; this.scene.add(this.rain);
  }

  setupControls() {
    window.addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); this.renderer.setPixelRatio(this.pixelRatio()); this.renderer.setSize(innerWidth, innerHeight);
    });
    window.addEventListener('keydown', event => {
      if (!this.active || this.paused || event.ctrlKey || event.metaKey || event.altKey || event.target.isContentEditable || event.target.closest?.('input,textarea,select')) return;
      if (event.target.closest?.('button') && event.code === 'Space') return;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault();
      this.keys.add(event.code);
    });
    window.addEventListener('keyup', event => this.keys.delete(event.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.dragging = false; this.touchMove = null; });
    this.canvas.addEventListener('pointerdown', event => {
      if (!this.active || this.paused) return;
      this.dragging = true; this.lastPointer = { x: event.clientX, y: event.clientY };
      this.canvas.setPointerCapture(event.pointerId);
    });
    this.canvas.addEventListener('pointermove', event => {
      if (!this.dragging || !this.lastPointer) return;
      this.yaw -= (event.clientX - this.lastPointer.x) * 0.0035;
      this.pitch = THREE.MathUtils.clamp(this.pitch - (event.clientY - this.lastPointer.y) * 0.003, -1.05, 1.05);
      this.lastPointer = { x: event.clientX, y: event.clientY };
    });
    const release = () => { this.dragging = false; this.lastPointer = null; };
    this.canvas.addEventListener('pointerup', release); this.canvas.addEventListener('pointercancel', release);
    this.canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); this.onUpdate?.({ error: '画面暂时中断，请刷新页面恢复；已记录的探索进度不会丢失。' }); });
  }

  setProgress(progress) {
    for (const marker of this.markers) {
      const done = marker.isSeed ? progress.planted.includes(marker.id) : progress.discovered.includes(marker.id);
      marker.gem.visible = !done; marker.ring.material.opacity = done ? 0.12 : 0.65;
    }
    for (const [id, mesh] of this.seedlings) mesh.visible = progress.planted.includes(id);
  }

  updateSky() {
    const sky = this.rainy ? this.rainySky : this.sunnySky;
    if (sky) this.scene.background = sky;
    else if (this.scene.background.isColor) this.scene.background.copy(this.scene.fog.color);
    this.scene.backgroundIntensity = this.rainy ? .45 : 1;
    this.scene.backgroundRotation.y = this.rainy ? 1.7 : -2.083;
  }

  setWeather(rainy) {
    this.rainy = rainy; this.rain.visible = rainy;
    if (rainy) this.moisture = 1;
    this.scene.fog.color.set(rainy ? '#65776d' : '#8ca18c');
    this.scene.fog.density = (rainy ? .007 : .0045) + this.moisture * .006;
    this.updateSky();
    this.scene.environmentIntensity = rainy ? .45 : .85;
    this.sun.intensity = rainy ? .75 : 3;
    this.sunRays.visible = !rainy && !this.lowDetail;
    this.waterMaterial.uniforms.fogColor.value.copy(this.scene.fog.color);
    this.waterMaterial.uniforms.rain.value = Number(rainy);
    this.ground.material.roughness = rainy ? .55 : .9;
    this.ground.material.envMapIntensity = rainy ? .4 : .22;
    this.ground.material.color.set(rainy ? '#a1aaa0' : '#ffffff');
    this.habitat.setWet(rainy);
  }

  travelTo(point) {
    const landmark = this.colliders.find(c => !c.parts && Math.hypot(point.x - c.x, point.z - c.z) < c.radius && c.radius > 1.5);
    const distance = Math.min(5, Math.max(4, (landmark?.radius ?? 0) * 2.7));
    this.position.set(point.x, 0, Math.min(BOUNDS.maxZ, point.z + distance)); this.yaw = 0; this.pitch = landmark ? 0.16 : -0.02;
    this.recoverPosition();
    this.notifyPosition();
  }

  resetPosition() { this.position.set(START.x, 0, START.z); this.yaw = -0.09; this.pitch = 0.035; this.notifyPosition(); }

  recoverPosition() {
    const free = (x, z) => {
      const floor = groundHeight(x, z);
      return !this.colliders.some(c => colliderContains(c, x, z, .4, floor));
    };
    if (free(this.position.x, this.position.z)) return;
    for (let radius = .5; radius <= 12; radius += .5) for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 12) {
      const x = this.position.x + Math.sin(angle) * radius, z = this.position.z + Math.cos(angle) * radius;
      if (x < BOUNDS.minX || x > Math.min(BOUNDS.maxX, riverX(z) - 5.3) || z < BOUNDS.minZ || z > BOUNDS.maxZ || !free(x, z)) continue;
      this.position.set(x, 0, z); return;
    }
    this.resetPosition();
  }

  notifyPosition() { this.onUpdate?.({ x: this.position.x, z: this.position.z, yaw: this.yaw, pitch: this.pitch, moving: false }); }

  targetDirection(point) {
    const angle = Math.atan2(-(point.x - this.position.x), -(point.z - this.position.z));
    const delta = Math.atan2(Math.sin(angle - this.yaw), Math.cos(angle - this.yaw));
    return Math.abs(delta) < 0.55 ? '' : delta > 0 ? '向左看 · ' : '向右看 · ';
  }

  animate = () => {
    requestAnimationFrame(this.animate);
    const delta = this.clock.getDelta();
    if (document.hidden) return;
    const dt = Math.min(delta, 0.75);
    this.elapsed += dt; const t = this.elapsed;
    if (!this.rainy && this.moisture > 0) this.moisture = Math.max(0, this.moisture - dt * 0.008);
    this.scene.fog.density = (this.rainy ? .007 : .0045) + this.moisture * .006;
    let moving = false;
    if (this.active && !this.paused) {
      const forward = (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) - (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0) + (this.touchMove?.y ?? 0);
      const side = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0) + (this.touchMove?.x ?? 0);
      if (this.keys.has('ArrowLeft')) this.yaw += dt * 1.3;
      if (this.keys.has('ArrowRight')) this.yaw -= dt * 1.3;
      const length = Math.max(1, Math.hypot(forward, side));
      const speed = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 8 : 4.3) * dt / length;
      const steps = Math.ceil(dt / 0.035);
      for (let step = 0; step < steps; step++) {
        const nx = this.position.x + (-Math.sin(this.yaw) * forward + Math.cos(this.yaw) * side) * speed / steps;
        const nz = this.position.z + (-Math.cos(this.yaw) * forward - Math.sin(this.yaw) * side) * speed / steps;
        const floor = groundHeight(nx, nz);
        const blocked = this.colliders.some(c => colliderContains(c, nx, nz, .4, floor));
        if (!blocked) {
          this.position.x = THREE.MathUtils.clamp(nx, BOUNDS.minX, Math.min(BOUNDS.maxX, riverX(nz) - 5.3));
          this.position.z = THREE.MathUtils.clamp(nz, BOUNDS.minZ, BOUNDS.maxZ);
        }
      }
      moving = !!(forward || side);
    }
    this.camera.position.set(this.position.x, groundHeight(this.position.x, this.position.z) + 1.85 + (moving ? Math.sin(t * 9) * 0.035 : Math.sin(t * 0.8) * 0.012), this.position.z);
    const introYaw = !this.active ? Math.sin(t * 0.09) * 0.075 : 0;
    this.camera.rotation.set(this.pitch, this.yaw + introYaw, 0, 'YXZ');
    this.waterMaterial.uniforms.time.value = t;
    this.motes.rotation.y = Math.sin(t * 0.05) * 0.03;
    if (this.rainy) { this.rain.position.set(this.position.x, -(t * 11 % 12), this.position.z); }
    for (const marker of this.markers) { marker.gem.position.y = (marker.isSeed ? 0.8 : 2.4) + Math.sin(t * 1.5 + marker.group.position.z) * 0.13; marker.gem.rotation.y = t * 0.5; }
    this.wildlife.update(t);
    if (!this.lastUpdate || t - this.lastUpdate > 0.12) {
      this.habitat.updateVisibility(this.camera.position);
      this.onUpdate?.({ x: this.position.x, z: this.position.z, yaw: this.yaw, pitch: this.pitch, moving }); this.lastUpdate = t;
    }
    if (!this.initializing) this.renderer.render(this.scene, this.camera);
  };
}
