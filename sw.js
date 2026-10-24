const CACHE = 'appcv-v17';
const SHELL = ['./', './index.html', './style.css', './app.js', './chitieu.js', './lich.js', './lichloc.js', './tin.js', './tinloc.js', './bangthang.js','./firebase-config.js', './icon.svg', './manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

// Thông báo đẩy từ máy chủ nhắc việc (FCM). iPhone yêu cầu mỗi lần đẩy phải hiện một thông báo.
self.addEventListener('push', e => {
  let j = {};
  try { j = e.data ? e.data.json() : {}; } catch { /* nội dung không phải JSON */ }
  const d = j.data || j.notification || j;
  e.waitUntil(self.registration.showNotification(d.title || 'Công việc của Thầy', {
    body: d.body || '', icon: 'icon.svg', badge: 'icon.svg', tag: 'appcv', renotify: true, data: { url: d.url || '' }
  }));
});

// Bấm thông báo: mở app; thông báo Điểm tin sáng (url "#tin") thì mở luôn hộp xem tin.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    const c = cs.find(x => x.url.startsWith(self.registration.scope));
    if (c) { if (url) c.postMessage({ url }); return c.focus(); }
    return self.clients.openWindow(self.registration.scope + url);
  }));
});

// Tệp của app: ưu tiên mạng, mất mạng thì dùng bản đã lưu.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request))
  );
});


