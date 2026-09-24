// Вкладка «Планы»: что готово, что в работе, что впереди и что сделано, но требует исправления.
// Источник — roadmap.md рядом со страницей (его кладёт Tools/news.ps1 из Docs/ROADMAP.md), разбор
// — roadmap.js. Этапы идут в порядке файла, то есть в порядке плана.

import { escapeHtml, inlineHtml, plural } from '../parse.js';
import { STATUS_LABELS, fixList, roadmapStats } from '../roadmap.js';
import { ICONS } from '../shared.js';

const open = new Set();
let initialized = false;

// Кольцо: сделанное — оранжевой дугой, следом жёлтой полосатой — сделанное, но требующее
// исправления.
function ring(stats) {
    const r = 42;
    const length = 2 * Math.PI * r;
    const done = (length * stats.done) / (stats.steps || 1);
    const fix = (length * stats.fix) / (stats.steps || 1);
    return `
        <svg class="p-ring" viewBox="0 0 100 100" aria-hidden="true">
            <circle cx="50" cy="50" r="${r}" class="p-ring-track"/>
            <circle cx="50" cy="50" r="${r}" class="p-ring-fix" stroke-dasharray="0 ${done.toFixed(1)} ${fix.toFixed(1)} ${length.toFixed(1)}"/>
            <circle cx="50" cy="50" r="${r}" class="p-ring-fill" stroke-dasharray="${done.toFixed(1)} ${length.toFixed(1)}"/>
        </svg>`;
}

function summaryHtml(doc) {
    const s = roadmapStats(doc);
    return `
        <section class="p-summary">
            <div class="p-ring-wrap">${ring(s)}<b>${s.percent}<small>%</small></b></div>
            <div class="p-summary-text">
                <h2>Путь к раннему доступу</h2>
                <p><b>${s.done}</b> ${plural(s.done, 'шаг готов', 'шага готово', 'шагов готово')},
                    <b class="warn">${s.fix}</b> сделано, но ${plural(s.fix, 'требует', 'требуют', 'требуют')} исправления,
                    <b>${s.todo}</b> впереди.</p>
                <ul class="p-legend">
                    <li data-status="done">${s.stages.done} ${plural(s.stages.done, 'этап готов', 'этапа готовы', 'этапов готовы')}</li>
                    <li data-status="active">${s.stages.active} в работе</li>
                    <li data-status="ahead">${s.stages.ahead} впереди</li>
                </ul>
            </div>
        </section>`;
}

function fixesHtml(doc) {
    const fixes = fixList(doc);
    if (!fixes.length) {
        return '';
    }
    return `
        <section class="p-fixes" id="plans-fix">
            <h2>${ICONS.warn} Сделано, но требует исправления <small>${fixes.length}</small></h2>
            <p class="p-fixes-lead">Это уже есть в игре, но работает не так, как задумано, или ещё не проверено живой игрой.</p>
            <ul>
                ${fixes.map(({ stage, step }) => `
                    <li>
                        <details>
                            <summary><span class="p-fix-title">${escapeHtml(step.lead || step.body)}</span><span class="p-fix-stage">${escapeHtml(stage.title)}</span></summary>
                            ${step.lead && step.body ? `<p>${inlineHtml(step.body)}</p>` : ''}
                        </details>
                    </li>`).join('')}
            </ul>
        </section>`;
}

function barHtml(counts) {
    const total = counts.done + counts.fix + counts.todo;
    if (!total) {
        return '';
    }
    const part = n => `${((n / total) * 100).toFixed(2)}%`;
    return `
        <div class="p-bar" role="img" aria-label="Сделано ${counts.done}, требует исправления ${counts.fix}, впереди ${counts.todo}">
            <i class="done" style="width:${part(counts.done)}"></i><i class="fix" style="width:${part(counts.fix)}"></i>
        </div>`;
}

function stepHtml(step) {
    const icon = step.state === 'done' ? ICONS.check : step.state === 'fix' ? ICONS.warn : '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6"/></svg>';
    const tag = step.state === 'fix' ? '<em class="p-fix-tag">требует исправления</em>' : '';
    return `<li class="p-step" data-state="${step.state}">${icon}<p>${inlineHtml(step.raw)}${tag}</p></li>`;
}

