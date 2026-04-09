'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
const TOTAL_ROUNDS = 3;

const S = {
  screen:       'home',   // home|lobby|picking|waiting|revealing|round_end|game_end
  ws:           null,
  playerId:     null,
  isHost:       false,
  roomCode:     '',
  pseudo:       '',
  players:      [],
  pickRound:    0,        // round de soumission courant (1-based)
  revealRound:  0,        // round de révélation courant (1-based)
  memes:        [],       // [{uuid,url,thumb}] proposés pour ce pick round
  selectedMeme: null,
  text:         '',
  submitted:    0,
  total:        0,
  // reveal
  currentReveal: null,
  myVote:        null,
  // timer
  timerInterval: null,
  timerVal:      120,
};

const app  = document.getElementById('app');
const rcEl = document.getElementById('room-code-display');

function setRoomCode(code) {
  S.roomCode = code;
  rcEl.innerHTML = code ? `Room : <span>${code}</span>` : '';
}

// ── Render ────────────────────────────────────────────────────────────────────
function render() {
  switch (S.screen) {
    case 'home':        return renderHome();
    case 'lobby':       return renderLobby();
    case 'picking':     return renderPicking();
    case 'waiting':     return renderWaiting();
    case 'revealing':   return renderReveal();
    case 'round_end':   return renderRoundEnd();
    case 'game_end':    return renderGameEnd();
  }
}

// ── Home ──────────────────────────────────────────────────────────────────────
function renderHome() {
  app.innerHTML = `
    <div class="card">
      <div class="home-logo">
        <div class="home-logo-title">MEMOSS</div>
        <div class="home-logo-sub">Le jeu de légendes de mèmes 🎬</div>
      </div>

      <div class="field">
        <label>Ton pseudo</label>
        <input id="pseudo-input" type="text" maxlength="20" placeholder="Ex: Nathan" value="${esc(S.pseudo)}"
               autocomplete="off" spellcheck="false">
      </div>

      <button class="btn btn-primary" id="btn-create" style="margin-top:4px">Créer une partie</button>

      <div class="divider-or">ou rejoindre</div>

      <div class="code-boxes" id="code-boxes">
        ${Array.from({length:6}, () => `<input class="code-box" maxlength="1" inputmode="text" autocomplete="off" spellcheck="false">`).join('')}
      </div>

      <button class="btn btn-ghost" id="btn-join" style="width:100%">Rejoindre →</button>

      <p class="error-msg" id="home-error"></p>
    </div>`;

  document.getElementById('pseudo-input').focus();
  document.getElementById('btn-create').onclick = doCreateRoom;
  document.getElementById('btn-join').onclick   = doJoinRoom;
  initCodeBoxes();
  document.getElementById('pseudo-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') doCreateRoom();
  });
}

async function doCreateRoom() {
  const pseudo = document.getElementById('pseudo-input').value.trim();
  if (!pseudo) return setError('Renseigne un pseudo.');
  S.pseudo = pseudo;

  const btn = document.getElementById('btn-create');
  btn.disabled = true; btn.textContent = '…';

  const r = await fetch('/game/api/rooms', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ pseudo }),
  });
  if (!r.ok) { btn.disabled = false; btn.textContent = 'Créer une partie'; return setError('Erreur serveur.'); }
  const { room_code, player_id } = await r.json();
  S.playerId = player_id;
  S.isHost   = true;
  setRoomCode(room_code);
  connectWS();
}

async function doJoinRoom() {
  const pseudo = document.getElementById('pseudo-input').value.trim();
  const code   = getCodeFromBoxes();
  if (!pseudo) return setError('Renseigne un pseudo.');
  if (code.length < 6) return setError('Entre le code complet (6 caractères).');
  S.pseudo = pseudo;

  const btn = document.getElementById('btn-join');
  btn.disabled = true; btn.textContent = '…';

  const r = await fetch(`/game/api/rooms/${code}/join`, {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ pseudo }),
  });
  if (!r.ok) {
    btn.disabled = false; btn.textContent = 'Rejoindre →';
    const d = await r.json().catch(() => ({}));
    return setError(d.detail || 'Room introuvable.');
  }
  const { player_id } = await r.json();
  S.playerId = player_id;
  S.isHost   = false;
  setRoomCode(code);
  connectWS();
}

