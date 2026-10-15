# ADR-014: 고객 principal, provider login, client-record access 경계

Date: 2026-10-15 (Asia/Seoul)
Status: Proposed; `READY_FOR_OWNER_DECISIONS`
Scope: BJJ-459 Phase 1 결정 계약
Correction base: `5eddd4bd116900ce173fe421198836d9036e3bd9`
Historical source base: `037ed2bdde6188869017bbb7173f54cace9739b2`

## 배경

현재 repository의 staff 인증은 opt-in `JwtGuard`, `JwtStrategy`,
`TenantGuard`를 사용한다. `JwtStrategy`는 `auth_session`의 expiry/revoke/
token-version과 staff approval을 조회하고, `TenantGuard`는 owner 또는
`user_branch` membership을 확인한다. Prisma에는 `user`, `auth_session`,
`auth_refresh_token`, `auth_rate_limit`이 있지만 customer principal과
customer-to-client link는 없다.

`client.branchId + phoneNormalized`는 데이터 제약이지 identity proof가 아니다.
`service_record_token`과 `receipt_link_token`은 좁은 record/document bearer
link이므로 customer account 권한이 될 수 없다. 기존 Aligo SMS도 outbound
transport 근거이지 OTP auth service 증거가 아니다.

최신 사용자 결정은 SMS one-time code + 별도 client-record linkage
confirmation, Kakao login, Naver login을 모두 요구한다. SMS는 번호 보유만
증명한다. 민감 데이터에는 fresh phone proof와 active client link가 모두
필요하다. provider account, recovery proof, 운영 approver, multiplicity,
retention, app signing, Apple guideline 4.8 경로는 owner 결정으로 남긴다.

## 결정(제안)

1. 내부 안정 ID `customerPrincipalId`를 만들고 provider binding, phone proof,
   recovery, session, operational client link를 별도 개념으로 둔다. 전화번호,
   email 일치, staff user ID, provider subject만으로 기록 소유자를 정하지
   않는다.
2. SMS OTP, Kakao, Naver를 필수 capability로 둔다. Phone-only entry는 제안
   UX이고 Apple은 미선택이다. Kakao는 issuer/audience/expiry/nonce/signature,
   Naver는 state와 server token/profile stable subject를 검증한다. provider
   proof로 link나 data 권한을 자동으로 만들지 않는다.
3. Customer/staff realm은 issuer, audience, purpose, signing key/strategy,
   cookie, authoritative session state를 분리한다. Staff credential은
   customer route를, customer credential은 staff route를 통과하지 못한다.
4. Onboarding session은 active link 없이도 `self`, own link status, logout,
   phone proof를 수행할 수 있다. `provider-proof/exchange`는 bounded
   unauth state에서 principal/session만 만들고, `phone-proof/start/verify`는
   현재 principal/session/challenge intent에 bind한다. `refresh`는 유효한
   principal/session/credential만 갱신하며 data permission을 만들지 않는다.
5. Home와 customer data read/mutation만 non-revoked session, active current
   link, current phone-proof generation을 모두 요구한다. Unknown/wrong-owner
   응답은 non-enumerating safe code를 쓴다.
6. Link 상태는 `none → pending → active | rejected | canceled | expired`,
   `active → revoked`만 허용한다. terminal 상태는 immutable이며 retry는 새
   request/new proof/new version이다. Active 승인은 principal/session 허용
   상태, 같은 phone-proof generation, pending request version, target record
   exclusivity를 atomic하게 확인한다. revoke/cancel/phone-change는 pending
   proof와 in-flight approval을 무효화한다.
7. `/customer/v1`은 provider exchange, phone proof, session refresh/revoke,
   self, own link, minimum home projection만 제안한다. `service_record_token`
   과 `receipt_link_token`은 customer auth로 재사용하지 않는다.
8. 앱은 새 root `customer/` React Native + Expo를 권장한다. Phase 2는
   sample-only app spike이고 Phase 3는 additive schema/realm boundary를
   먼저 적용한 뒤 customer controller/guard/provider/OTP/link 구현을 한다.
   App ID, signing, SDK, env, schema 세부값은 후속 binding이다.

