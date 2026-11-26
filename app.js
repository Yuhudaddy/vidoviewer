import {Renderer} from './renderer.js';
import {snapAt} from './core/query.js';
import {pickClosed} from './core/pick.js';
import {convertArea, convertLength, unitByName} from './core/units.js';
import {ParseLifecycle, LARGE_LIMIT, FILE_LIMIT} from './parse-lifecycle.js';
import {getDrawing, getDrawingMetadata, importDrawing, markOpened, setThumbnail, addMark, deleteMark, ensureMarkNumbers, setMeasurementState, undoMeasurementAtomic} from './library.js';
import {initHome, fmtBytes} from './home.js';

const $ = id => document.getElementById(id);
const canvas = $('drawing');
const renderer = new Renderer(canvas, {pill: $('measurementPill')});
const parser = new ParseLifecycle();
// 圖上的數字膠囊要避開的面板（畫布座標）：縮放鈕與顯示中的讀數卡
renderer.avoid = () => {
  const origin = canvas.getBoundingClientRect();
  return [document.querySelector('#side .vv-zoom'), $('result'), $('polygonActions'), $('undoMeasurement'), document.querySelector('.vv-notices'), $('areaClosed'), $('polygon'), $('speedMenu')].map(node => node.getBoundingClientRect()).filter(r => r.width && r.height)
    .map(r => ({left: r.left - origin.left, right: r.right - origin.left, top: r.top - origin.top, bottom: r.bottom - origin.top}));
};

let displayUnit = unitByName(localStorage.getItem('vidoviewer-display-unit') || 'cm') || unitByName('cm');
const SNAP_NAMES = {endpoint: '端點', midpoint: '中點', center: '圓心', intersection: '交點', 'polygon-start': '起點'};
const UNRELIABLE = {'non-uniform-scale': '非等比縮放', 'self-intersecting': '邊界自交', 'hatch-incomplete': '邊界不完整', 'hatch-loops-cross': '邊界交叉'};
const DRAG_SLOP = 8;     // px：超過就當作平移，不落點
const LONG_PRESS = 220;  // ms：按住不動多久後進入放大鏡瞄準

const fmt = (n, digits = 4) => n.toLocaleString('zh-TW', {maximumFractionDigits: digits});
const fmtArea = n => n >= 0.01 ? n.toLocaleString('zh-TW', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : n.toLocaleString('zh-TW', {maximumSignificantDigits: 3});
const cssNumber = (name, fallback) => { const n = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)); return Number.isFinite(n) ? n : fallback; };

// ---------- 提示、對話框 ----------
let noticeTimer = 0;
function notice(text, ms = 6000) {
  clearTimeout(noticeTimer);
  $('noticeText').textContent = text;
  $('notice').hidden = false;
  if (ms) noticeTimer = setTimeout(() => { $('notice').hidden = true; }, ms);
}
$('drawingWarningClose').onclick = () => { $('drawingWarning').hidden = true; $('drawingWarningList').hidden = true; $('drawingWarningToggle').setAttribute('aria-expanded', 'false'); };
$('drawingWarningToggle').onclick = () => {
  const open = $('drawingWarningList').hidden;
  $('drawingWarningList').hidden = !open;
  $('drawingWarningToggle').setAttribute('aria-expanded', String(open));
};
// 被略過的物件：核心回報的類型代碼轉成看得懂的中文；沒對到的照原代碼顯示，不假裝認得。
const KIND_NAME = {AcDbLine: '線', AcDbCircle: '圓', AcDbArc: '圓弧', AcDbPolyline: '多段線', AcDb2dPolyline: '多段線', AcDb3dPolyline: '3D 多段線', AcDbEllipse: '橢圓', AcDbSpline: '雲形線', AcDbPoint: '點', AcDbSolid: '實心填色', AcDbTrace: '實心填色', AcDbText: '文字', AcDbMText: '多行文字', AcDbHatch: '填充', AcDbBlockReference: '圖塊', AcDbFace: '3D 面'};
const kindName = k => Object.hasOwn(KIND_NAME, k) ? KIND_NAME[k] : String(k).replace(/^AcDb/, '');
function skippedLabel(key) {
  if (key.startsWith('tilted-')) return `畫在傾斜平面上的${kindName(key.slice(7))}`;
  if (key.startsWith('hatch-edge-')) return '填充的邊界含不支援的線段';
  if (key.startsWith('error-')) return `解析時出錯的${kindName(key.slice(6))}`;
  const FIXED = {'hatch-empty': '沒有邊界的填充', 'insert-no-block': '找不到內容的圖塊', 'minsert-too-large': '數量過大的陣列圖塊', 'dimension-no-block': '缺少內容的標註', 'recursive-insert': '互相包含的圖塊'};
  return Object.hasOwn(FIXED, key) ? FIXED[key] : `不支援的物件：${kindName(key)}`;
}
function fillWarningList(scene) {
  const list = $('drawingWarningList'); list.replaceChildren();
  const add = text => { const li = document.createElement('li'); li.textContent = text; list.append(li); };
  const byType = Object.entries(scene.skipped?.byType || {}).sort((a, b) => b[1] - a[1]);
  if (byType.length) { const h = document.createElement('li'); h.className = 'app-warning__head'; h.textContent = '略過的物件'; list.append(h); for (const [key, n] of byType.slice(0, 20)) add(`${skippedLabel(key)}　${n} 個`); if (byType.length > 20) add(`另有 ${byType.length - 20} 種`); }
  const warnings = scene.warnings || [];
  if (warnings.length) { const h = document.createElement('li'); h.className = 'app-warning__head'; h.textContent = `解析警告 ${warnings.length} 則`; list.append(h); for (const w of warnings.slice(0, 5)) { const t = String(w ?? ''); add(t.length > 90 ? `${t.slice(0, 90)}…` : t); } if (warnings.length > 5) add(`另有 ${warnings.length - 5} 則`); }
  return list.childElementCount > 0;
}
function setModal(on) { $('library').inert = on; $('viewerLayer').inert = on; }
function dialog(title, text, confirm = '繼續', cancel = '取消') {
  return new Promise(resolve => {
    const before = document.activeElement, box = $('dialog'), yes = $('dialogConfirm'), no = $('dialogCancel');
    $('dialogTitle').textContent = title;
    $('dialogText').textContent = text;
    $('dialogText').hidden = !text;
    yes.textContent = confirm;
    no.textContent = cancel;
    no.hidden = !cancel;
    const done = value => {
      document.removeEventListener('keydown', onKey, true);
      box.hidden = true;
      setModal(!$('loading').hidden);
      before?.focus?.();
      resolve(value);
    };
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
      else if (e.key === 'Tab') { e.preventDefault(); (document.activeElement === yes && !no.hidden ? no : yes).focus(); }
    };
    yes.onclick = () => done(true);
    no.onclick = () => done(false);
    document.addEventListener('keydown', onKey, true);
    setModal(true);
    box.hidden = false;
    yes.focus();
  });
}

