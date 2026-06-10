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
  'Access-Control-Allow-Headers': 'Content-Type, X-Device-Token, X-Admin-Key',
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

// 管理權限：未設定 ADMIN_KEY 環境變數時開放（內部低風險用途）；
// 設定後則需請求帶 X-Admin-Key 且相符。
function adminOk(env, request) {
  const key = env.ADMIN_KEY;
  if (!key) return true;
  return request.headers.get('X-Admin-Key') === key;
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
        return json({ id: me.id, name: me.name, english_name: me.english_name });
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
        // 同一天同時段先清掉再寫，避免重複
        await env.DB.prepare(
          'DELETE FROM leave_records WHERE employee_id = ? AND date = ? AND period = ?',
        ).bind(me.id, date, period).run();
        const id = crypto.randomUUID();
        await env.DB.prepare(
          'INSERT INTO leave_records (id, employee_id, date, leave_type_id, period) VALUES (?,?,?,?,?)',
        ).bind(id, me.id, date, leave_type_id, period).run();
        return json({ id, employee_id: me.id, date, leave_type_id, period });
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
        if (!adminOk(env, request)) return json({ error: 'unauthorized' }, 401);
        const [depts, emps, types] = await Promise.all([
          env.DB.prepare("SELECT id, name FROM departments WHERE status != 'hidden' ORDER BY sort_order").all(),
          env.DB.prepare("SELECT id, name, english_name, department_ids FROM employees WHERE status = 'active' ORDER BY sort_order").all(),
          env.DB.prepare('SELECT * FROM leave_types ORDER BY sort_order').all(),
        ]);
        return json({ departments: depts.results, employees: emps.results, leave_types: types.results });
      }

      if (pathname === '/api/admin/leaves' && method === 'GET') {
        if (!adminOk(env, request)) return json({ error: 'unauthorized' }, 401);
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
        if (!adminOk(env, request)) return json({ error: 'unauthorized' }, 401);
        const { employee_id, date, leave_type_id, period = 'full', note = null } = await request.json();
        if (!employee_id || !date || !leave_type_id) return json({ error: 'missing_fields' }, 400);
        await env.DB.prepare(
          'DELETE FROM leave_records WHERE employee_id = ? AND date = ? AND period = ?',
        ).bind(employee_id, date, period).run();
        const id = crypto.randomUUID();
        await env.DB.prepare(
          'INSERT INTO leave_records (id, employee_id, date, leave_type_id, period, note) VALUES (?,?,?,?,?,?)',
        ).bind(id, employee_id, date, leave_type_id, period, note).run();
        return json({ id, employee_id, date, leave_type_id, period, note });
      }

      const adminDel = pathname.match(/^\/api\/admin\/leaves\/(.+)$/);
      if (adminDel && method === 'DELETE') {
        if (!adminOk(env, request)) return json({ error: 'unauthorized' }, 401);
        await env.DB.prepare('DELETE FROM leave_records WHERE id = ?').bind(adminDel[1]).run();
        return json({ ok: true });
      }

      // ── 部門 CRUD ───────────────────────────────────────────────
      if (pathname === '/api/admin/departments' && method === 'GET') {
        if (!adminOk(env, request)) return json({ error: 'unauthorized' }, 401);
        const r = await env.DB.prepare(
          `SELECT d.*, (SELECT COUNT(*) FROM employees e
              WHERE e.status='active' AND instr(e.department_ids, d.id) > 0) AS member_count
           FROM departments d WHERE d.status != 'hidden' ORDER BY d.sort_order`,
        ).all();
        return json(r.results);
      }
      if (pathname === '/api/admin/departments' && method === 'POST') {
        if (!adminOk(env, request)) return json({ error: 'unauthorized' }, 401);
        const { name, sort_order = 0 } = await request.json();
        if (!name) return json({ error: 'missing_name' }, 400);
        const id = 'd_' + crypto.randomUUID().slice(0, 8);
        await env.DB.prepare('INSERT INTO departments (id, name, sort_order, status) VALUES (?,?,?,?)')
          .bind(id, name, sort_order, 'active').run();
        return json({ id, name, sort_order, status: 'active' });
      }
      const deptM = pathname.match(/^\/api\/admin\/departments\/(.+)$/);
      if (deptM && method === 'PUT') {
        if (!adminOk(env, request)) return json({ error: 'unauthorized' }, 401);
        const b = await request.json();
        await env.DB.prepare(
          'UPDATE departments SET name = COALESCE(?,name), sort_order = COALESCE(?,sort_order), status = COALESCE(?,status) WHERE id = ?',
        ).bind(b.name ?? null, b.sort_order ?? null, b.status ?? null, deptM[1]).run();
        return json({ ok: true });
      }
      if (deptM && method === 'DELETE') {
        if (!adminOk(env, request)) return json({ error: 'unauthorized' }, 401);
        await env.DB.prepare('DELETE FROM departments WHERE id = ?').bind(deptM[1]).run();
        return json({ ok: true });
      }

      // ── 員工 CRUD ───────────────────────────────────────────────
      if (pathname === '/api/admin/employees' && method === 'GET') {
        if (!adminOk(env, request)) return json({ error: 'unauthorized' }, 401);
        const r = await env.DB.prepare(
          'SELECT id, name, english_name, department_ids, status, sort_order FROM employees ORDER BY sort_order, name',
        ).all();
        return json(r.results);
      }
      if (pathname === '/api/admin/employees' && method === 'POST') {
        if (!adminOk(env, request)) return json({ error: 'unauthorized' }, 401);
        const { name, english_name = null, department_ids = [], status = 'active', sort_order = 0 } = await request.json();
        if (!name) return json({ error: 'missing_name' }, 400);
        const id = 'e_' + crypto.randomUUID().slice(0, 8);
        await env.DB.prepare(
          'INSERT INTO employees (id, name, english_name, department_ids, status, sort_order) VALUES (?,?,?,?,?,?)',
        ).bind(id, name, english_name, JSON.stringify(department_ids || []), status, sort_order).run();
        return json({ id });
      }
      const empM = pathname.match(/^\/api\/admin\/employees\/(.+)$/);
      if (empM && method === 'PUT') {
        if (!adminOk(env, request)) return json({ error: 'unauthorized' }, 401);
        const b = await request.json();
        const dids = b.department_ids !== undefined ? JSON.stringify(b.department_ids || []) : null;
        await env.DB.prepare(
          `UPDATE employees SET name = COALESCE(?,name), english_name = COALESCE(?,english_name),
             department_ids = COALESCE(?,department_ids), status = COALESCE(?,status),
             sort_order = COALESCE(?,sort_order) WHERE id = ?`,
        ).bind(b.name ?? null, b.english_name ?? null, dids, b.status ?? null, b.sort_order ?? null, empM[1]).run();
        return json({ ok: true });
      }
      if (empM && method === 'DELETE') {
        if (!adminOk(env, request)) return json({ error: 'unauthorized' }, 401);
        await env.DB.prepare('DELETE FROM leave_records WHERE employee_id = ?').bind(empM[1]).run();
        await env.DB.prepare('DELETE FROM employees WHERE id = ?').bind(empM[1]).run();
        return json({ ok: true });
      }

      // ── 假別 CRUD ───────────────────────────────────────────────
      if (pathname === '/api/admin/leave-types' && method === 'GET') {
        if (!adminOk(env, request)) return json({ error: 'unauthorized' }, 401);
        const r = await env.DB.prepare('SELECT * FROM leave_types ORDER BY sort_order').all();
        return json(r.results);
      }
      if (pathname === '/api/admin/leave-types' && method === 'POST') {
        if (!adminOk(env, request)) return json({ error: 'unauthorized' }, 401);
        const { name, short_name = null, color = '#64748b', sort_order = 0 } = await request.json();
        if (!name) return json({ error: 'missing_name' }, 400);
        const id = 'lt_' + crypto.randomUUID().slice(0, 8);
        await env.DB.prepare('INSERT INTO leave_types (id, name, short_name, color, sort_order) VALUES (?,?,?,?,?)')
          .bind(id, name, short_name, color, sort_order).run();
        return json({ id });
      }
      const ltM = pathname.match(/^\/api\/admin\/leave-types\/(.+)$/);
      if (ltM && method === 'PUT') {
        if (!adminOk(env, request)) return json({ error: 'unauthorized' }, 401);
        const b = await request.json();
        await env.DB.prepare(
          'UPDATE leave_types SET name = COALESCE(?,name), short_name = COALESCE(?,short_name), color = COALESCE(?,color), sort_order = COALESCE(?,sort_order) WHERE id = ?',
        ).bind(b.name ?? null, b.short_name ?? null, b.color ?? null, b.sort_order ?? null, ltM[1]).run();
        return json({ ok: true });
      }
      if (ltM && method === 'DELETE') {
        if (!adminOk(env, request)) return json({ error: 'unauthorized' }, 401);
        await env.DB.prepare('DELETE FROM leave_types WHERE id = ?').bind(ltM[1]).run();
        return json({ ok: true });
      }

      // ── 假日 CRUD ───────────────────────────────────────────────
      if (pathname === '/api/admin/holidays' && method === 'GET') {
        if (!adminOk(env, request)) return json({ error: 'unauthorized' }, 401);
        const year = url.searchParams.get('year');
        let q = 'SELECT * FROM holidays';
        const binds = [];
        if (year) { q += ' WHERE date >= ? AND date <= ?'; binds.push(`${year}-01-01`, `${year}-12-31`); }
        q += ' ORDER BY date';
        const r = await env.DB.prepare(q).bind(...binds).all();
        return json(r.results);
      }
      if (pathname === '/api/admin/holidays' && method === 'POST') {
        if (!adminOk(env, request)) return json({ error: 'unauthorized' }, 401);
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
        if (!adminOk(env, request)) return json({ error: 'unauthorized' }, 401);
        await env.DB.prepare('DELETE FROM holidays WHERE id = ?').bind(holM[1]).run();
        return json({ ok: true });
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

      return json({ error: 'not_found' }, 404);
    } catch (e) {
      return json({ error: String(e && e.message ? e.message : e) }, 500);
    }
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

  const leavesByEmp = {};
  for (const r of recs.results) {
    const t = typeById[r.leave_type_id];
    // 帶上 period（full/morning/afternoon），讓總表能以半格呈現半天假。
    (leavesByEmp[r.employee_id] ||= {})[r.date] = {
      label: t ? t.short_name || t.name : '休',
      period: r.period || 'full',
      color: t ? t.color || '#64748b' : '#64748b',
    };
  }

  const departments = depts.results
    .map((d) => ({
      name: d.name,
      members: emps.results
        .filter((e) => safeIds(e.department_ids).includes(d.id))
        .map((e) => ({ name: e.name, code: e.english_name || '', leaves: leavesByEmp[e.id] || {} })),
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

// 一筆休假折算成「天數」：整天=1、半天(上/下午)=0.5。
function leaveDays(period) {
  return period === 'morning' || period === 'afternoon' ? 0.5 : 1;
}

async function buildDashboard(env, date, deptId) {
  const [emps, depts, types, recs] = await Promise.all([
    env.DB.prepare("SELECT id, name, english_name, department_ids FROM employees WHERE status = 'active'").all(),
    env.DB.prepare("SELECT id, name FROM departments WHERE status != 'hidden' ORDER BY sort_order").all(),
    env.DB.prepare('SELECT * FROM leave_types').all(),
    env.DB.prepare('SELECT * FROM leave_records WHERE date = ?').bind(date).all(),
  ]);

  const typeById = Object.fromEntries(types.results.map((t) => [t.id, t]));
  const deptById = Object.fromEntries(depts.results.map((d) => [d.id, d]));
  const inDept = (e) => !deptId || safeIds(e.department_ids).includes(deptId);

  const active = emps.results.filter(inDept);
  const empById = Object.fromEntries(active.map((e) => [e.id, e]));
  const expected = active.length;

  const byType = {};
  const onLeaveList = [];
  const onLeaveEmp = new Set();

  for (const r of recs.results) {
    const e = empById[r.employee_id];
    if (!e) continue; // 不在篩選範圍內
    onLeaveEmp.add(e.id);
    const t = typeById[r.leave_type_id];
    const label = t ? t.short_name || t.name : '休';
    const color = t ? t.color || '#64748b' : '#64748b';
    const key = r.leave_type_id || '?';
    (byType[key] ||= { name: t ? t.name : '未分類', short_name: label, color, count: 0 }).count += 1;
    const dept = safeIds(e.department_ids).map((id) => (deptById[id] || {}).name).filter(Boolean).join('、');
    onLeaveList.push({ name: e.name, english_name: e.english_name || '', department: dept, label, period: r.period || 'full', color });
  }

  const onCount = onLeaveEmp.size;
  const onDuty = Math.max(0, expected - onCount);
  const rate = expected > 0 ? Math.round((onDuty / expected) * 1000) / 10 : 100;

  return {
    date,
    department_id: deptId || null,
    expected,
    on_duty: onDuty,
    on_leave_count: onCount,
    attendance_rate: rate,
    by_type: Object.values(byType).sort((a, b) => b.count - a.count),
    on_leave_list: onLeaveList,
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
