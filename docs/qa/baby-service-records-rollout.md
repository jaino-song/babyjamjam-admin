# 아기별 제공기록지 지점 전환 및 롤백

## 실행 범위

5.1 리허설은 `127.0.0.1:62295`의 `throwaway_baby_cutover_work`와 `throwaway_baby_cutover_verify`에서만 실행한다. 두 Prisma URL은 같은 clone을 가리켜야 하고 `NODE_ENV=test`, `E2E_VENDOR_STUBS=1`을 사용한다. 공유 dev·preview·production 실행, 배포, 실제 발송은 별도 승인 사항이다.

등록 UI·BFF와 백엔드가 같은 후보에 들어간 뒤 트래픽을 연다. 기존 UI는 allocation을 항상 보낼 수 있으므로 백엔드만 먼저 내보내면 off 지점의 신규 등록이 409로 막힌다. 지점 변경 시 등록 화면은 capability와 preview를 다시 읽는다. `GET /clients/baby-record-capability`는 현재 인증 지점의 `{enabled: boolean}`을 반환한다. 누락과 `true` 이외 값은 비활성이다. 활성 지점 하나와 off 지점 하나에서 실제 등록, 예약 확정, 그룹 발송, 링크별 모바일 서명 및 관리자 조회를 검증한다. 공유 DB 스키마가 후보보다 뒤처진 상태의 읽기 전용 QA로 이 리허설을 대체할 수 없다.

## 잠금과 발송 처리

- 설정 변경은 지점 advisory transaction lock을 잡고 설정 한 행만 upsert한다. 확정 등록과 그룹 생성 및 발송·재시도 경로는 같은 지점 잠금을 쓴다. 기존 client 및 일정 트랜잭션 안의 케이스 생성, 소유권 추가, 토큰 발급은 설정 행의 `FOR SHARE`를 커밋까지 유지한다.
- 그룹 source/발송은 지점 advisory → client/employee/case/schedule → 일정 발송 advisory → job/token/log 순서로 해당 작업에 필요한 잠금을 잡는다. 설정만 쓰는 운영 트랜잭션은 job이나 케이스를 잠그지 않는다. drain 쿼리는 설정 커밋 이후 별도 읽기 트랜잭션에서 실행한다.
- pause의 경계는 `false` upsert 트랜잭션의 커밋이다. 발송의 경계는 동일 지점 잠금 아래 `message_log.provider_call_started_at`을 찍고 `provider_acceptance_state='started'`로 바꾸는 CAS의 커밋이다. job의 `dispatching`과 log의 `prepared`는 발송 준비 상태다. pause가 먼저이면 carrier 호출 없이 보류한다. CAS가 먼저이면 잠금 밖에서 시작되거나 진행 중인 호출이 끝나는 것을 확인한다.
- 보류 그룹은 상태와 원래 예약·quiet-hours 일정을 보존한다. 큐 선택은 off 그룹을 제외한다. 이미 발급된 링크와 서명·제출, 담당 해제와 자격 취소는 계속 처리한다. 미확정 기존 고객과 비바우처 등록은 기존 단일 기록·발송 경로를 사용한다.

## 한 지점 설정 변경

승인된 연결에서 지점 UUID, slug, DB 이름을 운영 기록과 대조한다. 리허설에서 아래 변수를 한 대상에 맞춰 입력한다. `rollout_db`에는 위 두 이름 중 하나를, `rollout_value`에는 provision/pause `false` 또는 activation/resume `true`를 입력한다. 설정 변경 시마다 같은 SQL을 새 세션에서 실행한다.

```bash
case "$rollout_db" in
  throwaway_baby_cutover_work|throwaway_baby_cutover_verify) ;;
  *) exit 2 ;;
esac
psql -X --host=127.0.0.1 --port=62295 --username=bjj_revision_test --dbname="$rollout_db" \
  --set=ON_ERROR_STOP=1 --set=target_db="$rollout_db" \
  --set=target_branch="$rollout_branch_uuid" --set=target_slug="$rollout_branch_slug" \
  --set=rollout_value="$rollout_value"
```

```sql
BEGIN;
SET LOCAL search_path = pg_catalog, public;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(hashtextextended(
  'babyjamjam:message-automation-branch:' || :'target_branch'::uuid::text, 0));
WITH target AS (
  SELECT id FROM public.branch
  WHERE current_database() = :'target_db'
    AND id = :'target_branch'::uuid AND slug = :'target_slug' AND is_active
    AND :'rollout_value' IN ('false', 'true')
), setting AS (
  INSERT INTO public.system_setting (key, value, updated_at)
  SELECT 'branch:' || id::text || ':baby_service_records:enabled', :'rollout_value', now()
  FROM target
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
  RETURNING key
)
SELECT count(*) = 1 AS changed FROM setting \gset
\if :changed
  COMMIT;
\else
  ROLLBACK;
  \echo 대상 DB, 지점 또는 설정 값 불일치. 실행 중단.
  \quit 2
\endif
```

사용 승인된 배포 환경에서는 운영자가 확인한 단일 DB 연결로 같은 SQL을 실행한다. 연결 문자열이나 인증값은 shell 이력, 캡처 및 보고에서 제외한다. 잠금 시간 초과가 나면 트랜잭션이 반영되지 않았음을 확인하고 현재 잠금 보유자를 확인한 뒤 다시 시도한다.

## 단계별 실행

