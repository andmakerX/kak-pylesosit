// Что показывать «сегодня»: факт дня, гороскоп, находку из архива. Выбор одинаков у всех
// читателей в один день и у сервера уведомлений (Tools/news/push/worker.js), который утром
// присылает тот же факт дня. Без DOM: модуль проверяет Tools/news/app.test.js под node.

// Сутки считаются по Москве: читатели в России, и утреннее уведомление в 10:00 по Москве
// должно называть тот же факт, что откроется в приложении.
export const MOSCOW_OFFSET_MINUTES = 180;

// Дата вида 2026-09-24 в поясе со смещением offsetMinutes от UTC.
export function isoDay(date = new Date(), offsetMinutes = MOSCOW_OFFSET_MINUTES) {
    const shifted = new Date(date.getTime() + offsetMinutes * 60000);
    return shifted.toISOString().slice(0, 10);
}

// Номер дня от 1 января 1970 года; NaN для строки не того вида.
export function dayNumber(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
    return m ? Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000) : NaN;
}

export function addDays(iso, days) {
    return new Date((dayNumber(iso) + days) * 86400000).toISOString().slice(0, 10);
}

// FNV-1a, 32 бита: зерно из строки.
export function hashString(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

// Mulberry32: короткий генератор с зерном; одно зерно — одна и та же последовательность везде.
export function seededRandom(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function shuffled(count, seed) {
    const order = Array.from({ length: count }, (_, i) => i);
    const random = seededRandom(seed);
    for (let i = count - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
}

// Элемент списка на день iso. Дни идут кругами длиной в список, и внутри круга ни один элемент
// не повторяется: факт, показанный сегодня, вернётся не раньше чем через столько дней, сколько
// всего фактов. Порядок в каждом круге свой, salt разводит списки между собой.
export function pickDaily(items, iso, salt = '') {
    const count = items.length;
    const day = dayNumber(iso);
    if (!count || Number.isNaN(day)) {
        return null;
    }
    const cycle = Math.floor(day / count);
    const order = shuffled(count, hashString(`${salt}|${cycle}`));
    return items[order[((day % count) + count) % count]];
}

// Случайный выбор с зерном: одна дата и одна подпись — один и тот же результат.
export function pickSeeded(items, random) {
    return items.length ? items[Math.floor(random() * items.length)] : null;
}
