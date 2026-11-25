import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const listeners = {};
let fetchImpl, timeoutDelay, cached = new Response('cached');
const context = {
  self: {location: {origin:'https://example.test'}, addEventListener: (name, fn) => listeners[name] = fn},
  caches: {match: async () => cached.clone()}, URL, Response, AbortController,
  fetch: (...args) => fetchImpl(...args),
  setTimeout: (fn, ms) => { timeoutDelay = ms; return setTimeout(fn, 10); }, clearTimeout
};
vm.runInNewContext(await readFile(new URL('../sw.js', import.meta.url), 'utf8'), context);
async function run(path) {
  let result;
  listeners.fetch({request: new Request('https://example.test' + path), respondWith: promise => result = promise});
  return result && await result;
}
fetchImpl = () => new Promise(() => {});
assert.equal(await (await run('/index.html')).text(), 'cached');
assert.equal(timeoutDelay, 4000);
fetchImpl = async () => new Response('unauthorized', {status:401});
assert.equal((await run('/app.js')).status, 401);
fetchImpl = async () => new Response(null, {status:302, headers:{Location:'/login'}});
assert.equal((await run('/index.html')).status, 302);
fetchImpl = async () => {throw Error('offline');};
assert.equal(await (await run('/app.js')).text(), 'cached');
assert.equal(await run('/login'), undefined);
assert.equal(await run('/login.html'), undefined);
assert.equal(await run('/status.json'), undefined);
console.log('Service Worker 超時、離線退回及線上驗證回應測試通過');
