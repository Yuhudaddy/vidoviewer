// 單位表與換算。INSUNITS 對照:AutoCAD DXF Reference, header variable $INSUNITS。
// 內部統一用「圖面單位」;INSUNITS = 0(未設定)時 unit 為 null,不默默當公釐。

const M = { // 每 1 個圖面單位 = 幾公尺
  1: ['in', 0.0254], 2: ['ft', 0.3048], 3: ['mi', 1609.344], 4: ['mm', 0.001],
  5: ['cm', 0.01], 6: ['m', 1], 7: ['km', 1000],
  8: ['µin', 2.54e-8], 9: ['mil', 2.54e-5], 10: ['yd', 0.9144],
  11: ['Å', 1e-10], 12: ['nm', 1e-9], 13: ['µm', 1e-6], 14: ['dm', 0.1],
  15: ['dam', 10], 16: ['hm', 100], 17: ['Gm', 1e9], 18: ['au', 149597870700],
  19: ['ly', 9460730472580800], 20: ['pc', 30856775814913673],
};

/** INSUNITS 代碼 → {name, toMeters} 或 null(0 = 未設定;未知代碼也回 null,不猜)。 */
export function unitFromInsUnits(code) {
  const u = M[code];
  return u ? { name: u[0], toMeters: u[1] } : null;
}

/** 使用者手動選的單位名稱 → 單位物件。 */
export function unitByName(name) {
  for (const [n, f] of Object.values(M)) if (n === name) return { name: n, toMeters: f };
  return null;
}

/** 長度:圖面單位 → 目標單位。unit 為 null 時丟錯,逼呼叫端面對「單位未設定」。 */
export function convertLength(value, fromUnit, toUnit) {
  if (!fromUnit || !toUnit) throw new RangeError('convertLength: 圖面單位未設定,請先指定單位或校正');
  return (value * fromUnit.toMeters) / toUnit.toMeters;
}

/**
 * 校正:使用者在圖上量到 measuredDrawing(圖面單位),實際長度是 knownLength(單位 knownUnit)。
 * 回傳 {unitsPerDrawingUnit, toMeters}:一個圖面單位等於多少公尺。
 */
export function calibrate(measuredDrawing, knownLength, knownUnit) {
  if (!(measuredDrawing > 0) || !(knownLength > 0)) throw new RangeError('calibrate: 長度必須大於 0');
  return { name: null, toMeters: (knownLength * knownUnit.toMeters) / measuredDrawing };
}

/** 面積換算:長度係數平方。 */
export function convertArea(value, fromUnit, toUnit) {
  const k = convertLength(1, fromUnit, toUnit);
  return value * k * k;
}
