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
    return records;
  }

  /** 엑셀 양식(샘플 다운로드)용 예시 3줄 */
  const TEMPLATE_HEADERS = ['심사일자', '업체명', '인증분야', '정심사원', '부심사원', '지역', '진행상태', '표본어가 수'];
  const TEMPLATE_ROWS = [
    ['2026-03-05', '예시농장', '농산물', '김한결', '이서연', '전남', '완료', ''],
    ['2026.3.12', '예시수산', '수산', '박도윤', '', '경남', '예정', 6],
    ['2026-03-20', '예시식품', '유기가공', '이서연', '최민재', '충남', '보류', ''],
  ];

  return { YEAR, TODAY, AUDITORS, generate, TEMPLATE_HEADERS, TEMPLATE_ROWS };
}));
