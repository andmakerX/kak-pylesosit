// Разбор Docs/ROADMAP.md для вкладки «Планы» и для сервера уведомлений, который сообщает,
// что этап сдвинулся. Без DOM: модуль проверяет Tools/news/app.test.js под node, а сервер
// (Tools/news/push/worker.js) собирает его в себя.
//
// Формат (его пишут люди, разбор к нему снисходителен):
//   ## Турбо, захват и бросок      этап
//   Статус: в работе               готово, в работе, впереди или идея
//   Абзац о том, что это даёт.
//   - [x] **Заголовок.** Пояснение  шаг: [x] сделано, [ ] впереди, [!] требует исправления
//   - **Заголовок.** Пояснение       пункт без отметки — у раздела идей

import { hashKey, plural } from './parse.js';

const STATUSES = [
    { status: 'done', prefix: 'готов', label: 'Готово' },
    { status: 'active', prefix: 'в работ', label: 'В работе' },
    { status: 'ahead', prefix: 'вперед', label: 'Впереди' },
    { status: 'idea', prefix: 'иде', label: 'Идеи' },
];

export const STATUS_ORDER = ['active', 'ahead', 'done', 'idea'];

export const STATUS_LABELS = Object.fromEntries(STATUSES.map(s => [s.status, s.label]));

const MARKS = { x: 'done', X: 'done', ' ': 'todo', '!': 'fix' };

export function parseRoadmap(text) {
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    const doc = { title: '', intro: [], stages: [] };
    let stage = null;
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        if (!line.trim()) {
            i++;
            continue;
        }

        let m = /^#\s+(.+)$/.exec(line);
        if (m) {
            doc.title = plainText(m[1]).replace(/[«»]/g, '').trim();
            i++;
            continue;
        }

        m = /^##\s+(.+)$/.exec(line);
        if (m) {
            const title = plainText(m[1]).trim();
            stage = { title, status: 'ahead', statusSet: false, text: [], steps: [], key: hashKey(`stage|${title}`) };
            doc.stages.push(stage);
            i++;
            continue;
        }

        m = /^Статус:\s*(.+)$/i.exec(line.trim());
        if (m && stage && !stage.statusSet) {
            stage.status = parseStatus(m[1]);
            stage.statusSet = true;
            i++;
            continue;
        }

        m = /^[-*]\s+(.*)$/.exec(line);
        if (m) {
            const parts = [m[1]];
            i++;
            while (i < lines.length && /^\s{2,}\S/.test(lines[i])) {
                parts.push(lines[i].trim());
                i++;
            }
            if (stage) {
                stage.steps.push(makeStep(stage, squeeze(parts.join(' '))));
            }
            continue;
        }

        const parts = [line.trim()];
        i++;
        while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|[-*]\s|Статус:)/i.test(lines[i].trim())) {
            parts.push(lines[i].trim());
            i++;
        }
        (stage ? stage.text : doc.intro).push(squeeze(parts.join(' ')));
    }

    for (const s of doc.stages) {
        delete s.statusSet;
        s.counts = countSteps(s.steps);
    }
    return doc;
}

function parseStatus(value) {
    const lower = value.trim().toLowerCase().replace(/ё/g, 'е');
    const known = STATUSES.find(s => lower.startsWith(s.prefix));
    return known ? known.status : 'ahead';
}

function makeStep(stage, raw) {
    const box = /^\[([ xX!])\]\s*([\s\S]*)$/.exec(raw);
    const state = box ? MARKS[box[1]] : 'idea';
    const text = box ? box[2].trim() : raw;
    const bold = /^\*\*(.+?)\*\*\s*([\s\S]*)$/.exec(text);
    const lead = bold ? bold[1].trim().replace(/[.:]$/, '') : '';
    const body = bold ? bold[2].trim() : text;
    // Ключ шага не зависит ни от отметки, ни от пояснения: по нему сервер видит, что шаг стал
    // готов, даже если заодно поправили текст.
    return { state, raw: text, lead, body, key: hashKey(`step|${stage.title}|${lead || text}`) };
}

function countSteps(steps) {
    const counts = { done: 0, fix: 0, todo: 0, idea: 0, total: steps.length };
    for (const step of steps) {
        counts[step.state]++;
    }
    return counts;
}

