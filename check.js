/* 연간 배정표 ↔ 심사 일정 대조, 일정 충돌, 월별 부하 점검. 화면과 분리되어 Node/브라우저 모두에서 동작 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rules.js'));
  else root.AuditCheck = factory(root.AuditRules);
}(typeof self !== 'undefined' ? self : this, function (R) {
  'use strict';

  /* ===== 인증 진행 단계 — 단계 이름이 바뀌면 이 상수만 고치세요 (순서대로) ===== */
  const STAGES = ['신청전', '접수', '서류심사', '현장심사', '인증서 발급'];
  const LAST_STAGE = STAGES.length - 1;

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
      const month = parseMonth(pick('month'));
      if (!company || !lead || !month) { warnings.push(`배정표 ${i + 2}행: 업체명·정심사원·배정월(1~12) 중 읽을 수 없는 값이 있어 제외했습니다`); return; }
      const rawStage = clean(pick('stage'));
      const stage = parseStage(rawStage);
      if (rawStage && !stage) warnings.push(`배정표 ${i + 2}행: 알 수 없는 진행단계 '${rawStage}' → 일정으로 추정합니다`);
      const f = clean(pick('farms'));
      const farms = f !== '' && isFinite(parseFloat(f)) ? parseFloat(f) : null;
      plan.push({
        key: coKey(company), company, field: clean(pick('field')), lead, region: clean(pick('region')), month, farms, stage,
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

  /**
   * 월별 인증 건과 진행 단계.
   * 배정표에 진행단계가 있으면 그 값, 없으면 일정으로 추정: 일정 없음=신청전, 일정 예정=접수, 일정 완료=현장심사.
   * overdue: 배정월이 지났는데 아직 인증서 발급 전
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
      return { ...p, stage, stageIdx: STAGES.indexOf(stage), derived, overdue: p.month < tm && stage !== STAGES[LAST_STAGE] };
    });
  }

  /** 월별(1~12) 단계별 건수 → [{ counts:[단계별], total, overdue }] */
  function stageCounts(cases) {
    const months = Array.from({ length: 12 }, () => ({ counts: STAGES.map(() => 0), total: 0, overdue: 0 }));
    cases.forEach((c) => { const m = months[c.month - 1]; m.counts[c.stageIdx]++; m.total++; if (c.overdue) m.overdue++; });
    return months;
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

  return { STAGES, parseStage, parsePlan, planAssignments, reconcile, conflicts, parseMonth, caseStages, stageCounts };
}));
