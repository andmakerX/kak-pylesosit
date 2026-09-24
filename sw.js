// Работник приложения HTV. Без сети приложение открывается из сохранённой копии: своё — сначала
// из сети (иначе новое появлялось бы у читателя со второго захода), при обрыве — из кэша. Шрифты
// Google — сначала из кэша: они не меняются. Ещё он принимает уведомления (Web Push от
// Tools/news/push/worker.js) и по нажатию открывает нужную вкладку.

// Новое имя кэша при смене иконок или оболочки: при включении работник удаляет прежний кэш,
// и телефон не показывает старую иконку из него.
const CACHE = 'news-v4';
const SHELL = [
    './',
    'index.html',
    'style.css',
    'views.css',
    'app.js',
    'feed.js',
    'shared.js',
    'parse.js',
    'roadmap.js',
    'daily.js',
    'sweep-core.js',
    'push.js',
    'views/game.js',
    'views/plans.js',
    'views/facts.js',
    'views/fun.js',
    'views/sweep.js',
    'data/fun.js',
    'data/facts.json',
    'manifest.webmanifest',
    'icons/htv-192.png',
    'icons/htv-apple-180.png',
    'icons/htv-badge-96.png',
];

self.addEventListener('install', event => {
    const shell = SHELL.map(path => new Request(path, { cache: 'reload' }));
    event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(shell)).then(() => self.skipWaiting()));
});

// Сверка с сайтом при каждом открытии. GitHub Pages разрешает браузеру держать файлы
// 10 минут, и без сверки выложенное (новая иконка, правка страницы) доходило до читателя с
// опозданием. Неизменившийся файл сайт подтверждает коротким ответом, без повторной загрузки.
function fresh(request) {
    return request.mode === 'navigate'
        ? fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' })
        : fetch(request, { cache: 'no-cache' });
}

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
            fresh(request)
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

// ---------- Уведомления ----------

// Сервер шлёт JSON: title, body, url (адрес внутри приложения, вида ./#g-ключ), tag и badge —
// число на иконке. Показать уведомление обязательно при любом содержимом: iPhone отзывает
// подписку у приложения, которое принимает пуши молча.
self.addEventListener('push', event => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch {
        data = { body: event.data ? event.data.text() : '' };
    }
    const title = data.title || 'HTV';
    const options = {
        body: data.body || 'В игре новое',
        icon: 'icons/htv-192.png',
        badge: 'icons/htv-badge-96.png',
        tag: data.tag || 'htv',
        lang: 'ru',
        data: { url: data.url || './' },
    };
    const jobs = [self.registration.showNotification(title, options)];
    if (data.badge && self.navigator && self.navigator.setAppBadge) {
        jobs.push(self.navigator.setAppBadge(data.badge).catch(() => {}));
    }
    event.waitUntil(Promise.all(jobs));
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const url = new URL(event.notification.data && event.notification.data.url || './', self.registration.scope).href;
    event.waitUntil((async () => {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of windows) {
            if (client.url.startsWith(self.registration.scope)) {
                await client.focus();
                client.postMessage({ type: 'open', url });
                return;
            }
        }
        await self.clients.openWindow(url);
    })());
});

// Телефон сменил подписку сам (бывает после обновления браузера): новая уходит на сервер, а
// сервер переносит на неё темы прежней. Иначе уведомления тихо перестали бы приходить.
self.addEventListener('pushsubscriptionchange', event => {
    event.waitUntil((async () => {
        const config = await fetch('push.json', { cache: 'no-cache' }).then(r => r.json()).catch(() => null);
        if (!config || !config.server || !config.vapidPublicKey) {
            return;
        }
        const key = Uint8Array.from(atob(config.vapidPublicKey.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
        const subscription = event.newSubscription
            || await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        await fetch(`${config.server.replace(/\/$/, '')}/subscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                subscription: subscription.toJSON(),
                topics: { updates: true, daily: false },
                replaces: event.oldSubscription ? event.oldSubscription.endpoint : undefined,
            }),
        });
    })());
});
