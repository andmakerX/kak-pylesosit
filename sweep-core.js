// Закон мини-игры «Минутка уборки» без экрана: мусор, тяга к насадке, засасывание, комбо,
// штраф и время. Рисует и слушает палец views/sweep.js, проверяет Tools/news/app.test.js.
// Цены — как в игре: пыль 1, крошка 2, комок 3, носок 4, монета 15, кольцо 25, телефон
// заказчика −40. Быстрые засасывания подряд дают комбо до ×3 — то самое комбо из концепта,
// которого в игре ещё нет.

export const DURATION = 30;
export const COMBO_WINDOW = 0.55;
export const MAX_ITEMS = 120;
// Верхняя полоса под счёт и время: мусор там не появляется.
export const TOP = 90;

export const KINDS = {
    dust: { value: 1, radius: 3.2, mass: 0.6 },
    crumb: { value: 2, radius: 4.2, mass: 0.8 },
    paper: { value: 3, radius: 6.5, mass: 1 },
    sock: { value: 4, radius: 7.5, mass: 1.2 },
    coin: { value: 15, radius: 7.5, mass: 1, life: 6 },
    ring: { value: 25, radius: 7, mass: 1, life: 5 },
    phone: { value: -40, radius: 10, mass: 2.4, life: 5.5 },
};

// Пороги подобраны прогоном партий с искусственным пальцем: змейка по экрану набирает 400–750,
// охота за ближайшим мусором — 600–850. Легенда — это охота без штрафов и с комбо.
export const RANKS = [
    [0, 'Стажёр химчистки'],
    [250, 'Уверенный клинер'],
    [500, 'Гроза крошек'],
    [750, 'Профессионал с невинным видом'],
    [950, 'Легенда турбо'],
];

export function rankFor(score) {
    let title = RANKS[0][1];
    for (const [min, name] of RANKS) {
        if (score >= min) {
            title = name;
        }
    }
    return title;
}

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Радиус тяги — четверть короткой стороны экрана, но не меньше 70 точек.
export function reachFor(width, height) {
    return Math.max(70, Math.min(width, height) * 0.24);
}

