'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let state = {
  page:    1,
  perPage: 20,
  type:    '',
  feeder:  '',
  tag:     'cinema',
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
            <button class="btn-card-copy"
               onclick="event.stopPropagation(); copyLink(event, '${esc(item.url)}')"
               title="Copier le lien">⎘</button>
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
    player.on('volumechange', () => {
      sessionStorage.setItem('plyr-volume', player.volume);
      sessionStorage.setItem('plyr-muted',  player.muted);
    });
  }

  // Restaure le volume de la session
  const savedVolume = sessionStorage.getItem('plyr-volume');
  const savedMuted  = sessionStorage.getItem('plyr-muted');
  if (savedVolume !== null) {
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

function openMedia(id, type, url, name, tag = '') {
  _currentMediaUrl = url;
  _currentMediaId  = id;
  _currentMediaTag = tag;
  if (type === 'video') {
    document.getElementById('video-name').textContent = name;
    const dl = document.getElementById('video-dl');
    dl.href = url; dl.download = name;
    updateOverlayTagBar(tag);
    document.getElementById('video-overlay').classList.add('open');
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => vpInit(url));
    loadMemossHistory(id);
  } else {
    document.getElementById('modal-img').src = url;
    document.getElementById('image-name').textContent = name;
    const dl = document.getElementById('image-dl');
    dl.href = url; dl.download = name;
    document.getElementById('image-overlay').classList.add('open');
    document.body.style.overflow = 'hidden';
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
  // Reset crop
  const panel = document.querySelector('.video-panel');
  if (panel) panel.classList.remove('crop-open');
  document.getElementById('crop-top').value    = 0;
  document.getElementById('crop-bottom').value = 0;
  updateCropPreview();
  // Reset history
  document.getElementById('memoss-history').innerHTML = '';
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

  let apiKey = localStorage.getItem('memoss-api-key');
  if (!apiKey) {
    apiKey = prompt('Clé API :');
    if (!apiKey) return;
    localStorage.setItem('memoss-api-key', apiKey);
  }

  const r = await fetch(`/api/media/${id}`, {
    method: 'DELETE',
    headers: { 'x-api-key': apiKey },
  });

  if (r.status === 401) {
    localStorage.removeItem('memoss-api-key');
    alert('Clé API invalide.');
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
async function loadMemossHistory(uuid) {
  const el = document.getElementById('memoss-history');
  if (!el) return;
  el.innerHTML = '';

  try {
    const data = await fetch(`/game/api/history/${uuid}`).then(r => r.json());
    if (!Array.isArray(data) || data.length === 0) return;

    el.innerHTML = `
      <div class="memoss-history-title">
        💬 Légendes Memoss
        <a class="game-link" href="/game/">Jouer →</a>
      </div>
      <div class="memoss-caption-list">
        ${data.map(c => {
          const score = Math.round(c.avg);
          const hue = Math.round(score * 1.2); // 0→rouge, 100→vert
          return `
          <div class="memoss-caption">
            <div class="memoss-caption-text">${esc(c.text)}</div>
            <div class="memoss-caption-meta">
              <span>${esc(c.pseudo)}</span>
              <span class="memoss-caption-score">
                <span class="memoss-score-bar"><span class="memoss-score-fill" style="width:${score}%;background:hsl(${hue},80%,55%)"></span></span>
                <span class="memoss-score-num" style="color:hsl(${hue},80%,65%)">${score}<span class="memoss-score-denom">/100</span></span>
              </span>
              <span style="margin-left:auto;color:var(--text-muted);font-size:0.75rem">${c.vote_count} vote${c.vote_count > 1 ? 's' : ''}</span>
            </div>
          </div>`;
        }).join('')}
      </div>`;
  } catch (_) {}
}

// ── Admin mode ────────────────────────────────────────────────────────────────
function isAdmin() {
  return !!localStorage.getItem('memoss-api-key');
}

function applyAdminUI() {
  document.body.classList.toggle('admin-mode', isAdmin());
  const btn = document.getElementById('admin-btn');
  if (btn) {
    btn.classList.toggle('admin-mode-on', isAdmin());
    btn.title = isAdmin() ? 'Déconnecter le mode admin' : 'Connexion admin';
  }
}

function toggleAdminModal() {
  if (isAdmin()) {
    // Déconnexion directe
    localStorage.removeItem('memoss-api-key');
    applyAdminUI();
    loadMedia();
    return;
  }
  const modal = document.getElementById('admin-modal');
  modal.style.display = 'flex';
  document.getElementById('admin-password-input').value = '';
  document.getElementById('admin-modal-error').textContent = '';
  setTimeout(() => document.getElementById('admin-password-input').focus(), 50);
}

function closeAdminModal() {
  document.getElementById('admin-modal').style.display = 'none';
}

async function submitAdminLogin() {
  const password = document.getElementById('admin-password-input').value;
  const errEl    = document.getElementById('admin-modal-error');
  errEl.textContent = '';
  try {
    const r = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (r.ok) {
      localStorage.setItem('memoss-api-key', password);
      closeAdminModal();
      applyAdminUI();
      loadMedia();
    } else {
      errEl.textContent = 'Mot de passe incorrect.';
      document.getElementById('admin-password-input').select();
    }
  } catch (_) {
    errEl.textContent = 'Erreur réseau.';
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
(async () => {
  applyAdminUI();
  await Promise.all([refreshStorage(), refreshFeeders(), loadMedia()]);
  // Refresh storage every 30 seconds
  setInterval(refreshStorage, 30_000);
})();
