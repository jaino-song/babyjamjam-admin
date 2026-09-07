TL;DR: 지점의 수정 확정 한 번으로 제공 일수를 유지하면서 일정·기록·계약서·영수증의 서비스 기간을 맞추고, 기존 서명과 본인부담금 수령일을 보존한다.

관련 설계 결정: `docs/adr/ADR-012-admin-service-record-revisions.md` (Proposed).

상태: 사용자 실행 승인 후 Phase 0 진행 중(2026-09-07). 격리 남동구 문서에서 공식 API 반려와 SDK 날짜 수정·참여자 전송을 실행했고, 독립 API/PDF와 기존 이미지 생성기에서 날짜 갱신 및 서명·수령일·금액 보존을 확인했다. 최초 SDK 라이브 명령은 검사 오류 및 즉시 PDF 확보 실패로 RED이며, 이후 독립 증거와 구분한다. 서구·공개 영수증 링크 갱신·완료 문서 분기·복구 시험이 남아 후속 구현 게이트는 열리지 않았다. 제품 정책은 확정되었으나 구현·배포 완료나 전체 자동화 검증 완료를 뜻하지 않는다.

작업 공간: `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor`, 브랜치 `admin-service-record-editor`, 최초 기준 `dev`의 `110dbbb84`, 실행 기준은 최신 `origin/dev`의 `e72140413`. 기존 전용 작업 공간을 재사용한다.

확정된 범위:

| 항목 | 적용 규칙 |
|---|---|
| 관리자 진입 | 고객 메뉴 ‘제공기록지 보기’, 새 탭, 관리자 인증으로 3단계 일자별 기록 직행 |
| 화면과 기록 | 현행 전체 14개 항목·하위 입력·480px 레이아웃 공유, 제출 여부와 무관하게 모든 회차 조회·수정 |
| 초안 | 같은 지점 관리자가 이어서 수정·확정, 초안 저장은 실제 일정이나 문서에 반영하지 않음 |
| 확정 위치 | 고객 상세의 ‘서비스 일정 변경’ 자리에 ‘수정 확정’, 변경 내역을 최종 확인한 뒤 실행 |
| 제공 일수 | duration·바우처 5/10/15일 등 계약된 일수 불변. 회차를 빼지 않고 미룬 만큼 종료일 연장 |
| 이동 | 주말·한국 공휴일 선택 불가, 선택 회차 이후 제출·미작성 회차 모두 동일한 영업일 차이만큼 이동 |
| 표시 | 지점은 최초 날짜와 수정 날짜, 제공인력과 생성 문서는 확정된 수정 날짜만 표시 |
| 서명 | 기존 서명 보존·재서명 없음. 기록지의 표시용 서명 날짜는 수정 제공일로 변경, 실제 서명·제출 시각은 보존 |
| 계약과 영수증 | 계약 기간 필드와 영수증 서비스 기간 필드를 함께 갱신. 본인부담금 수령일·금액은 변경하지 않음 |
| 전자문서 | 계약 완료 전에는 같은 문서 항목 갱신. 이미 계약 완료면 새 전자문서 생성, 기존 문서 이력 보존 |
| 관련 기능 | 고객/배정/기록/현황 카드/예약 메시지/서비스 종료 후 계약 자동 완료 시점 연동 |

비목표: 제공 일수·요금·바우처 종류 변경, 본인부담금 수령일 변경, 기존 실제 서명 시각 조작, 일반 제공인력 인증 완화, 지점 간 권한 확대, 제공인력 자동 교체, 산모 기본정보 편집, 수정 확정 때 추가 안내 메시지 자동 발송. 완료 전 계약에 별도 ‘수정 계약서’를 발급하지 않는다.

검증 근거: `technical-verification-20260907.md`. 남동구 최신 양식으로 생성한 테스트 문서에서 제공기관 확인 단계 임시 저장 후 동일 ID·서명·수령일 유지와 변경 날짜 재조회까지 확인했다. 영수증 서비스 기간은 계약 종료일 변경만으로 자동 갱신되지 않아 별도로 입력했다. 이 증거는 자동 API 저장·공용 다운로드 PDF·영수증 이미지 갱신 증거를 대신하지 않는다.

현재 코드에서 직접 확인한 출발점:

| 확인 내용 | 근거 |
|---|---|
| 현재 14개 일자별 항목과 4개 화면 | [모바일 폼 정의](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/mobile/src/app/(public)/service-record/[token]/page.tsx:42) |
| 기존 480px 단일 열 화면 스타일 | [Styles](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/mobile/src/app/(public)/service-record/[token]/page.tsx:1158) |
| 완료 상태·제출된 회차 수정 차단 | [완료 상태 검사](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/service-record-entry.service.ts:199), [잠긴 회차 검사](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/service-record-entry.service.ts:299) |
| 문서 발행 버전이 양식 버전을 사용 | [기존 청크·문서 조회](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/usecases/eformsign-doc/create-and-send-service-record-snapshot.usecase.ts:174) |
| 뒤 회차 이동은 unlocked 기록만 대상 | [기존 일정 변경](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/schedule-change.service.ts:351) |
| 일반 관리자 레이아웃은 사이드바 포함 | [ProtectedLayout](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/frontend/src/app/(protected)/layout.tsx:25) |
| entry가 case를 먼저 잠금 | [entry의 첫 잠금](/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/service-record-entry.service.ts:177) |

실행 주석: 사용자의 2026-09-07 실행 지시에 따라 각 구현 task는 gpt-5.6-luna/max로 수행한다. local은 luna_implementer, 승인된 network는 luna_network_implementer를 사용한다. 메인 에이전트는 통합과 검증을 담당한다. 각 Phase의 독립 감사는 default 에이전트에 model=gpt-6-astra, reasoning_effort=medium을 명시하여 수행한다. 구현자와 별도 컨텍스트(fork_turns=none)에서 읽기 전용으로 감사하며, 각 Phase 완료 또는 차단 보고 시 실행한다. 감사 지적은 해당 Luna/max 구현 작업으로 돌려보내고 해소 확인 전 다음 Phase로 진행하지 않는다. 과거 Sol 계획 검토 기록은 그대로 보존한다. 구현 작업은 순차 실행하며 병렬 배치는 없다.

추가 Task의 상대 Paths는 동일 task worktree 루트를 기준으로 해석한다.

실행 경로 계약: 아래 Paths의 절대 경로는 검토를 위한 integration 파일 위치다. dispatcher는 Task N.M을 실행하기 전에 루트 `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor`를 정확히 `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor-units/task-N-M`으로 치환하고, branch `unit/admin-service-record-N-M` 및 cwd를 일치시킨다. 치환하지 않은 brief로 worker를 실행하지 않는다. 각 unit은 직전 완료 task가 통합된 integration HEAD에서 분기한다. Task 6.2는 검증한 integration diff를 읽기만 하고, Task 7.1의 원격 병합은 사용자가 승인한 target에서만 수행한다.

