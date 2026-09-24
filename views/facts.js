// Вкладка «Факты»: каждый день новый факт (у всех один и тот же, его же присылает утреннее
// уведомление), машина времени по журналу изменений и копилка фактов по темам. Факты лежат в
// data/facts.json; новые дописываются туда, и у читателя они помечаются «новое».

import { escapeHtml, monthGenitive } from '../parse.js';
import { addDays, dayNumber, pickDaily } from '../daily.js';
import { ICONS, share, store } from '../shared.js';

export const CATEGORIES = [
    { id: 'history', label: 'История пылесоса' },
    { id: 'science', label: 'Пыль и наука' },
    { id: 'culture', label: 'Кино и игры' },
    { id: 'gamedev', label: 'Как делают игры' },
    { id: 'devlog', label: 'Наша кухня' },
];

const SEEN_KEY = 'news.factsSeen';
const SEEN_AFTER_MS = 4000;
const FACT_SEEN_DAY_KEY = 'news.factSeenDay';

const view = {
    filter: 'all',
    extra: null,
    seenTimer: 0,
};

const label = id => (CATEGORIES.find(c => c.id === id) || { label: 'Факт' }).label;

export function factOfDay(facts, iso) {
    return facts && facts.length ? pickDaily(facts, iso, 'fact') : null;
}

function prettyDay(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    return m ? `${Number(m[3])} ${monthGenitive(Number(m[2]) - 1)}` : iso;
}

function sourceHtml(fact) {
    if (!fact.source) {
        return '';
    }
    const name = escapeHtml(fact.source);
    return fact.url
        ? `<p class="f-source">Источник: <a href="${escapeHtml(fact.url)}" target="_blank" rel="noopener">${name}</a></p>`
        : `<p class="f-source">${name}</p>`;
}

function dailyHtml(ctx, fact, iso) {
    if (!fact) {
        return '';
    }
    const shown = view.extra || fact;
    const isDaily = shown === fact;
    return `
        <section class="f-daily" data-cat="${shown.cat}" id="fact-${escapeHtml(shown.id)}">
            <p class="f-kicker">${ICONS.bulb}${isDaily ? `Факт дня · ${prettyDay(iso)}` : 'Случайный факт'}<span class="f-cat">${label(shown.cat)}</span></p>
            <h2>${escapeHtml(shown.title)}</h2>
            <p class="f-text">${escapeHtml(shown.text)}</p>
            ${sourceHtml(shown)}
            <div class="f-actions">
                <button class="slab-button" type="button" data-fact-share="${escapeHtml(shown.id)}">${ICONS.share}Поделиться</button>
                <button class="slab-button ghost" type="button" data-fact-random>${ICONS.shuffle}${isDaily ? 'Ещё факт' : 'Другой'}</button>
                ${isDaily ? '' : '<button class="link-button" type="button" data-fact-back>К факту дня</button>'}
            </div>
        </section>`;
}

// Неделю назад в игре: порция журнала ровно семидневной давности, а если в тот день ничего не
// выходило — случайная порция из архива, своя на каждый день.
function timeMachineHtml(ctx, iso) {
    const doc = ctx.feedDoc();
    if (!doc) {
        return '';
    }
    const weekAgo = addDays(iso, -7);
    const exact = doc.days.find(day => day.iso === weekAgo);
    let day = exact;
    let group = exact ? exact.groups[0] : null;
    let heading = 'Ровно неделю назад в игре';
    if (!group) {
        const old = doc.days.flatMap(d => d.groups.map(g => ({ day: d, group: g })))
            .filter(entry => entry.day.iso && dayNumber(entry.day.iso) <= dayNumber(iso) - 3);
        const pick = pickDaily(old, iso, 'archive');
        if (!pick) {
            return '';
        }
        ({ day, group } = pick);
        heading = 'Из архива ленты';
    }
    const more = exact && exact.groups.length > 1 ? ` и ещё ${exact.groups.length - 1}` : '';
    return `
        <section class="f-machine">
            <p class="f-kicker">${ICONS.clock}${heading}</p>
            <h3>${escapeHtml(group.title)}</h3>
            ${group.subtitle ? `<p>${escapeHtml(group.subtitle)}</p>` : ''}
            <p class="f-machine-date">${prettyDay(day.iso)}${more}</p>
            <button class="link-button" type="button" data-action="open-tab" data-tab-target="feed" data-arg="g-${group.key}">Открыть в ленте →</button>
        </section>`;
}

function chipsHtml(facts) {
    const counts = Object.fromEntries(CATEGORIES.map(c => [c.id, facts.filter(f => f.cat === c.id).length]));
    const all = `<button class="chip" type="button" data-fact-filter="all" aria-pressed="${view.filter === 'all'}">Все<small>${facts.length}</small></button>`;
    return `
        <div class="chips f-chips" role="group" aria-label="Темы фактов">
            ${all}${CATEGORIES.filter(c => counts[c.id]).map(c => `
                <button class="chip" type="button" data-fact-filter="${c.id}" data-cat="${c.id}" aria-pressed="${view.filter === c.id}"><span class="dot"></span>${c.label}<small>${counts[c.id]}</small></button>`).join('')}
        </div>`;
}

