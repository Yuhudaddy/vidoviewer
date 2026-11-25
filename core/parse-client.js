// 主執行緒端:包裝 Worker,提供 Promise、取消、逾時、大小上限。
//   const c = createParseClient({ workerUrl: '/core/parse-worker.js' });
//   const job = c.parse(file, { timeoutMs: 120000, onStage });   // → { promise, cancel() }
//   const { scene, stats, large } = await job.promise;
// 錯誤:Error 物件帶 .code:'too-large' | 'cancelled' | 'timeout' | 'not-cad' | 'parse-failed' | 'empty' | 'worker-crashed'
// 取消與逾時都靠 worker.terminate()(解析是同步的,唯一的中斷方式);下一次 parse 會自動重建 Worker。
// 匯入上限(使用者定案 2026-11-24):十進位,1 MB = 1,000,000 位元組,與 iPhone「檔案」App 的顯示一致。
// 「超過」才算:恰好等於上限可開;恰好等於提醒線不提醒。
export const HARD_LIMIT_BYTES = 65_000_000;   // 超過 65 MB 不開始解析
export const LARGE_WARN_BYTES = 30_000_000;   // 超過 30 MB 顯示大檔提醒

const fail = (code, message) => Object.assign(new Error(message), { code });

export function createParseClient({ workerUrl, WorkerCtor = Worker } = {}) {
  let worker = null, seq = 0;
  const ensure = () => (worker ??= new WorkerCtor(workerUrl, { type: 'module' }));
  const kill = () => { worker?.terminate(); worker = null; };

  function parse(file, { timeoutMs = 120000, onStage } = {}) {
    let settle, cancelFn;
    const promise = new Promise((resolve, reject) => {
      settle = { resolve, reject };
    });
    if (file.size > HARD_LIMIT_BYTES) {
      settle.reject(fail('too-large', `檔案超過 ${HARD_LIMIT_BYTES / 1e6} MB 上限`));
      return { promise, cancel() {} };
    }
    const id = ++seq;
    let done = false, timer = null;
    const finish = (fn, v) => { if (done) return; done = true; clearTimeout(timer); const w = worker; if (w) { w.removeEventListener('message', onMsg); w.removeEventListener('error', onErr); } fn(v); };
    const onMsg = (ev) => {
      const m = ev.data;
      if (m.id !== id) return;
      if (m.type === 'stage') onStage?.(m.stage);
      else if (m.type === 'result') finish(settle.resolve, { scene: m.scene, stats: m.stats, large: file.size > LARGE_WARN_BYTES });
      else if (m.type === 'error') finish(settle.reject, fail(m.code, m.message));
    };
    const onErr = (ev) => { kill(); finish(settle.reject, fail('worker-crashed', ev.message || 'Worker 發生錯誤')); };
    cancelFn = () => { if (done) return; kill(); finish(settle.reject, fail('cancelled', '已取消')); };
    file.arrayBuffer().then((buffer) => {
      if (done) return;
      const w = ensure();
      w.addEventListener('message', onMsg); w.addEventListener('error', onErr);
      timer = setTimeout(() => { if (done) return; kill(); finish(settle.reject, fail('timeout', `解析超過 ${timeoutMs / 1000} 秒,已中止`)); }, timeoutMs);
      w.postMessage({ type: 'parse', id, name: file.name, buffer }, [buffer]);
    }, (e) => finish(settle.reject, fail('parse-failed', String(e?.message ?? e))));
    return { promise, cancel: cancelFn };
  }

  return { parse, dispose: kill };
}
