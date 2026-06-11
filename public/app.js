/* 共用：響應式左側選單殼 + 角色權限 + 共用工具。頁面在 <body class="has-shell"> 末端引入。 */
(function () {
  const params = new URLSearchParams(location.search);
  const API_BASE = (params.get('api') || 'https://workforcemanagement.ellyfd.workers.dev').replace(/\/+$/, '');
  const DEVICE = localStorage.getItem('dev_device_token') || '';
  try { localStorage.removeItem('dev_admin_key'); } catch (_) {} // 移除舊版殘留的 ADMIN_KEY（已不再使用）

  // /api/me 的 sessionStorage 快取：換頁先用快取畫側欄、背景再驗證，
  // 讓導覽不必每頁都等一趟網路往返。快取綁定 device token，換 token 即失效。
  const ME_CACHE_KEY = 'dev_me_cache';
  function readMeCache() {
    try {
      const c = JSON.parse(sessionStorage.getItem(ME_CACHE_KEY) || 'null');
      return c && c.t === DEVICE && c.me ? c.me : null;
    } catch (_) { return null; }
  }
  function writeMeCache(me) {
    try {
      if (me) sessionStorage.setItem(ME_CACHE_KEY, JSON.stringify({ t: DEVICE, me }));
      else sessionStorage.removeItem(ME_CACHE_KEY);
    } catch (_) {}
  }

  // 線條圖示（lucide 風格，stroke 繼承文字色）
  const svg = (paths) => `<svg class="ni" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  const ICONS = {
    dash: svg('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>'),
    me: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/><path d="m9.5 16.5 2 2 3.5-3.5"/>'),
    all: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>'),
    people: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
    leave: svg('<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"/><path d="M1 14h6M9 8h6M17 16h6"/>'),
    sync: svg('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>'),
    more: svg('<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>'),
  };
  const NAV_MAIN = [
    { href: 'dashboard.html', label: '儀表板', icon: 'dash' },
    { href: 'me.html', label: '我的排休', icon: 'me' },
    { href: 'index.html', label: '全部排休', icon: 'all' },
  ];
  const NAV_ADMIN = [
    { href: 'people.html', label: '人員管理', icon: 'people' },
    { href: 'leave-settings.html', label: '休假設定', icon: 'leave' },
    { href: 'settings.html', label: 'DPC 同步', icon: 'sync' },
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

  // 年/月下拉選項（跨年資料瀏覽用）。年度範圍＝今年-3 ～ 今年+1，並保證包含目前選到的年份。
  function yearOptions(sel) {
    const now = new Date().getFullYear();
    const ys = new Set(Array.from({ length: 5 }, (_, i) => now - 3 + i));
    if (sel) ys.add(Number(sel));
    return [...ys].sort((a, b) => a - b)
      .map((y) => `<option value="${y}"${y === Number(sel) ? ' selected' : ''}>${y} 年</option>`).join('');
  }
  // allLabel 給「全部月份」這類不限月的選項（值為空字串）
  function monthOptions(sel, allLabel) {
    let out = allLabel ? `<option value=""${sel ? '' : ' selected'}>${allLabel}</option>` : '';
    for (let m = 1; m <= 12; m++) out += `<option value="${m}"${m === Number(sel) ? ' selected' : ''}>${m} 月</option>`;
    return out;
  }
  function api(path, opts = {}) {
    return fetch(API_BASE + path, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(DEVICE ? { 'X-Device-Token': DEVICE } : {}),
        ...(opts.headers || {}),
      },
    });
  }
  // 管理 API：權限完全由「本裝置綁定的 admin 帳號」決定（不再有 ADMIN_KEY 後門/輸入框）。
  // 非管理員會收到 401，由各頁顯示「此頁僅限管理員」提示。
  function adminApi(path, opts = {}) {
    return api(path, opts);
  }

  function navItems(items) {
    return items.map((it) => {
      const base = it.href.replace(/\.html$/, '');
      const active = base === cur ? ' active' : '';
      return `<a class="navlink${active}" href="${it.href}">${ICONS[it.icon] || ''}<span>${it.label}</span></a>`;
    }).join('');
  }
  function buildSidebar(isAdmin, me) {
    let nav = `<div class="nav-sect">主要功能</div>${navItems(NAV_MAIN)}`;
    if (isAdmin) nav += `<div class="nav-sect">設定管理</div>${navItems(NAV_ADMIN)}`;
    const user = me ? `<button class="userblock" id="appUser" title="個人資料">
        <span class="avatar">${esc((me.name || '?').slice(0, 1))}</span>
        <span class="uinfo"><b>${esc(me.name || '')}</b>${me.english_name ? `<small>${esc(me.english_name)}</small>` : ''}</span>
        <span class="chev">›</span>
      </button>` : '';
    return `<aside class="app-sidebar" id="appSidebar">${user || '<div class="brand">開發處休假表</div>'}<nav class="app-nav">${nav}</nav></aside>`;
  }

  // 手機底部導覽列：主要功能直達 + 「更多」開啟抽屜（含個人資料與管理項目）
  function buildBottomNav() {
    const links = NAV_MAIN.map((it) => {
      const active = it.href.replace(/\.html$/, '') === cur ? ' active' : '';
      return `<a class="${active.trim()}" href="${it.href}">${ICONS[it.icon] || ''}<span>${esc(it.label)}</span></a>`;
    }).join('');
    const moreActive = ADMIN_PAGES.includes(cur) ? ' active' : '';
    return `<nav class="app-bottomnav" id="appBottomNav">${links}` +
      `<button class="${moreActive.trim()}" id="appMore" aria-label="更多">${ICONS.more}<span>更多</span></button></nav>`;
  }

  /* ── 個人資料抽屜 ─────────────────────────────────── */
  const STATUS_LABEL = { active: '在職', parental_leave: '育嬰假', inactive: '離職', hidden: '隱藏' };
  function ids(s) { try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; } }
  const dayOf = (period) => (period === 'morning' || period === 'afternoon') ? 0.5 : 1;

  async function openProfile() {
    if (document.getElementById('pp')) return;
    document.body.insertAdjacentHTML('beforeend',
      `<div class="pp-scrim" id="ppScrim"></div>
       <aside class="pp" id="pp"><button class="pp-close" id="ppClose" aria-label="關閉">✕</button>
         <h2>個人資料</h2><div id="ppBody"><div class="status">載入中…</div></div></aside>`);
    const close = () => { const p = document.getElementById('pp'); if (p) p.remove(); const s = document.getElementById('ppScrim'); if (s) s.remove(); };
    document.getElementById('ppScrim').onclick = close;
    document.getElementById('ppClose').onclick = close;
    try {
      const now = new Date(); const year = now.getFullYear(); const month = now.getMonth() + 1;
      const [me, depts, emps, types, leaves] = await Promise.all([
        api('/api/me').then((r) => r.json()),
        fetch(API_BASE + '/api/departments', { cache: 'no-store' }).then((r) => r.json()),
        fetch(API_BASE + '/api/employees', { cache: 'no-store' }).then((r) => r.json()),
        fetch(API_BASE + '/api/leave-types', { cache: 'no-store' }).then((r) => r.json()),
        api(`/api/my-leaves?year=${year}`).then((r) => (r.ok ? r.json() : [])),
      ]);
      renderProfile({ me, depts, emps, types, leaves, year, month });
    } catch (e) {
      const b = document.getElementById('ppBody'); if (b) b.innerHTML = `<div class="status err">載入失敗：${esc(e.message)}</div>`;
    }
  }

  function renderProfile(ctx, editing = false) {
    const { me, depts, emps, types, leaves, year, month } = ctx;
    const body = document.getElementById('ppBody'); if (!body) return;
    const typeById = Object.fromEntries(types.map((t) => [t.id, t]));
    const empName = (id) => { const e = emps.find((x) => x.id === id); return e ? e.name : ''; };
    const deptNames = (me.department_ids || []).map((id) => (depts.find((d) => d.id === id) || {}).name).filter(Boolean).join('、') || '—';

    // 請假統計（每筆：整天=1、半天=0.5），分本月與全年
    const mp = `${year}-${String(month).padStart(2, '0')}`;
    const stat = (list) => {
      const by = {}; let sum = 0;
      for (const r of list) { const d = dayOf(r.period); by[r.leave_type_id] = (by[r.leave_type_id] || 0) + d; sum += d; }
      return { by, sum };
    };
    const yearStat = stat(leaves);
    const monthStat = stat(leaves.filter((r) => (r.date || '').startsWith(mp)));
    const rows = (st) => Object.entries(st.by).sort((a, b) => b[1] - a[1]).map(([tid, d]) => {
      const t = typeById[tid] || {};
      return `<div class="li"><span class="dot" style="background:${esc(t.color || '#64748b')}"></span>${esc(t.name || '未分類')}<span class="v">${d} 天</span></div>`;
    }).join('');

    // 本人可自行編輯：英文名 + 職代（候選＝與本人有共同部門的在職同仁）。部門/狀態/角色僅管理員可改。
    const myDeptSet = new Set(me.department_ids || []);
    const cands = emps.filter((e) => e.id !== me.id && ids(e.department_ids).some((d) => myDeptSet.has(d)));
    const opts = (cur, exclude) => '<option value="">無</option>' + cands.filter((e) => e.id !== exclude)
      .map((e) => `<option value="${esc(e.id)}"${e.id === cur ? ' selected' : ''}>${esc(e.name)}</option>`).join('');

    const head = editing
      ? `<div class="pp-head">
           <span class="avatar lg">${esc((me.name || '?').slice(0, 1))}</span>
           <div style="flex:1;min-width:0;"><b style="font-size:16px;">${esc(me.name || '')}</b>
             <input id="ppEng" placeholder="英文名（選填）" value="${esc(me.english_name || '')}" style="margin-top:5px;width:100%;padding:6px 8px;" /></div>
         </div>`
      : `<div class="pp-head">
           <span class="avatar lg">${esc((me.name || '?').slice(0, 1))}</span>
           <div style="flex:1;min-width:0;"><b style="font-size:16px;">${esc(me.name || '')}</b>
             ${me.english_name ? `<div class="muted">${esc(me.english_name)}</div>` : ''}</div>
           <a href="#" id="ppEdit" style="color:var(--blue);text-decoration:none;font-size:14px;">編輯</a>
         </div>`;

    const depCard = editing
      ? `<div class="pp-card" style="grid-column:1/-1;"><div class="k">職務代理人</div>
           <div class="row" style="margin-top:6px;gap:8px;">
             <select id="ppDep1" style="flex:1;">${opts(me.deputy_1, me.deputy_2)}</select>
             <select id="ppDep2" style="flex:1;">${opts(me.deputy_2, me.deputy_1)}</select>
           </div></div>`
      : `<div class="pp-card"><div class="k">職務代理人</div>
           ${esc([me.deputy_1, me.deputy_2].filter(Boolean).map(empName).filter(Boolean).join('、') || '—')}</div>`;

    body.innerHTML = `
      ${head}
      <div class="pp-cards">
        <div class="pp-card"><div class="k">部門</div>${esc(deptNames)}</div>
        ${depCard}
        <div class="pp-card"><div class="k">狀態</div>${esc(STATUS_LABEL[me.status] || me.status || '—')}</div>
        <div class="pp-card"><div class="k">角色</div>${me.role === 'admin' ? '管理員' : '一般'}</div>
      </div>
      ${editing
        ? `<div class="row" style="justify-content:flex-end;gap:8px;margin:12px 0 4px;">
             <button class="btn sm" id="ppCancel">取消</button>
             <button class="btn sm primary" id="ppSave">儲存</button></div>`
        : `<div class="muted" style="font-size:13px;margin:8px 2px 0;">部門、狀態、角色由管理員於「人員管理」維護。</div>`}
      <h3 class="pp-sect">${month} 月請假小計</h3>
      ${rows(monthStat) || '<div class="muted" style="padding:4px 2px;">本月尚無請假</div>'}
      ${monthStat.sum ? `<div class="pp-total"><span>小計</span><span>${monthStat.sum} 天</span></div>` : ''}
      <h3 class="pp-sect">${year} 年度累計</h3>
      ${rows(yearStat) || '<div class="muted" style="padding:4px 2px;">今年尚無請假</div>'}
      ${yearStat.sum ? `<div class="pp-total"><span>年度合計</span><span>${yearStat.sum} 天</span></div>` : ''}`;

    if (!editing) {
      const eb = document.getElementById('ppEdit');
      if (eb) eb.onclick = (e) => { e.preventDefault(); renderProfile(ctx, true); };
      return;
    }
    document.getElementById('ppCancel').onclick = () => renderProfile(ctx, false);
    document.getElementById('ppSave').onclick = async () => {
      const eng = document.getElementById('ppEng').value.trim();
      const d1 = document.getElementById('ppDep1').value || null;
      const d2 = document.getElementById('ppDep2').value || null;
      if (d1 && d1 === d2) { toast('兩位職代不可相同', 'err'); return; }
      const r = await api('/api/my-profile', { method: 'PUT', body: JSON.stringify({ english_name: eng, deputy_1: d1, deputy_2: d2 }) });
      if (!r.ok) { toast('儲存失敗', 'err'); return; }
      ctx.me.english_name = eng; ctx.me.deputy_1 = d1; ctx.me.deputy_2 = d2;
      writeMeCache(ctx.me); // 同步側欄快取，避免下次換頁誤判資料變更而重載
      toast('已更新個人資料', 'ok');
      renderProfile(ctx, false);
    };
  }

  async function fetchMe() {
    if (!DEVICE) return null;
    try { const r = await fetch(API_BASE + '/api/me', { headers: { 'X-Device-Token': DEVICE } }); if (r.ok) return await r.json(); } catch (_) {}
    return null;
  }

  function ensureToken() {
    let t = localStorage.getItem('dev_device_token');
    if (!t) { t = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)); localStorage.setItem('dev_device_token', t); }
    return t;
  }

  // 身分閘門：一進站尚未綁定 → 全螢幕選名字並綁定本裝置。
  async function showBindGate() {
    const t = ensureToken();
    let emps = [];
    try { emps = await (await fetch(API_BASE + '/api/employees', { cache: 'no-store' })).json(); } catch (_) {}
    document.body.insertAdjacentHTML('afterbegin', `
      <div class="bindgate" id="bindGate">
        <div class="bindbox">
          <div class="bindbrand">開發處休假表</div>
          <h2>請選擇你的名字</h2>
          <p class="muted">綁定後本裝置會記住你的身分，下次免選（可在「我的排休 → 切換身分」更換）。</p>
          <input id="bindSearch" type="text" placeholder="輸入中文名或英文名搜尋…" autocomplete="off" />
          <div class="bindlist" id="bindList"></div>
        </div>
      </div>`);
    const listEl = document.getElementById('bindList');
    const draw = (kw = '') => {
      const k = kw.trim().toLowerCase();
      listEl.innerHTML = emps
        .filter((e) => !k || (e.name || '').toLowerCase().includes(k) || (e.english_name || '').toLowerCase().includes(k))
        .map((e) => `<button class="binditem" data-id="${esc(e.id)}"><b>${esc(e.name)}</b>${e.english_name ? ` <span class="muted">${esc(e.english_name)}</span>` : ''}</button>`)
        .join('') || '<div class="muted" style="padding:10px;">查無此人</div>';
      listEl.querySelectorAll('.binditem').forEach((b) => b.onclick = async () => {
        const r = await fetch(API_BASE + '/api/bind', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Token': t }, body: JSON.stringify({ employee_id: b.dataset.id }) });
        if (!r.ok) { toast('綁定失敗，請重試', 'err'); return; }
        location.href = 'me.html'; // 綁定後直接進我的排休
      });
    };
    draw();
    document.getElementById('bindSearch').oninput = (e) => draw(e.target.value);
  }

  async function mount() {
    const cached = readMeCache();
    if (cached) {
      renderShell(cached); // 先用快取立即畫殼，不等網路
      const fresh = await fetchMe(); // 背景驗證
      writeMeCache(fresh);
      // 已解綁或資料變了（換人/角色/職代）→ 重載一次套用；快取已更新，不會迴圈
      if (!fresh || JSON.stringify(fresh) !== JSON.stringify(cached)) location.reload();
      return;
    }
    const me = await fetchMe();
    if (!me) { resolveReady({ me: null, isAdmin: false }); await showBindGate(); return; } // 綁定後會自動 reload
    writeMeCache(me);
    renderShell(me);
  }

  function renderShell(me) {
    const isAdmin = !!(me && me.role === 'admin');
    window.App.me = me; window.App.isAdmin = isAdmin;
    document.body.classList.toggle('is-admin', isAdmin);

    document.body.insertAdjacentHTML('afterbegin',
      buildSidebar(isAdmin, me) +
      `<div class="app-scrim" id="appScrim"></div>` +
      buildBottomNav(),
    );
    const sb = document.getElementById('appSidebar');
    const scrim = document.getElementById('appScrim');
    const close = () => { sb.classList.remove('open'); scrim.classList.remove('show'); };
    const open = () => { sb.classList.add('open'); scrim.classList.add('show'); };
    const moreBtn = document.getElementById('appMore');
    if (moreBtn) moreBtn.onclick = open;
    scrim.onclick = close;
    sb.querySelectorAll('a').forEach((a) => a.addEventListener('click', close));
    const ub = document.getElementById('appUser');
    if (ub) ub.onclick = () => { close(); openProfile(); };

    // 非管理員：移除管理專屬元素、擋掉管理頁
    if (!isAdmin) {
      document.querySelectorAll('.admin-only').forEach((el) => el.remove());
      if (ADMIN_PAGES.includes(cur)) {
        const main = document.querySelector('.app-main') || document.querySelector('.page') || document.body;
        main.innerHTML = '<div class="card" style="margin-top:20px;">此頁僅限管理員。請先到「我的排休」綁定為具管理權限的帳號（或由管理員指派）。</div>';
      }
    }
    document.dispatchEvent(new CustomEvent('app:ready', { detail: { me, isAdmin } }));
    resolveReady({ me, isAdmin });
  }

  // 輕量 toast 通知（取代刺眼的 alert）。type：'ok'｜'err'｜空（中性）
  function toast(msg, type) {
    let host = document.querySelector('.toast-host');
    if (!host) { host = document.createElement('div'); host.className = 'toast-host'; document.body.appendChild(host); }
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(8px)'; setTimeout(() => el.remove(), 250); }, 2600);
  }

  // App 內建確認對話框（取代 window.confirm）。回傳 Promise<boolean>。
  function confirmDialog(message, opts = {}) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'modal-scrim';
      wrap.innerHTML = `<div class="modal"><h3>${esc(opts.title || '確認')}</h3>
        <p style="margin:0 0 16px;white-space:pre-wrap;line-height:1.6;">${esc(message)}</p>
        <div class="actions">
          <button class="btn" id="c_cancel">${esc(opts.cancelText || '取消')}</button>
          <button class="btn ${opts.danger ? 'danger' : 'primary'}" id="c_ok">${esc(opts.okText || '確定')}</button>
        </div></div>`;
      document.body.appendChild(wrap);
      const done = (v) => { wrap.remove(); resolve(v); };
      wrap.querySelector('#c_cancel').onclick = () => done(false);
      wrap.querySelector('#c_ok').onclick = () => done(true);
      wrap.onclick = (e) => { if (e.target === wrap) done(false); };
    });
  }

  let resolveReady;
  window.App = {
    API_BASE, esc, api, adminApi, params, yearOptions, monthOptions, toast, confirm: confirmDialog, me: null, isAdmin: false,
    // 頁面可 await App.ready 取得身分（殼畫好後 resolve；未綁定時 me 為 null）
    ready: new Promise((r) => { resolveReady = r; }),
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
