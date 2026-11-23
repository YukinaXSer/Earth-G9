import './style.css';
import { Rainforest } from './world.js';
import { withTimeout } from './loading.js';
import { bindGraphicsRecovery, compatibilityUrl } from './graphics-recovery.js';
import { entranceGuidance } from './wayfinding.js';
import { SPECIES, PLANT_SITES, VIEWPOINTS, WALKING_ROUTES, FORDS, BOUNDS, mapProjection, START, nearestPoint, loadProgress, saveProgress, getCompletion, riverX, loadView, saveView, formatCoordinates, loadSettings, saveSettings } from './data.js';

const paths = {
  leaf: '<path d="M20 4C10 3 3 7 4 15c1 6 13 7 16-11Z"/><path d="m4 21 11-12M9 16v-5m3 2h5"/>',
  map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15"/>',
  book: '<path d="M12 5C8 2 4 3 2 4v15c4-2 7-1 10 1 3-2 6-3 10-1V4c-2-1-6-2-10 1Zm0 0v15"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  rain: '<path d="M7 15a5 5 0 1 1 9-5 3 3 0 1 1 1 6M8 16l-1 3m5-2-1 3m5-3-1 3"/>',
  sound: '<path d="M11 4 6 8H3v8h3l5 4V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  mute: '<path d="M11 4 6 8H3v8h3l5 4V4Zm5 5 5 6m0-6-5 6"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .6-1.5 1-1.5 2m0 3h.01"/>',
  camera: '<path d="M3 7h4l2-3h6l2 3h4v13H3V7Z"/><circle cx="12" cy="13" r="4"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="m8 4 12 8-12 8V4Z"/>',
  check: '<path d="m5 12 4 4L20 5"/>',
  pin: '<path d="M19 10c0 5-7 12-7 12S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
  fern: '<path d="M12 22V4m0 4L7 5m5 7L5 8m7 8-8-4m8 8-7-4m7-8 5-3m-5 7 7-4m-7 8 8-4m-8 8 7-4"/>',
  flower: '<path d="M12 22V9m0 6-6-3m6 7 6-4"/><path d="M12 11c-9-1-8-7-4-6 0-6 8-6 8 0 4-1 5 5-4 6Z"/>',
  butterfly: '<path d="M12 8c-8-12-16 7-2 5-12 8 0 15 2 2 2 13 14 6 2-2 14 2 6-17-2-5Zm0 0v9m0-9L9 4m3 4 3-4"/>',
  tree: '<path d="m12 2 8 10h-4l6 7H2l6-7H4L12 2Zm0 17v4"/>',
  mushroom: '<path d="M2 13a10 10 0 0 1 20 0H2Zm7 0-1 9h8l-1-9M8 8h.01M15 7h.01M12 10h.01"/>',
  sprout: '<path d="M12 22V12m0 3c-7 0-10-4-10-9 7-1 10 4 10 9Zm0-3c0-7 4-10 10-10 0 6-4 10-10 10Z"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-3 5-5 3 3-5 5-3Z"/>',
  reset: '<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7"/>',
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.leaf}</svg>`;
const app = document.querySelector('#app');
document.body.classList.toggle('touch-device', navigator.maxTouchPoints > 0);
app.innerHTML = `
  <header class="topbar">
    <a class="brand" href="/" aria-label="2 号地球首页"><span class="brand-symbol">${icon('leaf')}</span><span>EARTH <b>02</b><small>2 号地球</small></span></a>
    <nav class="nav" aria-label="世界导航"><button class="nav-link active" id="nav-world">雨林之境 <span>01</span></button><button class="nav-link" data-open="journal">自然图鉴 <span id="nav-count">0 / 5</span></button></nav>
    <div class="top-right"><span class="live-dot"></span><span class="world-status">原生世界 · 自由探索</span><button class="icon-button" id="pause" aria-label="暂停探索" title="暂停探索">${icon('pause')}</button></div>
  </header>

  <main>
    <section class="intro" id="intro" aria-label="欢迎来到雨林之境">
      <div class="eyebrow"><span></span> 一颗星球，重新呼吸</div>
      <h1>雨林之境<span>在这里，与万物共生。</span></h1>
      <p class="intro-description">把喧嚣留在世界之外。<br>沿着水声，走进一片自由生长的原生雨林。<br>发现微小的生命，也种下属于你的新生。</p>
      <button class="primary-button" id="enter"><span>进入 2 号地球</span>${icon('arrow')}</button>
      <button class="text-button entry-trail hidden" id="enter-trail">从入口沿小径出发（保留进度）</button>
      <div class="entry-note">无需安装 <i>·</i> 3D 自由漫游 <i>·</i> 进度自动保存</div>
      <p class="entry-guide">目标：记录 5 种生命，种下 3 株幼苗。<br>WASD / 摇杆移动 · 拖动环顾 · 滚轮 / 双指缩放<br>靠近光标按 E / 点按互动</p>
    </section>
    <div class="intro-aside" id="intro-aside"><span>让自然，做回自然。</span><small>THE FOREST IS ALIVE</small><div class="aside-line"></div><b>01°</b></div>
    <section class="mission compact hidden" id="mission" aria-label="探索任务">
      <button id="toggle-mission" aria-expanded="false" aria-label="展开探索任务">${icon('book')}<span id="mission-summary">探索 0 / 8</span><span>⌄</span></button>
      <div class="eyebrow">你的雨林手记 <span id="completion">0%</span></div>
      <h2>慢一点，发现更多。</h2>
      <div class="mission-row">${icon('leaf')}<span>认识雨林中的生命</span><b id="discover-count">0 / 5</b></div>
      <div class="mission-row">${icon('sprout')}<span>种下三株原生树苗</span><b id="plant-count">0 / 3</b></div>
      <div class="progress-track"><div id="progress-fill"></div></div>
      <p id="mission-hint">沿着林间小径，寻找微微发光的标记。</p>
    </section>
    <div class="crosshair hidden" id="crosshair" aria-hidden="true"></div>
    <section class="trail-guide hidden" id="trail-guide" aria-label="入口步行路线指引">
      <span class="trail-bearing" aria-hidden="true">${icon('arrow')}</span>
      <div><strong>走出溪谷入口</strong><p id="trail-direction"></p><small id="trail-description">沿土色小径，绕过右侧主榕</small></div>
      <button class="icon-button" data-open="map" aria-label="查看步道地图">${icon('map')}</button>
    </section>
    <div class="zoom-controls hidden" id="zoom-controls" role="group" aria-label="场景视野缩放">
      <button id="zoom-out" aria-label="拉远视野" title="拉远视野 · −">−</button>
      <button id="zoom-reset" aria-label="恢复默认视野" title="恢复默认视野 · 0">1×</button>
      <button id="zoom-in" aria-label="拉近视野" title="拉近视野 · +">+</button>
    </div>
    <div class="game-notices">
      <div class="toast hidden" id="toast" role="status" aria-live="polite"></div>
      <button class="interaction hidden" id="interact"><span class="keycap">E</span><span id="interaction-label"></span>${icon('arrow')}</button>
    </div>
    <div class="touch-controls hidden" id="touch-controls"><div class="joystick" id="joystick" aria-label="拖动摇杆移动"><div id="joystick-knob"></div></div><span>左侧移动 · 右侧拖动视角</span></div>
  </main>

  <footer class="bottom-bar">
    <div class="location">${icon('pin')}<div><strong>原生雨林 <span>· 溪谷入口</span></strong><small id="coordinates">00.0 N &nbsp; 00.0 E</small></div></div>
    <div class="intro-footer" id="intro-footer"><span class="tiny-line"></span> 不是征服自然，而是成为自然的一部分。</div>
    <div class="game-hint hidden" id="game-hint"><kbd>W A S D</kbd> 移动 <span>·</span> 拖动环顾 <span>·</span> <kbd>E</kbd> 互动</div>
    <div class="toolbar" aria-label="探索工具">
      <button class="tool-button" data-open="map" title="雨林地图 · M">${icon('map')}<span>地图</span></button>
      <button class="tool-button" data-open="journal" title="自然图鉴 · J">${icon('book')}<span>图鉴</span></button>
      <div class="tool-divider"></div>
      <button class="tool-button" id="weather" title="切换晴天与雨天" aria-label="天气：晴天" aria-pressed="false">${icon('sun')}<span>晴天</span></button>
      <button class="tool-button" id="audio" title="开启森林环境声" aria-label="开启环境声" aria-pressed="false">${icon('mute')}<span>声音</span></button>
      <button class="tool-button" id="photo" title="保存风景照片 · P">${icon('camera')}<span>拍照</span></button>
      <button class="icon-button" data-open="help" title="操作说明" aria-label="操作说明">${icon('help')}</button>
    </div>
  </footer>
  <div class="modal-overlay hidden" id="modal-overlay"><section class="modal" id="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1"></section></div>
  <div class="loading" id="loading" role="status" aria-busy="true"><span class="brand-symbol">${icon('leaf')}</span><p id="loading-phase">正在载入雨林素材…</p><progress id="loading-progress" aria-label="雨林素材加载进度"></progress><small id="loading-detail" aria-live="polite">首次进入需要下载真实扫描与植被素材。</small><button class="text-button hidden" id="loading-low">网络或设备响应较慢？使用流畅模式重试</button></div>
