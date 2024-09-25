// 캐시 이름을 상수로 정의
const CACHE_NAME = 'my-site-cache-v1';

// 캐시할 파일 목록
const urlsToCache = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js'
  // 추가적으로 캐시하고 싶은 파일들을 여기에 나열하세요
];

self.addEventListener('install', (event) => {
  console.log('Service worker installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('activate', (event) => {
  console.log('Service worker activating...');
  // 이전 버전의 캐시를 정리하는 코드를 여기에 추가할 수 있습니다.
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // 캐시에서 찾았다면 캐시된 응답을 반환
        if (response) {
          return response;
        }
        // 캐시에 없다면 네트워크에서 가져옴
        return fetch(event.request)
          .then((response) => {
            // 유효한 응답인지 확인 (ok는 HTTP 상태가 200-299 범위인 경우 true)
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            // 응답을 복제하여 캐시에 저장 (스트림은 한 번만 사용 가능하기 때문)
            const responseToCache = response.clone();

            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, responseToCache);
              });

            return response;
          });
      })
  );
});