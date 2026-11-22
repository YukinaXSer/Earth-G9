# 青岚境：独立试玩与接入边界

二维流送地表现使用版本化 MTN2 资源，附带按实际地表支撑烘焙的落叶土石分区；原 MTN1 解码与资源仍保留。洞口、宿主变换、共享光照和公开接口不变。

近景保留原始扫描正面，不再绘制布尔背壳或切割出的岩脚。补地只由有效实扫支撑和实拍高度图生成缓坡，不将扫描范围外的边缘样本挤出成长脊；近远景保留相同分块边界采样。补地本身是可见网格，碰撞与支撑索引不使用额外隐藏地板。

落叶分布由完整实拍层打散取样，底色、法线与粗糙度同步旋转，细颗粒层不代替中尺度。蕨复用四个已有实拍变体、聚簇和自然尺寸差，按缩放后的实际脚底求支撑；Low/High 数量预算不增，不增加模型或贴图。默认低档分辨率、共享光照、洞口和地形资源未改。

## 正式单场景接入接口（山洞会话使用）

只使用 `src/xianxia-mountain.js` 的 `XianxiaMountain`；下方旧 `XianxiaLink` 演示的场景切换**不能**用于正式穿洞。

```js
import {XianxiaMountain,MOUNTAIN_ENTRANCE,MOUNTAIN_LIGHTING} from './src/xianxia-mountain.js';
const mountain=new XianxiaMountain({renderer:rainforest.renderer,quality:rainforest.lowDetail?'low':'high'});
mountain.group.position.set(offset.x,offset.y,offset.z);
// 可设置 group.rotation.y；保持单位缩放，不做俯仰/翻滚。
rainforest.scene.add(mountain.group);
await mountain.load(); // 幂等；请在到洞口前提前完成下载、GPU上传和宿主 compileAsync。
const y=mountain.groundHeight(worldX,worldZ); // 宿主世界坐标；缺面/未加载返回 null，不回退隐藏地面。
const allowed=mountain.canMove(fromWorldX,fromWorldZ,toWorldX,toWorldZ);
```

- `group` 默认仅包含近山和道具，不创建 renderer、camera 或 Scene，不改宿主环境、背景、雾或灯光，不加载山洞、雨林资源或全景球。
- `load()` 返回同一个 Promise；完成后返回 mountain。`groundHeight` 和 `canMove` 查询可见地表及实体石块的最终三角网格，支持宿主父节点平移和 yaw。
- `MOUNTAIN_ENTRANCE` 是**山本地坐标**：脚底 `(100.5, 0.49862106783051635, -115.1)`；离洞入山向 `+X`，yaw `-Math.PI/2`（相机向前为 `-Z`）。它不是旧 XianxiaLink 的全局坐标。用 `mountain.group.localToWorld(...)` 得到宿主坐标，入口方向也随 group 的 yaw 旋转。
- 洞口前 `8 × 1.2m` 已在同一可见扫描网格内整坡，末端 `(108.5, 0.90559662697416, -115.1)`，坡度约 `5.09%`，不是水平平板；外围 0.6m 平滑衔接。没有第二层路面、碰撞平面或缩放整个扫描。边缘和完整山路仍在修，不能把本接口交接视为画面/穿洞验收通过。
- `MOUNTAIN_LIGHTING` 导出雨林共享配置：sRGB、ACESFilmic、曝光 `.96`；环境 `/textures/rainforest-light.hdr`（晴 `.85` / 雨 `.45`）；太阳 `#fff0ce`（晴 `3` / 雨 `.75`），相对玩家 `(-24,30,12)`；半球光 `#b8cda4 / #65503b`（LOW `1.35` / HIGH `.85`）；LOW Ambient `#dbe2d3 / 1.1`。雾基数晴 `.0045` / 雨 `.007`，湿度另加 `moisture*.006`，色值与显示天空路径/强度/旋转也在常量中。
- 灯光权威实现仍是 `src/world.js` 的 `makeLighting / setWeather / updateSky` 及 renderer 初始化；山适配器**不重新应用或覆盖**它们。宿主只保留同一个 renderer/Scene，天气变化跟随宿主，不另建一套山灯光。材质米制坐标、区域遮罩和法线使用山本地帧，整体平移/yaw 不会改变材质类别或法线朝向。
- 这里冻结的是洞口位置、朝向及接口；山路扩展不得悄悄改变它们。若必须调整，先通知主会话和洞穴会话。