`;

let storage;
try { storage = window.localStorage; } catch { storage = { getItem: () => null, setItem: () => { throw new Error('storage unavailable'); } }; }
let progress = loadProgress(storage);
let savedView = loadView(storage), lastViewSave = 0;
const settings = loadSettings(storage);
let world, entered = false, currentPoint = null, modalType = null, previousFocus = null, toastTimer, audioContext, birdTimer, navigationTarget = null;
let riverGain, rainGain;
let lastPosition = { ...START, yaw: 0 };
const $ = selector => document.querySelector(selector);
const show = (selector, visible) => $(selector).classList.toggle('hidden', !visible);

function toast(message) {
  $('#toast').textContent = message; show('#toast', true);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => show('#toast', false), 4200);
}

function syncProgress() {
  $('#enter span').textContent = savedView || getCompletion(progress) ? '继续探索雨林' : '进入 2 号地球';
  show('#enter-trail', !!savedView);
  $('#mission-summary').textContent = `探索 ${progress.discovered.length + progress.planted.length} / 8`;
  $('#nav-count').textContent = `${progress.discovered.length} / 5`;
  $('#discover-count').textContent = `${progress.discovered.length} / 5`;
  $('#plant-count').textContent = `${progress.planted.length} / 3`;
  $('#completion').textContent = `${getCompletion(progress)}%`;
  $('#progress-fill').style.width = `${getCompletion(progress)}%`;
  if (getCompletion(progress) === 100) $('#mission-hint').textContent = '雨林守护者，谢谢你留下的每一份新生。';
  else $('#mission-hint').textContent = '沿着林间小径，寻找微微发光的标记。';
  world?.setProgress(progress);
}

function commitProgress() {
  if (!saveProgress(storage, progress)) toast('浏览器未允许保存进度，本次探索仍可继续。');
  syncProgress();
}

function enterWorld() {
  if (!world) return;
  if (!entered && savedView) {
    world.position.set(savedView.x, 0, savedView.z); world.yaw = savedView.yaw; world.pitch = savedView.pitch;
    world.recoverPosition();
  }
  entered = true; world.active = true;
  if (settings.sound) setAudio(true, false);
  ['#intro', '#intro-aside', '#intro-footer'].forEach(s => show(s, false));
  ['#mission', '#crosshair', '#game-hint', '#touch-controls', '#zoom-controls'].forEach(s => show(s, true));
  document.body.classList.add('exploring');
  world.canvas.focus({ preventScroll: true });
  updateTrailGuide();
  toast(savedView ? '继续上次的旅程。按 M 查看地图与目的地。' : '先跟随上方箭头，沿土色小径走出入口。左侧蕨丛可按 E 观察。');
}

function updateTrailGuide() {
  const guidance = entranceGuidance(lastPosition);
  show('#trail-guide', entered && !modalType && !world?.paused && !!guidance);
  if (!guidance) return;
  $('.trail-bearing').style.transform = `rotate(${guidance.angle - Math.PI / 2}rad)`;
  $('#trail-direction').textContent = guidance.onPath ? `${guidance.direction} · 距蕨影小径约${guidance.remaining}米` : `${guidance.direction} · 先回到土色小径`;
  $('#trail-description').textContent = lastPosition.z > 20 ? '沿土色小径，绕过右侧主榕' : '继续沿土色小径，按 M 查看全图';
}

function updatePosition(position) {
  if (position.error) { toast(position.error); return; }
  lastPosition = position;
  updateTrailGuide();
  updateSoundscape();
  if (entered && performance.now() - lastViewSave > 1000) {
    saveView(storage, { x: position.x, z: position.z, yaw: position.yaw, pitch: position.pitch }); lastViewSave = performance.now();
  }
  $('#coordinates').textContent = formatCoordinates(position);
  const nearbyView = nearestPoint(position, VIEWPOINTS, 35);
  const region = nearbyView?.name ?? (position.x > riverX(position.z) + 8 ? '东岸雨林' : position.x < -60 ? '西部密林' : position.z < -125 ? '北部林冠' : position.z > 85 ? '南溪岸林' : position.z > 5 ? '溪谷入口' : position.z > -40 ? '蕨影小径' : position.z > -75 ? '巨木深处' : '新生林地');
  if (navigationTarget && Math.hypot(position.x - navigationTarget.x, position.z - navigationTarget.z) < 6) {
    toast(`已到达${navigationTarget.name}。按 E 欣赏风景，按 P 留下照片。`); navigationTarget = null;
  }
  $('.location strong span').textContent = navigationTarget ? `· ${world.targetDirection(navigationTarget)}${navigationTarget.name} ${Math.ceil(Math.hypot(position.x - navigationTarget.x, position.z - navigationTarget.z))}米` : `· ${region}`;
  const points = [
    ...SPECIES.map(s => ({ ...s, kind: 'species' })),
    ...PLANT_SITES.filter(s => !progress.planted.includes(s.id)).map(s => ({ ...s, kind: 'plant' })),
    ...VIEWPOINTS.map(s => ({ ...s, kind: 'viewpoint' })),
  ];
  currentPoint = entered && !modalType && !world?.paused ? nearestPoint(position, points) : null;
  show('#interact', !!currentPoint);
  if (currentPoint) $('#interaction-label').textContent = world.targetDirection(currentPoint) + (currentPoint.kind === 'plant' ? '种下一株新生' : currentPoint.kind === 'viewpoint' ? `欣赏 · ${currentPoint.name}` : `${progress.discovered.includes(currentPoint.id) ? '再次观察' : '观察'} · ${currentPoint.name}`);
  if (modalType === 'map') drawMap();
}

function interact() {
  if (!currentPoint || modalType || !world || world.paused) return;
  if (currentPoint.kind === 'plant') {
    progress.planted.push(currentPoint.id); commitProgress();
    toast(`一株新生，已经扎根。已种下 ${progress.planted.length} / 3 株树苗。`);
    currentPoint = null; show('#interact', false);
    if (getCompletion(progress) === 100) setTimeout(() => openModal('complete'), 900);
  } else if (currentPoint.kind === 'viewpoint') {
    openModal('viewpoint', currentPoint);
  } else {
    const species = SPECIES.find(s => s.id === currentPoint.id);
    if (!progress.discovered.includes(species.id)) { progress.discovered.push(species.id); commitProgress(); }
    openModal('species', species);
  }
}

const modalHeader = (eyebrow, title, subtitle = '') => `<div class="modal-top"><span class="eyebrow">${eyebrow}</span><button class="icon-button close-modal" aria-label="关闭窗口">${icon('close')}</button></div><h2 id="modal-title">${title}</h2>${subtitle ? `<p class="modal-subtitle">${subtitle}</p>` : ''}`;

function openModal(type, data) {
  if (!world || world.contextFailed) return;
  if (modalType) { closeModal(false); }
  previousFocus = document.activeElement;
  modalType = type; world.paused = true; world.keys.clear(); world.touchMove = null; world.cancelLook();
  show('#interact', false);
  const modal = $('#modal');
  modal.className = `modal modal-${type}`;
  if (type === 'journal') {
    modal.innerHTML = modalHeader('FIELD NOTES / 自然图鉴', '每一种生命，都值得被看见。', `已记录 ${progress.discovered.length} 种生命 · 点击已发现的物种，重温雨林故事。`) +
      `<div class="species-grid">${SPECIES.map(s => {
        const found = progress.discovered.includes(s.id);
        return `<button class="species-card ${found ? 'found' : 'locked'}" data-species="${s.id}" ${found ? '' : 'disabled'}><span class="species-number">${s.mark}</span><div class="species-art art-${s.id}">${icon(s.icon)}</div><small>${found ? s.type : '等待你的发现'}</small><h3>${found ? s.name : '未知的生命'}</h3><em>${found ? s.latin : '沿着小径，走近自然'}</em><span class="card-state">${found ? `${icon('check')} 已记录` : '尚未发现'}</span></button>`;
      }).join('')}</div><div class="journal-footer">${icon('sprout')} 你已种下 ${progress.planted.length} 株树苗。每一株，都让未来多一片绿荫。</div>`;
  } else if (type === 'species') {
    modal.innerHTML = modalHeader(`自然图鉴 / ${data.mark}`, data.name, data.latin) +
      `<div class="species-detail-art art-${data.id}">${icon(data.icon)}<span>${data.type}</span></div><p class="species-description">${data.description}</p><div class="field-tip">${icon('compass')}<span>${data.fact}</span></div><div class="species-detail-footer"><span>${icon('check')} 已收入自然图鉴</span><button class="primary-button close-modal">继续探索 ${icon('arrow')}</button></div>`;
  } else if (type === 'map') {
    modal.innerHTML = modalHeader('RAINFOREST ATLAS / 雨林地图', '跟随好奇心，向森林深处。', `${BOUNDS.maxX - BOUNDS.minX} × ${BOUNDS.maxZ - BOUNDS.minZ}米。新区域设为目标后步行探索，跨溪走浅滩；原林地物种仍可直接前往。`) +
      `<div class="map-layout"><div class="map-canvas-wrap"><canvas id="map-canvas" width="540" height="560" aria-label="雨林地图：圆点为物种，金色小点为种植地点，箭头为当前位置"></canvas><span class="map-north">N ↑</span><div class="map-legend"><span><i></i>生命印记</span><span><i class="gold"></i>新生林地</span></div></div><div class="map-places"><h3>林间目的地</h3>${SPECIES.map(s => `<button class="map-place" data-travel="${s.id}"><span>${s.mark}</span><div><strong>${s.name}</strong><small>${progress.discovered.includes(s.id) ? '已记录的生命' : '有待发现'}</small></div>${icon('arrow')}</button>`).join('')}<div class="map-seed-sites">${PLANT_SITES.map((s, i) => `<button data-travel="${s.id}" title="前往${s.name}">${icon(progress.planted.includes(s.id) ? 'check' : 'sprout')} 苗圃 ${i + 1}</button>`).join('')}</div><button class="text-button" id="return-start">${icon('reset')} 返回溪谷入口</button></div></div>`;
    modal.querySelector('.map-places').insertAdjacentHTML('afterbegin', `<h3>步行探索新区域</h3>${VIEWPOINTS.map(s => `<button class="map-place" data-guide="${s.id}"><span>${icon('compass')}</span><div><strong>${s.name}</strong><small>设为步行目标 · ${Math.round(Math.hypot(lastPosition.x - s.x, lastPosition.z - s.z))}米</small></div>${icon('arrow')}</button>`).join('')}`);
    modal.querySelector('.map-legend').insertAdjacentHTML('beforeend', '<span><i class="landscape"></i>步行风景点</span>');
  } else if (type === 'viewpoint') {
    modal.innerHTML = modalHeader('FOREST WALK / 林间风景', data.name, '步行深入森林，看见不同的层次。') + `<div class="species-detail-art">${icon('compass')}</div><p class="species-description">${data.description}</p><div class="field-tip">${icon('map')}<span>按 M 查看连通步道与两处浅滩，按 P 保存实机风景。风景点不会更改物种和种植记录。</span></div><button class="primary-button close-modal">继续步行 ${icon('arrow')}</button>`;
  } else if (type === 'help') {
    modal.innerHTML = modalHeader('A QUIET ADVENTURE / 漫游指南', '不必赶路，森林会等你。') +
      `<div class="help-grid"><div><kbd>W A S D</kbd><h3>自由移动</h3><p>或使用方向键。按住 Shift 快步前行。</p></div><div>${icon('compass')}<h3>环顾四周</h3><p>按住鼠标拖动。手机上拖动画面，使用左下角摇杆移动。</p></div><div><kbd>E</kbd><h3>观察与种植</h3><p>靠近发光标记，按 E 或点击提示，记录物种或种下树苗。</p></div><div>${icon('map')}<h3>找到你的方向</h3><p>M 打开地图，J 打开图鉴，P 拍照，Esc 关闭窗口或暂停。</p></div></div><div class="help-note">目标：记录 5 种生命，种下 3 株幼苗。这是使用授权模型、实拍材质与扫描素材的单人 3D 雨林原型，不是完整地点的复原；环境声为合成声景。进度和位置只保存在当前浏览器。<br><a href="/ASSET-CREDITS.txt" target="_blank" rel="noopener">素材来源与许可</a></div><div class="help-actions"><button class="text-button" id="reset-progress">重新开始探索</button><button class="text-button" data-open="feedback">反馈与建议</button></div>`;
    modal.innerHTML += `<div class="help-note"><strong>林间动物观察</strong><p>入口小径左侧的枯枝上有绿鬣蜥。小径上可近看金色箭毒蛙和华丽锯颚天牛，溪岸有淡水蟹。它们可自由观赏，不计入原有五项图鉴任务。</p><p>动物为真实标本或活体扫描，采用简化的整体位移动作，不是骨骼动画。</p></div>`;
  } else if (type === 'feedback') {
    modal.innerHTML = modalHeader('反馈与建议', '让这片森林继续生长。', '无需登录。写下遇到的问题，下载后交给分享游戏的人；这里不会自动发送或收集你的信息。') + `<label for="feedback-text">你的建议</label><textarea id="feedback-text" rows="6" maxlength="3000" placeholder="你遇到了什么？在哪个位置？希望怎样改进？"></textarea><button class="primary-button" id="download-feedback">下载反馈文本 ${icon('arrow')}</button><p id="feedback-status" role="status"></p>`;
  } else if (type === 'pause') {
    modal.innerHTML = modalHeader('TAKE A BREATH / 休息一下', '听，雨林还在呼吸。', '探索已暂停。你的发现已经保存在当前浏览器。') + `<button class="primary-button close-modal">继续探索 ${icon('play')}</button><button class="text-button" id="pause-map">打开地图</button>`;
  } else if (type === 'reset') {
    modal.innerHTML = modalHeader('重新出发', '重新开始这段旅程？', '将清空当前浏览器的物种记录和种植进度，此操作无法撤销。') + `<div class="confirm-actions"><button class="text-button close-modal">保留我的发现</button><button class="primary-button" id="confirm-reset">重新开始</button></div>`;
  } else if (type === 'complete') {
    modal.innerHTML = modalHeader('FOREST GUARDIAN / 雨林守护者', '你留下的，是一片未来。', '五种生命已被记录，三株幼苗已经扎根。这里没有终点，你随时可以回来，听听雨，看看树。') + `<div class="complete-emblem">${icon('sprout')}</div><button class="primary-button close-modal">继续在林间漫游 ${icon('arrow')}</button>`;
  }
  show('#modal-overlay', true);
  modal.focus({ preventScroll: true });
  if (type === 'map') drawMap();
}

function closeModal(restore = true) {
  modalType = null; show('#modal-overlay', false);
  if (world) { world.paused = false; world.keys.clear(); }
  if (restore) (entered ? world?.canvas : previousFocus)?.focus({ preventScroll: true });
}

function drawMap() {
  const canvas = $('#map-canvas'); if (!canvas) return;
  const ctx = canvas.getContext('2d'); const w = canvas.width, h = canvas.height;
  const { project, scale } = mapProjection(w, h);
  ctx.fillStyle = '#e3e6d5'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#c9d0b9'; ctx.lineWidth = 1;
  for (let i = 0; i < 25; i++) {
    ctx.beginPath();
    for (let j = 0; j <= 50; j++) { const x = j / 50 * w, y = i * 27 + Math.sin(j * 0.2 + i * 0.8) * 12; j ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke();
  }
  ctx.strokeStyle = '#99b9aa'; ctx.lineWidth = 14 * scale; ctx.lineCap = 'round'; ctx.beginPath();
  for (let z = BOUNDS.minZ; z <= BOUNDS.maxZ; z += 2) { const p = project(riverX(z), z); z === BOUNDS.minZ ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y); } ctx.stroke();
  ctx.strokeStyle = '#a7ab88'; ctx.lineWidth = 2; ctx.setLineDash([3, 5]);
  for (const route of WALKING_ROUTES) {
    ctx.beginPath(); route.points.forEach(([x, z], i) => { const p = project(x, z); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.stroke();
  }
  ctx.setLineDash([]); ctx.textAlign = 'left'; ctx.font = '11px "Rainforest Sans", sans-serif';
  for (const ford of FORDS) {
    const p = project(riverX(ford.z), ford.z); ctx.fillStyle = '#e5dec0'; ctx.fillRect(p.x - 10 * scale, p.y - 3, 20 * scale, 6);
    ctx.fillStyle = '#486357'; ctx.fillText(ford.name, p.x + 15, p.y + 4);
  }
  for (const s of VIEWPOINTS) {
    const p = project(s.x, s.z); ctx.strokeStyle = '#62764d'; ctx.lineWidth = navigationTarget?.id === s.id ? 3 : 1.5;
    ctx.strokeRect(p.x - 5, p.y - 5, 10, 10); ctx.fillStyle = '#3c513b';
    ctx.textAlign = s.x > 70 ? 'right' : 'left'; ctx.fillText(s.name, p.x + (s.x > 70 ? -12 : 12), p.y - 8);
  }
  ctx.font = '11px "Rainforest Sans", sans-serif'; ctx.textAlign = 'center';
  for (const s of SPECIES) {
    const p = project(s.x, s.z); ctx.fillStyle = progress.discovered.includes(s.id) ? '#426849' : '#6a8759';
    ctx.beginPath(); ctx.arc(p.x, p.y, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fffced'; ctx.fillText(s.mark, p.x, p.y + 4);
  }
  for (const s of PLANT_SITES) { const p = project(s.x, s.z); ctx.fillStyle = progress.planted.includes(s.id) ? '#8da672' : '#b48c42'; ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill(); }
  const p = project(lastPosition.x, lastPosition.z);
  ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(-lastPosition.yaw); ctx.fillStyle = '#1c4b40'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(-8, 9); ctx.lineTo(0, 5); ctx.lineTo(8, 9); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  const start = project(START.x, START.z); ctx.fillStyle = '#58664e'; ctx.font = '12px "Rainforest Sans", sans-serif'; ctx.fillText('溪谷入口', start.x, start.y + 24);
}

function syncAudio() {
  const pending = settings.sound && audioContext?.state !== 'running';
  $('#audio').innerHTML = `${icon(settings.sound ? 'sound' : 'mute')}<span>${pending ? '待播放' : settings.sound ? '有声' : '声音'}</span>`;
  $('#audio').setAttribute('aria-pressed', String(settings.sound));
  $('#audio').setAttribute('aria-label', pending ? '有声设置已记住，进入雨林后恢复播放' : settings.sound ? '关闭环境声' : '开启环境声');
}

async function setAudio(enabled, announce = true) {
  try {
    if (enabled && !audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const buffer = audioContext.createBuffer(1, audioContext.sampleRate * 3, audioContext.sampleRate);
      const values = buffer.getChannelData(0); let last = 0;
      for (let i = 0; i < values.length; i++) { last = (last + (Math.random() * 2 - 1) * 0.02) / 1.02; values[i] = last * 3; }
      const noise = audioContext.createBufferSource(); noise.buffer = buffer; noise.loop = true;
      const filter = audioContext.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 1000;
      riverGain = audioContext.createGain(); riverGain.gain.value = 0.08;
      noise.connect(filter).connect(riverGain).connect(audioContext.destination); noise.start();
      const rainBuffer = audioContext.createBuffer(1, audioContext.sampleRate * 7, audioContext.sampleRate);
      const rainValues = rainBuffer.getChannelData(0);
      for (let i = 0; i < rainValues.length; i++) rainValues[i] = Math.random() * 2 - 1;
      const rainSource = audioContext.createBufferSource(); rainSource.buffer = rainBuffer; rainSource.loop = true;
      const rainFilter = audioContext.createBiquadFilter(); rainFilter.type = 'lowpass'; rainFilter.frequency.value = 2800;
      rainGain = audioContext.createGain(); rainGain.gain.value = 0;
      rainSource.connect(rainFilter).connect(rainGain).connect(audioContext.destination); rainSource.start();
      updateSoundscape();
      birdTimer = setInterval(() => {
        if (audioContext.state !== 'running' || Math.random() < (world?.rainy ? 0.85 : 0.2)) return;
        const start = audioContext.currentTime, oscillator = audioContext.createOscillator(), volume = audioContext.createGain();
        oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(1600 + Math.random() * 900, start);
        oscillator.frequency.exponentialRampToValueAtTime(2800, start + 0.09); oscillator.frequency.exponentialRampToValueAtTime(1700, start + 0.28);
        volume.gain.setValueAtTime(0, start); volume.gain.linearRampToValueAtTime(0.018, start + 0.04); volume.gain.exponentialRampToValueAtTime(0.001, start + 0.35);
        oscillator.connect(volume).connect(audioContext.destination); oscillator.start(); oscillator.stop(start + 0.4);
        oscillator.onended = () => { oscillator.disconnect(); volume.disconnect(); };
      }, 3200);
    }
    if (audioContext) {
      if (enabled) await audioContext.resume(); else await audioContext.suspend();
    }
    settings.sound = enabled;
    saveSettings(storage, settings);
    syncAudio();
    if (announce) toast(enabled ? '合成声景已开启 · 溪流随距离变化，雨天加入雨声' : '环境声已关闭');
  } catch { toast('此浏览器暂不支持环境声，仍可继续探索。'); }
}

function applyWeather(rainy) {
  settings.rainy = rainy;
  world.setWeather(rainy);
  const button = $('#weather');
  button.innerHTML = `${icon(rainy ? 'rain' : 'sun')}<span>${rainy ? '雨天' : '晴天'}</span>`;
  button.setAttribute('aria-pressed', String(rainy));
  button.setAttribute('aria-label', `天气：${rainy ? '雨天' : '晴天'}`);
  updateSoundscape();
}

function updateSoundscape() {
  if (!riverGain || !rainGain) return;
  const distance = Math.abs(lastPosition.x - riverX(lastPosition.z));
  riverGain.gain.setTargetAtTime(0.04 + 0.2 * Math.exp(-distance / 12), audioContext.currentTime, 0.4);
  rainGain.gain.setTargetAtTime(world?.rainy ? 0.16 : 0, audioContext.currentTime, 0.5);
}

function takePhoto() {
  if (!world) return;
  world.renderer.render(world.scene, world.camera);
  world.canvas.toBlob(blob => {
    if (!blob) { toast('照片保存失败，请稍后重试。'); return; }
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = `2号地球-雨林-${Date.now()}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 3000);
    toast('这一刻的雨林，已保存为照片。');
  }, 'image/png');
}