1. **사전 점검.** 후보 SHA와 백엔드·등록 UI artifact를 고정한다. private clone에 기존 migration을 순서대로 재현한 뒤 drift, replay와 aggregate 기준선, 기존 단일 링크를 확인한다. `backend/prisma/scripts/verify-baby-record-foundation.sql`을 승인된 clone에서 읽기 검증에 사용한다. 기존 scalar writer와 scheduler가 아직 같은 저장소를 쓰는지 확인한다.
2. **Pause와 drain.** 단일 지점을 `false`로 설정하고 아래 aggregate를 캡처한다. 이미 승인된 그룹의 `started`가 수락·거절·불확실 중 하나로 정리될 때까지 관찰한다. `dispatching`의 남은 행은 claim 및 provider ledger와 대조한다. 오래 남는 건은 transport 담당과 접수 결과를 확인하고 이력을 보존한다. 기존 scalar writer가 키 전환 DB에 접근한다면 유지보수 구간에서 해당 writer와 queue consumer를 모두 drain한 후에만 키 전환으로 간다.
3. **스키마와 배포.** 정상 승격 파이프라인은 `dev → preview → main`이다. `.github/workflows/database-patches.yml`의 compatibility patch 실행과 `.github/workflows/backend-ci.yml`의 승격·patch 확인을 추적한다. 해당 workflow 기준 preview/main backend가 운영 DB를 공유하는 경로가 있으므로 preview 승격 전에도 DB 대상을 확인한다. Lightsail 승격에서는 `backend/deploy/lightsail/ci-operator.sh`의 `run_release_migrations`가 후보 컨테이너로 `prisma migrate deploy --schema prisma/schema.prisma`를 이미지 활성화 전에 자동 실행한다. 실행 결과와 migration ledger를 확인한다. 키 전환의 clone 리허설은 drained snapshot에서 `psql -X -v ON_ERROR_STOP=1 -f backend/prisma/scripts/stage-baby-case-keys.sql`로 재현한다. 최종 릴리스에서는 canonical key migration의 replay 및 drift 근거와 자동 deploy의 정확한 대상·순서를 리뷰한 뒤 진행한다.
4. **활성화와 재개.** 두 artifact 적용 및 정상 health를 확인한다. 해당 지점만 `true`로 전환한다. 기존 due queue/quiet queue가 남은 그룹을 다시 평가한다. 예약 시각, 직원 opt-out, 발신 승인, 해당 케이스·담당자·유효 링크 조건은 그대로 적용된다. 이전에 pause에서 거절된 신규 등록·예약은 사용자가 정상 화면에서 다시 실행한다. 보류 건의 확인은 기존 지점별 발송 이력에서 한다. 미접수 확인이 필요한 건은 기존 공급사 조회와 지점 관리자 대조 경로 `POST /message-logs/:id/reconcile`를 사용한다. 거절 또는 미접수로 확인된 적격 건만 기존 `/message-logs/:id/retry`로 다룬다. 수락된 건은 carrier 조회를 계속하고, 확인 전 불확실 건은 보류한다. 설정이나 SQL로 job·log 상태를 되돌리지 않는다.

## 지점 단위 검산

같은 지점에서 pause 전, 2단계 drain 후, 재개 후에 반복한다. 운영 검산은 읽기 전용 트랜잭션에서 실행한다. 서명·문서 지문은 정렬된 집계만 공유한다. 아래 조회는 payload, 전화번호, URL, 서명 원문을 출력하지 않는다.

```sql
BEGIN READ ONLY;
SELECT COALESCE((SELECT value = 'true' FROM public.system_setting
                 WHERE key = 'branch:' || :'target_branch'::uuid::text || ':baby_service_records:enabled'), false) AS enabled;
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

기존 서명과 문서 FK 지문이 유지되고 pause 이후 추가 provider-start가 없는지 확인한다. pause 이전에 찍힌 start의 늦은 응답은 drain에서 설명한다. 재개 후에는 작업·수신 범위와 새 수락 건을 대조한다. 두 번째 재개에서 기존 수락·불확실 범위의 발송이 늘면 다시 pause한다.

## 롤백 분기

- **첫 사용 전.** pause와 drain 이후 설정·등록·케이스·할당·토큰·그룹·문서·서명·carrier ledger를 기준선과 대조한다. 새 allocation이나 retired baby, 새 slot/owner 역사, 유효하게 발급된 링크, job/member, carrier-start·불확실·수락 이력 중 하나라도 있으면 사용 전 복구를 중단한다. 과거 backfill과 후보가 추가한 쓰기를 구분한다. 공유 키나 전역 backfill을 되돌리려면 모든 지점에서 동일 검산과 writer drain을 별도 승인받는다. 기존 `rollback-baby-record-foundation.sql`은 unchanged preactivation backfill을 대상으로 하는 전역 스크립트다. approved schema replay에 additive schema 및 migration ledger의 보존을 포함한다.
- **첫 사용 이후 또는 결과 불확실.** 대상 지점을 `false`로 두고 drain한다. 케이스별 키, 기존 URL과 세션, 서명·문서 및 job/log를 보존하는 호환 artifact를 유지한다. 이전 scalar writer, 전역 rollback SQL 및 이전 단일 고객/일정 unique key를 다시 적용하면 사용 중인 데이터를 처리할 수 없다. 기록·자격·이력의 정확성을 회복하는 패치를 전진 배포하고 위 검산을 다시 통과한 뒤 해당 지점만 재개한다.
