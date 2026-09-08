# 구현 검증 현황

2026-09-08 로컬 통합 기준. Phase1·2 구현/통합 검사와 Sol 최종 감사를 완료했고 Phase3 구현을 시작한다. Phase3~6 전체 구현 또는 외부 연동 완료를 뜻하지 않는다. 과거 화면 초안 기록은 아래에 별도 보존한다.

| 확인 대상 | 현재 증거 | 상태/한계 |
|---|---|---|
| 같은 전체 제공기록지 화면, 새 탭, 전체 회차/추가 과거 기록, 관리자 진입 | Phase1 Sol SHIP; 관리자 mock 브라우저24개(390/480/1280) | PASS, 실제 운영 인증 시험과 구분 |
| 초안/revision 불변성, 같은 case/branch 참조, 활성 초안 unique, CAS, 연속 revision 번호 | Task2.1 PG empty/legacy 각11개, 메인 통합 legacy11개, Prisma diff empty; 보정 Sol SHIP | PASS, 자체 생성 loopback PostgreSQL만 사용 |
| 초안 GET 무생성, 명시적 시작/재개, PATCH/취소, 원본 업무지문, 허용 입력 | 통합 backend6 suites72 tests, 생산 빌드/생성물 runtime import | PASS; Phase2 Sol SHIP |
| proxy 입력/오류, 관리자 편집/충돌 처리 | 통합 frontend3 suites33 tests; malformed/null/array 요청 upstream 미호출 | PASS |
| 초안 저장·새로고침 복원·취소, 완료된 부분기록 편집,409/403 입력 보존/명시적 최신값 복원 | `/tmp/bjj-admin-draft.config.cjs`, `/tmp/bjj-admin-draft-tests/admin-draft.spec.ts`, `/tmp/bjj-admin-draft-results` 총9개 | PASS, API 모의 응답 |
| 기존 제공인력 제출/최종 제출/실패 보존 | `/tmp/bjj-service-record-draft-public.config.cjs`, mobile/tests/service-record-final-flow.spec.ts, `/tmp/bjj-service-record-draft-public-results` 총12개 | PASS, API 모의 응답. 첫 다른 worktree runner 호출은 미실행 오류 후 수정 |
| frontend 회귀/타입/빌드/UI architecture gate | worker 전체209 suites1294 tests 및 각 검사 | PASS |
| mobile 생산 빌드 | 명령 범위 `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3999 pnpm build` | PASS, 최초 값 누락 실패 별도. 실제API 없는 정적 렌더 로그는 외부 검증 아님 |
| backend 전체 TypeScript | 기존 receipt helper/spec의5개 오류를 별도 baseline에서 재현 | FAIL, Task5.4에서 수정 필요 |
| 초기 N13/duration15/가격15일 유지, 영업일 뒤 회차 이동, 원본 날짜 보존 | 승인된 Phase3 수락 조건 | NOT RUN |
| 확정 트랜잭션/미리보기 결속/중복 확정/동시 발송 차단 | 승인된 Phase4 수락 조건 | NOT RUN |
| 계약·영수증 동일기간/수령일·금액 보존/완료계약 신규서명 문서/실제PDF 검증 후 pointer CAS | 승인된 Phase5 수락 조건 | NOT RUN, 외부 capability 미검증 상태 유지 |
| 실제 JWT/session/tenant 권한 HTTP+격리PG, 구 writer들과 경합 | 승인된 Phase6 수락 조건 | NOT RUN |

실제 전자문서 발급/수정, 문자 발송, 문의, 운영 DB 변경은 이번 로컬 구현 검사에서 수행하지 않았다. 과거 Phase0 진단 원장과 불확실한 요청 결과를 재시도하지 않았다. 공식 Chrome 검증과 API 모의응답 브라우저 검증을 동일한 증거로 취급하지 않는다.

---

# 초기 화면 초안 검증 기록 (구현 착수 전)

아래 기록 당시 변경은 화면 초안·구현 계획·Proposed ADR뿐이었다. 제품 API, 인증, DB schema, 문서 생성기는 변경하지 않았다.

## 화면 초안

- 현재 모바일 제공기록지 원본의 `DAILY_ITEMS` 14개 및 Styles CSS를 읽어 초안을 생성한다.
- 기존 480px 단일 열 레이아웃, 상단 진행 표시, 회차 목록, 산모/신생아/서비스 기록/확인 화면을 유지한다.
- Playwright headless Chromium에서 10회차 표시, 전체 14개 확인 항목, 각 섹션 5/6/3개 입력 항목, 이상변 선택 후 색깔 입력을 확인했다.
- 3회차 날짜를 변경한 뒤 8개 회차의 수정 상태 및 확정 미리보기에 8개 회차가 모두 표시되는 것을 확인했다.
- 임시저장 단계에서 확정 서비스 기간이 유지되고, 수정 확정 후에만 기간과 예시 문서 버전이 갱신되는 것을 확인했다.
- 390px 화면에서 가로 넘침 없음, 브라우저 JavaScript 오류 없음.
- 전체 확인 화면과 신생아 입력 화면 이미지를 직접 확인했다.

## 제한

- 실제 인증, 서버 임시저장, 데이터베이스 경합, 문서 재생성은 아직 구현하거나 검증하지 않았다.
- 초안은 예시 데이터만 사용한다. 서명은 원본 서명 표시 영역으로만 나타내며 실제 서명이 아니다.
- 초안의 날짜 계산은 평일 전용 예시다. 주말·공휴일 정책은 사용자 답변으로 확정하고 실제 구현에서 검증한다.
- 저장소 전체 test/lint/type-check/build는 제품 코드를 변경하지 않은 이번 문서·초안 작업에서 실행하지 않았다. 실제 구현 완료 게이트는 계획 Phase 6에 명시했다.
- 변경한 파일의 입력 값 출력은 HTML escape를 사용하며, 실제 개인정보나 인증 토큰을 포함하지 않는다.
