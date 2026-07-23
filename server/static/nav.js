'use strict';

// Navbar partagée (marque + liens), incluse par index.html, timeline.html,
// game/index.html et how-it-works.html — avant ce module, chacune la
// dupliquait en dur dans son propre HTML, avec des micro-divergences
// accumulées à chaque copie (tailles, ids de gradient SVG, style inline...).
// Un seul point de vérité ici. Voir account-widget.js pour le même principe
// appliqué au widget de compte.
const SiteNav = (() => {
  const LINKS = [
    { id: 'game',     href: '/',                  label: 'Jouer',         primary: true },
    { id: 'gallery',  href: '/gallery',            label: 'Bibliothèque' },
    { id: 'timeline', href: '/timeline',           label: 'Légendes' },
    { id: 'howto',    href: '/how-it-works.html',  label: 'Comment ça marche' },
  ];

  function mount(containerId, activePage) {
    const el = document.getElementById(containerId);
    if (!el) return;

    const navLinks = LINKS.map(l => {
      const cls = ['nav-link'];
      if (l.primary) cls.push('nav-link--primary');
      if (l.id === activePage) cls.push('active');
      return `<a href="${l.href}" class="${cls.join(' ')}">${l.label}</a>`;
    });

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
        ${navLinks[0]}
        <span class="nav-sep"></span>
        ${navLinks.slice(1).join('')}
      </div>`;
  }

  return { mount };
})();
