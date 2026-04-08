'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let state = {
  page:    1,
  perPage: 20,
  type:    '',
  feeder:  '',
  tag:     '',
  total:   0,
};

// ── Utilities ─────────────────────────────────────────────────────────────────
function fmtSize(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return Math.round(bytes / 1024) + ' KB';
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Storage bar ───────────────────────────────────────────────────────────────
async function refreshStorage() {
  try {
    const r = await fetch('/api/storage');
    const d = await r.json();
    document.getElementById('storage-text').textContent =
      `${d.used_gb} GB / ${d.max_gb} GB — ${d.percent}%`;
    const bar = document.getElementById('storage-bar');
    bar.style.width = Math.min(d.percent, 100) + '%';
    bar.className = 'storage-bar' +
      (d.percent >= 90 ? ' crit' : d.percent >= d.alert_pct ? ' warn' : '');
  } catch (_) {}
}

// ── Feeders dropdown ──────────────────────────────────────────────────────────
async function refreshFeeders() {
  try {
    const r = await fetch('/api/feeders');
    const feeders = await r.json();
    const sel = document.getElementById('feeder-select');
    const current = sel.value;
    // Keep first option
    while (sel.options.length > 1) sel.remove(1);
    feeders.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
    sel.value = current;
  } catch (_) {}
}

// ── Media list ────────────────────────────────────────────────────────────────
async function loadMedia() {
  const params = new URLSearchParams({
    page:     state.page,
    per_page: state.perPage,
  });
  if (state.type)   params.set('type',   state.type);
  if (state.feeder) params.set('feeder', state.feeder);
  if (state.tag)    params.set('tag',    state.tag);

  try {
    const r = await fetch('/api/media?' + params);
    const d = await r.json();
    state.total = d.total;
    renderGrid(d.items);
    renderPagination(d.total);
    document.getElementById('count-badge').textContent =
      d.total === 1 ? '1 fichier' : `${d.total} fichiers`;
  } catch (e) {
    document.getElementById('grid').innerHTML =
      '<div class="empty"><div class="empty-icon">⚠</div>' +
      '<div class="empty-title">Erreur de chargement</div>' +
      '<div class="empty-sub">Vérifiez que le serveur est bien lancé</div></div>';
  }
}

// ── Grid rendering ────────────────────────────────────────────────────────────
function renderGrid(items) {
  const grid = document.getElementById('grid');

  if (!items.length) {
    grid.innerHTML =
      '<div class="empty">' +
      '<div class="empty-icon">📭</div>' +
      '<div class="empty-title">Aucun média</div>' +
      '<div class="empty-sub">Les fichiers uploadés par vos feeders apparaîtront ici</div>' +
      '</div>';
    return;
  }

  // Staggered entrance animation delay
  grid.innerHTML = items.map((item, i) => {
    const isVideo  = item.type === 'video';
    const thumbUrl = esc(item.thumbnail);
    const mediaUrl = esc(item.url);
    const name     = esc(item.original_name);
    const tag      = item.tag || 'todo';

    return `
      <div class="card"
           style="animation-delay:${Math.min(i * 40, 300)}ms"
           data-id="${esc(item.id)}"
           data-type="${esc(item.type)}"
           data-url="${esc(item.url)}"
           data-name="${esc(item.original_name)}"
           data-tag="${tag}"
           onclick="openMediaFromCard(this)">
        <div class="card-thumb-wrap">
          <img class="card-thumb" src="${thumbUrl}" loading="lazy" alt="${name}" onerror="this.style.opacity=0.2">
          <div class="card-play">
            <div class="play-ring">${isVideo ? '▶' : '⤢'}</div>
          </div>
          <span class="card-badge badge-${item.type}">${item.type}</span>
          <div class="card-tag-bar" onclick="event.stopPropagation()">
            <button class="tag-opt ${tag === 'react' ? 'active-react' : ''}" data-tag="react"
                    onclick="setTag(event, '${esc(item.id)}', 'react')">React</button>
            <button class="tag-opt ${tag === 'osef' ? 'active-osef' : ''}" data-tag="osef"
                    onclick="setTag(event, '${esc(item.id)}', 'osef')">Osef</button>
            <button class="tag-opt ${tag === 'todo' ? 'active-todo' : ''}" data-tag="todo"
                    onclick="setTag(event, '${esc(item.id)}', 'todo')">Todo</button>
          </div>
        </div>
        <div class="card-body">
          <div class="card-title" title="${name}">${name}</div>
          <div class="card-meta">
            <div class="card-info">
              <span>${fmtSize(item.size)}</span>
              <span>${fmtDate(item.date)} · ${esc(item.feeder)}</span>
            </div>
            <button class="btn-card-copy"
               onclick="event.stopPropagation(); copyLink(event, '${esc(item.url)}')"
               title="Copier le lien">⎘</button>
            <a class="btn-card-dl"
               href="${mediaUrl}"
               download="${name}"
               onclick="event.stopPropagation()"
               title="Télécharger">↓</a>
          </div>
        </div>
      </div>`;
  }).join('');

  // Remplir la dernière ligne pour éviter les trous
  requestAnimationFrame(() => {
    const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
    const remainder = items.length % cols;
    if (remainder !== 0) {
      const needed = cols - remainder;
      for (let i = 0; i < needed; i++) {
        const filler = document.createElement('div');
        filler.className = 'card-filler';
        grid.appendChild(filler);
      }
    }
  });
}

// ── Pagination ────────────────────────────────────────────────────────────────
function renderPagination(total) {
  const totalPages = Math.ceil(total / state.perPage);
  const pg = document.getElementById('pagination');
  if (totalPages <= 1) { pg.innerHTML = ''; return; }

  let html = '';

  // Prev
  html += `<button class="page-btn" onclick="goPage(${state.page - 1})" ${state.page <= 1 ? 'disabled' : ''}>‹</button>`;

  // Pages with ellipsis
  const range = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || Math.abs(i - state.page) <= 2) range.push(i);
    else if (range[range.length - 1] !== '…') range.push('…');
  }

  range.forEach(p => {
    if (p === '…') {
      html += `<span class="page-btn" style="cursor:default;opacity:0.4">…</span>`;
    } else {
      html += `<button class="page-btn ${p === state.page ? 'active' : ''}" onclick="goPage(${p})">${p}</button>`;
    }
  });

  // Next
  html += `<button class="page-btn" onclick="goPage(${state.page + 1})" ${state.page >= totalPages ? 'disabled' : ''}>›</button>`;

  pg.innerHTML = html;
}