function setError(msg) {
  const el = document.getElementById('home-error');
  if (el) el.textContent = msg;
}

// ── Lobby ─────────────────────────────────────────────────────────────────────
function renderLobby() {
  const canStart = S.isHost && S.players.length >= 1;
  app.innerHTML = `
    <div class="card">
      <h2>Salle d'attente</h2>

      <div class="room-code-badge">
        <div>
          <div class="code-label">Code de la room</div>
          <div class="code-val">${esc(S.roomCode)}</div>
        </div>
        <button class="btn btn-ghost btn-sm" id="btn-copy">🔗 Inviter</button>
      </div>

      <ul class="player-list" id="player-list">
        ${S.players.map(p => `
          <li class="player-item">
            <span class="player-dot ${p.connected ? '' : 'off'}"></span>
            ${p.id === S.playerId ? `<strong>${esc(p.pseudo)}</strong>` : esc(p.pseudo)}
            ${p.id === S.players[0]?.id ? '<span class="crown">👑</span>' : ''}
            ${p.score ? `<span class="score">${p.score} pts</span>` : ''}
          </li>`).join('')}
      </ul>

      ${S.isHost
        ? `<button class="btn btn-cinema" id="btn-start" ${canStart ? '' : 'disabled'}>
             Lancer · ${S.players.length} joueur${S.players.length > 1 ? 's' : ''}
           </button>`
        : `<p style="text-align:center;color:var(--text-2);font-size:.88rem;padding:8px 0">En attente du host…</p>`}
    </div>`;

  document.getElementById('btn-copy')?.addEventListener('click', () => {
    const url = `${location.origin}/game?join=${S.roomCode}`;
    navigator.clipboard.writeText(url).then(() => {
      const btn = document.getElementById('btn-copy');
      if (btn) { btn.textContent = '✓ Copié !'; setTimeout(() => { if (btn) btn.textContent = '🔗 Inviter'; }, 2000); }
    });
  });
  if (S.isHost) {
    document.getElementById('btn-start').onclick = () => {
      S.ws?.send(JSON.stringify({ type: 'start_game' }));
    };
  }
}

// ── Picking ───────────────────────────────────────────────────────────────────
function renderPicking() {
  const pills = Array.from({length: TOTAL_ROUNDS}, (_,i) => {
    const cls = i + 1 < S.pickRound ? 'done' : i + 1 === S.pickRound ? 'active' : '';
    return `<div class="round-pill ${cls}"></div>`;
  }).join('');

  app.innerHTML = `
    <div class="card">
      <div class="round-pills">${pills}</div>
      <h2 style="text-align:center;margin-bottom:4px">Manche ${S.pickRound} / ${TOTAL_ROUNDS}</h2>
      <p class="sub" style="text-align:center;margin-bottom:16px">Choisis ton mème et écris ta légende</p>

      <div class="timer-row">
        <div class="timer-bar-wrap">
          <div class="timer-bar" id="timer-bar" style="width:${(S.timerVal/120)*100}%"></div>
        </div>
        <div class="timer-label" id="timer-label">${S.timerVal}s</div>
      </div>

      <div class="meme-pick-grid">
        ${S.memes.map((m, i) => {
          const sel = S.selectedMeme?.uuid === m.uuid;
          return `
          <div class="meme-pick-card ${sel ? 'selected' : ''}">
            <div class="meme-pick-thumb" onclick="openMemeModal(${i})">
              <img src="${esc(m.thumb)}" loading="lazy" onerror="this.style.opacity=0.2">
              <div class="meme-pick-play"><div class="meme-pick-play-icon">▶</div></div>
              ${sel ? '<div class="meme-pick-badge">✓</div>' : ''}
            </div>
            <button class="meme-pick-btn" onclick="selectMeme(${i})">
              ${sel ? '✓ Sélectionné' : 'Choisir ce mème'}
            </button>
          </div>`;
        }).join('')}
      </div>

      ${S.selectedMeme ? `
        <div class="caption-wrap">
          <span class="caption-label">Ta légende</span>
          <div class="text-area-wrap">
            <textarea id="caption-input" rows="2" maxlength="100"
              placeholder="Tape quelque chose de drôle…">${esc(S.text)}</textarea>
            <span class="char-count" id="char-count">${S.text.length}/100</span>
          </div>
        </div>
        <button class="btn btn-primary" id="btn-submit">
          ${S.pickRound < TOTAL_ROUNDS ? `Valider · Manche ${S.pickRound + 1}/${TOTAL_ROUNDS} →` : 'Valider · Lancer les votes →'}
        </button>
      ` : `
        <p style="text-align:center;color:var(--text-2);font-size:.82rem;margin-top:4px">
          Clique ▶ pour prévisualiser · Clique "Choisir" pour sélectionner
        </p>
      `}
    </div>`;

  if (S.selectedMeme) {
    let _draftTimeout = null;
    document.getElementById('caption-input').addEventListener('input', e => {
      S.text = e.target.value;
      document.getElementById('char-count').textContent = `${S.text.length}/100`;
      clearTimeout(_draftTimeout);
      _draftTimeout = setTimeout(() => {
        if (S.ws && S.ws.readyState === WebSocket.OPEN) {
          S.ws.send(JSON.stringify({ type: 'draft_answer', media_uuid: S.selectedMeme?.uuid || '', text: S.text }));
        }
      }, 500);
    });
    document.getElementById('btn-submit').onclick = doSubmit;
  }
}

