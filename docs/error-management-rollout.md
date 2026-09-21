# 오류 처리 전환 배포·복구·관측 절차 (BJJ-319 Phase 11)

기준: [BJJ-319 실행 계획](plans/bjj-319-remaining-plan.md) Phase 11 (Task 11.1)과 배포·롤백·관측 절차. 연결: [Error Management v1.0 적용 현황](error-management.md) 「호환성 경계」(L18-24), [실환경 검증 runbook](error-management-live-verification.md), [오류 처리 인벤토리](error-management-inventory.json)의 `deployment_rollout` 레코드, [devops 배포 규칙](devops-deployment-rules.md).

이 문서는 배포 후보와 배포 순서, 롤백 절차, 운영 관측 항목, 종료 판정 조건을 준비한 것이다. 이 문서의 작성·감사·병합은 dev 병합 승인이 아니며 대상 환경 배포 승인도 아니다. 빈칸(`____`)은 승인 시점에 실제 값으로 채우고, 실행 전까지 임의 값을 발명하지 않는다.

## 1. 승인 gate

- **dev 병합:** main이 정확한 후보를 제시하고 사용자의 명시적 승인을 받은 뒤에만 진행한다. 승격 PR은 merge commit으로 만든다(배포 규칙 §1: squash 승격 금지).
- **대상 환경 배포:** dev 병합과 별개의 별도 승인이다. 테스트 환경에서 정상 흐름과 실패 흐름을 검증한 뒤 운영 반영을 판단한다. 대상 환경(preview/production)은 승인 시점에 확정한다: ____
- 이 문서의 존재, 감사 통과, 병합은 위 두 승인의 증거가 아니다.

## 2. 배포 후보 고정

