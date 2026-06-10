/* 共用：注入響應式左側選單殼 + 共用工具。頁面在 <body class="has-shell"> 末端引入。 */
(function () {
  const params = new URLSearchParams(location.search);
  const API_BASE = (params.get('api') || 'https://workforcemanagement.ellyfd.workers.dev').replace(/\/+$/, '');

  const NAV = [
    { sect: '主要功能', items: [
      { href: 'dashboard.html', label: '儀表板', ic: '🏠' },
      { href: 'me.html', label: '我的排休', ic: '📅' },
      { href: 'index.html', label: '全部排休', ic: '🗓️' },
    ]},
    { sect: '設定管理', items: [
      { href: 'people.html', label: '人員管理', ic: '👥' },
      { href: 'leave-settings.html', label: '休假設定', ic: '🛠️' },
      { href: 'settings.html', label: 'DPC 同步', ic: '🔄' },
    ]},
  ];

  // 目前頁面檔名（'/'、'/dashboard'、'/dashboard.html' 都要對得起來）
  function currentName() {
    let p = location.pathname.split('/').pop() || 'index.html';
    if (!p) p = 'index.html';
    return p.replace(/\.html$/, '') || 'index';
  }
  const cur = currentName();

  function buildSidebar() {
    const links = NAV.map((g) => {
      const items = g.items.map((it) => {
        const base = it.href.replace(/\.html$/, '');
        const active = base === cur ? ' active' : '';
        return `<a class="navlink${active}" href="${it.href}"><span class="ic">${it.ic}</span>${it.label}</a>`;
      }).join('');
      return `<div class="sect">${g.sect}</div>${items}`;
    }).join('');
    return `
      <aside class="app-sidebar" id="appSidebar">
        <div class="brand"><b>開發處休假表</b><small>DPC Leave</small></div>
        <nav class="app-nav">${links}</nav>
      </aside>`;
  }

  const title = (NAV.flatMap((g) => g.items).find((it) => it.href.replace(/\.html$/, '') === cur) || {}).label || '開發處休假表';

  function mount() {
    document.body.insertAdjacentHTML('afterbegin',
      buildSidebar() +
      `<div class="app-scrim" id="appScrim"></div>` +
      `<header class="app-topbar"><button class="ham" id="appHam" aria-label="選單">☰</button><b>${title}</b></header>`,
    );
    const sb = document.getElementById('appSidebar');
    const scrim = document.getElementById('appScrim');
    const close = () => { sb.classList.remove('open'); scrim.classList.remove('show'); };
    document.getElementById('appHam').onclick = () => { sb.classList.add('open'); scrim.classList.add('show'); };
    scrim.onclick = close;
    sb.querySelectorAll('a').forEach((a) => a.addEventListener('click', close));
  }

  // ── 共用工具 ──────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function adminKey() { return localStorage.getItem('dev_admin_key') || ''; }
  function api(path, opts = {}) {
    const k = adminKey();
    return fetch(API_BASE + path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(k ? { 'X-Admin-Key': k } : {}), ...(opts.headers || {}) },
    });
  }
  // 管理 API：遇 401 先要密鑰再重試一次
  async function adminApi(path, opts = {}) {
    let res = await api(path, opts);
    if (res.status === 401) {
      const key = prompt('需要管理密鑰（ADMIN_KEY）：', adminKey());
      if (key == null) return res;
      localStorage.setItem('dev_admin_key', key.trim());
      res = await api(path, opts);
    }
    return res;
  }

  window.App = { API_BASE, esc, api, adminApi, params };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
