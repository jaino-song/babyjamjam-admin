# 아기별 제공기록지 배포 및 롤백

## 배포와 스키마 호환

인증과 활성 지점 권한을 확인한 `GET /clients/baby-record-capability`는 `{ "enabled": true }`를 반환한다. 기존 지점 설정은 등록, 링크 발급, 큐 처리에 영향을 주지 않는다. 승인된 백필의 원래 케이스 ID, 아기 ID, 서명 회차와 유효한 단일 링크는 저장된 출처를 바탕으로 이어진다. 그룹 준비 이후에는 그룹 선택과 담당자 검증을 적용한다. 배정 변경 등으로 철회된 링크는 새 발급으로 되살아나지 않는다.

preview와 production이 DB를 공유하는 동안에는 additive 스키마와 기존 단일 고객·일정 unique 키가 공존할 수 있다. 이 상태에서도 전 지점의 예약 전 등록에 아기와 담당 배정을 저장할 수 있다. 여러 케이스를 생성하는 예약 확정은 케이스별 키 전환이 필요하다. 기존 키와 충돌하면 HTTP 409 `REQUEST_CONFLICT`와 사유 `SERVICE_RECORD_CASE_KEYS_NOT_STAGED`를 반환한다. 확정 상태, 케이스, 발송 작업은 같은 트랜잭션에서 롤백되며 기존 등록 초안과 배정은 남는다. 예약 확정 상태를 포함한 신규 등록에서 같은 충돌이 나면 그 등록 요청 전체가 롤백된다.

- 스키마 승격 전 DB 대상과 migration ledger를 확인한다. 기존 scalar writer와 queue consumer가 같은 DB에 연결하는 경우 별도 승인된 전환 구간에서 먼저 drain한다. `backend/prisma/scripts/verify-baby-case-stage-before-release.sql`로 기존 키와 전환 대상 상태를 확인한다. 키 전환과 다태아 예약 확정 검증은 격리 복제본에서 수행한다.
- 키 전환 전에는 해당 DB에 쓰는 `Database Patches`의 대기·실행 중인 구버전 run을 모두 종료하고, 이후 push와 수동 dispatch가 replay 보호가 포함된 리비전을 사용하도록 한다. preview push, main push, production dispatch는 같은 운영 DB를 대상으로 한다. 전환 중에는 다른 DB 패치나 배포를 시작하지 않는다. 명시적 staging을 마친 뒤 검증을 통과하면 case 키에 대응하는 writer를 재개한다. 키 상태 검증에 실패하면 패치를 중단하고 해당 DB의 인덱스와 migration ledger를 확인한다.
- 화면 확인용 preview는 배포 워크플로에서 `SCHEDULERS_ENABLED=false`를 확인한다. 등록 화면은 읽기 전용으로 확인한다. 등록·예약 확정 저장과 발송·재시도 요청은 실제 쓰기 또는 즉시 발송을 일으킬 수 있다. DB 쓰기와 통신사 동작은 격리 PostgreSQL과 vendor stub으로 검증한다.

## 기존 큐와 발송

폐기된 지점 설정으로 보류되었던 작업은 스케줄러가 실제로 동작하는 환경에서 다시 큐 평가 대상이 된다. 발송 승인, 수신자 opt-out과 자동화 동의, 예약 시각, quiet hours, 담당자·케이스·링크 유효성 및 기존 중복 발송 방지가 적용된다. 운영에서 이전 보류분이 예상대로 처리되는지 기존 지점별 발송 이력과 아래 집계를 대조한다.

`provider_call_started_at`이 기록되고 `provider_acceptance_state='started'`로 바뀐 시점부터는 발송 처리 중으로 본다. 접수 여부가 불확실한 건은 공급사 조회로 확인한 뒤 기존 `POST /message-logs/:id/reconcile` 경로로 대조한다. 거절 또는 미접수가 확인된 적격 건은 기존 `/message-logs/:id/retry` 경로로 처리한다. 접수된 건은 carrier 조회를 계속한다. 큐와 접수 이력은 보존한다.

## 지점 단위 검산

