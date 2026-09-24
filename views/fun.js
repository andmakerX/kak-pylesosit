// Вкладка «Приколы»: гороскоп клинера на сегодня, тест «Какой ты пылесос?», генератор фраз
// диктора и мини-игра «Минутка уборки». Данные и законы — data/fun.js, игра — views/sweep.js.

import { escapeHtml, monthGenitive } from '../parse.js';
import { hashString } from '../daily.js';
import { QUIZ, SIGNS, announcerLine, horoscope, quizResult, signById } from '../data/fun.js';
import { ICONS, buzz, share, store } from '../shared.js';
import { openSweep, sweepBest } from './sweep.js';

const SIGN_KEY = 'news.sign';
const QUIZ_KEY = 'news.quizResult';

const view = {
    picking: false,
    quiz: null,
    announcer: null,
};

function prettyDay(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    return m ? `${Number(m[3])} ${monthGenitive(Number(m[2]) - 1)}` : iso;
}

// ---------- Гороскоп ----------

function horoscopeHtml(ctx) {
    const iso = ctx.today();
    const signId = store.get(SIGN_KEY, '');
    const chosen = signById(signId);
    if (!chosen || view.picking) {
        return `
            <section class="fun-card horo" id="fun-horoscope">
                <p class="fun-kicker">Гороскоп клинера · ${prettyDay(iso)}</p>
                <h2>Выберите свой знак</h2>
                <p class="fun-lead">Звёзды подскажут, что засасывать, а от чего держаться подальше. Каждый день новый прогноз.</p>
                <div class="horo-signs">
                    ${SIGNS.map(sign => `
                        <button type="button" class="horo-sign${sign.id === signId ? ' current' : ''}" data-sign="${sign.id}">
                            <span class="horo-symbol">${sign.symbol}</span><b>${sign.name}</b><small>${sign.dates}</small>
                        </button>`).join('')}
                </div>
            </section>`;
    }
    const h = horoscope(chosen.id, iso);
    const dots = value => '<span class="horo-dots">' + Array.from({ length: 5 }, (_, i) => `<i${i < value ? ' class="on"' : ''}></i>`).join('') + '</span>';
    return `
        <section class="fun-card horo" id="fun-horoscope">
            <p class="fun-kicker">Гороскоп клинера · ${prettyDay(iso)}</p>
            <header class="horo-head">
                <span class="horo-big">${chosen.symbol}</span>
                <div><h2>${chosen.name}</h2><p>${escapeHtml(chosen.trait)}</p></div>
            </header>
            <p class="horo-text">${escapeHtml(h.text)}</p>
            <p class="horo-warn">${escapeHtml(h.warning)}</p>
            <dl class="horo-lucky">
                <div><dt>Счастливый предмет</dt><dd>${escapeHtml(h.lucky.item)}</dd></div>
                <div><dt>Счастливая комната</dt><dd>${escapeHtml(h.lucky.room)}</dd></div>
                <div><dt>Счастливое число</dt><dd>${h.lucky.number} <small>${escapeHtml(h.lucky.why)}</small></dd></div>
                <div><dt>Напарник дня</dt><dd>${h.partner.symbol} ${h.partner.name}</dd></div>
            </dl>
            <ul class="horo-ratings">${h.ratings.map(r => `<li><span>${r.name}</span>${dots(r.value)}</li>`).join('')}</ul>
            <div class="fun-actions">
                <button class="slab-button" type="button" data-horo-share>${ICONS.share}Поделиться</button>
                <button class="link-button" type="button" data-horo-change>Сменить знак</button>
            </div>
        </section>`;
}

// ---------- Тест ----------

function quizHtml() {
    const total = QUIZ.questions.length;
    const q = view.quiz;
    if (q && q.step < total) {
        const question = QUIZ.questions[q.step];
        return `
            <section class="fun-card quiz" id="fun-quiz">
                <p class="fun-kicker">${QUIZ.title} · вопрос ${q.step + 1} из ${total}</p>
                <div class="quiz-progress"><i style="width:${(q.step / total) * 100}%"></i></div>
                <h2>${escapeHtml(question.text)}</h2>
                <div class="quiz-answers">
                    ${question.answers.map(([text], i) => `<button type="button" class="quiz-answer" data-answer="${i}">${escapeHtml(text)}</button>`).join('')}
                </div>
            </section>`;
    }
    const result = q ? quizResult(q.picks) : null;
    const last = store.get(QUIZ_KEY, null);
    const shown = result || (last && QUIZ.results[last] ? { key: last, ...QUIZ.results[last] } : null);
    if (shown) {
        return `
            <section class="fun-card quiz done" id="fun-quiz">
                <p class="fun-kicker">${QUIZ.title}${result ? '' : ' · ваш прошлый результат'}</p>
                <p class="quiz-you">Вы —</p>
                <h2 class="quiz-result">${escapeHtml(shown.title)}</h2>
                <p class="fun-lead">${escapeHtml(shown.text)}</p>
                <div class="fun-actions">
                    <button class="slab-button" type="button" data-quiz-share="${shown.key}">${ICONS.share}Поделиться</button>
                    <button class="link-button" type="button" data-quiz-start>Пройти ещё раз</button>
                </div>
            </section>`;
    }
    return `
        <section class="fun-card quiz" id="fun-quiz">
            <p class="fun-kicker">Тест · ${total} вопросов</p>
            <h2>${QUIZ.title}</h2>
            <p class="fun-lead">Робот, турбо, советский ветеран или клинер из нашей игры? Шесть честных вопросов о вашей уборке.</p>
            <button class="slab-button" type="button" data-quiz-start>${ICONS.play}Пройти тест</button>
        </section>`;
}