## Phase 0 — 자동 문서 반영 가능 여부 확정

화면 임시 저장과 앱 자동 연동의 차이를 실제 테스트 문서로 검증한다.

- **Task 0.1: 확인 단계 저장·출력·완료 문서 생성 검증** (test, high)
  - 기존 eformsign 연동의 공식 지원 API 또는 임베디드 편집 흐름으로 같은 문서의 계약 기간과 영수증 서비스 기간을 갱신한다. 남동구·서구 각각 서명 완료/계약 완료 전 문서를 사용해 저장 후 API 재조회, 별도 미리보기/다운로드 PDF, 영수증 이미지까지 확인한다. UI의 임시 저장만 보이면 최종 출력 반영으로 판정하지 않는다. 계약 완료 후 새 문서 생성도 재서명 없이 가능한지 별도로 확인한다.
  - 동일 문서 ID·이용자 서명·원래 서명 이력·수령일·금액·확인 단계가 보존되는지 검증한다. 공식 저장 경로가 완료를 강제하거나 재서명을 요구하면 자동화는 통과가 아니다. 브라우저 내부 비공개 요청 재생이나 목록의 ‘수정’으로 작성 단계로 되돌리는 우회는 사용하지 않는다.
  - 외부 저장 성공/응답 유실·부분 갱신·다운로드가 이전 데이터인 경우의 복구 방법을 증거와 함께 기록한다. 통과 전 문서 자동 연동을 구현 가능한 것으로 단정하거나 기능을 운영에 켜지 않는다. 기술적으로 불가능하면 정책을 임의로 바꾸지 않고 제약과 구체적 대안을 사용자에게 제시한다. 이 검증은 기존 본인 테스트 권한 범위만 사용하고 다른 고객에게 발송하지 않는다.

  **Tier:** heavy · **Sandbox:** network · **Agent:** luna_network_implementer · **Model:** gpt-5.6-luna · **Effort:** max  
  **Paths:** `backend/application/services/eformsign.service.ts`, `backend/test/e2e/contract-headless.live.e2e.spec.ts`, `backend/test/e2e/bjj249-service-record-snapshot.live.e2e.spec.ts`, `docs/plans/admin-service-record-editor/technical-verification-20260907.md`  
  **Depends:** none

## Phase 1 — 동일한 화면과 관리자 진입 경계 확보

전체 항목과 기존 화면을 하나의 구현으로 유지하면서 관리자 로그인 영역에서 새 탭을 연다.

현재 모바일 페이지에는 `DAILY_ITEMS` 14개와 산모·신생아·서비스 기록·확인 화면이 있다. 초안은 이 배열과 기존 CSS를 원본에서 추출해 사용한다. 실제 구현도 축약된 별도 폼을 만들지 않는다. 완료된 전체 회차도 3단계 목록에서 접근 가능해야 한다. 관리자 모드에서는 전체 회차 제출이 끝나도 완료 화면으로 강제 이동하지 않으며 ‘수정 확정’ 위치를 항상 유지하고 변경이 없을 때만 비활성화한다. 기간 밖에 보관된 회차가 있다면 별도 표시하되 조회 결과에서 조용히 제외하지 않는다.

관리자 경로는 같은 **frontend 출처**의 `/service-record-admin/[clientId]`로 한다. 기존 `(protected)` 레이아웃은 사이드바를 렌더하므로, 동일 로그인 검증을 사용하는 별도 최소 레이아웃으로 480px 제공기록지 화면을 표시한다. 전화번호를 임의로 인증 처리하거나 공용 링크에 `admin=true`를 붙이는 방식은 쓰지 않는다. URL에 인증 토큰을 넣지 않는다. 비로그인·세션 만료·권한 회수는 서버에서 거부한다.

- **Task 1.1: 기존 화면을 공유하는 경계 확정** (refactor, med)
  - `packages/service-record-ui`에 기존 폼 정의·화면·CSS를 이동한다. Next 라우팅, 인증, API, 분석 도구, 브라우저 저장소는 앱별로 유지한다. 서명·모달처럼 앱에 연결된 요소는 명시적인 조합 지점으로 전달한다.
  - 기존 public 경로는 같은 동작을 유지하고, frontend 관리자 화면도 같은 폼을 렌더한다. 기존 shared 유틸 패키지에 React를 섞어 backend 빌드를 변경하지 않는다. 양쪽 앱의 데이터 식별 속성은 호출자가 전달한다. 새 패키지의 exports·React peer·JSX tsconfig·workspace 연결·Next transpilePackages·CSS import 위치를 명시하고, Next/auth/storage/분석 도구 import가 없다는 경계 테스트를 둔다. 외부 신규 UI 라이브러리는 추가하지 않는다.
  - 14개 항목·하위 수치·이상변 색깔·서명 표시·4개 단계 및 390/480/desktop 화면 비교를 통과해야 다음 단계로 간다. 패키지 연결은 양쪽 빌드로 증명한다.

  **Tier:** standard · **Sandbox:** local · **Agent:** luna_implementer · **Model:** gpt-5.6-luna · **Effort:** max  
  **Paths:** `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/packages/service-record-ui/`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/mobile/src/app/(public)/service-record/[token]/page.tsx`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/mobile/src/components/app/service-record/`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/frontend/package.json`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/mobile/package.json`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/pnpm-lock.yaml`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/pnpm-workspace.yaml`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/frontend/next.config.ts`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/mobile/next.config.ts`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/docs/design-system/component-manifest.json`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/docs/design-system/ui-debt-baseline.json`  
  **Depends:** Task 0.1

