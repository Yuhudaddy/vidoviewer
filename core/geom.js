// VidoViewer 幾何核心。純函式、無相依、無 DOM。
// 座標與長度一律用「圖面單位」(drawing units);換算成 mm/m 只在顯示層做(見 units.js)。
// 角度內部用弧度、逆時針為正(與 DWG/DXF 一致);對外量測角度用度。
// 公式出處:
//   ・ bulge:AutoCAD DXF Reference, LWPOLYLINE group 42,bulge = tan(θ/4),正值 = 逆時針弧。
//   ・ 弓形面積 A = r²/2 · (θ − sin θ);弦長 c = 2r·sin(θ/2)。教科書通則。
//   ・ 多邊形面積:鞋帶公式 (shoelace)。

export const EPS = 1e-9;
const TAU = Math.PI * 2;

export const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
export const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** 把角度正規到 [0, 2π) */
export const norm = (a) => ((a % TAU) + TAU) % TAU;

/** 三點夾角(以 v 為頂點),回傳度數 [0,180]。任一臂長為 0 時丟錯,不回傳假數字。 */
export function angleAt(a, v, b) {
  const ux = a.x - v.x, uy = a.y - v.y, wx = b.x - v.x, wy = b.y - v.y;
  const lu = Math.hypot(ux, uy), lw = Math.hypot(wx, wy);
  if (lu < EPS || lw < EPS) throw new RangeError('angleAt: 臂長為 0,無法計算角度');
  // atan2(|cross|, dot) 在 0° 與 180° 附近比 acos 穩定
  return (Math.atan2(Math.abs(ux * wy - uy * wx), ux * wx + uy * wy) * 180) / Math.PI;
}

/** bulge → 弧資訊。回傳 null 表示直線段(bulge≈0)。 */
export function bulgeArc(p1, p2, bulge) {
  if (Math.abs(bulge) < EPS) return null;
  const c = dist(p1, p2);
  if (c < EPS) return null;
  const theta = 4 * Math.atan(Math.abs(bulge)); // 圓心角,(0, 2π)
  const r = c / (2 * Math.sin(theta / 2));
  const m = mid(p1, p2);
  // 弦的左法線(p1→p2 的逆時針 90°)
  const nx = -(p2.y - p1.y) / c, ny = (p2.x - p1.x) / c;
  // 圓心到弦中點距離 d = r·cos(θ/2)(θ>π 時為負,自動換邊)。
  // bulge>0(逆時針弧,凸向行進方向右側):圓心在弦的左側;bulge<0 鏡射,圓心在右側。
  const d = (bulge > 0 ? 1 : -1) * r * Math.cos(theta / 2);
  const center = { x: m.x + nx * d, y: m.y + ny * d };
  const a1 = Math.atan2(p1.y - center.y, p1.x - center.x);
  const a2 = Math.atan2(p2.y - center.y, p2.x - center.x);
  // 逆時針弧:從 start 到 end 逆時針。bulge<0 時是順時針,交換起訖讓 start→end 恆為逆時針。
  const ccw = bulge > 0;
  return { center, r, theta, ccw, start: ccw ? a1 : a2, end: ccw ? a2 : a1 };
}

export const arcLength = (r, theta) => r * theta;
export const segmentArea = (r, theta) => (r * r * (theta - Math.sin(theta))) / 2;

/** 多段線(含 bulge)分解成基本線段/弧。 */
export function explodePoly(pts, bulges, closed) {
  const n = pts.length, out = [];
  const m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const p1 = pts[i], p2 = pts[(i + 1) % n], b = bulges?.[i] ?? 0;
    const arc = bulgeArc(p1, p2, b);
    out.push(arc
      ? { type: 'arc', c: arc.center, r: arc.r, a0: arc.start, a1: arc.end, p1, p2 }
      : { type: 'line', p1, p2 });
  }
  return out;
}

/** 多段線長度(含弧段)。 */
export function polyLength(pts, bulges, closed) {
  let s = 0;
  const n = pts.length, m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) {
    const p1 = pts[i], p2 = pts[(i + 1) % n];
    const arc = bulgeArc(p1, p2, bulges?.[i] ?? 0);
    s += arc ? arcLength(arc.r, arc.theta) : dist(p1, p2);
  }
  return s;
}

