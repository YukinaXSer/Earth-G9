# 青岚境：独立试玩与接入边界

## 本次范围
基于 Earth-G9 稳定主图（已同步最新动物与镜头功能），不启用正式主入口洞穴。相对 origin/main，src/main.js、src/world.js、src/wildlife.js、src/habitat.js、src/data.js 和原素材许可保持不变。

Node 24：`npm ci && npm test && npm run build`，`npm run dev` 后打开 /xianxia.html。原 / 仍是原雨林，未接洞。生产服务沿用 server.js；用 PORT、STATIC_DIR 指向隔离的构建快照。

独立试玩用 XianxiaDemoRuntime extends Rainforest，复用原 renderer、camera、position、输入与场景资源，只在独立入口覆写演示移动/渲染循环；正式主入口不导入它。正式雨林不应照抄这个子类，而应在最新主循环人工接入下方接点。

演示锚点显式选在稳定图内 (0,-90)，y 来自原 groundHeight。这不是已批准的正式洞口；原扩图建议的 (72,-230) 在稳定图界外，不应启用。正式入口和固定雨林网址仍由雨林方整合发布。

## 模块
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

## 正式主循环接点（本 PR 未应用）
雨林方在动物与图形恢复发布后自行整合，勿覆盖最新 world.js：
1. 移动先算未 clamp 的候选 x/z。仅 link.owns(x,z) 为真时绕过雨林边界/河岸限制，改用 link.canWalk 与 link.groundHeight；否则保留正式版全部地面、河岸与碰撞逻辑。
2. 相机脚底同样选所属地面，保留 1.85 m 眼高和步态，不改变 position.y 语义。
3. 原 renderer 渲染 link.update(position,time) ?? rainforest.scene，不另建 renderer 或移动玩家来切图。
4. 洞内渐暗自然光，离洞恢复原背景/灯光/雾；若正式 UI 允许洞内切天气，要合并状态，避免两个系统同时写灯光。

演示子类是可运行参考，不是应覆盖正式循环的整文件补丁。正式锚点还需现场核对地形、净空、河道及恢复位置逻辑。

## 真实来源与边界
黄山远景为授权摄影，不可走近；近景山体改用 Chris Bibb 的 Haytor 完整摄影测量地形，源自约 50 m 飞行高度拍摄的 300 张照片，整体统一放大 4.5 倍，保留真实三维轮廓与纹理，不再只靠 30 m 高程加贴图补近景。实际脚底来自渲染三角形；12 m 高度代理仅用于实扫边缘与远处黄山 SRTM 的数据拼接，不代替近景几何。不同地方的真实捕获资源构成虚构关卡，不声称是原地黄山数字孪生。更远山体仍是约 30 m 原生采样的 SRTM，没有纵向夸张；EOX 2016 Sentinel-2 影像使用 CC BY 4.0 版本。

旧叠石洞口、程序洞壳、低精度 LiDAR 洞体和横板状砂岩遮棚都已移除。洞穴整体改用 b_nealie 的 Sea Cave 3：46 张照片经 3DF Zephyr 重建，原始约 70 万三角形、9 张原生 1024 像素纹理分块，CC BY 4.0。该捕获同时包含真实拱口、室外步道和洞内顶壁，不再把不同洞穴的破口硬拼在一起。两份完整洞穴臂在已拍摄的深处相对，以 1 m 重叠连接；统一缩放 0.04，并对整个连接作同一个约 8.6° 刚体倾斜，使雨林端为 0 m、仙山端为 7 m，不歪曲捕获比例。不做生成式放大，不声称源单位对应真实米数。实拍地面和洞顶都按最终三角形索引，净高不足玩家高度处不能通行；不把薄洞顶上表面当脚底，也不生成假地板。

步行近看的洞壁/洞顶以 Poly Haven rock_wall_02 的原生 4K 实拍表面替换模糊的烘焙色，保留实拍地面、植被和暗缝遮蔽，并叠加真实高度凹凸细节，2 m 实拍纹理块三平面投射，不拉伸原生 UV，不改变捕获的宏观几何。凹凸强度为画面设定，不声称测得该洞的毫米级起伏。室外裁切地面的前 1.5 m 作透明接色，演示中克隆的雨林地面按捕获边界高度平缓接合；适配器用修改后的真实三角形决定接缝外的相机高度。原雨林网格、地形函数和正式入口不改。

**整体画面尚未通过新一轮玩家实走验收，尤其要检查近处山体；30 m 高程来源真实不等于近景已合格。暂不合并或发布。** 松树为完整摄影材质模型离线烘焙透明景片，并非整树原始照片。路线是人工设计，不声称还原真实黄山步道。来源、作者、改制和重建脚本见 public/xianxia/ASSET-CREDITS.txt；原雨林全部许可保留。运行时无外部 CDN 或下载凭证。
