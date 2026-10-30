/* 놉스 일정표(사람 × 날짜 달력, 칸마다 자유 문장)를 심사 일정 목록으로 바꾼다.
   자유 문장을 해석하므로 100% 정확하지 않다: 확신이 낮은 건은 review 목록으로 따로 돌려준다.
   화면과 분리되어 Node/브라우저 모두에서 동작. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rules.js'));
  else root.AuditNops = factory(root.AuditRules);
}(typeof self !== 'undefined' ? self : this, function (R) {
  'use strict';

  /* ===== 규칙 — 표기가 다르면 여기만 고치면 됩니다 ===== */
  const KINDS = ['현장심사', '사후관리', '생산과정조사'];       // 업무 종류 표시어
  const SCHEDULE_KINDS = ['현장심사', '생산과정조사'];          // 심사 일정으로 가져올 종류(사후관리는 옵션)
  const FIELD_TAG = { 가공: '유기가공', 무가: '유기가공', 무항: '무항생제', 무항수산: '수산', 유기수산: '수산', 수산: '수산', 수산가공: '수산가공', 농산: '농산물', 취급: '취급자', 축산: '축산물', 유기축산: '축산물' };
  const NO_LEAD = '(미배정)';
  const COMPANY_HINT = /어촌계|영어조합|수산|농장|식품|농원|목장|법인|협동조합|㈜|주식회사/;   // 업체명으로 볼 만한 말
  /* ================================================== */

  const clean = (v) => (v == null ? '' : String(v).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim());
  const kindRe = new RegExp(`(${KINDS.join('|')})`, 'g');
  const nameKey = (s) => clean(s).toLowerCase().replace(/\(주\)|㈜|주식회사|\(유\)|농업회사법인|영농조합법인|어촌계|\(|\)|\[|\]|[\s_\-.,]/g, '');

  /** 문장 한 덩어리 → 종류별 조각. 한 칸에 일정이 여러 개 붙어 있는 경우를 나눈다 */
  function parseEventText(textIn) {
    const text = clean(textIn).replace(/^\d{1,2}:\d{2}\s*\[[^\]]*\]\s*/, '');
    const hits = [...text.matchAll(kindRe)].map((m) => ({ kind: m[1], idx: m.index }));
    if (!hits.length) {
      // '업체 NOP 심사', '업체(취급)심사' 표기: 종류는 현장심사로 가정하고 확인 목록에 올림
      const m = !/휴가|연차|반차|교육|회의/.test(text) && text.match(/^(.+?)\s*(?:\(([^)]*)\))?\s*(?:NOP\s*)?심사(?:\s|$)/);
      if (m && m[1].trim()) {
        const tg = m[2] || '';
        return { text, items: [{ kind: '현장심사', company: m[1].trim(), role: '', type: /신규/.test(tg) ? '신규' : /갱신/.test(tg) ? '갱신' : '', field: FIELD_TAG[tg.split(/[_,/]/)[0].trim()] || '', tags: tg, pattern: 'C' }] };
      }
      return { text, items: [] };
    }
    const items = [];
    hits.forEach((h, i) => {
      const prevEnd = i ? hits[i - 1].idx + hits[i - 1].kind.length : 0;
      const segEnd = i + 1 < hits.length ? hits[i + 1].idx : text.length;
      const before = text.slice(prevEnd, h.idx);
      let after = text.slice(h.idx + h.kind.length, segEnd);
      let role = '';
      const rm = after.match(/^\((정|부)\)/);
      if (rm) { role = rm[1]; after = after.slice(rm[0].length); }
      else after = after.replace(/^\([^)]*\)/, '');            // 현장심사(입회심사)_업체 처럼 종류 뒤에 붙은 부가 표기는 무시
      let company = '', tags = '', pattern = 'A';
      if (/^_/.test(after)) {                                    // 현장심사_업체명(분야_구분)
        const rest = after.replace(/^_+/, '').replace(/^\(주\)/, '㈜').replace(/^\(유\)/, '(유)');
        company = rest.split(/_|\(|\s{2,}/)[0].trim();
        const tg = rest.match(/\(([^)]*)\)/);
        tags = tg ? tg[1] : '';
      } else {                                                   // 분야_업체_품목 현장심사 (업체가 앞에 오는 표기)
        pattern = 'B';
        const tokens = before.replace(/\[[^\]]*\]/g, '').trim().split('_').map((x) => x.trim()).filter(Boolean);
        // 가운데가 업체일 수도, 품목일 수도 있어(표기가 사람마다 다름) 업체명다운 말이 들어 있는 조각을 우선 고른다
        const rest = tokens.slice(1);
        company = rest.find((t) => COMPANY_HINT.test(t)) || rest[0] || tokens[0] || '';
        tags = tokens[0] || '';
      }
      // 동행(부)가 있으면 이 사람이 정심사, 태그 안의 /정 /부 도 역할 표시
      if (/동행\(부\)/.test(after)) role = role || '정';
      const tr = tags.match(/\/(정|부)(?:_|$)/);
      if (tr && !role) role = tr[1];
      const type = /재심사/.test(tags) ? '재심사' : /신규/.test(tags) ? '신규' : /갱신/.test(tags) ? '갱신' : '';
      const fieldTok = tags.split(/[_,/]/)[0].trim();
      let field = FIELD_TAG[fieldTok] || '';
      if (!field && /\[수산\]/.test(text)) field = '수산';
      items.push({ kind: h.kind, company: company.replace(/[,.;:]+$/, '').trim(), role, type, field, tags, pattern });
    });
    return { text, items };
  }

  /**
   * 달력 시트(2차원 배열) → 일정 조각들.
   * 열: [구분(그룹), 부서, 이름(직책), 1일 … 31일]
   */
  function parseNops(aoa) {
    const events = [], nonAudit = [], suspicious = [], peopleMap = new Map();
    let dept = '';
    // 머리글에서 '1일' 위치 찾기
    const head = (aoa[0] || []).map(clean);
    const day1 = head.findIndex((h) => h === '1일');
    const nameCol = head.findIndex((h) => h === '이름');
    if (day1 < 0 || nameCol < 0) return { events, nonAudit, suspicious, people: [], error: "머리글에서 '이름'과 '1일' 열을 찾지 못했습니다" };
    aoa.slice(1).forEach((r) => {
      if (clean(r[nameCol - 1])) dept = clean(r[nameCol - 1]);
      const nm = clean(r[nameCol]);
      if (!nm) return;
      const m = nm.match(/^(.+?)\((.+)\)$/);
      const person = m ? m[1].trim() : nm, title = m ? m[2].trim() : '';
      const p = peopleMap.get(person) || { name: person, title, dept, audit: 0, other: 0 };
      peopleMap.set(person, p);
      for (let d = 1; d <= 31; d++) {
        const cell = clean(r[day1 + d - 1]);
        if (!cell) continue;
        cell.split(/(?=\d{1,2}:\d{2}\s*\[)/).map((x) => x.trim()).filter(Boolean).forEach((chunk) => {
          const ev = parseEventText(chunk);
          if (!ev.items.length) {
            if (/심사|조사/.test(ev.text) && !/휴가|연차|반차/.test(ev.text)) suspicious.push({ person, day: d, text: ev.text, reason: '심사 관련으로 보이지만 종류를 알 수 없음' });
            else { p.other++; nonAudit.push({ person, day: d, text: ev.text }); }
            return;
          }
          ev.items.forEach((it) => {
            p.audit++;
            if (!it.company) { suspicious.push({ person, day: d, text: ev.text, reason: '업체명을 찾지 못함' }); return; }
            events.push({ person, title, dept, day: d, ...it });
          });
        });
      }
    });
    return { events, nonAudit, suspicious, people: [...peopleMap.values()] };
  }

  /**
   * 조각들 → 심사 일정 행. opts: { year, month, todayIso, people:Set|null(대상 인원), includeFollowUp, regIso }
   * 같은 날 같은 업체는 한 건으로 합치고, 정/부는 표기와 동행 문구로 정한다. 정할 수 없는 건은 uncertain.
   */
  function buildRows(parsed, opts) {
    const o = opts || {};
    const kinds = o.includeFollowUp ? KINDS : SCHEDULE_KINDS;
    const lastDay = new Date(Date.UTC(o.year, o.month, 0)).getUTCDate();
    const groups = new Map();
    let followUp = 0;
    parsed.events.forEach((e) => {
      if (o.people && !o.people.has(e.person)) return;
      if (!kinds.includes(e.kind)) { followUp++; return; }
      if (e.day > lastDay) return;
      const key = `${e.day}|${nameKey(e.company)}`;
      const g = groups.get(key) || { day: e.day, company: e.company, kind: e.kind, type: '', field: '', parts: [], patterns: new Set() };
      if (!g.parts.some((p) => p.person === e.person)) g.parts.push({ person: e.person, role: e.role });
      g.type = g.type || e.type; g.field = g.field || e.field; g.patterns.add(e.pattern);
      groups.set(key, g);
    });
    const rows = [], uncertain = [], review = [];
    [...groups.values()].sort((a, b) => a.day - b.day || a.company.localeCompare(b.company, 'ko')).forEach((g) => {
      const leads = g.parts.filter((p) => p.role === '정');
      let lead, subs, why = '';
      if (leads.length) { lead = leads[0].person; subs = g.parts.filter((p) => p.person !== lead).map((p) => p.person); }
      else if (g.parts.length === 1 && g.parts[0].role !== '부') { lead = g.parts[0].person; subs = []; }
      else if (g.parts.every((p) => p.role === '부')) { lead = NO_LEAD; subs = g.parts.map((p) => p.person); why = '정심사원 표기가 없음'; }
      else { lead = g.parts[0].person; subs = g.parts.slice(1).map((p) => p.person); why = '정/부 표기가 없어 먼저 나온 사람을 정심사로 가정'; }
      const date = R.isoDate(o.year, o.month, g.day);
      const row = {
        '심사일자': date, '업체명': g.company, '인증분야': g.field, '정심사원': lead, '부심사원': subs.join(','), '지역': '',
        '진행상태': date < (o.todayIso || '9999-12-31') ? '완료' : '예정', '등록일': o.regIso || '',
      };
      rows.push(row);
      if (why) uncertain.push({ date, company: g.company, lead, subs, why });
      if (g.patterns.has('B')) review.push({ date, company: g.company, why: '업체명이 분야 앞/뒤에 섞인 표기라 맞는지 확인 필요' });
      else if (g.patterns.has('C')) review.push({ date, company: g.company, why: "'업체 NOP 심사' 표기: 종류를 현장심사로 가정했으니 확인 필요" });
    });
    return { rows, uncertain, review, followUp };
  }

  return { KINDS, SCHEDULE_KINDS, FIELD_TAG, NO_LEAD, parseEventText, parseNops, buildRows, nameKey };
}));
