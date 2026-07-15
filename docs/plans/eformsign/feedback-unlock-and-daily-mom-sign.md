---
plan_id: efsi-2026-007
feature: feedback-unlock-and-daily-mom-sign
status: approved
swagger_base: https://api.eformsign.com/v2.0
agent_version: v0.4.0
created_at: 2026-07-15T13:40:00+09:00
approved_at: 2026-07-15T14:11:30+09:00
content_hash: 9c8c92146f599f40807b11f2f0bddc2a90d4980e323012a7aa7f194864fb0159
depends_on: []
surfaces_touched: [usecases, schema, dto]
---

## Summary

TL;DR: 제공기록지에서 제출된 과거 회차도 (문서 생성 전까지) 수정할 수 있게 열고, 산모 확인을 토글에서 위저드 내 서명패드 실서명으로 바꾼다. 서명은 최초 1회만 받아 불변으로 저장하고, 서비스 종료 시 eformsign 종합 문서의 `산모확인서명 N` 칸(서명 타입으로 이미 교체됨)에 dataURI PNG로 주입한다 — 2026-07-15 라이브 실측으로 dataURI 주입·렌더링 검증 완료. UI 사양은 승인된 인터랙티브 목업(artifact 416b1ac6) 그대로.

## Requirements

### Goals
- 제출(잠금)된 회차를 제공기록표에서 눌러 열고 섹션별 "수정" 버튼으로 원래 입력 폼에서 고칠 수 있다 — 케이스가 FINALIZING/DOCUMENTS_CREATED/COMPLETED/FINALIZATION_FAILED에 도달하기 전까지만.
- 산모 확인 단계(4/4)에 캔버스 서명패드: 신규 제출은 서명해야 "확인" 활성. 서명 PNG dataURI + 서명 시각을 DB에 저장.
- 서명 불변: 한번 저장된 서명은 수정·삭제 불가. 과거 회차를 다시 열면 서명이 그려진 채 잠긴 패드로 표시되고, 재서명 없이 수정 제출 가능.
- finalize 시 종합 문서의 `산모확인서명 1~5`에 각 회차 서명 이미지를 dataURI로 prefill (빈 슬롯은 빈 문자열).

### Non-Goals
- eformsign embedded client / 참가자 서명 이벤트 (서명 증적은 자체 DB 타임스탬프).
- 회차별 개별 eformsign 문서 생성 (C안 폐기 — 종합 문서 파이프라인 유지).
- 문서 생성 이후의 기록 수정 (기존 게이트 유지: `service-feedback.service.ts:174-181`).
- 서명/손글씨 테스트 필드 정리 (템플릿에서 이미 제거됨, 실측 확인).

## Technical Design

### eformsign Layer Touchpoints
- **Usecases**: `application/usecases/eformsign-doc/service-record-field-mapper.ts:176` — `pushCheck(ids.momApproval, …)` 를 `pushRequired(ids.momApproval, day.momSignature ?? "")`로 교체 (dataURI 그대로 전송). 미사용 슬롯 분기 `:127-134`의 momApproval도 `pushRequired(…, "")`로 변경. `service-record-field-ids.ts:105`의 momApproval id("산모확인서명 N")는 불변, 주석만 binary 타입으로 갱신. 결제 확인(`pushCheck`)은 체크박스 그대로.
- **Service/Controller**: `application/services/service-feedback.service.ts` upsertSession/getContext 변경(아래), `interface/controllers/service-feedback.controller.ts:72-89` 시그니처 불변.
- **EformsignApiClient**: 변경 없음 (createDocument fields 배열이 dataURI 값을 그대로 운반 — 실측 검증 2026-07-15: dataURI는 렌더링, raw base64/텍스트는 저장만 되고 미렌더).
- **DTO**: `interface/dto/service-feedback.dto.ts:23-35` UpsertSessionDto에 `momSignature?: string` 추가 (`data:image/png;base64,` 접두사 + 길이 상한 262,144자 검증).
- **Prisma**: `service_record_day`(schema.prisma:680-710)에 `momSignature String? @map("mom_signature")`, `momSignedAt DateTime? @map("mom_signed_at") @db.Timestamptz(6)` 추가.
- **Env**: 추가 없음.
- **Webhook**: 영향 없음 (document 완료 흐름 불변).
- **Module**: 변경 없음.

### Design Details

### 확정 정책 (Codex 리뷰 반영)
- 당일 게이트는 신규 회차에만 적용. 수정 모드(잠긴 회차 재진입)는 날짜 게이트 우회하되 serviceDate 변경 불가(서버도 거부) — 날짜 변경은 일정 변경 요청 플로우 전용.
- 레거시 무서명 회차는 명시적 grandfathering(빈 칸 렌더 — 실측 안전). 배포 후 모든 제출은 서명 필수. lifecycle readiness 불변.
- 서명 불변성은 mom_signature IS NULL 조건부 UPDATE(트랜잭션 내)로 원자 강제. 케이스 상태 재확인과 세션 upsert를 단일 트랜잭션으로 묶어 finalizer FINALIZING claim과 직렬화.


