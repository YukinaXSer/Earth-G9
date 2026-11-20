# 青岚境：独立试玩与接入边界

## 本次范围
基于 Earth-G9 稳定原地图，不启用正式主入口洞穴。src/main.js、src/world.js、src/wildlife.js、src/habitat.js、src/data.js 和原素材许可保持不变。

Node 24：`npm ci && npm test && npm run build`，`npm run dev` 后打开 /xianxia.html。原 / 仍是原雨林，未接洞。生产服务沿用 server.js；用 PORT、STATIC_DIR 指向隔离的构建快照。

独立试玩用 XianxiaDemoRuntime extends Rainforest，复用原 renderer、camera、position、输入与场景资源，只在独立入口覆写演示移动/渲染循环；正式主入口不导入它。正式雨林不应照抄这个子类，而应在最新主循环人工接入下方接点。

演示锚点显式选在稳定图内 (0,-90)，y 来自原 groundHeight。这不是已批准的正式洞口；原扩图建议的 (72,-230) 在稳定图界外，不应启用。正式入口和固定雨林网址仍由雨林方整合发布。

## 模块
- xianxia-world.js：扫描近景岩壁、摄影材质松树模型烘焙景片、实拍 PBR/位移、黄山远景。
- xianxia-route.js：约 2.6 km 主径、支路、约 140 m 双向洞穴、六处手记地标。
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

锚点是洞的 local (0,0,132)，仙山口为 (0,7,0)；往仙山 z 递减，返程相反。link.entrance 是锚点以南 16 m 的试玩起点。暗弯 local z=70 处选择场景，两套洞体坐标/材质一致，共享玩家位置、朝向与相机。没有 iframe、传送门、网址跳转、重载或穿洞时重置位置。

clearApproach:true 只修改启用模块的场景实例：隐藏局部植被与 LOD、同步排除对应碰撞，克隆地面后压到洞内石径下；原资源和地形数据不变。正式洞口已净空时设 false。原碰撞索引如存在保留查询，仅过滤移除的对象。

## 正式主循环接点（本 PR 未应用）
雨林方在动物与图形恢复发布后自行整合，勿覆盖最新 world.js：
1. 移动先算未 clamp 的候选 x/z。仅 link.owns(x,z) 为真时绕过雨林边界/河岸限制，改用 link.canWalk 与 link.groundHeight；否则保留正式版全部地面、河岸与碰撞逻辑。
2. 相机脚底同样选所属地面，保留 1.85 m 眼高和步态，不改变 position.y 语义。
3. 原 renderer 渲染 link.update(position,time) ?? rainforest.scene，不另建 renderer 或移动玩家来切图。
4. 洞内渐暗自然光，离洞恢复原背景/灯光/雾；若正式 UI 允许洞内切天气，要合并状态，避免两个系统同时写灯光。

演示子类是可运行参考，不是应覆盖正式循环的整文件补丁。正式锚点还需现场核对地形、净空、河道及恢复位置逻辑。

## 真实来源与边界
黄山远景为授权摄影，不可走近；近景为真实扫描资源重新布局。洞口用扫描海崖组合，洞内连续底壳用摄影岩壁 PBR/真实位移并叠加扫描岩体，并非完整实洞扫描。松树为完整摄影材质模型离线烘焙透明景片，并非整树原始照片。路线是人工设计的虚构仙山，不声称还原黄山或武当。来源/作者/改制见 public/xianxia/ASSET-CREDITS.txt；原雨林全部许可保留。运行时无外部 CDN 或下载凭证。