// ---------- 匯入（原檔存在這個瀏覽器的 IndexedDB） ----------
const home = initHome({open: id => openRecord(id, true)});
$('import').onclick = () => $('file').click();
$('file').onchange = async e => {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  let added = 0, duplicates = 0, rejected = 0;
  for (const file of files) {
    if (file.size > FILE_LIMIT || !/\.(dwg|dxf)$/i.test(file.name)) { rejected++; continue; }
    try { (await importDrawing(file)).duplicate ? duplicates++ : added++; }
    catch { await dialog('無法儲存圖面', '儲存空間不足', '了解', ''); break; }
  }
  home.showTab('library'); // 新匯入的圖還沒開過，只會出現在資料庫
  await home.refresh({keepScroll: false});
  home.toast([added && `已匯入 ${added} 個`, duplicates && `${duplicates} 個已在資料庫`, rejected && `略過 ${rejected} 個（非 DWG、DXF 或超過 65 MB）`].filter(Boolean).join('，'));
};
$('example').onclick = async () => {
  home.closeHelp({focus: false});
  try {
    const response = await fetch('./example/mini.dxf');
    if (!response.ok) throw new Error(String(response.status));
    const {id} = await importDrawing(new File([await response.blob()], 'mini.dxf', {lastModified: 0}), {example: true});
    await openRecord(id, true);
  } catch { home.toast('無法開啟範例圖'); }
};

// ---------- 開啟、返回、瀏覽器上一頁 ----------
let scene = null, requestId = 0, currentRecordId = null;
function showLibrary() {
  requestId++;
  parser.cancel();
  $('loading').hidden = true;
  setModal(false);
  historyReady = false;
  setTool(null);
  scene = null;
  currentRecordId = null;
  renderer.scene = null;
  renderer.clearOverlay();
  $('notice').hidden = true;
  $('viewerLayer').hidden = true;
  $('library').hidden = false;
  home.refresh();
}
$('open').onclick = () => {
  if (history.state?.drawingId && history.state?.fromLibrary) history.back();
  else { history.replaceState(null, '', location.pathname + location.search); showLibrary(); }
};
window.addEventListener('popstate', () => { const id = history.state?.drawingId; if (id) openRecord(id, false); else showLibrary(); });
window.addEventListener('pagehide', () => parser.dispose());

async function openRecord(id, push) {
  const token = ++requestId;
  parser.cancel();
  await historyChain; // 同一分頁快速切圖或重開時，先寫完前一張圖的狀態。
  if (token !== requestId) return;
  let record;
  try { record = await getDrawing(id); }
  catch (error) {
    if (token !== requestId) return;
    if (error?.dataMissing) await missingData(id, push);
    else if (await dialog('無法開啟圖檔', '讀取失敗，請重試。', '重試', '關閉')) return openRecord(id, push);
    return;
  }
  if (token !== requestId) return;
  if (!record || record.deletedAt) {
    await dialog('找不到圖面', '', '了解', '');
    if (!push) { history.replaceState(null, '', location.pathname + location.search); showLibrary(); }
    return;
  }
  if (record.blob.size > LARGE_LIMIT && !await dialog('開啟大型圖檔', `${record.name}　${fmtBytes(record.blob.size)}`, '開啟')) return;
  if (token !== requestId) return;
  await ensureMarkNumbers(id);
  const updatedRecord = await getDrawingMetadata(id);
  if (token !== requestId) return;
  currentRecordId = id;
  const file = new File([record.blob], record.name, {lastModified: record.lastModified});
  await openFile(file, token, () => {
    markOpened(id).catch(() => {}); // 成功開啟才算「最近」
    const picture = renderer.thumbnail(320, 200); // 16:10 小圖，只存在本機 IndexedDB
    if (picture) setThumbnail(id, picture.toDataURL('image/png')).catch(() => {});
    if (push) history.pushState({drawingId: id, fromLibrary: true}, '', `#drawing=${id}`);
  }, updatedRecord, () => missingData(id, push));
}
async function missingData(id, push) {
  if (!await dialog('無法開啟圖檔', '這張圖的資料已失效，請重新匯入。（NotFoundError）', '刪除這筆', '關閉')) return;
  if (!push) { history.replaceState(null, '', location.pathname + location.search); showLibrary(); }
  await home.remove(id);
}
async function openFile(file, token, onOpened, record, removeRecord) {
  while (token === requestId) {
    $('loadingName').textContent = file.name;
    $('loadingSize').textContent = fmtBytes(file.size);
    $('loadingStage').textContent = '讀取中';
    $('loading').hidden = false;
    setModal(true);
    const result = await parser.start(file, {onStage: stage => { $('loadingStage').textContent = stage === 'building' ? '整理中' : '解析中'; }});
    if (token !== requestId) return;
    $('loading').hidden = true;
    setModal(false);
    if (result.status === 'done') { showDrawing(file.name, result.value, record); onOpened(); return; }
    if (result.status === 'cancelled') return;
    if (result.status === 'data-missing') {
      await removeRecord();
      return;
    }
    const messages = {error: result.value || '解析失敗', timeout: '開啟逾時', 'storage-error': '無法記錄開啟狀態', 'too-large': '超過 65 MB'};
    if (!await dialog('無法開啟圖檔', messages[result.status] || '解析失敗', '重試', '關閉')) return;
  }
}
function showDrawing(name, value, record) {
  historyReady = false;
  scene = value;
  setTool(null);
  $('library').hidden = true;
  $('viewerLayer').hidden = false;
  $('filename').textContent = name;
  updateUnitMetadata();
  $('notice').hidden = true;
  renderer.resize();
  measureInsets();
  renderer.setScene(scene);
  markRecords = record?.marks || []; undoStack = reconcileHistory(record?.measurementState, markRecords); activeMarkKey = null;
  historyReady = true;
  if (record?.measurementState?.current) restoreSnapshot(record.measurementState.current);
  else { updateSavedMarks(); updateHistoryControls(); }
  const warning = scene.skipped?.count ? `已略過 ${scene.skipped.count} 個物件` : scene.warnings?.length ? `解析警告 ${scene.warnings.length} 則` : '';
  $('drawingWarningText').textContent = warning;
  const detail = warning && fillWarningList(scene);
  $('drawingWarningList').hidden = true; $('drawingWarningToggle').setAttribute('aria-expanded', 'false'); $('drawingWarningToggle').hidden = !detail;
  $('drawingWarning').hidden = !warning;
}
$('cancelLoading').onclick = () => { requestId++; parser.cancel(); $('loading').hidden = true; setModal(false); };