// Сколько сделано по всем этапам, кроме идей. Шаг «требует исправления» в игре уже есть, но
// готовым не считается: у него своя доля (fixPercent), приложение рисует её отдельно.
export function roadmapStats(doc) {
    const result = { done: 0, fix: 0, todo: 0, steps: 0, percent: 0, fixPercent: 0, stages: { done: 0, active: 0, ahead: 0, idea: 0 } };
    for (const stage of doc.stages) {
        result.stages[stage.status]++;
        if (stage.status === 'idea') {
            continue;
        }
        result.done += stage.counts.done;
        result.fix += stage.counts.fix;
        result.todo += stage.counts.todo;
    }
    result.steps = result.done + result.fix + result.todo;
    result.percent = result.steps ? Math.round((result.done / result.steps) * 100) : 0;
    result.fixPercent = result.steps ? Math.round((result.fix / result.steps) * 100) : 0;
    return result;
}

// Все шаги «требует исправления» вместе с названием этапа — для списка наверху вкладки.
export function fixList(doc) {
    return doc.stages.flatMap(stage => stage.steps
        .filter(step => step.state === 'fix')
        .map(step => ({ stage, step })));
}

// Слепок для сервера уведомлений: у каждого этапа статус, у каждого шага отметка.
export function roadmapSnapshot(doc) {
    const snapshot = {};
    for (const stage of doc.stages) {
        snapshot[stage.key] = {
            status: stage.status,
            steps: Object.fromEntries(stage.steps.map(step => [step.key, step.state])),
        };
    }
    return snapshot;
}

// Что сдвинулось вперёд с прошлого слепка: этап сменил статус на «в работе» или «готово»,
// шаг стал сделанным или исправленным. Новые этапы и шаги, которых раньше не было, не в счёт:
// их дописали в план, а не сделали. Откат назад тоже молчит: о нём не уведомляют.
export function roadmapChanges(previous, doc) {
    const changes = [];
    if (!previous) {
        return changes;
    }
    const rank = { idea: 0, ahead: 1, active: 2, done: 3 };
    for (const stage of doc.stages) {
        const before = previous[stage.key];
        if (!before) {
            continue;
        }
        if (before.status !== stage.status && rank[stage.status] > rank[before.status]
            && (stage.status === 'active' || stage.status === 'done')) {
            changes.push({ kind: 'stage', stage: stage.title, status: stage.status });
        }
        for (const step of stage.steps) {
            const was = before.steps ? before.steps[step.key] : undefined;
            if (was === 'todo' && (step.state === 'done' || step.state === 'fix')) {
                changes.push({ kind: 'step', stage: stage.title, step: step.lead || headline(step.body), state: 'done' });
            } else if (was === 'fix' && step.state === 'done') {
                changes.push({ kind: 'step', stage: stage.title, step: step.lead || headline(step.body), state: 'fixed' });
            }
        }
    }
    return changes;
}

// Текст уведомления о сдвинувшихся планах: заголовок и строка.
export function describeChanges(changes) {
    if (!changes.length) {
        return null;
    }
    const lines = changes.map(change => {
        if (change.kind === 'stage') {
            return change.status === 'done' ? `Этап «${change.stage}» готов` : `Взялись за этап «${change.stage}»`;
        }
        return change.state === 'fixed' ? `Исправлено: ${change.step}` : `Готово: ${change.step}`;
    });
    const n = changes.length;
    const title = n === 1 ? 'Планы: шаг вперёд' : `Планы: ${n} ${plural(n, 'шаг', 'шага', 'шагов')} вперёд`;
    let body = lines.slice(0, 3).join(' · ');
    if (lines.length > 3) {
        body += ` · и ещё ${lines.length - 3}`;
    }
    return { title, body };
}

function headline(text) {
    const flat = plainText(text);
    const m = /[.!?](?=\s|$)/.exec(flat);
    return (m ? flat.slice(0, m.index) : flat).slice(0, 80);
}

function plainText(text) {
    return String(text).replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]*)`/g, '$1');
}

function squeeze(text) {
    return String(text).replace(/\s+/g, ' ').trim();
}
