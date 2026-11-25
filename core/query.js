// 場景查詢:在游標附近收集世界座標的基本形,並做鎖點(snap)。
// 這是 geom.snap 與 scene 之間的橋:處理 INSERT 巢狀變換、多段線 bulge 展開、圖層可見性、視窗裁切。
//
// 用法:  const hit = snapAt(scene, {x,y}, tolWorld);   // tolWorld = 螢幕像素 ÷ 縮放比
//        hit → {type:'endpoint'|'midpoint'|'center'|'intersection', point, dist} | null
// 渲染端用 hit.type 決定鎖點框形狀(端點方形、中點三角形、圓心圓形、交點叉形)。
// 限制:INSERT 若有「非等比縮放」(x、y 縮放不同),其內的圓與弧不參與鎖點(橢圓化);直線、多段線線段仍可。
import { explodePoly, snap, norm } from './geom.js';

const MAX_DEPTH = 24;
const mulM = (n, m) => [
  n[0] * m[0] + n[2] * m[1], n[1] * m[0] + n[3] * m[1],
  n[0] * m[2] + n[2] * m[3], n[1] * m[2] + n[3] * m[3],
  n[0] * m[4] + n[2] * m[5] + n[4], n[1] * m[4] + n[3] * m[5] + n[5],
];
const IDENT = [1, 0, 0, 1, 0, 0];

/** 矩陣是否為相似變換(等比縮放 + 旋轉,可含鏡射)。回傳 {s, theta, mirror} 或 null。 */
function similarity(m) {
  const sx = Math.hypot(m[0], m[1]), sy = Math.hypot(m[2], m[3]);
  if (sx < 1e-12 || Math.abs(sx - sy) > 1e-9 * sx) return null;
  if (Math.abs(m[0] * m[2] + m[1] * m[3]) > 1e-9 * sx * sx) return null;
  const det = m[0] * m[3] - m[1] * m[2];
  return { s: sx, theta: Math.atan2(m[1], m[0]), mirror: det < 0 };
}

function tf(m, x, y) { return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] }; }

function transformArc(sim, m, cx, cy, r, a0, a1) {
  const c = tf(m, cx, cy);
  return sim.mirror
    ? { type: 'arc', c, r: r * sim.s, a0: sim.theta - a1, a1: sim.theta - a0 }
    : { type: 'arc', c, r: r * sim.s, a0: a0 + sim.theta, a1: a1 + sim.theta };
}

