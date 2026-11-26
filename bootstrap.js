// 無法取得狀態時允許離線開啟；遠端停用無法保護長期離線的裝置。
let disabled = false;
try {
  const response = await fetch('./status.json', {cache: 'no-store', signal: AbortSignal.timeout(5000)});
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const status = await response.json();
  if (status.enabled === false) {
    disabled = true;
    document.body.replaceChildren();
    const message = document.createElement('main');
    message.setAttribute('role', 'alert');
    message.textContent = typeof status.message === 'string' ? status.message : '服務目前暫停使用。';
    message.className = 'service-disabled';
    document.body.append(message);
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.filter(reg => reg.scope === new URL('./', location.href).href).map(reg => reg.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter(key => /^vidoviewer-(shell|design|lan)-/.test(key) || key === 'vidoviewer-inbox').map(key => caches.delete(key)));
    }
  } else if (status.enabled !== true) throw new Error('狀態格式無效');
} catch (error) { console.warn('無法確認服務狀態，允許離線使用：', error); }
if (!disabled) await import('./app.js');