### 可选宿主远景（近景之后异步加载）

默认不下载远景。宿主可以在近景准备好之后主动调用：

```js
await mountain.load();
await mountain.prepare(rainforest.camera);
// 可在洞口进入视野前后台启动，不要在玩家走进洞里时阻塞等待。
mountain.loadHorizon().catch(error => reportBackgroundFailure(error));
```

也可在构造时传 `renderHorizon:true`，在近景 `load()` 完成后自动启动同一任务；它不延迟近景 Promise。`loadHorizon()` 幂等，返回远景 Mesh 的 Promise；失败记录在 `horizonError`，不让近景行走失败，宿主仍应上报错误。需要确定远景就绪时显式等待该 Promise，并在出洞前完成宿主的编译/上传预热。

远景使用已有约30米原生采样的黄山 SRTM 高程及512² Sentinel-2影像（新增延后下载约66KB），不复用旧全景球，也不把远景数据当近处扫描。它是随相机平移的不可走近背景，保留测得的相对地形和对应影像，以刚体旋转把主要山峰朝向山本地 `+X`；整体朝向仍随山组 yaw。外围淡出，不拉伸照片底部，不加入脚底/碰撞查询或射线拾取。

背景保留宿主 ACES/sRGB、天空和天气雾颜色，不新建灯光、不改全局曝光/雾或 camera。仅该材质投到最远深度且不写深度，让实际近景始终遮住它；无需将宿主220米的远裁剪扩大到几公里。远景自身按测得距离采用较稀薄的空气雾深，不改变宿主近地雾。宿主平移/yaw和220米相机的自动检查通过，**正式穿洞视角的视觉验收仍待完成**。

## 本次范围
基于 Earth-G9 稳定主图（已同步最新动物与镜头功能），不启用正式主入口洞穴。相对 origin/main，src/main.js、src/world.js、src/wildlife.js、src/habitat.js、src/data.js 和原素材许可保持不变。

Node 24：`npm ci && npm test && npm run build`，`npm run dev` 后打开 /xianxia.html。原 / 仍是原雨林，未接洞。生产服务沿用 server.js；用 PORT、STATIC_DIR 指向隔离的构建快照。

独立试玩用 XianxiaDemoRuntime extends Rainforest，复用原 renderer、camera、position、输入与原 makeLighting；不加载雨林地面、植物或动物。直接入山只启用原比例扫描近景、地面/岩壁双尺度材质与坡脚道具，正式主入口不导入这个子类。正式雨林应在最新主循环接入下方接点，并实现提前后台预载，不能照搬独立入口的加载时机。

演示锚点显式选在稳定图内 (0,-90)，y 来自原 groundHeight。这不是已批准的正式洞口；原扩图建议的 (72,-230) 在稳定图界外，不应启用。正式入口和固定雨林网址仍由雨林方整合发布。

