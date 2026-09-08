# 구현 검증 현황

2026-09-09 로컬 통합 기준. Phase4는 `1913ef766`, Phase5는 `535a7f2db`에서 Sol/high 독립 감사 SHIP으로 종료했다. Phase6 실제 HTTP 권한·로컬 mock 화면 통합 검증은 완료했고 독립 감사의 근거 보완을 진행 중이다. 아래 과거 단계별 결과는 당시 증거이며 최신 판정은 각 phase 감사 문서를 따른다.

과거 단계 기록: 2026-09-08 로컬 통합 기준. Phase1·2 구현/통합 검사와 Sol 최종 감사를 완료했다. Task3.0 저장 경계 변경을 통합했고 Task3.0 좁은 Sol 최종 감사도 통과했다. Phase3 통합 집중 검사207개와 보완 backend54/frontend36 및 최종 parser15개가 통과했고 Sol 잔여 감사는61a672cab에서 SHIP으로 종료됐다. Phase3~6 전체 구현 또는 외부 연동 완료를 뜻하지 않는다. 과거 화면 초안 기록은 아래에 별도 보존한다.

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
| backend 전체 TypeScript | Task5.4에서 기존 receipt helper 오류 해소; `/tmp/bjj-phase6-backend-types.log` | PASS, 2026-09-09 `pnpm exec tsc --noEmit` |
| 공통 쓰기 잠금/owning transaction, 삭제·교체·mirror generation 재검증 | 통합1fcbb6f75: backend12 suites483 tests, guarded PG3 suites19 tests; worker build/lint PASS | PASS, Sol/high FINAL SHIP (1fcbb6f75), 차단 지적 없음 |
| 초기 N/duration 분리, 영업일 뒤 회차 이동, 관리자 날짜/미리보기 | 통합 c8c7dd60e: backend86/shared44/PG19/frontend55/mobile3, 총207 PASS | SHIP: 최초6건 단계적 해소, 최종61a672cab. 보완 backend54/frontend36/parser15 PASS. PG19는 기존 쓰기 경합 회귀이며 새 preview 경합 증거는 아님 |
| 확정 트랜잭션/미리보기 결속/중복 확정/동시 발송 차단 | `phase4-final-audit.md`, `1913ef766` | local SHIP; 외부 활성화와 구분 |
| 계약·영수증 동일기간/수령일·금액 보존/완료계약 새 문서·pointer CAS | `phase5-verification.md`, `phase5-final-audit.md`, `535a7f2db` | local SHIP; PDF는 합성 로컬 자료이며 실제 외부 capability 미검증·차단 유지 |
| 실제 JWT/session/tenant 권한 HTTP+격리PG, 구 writer들과 경합 | HTTP18PASS ×2 `/tmp/bjj-phase6-http-expiry-final1.log`, `/tmp/bjj-phase6-http-expiry-final2.log`; writer 경합은 아래 매핑 | 실행 완료; 같은 Sol 감사 세션의 최종 판정 대기 |

승인된 검사는 격리 로컬 DB와 모의 외부 제공자를 사용한다. 별도 테스트 worker의 잘못 지정된 Jest 명령이 한 차례 넓은 범위를 실행해 중단됐다. 확인된 출력은 모의 테스트 및 실행 전 오류이며 실제 DB 작업은 확인되지 않았지만, 해당 프로세스 전체의 외부 접속 부재는 증명하지 못했다. 이 실행은 통과 근거에서 제외하고 후속 검사는 정확한 파일과 두 loopback DB URL을 명시한다. 과거 Phase0 진단 원장과 불확실한 요청 결과를 재시도하지 않았다. 공식 Chrome 검증과 API 모의응답 브라우저 검증을 동일한 증거로 취급하지 않는다.

## Task3.0 Sol FINAL 보완 기준

