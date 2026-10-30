/* 내장 가상 샘플 데이터 (모두 임의로 만든 이름·업체입니다). 항상 같은 결과가 나오도록 고정 시드를 씁니다. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rules.js'));
  else root.AuditSample = factory(root.AuditRules);
}(typeof self !== 'undefined' ? self : this, function (R) {
  'use strict';

  const YEAR = 2026;
  const TODAY = '2026-10-30'; // 이 날짜까지는 완료, 이후는 예정으로 생성
  const AUDITORS = ['김한결', '이서연', '박도윤', '최민재', '정하은', '강지후', '조예린', '윤태오'];
  // 월별 정심사 건수를 늘려 과부하 상황을 만드는 심사원
  const HEAVY = { 김한결: { 3: 11, 6: 9, 10: 12 }, 이서연: { 4: 10, 10: 10 }, 박도윤: { 10: 9 } };
  const REGIONS = ['전남', '전북', '충남', '충북', '경북', '경남', '강원', '경기', '제주'];
  const FIELD_WEIGHTS = [['농산물', 30], ['축산물', 10], ['무항생제', 8], ['취급자', 12], ['유기가공', 10], ['수산가공', 8], ['수산', 12]];
  const NAME_A = ['푸른', '한울', '새벽', '다온', '해든', '들꽃', '청정', '그린', '하늘', '모아', '이든', '산들'];
  const NAME_B = { 농산물: '농장', 축산물: '목장', 무항생제: '축산', 취급자: '유통', 유기가공: '식품', 수산가공: '수산식품', 수산: '수산' };

  function rng(seed) {
    return () => {
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function generate() {
    const rand = rng(20260301);
    const ri = (a, b) => a + Math.floor(rand() * (b - a + 1));
    const pick = (arr) => arr[Math.floor(rand() * arr.length)];
    const pickField = () => {
      let x = rand() * 100;
      for (const [f, w] of FIELD_WEIGHTS) { if ((x -= w) < 0) return f; }
      return '농산물';
    };
    const records = [];
    let seq = 0;

    for (let m = 1; m <= 12; m++) {
      const days = [];
      const last = new Date(Date.UTC(YEAR, m, 0)).getUTCDate();
      for (let d = 1; d <= last; d++) { const w = new Date(Date.UTC(YEAR, m - 1, d)).getUTCDay(); if (w !== 0 && w !== 6) days.push(d); }
      const busy = {}; AUDITORS.forEach((a) => { busy[a] = new Set(); });
      const monthRows = [];

      for (const lead of AUDITORS) {
        const n = (HEAVY[lead] && HEAVY[lead][m]) || ri(3, 5);
        const free = days.filter(() => true);
        for (let k = 0; k < n; k++) {
          const d = free.splice(Math.floor(rand() * free.length), 1)[0];
          busy[lead].add(d);
          monthRows.push({ lead, d, field: pickField() });
        }
      }
      for (const r of monthRows) {
        if (rand() < 0.7) {
          const cands = AUDITORS.filter((a) => a !== r.lead && !busy[a].has(r.d));
          if (cands.length) { r.sub = pick(cands); busy[r.sub].add(r.d); }
        }
      }
      for (const r of monthRows) {
        seq++;
        const dateStr = R.isoDate(YEAR, m, r.d);
        const roll = rand();
        // 날짜 형식을 섞어 파서를 함께 보여줌: 문자열 / 점 표기 / 엑셀 일련번호
        const date = roll < 0.7 ? dateStr : roll < 0.9 ? `${YEAR}.${m}.${r.d}` : R.ymdToSerial(YEAR, m, r.d);
        const st = rand() < 0.04 ? '보류' : dateStr <= TODAY ? '완료' : '예정';
        const rec = {
          '심사일자': date,
          '업체명': `${pick(NAME_A)}${NAME_B[r.field] || '농장'} ${String(seq).padStart(3, '0')}호(가상)`,
          '인증분야': r.field,
          '정심사원': r.lead,
          '부심사원': r.sub || '',
          '지역': pick(REGIONS),
          '진행상태': st,
          '표본어가 수': '',
        };
        if (r.field === '수산' && rand() < 0.5) rec['표본어가 수'] = ri(2, 10);
        records.push(rec);
      }
    }
    // 일정 충돌 시연용: 김한결은 11/4에 이미 심사가 있음
    records.push({ '심사일자': '2026-11-04', '업체명': '새솔농장 902호(가상)', '인증분야': '농산물', '정심사원': '김한결', '부심사원': '', '지역': '충남', '진행상태': '예정', '표본어가 수': '' });
    return records;
  }


  /** 샘플 할일: 최근 완료된 심사의 보고서 작성, 임박한 심사의 준비 서류 검토, 월말 실적 제출 */
  function generateTasks() {
    const rand = rng(777);
    const shift = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
    const rows = R.parseRecords(generate()).rows;
    const out = [];
    const mk = (due, owner, title, company, status) => out.push({ '기한': due, '담당자': owner, '할일': title, '업체명': company, '상태': status });
    rows.forEach((r) => {
      if (r.status === '완료' && r.date <= TODAY && r.date >= shift(TODAY, -14)) {
        const due = shift(r.date, 4);
        const st = due >= TODAY ? (due === TODAY && rand() < 0.4 ? '완료' : rand() < 0.5 ? '진행' : '대기') : (rand() < 0.75 ? '완료' : '대기');
        mk(due, r.lead, '심사보고서 작성', r.company, st);
      }
      if (r.status === '예정' && r.date > TODAY && r.date <= shift(TODAY, 4)) mk(shift(r.date, -1) < TODAY ? TODAY : shift(r.date, -1), r.lead, '심사 준비(서류 검토)', r.company, '대기');
    });
    mk(TODAY, '정하은', '월간 심사실적 제출', '', '진행');
    mk(TODAY, '윤태오', '월간 심사실적 제출', '', '대기');
    mk(TODAY, '조예린', '보완조치 확인 회신', '', '진행');
    return out;
  }

  /** 샘플 연간 배정표: 일정에서 만들되 점검 시연을 위해 누락·변경·월 이동·배정 외 심사를 일부러 섞음 */
  function generatePlan() {
    const rand = rng(555);
    const rows = R.parseRecords(generate()).rows;
    const plan = [];
    const pickIdx = (cond, n) => { const c = rows.map((r, i) => (cond(r) ? i : -1)).filter((i) => i >= 0); const out = new Set(); while (out.size < Math.min(n, c.length)) out.add(c[Math.floor(rand() * c.length)]); return out; };
    const changed = pickIdx((r) => r.m >= 9 && r.m <= 11 && r.lead !== '김한결', 2);
    const moved = pickIdx((r) => r.m >= 10 && r.m <= 12, 2);
    const unplanned = pickIdx((r) => r.m >= 10 && r.m <= 11 && r.status !== '보류', 2);
    rows.forEach((r, i) => {
      if (unplanned.has(i)) return;                                  // 배정표에 없는 심사
      const lead = changed.has(i) ? S_OTHER(r.lead) : r.lead;         // 담당 변경
      plan.push({ '업체명': r.company, '인증분야': r.field, '정심사원': lead, '부심사원': r.subs.join(','), '지역': r.region, '배정월': moved.has(i) ? r.m - 1 : r.m, '표본어가 수': r.farms == null ? '' : r.farms });
    });
    // 배정은 됐지만 일정이 없는 업체
    [[7, '이서연', '농산물'], [9, '최민재', '축산물'], [10, '박도윤', '유기가공'], [10, '정하은', '수산'], [11, '강지후', '농산물']].forEach(([m, lead, f], k) => {
      plan.push({ '업체명': `${['새솔', '미르', '다솜', '아름', '온누리'][k]}${NAME_B[f] || '농장'} ${901 + k + 10}호(가상)`, '인증분야': f, '정심사원': lead, '부심사원': '', '지역': '전남', '배정월': m, '표본어가 수': '' });
    });
    return plan;
  }
  function S_OTHER(name) { return AUDITORS[(AUDITORS.indexOf(name) + 1) % AUDITORS.length]; }

  /** 엑셀 양식(샘플 다운로드)용 예시 3줄 */
  const TEMPLATE_HEADERS = ['심사일자', '업체명', '인증분야', '정심사원', '부심사원', '지역', '진행상태', '표본어가 수'];
  const TEMPLATE_ROWS = [
    ['2026-03-05', '예시농장', '농산물', '김한결', '이서연', '전남', '완료', ''],
    ['2026.3.12', '예시수산', '수산', '박도윤', '', '경남', '예정', 6],
    ['2026-03-20', '예시식품', '유기가공', '이서연', '최민재', '충남', '보류', ''],
  ];

  return { YEAR, TODAY, AUDITORS, generate, generateTasks, generatePlan, TEMPLATE_HEADERS, TEMPLATE_ROWS };
}));
