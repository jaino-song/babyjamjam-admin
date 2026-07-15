# 서비스 일정 변경 (Request → Approval Postpone) — Design

- Date: 2026-07-02 (v3 — 구현 완료 반영; v2에서 요청-승인 워크플로로 개정)
- Related: `daily-service-feedback-doc.md` (BJJ-247), Linear BJJ-248, mockup `daily-service-feedback-doc/docs/mockups/daily-service-feedback/ui-fix.html`
- Status: Implemented (branch `service-schedule-postpone`)

> **v3 구현 확정 사항 (스펙 본문과 다르거나 확정된 부분):**
> 1. **승인 시 대상 회차 row가 없으면 `toDate`로 미잠금 draft row를 생성**한다 (§5.5-③의 "row 없는 회차는 모바일 기본 체인이 이어짐" 문구를 대체). row를 만들지 않으면 미룬 날짜가 유실되고 모바일 기본 체인이 fromDate에서 다시 시작하기 때문. `answers`는 `@default("{}")`라 추가 필드 없이 생성 가능.
> 2. **모바일 접근 토큰 만료는 발급 시점 고정으로 확인됨** (§6-2의 검증 항목 해소) — `expiresAt = 종료일 + grace(기본 14일)`이 DB에 저장되므로, 승인 트랜잭션이 활성 토큰의 `expiresAt`을 `newEndDate + grace`로 함께 연장한다 (`EmployeeFeedbackTokenService.extendExpiryForSchedule`).
> 3. **모바일 `defaultDate`는 row-우선**: 해당 회차 row가 있으면(잠금 여부 무관) 그 날짜를 사용하고, 없을 때만 직전 회차의 다음 영업일 체인으로 계산한다.
> 4. stale 마킹은 롤백된 트랜잭션 **밖에서** 수행 (트랜잭션 안에서 마킹하면 롤백으로 유실).
> 5. 알림톡은 `syncEmployeeAssignmentRulesForSchedule`를 승인 커밋 후 fire-and-forget으로 재동기화.

## 1. Goal

현장 제공인력이 모바일 위저드에서 **서비스 일정 변경을 요청**하면(예: 아기 병원 방문으로 오늘 회차 진행 불가), 데스크톱 관리자가 **승인/거부**로 결정한다. 승인 시 대상 회차가 **다음 영업일**로 이동하고, 이후 미제출 회차 전체가 연속 영업일로 재배치되며, 서비스 종료일(`client.endDate`, `employee_schedule.endDate`)이 그만큼 연장된다.

예: 3회차 7/3(금) → 요청 → 관리자 승인 → 3회차 7/6(월) (7/4 토·7/5 일 스킵), 4회차 이후 연쇄 이동, 종료일 +1영업일.

> **가정 (검토 시 확인 요망):** 요청 생성 주체는 모바일 위저드의 현장 인력이다 (목업의 "서비스 일정 변경" 버튼). 관리자가 직접 요청 없이 즉시 변경하는 기능은 이번 범위 밖 (§9).

## 2. Confirmed Decisions

| 항목 | 결정 |
|---|---|
| 워크플로 | 현장 인력 요청(모바일) → 관리자 승인/거부(데스크톱). 승인이 곧 실행 |
| 변경 방식 | "다음 영업일로 하루 미루기" 단일 액션 (임의 날짜 지정 없음) |
| 대상 회차 | 항상 첫 번째 미제출(locked=false 또는 row 없음) 회차 |
| 이후 회차 | 미제출 회차 전부 연속 영업일로 재배치, 제출완료(locked) 회차 불변 |
| 종료일 연장 | 상한 없음 |
| 영업일 정의 | 월–금, 한국 공휴일 제외 (기존 하드코딩 2026–27 세트 재사용), Asia/Seoul 날짜 기준 |
| 감사 이력 | `schedule_change_request` 테이블이 요청+결정 이력을 겸함 (별도 로그 테이블 없음) |
| 대시보드 | 대기 중 요청이 있는 고객의 status badge를 **"일정 변경"**, **burgundy**(`v3-burgundy`)로 표시 |
| 고객 상세 | **맨 왼쪽**에 조건부 탭 **"일정 변경"** — 대기 중 요청이 있을 때만 노출. 내용: title "서비스 일정 변경 요청이 있습니다." + subtitle "기존 날짜: {M월 D일} → 변경 날짜: {M월 D일}" + 버튼 **거부 / 승인** |
| 모바일 기본 날짜 체인 | 이번에 함께 영업일 체인으로 수정 (현재 전날+1 naive) |

## 3. Non-Goals

- 임의 날짜 지정, backdating, 회차 취소/축소.
- 관리자 직접(요청 없는) 즉시 변경 — 향후 과제.
- 회차 row 전체 사전 생성 리모델링, eformsign 흐름 변경, 공휴일 외부 API.

## 4. Workflow