감사 소스는 통합3bfc3d862/worker d7aad5c6a다. 최초 결과는 **FIX_REQUIRED / HIGH**였으며 보완 후 통합1fcbb6f75의 Sol/high FINAL은 **SHIP**, 차단 지적 없음으로 종료됐다. 아래 실제 PostgreSQL 경합 검사가 통과하고 재감사에서 해소되기 전에는3.1 구현으로 넘어가지 않는다. 기존472개 단위검사와PG7개만으로 아래 항목을 통과했다고 판단하지 않는다. 보완 통합1fcbb6f75에서 메인이 정확한 파일을 지정해 단위483개와PG19개를 재실행했고 모두 통과했다. 결과 로그는 `/tmp/bjj-task3-integrated-unit.log`, `/tmp/bjj-task3-integrated-pg.log`다. 기존 무잠금 root recompute로의 임시 치환은 실제PG에서 READY_TO_FINALIZE 대신 IN_PROGRESS가 되는 의미 있는 red를 재현했고 복구했다. 다른 새PG 사례의 옛 소스 red를 실행했다고 주장하지 않는다.

| 지적 | 필수 회귀 | 현재 상태 |
|---|---|---|
| root recompute가 잠금 전 기록으로 상태를 덮음 | 마지막 제출과 경쟁해 최신 READY_TO_FINALIZE 유지 | 통합 실제 PG 통과, Sol SHIP |
| saveHeader의 잠금 후 제출/완료 조건 미검사 | 대기 중 제출/최종화가 완료되면 header 무변경 | 통합 실제 PG 통과, Sol SHIP |
| client.update의 이전 기간/주소 및 제출 검증 | 대기 중 새 잠금 기록이 생기면 부적합 기간 거부; 최신 고객 값 사용 | 통합 실제 PG 통과, Sol SHIP |
| NULL branch mirror가 대상 지점 조건으로 차단 | 기존 고객 연결/자동 등록 모두 실제 SQL로 정상 연결; generation/소유권 변경은 거부 | 통합 실제 PG 통과, Sol SHIP |
| schedule request의 승인/거절/stale 무조건 전환 | 중복 승인과 승인/거절 경쟁에서 한 번만 결정; 승인된 요청을 stale로 덮지 않음 | 통합 실제 PG 통과, Sol SHIP |
| requestReplacement가 이전 종료일/주소 사용 | 고객 변경 대기 후 새 고객 기간/주소로 배정 생성 | 통합 실제 PG 통과, Sol SHIP |
| 과거 직원 잠금을 case 뒤에서 추가 | 두 고객과 과거/현재/신규 직원의 barrier 경합에서 전체 정렬 집합으로 완료 | 통합 실제 PG 통과, Sol SHIP |

## Phase3 독립 기대값 (제품 검사 전)

아래 값은 공식 달력 근거와 별도 날짜 계산으로 정한 수용 예시이며, 아직 제품 구현의 PASS 증거가 아니다. 공휴일 근거는 execution-log의 공식 URL을 따른다.

15일 바우처의 실제13회 제공: 최초 벡터는 `2026-09-07,08,09,10,11,14,15,16,17,18,21,22,23`이다. 3회차9/9를9/11로2영업일 이동하면 `2026-09-07,08,11,14,15,16,17,18,21,22,23,28,29`가 되어야 한다. N13·duration15·기존15일가격·수령일·회차/배정ID는 유지하며 종료일만9/29로 바뀐다. 원본9/9와수정9/11의서명표시는정책대로분리하고실제서명시각은유지한다. 역방향2영업일이동은원래벡터로돌아와야한다. 앞2회차를다시재정렬하지않는다.

| 기준일 | +1영업일 기대값 | 검사 이유 |
|---|---|---|
| 2024-09-30 | 2024-10-02 | 10/1 임시공휴일 누락 보정 |
| 2025-01-24 | 2025-01-31 | 1/27 임시공휴일과 설 연휴 |
| 2025-06-02 | 2025-06-04 | 대통령선거일 |
| 2026-09-23 | 2026-09-28 | 추석 뒤 월요일은 영업일 |
| 2026-12-31 | 2027-01-04 | 연도 경계와 신정 |
| 2027-04-30 | 2027-05-04 | 노동절 대체공휴일 |
| 2027-06-04 | 2027-06-07 | 현충일 다음 월요일 오등록 제거 |
| 2027-07-16 | 2027-07-20 | 제헌절 대체공휴일 |
| 2027-10-08 | 2027-10-12 | 한글날 대체공휴일 |
| 2027-12-24 | 2027-12-28 | 성탄절 대체공휴일 |

