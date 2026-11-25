// 封閉物件拾取與量測:點封閉圖形的邊界,回傳面積與周長。
//   const r = pickClosed(scene, {x,y}, tolWorld);   // tolWorld = 螢幕像素 ÷ 縮放比
// r.status:
//   'miss'       沒有任何可見封閉邊界在容差內
//   'ok'         命中且可可靠量測:{kind, area, perimeter, unit, outline, layer, approximate?}
//   'unreliable' 命中但不能給數字:{kind, reason, outline?, layer}。UI 要顯示「無法可靠量測」與原因,不顯示讀數。
// 單位:area 恆為「圖面單位²」,perimeter 為「圖面單位」,unit = scene.unit(null 表示圖面沒設定單位;數值照樣回傳,UI 標「圖面單位」)。
// 巢狀 INSERT:等比縮放 s 時面積×s²、周長×s;鏡射不影響(取絕對值)。
// 不可靠原因 reason:'non-uniform-scale'(含弧或圓的物件在非等比縮放的圖塊內)、'self-intersecting'、
//   'hatch-incomplete'(邊界不連續或含未支援的邊)、'hatch-loops-cross'(迴圈互相交叉,拓撲不確定)。
// Hatch:面積 = 奇偶規則(外框 − 孔 + 孔內島…);周長 = 全部有效邊界長度(含孔)。
import { explodePoly, polyArea, polyLength, circleArea, distToPrim, intersect, segSeg, dist, EPS } from './geom.js';
import { similarity, tf, mulM, IDENT } from './query.js';

const MAX_DEPTH = 24;
const SELF_CHECK_LIMIT = 1500; // 超過這個線段數就不做自交檢查(旗標 selfIntersectionChecked:false)

const segDist = (p, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
  const t = L < 1e-24 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};
const inPoly = (p, pts) => { // 射線法
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
};
const bboxOf = (pts) => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const p of pts) { if (p.x < a) a = p.x; if (p.x > c) c = p.x; if (p.y < b) b = p.y; if (p.y > d) d = p.y; } return [a, b, c, d]; };
const bbHit = (a, b) => a[2] >= b[0] && a[0] <= b[2] && a[3] >= b[1] && a[1] <= b[3];

/** 一組基本形(line/arc)是否有非相鄰線段互相穿越。大量線段時回傳 null(未檢查)。 */
function selfIntersects(prims, closed) {
  const n = prims.length;
  if (n > SELF_CHECK_LIMIT) return null;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const allowed = []; // 相鄰段只允許在共同頂點相遇(n=2 的封閉形兩端都共用)
    if (j === i + 1) allowed.push(prims[i].p2);
    if (closed && i === 0 && j === n - 1) allowed.push(prims[0].p1);
    for (const x of intersect(prims[i], prims[j])) {
      const tolx = 1e-9 * Math.max(1, Math.abs(x.x) + Math.abs(x.y));
      if (allowed.some((v) => v && dist(x, v) < tolx)) continue;
      return true;
    }
  }
  return false;
}

function loopsCross(loops) {
  const segs = loops.map((pts) => pts.map((p, i) => [p, pts[(i + 1) % pts.length]]));
  const bbs = loops.map(bboxOf);
  for (let i = 0; i < loops.length; i++) for (let j = i + 1; j < loops.length; j++) {
    if (!bbHit(bbs[i], bbs[j])) continue;
    for (const [a, b] of segs[i]) for (const [c, d] of segs[j]) if (segSeg(a, b, c, d).length) return true;
  }
  for (const pts of loops) { // 迴圈自交
    if (pts.length > SELF_CHECK_LIMIT) continue;
    const n = pts.length;
    for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segSeg(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n]).length) return true;
    }
  }
  return false;
}

