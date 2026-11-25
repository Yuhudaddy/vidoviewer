# core/ 介面(草案 v0.1,阿沅維護)

狀態標記:【已完成並有測試】【草案,尚未實作】。欄位要改,找阿沅改這份文件,不各自假設。

## 原則
・ 座標與長度一律「圖面單位」(drawing units)。換算只在顯示層做(units.js)。
・ 單位未設定(INSUNITS = 0)時 `unit: null`。不加 mm,不默默當公釐。
・ 角度:內部弧度、逆時針為正;量測角度對外給「度」。
・ 不在中間步驟四捨五入;顯示時才依位數規則捨入。
・ 型別分派用 DXF 的 `subclassMarker`(例如 AcDbLine),**不要用 constructor.name**:壓縮後的 vendor bundle 會把類別名稱改掉。

## geom.js【已完成並有測試:tests/geom.test.js,17 項,預期值皆手算】
```
dist(a,b)  mid(a,b)  angleAt(a, vertex, b) -> 度 [0,180];臂長 0 丟 RangeError
bulgeArc(p1,p2,bulge) -> {center,r,theta,ccw,start,end} | null(直線)
polyArea(pts, bulges?) -> {area, perimeter, ccw}   // 視為封閉,含弧段;至少 2 點
polyLength(pts, bulges?, closed) -> number
circleArea(r) -> {area, perimeter}
explodePoly(pts, bulges?, closed) -> [{type:'line'|'arc', ...}]
segSeg / segCircle / circleCircle / intersect(primA, primB) -> [點]
snap(pt, prims, tol, modes?) -> {type:'endpoint'|'midpoint'|'center'|'intersection', point, dist} | null
```
基本形(prims,世界座標):
```
{type:'line',   p1:{x,y}, p2:{x,y}}
{type:'arc',    c:{x,y}, r, a0, a1}      // 恆為 a0→a1 逆時針,弧度
{type:'circle', c:{x,y}, r}
```
`snap` 的 `tol` 是圖面單位:螢幕像素 ÷ 縮放比。呼叫端先用視窗裁切 prims。
同距離時優先序:端點 > 交點 > 中點 > 圓心。

已知限制:橢圓、spline 還沒有吸附;INSERT 內物件的吸附要由呼叫端先套變換矩陣再丟進來。

## units.js【已完成並有測試】
```
unitFromInsUnits(code) -> {name,toMeters} | null     // 0 與未知代碼都回 null
unitByName(name)
convertLength(v, from, to)   // from/to 為 null 時丟 RangeError
convertArea(v, from, to)
calibrate(measuredDrawing, knownLength, knownUnit) -> {name:null,toMeters}
```

## 入口:parse-client.js → parse-worker.js【已完成並有測試:tests/worker.test.js、client.test.js】
```js
import { createParseClient } from './core/parse-client.js';
const client = createParseClient({ workerUrl: '/core/parse-worker.js' });   // 同源 module worker
const job = client.parse(file, { timeoutMs: 120000, onStage: (s) => {} });   // s: 'reading' | 'building'
const { scene, stats, large } = await job.promise;   // stats:{readMs,buildMs,bytes};large = 超過 30 MB(30,000,000 B,十進位)
job.cancel();      // 取消 = worker.terminate()(解析是同步的,這是唯一的中斷方式),promise 以 code 'cancelled' 拒絕
client.dispose();  // 頁面關閉或釋放記憶體
```
錯誤是 `Error`,帶 `.code`:`too-large`(>65 MB = 65,000,000 B,十進位,不開 Worker;恰好等於上限可開)、`cancelled`、`timeout`、`not-cad`、`parse-failed`、`empty`(Model 空間沒內容)、`worker-crashed`。
取消、逾時後下一次 `parse` 自動重建 Worker。**「上次開啟時被系統中止」的標記不在這裡**:iOS 殺掉整個頁面時我們收不到事件,要由 App 層在 `parse` 前寫標記、`result` 後清除。

