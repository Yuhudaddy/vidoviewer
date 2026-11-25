import { sameOriginLogout } from './_lib/request.js';
import { checkToken, isConfigured, isNavigation, isPublicPath, readCookie, issueToken, sessionCookie } from './_lib/auth.js';

const security = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; worker-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'",
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer'
};
export async function onRequest(context) {
  const {request, env} = context;
  const url = new URL(request.url);
  let response;
  if (isPublicPath(url.pathname)) response = await context.next();
  else if (!isConfigured(env)) response = new Response('登入尚未設定完成，請聯絡管理員。', {status: 503});
  else if (url.pathname === '/api/logout' && request.method === 'POST' && !sameOriginLogout(request)) response = new Response('禁止跨來源登出', {status: 403});
  else {
    const session = await checkToken(env, readCookie(request));
    if (session.valid) {
      response = await context.next();
      if (session.renew && request.method === 'GET' && isNavigation(request)) {
        response = new Response(response.body, response);
        response.headers.append('Set-Cookie', sessionCookie(await issueToken(env, undefined, session.account)));
      }
    }
    else if (isNavigation(request)) response = new Response(null, {status: 302, headers: {Location: '/login?' + new URLSearchParams({next: url.pathname + url.search})}});
    else response = new Response('需要登入', {status: 401});
  }
  const result = new Response(response.body, response);
  for (const [key, value] of Object.entries(security)) result.headers.set(key, value);
  result.headers.set('Cache-Control', 'no-store');
  return result;
}