// 全圖只用標題列與 Dock 之間看得到的範圍，高度由實際版面量出來。
function measureInsets() {
  if ($('viewerLayer').hidden) return;
  const box = canvas.getBoundingClientRect(), title = document.querySelector('.vv-titlebar').getBoundingClientRect(), dock = document.querySelector('.vv-dock').getBoundingClientRect();
  const side = $('side').getBoundingClientRect(); // 矮畫面縮放鈕隱藏時寬度為 0
  renderer.insets = {top: title.bottom - box.top + 80, bottom: box.bottom - dock.top + 64, left: 16, right: side.width ? box.right - side.left + 8 : 16};
}
window.addEventListener('resize', measureInsets);

// ---------- 工具與讀數 ----------
// tool: null | 'distance' | 'area'
// measurement: null | {kind:'distance', points:[p] | [p,q]} | {kind:'area', pick}
let tool = null, snapping = true, measurement = null, markRecords = [], activeMarkKey = null, undoStack = [], historyReady = false, historyChain = Promise.resolve(), dockColorFrame=0, savingMark=false, undoBusy=false;
let polygonAutoClose = true;
try { polygonAutoClose = localStorage.getItem('polygonAutoClose') !== 'false'; } catch {}
$('polygonClose').setAttribute('aria-pressed', String(polygonAutoClose));
function snapshot() { return {tool, measurement: measurement ? structuredClone(measurement) : null, activeMarkKey, unit: scene?.unit || null}; }
function recordPrevious(includeEmpty=false) { if (historyReady && (measurement || includeEmpty)) { undoStack.push(snapshot()); if (undoStack.length > 100) { const firstTransient=undoStack.findIndex(s=>!s.undoMarkKey); if(firstTransient>=0)undoStack.splice(firstTransient,1); } } }
function reconcileHistory(state, marks) {
  const old=state?.history || [], valid=new Set(marks.map(m=>m.key));
  if(state?.historyVersion===2 && marks.every(m=>old.some(s=>s.undoMarkKey===m.key))) return old.filter(s=>!s.undoMarkKey || valid.has(s.undoMarkKey)).filter(s=>!s.activeMarkKey || valid.has(s.activeMarkKey));
  // 舊資料只有快照：保留標記本身與編號，補上按原建立順序的撤銷紀錄。
  const events=marks.map(m=>({undoMarkKey:m.key})), current=state?.current;
  if(current?.measurement && !current.activeMarkKey){
    const last=marks.at(-1); if(last)events.push({tool:null,measurement:structuredClone(last.measurement),activeMarkKey:last.key,unit:current.unit});
    if(current.measurement.kind==='polygon'&&!current.measurement.finished){const lastSaved=old.map(s=>s.activeMarkKey).lastIndexOf(last?.key);events.push(...old.slice(lastSaved+1).filter(s=>s.measurement?.kind==='polygon'&&!s.measurement.finished));}
  }
  return events;
}
function persistState() {
  if (!historyReady || !currentRecordId) return;
  const id=currentRecordId, state={current:snapshot(), history:structuredClone(undoStack), historyVersion:2};
  historyChain=historyChain.catch(()=>{}).then(()=>setMeasurementState(id,state)).catch(()=>notice('量測狀態儲存失敗',4000));
  updateHistoryControls();
}
function updateHistoryControls() { $('undoMeasurement').disabled = undoBusy || savingMark || !undoStack.length; }
function restoreSnapshot(state) {
  tool=state?.tool || null; measurement=state?.measurement ? structuredClone(state.measurement) : null;
  activeMarkKey=markRecords.some(m=>m.key===state?.activeMarkKey) ? state.activeMarkKey : null;
  if (state?.activeMarkKey && !activeMarkKey) measurement=null;
  if (state?.unit !== undefined) scene.unit=state.unit;
  $('measure').setAttribute('aria-pressed',String(tool==='distance')); $('area').setAttribute('aria-pressed',String(tool==='area'||tool==='polygon'));
  $('areaClosed').setAttribute('aria-pressed',String(tool==='area')); $('polygon').setAttribute('aria-pressed',String(tool==='polygon'));
  $('polygonActions').hidden=tool!=='polygon';
  $('polygonStatus').textContent=measurement?.kind==='polygon'&&!measurement.finished ? `已選 ${measurement.points.length} 點` : '請點選至少 3 個點';
  if(tool)canvas.dataset.tool=tool;else delete canvas.dataset.tool;
  clearPreview(); updateUnitMetadata(); updateDockIndicator(false); updateSavedMarks(); showMeasurement(); updateHistoryControls();
}
function updateSavedMarks() {
  canvas.dataset.markCount=String(markRecords.length);
  renderer.savedMarks=markRecords.map(mark=>{const m=mark.measurement, outline=m?.kind==='area'?m.pick?.outline:m?.outline;return {...mark, anchor:outline?.length ? outlineCenter(outline) : null};});
  renderer.draw();
}
$('undoMeasurement').onclick = async () => {
  if (!undoStack.length || undoBusy || savingMark) return;
  const previous=undoStack.at(-1);
  const id=currentRecordId, key=previous.undoMarkKey || null; undoBusy=true; updateHistoryControls(); $('viewerLayer').inert=true;
  try {
    await historyChain;
    const result=await undoMeasurementAtomic(id,key,structuredClone(undoStack.slice(0,-1)),scene?.unit || null,key ? previous.restore || null : previous);
    if(id!==currentRecordId)return;
    if(result.status!=='ok'){notice('資料已變更，請重新開啟圖面',4000);return;}
    markRecords=result.marks;undoStack=result.history;restoreSnapshot(result.current);
  } catch { if(id===currentRecordId)notice('復原失敗，請重試',4000); }
  finally { undoBusy=false; $('viewerLayer').inert=false; updateHistoryControls(); }
};