常數 `HARD_LIMIT_BYTES`(65,000,000)、`LARGE_WARN_BYTES`(30,000,000)從 `parse-client.js` 匯出;顯示檔案大小請用 `format.js` 的 `formatBytes`(十進位,62,714,655 → "62.7 MB"),判斷與顯示同一種算法。

直接用訊息(不經 client)的格式寫在 `parse-worker.js` 檔頭。

## scene(場景資料)【已實作,以 core/scene.js 為準】
`scene` 是純資料,可 structured clone;大陣列都是型別陣列(Worker 以 transfer 傳回,零複製)。
```
scene = {
  version: 1, format: 'dwg'|'dxf',
  unit: {name,toMeters} | null,  insUnits,   // null = 圖面沒設定單位,UI 要讓使用者看得到並可改
  codePage,                                   // 例如 'big5'
  extents: {min:{x,y}, max:{x,y}} | null,     // 只含 Model 空間;文字只算插入點
  layers: [{name, color:0xRRGGBB, visible, lineType}],
  model:  Space,                              // Model 空間
  protos: [Space],                            // 圖塊原型,以 index 為 id;INSERT 不展開
  dimensions: [Dim],                          // Model 空間的標註(見下)
  skipped: {count, byType},                   // 「已略過 N 個物件」要顯示
  ignored: number,                            // 刻意不顯示的(圖塊內 ATTDEF),不算 skipped
  warnings: [string]                          // 已去重,附 ×次數
}
Space = {
  id, name, bbox:[minx,miny,maxx,maxy]|null,
  lines:   Float64Array [x1,y1,x2,y2]*n,        lineAttr:   Int32Array [layer,color]*n
  arcs:    Float64Array [cx,cy,r,a0,a1]*n,      arcAttr:    …    // 弧度,a0→a1 逆時針
  circles: Float64Array [cx,cy,r]*n,            circleAttr: …
  polys:   {pts:Float64Array [x,y]*, bulges:Float64Array,   // 與 pts 同長
            offsets:Uint32Array(n+1)  // 第 i 條 = 頂點 offsets[i]..offsets[i+1]
            closed:Uint8Array(n), attr:Int32Array [layer,color]*n}
  points:  Float64Array [x,y]*n,                pointAttr: …
  solids:  Float64Array 8 個數/個(4 角,已排成多邊形順序),solidAttr
  inserts: {m:Float64Array [a,b,c,d,e,f]*n, proto:Int32Array, attr:Int32Array [layer,color]*n}
  texts:   [{x,y,h,rot,wf,str,mtext,layer,color, ha,va (TEXT) | attach,width (MTEXT)}]   // str 已純文字化,\n 為換行
  hatches: [{loops:[Float64Array [x,y]*], loopFlags:Uint8Array, solid, pattern, layer, color}]   // 邊界已取樣成折線;loopFlags: 1=邊界不連續或含未支援邊、2=含弧邊(取樣)
}
```
・ **color**:`-1` ByLayer、`-2` ByBlock、`>=0` 為 0xRRGGBB(ACI 已換成 RGB)。**layer**:`layers` 的 index,`-1` = 找不到。
・ **矩陣** `m=[a,b,c,d,e,f]`:`x' = a·x + c·y + e,y' = b·x + d·y + f`,與 Canvas `ctx.transform(a,b,c,d,e,f)` 同一慣例。巢狀 INSERT 由渲染端累乘。
・ **ByBlock 與圖層 "0"**:一般圖塊原型保留 `-2`(ByBlock),渲染時用 INSERT 的顏色;圖層 "0" 的物件渲染時繼承 INSERT 的圖層。**標註專屬圖塊例外,我已在解析端就地解好,你不用處理。**
・ **平面化**:忽略 Z。OCS 法向朝 −Z 的物件已鏡射到世界座標;法向偏離 Z 軸超過 1e-5 rad 的物件(真的傾斜平面)計入 skipped。
・ 橢圓、橢圓弧、spline 已在解析端取樣成折線(橢圓 64 段/整圈,spline 最多 400 點)。
・ 圖塊內的 ATTRIB(INSERT 的屬性值)已輸出成一般文字。

