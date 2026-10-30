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
  const DEMO = true;                       // true면 오늘 날짜를 샘플 기준일(AuditSample.TODAY)로 고정
  const ACK_KEY = 'audit-demo-acks';

  const readLocal = () => { try { return JSON.parse(localStorage.getItem(ACK_KEY) || '[]'); } catch (e) { return []; } };

  window.AuditData = {
    DEMO,
    today() { return DEMO ? new Date(S.TODAY + 'T09:00:00') : new Date(); },
    todayIso() { return DEMO ? S.TODAY : new Date().toISOString().slice(0, 10); },
    async fetchRecords() { return S.generate(); },
    async fetchTasks() { return S.generateTasks(); },
    async fetchPlan() { return S.generatePlan(); },
    async fetchAcks() { return [...S.generateAcks(), ...readLocal()]; },
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
  };
}());