```
[모바일 · 현장 인력]                       [백엔드]                          [데스크톱 · 관리자]
overview "서비스 일정 변경" 클릭
  → GET schedule-change/preview  ──────  다음 영업일 계산
  → 확인 모달 (7/3 → 7/6)
  → 확인 → POST schedule-change  ──────  pending 요청 생성 ──────→  대시보드 badge "일정 변경"(burgundy)
                                                                   고객 상세 맨 왼쪽 "일정 변경" 탭
                                                                     ├─ 승인 → 트랜잭션 실행(회차 이동+종료일 연장)
                                                                     └─ 거부 → 요청 rejected 처리
overview에 "요청 대기 중" 표시 ←────────  context에 pendingRequest 포함
```

## 5. Architecture

날짜 계산의 단일 진실 공급원은 **백엔드**. 모바일/프론트는 서버가 준 값을 표시만 한다.

### 5.1 Backend — business-day util (신규)

`backend/domain/utils/business-days.ts` — `/dev/mobile/src/lib/date/business-days.ts`에서 이식:

- `isBusinessDayKr(iso: string): boolean`
- `nextBusinessDayKr(iso: string): string` — iso **이후** 첫 영업일 (신규)
- `addBusinessDaysKr(iso: string, n: number): string` — n=0이면 iso (신규)

공휴일 세트는 모바일과 동일(2026–27 하드코딩). 범위 밖 연도는 주말만 스킵(현행 한계 유지, 연례 갱신 관행 문서화).

### 5.2 Backend — data model (신규)

```prisma
model schedule_change_request {
  id           String    @id @default(uuid())
  scheduleId   Int       @map("schedule_id")
  clientId     Int       @map("client_id")
  sessionIndex Int       @map("session_index")
  fromDate     DateTime  @map("from_date") @db.Date   // 요청 시점의 예정일
  toDate       DateTime  @map("to_date") @db.Date     // 계산된 다음 영업일
  oldEndDate   DateTime  @map("old_end_date") @db.Date
  newEndDate   DateTime  @map("new_end_date") @db.Date
  status       String    @default("pending")          // pending | approved | rejected | stale
  reason       String?
  decidedBy    String?   @map("decided_by")           // admin actor id
  requestedAt  DateTime  @default(now()) @map("requested_at")
  decidedAt    DateTime? @map("decided_at")
  branchId     String    @map("branch_id") @db.Uuid
}
```

- 마이그레이션 1건. **schedule당 pending 1건 제한** (부분 유니크 인덱스 `(schedule_id) WHERE status = 'pending'` 또는 서비스 레이어 검증).
- 이 테이블이 감사 이력을 겸한다 (요청·결정·전후 날짜·주체·시각 모두 보존).

### 5.3 Backend — 계산 규칙 (요청 생성/승인 공통)

- 대상 회차: `service_record_day`의 locked=true 최대 sessionIndex + 1. 전 회차 제출완료면 409 (`ALL_SESSIONS_SUBMITTED`).
- `fromDate`: 대상 회차 row가 있으면 그 `serviceDate`; 없으면 직전 locked 회차 `serviceDate`의 `nextBusinessDayKr`; 그것도 없으면 `employee_schedule.startDate` (시작일이 비영업일이면 `nextBusinessDayKr(startDate − 1일)`).
- `toDate = nextBusinessDayKr(fromDate)` — 예정일이 과거여도 동일 규칙(요청-승인 1사이클당 1영업일).
- `newEndDate = addBusinessDaysKr(toDate, N − sessionIndex)`, `N = client.duration`.

### 5.4 Backend — staff endpoints (feedback-token guard, service-feedback controller 확장)

- `GET /service-feedback/schedule-change/preview` → `{ sessionIndex, fromDate, toDate }` (모바일 확인 모달 문구용)
- `POST /service-feedback/schedule-change` → §5.3으로 계산해 pending 요청 생성. 이미 pending 존재 시 409 (`REQUEST_ALREADY_PENDING`).
- `GET /service-feedback/context` 응답에 `pendingScheduleChange` 포함 (위저드가 대기 상태 표시).

### 5.5 Backend — admin endpoints (admin guard)

- 고객 상세/목록 조회 응답에 pending 요청 존재 여부(+상세) 포함 — badge와 탭 노출 판단용. (별도 GET가 필요하면 `GET /api/schedule-change-requests?clientId=` 추가.)
- `POST /api/schedule-change-requests/:id/approve` — 단일 Prisma 트랜잭션:
  1. 요청이 pending인지 확인 (아니면 409).
  2. §5.3 로직으로 **현재 상태 기준 재계산** 후 요청의 `fromDate`/`sessionIndex`와 대조. 불일치(그 사이 회차 제출 등)면 요청을 `stale`로 마킹하고 409 (`REQUEST_STALE`) — 관리자에게 재요청 필요 안내.
  3. 대상 회차 row가 있으면 `serviceDate = toDate`; 이후 미제출 row들 `addBusinessDaysKr(toDate, k − sessionIndex)`로 재배치 (row 없는 회차는 모바일 기본 체인이 새 날짜에서 이어짐).
  4. `employee_schedule.endDate = client.endDate = newEndDate`.
  5. 요청 `approved` + `decidedBy`/`decidedAt` 기록.