app.addEventListener('click', event => {
  const button = event.target.closest('button'); if (!button) return;
  if (button.classList.contains('close-modal')) { closeModal(); return; }
  if (button.dataset.open) { openModal(button.dataset.open); return; }
  if (button.dataset.species) { openModal('species', SPECIES.find(s => s.id === button.dataset.species)); return; }
  if (button.dataset.guide) {
    navigationTarget = VIEWPOINTS.find(s => s.id === button.dataset.guide);
    if (!entered) enterWorld(); closeModal();
    toast(`已标记${navigationTarget.name}，沿地图虚线步行前往；跨溪走浅滩。`); return;
  }
  if (button.dataset.travel) {
    navigationTarget = null;
    const point = [...SPECIES, ...PLANT_SITES].find(s => s.id === button.dataset.travel);
    if (!entered) enterWorld(); world.travelTo(point); closeModal(); toast(`已来到${point.name}附近，向前走几步即可互动。`); return;
  }
  switch (button.id) {
    case 'toggle-mission': {
      const compact = $('#mission').classList.toggle('compact'); button.setAttribute('aria-expanded', String(!compact)); button.setAttribute('aria-label', compact ? '展开探索任务' : '收起探索任务'); break;
    }
    case 'download-feedback': {
      const feedback = $('#feedback-text').value.trim();
      if (!feedback) { $('#feedback-status').textContent = '请先写下你的建议。'; $('#feedback-text').focus(); break; }
      const blob = new Blob([`2号地球 · 雨林反馈\n位置：${lastPosition.x.toFixed(1)}, ${lastPosition.z.toFixed(1)}\n\n${feedback}`], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = '雨林反馈.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 3000); $('#feedback-status').textContent = '反馈已下载；请把文本文件交给分享游戏的人。'; break;
    }
    case 'enter': enterWorld(); break;
    case 'enter-trail': enterWorld(); navigationTarget = null; world.resetPosition(); break;
    case 'zoom-in': world.zoomView(.85); break;
    case 'zoom-out': world.zoomView(1 / .85); break;
    case 'zoom-reset': world.resetZoom(); break;
    case 'nav-world': if (modalType) closeModal(); if (entered) toast('你正置身于雨林之境。按 M 打开地图。'); break;
    case 'interact': interact(); break;
    case 'weather': {
      if (!world) return;
      applyWeather(!world.rainy);
      saveSettings(storage, settings);
      toast(world.rainy ? '一场温柔的雨，落进森林。' : '云层散开，阳光重新照进林间。'); break;
    }
    case 'audio': setAudio(!settings.sound); break;
    case 'photo': takePhoto(); break;
    case 'pause': modalType ? closeModal() : openModal('pause'); break;
    case 'pause-map': openModal('map'); break;
    case 'return-start': navigationTarget = null; world.resetPosition(); closeModal(); toast('已回到溪谷入口。'); break;
    case 'reset-progress': openModal('reset'); break;
    case 'confirm-reset': navigationTarget = null; savedView = null; saveView(storage, null); progress = { discovered: [], planted: [] }; commitProgress(); world.resetPosition(); closeModal(); toast('全新的一页，写给这片雨林。'); break;
  }
});

$('#modal-overlay').addEventListener('click', event => { if (event.target === $('#modal-overlay')) closeModal(); });
document.addEventListener('keydown', event => {
  if (world?.contextFailed) return;
  if (event.repeat) return;
  if (event.target.closest('textarea,input') && event.code !== 'Escape' && event.code !== 'Tab') return;
  if (event.code === 'Escape') { modalType ? closeModal() : entered && openModal('pause'); }
  if (event.code === 'KeyE' && !modalType) interact();
  if (event.code === 'KeyM') { event.preventDefault(); modalType === 'map' ? closeModal() : openModal('map'); }
  if (event.code === 'KeyJ') { event.preventDefault(); modalType === 'journal' ? closeModal() : openModal('journal'); }
  if (event.code === 'KeyP' && !modalType) takePhoto();
  if (event.code === 'Tab' && modalType) {
    const focusable = [...$('#modal').querySelectorAll('button:not([disabled]), a[href], textarea')];
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === $('#modal'))) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === $('#modal'))) { event.preventDefault(); first?.focus(); }
  }
});

