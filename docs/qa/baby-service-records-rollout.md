# 아기별 제공기록지 배포 및 롤백

## 배포와 스키마 호환

인증과 활성 지점 권한을 확인한 `GET /clients/baby-record-capability`는 `{ "enabled": true }`를 반환한다. 기존 지점 설정은 등록, 링크 발급, 큐 처리에 영향을 주지 않는다. 승인된 백필의 원래 케이스 ID, 아기 ID, 서명 회차와 유효한 단일 링크는 저장된 출처를 바탕으로 이어진다. 그룹 준비 이후에는 그룹 선택과 담당자 검증을 적용한다. 배정 변경 등으로 철회된 링크는 새 발급으로 되살아나지 않는다.

preview와 production이 DB를 공유하는 동안에는 additive 스키마와 기존 단일 고객·일정 unique 키가 공존할 수 있다. 이 상태에서도 전 지점의 예약 전 등록에 아기와 담당 배정을 저장할 수 있다. 여러 케이스를 생성하는 예약 확정은 케이스별 키 전환이 필요하다. 기존 키와 충돌하면 HTTP 409 `REQUEST_CONFLICT`와 사유 `SERVICE_RECORD_CASE_KEYS_NOT_STAGED`를 반환한다. 확정 상태, 케이스, 발송 작업은 같은 트랜잭션에서 롤백되며 기존 등록 초안과 배정은 남는다. 예약 확정 상태를 포함한 신규 등록에서 같은 충돌이 나면 그 등록 요청 전체가 롤백된다.

- 스키마 승격 전 DB 대상, migration ledger, 모든 활성 및 복구 리비전의 키 호환성을 확인한다. 키 전환과 다태아 예약 확정 검증은 격리 복제본에서 수행한다.
- 키 전환 전에는 해당 DB에 쓰는 `Database Patches`의 대기·실행 중인 구버전 run을 모두 종료하고, 이후 push와 수동 dispatch가 replay 보호가 포함된 리비전을 사용하도록 한다. preview push, main push, production dispatch는 같은 운영 DB를 대상으로 한다. 전환 중에는 다른 DB 패치나 배포를 시작하지 않는다. 키 상태 검증에 실패하면 패치를 중단하고 해당 DB의 인덱스와 migration ledger를 확인한다.
- 화면 확인용 preview는 배포 워크플로에서 `SCHEDULERS_ENABLED=false`를 확인한다. 등록 화면은 읽기 전용으로 확인한다. 등록·예약 확정 저장과 발송·재시도 요청은 실제 쓰기 또는 즉시 발송을 일으킬 수 있다. DB 쓰기와 통신사 동작은 격리 PostgreSQL과 vendor stub으로 검증한다.

## 운영 DB 키 전환

`backend/scripts/cutover-baby-case-keys.sh`는 승인된 점검 시간에 운영자가 수동 실행한다. `Database Patches`는 기존처럼 현재 키에 맞는 SQL을 재실행한다.

1. 독립적으로 확인한 운영 DB 직접 연결을 사용한다. 기존 자격 증명과 libpq 설정으로 `PGHOST`, `PGDATABASE`, `PGUSER`를 지정하고 TCP 연결은 `PGSSLMODE=verify-full`로 검증한다. 비밀번호와 접속 URI를 인자나 작업 기록에 넣지 않는다.
2. 기존 런타임 확인 결과에서 ingress와 인증·콜백 경로가 LightNode 및 같은 DB를 쓰는 Cloud Run preview로 한정되고, 양쪽의 현재·복구 리비전이 두 키 레이아웃을 처리하는지 확인한다. LightNode의 scheduler lease 갱신을 유지하고 수동 failover는 해제 상태로 둔다. 두 서비스는 실행 상태를 유지하며 키 전환 명령 자체에서 DB 쓰기를 일시 정지한다.
3. 해당 DB를 대상으로 실행 중이거나 대기 중인 DB patch·배포가 없는 상태를 확인하고 전환 종료까지 신규 실행을 막는다. 실패한 patch가 남긴 부분 적용 상태도 먼저 확인하고 해결한다. 운영 DB에서 시험용 데이터나 lease 행을 만들지 않는다.
4. `backend/scripts/cutover-baby-case-keys.test.sh`로 폐기 가능한 PostgreSQL 회귀를 실행한다. 테스트는 `rehearse`로 정본 SQL과 검증을 실행한 뒤 롤백한다. 운영 창에서는 검토된 커밋에서 `backend/scripts/cutover-baby-case-keys.sh apply`를 한 번 실행한다.
5. `Baby case keys verified (COMMIT).`을 성공 기준으로 삼는다. 성공과 롤백 모두 DB 세션이 끝나면 대기하던 호환 writer가 자동으로 진행한다. 종료 결과가 불명확하면 아래 읽기 전용 SQL로 키 레이아웃을 확인한다. 잠금 충돌로 거절되면 진행 중인 트랜잭션이나 유지보수 작업의 종료를 확인한다. 공급사 시도가 남아 있으면 기존 조회·대조 절차로 상태를 확인한다. 발송 결과 불명 사유로 실패한 제공기록 링크 작업이 하나라도 있으면 아래의 중단 기준을 적용한다. 실패한 명령을 자동 재시도하지 않는다.
6. 커밋을 확인했으면 같은 운영 DB 직접 연결의 승인된 URI를 Prisma의 `DIRECT_URL`과 `DATABASE_URL`에 안전하게 주입한 상태에서 `pnpm --dir backend exec prisma migrate resolve --schema prisma/schema.prisma --applied 20261126010000_baby_case_keys`로 ledger에 기록한다. ledger 기록에 실패하면 케이스별 키를 보존하고, 키 검증과 기존 ledger 상태를 확인한 뒤 기록 단계만 복구한다.