export function createGame({ width, height, random = Math.random }) {
    const game = {
        width,
        height,
        running: false,
        over: false,
        time: DURATION,
        clock: 0,
        score: 0,
        combo: 0,
        lastPickup: -10,
        items: [],
        spawnDebris: 0,
        spawnCoin: 2.5,
        spawnPhone: 4,
        ringsLeft: 2,
    };

    function spawn(kind, x, y) {
        const spec = KINDS[kind];
        const margin = 24;
        game.items.push({
            kind,
            x: x ?? margin + random() * (game.width - margin * 2),
            y: y ?? TOP + random() * (game.height - TOP - margin),
            vx: 0,
            vy: 0,
            r: spec.radius * (0.85 + random() * 0.3),
            angle: random() * Math.PI * 2,
            spin: 0,
            age: 0,
            life: spec.life || 0,
        });
    }

    // Мелочь ложится кучками, как в игре: одним проходом насадки собирается горсть.
    function spawnHeap(count) {
        const cx = 30 + random() * (game.width - 60);
        const cy = TOP + 20 + random() * (game.height - TOP - 60);
        for (let i = 0; i < count; i++) {
            const a = random() * Math.PI * 2;
            const d = random() * 38;
            const roll = random();
            const kind = roll < 0.45 ? 'dust' : roll < 0.8 ? 'crumb' : roll < 0.94 ? 'paper' : 'sock';
            spawn(kind, clamp(cx + Math.cos(a) * d, 12, game.width - 12), clamp(cy + Math.sin(a) * d, TOP + 6, game.height - 12));
        }
    }

    game.reset = () => {
        Object.assign(game, {
            running: false, over: false, time: DURATION, clock: 0, score: 0, combo: 0, lastPickup: -10,
            items: [], spawnDebris: 0, spawnCoin: 2.5, spawnPhone: 4, ringsLeft: 2,
        });
        for (let i = 0; i < 9; i++) {
            spawnHeap(7 + Math.floor(random() * 5));
        }
    };

    game.start = () => {
        game.reset();
        game.running = true;
    };

    game.resize = (w, h) => {
        game.width = w;
        game.height = h;
    };

    game.multiplier = () => Math.min(3, 1 + Math.floor(game.combo / 8));

    function collect(item, events) {
        const spec = KINDS[item.kind];
        if (spec.value < 0) {
            game.score = Math.max(0, game.score + spec.value);
            game.combo = 0;
            events.push({ type: 'penalty', item, value: spec.value });
            return;
        }
        game.combo = game.clock - game.lastPickup < COMBO_WINDOW ? game.combo + 1 : 1;
        game.lastPickup = game.clock;
        const gained = spec.value * game.multiplier();
        game.score += gained;
        events.push({ type: 'pickup', item, value: gained, valuable: spec.value >= 15, multiplier: game.multiplier() });
    }

    // Шаг игры. pointer — { x, y, down }: насадка тянет, только пока палец на экране.
    // Возвращает события шага: pickup, penalty и finish.
    game.step = (dt, pointer) => {
        const events = [];
        game.clock += dt;
        if (game.running) {
            game.time = Math.max(0, game.time - dt);
            game.spawnDebris -= dt;
            if (game.spawnDebris <= 0 && game.items.length < MAX_ITEMS) {
                spawnHeap(3 + Math.floor(random() * 4));
                game.spawnDebris = 0.9 + random() * 0.6;
            }
            game.spawnCoin -= dt;
            if (game.spawnCoin <= 0) {
                spawn('coin');
                game.spawnCoin = 3.5 + random() * 2.5;
            }
            game.spawnPhone -= dt;
            if (game.spawnPhone <= 0) {
                spawn('phone');
                game.spawnPhone = 4 + random() * 3;
            }
            if (game.ringsLeft > 0 && game.time < DURATION * (game.ringsLeft === 2 ? 0.7 : 0.3)) {
                game.ringsLeft--;
                spawn('ring');
            }
        }

        const reach = reachFor(game.width, game.height);
        const sucking = game.running && pointer && pointer.down;
        for (let i = game.items.length - 1; i >= 0; i--) {
            const item = game.items[i];
            const spec = KINDS[item.kind];
            item.age += dt;
            const near = sucking && Math.hypot(pointer.x - item.x, pointer.y - item.y) < reach;
            // Монета, кольцо и телефон лежат недолго; пойманное тягой уже не пропадёт.
            if (item.life && item.age > item.life && !near) {
                game.items.splice(i, 1);
                continue;
            }
            if (sucking) {
                const dx = pointer.x - item.x;
                const dy = pointer.y - item.y;
                const d = Math.hypot(dx, dy);
                if (d < 12 + item.r) {
                    game.items.splice(i, 1);
                    collect(item, events);
                    continue;
                }
                if (d < reach) {
                    const pull = (1 - d / reach) * 2600 / spec.mass;
                    item.vx += (dx / d) * pull * dt;
                    item.vy += (dy / d) * pull * dt;
                    // Лёгкий закрут: мусор входит в трубу по спирали, а не по линейке.
                    item.vx += (-dy / d) * pull * 0.18 * dt;
                    item.vy += (dx / d) * pull * 0.18 * dt;
                    item.spin += dt * 14;
                }
            }
            const drag = Math.exp(-dt * (sucking ? 3.2 : 6));
            item.vx *= drag;
            item.vy *= drag;
            item.x += item.vx * dt;
            item.y += item.vy * dt;
            item.angle += item.spin * dt;
            item.spin *= Math.exp(-dt * 3);
        }

        if (game.running && game.time <= 0) {
            game.running = false;
            game.over = true;
            events.push({ type: 'finish', score: game.score });
        }
        return events;
    };

    game.reset();
    return game;
}
