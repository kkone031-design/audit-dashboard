/* 화면 로직. 맨데이 계산은 rules.js, 샘플 데이터는 sample.js */
(function () {
  'use strict';
  const R = AuditRules;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  const SERIES_COLORS = ['#2f6db5', '#2e8b7a', '#7b5ea7', '#8a6d3b', '#4a8f2f', '#b0508a', '#5a7184', '#3a9bbf', '#7d7d2f', '#6a4c93'];
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];

  const state = {
    rows: [], assigns: [], hasFarmsColumn: false,
    includeHold: false, farmOverrides: new Set(),
    year: null, month: null, selected: '', chartSel: '',
    sort: { key: 'manday', dir: -1 },
  };

  /* ---------- 불러오기 ---------- */
  function setMsg(text, isErr) { const m = $('msg'); m.textContent = text; m.className = 'msg' + (isErr ? ' err' : ''); }

  function load(records, label) {
    const res = R.parseRecords(records);
    const wb = $('warn-box');
    if (!res.rows.length) {
      state.rows = []; $('app').hidden = true;
      setMsg('읽을 수 있는 심사 행이 없습니다. 열 이름(심사일자, 업체명, 인증분야, 정심사원, 부심사원, 지역, 진행상태)을 확인해 주세요.', true);
    } else {
      state.rows = res.rows; state.hasFarmsColumn = res.hasFarmsColumn;
      state.farmOverrides = new Set(); state.selected = ''; state.chartSel = '';
      const ys = res.rows.map((r) => r.y);
      const now = new Date();
      state.year = ys.includes(now.getFullYear()) ? now.getFullYear() : Math.max(...ys);
      const ms = res.rows.filter((r) => r.y === state.year).map((r) => r.m);
      state.month = ms.includes(now.getMonth() + 1) ? now.getMonth() + 1 : Math.max(...ms);
      setMsg(`${label}: ${res.rows.length}건을 불러왔습니다.` + (res.warnings.length ? ` (확인할 항목 ${res.warnings.length}건)` : ''), false);
      $('app').hidden = false;
      refresh(true);
    }
    wb.hidden = !res.warnings.length;
    $('warn-sum').textContent = `불러오기 확인 사항 ${res.warnings.length}건`;
    $('warn-list').innerHTML = res.warnings.map((w) => `<li>${esc(w)}</li>`).join('');
  }

  function readWorkbook(file) {
    if (typeof XLSX === 'undefined') { setMsg('엑셀 라이브러리(SheetJS)를 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 새로고침해 주세요.', true); return; }
    const fr = new FileReader();
    fr.onerror = () => setMsg('파일을 읽지 못했습니다.', true);
    fr.onload = () => {
      try {
        const wb = XLSX.read(new Uint8Array(fr.result), { type: 'array' }); // 날짜는 일련번호 그대로 받아 직접 해석
        const ws = wb.Sheets[wb.SheetNames[0]];
        const recs = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
        load(recs, file.name);
      } catch (e) { setMsg('엑셀 파일을 해석하지 못했습니다: ' + e.message, true); }
    };
    fr.readAsArrayBuffer(file);
  }

  function downloadTemplate() {
    if (typeof XLSX === 'undefined') { setMsg('엑셀 라이브러리를 불러오지 못했습니다.', true); return; }
    const ws = XLSX.utils.aoa_to_sheet([AuditSample.TEMPLATE_HEADERS, ...AuditSample.TEMPLATE_ROWS]);
    ws['!cols'] = [12, 18, 10, 10, 10, 8, 10, 12].map((w) => ({ wch: w }));
    const guide = XLSX.utils.aoa_to_sheet([
      ['작성 안내'],
      ['심사일자: 2026-03-05, 2026.3.5 같은 문자열이나 엑셀 날짜 모두 가능'],
      ['인증분야: ' + R.FIELDS.join(' / ')],
      ['정심사원: 필수 / 부심사원: 비어 있어도 됨 (여러 명이면 쉼표로 구분)'],
      ['진행상태: ' + R.STATUSES.join(' / ') + ' (보류는 기본적으로 집계 제외)'],
      ['표본어가 수: 수산 업체만 선택 입력. 5~8이면 정심사 3 맨데이. 열이 없으면 화면에서 업체별로 체크'],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '심사목록');
    XLSX.utils.book_append_sheet(wb, guide, '작성안내');
    XLSX.writeFile(wb, '심사일정_양식.xlsx');
  }

  /* ---------- 계산 갱신 ---------- */
  function rebuild() {
    state.assigns = R.buildAssignments(state.rows, { includeHold: state.includeHold, farmOverrides: state.farmOverrides });
  }
  function summary() { return R.summarize(state.assigns, state.year, state.month); }

  function refresh(rebuildSelectors) {
    rebuild();
    if (rebuildSelectors) buildPeriodSelectors();
    const sum = summary();
    const names = allAuditors();
    if (state.selected && !names.includes(state.selected)) state.selected = '';
    if (state.chartSel && !names.includes(state.chartSel)) state.chartSel = '';
    renderWarnSummary(sum); renderTable(sum); renderSuisan(); renderAuditorSelects(names); renderCalendar(); renderChart();
    $('t-period').textContent = `${state.year}년 ${state.month}월`;
    $('c-year').textContent = `${state.year}년`;
  }

  function allAuditors() {
    return [...new Set(state.assigns.map((a) => a.auditor))].sort((a, b) => a.localeCompare(b, 'ko'));
  }

  function buildPeriodSelectors() {
    const years = [...new Set(state.rows.map((r) => r.y))].sort();
    $('sel-year').innerHTML = years.map((y) => `<option value="${y}">${y}년</option>`).join('');
    $('sel-year').value = state.year;
    $('sel-month').innerHTML = Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${i + 1}월</option>`).join('');
    $('sel-month').value = state.month;
  }

  function renderAuditorSelects(names) {
    const opt = (v, t, cur) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(t)}</option>`;
    $('sel-cal').innerHTML = opt('', '— 심사원 선택 —', state.selected) + names.map((n) => opt(n, n, state.selected)).join('');
    $('sel-chart').innerHTML = opt('', '전체 비교', state.chartSel) + names.map((n) => opt(n, n, state.chartSel)).join('');
  }

  /* ---------- 경고 요약 ---------- */
  function renderWarnSummary(sum) {
    const w = sum.filter((s) => s.level !== 'ok').sort((a, b) => b.manday - a.manday);
    const el = $('warn-summary');
    if (!w.length) { el.innerHTML = '<span class="ok-text">이 달에는 경고 대상 심사원이 없습니다.</span>'; return; }
    const reds = w.filter((s) => s.level === 'red').length;
    el.innerHTML = `<p>경고 ${w.length}명 (초과 ${reds}명 · 주의 ${w.length - reds}명)</p><div class="chips">` +
      w.map((s) => `<button class="chip ${s.level}" data-name="${esc(s.name)}">${esc(s.name)} ${fmt(s.manday)}${s.level === 'red' ? ' 초과' : ' 주의'}</button>`).join('') + '</div>';
    el.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => select(b.dataset.name)));
  }

  /* ---------- 심사원별 표 ---------- */
  function renderTable(sum) {
    const cols = [
      ['name', '심사원'], ['lead', '정심사 건수'], ['sub', '부심사 건수'], ['manday', '합계 맨데이'], ['done', '완료 건수'], ['planned', '예정 건수'],
    ];
    if (state.includeHold) cols.push(['hold', '보류 건수']);
    const { key, dir } = state.sort;
    sum = sum.slice().sort((a, b) => (key === 'name' ? a.name.localeCompare(b.name, 'ko') : a[key] - b[key]) * dir || a.name.localeCompare(b.name, 'ko'));
    const head = cols.map(([k, t]) => {
      const cur = k === key;
      return `<th class="sortable" data-k="${k}" tabindex="0" aria-sort="${cur ? (dir > 0 ? 'ascending' : 'descending') : 'none'}">${t}${cur ? (dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
    }).join('');
    const body = sum.length ? sum.map((s) => {
      const cls = s.level === 'ok' ? '' : s.level;
      const mcls = s.level === 'red' ? 'num-red' : s.level === 'orange' ? 'num-orange' : '';
      return `<tr class="pick ${cls}${s.name === state.selected ? ' sel' : ''}" tabindex="0" data-name="${esc(s.name)}">` +
        `<td>${esc(s.name)}</td><td>${s.lead}</td><td>${s.sub}</td><td class="${mcls}">${fmt(s.manday)}</td><td>${s.done}</td><td>${s.planned}</td>` +
        (state.includeHold ? `<td>${s.hold}</td>` : '') + '</tr>';
    }).join('') : `<tr><td colspan="${cols.length}" class="l">이 달에 집계할 심사가 없습니다.</td></tr>`;
    const t = $('tbl');
    t.innerHTML = `<thead><tr>${head}</tr></thead><tbody>${body}</tbody>`;
    t.querySelectorAll('th.sortable').forEach((th) => {
      const go = () => {
        const k = th.dataset.k;
        state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : (k === 'name' ? 1 : -1) };
        renderTable(summary());
      };
      th.addEventListener('click', go);
      th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
    t.querySelectorAll('tbody tr.pick').forEach((tr) => {
      tr.addEventListener('click', () => select(tr.dataset.name));
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') select(tr.dataset.name); });
    });
  }

  function select(name) {
    state.selected = state.selected === name ? '' : name;
    state.chartSel = state.selected;
    refresh(false);
    if (state.selected) $('h-cal').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- 수산 표본어가 수동 지정 ---------- */
  function renderSuisan() {
    const items = state.rows.filter((r) => r.field === R.SUISAN.field && r.y === state.year && r.m === state.month && r.farms == null);
    $('suisan-card').hidden = !items.length;
    if (!items.length) return;
    $('tbl-suisan').innerHTML = '<thead><tr><th>심사일자</th><th>업체명</th><th>정심사원</th><th>표본어가 ' + R.SUISAN.sampleMin + '~' + R.SUISAN.sampleMax + '곳</th><th>적용 맨데이</th></tr></thead><tbody>' +
      items.map((r) => {
        const on = state.farmOverrides.has(r.key);
        return `<tr><td class="l">${esc(r.date)}</td><td class="l">${esc(r.company)}</td><td class="l">${esc(r.lead)}</td>` +
          `<td><input type="checkbox" data-key="${esc(r.key)}"${on ? ' checked' : ''} aria-label="${esc(r.company)} 표본어가 ${R.SUISAN.sampleMin}~${R.SUISAN.sampleMax}곳"></td>` +
          `<td>${on ? R.SUISAN.large : R.LEAD_MANDAY[R.SUISAN.field]}</td></tr>`;
      }).join('') + '</tbody>';
    $('tbl-suisan').querySelectorAll('input').forEach((c) => c.addEventListener('change', () => {
      if (c.checked) state.farmOverrides.add(c.dataset.key); else state.farmOverrides.delete(c.dataset.key);
      refresh(false);
    }));
  }

  /* ---------- 달력 ---------- */
  function evHtml(a) {
    const cls = ['ev', a.role === '부' ? 'sub' : '', a.status === '예정' ? 'plan' : '', !a.counted ? 'hold' : ''].filter(Boolean).join(' ');
    const note = !a.counted ? ' · 집계 제외' : '';
    return `<div class="${cls}"><b>${a.role}</b> ${esc(a.company)}<br><span class="st">${esc(a.field || '분야 미상')} · ${esc(a.status)}${note} · ${fmt(a.manday)}MD</span></div>`;
  }

  function renderCalendar() {
    const box = $('cal');
    if (!state.selected) { box.innerHTML = '<p class="hint">위 표에서 심사원을 누르거나 선택 목록에서 고르면 월간 달력이 표시됩니다.</p>'; return; }
    const items = state.assigns.filter((a) => a.auditor === state.selected && a.y === state.year && a.m === state.month);
    const byDay = {};
    items.forEach((a) => (byDay[a.d] = byDay[a.d] || []).push(a));
    const first = new Date(Date.UTC(state.year, state.month - 1, 1)).getUTCDay();
    const last = new Date(Date.UTC(state.year, state.month, 0)).getUTCDate();
    let grid = '<div class="cal-head">' + DOW.map((d) => `<div>${d}</div>`).join('') + '</div><div class="cal-grid">';
    for (let i = 0; i < first; i++) grid += '<div class="day empty"></div>';
    for (let d = 1; d <= last; d++) {
      const w = (first + d - 1) % 7;
      grid += `<div class="day${w === 0 || w === 6 ? ' wk' : ''}"><div class="dn">${d}</div>${(byDay[d] || []).map(evHtml).join('')}</div>`;
    }
    grid += '</div>';
    const days = Object.keys(byDay).map(Number).sort((a, b) => a - b);
    const list = '<ul class="cal-list">' + (days.length ? days.map((d) =>
      `<li><div class="d">${state.month}/${d} (${DOW[new Date(Date.UTC(state.year, state.month - 1, d)).getUTCDay()]})</div><div style="flex:1">${byDay[d].map(evHtml).join('')}</div></li>`).join('') : '<li>이 달 일정이 없습니다.</li>') + '</ul>';
    const s = summary().find((x) => x.name === state.selected);
    box.innerHTML = `<p class="cal-note"><b>${esc(state.selected)}</b> ${state.year}년 ${state.month}월 — 합계 ${s ? fmt(s.manday) : 0} 맨데이 · <span class="hint">정=정심사, 부=부심사, 점선=예정</span></p>` + grid + list;
  }

  /* ---------- 월별 추이 (순수 SVG) ---------- */
  function renderChart() {
    const trend = R.monthlyTrend(state.assigns, state.year);
    const names = state.chartSel ? [state.chartSel] : Object.keys(trend).sort((a, b) => a.localeCompare(b, 'ko'));
    const series = names.map((n) => trend[n] || Array(12).fill(0));
    const maxV = Math.max(0, ...series.flat());
    const yMax = Math.max(24, Math.ceil((maxV + 1) / 4) * 4);
    const single = names.length === 1;
    const slot = single ? 44 : Math.max(46, names.length * 9 + 14);
    const padL = 38, padR = 14, padT = 14, padB = 26, H = 300;
    const W = padL + padR + slot * 12;
    const ph = H - padT - padB;
    const Y = (v) => padT + ph - (v / yMax) * ph;
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${Math.max(W, 0)}" height="${H}" role="img" aria-label="${state.year}년 월별 심사원 맨데이 추이">`;
    for (let v = 0; v <= yMax; v += 4) s += `<line x1="${padL}" x2="${W - padR}" y1="${Y(v)}" y2="${Y(v)}" stroke="#e6ebe8"/><text x="${padL - 6}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`;
    const bw = single ? 24 : Math.max(6, Math.min(14, (slot - 12) / names.length));
    series.forEach((vals, si) => {
      vals.forEach((v, mi) => {
        if (!v) return;
        const x = padL + mi * slot + (slot - bw * names.length) / 2 + si * bw;
        const lvl = R.levelOf(v);
        const fill = single ? (lvl === 'red' ? '#d32f2f' : lvl === 'orange' ? '#e67e00' : '#2f6db5') : SERIES_COLORS[si % SERIES_COLORS.length];
        s += `<rect x="${x}" y="${Y(v)}" width="${bw - (single ? 0 : 1)}" height="${Y(0) - Y(v)}" fill="${fill}" rx="2"><title>${esc(names[si])} ${mi + 1}월 ${fmt(v)} 맨데이</title></rect>`;
        if (single) s += `<text class="ml" x="${x + bw / 2}" y="${Y(v) - 4}" text-anchor="middle">${fmt(v)}</text>`;
      });
    });
    for (let mi = 0; mi < 12; mi++) s += `<text x="${padL + mi * slot + slot / 2}" y="${H - 8}" text-anchor="middle"${mi + 1 === state.month ? ' style="font-weight:700;fill:#1f2a24"' : ''}>${mi + 1}월</text>`;
    s += `<line x1="${padL}" x2="${W - padR}" y1="${Y(R.WARN.red)}" y2="${Y(R.WARN.red)}" stroke="#d32f2f" stroke-width="1.5" stroke-dasharray="6 4"/><text x="${W - padR}" y="${Y(R.WARN.red) - 3}" text-anchor="end" style="fill:#d32f2f">${R.WARN.red}</text>`;
    s += `<line x1="${padL}" x2="${W - padR}" y1="${Y(R.WARN.orange)}" y2="${Y(R.WARN.orange)}" stroke="#e67e00" stroke-width="1.5" stroke-dasharray="6 4"/><text x="${W - padR}" y="${Y(R.WARN.orange) + 12}" text-anchor="end" style="fill:#e67e00">${R.WARN.orange}</text>`;
    s += '</svg>';
    $('chart').innerHTML = s;
    $('chart-legend').innerHTML = (single
      ? `<span><span class="sw" style="background:#2f6db5"></span>${R.WARN.orange} 미만</span><span><span class="sw" style="background:#e67e00"></span>${R.WARN.orange}~${R.WARN.red}</span><span><span class="sw" style="background:#d32f2f"></span>${R.WARN.red} 초과</span>`
      : names.map((n, i) => `<span><span class="sw" style="background:${SERIES_COLORS[i % SERIES_COLORS.length]}"></span>${esc(n)}</span>`).join('')) +
      '<span>점선: 빨강=' + R.WARN.red + ' / 주황=' + R.WARN.orange + ' 기준선</span>';
  }

  /* ---------- 엑셀 내려받기 ---------- */
  function exportXlsx() {
    if (typeof XLSX === 'undefined') { setMsg('엑셀 라이브러리를 불러오지 못했습니다.', true); return; }
    const ym = `${state.year}-${String(state.month).padStart(2, '0')}`;
    const sum = summary().sort((a, b) => b.manday - a.manday);
    const A = sum.map((s) => ({
      '심사원': s.name, '정심사 건수': s.lead, '부심사 건수': s.sub, '합계 맨데이': s.manday, '완료 건수': s.done, '예정 건수': s.planned,
      ...(state.includeHold ? { '보류 건수': s.hold } : {}),
      '경고': s.level === 'red' ? `초과(>${R.WARN.red})` : s.level === 'orange' ? `주의(${R.WARN.orange}~${R.WARN.red})` : '',
    }));
    const trend = R.monthlyTrend(state.assigns, state.year);
    const B = Object.keys(trend).sort((a, b) => a.localeCompare(b, 'ko')).map((n) => {
      const o = { '심사원': n };
      trend[n].forEach((v, i) => { o[`${i + 1}월`] = v; });
      o['연간 합계'] = trend[n].reduce((x, y) => x + y, 0);
      return o;
    });
    const C = state.assigns
      .filter((a) => a.y === state.year && a.m === state.month && (!state.selected || a.auditor === state.selected))
      .sort((a, b) => a.auditor.localeCompare(b.auditor, 'ko') || a.d - b.d)
      .map((a) => ({
        '심사원': a.auditor, '심사일자': a.date, '구분': a.role === '정' ? '정심사' : '부심사', '업체명': a.company, '인증분야': a.field,
        '지역': a.region, '진행상태': a.status, '맨데이': a.manday, '집계 반영': a.counted ? 'O' : 'X(보류 제외)',
      }));
    const wb = XLSX.utils.book_new();
    const add = (data, name, header) => {
      const ws = data.length ? XLSX.utils.json_to_sheet(data) : XLSX.utils.aoa_to_sheet([header]);
      XLSX.utils.book_append_sheet(wb, ws, name);
    };
    add(A, `심사원별_${ym}`, ['심사원']);
    add(B, `월별추이_${state.year}`, ['심사원']);
    add(C, `상세목록_${ym}${state.selected ? '_' + state.selected : ''}`.slice(0, 31), ['심사원']);
    XLSX.writeFile(wb, `심사원_맨데이_${ym}${state.selected ? '_' + state.selected : ''}.xlsx`);
  }

  /* ---------- 이벤트 ---------- */
  $('file').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) readWorkbook(f); e.target.value = ''; });
  $('btn-sample').addEventListener('click', () => load(AuditSample.generate(), '샘플 데이터'));
  $('btn-template').addEventListener('click', downloadTemplate);
  $('btn-export').addEventListener('click', exportXlsx);
  $('chk-hold').addEventListener('change', (e) => { state.includeHold = e.target.checked; refresh(false); });
  $('sel-year').addEventListener('change', (e) => { state.year = +e.target.value; refresh(false); });
  $('sel-month').addEventListener('change', (e) => { state.month = +e.target.value; refresh(false); });
  $('sel-cal').addEventListener('change', (e) => { state.selected = e.target.value; refresh(false); });
  $('sel-chart').addEventListener('change', (e) => { state.chartSel = e.target.value; renderChart(); });
})();
