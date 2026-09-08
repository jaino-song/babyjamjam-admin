TL;DR: 계약서·영수증·기록지와 화면 작업을 같은 단계에서 병렬로 만들고, 합친 결과를 한 번 검토한다.

## Phase 5 — 문서 연동 병렬 실행 계약

이 문서는 승인된 계획의 실행 순서와 파일 소유만 구체화한다. Phase4 독립 감사 통과 전에는 이 단계의 구현을 시작하지 않는다. Phase0 외부 활성화는 미검증이며 아래 로컬 구현의 성공으로 대체하지 않는다.

먼저 공용 타입·저장소 메서드·스키마를 한 소유자가 고정한 체크포인트를 배포한다. 다른 작업자는 그동안 자신만의 서비스 내부와 테스트 가짜 구현을 만들 수 있다. 공유 파일은 직접 고치지 않고 소유자에게 정확한 추가 메서드를 요청한다. 체크포인트 병합은 부모가 수행한다. 각 작업은 필요한 단위 검사를 포함하며 독립 감사는 통합 후 Phase5 전체에 한 번 수행한다.

**In parallel:**

- **문서 버전과 공용 저장 경계** (feature, high)
  - 기존 job/chunk 저장 방식을 확장하고, 확정 사본만으로 기록지를 생성한다. 청크의 revision/version과 모든 청크 완료 후 현재 참조 승격을 한 저장 경계에서 관리한다.
  - 공용 스키마·타입·상태 조회/재시도 저장소와 webhook/poller의 오래된 이벤트 차단을 소유한다. 계약·영수증 소유자가 요청한 필드를 공용 체크포인트에 포함한다.
  - **Tier:** standard · **Sandbox:** local · **Agent:** luna_implementer · **Model:** gpt-5.6-luna · **Effort:** max · **Depends:** Phase4 SHIP
  - **Paths:** `backend/prisma/schema.prisma`, `backend/prisma/migrations/<phase5-new>/**`, `packages/shared/src/types/service-record.ts`, `backend/vendor/shared-agent/**` (generated only), `backend/domain/repositories/service-record-edit.repository.interface.ts`, `backend/infrastructure/database/repositories/service-record-edit.repository.ts`, `backend/application/services/service-record-finalization.service.ts`, `backend/application/services/service-record-finalization-scheduler.service.ts`, `backend/application/usecases/eformsign-doc/create-and-send-service-record-snapshot.usecase.ts`, `backend/application/services/service-record-lifecycle.service.ts`, `backend/domain/entities/eformsign-document-job.entity.ts`, `backend/domain/repositories/eformsign-document-job.repository.interface.ts`, `backend/application/services/eformsign-document-job.service.ts`, `backend/application/services/eformsign-document-job-worker.service.ts`, `backend/application/services/eformsign-document-job-reconciliation.service.ts`, `backend/application/usecases/eformsign-doc/reconcile-completed-mirrored-eformsign-doc.usecase.ts`, `backend/infrastructure/database/repositories/sb.eformsign-document-job.repository.ts`, `backend/application/services/eformsign-webhook.service.ts`, `backend/application/services/eformsign-document-mirror.service.ts`, `backend/domain/repositories/eformsign-doc.repository.interface.ts`, `backend/infrastructure/database/repositories/sb.eformsign-doc.repository.ts`, `backend/domain/repositories/eformsign-document-mirror.repository.interface.ts`, `backend/infrastructure/database/repositories/sb.eformsign-document-mirror.repository.ts`, `backend/module/eformsign-doc.module.ts`, corresponding focused tests.

- **계약 기간 변경과 재개 처리** (feature, high)
  - 완료 전 같은 문서 수정과 완료 후 새 문서·새 서명을 구분한다. 고정 원본 수령일·금액과 수정 서비스 기간을 사용하고 응답 유실은 조회 후 판단한다.
  - 외부 단계마다 저장 가능한 상태를 기존 job으로 기록하며 capability 미검증은 외부 호출 없이 보존한다. 공용 worker 등록·저장소 변경은 문서 버전 소유자가 통합한다.
  - **Tier:** standard · **Sandbox:** local · **Agent:** luna_implementer · **Model:** gpt-5.6-luna · **Effort:** max · **Depends:** Phase4 SHIP; 공용 체크포인트 후 연결
  - **Paths:** `backend/application/services/eformsign.service.ts`, `backend/application/dto/contract.dto.ts`, `backend/application/usecases/eformsign-doc/` (excluding record snapshot and reconcile-completed-mirrored usecases), `backend/infrastructure/automation/eformsign-headless.service.ts`, `backend/infrastructure/automation/eformsign-finalize-gates.ts`, `backend/domain/entities/eformsign-dispatch-intent.entity.ts`, `backend/domain/repositories/eformsign-dispatch-intent.repository.interface.ts`, `backend/application/services/eformsign-dispatch-boundary.service.ts`, `backend/infrastructure/database/repositories/sb.eformsign-dispatch-intent.repository.ts`, new narrowly named contract revision service/policy and corresponding tests. No shared schema/job/mirror edits.

