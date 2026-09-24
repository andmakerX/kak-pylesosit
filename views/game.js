// Вкладка «Игра»: всё об игре для того, кто в неё ещё не играл. Числа и названия взяты из
// самой игры (каталоги предметов, цветов пылесоса, карт, подсказки управления); меняются они
// там — поправить и здесь. Живые счётчики внизу считаются по журналу изменений.

import { escapeHtml, plural, stats } from '../parse.js';
import { dayNumber } from '../daily.js';
import { ICONS } from '../shared.js';

// День первой играбельной версии (журнал, 10 сентября 2026).
const BIRTHDAY = '2026-09-10';

const PHASES = [
    { name: 'Ожидание', time: 'пока хост не нажмёт Enter', text: 'Все бегают по дому под «Waiting for Players» и присматриваются друг к другу.' },
    { name: 'Осмотр', time: '20 секунд', text: 'Пылесосы выключены: высматривай кучи мусора и тяжёлую мебель, под которой может лежать клад.' },
    { name: 'Уборка', time: '6 минут', text: 'Засасывай мусор ради очков, оттаскивай мебель и кидайся табуретками. Всё убрано — уборка кончается раньше.' },
    { name: 'Подсчёт', time: 'несколько секунд', text: 'Весь незасосанный мусор мигает сквозь стены: сразу видно, кто обошёл кухню стороной.' },
    { name: 'Результаты', time: 'до нового матча', text: 'Повтор лучшей катастрофы со стороны, таблица, разбор очков и значки.' },
];

const ABILITIES = [
    {
        name: 'Тяга', keys: 'левая кнопка мыши',
        icon: '<path d="M4 12h9"/><path d="M4 8.5h6M4 15.5h6"/><path d="M13 7.5l6-3v15l-6-3z"/>',
        text: 'Мусор летит в трубу и сразу приносит очки. Штрафное — телефон заказчика, ключи — лучше успеть отвернуть.',
    },
    {
        name: 'Турбо', keys: 'правая кнопка вместе с левой',
        icon: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>',
        text: 'Дальше, сильнее, тащит тяжёлую мебель. Тратит заряд, а заряд копится только уборкой: до 10 секунд в запасе.',
    },
    {
        name: 'Захват и бросок', keys: 'отпустить кнопку',
        icon: '<path d="M5 19c4-9 9-12 15-13"/><path d="m15 4 5 2-2 5"/><circle cx="5" cy="19" r="1.5"/>',
        text: 'Кружку, книгу или табурет подтягивает к насадке, а отпущенная кнопка швыряет их. Сила — от замаха мышью.',
    },
    {
        name: 'Присоска', keys: 'турбо на сопернике ближе 3 м',
        icon: '<circle cx="8" cy="8" r="3"/><path d="M8 11v6M5 21l3-4 3 4M5 14h6"/><path d="M14 12h7M17.5 9v6"/>',
        text: 'Хватает соперника за ту часть тела, куда целишься: за ногу — висит вниз головой. Раскрутить и бросить — живой таран.',
    },
    {
        name: 'Стрельба мусором', keys: 'F',
        icon: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
        text: 'Засосанное вылетает очередью, последний засосанный — первым. Выстреленное снова лежит в доме, поэтому стреляют крошкой, а не кольцом.',
    },
    {
        name: 'Толчок мебели', keys: 'F и левая кнопка',
        icon: '<rect x="3" y="9" width="9" height="9" rx="1.5"/><path d="M14 13.5h7"/><path d="m18 10.5 3 3-3 3"/>',
        text: 'В режиме стрельбы мебель толкается от себя: шкаф, затянутый на единственную дверь, больше не запирает комнату.',
    },
];

