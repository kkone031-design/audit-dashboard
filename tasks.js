/* 심사원 할일(보고서 작성 등) 해석과 "오늘의 할일" 계산. 화면과 분리되어 Node/브라우저 모두에서 동작 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rules.js'));
  else root.AuditTasks = factory(root.AuditRules);
}(typeof self !== 'undefined' ? self : this, function (R) {
  'use strict';

  const TASK_STATUSES = ['대기', '진행', '완료'];
  // 할일 목록 열 이름 (공백 제거 후 비교)
  const ALIASES = {
    due: ['기한', '마감', '마감일', '날짜'],
    owner: ['담당자', '심사원', '담당'],
    title: ['할일', '업무', '내용'],
    company: ['업체명', '업체'],
    status: ['상태', '진행상태'],
  };
  const norm = (s) => String(s == null ? '' : s).replace(/[\s 　]+/g, '');
  const clean = (v) => (v == null ? '' : String(v).trim());

  /** 엑셀/목록에서 읽은 객체 배열 → { tasks:[{due,owner,title,company,status}], warnings } */
  function parseTasks(records) {
    const tasks = [], warnings = [];
    records.forEach((rec, i) => {
      const n = {};
      for (const k of Object.keys(rec)) n[norm(k)] = rec[k];
      const pick = (name) => { for (const a of ALIASES[name]) if (a in n) return n[a]; return undefined; };
      const owner = clean(pick('owner')), title = clean(pick('title'));
      if (!owner && !title && clean(pick('due')) === '') return; // 빈 줄
      const dt = R.parseDate(pick('due'));
      if (!dt) { warnings.push(`할일 ${i + 2}행: 기한을 읽을 수 없어 제외했습니다`); return; }
      if (!owner || !title) { warnings.push(`할일 ${i + 2}행: 담당자 또는 할일이 비어 있어 제외했습니다`); return; }
      const st = clean(pick('status'));
      tasks.push({ due: R.isoDate(dt.y, dt.m, dt.d), owner, title, company: clean(pick('company')), status: TASK_STATUSES.includes(st) ? st : '대기' });
    });
    return { tasks, warnings };
  }

  const dayNum = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;
  const daysBetween = (fromIso, toIso) => Math.round(dayNum(toIso) - dayNum(fromIso));

  /**
   * 심사원별 오늘의 할일.
   * - audits: 오늘 심사(정/부, 보류 제외)
   * - tasks: 오늘이 기한이거나 기한이 지났는데 끝나지 않은 일(late=지연 일수), 오늘 기한인 완료 건(done)
   * 반환: [{ name, audits:[{role,company,field,region,status}], tasks:[{title,company,status,late,done}] }] 이름순
   */
  function buildToday(rows, tasks, todayIso) {
    const by = new Map();
    const get = (name) => { if (!by.has(name)) by.set(name, { name, audits: [], tasks: [] }); return by.get(name); };
    rows.forEach((r) => { get(r.lead); r.subs.forEach(get); });
    tasks.forEach((t) => get(t.owner));

    rows.filter((r) => r.date === todayIso && r.status !== '보류').forEach((r) => {
      const info = { company: r.company, field: r.field, region: r.region, status: r.status };
      get(r.lead).audits.push({ ...info, role: '정' });
      r.subs.forEach((s) => get(s).audits.push({ ...info, role: '부' }));
    });
    tasks.forEach((t) => {
      const diff = daysBetween(t.due, todayIso); // 양수 = 기한 경과
      if (t.status !== '완료' && diff >= 0) get(t.owner).tasks.push({ title: t.title, company: t.company, status: t.status, late: diff, done: false });
      else if (t.status === '완료' && diff === 0) get(t.owner).tasks.push({ title: t.title, company: t.company, status: t.status, late: 0, done: true });
    });
    const people = [...by.values()];
    people.forEach((p) => p.tasks.sort((a, b) => a.done - b.done || b.late - a.late));
    return people.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }

  return { TASK_STATUSES, parseTasks, buildToday, daysBetween };
}));
