// «HTV — дневник разработки» игры «Как пылесосить»: приложение для телефона, которое ставится на
// экран «Домой». Здесь каркас: вкладки внизу, шапка, листы настроек и «Что нового», уведомления,
// установка. Вкладки живут в своих модулях: лента (feed.js), игра, планы, факты и приколы
// (views/*.js). Переход между вкладками — по адресу после «#», поэтому ссылка из уведомления
// открывает нужную вкладку, а кнопка «Назад» на Android возвращает в ленту.

import {
    feedDoc, feedIsStale, followFeedAnchor, freshCount, initFeed, loadFeed, markAllSeen,
    measureClamps, pauseSeen, renderNotices, scheduleSeen, setFeedActive,
} from './feed.js';
import { parseRoadmap, roadmapSnapshot, roadmapStats } from './roadmap.js';
import { hashKey, plural } from './parse.js';
import { isoDay } from './daily.js';
import {
    DEFAULT_TOPICS, disablePush, enablePush, isAndroid, isIos, isStandalone, loadPushConfig,
    pushState, resyncPush, setTopics, testPush,
} from './push.js';
import { ICONS, buzz, reducedMotion, share, store, toast } from './shared.js';
import * as gameView from './views/game.js';
import * as plansView from './views/plans.js';
import * as factsView from './views/facts.js';
import * as funView from './views/fun.js';

// Версия приложения: выросла — читателю, который уже открывал ленту, один раз показывается лист
// «Что нового в HTV».
const APP_VERSION = 2;
const VERSION_KEY = 'news.appVersion';
const INSTALL_KEY = 'news.installDismissed';
const PUSH_PROMPT_KEY = 'news.pushPromptDismissed';
const PLANS_SEEN_KEY = 'news.plansSeen';
const FACT_SEEN_KEY = 'news.factSeenDay';

const TABS = {
    feed: { title: 'HTV — дневник разработки', tagline: 'Дневник разработки' },
    game: { title: 'Об игре — HTV', tagline: 'Об игре', view: gameView },
    plans: { title: 'Планы — HTV', tagline: 'Планы', view: plansView },
    facts: { title: 'Факты — HTV', tagline: 'Факты', view: factsView },
    fun: { title: 'Приколы — HTV', tagline: 'Приколы', view: funView },
};

const $ = (selector, root = document) => root.querySelector(selector);

const app = {
    tab: '',
    mounted: new Set(),
    scroll: {},
    roadmap: null,
    roadmapText: '',
    facts: null,
    installPrompt: null,
    push: { reason: 'unconfigured', subscribed: false, topics: DEFAULT_TOPICS },
};

// Что вкладкам нужно от каркаса.
const ctx = {
    feedDoc,
    roadmap: () => app.roadmap,
    facts: () => app.facts,
    today: () => isoDay(),
    openTab: (id, arg) => navigate(id, arg),
    openSheet,
    closeSheet,
    toast,
    share,
    buzz,
};

// ---------- Данные ----------

