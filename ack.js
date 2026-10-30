/* 배정 확인(심사원 확인) 로직: 지원팀이 일정을 등록·변경하면 해당 심사원이 확인해야 하고, 확인이 늦으면 단계별로 경고한다 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rules.js'));
  else root.AuditAck = factory(root.AuditRules);
}(typeof self !== 'undefined' ? self : this, function (R) {
  'use strict';

  /* ===== 확인 기한 규칙 — 숫자만 고치면 됩니다 =====
     warnDays    : 등록(변경) 후 이 일수가 지나도 미확인이면 주황
     lateDays    : 이 일수가 지나면 빨강(지연). 관리자에게 알리는 기준으로 쓰기 좋음
     urgentBefore: 심사일까지 이 일수 이하로 남았는데 미확인이면 빨강(긴급) */
  const ACK = { warnDays: 1, lateDays: 2, urgentBefore: 3 };

  const norm = (s) => String(s == null ? '' : s).replace(/[\s 　]+/g, '');
  const clean = (v) => (v == null ? '' : String(v).trim());
  const dayNum = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000;
  const daysBetween = (fromIso, toIso) => Math.round(dayNum(toIso) - dayNum(fromIso));
  /** 확인 기록과 일정을 잇는 키 (심사일자 + 업체명) */
  const ackId = (date, company) => `${date}|${norm(company)}`;

  const ALIASES = { date: ['심사일자', '심사일'], company: ['업체명', '업체'], who: ['확인자', '심사원'], at: ['확인일시', '확인일'] };

  /** 확인 기록 → { acks:[{id, auditor, at, atDate}], warnings } */
  function parseAcks(records) {
    const acks = [], warnings = [];
    records.forEach((rec, i) => {
      const n = {};
      for (const k of Object.keys(rec)) n[norm(k)] = rec[k];
      const pick = (name) => { for (const a of ALIASES[name]) if (a in n) return n[a]; return undefined; };
      const date = R.parseDate(pick('date')), company = clean(pick('company')), who = clean(pick('who'));
      const atRaw = pick('at');
      const at = R.parseDate(typeof atRaw === 'string' ? atRaw.slice(0, 10) : atRaw);
      if (!date || !company || !who || !at) { warnings.push(`확인 기록 ${i + 2}행: 읽을 수 없어 제외했습니다`); return; }
      acks.push({ id: ackId(R.isoDate(date.y, date.m, date.d), company), auditor: who, at: clean(atRaw), atDate: R.isoDate(at.y, at.m, at.d) });
    });
    return { acks, warnings };
  }

  /**
   * 앞으로의 예정 심사(보류·완료 제외)에 대해 정·부 심사원이 각각 확인했는지 점검.
   * - 확인 기준일(since) = 등록일과 변경일 중 늦은 날. 그 날 이후에 한 확인만 유효 (변경되면 다시 확인)
   * - level: red(지연·긴급) / orange(주의) / normal(방금 등록)
   * 반환 { pending:[…], total, acked }
   */
  function checkAcks(rows, acks, todayIso) {
    const byKey = new Map();
    acks.forEach((a) => { const k = `${a.id}|${a.auditor}`; if (!byKey.has(k) || byKey.get(k) < a.atDate) byKey.set(k, a.atDate); });
    const pending = [];
    let total = 0, acked = 0;
    rows.filter((r) => r.status === '예정' && r.date >= todayIso).forEach((r) => {
      const since = [r.regDate, r.changedDate].filter(Boolean).sort().pop() || todayIso;
      [[r.lead, '정'], ...r.subs.map((s) => [s, '부'])].forEach(([auditor, role]) => {
        total++;
        const last = byKey.get(`${ackId(r.date, r.company)}|${auditor}`);
        if (last && last >= since) { acked++; return; }
        const waitDays = Math.max(0, daysBetween(since, todayIso));
        const daysToAudit = daysBetween(todayIso, r.date);
        const level = waitDays >= ACK.lateDays || daysToAudit <= ACK.urgentBefore ? 'red' : waitDays >= ACK.warnDays ? 'orange' : 'normal';
        pending.push({ rowKey: r.key, auditor, role, company: r.company, field: r.field, region: r.region, date: r.date, since, waitDays, daysToAudit, reason: last ? 'changed' : 'new', level });
      });
    });
    const rank = { red: 0, orange: 1, normal: 2 };
    pending.sort((a, b) => rank[a.level] - rank[b.level] || a.daysToAudit - b.daysToAudit || b.waitDays - a.waitDays || a.auditor.localeCompare(b.auditor, 'ko'));
    return { pending, total, acked };
  }

  return { ACK, ackId, parseAcks, checkAcks, daysBetween };
}));