const MAPS = [
    {
        key: 'apartment', name: 'Квартира', image: 'img/map-apartment.jpg',
        facts: ['7 комнат', 'около 500 предметов', '1 этаж'],
        text: 'Гостиная, кухня, кабинет, коридор, спальня, ванная и детская после вечеринки. Крошки у стола, шелуха у дивана, носки везде.',
        loot: 'Заначка под кроватью, коллекционная монета под холодильником, флешка с диссертацией под стеллажом.',
    },
    {
        key: 'mansion', name: 'Особняк', image: 'img/map-mansion.jpg',
        facts: ['2 этажа', '725 предметов', '640 м²'],
        text: 'Богатая вечеринка: коробки из-под пиццы, шампанское, фишки казино, серпантин и рассыпанные деньги. Спальня с балдахином, библиотека, люстра.',
        loot: 'Фамильный перстень под кроватью с балдахином, серебряная ложка под холодильником, чёрная фишка под диваном в лаунже.',
    },
    {
        key: 'estate', name: 'Усадьба', image: 'img/map-estate.jpg',
        facts: ['4 уровня и двор', '970 предметов', '1005 м²'],
        text: 'Полуподвал с котельной, два этажа и чердак, а вокруг двор с забором в полтора метра. Шесть выходов во двор и 24 окна, которые бьются.',
        loot: 'Окно берётся табуретом, стулом — или соперником на присоске. Летит он при этом во двор.',
    },
];

const TRAITS = [
    ['Рост', '1,26 м — чуть выше дивана'],
    ['Причёска', 'лысина лоснится, венчик вокруг затылка и три последних кучерявых волоска на макушке'],
    ['Лицо', 'глаза-бусинки, брови-гусеницы и пышные усы-щётка'],
    ['Глаза', 'зрачки болтаются от бега, прыжков и поворотов головы — и бьются о край'],
    ['Одежда', 'двухцветный рабочий комбинезон с нашивкой и жёлтые резиновые перчатки'],
    ['Снаряжение', 'пылесос в правой руке, бак в левой — несёт за дужку, как канистру'],
];

const PRICES = [
    { group: 'Мусор', kind: 'good', items: [['Пыль', 1], ['Крошка', 2], ['Бумажный комок', 3], ['Носок', 4]] },
    { group: 'Ценное', kind: 'value', items: [['Монета', 15], ['Кольцо', 25], ['Купюра', 30], ['Пачка денег', 35]] },
    { group: 'Штраф', kind: 'bad', items: [['Ключи', -20], ['Пульт', -25], ['Очки (не те, что за уборку)', -30], ['Телефон заказчика', -40]] },
    { group: 'Редкое, в тайниках', kind: 'rare', items: [['Флешка с диссертацией', 50], ['Коллекционная монета', 60], ['Серебряная ложка', 60], ['Заначка', 70], ['Чёрная фишка', 70], ['Фамильный перстень', 100]] },
];

const SKINS = [
    ['Классика', '#f2801f', 'тот самый, с которого всё началось'],
    ['Золото', '#f5ad2b', 'пылесосить — так с шиком'],
    ['Вишня', '#d11f29', 'быстрее он от этого не станет, но кажется'],
    ['Океан', '#216bdb', 'спокойствие посреди бардака'],
    ['Лайм', '#85d129', 'кислотно чисто'],
    ['Жвачка', '#fa7ab8', 'липнет только пыль'],
    ['Фиалка', '#854ddb', 'для ценителей тихой уборки'],
    ['Снег', '#edf0f5', 'белый — до первой же пыли'],
    ['Ночь', '#1a1a1f', 'пыль его не видит'],
    ['Хром', '#dbe0eb', 'можно смотреться вместо зеркала'],
];

const BADGES = [
    ['Кладоискатель', 'больше всех очков за находки'],
    ['Драчун', 'больше всех попаданий в соперников'],
    ['Чистюля', 'больше всех очков за уборку'],
    ['Мишень', 'его сбивали чаще всех'],
];

const QUOTES = [
    'Диван перемещён. Его четыре части находятся в пределах помещения.',
    'Вы временно назначены ответственным за левую ногу синего клинера.',
    'Телефон заказчика успешно очищен от возможности принимать звонки.',
    'Лучший бросок матча: табурет, 11 метров, один коллега, ноль сожалений.',
];

const CONTROLS = [
    ['WASD', 'бежать; Shift — спринт, Ctrl — шаг, пробел — прыжок'],
    ['ЛКМ', 'тяга, отпустить — бросок'],
    ['ПКМ + ЛКМ', 'турбо'],
    ['F', 'стрельба мусором и толчок мебели'],
    ['Tab', 'таблица матча'],
    ['Enter', 'начать матч (хост)'],
    ['F2', 'позвать друга через Steam'],
    ['F9', 'отчёт о беде'],
];

function section(title, body, extra = '') {
    return `<section class="g-sec"${extra}><h2 class="g-h">${title}</h2>${body}</section>`;
}

