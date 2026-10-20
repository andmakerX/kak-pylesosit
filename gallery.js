import { escapeHtml } from './parse.js';

export function galleryHtml(images) {
    if (!images.length) return '';
    return `<section class="post-gallery" aria-label="Фотографии обновления">
        <p class="gallery-hint">${images.length} фото · откройте и листайте</p>
        <div class="gallery-strip">${images.map((image, index) => `
            <figure>
                <a href="${escapeHtml(image.src)}" data-photo="${index}" aria-label="Открыть фото: ${escapeHtml(image.alt)}">
                    <img src="${escapeHtml(image.src)}" alt="${escapeHtml(image.alt)}" width="1400" height="1400" loading="lazy" decoding="async">
                </a>
                <figcaption>${escapeHtml(image.alt)}</figcaption>
            </figure>`).join('')}</div>
    </section>`;
}

export function initGallery(root) {
    const dialog = document.createElement('dialog');
    dialog.className = 'photo-viewer';
    dialog.setAttribute('aria-label', 'Фотографии обновления');
    dialog.innerHTML = `
        <div class="photo-toolbar">
            <span data-photo-count aria-live="polite"></span>
            <button type="button" data-photo-zoom aria-pressed="false">Увеличить</button>
            <button type="button" data-photo-close aria-label="Закрыть фотографии">Закрыть ×</button>
        </div>
        <div class="photo-stage"><img data-photo-image alt=""></div>
        <div class="photo-footer">
            <button type="button" data-photo-prev aria-label="Предыдущее фото">←</button>
            <p data-photo-caption aria-live="polite"></p>
            <button type="button" data-photo-next aria-label="Следующее фото">→</button>
        </div>
        <div class="photo-thumbs" aria-label="Выбор фотографии"></div>`;
    document.body.append(dialog);
    const find = selector => dialog.querySelector(selector);
    const stage = find('.photo-stage');
    const image = find('[data-photo-image]');
    const zoom = find('[data-photo-zoom]');
    const thumbs = find('.photo-thumbs');
    let photos = [];
    let index = 0;
    let enlarged = false;
    let previousOverflow = '';
    let opener = null;

    function setZoom(value) {
        enlarged = value;
        stage.classList.toggle('is-zoomed', value);
        zoom.setAttribute('aria-pressed', String(value));
        zoom.textContent = value ? 'Весь кадр' : 'Увеличить';
        stage.scrollTo(value ? (stage.scrollWidth - stage.clientWidth) / 2 : 0,
            value ? (stage.scrollHeight - stage.clientHeight) / 2 : 0);
    }

    function show(next) {
        index = (next + photos.length) % photos.length;
        setZoom(false);
        image.src = photos[index].src;
        image.alt = photos[index].alt;
        find('[data-photo-count]').textContent = `${index + 1} / ${photos.length}`;
        find('[data-photo-caption]').textContent = photos[index].alt;
        for (const [i, button] of [...thumbs.children].entries())
            button.setAttribute('aria-current', String(i === index));
        thumbs.children[index]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    root.addEventListener('click', event => {
        const link = event.target.closest('a[data-photo]');
        if (!link) return;
        event.preventDefault();
        opener = link;
        photos = [...link.closest('.post-gallery').querySelectorAll('a[data-photo]')]
            .map(item => ({ src: item.getAttribute('href'), alt: item.querySelector('img').alt }));
        thumbs.replaceChildren(...photos.map((photo, i) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.setAttribute('aria-label', `Фото ${i + 1}: ${photo.alt}`);
            const thumb = document.createElement('img');
            thumb.src = photo.src;
            thumb.alt = '';
            button.append(thumb);
            button.addEventListener('click', () => show(i));
            return button;
        }));
        previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        dialog.showModal();
        show(Number(link.dataset.photo));
    });

    find('[data-photo-close]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
        document.body.style.overflow = previousOverflow;
        opener?.focus({ preventScroll: true });
    });
    find('[data-photo-prev]').addEventListener('click', () => show(index - 1));
    find('[data-photo-next]').addEventListener('click', () => show(index + 1));
    zoom.addEventListener('click', () => setZoom(!enlarged));
    image.addEventListener('dblclick', () => setZoom(!enlarged));
    dialog.addEventListener('keydown', event => {
        if (enlarged) return;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            show(index + (event.key === 'ArrowRight' ? 1 : -1));
        }
    });
    let start = null;
    stage.addEventListener('touchstart', event => {
        start = !enlarged && event.touches.length === 1
            ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
    }, { passive: true });
    stage.addEventListener('touchend', event => {
        if (!start || enlarged) return;
        const end = event.changedTouches[0];
        const dx = end.clientX - start.x;
        const dy = end.clientY - start.y;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5)
            show(index + (dx < 0 ? 1 : -1));
        start = null;
    }, { passive: true });
    stage.addEventListener('touchcancel', () => { start = null; }, { passive: true });
}