/**
 * 多邊形面積與周長(含 bulge),視為封閉。至少 2 點,否則丟錯。
 * 自交多邊形的「面積」依鞋帶公式為代數和,呼叫端要自行提醒(selfIntersects 可檢查)。
 */
export function polyArea(pts, bulges) {
  // 2 點加 bulge 是合法的封閉形(半圓、弓形);無 bulge 時面積自然為 0
  if (pts.length < 2) throw new RangeError('polyArea: 至少需要 2 個點');
  const n = pts.length;
  let shoelace = 0, segs = 0;
  for (let i = 0; i < n; i++) {
    const p1 = pts[i], p2 = pts[(i + 1) % n];
    shoelace += p1.x * p2.y - p2.x * p1.y;
    const arc = bulgeArc(p1, p2, bulges?.[i] ?? 0);
    if (arc) segs += Math.sign(bulges[i]) * segmentArea(arc.r, arc.theta);
  }
  const signed = shoelace / 2 + segs;
  return { area: Math.abs(signed), perimeter: polyLength(pts, bulges, true), ccw: signed > 0 };
}

export const circleArea = (r) => ({ area: Math.PI * r * r, perimeter: TAU * r });

/* ---------- 交點 ---------- */

/** 線段 × 線段。平行/共線回傳 []。 */
export function segSeg(a, b, c, d) {
  const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < EPS) return [];
  const qx = c.x - a.x, qy = c.y - a.y;
  const t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return [];
  return [{ x: a.x + t * rx, y: a.y + t * ry }];
}

/** 線段 × 圓(整圓)。相切回傳 1 點。 */
export function segCircle(a, b, c, r) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const fx = a.x - c.x, fy = a.y - c.y;
  const A = dx * dx + dy * dy;
  if (A < EPS * EPS) return [];
  const B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - r * r;
  let disc = B * B - 4 * A * C;
  const tol = 1e-9 * Math.max(1, B * B);
  if (disc < -tol) return [];
  disc = Math.max(0, disc);
  const sq = Math.sqrt(disc), out = [];
  for (const t of disc === 0 ? [-B / (2 * A)] : [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) {
    if (t >= -EPS && t <= 1 + EPS) out.push({ x: a.x + t * dx, y: a.y + t * dy });
  }
  return out;
}

/** 圓 × 圓。 */
export function circleCircle(c1, r1, c2, r2) {
  const d = dist(c1, c2);
  if (d < EPS) return [];
  if (d > r1 + r2 + EPS || d < Math.abs(r1 - r2) - EPS) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h2 = r1 * r1 - a * a;
  const h = h2 > 0 ? Math.sqrt(h2) : 0;
  const ux = (c2.x - c1.x) / d, uy = (c2.y - c1.y) / d;
  const px = c1.x + a * ux, py = c1.y + a * uy;
  if (h === 0) return [{ x: px, y: py }];
  return [{ x: px - h * uy, y: py + h * ux }, { x: px + h * uy, y: py - h * ux }];
}

/** 點是否落在弧的角度範圍內(弧恆為 a0→a1 逆時針)。 */
export function onArcRange(p, c, a0, a1) {
  const a = norm(Math.atan2(p.y - c.y, p.x - c.x));
  const s = norm(a0), sweep = norm(a1 - a0) || TAU; // sweep=0 視為整圓
  return norm(a - s) <= sweep + 1e-9;
}

/** 兩個基本形(line | arc | circle)的交點。 */
export function intersect(p, q) {
  const asCircle = (s) => (s.type === 'line' ? null : { c: s.c, r: s.r });
  let pts = [];
  if (p.type === 'line' && q.type === 'line') return segSeg(p.p1, p.p2, q.p1, q.p2);
  if (p.type === 'line' || q.type === 'line') {
    const l = p.type === 'line' ? p : q, o = p.type === 'line' ? q : p;
    pts = segCircle(l.p1, l.p2, o.c, o.r);
    return o.type === 'arc' ? pts.filter((x) => onArcRange(x, o.c, o.a0, o.a1)) : pts;
  }
  const cp = asCircle(p), cq = asCircle(q);
  pts = circleCircle(cp.c, cp.r, cq.c, cq.r);
  if (p.type === 'arc') pts = pts.filter((x) => onArcRange(x, p.c, p.a0, p.a1));
  if (q.type === 'arc') pts = pts.filter((x) => onArcRange(x, q.c, q.a0, q.a1));
  return pts;
}