function heroHtml(ctx) {
    const days = dayNumber(ctx.today()) - dayNumber(BIRTHDAY);
    return `
        <section class="g-hero">
            <p class="g-kicker">Сетевая физическая комедия</p>
            <h2 class="g-title">Как пылесосить</h2>
            <p class="g-pitch">Соревновательная уборка от первого лица: засасывай мусор ради очков, а табуретки кидай в соперников.</p>
            <ul class="g-tags">
                <li>2–4 игрока</li><li>от первого лица</li><li>матч ≈ 7 минут</li><li>Steam и по IP</li><li>Windows</li>
            </ul>
            <p class="g-age">${ICONS.clock} Прототип · в разработке ${days} ${plural(days, 'день', 'дня', 'дней')}</p>
        </section>
        <blockquote class="g-quote">
            <p>Пропылесосить комнату лучше соперников, бросить в друга табуреткой и закончить матч с невинным видом профессионального клинера.</p>
            <cite>Главная фантазия игрока, из концепта</cite>
        </blockquote>`;
}

function phasesHtml() {
    return section('Как проходит матч', `
        <ol class="g-phases">
            ${PHASES.map((p, i) => `
                <li>
                    <span class="g-step">${i + 1}</span>
                    <div><b>${p.name}</b> <small>${p.time}</small><p>${p.text}</p></div>
                </li>`).join('')}
        </ol>`);
}

function abilitiesHtml() {
    return section('Что умеет пылесос', `
        <div class="g-abilities">
            ${ABILITIES.map(a => `
                <article class="g-ability">
                    <svg viewBox="0 0 24 24" aria-hidden="true">${a.icon}</svg>
                    <h3>${a.name}</h3>
                    <p class="g-keys">${a.keys}</p>
                    <p>${a.text}</p>
                </article>`).join('')}
        </div>`);
}

function mapsHtml() {
    return section('Карты', `
        <div class="g-maps">
            ${MAPS.map(m => `
                <article class="g-map">
                    <img src="${m.image}" alt="${m.name}: дом со снятой крышей" loading="lazy" width="800" height="450">
                    <div class="g-map-body">
                        <h3>${m.name}</h3>
                        <ul class="g-map-facts">${m.facts.map(f => `<li>${f}</li>`).join('')}</ul>
                        <p>${m.text}</p>
                        <p class="g-map-loot">${m.loot}</p>
                    </div>
                </article>`).join('')}
        </div>`);
}

// Портрет героя нарисован здесь же, по приметам модели: лысая голова-шар, три волоска,
// брови-гусеницы, усы-щётка и глаза с болтающимися зрачками.
const PORTRAIT = `
    <svg class="g-portrait" viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r="56" class="p-bg"/>
        <path d="M22 118c3-22 18-33 38-33s35 11 38 33" class="p-suit"/>
        <path d="M44 88l16 12 16-12" class="p-collar"/>
        <circle cx="60" cy="54" r="31" class="p-head"/>
        <ellipse cx="50" cy="36" rx="9" ry="5" class="p-shine"/>
        <path d="M30 60c-3-7-2-15 2-20M90 60c3-7 2-15-2-20" class="p-fringe"/>
        <path d="M55 24c-3-5 1-9 4-6M60 23c0-6 5-7 6-3M65 25c2-5 7-4 6 0" class="p-hair"/>
        <path d="M40 47c4-5 11-5 15-1M65 46c4-4 11-4 15 1" class="p-brow"/>
        <circle cx="48" cy="55" r="6" class="p-eye"/><circle cx="72" cy="55" r="6" class="p-eye"/>
        <circle cx="50" cy="57" r="2.6" class="p-pupil"/><circle cx="70" cy="57" r="2.6" class="p-pupil"/>
        <path d="M58 60c1 4 3 6 5 6" class="p-nose"/>
        <path d="M40 72c6-6 14-7 20-3 6-4 14-3 20 3-6 3-13 3-20 0-7 3-14 3-20 0z" class="p-stache"/>
    </svg>`;

function heroCardHtml() {
    return section('Герой', `
        <div class="g-hero-card">
            ${PORTRAIT}
            <div>
                <h3>Работник химчистки</h3>
                <p>Взрослые пропорции, телосложение робота-капсулы и абсолютная уверенность в себе.</p>
            </div>
        </div>
        <dl class="g-traits">${TRAITS.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`);
}

