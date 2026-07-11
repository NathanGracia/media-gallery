'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let state = {
  page:    1,
  perPage: 20,
  type:    '',
  feeder:  '',
  tag:     'cinema',
  total:   0,
  mosaic:  false,
};
const MOSAIC_PER_PAGE = 9999;
let mosaicLoading = false;

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
async function loadMedia(append = false) {
  const perPage = state.mosaic ? MOSAIC_PER_PAGE : state.perPage;
  const params = new URLSearchParams({
    page:     state.page,
    per_page: perPage,
  });
  if (state.type)   params.set('type',   state.type);
  if (state.feeder) params.set('feeder', state.feeder);
  if (state.tag)    params.set('tag',    state.tag);

  try {
    const r = await fetch('/api/media?' + params);
    const d = await r.json();
    state.total = d.total;

    if (state.mosaic) {
      if (append && d.items.length) appendToGrid(d.items);
      else renderGrid(d.items);
      document.getElementById('pagination').innerHTML = '';
      const totalPages = Math.ceil(d.total / perPage);
      document.getElementById('mosaic-sentinel').hidden = state.page >= totalPages;
    } else {
      renderGrid(d.items);
      renderPagination(d.total);
      document.getElementById('mosaic-sentinel').hidden = true;
    }

    document.getElementById('count-badge').textContent =
      d.total === 1 ? '1 fichier' : `${d.total} fichiers`;
  } catch (e) {
    document.getElementById('grid').innerHTML =
      '<div class="empty"><div class="empty-icon">⚠</div>' +
      '<div class="empty-title">Erreur de chargement</div>' +
      '<div class="empty-sub">Vérifiez que le serveur est bien lancé</div></div>';
  } finally {
    mosaicLoading = false;
  }
}