/* ---------- 點到形體距離與吸附 ---------- */

function distPointSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
  const t = L < EPS * EPS ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function distToPrim(p, s) {
  if (s.type === 'line') return distPointSeg(p, s.p1, s.p2);
  const dc = Math.abs(dist(p, s.c) - s.r);
  if (s.type === 'circle') return dc;
  if (onArcRange(p, s.c, s.a0, s.a1)) return dc;
  const e0 = { x: s.c.x + s.r * Math.cos(s.a0), y: s.c.y + s.r * Math.sin(s.a0) };
  const e1 = { x: s.c.x + s.r * Math.cos(s.a1), y: s.c.y + s.r * Math.sin(s.a1) };
  return Math.min(dist(p, e0), dist(p, e1));
}

const arcPoint = (s, a) => ({ x: s.c.x + s.r * Math.cos(a), y: s.c.y + s.r * Math.sin(a) });
// 同距離時的優先序:端點 > 交點 > 中點 > 圓心(數字小者優先)
export const MAX_INTERSECT_PRIMS = 40;
const PRIORITY = { endpoint: 0, intersection: 1, midpoint: 2, center: 3 };

/** 一個基本形自己的吸附點。 */
export function primSnapPoints(s, modes) {
  const out = [];
  if (s.type === 'line') {
    if (modes.endpoint) out.push({ type: 'endpoint', point: s.p1 }, { type: 'endpoint', point: s.p2 });
    if (modes.midpoint) out.push({ type: 'midpoint', point: mid(s.p1, s.p2) });
  } else if (s.type === 'arc') {
    if (modes.endpoint) out.push({ type: 'endpoint', point: arcPoint(s, s.a0) }, { type: 'endpoint', point: arcPoint(s, s.a1) });
    if (modes.midpoint) {
      const sweep = norm(s.a1 - s.a0) || TAU;
      out.push({ type: 'midpoint', point: arcPoint(s, s.a0 + sweep / 2) });
    }
    if (modes.center) out.push({ type: 'center', point: s.c });
  } else if (s.type === 'circle' && modes.center) {
    out.push({ type: 'center', point: s.c });
  }
  return out;
}

/**
 * 在游標點 pt 附近找最佳吸附點。
 * prims:世界座標的基本形陣列(line/arc/circle),呼叫端先用視窗與 tol 裁切過。
 * tol:容許距離(圖面單位;螢幕像素除以縮放比得來)。
 * modes:{endpoint, midpoint, center, intersection},預設全開。
 * 回傳 {type, point, dist} 或 null。
 */
export function snap(pt, prims, tol, modes = { endpoint: true, midpoint: true, center: true, intersection: true }) {
  let best = null;
  const consider = (type, point) => {
    const d = dist(pt, point);
    if (d > tol) return;
    if (!best || d < best.dist - 1e-12 || (Math.abs(d - best.dist) <= 1e-12 && PRIORITY[type] < PRIORITY[best.type])) {
      best = { type, point, dist: d };
    }
  };
  for (const s of prims) for (const sp of primSnapPoints(s, modes)) consider(sp.type, sp.point);
  if (modes.intersection) {
    let near = prims.filter((s) => distToPrim(pt, s) <= tol);
    // 交點是 O(n²):密集區只取離游標最近的 MAX_INTERSECT_PRIMS 個,避免手機上卡頓
    if (near.length > MAX_INTERSECT_PRIMS) {
      near = near.map((s) => [distToPrim(pt, s), s]).sort((a, b) => a[0] - b[0]).slice(0, MAX_INTERSECT_PRIMS).map((x) => x[1]);
    }
    for (let i = 0; i < near.length; i++)
      for (let j = i + 1; j < near.length; j++)
        for (const x of intersect(near[i], near[j])) consider('intersection', x);
  }
  return best;
}
