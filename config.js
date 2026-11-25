/* ============================================================
   행사 설정 — 결제 뒤 고객사 맞춤은 이 파일과 theme.css만 고치면 돼요.
   ============================================================ */
window.EVENT_CONFIG = {
  companyName: 'OO그룹',          /* 회사 이름 */
  eventTitle: '2027 시무식',       /* 행사 이름 */
  eventDate: '2027. 1. 5',
  logoUrl: '',                     /* 로고 그림 주소 (비우면 LOGO 자리 표시) 예: 'assets/logo.svg' */

  goal: 1000,                      /* 목표 (억 원) */
  stopAt: 999,                     /* 직원 탭으로 멈추는 지점 (억 원) */
  durationSec: 10,                 /* 탭 속도와 상관없이 stopAt 까지 걸리는 시간(초) */

  headline: '1000억의 순간',
  doneLine: '2027, 우리가 함께 만든 1000억',
  doneSub: '모두의 손끝이 만든 숫자입니다',

  /* 실시간 중계 서버 (시안은 무료 공개 서버, 본 행사는 전용 서버로 교체) */
  broker: 'wss://broker.emqx.io:8084/mqtt',
  topicPrefix: 'evg-k7Qm2x',
  room: 'demo',                    /* 주소 뒤 ?r=방이름 으로 방을 나눌 수 있어요 */

  draftLabel: '시안 · DRAFT'       /* 최종본에서는 '' 로 비우기 */
};