불규칙 간격 예시: `[9/7,9/9,9/14]`에서2회차이후+1영업일은`[9/7,9/10,9/15]`다. 연속 영업일로 다시 채우지 않는다. 지원하지 않는2028년으로의이동,0영업일초기기간,모호한귀속,직전회차와역전/중복은차단대상이다. 달력 보정만으로 기존 저장된 N/벡터/day/원본을 바꾸면 실패다.

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


## Phase6 진행 중 — 통합 정적 검사

2026-09-09, 제품 checkpoint `82c76f113`. 아래 검사는 부모가 integration에서 실행했다. 넓은 Jest 탐색과 live 테스트 flag는 사용하지 않았다.

| 검사 | 정확한 명령 (해당 디렉터리) | 결과 artifact | 판정 |
|---|---|---|---|
| Backend 타입 | backend: `pnpm exec tsc --noEmit` | `/tmp/bjj-phase6-backend-types.log` | PASS |
| Frontend 타입 | frontend: `pnpm exec tsc --noEmit` | `/tmp/bjj-phase6-frontend-types.log` | PASS |
| Mobile 타입 | mobile: `pnpm exec tsc --noEmit` | `/tmp/bjj-phase6-mobile-types.log` | PASS |
| Shared 타입 | packages/shared: `pnpm exec tsc --noEmit` | `/tmp/bjj-phase6-shared-types.log` | PASS |
| Workspace lint | root: `pnpm lint` | `/tmp/bjj-phase6-workspace-lint.log` | PASS (기존 warnings 포함) |
| UI 구조 baseline gate | root: `pnpm lint:ui-architecture` | `/tmp/bjj-phase6-ui-architecture.log` | PASS; 기존 baseline의 위반 수가 0이라는 뜻은 아님 |

HTTP fixture와 mock 브라우저 증거는 아래에 기록되어 있다. 실제 제공자·SMS·운영 DB·공식 Chrome 수락 검증은 실행하지 않았다.

### Phase6 backend regression checkpoint

`/tmp/bjj-phase6-backend-unit-paths.json` freezes 48 exact changed non-e2e/non-live/non-HTTP test paths selected from `e72140413..82c76f113`. Parent ran `pnpm exec jest --runInBand --runTestsByPath <those paths>` from backend under `sandbox-exec` network denial. Initial result: 47 suites PASS, one PDF extractor test FAIL (`1311 PASS / 1 FAIL`, `/tmp/bjj-phase6-backend-unit-matrix.log`). This was a missing Jest ESM runtime option, not accepted as product PASS. The exact failing `test/services/receipt-pdf-verifier.service.spec.ts` then passed all12 with `NODE_OPTIONS=--experimental-vm-modules` under the same network denial (`/tmp/bjj-phase6-pdf-verifier-vm.log`). The installed PDF extractor path uses local synthetic AcroForm bytes; it is not vendor proof. Counts overlap and are not additive.

Root build first failed on external dependency symlinks in the fresh unit; after local APFS dependency clones, it failed because the network-deny sandbox also prevented Turbopack's local IPC port. Both are retained as harness failures (`/tmp/bjj-phase6-hermetic-build.log`, `/tmp/bjj-phase6-hermetic-build-local-deps.log`). The follow-up permits loopback only and continues to deny external networking.

초기 HTTP 준비에서 위조 query 필드가 무시되던 결과는 `c73b481ea`의 query pipe 보정과 아래 17/17 green 실행으로 대체됐다. 당시 RED 로그는 역사적 실패로만 보존하며 현재 판정으로 재사용하지 않는다.

Root `pnpm build` at `82c76f113` PASS with locally cloned dependencies and loopback-only sandbox (`/tmp/bjj-phase6-hermetic-build-loopback.log`). Backend/Nest, frontend/Next, and mobile/Next production builds completed. Static rendering logs include expected unavailable synthetic API `127.0.0.1:3999` and dynamic-cookie routes; this is compilation/packaging evidence only, not API/runtime success. No external networking was permitted.

