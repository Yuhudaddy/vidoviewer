/** 以檔頭判斷格式:DWG 以 "AC10xx" 開頭;Binary DXF 有簽名;ASCII DXF 以 "0 / SECTION" 開頭。回傳 'dwg'|'dxf'|null。 */
export function sniffFormat(bytes) {
  const head = String.fromCharCode(...bytes.subarray(0, 6));
  if (/^AC10\d\d$/.test(head)) return 'dwg';
  if (String.fromCharCode(...bytes.subarray(0, 18)) === 'AutoCAD Binary DXF') return 'dxf';
  const text = new TextDecoder('latin1').decode(bytes.subarray(0, 512));
  return /^\s*0\s*\r?\n\s*SECTION/.test(text) ? 'dxf' : null;
}

/** 檔案大小顯示:十進位(1 KB = 1000 B),與 iPhone「檔案」App 一致,也與匯入上限的判斷同一種算法。 */
export function formatBytes(n) {
  if (n < 1000) return `${n} B`;
  if (n < 1e6) return `${(n / 1e3).toFixed(1)} KB`;
  return `${(n / 1e6).toFixed(1)} MB`;
}