// ---------- Диктор ----------

function announcerHtml(ctx) {
    const iso = ctx.today();
    const line = view.announcer || announcerLine(hashString(`announcer|${iso}`));
    return `
        <section class="fun-card announcer" id="fun-announcer">
            <p class="fun-kicker">Голос диктора${view.announcer ? '' : ' · фраза дня'}</p>
            <blockquote class="announcer-line" aria-live="polite">«${escapeHtml(line)}»</blockquote>
            <div class="fun-actions">
                <button class="slab-button" type="button" data-announce>${ICONS.shuffle}Ещё фразу</button>
                <button class="link-button" type="button" data-announce-share>Поделиться</button>
            </div>
        </section>`;
}

// ---------- Мини-игра ----------

function sweepHtml() {
    const best = sweepBest();
    return `
        <section class="fun-card sweep-card" id="fun-sweep">
            <div class="sweep-art" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><b></b></div>
            <p class="fun-kicker">Мини-игра · 30 секунд</p>
            <h2>Минутка уборки</h2>
            <p class="fun-lead">Палец — это насадка. Собирай крошки, лови монеты и кольца, не засоси телефон заказчика. Быстро подряд — комбо до ×3.</p>
            <div class="fun-actions">
                <button class="slab-button accent" type="button" data-sweep-start>${ICONS.play}Играть</button>
                ${best ? `<span class="sweep-best">Рекорд: <b>${best}</b></span>` : ''}
            </div>
        </section>`;
}

function render(el, ctx) {
    el.innerHTML = [horoscopeHtml(ctx), sweepHtml(), quizHtml(), announcerHtml(ctx)].join('');
}

function replace(el, id, html) {
    const old = el.querySelector(`#${id}`);
    if (old) {
        old.outerHTML = html;
    }
}

export function mount(el, ctx) {
    render(el, ctx);
    el.addEventListener('click', event => {
        const sign = event.target.closest('[data-sign]');
        if (sign) {
            store.set(SIGN_KEY, sign.dataset.sign);
            view.picking = false;
            buzz(12);
            replace(el, 'fun-horoscope', horoscopeHtml(ctx));
            return;
        }
        if (event.target.closest('[data-horo-change]')) {
            view.picking = true;
            replace(el, 'fun-horoscope', horoscopeHtml(ctx));
            return;
        }
        if (event.target.closest('[data-horo-share]')) {
            const h = horoscope(store.get(SIGN_KEY, ''), ctx.today());
            if (h) {
                share({
                    title: `Гороскоп клинера: ${h.sign.name}`,
                    text: `Гороскоп клинера на ${prettyDay(ctx.today())}, ${h.sign.name}: ${h.text} ${h.warning} Счастливый предмет — ${h.lucky.item}.`,
                    hash: '#fun',
                });
            }
            return;
        }
        if (event.target.closest('[data-quiz-start]')) {
            view.quiz = { step: 0, picks: [] };
            replace(el, 'fun-quiz', quizHtml());
            return;
        }
        const answer = event.target.closest('[data-answer]');
        if (answer && view.quiz) {
            const question = QUIZ.questions[view.quiz.step];
            view.quiz.picks.push(question.answers[Number(answer.dataset.answer)][1]);
            view.quiz.step++;
            buzz(8);
            if (view.quiz.step >= QUIZ.questions.length) {
                store.set(QUIZ_KEY, quizResult(view.quiz.picks).key);
            }
            replace(el, 'fun-quiz', quizHtml());
            el.querySelector('#fun-quiz').scrollIntoView({ block: 'nearest' });
            return;
        }
        const quizShare = event.target.closest('[data-quiz-share]');
        if (quizShare) {
            const result = QUIZ.results[quizShare.dataset.quizShare];
            share({ title: QUIZ.title, text: `Тест «${QUIZ.title}»: мой результат — ${result.title}! ${result.text}`, hash: '#fun' });
            return;
        }
        if (event.target.closest('[data-announce]')) {
            view.announcer = announcerLine((Math.random() * 4294967296) >>> 0);
            buzz(8);
            replace(el, 'fun-announcer', announcerHtml(ctx));
            return;
        }
        if (event.target.closest('[data-announce-share]')) {
            const line = view.announcer || announcerLine(hashString(`announcer|${ctx.today()}`));
            share({ title: 'Голос диктора', text: `«${line}» — диктор игры «Как пылесосить»`, hash: '#fun' });
            return;
        }
        if (event.target.closest('[data-sweep-start]')) {
            openSweep({ onClose: () => replace(el, 'fun-sweep', sweepHtml()) });
        }
    });
}

// #fun/announcer, #fun/quiz и прочие — сразу к нужной карточке.
export function show(el, ctx, arg) {
    const target = arg && el.querySelector(`#fun-${CSS.escape(arg)}`);
    if (target) {
        target.scrollIntoView({ block: 'start' });
        return true;
    }
    return false;
}