### Phase6 frontend/mobile/shared regression checkpoint

Exact changed test manifests are `/tmp/bjj-phase6-frontend-unit-paths.json`, `/tmp/bjj-phase6-mobile-unit-paths.json`, `/tmp/bjj-phase6-packages-shared-unit-paths.json`. Parent invoked `pnpm exec jest --runInBand --runTestsByPath <manifest paths>` in each package with external/network denial. Frontend18suites192PASS, mobile2suites25PASS, shared3suites93PASS. Logs: `/tmp/bjj-phase6-frontend-unit-matrix.log`, `/tmp/bjj-phase6-mobile-unit-matrix.log`, `/tmp/bjj-phase6-packages-shared-unit-matrix.log`. These are selected changed-file regressions, not a claim that unrestricted root `pnpm test` ran. Root test discovery remains prohibited because the repository includes live e2e suites.

### Phase6 acceptance map — exact existing evidence

The map below transcribes prior Phase4/5 SHIP evidence and the frozen Phase6 manifests. No test was run for this correction. `phase6-test-commands.json#backend` and `#packages-shared` are the exact recorded command arrays (including cwd, `pnpm exec jest --runInBand --runTestsByPath`, and every path). Historical PostgreSQL command lines and their original working directories were recovered by the parent from the original exec launch records of this same task, using exact log-name matching. They are frozen in `phase6-historical-pg-commands.json`, alongside the existing path sets/results in the logs. They were not reconstructed from guesses or rerun. Historical task3 database targets are evidence only and must not be replayed under the current task4-only lease.

