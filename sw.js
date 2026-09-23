// Работник ленты: без сети лента открывается из сохранённой копии. Своё — сначала из сети
// (иначе новое появлялось бы у читателя со второго захода), при обрыве — из кэша. Шрифты
// Google — сначала из кэша: они не меняются.

// Новое имя кэша при смене иконок или оболочки: при включении работник удаляет прежний кэш,
// и телефон не показывает старую иконку из него.
const CACHE = 'news-v2';
const SHELL = [
    './',
    'index.html',
    'style.css',
    'app.js',
    'parse.js',
    'manifest.webmanifest',
    'icons/htv-192.png',
    'icons/htv-apple-180.png',
];

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
            .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') {
        return;
    }
    const url = new URL(request.url);

    if (url.origin === self.location.origin) {
        event.respondWith(
            fetch(request)
                .then(response => {
                    if (response.ok) {
                        const copy = response.clone();
                        caches.open(CACHE).then(cache => cache.put(request, copy));
                    }
                    return response;
                })
                .catch(() => caches.match(request, { ignoreSearch: true })
                    .then(hit => hit || (request.mode === 'navigate' ? caches.match('index.html') : undefined))
                    .then(hit => hit || Response.error())));
        return;
    }

    if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
        event.respondWith(
            caches.match(request).then(hit => hit || fetch(request).then(response => {
                const copy = response.clone();
                caches.open(CACHE).then(cache => cache.put(request, copy));
                return response;
            })));
    }
});
