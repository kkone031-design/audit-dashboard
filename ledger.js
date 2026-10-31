/* 인증 관리 대장(국내/해외/수산 시트) 읽기: 시트의 열 이름으로 열을 찾아 인증 건으로 바꾸고, 날짜 열로 진행 단계를 판정한다.
   화면과 분리되어 Node/브라우저 모두에서 동작. 실제 자료는 이 코드에 들어 있지 않다(열 이름 규칙만 있음). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rules.js'));
  else root.AuditLedger = factory(root.AuditRules);
}(typeof self !== 'undefined' ? self : this, function (R) {
  'use strict';

  /* ===== 규칙 — 업무에 맞게 여기만 고치면 됩니다 ===== */
  // 대장에서 읽을 시트(이름에 포함된 글자로 찾음). '변경', '추후청구', '사용금지' 시트는 제외
  const SHEET_KINDS = [{ kind: '국내', test: /국내/ }, { kind: '해외', test: /해외/ }, { kind: '수산', test: /수산/ }];
  const SHEET_SKIP = /변경|추후청구|사용금지|유보|연장/;
  // 진행 중이 아닌 '구분' 값(기본 제외): 아래 글자가 들어 있으면 제외. 화면에서 값마다 바꿀 수 있음
  const EXCLUDE_RE = /종료|취하|취소|철회|부적합|미진행|타기관/;
  // 구분 → 신규/갱신: '신규'가 들어 있으면 신규(재신규 포함), '갱신'·'선발급'이 들어 있으면 갱신(중도갱신, 유보(갱신) 포함)
  const typeOf = (raw) => (/신규/.test(raw) ? '신규' : /갱신|선발급/.test(raw) ? '갱신' : '');
  // 진행 단계 (check.js의 STAGES와 같은 이름). 아래 날짜 열 중 가장 뒤 단계에 해당하는 것으로 판정
  const STAGES = ['신청전', '접수', '서류심사', '현장심사', '인증서 발급'];
  const NO_LEAD = '(미배정)';

  // 열 이름 별칭(공백·줄바꿈 제거 후 비교). 앞에서부터 우선, 정확히 같거나 그 글자로 시작하면 인정
  const COLS = {
    company: ['생산자', '인증사업자', '인증농가', '업체명', '업체'],
    field: ['인증분류', '인증품목', '대표품목', '인증유형'],
    region: ['지역구분', '지역', '국가'],
    type: ['구분'],
    expiry: ['인증만료일', '인증종료일'],
    lead: ['담당심사원(정)', '당년도심사원', '심사원'],
    sub: ['담당심사원(부)'],
    received: ['접수일', '입금일(접수일과맞출것)'],
    due: ['처리기한'],
    docReview: ['서류심사일'],
    site: ['현장심사일', '심사내역서1날짜(심사일)', '현장심사요약보고서날짜', '심사일(시료채취유무확인)'],
    issued: ['인증서교부일', '인증서발급'],
    farms: ['표본어가'],
  };
  /* =============================================== */

  const norm = (s) => String(s == null ? '' : s).replace(/[\s 　]+/g, '');
  const clean = (v) => (v == null ? '' : String(v).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim());
  const ALL_ALIASES = [...new Set(Object.values(COLS).flat().map(norm))];

  /** 머리글 행 찾기: 알려진 열 이름이 4개 이상 있는 첫 행 */
  function findHeader(aoa) {
    for (let i = 0; i < Math.min(aoa.length, 20); i++) {
      const cells = (aoa[i] || []).map(norm);
      const hits = cells.filter((c) => c && ALL_ALIASES.some((a) => c === a || c.startsWith(a))).length;
      if (hits >= 4) return i;
    }
    return -1;
  }

  /** 열 이름 → 위치 (없으면 -1). 같은 열 이름이 여러 개면 맨 앞 */
  function mapColumns(headRow) {
    const head = headRow.map(norm);
    const out = {};
    for (const key of Object.keys(COLS)) {
      let idx = -1;
      for (const alias of COLS[key].map(norm)) {
        idx = head.findIndex((h) => h === alias);
        if (idx < 0) idx = head.findIndex((h) => h && h.startsWith(alias));
        if (idx >= 0) break;
      }
      out[key] = idx;
    }
    return out;
  }

  const isoOf = (v) => {
    if (v == null || v === '') return '';
    if (typeof v === 'string' && !/\d/.test(v)) return '';
    const d = R.parseDate(typeof v === 'string' ? v.trim() : v);
    return d ? R.isoDate(d.y, d.m, d.d) : '';
  };

  /** 인증분류 → 맨데이 규칙의 분야(rules.js FIELDS). 모르면 '' */
  function mapField(text, kind) {
    const t = norm(text);
    if (!t) return '';
    if (kind === '수산' || /수산/.test(t)) return /가공/.test(t) ? '수산가공' : '수산';
    if (/무항생제|축산/.test(t)) return /무항생제/.test(t) ? '무항생제' : '축산물';
    if (/취급/.test(t)) return '취급자';
    if (/가공/.test(t)) return '유기가공';
    if (/농산/.test(t)) return '농산물';
    return '';
  }

  /** 날짜 열로 진행 단계 판정 (오늘 이후 날짜는 아직 안 한 일로 봄) */
  function stageOf(c, todayIso) {
    const done = (iso) => iso && iso <= todayIso;
    if (done(c.issued)) return STAGES[4];
    if (done(c.site)) return STAGES[3];
    if (done(c.docReview)) return STAGES[2];
    if (done(c.received)) return STAGES[1];
    return STAGES[0];
  }

  const splitNames = (v) => clean(v).split(/[,，、/;；·]+/).map((x) => x.trim()).filter(Boolean);

  /** 시트 하나 → { cases, skipped:{noCompany,noDate}, header } */
  function parseSheet(aoa, kind, todayIso) {
    const hi = findHeader(aoa);
    if (hi < 0) return { cases: [], error: '머리글 행을 찾지 못했습니다', header: -1 };
    const col = mapColumns(aoa[hi]);
    if (col.company < 0) return { cases: [], error: '업체(생산자) 열을 찾지 못했습니다', header: hi };
    const get = (r, key) => (col[key] >= 0 ? r[col[key]] : '');
    const cases = [];
    let blank = 0;
    for (let i = hi + 1; i < aoa.length; i++) {
      const r = aoa[i] || [];
      const company = clean(get(r, 'company'));
      if (!company || /^\d+$/.test(company)) { blank++; continue; }
      if (!/^\d+$/.test(clean(r[0]))) continue;                       // 번호가 없는 줄(소계·메모)은 제외
      const rawType = clean(get(r, 'type'));
      const c = {
        sheet: kind, div: kind === '수산' ? '수산' : '농축산', srcRow: i + 1, company, rawType, type: typeOf(rawType),
        field: mapField(get(r, 'field'), kind), fieldRaw: clean(get(r, 'field')),
        region: clean(get(r, 'region')),
        expiry: isoOf(get(r, 'expiry')), received: isoOf(get(r, 'received')), due: isoOf(get(r, 'due')),
        docReview: isoOf(get(r, 'docReview')), site: isoOf(get(r, 'site')), issued: isoOf(get(r, 'issued')),
        farms: kind === '수산' && clean(get(r, 'farms')) !== '' && isFinite(parseFloat(get(r, 'farms'))) ? parseFloat(get(r, 'farms')) : null,
      };
      // 심사원: 정 열의 첫 이름 = 정심사원, 나머지와 부 열 = 부심사원
      const leads = splitNames(get(r, 'lead')), subs = splitNames(get(r, 'sub'));
      c.lead = leads[0] || NO_LEAD;
      c.subs = [...new Set([...leads.slice(1), ...subs])].filter((x) => x !== c.lead);
      c.stage = stageOf(c, todayIso);
      cases.push(c);
    }
    return { cases, header: hi, columns: col, blank };
  }

  /**
   * 통합 문서(시트별 2차원 배열) → 모든 대상 시트의 인증 건.
   * sheets: [{ name, aoa }]
   */
  function parseLedger(sheets, todayIso) {
    const cases = [], report = [];
    for (const sh of sheets) {
      if (SHEET_SKIP.test(sh.name)) continue;
      const k = SHEET_KINDS.find((x) => x.test.test(sh.name));
      if (!k) continue;
      const res = parseSheet(sh.aoa, k.kind, todayIso);
      report.push({ sheet: sh.name, kind: k.kind, rows: res.cases.length, error: res.error || '', header: res.header + 1 });
      cases.push(...res.cases);
    }
    return { cases, report };
  }

  /** 진행 중이 아닌 구분 제외. excludeTypes(구분 값 목록)를 주면 그 값만, 없으면 기본 규칙(EXCLUDE_RE) */
  const isExcludedType = (raw) => EXCLUDE_RE.test(raw);
  function activeCases(cases, excludeTypes) {
    const ex = excludeTypes ? new Set(excludeTypes) : null;
    return cases.filter((c) => !(ex ? ex.has(c.rawType) : isExcludedType(c.rawType)));
  }

  /** 심사원으로 볼 사람만 남김: 그 밖의 정심사원은 '(기타)', 부심사원에서는 제외 */
  const OTHER = '(기타)';
  function limitAuditors(cases, names) {
    const set = names instanceof Set ? names : new Set(names);
    return cases.map((c) => ({ ...c, lead: c.lead === NO_LEAD || set.has(c.lead) ? c.lead : OTHER, subs: c.subs.filter((x) => set.has(x)) }));
  }

  /** 인증 건 → check.js parsePlan이 읽는 연간 배정표 형식. 월을 정할 날짜가 없는 건은 제외하고 개수만 알려 줌 */
  function toPlanRecords(cases) {
    const records = [];
    let noDate = 0;
    cases.forEach((c) => {
      const base = c.type === '갱신' ? (c.expiry || c.received) : (c.received || c.expiry);
      if (!base) { noDate++; return; }
      records.push({
        '업체명': c.company, '인증분야': c.field, '정심사원': c.lead, '부심사원': c.subs.join(','), '지역': c.region,
        '표본어가 수': c.farms == null ? '' : c.farms, '부문': c.div, '진행단계': c.stage, '구분': c.type,
        '접수일': c.received, '인증만료일': c.type === '갱신' ? c.expiry : '', '처리기한': c.due,
      });
    });
    return { records, noDate };
  }

  /** 업체명 비교용 정규화 */
  const nameKey = (s) => clean(s).toLowerCase().replace(/\(주\)|㈜|주식회사|\(유\)|농업회사법인|영농조합법인|어촌계|\(|\)|\[|\]|[\s_\-.,]/g, '');

  /**
   * 놉스 일정(rows: R.parseRecords 결과 또는 업체명이 있는 객체)을 대장 건과 업체명으로 연결.
   * 반환: { linked:[{company, caseIdx, exact}], unlinked:[업체명], ambiguous:[업체명] }
   */
  function linkCompanies(companies, cases) {
    const exact = new Map(), list = [];
    cases.forEach((c, i) => { const k = nameKey(c.company); if (k) { if (!exact.has(k)) exact.set(k, i); list.push([k, i]); } });
    const linked = [], unlinked = [], ambiguous = [];
    [...new Set(companies)].forEach((name) => {
      const k = nameKey(name);
      if (!k) { unlinked.push(name); return; }
      if (exact.has(k)) { linked.push({ company: name, caseIdx: exact.get(k), exact: true }); return; }
      const hits = list.filter(([ck]) => k.length >= 3 && ck.length >= 3 && (ck.includes(k) || k.includes(ck)));
      const uniq = [...new Set(hits.map(([, i]) => i))];
      if (uniq.length === 1) linked.push({ company: name, caseIdx: uniq[0], exact: false });
      else if (uniq.length > 1) ambiguous.push(name);
      else unlinked.push(name);
    });
    return { linked, unlinked, ambiguous };
  }

  return { STAGES, EXCLUDE_RE, isExcludedType, typeOf, limitAuditors, OTHER, NO_LEAD, COLS, findHeader, mapColumns, mapField, stageOf, parseSheet, parseLedger, activeCases, toPlanRecords, linkCompanies, nameKey };
}));
