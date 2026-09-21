// ═══════════════════════════════════════════════════════════════
// public/js/layout.js
// Injects Bootstrap + AOS + navbar + footer into every page.
// Call renderLayout({ active: 'browse' }) at the top of each page.
// ═══════════════════════════════════════════════════════════════

import { auth } from './api.js';

const CDN = {
  bootstrapCss: 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css',
  bootstrapJs:  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js',
  icons:        'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.css',
  aosCss:       'https://unpkg.com/aos@2.3.4/dist/aos.css',
  aosJs:        'https://unpkg.com/aos@2.3.4/dist/aos.js',
};

// ─── Head injection ──────────────────────────────────────────
function injectOnce(tag, key, attrs) {
  const existing = document.querySelector(`${tag}[data-be="${key}"]`);
  if (existing) return existing;

  const el = document.createElement(tag);
  el.dataset.be = key;
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  document.head.appendChild(el);
  return el;
}

function loadStyles() {
  injectOnce('link', 'bs-css', { rel: 'stylesheet', href: CDN.bootstrapCss });
  injectOnce('link', 'bs-icons', { rel: 'stylesheet', href: CDN.icons });
  injectOnce('link', 'aos-css', { rel: 'stylesheet', href: CDN.aosCss });
}

function loadScripts() {
  // Bootstrap bundle
  if (!document.querySelector('script[data-be="bs-js"]')) {
    const s = document.createElement('script');
    s.src = CDN.bootstrapJs;
    s.defer = true;
    s.dataset.be = 'bs-js';
    document.head.appendChild(s);
  }

  // AOS + init
  if (!document.querySelector('script[data-be="aos-js"]')) {
    const s = document.createElement('script');
    s.src = CDN.aosJs;
    s.defer = true;
    s.dataset.be = 'aos-js';
    s.onload = () => {
      if (window.AOS) {
        window.AOS.init({
          duration: 600,
          once: true,
          offset: 40,
          easing: 'ease-out-cubic',
        });
      }
    };
    document.head.appendChild(s);
  } else if (window.AOS) {
    // Already loaded — re-init for SPA-style navigation
    window.AOS.refreshHard();
  }
}

// ─── Navbar markup ───────────────────────────────────────────
function navHTML(active) {
  const isActive = (name) => (active === name ? 'active' : '');

  const userMenu = auth.isLoggedIn
    ? `
      <li class="nav-item dropdown ms-lg-2">
        <a class="nav-link dropdown-toggle d-flex align-items-center gap-2"
           href="#" role="button" data-bs-toggle="dropdown" aria-expanded="false">
          <span class="rounded-circle bg-primary text-white d-flex align-items-center justify-content-center fw-bold flex-shrink-0"
                style="width:32px;height:32px;font-size:0.8rem;">
            ${escapeHtml((auth.user?.fullName || auth.user?.email || 'U').slice(0, 1).toUpperCase())}
          </span>
          <span class="d-none d-lg-inline text-truncate" style="max-width:140px;">
            ${escapeHtml(auth.user?.fullName || auth.user?.email || 'Account')}
          </span>
        </a>
        <ul class="dropdown-menu dropdown-menu-end shadow">
          <li class="px-3 py-2">
            <div class="small fw-semibold">${escapeHtml(auth.user?.fullName || '')}</div>
            <div class="small text-muted text-truncate" style="max-width:200px;">
              ${escapeHtml(auth.user?.email || '')}
            </div>
          </li>
          <li><hr class="dropdown-divider"></li>
          <li>
            <a class="dropdown-item" href="/my-bookings.html">
              <i class="bi bi-calendar-check me-2"></i>My bookings
            </a>
          </li>
          ${auth.user?.role === 'business_owner'
            ? `<li>
                 <a class="dropdown-item" href="/dashboard.html">
                   <i class="bi bi-speedometer2 me-2"></i>Dashboard
                 </a>
               </li>`
  : ''}
          ${auth.user?.role === 'admin'
            ? `<li>
                 <a class="dropdown-item" href="/admin.html">
                   <i class="bi bi-shield-lock me-2"></i>Admin panel
                 </a>
               </li>`
            : ''}
          <li><hr class="dropdown-divider"></li>
          <li>
            <a class="dropdown-item text-danger" href="#" id="logout-link">
              <i class="bi bi-box-arrow-right me-2"></i>Sign out
            </a>
          </li>
        </ul>
      </li>`
    : `
      <li class="nav-item ms-lg-2">
        <a class="btn btn-outline-primary btn-sm px-3" href="/login.html">Sign in</a>
      </li>
      <li class="nav-item">
        <a class="btn btn-primary btn-sm px-3" href="/register.html">Sign up</a>
      </li>`;

  return `
    <div class="container">
      <a class="navbar-brand fw-bold d-flex align-items-center gap-2" href="/">
        <span style="font-size:1.4rem;">✂️</span>
        <span>BookEasy</span>
      </a>

      <button class="navbar-toggler border-0 shadow-none" type="button"
              data-bs-toggle="collapse" data-bs-target="#mainNav"
              aria-controls="mainNav" aria-expanded="false" aria-label="Toggle navigation">
        <span class="navbar-toggler-icon"></span>
      </button>

      <div class="collapse navbar-collapse" id="mainNav">
        <ul class="navbar-nav ms-auto align-items-lg-center gap-lg-1">
          <li class="nav-item">
            <a class="nav-link ${isActive('browse')}" href="/browse.html">Browse</a>
          </li>
          <li class="nav-item">
            <a class="nav-link ${isActive('my-bookings')}" href="/my-bookings.html">My Bookings</a>
          </li>
          <li class="nav-item">
            <a class="nav-link ${isActive('dashboard')}" href="/dashboard.html">Dashboard</a>
          </li>
          ${userMenu}
        </ul>
      </div>
    </div>
  `;
}