## 허용 전이와 operation matrix 요약

| 행위 | link 없이 허용 | active link와 phone proof 필요 |
| --- | --- | --- |
| provider exchange | principal/session 생성만 | 불필요 |
| phone start/verify | 현재 onboarding session에 bind된 경우 | 불필요 |
| self, own status, logout | non-revoked session이면 허용 | 불필요 |
| link request | fresh phone proof면 허용 | 불필요 |
| refresh | valid principal/session/credential이면 허용 | 불필요 |
| home/data read/mutation | 거부 | 필요 |

Staff/customer token 상호 배제, revocation의 request-time 확인, logout의
idempotent cleanup, fresh proof generation은 후속 구현의 필수 acceptance다.

## 대안 검토

1. Staff JWT/cookie, `user.role`, `selectedBranch`를 customer 권한으로 재사용:
   staff tenant membership은 customer 기록 소유권이 아니므로 거부한다.
2. phone equality 또는 Kakao phone assertion을 ownership proof로 사용: 번호
   공유/재사용과 provider assertion의 한계 때문에 거부한다.
3. `service_record_token`/`receipt_link_token`을 account login으로 사용:
   좁은 record/document 경계를 customer account로 확장하므로 거부한다.
4. Kakao/Naver/phone 값이 같으면 자동 merge: 충돌 시 reauthentication과
   fresh target-provider proof가 필요하므로 거부한다.

## 결과

### Positive

- Onboarding이 active link 전에 막히지 않으면서 민감 data는 계속 보호된다.
- Customer ownership과 staff tenant authority가 분리된다.
- SMS/Kakao/Naver proof가 operational record owner로 오인되지 않는다.
- request-time revoke와 link/phone generation 검사로 logout, unlink,
  account switch, provider 변경 뒤 stale access를 차단한다.

### 부정적 결과와 미정 항목

- customer principal/session/link schema와 guard는 Phase 3의 별도 review가
  필요하다.
- provider account, recovery, approver, multiplicity, TTL/retention, signing,
  Apple 경로는 owner가 Phase 2/3 gate에서 정할 수 있으며 이 Phase 1
  boundary 초안의 review를 막는 세부값은 아니다.
- customer와 staff 앱은 native identity와 release evidence를 따로 유지한다.

## 검증과 rollback

계획 문서 `docs/plans/BJJ-459-customer-phase1-contract.md`는 AUTH-01~08의
원래 의미와 AUTH-X01~15 확장, success/failure assertion, operation matrix,
transition race를 기록한다. 이 ADR은 implementation이나 Phase 2 승인이
아니다. 문서 rollback은 correction commit의 Git revert다. 후속 schema/token
realm rollback은 별도 additive migration과 revoke 계획을 요구한다.

주요 정본은 다음 Linear 문서다.

- <https://linear.app/jaino-studio/document/implementation-plan-v02-%EA%B3%A0%EA%B0%9D-%EC%95%B1-ea56fdb5c159>
- <https://linear.app/jaino-studio/document/%EC%96%B4%EB%93%9C%EB%AF%BC-%EC%97%B0%EB%8F%99-%EB%A7%A4%ED%95%91-%EC%A1%B0%EC%82%AC-%EB%B3%B4%EA%B3%A0%EC%84%9C-7a66f1c23d25>
- <https://linear.app/jaino-studio/document/%EA%B8%B0%EB%8A%A5-%EB%AA%85%EC%84%B8-v02-%EA%B3%A0%EA%B0%9D-%EC%95%B1-d4f84be85479>
- <https://linear.app/jaino-studio/document/%ED%85%8C%EC%8A%A4%ED%8A%B8-%EB%AA%85%EC%84%B8-v02-62%EA%B0%9C-%EC%8B%9C%EB%82%98%EB%A6%AC%EC%98%A4-75ccefa72fcd>