- **Task 1.2: 조회 전용 관리자 진입을 먼저 연결** (feature, med)
  - 메뉴는 링크로 새 탭을 열어 팝업 차단을 피한다. 관리자 조회 API가 branch·case 권한을 확인한 뒤 전체 회차를 반환한다. 조회만으로 링크 발급·기록 생성·문자 발송이 일어나지 않는다.
  - 기존 `JwtGuard`·`TenantGuard`·`OwnerOrAdminGuard` 정책을 적용한다. UI 표시 여부와 별개로 모든 초안·확정·미리보기·재시도 API에서 서버 권한을 검사한다.
  - 빈 기록, 배정 이력, 전자문서 생성 완료 상태, 로그아웃, 다른 지점 clientId, URL 직접 입력을 검증한다. 공개 흐름에 관리자 권한이 전달되지 않는지 확인한다.

  **Tier:** standard · **Sandbox:** local · **Agent:** luna_implementer · **Model:** gpt-5.6-luna · **Effort:** max  
  **Paths:** `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/frontend/src/app/(protected)/clients/page.tsx`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/frontend/src/app/(service-record-admin)/`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/frontend/src/app/api/admin/service-records/`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/interface/controllers/admin-service-record.controller.ts`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/admin-service-record.service.ts`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/interface/dto/admin-service-record.dto.ts`  
  **Depends:** Task 1.1

## Phase 2 — 원본과 분리된 수정 초안

새로고침이나 다른 관리자 접속에도 초안을 보존하면서, 원본의 변경과 충돌하면 덮어쓰기를 막는다.

제안 데이터 모델은 다음과 같다. 실제 스키마 변경은 계획 합의 후 별도 migration으로 만든다.

| 모델 | 역할과 핵심 데이터 | 보장할 조건 |
|---|---|---|
| `service_record_edit_draft` | case·branch, 시작 당시 데이터 식별값, 허용된 필드별 변경, 초안 버전, 작성자·최종 수정자·실제 서버 시각 | case당 활성 초안 하나; 버전이 맞는 수정만 저장 |
| `service_record_revision` | 확정된 전체 기록·일정·배정·서명 근거의 고정된 사본, 내용 버전, 확정자·시각, 원본과 차이 | `(caseId, revisionNumber)` 중복 금지; 확정 뒤 내용 수정 불가 |
| revision별 문서 상태 | 대상 수정 버전, 생성 대기·진행·실패·완료, 문서 버전, 재시도 정보 | 기존 snapshot chunk 처리에 연결; 생성 작업 유실 방지 |
| case의 `plannedSessions` | 회차별 날짜와 assignmentId·scheduleId·employeeId·귀속 근거 버전을 포함하는 확정 예정 맵 | 기록 제출 행을 만들지 않고 예정일만 보존; legacy는 기존 계산으로 fallback |
| case의 현재 버전 참조 | 최신 확정 내용 버전 / 최신 사용 가능한 문서 버전 | 기록 확정과 문서 생성 완료를 구분 |

`case.version`(경합 제어), `formVersion`(양식), 새 내용 수정 버전, `snapshotVersion`(발행 버전)은 서로 다른 의미로 관리한다. 현재 코드에서는 `snapshotVersion = record.formVersion`으로 조회·생성하므로 이 연결을 먼저 분리해야 한다. 새 문서 생성은 revisionId와 고정 payload를 필수로 받는다. case 잠금 안에서 이전 문서 버전 최댓값 다음 번호를 할당한다. 과거 청크는 legacy로 남기고 새 revision에 임의 연결하지 않는다. 과거 PDF의 원본 내용을 현재 DB 값으로 추정해 복원했다고 표시하지 않는다.

- **Task 2.1: 초안·수정 이력 저장 기반 추가** (infra, high)
  - 추가형 migration으로 테이블·참조·인덱스·중복 방지 조건을 만든다. 기존 레코드는 기존 처리 방식으로 읽을 수 있게 유지한다. 지점별 접근 및 고객 삭제 후 문서 보존 정책을 기존 보존 계약과 맞춘다.
  - 초안에는 권한·submittedAt·서명 시각·제공인력 ID를 임의 입력할 수 없다. 변경 가능한 필드만 저장하며 기존 숨은 필드와 서명 근거는 지운 뒤 재작성하지 않는다.
  - 격리 DB에서 빈 DB와 기존 snapshot 데이터가 있는 DB 양쪽 migration·재실행·구버전 읽기를 검사한다. 기존 데이터 삭제를 롤백 수단으로 사용하지 않는다.

  **Tier:** standard · **Sandbox:** local · **Agent:** luna_implementer · **Model:** gpt-5.6-luna · **Effort:** max  
  **Paths:** `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/prisma/schema.prisma`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/prisma/migrations/`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/infrastructure/repositories/service-record-edit.repository.ts`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/interface/dto/admin-service-record-edit.dto.ts`  
  **Depends:** Task 1.2