| Invariant | Exact existing test path + exact test name | Recorded command / command record | Recorded result / artifact |
|---|---|---|---|
| Business-day calendar, holiday and reverse movement | `packages/shared/src/utils/business-days.test.ts` — `uses the corrected public holiday calendar for %s`; `removes the stale holiday entry for %s`; `starts counting from the next business day when the start date is a holiday`; `skips Korean holidays from the shared source-of-truth list`; `returns the next business day, skipping a holiday-then-weekend run`; `shifts +1 and reverses across the approved boundary %s -> %s` | `phase6-test-commands.json#packages-shared` | 3 suites / 93 PASS: `/tmp/bjj-phase6-packages-shared-unit-matrix.log` |
| Irregular-N schedule, exact N and invalid vector rejection | `packages/shared/src/utils/service-record-schedule.test.ts` — `moves the selected and later sessions by one signed business-day delta`; `preserves irregular gaps while shifting each suffix date independently`; `rejects unsupported, weekend, duplicate, and inverted vectors`; `orders a shuffled valid vector by session index before checking chronology` | `phase6-test-commands.json#packages-shared` | 3 suites / 93 PASS: `/tmp/bjj-phase6-packages-shared-unit-matrix.log` |
| N13/duration15/nominal prices/signatures and concurrent confirm replay | `backend/test/e2e/service-record-confirm-atomic.e2e.spec.ts` — `commits dates/content once for concurrent retries and preserves signatures, N and prices` | `phase6-historical-pg-commands.json#bjj-phase4-final-postgres.log` | 7 suites / 29 PASS: `/tmp/bjj-phase4-final-postgres.log` |
| Same idempotency key with a different request payload | `backend/test/e2e/service-record-confirm-atomic.e2e.spec.ts` — `commits dates/content once for concurrent retries and preserves signatures, N and prices`; inside that named test, the final call retains `request.idempotencyKey` but changes `expectedDraftVersion` and asserts `ConflictException` (lines117–119 at the reviewed source). The preceding identical request is replayed successfully. | `phase6-historical-pg-commands.json#bjj-phase4-final-postgres.log` | 7 suites /29 PASS: `/tmp/bjj-phase4-final-postgres.log`; this maps the existing explicit request-mismatch assertion, not a fabricated separate test name. |
| Immutable prior revision, future content without fabricated submission, durable no-op, stale preview/foreign branch | `backend/test/e2e/service-record-confirm-atomic.e2e.spec.ts` — `allows a second revision while keeping first dates and earlier confirmation replay immutable`; `persists explicitly edited future content without inventing a submission or signature`; `persists a replayable no-change result without a revision or document job`; `rejects a foreign branch and a stale preview while preserving the active draft` | `phase6-historical-pg-commands.json#bjj-phase4-future-content-pg.log` | 2 suites / 14 PASS: `/tmp/bjj-phase4-future-content-pg.log` |
| Atomic rollback after each owning write boundary | `backend/test/e2e/service-record-confirm-rollback.e2e.spec.ts` — `rolls back every owning write when the %s boundary fails` | `phase6-historical-pg-commands.json#bjj-phase4-future-content-pg.log` | 2 suites / 14 PASS (including rollback boundaries): `/tmp/bjj-phase4-future-content-pg.log` |
| Scheduled message and queued document dispatch races | `backend/test/e2e/service-record-confirm-message-races.e2e.spec.ts` — `%s wins the common client lock`; `backend/test/e2e/service-record-confirm-document-races.e2e.spec.ts` — `%s wins against %s` | `phase6-historical-pg-commands.json#bjj-phase4-dispatch-race-green.log` | 2 suites / 6 PASS: `/tmp/bjj-phase4-dispatch-race-green.log` |
| Provider/admin date race in both lock orders | `backend/test/e2e/service-record-confirm-provider-races.e2e.spec.ts` — `lets admin confirmation win, rejects stale provider input, then accepts refreshed input`; `lets a provider write win, then rejects the stale admin confirmation without period damage` | `phase6-historical-pg-commands.json#bjj-phase4-provider-audit-green.log` | 2 suites / 8 PASS: `/tmp/bjj-phase4-provider-audit-green.log` |
| Entry/common lock order and post-lock case re-read | `backend/test/e2e/service-record-write-lock-order.e2e.spec.ts` — `reproduces the pre-fix opposite case/client order as a bounded lock conflict`; `serializes two owning writers through the common lock order`; `stops before dependent locks when the branch-scoped client lock is absent` | `phase6-historical-pg-commands.json#bjj-task3-integrated-pg.log` | 3 suites / 19 PASS: `/tmp/bjj-task3-integrated-pg.log`; Sol/high Task3.0 FINAL SHIP is recorded in `phase4-verification.md` |
| Schedule target and schedule-request races | `backend/test/e2e/service-record-write-lock-order.e2e.spec.ts` — `rejects a schedule target that changes after discovery and client-lock wait`; `backend/test/e2e/service-record-mirror-request-races.e2e.spec.ts` — `approves a duplicate request once and never downgrades the terminal row to stale`; `lets approve or reject win once while preserving the matching schedule outcome` | `phase6-historical-pg-commands.json#bjj-task3-integrated-pg.log` | 3 suites / 19 PASS: `/tmp/bjj-task3-integrated-pg.log` |
| Allocation/assignment races and branchless mirror ownership | `backend/test/e2e/service-record-write-lock-races-lifecycle-client.e2e.spec.ts` — `uses the freshly locked client address and end date for a replacement`; `locks historical employees before the case across concurrent client assignment changes`; `backend/test/e2e/service-record-mirror-request-races.e2e.spec.ts` — `links a branchless mirror to the exact existing client through the complete transaction`; `does not claim a branchless mirror for a same-phone client in another authorized branch`; `auto-registers a branchless mirror and persists the mapped destination branch`; `rejects a branch-ownership change observed after the branchless snapshot`; `rejects a changed mirror generation without leaving an auto-registered client` | `phase6-historical-pg-commands.json#bjj-task3-integrated-pg.log` | 3 suites / 19 PASS: `/tmp/bjj-task3-integrated-pg.log` |
| Lifecycle/client stale-write races | `backend/test/e2e/service-record-write-lock-races-lifecycle-client.e2e.spec.ts` — `recomputes from a fresh case after a submitted session wins the case lock`; `rejects a header write when finalization changes the case while the writer waits`; `rejects a date-only client update after a submitted day is visible under the owning lock`; `backend/test/e2e/service-record-write-lock-order.e2e.spec.ts` — `serializes mirrored end-date sync behind a common writer and rechecks document generation ownership` | `phase6-historical-pg-commands.json#bjj-task3-integrated-pg.log` | 3 suites / 19 PASS: `/tmp/bjj-task3-integrated-pg.log` |
| Revision allocation and document-pointer promotion | `backend/test/e2e/service-record-revision-version-promotion.e2e.spec.ts` — `enforces revision owner links while retaining nullable legacy documents`; `allocates after legacy version two once under concurrent requests`; `promotes only after all exact chunks complete and retains the contract pointer`; `replaces a prior usable revision only after the next version is fully verified`; `refuses an older completed generation after a newer revision becomes current` | `phase6-historical-pg-commands.json#bjj-phase5-second-promotion-green.log` | 2 suites / 10 PASS (version + operation matrix): `/tmp/bjj-phase5-second-promotion-green.log`; supplementary 4/4 owner-link result: `/tmp/bjj-phase5-version-owner-postgres.log` |
| Finalization freeze, deadline and unresolved-generation gate | `backend/test/e2e/service-record-confirm-finalization.e2e.spec.ts` — `freezes a new complete generation input after a partial revision becomes eligible`; `uses the updated future deadline when recomputing an incomplete stale READY case`; `blocks a historical redacted revision recovery before target or custody reads`; `preserves a frozen complete payload while unresolved generation blocks another confirmation`; `backend/test/services/service-record-finalization.revision.spec.ts` — `freezes a complete current source once with signatures and provenance`; `reuses an existing request payload without rebuilding it` | PG path-set only for the e2e suite; `phase6-test-commands.json#backend` for the service suite | 1 suite / 11 PASS for the PG suite: `/tmp/bjj-phase5-finalizer-version-green.log`; selected backend matrix PASS for the service suite: `/tmp/bjj-phase6-backend-unit-matrix.log` |
| Webhook stale completion and status-CAS unit races | `backend/test/services/eformsign-webhook.service.spec.ts` — `stops delayed completion effects after the locked current-contract fence loses`; `does not fire stale side effects when the newer mirror has the same status`; `does not replay side effects when the same-generation status CAS is a no-op`; `does not link, notify, or emit a stale completion webhook`; `rechecks mirror readiness immediately before publishing completion`; `does not publish completion after the refreshed mirror moved to a non-completed status` | `phase6-test-commands.json#backend` | The selected backend matrix passed 47 suites / 1311 tests; the only separate failure was the PDF extractor, corrected by the exact 12-test command below. Artifact: `/tmp/bjj-phase6-backend-unit-matrix.log` |
| Direct contract-webhook pointer/end-date fence | `backend/test/e2e/service-record-contract-event-fence.e2e.spec.ts` — `rejects an older revision contract without replacing the current pointer or end date`; `rejects the original legacy pointer while a current revision is pending`; `allows a current legacy contract to link and synchronize its period`; `allows a revision contract only when the persisted current revision and pointer agree`; `rejects a legacy completion when a revision becomes current during its locked read` | `phase6-historical-pg-commands.json#bjj-phase5-audit-event-postgres.log` | 1 suite / 5 PASS: `/tmp/bjj-phase5-audit-event-postgres.log` |
| Mirrored webhook/poller pointer and lifecycle fence | `backend/test/e2e/service-record-mirrored-contract-event-fence.e2e.spec.ts` — `keeps a newer revision and contract pointer authoritative over an old ready mirror`; `allows the current legacy mirror to reconcile its period`; `rejects the original legacy mirror while a revision is pending`; `does not let an old revision replace a newer pointer even with a newer created date`; `rejects a stale mirrored completion when the pointer changes after the linker read` | `phase6-historical-pg-commands.json#bjj-phase5-mirror-event-postgres-green.log` | 2 suites / 10 PASS: `/tmp/bjj-phase5-mirror-event-postgres-green.log`; stale-lifecycle closure also recorded 10/10 in `/tmp/bjj-phase5-stale-lifecycle-green.log` |
| Partial-chunk failure and immutable frozen payload | `backend/test/usecases/eformsign-doc/service-record-case-snapshot.revision.spec.ts` — `reuses the same version, chunk row, and document identity on retry`; `preserves a completed first chunk when a later chunk fails`; `queries an unknown outcome before any second provider mutation`; `reconciles a CREATED row that lost its remote id before any new create`; `reconciles an in-flight CLAIMED row before retrying its provider request` | `phase6-test-commands.json#backend` | Selected backend matrix PASS; artifact `/tmp/bjj-phase6-backend-unit-matrix.log` (separate PDF failure corrected by `/tmp/bjj-phase6-pdf-verifier-vm.log`) |
| Document-pointer CAS and same-version mirror CAS | `backend/test/usecases/eformsign-doc/service-record-case-snapshot.revision.spec.ts` — `does not report completion when core rejects pointer promotion as stale`; `backend/test/repositories/sb.eformsign-document-mirror.repository.spec.ts` — `acquires a same-version retry only from its observed non-ready attempt`; `acquires a fresh fenced attempt for an explicit same-version ready repair`; `fences integrity failure reports to the exact ready file that was read`; `fences a file write when a purge or newer detail owns the document`; `returns false instead of downgrading ready state when a competing sync owns the generation`; `returns true when the current generation becomes ready`; `backend/test/repositories/service-record-edit.repository.spec.ts` — `compare-and-swaps changes while leaving source provenance untouched`; `maps a lost compare-and-swap race to a domain 409`; `returns its own CAS row while a later writer is queued behind the transaction` | `phase6-test-commands.json#backend` | Selected backend matrix PASS; artifact `/tmp/bjj-phase6-backend-unit-matrix.log` |
| Receipt date/amount and token/access preservation | `backend/test/e2e/service-record-receipt-promotion.e2e.spec.ts` — `promotes only the artifact while preserving token identity, contract FK, and receipt values`; `preserves revision-era token state on public lookup while retaining legacy restoration`; `fails closed for stale proof, state version, and revision without replacing the old artifact`; `allows exactly one concurrent promotion for a generation and retains that winner`; `preserves expired and revoked tokens without issuing a token or SMS` | `phase6-historical-pg-commands.json#bjj-phase5-receipt-promotion-postgres-green.log` | 5 PASS (`/tmp/bjj-phase5-receipt-promotion-postgres-green.log`) plus 6 PASS (`/tmp/bjj-phase5-receipt-access-postgres.log`); synthetic/local PDF only, not vendor proof |

