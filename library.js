// Keep each imported original in this browser's IndexedDB; never send it to the server.
// Record: {id, name, format, blob, lastModified, added, openedAt?, favorite?, deletedAt?, example?, thumb?}
//   example   the built-in sample opened from the help sheet: kept so it can be reopened, never listed on the home screen.
//   thumb     small 16:10 picture of the drawing as a data: URL, made after a successful open; absent on older records.
//   openedAt  only set after a successful open; older records without it were never opened as far as we know.
//   deletedAt set while a delete can still be undone; the same record (blob, favorite, openedAt) comes back on undo.
const DB = 'vidoviewer-library', STORE = 'drawings';
export const UNDO_MS = 5000;

function database() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE, {keyPath: 'id', autoIncrement: true}); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function run(mode, work) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode), store = tx.objectStore(STORE);
    let request;
    try { request = work(store); } catch (e) { db.close(); reject(e); return; }
    tx.oncomplete = () => { const value = request.result; db.close(); resolve(value); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error('儲存已中止')); };
  });
}
// Read-modify-write inside one transaction so concurrent changes to a record cannot overwrite each other.
const update = (id, change) => run('readwrite', store => {
  const req = store.get(Number(id));
  req.onsuccess = () => { if (req.result) store.put(change(req.result)); };
  return req;
});

export const listDrawings = () => run('readonly', s => s.getAll());
export const getDrawing = id => run('readonly', s => s.get(Number(id)));
export const markOpened = id => update(id, r => ({...r, openedAt: Date.now()}));
export const setFavorite = (id, on) => update(id, r => ({...r, favorite: !!on}));
export const softDelete = id => update(id, r => ({...r, deletedAt: Date.now()}));
export const restoreDrawing = id => update(id, ({deletedAt, ...rest}) => rest);
function normalizeMarks(r) {
  const source = r.marks || [], used = new Set(source.map(m => m.number).filter(n => Number.isSafeInteger(n) && n > 0));
  let next = Math.max(r.nextMarkNumber || 1, ...[...used].map(n => n + 1));
  const marks = source.map(m => Number.isSafeInteger(m.number) && m.number > 0 ? m : {...m, number: next++});
  return {...r, marks, nextMarkNumber: next};
}
export const ensureMarkNumbers = id => update(id, normalizeMarks);
export const addMark = (id, mark) => update(id, r => { const base = normalizeMarks(r), number = base.nextMarkNumber; return {...base, nextMarkNumber: number + 1, marks: [...base.marks, {...mark, number}]}; });
export const setMeasurementState = (id, state) => update(id, r => ({...r, measurementState: state}));
export const deleteMark = (id, key) => update(id, r => ({...r, marks: (r.marks || []).filter(m => m.key !== key)}));
// 撤銷快照或最新標記時，資料與歷史放在同一筆交易；失敗時畫面維持原狀。
export async function undoMeasurementAtomic(id, key, history, unit, restore = null) {
  const db=await database();
  return new Promise((resolve,reject)=>{
    let tx, outcome={status:'changed'};
    try {
      tx=db.transaction(STORE,'readwrite'); const store=tx.objectStore(STORE), req=store.get(Number(id));
      req.onsuccess=()=>{
        const record=req.result, marks=record?.marks || [];
        if(!record || record.deletedAt || (key && marks.at(-1)?.key!==key))return;
        const remaining=key ? marks.slice(0,-1) : marks, previous=remaining.at(-1);
        const valid=new Set(remaining.map(mark=>mark.key));
        const fallback={tool:null,measurement:previous?.measurement ? structuredClone(previous.measurement) : null,activeMarkKey:previous?.key || null,unit};
        // 已手動刪掉的舊標記不能透過快照復活；未儲存的前一筆量測仍可還原。
        const empty={tool:null,measurement:null,activeMarkKey:null,unit};
        const current=restore && (!restore.activeMarkKey || valid.has(restore.activeMarkKey)) ? restore : key ? fallback : empty;
        const safeHistory=history.filter(s=>!s.undoMarkKey || valid.has(s.undoMarkKey)).filter(s=>!s.activeMarkKey || valid.has(s.activeMarkKey));
        const state={current,history:safeHistory,historyVersion:2};
        store.put({...record,marks:remaining,measurementState:state}); outcome={status:'ok',marks:remaining,current,history:safeHistory};
      };
      tx.oncomplete=()=>{db.close();resolve(outcome)};
      tx.onerror=()=>{db.close();reject(tx.error || new Error('復原失敗'))};
      tx.onabort=()=>{db.close();reject(tx.error || new Error('復原已中止'))};
    } catch (error) { db.close(); reject(error); }
  });
}
export const setThumbnail = (id, thumb) => update(id, r => ({...r, thumb}));
// Remove the local copy only if its delete is still pending: an undo from this or another tab wins.
export const purgeIfDeleted = id => run('readwrite', store => {
  const req = store.get(Number(id));
  req.onsuccess = () => { if (req.result?.deletedAt) store.delete(Number(id)); };
  return req;
});

async function sameBlob(a, b) {
  if (a.size !== b.size) return false;
  const chunk = 1024 * 1024;
  for (let i = 0; i < a.size; i += chunk) {
    const [x, y] = await Promise.all([a.slice(i, i + chunk).arrayBuffer(), b.slice(i, i + chunk).arrayBuffer()]);
    const u = new Uint8Array(x), v = new Uint8Array(y);
    for (let j = 0; j < u.length; j++) if (u[j] !== v[j]) return false;
  }
  return true;
}
// Same bytes are stored once. Importing a file whose delete is still undoable brings that record back.
export async function importDrawing(file, extra = {}) { // extra: e.g. {example: true} for the built-in sample
  const candidates = (await listDrawings()).filter(x => x.blob.size === file.size);
  for (const candidate of candidates) {
    if (!await sameBlob(candidate.blob, file)) continue;
    if (candidate.deletedAt) { await restoreDrawing(candidate.id); return {id: candidate.id, duplicate: false}; }
    if (candidate.example && !extra.example) { await update(candidate.id, ({example, ...rest}) => rest); return {id: candidate.id, duplicate: false}; }
    return {id: candidate.id, duplicate: true};
  }
  const id = await run('readwrite', s => s.add({name: file.name, format: file.name.split('.').pop().toUpperCase(), blob: file, lastModified: file.lastModified, added: Date.now(), ...extra}));
  return {id, duplicate: false};
}