- **Task 2.2: 임시저장·재개·취소를 화면에 연결** (feature, med)
  - 회차별 저장은 draft만 수정한다. 확정된 일정·공개 제공기록지·문서·현황 카드는 그대로 유지한다. 변경된 회차와 마지막 저장 상태를 표시한다.
  - 같은 지점 관리자가 함께 작업하며 초안 버전이 오래된 저장을 409로 거부하고 서버 변경을 보여준다. 저장 전 입력은 잃지 않도록 유지한다. 원본이 바뀌어도 초안을 자동 삭제하거나 자동 확정하지 않는다.
  - 새로고침·탭 닫고 재접속·두 관리자 동시 저장·취소·권한 회수·기존 제공인력 제출과의 경합을 검증한다.

  **Tier:** standard · **Sandbox:** local · **Agent:** luna_implementer · **Model:** gpt-5.6-luna · **Effort:** max  
  **Paths:** `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/admin-service-record-edit.service.ts`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/interface/controllers/admin-service-record.controller.ts`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/frontend/src/features/service-records/`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/frontend/src/app/api/admin/service-records/`  
  **Depends:** Task 2.1

## Phase 3 — 날짜 연동과 최종 확인 내역

서버가 전체 회차·배정에 미치는 영향을 계산하고, 사용자가 확인한 결과만 확정 대상으로 만든다.

제공일은 한국 날짜 단위, 제출·수정 시각은 실제 시각으로 구분한다. 공통 한국 영업일 달력에서 각 날짜의 순번 B(d)를 정의하고, 선택 회차 k의 변경 차이 Δ=B(새 날짜)-B(초안 현재 날짜)를 구한다. i≥k인 모든 회차를 B⁻¹(B(dᵢ)+Δ)로 이동한다. 이미 제출된 회차와 아직 기록이 없는 미래 회차를 모두 포함하고 영업일 간격과 제공인력 귀속을 보존한다. 주말·공휴일·앞 회차와 역전·중복은 허용하지 않는다. 해당 연도 달력이 없으면 평일로 추정하지 않고 확정을 막는다.

고객의 확정된 제공 일수 N은 계약·바우처에서 가져오며 날짜 범위로 역산해 덮어쓰지 않는다. 항상 회차 수=N, 고유한 제공 날짜 수=N이어야 한다. 5/10/15일과 기존 일반 서비스의 고정 일수를 모두 보존한다. 하루 미제공은 회차 삭제가 아니라 그 회차부터 뒤 일정을 이동시키는 것이다. 종료일은 마지막 실제/예정 회차 날짜로 정하므로 빠진 일수만큼 서비스가 이어진다. 기존 기록이 N과 모순되면 조용히 자르거나 추가하지 않고 불일치를 보여주며 확정을 막는다. 최초 날짜는 첫 수정 때 보존한 원래 날짜로 고정하고, 2차 수정부터도 최초 값이 바뀌지 않게 한다.

누락된 미래 회차는 저장된 답변이 없더라도 예상 날짜를 계산한다. 날짜만 있는 `service_record_day`를 만들면 임시저장/미작성 알림 의미가 바뀌므로 만들지 않는다. 확정 시 case.plannedSessions에 예정일을 저장하고 모든 조회자가 하나의 공통 함수에서 현재 수정 버전의 plannedSessions → 해당 버전에 일치하는 실제 day → 미이관 legacy 계산 순으로 읽는다. 확정 시 기존 day 날짜도 같은 값으로 맞춘다. 각 예정 회차에는 assignmentId·scheduleId·employeeId와 귀속 근거 버전을 저장한다. 기존 배정 이력에서 유일하게 결정되는 회차만 최초 이관하며, 복수/누락 귀속은 확정 차단 사유로 표시한다. 미래 회차의 귀속을 존재하지 않는 day에서 읽는다고 가정하지 않는다. 회차 수·기록 ID·제공인력 귀속은 유지한다. 1회차 이동 시 시작일, 마지막 회차 이동 시 종료일을 재산정하며 앞당기기로 날짜 범위가 줄어도 제공 일수는 유지한다. 각 회차의 기존 scheduleId·employeeId 귀속을 고정하고, 그 배정에 귀속된 전체 예상/실제 날짜의 최소·최대로 해당 employee_schedule 및 service_record_assignment 범위를 계산한다. client/case 기간은 전체 외곽 날짜로 계산한다. 현재 활성 배정만 수정하는 것으로 끝내지 않는다. 배정 간 순서 역전·서로 겹치는 범위·다른 고객의 활성 배정 충돌이면 확정을 거부한다. 삭제된 schedule이나 모호한 과거 귀속은 해당 회차를 명시하고 확정을 막되 조회·초안은 보존한다. 다른 직원에게 자동으로 재배정하지 않는다.

- **Task 3.0: 공통 잠금 순서 확정과 회귀 검증** (refactor, high)
  - entry·일정 변경·lifecycle·자동 최종화·배정 변경의 잠금/쓰기 순서를 목록으로 고정한다. client → 정렬된 직원 → case → 정렬된 세션/배정 → draft/revision 순서에 맞추고 잠금 후 대상 집합을 재검증한다.
  - 기존 제출과 일정 변경이 서로 반대 순서로 동시에 진입하는 테스트를 먼저 작성한다. 목록 밖의 쓰기 경로가 발견되면 그 경로를 추가 검토하고, 공통 순서 확인 전에는 수정 확정 구현으로 넘어가지 않는다.

  **Tier:** standard · **Sandbox:** local · **Agent:** luna_implementer · **Model:** gpt-5.6-luna · **Effort:** max  
  **Paths:** `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/service-record-entry.service.ts`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/schedule-change.service.ts`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/service-record-lifecycle.service.ts`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/service-record-finalization.service.ts`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/policies/employee-schedule-invariants.policy.ts`  
  **Depends:** Task 2.2

- **Task 3.1: 날짜 변경 계산과 서버 미리보기** (feature, high)
  - 기존 `schedule-change`의 영업일 계산·배정 충돌 검사·클라이언트/직원 잠금 정책을 재사용한다. 다만 현재 ‘잠금되지 않은 뒤 회차만 이동’과 ‘종료일 연장’ 전용 부분을 그대로 호출하지 않는다.
  - 서버가 before/after 날짜, 기록 필드 변경, 시작·종료일, 영향받는 배정, 서명 처리, 재생성할 문서 범위를 반환한다. 초안에 반영된 현재 전체 날짜 벡터를 기준으로 선택 회차의 기존 날짜와 새 날짜 차이를 계산해 해당 회차 이후에 한 번 적용한다. 입력 필드 PATCH 재시도는 draftVersion 조건으로 중복 이동을 막는다. 여러 회차를 고친 뒤 원본으로 되돌리는 경우도 벡터 차이를 미리보기에 표시한다. 연속 영업일로 재배열하지 않아 원래의 불규칙 간격을 유지한다.
  - 변경 결과의 앞 회차 역전·중복 날짜·직원 배정 충돌은 확정 전에 구체적으로 보여준다. 배정 경계를 넘는 경우도 제공인력 귀속을 자동으로 바꾸지 않는다.

  **Tier:** standard · **Sandbox:** local · **Agent:** luna_implementer · **Model:** gpt-5.6-luna · **Effort:** max  
  **Paths:** `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/schedule-change.service.ts`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/policies/employee-schedule-invariants.policy.ts`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/policies/service-record-edit-preview.policy.ts`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/domain/utils/business-days.ts`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/packages/shared/src/utils/service-record-schedule.ts`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/packages/shared/src/types/service-record.ts`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/mobile/src/lib/service-records/`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/frontend/src/features/service-records/`  
  **Depends:** Task 3.0

제안 API (기존 `/admin/service-records` 아래, 모두 지점 권한 검사):

| 요청 | 책임 |
|---|---|
| `GET client/:clientId/editor` | 확정 데이터·전체 회차·기존 초안·허용 작업 조회 |
| `POST client/:clientId/draft` | 현재 원본을 기준으로 초안 시작 또는 기존 활성 초안 반환 |
| `PATCH drafts/:draftId` | 초안 버전 조건으로 허용 필드 변경 |
| `POST drafts/:draftId/preview` | 최신 원본과 비교한 변경 내역 및 확인용 식별값 |
| `POST drafts/:draftId/confirm` | draftVersion·확인용 식별값·중복 방지 키 검증 후 확정 |
| `POST drafts/:draftId/discard` | 버전 조건으로 초안 취소 |
| `GET revisions/:revisionId` | 확정 기록과 수정본 생성 상태 조회 |
| `POST revisions/:revisionId/retry-documents` | 같은 수정본의 실패한 문서 생성만 재시도 |

## Phase 4 — 한 번의 수정 확정으로 최종 반영

한쪽만 저장되는 상태와 오래된 확인 창으로 덮어쓰는 일을 막는다.