// 從目前畫面位置起跳，連續切換時不中斷或跳回舊位置。
function syncDockIconColors() {
  const bubble=$('dockIndicator');
  if(bubble.hidden){for(const b of [$('measure'),$('area')])b.classList.remove('is-bubble-over');return;}
  const r=bubble.getBoundingClientRect();
  for(const b of [$('measure'),$('area')]){ const i=b.querySelector('svg').getBoundingClientRect(); const overlaps=i.left<r.right&&r.left<i.right&&i.top<r.bottom&&r.top<i.bottom; b.classList.toggle('is-bubble-over',overlaps); }
}
function animateDockIconColors() { syncDockIconColors(); if($('dockIndicator').getAnimations().length) dockColorFrame=requestAnimationFrame(animateDockIconColors); }
function updateDockIndicator(animate = true) {
  cancelAnimationFrame(dockColorFrame);
  const indicator = $('dockIndicator'), dock = document.querySelector('.vv-dock');
  const selected = tool === 'distance' ? $('measure') : tool === 'area' || tool === 'polygon' ? $('area') : null;
  if (!selected || $('viewerLayer').hidden) { indicator.getAnimations().forEach(a => a.cancel()); indicator.hidden = true; dock.classList.remove('is-moving'); syncDockIconColors(); return; }
  const wasVisible = !indicator.hidden, current = wasVisible ? new DOMMatrixReadOnly(getComputedStyle(indicator).transform) : null;
  indicator.getAnimations().forEach(a => a.cancel()); indicator.hidden = false;
  const base = dock.getBoundingClientRect(), icon = selected.querySelector('svg').getBoundingClientRect();
  const x = icon.left + icon.width / 2 - base.left - 22, y = icon.top + icon.height / 2 - base.top - 22;
  const end = `translate(${x}px, ${y}px)`; indicator.style.transform = end;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!wasVisible || !animate || reduced || Math.abs(current.m41-x)<.5) { dock.classList.remove('is-moving'); syncDockIconColors(); return; }
  const sx=current.m41, sy=current.m42, mid=(sx+x)/2, distance=x-sx;
  dock.classList.add('is-moving');
  const motion=indicator.animate([
    {transform:`translate(${sx}px, ${sy}px) scale(1)`},
    {transform:`translate(${mid}px, ${Math.min(sy,y)-22}px) scale(.91, 1.08)`, offset:.48},
    {transform:`translate(${x+distance*.055}px, ${y+3}px) scale(1.09, .91)`, offset:.78},
    {transform:end+' scale(1)'}
  ], {duration:540, easing:'cubic-bezier(.2,.65,.2,1)'});
  motion.onfinish=()=>{dock.classList.remove('is-moving');syncDockIconColors();};
  animateDockIconColors();
}
function setTool(next) {
  recordPrevious();
  tool = next;
  measurement = null;
  activeMarkKey = null;
  endGesture();
  clearPreview();
  $('measure').setAttribute('aria-pressed', String(tool === 'distance'));
  $('area').setAttribute('aria-pressed', String(tool === 'area' || tool === 'polygon'));
  $('areaClosed').setAttribute('aria-pressed', String(tool === 'area'));
  $('polygon').setAttribute('aria-pressed', String(tool === 'polygon'));
  $('polygonActions').hidden = tool !== 'polygon';
  $('polygonStatus').textContent = '請點選至少 3 個點';
  if (tool) canvas.dataset.tool = tool; else delete canvas.dataset.tool;
  updateDockIndicator();
  showMeasurement();
  persistState();
}
function outlineCenter(prims) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); };
  for (const s of prims) {
    if (s.type === 'line') { add(s.p1.x, s.p1.y); add(s.p2.x, s.p2.y); }
    else { add(s.c.x - s.r, s.c.y - s.r); add(s.c.x + s.r, s.c.y + s.r); }
  }
  return {x: (x0 + x1) / 2, y: (y0 + y1) / 2};
}
// 與封閉共用同一套幾何檢查，避免預覽與完成讀數不同。
function polygonGeometry(points) {
  if(points.length<3)return {status:'too-few'};
  const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  if(points.some((a,i)=>Math.hypot(a.x-points[(i+1)%points.length].x,a.y-points[(i+1)%points.length].y)<1e-9))return {status:'invalid',reason:'相鄰點重複，請重新圈選'};
  for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++){
    if(j===i+1||(i===0&&j===points.length-1))continue;
    const a=points[i],b=points[(i+1)%points.length],c=points[j],d=points[(j+1)%points.length];
    const overlap=Math.max(Math.min(a.x,b.x),Math.min(c.x,d.x))<=Math.min(Math.max(a.x,b.x),Math.max(c.x,d.x))&&Math.max(Math.min(a.y,b.y),Math.min(c.y,d.y))<=Math.min(Math.max(a.y,b.y),Math.max(c.y,d.y));
    if(overlap&&cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0)return {status:'invalid',reason:'邊界交叉或重疊，請重新圈選'};
  }
  for(let i=0;i<points.length;i++){const a=points[(i+points.length-1)%points.length],b=points[i],c=points[(i+1)%points.length];if(Math.abs(cross(a,b,c))<1e-10&&(b.x-a.x)*(c.x-b.x)+(b.y-a.y)*(c.y-b.y)<0)return {status:'invalid',reason:'邊界交叉或重疊，請重新圈選'};}
  let twice=0,perimeter=0;const outline=[];
  points.forEach((a,i)=>{const b=points[(i+1)%points.length];twice+=a.x*b.y-b.x*a.y;perimeter+=Math.hypot(b.x-a.x,b.y-a.y);outline.push({type:'line',p1:a,p2:b});});
  if(Math.abs(twice)<1e-12)return {status:'invalid',reason:'無法計算面積，請重新圈選'};
  return {status:'ok',area:Math.abs(twice)/2,perimeter,outline};
}
let polygonIssue=null;
function updatePolygonNotice(geometry) {
  const issue=geometry?.status==='invalid' ? geometry.reason : null;
  if(issue && (issue!==polygonIssue || $('notice').hidden || $('noticeText').textContent!==issue)){notice(issue,0);polygonIssue=issue;}
  else if(!issue && polygonIssue){if($('noticeText').textContent===polygonIssue)$('notice').hidden=true;polygonIssue=null;}
}
// 讀數卡只在有量測值時出現；命中但無法可靠量測時只標出外框，原因用提示顯示，不留上一次的數字。
function showMeasurement() {
  const m=measurement, active=markRecords.find(mark=>mark.key===activeMarkKey), unit=active ? active.unit : scene?.unit;
  const previewPolygon=m?.kind==='polygon' && !m.finished ? polygonGeometry(m.points) : null;
  const closed=m?.kind==='polygon' && (m.finished || (polygonAutoClose && previewPolygon?.status==='ok'));
  updatePolygonNotice(polygonAutoClose ? previewPolygon : null);
  let card = null;
  renderer.points = m?.kind === 'distance' || m?.kind === 'polygon' ? m.points : [];
  renderer.polygon = m?.kind === 'polygon';
  renderer.outline = m?.kind === 'area' ? m.pick.outline || null : m?.kind === 'polygon' ? (m.finished ? m.outline : closed ? previewPolygon.outline : null) : null;
  renderer.label = null;
  if (m?.kind === 'distance' && m.points.length === 2) {
    const [a, b] = m.points, d = Math.hypot(b.x - a.x, b.y - a.y), name = unit ? displayUnit.name : '圖面單位';
    const val = n => unit ? convertLength(n, unit, displayUnit) : n;
    renderer.label = {at: {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2}, text: `${fmt(val(d))} ${name}`, dy: -18};
    card = {label: '距離', value: fmt(val(d)), unit: name, lines: [`Δx ${fmt(val(b.x - a.x))} ${name}`, `Δy ${fmt(val(b.y - a.y))} ${name}`]};
  } else if ((m?.kind === 'area' && m.pick.status === 'ok') || closed) {
    const {area, perimeter, approximate, outline} = m.kind === 'area' ? m.pick : m.finished ? m : previewPolygon;
    const label = approximate ? '面積（近似）' : '面積';
    const areaValue = unit ? convertArea(area, unit, displayUnit) : area;
    const lengthValue = unit ? convertLength(perimeter, unit, displayUnit) : perimeter;
    const name = unit ? displayUnit.name : '圖面單位';
    card = {label, value: fmtArea(areaValue), unit: `${name}²`, lines: [`周長 ${fmt(lengthValue)} ${name}`, unit ? '' : '來源單位未知']};
    renderer.label = {at: outlineCenter(outline), text: `${card.value} ${card.unit}`};
  }
  if (activeMarkKey) renderer.label = null; // 已儲存標記以編號顯示，避免數值膠囊遮住編號。
  $('result').hidden = !card; $('viewerLayer').classList.toggle('has-result', !!card);
  $('saveMark').disabled = !!activeMarkKey || savingMark || (m?.kind==='polygon' && !closed);
  $('saveMark').setAttribute('aria-label', activeMarkKey ? '已儲存標記' : '儲存標記');
  $('clear').setAttribute('aria-label', activeMarkKey ? '刪除此標記' : '清除目前量測');
  if (card) {
    $('resultLabel').textContent = card.label;
    $('resultValue').textContent = card.value;
    $('resultUnit').textContent = card.unit;
    $('resultLine1').textContent = card.lines[0];
    $('resultLine2').textContent = card.lines[1];
    positionReadoutSurroundings();
  }
  renderer.draw();
}
function positionReadoutSurroundings() {
  if($('result').hidden)return;
  const readout=$('result');
  $('viewerLayer').style.setProperty('--app-after-readout',`${readout.offsetTop+readout.offsetHeight+12}px`);
}
window.addEventListener('resize',positionReadoutSurroundings);
$('measure').onclick = () => setTool(tool === 'distance' ? null : 'distance');
function positionAreaMenu() {
  const button = $('area').getBoundingClientRect(), view = $('viewerLayer').getBoundingClientRect(), dock = document.querySelector('.vv-dock').getBoundingClientRect();
  $('areaMenu').style.left = `${button.left + button.width / 2 - view.left}px`;
  const gap = cssNumber('--area-menu-gap', 40), offset = cssNumber('--area-menu-offset', 40);
  // 兩顆按鈕各 44px：選單頂緣 = Dock 膠囊上緣 - 選單高度（88 + 兩顆之間的間距） - 「逐點封閉」下緣到 Dock 上緣的距離
  $('areaMenu').style.top = `${dock.top - view.top - (88 + gap + offset)}px`;
  $('viewerLayer').style.setProperty('--app-area-menu-right', `${button.left + button.width / 2 - view.left + 74}px`);
}
window.addEventListener('resize', () => { if (!$('areaMenu').hidden) positionAreaMenu(); updateDockIndicator(false); });
function closeAreaMenu() { const wasOpen = !$('areaMenu').hidden; $('areaMenu').hidden = true; $('viewerLayer').classList.remove('area-menu-open'); $('area').setAttribute('aria-expanded', 'false'); if (tool==='polygon') $('polygonActions').hidden=false; if(wasOpen) renderer.draw(); }
$('area').onclick = () => { if(tool==='area' || tool==='polygon'){closeAreaMenu(); setTool(null); return;} const opening = $('areaMenu').hidden; if (opening) { positionAreaMenu(); $('polygonActions').hidden=true; } else if(tool==='polygon') $('polygonActions').hidden=false; $('areaMenu').hidden = !opening; $('viewerLayer').classList.toggle('area-menu-open', opening); $('area').setAttribute('aria-expanded', String(opening)); renderer.draw(); if (opening) $('areaClosed').focus({preventScroll:true}); };
$('areaClosed').onclick = () => { closeAreaMenu(); setTool('area'); $('area').focus({preventScroll:true}); };
$('polygon').onclick = () => { closeAreaMenu(); setTool('polygon'); $('area').focus({preventScroll:true}); };
function clearCurrent() { clearTimeout(noticeTimer); $('notice').hidden=true; recordPrevious(); measurement=null; activeMarkKey=null; if(tool==='polygon') { $('polygonActions').hidden=false; $('polygonStatus').textContent='請點選至少 3 個點'; } clearPreview(); showMeasurement(); persistState(); }
$('clearDock').onclick = () => { closeAreaMenu(); clearCurrent(); };
$('clear').onclick = async () => { if (!activeMarkKey) { clearCurrent(); return; } await removeSavedMark(activeMarkKey); };
$('snap').onclick = () => { snapping = !snapping; $('snap').setAttribute('aria-pressed', String(snapping)); clearPreview(); };
$('zoomIn').onclick = () => { clearPreview(); renderer.zoom(1.35); };
$('zoomOut').onclick = () => { clearPreview(); renderer.zoom(1 / 1.35); };
$('fit').onclick = () => { clearPreview(); measureInsets(); renderer.fit(); };

