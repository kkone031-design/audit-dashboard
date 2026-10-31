/* 데이터 가져오기 화면(초안): 인증 관리 대장 + 놉스 일정표 → 현황판용 자료 */
(function () {
  'use strict';
  const R = AuditRules, L = AuditLedger, N = AuditNops, D = AuditData;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const localIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const todayIso = localIso(new Date());
  const chip = (txt, cls) => `<span class="chip ${cls || ''}">${txt}</span>`;
  const tableOf = (head, rows) => `<div class="list"><table class="tbl"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

  const st = { cases: [], ledgerName: '', excluded: new Set(), parsedNops: null, nopsName: '', people: new Set(), result: null };

  function readSheets(file, onlyFirst) {
    return new Promise((resolve, reject) => {
      if (typeof XLSX === 'undefined') { reject(new Error('엑셀 라이브러리(SheetJS)를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.')); return; }
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
      fr.onload = () => {
        try {
          const wb = XLSX.read(new Uint8Array(fr.result), { type: 'array' });
          const names = onlyFirst ? wb.SheetNames.slice(0, 1) : wb.SheetNames;
          resolve(names.map((name) => ({ name, aoa: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' }) })));
        } catch (e) { reject(new Error('엑셀 파일을 해석하지 못했습니다: ' + e.message)); }
      };
      fr.readAsArrayBuffer(file);
    });
  }
  const setMsg = (id, text, err) => { const m = $(id); m.textContent = text; m.className = 'msg' + (err ? ' err' : ''); };

  /* ---------- 1. 대장 ---------- */
  async function onLedger(file) {
    setMsg('m-ledger', '읽는 중…');
    try {
      const sheets = await readSheets(file, false);
      const res = L.parseLedger(sheets, todayIso);
      st.cases = res.cases; st.ledgerName = file.name; st.sheetReport = res.report;
      if (!res.cases.length) { setMsg('m-ledger', '읽을 수 있는 인증 건이 없습니다. 시트 이름(국내/해외/수산)과 머리글을 확인해 주세요.', true); return; }
      st.excluded = new Set([...new Set(res.cases.map((c) => c.rawType))].filter((t) => L.isExcludedType(t)));
      setMsg('m-ledger', `${file.name}: ${res.cases.length}건을 읽었습니다.`);
      $('r-ledger').hidden = false;
      recompute();
    } catch (e) { setMsg('m-ledger', e.message, true); }
  }

  /* ---------- 2. 놉스 ---------- */
  async function onNops(file) {
    setMsg('m-nops', '읽는 중…');
    try {
      const sheets = await readSheets(file, true);
      const parsed = N.parseNops(sheets[0].aoa);
      if (parsed.error) { setMsg('m-nops', parsed.error, true); return; }
      st.parsedNops = parsed; st.nopsName = file.name;
      st.people = new Set(parsed.people.filter((p) => p.audit > 0).map((p) => p.name));
      const fm = file.name.match(/(\d{4})-(\d{2})-\d{2}/);
      const y = fm ? +fm[1] : new Date().getFullYear(), m = fm ? +fm[2] : new Date().getMonth() + 1;
      $('sel-y').innerHTML = [y - 1, y, y + 1].map((v) => `<option${v === y ? ' selected' : ''}>${v}</option>`).join('');
      $('sel-m').innerHTML = Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}"${i + 1 === m ? ' selected' : ''}>${i + 1}월</option>`).join('');
      setMsg('m-nops', `${file.name}: 일정 조각 ${parsed.events.length}개를 읽었습니다.`);
      $('r-nops').hidden = false;
      recompute();
    } catch (e) { setMsg('m-nops', e.message, true); }
  }

  /* ---------- 계산 ---------- */
  function recompute() {
    const active = L.activeCases(st.cases, st.excluded);
    // 심사원으로 볼 사람: 놉스에서 고른 사람. 놉스가 없으면 대장에서 정심사원으로 많이 나온 12명
    let auditors = st.people;
    if (!st.parsedNops) {
      const cnt = {}; active.forEach((c) => { if (c.lead !== L.NO_LEAD) cnt[c.lead] = (cnt[c.lead] || 0) + 1; });
      auditors = new Set(Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([n]) => n));
    }
    const limited = L.limitAuditors(active, auditors);
    const plan = L.toPlanRecords(limited);
    let nopsRes = null, link = null, schedule = [];
    if (st.parsedNops) {
      nopsRes = N.buildRows(st.parsedNops, { year: +$('sel-y').value, month: +$('sel-m').value, todayIso, people: st.people, includeFollowUp: $('chk-follow').checked, regIso: todayIso });
      link = L.linkCompanies(nopsRes.rows.map((r) => r['업체명']), active);
      const byName = new Map(link.linked.map((x) => [x.company, active[x.caseIdx]]));
      schedule = nopsRes.rows.map((r) => {
        const c = byName.get(r['업체명']);
        if (!c) return r;
        return { ...r, '업체명': c.company, '인증분야': r['인증분야'] || c.field, '지역': r['지역'] || c.region };   // 업체명은 대장 표기로 통일
      });
    }
    st.result = { active, plan, nopsRes, link, schedule, auditors };
    renderLedger(active, plan); renderNops(); renderLink(); renderApply();
  }

  /* ---------- 화면 ---------- */
  function renderLedger(active, plan) {
    const cnt = (arr, f) => { const m = {}; arr.forEach((x) => { const k = f(x) || '(빈값)'; m[k] = (m[k] || 0) + 1; }); return m; };
    const stages = cnt(active, (c) => c.stage);
    $('s-ledger').innerHTML = chip(`전체 <b>${st.cases.length}</b>건`) + chip(`진행 대상 <b>${active.length}</b>건`, 'ok') +
      L.STAGES.map((s) => chip(`${s} <b>${stages[s] || 0}</b>`)).join('') +
      chip(`농축산 <b>${active.filter((c) => c.div === '농축산').length}</b> (해외 포함)`) + chip(`수산 <b>${active.filter((c) => c.div === '수산').length}</b>`) +
      chip(`심사원 미배정 <b>${active.filter((c) => c.lead === L.NO_LEAD).length}</b>`, active.some((c) => c.lead === L.NO_LEAD) ? 'warn' : '') +
      chip(`날짜가 없어 월을 정할 수 없는 건 <b>${plan.noDate}</b>`, plan.noDate ? 'warn' : '') +
      chip(`기한 날짜 있음 <b>${active.filter((c) => c.due).length}</b>`);
    $('t-sheets').innerHTML = '<thead><tr><th>시트</th><th>구분</th><th>머리글 행</th><th>읽은 건수</th><th>메모</th></tr></thead><tbody>' +
      st.sheetReport.map((r) => `<tr><td>${esc(r.sheet)}</td><td>${esc(r.kind)}</td><td>${r.header}</td><td>${r.rows}</td><td>${esc(r.error)}</td></tr>`).join('') + '</tbody>';
    const types = cnt(st.cases, (c) => c.rawType);
    $('t-types').innerHTML = '<thead><tr><th>구분 값</th><th>건수</th><th>해석</th><th>제외</th></tr></thead><tbody>' +
      Object.entries(types).sort((a, b) => b[1] - a[1]).map(([t, c]) => `<tr><td>${esc(t)}</td><td>${c}</td><td>${esc(L.typeOf(t === '(빈값)' ? '' : t) || '-')}</td><td><input type="checkbox" data-t="${esc(t === '(빈값)' ? '' : t)}" ${st.excluded.has(t === '(빈값)' ? '' : t) ? 'checked' : ''} aria-label="${esc(t)} 제외"></td></tr>`).join('') + '</tbody>';
    $('t-types').querySelectorAll('input').forEach((b) => b.addEventListener('change', () => { if (b.checked) st.excluded.add(b.dataset.t); else st.excluded.delete(b.dataset.t); recompute(); }));
  }

  function renderNops() {
    if (!st.parsedNops) return;
    const { nopsRes, auditors } = st.result;
    const p = st.parsedNops;
    $('s-nops').innerHTML = chip(`심사 일정 <b>${nopsRes.rows.length}</b>건`, 'ok') + chip(`사후관리 등 제외 <b>${nopsRes.followUp}</b>`) + chip(`휴가·기타 <b>${p.nonAudit.length}</b>`) +
      chip(`정/부 불명 <b>${nopsRes.uncertain.length}</b>`, nopsRes.uncertain.length ? 'warn' : '') + chip(`표기 확인 <b>${nopsRes.review.length}</b>`, nopsRes.review.length ? 'warn' : '') + chip(`해석 못 한 문장 <b>${p.suspicious.length}</b>`, p.suspicious.length ? 'bad' : '');
    $('people').innerHTML = p.people.map((x) => `<label><input type="checkbox" data-n="${esc(x.name)}" ${st.people.has(x.name) ? 'checked' : ''}> ${esc(x.name)} <span class="t">${esc(x.title)} · 심사 ${x.audit}건</span></label>`).join('');
    $('people').querySelectorAll('input').forEach((b) => b.addEventListener('change', () => { if (b.checked) st.people.add(b.dataset.n); else st.people.delete(b.dataset.n); recompute(); }));
    const n = nopsRes.uncertain.length + nopsRes.review.length + p.suspicious.length;
    $('sum-check').innerHTML = `확인이 필요한 항목 <small>${n}건 — 자동 해석이 불확실한 것들입니다</small>`;
    $('l-check').innerHTML = (p.suspicious.length ? `<p class="hint">해석하지 못한 문장 (일정에 넣지 않았습니다)</p>${tableOf(['사람', '일', '문장'], p.suspicious.map((s) => [s.person, s.day + '일', s.text.slice(0, 70) + ' — ' + s.reason]))}` : '') +
      (nopsRes.uncertain.length ? `<p class="hint">정/부심사원을 정할 수 없는 일정</p>${tableOf(['날짜', '업체', '가정한 정심사원', '부', '사유'], nopsRes.uncertain.map((u) => [u.date, u.company, u.lead, u.subs.join(', '), u.why]))}` : '') +
      (nopsRes.review.length ? `<p class="hint">업체명 표기가 섞여 있어 맞는지 확인이 필요한 일정</p>${tableOf(['날짜', '업체', '사유'], nopsRes.review.map((u) => [u.date, u.company, u.why]))}` : '') || '<p class="hint">확인할 항목이 없습니다.</p>';
  }

  function renderLink() {
    const { link, nopsRes, active } = st.result;
    $('c3').hidden = !link;
    if (!link) return;
    const ex = link.linked.filter((x) => x.exact).length, ap = link.linked.filter((x) => !x.exact);
    $('s-link').innerHTML = chip(`업체 <b>${ex + ap.length + link.ambiguous.length + link.unlinked.length}</b>곳`) + chip(`이름이 같음 <b>${ex}</b>`, 'ok') + chip(`비슷한 이름 <b>${ap.length}</b>`, ap.length ? 'warn' : '') + chip(`후보가 여러 개 <b>${link.ambiguous.length}</b>`, link.ambiguous.length ? 'warn' : '') + chip(`못 찾음 <b>${link.unlinked.length}</b>`, link.unlinked.length ? 'bad' : '');
    $('sum-approx').textContent = `비슷한 이름으로 연결한 건 (${ap.length}건 — 맞는지 확인)`;
    $('l-approx').innerHTML = ap.length ? tableOf(['놉스의 업체명', '연결된 대장의 업체명'], ap.map((x) => [x.company, active[x.caseIdx].company])) : '<p class="hint">없음</p>';
    const un = [...link.unlinked.map((n) => [n, '대장에서 찾지 못함']), ...link.ambiguous.map((n) => [n, '대장에 비슷한 업체가 여럿'])];
    $('sum-unlinked').textContent = `연결하지 못한 업체 (${un.length}곳 — 대장에 없거나 이름이 다르게 적힌 경우)`;
    $('l-unlinked').innerHTML = un.length ? tableOf(['놉스의 업체명', '사유'], un) : '<p class="hint">없음</p>';
  }

  function renderApply() {
    const { plan, schedule, auditors } = st.result;
    $('c4').hidden = !st.cases.length;
    $('apply-sum').innerHTML = `인증 건 <b>${plan.records.length}</b>건(연간 배정표) · 심사 일정 <b>${schedule.length}</b>건 · 심사원으로 볼 사람 <b>${auditors.size}</b>명` + (st.parsedNops ? '' : ' <span class="hint">(놉스 일정 없이 대장만 적용합니다)</span>');
    $('btn-apply').disabled = !plan.records.length;
    $('btn-clear').disabled = !D.hasImport();
  }

  /* ---------- 적용 ---------- */
  $('btn-apply').addEventListener('click', () => {
    const { plan, schedule } = st.result;
    try {
      D.saveImport({ plan: plan.records, schedule, builtAt: new Date().toLocaleString('ko-KR'), source: { ledger: st.ledgerName, nops: st.nopsName } });
      setMsg('apply-msg', '적용했습니다. 이 브라우저에서 현황판을 열면 가져온 자료가 보입니다.');
      $('links').hidden = false; $('btn-clear').disabled = false;
    } catch (e) { setMsg('apply-msg', '저장하지 못했습니다(자료가 너무 크거나 브라우저 저장이 막혀 있을 수 있습니다): ' + e.message, true); }
  });
  $('btn-clear').addEventListener('click', () => { D.clearImport(); $('btn-clear').disabled = true; $('links').hidden = true; setMsg('apply-msg', '적용을 해제했습니다. 현황판은 샘플 데이터로 돌아갑니다.'); });

  $('f-ledger').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) onLedger(f); e.target.value = ''; });
  $('f-nops').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) onNops(f); e.target.value = ''; });
  ['sel-y', 'sel-m', 'chk-follow'].forEach((id) => $(id).addEventListener('change', () => { if (st.parsedNops) recompute(); }));
})();