배포 전후 동일 지점에서 읽기 전용 트랜잭션으로 비교한다. 서명 및 문서 연결은 정렬된 집계로 확인한다. 아래 조회는 전화번호, 링크, 서명 원문을 출력하지 않는다.

```sql
BEGIN READ ONLY;
SELECT status, count(*) FROM public.service_record_case
WHERE branch_id = :'target_branch'::uuid AND baby_id IS NOT NULL GROUP BY status ORDER BY status;
SELECT count(*) AS signed_days,
       md5(COALESCE(string_agg(md5(concat_ws('|', d.service_record_case_id, d.case_session_index,
           d.client_signed_at, md5(COALESCE(d.client_signature, '')))), ',' ORDER BY d.service_record_case_id, d.case_session_index), '')) AS signed_digest
FROM public.service_record_day d
JOIN public.service_record_case c ON c.id = d.service_record_case_id AND c.branch_id = d.branch_id
WHERE c.branch_id = :'target_branch'::uuid AND c.baby_id IS NOT NULL AND d.client_signed_at IS NOT NULL;
SELECT count(*) AS snapshot_docs,
       md5(COALESCE(string_agg(concat_ws('|', d.service_record_case_id, d.id), ',' ORDER BY d.service_record_case_id, d.id), '')) AS doc_fk_digest
FROM public.eformsign_doc d
JOIN public.service_record_case c ON c.id = d.service_record_case_id AND c.branch_id = d.branch_id
WHERE c.branch_id = :'target_branch'::uuid AND c.baby_id IS NOT NULL;
SELECT j.status, count(DISTINCT j.id) AS jobs, count(m.job_id) AS members,
       count(DISTINCT ROW(j.employee_schedule_id, j.recipient_employee_id)) AS recipient_scopes
FROM public.message_trigger_job j
LEFT JOIN public.service_record_job_member m ON m.job_id = j.id AND m.branch_id = j.branch_id
WHERE j.branch_id = :'target_branch'::uuid AND j.recipient_employee_id IS NOT NULL
GROUP BY j.status ORDER BY j.status;
SELECT l.provider_acceptance_state, count(*) AS logs,
       count(l.provider_call_started_at) AS started, count(l.provider_accepted_at) AS accepted
FROM public.message_log l
JOIN public.message_trigger_job j ON j.id = l.trigger_job_id AND j.branch_id = l.branch_id
WHERE j.branch_id = :'target_branch'::uuid AND j.recipient_employee_id IS NOT NULL
GROUP BY l.provider_acceptance_state ORDER BY l.provider_acceptance_state;
SELECT
  (SELECT count(*) FROM public.client_baby WHERE branch_id = b.id AND NOT legacy_backfilled) AS new_babies,
  (SELECT count(*) FROM public.client_baby WHERE branch_id = b.id AND NOT active) AS retired_babies,
  (SELECT count(*) FROM public.service_record_team_slot WHERE branch_id = b.id AND NOT legacy_backfilled) AS new_slots,
  (SELECT count(*) FROM public.service_record_baby_assignment
   WHERE branch_id = b.id AND (NOT legacy_backfilled OR ended_at IS NOT NULL)) AS owner_changes,
  (SELECT count(*) FROM public.service_record_token t
   JOIN public.service_record_case c ON c.id = t.service_record_case_id AND c.branch_id = t.branch_id
   WHERE t.branch_id = b.id AND c.baby_id IS NOT NULL) AS scoped_tokens
FROM public.branch b WHERE b.id = :'target_branch'::uuid;
COMMIT;
```

## 롤백

- 코드 롤백은 revert PR로 진행한다. 첫 사용 전에 기준선과 배정·케이스·토큰·발송 이력을 대조해 이전 artifact와의 호환성을 확인한다.
- 신규 배정, 케이스, 유효 링크, 서명 또는 발송 이력이 있으면 이를 읽고 처리할 수 있는 호환 artifact를 사용한다. 이전 단일 고객·일정 키를 복원하면 이미 저장된 다태아 기록이 충돌하므로 전환된 스키마를 보존한다. 운영 DB 스키마 롤백은 별도 승인 범위다.