function selectMeme(idx) {
  S.selectedMeme = S.memes[idx];
  if (S.ws && S.ws.readyState === WebSocket.OPEN) {
    S.ws.send(JSON.stringify({ type: 'draft_answer', media_uuid: S.selectedMeme.uuid, text: S.text }));
  }
  renderPicking();
}

// ── Meme modal (player) ───────────────────────────────────────────────────────
function openMemeModal(idx) {
  closeMemeModal();
  const meme = S.memes[idx];
  const sel  = S.selectedMeme?.uuid === meme.uuid;

  const overlay = document.createElement('div');
  overlay.id    = 'meme-modal';
  overlay.innerHTML = `
    <div class="meme-modal-backdrop" onclick="closeMemeModal()"></div>
    <div class="meme-modal-panel">
      <button class="meme-modal-close" onclick="closeMemeModal()">✕</button>
      <video class="meme-modal-video"
             src="${esc(meme.url)}"
             autoplay playsinline controls loop></video>
      <div class="meme-modal-footer">
        <button class="btn ${sel ? 'btn-cinema' : 'btn-primary'} meme-modal-select"
                onclick="selectMemeFromModal(${idx})">
          ${sel ? '✓ Déjà sélectionné' : 'Choisir ce mème'}
        </button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  // Restaure le volume sauvegardé (même clés que la galerie)
  const vid = overlay.querySelector('video');
  const savedVol   = sessionStorage.getItem('plyr-volume');
  const savedMuted = sessionStorage.getItem('plyr-muted');
  if (savedVol !== null) vid.volume = parseFloat(savedVol);
  vid.muted = savedMuted === 'true' ? true : false;
  vid.play().catch(() => { vid.muted = true; vid.play(); });

  // Sauvegarde les changements de volume
  vid.addEventListener('volumechange', () => {
    sessionStorage.setItem('plyr-volume', vid.volume);
    sessionStorage.setItem('plyr-muted',  vid.muted);
  });

  document._memeEsc = e => { if (e.key === 'Escape') closeMemeModal(); };
  document.addEventListener('keydown', document._memeEsc);
}

function closeMemeModal() {
  const m = document.getElementById('meme-modal');
  if (m) {
    const v = m.querySelector('video');
    if (v) { v.pause(); v.src = ''; }
    m.remove();
  }
  document.body.style.overflow = '';
  document.removeEventListener('keydown', document._memeEsc);
}

function selectMemeFromModal(idx) {
  selectMeme(idx);
  closeMemeModal();
}

function doSubmit() {
  if (!S.selectedMeme) return;
  S.ws?.send(JSON.stringify({
    type:       'submit_answer',
    media_uuid: S.selectedMeme.uuid,
    text:       S.text,
  }));
  S.screen = 'waiting';
  render();
}

// ── Waiting ───────────────────────────────────────────────────────────────────
function renderWaiting() {
  const dots = Array.from({length: S.total || 1}, (_,i) =>
    `<div class="pdot ${i < S.submitted ? 'done' : ''}"></div>`
  ).join('');

  app.innerHTML = `
    <div class="card waiting-card">
      <div class="waiting-emoji">✅</div>
      <div class="waiting-title">Manche ${S.pickRound}/${TOTAL_ROUNDS} soumise</div>
      <div class="waiting-sub">${S.pickRound < TOTAL_ROUNDS ? 'En attente des autres pour passer à la manche suivante…' : 'En attente des autres pour lancer les votes…'}</div>

      ${S.selectedMeme ? `
        <div class="waiting-preview">
          <img src="${esc(S.selectedMeme.thumb)}" alt="">
          <div class="waiting-caption">${esc(S.text) || '<em style="opacity:.45">Pas de légende</em>'}</div>
        </div>` : ''}

      <div class="progress-row">
        <div class="progress-dots" id="progress-dots">${dots}</div>
        <span class="progress-count" id="progress-count">${S.submitted}/${S.total || '?'} soumis</span>
      </div>
    </div>`;
}

// ── Reveal ────────────────────────────────────────────────────────────────────
function renderReveal() {
  const r = S.currentReveal;
  if (!r) return;
  const isAuthor = r.player_id === S.playerId;

  app.innerHTML = `
    <div class="card">
      <div class="reveal-header">
        <span class="reveal-badge">Manche ${S.revealRound}/${TOTAL_ROUNDS}</span>
        <span class="reveal-badge" style="background:var(--s1);color:var(--text-2);border-color:var(--b0)">
          ${r.reveal_index} / ${r.total_reveals}
        </span>
      </div>

      <video class="reveal-video" id="reveal-video" src="${esc(r.media_url)}"
             autoplay playsinline controls></video>

      <div class="reveal-caption">${esc(r.text) || '<em style="opacity:.35">— pas de légende —</em>'}</div>
      <p class="reveal-author">par <strong>${esc(r.pseudo)}</strong></p>

      <div class="vote-section">
        ${isAuthor
          ? `<div class="is-author-label">C'est ta légende ! 🎤<br><small style="opacity:.6">Les autres votent…</small></div>`
          : `<p class="vote-label">Note cette légende</p>
             <div class="vote-slider-wrap">
               <div class="vote-slider-row">
                 <span class="vote-slider-bound">0</span>
                 <input type="range" id="vote-slider" class="vote-slider"
                        min="0" max="100" value="50"
                        oninput="updateSliderDisplay(this.value)">
                 <span class="vote-slider-bound">100</span>
               </div>
               <div class="vote-slider-val" id="vote-slider-val">50</div>
             </div>
             <button class="btn btn-primary" id="btn-vote-confirm" onclick="confirmVote()">Confirmer</button>`}
      </div>
    </div>`;

  // Restaure le volume et joue
  const vid = document.getElementById('reveal-video');
  if (vid) {
    const savedVol   = sessionStorage.getItem('plyr-volume');
    const savedMuted = sessionStorage.getItem('plyr-muted');
    if (savedVol !== null) vid.volume = parseFloat(savedVol);
    vid.muted = savedMuted === 'true' ? true : false;
    vid.play().catch(() => { vid.muted = true; vid.play(); });
    vid.addEventListener('volumechange', () => {
      sessionStorage.setItem('plyr-volume', vid.volume);
      sessionStorage.setItem('plyr-muted',  vid.muted);
    });
  }
}

function updateSliderDisplay(val) {
  const el = document.getElementById('vote-slider-val');
  if (el) el.textContent = val;
}

function confirmVote() {
  const slider = document.getElementById('vote-slider');
  const val = slider ? parseInt(slider.value) : 50;
  S.ws?.send(JSON.stringify({ type: 'submit_vote', stars: val }));
  const btn = document.getElementById('btn-vote-confirm');
  if (btn) { btn.disabled = true; btn.textContent = `${val} / 100 — envoyé ✓`; }
  if (slider) slider.disabled = true;
}

// ── Round end ─────────────────────────────────────────────────────────────────
function renderRoundEnd() {
  const sorted = [...S.players].sort((a,b) => b.score - a.score);
  const isLast = S.revealRound >= TOTAL_ROUNDS;
  app.innerHTML = `
    <div class="card">
      <h2>Votes manche ${S.revealRound}/${TOTAL_ROUNDS}</h2>
      <p class="sub">Scores intermédiaires</p>
      <div class="podium">
        ${sorted.map((p,i) => `
          <div class="podium-item ${i===0?'first':i===1?'second':''}">
            <span class="podium-rank">${['🥇','🥈','🥉'][i] || `${i+1}.`}</span>
            <span class="podium-pseudo">${esc(p.pseudo)}</span>
            <span class="podium-score">${p.score} pts</span>
          </div>`).join('')}
      </div>
      <p style="text-align:center;color:var(--text-dim);font-size:0.85rem;">
        ${isLast ? 'Résultats finaux dans quelques secondes…' : `Manche de votes ${S.revealRound + 1}/${TOTAL_ROUNDS} dans quelques secondes…`}
      </p>
    </div>`;
}

// ── Game end ──────────────────────────────────────────────────────────────────
function renderGameEnd() {
  const sorted = [...S.players].sort((a,b) => b.score - a.score);
  const winner = sorted[0];
  app.innerHTML = `
    <div class="card">
      <div class="winner-banner">
        <div class="winner-trophy">🏆</div>
        <div class="winner-name">${winner ? esc(winner.pseudo) : '—'}</div>
        <div class="winner-label">${winner ? `${winner.score} pts · Champion Memoss` : 'Fin de partie'}</div>
      </div>

      <div class="podium">
        ${sorted.map((p,i) => `
          <div class="podium-item ${i===0?'first':i===1?'second':''}">
            <span class="podium-rank">${['🥇','🥈','🥉'][i] || `${i+1}`}</span>
            <span class="podium-pseudo">${esc(p.pseudo)}${p.id === S.playerId ? ' <span style="color:var(--text-3);font-weight:400">(toi)</span>' : ''}</span>
            <span class="podium-score">${p.score} pts</span>
          </div>`).join('')}
      </div>

      <p style="text-align:center;color:var(--text-2);font-size:.82rem;margin-top:8px">
        Retour au lobby dans <span id="lobby-countdown">10</span>s…
      </p>
      <button class="btn btn-ghost" onclick="location.href='/'" style="width:100%;margin-top:14px">
        ← Retour à la galerie
      </button>
    </div>`;
}

// ── WebSocket ─────────────────────────────────────────────────────────────────
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url   = `${proto}//${location.host}/game/ws/${S.roomCode}/${S.playerId}`;
  S.ws = new WebSocket(url);

  S.ws.onmessage = e => handleMsg(JSON.parse(e.data));
  S.ws.onclose   = () => {
    if (S.screen !== 'game_end') {
      app.innerHTML = `<div class="card" style="text-align:center;padding:48px">
        <p style="color:var(--red);font-size:1.1rem">Connexion perdue.</p>
        <button class="btn btn-ghost" onclick="location.reload()" style="margin-top:16px">Recharger</button>
      </div>`;
    }
  };
}

