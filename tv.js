/* TV 현황판. 맨데이 계산은 rules.js, 할일 계산은 tasks.js를 사용합니다. */
(function () {
  'use strict';
  const R = AuditRules, T = AuditTasks, C = AuditCheck;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];
  const COLORS = ['#6cb6ff', '#7fd1ae', '#c49bff', '#ffd166', '#ff9e7d', '#5ee0e0', '#f78fb3', '#b5d96a', '#9fb4ff', '#e0a96d'];
  const params = new URLSearchParams(location.search);
  const ROTATE_SEC = Math.max(5, +params.get('sec') || 20);   // 화면 전환 간격(초) ?sec=30
  const REFRESH_SEC = 60;                                      // 데이터 다시 읽는 간격
  const SLIDES = ['s1', 's2', 's5', 's3', 's4'];   // 화면 순서
  const MAX_TASKS = 4;                                         // 심사원 카드 1장에 보여 줄 항목 수

  /* ★ 연동 지점 ─ 지금은 내장 샘플입니다. SharePoint 목록·DB 등으로 바꿀 때 아래 두 함수와 DEMO만 고치면 됩니다.
     fetchRecords: 심사 일정  (엑셀 업로드와 같은 열 이름의 객체 배열)
     fetchTasks  : 심사원 할일 (열: 기한, 담당자, 할일, 업체명, 상태[대기/진행/완료])
     fetchPlan   : 연말에 확정한 연간 배정표 (열: 업체명, 인증분야, 정심사원, 부심사원, 지역, 배정월) */
  const DEMO = true;                     // true면 오늘 날짜를 샘플 기준일로 고정
  async function fetchRecords() { return AuditSample.generate(); }
  async function fetchTasks() { return AuditSample.generateTasks(); }
  async function fetchPlan() { return AuditSample.generatePlan(); }

  let rows = [], tasks = [], plan = [];
  let slide = 0, timer = null;

  const ymd = (d) => R.isoDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
  const live = () => rows.filter((r) => r.status !== '보류');
  const refDate = () => (DEMO ? new Date(AuditSample.TODAY + 'T09:00:00') : new Date());

  function pickPeriod(now) {
    const ys = rows.map((r) => r.y);
    const y = ys.includes(now.getFullYear()) ? now.getFullYear() : Math.max(...ys);
    const ms = rows.filter((r) => r.y === y).map((r) => r.m);
    const m = y === now.getFullYear() && ms.includes(now.getMonth() + 1) ? now.getMonth() + 1 : Math.max(...ms);
    return { y, m };
  }

  function render() {
    const now = refDate();
    if (!rows.length) { $('today').innerHTML = '<p class="none">표시할 심사 데이터가 없습니다.</p>'; return; }
    const { y, m } = pickPeriod(now);
    const today = ymd(now);
    const assigns = R.buildAssignments(rows, { includeHold: false, farmOverrides: new Set() });
    const sum = R.summarize(assigns, y, m).sort((a, b) => b.manday - a.manday || a.name.localeCompare(b.name, 'ko'));
    const mdOf = new Map(sum.map((s) => [s.name, s]));
    $('period').textContent = `${y}년 ${m}월`;

    /* 상단: 과부하는 작은 배지로 */
    const warn = sum.filter((s) => s.level !== 'ok');
    $('alert').innerHTML = warn.length
      ? `<span>맨데이 주의</span>` + warn.map((s) => `<span class="tag ${s.level}">${esc(s.name)} ${fmt(s.manday)}</span>`).join('')
      : '<span>맨데이 주의 대상 없음</span>';

    /* 화면 1-좌: 오늘 심사, 앞으로 7일 */
    const td = live().filter((r) => r.date === today);
    $('today-n').textContent = td.length ? `${td.length}건` : '';
    const MAXC = 5;
    $('today').innerHTML = td.length
      ? td.slice(0, MAXC).map((r) => `<div class="card ${r.status === '완료' ? 'done' : ''}"><div class="co">${esc(r.company)}<span class="pill ${r.status === '예정' ? 'plan' : ''}">${esc(r.status)}</span></div><div class="who"><b>정 ${esc(r.lead)}</b>${r.subs.length ? ` · 부 ${esc(r.subs.join(', '))}` : ''}</div><div class="meta">${esc(r.field)}${r.region ? ' · ' + esc(r.region) : ''}</div></div>`).join('') + (td.length > MAXC ? `<div class="none">외 ${td.length - MAXC}건</div>` : '')
      : '<p class="none">오늘 예정된 심사가 없습니다</p>';
    const end = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7));
    const wk = live().filter((r) => r.date > today && r.date <= end).sort((a, b) => a.date.localeCompare(b.date));
    $('week-n').textContent = wk.length ? `${wk.length}건` : '';
    $('week').innerHTML = wk.length
      ? wk.slice(0, 4).map((r) => `<li><span class="d">${r.m}/${r.d}(${DOW[new Date(r.y, r.m - 1, r.d).getDay()]})</span><span class="who">${esc(r.lead)}</span><span class="co">${esc(r.company)}</span><span class="fd">${esc(r.field)}</span></li>`).join('') + (wk.length > 4 ? `<li class="none">외 ${wk.length - 4}건</li>` : '')
      : '<li class="none">예정된 심사가 없습니다</li>';

    /* 화면 1-우: 심사원별 오늘의 할일 */
    const people = T.buildToday(rows, tasks, today);
    $('people').style.gridTemplateColumns = `repeat(${people.length > 8 ? 3 : 2}, minmax(0, 1fr))`;
    $('people').innerHTML = people.map((p) => {
      const items = [
        ...p.audits.map((a) => ({ cls: 'audit', ic: '<span class="ic a">▶</span>', t: `${esc(a.company)} <small>${a.role === '정' ? '정심사' : '부심사'}</small>`, em: '' })),
        ...p.tasks.map((t) => t.done
          ? { cls: 'done', ic: '<span class="ic ok">✓</span>', t: `${esc(t.title)}${t.company ? ` <small>${esc(t.company)}</small>` : ''}`, em: '' }
          : t.late > 0
            ? { cls: 'late', ic: '<span class="ic l">!</span>', t: `${esc(t.title)}${t.company ? ` <small>${esc(t.company)}</small>` : ''}`, em: `지연 ${t.late}일` }
            : { cls: 'due', ic: '<span class="ic d">□</span>', t: `${esc(t.title)}${t.company ? ` <small>${esc(t.company)}</small>` : ''}`, em: '오늘 마감' }),
      ];
      const shown = items.length > MAX_TASKS ? items.slice(0, MAX_TASKS - 1) : items;
      const s = mdOf.get(p.name);
      const md = s ? `<span class="md ${s.level === 'ok' ? '' : s.level}">맨데이 ${fmt(s.manday)}</span>` : '';
      return `<div class="pc${items.length ? ' busy' : ''}"><div class="ph"><span class="pn">${esc(p.name)}</span>${md}</div><ul class="tl">` +
        (shown.length ? shown.map((i) => `<li class="${i.cls}">${i.ic}<span class="t">${i.t}</span>${i.em ? `<em>${i.em}</em>` : ''}</li>`).join('') + (items.length > shown.length ? `<li class="more">외 ${items.length - shown.length}건</li>` : '') : '<li class="none">오늘 등록된 할일 없음</li>') + '</ul></div>';
    }).join('');

    /* 화면 2: 달력 */
    renderCal(y, m, now, live().filter((r) => r.y === y && r.m === m));

    /* 화면 2: 점검 필요 */
    const rc = C.reconcile(plan, rows, today);
    const conf = C.conflicts(rows).filter((c) => c.date >= today);
    const late = tasks.filter((t) => t.status !== '완료' && T.daysBetween(t.due, today) > 0)
      .map((t) => ({ ...t, late: T.daysBetween(t.due, today) })).sort((a, b) => b.late - a.late);
    const trend = R.monthlyTrend(C.planAssignments(plan, y), y);
    const crowd = [];
    Object.keys(trend).forEach((n) => trend[n].forEach((v, i) => { if (i + 1 >= m && R.levelOf(v) !== 'ok') crowd.push({ name: n, m: i + 1, v, level: R.levelOf(v) }); }));
    crowd.sort((a, b) => a.m - b.m || b.v - a.v);
    const diffN = rc.changed.length + rc.moved.length + rc.unplanned.length;
    const tile = (label, n, cls) => `<div class="tile ${n ? cls : 'ok'}"><b>${n ? n : '✔'}</b><span>${label}</span></div>`;
    $('checks').innerHTML = tile('일정 누락·미확정', rc.missing.length + rc.unscheduled.length, rc.missing.length ? 'red' : 'orange')
      + tile('일정 충돌', conf.length, 'red') + tile('배정표와 다른 건', diffN, 'orange')
      + tile('보고서 지연', late.length, 'red') + tile('쏠림 예상(남은 달)', crowd.length, crowd.some((c) => c.level === 'red') ? 'red' : 'orange');
    const fill = (ul, nEl, items, render, max) => {
      $(nEl).textContent = items.length ? `${items.length}건` : '';
      $(ul).innerHTML = items.length ? items.slice(0, max).map(render).join('') + (items.length > max ? `<li class="none">외 ${items.length - max}건</li>` : '') : '<li class="okline">✔ 해당 없음</li>';
    };
    const li = (d, who, co, tag, tcls) => `<li><span class="d">${d}</span><span class="who">${esc(who)}</span><span class="co">${co}</span><span class="tag2 ${tcls}">${tag}</span></li>`;
    if (!plan.length) { $('l-miss').innerHTML = $('l-diff').innerHTML = '<li class="none">연간 배정표가 등록되어 있지 않습니다</li>'; }
    else {
      fill('l-miss', 'n-miss', [...rc.missing.map((x) => ({ ...x, k: 'm' })), ...rc.unscheduled.map((x) => ({ ...x, k: 'u' }))],
        (x) => li(`${x.month}월 배정`, x.lead, esc(x.company), x.k === 'm' ? `일정 없음 · ${m - x.month}개월 경과` : '이번 달 · 일정 미확정', x.k === 'm' ? 'red' : 'orange'), 6);
      fill('l-diff', 'n-diff', [...rc.changed.map((x) => ({ ...x, k: 'c' })), ...rc.moved.map((x) => ({ ...x, k: 'v' })), ...rc.unplanned.map((x) => ({ ...x, k: 'p' }))],
        (x) => x.k === 'c' ? li('담당 변경', x.actualLead, `${esc(x.company)} <span class="fd">배정 ${esc(x.planLead)} → ${esc(x.actualLead)}</span>`, '확인', 'blue')
          : x.k === 'v' ? li('월 이동', x.lead, `${esc(x.company)} <span class="fd">${x.planMonth}월 → ${x.actualMonth}월</span>`, '확인', 'blue')
            : li('배정 외', x.lead, `${esc(x.company)} <span class="fd">${x.date.slice(5).replace('-', '/')}</span>`, '확인', 'muted'), 6);
    }
    fill('l-conf', 'n-conf', conf, (c) => li(`${+c.date.slice(5, 7)}/${+c.date.slice(8)}(${DOW[new Date(c.date + 'T00:00:00').getDay()]})`, c.auditor, esc(c.companies.join(' / ')), `${c.companies.length}건 중복`, 'red'), 6);
    fill('l-late', 'n-late', late, (t) => li(`지연 ${t.late}일`, t.owner, `${esc(t.title)}${t.company ? ` <span class="fd">${esc(t.company)}</span>` : ''}`, '', 'red'), 6);

    /* 화면 5: 월별 인증 진행 */
    const ST = C.STAGES;
    const cases = C.caseStages(plan, rows, today);
    const sc = C.stageCounts(cases);
    const selM = +params.get('month') >= 1 && +params.get('month') <= 12 ? +params.get('month') : m;   // ?month=9 로 다른 달 보기
    const maxTot = Math.max(1, ...sc.map((x) => x.total));
    $('stage-key').innerHTML = ST.map((n, i) => `<i class="st-dot s${i}"></i>${esc(n)}`).join('');
    $('pipe-total').textContent = plan.length ? `${y}년 · 총 ${cases.length}건 · 발급 완료 ${sc.reduce((a, x) => a + x.counts[ST.length - 1], 0)}건` : '';
    $('mbars').innerHTML = plan.length ? sc.map((x, i) => `<div class="mb${i + 1 === selM ? ' cur' : ''}"><div class="tot">${x.total || ''}</div><div class="col"><div class="stk" style="height:${(x.total / maxTot) * 100}%">${x.counts.map((c, k) => (c ? `<div class="seg s${k}" style="flex:${c}" title="${esc(ST[k])} ${c}건"></div>` : '')).join('')}</div></div><div class="lbl">${i + 1}월</div><div class="late">${x.overdue ? `지연 ${x.overdue}` : ''}</div></div>`).join('')
      : '<p class="none">연간 배정표가 등록되어 있지 않습니다</p>';
    const selCases = cases.filter((c) => c.month === selM).sort((a, b) => b.overdue - a.overdue || a.company.localeCompare(b.company, 'ko'));
    const odN = selCases.filter((c) => c.overdue).length;
    $('kb-title').innerHTML = `${selM}월 인증 건 <small>${selCases.length}건${odN ? ` · 지연 ${odN}건` : ''}</small>`;
    const MAXK = 9;
    $('kanban').innerHTML = ST.map((name, k) => {
      const list = selCases.filter((c) => c.stageIdx === k);
      return `<div class="kc s${k}"><h3><span>${esc(name)}</span><b>${list.length}</b></h3><ul>` +
        list.slice(0, MAXK).map((c) => `<li class="${c.overdue ? 'od' : ''}"><span class="cn">${esc(c.company)}</span><span class="sub">${esc(c.field)} · ${esc(c.lead)}</span></li>`).join('') +
        (list.length > MAXK ? `<li class="more">외 ${list.length - MAXK}건</li>` : (list.length ? '' : '<li class="more">없음</li>')) + '</ul></div>';
    }).join('');

    /* 화면 4: 연간 월별 부하(배정 기준) */
    const names = [...new Set([...Object.keys(trend), ...rows.map((r) => r.lead)])].sort((a, b) => a.localeCompare(b, 'ko'));
    const now_m = m;
    $('heat').innerHTML = plan.length
      ? `<div class="hr hd"><div></div>${Array.from({ length: 12 }, (_, i) => `<div class="${i + 1 === now_m ? 'now' : ''}">${i + 1}월</div>`).join('')}</div>` +
        names.map((n) => `<div class="hr"><div class="nm">${esc(n)}</div>${Array.from({ length: 12 }, (_, i) => { const v = (trend[n] || [])[i] || 0; const lv = R.levelOf(v); return `<div class="${v ? (lv === 'ok' ? '' : 'c-' + lv) : 'c-none'}${i + 1 === now_m ? ' now' : ''}">${v ? fmt(v) : '–'}</div>`; }).join('')}</div>`).join('')
      : '<p class="none">연간 배정표가 등록되어 있지 않습니다</p>';
    $('crowd').innerHTML = crowd.length
      ? crowd.slice(0, 10).map((c) => `<li><span class="d">${c.m}월</span><span class="who">${esc(c.name)}</span><span class="co"></span><span class="tag2 ${c.level === 'red' ? 'red' : 'orange'}">${fmt(c.v)}</span></li>`).join('') + (crowd.length > 10 ? `<li class="none">외 ${crowd.length - 10}건</li>` : '')
      : '<li class="okline">✔ 이번 달 이후 쏠림 없음</li>';

    $('updated').textContent = DEMO ? `샘플 데이터 · 기준일 ${today}` : `데이터 갱신 ${new Date().toTimeString().slice(0, 8)}`;
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
    const d = DEMO ? refDate() : n;
    $('clock-time').textContent = n.toTimeString().slice(0, 5);
    $('clock-date').textContent = `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()} (${DOW[d.getDay()]})`;
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
    try {
      const [rec, tk, pl] = await Promise.all([fetchRecords(), fetchTasks(), fetchPlan()]);
      rows = R.parseRecords(rec).rows; tasks = T.parseTasks(tk).tasks; plan = C.parsePlan(pl).plan;
      render();
    } catch (e) { /* 실패 시 직전 화면 유지 */ }
  }

  $('dots').innerHTML = SLIDES.map((_, i) => `<button class="dot" aria-label="화면 ${i + 1}"></button>`).join('');
  document.querySelectorAll('.dot').forEach((d, i) => d.addEventListener('click', () => { show(i); startRotate(); }));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { show(slide + 1); startRotate(); } else if (e.key === 'ArrowLeft') { show(slide - 1); startRotate(); }
  });
  const only = +params.get('slide'); // ?slide=2 로 특정 화면 고정(확인용)
  tickClock(); setInterval(tickClock, 1000);
  show(only >= 1 && only <= SLIDES.length ? only - 1 : 0); startRotate();
  refresh(); setInterval(refresh, REFRESH_SEC * 1000);
  // 벽면 TV는 며칠씩 켜 두므로, 주기적으로 페이지 전체를 다시 불러와 새 버전 배포를 자동 반영 (?reload=분, 0이면 끔)
  const reloadMin = params.has('reload') ? +params.get('reload') : 60;
  if (reloadMin > 0) setTimeout(() => location.reload(), reloadMin * 60 * 1000);
})();