function pricesHtml() {
    return section('Сколько стоит мусор', `
        <div class="g-prices">
            ${PRICES.map(p => `
                <div class="g-price-group" data-price="${p.kind}">
                    <h3>${p.group}</h3>
                    <ul>${p.items.map(([name, score]) => `<li><span>${name}</span><b>${score > 0 ? '+' : '−'}${Math.abs(score)}</b></li>`).join('')}</ul>
                </div>`).join('')}
        </div>
        <p class="g-note">Редкое спрятано под мебелью: пока диван стоит на месте, вещи в комнате нет вовсе. Сдвинул — она на 15 секунд загорается золотом сквозь стены, и все бегут спорить за находку.</p>`);
}

function skinsHtml() {
    return section('Цвета пылесоса', `
        <ul class="g-skins">
            ${SKINS.map(([name, color, line]) => `
                <li><i style="--skin:${color}"></i><span><b>${name}</b><small>${line}</small></span></li>`).join('')}
        </ul>`);
}

function badgesHtml() {
    return section('Значки на итогах', `
        <ul class="g-badges">${BADGES.map(([name, line]) => `<li><b>${name}</b><span>${line}</span></li>`).join('')}</ul>
        <p class="g-note">Значок достаётся тому, кто в своей графе один впереди всех. При равенстве — никому.</p>`);
}

function quotesHtml() {
    return section('Голос диктора', `
        <div class="g-quotes">${QUOTES.map(q => `<p>«${q}»</p>`).join('')}</div>
        <button class="slab-button" type="button" data-action="open-tab" data-tab-target="fun" data-arg="announcer">Ещё — в генераторе диктора</button>`);
}

function controlsHtml() {
    return section('Управление', `
        <dl class="g-controls">${CONTROLS.map(([k, v]) => `<div><dt><kbd>${k}</kbd></dt><dd>${v}</dd></div>`).join('')}</dl>
        <p class="g-note">Геймпад тоже: правый триггер — тяга, левый — турбо, A — прыжок, Y — стрельба.</p>`);
}

function numbersHtml(ctx) {
    const doc = ctx.feedDoc();
    const s = doc ? stats(doc) : null;
    const days = dayNumber(ctx.today()) - dayNumber(BIRTHDAY);
    const cells = [
        [days, plural(days, 'день разработки', 'дня разработки', 'дней разработки')],
        [s ? s.groups : '—', s ? plural(s.groups, 'обновление', 'обновления', 'обновлений') : 'обновлений'],
        [s ? s.added : '—', s ? plural(s.added, 'новинка', 'новинки', 'новинок') : 'новинок'],
        [s ? s.fixed : '—', s ? plural(s.fixed, 'исправление', 'исправления', 'исправлений') : 'исправлений'],
        [3, 'карты'],
        [970, 'предметов в усадьбе'],
        [24, 'окна бьются'],
        ['800+', 'автотестов'],
    ];
    return section('В цифрах', `
        <div class="g-numbers">${cells.map(([n, label]) => `<div><b>${escapeHtml(String(n))}</b><span>${label}</span></div>`).join('')}</div>`, ' data-numbers');
}

function linksHtml() {
    return `
        <nav class="g-links">
            <button class="g-link" type="button" data-action="open-tab" data-tab-target="plans"><b>Планы</b><span>Что готово и что впереди</span>${ICONS.arrow}</button>
            <button class="g-link" type="button" data-action="open-tab" data-tab-target="fun"><b>Приколы</b><span>Гороскоп клинера и мини-игра</span>${ICONS.arrow}</button>
        </nav>`;
}

export function mount(el, ctx) {
    el.innerHTML = [
        heroHtml(ctx),
        phasesHtml(),
        abilitiesHtml(),
        mapsHtml(),
        heroCardHtml(),
        pricesHtml(),
        skinsHtml(),
        badgesHtml(),
        quotesHtml(),
        controlsHtml(),
        numbersHtml(ctx),
        linksHtml(),
    ].join('');
}

export function update(el, ctx, which) {
    if (which === 'feed') {
        const numbers = el.querySelector('[data-numbers]');
        if (numbers) {
            numbers.outerHTML = numbersHtml(ctx);
        }
    }
}
