// acad-ts 文件物件 → 精簡場景資料(型別陣列為主,可用 postMessage 轉移)。
// 不 import acad-ts:呼叫端(parse-worker.js 或測試)傳入已解析的 doc,所以可以在 Node 測試。
// 重要:型別分派一律用 subclassMarker(DXF 類別名),不用 constructor.name——壓縮後類別名會被改掉。
// 規則:INSERT 不展開(只存圖塊原型 + 變換矩陣);無法辨識的物件計入 skipped,不假裝完整。
// 版面:只處理 Model 空間(計畫第 2 節)。
//
// 顏色欄位 color:-1 = ByLayer、-2 = ByBlock、>=0 = 0xRRGGBB。ACI 索引在這裡就換成 RGB。
// 矩陣 m = [a,b,c,d,e,f]:x' = a·x + c·y + e,y' = b·x + d·y + f(Canvas 2D 同一慣例)。
import { unitFromInsUnits } from './units.js';

const TAU = Math.PI * 2;

/* ---------- 可增長型別陣列 ---------- */
class Grow {
  constructor(Type = Float64Array, cap = 64) { this.T = Type; this.a = new Type(cap); this.n = 0; }
  push(...v) {
    if (this.n + v.length > this.a.length) {
      const b = new this.T(Math.max(this.a.length * 2, this.n + v.length));
      b.set(this.a); this.a = b;
    }
    for (const x of v) this.a[this.n++] = x;
  }
  done() { return this.a.slice(0, this.n); }
}

