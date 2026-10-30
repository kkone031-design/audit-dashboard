/* TV 현황판. 계산은 rules.js를 그대로 사용합니다. */
(function () {
  'use strict';
  const R = AuditRules;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];
  const COLORS = ['#6cb6ff', '#7fd1ae', '#c49bff', '#ffd166', '#ff9e7d', '#5ee0e0', '#f78fb3', '#b5d96a', '#9fb4ff', '#e0a96d'];
  const params = new URLSearchParams(location.search);
  const ROTATE_SEC = Math.max(5, +params.get('sec') || 20);   // 슬라이드 전환 간격(초) ?sec=30
  const REFRESH_SEC = 60;                                      // 데이터 다시 읽는 간격
  const SLIDES = ['s1', 's2'];

  /* ★ 연동 지점: 지금은 내장 샘플. SharePoint 목록·DB 등으로 바꿀 때 이 함수만 고치면 됩니다.
     반환 형식: 엑셀 업로드와 같은 열 이름을 가진 객체 배열 */
  async function fetchRecords() { return AuditSample.generate(); }

  let rows = [];
  let slide = 0, timer = null;

  const ymd = (d) => R.isoDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
  const live = () => rows.filter((r) => r.status !== '보류');

  function pickPeriod(now) {
    const ys = rows.map((r) => r.y);
    const y = ys.includes(now.getFullYear()) ? now.getFullYear() : Math.max(...ys);
    const ms = rows.filter((r) => r.y === y).map((r) => r.m);
    const m = y === now.getFullYear() && ms.includes(now.getMonth() + 1) ? now.getMonth() + 1 : Math.max(...ms);
    return { y, m };
  }

  function render() {
    const now = new Date();
    if (!rows.length) { $('rows').innerHTML = '<p class="empty">표시할 심사 데이터가 없습니다.</p>'; return; }
    const { y, m } = pickPeriod(now);
    const assigns = R.buildAssignments(rows, { includeHold: false, farmOverrides: new Set() });
    const sum = R.summarize(assigns, y, m).sort((a, b) => b.manday - a.manday || a.name.localeCompare(b.name, 'ko'));
    $('period').textContent = `${y}년 ${m}월`;

    /* 경고 */
    const warn = sum.filter((s) => s.level !== 'ok');
    $('alert').innerHTML = warn.length
      ? warn.map((s) => `<span class="tag ${s.level}">${s.level === 'red' ? '⚠ ' : ''}${esc(s.name)} ${fmt(s.manday)}</span>`).join('')
      : '<span class="calm">✔ 과부하 심사원 없음</span>';

    /* 막대 */
    const yMax = Math.max(24, Math.ceil(Math.max(0, ...sum.map((s) => s.manday)) / 4) * 4 + 2);
    const pct = (v) => (v / yMax) * 100;
    $('axis').innerHTML = `<span></span><div class="ticks"><span class="t o" style="left:${pct(R.WARN.orange)}%">${R.WARN.orange}</span><span class="t r" style="left:${pct(R.WARN.red)}%">${R.WARN.red}</span></div><span></span>`;
    $('rows').innerHTML = sum.length ? sum.map((s) => `
      <div class="row ${s.level === 'ok' ? '' : s.level}">
        <div class="name">${esc(s.name)}</div>
        <div class="track"><div class="fill" style="width:${pct(s.manday)}%"></div><i class="ref o" style="left:${pct(R.WARN.orange)}%"></i><i class="ref r" style="left:${pct(R.WARN.red)}%"></i></div>
        <div class="val"><b>${fmt(s.manday)}</b><span>정 ${s.lead} · 부 ${s.sub}<br>완료 ${s.done} · 예정 ${s.planned}</span></div>
      </div>`).join('') : '<p class="empty">이 달에 집계할 심사가 없습니다.</p>';

    /* KPI */
    const mrows = live().filter((r) => r.y === y && r.m === m);
    const done = mrows.filter((r) => r.status === '완료').length;
    $('kpis').innerHTML = [['이번 달 심사', mrows.length, ''], ['완료', done, ''], ['예정', mrows.length - done, ''], ['경고 인원', warn.length, warn.length ? 'warn' : '']]
      .map(([t, v, c]) => `<div class="kpi ${c}"><b>${v}</b><span>${t}</span></div>`).join('');

    /* 오늘 / 앞으로 7일 */
    const today = ymd(now);
    const end = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7));
    const li = (r, showDate) => `<li>${showDate ? `<span class="d">${r.m}/${r.d}(${DOW[new Date(r.y, r.m - 1, r.d).getDay()]})</span>` : ''}<span class="who">${esc(r.lead)}${r.subs.length ? ` <span class="fd">+${esc(r.subs.join(','))}</span>` : ''}</span><span class="co">${esc(r.company)}</span><span class="fd">${esc(r.field)}</span></li>`;
    const td = live().filter((r) => r.date === today);
    $('today-n').textContent = td.length ? `${td.length}건` : '';
    $('today').innerHTML = td.length ? td.slice(0, 6).map((r) => li(r, false)).join('') + (td.length > 6 ? `<li class="none">외 ${td.length - 6}건</li>` : '') : '<li class="none">오늘 예정된 심사가 없습니다</li>';
    const wk = live().filter((r) => r.date > today && r.date <= end).sort((a, b) => a.date.localeCompare(b.date));
    $('week-n').textContent = wk.length ? `${wk.length}건` : '';
    $('week').innerHTML = wk.length ? wk.slice(0, 7).map((r) => li(r, true)).join('') + (wk.length > 7 ? `<li class="none">외 ${wk.length - 7}건</li>` : '') : '<li class="none">예정된 심사가 없습니다</li>';

    renderCal(y, m, now, mrows);
    $('updated').textContent = `데이터 갱신 ${now.toTimeString().slice(0, 8)}`;
  }

  function renderCal(y, m, now, mrows) {
    const names = [...new Set(rows.map((r) => r.lead))].sort((a, b) => a.localeCompare(b, 'ko'));
    const first = new Date(y, m - 1, 1).getDay();
    const last = new Date(y, m, 0).getDate();
    const byDay = {};
    mrows.forEach((r) => (byDay[r.d] = byDay[r.d] || []).push(r));
    const isCur = y === now.getFullYear() && m === now.getMonth() + 1;
    const MAX = 5;
    let g = '';
    for (let i = 0; i < first; i++) g += '<div class="cd blank"></div>';
    for (let d = 1; d <= last; d++) {
      const w = (first + d - 1) % 7;
      const list = byDay[d] || [];
      g += `<div class="cd${w === 0 || w === 6 ? ' wk' : ''}${isCur && d === now.getDate() ? ' today' : ''}"><div class="n">${d}</div>` +
        list.slice(0, MAX).map((r) => `<div class="ce${r.status === '예정' ? ' plan' : ''}"><i style="background:${COLORS[names.indexOf(r.lead) % COLORS.length]}"></i><span class="t">${esc(r.lead)} ${esc(r.company)}</span></div>`).join('') +
        (list.length > MAX ? `<div class="more">+${list.length - MAX}건</div>` : '') + '</div>';
    }
    $('cal').innerHTML = `<div class="cal-head">${DOW.map((x) => `<div>${x}</div>`).join('')}</div><div class="cal-grid">${g}</div>`;
  }

  function tickClock() {
    const n = new Date();
    $('clock-time').textContent = n.toTimeString().slice(0, 5);
    $('clock-date').textContent = `${n.getFullYear()}.${n.getMonth() + 1}.${n.getDate()} (${DOW[n.getDay()]})`;
  }

  function show(i) {
    slide = (i + SLIDES.length) % SLIDES.length;
    SLIDES.forEach((id, k) => $(id).classList.toggle('on', k === slide));
    document.querySelectorAll('.dot').forEach((d, k) => d.classList.toggle('on', k === slide));
  }
  function startRotate() {
    clearInterval(timer);
    if (params.get('rotate') !== '0') timer = setInterval(() => show(slide + 1), ROTATE_SEC * 1000);
  }

  async function refresh() {
    try { rows = R.parseRecords(await fetchRecords()).rows; render(); } catch (e) { /* 실패 시 직전 화면 유지 */ }
  }

  $('dots').innerHTML = SLIDES.map((_, i) => `<button class="dot" aria-label="화면 ${i + 1}"></button>`).join('');
  document.querySelectorAll('.dot').forEach((d, i) => d.addEventListener('click', () => { show(i); startRotate(); }));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { show(slide + 1); startRotate(); } else if (e.key === 'ArrowLeft') { show(slide - 1); startRotate(); }
  });
  tickClock(); setInterval(tickClock, 1000);
  show(0); startRotate();
  refresh(); setInterval(refresh, REFRESH_SEC * 1000);
  setInterval(() => { if (rows.length) render(); }, 60 * 1000); // 날짜가 바뀌면 오늘 목록 갱신
})();