**잠금 해제 규칙** — `service-feedback.service.ts:206-208`의 "locked면 거부"를 제거하고, 게이트를 케이스 상태(:174-181, 기존 그대로)로 일원화. locked 세션에 대한 PUT(저장)과 POST submit(수정 제출) 모두 허용. `recompute()`(service-record-lifecycle.service.ts:289-341)는 무변경 — momApproval="approved" 조건 그대로.

**서명 불변성(서버 강제)** — upsertSession에서: 기존 `day.momSignature`가 있으면 요청의 momSignature는 **무시**(기존 값 유지, momSignedAt 불변). 없고 lock=true면 momSignature **필수**(400) + `momSignedAt=now()`. lock=false(중간 저장)에서는 서명 저장 안 함. 레거시 잠금 세션(서명 없음)을 수정 제출할 때도 서명 요구 — 전환기 1회 서명 확보.

**Context 확장** — `getContext()`(service-feedback.service.ts:68-116)의 세션 row는 `...day` 스프레드(:104)라 momSignature/momSignedAt 자동 포함. 응답 크기(회차당 ~20-30KB, 15회차 ~450KB)는 모바일 1회 로드로 허용. recordStatus는 이미 반환 — 프런트 게이팅에 사용.

**모바일 위저드** (`mobile/src/app/(public)/feedback/[token]/page.tsx`, 승인 목업 사양):
- 제공기록표(:627-638): done 회차 클릭 가능(`disabled = !done && !open`), 상태 텍스트 "제출완료" 유지, 안내 문구 교체. recordStatus가 finalize 계열이면 전부 비활성.
- `openDay(d, editing)`(:372-377 개편): locked 회차 진입 허용, 해당 세션의 answers/etcService/notes/paymentConfirmed를 draft로 프리필.
- 확인 화면(:678-709): edit 모드 notice "이미 제출된 회차입니다.", 섹션 헤더 우측 "수정" 버튼 → 해당 섹션 폼(pageIdx 점프) → 저장 시 확인 화면 복귀.
- 서명패드: 캔버스(pointer events, dpr 스케일), 지우기, 서명 전 "확인" 비활성. 기존 서명 있으면 dataURI를 캔버스에 렌더 + 잠금(입력 차단, 지우기 숨김) + "서명 완료 · {momSignedAt}" 칩, "확인" 즉시 활성.
- `submitDay()`(:379-405): 신규 서명 시에만 `momSignature` 포함.
- API 프록시 라우트: body 패스스루라 변경 없음. 세션 저장용 PUT 프록시(`sessions/[index]/route.ts`)가 없으므로 신설하지 않고 기존 submit 라우트만 사용 (중간 저장은 현행처럼 sessionStorage draft).

**DB 패치** — repo 컨벤션(.github/workflows/database-patches.yml, `prisma/migrations/<ts>_<name>/migration.sql` 하드코딩 SQL)대로: `ALTER TABLE service_record_day ADD COLUMN IF NOT EXISTS mom_signature text; ADD COLUMN IF NOT EXISTS mom_signed_at timestamptz;` + 워크플로 스텝 추가. `prisma migrate deploy` 금지(운영 규칙).

## Task Breakdown

### Phase 1 — Backend
백엔드가 서명 저장·불변성·잠금 해제·문서 주입을 갖춘다.

#### Task 1.1: 스키마 + DB 패치
**Tier:** standard
**Sandbox:** local
**Paths:** `backend/prisma/schema.prisma`, `backend/prisma/migrations/20260715_add_mom_signature/migration.sql`, `.github/workflows/database-patches.yml`
**Depends:** none
- service_record_day에 mom_signature(text, null)·mom_signed_at(timestamptz, null) 추가, idempotent SQL 패치 + 워크플로 스텝. `prisma generate`로 클라이언트 재생성.

#### Task 1.2: 세션 잠금 해제 + 서명 불변성 + DTO
**Tier:** standard
**Sandbox:** local
**Paths:** `backend/application/services/service-feedback.service.ts`, `backend/interface/dto/service-feedback.dto.ts`, `backend/test/services/service-feedback.service.spec.ts`
**Depends:** Task 1.1
- upsertSession: locked 거부 제거, 케이스 상태 재확인+upsert 단일 트랜잭션, mom_signature IS NULL 조건부 쓰기(불변), 잠긴 적 없는 세션의 lock 제출엔 서명 필수(400), 수정 제출의 serviceDate 변경 거부, DTO 검증(접두사+base64 유효성+디코드 상한 192KB). 스펙: ①locked 수정 제출 허용 ②finalize 상태 409 ③무서명 첫 제출 400 ④서명 불변(동시 제출 race 2케이스) ⑤momSignedAt 1회 ⑥serviceDate 변경 거부.

