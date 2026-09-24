// Мини-игра «Минутка уборки» на экране: холст, палец (или зажатая мышь) — насадка пылесоса,
// звук, вспышки очков и окна «Поехали» и итога. Закон игры — sweep-core.js.

import { store, buzz, share, reducedMotion } from '../shared.js';
import { DURATION, createGame, rankFor, reachFor } from '../sweep-core.js';

export { rankFor };

const BEST_KEY = 'news.sweepBest';
const MUTE_KEY = 'news.sweepMute';

const COLORS = {
    dust: '#9aa1ac',
    crumb: '#d8a15f',
    paper: '#f4f1ea',
    sock: '#e0523f',
    coin: '#f5b82e',
    ring: '#ffd66b',
    phone: '#2a2e36',
};

// Скруглённый прямоугольник холста есть в Safari с 16-й версии; раньше — просто прямоугольник.
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function roundRect(x, y, w, h) {
        this.rect(x, y, w, h);
    };
}

export function sweepBest() {
    return store.get(BEST_KEY, 0);
}

// ---------- Звук ----------

let audio = null;

function sound(kind) {
    if (store.get(MUTE_KEY, false)) {
        return;
    }
    try {
        audio = audio || new (window.AudioContext || window.webkitAudioContext)();
        const now = audio.currentTime;
        const gain = audio.createGain();
        const osc = audio.createOscillator();
        gain.connect(audio.destination);
        osc.connect(gain);
        const [type, from, to, length, volume] = {
            pop: ['triangle', 520 + Math.random() * 180, 900, 0.05, 0.06],
            combo: ['triangle', 700, 1300, 0.07, 0.08],
            coin: ['square', 988, 1319, 0.12, 0.05],
            bad: ['sawtooth', 180, 90, 0.35, 0.07],
            end: ['triangle', 523, 1047, 0.5, 0.08],
        }[kind];
        osc.type = type;
        osc.frequency.setValueAtTime(from, now);
        osc.frequency.exponentialRampToValueAtTime(to, now + length);
        gain.gain.setValueAtTime(volume, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + length);
        osc.start(now);
        osc.stop(now + length + 0.02);
    } catch {
        // Звука нет — игра и так идёт.
    }
}

// ---------- Игра ----------