// ── Grid rendering ────────────────────────────────────────────────────────────
function cardHTML(item, i) {
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
        <div class="card-tag-bar admin-only" onclick="event.stopPropagation()">
          <button class="tag-opt ${tag === 'cinema' ? 'active-cinema' : ''}" data-tag="cinema"
                  onclick="setTag(event, '${esc(item.id)}', 'cinema')">Cinema</button>
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
          <a class="btn-card-dl"
             href="${mediaUrl}"
             download="${name}"
             onclick="event.stopPropagation()"
             title="Télécharger">↓</a>
          ${tag === 'todo' ? `<button class="btn-card-del btn-card-del--todo admin-only"
             onclick="event.stopPropagation(); deleteMedia('${esc(item.id)}')"
             title="Supprimer">Supprimer</button>` : ''}
        </div>
      </div>
    </div>`;
}

function fillGridRow(grid, cardCount) {
  const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
  const remainder = cardCount % cols;
  if (remainder !== 0) {
    const needed = cols - remainder;
    for (let i = 0; i < needed; i++) {
      const filler = document.createElement('div');
      filler.className = 'card-filler';
      grid.appendChild(filler);
    }
  }
}

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

  grid.innerHTML = items.map((item, i) => cardHTML(item, i)).join('');
  requestAnimationFrame(() => fillGridRow(grid, items.length));
}

function appendToGrid(items) {
  const grid = document.getElementById('grid');
  grid.querySelectorAll('.card-filler').forEach(f => f.remove());
  const offset = grid.querySelectorAll('.card').length;
  const frag = document.createDocumentFragment();
  items.forEach((item, i) => {
    const tmp = document.createElement('div');
    tmp.innerHTML = cardHTML(item, offset + i);
    frag.appendChild(tmp.firstElementChild);
  });
  grid.appendChild(frag);
  requestAnimationFrame(() => fillGridRow(grid, grid.querySelectorAll('.card').length));
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

// Écrit le réglage de volume partagé (voir cooloss/prisma/schema.prisma,
// User.volume) — même origine "same-site" que memoss.nathangracia.com, le
// cookie de session part automatiquement (voir CORS côté cooloss).
let _sharedVolumeDebounce = null;
function persistSharedVolume(v) {
  if (_sharedVolumeDebounce) clearTimeout(_sharedVolumeDebounce);
  _sharedVolumeDebounce = setTimeout(() => {
    fetch('https://cooloss.nathangracia.com/api/profile', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ volume: v }),
    }).catch(() => {});
  }, 300);
}

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
      loop: { active: true },
    });
    player.on('volumechange', () => {
      sessionStorage.setItem('plyr-volume', player.volume);
      sessionStorage.setItem('plyr-muted',  player.muted);
      // Compte connecté : le volume Plyr alimente aussi le réglage partagé
      // entre toutes les apps "-oss" (invité sans compte -> sessionStorage
      // seul, comme avant).
      if (AccountWidget.session.loggedIn && !player.muted) persistSharedVolume(player.volume);
    });
  }

  // Volume : priorité au réglage partagé du compte connecté ; repli sur
  // sessionStorage (comportement historique, pour les invités ou tant que
  // /api/whoami n'a pas encore répondu).
  const savedVolume = sessionStorage.getItem('plyr-volume');
  const savedMuted  = sessionStorage.getItem('plyr-muted');
  if (AccountWidget.session.loggedIn) {
    player.volume = AccountWidget.session.volume;
    player.muted  = false;
  } else if (savedVolume !== null) {
    player.volume = parseFloat(savedVolume);
    player.muted  = savedMuted === 'true';
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
  openMedia(el.dataset.id, el.dataset.type, el.dataset.url, el.dataset.name, el.dataset.tag);
}

function updateOverlayTagBar(tag) {
  document.querySelectorAll('#video-tag-bar .overlay-tag-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tag === tag);
    btn.dataset.active = btn.dataset.tag === tag ? '1' : '0';
  });
}

function openMedia(id, type, url, name, tag = '', highlightCaption = null) {
  _currentMediaUrl = url;
  _currentMediaId  = id;
  _currentMediaTag = tag;
  if (!window.TIMELINE_MODE) {
    const qs = highlightCaption ? `?m=${id}&l=${highlightCaption}` : `?m=${id}`;
    history.pushState({ mediaId: id }, '', '/' + qs);
  }
  if (type === 'video') {
    document.getElementById('video-name').textContent = name;
    const dl = document.getElementById('video-dl');
    dl.href = url; dl.download = name;
    updateOverlayTagBar(tag);
    document.getElementById('video-overlay').classList.add('open');
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    requestAnimationFrame(() => vpInit(url));
    loadMemossHistory(id, highlightCaption);
  } else {
    document.getElementById('modal-img').src = url;
    document.getElementById('image-name').textContent = name;
    const dl = document.getElementById('image-dl');
    dl.href = url; dl.download = name;
    document.getElementById('image-overlay').classList.add('open');
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
  }
}

// ── Crop ──────────────────────────────────────────────────────────────────────
function toggleCropBar() {
  const panel = document.querySelector('.video-panel');
  const open  = panel.classList.toggle('crop-open');
  if (!open) {
    document.getElementById('crop-top').value    = 0;
    document.getElementById('crop-bottom').value = 0;
    updateCropPreview();
  }
}

function updateCropPreview() {
  const top = Math.min(49, Math.max(0, parseInt(document.getElementById('crop-top').value)    || 0));
  const bot = Math.min(49, Math.max(0, parseInt(document.getElementById('crop-bottom').value) || 0));
  document.getElementById('crop-overlay-top').style.height = top + '%';
  document.getElementById('crop-overlay-bot').style.height = bot + '%';
}

async function cropVideo() {
  const top = Math.max(0, parseInt(document.getElementById('crop-top').value)    || 0);
  const bot = Math.max(0, parseInt(document.getElementById('crop-bottom').value) || 0);
  if (top + bot === 0) return;

  const btn = document.getElementById('btn-crop');
  btn.disabled    = true;
  btn.textContent = '…';

  try {
    const r = await fetch(
      `/api/media/${_currentMediaId}/crop?top_pct=${top}&bottom_pct=${bot}`,
      { method: 'POST' }
    );
    if (r.ok) {
      const { id: newId } = await r.json();
      btn.textContent = 'Sauvegarder';
      btn.disabled    = false;
      loadMedia(); // refresh grille en arrière-plan
      // Fetch le nouveau média et l'ouvre directement
      const meta = await fetch(`/api/media/${newId}`).then(x => x.json());
      closeOverlay();
      openMedia(meta.id, meta.type, meta.url, meta.original_name, meta.tag);
    } else {
      btn.textContent = '✗ Erreur';
      setTimeout(() => { btn.textContent = 'Sauvegarder'; btn.disabled = false; }, 2000);
    }
  } catch (_) {
    btn.textContent = '✗ Erreur';
    setTimeout(() => { btn.textContent = 'Sauvegarder'; btn.disabled = false; }, 2000);
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
  document.documentElement.style.overflow = '';
  // Reset crop (éléments absents sur la page timeline)
  const panel = document.querySelector('.video-panel');
  if (panel) panel.classList.remove('crop-open');
  const cropTop = document.getElementById('crop-top');
  const cropBot = document.getElementById('crop-bottom');
  if (cropTop) cropTop.value = 0;
  if (cropBot) cropBot.value = 0;
  if (cropTop || cropBot) updateCropPreview();
  // Reset history
  const hist = document.getElementById('memoss-history');
  if (hist) hist.innerHTML = '';
  // Clean URL (pas sur la page timeline)
  if (!window.TIMELINE_MODE) history.replaceState({}, '', '/');
}

// ── Copy link ─────────────────────────────────────────────────────────────────
let _currentMediaUrl = '';
let _currentMediaId  = '';
let _currentMediaTag = '';

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
  if (!_currentMediaId) return;
  const full = `${location.origin}/?m=${_currentMediaId}`;
  navigator.clipboard.writeText(full).then(() => {
    const btn = document.querySelector('.overlay.open .btn-copy-modal');
    if (!btn) return;
    btn.textContent = '✓ Copié !';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copier le lien'; btn.classList.remove('copied'); }, 2000);
  });
}

// ── Tag update ────────────────────────────────────────────────────────────────
async function setTagFromOverlay(tag) {
  const r = await fetch(`/api/media/${_currentMediaId}/tag?tag=${tag}`, { method: 'PATCH' });
  if (!r.ok) return;
  _currentMediaTag = tag;
  updateOverlayTagBar(tag);
  // Met aussi à jour la card dans la grille si elle est visible
  const card = document.querySelector(`.card[data-id="${_currentMediaId}"]`);
  if (card) {
    card.dataset.tag = tag;
    card.querySelectorAll('.tag-opt').forEach(btn => {
      btn.classList.toggle('active-cinema', btn.dataset.tag === 'cinema' && tag === 'cinema');
      btn.classList.toggle('active-osef',  btn.dataset.tag === 'osef'  && tag === 'osef');
      btn.classList.toggle('active-todo',  btn.dataset.tag === 'todo'  && tag === 'todo');
    });
  }
}

async function setTag(event, id, tag) {
  event.stopPropagation();
  const card = event.target.closest('.card');
  const r = await fetch(`/api/media/${id}/tag?tag=${tag}`, { method: 'PATCH' });
  if (!r.ok) return;

  // Mise à jour visuelle immédiate sans reload
  card.dataset.tag = tag;
  card.querySelectorAll('.tag-opt').forEach(btn => {
    const isActive = btn.dataset.tag === tag;
    btn.classList.toggle('active-cinema', isActive && tag === 'cinema');
    btn.classList.toggle('active-osef',  isActive && tag === 'osef');
    btn.classList.toggle('active-todo',  isActive && tag === 'todo');
  });
}

// ── Delete ────────────────────────────────────────────────────────────────────
async function deleteMedia(id) {
  if (!confirm('Supprimer ce média définitivement ?')) return;

  // Pas de clé à fournir : la session cooloss (cookie same-origin) suffit,
  // le serveur vérifie isAdmin côté /api/media/{id} lui-même.
  const r = await fetch(`/api/media/${id}`, { method: 'DELETE' });

  if (r.status === 401) {
    alert('Non autorisé — reconnecte-toi en admin.');
    return;
  }
  if (!r.ok) {
    alert('Erreur lors de la suppression.');
    return;
  }

  // Fermer l'overlay si le média supprimé est celui ouvert
  if (id === _currentMediaId) closeOverlay();
  loadMedia();
  refreshStorage();
}

async function deleteCurrentMedia() {
  return deleteMedia(_currentMediaId);
}

// ── Mosaic mode ───────────────────────────────────────────────────────────────
function toggleMosaic() {
  state.mosaic = !state.mosaic;
  state.page   = 1;
  document.getElementById('grid').classList.toggle('mosaic', state.mosaic);
  document.getElementById('mosaic-btn').classList.toggle('active', state.mosaic);
  loadMedia();
}

const _mosaicObserver = new IntersectionObserver((entries) => {
  if (!state.mosaic || mosaicLoading) return;
  if (entries[0].isIntersecting) {
    const totalPages = Math.ceil(state.total / MOSAIC_PER_PAGE);
    if (state.page < totalPages) {
      mosaicLoading = true;
      state.page++;
      loadMedia(true);
    }
  }
}, { rootMargin: '300px' });

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

// ── Memoss History ─────────────────────────────────────────────────────────────
function refreshMemossHistoryIfOpen() {
  if (_currentMediaId && document.getElementById('video-overlay')?.classList.contains('open')) {
    loadMemossHistory(_currentMediaId);
  }
}

async function loadMemossHistory(uuid, highlightId = null) {
  const el = document.getElementById('memoss-history');
  if (!el) return;
  el.innerHTML = '';
  if (!canSeeLegends()) return; // légendes réservées aux admins et habitués

  try {
    const data = await fetch(`/game/api/history/${uuid}`).then(r => r.json());
    if (!Array.isArray(data) || data.length === 0) return;

    data.sort((a, b) => b.avg - a.avg || b.vote_count - a.vote_count);

    // Highlighted caption goes to top
    if (highlightId) {
      const idx = data.findIndex(c => String(c.id) === String(highlightId));
      if (idx > 0) data.unshift(data.splice(idx, 1)[0]);
    }

    el.innerHTML = `
      <div class="memoss-history-title">
        💬 Légendes Memoss
        <a class="game-link" href="/game/">Jouer →</a>
      </div>
      <div class="memoss-caption-list">
        ${data.map(c => {
          const score = Math.round(c.avg);
          const hue = Math.round(score * 1.2);
          const hi = highlightId && String(c.id) === String(highlightId);
          return `
          <div class="memoss-caption${hi ? ' highlighted' : ''}">
            ${hi ? '<div class="memoss-caption-shared-badge">Partagé</div>' : ''}
            <div class="memoss-caption-text">${esc(c.text)}</div>
            <div class="memoss-caption-meta">
              <span>${esc(c.pseudo)}</span>
              <span class="memoss-caption-score">
                <span class="memoss-score-bar"><span class="memoss-score-fill" style="width:${score}%;background:hsl(${hue},80%,55%)"></span></span>
                <span class="memoss-score-num" style="color:hsl(${hue},80%,65%)">${score}<span class="memoss-score-denom">/100</span></span>
              </span>
              <span style="margin-left:auto;color:var(--text-muted);font-size:0.75rem">${c.vote_count} vote${c.vote_count > 1 ? 's' : ''}</span>
              <button class="btn-caption-share" onclick="shareCaption(event,'${esc(String(c.id))}')" title="Partager cette légende">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="9.5" cy="2.5" r="1.2"/><circle cx="2.5" cy="6" r="1.2"/><circle cx="9.5" cy="9.5" r="1.2"/>
                  <line x1="3.7" y1="5.35" x2="8.3" y2="3.15"/><line x1="3.7" y1="6.65" x2="8.3" y2="8.85"/>
                </svg>
              </button>
            </div>
          </div>`;
        }).join('')}
      </div>`;
  } catch (_) {}
}

let _toastTimer = null;
function showToast(msg) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<svg class="toast-icon" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="2,7 5.5,10.5 12,3.5"/></svg>${msg}`;
  document.body.appendChild(el);
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.remove(), 1950);
}

