// Вкладка «Лента»: грузит changelog.md рядом со страницей (его кладёт Tools/news.ps1 из
// Docs/CHANGELOG.md), рисует дни и порции изменений и помнит в браузере читателя, какие пункты
// он уже видел: новое с прошлого визита отмечено оранжевым. Шапку со счётчиками рисует тоже она.

import {
    KIND_ORDER, escapeHtml, inlineHtml, monthGenitive, parseChangelog, plural, searchable, stats,
} from './parse.js';
import { store, toast, parseIso, relative, formatDate, whenLong, WEEKDAYS } from './shared.js';

const SOURCE = 'changelog.md';
const SEEN_KEY = 'news.seen';
// Пункты считаются прочитанными, если лента провисела на экране столько: открыть и сразу
// закрыть — не значит увидеть.
const SEEN_AFTER_MS = 4000;
// Вернулись в приложение позже этого — лента проверяется заново.
const REFRESH_AFTER_MS = 60 * 1000;

const FILTERS = [
    { id: 'all', label: 'Всё' },
    { id: 'added', label: 'Добавлено' },
    { id: 'changed', label: 'Изменено' },
    { id: 'fixed', label: 'Исправлено' },
];

export const WORDS = {
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
    active: true,
};

let hooks = {
    extraNotices: () => [],
    onLoaded: () => {},
    onSeen: () => {},
};

export function feedDoc() {
    return state.doc;
}

export function freshCount() {
    return state.freshGroups.size;
}

// ---------- Загрузка ----------

export async function loadFeed({ manual = false } = {}) {
    if (state.loading) {
        return;
    }
    state.loading = true;
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
        hooks.onLoaded(state.doc);
        if (!first) {
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
        renderStamp();
    }
}

export function feedIsStale() {
    return Date.now() - state.fetchedAt > REFRESH_AFTER_MS;
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

// Прочитанным считается только то, что провисело на экране вкладки «Лента».
export function setFeedActive(active) {
    state.active = active;
    scheduleSeen();
}

export function scheduleSeen() {
    clearTimeout(seenTimer);
    if (pendingSeen && state.active && document.visibilityState === 'visible') {
        seenTimer = setTimeout(() => {
            store.set(SEEN_KEY, pendingSeen);
            pendingSeen = null;
            hooks.onSeen();
        }, SEEN_AFTER_MS);
    }
}

export function pauseSeen() {
    clearTimeout(seenTimer);
}

// Всё прочитано сразу, по кнопке в настройках.
export function markAllSeen() {
    if (!state.doc) {
        return;
    }
    store.set(SEEN_KEY, allItems(state.doc).map(item => item.key));
    pendingSeen = null;
    state.fresh = new Set();
    state.freshGroups = new Set();
    render();
    hooks.onSeen();
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

export function renderNotices() {
    const parts = [];

    if (state.doc && state.freshGroups.size) {
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

    parts.push(...hooks.extraNotices());
    $('[data-notices]').innerHTML = parts.join('');
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
export function measureClamps(root = document) {
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

// Переход по ссылке вида #g-<ключ> или #d-<дата>: карточка раскрывается и встаёт наверх.
export function followFeedAnchor(id) {
    const target = id && document.getElementById(id);
    if (!target) {
        return false;
    }
    const head = target.querySelector('[data-toggle]');
    if (head && head.getAttribute('aria-expanded') !== 'true') {
        head.click();
    }
    target.scrollIntoView({ block: 'start' });
    return true;
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

// ---------- События ----------

export function initFeed(options) {
    hooks = { ...hooks, ...options };
    const view = $('[data-view="feed"]');

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

    view.addEventListener('click', event => {
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
            case 'reset':
                state.filter = 'all';
                state.query = '';
                input.value = '';
                renderChips();
                renderFeed();
                break;
            case 'retry':
                loadFeed({ manual: true });
                break;
        }
    });

    let resizeTimer = 0;
    addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            measureClamps(document);
            markChipsScroll();
        }, 200);
    });

    return loadFeed();
}