/* ---------- MText 純文字化 ---------- */
// 常見格式碼:\P 換行、\~ 不斷行空白、{ } 群組、\f \H \C \A \Q \T \W \L \O \K 等屬性碼(到 ; 為止)、
// \S 堆疊分數(a/b、a^b、a#b)、\U+XXXX、\\ \{ \}、%%c %%d %%p。
export function mtextToPlain(src) {
  let s = String(src ?? '');
  s = s.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  s = s.replace(/\\S([^;]*);/g, (_, f) => f.replace(/[\^#]/g, '/'));
  s = s.replace(/\\P/g, '\n');
  s = s.replace(/\\p[^;\\]*;/g, '');                                      // \pt..; 段落設定
  s = s.replace(/\\~/g, ' ');
  s = s.replace(/\\[fFHhCcAaQqTtWw][^;]*;/g, '');
  s = s.replace(/\\[LlOoKk]/g, '');
  s = s.replace(/\\([\\{}])/g, '\u0000$1');
  s = s.replace(/[{}]/g, '');
  s = s.replace(/\u0000([\\{}])/g, '$1');
  return decodeSpecial(s);
}
export function decodeSpecial(s) {
  return String(s ?? '').replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±').replace(/%%%/g, '%');
}

/* ---------- 顏色 ---------- */
const packRgb = (r, g, b) => (r << 16) | (g << 8) | b;
function colorCode(c) {
  if (!c || c.isByLayer) return -1;
  if (c.isByBlock) return -2;
  if (c.isTrueColor) return packRgb(c.r, c.g, c.b);
  const rgb = c.getRgb?.();
  return rgb ? packRgb(rgb[0], rgb[1], rgb[2]) : -1;
}

/* ---------- 矩陣 ---------- */
const IDENT = [1, 0, 0, 1, 0, 0];
const mul = (n, m) => [ // n ∘ m:先 m 後 n
  n[0] * m[0] + n[2] * m[1], n[1] * m[0] + n[3] * m[1],
  n[0] * m[2] + n[2] * m[3], n[1] * m[2] + n[3] * m[3],
  n[0] * m[4] + n[2] * m[5] + n[4], n[1] * m[4] + n[3] * m[5] + n[5],
];
const MIRROR_X = [-1, 0, 0, 1, 0, 0];

/** OCS 判斷:法向 (0,0,±1) 以外視為傾斜平面,第一版不處理(計入 skipped)。回傳 {mirror} 或 null。 */
function ocsOf(e) {
  const n = e.normal;
  if (!n) return { mirror: false };
  // 容許浮點雜訊:實測有圖的法向是 (-2.2e-6, 0, 0.99999999999),實質上仍朝 +Z。門檻 1e-5 rad。
  if (Math.abs(n.x) > 1e-5 || Math.abs(n.y) > 1e-5) return null;
  return { mirror: n.z < 0 };
}

/* ---------- 空間(Model 或圖塊原型) ---------- */
class Space {
  constructor(id, name) {
    this.id = id; this.name = name;
    this.lines = new Grow(); this.lineAttr = new Grow(Int32Array);
    this.arcs = new Grow(); this.arcAttr = new Grow(Int32Array);
    this.circles = new Grow(); this.circleAttr = new Grow(Int32Array);
    this.polyPts = new Grow(); this.polyBulge = new Grow(); this.polyOff = new Grow(Uint32Array); this.polyClosed = new Grow(Uint8Array);
    this.polyAttr = new Grow(Int32Array); this.polyOff.push(0);
    this.points = new Grow(); this.pointAttr = new Grow(Int32Array);
    this.solids = new Grow(); this.solidAttr = new Grow(Int32Array);      // 每個 8 個數(4 角,已排成多邊形順序)
    this.insM = new Grow(); this.insProto = new Grow(Int32Array); this.insAttr = new Grow(Int32Array);
    this.texts = []; this.hatches = [];
    this.bb = [Infinity, Infinity, -Infinity, -Infinity];
  }
  grow(x, y) { const b = this.bb; if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y; }
  addLine(x1, y1, x2, y2, at) { this.lines.push(x1, y1, x2, y2); this.lineAttr.push(...at); this.grow(x1, y1); this.grow(x2, y2); }
  addArc(cx, cy, r, a0, a1, at) { this.arcs.push(cx, cy, r, a0, a1); this.arcAttr.push(...at); this.grow(cx - r, cy - r); this.grow(cx + r, cy + r); }
  addCircle(cx, cy, r, at) { this.circles.push(cx, cy, r); this.circleAttr.push(...at); this.grow(cx - r, cy - r); this.grow(cx + r, cy + r); }
  addPoly(pts, bulges, closed, at) { // pts: [{x,y}],bulges: number[]|null
    for (let i = 0; i < pts.length; i++) { this.polyPts.push(pts[i].x, pts[i].y); this.polyBulge.push(bulges?.[i] ?? 0); this.grow(pts[i].x, pts[i].y); }
    this.polyOff.push(this.polyBulge.n); this.polyClosed.push(closed ? 1 : 0); this.polyAttr.push(...at);
  }
  addPoint(x, y, at) { this.points.push(x, y); this.pointAttr.push(...at); this.grow(x, y); }
  addSolid(p, at) { for (const q of [p[0], p[1], p[3], p[2]]) { this.solids.push(q.x, q.y); this.grow(q.x, q.y); } this.solidAttr.push(...at); }
  addText(t) { this.texts.push(t); this.grow(t.x, t.y); }
  addInsert(m, proto, at, protoBB) {
    this.insM.push(...m); this.insProto.push(proto); this.insAttr.push(...at);
    if (protoBB && protoBB[0] <= protoBB[2]) {
      for (const [x, y] of [[protoBB[0], protoBB[1]], [protoBB[2], protoBB[1]], [protoBB[0], protoBB[3]], [protoBB[2], protoBB[3]]])
        this.grow(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]);
    }
  }
  finish() {
    return {
      id: this.id, name: this.name, bbox: this.bb[0] <= this.bb[2] ? this.bb : null,
      lines: this.lines.done(), lineAttr: this.lineAttr.done(),
      arcs: this.arcs.done(), arcAttr: this.arcAttr.done(),
      circles: this.circles.done(), circleAttr: this.circleAttr.done(),
      polys: { pts: this.polyPts.done(), bulges: this.polyBulge.done(), offsets: this.polyOff.done(), closed: this.polyClosed.done(), attr: this.polyAttr.done() },
      points: this.points.done(), pointAttr: this.pointAttr.done(),
      solids: this.solids.done(), solidAttr: this.solidAttr.done(),
      inserts: { m: this.insM.done(), proto: this.insProto.done(), attr: this.insAttr.done() },
      texts: this.texts, hatches: this.hatches,
    };
  }
}

/* ---------- 曲線取樣 ---------- */
function ellipsePoints(c, major, ratio, t0, t1) {
  let sweep = t1 - t0; if (sweep <= 0) sweep += TAU;
  const n = Math.max(8, Math.ceil((sweep / TAU) * 64));
  const ux = major.x, uy = major.y, vx = -uy * ratio, vy = ux * ratio;
  const out = [];
  for (let i = 0; i <= n; i++) { const t = t0 + (sweep * i) / n; out.push({ x: c.x + ux * Math.cos(t) + vx * Math.sin(t), y: c.y + uy * Math.cos(t) + vy * Math.sin(t) }); }
  return { pts: out, closed: Math.abs(sweep - TAU) < 1e-9 };
}

function bsplinePoints(ctrl, knots, deg, weights) {
  const n = ctrl.length, N = Math.min(400, Math.max(16, n * 8));
  const t0 = knots[deg], t1 = knots[n];
  const rational = weights && weights.length === n;
  const out = [];
  for (let s = 0; s <= N; s++) {
    const t = s === N ? t1 - 1e-12 * Math.abs(t1 - t0) : t0 + ((t1 - t0) * s) / N;
    let k = deg; while (k < n - 1 && t >= knots[k + 1]) k++;
    const d = [];
    for (let j = 0; j <= deg; j++) { const p = ctrl[j + k - deg], w = rational ? weights[j + k - deg] : 1; d.push([p.x * w, p.y * w, w]); }
    for (let r = 1; r <= deg; r++) for (let j = deg; j >= r; j--) {
      const den = knots[j + 1 + k - r] - knots[j + k - deg];
      const a = den === 0 ? 0 : (t - knots[j + k - deg]) / den;
      d[j] = [(1 - a) * d[j - 1][0] + a * d[j][0], (1 - a) * d[j - 1][1] + a * d[j][1], (1 - a) * d[j - 1][2] + a * d[j][2]];
    }
    out.push({ x: d[deg][0] / d[deg][2], y: d[deg][1] / d[deg][2] });
  }
  return out;
}

/* ---------- 主入口 ---------- */
/**
 * @param doc  acad-ts CadDocument
 * @param opts {warnings?: string[]}  讀取時收到的警告
 */
export function buildScene(doc, opts = {}) {
  const skipped = { count: 0, byType: {} };
  let ignored = 0;
  const skip = (kind) => { skipped.count++; skipped.byType[kind] = (skipped.byType[kind] || 0) + 1; };

  // 圖層
  const layers = [], layerIdx = new Map();
  for (const l of doc.layers) {
    layerIdx.set(l.name, layers.length);
    layers.push({
      name: l.name, color: colorCode(l.color) >= 0 ? colorCode(l.color) : 0xffffff,
      visible: !!l.isOn && !((l.flags ?? 0) & 1), lineType: l.lineType?.name ?? 'Continuous',
    });
  }
  const layerOf = (e) => layerIdx.get(e.layer?.name) ?? -1;
  // ov:標註專屬圖塊的就地解析。圖層 "0" 的物件繼承標註圖層;ByBlock 顏色用標註顏色。
  const attrOf = (e, ov) => [ov && e.layer?.name === '0' ? ov.layer : layerOf(e), ov && colorCode(e.color) === -2 ? ov.color : colorCode(e.color)];

  const protos = [];            // 已完成的原型(index = id)
  const protoByHandle = new Map();
  const building = new Set();

  function protoFor(block, ov) {
    const key = ov ? `d${block.handle}` : block.handle;
    if (protoByHandle.has(key)) return protoByHandle.get(key);
    if (building.has(key)) { skip('recursive-insert'); return null; }
    building.add(key);
    const id = protos.length; protos.push(null);
    protoByHandle.set(key, id);
    const sp = new Space(id, block.name);
    for (const e of block.entities) addEntity(sp, e, ov);
    protos[id] = sp.finish();
    building.delete(key);
    return id;
  }

  const dimensions = [];

  function addEntity(sp, e, ov) {
    if (e.isInvisible) return;
    const k = e.subclassMarker;
    try {
      switch (k) {
        case 'AcDbLine': {
          const at = attrOf(e, ov);
          sp.addLine(e.startPoint.x, e.startPoint.y, e.endPoint.x, e.endPoint.y, at); return;
        }
        case 'AcDbCircle': {
          const o = ocsOf(e); if (!o) return skip('tilted-' + k);
          sp.addCircle(o.mirror ? -e.center.x : e.center.x, e.center.y, e.radius, attrOf(e, ov)); return;
        }
        case 'AcDbArc': {
          const o = ocsOf(e); if (!o) return skip('tilted-' + k);
          let a0 = e.startAngle, a1 = e.endAngle, cx = e.center.x;
          if (o.mirror) { cx = -cx; [a0, a1] = [Math.PI - a1, Math.PI - a0]; }
          sp.addArc(cx, e.center.y, e.radius, a0, a1, attrOf(e, ov)); return;
        }
        case 'AcDbPolyline': case 'AcDb2dPolyline': {
          const o = ocsOf(e); if (!o) return skip('tilted-' + k);
          const f = o.mirror ? -1 : 1;
          const pts = e.vertices.map((v) => ({ x: f * v.location.x, y: v.location.y }));
          const bl = e.vertices.map((v) => f * (v.bulge || 0));
          if (pts.length >= 2) sp.addPoly(pts, bl, !!e.isClosed, attrOf(e, ov)); return;
        }
        case 'AcDb3dPolyline': {
          const vs = e.vertices ?? [];
          const pts = vs.map((v) => ({ x: v.location.x, y: v.location.y }));
          if (pts.length >= 2) sp.addPoly(pts, null, !!e.isClosed, attrOf(e, ov)); return;
        }
        case 'AcDbEllipse': {
          const o = ocsOf(e); if (!o) return skip('tilted-' + k);
          const f = o.mirror ? -1 : 1;
          const { pts, closed } = ellipsePoints({ x: f * e.center.x, y: e.center.y }, { x: f * e.majorAxisEndPoint.x, y: e.majorAxisEndPoint.y }, e.radiusRatio, e.startParameter, e.endParameter);
          sp.addPoly(pts, null, closed, attrOf(e, ov)); return;
        }
        case 'AcDbSpline': {
          const cp = e.controlPoints ?? [];
          let pts;
          if (cp.length > e.degree && e.knots?.length >= cp.length + e.degree + 1) pts = bsplinePoints(cp, e.knots, e.degree, e.weights);
          else pts = (e.fitPoints?.length ? e.fitPoints : cp).map((p) => ({ x: p.x, y: p.y }));
          if (pts.length >= 2) sp.addPoly(pts, null, false, attrOf(e, ov)); return;
        }
        case 'AcDbPoint': sp.addPoint(e.location.x, e.location.y, attrOf(e, ov)); return;
        case 'AcDbTrace': case 'AcDbSolid': sp.addSolid([e.firstCorner, e.secondCorner, e.thirdCorner, e.fourthCorner], attrOf(e, ov)); return;
        case 'AcDbText': {
          const o = ocsOf(e); if (!o) return skip('tilted-' + k);
          const ha = e.horizontalAlignment ?? 0, va = e.verticalAlignment ?? 0;
          const p = (ha === 0 && va === 0) || ha === 3 || ha === 5 ? e.insertPoint : e.alignmentPoint;
          const [layer, color] = attrOf(e, ov);
          sp.addText({ x: o.mirror ? -p.x : p.x, y: p.y, h: e.height, rot: o.mirror ? Math.PI - e.rotation : e.rotation, wf: e.widthFactor || 1, ha, va, str: decodeSpecial(e.value), mtext: false, layer, color });
          return;
        }
        case 'AcDbMText': {
          const o = ocsOf(e); if (!o) return skip('tilted-' + k);
          const ax = e.alignmentPoint ?? { x: 1, y: 0 };
          const rot = Math.atan2(ax.y, ax.x);
          const [layer, color] = attrOf(e, ov);
          sp.addText({ x: o.mirror ? -e.insertPoint.x : e.insertPoint.x, y: e.insertPoint.y, h: e.height, rot: o.mirror ? Math.PI - rot : rot, wf: 1, attach: e.attachmentPoint ?? 1, width: e.rectangleWidth || 0, str: mtextToPlain(e.value), mtext: true, layer, color });
          return;
        }
        case 'AcDbHatch': {
          // 每個迴圈附旗標 loopFlags:1 = 邊界不連續或含未支援的邊(面積不可靠);2 = 含弧邊(已取樣,有微小誤差)
          const loops = [], flags = [];
          const GAP = 1e-6;
          for (const path of e.paths) {
            const pts = []; let flag = 0;
            const add = (x, y) => { const l = pts[pts.length - 1]; if (!l || Math.abs(l.x - x) > 1e-12 || Math.abs(l.y - y) > 1e-12) pts.push({ x, y }); };
            const join = (x, y) => { const l = pts[pts.length - 1]; if (l && Math.hypot(l.x - x, l.y - y) > GAP) flag |= 1; };
            for (const ed of path.edges) {
              switch (ed.type) {
                case 0: { // 折線路徑(bulge 弧段未展開:有 bulge 時標記為取樣不精確→不可靠)
                  const vs = ed.vertices; if (vs.length) join(vs[0].x, vs[0].y);
                  if (ed.hasBulge && (ed.bulges ?? []).some((b) => Math.abs(b) > 1e-12)) flag |= 1;
                  for (const v of vs) add(v.x, v.y);
                  break;
                }
                case 1: join(ed.start.x, ed.start.y); add(ed.start.x, ed.start.y); add(ed.end.x, ed.end.y); break;
                case 2: { // 圓弧邊:counterClockWise 決定從 start 沿哪個方向走到 end
                  const ccw = ed.counterClockWise;
                  let sw = ccw ? ed.endAngle - ed.startAngle : ed.startAngle - ed.endAngle;
                  sw = ((sw % TAU) + TAU) % TAU || TAU;
                  const n = Math.max(8, Math.ceil((sw / TAU) * 256)); // 整圓 256 段:面積誤差約 0.01%
                  flag |= 2;
                  for (let i = 0; i <= n; i++) {
                    const a = ccw ? ed.startAngle + (sw * i) / n : ed.startAngle - (sw * i) / n;
                    const x = ed.center.x + ed.radius * Math.cos(a), y = ed.center.y + ed.radius * Math.sin(a);
                    if (i === 0) join(x, y);
                    add(x, y);
                  }
                  break;
                }
                default: flag |= 1; skip('hatch-edge-' + ed.type); // 橢圓弧、spline 邊界:未支援,迴圈標為不可靠
              }
            }
            if (pts.length >= 2) { const f = pts[0], l = pts[pts.length - 1]; if (Math.hypot(f.x - l.x, f.y - l.y) > GAP) flag |= 1; else if (pts.length > 1) pts.pop(); }
            if (pts.length >= 3) { loops.push(pts); flags.push(flag); }
          }
          if (!loops.length) return skip('hatch-empty');
          const [layer, color] = attrOf(e, ov);
          const flat = loops.map((l) => { const a = new Float64Array(l.length * 2); l.forEach((p, i) => { a[2 * i] = p.x; a[2 * i + 1] = p.y; sp.grow(p.x, p.y); }); return a; });
          sp.hatches.push({ loops: flat, loopFlags: Uint8Array.from(flags), solid: !!e.isSolid, pattern: e.pattern?.name ?? '', layer, color });
          return;
        }
        case 'AcDbBlockReference': {
          const o = ocsOf(e); if (!o) return skip('tilted-' + k);
          const block = e.block; if (!block) return skip('insert-no-block');
          const pid = protoFor(block, null); if (pid == null) return;
          const rows = Math.max(1, e.rowCount || 1), cols = Math.max(1, e.columnCount || 1);
          if (rows * cols > 100000) return skip('minsert-too-large');
          const cr = Math.cos(e.rotation), sr = Math.sin(e.rotation);
          const at = attrOf(e, ov);
          for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            // 位移在旋轉後的方向上排列(MINSERT 的列/欄間距沿插入旋轉方向)
            const dx = c * (e.columnSpacing || 0), dy = r * (e.rowSpacing || 0);
            let m = [cr * e.xScale, sr * e.xScale, -sr * e.yScale, cr * e.yScale,
              e.insertPoint.x + cr * dx - sr * dy, e.insertPoint.y + sr * dx + cr * dy];
            if (o.mirror) m = mul(MIRROR_X, m);
            sp.addInsert(m, pid, at, protos[pid]?.bbox);
          }
          for (const a of e.attributes ?? []) if (!a.isInvisible && a.value) addEntity(sp, { subclassMarker: 'AcDbText', isInvisible: false, handle: a.handle, normal: a.normal, insertPoint: a.insertPoint, alignmentPoint: a.alignmentPoint, height: a.height, rotation: a.rotation, widthFactor: a.widthFactor, value: a.value, horizontalAlignment: a.horizontalAlignment, verticalAlignment: a.verticalAlignment, layer: a.layer, color: a.color }, ov);
          return;
        }
        case 'AcDbRotatedDimension': case 'AcDbAlignedDimension': case 'AcDbRadialDimension': case 'AcDbDiametricDimension':
        case 'AcDb3PointAngularDimension': case 'AcDb2LineAngularDimension': case 'AcDbOrdinateDimension': {
          const block = e.block;
          const kind = { AcDbRotatedDimension: 'linear', AcDbAlignedDimension: 'aligned', AcDbRadialDimension: 'radial', AcDbDiametricDimension: 'diameter', AcDb3PointAngularDimension: 'angular3', AcDb2LineAngularDimension: 'angular2', AcDbOrdinateDimension: 'ordinate' }[k];
          if (!block) return skip('dimension-no-block'); // 備援推導尚未實作
          // 標註圖塊是這個標註專屬:ByBlock/圖層 0 在此就地解析(其他圖塊要等渲染時用 INSERT 的值)
          const at = attrOf(e, ov);
          const pid = protoFor(block, { layer: at[0], color: at[1] });
          if (pid == null) return;
          const d = { kind, proto: pid, textOverride: e.text ?? '', measurement: e.measurement, textPos: pt2(e.textMiddlePoint), textRot: e.textRotation || 0, defPoint: pt2(e.definitionPoint), layer: at[0], color: at[1], styleName: e.style?.name ?? '' };
          if (kind === 'linear' || kind === 'aligned') { d.p1 = pt2(e.firstPoint); d.p2 = pt2(e.secondPoint); }
          if (kind === 'linear') d.rotation = e.rotation;
          const bb = protos[pid]?.bbox;
          if (sp.id === -1) dimensions.push(d);          // Model 空間的標註:世界座標,以單位矩陣畫
          else sp.addInsert(IDENT, pid, at, bb);          // 圖塊內的標註:跟著該圖塊的 INSERT 變換,不能進全域清單
          if (sp.id === -1 && bb) { sp.grow(bb[0], bb[1]); sp.grow(bb[2], bb[3]); }
          return;
        }
        case 'AcDbAttributeDefinition': ignored++; return; // 圖塊內的屬性定義不直接顯示(顯示的是 INSERT 的 ATTRIB)
        default: skip(k || 'unknown');
      }
    } catch (err) {
      skip('error-' + k);
      (opts.warnings ??= []).push(`entity ${k} handle=${e.handle}: ${err.message}`);
    }
  }

  const pt2 = (p) => (p ? { x: p.x, y: p.y } : null);

  const model = new Space(-1, '*Model_Space');
  for (const e of doc.modelSpace.entities) addEntity(model, e, null);
  const modelOut = model.finish();

  // 警告去重:同一則訊息只留一次,附次數
  const wc = new Map();
  for (const w of opts.warnings ?? []) wc.set(w, (wc.get(w) || 0) + 1);
  const warnings = [...wc].map(([m, n]) => (n > 1 ? `${m} ×${n}` : m));

  return {
    version: 1,
    unit: unitFromInsUnits(doc.header.insUnits), insUnits: doc.header.insUnits ?? 0,
    codePage: doc.header.codePage ?? null,
    extents: modelOut.bbox ? { min: { x: modelOut.bbox[0], y: modelOut.bbox[1] }, max: { x: modelOut.bbox[2], y: modelOut.bbox[3] } } : null,
    layers, model: modelOut, protos, dimensions, skipped, ignored, warnings,
  };
}

/** 收集可轉移的 ArrayBuffer,給 postMessage 的第二個參數用(避免複製)。 */
export function collectTransferables(scene) {
  const set = new Set();
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (ArrayBuffer.isView(o)) { set.add(o.buffer); return; }
    if (Array.isArray(o)) { for (const x of o) walk(x); return; }
    for (const v of Object.values(o)) walk(v);
  };
  walk(scene.model); for (const p of scene.protos) walk(p);
  return [...set];
}

export const IDENTITY = IDENT;
