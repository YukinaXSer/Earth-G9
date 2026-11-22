# 青岚境：独立试玩与接入边界

High摄影针束的颜色补偿离线只作用于绿色针叶像素，照片里的棕色枝梗保持原色；材质带pinePhotographBalanced标记，运行时不再整张提亮/染绿。Low仍使用原材质处理和全部原贴图。新的苔藓摄影地表仅供High验收，不改变Low素材。

二维流送地表现使用版本化 MTN2 资源，附带按实际地表支撑烘焙的落叶土石分区；原 MTN1 解码与资源仍保留。洞口、宿主变换、共享光照和公开接口不变。

近景保留原始扫描正面，不再绘制布尔背壳或切割出的岩脚。补地只由有效实扫支撑和实拍高度图生成缓坡，不将扫描范围外的边缘样本挤出成长脊；近远景保留相同分块边界采样。补地本身是可见网格，碰撞与支撑索引不使用额外隐藏地板。

落叶分布由完整实拍层打散取样，底色、法线与粗糙度同步旋转，细颗粒层不代替中尺度。蕨复用四个已有实拍变体，按缩放后的实际脚底求支撑；Low/High每块最多190/900个候选，再按路径净空和真实支撑剔除。散株与较成熟的蕨丛混合，丛生候选高约0.2–1米，约一半丛心关联松根，另一半关联岩脚或自然土坡；不把统一大小的幼株等距撒满。道具脚底跨分块边缘时查询相邻镜像的同一可见地面。提高林下覆盖会增加绘制工作，不能以旧版帧时冒充新性能；默认低档分辨率、共享光照、洞口和地形资源未改。

松林有三个原生高度层：1.05米幼株、7.01米 Pine Sapling Medium C、约14.9米 Pine Tree 01 B。保留原比例木质枝系与真实根脚/身体碰撞，针叶不作脚底或身体支撑。低/高档成年树LOD为12/25米，中层6/12米，均带15%滞回。上一版逐针细长比补面积在真实High下仍稀薄偏棕，不能把投影面积数字当视觉通过。

本版改用原始摄影图集中的针束近照，固定交叉在原模型绿色针叶簇的位置与主轴上；不是面对镜头的整树卡片，也不生成新的树干/枝条布局。照片亮度蒙版只保留连通针束，剔除旁边的图集填充岛并扩边RGB；原生241×410像素，不插值扩图。固定扇向交叉面避免从枝端观察消失，弯曲的簇法线近似针束平均朝向。High保留原图集木质叉枝区域对应的细枝几何（过去只保松果而漏掉），木质枝系使用更精细LOD，远档针束不再粗聚合成大叶团；保持原比例，不生成树枝骨架。针束用整面等比收缩贴合原针叶范围，不再逐角裁剪扭曲照片。使用MASK/.18阈值；只对针束校色，细枝/松果/树干不染绿或提亮，保留原始IOR/specular，不改曝光/宿主光照。High林下沿原有松根/岩脚非均匀蕨簇增加候选，仍四种原生植株混合大小；避开走线、拒绝无支撑根脚。

Low仍用 `pine-mature-v5-*.glb.gz` / `pine-mid-v3-*.glb.gz`，四个LOD约3.1MB，全部素材、190个蕨候选与默认分辨率不变。High用v8/v6，四个LOD总计8,497,955B；High蕨候选900。仅替换几何识别出的细长针叶，其余原始表面保留。原图集木质叉枝与针叶区残面分别简化，避免后者占去枝系LOD预算；简化后合并回同一primitive，材质/图片数和绘制段数不增加。原生twig图集补做近黑空区实拍RGB扩边；非黑源像素、木质/松果颜色因子和原始specular/IOR不变。几何仍是原件，不生成骨架、不加粗木质或松果。针束按真实顶点主轴跨度等比拟合，远档复用近材质且保留TEXCOORD_0。92defbd的固定镜头A/B已定位原生细枝层黑粒，未证实单独机制；本次原生图集/独立枝系LOD修订仍待真High整帧与冷载验收，模型文件体积不是整页HTTP或性能结论。原生gzip/glTF，无WASM/meshcodec/worker。

仅High土层中尺度底色、GL法线和粗糙度换为同一实拍 Forest Leaves 02（Poly Haven / Rob Tuytel / CC0）：天然苔藓、落叶和树枝的成片变化，保留完整照片及其约3.001米原生尺度，不把3米照片缩成2米。细颗粒仍用原 Forest Floor 0.2675米裁片，岩壁照片、反射率、HDR/ACES与曝光不变。Low仍使用原manifest及全部原贴图；High使用独立manifest-high.json。两种GPU格式仍各8张纹理、2048²中尺度底色和1024²法线/粗糙度，上传字节与原版相同，无新增运行时贴图/解码器。离线脚本 `prepare-xianxia-forest-meso.py` 输入官方4K底色/GL法线、2K粗糙度与含dimensions的资源JSON，先用toktx编码，再由ktx转ETC2/S3TC；这些工具不进入运行时。黄山照片带等比例上移约5度，接口、默认异步关闭与宿主220米裁剪不变；未过整帧前不交接洞穴。

离线重建：准备 Poly Haven Pine Tree 01 的1K glTF及原始未扩边的针束图，保留extensionsUsed/Required声明，运行 `node scripts/prepare-xianxia-pine-sprays.mjs /path/to/pine_tree_01_1k.gltf mature public/xianxia/surface /path/to/pine_tree_01_twig_diff_1k.jpg`。中层用同一脚本，把输入替换为 `public/xianxia/surface/pine-medium.glb`，类型改为 `middle`，仍用同一原始针束近照。准备机需 `@gltf-transform/core`、`extensions`、`functions` 4.2.1，`meshoptimizer` 0.24.0 和 `sharp`（本次0.35.5）；这些只用于离线制作，不加入浏览器运行时。旧逐针脚本留作来源追溯，当前不使用。来源与改制见资产许可文件。

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

