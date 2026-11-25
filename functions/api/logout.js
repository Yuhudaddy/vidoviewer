// POST /api/logout：清掉通行證，回登入頁。
import { sameOriginLogout } from "../_lib/request.js";
import { clearedCookie } from "../_lib/auth.js";

export function onRequestPost({ request }) {
  if (!sameOriginLogout(request)) return new Response("禁止跨來源登出", {status: 403, headers: {"Cache-Control": "no-store"}});
  return new Response(null, { status: 303, headers: { Location: "/login", "Set-Cookie": clearedCookie(), "Cache-Control": "no-store" } });
}
