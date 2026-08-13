'use strict';

// Navbar partagée (marque + liens), incluse par index.html, timeline.html,
// game/index.html et how-it-works.html — avant ce module, chacune la
// dupliquait en dur dans son propre HTML, avec des micro-divergences
// accumulées à chaque copie (tailles, ids de gradient SVG, style inline...).
// Un seul point de vérité ici. Voir account-widget.js pour le même principe
// appliqué au widget de compte (et pour le pattern de dropdown repris ici).
const SiteNav = (() => {
  const LINKS = [
    { id: 'game',     href: '/game',               label: 'Jouer',         primary: true },
    { id: 'gallery',  href: '/gallery',            label: 'Bibliothèque' },
    { id: 'vitrine',  label: 'Vitrine', dropdown: [
        { id: 'vitrine-public', href: '/vitrine',       label: 'Vitrine publique' },
        { id: 'vitrine-perso',  href: '/vitrine/perso', label: 'Vitrine perso' },
      ] },
    { id: 'timeline', href: '/timeline',           label: 'Légendes' },
    { id: 'howto',    href: '/how-it-works.html',  label: 'Comment ça marche' },
    { id: 'credits',  href: '/credits',            label: 'Crédits' },
  ];

  function renderItem(l, activePage) {
    if (l.dropdown) {
      const isActive = l.dropdown.some(d => d.id === activePage);
      const cls = ['nav-link', 'nav-dropdown-trigger'];
      if (isActive) cls.push('active');
      return `
        <div class="nav-dropdown">
          <button type="button" class="${cls.join(' ')}" id="nav-dd-trigger-${l.id}">
            ${l.label}
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none" class="nav-dropdown-chevron">
              <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <div class="nav-dropdown-menu" id="nav-dd-menu-${l.id}" hidden>
            ${l.dropdown.map(d => `<a href="${d.href}"${d.id === activePage ? ' class="active"' : ''}>${d.label}</a>`).join('')}
          </div>
        </div>`;
    }
    const cls = ['nav-link'];
    if (l.primary) cls.push('nav-link--primary');
    if (l.id === activePage) cls.push('active');
    return `<a href="${l.href}" class="${cls.join(' ')}">${l.label}</a>`;
  }

  function mount(containerId, activePage) {
    const el = document.getElementById(containerId);
    if (!el) return;

    const navItems = LINKS.map(l => renderItem(l, activePage));

    el.innerHTML = `
      <a class="brand" href="/">
        <svg class="brand-logo" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="2" y="2" width="13" height="13" rx="3" fill="url(#site-nav-g)" opacity="0.9"/>
          <rect x="17" y="2" width="13" height="13" rx="3" fill="url(#site-nav-g)" opacity="0.5"/>
          <rect x="2" y="17" width="13" height="13" rx="3" fill="url(#site-nav-g)" opacity="0.5"/>
          <rect x="17" y="17" width="13" height="13" rx="3" fill="url(#site-nav-g)" opacity="0.9"/>
          <defs>
            <linearGradient id="site-nav-g" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#22d3ee"/>
              <stop offset="100%" stop-color="#6366f1"/>
            </linearGradient>
          </defs>
        </svg>
        <span class="brand-name">Memoss</span>
      </a>
      <div class="nav-links">
        ${navItems[0]}
        <span class="nav-sep"></span>
        ${navItems.slice(1).join('')}
      </div>`;

    // Un seul listener document-level pour tous les dropdowns de la navbar
    // (même pattern que account-widget.js) — ferme celui qui est ouvert dès
    // qu'on clique en dehors de son trigger/menu.
    LINKS.forEach(l => {
      if (!l.dropdown) return;
      const trigger = document.getElementById(`nav-dd-trigger-${l.id}`);
      const menu    = document.getElementById(`nav-dd-menu-${l.id}`);
      if (!trigger || !menu) return;
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.hidden = !menu.hidden;
      });
      document.addEventListener('click', (e) => {
        if (!menu.hidden && !trigger.contains(e.target) && !menu.contains(e.target)) {
          menu.hidden = true;
        }
      });
    });
  }

  return { mount };
})();
