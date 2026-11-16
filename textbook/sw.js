// 앱 화면 파일을 기기에 저장해 두어 빠르게 열리고, 인터넷이 잠깐 끊겨도 열리게 한다.
// 교재 PDF는 여기서 다루지 않는다 (js/pdfsource.js가 따로 저장한다).
const VERSION = 'lt-app-v12';
const SHELL = [
  './', 'index.html', 'app.css', 'manifest.webmanifest',
  'js/main.js', 'js/core.js', 'js/ui.js', 'js/reader.js', 'js/pdfsource.js', 'js/config.js',
  'js/store-demo.js', 'js/store-firebase.js',
  'vendor/pdfjs/pdf.min.js', 'vendor/pdfjs/pdf.worker.min.js',
  'icons/icon-192.png', 'icons/logo.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('lt-app-') && k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// 같은 사이트의 앱 파일: 인터넷이 되면 새 파일을 받아 저장하고, 안 되면 저장된 파일을 쓴다
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
  );
});