/** 收集所有候選封閉形(世界座標),含到游標的邊界距離。 */
function candidates(scene, pt, tol) {
  const out = [];
  const layers = scene.layers;
  const on = (i) => i < 0 || layers[i]?.visible !== false;
  const x0 = pt.x - tol, x1 = pt.x + tol, y0 = pt.y - tol, y1 = pt.y + tol;
  const near = (bb) => bb[2] >= x0 && bb[0] <= x1 && bb[3] >= y0 && bb[1] <= y1;

  function visit(sp, m, depth, insLayerOn) {
    if (depth > MAX_DEPTH) return;
    const sim = similarity(m);
    const det = Math.abs(m[0] * m[3] - m[1] * m[2]);
    const mirror = m[0] * m[3] - m[1] * m[2] < 0;

    const C = sp.circles;
    const smax = Math.max(Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3]));
    const inv = det > 1e-18 ? [m[3] / (m[0] * m[3] - m[1] * m[2]), -m[1] / (m[0] * m[3] - m[1] * m[2]), -m[2] / (m[0] * m[3] - m[1] * m[2]), m[0] / (m[0] * m[3] - m[1] * m[2])] : null;
    for (let i = 0, n = C.length / 3; i < n; i++) {
      if (!on(sp.circleAttr[2 * i])) continue;
      const c = tf(m, C[3 * i], C[3 * i + 1]);
      const r0 = C[3 * i + 2];
      const r = r0 * (sim ? sim.s : smax); // 非等比縮放時圓變橢圓,這裡只用外包半徑做粗篩
      if (!near([c.x - r, c.y - r, c.x + r, c.y + r])) continue;
      let d;
      if (sim) d = Math.abs(dist(pt, c) - r);
      else { // 橢圓:把游標反變換回圖塊座標,取到圓的距離,乘以幾何平均縮放換回世界距離(近似,只用來判斷命中)
        if (!inv) continue;
        const dx = pt.x - m[4], dy = pt.y - m[5];
        const lx = inv[0] * dx + inv[2] * dy - C[3 * i], ly = inv[1] * dx + inv[3] * dy - C[3 * i + 1];
        d = Math.abs(Math.hypot(lx, ly) - r0) * Math.sqrt(det);
      }
      if (d > tol) continue;
      out.push({ kind: 'circle', d, layer: sp.circleAttr[2 * i], unreliable: sim ? null : 'non-uniform-scale', circle: { c, r: r0 * (sim ? sim.s : 1) }, outline: [{ type: 'circle', c, r }] });
    }

    const P = sp.polys, off = P.offsets;
    for (let i = 0; i < P.closed.length; i++) {
      if (!on(P.attr[2 * i])) continue;
      const s = off[i], e = off[i + 1];
      let pts = [], bl = [];
      for (let k = s; k < e; k++) { pts.push(tf(m, P.pts[2 * k], P.pts[2 * k + 1])); bl.push(mirror ? -P.bulges[k] : P.bulges[k]); }
      let closed = !!P.closed[i];
      const bb = bboxOf(pts);
      const size = Math.max(bb[2] - bb[0], bb[3] - bb[1], 1e-12);
      if (!closed && pts.length >= 4 && dist(pts[0], pts[pts.length - 1]) <= 1e-9 * size) { closed = true; pts.pop(); bl.pop(); } // 首尾重合視為封閉
      if (!closed || pts.length < 2) continue;
      const hasArc = bl.some((b) => Math.abs(b) > 1e-12);
      if (hasArc) { // 弧可能凸出頂點外,框要放大(同 query.js)
        let g = 0;
        for (let k = 0; k < pts.length; k++) { const b = Math.abs(bl[k]); if (b < 1e-12) continue; const c = dist(pts[k], pts[(k + 1) % pts.length]); g = Math.max(g, b <= 1 ? (b * c) / 2 : (c * (1 + b * b)) / (4 * b)); }
        bb[0] -= g; bb[1] -= g; bb[2] += g; bb[3] += g;
      }
      if (!near(bb)) continue;
      const prims = explodePoly(pts, hasArc && sim ? bl : null, true); // 非相似變換下弧無效,退為直線段(量測會被標不可靠)
      let d = Infinity;
      for (const pr of prims) d = Math.min(d, distToPrim(pt, pr));
      if (d > tol) continue;
      out.push({ kind: 'polyline', d, layer: P.attr[2 * i], unreliable: hasArc && !sim ? 'non-uniform-scale' : null, pts, bulges: hasArc && sim ? bl : null, prims, sim, det });
    }

    for (const h of sp.hatches) {
      if (!on(h.layer)) continue;
      const loops = h.loops.map((f) => { const a = []; for (let k = 0; k < f.length; k += 2) a.push(tf(m, f[k], f[k + 1])); return a; });
      const bb = bboxOf(loops.flat());
      if (!near(bb)) continue;
      let d = Infinity;
      for (const pts of loops) for (let k = 0; k < pts.length; k++) d = Math.min(d, segDist(pt, pts[k], pts[(k + 1) % pts.length]));
      if (d > tol) continue;
      const flags = h.loopFlags ?? new Uint8Array(loops.length);
      out.push({ kind: 'hatch', d, layer: h.layer, loops, incomplete: flags.some((f) => f & 1), approximate: flags.some((f) => f & 2), det });
    }

    const I = sp.inserts;
    for (let i = 0, n = I.proto.length; i < n; i++) {
      const pr = scene.protos[I.proto[i]];
      if (!pr || !on(I.attr[2 * i])) continue;
      const next = mulM(m, I.m.subarray(6 * i, 6 * i + 6));
      if (pr.bbox) {
        const [a, b, c, d] = pr.bbox;
        const cs = [tf(next, a, b), tf(next, c, b), tf(next, a, d), tf(next, c, d)];
        if (!near(bboxOf(cs))) continue;
      }
      visit(pr, next, depth + 1);
    }
  }
  visit(scene.model, IDENT, 0);
  return out;
}