The exact-path PG logs above are the result artifacts for the historical SHIP evidence; `phase6-historical-pg-commands.json` provides the recovered recorded shell invocations and cwd, except `bjj-phase5-stale-lifecycle-green.log`: its accepted exact command is unavailable (JSON command is null). The rejected typo invocation has been removed; no exact-command provenance is claimed for that artifact. These are retained execution records, not new runs. The Phase6 PDF correction is separately frozen as `phase6-test-commands.json#pdf-extractor-correction` with `NODE_OPTIONS=--experimental-vm-modules`; recorded result is 12 PASS in `/tmp/bjj-phase6-pdf-verifier-vm.log`.

### Same-session audit corrections — evidence ready, verdict pending

- Different-payload rejection is mapped above to the actual mismatch assertion inside the existing named atomic test. A standalone test with that title was not invented.
- Twelve historical PG commands/cwds were recovered from original exec launch inputs and preserved in `phase6-historical-pg-commands.json`; no historical DB command was replayed.
- Both JWT expiration and persisted-session expiration are now separately exercised. Final18-case suite passed twice sequentially with a firmly expired JWT fixture (`fbb91879a`): `/tmp/bjj-phase6-http-expiry-final1.log`, `/tmp/bjj-phase6-http-expiry-final2.log`. The original one-off403 response, diagnostic18PASS, and unproven cause remain recorded in `phase6-final-audit.md`; production authentication was not changed and the401 assertion was retained.
- Root `pnpm build` and `pnpm lint` were rerun at final code/test checkpoint `fbb91879a` in a fresh no-env unit with local dependency clones. Accepted artifacts: `/tmp/bjj-phase6-release-check-build.log`, `/tmp/bjj-phase6-release-check-lint.log`. Build allowed only loopback with fixed synthetic API/DB values and blank Sentry credentials; lint denied networking. Backend dist and frontend/mobile BUILD_ID outputs were nonempty. Subsequent changes are documentation only.