function shareCaption(event, captionId) {
  event.stopPropagation();
  const url = `${location.origin}/?m=${_currentMediaId}&l=${captionId}`;
  navigator.clipboard.writeText(url).then(() => {
    showToast('Lien copié');
    const btn = event.target.closest('button');
    const prev = btn.innerHTML;
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="2,6 5,9 10,3"/></svg>';
    btn.style.borderColor = 'rgba(74,222,128,0.4)';
    btn.style.background  = 'rgba(74,222,128,0.1)';
    setTimeout(() => { btn.innerHTML = prev; btn.style.borderColor = ''; btn.style.background = ''; }, 1500);
  });
}

// ── Admin mode (compte partagé cooloss) ─────────────────────────────────────
// Le fetch de /api/whoami et le rendu du bouton compte vivent dans
// account-widget.js (partagé avec timeline.html et game/index.html) — ici on
// se contente de le charger et de dériver l'état admin.
function isAdmin() {
  return !!AccountWidget.session.isAdmin;
}

// Rôle intermédiaire : accès à l'historique des légendes / timeline, pas aux
// actions de modération (delete/tag/crop, qui restent isAdmin uniquement).
function isHabitue() {
  return !!AccountWidget.session.isHabitue;
}

function canSeeLegends() {
  return isAdmin() || isHabitue();
}

