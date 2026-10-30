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
  const T = typeof require === 'function' ? require('../tasks.js') : window.AuditTasks;
  const pr = T.parseTasks([
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
  const tp = T.buildToday(todayRows, pr.tasks, '2026-10-30');
  const g = (n) => tp.find((p) => p.name === n);
  eq('오늘 심사: 정/부 구분, 보류 제외', [g('갑').audits.map((a) => a.role), g('을').audits.map((a) => a.role), g('병').audits.length], [['정'], ['부'], 0]);
  eq('오늘 할일: 지연이 먼저, 내일·지난 완료 건은 제외', g('갑').tasks.map((t) => [t.title, t.late]), [['지연된 일', 3], ['보고서 작성', 0]]);
  eq('오늘 기한의 완료 건은 완료 표시로 포함', g('을').tasks.map((t) => t.done), [true]);

  const text = out.join('\n') + `\n\n${out.length - fail}/${out.length} 통과`;
  if (typeof document !== 'undefined') { document.getElementById('out').textContent = text; document.title = fail ? 'FAIL' : 'PASS'; }
  else { console.log(text); if (fail) process.exit(1); }
})();
