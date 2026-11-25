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

// 第二組啟用、設定不完整與重複帳號的行為。
const { matchAccount } = await import('../functions/_lib/auth.js');
const dual = {...env, AUTH_USER_2:'second', AUTH_PASSWORD_2:'second-password'};
assert.equal(await matchAccount(dual, 'test', 'test-password'), 1);
assert.equal(await matchAccount(dual, 'second', 'second-password'), 2);
assert.equal(await matchAccount(dual, 'test', 'second-password'), 0);
for (const partial of [{AUTH_USER_2:'second'}, {AUTH_PASSWORD_2:'second-password'}, {AUTH_USER_2:'test', AUTH_PASSWORD_2:'second-password'}]) {
  const config = {...env, ...partial};
  assert.equal(await matchAccount(config, 'second', 'second-password'), 0);
  assert.equal(await matchAccount(config, 'test', 'second-password'), 0);
  await assert.rejects(issueToken(config, 1000, 2));
}
const firstToken = await issueToken(dual, 1000, 1);
const secondToken = await issueToken(dual, 1000, 2);
for (const [key, firstValid, secondValid] of [['AUTH_PASSWORD', false, true], ['AUTH_PASSWORD_2', true, false]]) {
  const changed = {...dual, [key]:'new-password'};
  assert.equal((await checkToken(changed, firstToken, 1001)).valid, firstValid);
  assert.equal((await checkToken(changed, secondToken, 1001)).valid, secondValid);
}
for (const key of Object.keys(env)) {
  const invalid = {...dual}; delete invalid[key];
  const response = await onRequest({request:new Request('https://example.test/app.js'), env:invalid, next:() => new Response('unexpected')});
  assert.equal(response.status, 503);
}
const oldSecond = await issueToken(dual, Math.floor(Date.now()/1000) - 86402, 2);
const renewed = await onRequest({request:new Request('https://example.test/', {headers:{Cookie:`__Host-vv_auth=${oldSecond}`, Accept:'text/html'}}), env:dual, next:() => new Response('ok')});
const renewedToken = renewed.headers.get('set-cookie').split(';')[0].split('=')[1];
assert.deepEqual(await checkToken(dual, renewedToken), {valid:true, renew:false, account:2});
assert.equal((await checkToken({...dual, AUTH_PASSWORD:'new-password'}, renewedToken)).valid, true);
assert.equal((await checkToken({...dual, AUTH_PASSWORD_2:'new-password'}, renewedToken)).valid, false);
const { onRequestPost: login } = await import('../functions/api/login.js');
for (const key of Object.keys(env)) {
  const invalid = {...dual}; delete invalid[key];
  const request = new Request('https://example.test/api/login', {method:'POST', headers:{Accept:'application/json'}, body:new URLSearchParams({username:'second', password:'second-password'})});
  assert.equal((await login({request, env:invalid})).status, 503);
}
console.log('雙帳號、獨立撤銷及續期測試通過');
