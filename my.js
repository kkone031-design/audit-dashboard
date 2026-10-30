/* 심사원용 모바일 화면(시안): 지원팀이 등록·변경한 배정을 확인한다 */
(function () {
  'use strict';
  const R = AuditRules, T = AuditTasks, AK = AuditAck, D = AuditData;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DOW = ['일', '월', '화', '수', '목', '금', '토'];
  const WHO_KEY = 'audit-demo-who';
  const params = new URLSearchParams(location.search);
  let rows = [], tasks = [], acks = [], who = '';

  const md = (iso) => `${+iso.slice(5, 7)}/${+iso.slice(8)}(${DOW[new Date(iso + 'T00:00:00').getDay()]})`;
  const store = {
    get() { try { return localStorage.getItem(WHO_KEY) || ''; } catch (e) { return ''; } },
    set(v) { try { localStorage.setItem(WHO_KEY, v); } catch (e) { /* 무시 */ } },
  };
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), 2800); }

  async function load() {
    const [rec, tk, ak] = await Promise.all([D.fetchRecords(), D.fetchTasks(), D.fetchAcks()]);
    rows = R.parseRecords(rec).rows; tasks = T.parseTasks(tk).tasks; acks = AK.parseAcks(ak).acks;
    const names = [...new Set(rows.flatMap((r) => [r.lead, ...r.subs]))].sort((a, b) => a.localeCompare(b, 'ko'));
    if (!names.length) { $('summary').textContent = '표시할 배정이 없습니다. 일정(놉스)을 가져오기 화면에서 적용해 주세요.'; $('who').innerHTML = ''; return; }
    who = names.includes(params.get('as')) ? params.get('as') : names.includes(store.get()) ? store.get() : names[0];
    $('who').innerHTML = names.map((n) => `<option${n === who ? ' selected' : ''}>${esc(n)}</option>`).join('');
    $('demo').textContent = D.DEMO ? `※ 시안입니다. 샘플 데이터이며 확인 기록은 이 브라우저에만 저장됩니다. 기준일 ${D.todayIso()}` : '※ 시안입니다. 가져온 데이터이며 확인 기록은 이 브라우저에만 저장됩니다.';
    render();
  }

  function render() {
    const today = D.todayIso();
    const ck = AK.checkAcks(rows, acks, today);
    const mine = ck.pending.filter((p) => p.auditor === who);
    const redN = mine.filter((p) => p.level === 'red').length;

    $('summary').className = 'summary ' + (redN ? 'alert' : mine.length ? '' : 'ok');
    $('summary').innerHTML = mine.length
      ? `<b>${mine.length}건</b> 확인이 필요합니다${redN ? ` <span class="pill red">지연·긴급 ${redN}건</span>` : ''}`
      : '✔ 확인할 배정이 없습니다. 모두 확인하셨습니다.';
    $('n-pend').textContent = mine.length ? `${mine.length}건` : '';

    const lv = (p) => (p.reason === 'changed' && p.level !== 'red' ? '변경' : p.level === 'red' ? (p.daysToAudit <= AK.ACK.urgentBefore ? '긴급' : '지연') : p.level === 'orange' ? '주의' : '신규');
    $('pending').innerHTML = mine.length ? mine.map((p, i) => {
      const note = p.reason === 'changed' ? `<p class="note orange">일정이 변경되었습니다 (${md(p.since)}). 다시 확인해 주세요.</p>`
        : p.waitDays ? `<p class="note ${p.level === 'red' ? 'red' : 'orange'}">지원팀 등록 후 ${p.waitDays}일째 미확인입니다.</p>` : `<p class="note meta">방금 등록되었습니다.</p>`;
      return `<article class="card ${p.level === 'normal' ? '' : p.level}"><div><span class="pill ${p.level === 'normal' ? '' : p.level}">${lv(p)}</span><span class="pill role">${p.role === '정' ? '정심사' : '부심사'}</span></div>` +
        `<h3>${esc(p.company)}</h3><div class="meta">${esc(p.field || '분야 미상')}${p.region ? ' · ' + esc(p.region) : ''}</div>` +
        `<div><b>${md(p.date)}</b> · D-${p.daysToAudit}</div>${note}` +
        `<button class="ack-btn" data-i="${i}">확인했습니다</button></article>`;
    }).join('') : '<p class="empty">모든 배정을 확인했습니다 👍</p>';
    document.querySelectorAll('.ack-btn').forEach((b) => b.addEventListener('click', async () => {
      const p = mine[+b.dataset.i];
      b.disabled = true;
      try { await D.saveAck({ date: p.date, company: p.company, auditor: who }); acks = AK.parseAcks(await D.fetchAcks()).acks; toast(`확인 처리했습니다: ${p.company}`); render(); }
      catch (e) { b.disabled = false; toast(e.message || '저장하지 못했습니다. 다시 시도해 주세요.'); }
    }));

    /* 오늘 할 일: 오늘 심사 + 마감 지난 일 + 오늘 마감 */
    const me = T.buildToday(rows, tasks, today).find((x) => x.name === who) || { audits: [], tasks: [] };
    const items = [
      ...me.audits.map((a) => `<li>▶ 현장 심사 · ${esc(a.company)} <span class="meta">(${a.role === '정' ? '정심사' : '부심사'})</span></li>`),
      ...me.tasks.map((t) => `<li class="${t.done ? 'done' : t.late ? 'late' : 'due'}">${t.done ? '✓' : t.late ? '!' : '□'} ${esc(t.title)}${t.company ? ` · ${esc(t.company)}` : ''} ${t.done ? '' : t.late ? `(지연 ${t.late}일)` : '(오늘 마감)'}</li>`),
    ];
    $('today').innerHTML = items.length ? items.join('') : '<li class="meta">오늘 등록된 할일이 없습니다</li>';

    /* 확인 완료 */
    const mineDone = acks.filter((a) => a.auditor === who).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 15)
      .map((a) => { const r = rows.find((x) => AK.ackId(x.date, x.company) === a.id); return r ? `<li>${esc(r.company)} <span class="meta">${md(r.date)} · 확인 ${esc(a.at.slice(5, 16))}</span></li>` : ''; }).filter(Boolean);
    $('n-done').textContent = mineDone.length ? `(최근 ${mineDone.length}건)` : '';
    $('done').innerHTML = mineDone.join('') || '<li class="meta">아직 없습니다</li>';
  }

  $('who').addEventListener('change', (e) => { who = e.target.value; store.set(who); render(); });
  $('reset').addEventListener('click', async () => { D.resetDemoAcks(); acks = AK.parseAcks(await D.fetchAcks()).acks; toast('시안 확인 기록을 초기화했습니다'); render(); });
  load();
})();
