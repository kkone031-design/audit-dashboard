/* 데이터 연동 지점 ─ 지금은 내장 샘플 + 이 브라우저(localStorage)에 저장하는 시안 모드입니다.
   실제 운영에서는 이 파일의 함수들만 SharePoint 목록·DB 호출로 바꾸면 TV 현황판과 심사원 화면이 그대로 동작합니다.
   - fetchRecords : 심사 일정   (열: 심사일자, 업체명, 인증분야, 정심사원, 부심사원, 지역, 진행상태, [표본어가 수], [등록일], [변경일])
   - fetchTasks   : 심사원 할일 (열: 기한, 담당자, 할일, 업체명, 상태)
   - fetchPlan    : 연간 배정표 (열: 업체명, 인증분야, 정심사원, 부심사원, 지역, 배정월, [진행단계])
   - fetchAcks    : 배정 확인 기록 (열: 심사일자, 업체명, 확인자, 확인일시)
   - saveAck      : 심사원이 확인 버튼을 눌렀을 때 기록 저장 */
(function () {
  'use strict';
  const S = AuditSample;
  const ACK_KEY = 'audit-demo-acks';
  const IMPORT_KEY = 'audit-import-v1';    // 가져오기 화면(import.html)에서 '현황판에 적용'한 자료. 이 브라우저에만 저장됨

  const readLocal = () => { try { return JSON.parse(localStorage.getItem(ACK_KEY) || '[]'); } catch (e) { return []; } };
  const readImport = () => { try { const j = JSON.parse(localStorage.getItem(IMPORT_KEY) || 'null'); return j && j.plan && j.schedule ? j : null; } catch (e) { return null; } };
  const forceDemo = new URLSearchParams(location.search).get('demo') === '1';   // ?demo=1 이면 가져온 자료가 있어도 샘플을 보여 줌
  const imp = forceDemo ? null : readImport();
  const DEMO = !imp;                       // true면 샘플 데이터이고 오늘 날짜를 샘플 기준일(AuditSample.TODAY)로 고정
  const localIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  window.AuditData = {
    DEMO,
    IMPORTED: !!imp,
    builtAt: imp ? imp.builtAt : '',
    today() { return DEMO ? new Date(S.TODAY + 'T09:00:00') : new Date(); },
    todayIso() { return DEMO ? S.TODAY : localIso(new Date()); },
    async fetchRecords() { return imp ? imp.schedule : S.generate(); },
    async fetchTasks() { return imp ? [] : S.generateTasks(); },
    async fetchPlan() { return imp ? imp.plan : S.generatePlan(); },
    async fetchAcks() { return imp ? readLocal() : [...S.generateAcks(), ...readLocal()]; },
    /** 가져오기 화면에서 호출: { plan:[…], schedule:[…], builtAt } */
    saveImport(data) { localStorage.setItem(IMPORT_KEY, JSON.stringify(data)); },
    clearImport() { try { localStorage.removeItem(IMPORT_KEY); } catch (e) { /* 무시 */ } },
    hasImport() { return !!readImport(); },
    /** ack = { date: '2026-11-10', company, auditor } */
    async saveAck(ack) {
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      const list = readLocal();
      list.push({ '심사일자': ack.date, '업체명': ack.company, '확인자': ack.auditor, '확인일시': `${this.todayIso()} ${hhmm}` });
      try { localStorage.setItem(ACK_KEY, JSON.stringify(list)); } catch (e) { throw new Error('이 브라우저에서는 시안 저장을 쓸 수 없습니다'); }
    },
    resetDemoAcks() { try { localStorage.removeItem(ACK_KEY); } catch (e) { /* 무시 */ } },
    ACK_KEY,
    IMPORT_KEY,
  };
}());
