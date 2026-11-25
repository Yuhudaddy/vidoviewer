// Web Worker(module):解析 DWG/DXF → 場景資料。
// 啟動:new Worker('/core/parse-worker.js', { type: 'module' })   // 同源檔案,符合 CSP default-src 'self'
//
// 訊息(主執行緒 → Worker)
//   { type:'parse', id, name, buffer:ArrayBuffer, format?:'dwg'|'dxf' }   buffer 請用 transfer 傳入
// 訊息(Worker → 主執行緒)
//   { type:'ready' }                                              載入完成
//   { type:'stage', id, stage:'reading'|'building' }
//   { type:'result', id, scene, stats:{ readMs, buildMs, bytes } }  scene 的 ArrayBuffer 以 transfer 傳回
//   { type:'error', id, code, message }
//     code:'not-cad'(不是 DWG/DXF)| 'parse-failed' | 'empty'(Model 空間沒有可顯示內容)
//
// 取消:acad-ts 的讀取是同步的,Worker 內無法中斷。取消 = 主執行緒 worker.terminate()(見 parse-client.js)。
import { DwgReader, DxfReader } from '../vendor/acad-ts-3.9.0.min.js';
import { buildScene, collectTransferables } from './scene.js';
import { sniffFormat } from './format.js';

self.onmessage = (ev) => {
  const m = ev.data;
  if (m?.type !== 'parse') return;
  const { id } = m;
  try {
    const bytes = new Uint8Array(m.buffer);
    const fmt = m.format ?? sniffFormat(bytes);
    if (!fmt) return self.postMessage({ type: 'error', id, code: 'not-cad', message: '檔案不是 DWG 或 DXF' });
    const warnings = [];
    const note = (_s, e) => warnings.push(e.message);
    self.postMessage({ type: 'stage', id, stage: 'reading' });
    const t0 = performance.now();
    const doc = fmt === 'dwg' ? DwgReader.readFromStream(m.buffer, note) : DxfReader.readFromStream(bytes, note);
    const t1 = performance.now();
    self.postMessage({ type: 'stage', id, stage: 'building' });
    const scene = buildScene(doc, { warnings });
    const t2 = performance.now();
    scene.format = fmt;
    if (!scene.extents) return self.postMessage({ type: 'error', id, code: 'empty', message: 'Model 空間沒有可顯示的內容(可能內容在 Layout)' });
    self.postMessage({ type: 'result', id, scene, stats: { readMs: t1 - t0, buildMs: t2 - t1, bytes: bytes.length } }, collectTransferables(scene));
  } catch (err) {
    self.postMessage({ type: 'error', id, code: 'parse-failed', message: String(err?.message ?? err) });
  }
};
self.postMessage({ type: 'ready' });