const joystick = $('#joystick');
function moveJoystick(event) {
  if (!world || modalType) return;
  const rect = joystick.getBoundingClientRect();
  let x = (event.clientX - rect.left - rect.width / 2) / 35, y = (event.clientY - rect.top - rect.height / 2) / 35;
  const length = Math.max(1, Math.hypot(x, y)); x /= length; y /= length;
  world.touchMove = { x, y: -y }; $('#joystick-knob').style.transform = `translate(${x * 27}px, ${y * 27}px)`;
}
joystick.addEventListener('pointerdown', event => { joystick.setPointerCapture(event.pointerId); moveJoystick(event); });
joystick.addEventListener('pointermove', event => { if (joystick.hasPointerCapture(event.pointerId)) moveJoystick(event); });
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) joystick.addEventListener(name, () => { if (world) world.touchMove = null; $('#joystick-knob').style.transform = ''; });
window.addEventListener('pagehide', () => { if (entered) saveView(storage, { x: lastPosition.x, z: lastPosition.z, yaw: lastPosition.yaw, pitch: lastPosition.pitch }); audioContext?.suspend(); });

syncProgress();
syncAudio();
setTimeout(async () => {
  const lowQuality = () => { const url = new URL(location.href); url.searchParams.set('quality', 'low'); location.assign(url); };
  const showFailure = () => {
    clearTimeout(slowTimer);
    if (modalType) closeModal(false);
    if (world) { world.contextFailed = true; world.active = false; world.paused = true; world.keys.clear(); world.touchMove = null; world.dragging = false; }
    show('#loading', true);
    $('#loading').setAttribute('aria-busy', 'false');
    $('#loading').innerHTML = `${icon('leaf')}<h2>雨林暂时未能载入</h2><p>网络或设备准备耗时过长，或某个素材未能下载。</p><small>你的探索存档仍然保留。请检查网络后重试，也可选择流畅模式。</small><button class="primary-button" id="retry">重新加载</button><button class="text-button" id="retry-low">使用流畅模式重试</button>`;
    $('#retry').addEventListener('click', () => location.reload());
    $('#retry-low').addEventListener('click', lowQuality);
    $('#retry').focus({ preventScroll: true });
  };
  $('#loading-low').addEventListener('click', lowQuality);
  const slowTimer = setTimeout(() => show('#loading-low', true), 15000);
  try {
    world = new Rainforest($('#world'), updatePosition, state => {
      const phase = $('#loading-phase'); if (!phase) return;
      const meter = $('#loading-progress');
      if (state.phase === 'download') {
        phase.textContent = '正在载入雨林素材…';
        $('#loading-detail').textContent = `已完成 ${state.loaded} / ${state.total} 项资源，首次进入请稍候。`;
        meter.max = state.total || 1; meter.value = state.loaded;
      } else {
        phase.textContent = state.phase === 'compose' ? '正在布置森林…' : '正在准备首帧画面…';
        $('#loading-detail').textContent = '素材已载入，正在为你的设备准备三维场景。';
        meter.removeAttribute('value');
      }
    });
    bindGraphicsRecovery(world.canvas, {
      lowDetail: world.lowDetail,
      pause: () => {
        world.contextFailed = true; world.active = false; world.paused = true;
        world.keys.clear(); world.touchMove = null; world.cancelLook();
      },
      fallback: () => location.replace(compatibilityUrl(location.href)),
      failure: showFailure,
    });
    await withTimeout(world.ready, 90000);
    if (world.contextFailed) return;
    applyWeather(settings.rainy);
    world.setProgress(progress);
    $('#loading').setAttribute('aria-busy', 'false');
    show('#loading', false);
    if (new URLSearchParams(location.search).get('recovered') === '1') toast('已使用流畅模式，探索存档仍然保留。');
  } catch (error) {
    console.error('Rainforest initialization failed:', error);
    showFailure();
  } finally { clearTimeout(slowTimer); }
}, 100);
