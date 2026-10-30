/* 맨데이 규칙 + 집계 로직 (화면과 분리: 브라우저/Node 모두에서 동작) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AuditRules = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ================= 규칙 상수 — 규칙이 바뀌면 이 블록만 고치세요 ================= */
  const FIELDS = ['유기가공', '수산가공', '농산물', '축산물', '취급자', '수산', '무항생제'];

  // 정심사원 기준 인증분야별 맨데이
  const LEAD_MANDAY = {
    유기가공: 2.5,
    수산가공: 2.5,
    농산물: 2,
    축산물: 2,
    취급자: 2,
    무항생제: 2, // 축산물과 동일하게 처리
    수산: 1.5,
  };
  const DEFAULT_LEAD_MANDAY = 2;   // 목록에 없는 분야일 때(경고 표시 후 사용)
  const SUB_MANDAY = 0.5;          // 부심사원(모든 분야 공통)

  // 수산: 표본어가가 SAMPLE_MIN~SAMPLE_MAX곳이면 LARGE 맨데이
  const SUISAN = { field: '수산', sampleMin: 5, sampleMax: 8, large: 3 };

  // 월 맨데이 경고 기준: red 초과 → 빨강, orange 이상 red 이하 → 주황
  const WARN = { red: 20, orange: 18 };

  const STATUSES = ['예정', '완료', '보류'];
  /* =============================================================================== */

  // 엑셀 열 이름 별칭 (공백 제거 후 비교)
  const HEADER_ALIASES = {
    date: ['심사일자', '심사일', '일자'],
    company: ['업체명', '업체', '농가명'],
    field: ['인증분야', '분야'],
    lead: ['정심사원', '정심사'],
    sub: ['부심사원', '부심사'],
    region: ['지역'],
    status: ['진행상태', '상태'],
    farms: ['표본어가수', '표본어가', '표본어가수(곳)'],
  };

  const pad = (n) => String(n).padStart(2, '0');
  const isoDate = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const normHeader = (s) => String(s == null ? '' : s).replace(/[\s 　]+/g, '');
  const clean = (v) => (v == null ? '' : String(v).replace(/[ 　]+/g, ' ').trim());

  /** 엑셀 일련번호 → {y,m,d} (1900 날짜 체계) */
  function serialToYMD(n) {
    const dt = new Date(Math.round((n - 25569) * 86400000));
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
  }
  function ymdToSerial(y, m, d) { return Date.UTC(y, m - 1, d) / 86400000 + 25569; }

  /** 일련번호/Date/문자열(2026-03-05, 2026.3.5, 2026/3/5, 2026년 3월 5일, 20260305) → {y,m,d}|null */
  function parseDate(v) {
    if (v == null || v === '') return null;
    let r = null;
    if (v instanceof Date) {
      if (isNaN(v)) return null;
      r = { y: v.getFullYear(), m: v.getMonth() + 1, d: v.getDate() };
    } else if (typeof v === 'number') {
      if (!(v > 1 && v < 2958466)) return null;
      r = serialToYMD(v);
    } else {
      const s = String(v).trim();
      let m = s.match(/^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/);
      if (m) r = { y: +m[1], m: +m[2], d: +m[3] };
      else if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) r = { y: +m[1], m: +m[2], d: +m[3] };
      else if (/^\d+(\.\d+)?$/.test(s)) return parseDate(parseFloat(s)); // 문자열로 저장된 일련번호
      else return null;
    }
    const chk = new Date(Date.UTC(r.y, r.m - 1, r.d));
    if (chk.getUTCFullYear() !== r.y || chk.getUTCMonth() !== r.m - 1 || chk.getUTCDate() !== r.d) return null;
    return r;
  }

  function normStatus(v) {
    const s = clean(v);
    if (STATUSES.includes(s)) return { status: s, known: true };
    return { status: '예정', known: s === '' }; // 빈 값은 예정, 그 외 알 수 없는 값도 예정 + 경고
  }

  function splitNames(v) {
    return clean(v).split(/[,，、/;；·]+/).map((x) => x.trim()).filter(Boolean);
  }

  /**
   * 엑셀에서 읽은 객체 배열(열 이름=키) → 표준 행 + 경고
   * 반환: { rows:[{key,y,m,d,date,company,field,lead,subs,region,status,farms,srcRow}], warnings:[], hasFarmsColumn }
   */
  function parseRecords(records) {
    const warnings = [];
    const rows = [];
    let hasFarmsColumn = false;
    const seenKeys = Object.create(null);

    records.forEach((rec, i) => {
      const norm = {};
      for (const k of Object.keys(rec)) norm[normHeader(k)] = rec[k];
      const pick = (name) => {
        for (const a of HEADER_ALIASES[name]) if (a in norm) return norm[a];
        return undefined;
      };
      if (pick('farms') !== undefined) hasFarmsColumn = true;

      const srcRow = i + 2; // 엑셀 행 번호(1행은 머리글)
      const rawDate = pick('date');
      const company = clean(pick('company'));
      const lead = clean(pick('lead'));
      if ([rawDate, company, lead].every((x) => x === undefined || clean(x) === '')) return; // 빈 줄

      const dt = parseDate(rawDate);
      if (!dt) { warnings.push(`${srcRow}행: 심사일자를 읽을 수 없어 제외했습니다 (${clean(rawDate) || '빈 값'})`); return; }
      if (!lead) { warnings.push(`${srcRow}행: 정심사원이 비어 있어 제외했습니다 (${company})`); return; }

      const field = clean(pick('field'));
      if (!FIELDS.includes(field)) warnings.push(`${srcRow}행: 알 수 없는 인증분야 '${field || '빈 값'}' → 정심사 ${DEFAULT_LEAD_MANDAY} 맨데이로 처리했습니다`);

      const st = normStatus(pick('status'));
      if (!st.known) warnings.push(`${srcRow}행: 알 수 없는 진행상태 '${clean(pick('status'))}' → '예정'으로 처리했습니다`);

      const farmsRaw = clean(pick('farms'));
      let farms = null;
      if (farmsRaw !== '') {
        const n = parseFloat(farmsRaw.replace(/[^\d.]/g, ''));
        if (isFinite(n)) farms = n;
        else warnings.push(`${srcRow}행: 표본어가 수 '${farmsRaw}'를 숫자로 읽을 수 없어 비어 있는 것으로 처리했습니다`);
      }

      const date = isoDate(dt.y, dt.m, dt.d);
      let key = `${date}|${company}|${lead}`;
      if (seenKeys[key]) key += `#${++seenKeys[key]}`; else seenKeys[key] = 1;

      const subs = splitNames(pick('sub')).filter((s) => s !== lead);
      rows.push({
        key, y: dt.y, m: dt.m, d: dt.d, date, company, field, lead,
        subs: [...new Set(subs)], region: clean(pick('region')), status: st.status, farms, srcRow,
      });
    });
    return { rows, warnings, hasFarmsColumn };
  }

  /** 정심사 맨데이. 반환 { value, auto } — auto: 표본어가 수 열 값으로 정해졌는지 */
  function leadManday(row, farmOverrides) {
    if (row.field === SUISAN.field) {
      if (row.farms != null) {
        return { value: row.farms >= SUISAN.sampleMin && row.farms <= SUISAN.sampleMax ? SUISAN.large : LEAD_MANDAY[SUISAN.field], auto: true };
      }
      return { value: farmOverrides && farmOverrides.has(row.key) ? SUISAN.large : LEAD_MANDAY[SUISAN.field], auto: false };
    }
    return { value: LEAD_MANDAY[row.field] != null ? LEAD_MANDAY[row.field] : DEFAULT_LEAD_MANDAY, auto: false };
  }

  /**
   * 행 → 심사원별 배정(정/부)으로 펼침.
   * counted=false: 보류이면서 includeHold가 꺼진 경우 (달력에는 보이지만 집계 제외)
   */
  function buildAssignments(rows, opts) {
    const o = opts || {};
    const out = [];
    for (const r of rows) {
      const counted = r.status !== '보류' || !!o.includeHold;
      const base = { rowKey: r.key, y: r.y, m: r.m, d: r.d, date: r.date, company: r.company, field: r.field, region: r.region, status: r.status, counted };
      out.push({ ...base, auditor: r.lead, role: '정', manday: leadManday(r, o.farmOverrides).value });
      for (const s of r.subs) out.push({ ...base, auditor: s, role: '부', manday: SUB_MANDAY });
    }
    return out;
  }

  function levelOf(manday) {
    if (manday > WARN.red) return 'red';
    if (manday >= WARN.orange) return 'orange';
    return 'ok';
  }

  /** 해당 연·월 심사원별 집계 */
  function summarize(assigns, y, m) {
    const map = new Map();
    for (const a of assigns) {
      if (!a.counted || a.y !== y || a.m !== m) continue;
      let s = map.get(a.auditor);
      if (!s) { s = { name: a.auditor, lead: 0, sub: 0, manday: 0, done: 0, planned: 0, hold: 0 }; map.set(a.auditor, s); }
      if (a.role === '정') s.lead++; else s.sub++;
      s.manday += a.manday;
      if (a.status === '완료') s.done++; else if (a.status === '보류') s.hold++; else s.planned++;
    }
    const list = [...map.values()];
    list.forEach((s) => { s.level = levelOf(s.manday); });
    return list;
  }

  /** 연간 1~12월 심사원별 맨데이 → { 이름: [12개] } */
  function monthlyTrend(assigns, y) {
    const t = {};
    for (const a of assigns) {
      if (!a.counted || a.y !== y) continue;
      (t[a.auditor] = t[a.auditor] || Array(12).fill(0))[a.m - 1] += a.manday;
    }
    return t;
  }

  return {
    FIELDS, LEAD_MANDAY, DEFAULT_LEAD_MANDAY, SUB_MANDAY, SUISAN, WARN, STATUSES,
    parseDate, ymdToSerial, parseRecords, leadManday, buildAssignments, summarize, monthlyTrend, levelOf, isoDate,
  };
}));