#### Task 1.3: 스냅샷 파이프라인 + 필드 매퍼 서명 주입
**Tier:** standard
**Sandbox:** local
**Paths:** `backend/application/usecases/eformsign-doc/create-and-send-feedback-snapshot.usecase.ts`, `backend/application/usecases/eformsign-doc/service-record-field-mapper.ts`, `backend/application/usecases/eformsign-doc/service-record-field-ids.ts`, 매퍼·스냅샷 usecase 스펙
**Depends:** Task 1.1
- 스냅샷 usecase의 Prisma select·FeedbackDayInput 변환(두 입력 경로)·sourceHash에 momSignature 반영. momApproval 슬롯 값: 체크마크 → `day.momSignature ?? ""` (dataURI 원문). 미사용 슬롯 "". 스펙: DB row→매퍼 필드 dataURI 관통, 빈값, 결제확인 체크마크 불변, sourceHash 변화 단언.

### Phase 2 — Mobile
위저드가 목업 사양(제공기록표 진입·섹션 수정·서명패드·서명 잠금)을 구현한다.

#### Task 2.1: 위저드 개편 (서명패드 + 과거 회차 수정 흐름)
**Tier:** heavy
**Sandbox:** local
**Paths:** `mobile/src/app/(public)/feedback/[token]/page.tsx`, `mobile/src/components/app/feedback/SignaturePad.tsx`(신규), 관련 jest
**Depends:** Task 1.2
- 목업(artifact 416b1ac6, label section-edit-forms) 사양 그대로: done 회차 진입, draft 프리필, 섹션 수정 버튼→폼 점프→복귀, 서명패드(신규 필수/기존 잠금 표시), submitDay에 momSignature, recordStatus 게이팅, 문구 3종 교체. SignaturePad는 재사용 가능한 컴포넌트로 분리.

### Phase 3 — 검증
**In parallel:**
- **백엔드 검증** (test, low) — build + 신규/갱신 스펙.
- **모바일 검증** (test, low) — type-check + jest + 로컬 E2E 수동 시나리오(신규 제출→서명→재진입 잠금 확인→수정 제출).

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| 템플릿 서명 타입 전환~배포 사이에 finalize 실행 시 산모확인 표시 없는 문서 생성 (현 매퍼가 binary 필드에 "체크1" 전송 → 저장만 되고 미렌더) | M | M | 빠른 배포; 창구 기간 동안 finalize 대상 케이스 확인 후 필요 시 문서 재생성 |
| dataURI 대용량으로 createDocument 요청 비대 (회차당 ~30KB×5) | L | L | DTO 길이 상한(256KB/서명) + 캔버스 150px 높이 고정 |
| 레거시 잠금 세션(서명 없음)이 finalize에 걸리면 해당 슬롯 빈 서명 | M | L | 빈 문자열 전송은 실측상 안전(빈 칸 렌더); 운영상 수정 제출 시 서명 확보 |
| context 응답 비대(15회차 서명 포함 ~450KB) | L | L | 모바일 1회 로드, 필요 시 후속으로 서명 lazy 엔드포인트 분리 |
| 과거 회차 동시 수정(제공인력 앱 2기기) 경합 | L | M | 기존 upsert가 row 단위 upsert — 마지막 쓰기 승리, 서명은 서버 불변 규칙으로 보호 |

## Testing Strategy
- Unit: service-feedback.service.spec.ts (잠금 해제·서명 규칙 5케이스), service-record-field-mapper.spec.ts (dataURI/빈값/체크마크 회귀).
- Integration: 기존 서비스 레벨 스펙 스위트 회귀 (147 스위트).
- Manual E2E (로컬 스택): 링크 → 3회차 신규 제출(서명) → 재진입(서명 잠금 확인) → 신생아 섹션 수정 → 수정 제출 → 스케줄러 finalize → 생성 문서 PDF에서 산모확인서명 1~3 렌더 확인.

## Verification
Post-implementation checks per §24 Q4:

**Backend build:** `pnpm --dir /Users/jaino/Development/babyjamjam-admin/feedback-refactor/backend run build`

**Spec test:** `pnpm --dir /Users/jaino/Development/babyjamjam-admin/feedback-refactor/backend exec jest test/services/service-feedback.service.spec.ts test/usecases/eformsign-doc/service-record-field-mapper.spec.ts --runInBand`

**Rollout:** ①자동 finalize 일시 정지(READY_TO_FINALIZE 0건 확인 또는 크론 hold) ②DB 패치 적용·검증 ③backend+mobile 동시 배포(모바일 프로덕션 promote 완료까지 finalize 재개 금지) ④실서비스 1건 PDF 서명 렌더 검증 ⑤창구 기간 gap 문서 식별·재생성 ⑥finalize 재개.

**Rollback:** 코드 롤백만으로 안전 (컬럼은 nullable 추가라 잔존 무해). 매퍼 롤백 시 산모확인서명 칸은 미렌더 상태로 복귀(문서 생성은 계속 성공 — 실측 근거).
