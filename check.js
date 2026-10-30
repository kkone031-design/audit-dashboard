/* 연간 배정표 ↔ 심사 일정 대조, 일정 충돌, 월별 부하 점검. 화면과 분리되어 Node/브라우저 모두에서 동작 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rules.js'));
  else root.AuditCheck = factory(root.AuditRules);
}(typeof self !== 'undefined' ? self : this, function (R) {
  'use strict';

  /* ===== 인증 진행 단계 — 단계 이름이 바뀌면 이 상수만 고치세요 (순서대로) ===== */
  const STAGES = ['신청전', '접수', '서류심사', '현장심사', '인증서 발급'];
  const LAST_STAGE = STAGES.length - 1;

  /* ===== 처리기한 규칙 — 숫자만 고치면 됩니다 =====
     days  : 접수일부터 처리기한(일)
     warn  : 기한까지 이 일수 이하로 남으면 '임박'(주황)
     urgent: 이 일수 이하면 '촉박'(빨강)
     renewalNotice: 갱신 건의 인증 만료일까지 이 일수 이하로 남았는데 아직 접수 전이면 '접수 필요'(빨강) */
  const DEADLINE = { days: 60, warn: 14, urgent: 7, renewalNotice: 30 };

  // 연간 배정표 열 이름 (공백 제거 후 비교). 배정월: 3 / 3월 / 2026-03 모두 가능
  const ALIASES = {
    company: ['업체명', '업체'],
    field: ['인증분야', '분야'],
    lead: ['정심사원', '정심사'],
    sub: ['부심사원', '부심사'],
    region: ['지역'],
    month: ['배정월', '예정월', '심사월', '월'],
    farms: ['표본어가수', '표본어가'],
    stage: ['진행단계', '인증단계', '단계'],
    type: ['구분', '신청구분', '인증구분'],        // 신규 / 갱신
    received: ['접수일', '접수일자'],
    expiry: ['인증만료일', '만료일', '유효기간만료일'],
  };
  const norm = (s) => String(s == null ? '' : s).replace(/[\s 　]+/g, '');
  const clean = (v) => (v == null ? '' : String(v).trim());
  const coKey = (s) => norm(s); // 업체명 비교: 공백 차이 무시

  /** 단계 표기 → STAGES 중 하나 (예: '서류', '심사(현장)', '발급' 모두 허용). 모르면 null */
  function parseStage(v) {
    const t = norm(v);
    if (!t) return null;
    if (/신청전|미신청|신청대기/.test(t)) return STAGES[0];
    if (/발급|인증서/.test(t)) return STAGES[4];
    if (/현장/.test(t)) return STAGES[3];
    if (/서류/.test(t)) return STAGES[2];
    if (/접수/.test(t)) return STAGES[1];
    return null;
  }

  function parseMonth(v) {
    if (typeof v === 'number' && v >= 1 && v <= 12 && Number.isInteger(v)) return v;
    const s = clean(v);
    let m = s.match(/^(\d{1,2})\s*월?$/);
    if (m && +m[1] >= 1 && +m[1] <= 12) return +m[1];
    m = s.match(/^\d{4}\s*[-./]\s*(\d{1,2})/);
    if (m && +m[1] >= 1 && +m[1] <= 12) return +m[1];
    return null;
  }

  /** 연간 배정표 → { plan:[{key,company,field,lead,subs,region,month,farms}], warnings } */
  function parsePlan(records) {
    const plan = [], warnings = [];
    records.forEach((rec, i) => {
      const n = {};
      for (const k of Object.keys(rec)) n[norm(k)] = rec[k];
      const pick = (name) => { for (const a of ALIASES[name]) if (a in n) return n[a]; return undefined; };
      const company = clean(pick('company')), lead = clean(pick('lead'));
      if (!company && !lead) return;
      const dateOf = (v) => { const d = R.parseDate(v); return d ? R.isoDate(d.y, d.m, d.d) : ''; };
      const received = dateOf(pick('received')), expiry = dateOf(pick('expiry'));
      const rawType = clean(pick('type'));
      const type = /갱신/.test(rawType) ? '갱신' : /신규/.test(rawType) ? '신규' : '';
      if (rawType && !type) warnings.push(`배정표 ${i + 2}행: 알 수 없는 구분 '${rawType}' (신규/갱신) → 구분 없이 처리합니다`);
      // 배정월이 없으면 기준 날짜(갱신=만료일, 신규=접수일)의 월을 씁니다
      const baseIso = type === '갱신' ? (expiry || received) : (received || expiry);
      const month = parseMonth(pick('month')) || (baseIso ? +baseIso.slice(5, 7) : null);
      if (!company || !lead || !month) { warnings.push(`배정표 ${i + 2}행: 업체명·정심사원·배정월(1~12) 중 읽을 수 없는 값이 있어 제외했습니다`); return; }
      const rawStage = clean(pick('stage'));
      const stage = parseStage(rawStage);
      if (rawStage && !stage) warnings.push(`배정표 ${i + 2}행: 알 수 없는 진행단계 '${rawStage}' → 일정으로 추정합니다`);
      const f = clean(pick('farms'));
      const farms = f !== '' && isFinite(parseFloat(f)) ? parseFloat(f) : null;
      plan.push({
        key: coKey(company), company, field: clean(pick('field')), lead, region: clean(pick('region')), month, farms, stage, type, received, expiry,
        subs: [...new Set(clean(pick('sub')).split(/[,，、/;；·]+/).map((x) => x.trim()).filter((x) => x && x !== lead))],
      });
    });
    return { plan, warnings };
  }

  /** 배정표를 해당 연도의 월별 부하 계산용 배정(assignments)으로 펼침 */
  function planAssignments(plan, year, opts) {
    const rows = plan.map((p) => ({
      key: p.key, y: year, m: p.month, d: 1, date: R.isoDate(year, p.month, 1), company: p.company, field: p.field,
      lead: p.lead, subs: p.subs, region: p.region, status: '예정', farms: p.farms,
    }));
    return R.buildAssignments(rows, opts || {});
  }

  function schedMap(rows, year) {
    const m = new Map();
    rows.filter((r) => r.y === year).forEach((r) => { const k = coKey(r.company); (m.get(k) || m.set(k, []).get(k)).push(r); });
    return m;
  }

  const dayNum = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;
  const daysBetween = (fromIso, toIso) => Math.round(dayNum(toIso) - dayNum(fromIso));
  const addDays = (iso, n) => new Date((dayNum(iso) + n) * 86400000).toISOString().slice(0, 10);

  /**
   * 인증 건의 소속 월과 처리기한.
   * - 소속 월(ym): 갱신 = 인증 만료월, 신규 = 접수월. 해당 날짜가 없으면(예: 아직 접수 전인 신규) 배정월(올해)로 둔다
   * - 처리기한(deadline) = 접수일 + DEADLINE.days. 접수일이 없으면 기한 없음
   * - 진행단계가 배정표에 있으면 그 값, 없으면 일정으로 추정: 일정 없음=신청전, 예정=접수, 완료=현장심사
   * - overdue: 발급 전인데 처리기한 경과(접수일이 없으면 소속 월이 지난 경우)
   * - level: red(기한 경과 또는 7일 이내) / orange(14일 이내) / ''
   * - renewalRisk: 갱신인데 접수 전이고 인증 만료가 DEADLINE.renewalNotice일 이내
   */
  function caseStages(plan, rows, todayIso) {
    const ty = +todayIso.slice(0, 4), tm = +todayIso.slice(5, 7);
    const sched = schedMap(rows, ty);
    return plan.map((p) => {
      let stage = p.stage, derived = false;
      if (!stage) {
        derived = true;
        const hit = sched.get(p.key);
        stage = !hit ? STAGES[0] : hit[0].status === '완료' ? STAGES[3] : STAGES[1];
      }
      const stageIdx = STAGES.indexOf(stage);
      const issued = stageIdx === LAST_STAGE;
      const base = p.type === '갱신' ? (p.expiry || p.received) : (p.received || p.expiry);
      const ym = base ? { y: +base.slice(0, 4), m: +base.slice(5, 7) } : { y: ty, m: p.month };
      const deadline = p.received ? addDays(p.received, DEADLINE.days) : '';
      const daysLeft = deadline ? daysBetween(todayIso, deadline) : null;
      const overdue = !issued && (deadline ? daysLeft < 0 : ym.y * 12 + ym.m < ty * 12 + tm);
      const level = issued || daysLeft == null ? '' : daysLeft < 0 || daysLeft <= DEADLINE.urgent ? 'red' : daysLeft <= DEADLINE.warn ? 'orange' : '';
      const toExpiry = p.expiry ? daysBetween(todayIso, p.expiry) : null;
      const renewalRisk = !issued && p.type === '갱신' && !p.received && toExpiry != null && toExpiry <= DEADLINE.renewalNotice;
      return { ...p, month: ym.m, ym, stage, stageIdx, derived, deadline, daysLeft, toExpiry, overdue, level, renewalRisk };
    });
  }

  /** 해당 연도의 월별(1~12) 단계별 건수 → [{ counts:[단계별], total, overdue }] */
  function stageCounts(cases, year) {
    const months = Array.from({ length: 12 }, () => ({ counts: STAGES.map(() => 0), total: 0, overdue: 0 }));
    cases.filter((c) => c.ym.y === year).forEach((c) => { const m = months[c.ym.m - 1]; m.counts[c.stageIdx]++; m.total++; if (c.overdue) m.overdue++; });
    return months;
  }

  /** 기준 달에서 before개월 전부터 after개월 뒤까지의 {y, m} 목록 (연도가 바뀌어도 이어짐) */
  function monthWindow(y, m, before, after) {
    const out = [];
    for (let k = -before; k <= after; k++) { const t = y * 12 + (m - 1) + k; out.push({ y: Math.floor(t / 12), m: (t % 12) + 1 }); }
    return out;
  }

  /**
   * 배정표 ↔ 일정 대조 (같은 연도, 업체명 기준)
   *  missing    : 배정월이 지났는데 일정이 없음
   *  unscheduled: 이번 달 배정인데 일정이 없음
   *  changed    : 일정의 정심사원이 배정표와 다름
   *  moved      : 일정의 월이 배정월과 다름
   *  unplanned  : 일정은 있는데 배정표에 없음
   */
  function reconcile(plan, rows, todayIso) {
    const ty = +todayIso.slice(0, 4), tm = +todayIso.slice(5, 7);
    const sched = schedMap(rows, ty);
    const out = { missing: [], unscheduled: [], changed: [], moved: [], unplanned: [] };
    const planKeys = new Set();
    plan.forEach((p) => {
      planKeys.add(p.key);
      const hit = sched.get(p.key);
      if (!hit) {
        if (p.month < tm) out.missing.push({ company: p.company, lead: p.lead, month: p.month });
        else if (p.month === tm) out.unscheduled.push({ company: p.company, lead: p.lead, month: p.month });
        return;
      }
      const r = hit[0];
      if (r.lead !== p.lead) out.changed.push({ company: p.company, planLead: p.lead, actualLead: r.lead });
      if (r.m !== p.month) out.moved.push({ company: p.company, planMonth: p.month, actualMonth: r.m, lead: r.lead });
    });
    rows.filter((r) => r.y === ty && !planKeys.has(coKey(r.company))).forEach((r) => out.unplanned.push({ company: r.company, lead: r.lead, date: r.date }));
    return out;
  }

  /** 같은 심사원이 같은 날 2건 이상 배정된 경우 (정·부 모두, 보류 제외) */
  function conflicts(rows) {
    const by = new Map();
    rows.filter((r) => r.status !== '보류').forEach((r) => {
      [r.lead, ...r.subs].forEach((a) => {
        const k = `${a}|${r.date}`;
        (by.get(k) || by.set(k, { auditor: a, date: r.date, companies: [] }).get(k)).companies.push(r.company);
      });
    });
    return [...by.values()].filter((c) => c.companies.length > 1).sort((a, b) => a.date.localeCompare(b.date) || a.auditor.localeCompare(b.auditor, 'ko'));
  }

  return { STAGES, DEADLINE, parseStage, parsePlan, planAssignments, reconcile, conflicts, parseMonth, caseStages, stageCounts, monthWindow };
}));