function listHtml(facts, seen) {
    const shown = view.filter === 'all' ? facts : facts.filter(f => f.cat === view.filter);
    return `
        <ul class="f-list">
            ${shown.map(f => `
                <li class="f-card" data-cat="${f.cat}" id="fact-${escapeHtml(f.id)}">
                    <p class="f-card-cat"><span class="dot"></span>${label(f.cat)}${seen.has(f.id) ? '' : '<span class="fresh-pill">новое</span>'}</p>
                    <h3>${escapeHtml(f.title)}</h3>
                    <p class="f-text">${escapeHtml(f.text)}</p>
                    ${sourceHtml(f)}
                </li>`).join('')}
        </ul>`;
}

function render(el, ctx) {
    const facts = ctx.facts();
    if (!facts) {
        el.innerHTML = `
            <div class="empty">
                <strong>Факты не загрузились</strong>
                Проверьте интернет и нажмите «Обновить» вверху.
            </div>`;
        return;
    }
    const iso = ctx.today();
    const seenList = store.get(SEEN_KEY, null);
    // Первый заход — отмечать нечего: новым было бы всё.
    if (seenList === null) {
        store.set(SEEN_KEY, facts.map(f => f.id));
    }
    const seen = new Set(seenList === null ? facts.map(f => f.id) : seenList);
    el.innerHTML = `
        ${dailyHtml(ctx, factOfDay(facts, iso), iso)}
        ${timeMachineHtml(ctx, iso)}
        <h2 class="f-h">Копилка фактов</h2>
        ${chipsHtml(facts)}
        <div data-fact-list>${listHtml(facts, seen)}</div>`;
    scheduleSeen(facts);
}

function scheduleSeen(facts) {
    clearTimeout(view.seenTimer);
    view.seenTimer = setTimeout(() => {
        if (document.body.dataset.tab === 'facts' && document.visibilityState === 'visible') {
            const seen = new Set(store.get(SEEN_KEY, []));
            facts.forEach(f => seen.add(f.id));
            store.set(SEEN_KEY, [...seen]);
        }
    }, SEEN_AFTER_MS);
}

export function mount(el, ctx) {
    render(el, ctx);
    el.addEventListener('click', event => {
        const facts = ctx.facts() || [];
        const filter = event.target.closest('[data-fact-filter]');
        if (filter) {
            view.filter = filter.dataset.factFilter;
            const seen = new Set(store.get(SEEN_KEY, []));
            el.querySelector('.f-chips').outerHTML = chipsHtml(facts);
            el.querySelector('[data-fact-list]').innerHTML = listHtml(facts, seen);
            return;
        }
        if (event.target.closest('[data-fact-random]')) {
            const current = view.extra || factOfDay(facts, ctx.today());
            const others = facts.filter(f => f !== current);
            view.extra = others[Math.floor(Math.random() * others.length)] || null;
            replaceDaily(el, ctx);
            return;
        }
        if (event.target.closest('[data-fact-back]')) {
            view.extra = null;
            replaceDaily(el, ctx);
            return;
        }
        const shareButton = event.target.closest('[data-fact-share]');
        if (shareButton) {
            const fact = facts.find(f => f.id === shareButton.dataset.factShare);
            if (fact) {
                share({ title: fact.title, text: `${fact.title}\n\n${fact.text}\n\nФакт из HTV — дневника игры «Как пылесосить»`, hash: `#facts/${fact.id}` });
            }
        }
    });
}

function replaceDaily(el, ctx) {
    const iso = ctx.today();
    const daily = el.querySelector('.f-daily');
    if (daily) {
        daily.outerHTML = dailyHtml(ctx, factOfDay(ctx.facts(), iso), iso);
    }
}

export function update(el, ctx, which) {
    if (which === 'facts' || which === 'feed') {
        render(el, ctx);
    }
}

// #facts/<id> — к конкретному факту: так открывается утреннее уведомление.
export function show(el, ctx, arg) {
    scheduleSeen(ctx.facts() || []);
    if (!arg) {
        return false;
    }
    const facts = ctx.facts() || [];
    const daily = factOfDay(facts, ctx.today());
    if (daily && daily.id !== arg) {
        const wanted = facts.find(f => f.id === arg);
        if (wanted) {
            view.extra = wanted;
            replaceDaily(el, ctx);
        }
    }
    const target = el.querySelector('.f-daily');
    if (target) {
        target.scrollIntoView({ block: 'start' });
        target.classList.add('flash');
        setTimeout(() => target.classList.remove('flash'), 1600);
        return true;
    }
    return false;
}

// Подсказка над лентой: факт дня, пока его не открыли.
export function teaserHtml(ctx) {
    const facts = ctx.facts();
    const iso = ctx.today();
    if (!facts || store.get(FACT_SEEN_DAY_KEY, '') === iso) {
        return '';
    }
    const fact = factOfDay(facts, iso);
    if (!fact) {
        return '';
    }
    return `
        <button class="notice fact-teaser" type="button" data-action="open-tab" data-tab-target="facts">
            <span class="f-kicker">${ICONS.bulb}Факт дня</span>
            <b>${escapeHtml(fact.title)}</b>
            <span class="fact-teaser-go">Читать ${ICONS.arrow}</span>
        </button>`;
}
