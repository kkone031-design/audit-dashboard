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
  const sc = CK.stageCounts(cs, 2026);
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

  // 12) 신규/갱신 소속 월과 60일 처리기한
  const np = CK.parsePlan([
    { '업체명': '갱신A', '정심사원': '갑', '구분': '갱신', '인증만료일': '2026-09-15', '접수일': '2026-08-10', '진행단계': '현장' },
    { '업체명': '신규B', '정심사원': '갑', '구분': '신규', '접수일': '2026-09-03', '진행단계': '서류' },
    { '업체명': '신규C', '정심사원': '갑', '구분': '신규', '배정월': 12, '진행단계': '신청전' },
    { '업체명': '갱신D', '정심사원': '갑', '구분': '갱신', '인증만료일': '2026-11-10', '진행단계': '신청전' },
    { '업체명': '갱신E', '정심사원': '갑', '구분': '갱신', '인증만료일': '2026-09-20', '접수일': '2026-09-01', '진행단계': '발급' },
    { '업체명': '이상', '정심사원': '갑', '구분': '재신청', '배정월': 5 },
  ]);
  eq('구분·접수일·만료일 파싱, 알 수 없는 구분은 경고', [np.plan.map((x) => x.type), np.warnings.length], [['갱신', '신규', '신규', '갱신', '갱신', ''], 1]);
  eq('배정월이 없으면 기준 날짜의 월을 사용', [np.plan[0].month, np.plan[1].month, np.plan[2].month], [9, 9, 12]);
  const nc = CK.caseStages(np.plan, [], '2026-10-30');
  const c = (n) => nc.find((x) => x.company === n);
  eq('소속 월: 갱신=만료월, 신규=접수월, 접수 전 신규=배정월', [c('갱신A').ym, c('신규B').ym, c('신규C').ym], [{ y: 2026, m: 9 }, { y: 2026, m: 9 }, { y: 2026, m: 12 }]);
  eq('기한: 신규=접수+60일, 갱신=인증 만료일과 접수+60일 중 빠른 날, 접수 전 신규는 기한 없음', [c('갱신A').deadline, c('갱신A').dueBasis, c('신규B').deadline, c('신규B').dueBasis, c('신규C').deadline], ['2026-09-15', '인증만료', '2026-11-02', '처리기한', '']);
  eq('만료 지난 갱신A는 지연(-45일), 잔여 3일 신규B는 촉박(red)', [c('갱신A').overdue, c('갱신A').daysLeft, c('신규B').overdue, c('신규B').daysLeft, c('신규B').level], [true, -45, false, 3, 'red']);
  eq('접수 후 경과일(+N일): 갱신A 81일, 신규B 57일, 접수 전은 null', [c('갱신A').elapsed, c('신규B').elapsed, c('신규C').elapsed], [81, 57, null]);
  const early = CK.caseStages(CK.parsePlan([{ '업체명': 'Z', '정심사원': '갑', '구분': '갱신', '인증만료일': '2027-03-01', '접수일': '2026-10-01', '진행단계': '서류' }]).plan, [], '2026-10-30')[0];
  eq('갱신이라도 접수+60일이 만료보다 빠르면 처리기한이 기한', [early.deadline, early.dueBasis, early.daysLeft], ['2026-11-30', '처리기한', 31]);
  eq('발급 완료 건은 기한이 지나도 지연 아님', [c('갱신E').overdue, c('갱신E').level], [false, '']);
  eq('접수 전 갱신: 만료 30일 이내면 접수 필요(renewalRisk), 접수일이 있으면 해당 없음', [c('갱신D').renewalRisk, c('갱신D').toExpiry, c('갱신A').renewalRisk], [true, 11, false]);
  const near = CK.caseStages(CK.parsePlan([{ '업체명': 'N', '정심사원': '갑', '구분': '갱신', '인증만료일': '2026-11-20', '진행단계': '신청전' }]).plan, [], '2026-10-30')[0];
  eq('만료 21일 전 접수 전 갱신 → 접수 필요', [near.renewalRisk, near.toExpiry], [true, 21]);
  eq('5개월 창: 10월 기준 8~12월, 연도 넘어가는 경우도 이어짐', [CK.monthWindow(2026, 10, 2, 2).map((x) => x.m), CK.monthWindow(2026, 11, 2, 2).map((x) => `${x.y}-${x.m}`)], [[8, 9, 10, 11, 12], ['2026-9', '2026-10', '2026-11', '2026-12', '2027-1']]);

  // 13) 인증 관리 대장 읽기 (ledger.js) — 가상 데이터
  const LG = typeof require === 'function' ? require('../ledger.js') : window.AuditLedger;
  const ser = (iso) => R.ymdToSerial(+iso.slice(0, 4), +iso.slice(5, 7), +iso.slice(8));
  const H1 = ['연번', '계', '협', '전', '만료월', '지역\n구분', '주소', '대표품목', '인증분류', '생산자', '인증번호', '인증만료일', '구분', '담당자', '심사원', '심의관', '특이사항', '신청서 제출일', '접수일', '접수번호', '처리기한', '인증서\n교부일', '서류 심사일', '심사내역서1 날짜 (심사일)'];
  const mkRow = (o) => H1.map((h) => { const k = h.replace(/\s/g, ''); const v = o[k]; return v == null ? '' : (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? ser(v) : v); });
  const domestic = [
    ['2026 국내 인증자 현황'], [], H1,
    mkRow({ 연번: 1, 인증분류: '유기가공식품', 생산자: '가나다식품', 인증만료일: '2026-11-20', 구분: '갱신', 심사원: '갑', 접수일: '2026-10-10', 처리기한: '2026-12-09', 서류심사일: '2026-10-20', 지역구분: '강원도' }),
    mkRow({ 연번: 2, 인증분류: '유기농산물', 생산자: '라마바농장', 인증만료일: '신규', 구분: '신규', 심사원: '을', 접수일: '2026-10-01', 서류심사일: '2026-10-05', '심사내역서1날짜(심사일)': '2026-10-25' }),
    mkRow({ 연번: 3, 인증분류: '취급자', 생산자: '사아자유통', 인증만료일: '2026-09-30', 구분: '종료', 심사원: '갑' }),
    mkRow({ 연번: 4, 인증분류: '무항생제축산물', 생산자: '차카타목장', 인증만료일: '2026-10-05', 구분: '갱신', 심사원: '갑', 접수일: '2026-09-01', '인증서교부일': '2026-10-02' }),
    mkRow({ 연번: 5, 인증분류: '유기가공식품', 생산자: '파하식품', 인증만료일: '신규', 구분: '재신규', 심사원: '갑,을' }),
    [], ['', '', '', '', '', '', '', '', '', '소계', 3],
    mkRow({ 연번: 6, 인증분류: '유기가공식품', 생산자: '미래식품', 인증만료일: '2026-12-31', 구분: '중도 갱신', 심사원: '', 접수일: '2026-10-28', '심사내역서1날짜(심사일)': '2026-11-15' }),
  ];
  const lg = LG.parseLedger([{ name: '2026 국내', aoa: domestic }, { name: '2026 국내 변경', aoa: domestic }, { name: '유보', aoa: domestic }], '2026-10-30');
  eq('시트 선택: 국내 시트만 읽고 변경·유보 시트는 건너뜀', [lg.report.length, lg.report[0].kind, lg.report[0].header, lg.cases.length], [1, '국내', 3, 6]);
  const lc = (n) => lg.cases.find((c) => c.company === n);
  eq('날짜 열로 단계 판정(서류/현장/발급/접수/신청전)', [lc('가나다식품').stage, lc('라마바농장').stage, lc('차카타목장').stage, lc('미래식품').stage, lc('파하식품').stage], ['서류심사', '현장심사', '인증서 발급', '접수', '신청전']);
  eq('오늘 이후의 현장심사일은 아직 안 한 일로 봄', lc('미래식품').stage, '접수');
  eq('구분 해석: 재신규=신규, 중도 갱신=갱신', [lc('파하식품').type, lc('미래식품').type, lc('가나다식품').type], ['신규', '갱신', '갱신']);
  eq('종료 구분은 기본 제외', LG.activeCases(lg.cases).map((c) => c.company).includes('사아자유통'), false);
  eq('정심사원=첫 이름, 나머지는 부심사원, 심사원이 비면 (미배정)', [lc('파하식품').lead, lc('파하식품').subs, lc('미래식품').lead], ['갑', ['을'], '(미배정)']);
  eq('인증분류 → 분야', ['유기가공식품', '유기농산물', '무항생제축산물', '취급자(무취)', '무농약원료가공식품'].map((t) => LG.mapField(t, '국내')), ['유기가공', '농산물', '무항생제', '취급자', '유기가공']);
  eq('수산 시트 분야: 가공이면 수산가공, 아니면 수산', [LG.mapField('유기수산물', '수산'), LG.mapField('유기가공식품', '수산')], ['수산', '수산가공']);
  eq('소계 줄(번호 없음)은 건너뜀', lg.cases.some((c) => c.company === '소계'), false);
  const prp = LG.toPlanRecords(LG.activeCases(lg.cases));
  eq('연간표 변환: 월을 정할 날짜가 없는 건은 제외하고 개수 알림', [prp.records.length, prp.noDate], [4, 1]);
  const pcs = CK.caseStages(CK.parsePlan(prp.records).plan, [], '2026-10-30');
  const pc = (n) => pcs.find((x) => x.company === n);
  eq('대장의 처리기한 열이 있으면 접수+60일 대신 그 값을 사용(연장 반영)', [pc('가나다식품').procDeadline, pc('가나다식품').deadline, pc('가나다식품').dueBasis], ['2026-12-09', '2026-11-20', '인증만료']);
  eq('처리기한 열이 없으면 접수+60일', pc('미래식품').procDeadline, '2026-12-27');
  const HS = ['번호', '인증 사업자', '전체어가', '표본어가', '경북', '인증품목', '주소', '구분', '담당심사원(정)', '담당심사원(부)', '컨설팅', '특이사항', '인증번호', '접수번호', '인증종료일', '독려공문', '견적서 발송', '활성처리제', '입금일 (접수일과 맞출 것)', '처리기한 (2개월)', '신청비', '현장심사일', '인증서 발급', '서류 심사일'];
  const suRow = ['1', '해바라기수산', '10', '6', '', '유기수산물', '주소', '갱신', '병', '정', '', '', '102-0001', '', ser('2026-12-10'), 'o', '', '', ser('2026-10-20'), ser('2026-12-19'), '', '', '', ser('2026-10-25')];
  const su = LG.parseSheet([['2026 수산 인증자 현황'], [], HS, suRow], '수산', '2026-10-30').cases[0];
  eq('수산 시트: 정/부 열, 표본어가, 입금일=접수일, 처리기한', [su.lead, su.subs, su.farms, su.received, su.due, su.field, su.stage], ['병', ['정'], 6, '2026-10-20', '2026-12-19', '수산', '서류심사']);
  const lk = LG.linkCompanies(['가나다식품', '(주)라마바농장', '차카타', '그린', '없는업체'], [{ company: '가나다식품' }, { company: '라마바농장 주식회사' }, { company: '차카타목장' }, { company: '그린푸드' }, { company: '그린팜' }]);
  eq('업체명 연결: 정확/근사/모호/못 찾음', [lk.linked.filter((x) => x.exact).length, lk.linked.filter((x) => !x.exact).length, lk.ambiguous, lk.unlinked], [2, 1, [], ['그린', '없는업체']]);
  const lim = LG.limitAuditors([{ lead: '갑', subs: ['을', '병'] }, { lead: '정', subs: ['갑'] }, { lead: LG.NO_LEAD, subs: [] }], ['갑', '을']);
  eq('심사원 범위 제한: 범위 밖 정심사원은 (기타), 범위 밖 부심사원은 제외', lim.map((c) => [c.lead, c.subs]), [['갑', ['을']], ['(기타)', ['갑']], ['(미배정)', []]]);

  // 14) 놉스 달력 변환 (nops.js) — 가상 데이터
  const NP = typeof require === 'function' ? require('../nops.js') : window.AuditNops;
  const NH = ['구분', '상위부서/부서명', '이름', ...Array.from({ length: 31 }, (_, i) => `${i + 1}일`)];
  const nrow = (grp, dept, name, cells) => [grp, dept, name, ...Array.from({ length: 31 }, (_, i) => cells[i + 1] || '')];
  const nops = [NH,
    nrow('기관', '인증심사', '갑(심사원)', { 5: '  9:00 [갑] 현장심사_가나다식품_(가공_갱신)', 8: '  9:00 [갑] [수산]현장심사(정)_해바라기양어장(무항수산_신규/정_메기)_차량필요', 12: '  9:00 [갑] 사후관리_사과농장_(가공)', 22: '  9:00 [갑] 유기수산_파래_서리어촌계 현장심사(정), 병 과장 동행(부)', 28: '  9:00 [갑] 현장심사_공동농장_(농산_갱신)' }),
    nrow('', '', '을(심사원)', { 8: '  9:00 [을] [수산]현장심사(부)_해바라기양어장(무항수산_신규/부_메기)', 15: '  9:00 [을] 휴가', 20: '  9:00 [을] 현장심사_바나나식품_(가공_갱신) 사후관리_딸기식품_(가공)', 25: '  9:00 [을] 철원닉스팜 NOP 심사', 28: '  9:00 [을] 현장심사_공동농장_(농산_갱신)' })];
  const np2 = NP.parseNops(nops);
  const evOf = (co) => np2.events.filter((e) => e.company === co);
  eq('이벤트 해석: 업체명·구분·분야·역할', [evOf('가나다식품')[0].type, evOf('가나다식품')[0].field, evOf('해바라기양어장').map((e) => e.role), evOf('해바라기양어장')[0].type, evOf('해바라기양어장')[0].field], ['갱신', '유기가공', ['정', '부'], '신규', '수산']);
  eq('한 칸에 일정 두 개: 현장심사와 사후관리로 나눔', [evOf('바나나식품').length, evOf('딸기식품')[0].kind], [1, '사후관리']);
  eq('휴가는 심사가 아님(비심사 1건), 해석 못 한 문장은 없음(NOP 심사는 해석함)', [np2.nonAudit.length, np2.suspicious.length], [1, 0]);
  eq('업체명이 앞에 오는 표기: 업체명다운 조각을 선택하고 역할(정) 인식', [evOf('서리어촌계').length, evOf('서리어촌계')[0].role, evOf('서리어촌계')[0].pattern], [1, '정', 'B']);
  const nb = NP.buildRows(np2, { year: 2026, month: 10, todayIso: '2026-10-10', regIso: '2026-10-10' });
  const nr = (co) => nb.rows.find((r) => r['업체명'] === co);
  eq('같은 날 같은 업체는 한 건으로 합치고 정/부 구분', [nr('해바라기양어장')['정심사원'], nr('해바라기양어장')['부심사원']], ['갑', '을']);
  eq('진행상태: 오늘 이전은 완료, 오늘 이후는 예정', [nr('가나다식품')['진행상태'], nr('서리어촌계')['진행상태']], ['완료', '예정']);
  eq('사후관리는 기본 제외, 옵션을 켜면 포함', [nb.rows.some((r) => r['업체명'] === '사과농장'), NP.buildRows(np2, { year: 2026, month: 10, todayIso: '2026-10-10', includeFollowUp: true }).rows.some((r) => r['업체명'] === '사과농장')], [false, true]);
  eq('정/부 표기가 없는 공동 심사는 확인 필요 목록', [nb.uncertain.map((u) => u.company), nr('공동농장')['정심사원']], [['공동농장'], '갑']);
  eq('표기가 섞인 건(업체명 위치)과 NOP 심사 표기는 확인 목록에 올림', nb.review.map((v) => v.company), ['서리어촌계', '철원닉스팜']);
  eq('대상 인원 제한(갑만)', NP.buildRows(np2, { year: 2026, month: 10, todayIso: '2026-10-10', people: new Set(['갑']) }).rows.some((r) => r['정심사원'] === '을' || r['부심사원'] === '을'), false);
  eq('변환된 행은 심사 일정 형식으로 읽힘', R.parseRecords(nb.rows).rows.length, nb.rows.length);

  // 15) 보강: 부가 표기, 'NOP 심사' 표기, 인증 대장 기반 점검(loose)
  const ev2 = (t) => NP.parseEventText(t).items;
  eq('종류 뒤 부가 표기(입회심사)는 무시하고 업체명을 읽음', [ev2('현장심사(입회심사)_가나다식품_(무항_신규)')[0].company, ev2('현장심사(입회심사)_가나다식품_(무항_신규)')[0].type], ['가나다식품', '신규']);
  eq("'업체 NOP 심사', '업체(취급)심사' 표기 해석", [ev2('철원닉스팜 NOP 심사')[0].company, ev2('철원닉스팜 NOP 심사')[0].pattern, ev2('넥세스(취급)심사')[0].company, ev2('넥세스(취급)심사')[0].field], ['철원닉스팜', 'C', '넥세스', '취급자']);
  eq('휴가는 심사로 해석하지 않음', ev2('휴가').length + ev2('오전반차').length, 0);
  const lp = CK.parsePlan([
    { '업체명': '발급끝', '정심사원': '갑', '구분': '갱신', '인증만료일': '2026-10-05', '진행단계': '발급' },
    { '업체명': '심사끝', '정심사원': '갑', '구분': '갱신', '인증만료일': '2026-10-06', '진행단계': '현장' },
    { '업체명': '접수중', '정심사원': '갑', '구분': '갱신', '인증만료일': '2026-10-20', '접수일': '2026-09-20', '진행단계': '접수' },
    { '업체명': '다른달', '정심사원': '갑', '구분': '갱신', '인증만료일': '2026-07-20', '접수일': '2026-06-20', '진행단계': '접수' },
    { '업체명': '담당다름', '정심사원': '갑', '구분': '갱신', '인증만료일': '2026-10-25', '접수일': '2026-09-25', '진행단계': '서류' },
  ]).plan;
  const lrows = R.parseRecords([{ '심사일자': '2026-10-27', '업체명': '담당다름', '인증분야': '농산물', '정심사원': '을', '진행상태': '예정' }, { '심사일자': '2026-10-28', '업체명': '대장없음', '인증분야': '농산물', '정심사원': '을', '진행상태': '예정' }]).rows;
  const strict = CK.reconcile(lp, lrows, '2026-10-30'), loose = CK.reconcile(lp, lrows, '2026-10-30', { loose: true });
  eq('이미 발급·심사 끝난 건은 일정이 없어도 누락이 아님', strict.missing.map((x) => x.company), ['다른달']);
  eq('대장 모드(loose): 일정이 들어 있는 달(10월)만 판단, 지난 달 배정은 알 수 없어 제외', [loose.missing.length, loose.unscheduled.map((x) => x.company)], [0, ['접수중']]);
  eq('대장 모드: 담당 변경·월 이동은 비교하지 않고, 대장에 없는 일정은 그대로 알림', [loose.changed.length, loose.moved.length, loose.unplanned.map((x) => x.company)], [0, 0, ['대장없음']]);

  // 16) 부문(농축산/수산)과 부문별 처리기한
  eq('부문 판정: 수산·수산가공=수산, 그 밖(해외 포함)=농축산', [CK.divOfField('수산'), CK.divOfField('수산가공'), CK.divOfField('유기가공'), CK.divOfField(''), CK.divOfField('유기수산물')], ['수산', '수산', '농축산', '농축산', '수산']);
  const dp = CK.parsePlan([
    { '업체명': 'D1', '정심사원': '갑', '배정월': 3, '인증분야': '수산' },
    { '업체명': 'D2', '정심사원': '갑', '배정월': 3, '인증분야': '유기가공' },
    { '업체명': 'D3', '정심사원': '갑', '배정월': 3, '인증분야': '유기가공', '부문': '수산' },
  ]).plan;
  eq('부문 열이 없으면 분야로 판정, 있으면 부문 열 우선', dp.map((x) => x.div), ['수산', '농축산', '수산']);
  const ls = LG.parseSheet([['t'], [], H1, mkRow({ 연번: 1, 인증분류: '유기가공식품', 생산자: '해외농장', 구분: '갱신', 심사원: '갑', 접수일: '2026-10-01' })], '해외', '2026-10-30').cases[0];
  const lsu = LG.parseSheet([['t'], [], HS, suRow], '수산', '2026-10-30').cases[0];
  eq('대장 시트 → 부문: 해외·국내는 농축산, 수산 시트는 수산', [ls.div, lg.cases[0].div, lsu.div], ['농축산', '농축산', '수산']);
  eq('연간표 변환에 부문이 들어감', LG.toPlanRecords([ls, lsu]).records.map((r) => r['부문']), ['농축산', '수산']);
  const save = { ...CK.DEADLINE.daysByDiv };
  CK.DEADLINE.daysByDiv['수산'] = 45;
  const dc = CK.caseStages(CK.parsePlan([
    { '업체명': 'N1', '정심사원': '갑', '구분': '신규', '접수일': '2026-10-01', '진행단계': '접수', '인증분야': '유기가공' },
    { '업체명': 'S1', '정심사원': '갑', '구분': '신규', '접수일': '2026-10-01', '진행단계': '접수', '인증분야': '수산' },
    { '업체명': 'S2', '정심사원': '갑', '구분': '신규', '접수일': '2026-10-01', '진행단계': '접수', '인증분야': '수산', '처리기한': '2026-12-31' },
  ]).plan, [], '2026-10-30');
  CK.DEADLINE.daysByDiv['수산'] = save['수산'];
  eq('부문별 처리기한: 농축산 60일, 수산 45일(설정 시), 대장의 처리기한 열이 있으면 그 값', dc.map((c) => c.deadline), ['2026-11-30', '2026-11-15', '2026-12-31']);

  const text = out.join('\n') + `\n\n${out.length - fail}/${out.length} 통과`;
  if (typeof document !== 'undefined') { document.getElementById('out').textContent = text; document.title = fail ? 'FAIL' : 'PASS'; }
  else { console.log(text); if (fail) process.exit(1); }
})();