$('saveMark').onclick = async () => {
  if (!measurement || !currentRecordId || activeMarkKey) return;
  if (measurement.kind==='polygon' && !measurement.finished) {
    const geometry=polygonAutoClose && polygonGeometry(measurement.points);
    if (!geometry || geometry.status!=='ok') return;
    Object.assign(measurement,{finished:true,area:geometry.area,perimeter:geometry.perimeter,outline:geometry.outline});
  }
  const id=currentRecordId, key=`${Date.now()}-${Math.random().toString(36).slice(2)}`, savedMeasurement=measurement;
  const savedHistoryLength=undoStack.length, beforeSave=undoStack.slice(0,savedHistoryLength), value=JSON.stringify(measurement);
  const complete=s=>s?.measurement && (s.measurement.kind==='distance' ? s.measurement.points?.length===2 : s.measurement.kind==='polygon' ? !!s.measurement.finished : s.measurement.kind==='area' && s.measurement.pick?.status==='ok');
  let baseline=-1; for(let i=beforeSave.length-1;i>=0;i--)if(complete(beforeSave[i]) && JSON.stringify(beforeSave[i].measurement)!==value){baseline=i;break;}
  const prior=baseline>=0 ? structuredClone(beforeSave[baseline]) : null;
  savingMark=true; $('saveMark').disabled=true; updateHistoryControls();
  const mark={key, measurement:structuredClone(measurement), unit:scene.unit, label:`${$('resultLabel').textContent} ${$('resultValue').textContent} ${$('resultUnit').textContent}`};
  try { await addMark(id, mark); const record=await getDrawing(id); if (id!==currentRecordId) return;
    const earlier=baseline>=0 ? beforeSave.slice(0,baseline) : beforeSave.filter(s=>s.undoMarkKey), later=undoStack.slice(savedHistoryLength);
    markRecords=record.marks||[]; undoStack=[...earlier,{undoMarkKey:key,restore:prior},...later];
    if(measurement===savedMeasurement)activeMarkKey=key;
    updateSavedMarks(); showMeasurement(); persistState(); }
  catch { notice('標記儲存失敗',4000); }
  finally { savingMark=false; $('saveMark').disabled=!!activeMarkKey || (measurement?.kind==='polygon' && !measurement.finished); updateHistoryControls(); }
};
async function removeSavedMark(key) {
  const id=currentRecordId;
  try {
    await deleteMark(id,key); if(id!==currentRecordId)return;
    markRecords=markRecords.filter(m=>m.key!==key); undoStack=undoStack.filter(s=>s.activeMarkKey!==key && s.undoMarkKey!==key);
    if(activeMarkKey===key){measurement=null;activeMarkKey=null;} updateSavedMarks(); showMeasurement(); persistState();
  } catch { notice('標記刪除失敗',4000); }
}
function selectSavedMark(mark) {
  recordPrevious(); measurement=structuredClone(mark.measurement); activeMarkKey=mark.key;
  if(tool) { tool=null; $('measure').setAttribute('aria-pressed','false'); $('area').setAttribute('aria-pressed','false'); $('areaClosed').setAttribute('aria-pressed','false'); $('polygon').setAttribute('aria-pressed','false'); $('polygonActions').hidden=true; delete canvas.dataset.tool; updateDockIndicator(); }
  updateSavedMarks(); showMeasurement(); persistState();
}
async function renderMarks() {
  const record=await getDrawing(currentRecordId), list=$('marksList'); list.replaceChildren();
  if(!record?.marks?.length){list.textContent='尚無儲存的標記';return;}
  const rows=document.createElement('ul'); rows.className='vv-rows';
  for(const mark of record.marks){
    // 由左到右：編號、名稱、數值、垃圾桶。列沒有外框與填色；左邊三段合成一顆可點的按鈕（選取該標記），只有垃圾桶是另一顆。
    const row=document.createElement('li'), open=document.createElement('button'), remove=document.createElement('button');
    const no=document.createElement('span'), name=document.createElement('span'), value=document.createElement('span');
    const [label,...rest]=String(mark.label).split(' ');
    row.className='vv-mark-row'; open.className='app-mark-open'; remove.className='vv-icon-btn is-off';
    no.className='vv-mark-row__no'; name.className='vv-mark-row__name'; value.className='vv-mark-row__value';
    no.textContent=String(mark.number); name.textContent=label; value.textContent=rest.join(' ');
    open.type=remove.type='button'; remove.setAttribute('aria-label',`刪除標記 ${mark.number}`);
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'), use=document.createElementNS('http://www.w3.org/2000/svg','use'); svg.classList.add('vv-icon'); svg.setAttribute('aria-hidden','true'); use.setAttribute('href','#t-trash'); svg.append(use); remove.append(svg);
    open.onclick=()=>{ $('marksClose').click(); selectSavedMark(mark); };
    remove.onclick=async()=>{ await removeSavedMark(mark.key); await renderMarks(); };
    open.append(no,name,value); row.append(open,remove); rows.append(row);
  }
  list.append(rows);
}
$('marksOpen').onclick=async()=>{closeSpeed();$('marksDialog').hidden=false;$('viewerLayer').inert=true;$('marksClose').focus();try{await renderMarks();}catch{$('marksList').textContent='無法讀取標記';}};
$('marksClose').onclick=()=>{$('marksDialog').hidden=true;$('viewerLayer').inert=false;$('speedToggle').focus();};
function updateUnitMetadata() {
  const name = displayUnit.name;
  $('unitHint').textContent = scene?.unit ? `面積 ${name}² | 長度 ${name}` : '面積 圖面單位² | 長度 圖面單位（來源未知）';
  $('unitStatus').textContent = scene?.unit ? '來源設定僅套用本次開圖。' : '來源未知，請確認圖面單位。';
}
function openUnits() {
  closeSpeed();
  const select = $('sourceUnit');
  if (scene.unit?.name && ![...select.options].some(o => o.value === scene.unit.name)) select.add(new Option(scene.unit.name, scene.unit.name));
  select.value = scene.unit?.name || '';
  $('displayUnit').value = displayUnit.name;
  $('unitDialog').hidden = false; $('viewerLayer').inert = true; $('unitPanel').focus();
}
$('filename').onclick = openUnits;
$('sourceUnit').onchange = e => { scene.unit = unitByName(e.target.value); updateUnitMetadata(); showMeasurement(); };
$('displayUnit').onchange = e => { displayUnit = unitByName(e.target.value); localStorage.setItem('vidoviewer-display-unit', displayUnit.name); updateUnitMetadata(); showMeasurement(); };
$('unitClose').onclick = () => { $('unitDialog').hidden = true; $('viewerLayer').inert = false; $('filename').focus(); };
$('unitDialog').addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  const first=$('sourceUnit'), last=$('unitClose'), active=document.activeElement;
  if (e.shiftKey && (active === first || active === $('unitPanel'))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
});
function closeSpeed() { const wasOpen = !$('speedMenu').hidden; $('speedMenu').hidden = true; $('viewerLayer').classList.remove('speed-menu-open'); $('speedMenu').style.removeProperty('top'); $('speedToggle').setAttribute('aria-expanded', 'false'); if(wasOpen) renderer.draw(); }
$('speedToggle').onclick = () => {
  if (!$('speedMenu').hidden) { closeSpeed(); return; }
  $('speedMenu').hidden = false; $('speedToggle').setAttribute('aria-expanded', 'true'); $('viewerLayer').classList.add('speed-menu-open');
  const menu=$('speedMenu').getBoundingClientRect(), view=$('viewerLayer').getBoundingClientRect(), notice=document.querySelector('.vv-notices').getBoundingClientRect();
  if (view.height > 440 && notice.height) $('speedMenu').style.top = `${notice.bottom - document.querySelector('.app-speed').getBoundingClientRect().top + 12}px`;
  else if (view.height <= 440) $('viewerLayer').style.setProperty('--app-speed-menu-left', `${menu.left-view.left}px`);
  renderer.draw();
};
$('viewerHelpOpen').onclick = () => { closeSpeed(); $('viewerHelp').hidden = false; $('viewerLayer').inert = true; $('viewerHelpClose').focus(); };
$('viewerHelpClose').onclick = () => { $('viewerHelp').hidden = true; $('viewerLayer').inert = false; $('speedToggle').focus(); };
document.addEventListener('pointerdown', e => { if (!e.target.closest('.app-speed')) closeSpeed(); if (!e.target.closest('#areaMenu') && !e.target.closest('#area')) closeAreaMenu(); });
document.addEventListener('keydown', e => { if (e.key !== 'Escape') return; if (!$('marksDialog').hidden) $('marksClose').click(); else if (!$('unitDialog').hidden) $('unitClose').click(); else if (!$('viewerHelp').hidden) $('viewerHelpClose').click(); else if (!$('areaMenu').hidden) { closeAreaMenu(); $('area').focus(); } else if (!$('speedMenu').hidden) { closeSpeed(); $('speedToggle').focus(); } else if (tool && $('dialog').hidden) setTool(null); });
$('polygonBack').onclick = () => { if(measurement?.kind!=='polygon'||activeMarkKey||!measurement.points.length) return; recordPrevious(); if(measurement.finished){delete measurement.finished;delete measurement.area;delete measurement.perimeter;delete measurement.outline;}else measurement.points.pop(); $('polygonStatus').textContent=`已選 ${measurement.points.length} 點`; clearPreview(); showMeasurement(); persistState(); };
$('polygonClear').onclick = clearCurrent;
function finishPolygon() {
  const points=measurement?.kind==='polygon' ? measurement.points : [];
  const geometry=polygonGeometry(points);
  if(geometry.status!=='ok'){if(geometry.status==='too-few')notice('請至少選擇 3 個點',3000);else updatePolygonNotice(geometry);return;}
  clearTimeout(noticeTimer); $('notice').hidden=true; polygonIssue=null; recordPrevious();
  Object.assign(measurement,{finished:true,area:geometry.area,perimeter:geometry.perimeter,outline:geometry.outline});
  clearPreview(); showMeasurement(); persistState();
}
$('polygonClose').onclick=() => { polygonAutoClose=!polygonAutoClose; try { localStorage.setItem('polygonAutoClose',String(polygonAutoClose)); } catch {} $('polygonClose').setAttribute('aria-pressed',String(polygonAutoClose)); showMeasurement(); };