export function openSweep({ onClose } = {}) {
    const root = document.createElement('div');
    root.className = 'sweep';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Минутка уборки');
    root.innerHTML = `
        <canvas class="sweep-canvas"></canvas>
        <div class="sweep-hud">
            <div class="sweep-score"><b data-score>0</b><small data-combo></small></div>
            <div class="sweep-time" data-time>${DURATION}</div>
            <button class="sweep-icon" type="button" data-mute aria-label="Звук"></button>
            <button class="sweep-icon" type="button" data-close aria-label="Закрыть">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
            </button>
        </div>
        <div class="sweep-panel" data-intro>
            <h2>Минутка уборки</h2>
            <p>Водите пальцем по экрану — мусор полетит в насадку. Золото — дорого, телефон заказчика — штраф. Засасывайте быстро подряд: комбо до ×3.</p>
            <button class="slab-button accent" type="button" data-go>Поехали!</button>
        </div>
        <div class="sweep-panel" data-end hidden></div>`;
    document.body.append(root);
    document.body.classList.add('sweep-open');

    const canvas = root.querySelector('canvas');
    const g = canvas.getContext('2d');
    const $ = sel => root.querySelector(sel);
    const muteButton = $('[data-mute]');
    const game = createGame({ width: root.clientWidth, height: root.clientHeight });
    const pointer = { x: 0, y: 0, down: false, seen: false };
    const fx = { pops: [], sparks: [] };
    const view = { dpr: 1, floor: null, raf: 0, last: 0 };

    function renderMute() {
        const muted = store.get(MUTE_KEY, false);
        muteButton.innerHTML = muted
            ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/></svg>'
            : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/></svg>';
        muteButton.setAttribute('aria-pressed', String(muted));
    }
    renderMute();

    function resize() {
        view.dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = root.clientWidth;
        const h = root.clientHeight;
        game.resize(w, h);
        canvas.width = Math.round(w * view.dpr);
        canvas.height = Math.round(h * view.dpr);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        view.floor = paintFloor(w, h, view.dpr);
    }

    // Паркет рисуется один раз: доски со сдвигом и лёгким разбросом тона.
    function paintFloor(w, h, dpr) {
        const floor = document.createElement('canvas');
        floor.width = Math.round(w * dpr);
        floor.height = Math.round(h * dpr);
        const f = floor.getContext('2d');
        f.scale(dpr, dpr);
        const plank = 26;
        for (let y = 0, row = 0; y < h; y += plank, row++) {
            let x = -((row * 53) % 140);
            while (x < w) {
                const length = 110 + ((row * 31 + x) % 70);
                const tone = 38 + ((row * 7 + Math.floor(x / 13)) % 6) * 2;
                f.fillStyle = `rgb(${tone + 38}, ${tone + 22}, ${tone + 8})`;
                f.fillRect(x, y, length - 1.5, plank - 1.5);
                x += length;
            }
        }
        const shade = f.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.75);
        shade.addColorStop(0, 'rgba(0,0,0,0)');
        shade.addColorStop(1, 'rgba(0,0,0,0.45)');
        f.fillStyle = shade;
        f.fillRect(0, 0, w, h);
        return floor;
    }

    function updateHud() {
        $('[data-score]').textContent = String(game.score);
        const m = game.multiplier();
        $('[data-combo]').textContent = game.running && m > 1 ? `комбо ×${m}` : '';
        const time = $('[data-time]');
        time.textContent = String(Math.ceil(game.time));
        time.classList.toggle('late', game.running && game.time <= 5);
    }

    function react(events) {
        for (const event of events) {
            if (event.type === 'penalty') {
                fx.pops.push({ x: event.item.x, y: event.item.y, text: `${event.value}`, color: '#ff5a4f', age: 0, big: true });
                sound('bad');
                buzz([30, 40, 30]);
                root.classList.remove('shake');
                void root.offsetWidth;
                root.classList.add('shake');
            } else if (event.type === 'pickup') {
                const color = event.valuable ? '#ffd35c' : COLORS[event.item.kind];
                fx.pops.push({ x: event.item.x, y: event.item.y, text: `+${event.value}`, color: event.valuable ? '#ffd35c' : '#ffffff', age: 0, big: event.valuable });
                for (let i = 0; i < (event.valuable ? 14 : 4); i++) {
                    const a = Math.random() * Math.PI * 2;
                    const s = 40 + Math.random() * 120;
                    fx.sparks.push({ x: event.item.x, y: event.item.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, age: 0, color });
                }
                if (event.valuable) {
                    sound('coin');
                    buzz(25);
                } else {
                    sound(event.multiplier > 1 ? 'combo' : 'pop');
                }
            } else if (event.type === 'finish') {
                finish();
            }
        }
    }

    function stepEffects(dt) {
        for (const pop of fx.pops) {
            pop.age += dt;
        }
        fx.pops = fx.pops.filter(pop => pop.age < 0.8);
        for (const spark of fx.sparks) {
            spark.age += dt;
            spark.x += spark.vx * dt;
            spark.y += spark.vy * dt;
            spark.vx *= Math.exp(-dt * 5);
            spark.vy *= Math.exp(-dt * 5);
        }
        fx.sparks = fx.sparks.filter(spark => spark.age < 0.45);
    }

    function draw() {
        const w = game.width;
        const h = game.height;
        g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
        g.drawImage(view.floor, 0, 0, w, h);

        if (game.running && pointer.down) {
            const reach = reachFor(w, h);
            const glow = g.createRadialGradient(pointer.x, pointer.y, 4, pointer.x, pointer.y, reach);
            glow.addColorStop(0, 'rgba(250,128,31,0.35)');
            glow.addColorStop(1, 'rgba(250,128,31,0)');
            g.fillStyle = glow;
            g.beginPath();
            g.arc(pointer.x, pointer.y, reach, 0, Math.PI * 2);
            g.fill();
        }

        for (const item of game.items) {
            drawItem(item);
        }

        for (const spark of fx.sparks) {
            g.globalAlpha = 1 - spark.age / 0.45;
            g.fillStyle = spark.color;
            g.fillRect(spark.x - 1.5, spark.y - 1.5, 3, 3);
        }
        g.globalAlpha = 1;

        if (pointer.seen) {
            drawNozzle(pointer.x, pointer.y, game.running && pointer.down);
        }

        g.textAlign = 'center';
        for (const pop of fx.pops) {
            const t = pop.age / 0.8;
            g.globalAlpha = 1 - t * t;
            g.font = `800 ${pop.big ? 22 : 15}px Unbounded, system-ui, sans-serif`;
            g.lineWidth = 4;
            g.strokeStyle = 'rgba(18,15,18,0.8)';
            g.strokeText(pop.text, pop.x, pop.y - 18 - t * 34);
            g.fillStyle = pop.color;
            g.fillText(pop.text, pop.x, pop.y - 18 - t * 34);
        }
        g.globalAlpha = 1;
    }

    function drawItem(item) {
        g.save();
        g.translate(item.x, item.y);
        g.rotate(item.angle);
        const fade = item.life ? Math.min(1, (item.life - item.age) / 0.8) : 1;
        g.globalAlpha = Math.max(0.15, fade);
        g.fillStyle = 'rgba(0,0,0,0.28)';
        g.beginPath();
        g.ellipse(1.5, 2.5, item.r, item.r * 0.8, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = COLORS[item.kind];
        switch (item.kind) {
            case 'sock':
                g.beginPath();
                g.roundRect(-item.r * 0.45, -item.r, item.r * 0.9, item.r * 1.5, 2.5);
                g.roundRect(-item.r * 0.45, item.r * 0.2, item.r * 1.3, item.r * 0.8, 3);
                g.fill();
                g.fillStyle = '#f7f2e6';
                g.fillRect(-item.r * 0.45, -item.r, item.r * 0.9, item.r * 0.35);
                break;
            case 'paper':
                g.beginPath();
                for (let i = 0; i < 7; i++) {
                    const a = (i / 7) * Math.PI * 2;
                    const rr = item.r * (0.78 + ((i * 37) % 5) * 0.06);
                    g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
                }
                g.closePath();
                g.fill();
                break;
            case 'phone':
                g.beginPath();
                g.roundRect(-item.r * 0.65, -item.r, item.r * 1.3, item.r * 2, 3);
                g.fill();
                g.fillStyle = '#5b8cff';
                g.fillRect(-item.r * 0.5, -item.r * 0.8, item.r, item.r * 1.45);
                g.fillStyle = '#ff5a4f';
                g.beginPath();
                g.arc(item.r * 0.75, -item.r * 0.95, 3.5, 0, Math.PI * 2);
                g.fill();
                break;
            case 'coin':
            case 'ring': {
                const shine = 0.5 + 0.5 * Math.sin(game.clock * 8 + item.x);
                g.shadowColor = 'rgba(255, 200, 60, 0.9)';
                g.shadowBlur = reducedMotion() ? 6 : 6 + shine * 10;
                g.beginPath();
                g.arc(0, 0, item.r, 0, Math.PI * 2);
                g.fill();
                g.shadowBlur = 0;
                if (item.kind === 'ring') {
                    g.fillStyle = '#6b4a10';
                    g.beginPath();
                    g.arc(0, 0, item.r * 0.5, 0, Math.PI * 2);
                    g.fill();
                    g.fillStyle = '#bff3ff';
                    g.beginPath();
                    g.arc(0, -item.r, 2.6, 0, Math.PI * 2);
                    g.fill();
                } else {
                    g.fillStyle = 'rgba(120, 72, 8, 0.55)';
                    g.fillRect(-1, -item.r * 0.5, 2, item.r);
                }
                break;
            }
            default:
                g.beginPath();
                g.arc(0, 0, item.r, 0, Math.PI * 2);
                g.fill();
        }
        g.restore();
    }

    // Насадка: плоская щётка с бампером, над ней трубка — вид сверху, как в игре.
    function drawNozzle(x, y, on) {
        g.save();
        g.translate(x, y);
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.beginPath();
        g.roundRect(-25, -6, 52, 18, 7);
        g.fill();
        g.fillStyle = '#2a2e36';
        g.beginPath();
        g.roundRect(-26, -10, 52, 18, 7);
        g.fill();
        g.fillStyle = on ? '#fa801f' : '#9e400d';
        g.beginPath();
        g.roundRect(-22, -7, 44, 6, 3);
        g.fill();
        g.strokeStyle = '#120f12';
        g.lineWidth = 2;
        g.beginPath();
        g.roundRect(-26, -10, 52, 18, 7);
        g.stroke();
        g.fillStyle = '#f2ede0';
        g.beginPath();
        g.roundRect(-5, -34, 10, 26, 4);
        g.fill();
        g.stroke();
        g.restore();
    }

    function loop(now) {
        const dt = Math.min(0.05, (now - (view.last || now)) / 1000);
        view.last = now;
        react(game.step(dt, pointer));
        stepEffects(dt);
        updateHud();
        draw();
        view.raf = requestAnimationFrame(loop);
    }

    function start() {
        game.start();
        fx.pops = [];
        fx.sparks = [];
        $('[data-intro]').hidden = true;
        $('[data-end]').hidden = true;
        updateHud();
    }

    function finish() {
        pointer.down = false;
        const best = sweepBest();
        const record = game.score > best;
        if (record) {
            store.set(BEST_KEY, game.score);
        }
        sound('end');
        buzz([20, 60, 20]);
        const end = $('[data-end]');
        end.innerHTML = `
            <p class="sweep-kicker">${record ? 'Новый рекорд!' : `Рекорд: ${Math.max(best, game.score)}`}</p>
            <h2>${game.score} ${points(game.score)}</h2>
            <p class="sweep-rank">${rankFor(game.score)}</p>
            <div class="sweep-buttons">
                <button class="slab-button accent" type="button" data-go>Ещё раз</button>
                <button class="slab-button" type="button" data-share>Поделиться</button>
                <button class="link-button light" type="button" data-close>Закрыть</button>
            </div>`;
        end.hidden = false;
    }

    function point(event) {
        const rect = canvas.getBoundingClientRect();
        pointer.x = event.clientX - rect.left;
        pointer.y = event.clientY - rect.top;
        pointer.seen = true;
    }

    canvas.addEventListener('pointerdown', event => {
        point(event);
        pointer.down = true;
        if (canvas.setPointerCapture) {
            try {
                canvas.setPointerCapture(event.pointerId);
            } catch {
                // Искусственное касание захватить нельзя — и не нужно.
            }
        }
    });
    canvas.addEventListener('pointermove', point);
    const lift = () => {
        pointer.down = false;
    };
    canvas.addEventListener('pointerup', lift);
    canvas.addEventListener('pointercancel', lift);

    const close = () => {
        cancelAnimationFrame(view.raf);
        removeEventListener('resize', resize);
        removeEventListener('keydown', onKey);
        removeEventListener('popstate', onPop);
        document.removeEventListener('visibilitychange', onVisibility);
        root.remove();
        document.body.classList.remove('sweep-open');
        if (onClose) {
            onClose();
        }
    };
    // «Назад» на Android закрывает игру, а не уводит из приложения.
    const onPop = () => close();
    const onKey = event => {
        if (event.key === 'Escape') {
            history.back();
        }
    };
    const onVisibility = () => {
        if (document.visibilityState === 'hidden') {
            pointer.down = false;
        }
        view.last = 0;
    };

    root.addEventListener('click', event => {
        if (event.target.closest('[data-go]')) {
            start();
        } else if (event.target.closest('[data-close]')) {
            history.back();
        } else if (event.target.closest('[data-mute]')) {
            store.set(MUTE_KEY, !store.get(MUTE_KEY, false));
            renderMute();
        } else if (event.target.closest('[data-share]')) {
            share({
                title: 'Минутка уборки',
                text: `Мой счёт в «Минутке уборки»: ${game.score} ${points(game.score)} — «${rankFor(game.score)}». Побьёшь?`,
                hash: '#fun/sweep',
            });
        }
    });

    history.pushState({ sweep: true }, '');
    addEventListener('popstate', onPop);
    addEventListener('resize', resize);
    addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVisibility);

    resize();
    game.reset();
    updateHud();
    view.raf = requestAnimationFrame(loop);
    $('[data-go]').focus();
}

function points(n) {
    const m10 = n % 10;
    const m100 = n % 100;
    if (m10 === 1 && m100 !== 11) {
        return 'очко';
    }
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) {
        return 'очка';
    }
    return 'очков';
}