- **Task 4.1: 확정 트랜잭션과 충돌 처리** (feature, high)
  - 모든 관련 쓰기 경로의 잠금 순서를 조사하고 한 가지 순서로 통일한 뒤 구현한다. 원본 기록·client·employee_schedule·assignment·초안 버전을 잠금 안에서 다시 확인한다. 일반 제출·기존 일정 변경·자동 최종화와 충돌해도 교착이나 조용한 덮어쓰기가 없어야 한다. 현재 entry는 case → client → 직원 순서이며 기존 schedule 경로는 client → 직원 → lifecycle/case여서 이미 같은 순서라고 가정하면 안 된다. 공통 쓰기 조정 경계의 권장 순서는 client → 정렬된 직원 → case → 정렬된 세션/배정 → draft/revision이며, 전체 영향 경로가 이 순서를 지키는 테스트를 확정 기능보다 먼저 통과시킨다.
  - 일정·기록·수정 이력·확정 데이터 사본·문서 생성 의도를 하나의 DB 트랜잭션으로 저장한다. 실제 제출/서명 시각·기존 제공인력 귀속은 보존하고 지점 수정자/확정자/시각을 별도로 남긴다. 서비스 제공 링크 만료·finalization 예정일 등 파생 데이터도 같은 변경과 일치시킨다. 영수증 링크의 기존 만료 계약은 유지한다. duration과 본인부담금 수령일·금액은 쓰기 허용 목록에서 제외한다. 계약서와 영수증 기간 갱신 의도 및 기존 예약 작업의 무효화 버전도 함께 저장한다.
  - 동일 요청 재전송은 같은 revision 결과를 반환한다. 다른 원본 변경이 확인 이후 발생하면 409로 막고 최신 미리보기를 다시 요구한다. 변경 없음은 문서 생성 없이 종료한다. 실패 시 초안을 유지한다.

  **Tier:** standard · **Sandbox:** local · **Agent:** luna_implementer · **Model:** gpt-5.6-luna · **Effort:** max  
  **Paths:** `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/admin-service-record-edit.service.ts`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/infrastructure/repositories/service-record-edit.repository.ts`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/service-record-entry.service.ts`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/service-record-lifecycle.service.ts`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/schedule-change.service.ts`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/policies/employee-schedule-invariants.policy.ts`  
  **Depends:** Task 3.1

- **Task 4.2: 기존 일정 변경과 자동 작업도 같은 날짜를 사용** (feature, high)
  - 기존 일정 변경·배정·기록 조회·알림 조회자가 확정 날짜 배열을 함께 읽게 한다. 공개 제공인력 저장/upsert 역시 잠금 안에서 최신 plannedSessions의 날짜·귀속을 검증하고 서버 값으로 저장한다. 요청의 날짜가 오래된 버전에 해당하면 409와 재조회 요구로 거부한다. 관리자 확정 직후 제공인력이 미작성 회차를 생성하는 동시 실행에서도 이전 계산 날짜가 다시 들어가면 실패다. 날짜 범위로 duration을 다시 계산하는 경로를 제거하고, 기존 5/10/15일과 일반 서비스 일수, 이미 제출된 회차와 미작성 미래 회차가 모두 보존되는지 통합 검증한다. 신규 관리자 경로에서만 맞고 기존 기능에서 다시 덮어쓰는 구현은 통과시키지 않는다.
  - 변경된 종료일로 계약 자동 완료 예정일을 기존 지점 설정에 따라 다시 계산한다. 기본 종료일 후 7일이라는 기존 정책을 바꾸지 않는다. 이미 대기/선점된 작업도 실행 직전에 수정 버전·최신 종료일·문서 동기화 완료 여부를 확인한다. 기한이 과거가 되어도 화면 저장 동작에서 계약을 즉시 완료하지 않고 기존 스케줄러가 최신 조건으로 판단한다.
  - 미발송 예약 메시지는 기존 trigger/job 체계에서 재평가한다. 기존 작업은 무효화하고 같은 이벤트를 중복 발송하지 않는다. 이미 발송된 메시지는 재발송하지 않는다. 문서와 일정 상태가 다른 동안 오래된 영수증 전송은 보류한다. 직원 교체 이력·기간 단축/연장·확정과 예약 작업 동시 실행을 검증한다.

  **Tier:** standard · **Sandbox:** local · **Agent:** luna_implementer · **Model:** gpt-5.6-luna · **Effort:** max  
  **Paths:** `backend/application/services/schedule-change.service.ts`, `backend/application/services/service-record-lifecycle.service.ts`, `backend/application/services/service-record-entry.service.ts`, `backend/application/services/contract-auto-finalize-scheduler.service.ts`, `backend/application/services/contract-auto-finalize.policy.ts`, `backend/application/services/eformsign-document-job-worker.service.ts`, `backend/application/services/message-trigger*.ts`  
  **Depends:** Task 4.1

## Phase 5 — 계약과 영수증 동기화 및 기록지 재생성

외부 전자문서 생성이 실패하거나 늦어져도 확정 내용과 이전 문서를 잃지 않는다.

완료된 case의 기존 lifecycle 상태를 다시 열거나 `formVersion`을 바꾸지 않는다. 수정본의 생성 상태는 revision별로 추적하고 기존 scheduler/청크 처리에 연결한다. 별도의 독립 job 시스템은 추가하지 않는다.

DB 저장과 외부 문서 생성은 하나의 트랜잭션으로 묶을 수 없다. 화면 상태를 ‘수정 확정됨 · 수정본 생성 중/실패/완료’로 분리한다. 확정 버튼 응답은 문서 생성 완료를 의미하지 않는다. 재시도는 이미 확정된 동일 데이터로 수행하며 새 수정 버전을 만들지 않는다.

아래 버전 생성 설명은 제공기록지에 적용한다. 계약서는 Task 5.3의 완료 전 동일 문서 갱신 규칙을 적용한다. 이미 전체 제출과 원본 문서 생성이 끝난 case는 확정 직후 새 버전 생성 대상으로 등록한다. 원본 문서가 아직 없는 진행 중 case는 기존 완료/최종화 조건을 유지해 미완성 전자문서를 갑자기 발행하지 않는다. 생성 중인 버전이 있는 경우 초안 편집은 허용하되 다음 확정은 생성 상태 정리 후 가능하게 한다. 이 초기 제한을 UI에 설명한다.

날짜 연동 수락 행렬:

| 시나리오 | 합격 조건 |
|---|---|
| 5/10/15일 중간 회차가 1영업일 미뤄짐 | 해당 회차 이후 모든 제공일이 1영업일 이동, 총 N개 유지, 마지막 제공일 연장 |
| 주말·공휴일·연도 경계 및 앞당기기 | 영업일 순번으로 이동, 주말/휴일 선택 거부, 이전 회차 역전/중복 거부 |
| 불규칙 간격·제출 완료·미작성 미래 회차 혼합 | 영업일 간격 유지, 기록 유무와 무관하게 전 회차 포함, 날짜만을 위해 제출 행 생성 금지 |
| 직원 2명/교체 이력/기존 다른 고객 배정 | 기존 귀속 유지, 영향 배정 범위 계산, 다른 고객 충돌 시 무변경·초안 보존 |
| 2차 수정·원상 복귀·중복 confirm | 최초 날짜/서명 시각 유지, 동일 요청은 같은 결과, 재시도로 날짜가 추가 이동하지 않음 |
| 기존 일반 일정 변경이 뒤이어 실행 | 같은 확정 날짜/N을 읽고 수정 버전 검증, duration 덮어쓰기 없음 |
| 계약/영수증 연동 지연 중 자동 완료 선점 | 오래된 작업은 완료/발송하지 않음, 최신 버전의 두 필드/출력 반영 뒤 실행 |
| 2차 문서 생성 중 1차 webhook 도착 | 1차 문서 상태만 갱신, 최신 수정본 또는 계약 포인터 승격 금지 |

문서 버전 수락 테스트:

| 시작 상태/사건 | 기대 결과 |
|---|---|
| legacy 양식 v2, 문서 snapshotVersion=2 → 첫 지점 확정 | formVersionAtConfirm=2, 내용 revision=1, 문서 발행 version=3; legacy 문서의 revisionId는 null 유지 |
| revision 1 / 문서 v3 생성 실패 후 재시도 | 같은 revisionId·고정 payload·sourceHash·문서 v3·청크 ID 사용, v4 생성 금지 |
| revision 1 완료 후 다음 수정 확정 | 내용 revision=2, 문서 v4, 양식 v2 유지, v2/v3 문서 보존 |
| 원본 v2 webhook/poller가 v3 생성 도중 도착 | v2 문서 행만 갱신, v3 revision과 현재 문서 포인터는 승격하지 않음 |
| 원본 문서 없는 진행 중 case를 지점에서 수정 | 부분 수정 revision으로 문서를 생성하지 않음; 전체 제출 완료 시 `INITIAL_FINALIZATION` 종류의 새 고정 사본을 만들어 현재 완성 데이터로 최초 발행 |

- **Task 5.1: 고정된 수정 버전으로 기존 생성기를 확장** (feature, high)
  - 기존 청크 선점·중복 방지·외부 생성 결과 재조회 구조를 재사용한다. 청크 경계뿐 아니라 실제 필드·일자·제공인력·서명 근거까지 확정된 사본에서 읽는다. 재시도 때 live case를 다시 읽어 payload를 바꾸지 않는다.
  - 문서 발행 버전은 기존 최댓값 이후로 부여하고 과거 청크·eformsign 문서 ID를 지우지 않는다. sourceHash·요청 마커·조회 기준·완료 판정을 대상 revision과 문서 버전에 연결한다.
  - 외부 호출 성공 후 응답 유실, DB 반영 전 중단, 중간 청크 실패, 이미 있는 버전으로 재시도, 구버전 webhook 지연을 검증한다. 구문서 webhook과 poller는 자신의 문서 상태만 갱신하고 현재 revision·문서 포인터를 바꾸지 못해야 한다. current pointer 승격은 대상 revision의 모든 청크 완료를 확인하는 한 곳에서만 수행한다. 구문서 webhook이 새 수정본을 완료 처리하면 실패다.

  **Tier:** standard · **Sandbox:** local · **Agent:** luna_implementer · **Model:** gpt-5.6-luna · **Effort:** max  
  **Paths:** `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/service-record-finalization.service.ts`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/service-record-finalization-scheduler.service.ts`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/usecases/eformsign-doc/create-and-send-service-record-snapshot.usecase.ts`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/service-record-lifecycle.service.ts`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/usecases/eformsign-doc/`  
  **Depends:** Task 4.2

계약 외부 단계별 처리 계약:

| 실제 외부 상태 | 작업 규칙 |
|---|---|
| 제공기관 확인/수정 가능 참여 단계 | Phase 0에서 검증한 동일 문서 저장 경로로 갱신, 저장 전후 단계와 필드 재조회 |
| 이용자 서명 대기/서명 진행/전송 중 | 기존 문서를 유지하고 문서 갱신은 대기. 서명 완료 후 제공기관 확인 상태에서 최신 확정 버전을 저장. 대기 중 문서 동기화는 미완료로 표시하고 자동 계약 완료/영수증 전송을 보류 |
| 완료 | 원본을 유지하고 새 전자문서 생성, 같은 완료 문서 수정 시도 금지 |
| 반려/취소/삭제/권한 부족/알 수 없음 | 기존 워크플로우 정책에 따라 처리 필요 상태로 표시, 무조건 재발급하거나 작성 단계로 되돌리지 않음 |

상태는 표시 이름이 아니라 외부 단계 타입·문서 상태 및 저장 가능 권한으로 판단한다. 외부에서 서명 중인 동안 값을 덮어쓰지 않는다. 제공기관 확인으로 전환된 후 저장하되 원래 서명 당시 값과 날짜의 근거를 보존하고, 그 서명을 새 변경에 대한 동의로 기록하지 않는다. 저장 직전/직후 완료 경합은 재조회하며 결과 불명 상태에서는 중복 신규 생성하지 않는다. 이 단계 매트릭스의 자동화 가능성도 Phase 0의 통과 조건이다.

- **Task 5.3: 계약서와 영수증 기간을 같은 수정 버전으로 갱신** (feature, high)
  - 확정 사본에서 계약 시작/종료일과 영수증 서비스 기간을 모두 만든다. eformsign 문서별 ID·실제 단계·양식 버전·필드 권한을 확인하고, 미완료 계약은 Task 0.1에서 증명한 같은 문서 저장 경로를 사용한다. 변경 전 필드/서명 근거를 보존한다. 수령일·금액·실제 서명 시각을 변경 payload에 넣지 않는다. 오래된 검토 단계 문서에도 동일 이름의 확인 단계 설정이 적용됐다고 가정하지 않는다.
  - 완료된 계약은 고정 수정 사본·원본 서명을 사용해 새 문서를 생성하고 원본 ID를 이력에 남긴다. 완료/미완료 판단과 저장 사이에 완료된 경우 다시 조회해 분기를 재결정한다. 응답 유실만으로 새 문서를 생성하지 않는다. 문서별 `(revisionId, documentId, operation)` 중복 방지와 전체 필드 재조회로 부분 성공을 감지한다.
  - 계약/영수증 연동 완료는 두 필드 저장 및 출력 확인 후 표시한다. 후속 확정은 이전 연동 정리 후 허용하고 초안은 계속 저장할 수 있다. 기록지 청크와 계약 문서의 최신 포인터는 별도로 관리하며 기록지 생성이 고객 계약 eDocId를 덮어쓰면 실패다. 남동구·서구 및 완료 전/후, 저장 도중 완료·응답 유실·오래된 webhook을 검증한다.

  **Tier:** standard · **Sandbox:** local · **Agent:** luna_implementer · **Model:** gpt-5.6-luna · **Effort:** max  
  **Paths:** `backend/application/services/eformsign.service.ts`, `backend/application/usecases/eformsign-doc/`, `backend/application/services/admin-service-record-edit.service.ts`, `backend/prisma/schema.prisma`  
  **Depends:** Task 0.1, Task 5.1

- **Task 5.4: 기존 영수증 URL에서 최신 이미지 제공** (feature, high)
  - 기존 영수증 링크·이미지 생성 및 메시지 템플릿 경로를 확장한다. URL 토큰과 만료 정책은 유지하고 해당 링크가 참조하는 계약/수정 버전을 명시한다. 템플릿을 복제하거나 별도 발송 체계를 만들지 않는다.
  - 문서 출력이 최신임을 확인한 뒤 새 버전 경로에 이미지를 생성·검증하고 현재 이미지 참조를 교체한다. 캐시가 구버전을 내보내지 않도록 버전 키와 응답 정책을 적용한다. 생성 실패 때 기존 이미지를 최신으로 표시하지 않고 연동 실패 상태와 재시도를 제공한다. 민감 문서를 공개 저장소로 옮기지 않는다.
  - 같은 영수증 URL로 변경 서비스 기간이 표시되고 수령일·금액은 그대로인지, 만료·권한·구버전 캐시·동시 생성·응답 유실을 확인한다. 이미 전송한 링크는 그대로 사용하며 수정만으로 문자를 추가 전송하지 않는다.

  **Tier:** standard · **Sandbox:** local · **Agent:** luna_implementer · **Model:** gpt-5.6-luna · **Effort:** max  
  **Paths:** `backend/application/services/receipt-link-issue.service.ts`, `backend/application/services/receipt-link-delivery-enricher.service.ts`, `backend/application/services/receipt-link-manual-send.service.ts`, `backend/interface/controllers/receipt-link.controller.ts`, `backend/domain/constants/system-template-registry.ts`, `backend/test/e2e/`  
  **Depends:** Task 5.3

- **Task 5.2: 확정 상태·문서 이력·원래 탭 갱신 연결** (feature, med)
  - 새 탭의 성공 이벤트는 같은 출처의 알림 채널로 case ID/버전만 보낸다. 고객 상세는 서버 데이터를 다시 읽는다. 포커스 복귀 시 재조회도 적용해 탭 알림을 놓쳐도 갱신된다. 임시저장에는 원본 갱신 이벤트를 보내지 않는다.
  - 현황 카드에는 확정된 서비스 기간을 표시한다. 문서는 최신 사용 가능 버전과 생성 중인 수정본을 구분하고 원본 이력은 별도로 남긴다. 실패 재시도와 수동 확인 상태를 표시한다.
  - 일반 제공인력 경로는 기존 인증·권한 규칙을 유지하며 최종 확정된 데이터만 조회한다. 공개 경로에서 draft/revision 관리 API를 호출해도 거부되어야 한다.

  **Tier:** standard · **Sandbox:** local · **Agent:** luna_implementer · **Model:** gpt-5.6-luna · **Effort:** max  
  **Paths:** `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/frontend/src/features/service-records/`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/frontend/src/components/app/clients/ClientServiceRecordsTab.tsx`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/frontend/src/app/(service-record-admin)/`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/backend/application/services/admin-service-record.service.ts`, `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/packages/shared/src/types/service-record.ts`  
  **Depends:** Task 5.1, Task 5.3, Task 5.4