// whoami est forcément async (le cookie est HttpOnly, le JS ne peut pas le
// lire lui-même) : les contrôles admin restent cachés (état par défaut côté
// CSS) jusqu'à ce que cette réponse arrive, pour éviter un flash de contenu
// admin visible avant vérification.
async function refreshSession() {
  await AccountWidget.load();
  AccountWidget.mount('account-widget');
  document.body.classList.toggle('admin-mode', isAdmin());
}

// ── Init ──────────────────────────────────────────────────────────────────────
(async () => {
  await refreshSession();
  if (!document.getElementById('grid')) return; // page timeline ou autre
  await Promise.all([refreshStorage(), refreshFeeders(), loadMedia()]);
  setInterval(refreshStorage, 30_000);
  const sentinel = document.getElementById('mosaic-sentinel');
  if (sentinel) _mosaicObserver.observe(sentinel);

  // Deeplink : ouvre directement un média via ?m=UUID (et ?l=ID pour highlight légende)
  const _qs       = new URLSearchParams(location.search);
  const deepId     = _qs.get('m');
  const deepCaption = _qs.get('l');
  if (deepId) {
    try {
      const meta = await fetch(`/api/media/${deepId}`).then(r => r.ok ? r.json() : null);
      if (meta) openMedia(meta.id, meta.type, meta.url, meta.original_name, meta.tag, deepCaption);
    } catch (_) {}
  }
})();

// Ferme la modal si on navigue en arrière (popstate, galerie uniquement)
window.addEventListener('popstate', () => {
  if (window.TIMELINE_MODE) return;
  if (!new URLSearchParams(location.search).get('m')) {
    document.querySelectorAll('.overlay.open').forEach(o => o.classList.remove('open'));
    if (player) { player.pause(); player.source = { type: 'video', sources: [] }; }
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
    const panel = document.querySelector('.video-panel');
    if (panel) panel.classList.remove('crop-open');
    document.getElementById('memoss-history').innerHTML = '';
  }
});