function handleMsg(msg) {
  switch (msg.type) {

    case 'ping':
      S.ws.send(JSON.stringify({ type: 'pong' }));
      return;

    case 'connected':
      S.isHost  = msg.is_host;
      S.players = msg.players;
      S.screen  = 'lobby';
      render();
      break;

    case 'room_update':
      S.players = msg.players;
      if (S.screen === 'lobby') render();
      else updatePlayerList();
      break;

    case 'round_start':
      S.pickRound    = msg.round;
      S.memes        = msg.memes;
      S.selectedMeme = null;
      S.text         = '';
      S.screen       = 'picking';
      startTimer();
      render();
      break;

    case 'reveal_phase_start':
      S.revealRound = msg.reveal_round;
      // Le reveal_meme arrive immédiatement après, pas besoin d'un écran dédié
      break;

    case 'timer_tick':
      S.timerVal = msg.remaining;
      updateTimer();
      break;

    case 'submit_progress':
      S.submitted = msg.submitted;
      S.total     = msg.total;
      if (S.screen === 'waiting') {
        const cnt = document.getElementById('progress-count');
        if (cnt) cnt.textContent = `${msg.submitted}/${msg.total} soumis`;
        const dotsEl = document.getElementById('progress-dots');
        if (dotsEl) dotsEl.innerHTML = Array.from({length: msg.total}, (_,i) =>
          `<div class="pdot ${i < msg.submitted ? 'done' : ''}"></div>`
        ).join('');
      }
      break;

    case 'reveal_meme':
      S.currentReveal = msg;
      S.revealRound   = msg.reveal_round;
      S.myVote        = null;
      S.screen        = 'revealing';
      render();
      break;

    case 'reveal_result':
      S.players = msg.players;
      // Show result overlay briefly
      showRevealResult(msg);
      break;

    case 'round_end':
      S.revealRound = msg.reveal_round;
      S.players     = msg.players;
      // Pas d'écran intermédiaire, on attend le prochain reveal_meme ou game_end
      break;

    case 'game_end':
      stopTimer();
      S.players = msg.players;
      S.screen  = 'game_end';
      render();
      startLobbyCountdown(10);
      break;

    case 'back_to_lobby':
      S.players     = msg.players;
      S.pickRound   = 0;
      S.revealRound = 0;
      S.selectedMeme = null;
      S.text        = '';
      S.screen      = 'lobby';
      stopLobbyCountdown();
      render();
      break;
  }
}