// ---------- 鎖點預覽：畫出來的框就是放開後採用的點 ----------
// preview: null | {screen, point, hit}；hit 來自 core 的 snapAt，沒鎖到時 point 是游標下的圖面座標。
let preview = null, previewFrame = 0, pendingPreview = null, holdTimer = 0;
function showPreview(screen, {loupe = false} = {}) {
  const world = renderer.world(screen.x, screen.y);
  const start = tool==='polygon' && !polygonAutoClose && measurement?.kind==='polygon' && !measurement.finished ? measurement.points[0] : null;
  const hitStart = start && Math.hypot(world.x-start.x, world.y-start.y) <= cssNumber('--hit-slop', 22) / renderer.scale;
  const hit = hitStart ? {point:start, type:'polygon-start'} : snapping ? snapAt(scene, world, cssNumber('--hit-slop', 22) / renderer.scale) : null;
  preview = {screen, hit, point: hit ? hit.point : world};
  renderer.preview = hit ? {point: hit.point, type: hit.type} : null;
  renderer.rubber = measurement?.kind === 'distance' && measurement.points.length === 1 ? preview.point : null;
  if (hit) { canvas.dataset.lockType = hit.type; canvas.dataset.lockX = String(hit.point.x); canvas.dataset.lockY = String(hit.point.y); }
  else { delete canvas.dataset.lockType; delete canvas.dataset.lockX; delete canvas.dataset.lockY; }
  renderer.draw();
  if (loupe) drawLoupe(screen); else hideLoupe();
}
function schedulePreview(screen, options) {
  pendingPreview = {screen, options};
  if (previewFrame) return;
  previewFrame = requestAnimationFrame(() => { previewFrame = 0; flushPreview(); });
}
function flushPreview() {
  if (previewFrame) cancelAnimationFrame(previewFrame);
  previewFrame = 0;
  const job = pendingPreview;
  pendingPreview = null;
  if (job && (tool === 'distance' || tool === 'polygon') && scene) showPreview(job.screen, job.options);
}
function clearPreview() {
  clearTimeout(holdTimer);
  if (previewFrame) cancelAnimationFrame(previewFrame);
  previewFrame = 0;
  pendingPreview = null;
  preview = null;
  renderer.preview = null;
  renderer.rubber = null;
  delete canvas.dataset.lockType; delete canvas.dataset.lockX; delete canvas.dataset.lockY;
  hideLoupe();
  renderer.draw();
}
function hideLoupe() { $('loupeBox').hidden = true; $('lockTag').hidden = true; }
// 放大鏡直接複製主畫布上鎖定點周圍的像素（倍率 3），所以看到的框與放開後的落點是同一個。
function drawLoupe(finger) {
  const box = $('loupeBox'), lens = $('loupe'), tag = $('lockTag'), target = renderer.screen(preview.point), dpr = renderer.dpr;
  box.hidden = false;
  const size = box.offsetWidth || 112, half = size / 2, above = finger.y - 90 - half >= 8;
  const cx = Math.max(half + 4, Math.min(renderer.w - half - 4, finger.x)), cy = above ? finger.y - 90 : finger.y + 90;
  box.style.setProperty('--vv-x', `${cx}px`);
  box.style.setProperty('--vv-y', `${cy}px`);
  if (lens.width !== Math.round(size * dpr)) lens.width = lens.height = Math.round(size * dpr);
  const ctx = lens.getContext('2d'), src = size * dpr / 3, css = getComputedStyle(document.documentElement);
  ctx.fillStyle = css.getPropertyValue('--canvas').trim() || '#212830';
  ctx.fillRect(0, 0, lens.width, lens.height);
  ctx.drawImage(canvas, target.x * dpr - src / 2, target.y * dpr - src / 2, src, src, 0, 0, lens.width, lens.height);
  if (!preview.hit) { // 沒鎖到點時用十字標出落點
    const c = lens.width / 2, arm = 10 * dpr;
    ctx.beginPath(); ctx.moveTo(c - arm, c); ctx.lineTo(c + arm, c); ctx.moveTo(c, c - arm); ctx.lineTo(c, c + arm);
    ctx.strokeStyle = css.getPropertyValue('--canvas').trim() || '#212830'; ctx.lineWidth = 4 * dpr; ctx.stroke();
    ctx.strokeStyle = css.getPropertyValue('--accent').trim() || '#4CD7F6'; ctx.lineWidth = 1.5 * dpr; ctx.stroke();
  }
  tag.hidden = !preview.hit;
  if (preview.hit) {
    tag.textContent = SNAP_NAMES[preview.hit.type];
    tag.style.setProperty('--vv-x', `${cx}px`);
    tag.style.setProperty('--vv-y', `${cy + half + 16}px`);
  }
}

