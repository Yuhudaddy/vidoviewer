// /login 為 Pages 的正式登入網址；沿用查詢參數中的站內返回路徑。
const params = new URLSearchParams(location.search);
document.querySelector('[name=next]').value = params.get('next') || '/';
if (params.has('e')) document.querySelector('#error').hidden = false;
