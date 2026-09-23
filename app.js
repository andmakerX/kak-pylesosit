// Лента новостей «Как пылесосить»: грузит changelog.md рядом со страницей (его кладёт
// Tools/news.ps1 из Docs/CHANGELOG.md), рисует дни и порции изменений и помнит в браузере
// читателя, какие пункты он уже видел: новое с прошлого визита отмечено оранжевым.

import {
    KIND_ORDER, escapeHtml, inlineHtml, monthGenitive, parseChangelog, plural, searchable, stats,
} from './parse.js';

const SOURCE = 'changelog.md';
const SEEN_KEY = 'news.seen';
const INSTALL_KEY = 'news.installDismissed';
// Пункты считаются прочитанными, если лента провисела на экране столько: открыть и сразу
// закрыть — не значит увидеть.
const SEEN_AFTER_MS = 4000;
// Вернулись в приложение позже этого — лента проверяется заново.
const REFRESH_AFTER_MS = 60 * 1000;

const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

const FILTERS = [
    { id: 'all', label: 'Всё' },
    { id: 'added', label: 'Добавлено' },
    { id: 'changed', label: 'Изменено' },
    { id: 'fixed', label: 'Исправлено' },
];

const WORDS = {
    added: ['новинка', 'новинки', 'новинок'],
    changed: ['изменение', 'изменения', 'изменений'],
    fixed: ['исправление', 'исправления', 'исправлений'],
    removed: ['убранное', 'убранных', 'убранных'],
    other: ['пункт', 'пункта', 'пунктов'],
    groups: ['обновление', 'обновления', 'обновлений'],
};

const $ = (selector, root = document) => root.querySelector(selector);

const state = {
    text: '',
    doc: null,
    totals: null,
    filter: 'all',
    query: '',
    fresh: new Set(),
    freshGroups: new Set(),
    open: new Set(),
    fetchedAt: 0,
    loading: false,
    installPrompt: null,
};

const store = {
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
            // Приватный режим или запрет хранилища: лента работает, только не помнит прочитанное.
        }
    },
};

// ---------- Загрузка ----------

