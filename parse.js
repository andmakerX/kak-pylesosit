// Разбор Docs/CHANGELOG.md в ленту приложения новостей. Без DOM: тот же модуль проверяет
// Tools/news/parse.test.js под node.
//
// Формат журнала (его пишут люди, разбор к нему снисходителен):
//   ## 21 сентября 2026            день; бывает «15 сентября 2026, вечер»
//   Ветка `claude/x` — заголовок.  порция изменений; заголовок после тире видит читатель ленты
//   ### Добавлено                  раздел: Добавлено, Изменено, Исправлено, можно с пометкой в скобках
//   - **Главное.** Подробности,    пункт; жирное начало — заголовок пункта, продолжение с отступом
//     продолжение строки.
// Абзац без «Ветка» сразу под датой тоже открывает порцию и целиком служит заголовком.

const MONTHS = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

const KINDS = [
    { kind: 'added', prefix: 'добавлен', label: 'Добавлено' },
    { kind: 'changed', prefix: 'изменен', label: 'Изменено' },
    { kind: 'fixed', prefix: 'исправлен', label: 'Исправлено' },
    { kind: 'removed', prefix: 'убран', label: 'Убрано' },
    { kind: 'removed', prefix: 'удален', label: 'Убрано' },
];

export const KIND_ORDER = ['added', 'changed', 'fixed', 'removed', 'other'];

export function parseChangelog(text) {
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    const doc = { title: '', days: [] };
    let day = null;
    let group = null;
    let section = null;
    let i = 0;

    const openGroup = () => {
        group = { title: '', subtitle: '', header: '', notes: [], sections: [] };
        day.groups.push(group);
        section = null;
        return group;
    };

    while (i < lines.length) {
        const line = lines[i];
        if (!line.trim()) {
            i++;
            continue;
        }

        let m = /^#\s+(.+)$/.exec(line);
        if (m) {
            doc.title = plain(m[1]).replace(/[«»]/g, '').trim();
            i++;
            continue;
        }

        m = /^##\s+(.+)$/.exec(line);
        if (m) {
            day = parseDay(m[1].trim());
            doc.days.push(day);
            group = null;
            section = null;
            i++;
            continue;
        }

        m = /^###\s+(.+)$/.exec(line);
        if (m) {
            i++;
            if (!day) {
                continue;
            }
            if (!group) {
                openGroup();
            }
            section = parseSection(m[1].trim());
            group.sections.push(section);
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
            if (!day) {
                continue;
            }
            if (!group) {
                openGroup();
            }
            if (!section) {
                section = parseSection('');
                group.sections.push(section);
            }
            section.items.push(makeItem(parts.join(' ')));
            continue;
        }

        const parts = [line.trim()];
        i++;
        while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|[-*]\s)/.test(lines[i])) {
            parts.push(lines[i].trim());
            i++;
        }
        if (!day) {
            continue;
        }

        const paragraph = squeeze(parts.join(' '));
        const branch = /^Ветк[аи]\s/.test(paragraph);
        if (group && group.sections.length === 0 && !group.header) {
            applyHeader(group, paragraph);
        } else if (branch || !group) {
            applyHeader(openGroup(), paragraph);
        } else {
            group.notes.push(paragraph);
        }
    }

    finish(doc);
    return doc;
}

function parseDay(heading) {
    const m = /^(\d{1,2})\s+([А-Яа-яЁё]+)\s+(\d{4})(?:\s*,\s*(.+))?$/.exec(heading);
    const month = m ? MONTHS.indexOf(m[2].toLowerCase()) : -1;
    const iso = m && month >= 0
        ? `${m[3]}-${String(month + 1).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`
        : '';
    return {
        heading,
        iso,
        note: m && m[4] ? m[4].trim() : '',
        groups: [],
        id: '',
    };
}

function parseSection(heading) {
    const m = /^(.*?)\s*(?:\(([^)]*)\))?\s*$/.exec(heading);
    const name = (m ? m[1] : heading).trim();
    const lower = name.toLowerCase().replace(/ё/g, 'е');
    const known = KINDS.find(k => lower.startsWith(k.prefix));
    return {
        heading,
        kind: known ? known.kind : 'other',
        label: known ? known.label : (name || 'Прочее'),
        note: m && m[2] ? m[2].trim() : '',
        items: [],
    };
}

function makeItem(text) {
    const raw = squeeze(text);
    const m = /^\*\*(.+?)\*\*\s*([\s\S]*)$/.exec(raw);
    const lead = m ? m[1].trim() : '';
    const body = m ? m[2].trim() : raw;
    return { raw, lead, body, headline: headline(lead || body), key: hashKey(raw) };
}