async function loadRoadmap() {
    try {
        const response = await fetch('roadmap.md', { cache: 'no-cache' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const text = await response.text();
        if (text !== app.roadmapText) {
            app.roadmapText = text;
            app.roadmap = parseRoadmap(text);
            onDataChanged('plans');
        }
    } catch {
        // Без сети вкладка покажет, что было, или скажет, что планы не загрузились.
        if (!app.roadmap) {
            onDataChanged('plans');
        }
    }
}

async function loadFacts() {
    try {
        const response = await fetch('data/facts.json', { cache: 'no-cache' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const facts = await response.json();
        if (JSON.stringify(facts) !== JSON.stringify(app.facts)) {
            app.facts = facts;
            onDataChanged('facts');
        }
    } catch {
        if (!app.facts) {
            onDataChanged('facts');
        }
    }
}

function onDataChanged(which) {
    for (const id of app.mounted) {
        const view = TABS[id].view;
        if (view && view.update) {
            view.update(viewElement(id), ctx, which);
        }
    }
    renderHead();
    renderDots();
    if (which === 'facts') {
        renderNotices();
    }
}

async function refreshAll({ manual = false } = {}) {
    const button = $('.refresh');
    button.classList.add('busy');
    try {
        await Promise.all([loadFeed({ manual: manual && app.tab === 'feed' }), loadRoadmap(), loadFacts()]);
        if (manual && app.tab !== 'feed') {
            toast('Обновлено');
        }
    } finally {
        button.classList.remove('busy');
    }
}

// ---------- Вкладки ----------

function viewElement(id) {
    return $(`[data-view="${id}"]`);
}

function parseHash() {
    const hash = decodeURIComponent(location.hash.slice(1));
    const [head, ...rest] = hash.split('/');
    if (TABS[head]) {
        return { tab: head, arg: rest.join('/') };
    }
    return { tab: 'feed', arg: hash };
}

function route() {
    const { tab, arg } = parseHash();
    showTab(tab, arg);
}

// Переход по нажатию: из ленты — новой записью истории (кнопка «Назад» вернёт в ленту), между
// остальными вкладками — заменой, чтобы «Назад» не листал их все по очереди.
function navigate(id, arg = '') {
    const hash = id === 'feed' ? (arg ? `#${arg}` : '') : `#${id}${arg ? `/${arg}` : ''}`;
    const url = location.pathname + location.search + hash;
    if (app.tab === 'feed' && id !== 'feed') {
        history.pushState(null, '', url);
    } else {
        history.replaceState(null, '', url);
    }
    showTab(id, arg);
}

function showTab(id, arg = '') {
    const previous = app.tab;
    if (previous && previous !== id) {
        app.scroll[previous] = scrollY;
    }
    app.tab = id;
    document.body.dataset.tab = id;
    document.title = TABS[id].title;

    for (const tab of document.querySelectorAll('.tabbar .tab')) {
        const current = tab.dataset.tab === id;
        tab.classList.toggle('active', current);
        if (current) {
            tab.setAttribute('aria-current', 'page');
        } else {
            tab.removeAttribute('aria-current');
        }
    }
    for (const view of document.querySelectorAll('[data-view]')) {
        view.hidden = view.dataset.view !== id;
    }

    const element = viewElement(id);
    const view = TABS[id].view;
    if (view && !app.mounted.has(id)) {
        app.mounted.add(id);
        view.mount(element, ctx);
    }
    if (previous !== id && !reducedMotion()) {
        element.classList.remove('view-enter');
        void element.offsetWidth;
        element.classList.add('view-enter');
    }

    setFeedActive(id === 'feed');
    if (id === 'feed' && previous && previous !== 'feed') {
        // Факт дня мог быть прочитан на своей вкладке: подсказка над лентой гаснет.
        renderNotices();
    }
    if (id === 'plans' && app.roadmap) {
        store.set(PLANS_SEEN_KEY, plansFingerprint());
    }
    if (id === 'facts') {
        store.set(FACT_SEEN_KEY, isoDay());
    }
    renderHead();
    renderDots();

    let anchored = false;
    if (id === 'feed' && arg) {
        anchored = followFeedAnchor(arg);
    } else if (view && view.show) {
        anchored = view.show(element, ctx, arg) === true;
    }
    if (!anchored && previous !== id) {
        scrollTo(0, app.scroll[id] || 0);
    }
    if (id === 'feed') {
        measureClamps(element);
    }
}

function renderHead() {
    const tab = TABS[app.tab] || TABS.feed;
    $('[data-tagline]').textContent = tab.tagline;
    const sub = $('[data-head-sub]');
    const text = headSub(app.tab);
    sub.hidden = !text;
    sub.innerHTML = text;
}

function headSub(id) {
    switch (id) {
        case 'game':
            return '«Как пылесосить»: уборка наперегонки и табуретки в коллег';
        case 'plans': {
            if (!app.roadmap) {
                return 'Что готово, что в работе и что впереди';
            }
            const s = roadmapStats(app.roadmap);
            const fix = s.fix ? ` · <b>${s.fix}</b> ${plural(s.fix, 'требует', 'требуют', 'требуют')} исправления` : '';
            return `Готово <b>${s.percent} %</b> шагов${fix}`;
        }
        case 'facts':
            return app.facts
                ? `Каждый день новый факт · в копилке ${app.facts.length} ${plural(app.facts.length, 'факт', 'факта', 'фактов')}`
                : 'Каждый день новый факт';
        case 'fun':
            return 'Гороскоп клинера, тест, диктор и мини-игра';
        default:
            return '';
    }
}

// Точки на вкладках: в ленте новое; в планах что-то сдвинулось с прошлого захода; факт дня
// ещё не открыт.
function renderDots() {
    const feedDot = $('.tab[data-tab="feed"] .tab-dot');
    feedDot.hidden = app.tab === 'feed' || freshCount() === 0;

    const plansDot = $('.tab[data-tab="plans"] .tab-dot');
    const seen = store.get(PLANS_SEEN_KEY, null);
    if (app.roadmap && seen === null) {
        store.set(PLANS_SEEN_KEY, plansFingerprint());
    }
    plansDot.hidden = !app.roadmap || app.tab === 'plans' || seen === null || seen === plansFingerprint();

    const factsDot = $('.tab[data-tab="facts"] .tab-dot');
    factsDot.hidden = !app.facts || app.tab === 'facts' || store.get(FACT_SEEN_KEY, '') === isoDay();
}

function plansFingerprint() {
    return hashKey(JSON.stringify(roadmapSnapshot(app.roadmap)));
}

// ---------- Листы ----------

let sheetReturnFocus = null;
let sheetOnClose = null;

function openSheet(html, { onClose } = {}) {
    const sheet = $('[data-sheet]');
    const backdrop = $('[data-sheet-backdrop]');
    $('[data-sheet-body]').innerHTML = html;
    sheetReturnFocus = document.activeElement;
    sheetOnClose = onClose || null;
    backdrop.hidden = false;
    sheet.hidden = false;
    document.body.classList.add('sheet-open');
    requestAnimationFrame(() => {
        backdrop.classList.add('shown');
        sheet.classList.add('shown');
    });
    const focusable = sheet.querySelector('button, [href], input');
    if (focusable) {
        focusable.focus({ preventScroll: true });
    }
}

function closeSheet() {
    const sheet = $('[data-sheet]');
    if (sheet.hidden) {
        return;
    }
    const backdrop = $('[data-sheet-backdrop]');
    sheet.classList.remove('shown');
    backdrop.classList.remove('shown');
    document.body.classList.remove('sheet-open');
    const done = () => {
        sheet.hidden = true;
        backdrop.hidden = true;
        sheet.style.transform = '';
    };
    if (reducedMotion()) {
        done();
    } else {
        setTimeout(done, 220);
    }
    if (sheetReturnFocus && sheetReturnFocus.focus) {
        sheetReturnFocus.focus({ preventScroll: true });
    }
    const callback = sheetOnClose;
    sheetOnClose = null;
    if (callback) {
        callback();
    }
}

// Лист можно смахнуть вниз за ручку или за заголовок.
function wireSheetDrag() {
    const sheet = $('[data-sheet]');
    let startY = 0;
    let dragging = false;
    let offset = 0;
    sheet.addEventListener('touchstart', event => {
        const grip = event.target.closest('.sheet-handle, .sheet-head');
        if (!grip || sheet.scrollTop > 0) {
            return;
        }
        dragging = true;
        startY = event.touches[0].clientY;
        offset = 0;
        sheet.style.transition = 'none';
    }, { passive: true });
    sheet.addEventListener('touchmove', event => {
        if (!dragging) {
            return;
        }
        offset = Math.max(0, event.touches[0].clientY - startY);
        sheet.style.transform = `translate(-50%, ${offset}px)`;
    }, { passive: true });
    sheet.addEventListener('touchend', () => {
        if (!dragging) {
            return;
        }
        dragging = false;
        sheet.style.transition = '';
        if (offset > 90) {
            closeSheet();
        } else {
            sheet.style.transform = '';
        }
    });
}

// ---------- Настройки и уведомления ----------

async function refreshPushState() {
    app.push = await pushState();
    // Точка на колокольчике зовёт включить уведомления, пока читатель от них не отказался.
    const bellDot = $('.bell-dot');
    bellDot.hidden = !(app.push.reason === 'ok' && !app.push.subscribed && !store.get(PUSH_PROMPT_KEY, false));
    $('.bell').classList.toggle('on', app.push.subscribed);
    return app.push;
}

function pushStatusHtml(state) {
    switch (state.reason) {
        case 'unconfigured':
            return '<p class="set-note">Сервер уведомлений ещё не включён. Как только его запустят, здесь появятся переключатели.</p>';
        case 'ios-install':
            return `<p class="set-note">iPhone присылает уведомления только приложениям с экрана «Домой». Откройте HTV в Safari, нажмите «Поделиться» ${ICONS.shareInline} → «На экран „Домой“», запустите оттуда и включите здесь.</p>`;
        case 'unsupported':
            return '<p class="set-note">Этот браузер не умеет уведомления от сайтов. На Android откройте HTV в Chrome, на iPhone — добавьте на экран «Домой».</p>';
        case 'denied':
            return isIos()
                ? '<p class="set-note warn">Уведомления запрещены. Включить: Настройки телефона → Уведомления → HTV.</p>'
                : '<p class="set-note warn">Уведомления запрещены. Включить: значок замка рядом с адресом → Разрешения → Уведомления. В установленном приложении — долгое нажатие на иконку → О приложении → Уведомления.</p>';
        default:
            return state.subscribed
                ? '<p class="set-note ok">Уведомления включены.</p>'
                : '<p class="set-note">Уведомления выключены.</p>';
    }
}

function toggleHtml(id, title, sub, on, disabled) {
    return `
        <label class="set-row toggle-row${disabled ? ' disabled' : ''}">
            <span class="set-text"><b>${title}</b><small>${sub}</small></span>
            <input type="checkbox" class="switch" data-topic="${id}"${on ? ' checked' : ''}${disabled ? ' disabled' : ''}>
        </label>`;
}

async function openSettings() {
    const state = await refreshPushState();
    const usable = state.reason === 'ok';
    const topics = state.subscribed ? state.topics : { updates: false, daily: false };
    openSheet(`
        <header class="sheet-head">
            <h2 id="sheet-title">Настройки</h2>
            <button class="icon-button sheet-close" type="button" data-action="close-sheet" aria-label="Закрыть">${ICONS.close}</button>
        </header>
        <section class="set-group">
            <h3>${ICONS.bell} Уведомления</h3>
            <div data-push-status>${pushStatusHtml(state)}</div>
            ${toggleHtml('updates', 'Новое в игре и планах', 'Вышло обновление, этап плана сдвинулся', topics.updates, !usable)}
            ${toggleHtml('daily', 'Факт дня', 'Каждое утро в 10:00 по Москве', topics.daily, !usable)}
            <button class="slab-button small" type="button" data-action="test-push"${state.subscribed ? '' : ' hidden'}>Прислать проверочное</button>
        </section>
        <section class="set-group">
            <h3>Лента</h3>
            <button class="set-row set-button" type="button" data-action="mark-all-seen"><span class="set-text"><b>Отметить всё прочитанным</b><small>Оранжевые отметки нового погаснут</small></span></button>
        </section>
        <section class="set-group">
            <h3>О приложении</h3>
            <button class="set-row set-button" type="button" data-action="whats-new"><span class="set-text"><b>Что нового в HTV</b><small>Версия ${APP_VERSION}.0</small></span>${ICONS.arrow}</button>
            <button class="set-row set-button" type="button" data-action="share-app"><span class="set-text"><b>Отправить ссылку</b><small>Друзьям и соавторам</small></span>${ICONS.share}</button>
        </section>`);
}

async function onTopicToggle(input) {
    const rows = [...document.querySelectorAll('[data-topic]')];
    const wanted = Object.fromEntries(rows.map(row => [row.dataset.topic, row.checked]));
    rows.forEach(row => { row.disabled = true; });
    try {
        if (!app.push.subscribed && (wanted.updates || wanted.daily)) {
            await enablePush(wanted);
            toast('Уведомления включены');
        } else {
            await setTopics(wanted);
            toast(wanted.updates || wanted.daily ? 'Сохранено' : 'Уведомления выключены');
        }
        if (!wanted.updates && !wanted.daily) {
            // Выключил сам — больше не зовём включить.
            store.set(PUSH_PROMPT_KEY, true);
        }
    } catch (error) {
        input.checked = !input.checked;
        const reason = String(error && error.message);
        toast(reason === 'denied'
            ? 'Телефон запретил уведомления'
            : reason === 'dismissed' ? 'Разрешение не дали' : 'Не получилось: нет связи с сервером');
    }
    const state = await refreshPushState();
    const status = $('[data-push-status]');
    if (status) {
        status.innerHTML = pushStatusHtml(state);
    }
    rows.forEach(row => { row.disabled = state.reason !== 'ok'; });
    const test = $('[data-action="test-push"]');
    if (test) {
        test.hidden = !state.subscribed;
    }
    renderNotices();
}

function whatsNewHtml() {
    const items = [
        ['game', 'Игра', 'Всё об игре: как идёт матч, что умеет пылесос, карты, герой и находки.'],
        ['plans', 'Планы', 'Что готово, что в работе, что впереди — и что сделано, но требует исправления.'],
        ['facts', 'Факты', 'Каждый день новый: история пылесоса, наука о пыли, игры и байки нашей разработки.'],
        ['fun', 'Приколы', 'Гороскоп клинера, тест «Какой ты пылесос?», генератор диктора и мини-игра.'],
    ];
    return `
        <header class="sheet-head">
            <h2 id="sheet-title">HTV обновилось</h2>
            <button class="icon-button sheet-close" type="button" data-action="close-sheet" aria-label="Закрыть">${ICONS.close}</button>
        </header>
        <p class="sheet-lead">Теперь это не только лента. Внизу — вкладки:</p>
        <ul class="whats-new">
            ${items.map(([id, title, text]) => `
                <li><button type="button" data-action="open-tab" data-tab-target="${id}">
                    <b>${title}</b><span>${text}</span>${ICONS.arrow}
                </button></li>`).join('')}
            ${app.push.reason === 'unconfigured' ? '' : `<li class="whats-new-push"><button type="button" data-action="settings">
                <b>Уведомления</b><span>О новом в игре и о сдвигах в планах, а по желанию — факт дня. Включаются колокольчиком вверху.</span>${ICONS.arrow}
            </button></li>`}
        </ul>
        <button class="slab-button wide" type="button" data-action="close-sheet">Понятно</button>`;
}

function maybeShowWhatsNew() {
    const seenVersion = store.get(VERSION_KEY, 0);
    const returning = store.get('news.seen', null) !== null;
    store.set(VERSION_KEY, APP_VERSION);
    if (returning && seenVersion < APP_VERSION && !location.hash) {
        setTimeout(() => openSheet(whatsNewHtml()), 600);
    }
}

// ---------- Подсказки над лентой ----------

function extraNotices() {
    const parts = [];
    const push = pushNotice();
    if (push) {
        parts.push(push);
    }
    const install = installNotice();
    if (install) {
        parts.push(install);
    }
    const teaser = factsView.teaserHtml(ctx);
    if (teaser) {
        parts.push(teaser);
    }
    return parts;
}

function pushNotice() {
    if (app.push.reason !== 'ok' || app.push.subscribed || store.get(PUSH_PROMPT_KEY, false)) {
        return '';
    }
    return `
        <section class="notice push-prompt">
            <button class="icon-button close" type="button" data-action="close-push-prompt" aria-label="Скрыть">${ICONS.close}</button>
            <h3>${ICONS.bell} Узнавайте о новом первым</h3>
            <p>Уведомление придёт, как только в игру войдёт обновление или сдвинется этап плана.</p>
            <button class="slab-button" type="button" data-action="settings">Включить уведомления</button>
        </section>`;
}

function installNotice() {
    if (isStandalone() || store.get(INSTALL_KEY, false)) {
        return '';
    }
    const close = `<button class="icon-button close" type="button" data-action="close-install" aria-label="Скрыть">${ICONS.close}</button>`;
    const telegram = '<p class="install-note">Ссылка открылась внутри Telegram? Сначала откройте её в браузере: меню ⋯ → «Открыть в браузере».</p>';

    if (app.installPrompt) {
        return `
            <section class="notice install">${close}
                <h3>Поставьте HTV на экран телефона</h3>
                <p>Оно откроется как приложение, отдельно от браузера, и сможет присылать уведомления.</p>
                <button class="slab-button" type="button" data-action="install">Установить</button>
            </section>`;
    }
    if (isIos()) {
        return `
            <section class="notice install">${close}
                <h3>Поставьте HTV на экран iPhone</h3>
                <ol class="install-steps">
                    <li>Откройте страницу в Safari и нажмите «Поделиться» ${ICONS.shareInline} внизу экрана.</li>
                    <li>Выберите «На экран „Домой“» и нажмите «Добавить».</li>
                    <li>Запустите HTV с экрана «Домой» — только так iPhone разрешит уведомления.</li>
                </ol>
                ${telegram}
            </section>`;
    }
    if (isAndroid()) {
        return `
            <section class="notice install">${close}
                <h3>Поставьте HTV на экран телефона</h3>
                <ol class="install-steps">
                    <li>Откройте страницу в Chrome и нажмите меню ⋮ справа вверху.</li>
                    <li>Выберите «Добавить на главный экран» или «Установить приложение».</li>
                </ol>
                ${telegram}
            </section>`;
    }
    return '';
}

// ---------- События ----------

function wire() {
    $('.refresh').addEventListener('click', () => refreshAll({ manual: true }));

    $('.tabbar').addEventListener('click', event => {
        const tab = event.target.closest('[data-tab]');
        if (!tab) {
            return;
        }
        if (tab.dataset.tab === app.tab) {
            scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
            return;
        }
        buzz(8);
        navigate(tab.dataset.tab);
    });

    document.addEventListener('click', async event => {
        const action = event.target.closest('[data-action]');
        if (!action) {
            return;
        }
        switch (action.dataset.action) {
            case 'settings':
                closeSheet();
                openSettings();
                break;
            case 'close-sheet':
                closeSheet();
                break;
            case 'open-tab':
                closeSheet();
                navigate(action.dataset.tabTarget, action.dataset.arg || '');
                break;
            case 'whats-new':
                closeSheet();
                setTimeout(() => openSheet(whatsNewHtml()), reducedMotion() ? 0 : 230);
                break;
            case 'share-app':
                share();
                break;
            case 'mark-all-seen':
                markAllSeen();
                toast('Всё отмечено прочитанным');
                break;
            case 'test-push':
                action.disabled = true;
                try {
                    await testPush();
                    toast('Отправлено — уведомление придёт через пару секунд');
                } catch {
                    toast('Не получилось: нет связи с сервером');
                }
                action.disabled = false;
                break;
            case 'close-install':
                store.set(INSTALL_KEY, true);
                renderNotices();
                break;
            case 'close-push-prompt':
                store.set(PUSH_PROMPT_KEY, true);
                renderNotices();
                break;
            case 'install':
                if (app.installPrompt) {
                    app.installPrompt.prompt();
                    const choice = await app.installPrompt.userChoice.catch(() => null);
                    app.installPrompt = null;
                    if (choice && choice.outcome === 'accepted') {
                        store.set(INSTALL_KEY, true);
                    }
                    renderNotices();
                }
                break;
        }
    });

    document.addEventListener('change', event => {
        if (event.target.matches('[data-topic]')) {
            onTopicToggle(event.target);
        }
    });

    $('[data-sheet-backdrop]').addEventListener('click', closeSheet);
    addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            closeSheet();
        }
    });
    wireSheetDrag();

    addEventListener('popstate', route);
    addEventListener('hashchange', route);

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            scheduleSeen();
            clearBadge();
            if (feedIsStale()) {
                refreshAll();
            }
            renderDots();
        } else {
            pauseSeen();
        }
    });

    addEventListener('beforeinstallprompt', event => {
        event.preventDefault();
        app.installPrompt = event;
        renderNotices();
    });
    addEventListener('appinstalled', () => {
        app.installPrompt = null;
        store.set(INSTALL_KEY, true);
        renderNotices();
    });

    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
        navigator.serviceWorker.register('sw.js').catch(() => {});
        // Нажатие на уведомление при открытом приложении: работник просит открыть адрес.
        navigator.serviceWorker.addEventListener('message', event => {
            const data = event.data || {};
            if (data.type === 'open' && data.url) {
                const target = new URL(data.url, location.href);
                history.replaceState(null, '', target.pathname + target.search + target.hash);
                route();
            }
        });
    }
}

function clearBadge() {
    if (navigator.clearAppBadge) {
        navigator.clearAppBadge().catch(() => {});
    }
}

async function start() {
    wire();
    route();
    clearBadge();

    // «Что нового» — после настроек уведомлений: пока сервера нет, лист о них не обещает.
    loadPushConfig().then(async () => {
        await refreshPushState();
        renderNotices();
        maybeShowWhatsNew();
        resyncPush();
    });

    await Promise.all([
        initFeed({
            extraNotices,
            onLoaded: () => {
                renderDots();
                for (const id of app.mounted) {
                    const view = TABS[id].view;
                    if (view && view.update) {
                        view.update(viewElement(id), ctx, 'feed');
                    }
                }
                // Переход по ссылке на карточку ленты возможен только после её отрисовки.
                const { tab, arg } = parseHash();
                if (tab === 'feed' && arg) {
                    followFeedAnchor(arg);
                }
            },
            onSeen: () => {
                renderDots();
                clearBadge();
            },
        }),
        loadRoadmap(),
        loadFacts(),
    ]);
}

start();
