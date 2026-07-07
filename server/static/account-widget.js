'use strict';

// Widget de compte partagé (cooloss), inclus par index.html, timeline.html et
// game/index.html — un seul endroit qui fetch /api/whoami et rend le
// bouton/dropdown, pour ne pas dupliquer cette logique dans app.js ET game.js.
const AccountWidget = (() => {
  const COOLOSS = 'https://cooloss.nathangracia.com';
  let session = { loggedIn: false, isAdmin: false, username: null, displayName: null, avatarFile: null };

  async function load() {
    try {
      const r = await fetch('/api/whoami');
      session = await r.json();
    } catch (_) {
      session = { loggedIn: false, isAdmin: false, username: null, displayName: null, avatarFile: null };
    }
    return session;
  }

  function name() {
    return session.displayName || session.username || '';
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Rendu dans un <div id="containerId"></div> déjà présent dans le header
  // de chaque page. Rien de spécifique à une page dans ce module — le style
  // vient de la feuille de style de la page hôte (classes .account-widget*).
  function mount(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;

    if (!session.loggedIn) {
      el.innerHTML = `<a href="${COOLOSS}/login?next=${encodeURIComponent(location.href)}" class="account-widget-login">Se connecter</a>`;
      return;
    }

    const initials = esc(name()).slice(0, 2).toUpperCase();
    const avatar = session.avatarFile
      ? `<img src="${esc(session.avatarFile)}" alt="" class="account-widget-avatar">`
      : `<span class="account-widget-avatar account-widget-avatar--fallback">${initials}</span>`;

    el.innerHTML = `
      <div class="account-widget">
        <button class="account-widget-trigger" id="account-widget-trigger" type="button">
          ${avatar}
          <span class="account-widget-name">${esc(name())}</span>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" class="account-widget-chevron">
            <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <div class="account-widget-menu" id="account-widget-menu" hidden>
          ${session.isAdmin ? '<div class="account-widget-badge">Admin</div>' : session.isHabitue ? '<div class="account-widget-badge">Habitué</div>' : ''}
          <a href="${COOLOSS}/profile/edit" target="_blank" rel="noopener noreferrer">Modifier le profil</a>
          <a href="${COOLOSS}/api/logout?next=${encodeURIComponent(location.href)}">Se déconnecter</a>
        </div>
      </div>`;

    const trigger = document.getElementById('account-widget-trigger');
    const menu = document.getElementById('account-widget-menu');
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    });
    document.addEventListener('click', (e) => {
      if (!menu.hidden && !el.contains(e.target)) menu.hidden = true;
    });
  }

  return {
    load,
    mount,
    get session() { return session; },
  };
})();
