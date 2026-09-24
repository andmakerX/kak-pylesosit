// Общее для вкладок приложения: хранилище читателя, всплывающая строка, даты и «поделиться».

import { monthGenitive, plural } from './parse.js';

export const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

// Настройки и отметки читателя живут в его браузере. Приватный режим или запрет хранилища —
// приложение работает, только ничего не помнит.
export const store = {
    get(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw === null ? fallback : JSON.parse(raw);
        } catch {
            return fallback;
        }
    },
    set(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch {
            // Нет хранилища — не помним.
        }
    },
    remove(key) {
        try {
            localStorage.removeItem(key);
        } catch {
            // Нет хранилища — нечего и убирать.
        }
    },
};

let toastTimer = 0;

export function toast(text) {
    const el = document.querySelector('.toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        el.hidden = true;
    }, 2400);
}

// ---------- Даты ----------

export function parseIso(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

export function daysAgo(date) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((today - date) / 86400000);
}

export function relative(date) {
    const n = daysAgo(date);
    if (n === 0) {
        return 'сегодня';
    }
    if (n === 1) {
        return 'вчера';
    }
    if (n === 2) {
        return 'позавчера';
    }
    if (n > 2 && n < 7) {
        return `${n} ${plural(n, 'день', 'дня', 'дней')} назад`;
    }
    return '';
}

export function formatDate(iso) {
    const date = parseIso(iso);
    if (!date) {
        return iso;
    }
    const year = date.getFullYear() !== new Date().getFullYear() ? ` ${date.getFullYear()}` : '';
    return `${date.getDate()} ${monthGenitive(date.getMonth())}${year}`;
}

export function whenLong(iso) {
    const date = parseIso(iso);
    const near = date ? relative(date) : '';
    return near && near.endsWith('назад') ? `${formatDate(iso)}, ${near}` : near || formatDate(iso);
}

// ---------- Поделиться ----------

export function appUrl(hash = '') {
    return location.href.split('#')[0] + hash;
}

// Системное окно «Поделиться» телефона, а без него — в буфер обмена.
export async function share({ title = 'HTV — дневник разработки', text = '', hash = '' } = {}) {
    const url = appUrl(hash);
    if (navigator.share) {
        try {
            await navigator.share(text ? { title, text, url } : { title, url });
        } catch {
            // Отменили: ничего не делаем.
        }
        return;
    }
    try {
        await navigator.clipboard.writeText(text ? `${text}\n${url}` : url);
        toast(text ? 'Скопировано — можно вставить в чат' : 'Ссылка скопирована');
    } catch {
        toast(url);
    }
}

export function reducedMotion() {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Лёгкий отклик под пальцем там, где телефон умеет (Android); iPhone вибрацию сайтам не даёт.
export function buzz(pattern = 10) {
    try {
        if (navigator.vibrate) {
            navigator.vibrate(pattern);
        }
    } catch {
        // Не умеет — не страшно.
    }
}

export const ICONS = {
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>',
    shareInline: '<svg class="inline-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>',
    shuffle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="M4 4l5 5"/></svg>',
    bulb: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1 2V16h5.2v-.2c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/></svg>',
    bell: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    warn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.2M12 17h.01"/></svg>',
    clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
    chevron: '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
};