async function load({ manual = false } = {}) {
    if (state.loading) {
        return;
    }
    state.loading = true;
    $('.refresh').classList.add('busy');
    try {
        const response = await fetch(SOURCE, { cache: 'no-cache' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const text = await response.text();
        state.fetchedAt = Date.now();
        if (text === state.text) {
            if (manual) {
                toast(navigator.onLine === false ? 'Нет связи — показана сохранённая лента' : 'Нового пока нет');
            }
            return;
        }

        const first = !state.doc;
        state.text = text;
        state.doc = parseChangelog(text);
        state.totals = stats(state.doc);
        markFresh();
        if (first) {
            const newest = state.doc.days[0];
            for (const group of newest ? newest.groups : []) {
                state.open.add(group.key);
            }
        }
        render();
        if (first) {
            followHash();
        } else {
            toast(state.freshGroups.size ? 'В ленте новое' : 'Лента обновлена');
        }
    } catch {
        if (!state.doc) {
            renderFailure();
        } else if (manual) {
            toast('Нет связи — показана сохранённая лента');
        }
    } finally {
        state.loading = false;
        $('.refresh').classList.remove('busy');
        renderStamp();
    }
}

// ---------- Что читатель уже видел ----------

let seenTimer = 0;
let pendingSeen = null;

function markFresh() {
    const keys = allItems(state.doc).map(item => item.key);
    // Первый визит — отмечать нечего: новым было бы всё.
    const seen = store.get(SEEN_KEY, null);
    const known = new Set(Array.isArray(seen) ? seen : keys);
    state.fresh = new Set(keys.filter(key => !known.has(key)));
    state.freshGroups = new Set();
    for (const day of state.doc.days) {
        for (const group of day.groups) {
            if (group.sections.some(s => s.items.some(item => state.fresh.has(item.key)))) {
                state.freshGroups.add(group.key);
                state.open.add(group.key);
            }
        }
    }
    pendingSeen = keys;
    scheduleSeen();
}

function scheduleSeen() {
    clearTimeout(seenTimer);
    if (pendingSeen && document.visibilityState === 'visible') {
        seenTimer = setTimeout(() => {
            store.set(SEEN_KEY, pendingSeen);
            pendingSeen = null;
        }, SEEN_AFTER_MS);
    }
}

function allItems(doc) {
    return doc.days.flatMap(day => day.groups.flatMap(g => g.sections.flatMap(s => s.items)));
}

// ---------- Отрисовка ----------

function render() {
    renderStats();
    renderNotices();
    renderChips();
    renderFeed();
}

function renderStats() {
    const t = state.totals;
    countUp('added', t.added, WORDS.added);
    countUp('fixed', t.fixed, WORDS.fixed);
    countUp('groups', t.groups, WORDS.groups);
    $('[data-since]').innerHTML = t.first
        ? `С ${escapeHtml(formatDate(t.first))} · последнее обновление <strong>${escapeHtml(whenLong(t.last))}</strong>`
        : '';
}

function countUp(name, value, words) {
    const number = $(`[data-stat="${name}"]`);
    $(`[data-label="${name}"]`).textContent = plural(value, ...words);
    const from = Number(number.dataset.value || 0);
    number.dataset.value = String(value);
    if (from === value || matchMedia('(prefers-reduced-motion: reduce)').matches) {
        number.textContent = String(value);
        return;
    }
    const started = performance.now();
    const step = now => {
        const t = Math.min(1, (now - started) / 700);
        number.textContent = String(Math.round(from + (value - from) * (1 - Math.pow(1 - t, 3))));
        if (t < 1) {
            requestAnimationFrame(step);
        }
    };
    requestAnimationFrame(step);
}

function renderNotices() {
    if (!state.doc) {
        return;
    }
    const parts = [];

    if (state.freshGroups.size) {
        const groups = state.doc.days.flatMap(d => d.groups).filter(g => state.freshGroups.has(g.key));
        const n = groups.length;
        const list = groups.slice(0, 4).map(g => `<li>${escapeHtml(g.title)}</li>`).join('');
        const more = n > 4 ? `<li>и ещё ${n - 4}</li>` : '';
        parts.push(`
            <section class="notice fresh-news">
                <h3>Пока вас не было — ${n} ${plural(n, ...WORDS.groups)}</h3>
                <ul>${list}${more}</ul>
                <button class="slab-button" type="button" data-action="show-fresh">Смотреть новое ↓</button>
            </section>`);
    }

    const install = installNotice();
    if (install) {
        parts.push(install);
    }

    $('[data-notices]').innerHTML = parts.join('');
}

function installNotice() {
    if (isStandalone() || store.get(INSTALL_KEY, false)) {
        return '';
    }
    const close = `<button class="icon-button close" type="button" data-action="close-install" aria-label="Скрыть">${ICON_CLOSE}</button>`;
    const telegram = '<p class="install-note">Ссылка открылась внутри Telegram? Сначала откройте её в браузере: меню ⋯ → «Открыть в браузере».</p>';

    if (state.installPrompt) {
        return `
            <section class="notice install">${close}
                <h3>Поставьте ленту на экран телефона</h3>
                <p>Она откроется как приложение, отдельно от браузера.</p>
                <button class="slab-button" type="button" data-action="install">Установить</button>
            </section>`;
    }
    if (isIos()) {
        return `
            <section class="notice install">${close}
                <h3>Поставьте ленту на экран iPhone</h3>
                <ol class="install-steps">
                    <li>Откройте страницу в Safari и нажмите «Поделиться» ${ICON_SHARE} внизу экрана.</li>
                    <li>Выберите «На экран „Домой“» и нажмите «Добавить».</li>
                </ol>
                ${telegram}
            </section>`;
    }
    if (isAndroid()) {
        return `
            <section class="notice install">${close}
                <h3>Поставьте ленту на экран телефона</h3>
                <ol class="install-steps">
                    <li>Откройте страницу в Chrome и нажмите меню ⋮ справа вверху.</li>
                    <li>Выберите «Добавить на главный экран» или «Установить приложение».</li>
                </ol>
                ${telegram}
            </section>`;
    }
    return '';
}

function renderChips() {
    const t = state.totals;
    const counts = { all: t.items, added: t.added, changed: t.changed, fixed: t.fixed };
    const chips = $('[data-chips]');
    chips.innerHTML = FILTERS
        .filter(f => f.id === 'all' || counts[f.id])
        .map(f => {
            const kind = f.id === 'all' ? '' : ` data-kind="${f.id}"`;
            const dot = f.id === 'all' ? '' : '<span class="dot"></span>';
            return `<button class="chip" type="button" data-filter="${f.id}"${kind} aria-pressed="${state.filter === f.id}">${dot}${f.label}<small>${counts[f.id]}</small></button>`;
        })
        .join('');
    markChipsScroll();
}

function markChipsScroll() {
    const chips = $('[data-chips]');
    chips.classList.toggle('scrolls', chips.scrollWidth > chips.clientWidth + 1);
    chips.classList.toggle('at-end', chips.scrollLeft + chips.clientWidth >= chips.scrollWidth - 2);
}

function renderFeed() {
    const feed = $('[data-feed]');
    feed.removeAttribute('aria-busy');
    const query = searchable(state.query.trim());
    const filtering = state.filter !== 'all' || Boolean(query);
    const days = [];

    for (const day of state.doc.days) {
        const cards = [];
        for (const group of day.groups) {
            const view = filterGroup(group, query);
            if (view) {
                cards.push(cardHtml(group, view, filtering, Boolean(query)));
            }
        }
        if (cards.length) {
            days.push(`<section class="day" id="${day.id}">${dayHeadHtml(day)}${cards.join('')}</section>`);
        }
    }

    if (days.length) {
        feed.innerHTML = days.join('');
    } else {
        const what = query ? `по запросу «${escapeHtml(state.query.trim())}»` : 'в этом разделе';
        feed.innerHTML = `
            <div class="empty">
                <strong>Ничего не нашлось</strong>
                ${what} пока пусто.
                <div><button class="slab-button" type="button" data-action="reset">Показать всё</button></div>
            </div>`;
    }

    if (query) {
        highlight(feed, query);
    }
    measureClamps(feed);
}

function filterGroup(group, query) {
    const titleHit = query && searchable(`${group.title} ${group.subtitle}`).includes(query);
    const sections = [];
    let count = 0;
    for (const section of group.sections) {
        if (state.filter !== 'all' && section.kind !== state.filter) {
            continue;
        }
        const items = query && !titleHit
            ? section.items.filter(item => searchable(item.raw).includes(query))
            : section.items;
        if (items.length) {
            sections.push({ section, items });
            count += items.length;
        }
    }
    return count ? { sections, count } : null;
}

function cardHtml(group, view, filtering, searching) {
    const open = filtering || state.open.has(group.key);
    const fresh = state.freshGroups.has(group.key);
    const id = `g-${group.key}`;

    const counts = {};
    for (const { section, items } of view.sections) {
        counts[section.kind] = (counts[section.kind] || 0) + items.length;
    }
    const meta = KIND_ORDER
        .filter(kind => counts[kind])
        .map(kind => `<span class="kind" data-kind="${kind}"><i></i>${counts[kind]} ${plural(counts[kind], ...WORDS[kind])}</span>`)
        .join('');

    const sections = view.sections.map(({ section, items }) => `
        <section class="sec" data-kind="${section.kind}">
            <h4 class="sec-label"><i></i>${escapeHtml(section.label)}${section.note ? ` <small>· ${escapeHtml(section.note)}</small>` : ''}</h4>
            <ul class="items">${items.map(item => itemHtml(item, searching)).join('')}</ul>
        </section>`).join('');
    const notes = filtering ? '' : group.notes.map(note => `<p class="card-note">${inlineHtml(note)}</p>`).join('');

    return `
        <article class="card${fresh ? ' fresh' : ''}" id="${id}">
            <h3 class="card-h">
                <button class="card-head" type="button" aria-expanded="${open}" aria-controls="${id}-body" data-toggle="${group.key}">
                    <span class="card-titles">
                        <span class="card-title">${escapeHtml(group.title)}</span>
                        ${group.subtitle ? `<span class="card-sub">${escapeHtml(group.subtitle)}</span>` : ''}
                        <span class="card-meta">${meta}${fresh ? '<span class="fresh-pill">свежее</span>' : ''}</span>
                    </span>
                    <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
                </button>
            </h3>
            <div class="card-body" id="${id}-body"${open ? '' : ' hidden'}>${sections}${notes}</div>
        </article>`;
}

function itemHtml(item, searching) {
    const classes = ['item'];
    if (!searching) {
        classes.push('clamp');
    }
    if (state.fresh.has(item.key)) {
        classes.push('fresh');
    }
    return `<li class="${classes.join(' ')}"><p class="item-text">${inlineHtml(item.raw)}</p><button class="more" type="button" data-more>Читать дальше</button></li>`;
}

function dayHeadHtml(day) {
    const date = parseIso(day.iso);
    if (!date) {
        return `<header class="day-head"><h2>${escapeHtml(day.heading)}</h2></header>`;
    }
    let title = `${date.getDate()} ${monthGenitive(date.getMonth())}`;
    if (date.getFullYear() !== new Date().getFullYear()) {
        title += ` ${date.getFullYear()}`;
    }
    if (day.note) {
        title += `, ${day.note}`;
    }
    const near = relative(date);
    const sub = [WEEKDAYS[date.getDay()], near].filter(Boolean).join(' · ');
    return `<header class="day-head"><h2>${escapeHtml(title)}</h2><span${near === 'сегодня' ? ' class="today"' : ''}>${escapeHtml(sub)}</span></header>`;
}

function renderFailure() {
    $('[data-feed]').innerHTML = `
        <div class="empty">
            <strong>Не удалось загрузить ленту</strong>
            Проверьте интернет и попробуйте ещё раз.
            <div><button class="slab-button" type="button" data-action="retry">Попробовать ещё раз</button></div>
        </div>`;
    $('[data-since]').textContent = '';
}

function renderStamp() {
    const stamp = $('[data-stamp]');
    if (!state.fetchedAt) {
        stamp.textContent = '';
        return;
    }
    const time = new Date(state.fetchedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    stamp.textContent = `Лента проверена в ${time}`;
}

// Пункт длиннее четырёх строк свёрнут; «Читать дальше» показывается только у свёрнутых по-настоящему.
function measureClamps(root) {
    for (const item of root.querySelectorAll('.item.clamp')) {
        const text = item.firstElementChild;
        if (text.offsetParent !== null) {
            item.classList.toggle('overflows', text.scrollHeight > text.clientHeight + 1);
        }
    }
}

function highlight(root, query) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: node => node.parentElement.closest('.item-text, .card-title, .card-sub')
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT,
    });
    const nodes = [];
    while (walker.nextNode()) {
        nodes.push(walker.currentNode);
    }
    for (const node of nodes) {
        const text = node.nodeValue;
        // Строчные буквы и «ё» → «е» не меняют длину строки, поэтому позиции совпадают.
        const lower = text.toLowerCase().replace(/ё/g, 'е');
        let at = lower.indexOf(query);
        if (at < 0) {
            continue;
        }
        const fragment = document.createDocumentFragment();
        let from = 0;
        while (at >= 0) {
            fragment.append(text.slice(from, at));
            const mark = document.createElement('mark');
            mark.textContent = text.slice(at, at + query.length);
            fragment.append(mark);
            from = at + query.length;
            at = lower.indexOf(query, from);
        }
        fragment.append(text.slice(from));
        node.replaceWith(fragment);
    }
}