## Phase 6 — 오류 상황을 포함한 통합 검증

정상 저장뿐 아니라 중복 요청·동시 수정·외부 실패에서도 원본과 수정본이 맞는지 확인한다.

각 task가 자신의 테스트를 포함하고 이 단계는 통합 회귀와 독립 검토를 담당한다.

| 주요 위험 | 가능성 / 영향 | 반드시 통과할 검증 |
|---|---|---|
| 다른 관리자·제공인력의 변경을 덮어씀 | 중 / 상 | 초안·확정 버전 충돌 시 409, 사용자 입력 보존, 최신 미리보기 요구 |
| case/일정 잠금 순서 교착 | 중 / 상 | 서로 반대 순서로 진입하는 제출·일정·확정 동시 실행, 제한된 재시도 |
| 여러 배정과 뒤 회차 일부 누락 | 상 / 상 | 제공인력 교체 이력, 잠긴 뒤 회차, 미래 미작성 회차, 기간 축소 모두 비교 |
| 외부 성공 후 응답 유실로 중복 문서 | 중 / 상 | 동일 revision/chunk 재조회로 복구, 중복 발행 없음 |
| 구버전 webhook이 현재 상태를 완료로 덮음 | 중 / 상 | 대상 문서 버전 밖 이벤트는 현재 revision 상태를 변경하지 않음 |
| 서명이 수정본 동의로 잘못 표시됨 | 중 / 상 | 원본 서명과 지점 수정 근거의 표시·저장·출력 구분 |
| 새 화면에서 항목·기존 기능 누락 | 중 / 중 | 원본 필드 정의와 1:1, 14개 및 하위 필드, 일반 경로 회귀·이미지 비교 |
| 확인 단계 임시 저장만 최신이고 PDF/이미지는 구버전 | 중 / 상 | 별도 다운로드와 기존 영수증 URL에서 실제 수정 값을 확인, 실패 시 최신 표시 금지 |
| 자동 완료·예약 메시지가 이전 종료일로 실행 | 중 / 상 | 실행 직전 버전 및 연동 상태 검사, 선점된 작업의 오래된 실행 차단 |
| 고정 제공 일수 유실 또는 수령일 변경 | 중 / 상 | N개 고유 영업일 불변식과 수령일/금액 전후 비교 |
| 신규 migration과 구배포 혼재 | 중 / 상 | 추가형 schema·기존 버전 읽기, 구버전 writer가 새 revision을 오염시키지 못함 |