function showRevealResult(msg) {
  // Overlay on top of current reveal screen
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:500;
    display:flex;align-items:center;justify-content:center;
    background:rgba(0,0,0,0.7);backdrop-filter:blur(8px);`;

  const avg    = msg.vote_count ? Math.round(msg.total_stars / msg.vote_count) : 0;
  const emoji  = avg >= 80 ? '🔥' : avg >= 50 ? '👍' : avg >= 20 ? '😐' : '💀';
  const color  = avg >= 80 ? 'var(--green)' : avg >= 50 ? 'var(--accent)' : avg >= 20 ? 'var(--gold)' : 'var(--red)';

  overlay.innerHTML = `
    <div style="background:rgba(10,10,20,0.95);border:1px solid rgba(255,255,255,0.1);
                border-radius:18px;padding:40px;text-align:center;max-width:320px;width:90%">
      <p style="font-size:0.85rem;color:var(--text-2);margin-bottom:8px">${esc(msg.pseudo)}</p>
      <p style="font-size:3rem;margin-bottom:12px">${emoji}</p>
      <p style="font-size:2.4rem;font-weight:800;color:${color};margin-bottom:4px;font-family:'Syne',sans-serif">${avg}</p>
      <p style="font-size:0.8rem;color:var(--text-2)">sur 100 · ${msg.vote_count} vote${msg.vote_count > 1 ? 's' : ''}</p>
    </div>`;

  document.body.appendChild(overlay);
  setTimeout(() => overlay.remove(), 2800);
}

function updatePlayerList() {
  // Light refresh without full re-render
  const ul = document.getElementById('player-list');
  if (!ul) return;
  ul.innerHTML = S.players.map(p => `
    <li class="player-item">
      <span class="player-dot ${p.connected ? '' : 'off'}"></span>
      ${p.id === S.playerId ? `<strong>${esc(p.pseudo)}</strong>` : esc(p.pseudo)}
      <span class="score">${p.score ? p.score + ' pts' : ''}</span>
    </li>`).join('');
}

// ── Lobby countdown ───────────────────────────────────────────────────────────
let _lobbyCountdown = null;

function startLobbyCountdown(sec) {
  stopLobbyCountdown();
  let n = sec;
  _lobbyCountdown = setInterval(() => {
    n--;
    const el = document.getElementById('lobby-countdown');
    if (el) el.textContent = n;
    if (n <= 0) stopLobbyCountdown();
  }, 1000);
}

function stopLobbyCountdown() {
  clearInterval(_lobbyCountdown);
  _lobbyCountdown = null;
}

// ── Timer ─────────────────────────────────────────────────────────────────────
function startTimer() {
  stopTimer();
  S.timerVal = 120;
}

function stopTimer() {
  clearInterval(S.timerInterval);
  S.timerInterval = null;
}

function updateTimer() {
  const lbl = document.getElementById('timer-label');
  const bar = document.getElementById('timer-bar');
  if (!lbl || !bar) return;

  lbl.textContent = `${S.timerVal}s`;
  bar.style.width = `${(S.timerVal / 120) * 100}%`;
  bar.className   = 'timer-bar' + (S.timerVal <= 10 ? ' crit' : S.timerVal <= 20 ? ' warn' : '');
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── OTP code boxes ────────────────────────────────────────────────────────────
function initCodeBoxes(containerSelector = '#code-boxes') {
  const boxes = Array.from(document.querySelectorAll(`${containerSelector} .code-box`));
  boxes.forEach((box, i) => {
    box.addEventListener('input', e => {
      const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      e.target.value = val ? val[val.length - 1] : '';
      e.target.classList.toggle('filled', !!e.target.value);
      if (e.target.value && i < boxes.length - 1) boxes[i + 1].focus();
    });
    box.addEventListener('keydown', e => {
      if (e.key === 'Backspace' && !e.target.value && i > 0) {
        boxes[i - 1].value = '';
        boxes[i - 1].classList.remove('filled');
        boxes[i - 1].focus();
      }
      if (e.key === 'Enter') doJoinRoom();
    });
    box.addEventListener('paste', e => {
      e.preventDefault();
      const paste = (e.clipboardData.getData('text') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      paste.split('').forEach((ch, j) => {
        if (boxes[j]) { boxes[j].value = ch; boxes[j].classList.add('filled'); }
      });
      const next = Math.min(paste.length, boxes.length - 1);
      boxes[next].focus();
    });
  });
}

function getCodeFromBoxes(containerSelector = '#code-boxes') {
  return Array.from(document.querySelectorAll(`${containerSelector} .code-box`))
    .map(b => b.value).join('');
}

// ── Invite modal (lien ?join=CODE) ────────────────────────────────────────────
function showInviteModal(code) {
  const overlay = document.createElement('div');
  overlay.className = 'invite-overlay';
  overlay.id = 'invite-overlay';
  overlay.innerHTML = `
    <div class="invite-modal">
      <div class="invite-emoji">🎬</div>
      <div class="invite-code-display">${esc(code)}</div>
      <p class="invite-sub">Tu as été invité à rejoindre cette room</p>
      <div class="field">
        <label>Ton pseudo</label>
        <input id="invite-pseudo" type="text" maxlength="20" placeholder="Ex: Nathan"
               autocomplete="off" spellcheck="false" value="${esc(S.pseudo)}">
      </div>
      <button class="btn btn-cinema" id="invite-join-btn" style="width:100%;margin-top:4px">
        Rejoindre la partie →
      </button>
      <p class="error-msg" id="invite-error"></p>
      <button class="btn btn-ghost" id="invite-cancel-btn"
              style="width:100%;margin-top:8px;font-size:.8rem">
        Annuler
      </button>
    </div>`;
  document.body.appendChild(overlay);

  const pseudoInput = document.getElementById('invite-pseudo');
  pseudoInput.focus();

  async function doInviteJoin() {
    const pseudo = pseudoInput.value.trim();
    if (!pseudo) { document.getElementById('invite-error').textContent = 'Renseigne un pseudo.'; return; }
    S.pseudo = pseudo;
    const btn = document.getElementById('invite-join-btn');
    btn.disabled = true; btn.textContent = '…';
    const r = await fetch(`/game/api/rooms/${code}/join`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ pseudo }),
    });
    if (!r.ok) {
      btn.disabled = false; btn.textContent = 'Rejoindre la partie →';
      const d = await r.json().catch(() => ({}));
      document.getElementById('invite-error').textContent = d.detail || 'Room introuvable.';
      return;
    }
    const { player_id } = await r.json();
    S.playerId = player_id;
    S.isHost   = false;
    setRoomCode(code);
    overlay.remove();
    history.replaceState({}, '', '/game');
    connectWS();
  }

  document.getElementById('invite-join-btn').onclick = doInviteJoin;
  document.getElementById('invite-cancel-btn').onclick = () => {
    overlay.remove();
    history.replaceState({}, '', '/game');
  };
  pseudoInput.addEventListener('keydown', e => { if (e.key === 'Enter') doInviteJoin(); });
}

// ── Init ──────────────────────────────────────────────────────────────────────
render();

const _joinParam = new URLSearchParams(location.search).get('join');
if (_joinParam) showInviteModal(_joinParam.toUpperCase());