// Заголовок порции из абзаца «Ветка `имя` — заголовок: пояснение. Ещё текст».
// Имя ветки, ссылки на план и код в заголовок не идут: их читает не разработчик.
function applyHeader(group, paragraph) {
    group.header = paragraph;
    let text = paragraph;
    if (/^Ветк[аи]\s/.test(text)) {
        const stripped = stripCode(text);
        const dash = stripped.search(/\s[—–]\s/);
        text = dash >= 0 ? stripped.slice(dash).replace(/^\s[—–]\s/, '') : '';
    } else {
        text = stripCode(text);
    }

    text = squeeze(text.replace(/\s*\((?:план|см\.)[^)]*\)/gi, ''))
        .replace(/\s+([,.:;!?])/g, '$1');
    if (!text) {
        return;
    }

    const colon = text.indexOf(': ');
    const stop = sentenceEnd(text);
    if (colon >= 0 && (stop < 0 || colon < stop)) {
        group.title = capitalize(text.slice(0, colon));
        const rest = text.slice(colon + 2);
        const end = sentenceEnd(rest);
        group.subtitle = capitalize(end >= 0 ? rest.slice(0, end + 1) : rest);
    } else {
        group.title = capitalize(stop >= 0 ? text.slice(0, stop) : text.replace(/\.$/, ''));
        group.subtitle = '';
    }
    group.title = group.title.replace(/[.;,]+$/, '');
}

function sentenceEnd(text) {
    const m = /[.!?](?=\s|$)/.exec(text);
    return m ? m.index : -1;
}

function finish(doc) {
    const used = new Map();
    for (const day of doc.days) {
        day.groups = day.groups.filter(g => g.sections.some(s => s.items.length));
        for (const group of day.groups) {
            group.sections = group.sections.filter(s => s.items.length);
            if (!group.title) {
                const first = group.sections[0].items[0];
                group.title = first.headline;
            }
            group.count = group.sections.reduce((n, s) => n + s.items.length, 0);
            group.key = hashKey(`${day.iso}|${group.title}|${group.sections.map(s => s.items[0].key).join()}`);
        }

        const base = `d-${day.iso || 'undated'}`;
        const seen = used.get(base) || 0;
        used.set(base, seen + 1);
        day.id = seen ? `${base}-${seen + 1}` : base;
    }
    doc.days = doc.days.filter(d => d.groups.length);
}

// Короткая строка для обзора: жирное начало без точки или первое предложение.
function headline(text) {
    const flat = plain(text);
    const end = sentenceEnd(flat);
    let line = end >= 0 ? flat.slice(0, end) : flat;
    line = line.replace(/[.:;,—–\s]+$/, '');
    if (line.length > 90) {
        line = line.slice(0, 88).replace(/\s+\S*$/, '') + '…';
    }
    return capitalize(line);
}

export function stats(doc) {
    const result = { days: doc.days.length, groups: 0, items: 0, added: 0, changed: 0, fixed: 0, first: '', last: '' };
    for (const day of doc.days) {
        result.groups += day.groups.length;
        for (const group of day.groups) {
            for (const section of group.sections) {
                result.items += section.items.length;
                if (section.kind in result) {
                    result[section.kind] += section.items.length;
                }
            }
        }
        if (day.iso) {
            if (!result.last || day.iso > result.last) {
                result.last = day.iso;
            }
            if (!result.first || day.iso < result.first) {
                result.first = day.iso;
            }
        }
    }
    return result;
}

// Строка Markdown в HTML: экранирование, `код` и **жирное**. Больше в журнале ничего не бывает.
export function inlineHtml(text) {
    return String(text)
        .split(/(`[^`]*`)/)
        .map(part => {
            if (part.length > 1 && part.startsWith('`') && part.endsWith('`')) {
                return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
            }
            return escapeHtml(part).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        })
        .join('');
}

export function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Текст без разметки: для поиска, заголовков и подписей.
export function plain(text) {
    return String(text).replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]*)`/g, '$1');
}

export function searchable(text) {
    return plain(text).toLowerCase().replace(/ё/g, 'е');
}

export function plural(n, one, few, many) {
    const m10 = Math.abs(n) % 10;
    const m100 = Math.abs(n) % 100;
    if (m10 === 1 && m100 !== 11) {
        return one;
    }
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) {
        return few;
    }
    return many;
}

export function monthGenitive(index) {
    return MONTHS[index];
}

function stripCode(text) {
    return text.replace(/`[^`]*`/g, '');
}

function squeeze(text) {
    return String(text).replace(/\s+/g, ' ').trim();
}

function capitalize(text) {
    const t = String(text).trim();
    return t ? t[0].toUpperCase() + t.slice(1) : t;
}

// FNV-1a: короткий устойчивый ключ пункта, по нему лента помнит, что читатель уже видел.
export function hashKey(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
}