// ─── Footer markup ───────────────────────────────────────────
function footerHTML() {
  const year = new Date().getFullYear();
  return `
    <div class="container">
      <div class="row g-4">
        <div class="col-lg-4 col-md-6">
          <h5 class="fw-bold mb-3 d-flex align-items-center gap-2">
            <span>✂️</span><span>BookEasy</span>
          </h5>
          <p class="small mb-0" style="opacity:0.75; max-width:340px;">
            Book appointments at salons, barbers, clinics, and consultants — instantly, online.
          </p>
        </div>

        <div class="col-6 col-md-3 col-lg-2">
          <h6 class="text-uppercase small fw-bold mb-3" style="opacity:0.5;">Product</h6>
          <ul class="list-unstyled small">
            <li class="mb-2"><a href="/browse.html" class="text-decoration-none text-light" style="opacity:0.75;">Browse</a></li>
            <li class="mb-2"><a href="/dashboard.html" class="text-decoration-none text-light" style="opacity:0.75;">For Business</a></li>
            <li class="mb-2"><a href="/docs" class="text-decoration-none text-light" style="opacity:0.75;">API Docs</a></li>
          </ul>
        </div>

        <div class="col-6 col-md-3 col-lg-2">
          <h6 class="text-uppercase small fw-bold mb-3" style="opacity:0.5;">Company</h6>
          <ul class="list-unstyled small">
            <li class="mb-2"><a href="#" class="text-decoration-none text-light" style="opacity:0.75;">About</a></li>
            <li class="mb-2"><a href="#" class="text-decoration-none text-light" style="opacity:0.75;">Privacy</a></li>
            <li class="mb-2"><a href="#" class="text-decoration-none text-light" style="opacity:0.75;">Terms</a></li>
          </ul>
        </div>

        <div class="col-lg-4 col-md-12">
          <h6 class="text-uppercase small fw-bold mb-3" style="opacity:0.5;">Get in touch</h6>
          <p class="small mb-2"><i class="bi bi-envelope me-2"></i>hello@bookeasy.demo</p>
          <p class="small mb-0"><i class="bi bi-geo-alt me-2"></i>New York, NY</p>
        </div>
      </div>

      <hr class="border-secondary my-4" style="opacity:0.25;">

      <div class="d-flex flex-column flex-sm-row justify-content-between align-items-center gap-2 small" style="opacity:0.6;">
        <div>© ${year} BookEasy — Demo booking platform</div>
        <div class="d-flex gap-3">
          <a href="#" class="text-decoration-none text-light"><i class="bi bi-twitter"></i></a>
          <a href="#" class="text-decoration-none text-light"><i class="bi bi-instagram"></i></a>
          <a href="#" class="text-decoration-none text-light"><i class="bi bi-github"></i></a>
        </div>
      </div>
    </div>
  `;
}

// ─── HTML escaping helper (XSS safety) ──────────────────────
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ─── Public API ──────────────────────────────────────────────
export function renderLayout({ active = '' } = {}) {
  loadStyles();
  loadScripts();

  // Inject navbar (if missing)
  if (!document.querySelector('nav.navbar[data-be="main"]')) {
    const nav = document.createElement('nav');
    nav.className = 'navbar navbar-expand-lg sticky-top';
    nav.dataset.be = 'main';
    nav.innerHTML = navHTML(active);
    document.body.prepend(nav);
  }

  // Inject footer (if missing)
  if (!document.querySelector('footer[data-be="main"]')) {
    const footer = document.createElement('footer');
    footer.className = 'bg-dark text-light mt-5 pt-5 pb-4';
    footer.dataset.be = 'main';
    footer.innerHTML = footerHTML();
    document.body.appendChild(footer);
  }

  // Auto-close mobile nav after clicking a link
  document.addEventListener('click', (e) => {
    const link = e.target.closest('.navbar .nav-link, .navbar .dropdown-item');
    if (!link) return;
    const navbar = document.querySelector('.navbar-collapse.show');
    if (navbar) {
      // Use Bootstrap's collapse API if available; fallback to click on toggler
      if (window.bootstrap?.Collapse) {
        window.bootstrap.Collapse.getOrCreateInstance(navbar).hide();
      } else {
        document.querySelector('.navbar-toggler')?.click();
      }
    }
  });

  // Logout handler (event delegation — works with dynamic content)
  document.addEventListener('click', async (e) => {
    const logoutLink = e.target.closest('#logout-link');
    if (!logoutLink) return;
    e.preventDefault();
    if (!confirm('Sign out of BookEasy?')) return;
    await auth.logout();
  });

  // If the user's not logged in but the page requires auth, they'll be
  // redirected by requireAuth() in api.js — nothing to do here.

  // Refresh AOS once content is likely painted
  window.addEventListener('load', () => {
    window.AOS?.refreshHard();
  });
}

// Optional: helper to update nav after login/logout without a full page reload
export function refreshLayout() {
  const nav = document.querySelector('nav.navbar[data-be="main"]');
  if (nav) {
    nav.innerHTML = navHTML(location.pathname.includes('browse') ? 'browse' : '');
  }
}