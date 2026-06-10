// 開發處休假系統 — Cloudflare Worker API
//
// 階段 1：讀取月曆。 階段 2：裝置綁定登入 + 我的排休（各人請假/改假）。
//
// 身分模型（無密碼）：前端產生一組隨機 device token 存在瀏覽器，
// 每次請求帶 X-Device-Token。第一次選自己的名字後，把 token 綁到該員工。
// ⚠️ 無密碼＝拿到連結的人都能綁成任一員工，屬內部低風險用途。
//
// 端點：
//   GET    /api/health
//   GET    /api/calendar?year&month        全部排休（讀）
//   GET    /api/employees                  登入用的人員清單
//   GET    /api/leave-types                假別清單
//   POST   /api/bind        {employee_id}  以本裝置綁定為某員工
//   GET    /api/me                         取得本裝置綁定的員工
//   GET    /api/my-leaves?year             我的休假
//   POST   /api/my-leaves   {date,leave_type_id,period}
//   DELETE /api/my-leaves/:id

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Device-Token, X-Admin-Key, X-Sync-Secret',
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });

const token = (req) => req.headers.get('X-Device-Token') || '';

async function meFromToken(env, t) {
  if (!t) return null;
  return env.DB.prepare('SELECT * FROM employees WHERE device_token = ?').bind(t).first();
}

// 管理權限：X-Admin-Key 相符 OR 本裝置綁定的員工 role=admin 才可。
// 啟動保險：若系統中尚無任何 admin 且未設 ADMIN_KEY，暫時開放(讓你先指派 admin)。
async function canAdmin(env, request) {
  const key = env.ADMIN_KEY;
  if (key && request.headers.get('X-Admin-Key') === key) return true;
  const me = await meFromToken(env, token(request));
  if (me && me.role === 'admin') return true;
  if (!key) {
    const anyAdmin = await env.DB.prepare("SELECT 1 FROM employees WHERE role='admin' LIMIT 1").first();
    if (!anyAdmin) return true;
  }
  return false;
}