### Dim(標註)
```
{ kind:'linear'|'aligned'|'radial'|'diameter'|'angular3'|'angular2'|'ordinate',
  proto,                    // 標註專屬圖塊,以單位矩陣畫(座標已是世界座標)
  p1,p2,rotation,           // 僅 linear/aligned:量測端點(可當吸附點);rotation 僅 linear
  defPoint, textPos, textRot,
  textOverride,             // "<>" 或 "" = 用量測值;" " = 隱藏文字;其他照寫
  measurement,              // 圖面單位
  layer, color, styleName }
```
圖塊內的標註(標註在 INSERT 的圖塊裡面)不在 `dimensions`,而是該圖塊 `inserts` 裡一筆單位矩陣的 INSERT,跟著外層變換。
沒有圖塊的標註計入 `skipped.byType['dimension-no-block']`(備援推導尚未實作)。

## query.js:鎖點【已完成並有測試:tests/query.test.js】
```js
import { snapAt, collectPrims } from './core/query.js';
const hit = snapAt(scene, {x, y}, tolWorld, modes?);   // tolWorld = 螢幕像素 ÷ 縮放比;modes 預設四種全開
// hit → {type:'endpoint'|'midpoint'|'center'|'intersection', point:{x,y}, dist} | null
```
・ 直接吃 `scene`(`model`、`protos`、`dimensions`),處理 INSERT 巢狀變換、多段線 bulge 弧、鏡射、圖層可見性(讀 `scene.layers[i].visible`,切換圖層後立即生效)。
・ `hit.type` 供渲染端決定鎖點框形狀:端點方形、中點三角形、圓心圓形、交點叉形(莉芽定案)。
・ 同距離優先序:端點 > 交點 > 中點 > 圓心。交點只取離游標最近的 40 個基本形互相求交(O(n²) 的上限)。
・ 實測(桌機,中圖(約 10 MB)97k 線,隨機 300 點):中位 1.3 ms、p95 4.6 ms。手機未測,預期慢數倍,所以 pointermove 建議節流,放開手指與長按放大鏡時再精確鎖點。
・ 限制:INSERT 若有非等比縮放,其內的圓與弧不參與鎖點;橢圓與 spline 是取樣後的折線,只鎖得到折線頂點;Hatch、Solid、文字不鎖。

## pick.js:封閉物件拾取與量測【已完成並有測試:tests/pick.test.js】
```js
import { pickClosed } from './core/pick.js';
const r = pickClosed(scene, {x, y}, tolWorld);   // 點「邊界」,不是點內部;tolWorld = 螢幕像素 ÷ 縮放比
```
`r.status` 三種,UI 必須分開處理:
・ `'miss'`:容差內沒有任何可見的封閉邊界。
・ `'ok'`:`{kind:'circle'|'polyline'|'hatch', area, perimeter, unit, outline, layer, layerName, holes?, approximate?}`
・ `'unreliable'`:命中但不能給數字:`{kind, reason, outline, layer, layerName, unit}`(沒有 area/perimeter)。UI 顯示「無法可靠量測」與原因,**不要顯示讀數**。
  reason:`non-uniform-scale`(含弧或圓的物件在非等比縮放的圖塊內)、`self-intersecting`(自交或線段重疊)、`hatch-incomplete`(邊界不連續或含未支援的邊,如橢圓弧、spline)、`hatch-loops-cross`(迴圈互相交叉,拓撲不確定)。