function goPage(p) {
  state.page = p;
  loadMedia();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Plyr video player ─────────────────────────────────────────────────────────
let player = null;

const FOOTER_H  = 80;   // hauteur footer en px (inclut padding + border)
const MAX_VH    = 0.92; // 92vh
const MAX_VW    = 0.92; // 92vw
const MAX_PX    = 960;  // largeur max panel horizontal

function vpApplyRatio(vw, vh) {
  const wrap  = document.getElementById('vp-wrap');
  const panel = document.querySelector('.video-panel');
  const maxH  = window.innerHeight * MAX_VH - FOOTER_H;
  const maxW  = Math.min(window.innerWidth * MAX_VW, MAX_PX);
  const ratio = vw / vh;

  let w, h;
  if (ratio >= 1) {
    // Horizontal : partir de la largeur max
    w = maxW;
    h = w / ratio;
    if (h > maxH) { h = maxH; w = h * ratio; }
  } else {
    // Vertical : partir de la hauteur max
    h = maxH;
    w = h * ratio;
    if (w > maxW) { w = maxW; h = w / ratio; }
  }

  wrap.style.width  = `${Math.round(w)}px`;
  wrap.style.height = `${Math.round(h)}px`;
  if (panel) panel.style.width = `${Math.round(w)}px`;
}

function vpInit(url) {
  const wrap = document.getElementById('vp-wrap');
  // Taille par défaut 16:9 pendant le chargement
  vpApplyRatio(16, 9);

  if (!player) {
    player = new Plyr('#modal-video', {
      controls: ['play-large', 'play', 'progress', 'current-time', 'mute', 'volume', 'fullscreen'],
      autoplay: true,
      resetOnEnd: true,
    });
  }

  player.off('loadedmetadata');
  player.on('loadedmetadata', () => {
    const v = player.media;
    if (v && v.videoWidth && v.videoHeight) {
      vpApplyRatio(v.videoWidth, v.videoHeight);
    }
  });

  player.source = {
    type: 'video',
    sources: [{ src: url, type: 'video/mp4' }],
  };
  player.play().catch(() => {});
}

// ── Overlays ──────────────────────────────────────────────────────────────────
function openMediaFromCard(el) {
  openMedia(el.dataset.id, el.dataset.type, el.dataset.url, el.dataset.name);
}

function openMedia(id, type, url, name) {
  _currentMediaUrl = url;
  if (type === 'video') {
    document.getElementById('video-name').textContent = name;
    const dl = document.getElementById('video-dl');
    dl.href = url; dl.download = name;
    document.getElementById('video-overlay').classList.add('open');
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => vpInit(url));
  } else {
    document.getElementById('modal-img').src = url;
    document.getElementById('image-name').textContent = name;
    const dl = document.getElementById('image-dl');
    dl.href = url; dl.download = name;
    document.getElementById('image-overlay').classList.add('open');
    document.body.style.overflow = 'hidden';
  }
}