独立近山入口在近景完成后启动同一个黄山远景；此前 nearOnly 提前返回漏掉了这一层，并不是玩家朝向或近石遮挡。宿主 `XianxiaMountain` 默认仍关闭；两种入口共用远景加载器及随相机移动、保留父级平移/yaw的摆放，不另建天空或色调管线。远景失败记录在 `horizonError`，不让近景行走失败。改动后的实际下载、远峰可见度及SwiftShader响应须单独实测，不沿用无远景版本的冷载数字。

默认不下载远景。宿主可以在近景准备好之后主动调用：

```js
await mountain.load();
await mountain.prepare(rainforest.camera);
// 可在洞口进入视野前后台启动，不要在玩家走进洞里时阻塞等待。
mountain.loadHorizon().catch(error => reportBackgroundFailure(error));
```

也可在构造时传 `renderHorizon:true`，在近景 `load()` 完成后自动启动同一任务；它不延迟近景 Promise。`loadHorizon()` 幂等，返回远景 Mesh 的 Promise；失败记录在 `horizonError`，不让近景行走失败，宿主仍应上报错误。需要确定远景就绪时显式等待该 Promise，并在出洞前完成宿主的编译/上传预热。

旧版只有山本地东向135°黄山照片带，西/西北在带外；3米原档短走不构成洞口路线验收。新版使用 Alex Radosnov / Poly Haven 的云南属都湖林木山脊摄影，在东向保留 François Philipp 黄山实拍。v5逐像素分离树梢和天空，同时保留雾化中性灰山脊，避免只留下孤立的深绿树冠；避开木屋、游客和湖岸栈道。低山鞍部后方用等角尺度的纯林坡片段循环衬底，因此存在重复的摄影片段，但没有镜像、生成式补画或重建山体。离线合成、填充透明像素RGB并羽化下沿；游戏只投一个闭合柱面环带，无照片极点或脚下全景拉伸。它是非地理真实的美术合成，不声称为原场景连续360°摄影、数字孪生或实测三维地形。全部出处和变更见素材署名。

High 为3072×432，Low为2048×288，每档只下载一张、不超过256KB；近景Low模型、贴图、植被密度、画面缓冲分辨率均不变。环带随相机平移、不可走近，朝向随山组yaw，不加入脚底/碰撞查询或射线拾取。仅闭合水平方位，不包住天空；环带上下沿透明，保留宿主天空。

背景保留宿主 ACES/sRGB、天空和天气雾颜色，不新建灯光、不改全局曝光/雾或 camera。仅该材质投到最远深度且不写深度，让实际近景始终遮住它；无需将宿主220米的远裁剪扩大到几公里。照片已含大气层次，只叠加按径向距离缩放的宿主天气雾，避免同一座峰随鼠标朝向改变浓淡；缩放是视觉参数，不声称测得摄影距离，不改变宿主近地雾。宿主平移/yaw和220米相机的自动检查通过，**正式穿洞视角的视觉验收仍待完成**。

先前DEM远景有低矮绿脊和天空三角孔，不再承担背景轮廓；135°第二版则不能覆盖西/西北。新版URL不覆盖已缓存旧图。文件大小**不是新冷载、全向观感或洞口往返验收**，须在新修订中实际录下从洞口走出数百米再回洞口并沿途转向。复现：先运行`python3 scripts/prepare-xianxia-horizon.py`得到中间黄山图，再运行`python3 scripts/prepare-xianxia-horizon-ring.py --panorama <署名中的原全景JPEG> --east public/xianxia/textures/huangshan-distant-v2.webp --output public/xianxia/textures/mountain-distant-ring-v5.webp`，依赖numpy/scipy/Pillow；运行时不加载原全景，不需解码器/worker。

## 本次范围
基于 Earth-G9 稳定主图（已同步最新动物与镜头功能），不启用正式主入口洞穴。相对 origin/main，src/main.js、src/world.js、src/wildlife.js、src/habitat.js、src/data.js 和原素材许可保持不变。

Node 24：`npm ci && npm test && npm run build`，`npm run dev` 后打开 /xianxia.html。原 / 仍是原雨林，未接洞。生产服务沿用 server.js；用 PORT、STATIC_DIR 指向隔离的构建快照。

独立试玩用 XianxiaDemoRuntime extends Rainforest，复用原 renderer、camera、position、输入与原 makeLighting；不加载雨林地面、植物或动物。直接入山只启用原比例扫描近景、地面/岩壁双尺度材质与坡脚道具，正式主入口不导入这个子类。正式雨林应在最新主循环接入下方接点，并实现提前后台预载，不能照搬独立入口的加载时机。

演示锚点显式选在稳定图内 (0,-90)，y 来自原 groundHeight。这不是已批准的正式洞口；原扩图建议的 (72,-230) 在稳定图界外，不应启用。正式入口和固定雨林网址仍由雨林方整合发布。

## 当前近景与保留的历史模块
- xianxia-mountain-field.js / xianxia-mountain-surface.js：当前v3扫描岩面与实拍缓坡二维流送，共用可见网格作支撑与碰撞。xianxia-near.js保留原比例扫描工具、前庭整坡和道具接地；xianxia-surface.js双尺度摄影材质走共享Standard PBR，原生ETC2/S3TC上传，无运行时Basis/WASM。近景不首载旧航拍、旧可走SRTM山体、洞穴或雨林模型；独立入口在近景后异步加载实拍的不可走远山背景。不代表下列历史路线已经开放。
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
