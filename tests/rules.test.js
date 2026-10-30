/* 맨데이 계산 테스트: `node tests/rules.test.js` 또는 브라우저에서 tests.html 열기 */
(function () {
  const R = typeof require === 'function' ? require('../rules.js') : window.AuditRules;
  const S = typeof require === 'function' ? require('../sample.js') : window.AuditSample;
  const out = [];
  let fail = 0;
  const eq = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) fail++;
    out.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (기대 ${JSON.stringify(want)}, 실제 ${JSON.stringify(got)})`}`);
  };
  const row = (o) => R.parseRecords([Object.assign({ '심사일자': '2026-03-05', '업체명': 'A', '인증분야': '농산물', '정심사원': '갑', '부심사원': '', '진행상태': '완료' }, o)]).rows[0];
  const lead = (o, ov) => R.leadManday(row(o), ov).value;

  // 1) 분야별 정심사 맨데이
  eq('유기가공 2.5', lead({ '인증분야': '유기가공' }), 2.5);
  eq('수산가공 2.5', lead({ '인증분야': '수산가공' }), 2.5);
  eq('농산물 2', lead({ '인증분야': '농산물' }), 2);
  eq('축산물 2', lead({ '인증분야': '축산물' }), 2);
  eq('취급자 2', lead({ '인증분야': '취급자' }), 2);
  eq('무항생제 2', lead({ '인증분야': '무항생제' }), 2);
  eq('수산 기본 1.5', lead({ '인증분야': '수산' }), 1.5);
  // 2) 수산 표본어가
  eq('수산 표본어가 4 → 1.5', lead({ '인증분야': '수산', '표본어가 수': 4 }), 1.5);
  eq('수산 표본어가 5 → 3', lead({ '인증분야': '수산', '표본어가 수': 5 }), 3);
  eq('수산 표본어가 8 → 3', lead({ '인증분야': '수산', '표본어가 수': '8' }), 3);
  eq('수산 표본어가 9 → 1.5', lead({ '인증분야': '수산', '표본어가 수': 9 }), 1.5);
  const r = row({ '인증분야': '수산' });
  eq('수산 수동 체크 → 3', R.leadManday(r, new Set([r.key])).value, 3);
  const r2 = row({ '인증분야': '수산', '표본어가 수': 3 });
  eq('표본어가 열 값이 있으면 수동 체크보다 우선', R.leadManday(r2, new Set([r2.key])).value, 1.5);
  // 3) 부심사원 0.5, 비어 있는 부심사원
  const a1 = R.buildAssignments([row({ '부심사원': '을' })], {});
  eq('부심사원 0.5', a1.find((a) => a.role === '부').manday, 0.5);
  eq('부심사원 없음 → 배정 1건', R.buildAssignments([row({})], {}).length, 1);
  eq('정심사원과 같은 이름의 부심사원은 무시', R.buildAssignments([row({ '부심사원': '갑' })], {}).length, 1);
  // 4) 보류 제외 / 포함
  const hold = [row({ '진행상태': '보류' }), row({ '업체명': 'B', '진행상태': '예정' })];
  eq('보류 제외 맨데이', R.summarize(R.buildAssignments(hold, {}), 2026, 3)[0].manday, 2);
  eq('보류 포함 맨데이', R.summarize(R.buildAssignments(hold, { includeHold: true }), 2026, 3)[0].manday, 4);
  // 5) 날짜 파싱, 열 이름 공백
  eq('날짜 2026-03-05', R.parseDate('2026-03-05'), { y: 2026, m: 3, d: 5 });
  eq('날짜 2026.3.5', R.parseDate('2026.3.5'), { y: 2026, m: 3, d: 5 });
  eq('날짜 2026/3/5', R.parseDate('2026/3/5'), { y: 2026, m: 3, d: 5 });
  eq('날짜 2026년 3월 5일', R.parseDate('2026년 3월 5일'), { y: 2026, m: 3, d: 5 });
  eq('엑셀 일련번호', R.parseDate(R.ymdToSerial(2026, 3, 5)), { y: 2026, m: 3, d: 5 });
  eq('엑셀 일련번호 46086 = 2026-03-05', R.parseDate(46086), { y: 2026, m: 3, d: 5 });
  eq('없는 날짜(2월 30일)는 null', R.parseDate('2026-02-30'), null);
  eq('열 이름 앞뒤 공백 허용', R.parseRecords([{ ' 심사일자 ': '2026-03-05', ' 업체명': 'A', '인증분야 ': '농산물', ' 정심사원 ': '갑' }]).rows.length, 1);
  // 6) 경고 단계 경계
  eq('18 미만 ok', R.levelOf(17.5), 'ok');
  eq('18 주황', R.levelOf(18), 'orange');
  eq('20 주황', R.levelOf(20), 'orange');
  eq('20.5 빨강', R.levelOf(20.5), 'red');

  // 7) 샘플 데이터: 독립 구현과 대조
  const parsed = R.parseRecords(S.generate());
  eq('샘플 파싱 경고 없음', parsed.warnings.length, 0);
  const T = { 유기가공: 2.5, 수산가공: 2.5, 농산물: 2, 축산물: 2, 취급자: 2, 무항생제: 2 };
  const expect = {};
  parsed.rows.forEach((x) => {
    if (x.status === '보류') return;
    const k = (n) => `${n}|${x.m}`;
    let md = T[x.field];
    if (x.field === '수산') md = x.farms != null && x.farms >= 5 && x.farms <= 8 ? 3 : 1.5;
    expect[k(x.lead)] = (expect[k(x.lead)] || 0) + md;
    x.subs.forEach((sname) => { expect[k(sname)] = (expect[k(sname)] || 0) + 0.5; });
  });
  const assigns = R.buildAssignments(parsed.rows, {});
  let mism = 0, cnt = 0;
  for (let m = 1; m <= 12; m++) R.summarize(assigns, 2026, m).forEach((s) => { cnt++; if (expect[`${s.name}|${m}`] !== s.manday) mism++; });
  eq(`샘플 ${cnt}개 (심사원×월) 맨데이가 독립 계산과 일치`, mism, 0);
  const lv = { red: 0, orange: 0 };
  for (let m = 1; m <= 12; m++) R.summarize(assigns, 2026, m).forEach((s) => { if (lv[s.level] != null) lv[s.level]++; });
  eq('샘플에 빨강 경고 존재', lv.red > 0, true);
  eq('샘플에 주황 경고 존재', lv.orange > 0, true);
  eq('샘플 12월 추이 길이', Object.values(R.monthlyTrend(assigns, 2026))[0].length, 12);

  // 8) 오늘의 할일 (tasks.js)
  const TK = typeof require === 'function' ? require('../tasks.js') : window.AuditTasks;
  const pr = TK.parseTasks([
    { '기한': '2026-10-30', '담당자': '갑', '할일': '보고서 작성', '업체명': 'A', '상태': '진행' },
    { '기한': '2026-10-27', '담당자': '갑', '할일': '지연된 일', '상태': '대기' },
    { '기한': '2026-10-30', '담당자': '을', '할일': '끝난 일', '상태': '완료' },
    { '기한': '2026-10-31', '담당자': '갑', '할일': '내일 일', '상태': '대기' },
    { '기한': '2026-10-20', '담당자': '갑', '할일': '이미 끝난 지난 일', '상태': '완료' },
    { '기한': '날짜아님', '담당자': '갑', '할일': 'x' },
  ]);
  eq('할일 파싱: 잘못된 행은 경고와 함께 제외', [pr.tasks.length, pr.warnings.length], [5, 1]);
  const todayRows = R.parseRecords([{ '심사일자': '2026-10-30', '업체명': 'A', '인증분야': '농산물', '정심사원': '갑', '부심사원': '을', '진행상태': '완료' },
    { '심사일자': '2026-10-30', '업체명': 'B', '인증분야': '농산물', '정심사원': '병', '진행상태': '보류' }]).rows;
  const tp = TK.buildToday(todayRows, pr.tasks, '2026-10-30');
  const g = (n) => tp.find((p) => p.name === n);
  eq('오늘 심사: 정/부 구분, 보류 제외', [g('갑').audits.map((a) => a.role), g('을').audits.map((a) => a.role), g('병').audits.length], [['정'], ['부'], 0]);
  eq('오늘 할일: 지연이 먼저, 내일·지난 완료 건은 제외', g('갑').tasks.map((t) => [t.title, t.late]), [['지연된 일', 3], ['보고서 작성', 0]]);
  eq('오늘 기한의 완료 건은 완료 표시로 포함', g('을').tasks.map((t) => t.done), [true]);

  // 9) 연간 배정표 대조·충돌·월별 부하 (check.js)
  const CK = typeof require === 'function' ? require('../check.js') : window.AuditCheck;
  const pp = CK.parsePlan([
    { '업체명': 'A농장', '인증분야': '농산물', '정심사원': '갑', '부심사원': '을', '배정월': '3월' },
    { '업체명': 'B농장', '인증분야': '농산물', '정심사원': '갑', '배정월': 7 },
    { '업체명': 'C농장', '인증분야': '농산물', '정심사원': '갑', '배정월': '2026-10' },
    { '업체명': 'D농장', '인증분야': '농산물', '정심사원': '병', '배정월': 5 },
    { '업체명': 'E 농장', '인증분야': '수산', '정심사원': '병', '배정월': 10 },
    { '업체명': '월없음', '정심사원': '갑', '배정월': '13월' },
  ]);
  eq('배정표 파싱: 월 형식 3월/7/2026-10, 잘못된 행 제외', [pp.plan.map((x) => x.month), pp.warnings.length], [[3, 7, 10, 5, 10], 1]);
  const sched = R.parseRecords([
    { '심사일자': '2026-03-05', '업체명': 'A농장', '인증분야': '농산물', '정심사원': '갑', '부심사원': '을', '진행상태': '완료' },
    { '심사일자': '2026-06-10', '업체명': 'D농장', '인증분야': '농산물', '정심사원': '정', '진행상태': '완료' },
    { '심사일자': '2026-10-10', '업체명': 'E농장', '인증분야': '수산', '정심사원': '병', '진행상태': '예정' },
    { '심사일자': '2026-10-10', '업체명': '배정외', '인증분야': '농산물', '정심사원': '병', '진행상태': '예정' },
    { '심사일자': '2026-10-12', '업체명': '보류건', '인증분야': '농산물', '정심사원': '무', '진행상태': '보류' },
    { '심사일자': '2026-10-12', '업체명': '보류건2', '인증분야': '농산물', '정심사원': '무', '진행상태': '예정' },
  ]).rows;
  const rc = CK.reconcile(pp.plan, sched, '2026-10-30');
  eq('대조: 지난 달 배정인데 일정 없음 = 누락', rc.missing.map((x) => x.company), ['B농장']);
  eq('대조: 이번 달 배정인데 일정 없음 = 미확정', rc.unscheduled.map((x) => x.company), ['C농장']);
  eq('대조: 담당 변경(D농장 병→정)', rc.changed.map((x) => [x.company, x.planLead, x.actualLead]), [['D농장', '병', '정']]);
  eq('대조: 월 이동(D농장 5→6월), 업체명 공백 차이는 같은 업체', rc.moved.map((x) => [x.company, x.planMonth, x.actualMonth]), [['D농장', 5, 6]]);
  eq('대조: 배정표에 없는 심사', rc.unplanned.map((x) => x.company), ['배정외', '보류건', '보류건2']);
  eq('충돌: 병이 10/10에 2건', CK.conflicts(sched).map((c) => [c.auditor, c.date, c.companies.length]), [['병', '2026-10-10', 2]]);
  const pl = R.monthlyTrend(CK.planAssignments(pp.plan, 2026), 2026);
  eq('월별 부하(배정 기준): 갑 3월=2, 7월=2, 10월=2 / 을 3월=0.5', [pl['갑'][2], pl['갑'][6], pl['갑'][9], pl['을'][2]], [2, 2, 2, 0.5]);
  eq('월별 부하: 수산(표본어가 없음) 1.5', pl['병'][9], 1.5);

  // 10) 인증 진행 단계
  eq('단계 표기 인식', ['신청전', '접수', '서류', '심사(현장)', '인증서발급', '발급', '모름', ''].map(CK.parseStage), ['신청전', '접수', '서류심사', '현장심사', '인증서 발급', '인증서 발급', null, null]);
  const sp = CK.parsePlan([
    { '업체명': 'S1', '정심사원': '갑', '배정월': 3, '진행단계': '인증서 발급' },
    { '업체명': 'S2', '정심사원': '갑', '배정월': 3, '진행단계': '서류' },
    { '업체명': 'S3', '정심사원': '갑', '배정월': 10 },
    { '업체명': 'S4', '정심사원': '갑', '배정월': 10 },
    { '업체명': 'S5', '정심사원': '갑', '배정월': 11 },
    { '업체명': 'S6', '정심사원': '갑', '배정월': 10, '진행단계': '이상한값' },
  ]);
  eq('알 수 없는 단계는 경고', sp.warnings.length, 1);
  const srows = R.parseRecords([
    { '심사일자': '2026-10-05', '업체명': 'S3', '인증분야': '농산물', '정심사원': '갑', '진행상태': '완료' },
    { '심사일자': '2026-10-20', '업체명': 'S4', '인증분야': '농산물', '정심사원': '갑', '진행상태': '예정' },
  ]).rows;
  const cs = CK.caseStages(sp.plan, srows, '2026-10-30');
  const st = (n) => cs.find((c) => c.company === n);
  eq('단계 추정: 일정 완료=현장심사, 예정=접수, 일정 없음=신청전', [st('S3').stage, st('S4').stage, st('S5').stage, st('S6').stage], ['현장심사', '접수', '신청전', '신청전']);
  eq('명시한 단계가 추정보다 우선, 추정 여부 표시', [st('S2').stage, st('S2').derived, st('S3').derived], ['서류심사', false, true]);
  eq('지연: 지난 달 배정인데 발급 전만 true', [st('S1').overdue, st('S2').overdue, st('S3').overdue, st('S5').overdue], [false, true, false, false]);
  const sc = CK.stageCounts(cs);
  eq('월별 단계 건수(3월): 서류1·발급1, 지연1', [sc[2].counts, sc[2].total, sc[2].overdue], [[0, 0, 1, 0, 1], 2, 1]);

  // 11) 배정 확인 (ack.js)
  const AK = typeof require === 'function' ? require('../ack.js') : window.AuditAck;
  const mk = (o) => R.parseRecords([Object.assign({ '심사일자': '2026-11-20', '업체명': 'K농장', '인증분야': '농산물', '정심사원': '갑', '부심사원': '을', '진행상태': '예정', '등록일': '2026-10-30' }, o)]).rows[0];
  const chk = (row, acks, today) => AK.checkAcks([row], AK.parseAcks(acks).acks, today || '2026-10-30');
  const pend = chk(mk({}), []);
  eq('등록 당일: 정·부 모두 미확인이지만 아직 경고 아님(normal)', [pend.pending.map((p) => p.auditor + p.role), pend.pending.map((p) => p.level), pend.total, pend.acked], [['갑정', '을부'], ['normal', 'normal'], 2, 0]);
  const one = chk(mk({}), [{ '심사일자': '2026-11-20', '업체명': 'K농장', '확인자': '갑', '확인일시': '2026-10-30 10:00' }]);
  eq('정심사원만 확인하면 부심사원만 대기', [one.pending.map((p) => p.auditor), one.acked], [['을'], 1]);
  eq('등록 1일 경과=주황, 2일 경과=빨강', [chk(mk({ '등록일': '2026-10-29' }), []).pending[0].level, chk(mk({ '등록일': '2026-10-28' }), []).pending[0].level], ['orange', 'red']);
  eq('심사 3일 전까지 미확인이면 등록 직후라도 긴급(red)', chk(mk({ '심사일자': '2026-11-02' }), []).pending[0].level, 'red');
  const chg = chk(mk({ '등록일': '2026-10-20', '변경일': '2026-10-29' }), [{ '심사일자': '2026-11-20', '업체명': 'K농장', '확인자': '갑', '확인일시': '2026-10-21 09:00' }]);
  eq('변경 후에는 이전 확인이 무효 → 재확인 필요', chg.pending.filter((p) => p.auditor === '갑').map((p) => [p.reason, p.waitDays]), [['changed', 1]]);
  eq('변경 이후에 한 확인은 유효', chk(mk({ '등록일': '2026-10-20', '변경일': '2026-10-29' }), [{ '심사일자': '2026-11-20', '업체명': 'K농장', '확인자': '갑', '확인일시': '2026-10-29 15:00' }]).pending.map((p) => p.auditor), ['을']);
  eq('완료·보류·지난 일정은 확인 대상 아님', [chk(mk({ '진행상태': '완료' }), []).total, chk(mk({ '진행상태': '보류' }), []).total, chk(mk({ '심사일자': '2026-10-01' }), []).total], [0, 0, 0]);
  eq('등록일이 없으면 오늘 등록으로 보고 경고하지 않음', chk(mk({ '등록일': '' }), []).pending.map((p) => p.level), ['normal', 'normal']);
  eq('긴급·지연이 먼저, 심사일 임박한 순', AK.checkAcks([mk({ '업체명': 'A', '심사일자': '2026-12-01', '부심사원': '' }), mk({ '업체명': 'B', '심사일자': '2026-11-01', '부심사원': '' }), mk({ '업체명': 'C', '심사일자': '2026-12-05', '등록일': '2026-10-25', '부심사원': '' })], [], '2026-10-30').pending.map((p) => p.company), ['B', 'C', 'A']);

  const text = out.join('\n') + `\n\n${out.length - fail}/${out.length} 통과`;
  if (typeof document !== 'undefined') { document.getElementById('out').textContent = text; document.title = fail ? 'FAIL' : 'PASS'; }
  else { console.log(text); if (fail) process.exit(1); }
})();