## 当前近景与保留的历史模块
- xianxia-near.js / xianxia-surface.js：Coastal Cliff 04 原比例扫描地块（151044 个源三角形、约 12.5×11.7m），位置仅作平移；同一可见网格与扫描岩石提供脚底和阻挡。双尺度摄影材质走共享 Standard PBR，原生 ETC2/S3TC 上传，无运行时 Basis/WASM。入山首载不加载旧航拍、SRTM 山体、洞穴和雨林模型；并不代表下列历史完整路线已开放。
- xianxia-world.js：完整近景摄影测量地形、远处实测山体、摄影材质松树景片、实拍 PBR；洞口、洞顶、洞壁和地面使用同一套完整摄影测量洞穴臂。
- xianxia-foreground.js / xianxia-foreground-data.json：Haytor 完整实拍地形的变换和边界融合代理。近景实际绘制完整 GLB 并用真实三角形接地，不把代理网格冒称原始扫描。山地洞口按实扫地面横坡作刚体姿态对齐，岩体埋入地面而非悬空叠放。
- xianxia-terrain.js / xianxia-terrain-data.json：黄山 SRTM 实测高程与原始瓦片校验；约 30 m 原生采样、12 m 插值渲染，不夸称近地扫描。
- xianxia-route.js：约 2.6 km 主径、支路、约 46.5 m 双向摄影测量洞穴、六处手记地标。
- xianxia-cave-captures.json：完整洞穴捕获的来源、统一比例、共享刚体倾斜、两份捕获的实例变换、真实洞口的明暗边界；不把岩体拉伸成隧道。
- xianxia-link.js：可换锚点的场景、地面、碰撞适配器。
- xianxia-demo-runtime.js：独立演示循环，非正式雨林主循环。
- xianxia-main.js / xianxia.css / xianxia.html：中文 UI，独立使用 earth2.xianxia.v1 存档。
- public/xianxia/：随站点提供的本地资源、字体与许可，岩壁有高低画质版本。

```js
await rainforest.ready;
const link = new XianxiaLink(rainforest, {
  anchor: { x: chosenX, y: groundHeight(chosenX,chosenZ), z: chosenZ },
  clearApproach: true,
  onProgress: fraction => {},
});
await link.ready;
// 仅赋属性不能完成正式接入，还需下列人工整合。
rainforest.worldLink = link;
```

锚点是捕获室外步道的 local (0,0,CAVE_LENGTH)，仙山端步道为 (0,7,0)；摄影测量洞路约 46.5 m，包括两端各约 8 m 的原捕获室外地面，真实洞口在其内侧。保留统一比例，只对整个连接作共享刚体倾斜，不拉长单轴。往仙山 z 递减，返程相反。link.entrance 是锚点以南 48 m 的正常试玩起点。明暗从真实拱口开始渐变，不在尚未进洞的室外步道提前变黑。场景在实拍洞内约中点选择，两套洞体坐标/材质一致，共享玩家位置、朝向与相机；不跳页、不传送、不重载或重置玩家。

clearApproach:true 只修改启用模块的场景实例：隐藏局部植被与 LOD、同步排除对应碰撞，克隆地面后压到洞内石径下；原资源和地形数据不变。正式洞口已净空时设 false。原碰撞索引如存在保留查询，仅过滤移除的对象。

## 连续穿洞的硬性验收（正式接入后必须实走，本轮尚未实现）

- 两界必须共用雨林现在线上的同一个 renderer、HDR/PMREM、色调映射、输出色彩空间及后处理顺序。不得在世界边界切换 NoToneMapping/ACES、另建 renderer，或通过样例专用直出照明使材质看起来正确。仙侠地面与岩壁须在共享 Standard PBR 管线内校准；曝光如需不同，只能在真实洞内随路程连续渐变，折返时同样连续。
- 目前独立近山入口继承 Rainforest 的 renderer 与 makeLighting，不覆写其 SRGB/ACES/.96 设置，复用 rainforest-light.hdr、晴天光照和环境强度。两层摄影材质只注入 PBR 底色、法线、粗糙度，不绕开环境、色调映射或输出阶段。海岸扫描原比例近景约 12.5×11.7m，并不代表旧 2.6km 山径已经全部开放。旧全路线/洞穴代码仅供后续坐标参考，画质未验，不得作为正式接入版本。
- “直接进仙侠”允许不首载雨林和洞穴；“从雨林走来”必须在接近洞口前于后台载好洞壳、两端近景及返回方向所需资源，并提前完成解码、GPU 上传与 shader 编译。预载触发距离须按正常疾行速度和实测冷载耗时留余量，不是走到洞口才开始下载。
- 记录首次无缓存雨林→山洞→仙侠→山洞→雨林的连续普通玩家路线：位置、朝向、输入、眼高、碰撞必须连续；途中不得有加载画面、暂停等待资源、强制改速、重载、传送，或基础贴图到精细贴图突然替换。用慢网/无缓存复验预载完成早于到达，不得以暖缓存通过代替。
- 预载必须跟踪资源就绪与编译/上传就绪；下载失败要在玩家到达前报告，而不是在洞内阻塞主循环。保留本次后台网络时间线、帧时和来回录屏作为证据。正式洞穴尚暂停，因此本轮不声称这些条件已经通过。