/** 收集以 (cx,cy) 為中心、半徑 r(世界單位)的方框內的基本形。 */
export function collectPrims(scene, cx, cy, r) {
  const out = [];
  const x0 = cx - r, x1 = cx + r, y0 = cy - r, y1 = cy + r;
  const layers = scene.layers;
  const layerOn = (i) => i < 0 || layers[i]?.visible !== false;
  const hit = (minx, miny, maxx, maxy) => maxx >= x0 && minx <= x1 && maxy >= y0 && miny <= y1;

  function visit(sp, m, depth) {
    if (depth > MAX_DEPTH) return;
    const sim = similarity(m);
    const L = sp.lines, la = sp.lineAttr;
    for (let i = 0, n = L.length / 4; i < n; i++) {
      if (!layerOn(la[2 * i])) continue;
      const ax = L[4 * i], ay = L[4 * i + 1], bx = L[4 * i + 2], by = L[4 * i + 3];
      const p = tf(m, ax, ay), q = tf(m, bx, by);
      if (hit(Math.min(p.x, q.x), Math.min(p.y, q.y), Math.max(p.x, q.x), Math.max(p.y, q.y))) out.push({ type: 'line', p1: p, p2: q });
    }
    if (sim) {
      const A = sp.arcs, aa = sp.arcAttr;
      for (let i = 0, n = A.length / 5; i < n; i++) {
        if (!layerOn(aa[2 * i])) continue;
        const pr = transformArc(sim, m, A[5 * i], A[5 * i + 1], A[5 * i + 2], A[5 * i + 3], A[5 * i + 4]);
        if (hit(pr.c.x - pr.r, pr.c.y - pr.r, pr.c.x + pr.r, pr.c.y + pr.r)) out.push(pr);
      }
      const C = sp.circles, ca = sp.circleAttr;
      for (let i = 0, n = C.length / 3; i < n; i++) {
        if (!layerOn(ca[2 * i])) continue;
        const c = tf(m, C[3 * i], C[3 * i + 1]), rr = C[3 * i + 2] * sim.s;
        if (hit(c.x - rr, c.y - rr, c.x + rr, c.y + rr)) out.push({ type: 'circle', c, r: rr });
      }
    }
    const P = sp.polys, off = P.offsets;
    for (let i = 0; i < P.closed.length; i++) {
      if (!layerOn(P.attr[2 * i])) continue;
      const s = off[i], e = off[i + 1];
      let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
      const pts = [];
      for (let k = s; k < e; k++) {
        const p = tf(m, P.pts[2 * k], P.pts[2 * k + 1]); pts.push(p);
        if (p.x < minx) minx = p.x; if (p.x > maxx) maxx = p.x; if (p.y < miny) miny = p.y; if (p.y > maxy) maxy = p.y;
      }
      // 弧段可能凸出頂點外:|bulge|≤1 時最多凸出矢高 s = |b|·c/2;>1 時(超過半圓)最多凸出半徑 r。
      let grow = 0;
      for (let k = s; k < e; k++) {
        const b = Math.abs(P.bulges[k]);
        if (b < 1e-12) continue;
        const q = (k + 1 < e) ? k + 1 : s;
        const c = Math.hypot(P.pts[2 * q] - P.pts[2 * k], P.pts[2 * q + 1] - P.pts[2 * k + 1]) * (sim ? sim.s : 1);
        grow = Math.max(grow, b <= 1 ? (b * c) / 2 : (c * (1 + b * b)) / (4 * b));
      }
      if (!hit(minx - grow, miny - grow, maxx + grow, maxy + grow)) continue;
      const bl = [];
      for (let k = s; k < e; k++) bl.push(sim?.mirror ? -P.bulges[k] : P.bulges[k]);
      // bulge 在非相似變換下不成立:退回只取直線段
      for (const prim of explodePoly(pts, sim ? bl : null, !!P.closed[i])) {
        if (prim.type === 'arc') {
          if (hit(prim.c.x - prim.r, prim.c.y - prim.r, prim.c.x + prim.r, prim.c.y + prim.r)) out.push(prim);
        } else out.push(prim);
      }
    }
    const I = sp.inserts;
    for (let i = 0, n = I.proto.length; i < n; i++) {
      const pr = scene.protos[I.proto[i]];
      if (!pr || !layerOn(I.attr[2 * i])) continue;
      const mi = I.m.subarray(6 * i, 6 * i + 6);
      const next = mulM(m, mi);
      if (pr.bbox) {
        const [bx0, by0, bx1, by1] = pr.bbox;
        const cs = [tf(next, bx0, by0), tf(next, bx1, by0), tf(next, bx0, by1), tf(next, bx1, by1)];
        if (!hit(Math.min(...cs.map((c) => c.x)), Math.min(...cs.map((c) => c.y)), Math.max(...cs.map((c) => c.x)), Math.max(...cs.map((c) => c.y)))) continue;
      }
      visit(pr, next, depth + 1);
    }
  }

  visit(scene.model, IDENT, 0);
  for (const d of scene.dimensions ?? []) {
    const pr = scene.protos[d.proto];
    if (pr && layerOn(d.layer) && (!pr.bbox || hit(pr.bbox[0], pr.bbox[1], pr.bbox[2], pr.bbox[3]))) visit(pr, IDENT, 1);
  }
  return out;
}

export const DEFAULT_MODES = { endpoint: true, midpoint: true, center: true, intersection: true };

/** 鎖點:pt 附近 tol(世界單位)內最佳吸附點,或 null。 */
export function snapAt(scene, pt, tol, modes = DEFAULT_MODES) {
  if (!scene?.model) return null;
  return snap(pt, collectPrims(scene, pt.x, pt.y, tol), tol, modes);
}

export { norm, similarity, tf, mulM, IDENT };