Phase6 actual HTTP initial run (`/tmp/bjj-phase6-http-red.log`): 14PASS/3FAIL. Two failures were the real missing query rejection (forgedbranch got200/201); one was a fixture assertion passing undefined into a helper with environment defaults. Commit `24e85c048` changes the guard fixture to explicit empty strings; `9a6703b16` pins the runner's synthetic JWT signing secret. Neither changes the production authentication implementation. The later `c73b481ea` correction and 17/17 green run below supersede this RED for current query-boundary status. Random synthetic auth/client rows remain only in the owned disposable DB; no global auth tables are cleared.

### Phase6 actual HTTP and browser proof

- Actual guarded HTTP runner: `DATABASE_URL=postgresql://bjj_revision_test@127.0.0.1:62295/bjj_revision_task4 DIRECT_URL=postgresql://bjj_revision_test@127.0.0.1:62295/bjj_revision_task4 pnpm --dir backend run e2e:admin-service-record-edit-http` from integration. After `c73b481ea` query pipe correction,17/17PASS (`/tmp/bjj-phase6-http-green.log`). Actual Nest guards/strategy, strict GlobalValidationPipe, synthetic signing secret/session/user/branch/client rows, disposable PG. The edit application service is mocked in this authentication boundary test; persistence proof comes from the separate actual PG suites.
- Parent admin browser: no-env unit at `5d2a06983`, exact `pnpm exec playwright test --config=playwright.service-record-local.config.ts tests/admin-service-record-editor.spec.ts`,6/6PASS (`/tmp/bjj-phase6-browser-parent.log`) under macOS `sandbox-exec` allowing loopback only and denying external network. Test mocks all relevant API/auth routes and aborts unknown/live requests. Parent screenshot copies retained at `/tmp/bjj-phase6-admin-browser-results/`.
- Parent ordinary provider regression: current `mobile/tests/service-record-final-flow.spec.ts`, exact dedicated `/tmp/bjj-phase6-provider.config.cjs`,390/480/1280 widths,12/12PASS (`/tmp/bjj-phase6-provider-browser.log`), screenshots `/tmp/bjj-phase6-provider-results/`. Same external-network denial, mocked API, no production login/vendor. Dedicated config disables default globalSetup and uses no-env unit; this is current provider workflow browser evidence, not live phone-auth proof.
- Parent visual inspection confirmed all13 date cards, existing480px layout,14fields and original/revised values. It caught visually adjacent date labels (`newdate원본olddate`); the scoped correction and its 2/2 browser evidence are recorded in the final implementation checkpoint below.

The worker independently ran admin6PASS before the parent's fenced run. The parent result above is the network-fenced evidence; a route-mock worker run alone is not treated as proof of no server-side external traffic.

### Phase6 final implementation checkpoint

`73b38c228` fixes date label spacing in the existing admin renderer and scoped shared stylesheet only. Parent exact visual cases (`--grep 'admin direct Step 3|narrow mobile viewport'` on the dedicated config)2/2PASS under loopback-only network fence: `/tmp/bjj-phase6-date-display-browser.log`. Parent viewed the390px chip and all13-date overview images and confirmed readable separation/wrapping; artifacts copied to `/tmp/bjj-phase6-date-display-results/`. The ordinary provider renderer does not use the new admin-only classes.

Final backend/frontend type checks PASS after HTTP/browser integration (`/tmp/bjj-phase6-final-backend-types.log`, `/tmp/bjj-phase6-final-frontend-types.log`); final UI architecture gate PASS after spacing (`/tmp/bjj-phase6-final-ui-architecture.log`). No unresolved local test failure remains from the executed matrix. Phase6 independent Sol/high audit is next; no external activation, push, environment merge or deployment has occurred.
