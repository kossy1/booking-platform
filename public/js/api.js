// public/js/api.js
export const API_BASE = '';

// ─── Currency config ─────────────────────────────────
export const CURRENCY = {
  code: 'NGN',
  symbol: '₦',
  locale: 'en-NG',
};

// ─── Auth factory ────────────────────────────────────
function makeAuth(prefix) {
  return {
    get token()   { return localStorage.getItem(`${prefix}_token`); },
    get refresh() { return localStorage.getItem(`${prefix}_refresh`); },
    get user()    {
      try { return JSON.parse(localStorage.getItem(`${prefix}_user`) || 'null'); }
      catch { return null; }
    },
    get isLoggedIn() { return !!this.token && !!this.user; },

    save({ accessToken, refreshToken, user }) {
      if (accessToken)  localStorage.setItem(`${prefix}_token`, accessToken);
      if (refreshToken) localStorage.setItem(`${prefix}_refresh`, refreshToken);
      if (user)         localStorage.setItem(`${prefix}_user`, JSON.stringify(user));
    },

    clear() {
      localStorage.removeItem(`${prefix}_token`);
      localStorage.removeItem(`${prefix}_refresh`);
      localStorage.removeItem(`${prefix}_user`);
    },

    async logout(redirectTo = '/login.html', logoutPath = '/auth/logout') {
      try {
        if (this.refresh) {
          await fetch(API_BASE + logoutPath, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: this.refresh }),
          });
        }
      } catch { /* ignore */ }
      this.clear();
      window.location.href = redirectTo;
    },
  };
}

export const auth      = makeAuth('auth');
export const adminAuth = makeAuth('admin');

// ─── Fetch wrapper ───────────────────────────────────
function pickStore(path) {
  return path.startsWith('/admin') ? adminAuth : auth;
}

function pickToken(path) {
  return pickStore(path).token;
}

async function tryRefresh(path) {
  const store = pickStore(path);
  if (!store.refresh) return null;

  const refreshPath = path.startsWith('/admin')
    ? '/auth/admin/refresh'
    : '/auth/refresh';

  const res = await fetch(API_BASE + refreshPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: store.refresh }),
  });
  if (!res.ok) throw new Error('refresh failed');

  const data = await res.json();
  store.save(data);
  return data.accessToken;
}

export async function api(path, options = {}) {
  const makeReq = (token) => fetch(API_BASE + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  let res = await makeReq(pickToken(path));

  if (res.status === 401 && !path.startsWith('/auth/')) {
    try {
      const newToken = await tryRefresh(path);
      if (newToken) res = await makeReq(newToken);
    } catch {
      pickStore(path).clear();
      const loginPath = path.startsWith('/admin') ? '/admin-login.html' : '/login.html';
      window.location.href = `${loginPath}?next=${encodeURIComponent(location.pathname + location.search)}`;
      throw new Error('Session expired');
    }
  }

  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!res.ok) {
    const err = new Error(data?.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// ─── Customer domain helpers ─────────────────────────
export const getBusinesses   = (q = {}) => api('/businesses?' + new URLSearchParams(q));
export const getBusiness     = (id)     => api(`/businesses/${id}`);
export const getServices     = (businessId) => api(`/services?businessId=${businessId}`);
export const getAvailability = (params) => api('/availability?' + new URLSearchParams(params));
export const createBooking   = (body)   => api('/bookings', { method: 'POST', body: JSON.stringify(body) });
export const getBooking      = (id)     => api(`/bookings/${id}`);
export const cancelBooking   = (id, reason) => api(`/bookings/${id}/cancel`, {
  method: 'POST', body: JSON.stringify({ reason }),
});
export const listBookings    = (params = {}) => api('/bookings?' + new URLSearchParams(params));

export const register = (body) => api('/auth/register', { method: 'POST', body: JSON.stringify(body) });
export const login    = (body) => api('/auth/login',    { method: 'POST', body: JSON.stringify(body) });
export const getMe    = ()     => api('/auth/me');

export const getMyBusinesses  = ()     => api('/me/businesses');
export const createMyBusiness = (body) => api('/me/businesses', { method: 'POST', body: JSON.stringify(body) });

// ─── Admin domain helpers ────────────────────────────
export const adminLogin  = (body) => api('/auth/admin/login', { method: 'POST', body: JSON.stringify(body) });
export const adminGetMe  = ()     => api('/auth/admin/me');
export const adminLogout = ()     => adminAuth.logout('/admin-login.html', '/auth/admin/logout');

// ─── Route guards ────────────────────────────────────
export function requireAuth() {
  if (!auth.isLoggedIn) {
    window.location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
    return false;
  }
  return true;
}

export function requireAdminAuth() {
  if (!adminAuth.isLoggedIn) {
    window.location.href = `/admin-login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
    return false;
  }
  return true;
}

// ─── UI helpers ──────────────────────────────────────
export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function fmtDate(iso, opts = {}) {
  return new Date(iso).toLocaleString(CURRENCY.locale, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', ...opts,
  });
}
export const fmtTime     = (iso) => new Date(iso).toLocaleTimeString(CURRENCY.locale, { hour: '2-digit', minute: '2-digit' });
export const fmtDateOnly = (iso) => new Date(iso).toLocaleDateString(CURRENCY.locale, { weekday: 'long', month: 'long', day: 'numeric' });

export function fmtMoney(n) {
  const value = Number(n ?? 0);
  if (!Number.isFinite(value)) return `${CURRENCY.symbol}0.00`;
  return new Intl.NumberFormat(CURRENCY.locale, {
    style: 'currency',
    currency: CURRENCY.code,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function fmtMoneyShort(n) {
  const value = Number(n ?? 0);
  if (!Number.isFinite(value)) return `${CURRENCY.symbol}0`;
  if (Math.abs(value) >= 1_000_000) return `${CURRENCY.symbol}${(value / 1_000_000).toFixed(1)}m`;
  if (Math.abs(value) >= 1_000)     return `${CURRENCY.symbol}${(value / 1_000).toFixed(1)}k`;
  return `${CURRENCY.symbol}${value.toFixed(0)}`;
}

export function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `alert alert-${type} shadow position-fixed`;
  el.style.cssText = 'bottom:20px; right:20px; z-index:9999; max-width:360px;';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}