## 正式主循环接点（本 PR 未应用）
雨林方在动物与图形恢复发布后自行整合，勿覆盖最新 world.js：
1. 移动先算未 clamp 的候选 x/z。仅 link.owns(x,z) 为真时绕过雨林边界/河岸限制，改用 link.canWalk 与 link.groundHeight；否则保留正式版全部地面、河岸与碰撞逻辑。
2. 相机脚底同样选所属地面，保留 1.85 m 眼高和步态，不改变 position.y 语义。
3. 原 renderer 渲染 link.update(position,time) ?? rainforest.scene，不另建 renderer 或移动玩家来切图。
4. 洞内渐暗自然光，离洞恢复原背景/灯光/雾；若正式 UI 允许洞内切天气，要合并状态，避免两个系统同时写灯光。

演示子类是可运行参考，不是应覆盖正式循环的整文件补丁。正式锚点还需现场核对地形、净空、河道及恢复位置逻辑。

## 真实来源与边界
黄山远景为授权摄影，不可走近；当前可走近景为 Coastal Cliff 04 原比例扫描地面、坡脚和岩壁，使用 Rocky Trail 整张 2m 摄影与 0.25m 原生裁块、Rock043L 整张 1.8m 摄影与 0.225m 原生裁块。后者仅确认是灰色自然岩石摄影测量素材，不声称经过花岗岩鉴定。坡脚为原比例扫描岩石和蕨类，向同一可见地表投射并嵌入；缺少真实支撑的位置不放道具。Haytor 航拍与约 30m 原生采样 SRTM 仅保留历史中远景数据，不在当前首屏创建或作近处脚底。不同地方的真实捕获组成虚构关卡，不声称是黄山数字孪生。

### 历史洞穴尝试（已暂停，未验收，不在当前首载）

旧叠石洞口、程序洞壳、低精度 LiDAR 洞体和横板状砂岩遮棚都已移除。洞穴整体改用 b_nealie 的 Sea Cave 3：46 张照片经 3DF Zephyr 重建，原始约 70 万三角形、9 张原生 1024 像素纹理分块，CC BY 4.0。该捕获同时包含真实拱口、室外步道和洞内顶壁，不再把不同洞穴的破口硬拼在一起。两份完整洞穴臂在已拍摄的深处相对，以 1 m 重叠连接；统一缩放 0.04，并对整个连接作同一个约 8.6° 刚体倾斜，使雨林端为 0 m、仙山端为 7 m，不歪曲捕获比例。不做生成式放大，不声称源单位对应真实米数。实拍地面和洞顶都按最终三角形索引，净高不足玩家高度处不能通行；不把薄洞顶上表面当脚底，也不生成假地板。

步行近看的洞壁/洞顶以 Poly Haven rock_wall_02 的原生 4K 实拍表面替换模糊的烘焙色，保留实拍地面、植被和暗缝遮蔽，并叠加真实高度凹凸细节，2 m 实拍纹理块三平面投射，不拉伸原生 UV，不改变捕获的宏观几何。凹凸强度为画面设定，不声称测得该洞的毫米级起伏。室外裁切地面的前 1.5 m 作透明接色，演示中克隆的雨林地面按捕获边界高度平缓接合；适配器用修改后的真实三角形决定接缝外的相机高度。原雨林网格、地形函数和正式入口不改。

**整体画面尚未通过新一轮玩家实走验收，尤其要检查近处山体；30 m 高程来源真实不等于近景已合格。暂不合并或发布。** 松树为完整摄影材质模型离线烘焙透明景片，并非整树原始照片。路线是人工设计，不声称还原真实黄山步道。来源、作者、改制和重建脚本见 public/xianxia/ASSET-CREDITS.txt；原雨林全部许可保留。运行时无外部 CDN 或下载凭证。