- `POST /api/schedule-change-requests/:id/reject` — pending 검증 후 `rejected` 마킹만. 일정 불변.

### 5.6 Mobile (/dev/mobile)

1. **요청 버튼**: 위저드 overview에 "서비스 일정 변경" 버튼(목업 그대로) → preview GET → 확인 모달(title "서비스 일정을 조정할까요?", subtitle에 fromDate→toDate와 비영업일 사유 문구) → POST. pending이면 버튼 대신 "일정 변경 요청 대기 중" 표시.
2. **기본 날짜 체인 수정**: `defaultDate`의 `addDays(prev, 1)` → 기존 모바일 유틸 기반 next-business-day 체인으로 교체. 백엔드 forward-only 검증과 충돌 없음.

### 5.7 Frontend — desktop admin (/dev/frontend)

1. **대시보드 badge**: pending 요청이 있는 고객은 status badge를 **"일정 변경"**으로, `v3-burgundy` 토큰 색상으로 표시 (결정 후 원래 상태 badge로 복귀).
2. **고객 상세 탭**: 탭 목록 **맨 왼쪽**에 "일정 변경" 탭 — pending 요청이 있을 때만 렌더. 내용:
   - Title: **서비스 일정 변경 요청이 있습니다.**
   - Subtitle: `기존 날짜: {M}월 {D}일 → 변경 날짜: {M}월 {D}일` (요청의 fromDate/toDate)
   - Buttons: **거부**(outline/neutral) / **승인**(primary) — approve/reject 엔드포인트 호출, 성공 시 탭 제거 + badge 복귀 + 고객 쿼리 invalidate + 토스트. `REQUEST_STALE` 409는 "요청이 최신 상태와 달라 만료되었습니다" 안내.

## 6. Integration Touchpoints (구현 시 검증 필수)

1. **serviceStatus**: 날짜 유도 상태이므로 endDate 연장 시 `completed → active` 복귀는 의도된 동작. 확인만.
2. **모바일 접근 토큰**: 링크/액세스 토큰 유효성이 "종료일 + grace buffer"를 **현재 endDate 기준으로** 판정하는지 확인. 발급 시점 고정이면 DOB 재인증 재발급 흐름 검증 (BJJ-247 "skip-tail exceeds grace buffer" 리스크 해소 지점).
3. **알림톡 규칙 동기화**: schedule 생성 시 sync 존재 — endDate 변경 시 재동기화 필요 여부 확인, 필요하면 approve 트랜잭션 후속 훅.

## 7. Edge Cases

| 케이스 | 동작 |
|---|---|
| pending 중복 요청 | 409, 모바일은 대기 중 표시 |
| 승인 시점에 상태 드리프트(그 사이 회차 제출/날짜 변경) | 재계산 대조 실패 → `stale` 마킹 + 409, 현장 재요청 |
| 전 회차 제출완료 | preview/요청 생성 409, 모바일 버튼 숨김/비활성 |
| 반복 미루기 | 요청→승인 1사이클당 1영업일; 추가로 미루려면 재요청 |
| 거부 후 재요청 | 허용 (pending 아님) |
| replaced=true 배정 | 대상 아님 (활성 배정만) |
| 공휴일 세트 범위 밖 연도 | 주말만 스킵 (현행 한계, 연례 갱신) |
| 시작 전 계약(waiting) | 동일 규칙, 1회차가 대상 |

## 8. Testing

- **Unit**: business-day util (주말·연휴·연말 경계·n=0), §5.3 계산 규칙 (locked prefix/draft row 유무 조합).
- **Service**: 요청 생성(중복 409), 승인 트랜잭션(날짜 이동+종료일+상태 전이, 롤백), stale 검증, 거부.
- **Mobile**: defaultDate 체인이 금요일 다음을 월요일로 내놓는지, pending 상태 표시.
- **E2E (수동)**: 모바일 요청 → 대시보드 badge → 탭 승인 → 고객 종료일 변경 + 모바일 재접속 시 새 날짜 반영. 거부 경로도 확인.

## 9. Rollout Order & Future Work

1. Backend: util + 테이블 + staff/admin 엔드포인트 (UI 없인 무해).
2. Mobile: 요청 버튼 + 기본 체인 수정.
3. Frontend: badge + 조건부 탭.

Future: 관리자 직접(요청 없는) 즉시 변경, 임의 날짜 지정, 변경 이력 조회 UI, 회차 사전 생성 모델, 공휴일 API 연동.
