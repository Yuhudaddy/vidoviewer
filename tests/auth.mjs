import assert from 'node:assert/strict';
import { issueToken, checkToken, SESSION_SECONDS, sessionCookie } from '../functions/_lib/auth.js';
import { onRequest } from '../functions/_middleware.js';
const env = {AUTH_USER:'test', AUTH_PASSWORD:'test-password', SESSION_SECRET:'a'.repeat(40)};
const token = await issueToken(env, 1000);
assert.equal((await checkToken(env, token, 1001)).valid, true);
assert.equal((await checkToken(env, token, 1000 + SESSION_SECONDS)).valid, false);
assert.equal((await checkToken(env, token + 'x', 1001)).valid, false);
assert.equal((await checkToken({...env, AUTH_PASSWORD:'changed'}, token, 1001)).valid, false);
assert.match(sessionCookie(token), /Secure; HttpOnly; SameSite=Lax/);
for (const key of Object.keys(env)) {
  const invalid = {...env}; delete invalid[key];
  const response = await onRequest({request:new Request('https://example.test/app.js'), env:invalid, next:() => new Response('unexpected')});
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
}
console.log('驗證閘門測試通過');

const { onRequestPost: logout } = await import('../functions/api/logout.js');
const old = await issueToken(env, Math.floor(Date.now()/1000) - 86402);
const current = await issueToken(env);
async function gate(path, method, headers = {}, next = () => new Response('ok')) {
  return onRequest({request: new Request('https://example.test' + path, {method, headers}), env, next});
}
for (const path of ['/login', '/login.html']) assert.equal((await gate(path, 'GET')).status, 200);
let response = await gate('/', 'GET', {Cookie:`__Host-vv_auth=${old}`, Accept:'text/html'});
assert.match(response.headers.get('set-cookie'), /__Host-vv_auth=/);
response = await gate('/', 'GET', {Cookie:`__Host-vv_auth=${current}`, Accept:'text/html'});
assert.equal(response.headers.get('set-cookie'), null);
response = await gate('/app.js', 'GET', {Cookie:`__Host-vv_auth=${old}`});
assert.equal(response.headers.get('set-cookie'), null);
response = await gate('/api/logout', 'POST', {Cookie:`__Host-vv_auth=${old}`, Origin:'https://example.test'}, () => logout({request: new Request('https://example.test/api/logout', {method:'POST', headers:{Origin:'https://example.test'}})}));
assert.equal(response.status, 303);
assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
assert.equal((response.headers.get('set-cookie').match(/__Host-vv_auth/g) || []).length, 1);
for (const headers of [{Origin:'https://evil.test'}, {'Sec-Fetch-Site':'cross-site'}, {}]) {
  const request = new Request('https://example.test/api/logout', {method:'POST', headers});
  assert.equal(logout({request}).status, 403);
  assert.equal((await onRequest({request, env, next: () => logout({request})})).status, 403);
}
assert.equal(logout({request:new Request('https://example.test/api/logout',{method:'POST',headers:{'Sec-Fetch-Site':'same-origin'}})}).status, 303);
assert.equal((await gate('/private', 'GET', {Accept:'text/html'})).headers.get('location'), '/login?next=%2Fprivate');
response = await gate('/', 'GET', {'Sec-Fetch-Mode':'same-origin', 'Sec-Fetch-Dest':'empty', Accept:'text/html'});
assert.equal(response.status, 302);
assert.match(response.headers.get('location'), /^\/login\?/);
console.log('續期、登入路由及登出來源測試通過');