- **Task 6.1: 전체 통합 검증** (test, high)
  - 격리 로컬 DB·가짜 전자문서 제공자로 경쟁 조건과 장애를 재현한다. 실 고객 데이터나 실제 문자 발송으로 테스트하지 않는다.
  - 저장소의 `pnpm test`, `pnpm lint`, `pnpm -r --if-present run type-check`, `pnpm build`, `pnpm lint:ui-architecture`를 실행한다. 기존 실패가 있으면 변경 영향과 분리해 기록하고 완료로 감추지 않는다.
  - 모델이 볼 수 있는 코드 검토와 실제 브라우저 검증을 각각 수행한다. 부분 청크 실패 시 수정본을 성공 표시하지 않는지까지 확인한다.

  **Tier:** standard · **Sandbox:** local · **Agent:** luna_implementer · **Model:** gpt-5.6-luna · **Effort:** max  
  **Paths:** `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/docs/plans/admin-service-record-editor/verification.md`, 전체 변경 파일은 검사 대상으로 읽기  
  **Depends:** Task 5.2

- **Task 6.2: 독립 최종 검토** (test, high)
  - 구현자가 아닌 검토자가 권한·초안 분리·경합·문서 버전·롤백 근거를 읽기 전용으로 검토한다. 수정 요구가 나오면 해당 구현 task로 돌려보내고 필요한 검증을 다시 실행한다.

  **Tier:** standard · **Sandbox:** local · **Agent:** default (읽기 전용 감사) · **Model:** gpt-6-astra · **Effort:** medium
  **Paths:** `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/`의 task diff와 검증 결과 읽기 전용  
  **Depends:** Task 6.1

