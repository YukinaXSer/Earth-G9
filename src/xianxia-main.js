import './xianxia.css';
import { XianxiaDemoRuntime } from './xianxia-demo-runtime.js';
import { groundHeight,BOUNDS } from './data.js';
import { XianxiaLink } from './xianxia-link.js';
import { withTimeout } from './loading.js';
import {MOUNTAIN_ENTRANCE} from './xianxia-mountain.js';
import {LOCATIONS as STORIES,routeLength} from './xianxia-route.js';
import {mountainRoute,mountainRoutePoint} from './xianxia-mountain-route.js';

const TRAIL=mountainRoute();
const BRANCH=[],CAVE=[];
const LOCATIONS=STORIES.map((p,i)=>({...p,point:mountainRoutePoint(TRAIL,i/(STORIES.length-1))}));
const nearestLocation=(x,z)=>LOCATIONS.find(p=>Math.hypot(x-p.point[0],z-p.point[2])<6);
const regionLabel=()=> '青岚山径';

const $=s=>document.querySelector(s),STORE='earth2.xianxia.v1';
const mountainIcon='<svg viewBox="0 0 48 40" fill="none" aria-hidden="true"><path d="m3 33 12-22 9 15 7-23 14 30M9 23l6-3 4 4m8-8 4-3 5 10" stroke="currentColor" stroke-width="1.3"/></svg>';
const icons={map:'<path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Zm6-2v16m6-14v16"/>',book:'<path d="M4 3h13a3 3 0 0 1 3 3v15H7a3 3 0 0 1-3-3Zm0 14h16M8 7h8m-8 4h6"/>',help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 3h.01"/>',sound:'<path d="m3 9 5 0 5-5v16l-5-5H3Zm14-2a8 8 0 0 1 0 10m3-13a12 12 0 0 1 0 16"/>',full:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',close:'<path d="m5 5 14 14M19 5 5 19"/>',arrow:'<path d="M4 12h15m-6-6 6 6-6 6"/>'};
const icon=n=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[n]}</svg>`;
let progress={visited:[],position:null},world,link,nearby,started=false,ready=false,lastSaved=0,distance=0,previous=null,currentDialog=null,meditating=false,wind=null;
try{const saved=JSON.parse(localStorage.getItem(STORE));if(saved){progress.visited=Array.isArray(saved.visited)?[...new Set(saved.visited.filter(id=>LOCATIONS.some(p=>p.id===id)))]:[];if(saved.position&&['x','z','yaw','pitch'].every(k=>Number.isFinite(saved.position[k])))progress.position=saved.position;}}catch{}

$('#app').innerHTML=`
<header class="topbar"><a class="brand" href="/xianxia.html" aria-label="青岚境首页">${mountainIcon}<span>EARTH <b>2</b><small>循山而行 · 与天地相逢</small></span></a><div class="chapter"><span class="dot"></span>青岚境 <i>/</i> <span id="region">云海山径</span></div><nav aria-label="探索工具"><button id="map-button" title="山行图 M" aria-label="打开山行图">${icon('map')}<span>山行图</span></button><button id="journal-button" title="山中手记 J" aria-label="打开山中手记">${icon('book')}<span>手记 <b id="count">0/6</b></span></button><button id="help-top" title="操作说明" aria-label="操作说明">${icon('help')}<span>操作说明</span></button><button id="sound-button" title="开启风声" aria-label="开启风声" aria-pressed="false">${icon('sound')}</button><button id="full-button" title="全屏" aria-label="全屏">${icon('full')}</button></nav></header>
<main id="intro" class="intro"><div class="eyebrow"><span></span>贰号地球 · 仙侠独立试玩</div><p class="small-heading">山水之间，另有天地</p><h1>青岚<span>境</span><b>山</b></h1><p class="intro-copy">穿过雨林深处的山洞，循松风而上。<br>不必赶路，这一路的云与山，都在等你。</p><div class="intro-actions"><button class="primary" id="enter" disabled>正在唤醒山林 <span id="percent">0%</span></button><button class="text-button" id="forest-start" disabled>从雨林洞口出发 ${icon('arrow')}</button></div><p id="continue-note" class="muted">黄山实拍与扫描松岩 · 正式雨林入口待接入</p><div class="loadtrack"><span id="loadbar"></span></div><p id="load-status" role="status">正在加载真实场景素材，请稍候</p></main>
<aside class="poem"><span>行到水穷处</span><span>坐看云起时</span><small>王维 · 终南别业</small><b>青<br>岚</b></aside>
<div class="vignette"></div><div id="crosshair" hidden></div>
<section class="minimap" aria-label="附近山径"><div class="minimap-top"><span>青岚 · 山行</span><span id="bearing">北 N</span></div><canvas id="mini" width="256" height="180"></canvas><div class="minimap-bottom"><span id="elevation">海拔 7 m</span><span id="walked">已行 0 m</span></div></section>
<div id="place-label" class="place-label"><span>初入青岚</span><h2 id="place-name">两界洞</h2><p id="place-poem">一洞隔尘世，松风入青岚</p></div>
<div id="interaction" class="interaction" hidden><button id="interact"><kbd>E</kbd><span id="interact-label">驻足听松</span><span>↗</span></button></div>
<div id="meditation" class="meditation" hidden><span class="breath"></span><p>一呼，一吸。</p><span>松风与云，皆不催人。</span><button id="leave-meditation">结束静坐 <kbd>Esc</kbd></button></div>
<footer class="bottombar"><span class="weather"><span class="sun-icon">◌</span> 晴岚 <i>·</i> 松风徐来</span><div class="controls"><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 行走</span><span>拖动画面 环顾</span><span><kbd>Shift</kbd> 疾行</span><button id="help-button">操作说明 ?</button></div><button id="credits-button" class="credits-link">取景与鸣谢 ↗</button></footer>
<div class="touch-controls" hidden><div id="joystick" role="region" aria-label="拖动摇杆行走"><span id="stick"></span></div><span>右侧拖动环顾</span></div>
<dialog id="panel"><div class="dialog-head"><span id="panel-kicker">青岚境</span><button id="close-panel" aria-label="关闭">${icon('close')}</button></div><div id="panel-content"></div></dialog><div id="toast" role="status"></div>`;

function toast(message){$('#toast').textContent=message;$('#toast').classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').classList.remove('show'),3400);}
function save(){if(!world||!started)return;try{localStorage.setItem(STORE,JSON.stringify({visited:progress.visited,position:{x:world.position.x,z:world.position.z,yaw:world.yaw,pitch:world.pitch}}));}catch{}}
function pause(value){if(!world)return;world.paused=value;world.keys.clear();world.touchMove=null;world.dragging=false;}
function openPanel(title,kicker,html,kind){pause(true);currentDialog=kind;$('#panel-kicker').textContent=kicker;$('#panel-content').innerHTML=`<h2>${title}</h2>${html}`;$('#panel').showModal();}
function closePanel(){$('#panel').close();currentDialog=null;pause(!started||meditating);}
$('#close-panel').onclick=closePanel;$('#panel').addEventListener('cancel',e=>{e.preventDefault();closePanel();});$('#panel').addEventListener('click',e=>{if(e.target===$('#panel'))closePanel();});

function drawMap(canvas,local,all=false){
  const ctx=canvas.getContext('2d'),w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);
  const points=[...TRAIL,...CAVE,...BRANCH],minX=Math.min(...points.map(p=>p[0]))-30,maxX=Math.max(...points.map(p=>p[0]))+30,minZ=Math.min(...points.map(p=>p[2]))-30,maxZ=Math.max(...points.map(p=>p[2]))+30;
  const scale=all?Math.min((w-100)/(maxX-minX),(h-100)/(maxZ-minZ)):.75;
  const cx=all?(minX+maxX)/2:local.x,cz=all?(minZ+maxZ)/2:local.z;
  const point=p=>[w/2+(p[0]-cx)*scale,h/2+(p[2]-cz)*scale];
  ctx.strokeStyle=all?'#bdc9b9':'#778c7b';ctx.lineWidth=1;ctx.globalAlpha=.16;
  for(let k=-1000;k<1400;k+=80){ctx.beginPath();ctx.ellipse(w/2+(k-cx)*scale,h/2+(-300-cz)*scale,90*scale,320*scale,-.5,0,Math.PI*2);ctx.stroke();}ctx.globalAlpha=1;
  for(const [i,route]of [TRAIL,BRANCH,CAVE].entries()){ctx.beginPath();route.forEach((p,k)=>{const [x,y]=point(p);k?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.strokeStyle=i===2?'#a9a998':all?'#405f4a':'#d4ddbd';ctx.lineWidth=i===0?2:1;ctx.setLineDash(i===2?[3,4]:[]);ctx.stroke();}ctx.setLineDash([]);
  ctx.font=`${all?15:12}px "Xianxia Serif",serif`;ctx.textAlign='center';
  for(const place of LOCATIONS){const [x,y]=point(place.point);ctx.beginPath();ctx.arc(x,y,all?4:2.5,0,Math.PI*2);ctx.fillStyle=progress.visited.includes(place.id)?'#b88d55':all?'#58715e':'#a5b69d';ctx.fill();if(all){ctx.fillStyle='#394f40';ctx.fillText(place.name,x+(place.id==='pine'?30:0),y-12);}}
  const [x,y]=point([local.x,0,local.z]);ctx.save();ctx.translate(x,y);ctx.rotate(-world.yaw);ctx.fillStyle=all?'#b26c3e':'#f0deab';ctx.shadowColor='#eedca2';ctx.shadowBlur=8;ctx.beginPath();ctx.moveTo(0,-7);ctx.lineTo(-4,5);ctx.lineTo(0,3);ctx.lineTo(4,5);ctx.closePath();ctx.fill();ctx.restore();
}
function map(){if(!ready)return;openPanel('山行图','青岚山志 · 入口近景验收中',`<p class="panel-lead">当前只验收山侧入口的真实岩体与地表。完整山路和雨林山洞仍在制作。</p><canvas id="big-map" width="760" height="760" aria-label="青岚境路线与当前位置"></canvas><div class="map-key"><span>─ 山径</span><span>● 已至之处</span><span>▲ 此刻所在</span></div><p class="footnote">山径约 ${(routeLength(TRAIL)/1000).toFixed(1)} 公里，尚未实走验收。此图没有传送。</p>`,'map');drawMap($('#big-map'),link.local(world.position.x,world.position.z),true);}
function journal(){openPanel('山中手记',`行过的山，记得的风 · ${progress.visited.length} / ${LOCATIONS.length}`,`<p class="panel-lead">不设倒计时，也不必收集一切。走近一处风景，它便留在这里。</p><div class="journal-grid">${LOCATIONS.map((p,i)=>{const visited=progress.visited.includes(p.id);return `<article class="journal-card ${visited?'visited':''}"><span>0${i+1} <i>${visited?'已到访':'尚未到访'}</i></span><h3>${visited?p.name:'山中未识'}</h3><p>${visited?p.subtitle:'沿着山径，等一次偶然相逢。'}</p>${visited?`<blockquote>${p.verse??p.subtitle}</blockquote><small>${p.author??'两界相连，循径可返'}</small>`:'<small>步履未至，山景待寻</small>'}</article>`;}).join('')}</div><p class="footnote">探索记录保存在当前浏览器，刷新后可续行。</p>`,'journal');}
function interact(){if(!nearby||!started||currentDialog)return;const p=nearby;if(p.id==='cave'){toast('沿洞内石径继续步行，即可往返雨林。');return;}openPanel(p.name,p.subtitle,`<blockquote class="verse">${p.verse}</blockquote><p class="verse-author">${p.author}</p><p class="story">${p.story}</p><button id="sit" class="primary dark">在此静坐 ${icon('arrow')}</button>`,'place');$('#sit').onclick=()=>{closePanel();meditating=true;pause(true);$('#meditation').hidden=false;document.body.classList.add('sitting');};}
function leaveMeditation(){meditating=false;$('#meditation').hidden=true;document.body.classList.remove('sitting');pause(!started);}
$('#leave-meditation').onclick=leaveMeditation;$('#map-button').onclick=map;$('#journal-button').onclick=journal;$('#interact').onclick=interact;
$('#help-button').onclick=()=>openPanel('慢下来，去山里','行路指南',`<div class="help-grid"><p><kbd>W A S D</kbd> 前后与侧向行走</p><p><kbd>↑ ↓</kbd> 前进、后退</p><p><kbd>← →</kbd> 转身环顾</p><p><kbd>Shift</kbd> 按住疾行</p><p><kbd>鼠标拖动</kbd> 自由环顾四周</p><p><kbd>E</kbd> 驻足、读诗与静坐</p><p><kbd>M / J</kbd> 山行图 / 手记</p><p><kbd>Esc</kbd> 暂停或关闭面板</p></div><p class="story">手机或平板：左下摇杆行走，在画面右侧拖动环顾。沿石径可穿过两界洞，洞内没有传送，回头便是来路。</p><p class="footnote">建议横屏与硬件加速。画面会按设备自动降低远景密度。探索进度仅保存在当前浏览器。</p>`,'help');
$('#help-top').onclick=$('#help-button').onclick;
$('#credits-button').onclick=()=>openPanel('山有所本','取景与鸣谢',`<p class="panel-lead">青岚境是一处取材于真实山水的虚构山境，并非黄山或武当山的测绘复原。路线为人工编排；近景岩壁来自扫描，松树使用摄影材质模型，地表为实拍 PBR 与位移，远山为黄山全景摄影。</p><div class="credit-list"><p><b>黄山远景</b><span>François Philipp · CC BY 2.0<br><a href="https://commons.wikimedia.org/wiki/File:Environment_of_huangshan.jpg" target="_blank" rel="noopener">Environment of huangshan ↗</a> · 已裁切、压缩并作远景</span></p><p><b>松岩与地表</b><span>Poly Haven · CC0<br>rock_face_01 · rock_face_02 · coastal_cliff_02 · pine_sapling_medium · rocky_trail · <a href="https://polyhaven.com/" target="_blank" rel="noopener">来源 ↗</a></span></p><p><b>字体与引擎</b><span>Noto Serif CJK SC · SIL OFL 1.1<br>Three.js · MIT · 原雨林素材许可全部保留</span></p></div><p><a href="/xianxia/ASSET-CREDITS.txt" target="_blank">查看完整来源与改制说明 ↗</a></p><a class="request-link" href="https://app.devin.ai/sessions/f5e8c5a184a1412d9ffc91f500108c7a" target="_blank" rel="noopener">反馈与修改 ↗</a>`,'credits');
$('#full-button').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{toast('当前浏览器不支持全屏，可横屏体验。');}};
$('#sound-button').onclick=async()=>{try{if(!wind){const C=window.AudioContext||window.webkitAudioContext,ctx=new C(),buffer=ctx.createBuffer(1,ctx.sampleRate*4,ctx.sampleRate),data=buffer.getChannelData(0);let last=0;for(let i=0;i<data.length;i++){last=(last+(Math.random()*2-1)*.025)/1.025;data[i]=last*3;}const noise=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();noise.buffer=buffer;noise.loop=true;filter.type='lowpass';filter.frequency.value=650;gain.gain.value=0;noise.connect(filter).connect(gain).connect(ctx.destination);noise.start();wind={ctx,gain,on:false};}await wind.ctx.resume();wind.on=!wind.on;wind.gain.gain.setTargetAtTime(wind.on?.22:0,wind.ctx.currentTime,.5);$('#sound-button').setAttribute('aria-pressed',String(wind.on));$('#sound-button').setAttribute('aria-label',wind.on?'关闭风声':'开启风声');toast(wind.on?'风声已开启':'风声已关闭');}catch{toast('当前浏览器无法开启声音。');}};
document.addEventListener('keydown',e=>{if(e.repeat||e.ctrlKey||e.metaKey)return;if(e.code==='Escape'){if(meditating)leaveMeditation();else if(!currentDialog&&started)openPanel('歇一歇','山还在，风也还在',`<p class="story">探索进度已自动保存。关闭此页即可继续行走。</p><button class="primary dark" id="resume">继续山行 ${icon('arrow')}</button>`,'pause');if($('#resume'))$('#resume').onclick=closePanel;return;}if(currentDialog||!started)return;if(e.code==='KeyM')map();if(e.code==='KeyJ')journal();if(e.code==='KeyE')interact();});
document.addEventListener('visibilitychange',()=>{save();if(document.hidden){if(wind)wind.ctx.suspend();if(started&&!currentDialog&&!meditating){pause(true);toast('已暂停，点击画面继续');}}else if(wind?.on)wind.ctx.resume();});$('#world').addEventListener('pointerdown',()=>{if(started&&world?.paused&&!currentDialog&&!meditating)pause(false);},{capture:true});window.addEventListener('pagehide',save);

function update(state){
  if(state.error){toast(state.error);pause(true);return;}if(!ready||!world)return;
  const local=link.local(state.x,state.z),p=nearestLocation(local.x,local.z);
  $('#region').textContent=regionLabel(local.z);$('#walked').textContent='已行 '+Math.round(distance)+' m';
  $('#elevation').textContent=`海拔 ${Math.round(link.owns(state.x,state.z)?link.groundHeight(state.x,state.z):0)} m`;
  const deg=((Math.round(-state.yaw*180/Math.PI)%360)+360)%360;$('#bearing').textContent=`${deg}° ${deg<45||deg>=315?'北 N':deg<135?'东 E':deg<225?'南 S':'西 W'}`;
  drawMap($('#mini'),local);
  if(started&&p&&!progress.visited.includes(p.id)){progress.visited.push(p.id);$('#count').textContent=`${progress.visited.length}/6`;save();toast(`山中手记 · 已记下「${p.name}」`);$('#place-name').textContent=p.name;$('#place-poem').textContent=p.subtitle;$('#place-label').classList.add('visible');clearTimeout(update.labelTimer);update.labelTimer=setTimeout(()=>$('#place-label').classList.remove('visible'),6000);}
  nearby=p;$('#interaction').hidden=!started||!p||meditating||!!currentDialog;$('#interact-label').textContent=p?.id==='cave'?'两界洞 · 循径可返':p?`${p.name} · 驻足读诗`:'';
  if(started&&previous)distance+=Math.hypot(state.x-previous.x,state.z-previous.z);previous={x:state.x,z:state.z};
  if(started&&Date.now()-lastSaved>3000){save();lastSaved=Date.now();}
}
function start(fromForest=false){if(!ready)return;started=true;document.body.classList.add('playing');$('#intro').hidden=true;$('.poem').hidden=true;$('#crosshair').hidden=false;world.active=true;pause(false);
  if(fromForest){world.position.set(link.entrance.x,0,link.entrance.z);world.yaw=0;world.pitch=.02;}else if(progress.position){const p=progress.position;const valid=link.owns(p.x,p.z)?link.canWalk(p.x,p.z):p.x>=BOUNDS.minX&&p.x<=BOUNDS.maxX&&p.z>=BOUNDS.minZ&&p.z<=BOUNDS.maxZ;if(valid){world.position.set(p.x,0,p.z);world.yaw=p.yaw;world.pitch=Math.max(-1.05,Math.min(1.05,p.pitch));}}
  if(matchMedia('(pointer:coarse)').matches)$('.touch-controls').hidden=false;world.canvas.focus();toast(fromForest?'沿洞内石径向前走，青岚境就在洞的另一端。':'沿山径前行，或回身穿洞，返回雨林。');save();
}
$('#enter').onclick=()=>start();$('#forest-start').onclick=()=>start(true);
const joystick=$('#joystick'),stick=$('#stick');let joyId=null;
function moveJoy(e){if(e.pointerId!==joyId)return;const r=joystick.getBoundingClientRect(),dx=e.clientX-r.left-r.width/2,dy=e.clientY-r.top-r.height/2,d=Math.max(1,Math.hypot(dx,dy)/30),x=dx/d,y=dy/d;stick.style.transform=`translate(${x}px,${y}px)`;if(world)world.touchMove={x:x/30,y:-y/30};}
joystick.addEventListener('pointerdown',e=>{e.preventDefault();joyId=e.pointerId;joystick.setPointerCapture(joyId);moveJoy(e);});joystick.addEventListener('pointermove',moveJoy);for(const event of ['pointerup','pointercancel','lostpointercapture'])joystick.addEventListener(event,()=>{joyId=null;stick.style.transform='';if(world)world.touchMove=null;});

async function boot(){try{
  await document.fonts.load('16px "Xianxia Serif"');
  world=new XianxiaDemoRuntime($('#world'),update,stage=>{if(!ready){const p=stage.phase==='download'?Math.min(60,Math.round((stage.loaded/Math.max(1,stage.total))*60)):62;$('#percent').textContent=`${p}%`;$('#loadbar').style.width=`${p}%`;}});
  world.canvas.setAttribute('aria-label','青岚境与雨林连续山境：WASD 行走，鼠标拖动环顾，M 山行图，E 驻足');
  await withTimeout(world.ready,120000);world.initializing=true;
  link=new XianxiaLink(world,{nearOnly:true,clearApproach:false,anchor:{x:0,y:groundHeight(0,-90),z:-90},onProgress:p=>{$('#percent').textContent=`${Math.round(65+p*30)}%`;$('#loadbar').style.width=`${65+p*30}%`;$('#load-status').textContent='正在铺展松岩与云海';}});
  await withTimeout(link.ready,90000);world.worldLink=link;
  let spawn={x:link.offset.x+MOUNTAIN_ENTRANCE.position.x,z:link.offset.z+MOUNTAIN_ENTRANCE.position.z,yaw:MOUNTAIN_ENTRANCE.yaw,pitch:.015};
  if(progress.position){
    const saved=progress.position,local=link.local(saved.x,saved.z);
    if(Number.isSafeInteger(Math.round(local.x))&&Number.isSafeInteger(Math.round(local.z))){
      await withTimeout(link.world.updateMountain(local.x,local.z),90000);
      if(link.world.streamingError)throw link.world.streamingError;
      if(link.canWalk(saved.x,saved.z))spawn=saved;
      else await withTimeout(link.world.updateMountain(MOUNTAIN_ENTRANCE.position.x),90000);
    }
  }
  world.position.set(spawn.x,0,spawn.z);world.yaw=spawn.yaw;world.pitch=Math.max(-1.05,Math.min(1.05,spawn.pitch));world.camera.position.set(spawn.x,link.groundHeight(spawn.x,spawn.z)+1.85,spawn.z);
  await world.prepareDemo(link.scene);world.initializing=false;ready=true;$('#loadbar').style.width='100%';$('#enter').disabled=false;$('#forest-start').hidden=true;$('#enter').innerHTML=`${progress.position?'继续山行':'入山，听风'} ${icon('arrow')}`;$('#load-status').textContent='山林已就绪';$('#count').textContent=`${progress.visited.length}/6`;$('#continue-note').textContent='入口近景验收中 · 完整山路和山洞暂不开放';
  update({x:world.position.x,z:world.position.z,yaw:world.yaw});
}catch(error){console.error(error);$('#load-status').textContent='素材加载未完成，请刷新后重试。';$('#enter').textContent='重新加载';$('#enter').disabled=false;$('#enter').onclick=()=>location.reload();}}
boot();