function measure(c, scene) {
  const base = { kind: c.kind, layer: c.layer, layerName: scene.layers[c.layer]?.name ?? null, unit: scene.unit };
  const bad = (reason, outline) => ({ status: 'unreliable', ...base, reason, outline });
  if (c.kind === 'circle') {
    if (c.unreliable) return bad(c.unreliable, c.outline);
    return { status: 'ok', ...base, ...circleArea(c.circle.r), outline: c.outline };
  }
  if (c.kind === 'polyline') {
    if (c.unreliable) return bad(c.unreliable, c.prims);
    const si = selfIntersects(c.prims, true);
    if (si) return bad('self-intersecting', c.prims);
    const { area, perimeter } = polyArea(c.pts, c.bulges);
    return { status: 'ok', ...base, area, perimeter, outline: c.prims, ...(si === null ? { selfIntersectionChecked: false } : {}) };
  }
  // hatch
  const outline = c.loops.flatMap((pts) => pts.map((p, i) => ({ type: 'line', p1: p, p2: pts[(i + 1) % pts.length] })));
  if (c.incomplete) return bad('hatch-incomplete', outline);
  if (loopsCross(c.loops)) return bad('hatch-loops-cross', outline);
  let area = 0, perimeter = 0;
  const abs = c.loops.map((pts) => polyArea(pts).area);
  c.loops.forEach((pts, i) => {
    let depth = 0;
    for (let j = 0; j < c.loops.length; j++) if (j !== i && inPoly(pts[0], c.loops[j])) depth++;
    area += depth % 2 === 0 ? abs[i] : -abs[i];
    perimeter += polyLength(pts, null, true);
  });
  if (area < -1e-9) return bad('hatch-loops-cross', outline); // 奇偶規則算出負面積:巢狀關係不成立
  const holes = c.loops.filter((pts, i) => c.loops.some((q, j) => j !== i && inPoly(pts[0], q))).length; // 位於其他迴圈內的迴圈數(孔與孔內島)
  return { status: 'ok', ...base, area, perimeter, outline, holes, ...(c.approximate ? { approximate: true } : {}) };
}

export function pickClosed(scene, pt, tol) {
  if (!scene?.model) return { status: 'miss' };
  const cs = candidates(scene, pt, tol);
  if (!cs.length) return { status: 'miss' };
  cs.sort((a, b) => a.d - b.d);
  return measure(cs[0], scene);
}