// 一筆休假的 upsert：依 period 互斥規則先刪後寫。
// full 會清掉整天(含 AM/PM)；AM 只清 full+AM；PM 只清 full+PM（AM 與 PM 可並存）。
function leaveUpsertStmts(env, employeeId, date, leaveTypeId, period, note = null) {
  const p = period === 'morning' || period === 'afternoon' ? period : 'full';
  const clear = p === 'morning' ? ['full', 'morning'] : p === 'afternoon' ? ['full', 'afternoon'] : ['full', 'morning', 'afternoon'];
  const ph = clear.map(() => '?').join(',');
  return [
    env.DB.prepare(`DELETE FROM leave_records WHERE employee_id=? AND date=? AND period IN (${ph})`).bind(employeeId, date, ...clear),
    env.DB.prepare('INSERT INTO leave_records (id,employee_id,date,leave_type_id,period,note) VALUES (?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), employeeId, date, leaveTypeId, p, note),
  ];
}

// 清理懸空職代：把所有把 removedId 設為 deputy_1/deputy_2 的人改回 NULL。
async function clearDeputyRefs(env, removedId) {
  await env.DB.prepare('UPDATE employees SET deputy_1 = NULL WHERE deputy_1 = ?').bind(removedId).run();
  await env.DB.prepare('UPDATE employees SET deputy_2 = NULL WHERE deputy_2 = ?').bind(removedId).run();
}

// 大量刪除分批執行，避免一次對 D1 發太多並發（每批 N 筆）。
async function runInBatches(items, fn, size = 10) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;
    if (method === 'OPTIONS') return new Response(null, { headers: CORS });

    try {
      if (pathname === '/api/health') return json({ ok: true });

      if (pathname === '/api/calendar' && method === 'GET') {
        const now = new Date();
        const year = Number(url.searchParams.get('year')) || now.getFullYear();
        const month = Number(url.searchParams.get('month')) || now.getMonth() + 1;
        return json(await buildCalendar(env, year, month));
      }

      if (pathname === '/api/employees' && method === 'GET') {
        const r = await env.DB.prepare(
          "SELECT id, name, english_name, department_ids FROM employees WHERE status='active' ORDER BY sort_order",
        ).all();
        return json(r.results);
      }

      // 公開部門清單（儀表板/篩選用）
      if (pathname === '/api/departments' && method === 'GET') {
        const r = await env.DB.prepare("SELECT id, name FROM departments WHERE status != 'hidden' ORDER BY sort_order").all();
        return json(r.results);
      }

      // 公開假日清單（前端區間請假用來略過國定假日；?names=1 連名稱一起回）
      if (pathname === '/api/holidays' && method === 'GET') {
        const year = url.searchParams.get('year');
        let q = 'SELECT date, name FROM holidays';
        const binds = [];
        if (year) { q += ' WHERE date >= ? AND date <= ?'; binds.push(`${year}-01-01`, `${year}-12-31`); }
        const r = await env.DB.prepare(q).bind(...binds).all();
        if (url.searchParams.get('names')) return json(r.results);
        return json(r.results.map((h) => h.date));
      }

      // 請假前警示檢查：職代當天也請假 / 部門當天請假達 1/3 上限
      if (pathname === '/api/leave-check' && method === 'GET') {
        const empId = url.searchParams.get('employee_id');
        const dates = (url.searchParams.get('dates') || '').split(',').filter(Boolean);
        if (!empId || !dates.length) return json({ error: 'missing_fields' }, 400);
        return json(await buildLeaveCheck(env, empId, dates));
      }

      if (pathname === '/api/leave-types' && method === 'GET') {
        const r = await env.DB.prepare('SELECT * FROM leave_types ORDER BY sort_order').all();
        return json(r.results);
      }

      if (pathname === '/api/bind' && method === 'POST') {
        const t = token(request);
        if (!t) return json({ error: 'no_device_token' }, 400);
        const { employee_id } = await request.json();
        const emp = await env.DB.prepare('SELECT * FROM employees WHERE id = ?').bind(employee_id).first();
        if (!emp) return json({ error: 'employee_not_found' }, 404);
        // 一個裝置只綁一人：先把這個 token 從其他人身上清掉
        await env.DB.prepare('UPDATE employees SET device_token = NULL WHERE device_token = ?').bind(t).run();
        await env.DB.prepare('UPDATE employees SET device_token = ? WHERE id = ?').bind(t, employee_id).run();
        return json({ id: emp.id, name: emp.name, english_name: emp.english_name });
      }

      if (pathname === '/api/me' && method === 'GET') {
        const me = await meFromToken(env, token(request));
        if (!me) return json({ error: 'not_bound' }, 401);
        return json({ id: me.id, name: me.name, english_name: me.english_name, role: me.role || 'user' });
      }

      if (pathname === '/api/my-leaves' && method === 'GET') {
        const me = await meFromToken(env, token(request));
        if (!me) return json({ error: 'not_bound' }, 401);
        const year = url.searchParams.get('year');
        let q = 'SELECT * FROM leave_records WHERE employee_id = ?';
        const binds = [me.id];
        if (year) {
          q += ' AND date >= ? AND date <= ?';
          binds.push(`${year}-01-01`, `${year}-12-31`);
        }
        const r = await env.DB.prepare(q).bind(...binds).all();
        return json(r.results);
      }

      if (pathname === '/api/my-leaves' && method === 'POST') {
        const me = await meFromToken(env, token(request));
        if (!me) return json({ error: 'not_bound' }, 401);
        const { date, leave_type_id, period = 'full' } = await request.json();
        if (!date || !leave_type_id) return json({ error: 'missing_fields' }, 400);
        await env.DB.batch(leaveUpsertStmts(env, me.id, date, leave_type_id, period));
        return json({ ok: true, employee_id: me.id, date, leave_type_id, period });
      }

      // 區間請假：一次批次寫入多天（前端已算好、週末/假日已略過）
      if (pathname === '/api/my-leaves/bulk' && method === 'POST') {
        const me = await meFromToken(env, token(request));
        if (!me) return json({ error: 'not_bound' }, 401);
        const { items = [] } = await request.json();
        if (!Array.isArray(items) || !items.length) return json({ error: 'empty' }, 400);
        const stmts = [];
        for (const it of items) {
          if (!it.date || !it.leave_type_id) continue;
          stmts.push(...leaveUpsertStmts(env, me.id, it.date, it.leave_type_id, it.period || 'full'));
        }
        await env.DB.batch(stmts);
        return json({ ok: true, count: stmts.length / 2 });
      }

      // 區間/連續段刪除：刪除本人指定的多筆 id（分批,避免一次轟 D1）
      if (pathname === '/api/my-leaves/delete' && method === 'POST') {
        const me = await meFromToken(env, token(request));
        if (!me) return json({ error: 'not_bound' }, 401);
        const { ids = [] } = await request.json();
        await runInBatches(ids, (id) =>
          env.DB.prepare('DELETE FROM leave_records WHERE id = ? AND employee_id = ?').bind(id, me.id).run());
        return json({ ok: true, count: ids.length });
      }

      const delMatch = pathname.match(/^\/api\/my-leaves\/(.+)$/);
      if (delMatch && method === 'DELETE') {
        const me = await meFromToken(env, token(request));
        if (!me) return json({ error: 'not_bound' }, 401);
        await env.DB.prepare('DELETE FROM leave_records WHERE id = ? AND employee_id = ?')
          .bind(delMatch[1], me.id)
          .run();
        return json({ ok: true });
      }

      // ── 管理端點（新增/刪除任一員工的休假、維護用資料）─────────────
      if (pathname === '/api/admin/meta' && method === 'GET') {
        if (!(await canAdmin(env, request))) return json({ error: 'unauthorized' }, 401);
        const [depts, emps, types] = await Promise.all([
          env.DB.prepare("SELECT id, name FROM departments WHERE status != 'hidden' ORDER BY sort_order").all(),
          env.DB.prepare("SELECT id, name, english_name, department_ids FROM employees WHERE status = 'active' ORDER BY sort_order").all(),
          env.DB.prepare('SELECT * FROM leave_types ORDER BY sort_order').all(),
        ]);
        return json({ departments: depts.results, employees: emps.results, leave_types: types.results });
      }

      if (pathname === '/api/admin/leaves' && method === 'GET') {
        if (!(await canAdmin(env, request))) return json({ error: 'unauthorized' }, 401);
        const empId = url.searchParams.get('employee_id');
        const year = url.searchParams.get('year');
        if (!empId) return json({ error: 'missing_employee_id' }, 400);
        let q = 'SELECT * FROM leave_records WHERE employee_id = ?';
        const binds = [empId];
        if (year) {
          q += ' AND date >= ? AND date <= ?';
          binds.push(`${year}-01-01`, `${year}-12-31`);
        }
        const r = await env.DB.prepare(q).bind(...binds).all();
        return json(r.results);
      }

      if (pathname === '/api/admin/leaves' && method === 'POST') {
        if (!(await canAdmin(env, request))) return json({ error: 'unauthorized' }, 401);
        const { employee_id, date, leave_type_id, period = 'full', note = null } = await request.json();
        if (!employee_id || !date || !leave_type_id) return json({ error: 'missing_fields' }, 400);
        await env.DB.batch(leaveUpsertStmts(env, employee_id, date, leave_type_id, period, note));
        return json({ ok: true, employee_id, date, leave_type_id, period });
      }

      // 管理端區間請假：批次寫入某員工多天
      if (pathname === '/api/admin/leaves/bulk' && method === 'POST') {
        if (!(await canAdmin(env, request))) return json({ error: 'unauthorized' }, 401);
        const { employee_id, items = [] } = await request.json();
        if (!employee_id || !Array.isArray(items) || !items.length) return json({ error: 'missing_fields' }, 400);
        const stmts = [];
        for (const it of items) {
          if (!it.date || !it.leave_type_id) continue;
          stmts.push(...leaveUpsertStmts(env, employee_id, it.date, it.leave_type_id, it.period || 'full', it.note || null));
        }
        await env.DB.batch(stmts);
        return json({ ok: true, count: stmts.length / 2 });
      }

      // 管理端多筆刪除（區間/連續段）
      if (pathname === '/api/admin/leaves/delete' && method === 'POST') {
        if (!(await canAdmin(env, request))) return json({ error: 'unauthorized' }, 401);
        const { ids = [] } = await request.json();
        await runInBatches(ids, (id) => env.DB.prepare('DELETE FROM leave_records WHERE id = ?').bind(id).run());
        return json({ ok: true, count: ids.length });
      }

      // 管理端依「員工 + 日期」刪除（全部排休的格子沒有 record id，用這個刪整格/整段）
      if (pathname === '/api/admin/leaves/delete-by-date' && method === 'POST') {
        if (!(await canAdmin(env, request))) return json({ error: 'unauthorized' }, 401);
        const { employee_id, dates = [], period } = await request.json();
        if (!employee_id || !dates.length) return json({ error: 'missing_fields' }, 400);
        await runInBatches(dates, (d) => period
          ? env.DB.prepare('DELETE FROM leave_records WHERE employee_id = ? AND date = ? AND period = ?').bind(employee_id, d, period).run()
          : env.DB.prepare('DELETE FROM leave_records WHERE employee_id = ? AND date = ?').bind(employee_id, d).run());
        return json({ ok: true, count: dates.length });
      }

      const adminDel = pathname.match(/^\/api\/admin\/leaves\/(.+)$/);
      if (adminDel && method === 'DELETE') {
        if (!(await canAdmin(env, request))) return json({ error: 'unauthorized' }, 401);
        await env.DB.prepare('DELETE FROM leave_records WHERE id = ?').bind(adminDel[1]).run();
        return json({ ok: true });
      }

      // ── 部門 CRUD ───────────────────────────────────────────────
      if (pathname === '/api/admin/departments' && method === 'GET') {
        if (!(await canAdmin(env, request))) return json({ error: 'unauthorized' }, 401);
        const r = await env.DB.prepare(
          `SELECT d.*, (SELECT COUNT(*) FROM employees e
              WHERE e.status='active' AND instr(e.department_ids, d.id) > 0) AS member_count
           FROM departments d WHERE d.status != 'hidden' ORDER BY d.sort_order`,
        ).all();
        return json(r.results);
      }
      if (pathname === '/api/admin/departments' && method === 'POST') {
        if (!(await canAdmin(env, request))) return json({ error: 'unauthorized' }, 401);
        const { name, sort_order = 0 } = await request.json();
        if (!name) return json({ error: 'missing_name' }, 400);
        const id = 'd_' + crypto.randomUUID().slice(0, 8);
        await env.DB.prepare('INSERT INTO departments (id, name, sort_order, status) VALUES (?,?,?,?)')
          .bind(id, name, sort_order, 'active').run();
        return json({ id, name, sort_order, status: 'active' });
      }
      const deptM = pathname.match(/^\/api\/admin\/departments\/(.+)$/);
      if (deptM && method === 'PUT') {
        if (!(await canAdmin(env, request))) return json({ error: 'unauthorized' }, 401);
        const b = await request.json();
        await env.DB.prepare(
          'UPDATE departments SET name = COALESCE(?,name), sort_order = COALESCE(?,sort_order), status = COALESCE(?,status) WHERE id = ?',
        ).bind(b.name ?? null, b.sort_order ?? null, b.status ?? null, deptM[1]).run();
        return json({ ok: true });
      }
      if (deptM && method === 'DELETE') {
        if (!(await canAdmin(env, request))) return json({ error: 'unauthorized' }, 401);
        await env.DB.prepare('DELETE FROM departments WHERE id = ?').bind(deptM[1]).run();
        return json({ ok: true });
      }

      // ── 員工 CRUD ───────────────────────────────────────────────
      if (pathname === '/api/admin/employees' && method === 'GET') {
        if (!(await canAdmin(env, request))) return json({ error: 'unauthorized' }, 401);
        const r = await env.DB.prepare(
          'SELECT id, name, english_name, department_ids, status, sort_order, deputy_1, deputy_2, role FROM employees ORDER BY sort_order, name',
        ).all();
        return json(r.results);
      }
      if (pathname === '/api/admin/employees' && method === 'POST') {
        if (!(await canAdmin(env, request))) return json({ error: 'unauthorized' }, 401);
        const { name, english_name = null, department_ids = [], status = 'active', sort_order = 0, deputy_1 = null, deputy_2 = null, role = 'user' } = await request.json();
        if (!name) return json({ error: 'missing_name' }, 400);
        const id = 'e_' + crypto.randomUUID().slice(0, 8);
        await env.DB.prepare(
          'INSERT INTO employees (id, name, english_name, department_ids, status, sort_order, deputy_1, deputy_2, role) VALUES (?,?,?,?,?,?,?,?,?)',
        ).bind(id, name, english_name, JSON.stringify(department_ids || []), status, sort_order, deputy_1 || null, deputy_2 || null, role).run();
        return json({ id });
      }
      // 批次更新（統一改部門 / 狀態；未給的欄位不動）
      if (pathname === '/api/admin/employees/bulk' && method === 'POST') {
        if (!(await canAdmin(env, request))) return json({ error: 'unauthorized' }, 401);
        const { ids = [], department_ids, status } = await request.json();
        if (!ids.length) return json({ error: 'empty' }, 400);
        const dids = department_ids !== undefined ? JSON.stringify(department_ids || []) : null;
        await runInBatches(ids, (id) =>
          env.DB.prepare('UPDATE employees SET department_ids = COALESCE(?,department_ids), status = COALESCE(?,status) WHERE id = ?')
            .bind(dids, status ?? null, id).run());
        if (status === 'inactive') await runInBatches(ids, (id) => clearDeputyRefs(env, id));
        return json({ ok: true, count: ids.length });
      }
      // 批次刪除（含職代參照清理）
      if (pathname === '/api/admin/employees/delete' && method === 'POST') {
        if (!(await canAdmin(env, request))) return json({ error: 'unauthorized' }, 401);
        const { ids = [] } = await request.json();
        await runInBatches(ids, async (id) => {
          await clearDeputyRefs(env, id);
          await env.DB.prepare('DELETE FROM leave_records WHERE employee_id = ?').bind(id).run();
          await env.DB.prepare('DELETE FROM employees WHERE id = ?').bind(id).run();
        });
        return json({ ok: true, count: ids.length });
      }
      const empM = pathname.match(/^\/api\/admin\/employees\/(.+)$/);
      if (empM && method === 'PUT') {
        if (!(await canAdmin(env, request))) return json({ error: 'unauthorized' }, 401);
        const b = await request.json();
        const dids = b.department_ids !== undefined ? JSON.stringify(b.department_ids || []) : null;
        await env.DB.prepare(
          `UPDATE employees SET name = COALESCE(?,name), english_name = COALESCE(?,english_name),
             department_ids = COALESCE(?,department_ids), status = COALESCE(?,status),
             sort_order = COALESCE(?,sort_order), deputy_1 = ?, deputy_2 = ?, role = COALESCE(?,role) WHERE id = ?`,
        ).bind(b.name ?? null, b.english_name ?? null, dids, b.status ?? null, b.sort_order ?? null,
          b.deputy_1 ?? null, b.deputy_2 ?? null, b.role ?? null, empM[1]).run();
        if (b.status === 'inactive') await clearDeputyRefs(env, empM[1]); // 離職→清理別人指向他的職代
        return json({ ok: true });
      }
      if (empM && method === 'DELETE') {
        if (!(await canAdmin(env, request))) return json({ error: 'unauthorized' }, 401);
        await clearDeputyRefs(env, empM[1]); // 刪除→清理懸空職代參照
        await env.DB.prepare('DELETE FROM leave_records WHERE employee_id = ?').bind(empM[1]).run();
        await env.DB.prepare('DELETE FROM employees WHERE id = ?').bind(empM[1]).run();
        return json({ ok: true });
      }

      // ── 假別 CRUD ───────────────────────────────────────────────
      if (pathname === '/api/admin/leave-types' && method === 'GET') {
        if (!(await canAdmin(env, request))) return json({ error: 'unauthorized' }, 401);
        const r = await env.DB.prepare('SELECT * FROM leave_types ORDER BY sort_order').all();
        return json(r.results);
      }
      if (pathname === '/api/admin/leave-types' && method === 'POST') {
        if (!(await canAdmin(env, request))) return json({ error: 'unauthorized' }, 401);
        const { name, short_name = null, color = '#64748b', sort_order = 0 } = await request.json();
        if (!name) return json({ error: 'missing_name' }, 400);
        const id = 'lt_' + crypto.randomUUID().slice(0, 8);
        await env.DB.prepare('INSERT INTO leave_types (id, name, short_name, color, sort_order) VALUES (?,?,?,?,?)')
          .bind(id, name, short_name, color, sort_order).run();
        return json({ id });
      }
      const ltM = pathname.match(/^\/api\/admin\/leave-types\/(.+)$/);
      if (ltM && method === 'PUT') {
        if (!(await canAdmin(env, request))) return json({ error: 'unauthorized' }, 401);
        const b = await request.json();
        await env.DB.prepare(
          'UPDATE leave_types SET name = COALESCE(?,name), short_name = COALESCE(?,short_name), color = COALESCE(?,color), sort_order = COALESCE(?,sort_order) WHERE id = ?',
        ).bind(b.name ?? null, b.short_name ?? null, b.color ?? null, b.sort_order ?? null, ltM[1]).run();
        return json({ ok: true });
      }
      if (ltM && method === 'DELETE') {
        if (!(await canAdmin(env, request))) return json({ error: 'unauthorized' }, 401);
        await env.DB.prepare('DELETE FROM leave_types WHERE id = ?').bind(ltM[1]).run();
        return json({ ok: true });
      }

      // ── 假日 CRUD ───────────────────────────────────────────────
      if (pathname === '/api/admin/holidays' && method === 'GET') {
        if (!(await canAdmin(env, request))) return json({ error: 'unauthorized' }, 401);
        const year = url.searchParams.get('year');
        let q = 'SELECT * FROM holidays';
        const binds = [];
        if (year) { q += ' WHERE date >= ? AND date <= ?'; binds.push(`${year}-01-01`, `${year}-12-31`); }
        q += ' ORDER BY date';
        const r = await env.DB.prepare(q).bind(...binds).all();
        return json(r.results);
      }
      if (pathname === '/api/admin/holidays' && method === 'POST') {
        if (!(await canAdmin(env, request))) return json({ error: 'unauthorized' }, 401);
        const { date, name = null, type = 'national' } = await request.json();
        if (!date) return json({ error: 'missing_date' }, 400);
        await env.DB.prepare('DELETE FROM holidays WHERE date = ?').bind(date).run();
        const id = 'h_' + crypto.randomUUID().slice(0, 8);
        await env.DB.prepare('INSERT INTO holidays (id, date, name, type) VALUES (?,?,?,?)')
          .bind(id, date, name, type).run();
        return json({ id, date, name, type });
      }
      const holM = pathname.match(/^\/api\/admin\/holidays\/(.+)$/);
      if (holM && method === 'DELETE') {
        if (!(await canAdmin(env, request))) return json({ error: 'unauthorized' }, 401);
        await env.DB.prepare('DELETE FROM holidays WHERE id = ?').bind(holM[1]).run();
        return json({ ok: true });
      }

      // 清理重複休假紀錄(同員工+日期+時段+假別只留一筆)
      if (pathname === '/api/admin/dedupe-leaves' && method === 'POST') {
        if (!(await canAdmin(env, request))) return json({ error: 'unauthorized' }, 401);
        const r = await env.DB.prepare(
          'DELETE FROM leave_records WHERE rowid NOT IN (SELECT MIN(rowid) FROM leave_records GROUP BY employee_id, date, period, leave_type_id)',
        ).run();
        return json({ ok: true, removed: r.meta ? r.meta.changes : 0 });
      }

      // ── 當日儀表板 ──────────────────────────────────────────────
      if (pathname === '/api/dashboard' && method === 'GET') {
        const now = new Date();
        const date = url.searchParams.get('date') || `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
        const dept = url.searchParams.get('dept') || '';
        return json(await buildDashboard(env, date, dept));
      }

      // ── 儀表板統計 ──────────────────────────────────────────────
      if (pathname === '/api/stats' && method === 'GET') {
        const now = new Date();
        const year = Number(url.searchParams.get('year')) || now.getFullYear();
        return json(await buildStats(env, year));
      }

      // ── DPC 同步（Base44 → D1，單向、只動 DPC）─────────────────────
      if (pathname === '/api/sync' && method === 'POST') {
        const secret = env.SYNC_SECRET;
        if (secret && request.headers.get('X-Sync-Secret') !== secret) {
          return json({ error: 'unauthorized' }, 401);
        }
        const r = await runSync(env);
        return json(r, r.ok ? 200 : 500);
      }
      if (pathname === '/api/sync/status' && method === 'GET') {
        const row = await env.DB.prepare("SELECT v, updated_at FROM kv WHERE k = 'last_dpc_sync'").first();
        if (!row) return json({ ok: null, never: true });
        let v = {};
        try { v = JSON.parse(row.v); } catch {}
        return json({ ...v, updated_at: row.updated_at });
      }

      return json({ error: 'not_found' }, 404);
    } catch (e) {
      return json({ error: String(e && e.message ? e.message : e) }, 500);
    }
  },

  // Cron 定時觸發（見 wrangler.toml [triggers]）：定時把 Base44 的 DPC 灌進 D1。
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runSync(env));
  },
};

async function buildCalendar(env, year, month) {
  const [depts, emps, types, recs, hols] = await Promise.all([
    env.DB.prepare("SELECT * FROM departments WHERE status != 'hidden' ORDER BY sort_order").all(),
    env.DB.prepare("SELECT * FROM employees WHERE status = 'active' ORDER BY sort_order").all(),
    env.DB.prepare('SELECT * FROM leave_types ORDER BY sort_order').all(),
    env.DB.prepare('SELECT * FROM leave_records').all(),
    env.DB.prepare('SELECT date FROM holidays').all(),
  ]);

  const typeById = Object.fromEntries(types.results.map((t) => [t.id, t]));
  const legend = {};
  for (const t of types.results) legend[t.short_name || t.name] = t.color || '#64748b';

  // 每人每日可同時有 full / am / pm 三格（AM+PM 可並存），分槽存放。
  // 同時計算「年度累計休假日」，規則同原 Excel 公式：
  // COUNTIF(休) + 0.5*(午休+早休+上午休+下午休)；差/病/員旅/健等其他假別不計。
  const leavesByEmp = {};
  const yearTotals = {};
  const yearPrefix = String(year) + '-';
  for (const r of recs.results) {
    const t = typeById[r.leave_type_id];
    const slot = r.period === 'morning' ? 'am' : r.period === 'afternoon' ? 'pm' : 'full';
    const label = t ? t.short_name || t.name : '休';
    const cell = { label, period: r.period || 'full', color: t ? t.color || '#64748b' : '#64748b' };
    const days = (leavesByEmp[r.employee_id] ||= {});
    (days[r.date] ||= {})[slot] = cell;
    if (r.date && r.date.startsWith(yearPrefix)) {
      let w = 0;
      if (label === '休') w = slot === 'full' ? 1 : 0.5;
      else if (/午休|早休/.test(label)) w = 0.5;
      if (w) yearTotals[r.employee_id] = (yearTotals[r.employee_id] || 0) + w;
    }
  }

  const departments = depts.results
    .map((d) => ({
      name: d.name,
      members: emps.results
        .filter((e) => safeIds(e.department_ids).includes(d.id))
        .map((e) => ({ id: e.id, name: e.name, code: e.english_name || '', leaves: leavesByEmp[e.id] || {} })),
    }))
    .filter((d) => d.members.length > 0);

  return {
    title: '開發處休假表',
    year,
    month,
    updated_at: new Date().toISOString(),
    legend,
    holidays: [...new Set(hols.results.map((h) => h.date).filter(Boolean))],
    departments,
    year_totals: yearTotals,
  };
}

function safeIds(s) {
  try {
    const v = JSON.parse(s || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// ── DPC 同步：Base44 為真相來源，單向灌進 D1 ──────────────────────────
// 只動 DPC 部門的 department/employees/leave_records。
// 假別(leave_types)與假日(holidays)「不同步」，改由休假設定頁手動維護。
// 保留每位員工的 device_token（me.html 綁定用）。
const D1_DPC_DEPT = 'd_dpc';

async function base44(env, entity, q) {
  const api = env.BASE44_API_URL || 'https://app-67c8f9d9.base44.app/api';
  const url = new URL(`${api}/entities/${entity}`);
  if (q) url.searchParams.set('q', JSON.stringify(q));
  url.searchParams.set('limit', '10000');
  const res = await fetch(url, {
    headers: { api_key: env.BASE44_API_KEY, 'X-App-Id': env.BASE44_APP_ID || '693bb4665c3a400767c8f9d9' },
  });
  if (!res.ok) throw new Error(`Base44 ${entity} HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

// 由假別簡稱推半天時段（與前端一致）：含「早」=上午、含「午」=下午、否則整天。
function periodFromShort(short) {
  if (/早/.test(short || '')) return 'morning';
  if (/午/.test(short || '')) return 'afternoon';
  return 'full';
}

// 執行同步並把結果寫進 kv（last_dpc_sync），失敗也記錄，永不丟例外給呼叫端。
async function runSync(env) {
  try {
    const summary = await syncFromBase44(env);
    const v = JSON.stringify({ ok: true, ...summary });
    await env.DB.prepare(
      "INSERT INTO kv (k, v, updated_at) VALUES ('last_dpc_sync', ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at",
    ).bind(v, Date.now()).run();
    return { ok: true, ...summary };
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    const v = JSON.stringify({ ok: false, error: msg });
    try {
      await env.DB.prepare(
        "INSERT INTO kv (k, v, updated_at) VALUES ('last_dpc_sync', ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at",
      ).bind(v, Date.now()).run();
    } catch {}
    return { ok: false, error: msg };
  }
}

async function syncFromBase44(env) {
  if (!env.BASE44_API_KEY) throw new Error('缺少 BASE44_API_KEY（請用 wrangler secret put 設定）');
  const deptName = env.DPC_DEPT_NAME || 'DPC';
  const displayName = env.DPC_DISPLAY_NAME || 'DPC';
  const year = new Date().getFullYear();
  const start = `${year}-01-01`;
  const end = `${year + 1}-12-31`;

  // 仍抓 LeaveType 只為了推算半天時段；不寫回 D1。假日完全不抓。
  const [departments, employeesAll, leaveTypes, records] = await Promise.all([
    base44(env, 'Department'),
    base44(env, 'Employee'),
    base44(env, 'LeaveType'),
    base44(env, 'LeaveRecord', { date: { $gte: start, $lte: end } }),
  ]);

  if (!Array.isArray(employeesAll) || employeesAll.length === 0) {
    throw new Error('Base44 回傳的員工清單為空，為安全起見中止同步');
  }
  const dpcDept = departments.find((d) => d.name === deptName);
  if (!dpcDept) throw new Error(`在 Base44 找不到部門「${deptName}」`);

  const emps = employeesAll
    // 排除離職/隱藏；保留育嬰假（仍顯示於人員管理，但月曆只取 active）
    .filter((e) => (e.department_ids || []).includes(dpcDept.id) && !['inactive', 'hidden'].includes(e.status))
    .sort((a, b) => (a.sort_order_by_dept?.[dpcDept.id] ?? 9e9) - (b.sort_order_by_dept?.[dpcDept.id] ?? 9e9));
  const dpcEmpIds = new Set(emps.map((e) => e.id));
  const ltById = Object.fromEntries(leaveTypes.map((t) => [t.id, t]));
  const dpcRecords = records.filter((r) => dpcEmpIds.has(r.employee_id));

  const stmts = [];

  // 1) DPC 部門（upsert）
  stmts.push(
    env.DB.prepare(
      'INSERT INTO departments (id,name,sort_order,status) VALUES (?,?,?,?) ' +
        'ON CONFLICT(id) DO UPDATE SET name=excluded.name, sort_order=excluded.sort_order, status=excluded.status',
    ).bind(D1_DPC_DEPT, displayName, dpcDept.sort_order ?? 10, 'active'),
  );

  // 假別與假日「不同步」：略過，保留休假設定頁手動維護的內容。

  // 2) 先清掉現有 DPC 員工的休假紀錄（待會重灌）
  stmts.push(
    env.DB.prepare("DELETE FROM leave_records WHERE employee_id IN (SELECT id FROM employees WHERE instr(department_ids, ?) > 0)").bind(D1_DPC_DEPT),
  );

  // 3) 刪掉已不在 Base44 DPC 名單裡的舊 DPC 員工（保留仍在的人 → device_token 不動）
  if (emps.length) {
    const ph = emps.map(() => '?').join(',');
    stmts.push(
      env.DB.prepare(`DELETE FROM employees WHERE instr(department_ids, ?) > 0 AND id NOT IN (${ph})`)
        .bind(D1_DPC_DEPT, ...emps.map((e) => e.id)),
    );
  }

  // 4) Upsert DPC 員工（用 Base44 id 當 D1 id；保留真實 status；UPDATE 不碰 device_token）
  emps.forEach((e, i) => {
    stmts.push(
      env.DB.prepare(
        'INSERT INTO employees (id,name,english_name,department_ids,status,sort_order,deputy_1,deputy_2) VALUES (?,?,?,?,?,?,?,?) ' +
          'ON CONFLICT(id) DO UPDATE SET name=excluded.name, english_name=excluded.english_name, department_ids=excluded.department_ids, status=excluded.status, sort_order=excluded.sort_order, deputy_1=excluded.deputy_1, deputy_2=excluded.deputy_2',
      ).bind(e.id, e.name, e.english_name || '', JSON.stringify([D1_DPC_DEPT]), e.status || 'active', (i + 1) * 10, e.deputy_1 || null, e.deputy_2 || null),
    );
  });

  // 5) 重灌 DPC 休假紀錄
  for (const r of dpcRecords) {
    const lt = ltById[r.leave_type_id];
    const period = r.period || periodFromShort(lt ? lt.short_name : '');
    stmts.push(
      env.DB.prepare('INSERT INTO leave_records (id,employee_id,date,leave_type_id,period,note) VALUES (?,?,?,?,?,?)')
        .bind(r.id || crypto.randomUUID(), r.employee_id, r.date, r.leave_type_id, period, r.note || null),
    );
  }

  await env.DB.batch(stmts);

  return {
    at: new Date().toISOString(),
    department: displayName,
    employees: emps.length,
    leave_records: dpcRecords.length,
  };
}

// 一筆休假折算成「天數」：整天=1、半天(上/下午)=0.5。
function leaveDays(period) {
  return period === 'morning' || period === 'afternoon' ? 0.5 : 1;
}

// 警示檢查：對某員工在多個日期,算出「職代當天也請假」與「部門當天請假達 1/3」。
async function buildLeaveCheck(env, empId, dates) {
  const emp = await env.DB.prepare('SELECT id, department_ids, deputy_1, deputy_2 FROM employees WHERE id = ?').bind(empId).first();
  if (!emp) return { results: {} };
  const deptId = safeIds(emp.department_ids)[0] || null;
  const all = await env.DB.prepare("SELECT id, name, department_ids FROM employees WHERE status = 'active'").all();
  const nameById = Object.fromEntries(all.results.map((e) => [e.id, e.name]));
  const deptMemberIds = new Set(all.results.filter((e) => deptId && safeIds(e.department_ids).includes(deptId)).map((e) => e.id));
  const threshold = Math.floor(deptMemberIds.size / 3);
  const deputies = [emp.deputy_1, emp.deputy_2].filter(Boolean);

  const ph = dates.map(() => '?').join(',');
  const recs = await env.DB.prepare(`SELECT DISTINCT employee_id, date FROM leave_records WHERE date IN (${ph})`).bind(...dates).all();
  const byDate = {};
  for (const r of recs.results) (byDate[r.date] ||= new Set()).add(r.employee_id);

  const results = {};
  for (const d of dates) {
    const onLeave = byDate[d] || new Set();
    const dep = deputies.filter((id) => id !== empId && onLeave.has(id)).map((id) => nameById[id] || '職代');
    const deptCount = [...onLeave].filter((id) => id !== empId && deptMemberIds.has(id)).length;
    results[d] = { deputies: dep, dept_count: deptCount, over: threshold > 0 && deptCount >= threshold };
  }
  return { threshold, dept_size: deptMemberIds.size, results };
}

async function buildDashboard(env, date, deptParam) {
  const deptIds = (deptParam || '').split(',').filter(Boolean);
  const [emps, depts, types, recs, hol] = await Promise.all([
    env.DB.prepare("SELECT id, name, english_name, department_ids, deputy_1, deputy_2 FROM employees WHERE status = 'active'").all(),
    env.DB.prepare("SELECT id, name FROM departments WHERE status != 'hidden' ORDER BY sort_order").all(),
    env.DB.prepare('SELECT * FROM leave_types').all(),
    env.DB.prepare('SELECT * FROM leave_records WHERE date = ?').bind(date).all(),
    env.DB.prepare('SELECT 1 FROM holidays WHERE date = ? LIMIT 1').bind(date).first(),
  ]);

  const typeById = Object.fromEntries(types.results.map((t) => [t.id, t]));
  const deptById = Object.fromEntries(depts.results.map((d) => [d.id, d]));
  const empByIdAll = Object.fromEntries(emps.results.map((e) => [e.id, e]));
  const inScope = (e) => !deptIds.length || safeIds(e.department_ids).some((id) => deptIds.includes(id));
  const isBiz = (tid) => { const t = typeById[tid]; return /差/.test(t ? (t.short_name || t.name || '') : ''); };

  // 非工作日（週末 / 國定假日）：應到 0、出勤率不計
  const dow = new Date(date + 'T00:00:00').getDay();
  const isNonWorking = dow === 0 || dow === 6 || !!hol;

  const scoped = emps.results.filter(inScope);
  const scopedIds = new Set(scoped.map((e) => e.id));
  const expected = isNonWorking ? 0 : scoped.length;

  // 當日所有人(全公司)的請假，供職代衝突判斷
  const leavesByEmp = {};
  for (const r of recs.results) (leavesByEmp[r.employee_id] ||= []).push(r);
  const onLeaveAll = new Set(recs.results.map((r) => r.employee_id));

  const byType = {};
  const onLeaveList = [];
  const onLeaveEmp = new Set();
  for (const r of recs.results) {
    if (!scopedIds.has(r.employee_id)) continue;
    const e = empByIdAll[r.employee_id];
    onLeaveEmp.add(e.id);
    const t = typeById[r.leave_type_id];
    const label = t ? t.short_name || t.name : '休';
    const color = t ? t.color || '#64748b' : '#64748b';
    (byType[r.leave_type_id || '?'] ||= { name: t ? t.name : '未分類', short_name: label, color, count: 0 }).count += 1;
    const dept = safeIds(e.department_ids).map((id) => (deptById[id] || {}).name).filter(Boolean).join('、');
    onLeaveList.push({ name: e.name, english_name: e.english_name || '', department: dept, label, period: r.period || 'full', color });
  }

  // 每部門當日請假人數 + 在職數(算 1/3 上限)
  const deptActive = {}, deptOnLeave = {};
  for (const e of emps.results) for (const id of safeIds(e.department_ids)) deptActive[id] = (deptActive[id] || 0) + 1;
  for (const id of onLeaveAll) { const e = empByIdAll[id]; if (e) for (const d of safeIds(e.department_ids)) (deptOnLeave[d] ||= new Set()).add(id); }

  // 異常請假：即時重算(不信舊旗標)。職代當天也請假 / 部門當天達 1/3。出差不算。
  const warnings = [];
  for (const e of scoped) {
    const myLeaves = leavesByEmp[e.id]; if (!myLeaves) continue;
    if (myLeaves.every((r) => isBiz(r.leave_type_id))) continue; // 全是出差→略過
    const reasons = [];
    const deps = [e.deputy_1, e.deputy_2].filter(Boolean).filter((id) => onLeaveAll.has(id) && (leavesByEmp[id] || []).some((r) => !isBiz(r.leave_type_id)));
    if (deps.length) reasons.push(`職代 ${deps.map((id) => (empByIdAll[id] || {}).name || '?').join('、')} 當天也請假`);
    for (const d of safeIds(e.department_ids)) {
      const lim = Math.floor((deptActive[d] || 0) / 3);
      const cnt = (deptOnLeave[d] || new Set()).size;
      if (lim > 0 && cnt >= lim) { reasons.push(`${(deptById[d] || {}).name || '部門'}當天請假 ${cnt} 人(達 1/3 上限)`); break; }
    }
    if (reasons.length) warnings.push({ name: e.name, english_name: e.english_name || '', reasons });
  }

  const onCount = onLeaveEmp.size;
  const onDuty = Math.max(0, expected - onCount);
  const rate = expected > 0 ? Math.round((onDuty / expected) * 1000) / 10 : 100;

  return {
    date,
    is_non_working: isNonWorking,
    expected,
    on_duty: onDuty,
    on_leave_count: onCount,
    attendance_rate: rate,
    by_type: Object.values(byType).sort((a, b) => b.count - a.count),
    on_leave_list: onLeaveList,
    warnings,
    departments: depts.results,
    updated_at: new Date().toISOString(),
  };
}

async function buildStats(env, year) {
  const [emps, depts, types, recs] = await Promise.all([
    env.DB.prepare("SELECT id, name, english_name, department_ids FROM employees WHERE status = 'active'").all(),
    env.DB.prepare("SELECT id, name FROM departments WHERE status != 'hidden' ORDER BY sort_order").all(),
    env.DB.prepare('SELECT * FROM leave_types ORDER BY sort_order').all(),
    env.DB.prepare('SELECT * FROM leave_records WHERE date >= ? AND date <= ?')
      .bind(`${year}-01-01`, `${year}-12-31`).all(),
  ]);

  const empById = Object.fromEntries(emps.results.map((e) => [e.id, e]));
  const deptById = Object.fromEntries(depts.results.map((d) => [d.id, d]));
  const typeById = Object.fromEntries(types.results.map((t) => [t.id, t]));

  const byType = {};
  const byDept = {};
  const byEmp = {};
  const byMonth = Array.from({ length: 12 }, () => 0);
  let total = 0;

  for (const r of recs.results) {
    const days = leaveDays(r.period);
    total += days;

    const m = Number((r.date || '').slice(5, 7));
    if (m >= 1 && m <= 12) byMonth[m - 1] += days;

    const t = typeById[r.leave_type_id];
    const tKey = t ? t.id : 'unknown';
    (byType[tKey] ||= { name: t ? t.name : '未分類', short_name: t ? t.short_name : '?', color: t ? t.color || '#64748b' : '#64748b', days: 0 }).days += days;

    const e = empById[r.employee_id];
    if (e) {
      (byEmp[e.id] ||= { name: e.name, english_name: e.english_name || '', days: 0 }).days += days;
      // 一個人可能屬多個部門：天數記入其每個部門。
      const dids = safeIds(e.department_ids);
      const targets = dids.length ? dids : ['_none'];
      for (const did of targets) {
        const d = deptById[did];
        const key = d ? d.id : '_none';
        (byDept[key] ||= { name: d ? d.name : '未分組', days: 0 }).days += days;
      }
    }
  }

  const sortDesc = (o) => Object.values(o).sort((a, b) => b.days - a.days);

  return {
    year,
    total_days: total,
    by_type: types.results.map((t) => byType[t.id] || { name: t.name, short_name: t.short_name, color: t.color || '#64748b', days: 0 }),
    by_department: sortDesc(byDept),
    by_employee: sortDesc(byEmp),
    by_month: byMonth,
    updated_at: new Date().toISOString(),
  };
}