function stageHtml(stage) {
    const c = stage.counts;
    const isOpen = open.has(stage.key);
    const id = `stage-${stage.key}`;
    const progress = c.total ? `готово ${c.done} из ${c.total}` : '';
    return `
        <li class="p-stage" data-status="${stage.status}">
            <span class="p-node" aria-hidden="true">${stage.status === 'done' ? ICONS.check : ''}</span>
            <article class="p-card">
                <h3 class="card-h">
                    <button class="p-head" type="button" aria-expanded="${isOpen}" aria-controls="${id}" data-stage="${stage.key}">
                        <span class="p-titles">
                            <span class="p-title">${escapeHtml(stage.title)}</span>
                            <span class="p-meta">
                                <span class="p-pill" data-status="${stage.status}">${STATUS_LABELS[stage.status]}</span>
                                ${progress ? `<span class="p-count">${progress}</span>` : ''}
                                ${c.fix ? `<span class="p-count warn">${ICONS.warn}${c.fix}</span>` : ''}
                            </span>
                            ${barHtml(c)}
                        </span>
                        ${ICONS.chevron}
                    </button>
                </h3>
                <div class="p-body" id="${id}"${isOpen ? '' : ' hidden'}>
                    ${stage.text.map(p => `<p class="p-text">${inlineHtml(p)}</p>`).join('')}
                    <ul class="p-steps">${stage.steps.map(stepHtml).join('')}</ul>
                </div>
            </article>
        </li>`;
}

function ideasHtml(stages) {
    if (!stages.length) {
        return '';
    }
    return stages.map(stage => `
        <section class="p-ideas">
            <h2>${escapeHtml(stage.title)}</h2>
            ${stage.text.map(p => `<p class="p-text">${inlineHtml(p)}</p>`).join('')}
            <ul>${stage.steps.map(step => `<li>${inlineHtml(step.raw)}</li>`).join('')}</ul>
        </section>`).join('');
}

function render(el, ctx) {
    const doc = ctx.roadmap();
    if (!doc) {
        el.innerHTML = `
            <div class="empty">
                <strong>Планы не загрузились</strong>
                Проверьте интернет и нажмите «Обновить» вверху.
            </div>`;
        return;
    }
    if (!initialized) {
        initialized = true;
        for (const stage of doc.stages) {
            if (stage.status === 'active') {
                open.add(stage.key);
            }
        }
    }
    const track = doc.stages.filter(stage => stage.status !== 'idea');
    const ideas = doc.stages.filter(stage => stage.status === 'idea');
    el.innerHTML = `
        ${summaryHtml(doc)}
        ${fixesHtml(doc)}
        <h2 class="p-track-h">Этапы</h2>
        <ol class="p-track">${track.map(stageHtml).join('')}</ol>
        ${ideasHtml(ideas)}
        <p class="p-foot">Планы меняются вместе с игрой. Когда этап сдвинется или шаг будет готов, придёт уведомление — если оно включено.
            <button class="link-button" type="button" data-action="settings">Настроить уведомления</button></p>`;
}

export function mount(el, ctx) {
    render(el, ctx);
    el.addEventListener('click', event => {
        const head = event.target.closest('[data-stage]');
        if (!head) {
            return;
        }
        const isOpen = head.getAttribute('aria-expanded') !== 'true';
        head.setAttribute('aria-expanded', String(isOpen));
        document.getElementById(head.getAttribute('aria-controls')).hidden = !isOpen;
        if (isOpen) {
            open.add(head.dataset.stage);
        } else {
            open.delete(head.dataset.stage);
        }
    });
}

export function update(el, ctx, which) {
    if (which === 'plans') {
        render(el, ctx);
    }
}

// #plans/fix — сразу к списку «требует исправления».
export function show(el, ctx, arg) {
    if (arg === 'fix') {
        const target = el.querySelector('#plans-fix');
        if (target) {
            target.scrollIntoView({ block: 'start' });
            return true;
        }
    }
    return false;
}