function closeOverlay() {
  document.querySelectorAll('.overlay.open').forEach(o => {
    o.classList.remove('open');
    const img = o.querySelector('img');
    if (img) img.src = '';
  });
  if (player) { player.pause(); player.source = { type: 'video', sources: [] }; }
  document.body.style.overflow = '';
}

// ── Copy link ─────────────────────────────────────────────────────────────────
let _currentMediaUrl = '';

function copyLink(e, url) {
  const full = location.origin + url;
  navigator.clipboard.writeText(full).then(() => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const prev = btn.textContent;
    btn.textContent = '✓';
    btn.style.color = '#4ade80';
    setTimeout(() => { btn.textContent = prev; btn.style.color = ''; }, 1500);
  });
}

function copyModalLink() {
  if (!_currentMediaUrl) return;
  const full = location.origin + _currentMediaUrl;
  navigator.clipboard.writeText(full).then(() => {
    const btn = document.querySelector('.overlay.open .btn-copy-modal');
    if (!btn) return;
    btn.textContent = '✓ Copié !';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copier le lien'; btn.classList.remove('copied'); }, 2000);
  });
}

// ── Tag update ────────────────────────────────────────────────────────────────
async function setTag(event, id, tag) {
  event.stopPropagation();
  const card = event.target.closest('.card');
  const r = await fetch(`/api/media/${id}/tag?tag=${tag}`, { method: 'PATCH' });
  if (!r.ok) return;

  // Mise à jour visuelle immédiate sans reload
  card.dataset.tag = tag;
  card.querySelectorAll('.tag-opt').forEach(btn => {
    const isActive = btn.dataset.tag === tag;
    btn.classList.toggle('active-react', isActive && tag === 'react');
    btn.classList.toggle('active-osef',  isActive && tag === 'osef');
    btn.classList.toggle('active-todo',  isActive && tag === 'todo');
  });
}

// ── Event listeners ───────────────────────────────────────────────────────────
document.getElementById('filter-tabs').addEventListener('click', e => {
  const btn = e.target.closest('.tab');
  if (!btn) return;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  state.type = btn.dataset.type;
  state.page = 1;
  loadMedia();
});

document.getElementById('tag-tabs').addEventListener('click', e => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  document.querySelectorAll('#tag-tabs .chip').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  state.tag  = btn.dataset.tag;
  state.page = 1;
  loadMedia();
});

document.getElementById('feeder-select').addEventListener('change', e => {
  state.feeder = e.target.value;
  state.page   = 1;
  loadMedia();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeOverlay();
});

// ── Init ──────────────────────────────────────────────────────────────────────
(async () => {
  await Promise.all([refreshStorage(), refreshFeeders(), loadMedia()]);
  // Refresh storage every 30 seconds
  setInterval(refreshStorage, 30_000);
})();
