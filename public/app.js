/* 共用：響應式左側選單殼 + 角色權限 + 共用工具。頁面在 <body class="has-shell"> 末端引入。 */
(function () {
  const params = new URLSearchParams(location.search);
  const API_BASE = (params.get('api') || 'https://workforcemanagement.ellyfd.workers.dev').replace(/\/+$/, '');
  const DEVICE = localStorage.getItem('dev_device_token') || '';

  const NAV_MAIN = [
    { href: 'dashboard.html', label: '儀表板' },
    { href: 'me.html', label: '我的排休' },
    { href: 'index.html', label: '全部排休' },
  ];
  const NAV_ADMIN = [
    { href: 'people.html', label: '人員管理' },
    { href: 'leave-settings.html', label: '休假設定' },
    { href: 'settings.html', label: 'DPC 同步' },
  ];
  const ADMIN_PAGES = ['people', 'leave-settings', 'settings'];

  function currentName() {
    let p = location.pathname.split('/').pop() || 'index.html';
    return (p.replace(/\.html$/, '') || 'index');
  }
  const cur = currentName();

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function adminKey() { return localStorage.getItem('dev_admin_key') || ''; }
  function api(path, opts = {}) {
    const k = adminKey();
    return fetch(API_BASE + path, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(DEVICE ? { 'X-Device-Token': DEVICE } : {}),
        ...(k ? { 'X-Admin-Key': k } : {}),
        ...(opts.headers || {}),
      },
    });
  }
  async function adminApi(path, opts = {}) {
    let res = await api(path, opts);
    if (res.status === 401 && !window.App.isAdmin) {
      const key = prompt('需要管理權限（管理員帳號或 ADMIN_KEY）：', adminKey());
      if (key == null) return res;
      localStorage.setItem('dev_admin_key', key.trim());
      res = await api(path, opts);
    }
    return res;
  }

  function navItems(items) {
    return items.map((it) => {
      const base = it.href.replace(/\.html$/, '');
      const active = base === cur ? ' active' : '';
      return `<a class="navlink${active}" href="${it.href}">${it.label}</a>`;
    }).join('');
  }
  function buildSidebar(isAdmin) {
    let nav = `<div class="nav-sect">主要功能</div>${navItems(NAV_MAIN)}`;
    if (isAdmin) nav += `<div class="nav-sect">設定管理</div>${navItems(NAV_ADMIN)}`;
    return `<aside class="app-sidebar" id="appSidebar"><div class="brand">開發處休假表</div><nav class="app-nav">${nav}</nav></aside>`;
  }

  async function fetchMe() {
    if (!DEVICE) return null;
    try { const r = await fetch(API_BASE + '/api/me', { headers: { 'X-Device-Token': DEVICE } }); if (r.ok) return await r.json(); } catch (_) {}
    return null;
  }

  async function mount() {
    const me = await fetchMe();
    const isAdmin = !!(me && me.role === 'admin');
    window.App.me = me; window.App.isAdmin = isAdmin;
    document.body.classList.toggle('is-admin', isAdmin);

    document.body.insertAdjacentHTML('afterbegin',
      buildSidebar(isAdmin) +
      `<div class="app-scrim" id="appScrim"></div>` +
      `<header class="app-topbar"><button class="ham" id="appHam" aria-label="選單">☰</button><b>開發處休假表</b></header>`,
    );
    const sb = document.getElementById('appSidebar');
    const scrim = document.getElementById('appScrim');
    const close = () => { sb.classList.remove('open'); scrim.classList.remove('show'); };
    document.getElementById('appHam').onclick = () => { sb.classList.add('open'); scrim.classList.add('show'); };
    scrim.onclick = close;
    sb.querySelectorAll('a').forEach((a) => a.addEventListener('click', close));

    // 非管理員：移除管理專屬元素、擋掉管理頁
    if (!isAdmin) {
      document.querySelectorAll('.admin-only').forEach((el) => el.remove());
      if (ADMIN_PAGES.includes(cur)) {
        const main = document.querySelector('.app-main') || document.querySelector('.page') || document.body;
        main.innerHTML = '<div class="card" style="margin-top:20px;">此頁僅限管理員。請先到「我的排休」綁定為具管理權限的帳號（或由管理員指派）。</div>';
      }
    }
    document.dispatchEvent(new CustomEvent('app:ready', { detail: { me, isAdmin } }));
  }

  window.App = { API_BASE, esc, api, adminApi, params, me: null, isAdmin: false };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