명령은 한 트랜잭션에서 `NOWAIT` 잠금을 잡는다. 기존 쓰기가 남아 있으면 전환이 즉시 중단된다. 모든 잠금을 잡은 뒤 이미 커밋된 발송 선점, SMS 접수 상태, 문서 작업·직접 완료 인텐트와 삭제 인텐트를 조회한다. 공급사 호출 전에 작업과 함께 취소된 SMS 초안과 예약 변경으로 발송 연결이 해제된 quiet-hours 초안은 통과한다. 처리 중이거나 결과가 불명확한 시도는 전환을 중단한다.

이번 수동 전환은 발송 결과 불명 사유로 실패한 제공기록 링크 작업이 0건인 경우에만 진행한다. 회수 로직은 작업의 클레임을 지우며 해당 클레임에서 사용한 로그 ID나 발송 세대를 저장하지 않는다. 로그 대조가 회수 전후 어느 쪽에서 끝났든 같은 작업 키를 사용하는 다른 발송과 구분할 수 없으므로, 대조 후에도 명령은 이 상태에서 중단한다. 이 경우 전환 창을 종료하고 작업과 공급사 이력을 별도로 조사한다.

제공기록지 스냅샷은 검토자 단계(06)로 생성한다. 외부 참여자 단계(05)로 재요청할 수 있는 연결 문서가 0건이어야 하며, 명령은 목록용 열과 저장된 상세 상태를 모두 정규화해 이 조건을 확인한다. 잠금은 두 저장 상태의 갱신을 막고, 스냅샷 생성은 공급사 호출 전 청크를 `CREATE_REQUESTED`로 저장해야 한다. 이미 문서 ID를 읽은 요청도 `reRequestOutsiderDocument`에서 그 ID로 공급사에 재통지하고 로컬 문서 캐시 버전만 갱신한다. 일반 전자계약 재통지도 같은 경로를 쓴다. 후속 문서 상태 반영, `completeServiceRecordSnapshotIfReady`의 케이스 완료와 작성 링크 발급은 각자 위 DB 잠금을 통과해야 한다.

잠금이 유지되는 동안 기존 연결과 새 연결 모두에서 제공기록 쓰기와 새 발송 선점은 대기하거나 연결의 제한 시간에 걸려 실패한다. 인덱스 전환 대상 네 테이블의 조회도 대기한다. 공유 발송·문서 큐의 조회는 계속되며 다른 종류의 쓰기도 잠금 해제까지 짧게 대기할 수 있다. 같은 트랜잭션 안에서 정본 SQL을 적용하고 전체 인덱스 정의를 검증한다. 같은 LightNode 인스턴스의 최신 lease를 시작과 커밋 직전에 확인한다. 서버 제한은 SQL 문 8초, 개별 잠금 대기 750ms, 트랜잭션 유휴 2초다.

커밋 전에 오류, 타임아웃, 클라이언트 종료가 발생하면 PostgreSQL이 인덱스 변경을 롤백하고 잠금을 해제한다. PostgreSQL은 실행 중에도 연결 종료를 확인한다. 커밋 요청 이후 연결이 끊어지면 같은 직접 연결에서 키 레이아웃을 조회한다.

```sh
psql -Xw -1 -v ON_ERROR_STOP=1 -c 'SET TRANSACTION READ ONLY' \
  -f backend/prisma/scripts/select-service-record-replay-layout.sql \
  -c "SELECT current_setting('bjj.service_record_replay_layout')"
```

`legacy`이면 기존 키가 유지된 상태로 호환 writer가 진행한다. `case`이면 전체 키 검증을 실행하고 성공한 경우에만 ledger를 확인해 적용 기록을 완료한다. 레이아웃 조회 또는 전체 키 검증이 실패하면 두 결과와 ledger를 확인한다.

```sh
psql -Xw -v ON_ERROR_STOP=1 -f backend/prisma/scripts/verify-baby-case-stage-before-release.sql
```

커밋 뒤에는 호환 복구 리비전을 쓰고 케이스별 키를 보존한다. 형제 아기의 케이스·일정 행이 만들어지면 단일 고객·일정 키 복원은 기존 행과 충돌한다. 커밋 뒤 DB 스키마 롤백은 별도 승인 범위다.

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