單位:`area` 恆為**圖面單位²**,`perimeter` 為**圖面單位**,`unit` = `scene.unit`(`null` 表示沒設定單位;數字照回傳,UI 標「圖面單位」,不加 mm、m²)。有單位時由顯示層用 `units.convertArea` / `convertLength` 換算。
・ 封閉多段線:含 bulge 弧,精確解;`closed` 旗標或首尾重合(≥4 點)都算封閉;開放多段線不命中。
・ 圓:πr²、2πr。
・ Hatch:面積 = 奇偶規則(外框 − 孔 + 孔內島…),**周長 = 全部有效邊界長度(含孔)**;`holes` = 位於其他迴圈內的迴圈數。弧邊界已取樣(整圓 256 段,面積誤差約 0.01%),此時 `approximate: true`。
・ INSERT 巢狀:等比縮放 s → 面積×s²、周長×s;鏡射不影響。非等比縮放:直線邊多邊形仍可算(面積×|det|);含弧或圓不成立 → `unreliable`。
・ 圖層關閉的物件不命中。多個候選時取最近的邊界。
・ 實測(桌機)小圖 A:14 個 Hatch 中 11 個 ok、3 個 hatch-incomplete;145 個封閉多段線全 ok;24 個圓全 ok。中圖(992 ok / 104 incomplete / 48 loops-cross 的 Hatch;3739 個封閉多段線 ok)。單次拾取中位 0.85 ms、最大 5 ms。
・ 尚未做:點內部拾取;Hatch 迴圈只依奇偶規則,沒有處理「孤島 Hatch」的 AutoCAD 偵測樣式(普通/外部/忽略)。

## 實測證據(桌機 Node v26,acad-ts 3.9.0;手機尚未測)
| 檔案 | 大小 | 讀取 | 轉場景 | 峰值 RSS | 備註 |
|---|---|---|---|---|---|
| 小圖 A | 1.7 MB | 245 ms | 3 ms | — | 2182 線、20 標註,skipped 0 |
| 小圖 B | 1.0 MB | 146 ms | 5 ms | — | skipped 69(全是 Wipeout) |
| 中圖 | 10.1 MB | 2.5 s | 41 ms | 1.27 GB | 97,254 線,與計畫記載相符 |
| 大圖 | 62.7 MB(十進位;59.8 MiB) | 7.5 s | 0.4 s | 2.39 GB | 圖塊原型 1517、skipped 60(MLeader 50、Leader 2、空 Hatch 6、橢圓弧邊界 2) |
・ 峰值記憶體發生在 acad-ts 讀取(它先建完整物件圖,我們才精簡),不是場景資料。**手機能否撐住 62.7 MB 那張,只有 iPhone 實測才知道。**
・ 出貨 bundle 與 npm 套件輸出一致(同一批 DWG 逐項比對:線/弧/圓/多段線/文字/標註數、extents、skipped 全同)。
・ 標註獨立檢查:123 個線性標註,|由 p1/p2/rotation 算出的長度 − DIMENSION.measurement| ≤ 3e-14(`node tools/check-dims.mjs`)。

## 尚未驗證(不要當成已知)
・ 對齊、角度、半徑、直徑、座標標註(樣本只出現線性)。
・ 實心箭頭、圖塊內 Hatch。
・ 無匿名圖塊的標註(DXF 或被清理過的圖)的備援推導:未實作,目前計入 skipped。
・ 瀏覽器內真實 Worker 載入 bundle(Safari/Chrome):Node 以假 self 驗證過訊息流程,真瀏覽器尚未跑。
・ 未支援且已在 skipped 回報:MLeader、Leader、Wipeout、橢圓弧/spline 的填充邊界、傾斜平面物件。線型(虛線)尚未輸出。
・ MText 複雜格式碼(堆疊、欄位、%%c / %%d)。
・ 巢狀 INSERT 內的標註變換。
・ DXF 路徑只用合成測資驗證過(tests/fixtures/mini.dxf);真實 DXF(含舊版、Big5 無 codepage 標頭)未測。
・ R12(AC1009)圖檔。
・ 手機上的速度與記憶體。