| 항목 | 값 |
| --- | --- |
| 통합 worktree | `/Users/jaino/Development/babyjamjam-admin/korean-error-messages` |
| 통합 branch | `korean-error-messages` |
| 후보 SHA | `06a8b68afbcea16314ade60bcd20b39f9976e59d` |
| 후보 내용 | 6.1 close(61a~61g) + 7.1 + 8.1 + 9.1 + 10.1 doc-prep의 통합 결과와 단계 close 기록 |
| dev 반영 기준 | 2026-09-14 `2d01ecd9d`(PR #657)까지. 후보는 그 이후 Phase 4b~10.1 누적을 포함한다 |

단계별 독립 감사 판정(계획 실행 기록의 최종 판정만 표기):

| 단계 | 최종 감사 판정 |
| --- | --- |
| Phase 0·dev 동기화 병합 | SHIP/HIGH(`5f96f4ba8`, 보정 `b313c25fe`) · SHIP/MEDIUM(`5ceb8b4fe`) · 동결 재감사 SHIP/HIGH(`9ec166edc`) |
| Task 1.1 (전수 조사·규격 매핑) | 배치 A~E와 규격 매핑은 SELF(main 대조) — 감사 라벨 없음, 2026-09-14 마감 |
| Phase 2a / 2b | SHIP/HIGH(`8cc87adf`, `f91fabdba`) |
| Phase 3a / 3.1b | SHIP/HIGH(`282065ab3`, `03646f8d5`) |
| Phase 4a / 4b / 4c | SHIP/HIGH 다수 · SHIP/MEDIUM(4c-2). 4a-3은 2회 FIX_REQUIRED 보정 후 SHIP/HIGH |
| Phase 5 (5-1~5-4d) | SHIP/HIGH · SHIP/MEDIUM(5-2) · SHIP(5-4b/c). 5-3b·5-4d는 FIX_REQUIRED → 보정 후 SHIP/HIGH |
| Phase 6 (6a~6c, wave1/2, 6.1a~g) | SHIP — 6a·6b·6c, wave1 3건(보정 후), 6g2b·6h2b·6d2b2·6h3b, 61ab·61db·61eb·61bb2·61fb·61gb |
| Phase 7 (7.1) | SHIP (7-1b) |
| Phase 8 (8.1) | 감사 라벨 기록 없음 — osv-scanner.toml 정리와 OSV 재검사 0건만 기록 |
| Phase 9 (9.1) | SHIP (9-1b) |
| Phase 10 (10.1) | SHIP (10-1b) — runbook 준비 한정이며 실행은 미승인 |

로컬 gate 결과(9.1 D7, exact-HEAD 전체 회귀; 9.1 통합 SHA부터 후보까지의 차이는 문서·기록 전용 커밋이다 — `f0f16d3b0`, `28132fded`+`0bfc862f3`, `06a8b68af` diffstat으로 확인):

| 검사 | 결과 |
| --- | --- |
| backend | 364 suites / 5,205 passed / 45 skipped / 0 failed |
| frontend | 308 suites / 1,821 tests |
| mobile | 268 suites / 1,834 tests |
| shared | 27 suites / 423 Jest + 91 Node(scripts) |
| raw-error intake gate | 위반 0 (2,036파일 스캔) |
| UI architecture gate | 0 (baseline 일치) |
| OSV | 0건 (suppression 없이 재검색) |

GitHub CI는 이 환경에서 실행하지 않은 최종 외부 검사다. dev 병합 승인 전에 후보 SHA의 required workflows 결과를 확인하고 그 실행 링크를 여기에 기록한다: ____

## 3. 배포 순서 (서버·호환 클라이언트)

error-management.md 「호환성 경계」(L18-24)가 기준이다: 기존 response `message`/`error`/`statusCode`는 구버전 소비자를 위한 별칭이고, 문자열 번역 이행 어댑터(`user-error-message.ts`)와 공유 경계 툴킷(`route-utils.ts`), 서버측 빌더(`problem-bodies.ts`)는 9.1에서 전수 사용처와 함께 기록된 승인 예외다. 이 어댑터와 별칭은 배포 내내 살아 있어야 하며, 그렇기 때문에 서버·클라이언트 배포 순서가 뒤바뀌어도 구버전 소비자가 깨지지 않는 것이 설계 증거다(9.1 필수 시나리오 10: 구버전 클라이언트·웹훅·정상 빈 조회 PASS).

1. **사전 고정:** 후보 SHA·CI 결과(§2), 대상 환경, 롤백 기준 값(§4 빈칸)을 승인 기록과 함께 고정한다.
2. **서버 전환(Lightsail):** 호환 어댑터와 별칭이 살아있는 후보 이미지로 백엔드를 먼저 전환한다. 이 상태에서 구버전 웹·모바일·webhook은 기존 별칭 경로로 계속 동작한다.
3. **클라이언트 배포:** 웹(Vercel)과 모바일을 후보 기준으로 배포한다. 가산 계약(`code`/`outcome`/`recovery`)을 우선 분류로 쓰는 새 소비자가 활성화된다.
4. **어댑터 제거 gate:** 이행 어댑터와 별칭의 제거는 소비자·webhook 호환 검증이 모두 끝난 뒤 별도 단위로 판단한다 — 「호환성 경계」의 제거 조건(전체 기능 서버 오류 코드 전환, 웹/모바일 개별 입력 연결·복구 검증, 구버전 소비자 호환 검증 완료)이 원문이다. 임의 날짜로 제거를 약속하지 않는다.

배포 topology와 관련된 기록:

- dev 호스팅은 없다(배포 규칙 §1-3). dev 병합 후 검증 환경은 preview다. preview/main push는 각각 Vercel 빌드와 Lightsail 배포를 자동 실행하므로, main push 자체가 production 배포 행위다 — 승인 기록이 push보다 먼저다.
- main push는 Vercel production과 Lightsail 배포를 같은 커밋에서 진행하므로(배포 규칙 §1), 서버→클라이언트 순서 제어가 필요하면 Vercel Ignored Build Step과 배포 잡 상태를 [외부] 사실로 확인한다: ____
- **DB 마이그레이션 가정: 없다.** 이 오류 처리 전환은 스키마 변경을 도입하지 않았다(7.1의 `retrySafety` fence는 기존 `message_log` `variables` JSON 필드를 사용). 다만 후보 이력에 dev 유입 branch-snapshot 마이그레이션 커밋(`99ab404d0`, `bc93f221f`)이 존재하므로, 승격 시 DB 패치 잡(`apply-preview`/`apply-production`) 필요 여부는 배포 규칙 §3 절차로 별도 확인한다 — 이는 이 절차가 새로 만드는 요구가 아니라 기존 규칙이다.

## 4. 롤백

이전 안전 값은 배포 시점에 기록하며 미리 발명하지 않는다:

| 항목 | 값 (배포 시점 기록) |
| --- | --- |
| 이전 백엔드 이미지 tag/digest | ____ |
| 이전 웹 production 배포 SHA | ____ |
| 이전 모바일 기준 (스토어 빌드/OTA) | ____ |
| Fallback Server(LightNode) 이미지 버전 | ____ |

**핵심 제약:** 롤백은 외부에 이미 접수된 작업이 되돌려졌다는 의미가 아니다. 부분 접수/UNKNOWN의 durable marker(`retrySafety`)를 해석하지 못하는 버전으로 되돌리지 않는다.

- 7.1 marker semantics: partial/uncertain 문자 발송의 fence는 source 행과 attempt 행 모두에 기록되고(`message_log.variables.retrySafety`, 값 예: `partial`, `uncertain`, `manual-provider-rejected`), 프로세스 재시작 후에도 모든 재발송 경로가 거부된다(`sms-provider-acceptance.retry.spec.ts` "persists the partial fence and a restarted process still forbids every resend path"). `retryById`는 fenced 전체 목록 재발송을 `REQUEST_CONFLICT`로 거부한다.
- fence 해석 이전 버전으로 되돌리면 source 행만 남은 상태에서 재시작/재클릭 시 전체 수신자 재발송(중복) 위험이 부활한다 — 7.1에서 수정한 결함이 그렇다.

복구 절차:

1. **위험 job 중단:** SMS 재시도 스케줄러·eformsign 문서 잡이 새 시도를 시작하지 못하게 한다(런타임 정지 또는 해당 job 비활성). `SCHEDULERS_ENABLED=true` 런타임은 언제나 하나만 존재한다(배포 규칙 §5).
2. **상태 확인(read-only):** `message_log`와 문서 작업 상태로 이미 접수된 작업과 fence를 확인한다. 자동 재발송을 실행하지 않으며, UNKNOWN은 재실행이 아니라 상태 확인이 우선이다.
3. **안전 버전 복구:** fence를 해석하는 최소 버전(7.1 이후)으로 되돌린다. Fallback Server로 트래픽을 전환하는 것도 버전 결정이므로 같은 제약을 적용한다 — fallback은 스케줄러가 비활성화돼 있어도 수동 재시도 API 경로는 열려 있다.
4. **복구 후 재개:** 중단한 job을 재개하고 §5 관측으로 후속 오류를 확인한다.

롤백 판단의 알려진 한계(7.1b 감사 carried): 기존 production 행의 fence는 다음 attempt 시점에 기록된다(소급 backfill 미실시)·late-fence/`reconciled-*` 비-CAS 경합은 log-visible에 머문다(발송 안전성에는 무영향).

## 5. 운영 관측

관측 경로는 기존 Sentry 실행 경계다(error-management.md 관측 프로필: `error.code`는 공개 카탈로그 허용 값만 기록, 요청 참조는 `requestReference` context). 보존기간과 알림 설정은 BJJ-317 소유다.

| 항목 | 정의 | 기준선/경보 임계값 | 담당자 |
| --- | --- | --- | --- |
| 공개 코드별 발생량 | Sentry `error.code` 그룹별 발생 수와 추이 | ____ | ____ |
| 미등록 fallback 비율 | 카탈로그에 없는 코드/타입으로 일반 문구 fallback이 발생한 비율 — 실행 시점 신규 원시 오류 유입의 운영 신호(intake gate가 빌드 시 차단하는 것과 별개) | ____ | ____ |
| UNKNOWN / PARTIALLY_APPLIED | 업무 결과 기준 발생 수와 추이 | ____ | ____ |
| retry exhausted | 재시도 소진(terminal) 도달 건수 — 문자 재시도·문서 job | ____ | ____ |
| 중복 capture | 같은 예외의 중복 Sentry capture 수 — 설계 증거상 0이어야 하며 운영에서 이탈을 관측 | ____ | ____ |
| 폼 실패율 | 웹·모바일 제출 실패율(사용자 관점) | ____ | ____ |

실제 기준선과 경보 임계값·담당자는 운영 검증(Phase 10 runbook 실행) 시 확정하며 임의 수치를 발명하지 않는다.

## 6. 종료 조건 체크리스트 (BJJ-319 종료 제안 조건)

아래 전부가 충족될 때만 BJJ-319 종료를 제안한다. 실환경 검증 gate가 미완인 상태에서는 "구현 범위 완료(로컬 검증 한정)"까지만 표현할 수 있고 "전체 규격 준수"는 표현하지 않는다.

| # | 조건 | 현재 상태 (2026-09-22, 후보 SHA 기준) |
| --- | --- | --- |
| 1 | 모든 inventory 행이 적용·검증 완료 또는 명시적 승인 예외 | 충족 — 803행: migrated 513 · no-direct 282 · approved-exception 7 · removed 1, legacy 0 (9.1 감사) |
| 2 | 미분류 0 유지 + 신규 원시 오류 유입 차단 | 충족 — 미분류 0, intake gate 위반 0 |
| 3 | 필수 검사 실행 | 충족(로컬) — 11개 필수 시나리오 PASS 증거와 exact-HEAD 전체 회귀 green(9.1). 후보까지의 delta는 문서 전용 |
| 4 | 감사 지적 해소 | blocking 0. carried nonblocking은 열려 있다 — 종료 제안 전 명시적 처리·수용 기록 필요: `BRANCH_CONTEXT_CHANGED` 카탈로그 등록, live-DB/e2e 레인, NotificationBell 전용 오류 UI, 7.1 fence 관측성·prod 행 backfill, 단계별 carried 목록(계획 기록) |
| 5 | 실환경 검증 증거 | 미충족 — Phase 10 runbook 미승인·미실행. runbook 증거 표가 실제 관찰로 채워져야 한다 |
| 6 | 배포 후 smoke·관측·복구 가능성 확인 | 미충족 — 대상 환경 배포가 아직 없다(Phase 11 close gate) |

미충족 항목이 있는 상태로 종료를 제안하지 않는다. 실환경 검증 실행과 대상 환경 배포는 각각의 승인 gate(§1, runbook §1)를 통과한 뒤에만 진행할 수 있다.