// ---------- Даты ----------

function parseIso(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

function daysAgo(date) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((today - date) / 86400000);
}

function relative(date) {
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

function formatDate(iso) {
    const date = parseIso(iso);
    if (!date) {
        return iso;
    }
    const year = date.getFullYear() !== new Date().getFullYear() ? ` ${date.getFullYear()}` : '';
    return `${date.getDate()} ${monthGenitive(date.getMonth())}${year}`;
}

function whenLong(iso) {
    const date = parseIso(iso);
    const near = date ? relative(date) : '';
    return near && near.endsWith('назад') ? `${formatDate(iso)}, ${near}` : near || formatDate(iso);
}

// ---------- Установка на телефон ----------

function isStandalone() {
    return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

function isIos() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isAndroid() {
    return /android/i.test(navigator.userAgent);
}

// ---------- Мелочи ----------

let toastTimer = 0;

function toast(text) {
    const el = $('.toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        el.hidden = true;
    }, 2400);
}

function followHash() {
    const id = decodeURIComponent(location.hash.slice(1));
    const target = id && document.getElementById(id);
    if (!target) {
        return;
    }
    const head = target.querySelector('[data-toggle]');
    if (head && head.getAttribute('aria-expanded') !== 'true') {
        head.click();
    }
    target.scrollIntoView({ block: 'start' });
}

// После смены отбора лента начинается сверху: иначе найденное оставалось где-то выше экрана.
function scrollToFeedTop() {
    const top = $('[data-feed]').getBoundingClientRect().top + scrollY - $('.toolbar').offsetHeight - 8;
    if (scrollY > top) {
        scrollTo({ top });
    }
}

function scrollToFresh() {
    const card = $('.card.fresh');
    if (!card) {
        return;
    }
    // Первая карточка дня — вместе с датой над ней: без даты непонятно, когда это было.
    const day = card.closest('.day');
    const target = day && day.querySelector('.card') === card ? day : card;
    target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

async function share() {
    const url = location.href.split('#')[0];
    if (navigator.share) {
        try {
            await navigator.share({ title: 'Как пылесосить — дневник разработки', url });
        } catch {
            // Отменили: ничего не делаем.
        }
        return;
    }
    try {
        await navigator.clipboard.writeText(url);
        toast('Ссылка скопирована');
    } catch {
        toast(url);
    }
}

const ICON_CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const ICON_SHARE = '<svg class="inline-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';

// ---------- События ----------

function wire() {
    $('.refresh').addEventListener('click', () => load({ manual: true }));

    $('[data-chips]').addEventListener('click', event => {
        const chip = event.target.closest('[data-filter]');
        if (!chip || !state.doc) {
            return;
        }
        const scroll = $('[data-chips]').scrollLeft;
        state.filter = chip.dataset.filter;
        renderChips();
        $('[data-chips]').scrollLeft = scroll;
        renderFeed();
        scrollToFeedTop();
    });
    $('[data-chips]').addEventListener('scroll', markChipsScroll, { passive: true });

    const toggle = $('.search-toggle');
    const box = $('.search');
    const input = $('.search input');
    let typing = 0;
    toggle.addEventListener('click', () => {
        const opening = box.hidden;
        box.hidden = !opening;
        toggle.setAttribute('aria-expanded', String(opening));
        if (opening) {
            input.focus();
        } else if (state.query) {
            input.value = '';
            state.query = '';
            if (state.doc) {
                renderFeed();
            }
        }
    });
    input.addEventListener('input', () => {
        clearTimeout(typing);
        typing = setTimeout(() => {
            state.query = input.value;
            if (state.doc) {
                renderFeed();
                scrollToFeedTop();
            }
        }, 150);
    });
    input.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            toggle.click();
        } else if (event.key === 'Enter') {
            input.blur();
        }
    });

    document.addEventListener('click', async event => {
        const head = event.target.closest('[data-toggle]');
        if (head) {
            const open = head.getAttribute('aria-expanded') !== 'true';
            head.setAttribute('aria-expanded', String(open));
            const body = document.getElementById(head.getAttribute('aria-controls'));
            body.hidden = !open;
            if (open) {
                state.open.add(head.dataset.toggle);
                measureClamps(body);
            } else {
                state.open.delete(head.dataset.toggle);
            }
            return;
        }

        const clamped = event.target.closest('.item.clamp.overflows');
        if (clamped) {
            clamped.classList.remove('clamp');
            return;
        }

        const action = event.target.closest('[data-action]');
        if (!action) {
            return;
        }
        switch (action.dataset.action) {
            case 'show-fresh':
                scrollToFresh();
                break;
            case 'close-install':
                store.set(INSTALL_KEY, true);
                renderNotices();
                break;
            case 'install':
                if (state.installPrompt) {
                    state.installPrompt.prompt();
                    const choice = await state.installPrompt.userChoice.catch(() => null);
                    state.installPrompt = null;
                    if (choice && choice.outcome === 'accepted') {
                        store.set(INSTALL_KEY, true);
                    }
                    renderNotices();
                }
                break;
            case 'reset':
                state.filter = 'all';
                state.query = '';
                input.value = '';
                renderChips();
                renderFeed();
                break;
            case 'retry':
                load({ manual: true });
                break;
        }
    });

    const shareButton = $('.share');
    shareButton.hidden = false;
    shareButton.addEventListener('click', share);

    let resizeTimer = 0;
    addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            measureClamps(document);
            markChipsScroll();
        }, 200);
    });

    addEventListener('hashchange', followHash);

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            scheduleSeen();
            if (Date.now() - state.fetchedAt > REFRESH_AFTER_MS) {
                load();
            }
        } else {
            clearTimeout(seenTimer);
        }
    });

    addEventListener('beforeinstallprompt', event => {
        event.preventDefault();
        state.installPrompt = event;
        renderNotices();
    });
    addEventListener('appinstalled', () => {
        state.installPrompt = null;
        store.set(INSTALL_KEY, true);
        renderNotices();
    });

    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    }
}

wire();
load();