// ---------- 指標手勢 ----------
// gesture.phase：press（按下未移動）→ aim（觸控長按，放大鏡瞄準）| pan（拖曳平移）；pinch（雙指）。
// 只有 press 與 aim 放開時落點；pan 與 pinch 永遠不落點。
const pointers = new Map();
let gesture = null, aimTimer = 0;
const pos = e => { const r = canvas.getBoundingClientRect(); return {x: e.clientX - r.left, y: e.clientY - r.top}; };
const pair = () => { const [a, b] = [...pointers.values()]; return {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y)}; };
function endGesture() {
  clearTimeout(aimTimer);
  gesture = null;
  $('side').classList.remove('is-hidden');
  hideLoupe();
}
function placePoint(point) {
  recordPrevious(true); activeMarkKey=null;
  const first = measurement?.kind === 'distance' && measurement.points.length === 1 ? measurement.points[0] : null;
  measurement = {kind: 'distance', points: first ? [first, {...point}] : [{...point}]};
  if (first) { clearTimeout(noticeTimer); $('notice').hidden=true; }
  showMeasurement(); persistState();
}
function pickArea(screen) {
  const pick = pickClosed(scene, renderer.world(screen.x, screen.y), cssNumber('--hit-slop', 22) / renderer.scale);
  if (pick.status !== 'miss' || measurement) recordPrevious(pick.status !== 'miss');
  activeMarkKey=null;
  measurement = pick.status === 'miss' ? null : {kind: 'area', pick};
  if (pick.status === 'miss') notice('沒有點到封閉邊界', 2500);
  else if (pick.status === 'unreliable') notice(`無法可靠量測：${UNRELIABLE[pick.reason] || '原因不明'}`, 6000);
  else $('notice').hidden = true;
  showMeasurement(); persistState();
}
function selectSavedAt(screen) {
  const c=canvas.getContext('2d'), threshold=12;
  const nearSegment=(p,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy)<=threshold;};
  for(const mark of [...markRecords].reverse()){
    const m=mark.measurement; if(!m)continue; let hit=false;
    if(m.kind==='distance'&&m.points?.length===2) hit=nearSegment(screen,...m.points.map(p=>renderer.screen(p)));
    else {const outline=m.kind==='area'?m.pick?.outline:m.outline;if(outline?.length){c.save();c.setTransform(1,0,0,1,0,0);c.lineWidth=threshold*2;c.beginPath();renderer.tracePrims(c,outline);hit=c.isPointInPath(screen.x,screen.y,'evenodd')||c.isPointInStroke(screen.x,screen.y);c.restore();}}
    if(hit){selectSavedMark(mark);return;}
  }
}
canvas.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  canvas.setPointerCapture(e.pointerId);
  const p = pos(e);
  pointers.set(e.pointerId, p);
  clearTimeout(holdTimer);
  if (pointers.size > 1) { endGesture(); clearPreview(); gesture = {phase: 'pinch', last: pair()}; return; }
  gesture = {phase: 'press', start: p, last: p, touch: e.pointerType !== 'mouse'};
  if ((tool !== 'distance' && tool !== 'polygon') || !scene || !gesture.touch) return;
  showPreview(p); // 觸控一按下就先看到鎖點框
  aimTimer = setTimeout(() => {
    if (gesture?.phase !== 'press') return;
    gesture.phase = 'aim';
    $('side').classList.add('is-hidden');
    showPreview(gesture.last, {loupe: true});
  }, LONG_PRESS);
});
canvas.addEventListener('pointermove', e => {
  const p = pos(e);
  if (!pointers.has(e.pointerId)) { // 滑鼠未按鍵移動：只預覽
    if (e.pointerType === 'mouse' && e.buttons === 0 && (tool === 'distance' || tool === 'polygon') && scene) schedulePreview(p);
    return;
  }
  pointers.set(e.pointerId, p);
  if (!gesture) return;
  if (gesture.phase === 'pinch') {
    if (pointers.size < 2) return;
    const next = pair();
    renderer.pan(next.x - gesture.last.x, next.y - gesture.last.y);
    if (gesture.last.d > 0) renderer.zoom(next.d / gesture.last.d, next.x, next.y);
    gesture.last = next;
  } else if (gesture.phase === 'aim') {
    gesture.last = p;
    schedulePreview(p, {loupe: true});
  } else {
    if (gesture.phase === 'press') {
      if (Math.hypot(p.x - gesture.start.x, p.y - gesture.start.y) <= DRAG_SLOP) return;
      gesture.phase = 'pan';
      clearTimeout(aimTimer);
      clearPreview();
    }
    renderer.pan(p.x - gesture.last.x, p.y - gesture.last.y);
    gesture.last = p;
  }
});
function release(e, cancelled) {
  if (!pointers.has(e.pointerId)) return;
  const p = pos(e), ended = gesture;
  pointers.delete(e.pointerId);
  if (pointers.size) { clearTimeout(aimTimer); gesture = {phase: 'pan', last: [...pointers.values()][0], touch: true}; return; }
  endGesture();
  if (!cancelled && scene && !tool && ended?.phase==='press') { selectSavedAt(p); return; }
  const placing = !cancelled && scene && tool && (ended?.phase === 'press' || ended?.phase === 'aim');
  if (!placing) { if (cancelled || ended?.touch) clearPreview(); return; }
  if (tool === 'area') { pickArea(p); return; }
  flushPreview();
  showPreview(p); // 放開位置與最後顯示的鎖點使用相同判斷
  if (tool === 'polygon') {
    if (!measurement || measurement.kind !== 'polygon' || measurement.finished) { recordPrevious(true); activeMarkKey=null; measurement = {kind: 'polygon', points: []}; $('polygonActions').hidden = false; }
    else if(measurement.points.length) { const start=renderer.screen(measurement.points[0]), at=renderer.screen(preview.point); if((preview.hit ? Math.hypot(preview.point.x-measurement.points[0].x,preview.point.y-measurement.points[0].y)<1e-9 : Math.hypot(start.x-at.x,start.y-at.y)<=12)){ if(measurement.points.length<3)notice('請至少選擇 3 個點',3000);else finishPolygon(); return; } recordPrevious(); }
    measurement.points.push({...preview.point});
    $('polygonStatus').textContent = `已選 ${measurement.points.length} 點`;
    showMeasurement(); persistState();
  } else placePoint(preview.point);
  if (ended.touch) holdTimer = setTimeout(clearPreview, cssNumber('--snap-hold', 800)); // 點一下後鎖點框停留片刻
  else showPreview(p);
}
canvas.addEventListener('pointerup', e => release(e, false));
canvas.addEventListener('pointercancel', e => release(e, true));
canvas.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !pointers.has(e.pointerId)) clearPreview(); });
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const p = pos(e);
  clearPreview();
  renderer.zoom(Math.exp(-e.deltaY * .001), p.x, p.y);
  if ((tool === 'distance' || tool === 'polygon') && scene && !pointers.size) schedulePreview(p);
}, {passive: false});

// ---------- 啟動 ----------
if (parser.interrupted()) dialog('上次開啟時被中止', '', '了解', '').then(() => parser.clearInterrupted());
home.start().then(() => {
  if (!$('toast').hidden) return; // 正在顯示「已刪除　復原」時不蓋掉它
  if (!window.isSecureContext) home.toast('此網址為 HTTP，無法離線使用', {ms: 5000});
  else if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => home.toast('離線快取無法啟用'));
});
const hash = location.hash.match(/^#drawing=(\d+)$/);
if (hash) {
  const id = Number(hash[1]);
  history.replaceState({drawingId: id, fromLibrary: !!history.state?.fromLibrary}, '', location.href);
  openRecord(id, false);
}
