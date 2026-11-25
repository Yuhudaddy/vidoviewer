// 僅供本機瀏覽器測試，模擬 Pages Functions 路由。
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname, resolve, sep} from 'node:path';
import {onRequest} from '../functions/_middleware.js';
import {onRequestPost as login} from '../functions/api/login.js';
import {onRequestPost as logout} from '../functions/api/logout.js';
const root = resolve('.');
const env = {AUTH_USER:'test', AUTH_PASSWORD:'test-password', AUTH_USER_2:'second', AUTH_PASSWORD_2:'second-password', SESSION_SECRET:'a'.repeat(40)};
let slowNextApp = false;
const types = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.webmanifest':'application/manifest+json', '.png':'image/png'};
http.createServer(async (req,res) => {
  try {
    const chunks=[]; for await (const chunk of req) chunks.push(chunk);
    const url = new URL(req.url, 'http://localhost:8766');
    const request = new Request(url, {method:req.method, headers:req.headers, ...(chunks.length ? {body:Buffer.concat(chunks)} : {})});
    const next = async () => {
      if (url.pathname === '/__test/slow') { slowNextApp = true; return new Response('ok'); }
      if (url.pathname === '/app.js' && slowNextApp) { slowNextApp = false; await new Promise(resolve => setTimeout(resolve, 6000)); }
      if (url.pathname === '/api/login' && req.method === 'POST') return login({request,env});
      if (url.pathname === '/api/logout' && req.method === 'POST') return logout({request});
      if (url.pathname === '/login.html') return new Response(null, {status: 308, headers: {Location: '/login' + url.search}});
      const path = url.pathname === '/' ? '/index.html' : url.pathname === '/login' ? '/login.html' : url.pathname;
      const file = resolve(root, '.' + path);
      if (!file.startsWith(root + sep)) return new Response('Forbidden',{status:403});
      try { return new Response(await readFile(file), {headers:{'Content-Type':types[extname(file)] || 'application/octet-stream'}}); }
      catch { return new Response('Not found',{status:404}); }
    };
    const response = await onRequest({request,env,next});
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) { console.error(e); res.writeHead(500).end(); }
}).listen(8766,'127.0.0.1');
