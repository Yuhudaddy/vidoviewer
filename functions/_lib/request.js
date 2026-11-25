// 瀏覽器表單應提供同源 Fetch Metadata 或相符的 Origin；缺少兩者時拒絕。
export function sameOriginLogout(request) {
  const site = request.headers.get('Sec-Fetch-Site');
  const origin = request.headers.get('Origin');
  return site === 'same-origin' || origin === new URL(request.url).origin;
}
