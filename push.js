// Уведомления на телефон: подписка через Web Push на сервер ленты (Tools/news/push/worker.js на
// Cloudflare). Адрес сервера и его открытый ключ лежат в push.json рядом со страницей; их пишет
// Tools/news-push.ps1 -Setup. Пока файла нет или он пуст, приложение говорит, что уведомления
// ещё не включены, и больше ничего не делает.
//
// iPhone принимает уведомления только у приложения, добавленного на экран «Домой» (iOS 16.4 и
// новее), Android — и в самом Chrome. Разрешение телефон спрашивает только по нажатию кнопки.

import { store } from './shared.js';

const CONFIG_URL = 'push.json';
const TOPICS_KEY = 'news.push.topics';
const SYNCED_KEY = 'news.push.synced';

export const DEFAULT_TOPICS = { updates: true, daily: false };

let config = null;

export async function loadPushConfig() {
    try {
        const response = await fetch(CONFIG_URL, { cache: 'no-cache' });
        const value = response.ok ? await response.json() : null;
        config = value && value.server && value.vapidPublicKey ? value : null;
    } catch {
        // Без сети остаётся то, что было.
    }
    return config;
}

export function isIos() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isAndroid() {
    return /android/i.test(navigator.userAgent);
}

export function isStandalone() {
    return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

function supported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

async function currentSubscription() {
    const registration = await navigator.serviceWorker.ready;
    return registration.pushManager.getSubscription();
}

// Что сейчас с уведомлениями у этого читателя:
//   unconfigured — сервер ещё не заведён; ios-install — на iPhone сначала «На экран „Домой“»;
//   unsupported — браузер не умеет; denied — запрещено в настройках; ok — можно включать.
export async function pushState() {
    const topics = store.get(TOPICS_KEY, null);
    if (!config) {
        return { reason: 'unconfigured', subscribed: false, topics: DEFAULT_TOPICS };
    }
    if (isIos() && !isStandalone()) {
        return { reason: 'ios-install', subscribed: false, topics: DEFAULT_TOPICS };
    }
    if (!supported()) {
        return { reason: 'unsupported', subscribed: false, topics: DEFAULT_TOPICS };
    }
    if (Notification.permission === 'denied') {
        return { reason: 'denied', subscribed: false, topics: DEFAULT_TOPICS };
    }
    let subscription = null;
    try {
        subscription = await currentSubscription();
    } catch {
        subscription = null;
    }
    const subscribed = Boolean(subscription) && Notification.permission === 'granted' && Boolean(topics)
        && (topics.updates || topics.daily);
    return { reason: 'ok', subscribed, topics: subscribed ? topics : DEFAULT_TOPICS };
}

// Включить с выбранными темами. Разрешение спрашивается первым же делом: Safari даёт спросить
// только прямо по нажатию, до любого ожидания.
export async function enablePush(topics) {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
        throw new Error(permission === 'denied' ? 'denied' : 'dismissed');
    }
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (subscription && !sameKey(subscription, config.vapidPublicKey)) {
        await subscription.unsubscribe();
        subscription = null;
    }
    if (!subscription) {
        subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: fromBase64Url(config.vapidPublicKey),
        });
    }
    await post('/subscribe', { subscription: subscription.toJSON(), topics });
    store.set(TOPICS_KEY, topics);
    store.set(SYNCED_KEY, today());
}

export async function setTopics(topics) {
    if (!topics.updates && !topics.daily) {
        return disablePush();
    }
    const subscription = await currentSubscription();
    if (!subscription) {
        return enablePush(topics);
    }
    await post('/subscribe', { subscription: subscription.toJSON(), topics });
    store.set(TOPICS_KEY, topics);
}

export async function disablePush() {
    const subscription = supported() ? await currentSubscription().catch(() => null) : null;
    if (subscription) {
        await post('/unsubscribe', { endpoint: subscription.endpoint }).catch(() => {});
        await subscription.unsubscribe().catch(() => {});
    }
    store.set(TOPICS_KEY, { updates: false, daily: false });
}

export async function testPush() {
    const subscription = await currentSubscription();
    if (!subscription) {
        throw new Error('not-subscribed');
    }
    return post('/test', { endpoint: subscription.endpoint });
}

// Раз в день подписка заново отдаётся серверу: переживёт и переезд сервера, и потерю записи.
export async function resyncPush() {
    try {
        const state = await pushState();
        if (state.subscribed && store.get(SYNCED_KEY, '') !== today()) {
            const subscription = await currentSubscription();
            await post('/subscribe', { subscription: subscription.toJSON(), topics: state.topics });
            store.set(SYNCED_KEY, today());
        }
    } catch {
        // Сервер недоступен — попробуем в следующий раз.
    }
}

async function post(path, body) {
    const response = await fetch(config.server.replace(/\/$/, '') + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    return response.json().catch(() => ({}));
}

function sameKey(subscription, key) {
    const current = subscription.options && subscription.options.applicationServerKey;
    if (!current) {
        return true;
    }
    const a = new Uint8Array(current);
    const b = fromBase64Url(key);
    return a.length === b.length && a.every((v, i) => v === b[i]);
}

function fromBase64Url(text) {
    const base64 = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=');
    return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}

function today() {
    return new Date().toISOString().slice(0, 10);
}
