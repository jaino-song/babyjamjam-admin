TL;DR: Phase 1은 고객 principal, SMS OTP, Kakao/Naver 로그인, 기존 client 기록 연결, 직원 권한과의 분리 경계를 실행 가능한 제안 계약으로 정리한다. 유효한 전화번호·이름·고객 생년월일의 세 값이 서버 원본과 정확히 하나 일치하면 명시적 연결 제출 뒤 staff 승인 없이 자동 연결한다. SMS OTP는 계속 필수이며, 모호하거나 충돌하는 결과만 예외 검토 경로로 보낸다. 아직 후속 소유자 결정과 독립 SOL 검토가 남아 있으므로 이 문서는 `READY_FOR_OWNER_DECISIONS`이며 Phase 1 종료나 구현 승인이 아니다.

# BJJ-459 고객 앱 Phase 1 결정 계약

Date: 2026-10-16 (Asia/Seoul)
Status: `READY_FOR_OWNER_DECISIONS`
Mode: PLAN/document authoring only
Issue/project: BJJ-459 / Linear project `b625abbd4639`
Plan revision: 0.3 (automatic-link owner revision)

## 1. 출처, 개정, 권한

| 정본 출처 | 개정/식별자 | 이 계약에서의 용도 |
| --- | --- | --- |
| [고객 앱 구현 계획 v0.2](https://linear.app/jaino-studio/document/implementation-plan-v02-%EA%B3%A0%EA%B0%9D-%EC%95%B1-ea56fdb5c159) | v0.2 | 단계 순서, 범위, 앱 대상 제안 |
| [어드민 연동 매핑 조사 보고서](https://linear.app/jaino-studio/document/%EC%96%B4%EB%93%9C%EB%AF%BC-%EC%97%B0%EB%8F%99-%EB%A7%A4%ED%95%91-%EC%A1%B0%EC%82%AC-%EB%B3%B4%EA%B3%A0%EC%84%9C-7a66f1c23d25) | Revision 1 | 실제 어드민 경로와 데이터 근거 |
| [고객 앱 기능 명세 v0.2](https://linear.app/jaino-studio/document/%EA%B8%B0%EB%8A%A5-%EB%AA%85%EC%84%B8-v02-%EA%B3%A0%EA%B0%9D-%EC%95%B1-d4f84be85479) | v0.2 | FR-01~07, 공개 필드와 비목표 |
| [고객 앱 테스트 명세 v0.2](https://linear.app/jaino-studio/document/%ED%85%8C%EC%8A%A4%ED%8A%B8-%EB%AA%85%EC%84%B8-v02-62%EA%B0%9C-%EC%8B%9C%EB%82%98%EB%A6%AC%EC%98%A4-75ccefa72fcd) | v0.2, 기존 62개 ID | AUTH-01~08과 기존 시나리오 보존 |
| 2026-10-15 소유자 결정 | SMS OTP + 별도 client 기록 연결 확인, Kakao/Naver 필수 | 최신 사용자 권한. PASS는 선택되지 않음 |
| 2026-10-16 소유자 결정 | 전화번호·이름·고객 생년월일의 정상 유일 일치면 staff 승인 없이 자동 연결 | 자동 operational-client link 정책의 최신 권한 |
| Repository `dev` | `037ed2bdde6188869017bbb7173f54cace9739b2` | 소스 기준 SHA이며 운영/배포 증거가 아님 |

`/tmp/bjj-459-autolink-20261016/{linear-plan,linear-adr,linear-issue,worker-brief,source-binding}.md`는 위 정본과 이번 owner binding의 로컬 감사용 복사본이다. 복사본이 Linear 정본과 최신 사용자 결정과 다르면 Linear 정본과 최신 결정을 따른다.

권한의 우선순위는 최신 사용자 결정, 이 계약, Linear 정본, 로컬 감사 복사본 순서다. 이 문서는 provider console 쓰기, 구매, schema migration, dependency 변경, 앱 생성, 환경변수 변경, 런타임 실행, 배포를 허가하지 않는다.

## 2. 작업 바인딩과 범위

| 항목 | 현재 correction binding |
| --- | --- |
| 현재 unit worktree | `/Users/jaino/Development/babyjamjam-admin/unit-bjj-459-auto-link-correction` |
| 현재 branch | `codex/unit/bjj-459-auto-link-correction` |
| current correction 시작 commit | `c1ffe51d2bfc195f1379c2f5546f9cff9049e613` |
| automatic-link revision 시작 commit | `f84553345912352a434765a4132dac7473eaf2c2` |
| 역사적 소스 기준 | `037ed2bdde6188869017bbb7173f54cace9739b2` |
| 이전 통합 후보 commit | `a7fc0fef6`, `5eddd4bd1`, `f84553345`, `c1ffe51d2` |
| integration worktree/branch | `/Users/jaino/Development/babyjamjam-admin/bjj-459-phase1-plan` / `docs/BJJ-459-phase1-plan` |
| 허용 변경 | 이 계획과 `docs/adr/ADR-014-customer-access-boundary.md`만 |
| 실행/감사 | `Execution: LUNA`, local, `Audit: SOL`; correction singleton |

이 revision은 기존 두 문서의 통합 후보에 owner가 확정한 자동 연결 정책을 반영한다. 수정 범위는 두 Markdown 파일뿐이며, main은 통합·최종 감사·Linear 저장을 담당한다. 고객 auth, API, DTO, Prisma, env, app source, SDK, signing, provider 설정은 만들지 않는다.

이 변경은 이전 `f8455334` 후보의 SOL 승인을 이 branch-mutation/unassigned
correction에 재사용하지 않는다. fresh SOL review가 별도로 필요하다.

## 3. 고객 principal과 로그인 계약

### 3.1 principal 원칙

1. 고객은 내부의 안정적인 `customerPrincipalId`를 가진다. principal은
   customer session, provider binding, phone-proof 상태, recovery 증거와
   operational client link의 소유자다.
2. credential binding은 principal과 별개이며 `provider`, `issuer`, provider
   client/app scope, `subject`를 묶는다. 전화번호, email, staff user ID,
   provider subject만으로 client 소유자를 정하지 않는다.
3. email/전화번호가 같아도 provider 계정을 자동 생성·병합하지 않는다. 다른
   provider를 추가할 때는 현재 session 재인증과 대상 provider의 fresh proof가
   모두 필요하며 충돌 시 client link를 자동으로 옮기지 않는다.
4. account recovery, social identity linking, operational client linking은
   서로 다른 흐름과 감사 사건이다.
5. 안전한 제안은 client별 active principal 1개다. 여러 branch의 명시적 link와
   가족 공유 허용 여부는 owner가 결정하기 전까지 미정이며, 가족 공유는
   기본 범위에 넣지 않는다.

### 3.2 확정된 로그인 능력과 미정 항목

| 능력 | Phase 1 계약 | 아직 owner가 정할 것 |
| --- | --- | --- |
| Phone verification | **필수·확정:** SMS one-time code로 현재 번호 보유를 확인하고, 민감 고객 데이터 전에 fresh phone proof를 만든다. | SMS delivery account/provider, template, abuse limit, recovery proof, retention |
| Kakao login | **필수:** server가 provider proof를 검증하고 Kakao issuer/client scope 아래 안정 subject를 binding한다. | client/app ID, redirect/signing 설정, console owner |
| Naver login | **필수:** state-bound server validation으로 token/profile의 안정 subject를 binding한다. | client/app ID, redirect 설정, console owner |
| Phone-only entry | social login이 없는 고객을 위한 제안 UX일 뿐, 별도 진입점으로 선택된 것은 아니다. | 이 UX의 존재와 rate limit |
| Apple login | 선택되지 않음 | Apple guideline 4.8 대응 경로와 Sign in with Apple 채택 여부 |

현재 우선 설계는 **Kakao/Naver first**이고, iOS 로그인 eligibility는 별도
review로 남긴다. Apple login은 추가하지 않는다. 이 세 가지는 이미 확정된
사용자 선택이므로 이 revision에서 재확인을 요구하지 않는다.

SMS OTP는 번호 보유 증명이지 client 기록 소유권 증명이 아니다. OTP 성공 뒤 고객이 이름과 고객 생년월일을 함께 제출하고, 서버가 authoritative client 원본과 정확히 하나 일치하는지 평가한다. 정상적인 유일 일치면 staff 승인 없이 같은 transaction에서 자동 active link를 만든다. 0건·다건·누락·충돌·보안 차단 같은 예외만 generic help/exception 경로로 보내며, 예외 검토 authority는 후속 결정이다. 현재 Aligo 코드는 outbound SMS 근거일 뿐 OTP 인증 서비스가 아니다. Aligo를 delivery 후보로 평가할 수는 있으나 setup, 구매, 실제 발송은 이 문서에 포함하지 않는다.

Kakao ID token은 issuer, audience, expiry, nonce, signature를 확인한다. Kakao의 `phone_number_verified=true`는 provider assertion일 뿐 fresh project phone proof나 기록 소유권이 아니다. tokeninfo는 debug 용도이지 production authenticity proof가 아니다. Naver는 state와 server-validated token/profile의 stable subject를 사용하며, 별도 근거 없이 OIDC 또는 PKCE를 지원한다고 쓰지 않는다. Static state나 URL에 token을 기록하지 않는다.

### 3.3 자동 연결의 authoritative source와 equality

자동 연결에 사용하는 실제 source field는 `client.name`,
`client.phoneNormalized`, `client.birthday`다. `client.branchId`는 후보 범위와
유효한 branch association 확인에 쓰지만 caller가 보낸 branch를 권한으로 쓰지
않는다. `client.phoneNormalized`는 `@@unique([branchId, phoneNormalized])`인
branch별 제약이라 전역 유일하지 않다. 서버의 검증된 phone proof에서 얻은
정규화 번호만 matching에 사용하며 raw phone body fallback을 허용하지 않는다.

`client.birthday`는 어머니/고객 생년월일(String)이다. `client.birthDate`는 아기
실제 출산일이고 `user.birthDate`는 staff profile이므로 customer DOB를 대신할
수 없다. 이 구분은
`docs/superpowers/specs/2026-08-01-maternity-contract-dialog-design.md:13,47`와
`docs/superpowers/specs/2026-09-03-service-end-receipt-link-design.md:29`에
기록되어 있다. 이 task에서는 live data의 형식 분포를 조사하거나 보정하지 않는다.

제출 이름과 저장 `client.name`은 각각 Unicode NFC 후 양 끝 boundary
whitespace만 trim한 normalized 값이 모두 nonempty여야 exact equality를
적용한다. 어느 한쪽이 null, empty, 또는 whitespace-only이면 phone+DOB가
맞아도 generic cannot-auto-link/help로 끝낸다. 내부 whitespace 제거, case 변경,
NFKC/romanization, fuzzy·substring 비교를 하지 않는다. 고객 DOB와 저장 DOB는 모두 완전한 유효 달력 날짜이며
4자리 연도를 가져야 한다. `YYYY-MM-DD` 또는 명시적 연도의 `YYYYMMDD`만
date-only ISO로 정규화한 뒤 비교한다. 6자리 `YYMMDD`, MMDD, 부분 날짜,
연도 추정, 잘못된 날짜, 모호하거나 누락된 저장값은 자동 연결하지 않는다.
기존 `IsBirthdayDate`와 shared normalizer가 legacy six-digit과 세기 추정을
허용하더라도 이 ownership contract에서는 더 약한 경로를 복사하지 않는다.
영수증의 `slice(2)` 생일 fallback도 customer ownership에 재사용하지 않는다.

Active link는 이름·전화번호·고객 생년월일뿐 아니라 매칭 당시의
`client.branchId`와 source revision/fingerprint를 함께 bind한다. `branchId`가
후속 변경되거나 null/unassigned가 되면 민감 access를 suspend/deny하고, 매
data request와 precommit write에서 현재 branch와 전체 source revision을 다시
확인한다. 예전에 캐시한 old branch grant로 접근할 수 없으며, unchanged valid
branch와 unchanged source만 계속 허용한다. 자동 matching은 명시적으로
revoked된 grant를 undo하거나 다른 branch로 이전하지 않는다.

## 4. 기존 auth 재사용과 분리

| 실제 anchor | 재사용 가능한 기제 | customer에 가져오면 안 되는 staff 가정 | 제안 customer 경계 |
| --- | --- | --- | --- |
| `backend/interface/controllers/auth.controller.ts` | request validation, 기존 token/refresh 흐름 | `/auth/token`, `/auth/refresh-token`은 staff session/route | 별도 `/customer/v1` controller |
| `backend/infrastructure/auth/jwt.strategy.ts` | session 조회, expiry, `sid`, revoke, token-version, fail-closed | `user.role`, `approvalStatus`, `branchId`, `organizationId`, staff branch | customer issuer/audience/purpose와 principal session |
| `backend/infrastructure/auth/jwt.guard.ts` | opt-in guard 조합 | staff Passport strategy를 인증함 | 별도 customer guard, role/cookie fallback 금지 |
| `backend/infrastructure/tenant/tenant.guard.ts` | 최신 membership 조회 원리 | owner/`user_branch`와 staff-selected branch | active principal-to-client link 검사 |
| `auth_session` | server session family, revoke 상태 | 현재 `user` relation과 selected staff branch | realm discriminator 또는 분리 session을 schema review 후 결정 |
| `auth_refresh_token` | opaque secret hash, atomic rotation, replacement marker | staff realm row를 customer가 읽는 것 | hash/rotation/revoke 기제만 boundary 검토 후 재사용 |
| `auth_rate_limit` | rate-limit 저장/정책 선례 | staff/login 키와 임계값을 그대로 복사 | customer phone/provider/link 정책을 별도 검토 |
| `docs/adr/ADR-001-auth-session-and-tenant-principal.md` | opaque refresh, replay, server lookup | staff tenant principal과 route shape | customer ADR의 명시적 결정을 거쳐 적용 |
| `service_record_token`, `receipt_link_token` | 좁은 link의 hash/expiry/replay 선례 | 특정 record/document bearer 권한 | customer principal/session/link 권한으로 사용 금지 |

현재 schema에는 customer principal/link 모델이 없다. realm discriminator,
기존 table 재사용, 새 table 선택은 data boundary와 retention review 뒤로
미룬다.

## 5. 세션 경계와 operation authorization matrix

Customer와 staff credential은 issuer, audience, purpose, signing key/strategy,
cookie 이름, session-state 의미를 각각 갖는다. role 문자열이나 branch ID가
있다는 이유로 권한을 주지 않는다. 두 realm token은 양방향으로 거부한다.

### 5.1 허용 행위와 차단 행위

| 행위 | 허용 조건 | 허용 결과 | 반드시 거부할 경우 |
| --- | --- | --- | --- |
| `provider-proof/exchange` | 제한된 미인증 exchange state, provider proof, redirect/state/nonce 검증 | principal/session을 만들거나 기존 principal에 binding; link/data 권한은 만들지 않음 | 잘못된 issuer/audience/signature, replay, staff token, state 불일치 |
| `phone-proof/start` | 현재 non-revoked customer onboarding session과 동일 principal, 명시된 challenge intent | 그 principal/session에 귀속된 challenge reference만 반환 | anonymous transferable challenge, 다른 principal/session, candidate lookup |
| `phone-proof/verify` | 같은 principal/session의 challenge reference, one-time code, current intent | 현재 phone-proof generation을 증가시키고 link flow로 이동 | 다른 session의 challenge, wrong/expired/replayed code, revoked session |
| `self`, own link status, logout | non-revoked customer session; active link 불필요 | 최소 principal 상태, 본인 link 상태, logout/cleanup | staff token/cookie, 다른 principal의 link ID |
| `POST /customer/v1/links` | non-revoked session, fresh server phone proof, user-supplied exact name + full DOB, explicit connect submit, idempotency | 정확히 하나인 eligible unclaimed match면 staff 승인 없이 `active` opaque link를 즉시 반환; evaluation이 계속되는 예외만 `pending` | active link가 없다는 이유로 차단하지 않음; request `clientId`/`branchId`, old proof, body owner, staff token은 거부 |
| `home`와 customer data read/mutation | non-revoked session + active current link + valid current phone-proof generation + unchanged valid `client.branchId`/source revision | 최소 공개 projection만 반환/변경 | unlinked, revoked, phone-proof stale, branch changed/null, source changed, wrong link, staff credential |
| `session/refresh` | principal/session/credential의 expiry·revoke·reuse 상태가 유효 | rotated credential; active link 없이도 session 수명 연장 가능 | refresh가 customer-data 권한을 만들거나 phone/link 검사를 건너뜀 |
| `session/revoke` | 현재 session 또는 owner가 정한 all-device 범위 | revoke와 local cleanup; 이미 revoked session의 logout은 idempotent | 다른 principal session revoke, customer token으로 staff revoke |

`phone-proof/start`와 `verify`는 provider exchange에서 나온 customer
onboarding session에 묶인다. Phone-only entry가 나중에 선택되면 anonymous
bearer challenge가 아니라 같은 principal/session/challenge-intent binding을
만드는 별도 bounded bootstrap이 필요하다. 그 UX는 아직 선택되지 않았다.

Guard 순서는 transport 추출 → realm signature/issuer/audience/purpose 검증
→ authoritative session 조회 → expiry/revoke/token-version/reuse 검증
→ operation별 필요한 current phone-proof/link state 확인 → ownership 검사다.
Public metadata는 customer auth 우회가 아니다. Revoke, logout, account switch,
provider unlink, phone change/recycle, link revoke 뒤에는 다음 요청에서
server가 다시 검사하며, precommit write에도 같은 검사를 적용한다.

Refresh는 active link를 요구하지 않지만 valid session/credential만 연장한다.
Refresh 결과만으로 home/data 권한을 만들 수 없고, fresh phone proof와 active
link가 없으면 민감 응답은 계속 차단된다. Refresh secret은 URL, analytics,
exception, log에 넣지 않는다.

즉 customer data는 `active link + valid current phone-proof generation`을
동시에 요구하고, non-revoked onboarding session만으로는 민감 data를 열지
않는다.

## 6. Client-record 자동 연결 상태와 원자 전이

`none`, `pending`, `active`, `rejected`, `canceled`, `expired`, `revoked`를
서버의 명시적인 상태로 둔다. 정상적인 유일 일치에서는 staff 승인 없이
`pending → active`를 같은 authoritative transaction 안에서 수행한다. 다음
표의 `pending`은 실제로 평가가 계속되거나 예외 검토가 필요한 경우에만 쓴다.

| 현재 상태 | 허용 전이 | 수행 주체/조건 | 금지 전이와 이유 |
| --- | --- | --- | --- |
| `none` | `pending` 또는 `active` | 같은 non-revoked principal/session, fresh phone-proof generation, exact name + full DOB, explicit submit; 유일하고 unclaimed이며 `client.branchId`가 유효한 assigned branch인 경우만 `active` | phone equality, social profile phone, client-supplied verified flag, old proof, null/unassigned branch만으로 연결 금지 |
| `pending` | `active` | 예외 평가가 끝난 뒤 동일한 원자 조건을 다시 통과한 경우; 정상 unique match는 이미 자동 active | 정상 성공에 staff 승인을 삽입하거나 임의로 첫 후보를 선택하지 않음 |
| `pending` | `rejected` | non-match/invalid/보안 예외를 generic reason으로 종결; 예외 review authority는 후속 결정 | candidate PII, mismatch field, 존재 여부 노출 금지 |
| `pending` | `canceled` | principal의 본인 취소 또는 후속 정책이 허용한 취소 | 취소 뒤 in-flight 평가가 active가 되지 않음 |
| `pending` | `expired` | server cleanup/owner가 정한 시간 정책 | 만료 proof 재사용 금지 |
| `active` | `revoked` | principal unlink, security block, source mutation/delete, staff revocation | `revoked`를 active로 resurrect하거나 다른 principal에게 reassign하지 않음 |
| terminal 상태 | 없음 | terminal row, proof binding, 결과는 immutable | retry는 새 request, 새 current proof, 새 version으로만 가능 |

자동 active의 transaction은 다음을 모두 확인해야 한다. (1) current
principal/session이 non-revoked인지, (2) 현재 phone-proof generation과 session/
intent가 같은지, (3) request version과 idempotency payload가 같은지, (4) 모든
branch를 포함한 eligible client scope에서 정확히 하나의 full match인지,
(5) `client.name`, `client.phoneNormalized`, `client.birthday`,
`client.branchId`의 source revision/fingerprint가 변하지 않았는지, (6) target
link가 unclaimed인지, (7) revoked/security-blocked prior grant가 없는지,
(8) `client.branchId`가 null/unassigned가 아닌 유효 assigned branch인지다.
따라서 정확히 하나인 full match라도 branch가 null/unassigned/invalid면
자동 active하지 않고 generic cannot-auto-link/help로 끝낸다. 물리적 serialization,
unique claim, phantom insert/change 방지는 Phase 3에서 mechanism을 binding한다.

후보 scope는 caller branch filter가 아니라 모든 branch의 기존 eligible client
row다. nullable/unassigned branch, 이미 다른 principal이 active link를 보유한
후보도 먼저 ambiguity/claim 판단에 포함한다. 정확히 하나인 후보라도 branch
association이 null/unassigned/invalid이면 active로 만들지 않는다. 여러 후보 중 unclaimed만 골라
unique로 만들지 않으며, 0건·다건·missing/invalid attribute·claimed/revoked/
security-blocked 후보는 generic cannot-auto-link/help 경로로 보낸다. 같은
principal의 active retry는 fresh authorization 뒤 기존 link를 반환할 수 있다.

revoke, cancel, phone change, source identity mutation 또는 hard delete는
pending proof와 in-flight match를 무효화한다. client에는 `deletedAt`/archive
field가 없으므로 completed/terminated 상태를 삭제로 추정하지 않는다. Hard
delete와 동시 insert/change가 claim을 우회하지 않도록 같은 transaction에서
재검사한다. Active 이후 `client.branchId`가 reassignment되거나 null/unassigned가
되면 old branch grant를 사용하지 못하고 다음 data request/precommit에서
suspend/deny한다. unchanged valid branch와 source만 계속 허용한다. 동일
principal+idempotency key+동일 payload는 같은 결과를
반환하고, 같은 key의 변경 payload는 conflict다. recycled/shared phone으로
link를 자동 이전하거나 명시적 revoke를 되돌리지 않는다.

## 7. 제안 `/customer/v1` 계약

아래는 실행 가능한 OpenAPI/DTO가 아닌 conceptual allowlist다. 정확한 field
name과 transport는 후속 binding에서 정할 수 있지만, operation별 권한과
privacy 경계는 넓혀서 해석하지 않는다.

| Endpoint | Request allowlist | Response와 실패 경계 |
| --- | --- | --- |
| `POST /customer/v1/auth/provider-proof/exchange` | provider, authorization proof, redirect/state binding, nonce(해당 시) | opaque customer session/principal 상태만; data/link 권한 없음 |
| `POST /customer/v1/auth/phone-proof/start` | 현재 session/principal, challenge intent, normalized phone, idempotency key | principal에 귀속된 challenge reference/expiry만; 존재 여부 비공개 |
| `POST /customer/v1/auth/phone-proof/verify` | 같은 session/principal의 challenge reference, one-time code, intent, idempotency key | current phone-proof generation과 next link state; wrong/replay/expired는 safe failure |
| `POST /customer/v1/auth/session/refresh` | secure transport의 opaque refresh secret/handle | rotated credential/expiry; active link 없는 session도 갱신 가능 |
| `POST /customer/v1/auth/session/revoke` | current customer session, optional all-device intent | success와 cleanup 상태; 이미 revoke된 logout은 idempotent |
| `GET /customer/v1/self` | non-revoked customer session | opaque principal reference, phone state, provider names, own link summary |
| `POST /customer/v1/links` | authenticated principal/session, fresh server `phoneProof` reference, submitted `name`, full `birthday`, explicit connect intent, idempotency key | 정확히 하나인 eligible match면 `active` opaque link와 time/version; unresolved evaluation만 `pending`; request `clientId`/`branchId`와 field별 mismatch는 노출하지 않음 |
| `GET /customer/v1/links/:linkId` | non-revoked session과 본인 link ID | own state, safe timestamps/reason; active link가 아니어도 own status 허용 |
| `GET /customer/v1/home` | non-revoked session, active link, current phone-proof generation | 최소 home projection; unlinked/revoked/stale proof는 unavailable |

Unknown identifier, wrong owner, revoked link, unlinked session은 safe generic
problem code를 쓴다. raw provider proof, refresh secret, raw phone, candidate
PII, staff note, signature, address, staff contact snapshot은 response/log에
넣지 않는다. Service-record/receipt bearer token은 customer endpoint의 인증
대체물이 아니다.

Challenge와 자동 연결 retry에는 principal, server-verified phone, IP, session을
함께 고려하는 aggregate abuse limit을 적용한다. 새 challenge가 누적 한도를
초기화하지 않는다. non-match, duplicate, claimed, revoked 결과는 같은 outward
denial/status class로 반환하고, rate-limit만 별도 명시적 응답을 허용한다.
실제 고객의 Name/DOB/phone/OTP/provider proof는 URL, analytics, log, audit
error, persistent client cache에 raw로 남기지 않는다. 샘플/테스트에는 실제
고객 데이터가 들어갈 수 없지만, production과 분리된 fully synthetic identity
fixture는 명시적으로 허용한다. 낮은 entropy 값을 단순 hash했다고 안전하다고
주장하지 않으며, 필요하면 keyed digest와 최소 보존을 후속 Phase 3에서 정한다.
세 값과 SMS possession은 PASS나 독립된 identity authentication, 충분한 account
recovery가 아니다.

## 8. 최소 home projection

첫 home에는 server가 확인한 다음 항목만 둔다.

- opaque link reference와 link state;
- service period date와 의미가 설명된 server-derived lifecycle label;
- `pending_review`, `unavailable_after_revocation` 같은 pending-source 표현과
  필요한 source/version metadata;
- 후속 contract가 승인한 safe next action/notification 요약.

Date-derived `active`/`completed`는 실제 방문 시작·종료가 아니다. Internal
notes, signatures, addresses, staff contact snapshot, payment/receipt outcome,
완전한 booking/outbox/billing schema는 노출하지 않는다. Rich record는 후속
Phase 5 field allowlist와 revoke 규칙에서 별도로 정한다.

## 9. 앱 경계, 단계 순서, 보호 변경 목록

### 9.1 앱 경계

권장 대상은 새 root `customer/` React Native + Expo 앱이다. `mobile/`은 직원용
Next.js 앱이고 `native/`는 직원용 KMP/Compose/SwiftUI 앱이므로 복사하지 않는다.
고객 시각 기준은 203-token baseline을 유지한다. 실제 두 번째 consumer가 생길
때에만 `packages/customer-contracts/`에 pure customer DTO/type을 둔다. Staff
auth, cookie, selected-branch state와 전체 store는 공유하지 않는다.

### 9.2 controlling rollout order

1. **Phase 1 — 이 계약:** owner가 principal, mandatory capabilities, no-merge,
   operation matrix, link state/approval boundary를 검토하고 SOL이 exact
   candidate를 감사한다. 이 단계는 문서이며 code/Phase2 승인이 아니다.
2. **Phase 2 — sample-only app spike:** Phase 1의 앱 위치와 최소 visual
   binding 뒤, real customer data/provider/push 없이 새 `customer/` 앱의 홈
   shell만 양 OS에서 검증한다. 이 단계가 Phase 3 auth보다 먼저다.
3. **Phase 3 — customer auth implementation:** 먼저 additive schema/realm/data
   boundary를 확정하고 적용한 뒤 같은 Phase 3 안에서 customer controller,
   guards, provider proof, SMS OTP, link transition을 구현한다. Schema는
   Phase 2 prerequisite가 아니다.
4. 이후 app session UX, home/public projection, records/notifications/billing은
   각자 별도 plan, test, audit gate를 가진다.

Phase 2의 알려진 discovery는 Node `22.23.2`, pnpm `10.33.0`, Xcode
`26.6 (17F113)`, selected developer directory, Temurin Java `21.0.12`다.
`adb`, emulator, `sdkmanager`, Watchman은 PATH에서 찾지 못했고
`~/Library/Android/sdk`도 없었다. 이는 알려진 경로 discovery일 뿐 Android
부재의 전수 증명이 아니다. 설치·native build·device run·customer runtime
검증은 하지 않았다.

### 9.3 향후 보호 변경 목록

| Path/영역 | 이유 | 후속 binding |
| --- | --- | --- |
| `customer/package.json`, `customer/tsconfig.json` | 새 앱 package/strict 설정 | Expo/RN version과 dependency |
| `customer/` app config/native identifiers/signing | staff와 별도 앱 정체성 | bundle/package ID, signing account/owner |
| `pnpm-workspace.yaml`, `pnpm-lock.yaml` | workspace/lock 반영 | 실제 package path와 승인된 dependency |
| `packages/customer-contracts/` | 실제 shared consumer가 있을 때 pure DTO/type | consumer와 version policy |
| Phase 3 backend auth/session/link path | principal, provider proof, OTP, link auth | exact module/path, realm schema, transaction |
| future env/provider config | issuer, client ID, keys, SMS credential | 이름, secret store, owner, provider approval |

정확한 version, app ID, signing 값, env key 이름, schema migration은 여기서
선택하지 않는다. 후속 계획의 보호 변경 목록과 rollback이 필요하다.

## 10. Owner 결정과 Phase 1 close gate

| 질문 | 안전한 제안/확인 사실 | 소비 단계 | Phase 1 처리 |
| --- | --- | --- | --- |
| SMS delivery provider/account | Aligo를 capability/owner 검토 후 후보로 평가; setup/send 없음 | Phase 3 provider adapter | provider만 pending, SMS OTP 의미는 확정 |
| Recovery proof | phone/email 일치만으로 recovery하지 않는 별도 proof | Phase 3 auth/recovery | 정책 pending, 자동 이전 금지 |
| Exception review authority | 정상 유일 일치에는 staff 승인이 없고, 0건·다건·claimed·security 예외만 review 역할과 감사 사건이 필요 | Phase 1 경계 확인 후 Phase 3 예외 workflow | 예외 authority pending |
| Multi-record/branch multiplicity | client별 active 1개 제안, cross-branch는 명시 승인 때만 | Phase 1 경계와 Phase 3 schema | owner 확인 필요 |
| TTL/retention | 임의 값 없이 artifact별 owner 결정 | Phase 3 data/auth | 이 문서 검토 뒤 후속 gate로 유예 가능 |
| App ID/signing/developer account | customer identity를 staff와 분리 | Phase 2 build/release | 후속 binding |
| Apple guideline 4.8 | iOS login eligibility를 별도 review; Apple login은 추가하지 않음 | Phase 2 iOS review/release gate | 이미 확정된 후속 검토이며 selection 재확인 불필요 |
| Phone-only entry | 제안 UX로만 기록 | 제품 후속 결정 | 선택 전 구현하지 않음 |

Phase 1 close는 provider credential, env key 이름, app ID/signing 값, schema
table 이름, TTL/retention 숫자를 모두 지금 정하라는 뜻이 아니다. Close에
필요한 것은 principal/link/token invariants, 세 가지 확정 capability,
no-merge, operation matrix와 transition boundary를 owner가 승인하고 각
미정 항목을 Phase 2/3 또는 제품 후속 gate에 명시적으로 배정하는 것이다.
그 승인과 독립 SOL 검토 전에는 상태를 `READY_FOR_OWNER_DECISIONS`로 두며,
Phase 1 종료·Phase 2 실행·code implementation approval을 주장하지 않는다.

## 11. 추적성과 검증 계약

기존 62개 test ID는 변경하지 않는다. AUTH-01~08은 원래 의미를 유지하고,
아래 AUTH-X ID는 이 경계의 확장이다.

| ID | 성공 assertion | 실패 assertion |
| --- | --- | --- |
| AUTH-01 | unlinked principal은 link 안내와 own 상태만 받음 | reservation/record detail과 candidate PII가 나오지 않음 |
| AUTH-02 | A의 active link는 A-owned projection만 받음 | B/C ID, file, write가 차단되고 열거되지 않음 |
| AUTH-03 | phone equality alone은 연결하지 않고, fresh SMS 뒤 full identity flow로 이동 | 전화번호만 맞아도 link active가 되지 않음 |
| AUTH-04 | A logout 후 B login과 지연 response를 분리 | A cache/response가 B 화면에 오지 않음 |
| AUTH-05 | revoke 후 foreground/server 재검사로 차단 | direct URL/cache가 revoke를 우회하지 않음 |
| AUTH-06 | 동시 expiry에서 refresh를 조정 | reuse/revoke가 무한 loop나 권한 상승을 만들지 않음 |
| AUTH-07 | reinstall 뒤 server session/link를 확인 | 남은 device credential만으로 private screen을 열지 않음 |
| AUTH-08 | customer↔staff controller 호출이 양방향 차단 | staff cookie/role/`selectedBranch`가 customer 권한이 되지 않음 |
| AUTH-X01 | valid SMS OTP가 현재 proof generation을 만들고 link flow로 이동 | wrong/expired/replayed/rate-limited code가 safe failure |
| AUTH-X02 | Kakao issuer/audience/expiry/nonce/signature 검증 통과 | bad signature/audience, debug tokeninfo, stale proof 거부 |
| AUTH-X03 | Naver state/token/profile이 stable subject에 binding | static state, URL token log, 무근거 OIDC/PKCE 가정 거부 |
| AUTH-X04 | reauthentication 후 새 provider binding 성공 | email/phone collision이 principal/link를 자동 merge하지 않음 |
| AUTH-X05 | exact unique full match가 staff action 없이 pending/none을 active로 한 번 전이 | old version/proof, 동시 claim, unlink 뒤 active 금지 |
| AUTH-X06 | revoke/link/phone state를 read/write 직전에 확인 | JWT expiry만으로 data 권한을 주지 않음 |
| AUTH-X07 | unknown/not-owner 응답이 동일한 safe code | candidate/phone 존재나 staff data 추론 불가 |
| AUTH-X08 | home이 source/status 의미와 provenance를 표시 | date status를 visit/payment 완료로 표시하지 않음 |
| AUTH-X09 | recovery/phone recycle/reinstall/multi-device 정책이 명시됨 | recycled phone이 link를 자동 이전하지 않음 |
| AUTH-X10 | app identity/signing/Apple gate가 build 전 기록됨 | sample build가 release compliance를 의미하지 않음 |
| AUTH-X11 | unlinked non-revoked session이 self/status/logout/phone flow를 수행 | active link가 없다는 이유로 onboarding을 deadlock하지 않음 |
| AUTH-X12 | refresh가 valid principal/session만 갱신 | refresh가 active link/phone proof 없는 data 권한을 만들지 않음 |
| AUTH-X13 | fresh phone proof + full submitted name/DOB + explicit connect intent의 유일한 valid assigned-branch match가 즉시 `active`; `pending`은 genuinely ongoing unresolved evaluation에만 사용 | name/DOB/intent가 없거나 normal success를 universal `pending`/staff wait로 바꾸면 실패 |
| AUTH-X14 | `none→pending/active`, `pending→active/rejected/canceled/expired`, `active→revoked`만 성공 | terminal resurrect, replay, duplicate claim, in-flight revoke 우회 불가 |
| AUTH-X15 | provider exchange가 bounded unauth state에서 principal/session만 만듦 | provider proof만으로 home/data/link active가 되지 않음 |
| AUTH-X16 | exact normalized phone + NFC/trim exact name + complete four-digit-year customer DOB의 유일 unclaimed **assigned valid-branch** match가 staff action 없이 active | 0건·다건·claimed·revoked·security-blocked는 generic cannot-auto-link |
| AUTH-X17 | phone, name, DOB 각각의 불일치가 동일한 generic denial을 반환 | mismatch field나 candidate 존재를 노출하지 않음 |
| AUTH-X18 | `client.birthday`의 완전한 YYYY-MM-DD/explicit-year YYYYMMDD만 date-only 비교 | six-digit, MMDD, partial, invalid, century inference와 `client.birthDate` 대체를 거부 |
| AUTH-X19 | NFC와 boundary trim 뒤 exact name match만 성공 | internal whitespace 제거, case/fuzzy/substring/romanization/NFKC 가정은 실패 |
| AUTH-X20 | 모든 branch의 eligible row를 포함해 하나의 unclaimed valid-association 후보를 찾음 | 다건, nullable/unassigned invalid association, 이미 claim된 후보를 제외해 unique로 만들 수 없음 |
| AUTH-X21 | same principal의 fresh authorized retry와 같은 idempotency payload가 같은 active link를 반환 | 다른 payload의 같은 key, 다른 principal, revoked grant는 conflict/denial |
| AUTH-X22 | 두 principal의 동시 claim과 source insert/change가 atomic serialization에서 한 건만 성공 | phantom candidate, duplicate claim, first-row/latest-row 선택이 없음 |
| AUTH-X23 | source name/phoneNormalized/birthday revision 또는 hard delete 뒤 sensitive access가 재평가됨 | claimant input이 source를 backfill/correct하거나 explicit revoke를 resurrect하지 않음 |
| AUTH-X24 | OTP가 같은 principal/session/intent와 server phone에 묶여 검증됨 | replay, wrong session, wrong phone, client-supplied verified flag는 실패 |
| AUTH-X25 | fresh challenge가 principal+phone+IP/session aggregate limit에 누적됨 | 새 challenge로 probing/retry 한도를 초기화하지 않음 |
| AUTH-X26 | non-match/duplicate/claimed/revoked 실패에 real-customer raw PII가 없음; fully synthetic test identity fixture는 허용 | real customer name/DOB/phone/OTP/provider proof가 log/cache/audit error/URL에 남거나 fixture로 복사됨 |
| AUTH-X27 | exact full match인 단일 후보가 assigned valid `client.branchId`일 때만 automatic active | 단 하나라도 null/unassigned/invalid branch면 ambiguity/help로 끝나며 자동 active하지 않음 |
| AUTH-X28 | active link의 bound branch와 source revision이 그대로면 data request/precommit이 허용됨 | branch reassignment/nulling 또는 source mutation 뒤 old cached grant는 deny/suspend |
| AUTH-X29 | 명시적 revoke 뒤 current triple match가 다시 보여도 revoke 상태가 유지됨 | auto matching이 revoke를 undo하거나 다른 branch로 grant를 이전하지 않음 |
| AUTH-X30 | 제출 이름과 저장 `client.name`이 NFC+boundary trim 뒤 모두 nonempty이고 exact match면 정상 유일 연결을 허용 | 어느 한쪽이 null/empty/whitespace-only이면 phone+DOB가 맞아도 generic cannot-auto-link |

문서 task의 실제 검증은 Markdown 구조, durable source URL/개정, source
anchor, exact path allowlist, credential-pattern scan이다. Backend
`type-check`, `lint`, `test`, `build`, `test:auth-e2e`, native build, provider
call, device QA, DB check는 executable implementation이 없으므로 `NOT RUN`이다.

## 12. 위험, rollout, rollback

| 위험 | 영향 | 완화 |
| --- | --- | --- |
| 번호 공유/재사용 | 잘못된 client 노출 | stable principal + fresh OTP + 세 값의 정확한 일치; recycled phone 자동 이전 금지 |
| 이름/DOB와 번호의 낮은 독립성 | 지식 정보가 추측되어 오인 연결될 수 있음 | SMS possession을 계속 요구하고, 세 값은 PASS/identity auth/recovery로 과장하지 않음 |
| staff/customer realm 혼용 | 교차 role data/write | issuer/audience/purpose/key/strategy 분리와 양방향 test |
| provider proof drift | false auth/충돌 merge | server 검증, stable subject, provider contract review |
| link race/replay | 중복 active 또는 무단 활성화 | version/proof generation/source revision/exclusivity atomic check와 serialization |
| retention/TTL 추측 | privacy/recovery 실패 | 값을 비워 두고 Phase 3 owner gate에서 결정 |
| signing/Apple 경로 불명 | release collision/reject | Phase 2 iOS/release gate |
| Android tooling 미확인 | false build PASS | discovery를 `NOT RUN`으로 기록 |

문서 rollback은 correction commit을 Git revert한다. 후속 code rollback은
새 customer issuance/link activation을 멈추고 revoke와 unresolved lookup을
보존해야 하며, schema/data rollback은 별도 migration 계획이 필요하다.

## 13. 근거 anchor와 공식 참고

실제 source anchor는 다음과 같다.

- `backend/infrastructure/auth/jwt.strategy.ts:29-109`는 Bearer/`auth_token`,
  `auth_session`, expiry/revoke/token-version/selected branch/staff approval을
  확인한다. `jwt.guard.ts:5-12`는 opt-in guard다.
- `backend/infrastructure/tenant/tenant.guard.ts:24-33`은 owner 또는
  `user_branch` membership을 확인한다. `backend/app.module.ts:107`과
  `backend/infrastructure/auth/auth.module.ts:41`은 strategy provider이며,
  inspected app module에는 `APP_GUARD`/`useGlobalGuards`가 없다.
- `backend/prisma/schema.prisma:851` (`auth_rate_limit`), `:875`
  (`auth_session`), `:894` (`auth_refresh_token`), `:911`
  (`auth_email_outbox`), `:1184` (`service_record_token`), `:1562`
  (`receipt_link_token`)은 customer principal/link가 아니다.
- `backend/prisma/schema.prisma:244-291`의 실제 identity source는 required
  `client.name`, nullable `client.phoneNormalized`, nullable `client.birthday`,
  그리고 nullable `client.branchId`다. `client.birthDate`는 아기 출산일이며
  customer DOB source가 아니다. client에는 `deletedAt`/archive field가 없고,
  삭제는 hard-delete 경로이므로 `serviceStatus`를 삭제 표식으로 쓰지 않는다.
- `backend/interface/dto/birthday.validator.ts:13-17`과
  `packages/shared/src/utils/birthday.ts:63-73,85`에는 legacy six-digit과
  century inference가 있지만, 이 계약은 full four-digit-year만 허용한다.
  Receipt의 `backend/application/services/receipt-link-token.service.ts:206-208,234-236`
  생일 fallback은 customer ownership matching에 재사용하지 않는다.
- 이름 비교의 NFC+boundary-trim exact 규칙은
  `backend/application/utils/eformsign-client-identity.ts`의 더 느슨한
  whitespace 제거/생일 normalizer를 의도적으로 따르지 않는다.
- `docs/adr/ADR-001-auth-session-and-tenant-principal.md`는 hash/rotation/
  replay/server lookup 재사용 근거이고, `docs/aligo-preparation.md`는
  outbound setup 예시일 뿐 OTP auth proof가 아니다.

공식 참고 링크는 구현 review에서 다시 확인한다.

- Kakao: <https://developers.kakao.com/docs/ko/kakaologin/rest-api>,
  <https://developers.kakao.com/docs/ko/kakaologin/utilize>
- Naver: <https://developers.naver.com/docs/login/api/api.md>
- Apple guideline 4.8: <https://developer.apple.com/app-store/review/guidelines/#login-services>
- JWT audience/realm validation: <https://www.rfc-editor.org/rfc/rfc8725>
- Expo monorepo/SecureStore: <https://docs.expo.dev/guides/monorepos/>,
  <https://docs.expo.dev/versions/latest/sdk/securestore/>
- Aligo outbound SMS candidate: <https://smartsms.aligo.in/admin/api/spec.html>
