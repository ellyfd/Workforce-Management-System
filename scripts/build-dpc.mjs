// 從 Base44 讀取 DPC（3D team）的休假，產生 dpc.json 供開發處檢視頁合併顯示。
//
// 在 GitHub Actions 排程裡執行；需要環境變數：
//   BASE44_API_KEY  （必填，放在 GitHub Actions Secret，切勿寫進程式）
//   BASE44_API_URL  （選填，預設見下）
//   BASE44_APP_ID   （選填）
//   DPC_DEPT_NAME   （選填，Base44 裡 DPC 部門的名稱，預設 'DPC'）
//   DPC_DISPLAY_NAME（選填，顯示在開發處表上的區塊名稱，預設 '3D team（DPC）'）
//   SYNC_START / SYNC_END（選填，撈取日期範圍 YYYY-MM-DD）
//
// Node 20+（內建 fetch）。輸出檔：dpc.json（位於 repo 根目錄）。

import { writeFileSync } from 'node:fs';

const API = process.env.BASE44_API_URL || 'https://app-67c8f9d9.base44.app/api';
const APP_ID = process.env.BASE44_APP_ID || '693bb4665c3a400767c8f9d9';
const API_KEY = process.env.BASE44_API_KEY;
const DPC_DEPT_NAME = process.env.DPC_DEPT_NAME || 'DPC';
const DPC_DISPLAY_NAME = process.env.DPC_DISPLAY_NAME || '3D team（DPC）';

if (!API_KEY) {
  console.error('缺少 BASE44_API_KEY（請設定為 GitHub Actions Secret）');
  process.exit(1);
}

const year = new Date().getFullYear();
const START = process.env.SYNC_START || `${year}-01-01`;
const END = process.env.SYNC_END || `${year + 1}-12-31`;

async function api(entity, q) {
  const url = new URL(`${API}/entities/${entity}`);
  if (q) url.searchParams.set('q', JSON.stringify(q));
  url.searchParams.set('limit', '10000');
  const res = await fetch(url, {
    headers: { api_key: API_KEY, 'X-App-Id': APP_ID },
  });
  if (!res.ok) {
    throw new Error(`讀取 ${entity} 失敗：HTTP ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function main() {
  const departments = await api('Department');
  const dpcDept = departments.find((d) => d.name === DPC_DEPT_NAME);
  if (!dpcDept) throw new Error(`在 Base44 找不到部門「${DPC_DEPT_NAME}」`);

  const employees = (await api('Employee')).filter(
    (e) =>
      e.department_ids?.includes(dpcDept.id) &&
      !['inactive', 'parental_leave', 'hidden'].includes(e.status),
  );
  employees.sort(
    (a, b) =>
      (a.sort_order_by_dept?.[dpcDept.id] ?? 9e9) -
      (b.sort_order_by_dept?.[dpcDept.id] ?? 9e9),
  );
  const empIds = new Set(employees.map((e) => e.id));

  const leaveTypes = await api('LeaveType');
  const ltById = Object.fromEntries(leaveTypes.map((t) => [t.id, t]));

  const records = (await api('LeaveRecord', { date: { $gte: START, $lte: END } })).filter(
    (r) => empIds.has(r.employee_id),
  );

  const holidays = [
    ...new Set((await api('Holiday')).map((h) => h.date).filter(Boolean)),
  ];

  const members = new Map(
    employees.map((e) => [e.id, { name: e.name, code: e.english_name || '', leaves: {} }]),
  );
  for (const r of records) {
    const lt = ltById[r.leave_type_id];
    const label = lt ? lt.short_name || lt.name : '休';
    members.get(r.employee_id).leaves[r.date] = label;
  }

  const legend = {};
  for (const lt of leaveTypes) legend[lt.short_name || lt.name] = lt.color || '#64748b';

  const out = {
    updated_at: new Date().toISOString(),
    department_name: DPC_DISPLAY_NAME,
    legend,
    holidays,
    members: [...members.values()],
  };

  writeFileSync('dpc.json', JSON.stringify(out, null, 2) + '\n');
  console.log(
    `dpc.json 完成：${out.members.length} 人、${records.length} 筆休假（${START} ~ ${END}）`,
  );
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