## Phase 7 — 점진적 반영과 되돌리기

원본 문서와 수정 이력을 보존한 채 기능을 켜고 끌 수 있게 배포한다.

- **Task 7.1: 검증된 변경을 환경별로 반영** (infra, high)
  - 각 standard task는 승인된 계획의 전용 unit worktree에서 순차 실행하고 integration worktree로 합친 뒤 정리한다. 현재는 강하게 연결된 변경이므로 구현 병렬 배치를 두지 않는다. package·tsconfig·schema 변경은 이 계획의 명시된 범위로 검토받는다.
  - 코드 검증 후 commit/push, 사용자 승인 후 `dev` 병합. `preview`에서 migration·실제 인증·격리된 전자문서 생성과 복구를 확인한 동일 변경만 별도 승인 후 production으로 반영한다. 원격 문서가 알림을 발송하는 경로라면 발송 대상을 명시하고 승인 없이 시험 발송하지 않는다.
  - 문제 발생 시 신규 관리자 편집·확정 진입을 차단한다. 기존 문서·확정 이력·초안은 보존하고 생성 중 작업은 동일 revision으로 재개한다. 이미 확정된 데이터를 구코드 배포로 되돌렸다고 주장하지 않는다. 새 버전 문서가 생긴 후에는 revision을 모르는 구 writer를 다시 켜지 않는다.

  **Tier:** heavy · **Sandbox:** network · **Agent:** luna_network_implementer · **Model:** gpt-5.6-luna · **Effort:** max  
  **Paths:** `/Users/jaino/Development/babyjamjam-admin/admin-service-record-editor/docs/plans/admin-service-record-editor/verification.md`, 승인된 migration·배포 설정과 원격 task branch  
  **Depends:** Task 6.2, 각 환경 병합·승격의 사용자 승인

관찰할 지표: 초안 저장 충돌, 확정 409/실패, 잠금 대기·교착, 확정 대비 수정본 미완료 건수, 청크 재시도·수동 검토, 중복 문서 탐지, 문서 생성 대기 시간. 개인정보·서명·토큰 대신 case/revision/chunk 식별자와 실제 서버 시각만 진단 로그에 기록한다.

완료 기준: 관리자 새 탭·전체 항목·3단계 직행, 원본과 초안 분리, 확인한 DB 변경만 원자적으로 확정, 고정 제공 일수와 수령일 보존, 뒤 회차/배정/현황/예약 작업 연동, 계약·영수증 두 기간과 실제 이미지 갱신, 재생성 실패 복구와 이전 문서 보존, 일반 경로 회귀, 권한 경계와 모든 검증 결과가 확인되어야 구현 완료다. 초안의 정상 동작만으로 이 기준을 충족했다고 보지 않는다.

이전 독립 계획 검토: Sol 검토는 CONCERNS였다. 지적된 UI 패키지 계약, 잠금 순서 선행 task, 미래 예정일 저장, 배정 귀속별 날짜 계산, legacy 버전 행렬, 통합 검증/읽기 전용 검토 분리, unit 경로 치환을 이 초안에 반영했다. 반영 후 재승인된 계획이라고 주장하지 않는다. 사용자 정책 세 가지는 이번 계획에 확정 반영했다. 2026-09-07 재검토에서 미래 회차 귀속·제공인력 신규 저장·외부 서명 진행 단계의 세 지적을 추가 반영했으며, Sol(gpt-5.6-sol/high)의 최종 판정은 APPROVE, blocking concerns 없음이다. Phase 0 실제 자동 저장/출력 검증은 여전히 실행 선행 조건이다.

소유 경로 재확인(2026-09-07): `receipt-link-issue.service.ts`가 영수증 이미지와 토큰 발급, `receipt-link-delivery-enricher.service.ts`가 receiptUrl 주입, `receipt-link.controller.ts`가 공개 조회/검증/이미지를 담당한다. 계약 자동 완료는 `contract-auto-finalize-scheduler.service.ts`와 `contract-auto-finalize.policy.ts`, 실제 작업 실행은 `eformsign-document-job-worker.service.ts`다. 제공기록지 최종화 스케줄러와 계약 자동 완료 스케줄러는 별개이므로 둘 다 최신 수정 버전을 검사해야 한다.

실행 시작: 사용자 Luna max 작업자 실행 승인. 기존 브랜치를 e72140413으로 fast-forward하여 검토 중 PDF 조회와 duration 확인 수정을 포함했다. 정책은 그대로 유지하며 최신 코드 재사용을 우선한다.

Phase 0 현재 판정: 기존 임시 저장의 오래된 PDF 결과와 새 격리 문서27e3c3287859433dbd8a680525c5338d의 후속 결과를 구분한다. UI 반복 수정 검증에 이어 공식 API 단일 반려 및 SDK의 네 날짜 항목 수정·전송을 실행했다. 같은 문서가 Jan06로 갱신되어 검토 단계에 유지되며, 최초 서명·수령일·금액 및 기한0 보존을 독립 API/PDF로 확인했다. 기존 영수증 이미지 생성기의 로컬 출력도 확인했다. 최초 SDK 라이브 명령은 금액 표기 검사 오류와 즉시 PDF 확보 실패로 RED였고, 이후 독립 검증으로 실제 처리 결과를 확인했다. 수정된 변경 명령은 재실행하지 않았다. Astra/medium은 한계를 명시한 코드·증거 통합을 승인했다. 서구 양식, 기존 공개 영수증 링크의 이미지 갱신, 완료 후 새 문서 생성, 응답 유실·부분 실패 복구 등 Task 0.1 전체 게이트가 검증되기 전 Phase 1 이후를 시작하지 않는다. 상세 증거는 실행 기록을 참조한다.