- **영수증 이미지 검증과 기존 링크 유지** (feature, high)
  - 새로 내려받은 공식 PDF 출력의 기대 기간·수령일·금액을 검증한 증거와 현재 revision/document/generation을 다시 비교하고 이미지 참조만 교체한다.
  - 기존 토큰·접근·만료와 이전 이미지를 보존한다. 알려진 receipt helper 타입 오류 5개도 현재 계약에 맞게 수정한다.
  - **Tier:** standard · **Sandbox:** local · **Agent:** luna_implementer · **Model:** gpt-5.6-luna · **Effort:** max · **Depends:** Phase4 SHIP; 공용 체크포인트 후 연결
  - **Paths:** `backend/application/services/receipt-link-issue.service.ts`, `backend/application/services/receipt-link-delivery-enricher.service.ts`, `backend/application/services/receipt-link-manual-send.service.ts`, `backend/application/services/receipt-link-token.service.ts`, `backend/interface/controllers/receipt-link.controller.ts`, `backend/domain/repositories/receipt-link-token.repository.interface.ts`, `backend/infrastructure/database/repositories/sb.receipt-link-token.repository.ts`, `backend/infrastructure/pdf/pdf-page-rasterizer.service.ts`, `backend/module/receipt-link.module.ts`, `backend/test/e2e/helpers/receipt-link-refresh.live.helper.ts`, `backend/test/e2e/receipt-link-refresh.live.e2e.spec.ts`, corresponding focused offline tests. No shared schema/mirror/edit repository edits.

- **상태·이력·원래 고객 탭 갱신** (feature, med)
  - 같은 출처 알림에는 case ID/version만 보내고 서버를 다시 읽는다. 포커스 복귀도 재조회하며 초안 저장은 확정 이벤트를 보내지 않는다.
  - 문서 생성 대기·실패·확인 필요·완료와 이전 사용 가능 문서를 구분한다. 재시도는 같은 고정 버전을 대상으로 하며 지점 권한을 서버에서 검증한다.
  - **Tier:** standard · **Sandbox:** local · **Agent:** luna_implementer · **Model:** gpt-5.6-luna · **Effort:** max · **Depends:** Phase4 SHIP; 공용 체크포인트 후 연결
  - **Paths:** `frontend/src/features/service-records/`, `frontend/src/components/app/clients/ClientServiceRecordsTab.tsx`, `frontend/src/components/app/service-record/ServiceRecordAdminWizard.tsx`, `frontend/src/app/(service-record-admin)/`, `frontend/src/app/api/admin/service-records/`, `backend/application/services/admin-service-record.service.ts`, `backend/application/services/admin-service-record-edit.service.ts`, `backend/interface/controllers/admin-service-record.controller.ts`, `backend/interface/dto/admin-service-record-edit.dto.ts`, `backend/module/service-record-entry.module.ts`, corresponding focused tests. Shared types/repository/schema changes are requested from the document version owner.

- **통합 확인과 단계 독립 감사** (test, high)
  - 부모가 격리된 단위 작업을 통합하고 필요한 로컬 DB·타입·회귀 검사를 실행한다. Sol은 그 결과와 전체 단계 변경을 읽기 전용으로 검토한다.
  - **Tier:** standard · **Sandbox:** local · **Agent:** sol_reviewer · **Model:** gpt-5.6-sol · **Effort:** high · **Depends:** 위 병렬 작업 통합과 필수 검사 완료
  - **Paths:** Phase5 owned files and verification evidence, read only.

공통 제한: 실제 vendor/SMS/storage/환경 DB·서명 요청·문의 전송은 실행하지 않는다. 기존 Phase0 ledger를 읽거나 초기화하지 않는다. 가짜 외부 어댑터와 명시적 loopback PostgreSQL만 로컬 증거로 사용한다. 공용 체크포인트에는 각 lane이 호출할 정확한 메서드와 DTO를 기록하고 부모가 모든 단위 worktree에 병합한 뒤 연결한다. worker는 아키텍처·소유·트랜잭션 경계를 임의로 바꾸지 않는다. 승인된 implementation-plan.md의 Phase5 수락 행렬·오류 복구·공식 PDF 증거 조건을 축약하거나 생략하지 않는다.
