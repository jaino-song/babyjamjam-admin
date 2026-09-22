# BabyJamJam 대화형 업무 AI v1.0 릴리스 준비 기록

작성일: 2026-09-18  
현재 검증 worktree: `/Users/jaino/Development/babyjamjam-admin/bjj-conversation-final`
현재 검증 브랜치: `codex/unit/bjj-conversation-final`
현재 기준 커밋: `6fe3a27c20f8b5babec14b7374070178e068bc95` (base `origin/dev` `089cb133741f67752d084c1fba0766c5ad6a70f4`)

## Preview promotion attempt — 2026-09-19

PR [#731](https://github.com/jaino-song/babyjamjam-admin/pull/731)이 `dev`를 `preview`로 승격해 merge commit
`92d5b63eec1cb04e0b7821b5424800751e8a711b1`을 생성했다. Preview push workflow는
`35364445679`이다.

- Backend type-check/lint/test, auth observe/enforce E2E, conversation task E2E, immutable image build,
  database-patch wait 및 deployment-target resolution은 모두 통과했다.
- Lightsail deploy job `105667457833`은 AWS OIDC 인증에서
  `Could not assume role with OIDC: Not authorized to perform sts:AssumeRoleWithWebIdentity`로 실패했다.
  따라서 Systems Manager 배포는 실행되지 않았다.
- Preview backend 배포·런타임 health/browser proof, 운영 DB 변경, 실제 SMS/provider 호출은 수행되지 않았다.
  외부 AWS IAM trust/configuration 경계이며 IAM이나 workflow 우회는 하지 않았다.

이 섹션은 preview 승격과 배포 전 결정적 검증만 기록한다. Preview runtime/browser proof, 유료
Google/OpenAI 품질 평가, human review 및 운영 활성화는 여전히 별도 게이트다.

## Scope update — 2026-09-19

사용자 지시에 따라 AWS OIDC/IAM 수리, preview 배포·런타임·브라우저 검증, 운영 DB 변경 및 운영 활성화는
이번 진행에서 건너뛴다. 해당 항목은 미검증으로 유지한다.

OpenAI 평가 경로는 문서의 `gpt-4.1-mini` current/improved 프로필로 dry-run과 단일 케이스 live smoke를
재확인했다. dry-run 설정은 유효했지만 로컬 환경에 비어 있지 않은 OpenAI 평가 키가 없어
`MISSING_API_KEY`로 transport 생성 전에 fail-closed 되었다. provider 요청이나 키 값은 기록하지 않았다.
유료 모델 품질 평가와 human review는 평가 키가 구성된 뒤 진행한다.

## Google model evaluation refresh — 2026-09-19

기존 로컬 Gemini 평가 키를 프로세스에만 주입해 Google staging 전체 조합을 실행했다. `gemini-2.5-flash`,
current/improved profile, 합성 48개 사례 × 3회로 **288 runs**를 완료했고, redacted artifact는
[`2026-09-19-google-all.json`](../ai-conversation-quality/artifacts/2026-09-19-google-all.json)이다.

- **286 responses / 2 errors** (HTTP 503 1건, malformed response 1건); text 118, tool calls 168.
- Required-token **223/324 (68.8%)**; structured-event **172/576 (29.9%)**.
- Latency p50 **2,169 ms**, p95 **7,631 ms**, max **22,931 ms**; usage/cost는 provider 응답에서 확인되지 않았다.
- Fixture digest `24ab8fb9498ba7472972c6d3a66b2d19274bc47787f96e5f34e9d8a1abc97d4a`, assertion digest
  `8c6070f04f167f22e211d113d0fe6e64b2af8491057f861609f8d5d8c2042af4`가 계약과 일치한다.

결과는 제안한 95% 기준 미달이므로 model-quality pass가 아니다. OpenAI 비교와 human review는 여전히 남아 있다.

## Current task-branch attestation — 2026-09-18

현재 누적 검증은 `/Users/jaino/Development/babyjamjam-admin/bjj-conversation-complete`의
`feature/bjj-conversation-complete` 브랜치, HEAD `b65b950d0ea1cf79a56f6c87f90240f47f1665e3`,
기준 `origin/dev` `55777f1facf7aafb3cbe19b322b6205a4c4860df`에서 수행했다. 위의 과거 기록은
이전 통합 worktree의 재현 자료로 보존한다.

- Backend 전체 회귀: **401 suites passed, 1 skipped; 5,786 tests passed, 44 skipped; 1 snapshot passed**.
  8GB 힙 재실행에서 테스트 assertion 실패 없이 종료됐으며, 초기 4GB 힙 OOM 시도는 성공으로 집계하지 않았다.
- Phase 7 보강: task-origin service-record-link의 정상·위조 revision 차단을 포함한 집중 회귀와 guarded
  PostgreSQL/AppModule matrix를 별도 통과했다. 실제 provider, SMS, 운영 DB는 사용하지 않았다.
- 결정적 대화 harness: **48/48 passed**; capability drift **47 capabilities passed**; frontend/mobile
  type-check와 production build, UI architecture gate, E2E string gate, `pnpm audit --prod`가 통과했다.
- 인증 synthetic browser 계약: desktop **3 passed / 1 intentional skip**, mobile **1 passed / 1 intentional skip**;
  mobile unit **9 passed**. 공식 Chrome에서 `/chat`을 375×812와 1280×900으로 확인해 모바일·데스크톱 shell,
  sidebar 표시, `/chat` 공통 chrome 숨김, DOM·computed style·스크린샷을 확인한 뒤 QA 탭을 원상 복구했다.
- Google/OpenAI staging runner의 양쪽 provider dry-run은 **576개 계획**을 transport 없이 생성했고,
  holdout live 실행은 두 평가 키가 unset인 상태에서 `MISSING_API_KEY`로 전송 전에 거절됐다.
- 현재 원격에는 이 task 브랜치에 대한 PR 또는 workflow run이 없으며, push·merge·deploy는 수행하지 않았다.
  실제 Google/OpenAI 품질 평가, human review, 실제 SMS·운영 DB 변경·운영 활성화도 수행하지 않았다.

현재 판정은 **구현 및 결정적 검증 완료**, **실제 대화 품질 검증 대기**, **운영 적용 대기**다.

## RV-04 real product AppModule evidence — 2026-09-19

The guarded disposable product evaluator is committed at `afca342d2`. It boots the real Nest `AppModule` against the approved loopback disposable PostgreSQL database and exercises the persisted customer task/action path with vendor stubs.

- Exit 0 with `AGENT_E2E=1`, `E2E_VENDOR_STUBS=1`, `SCHEDULER_LEASE_MODE=off`, and both datasource URLs bound to `127.0.0.1:55433/bjj_conversation_test`.
- Create/update customer writes both succeeded; 3 synthetic rows were observed before cleanup.
- 4 actions were proposed, approved, terminal and succeeded.
- 8 task-owned authority records/jobs were observed; positive job evidence was present. Deny/no-send produced 0 message logs and 0 sends; coverage was 8 intents, 8 jobs and 0 message logs.
- The runner fails closed for missing product opt-in, unsafe or mismatched datasource URLs, missing vendor stubs and scheduler leases. Temporary disposable task flags, parent policy and default rules are restored/removed during teardown.
- Provider calls and SMS sends: **0**. The normal `--product` evaluator path and production defaults are unchanged.
- Evaluator-focused regression: **2 suites / 28 tests passed**. Current full backend: **401 suites passed, 1 skipped; 5,789 tests passed, 44 skipped; 1 snapshot passed**. Type-check, diff check, changed-file secret scan and production dependency audit passed.

This closes the local RV-04 product DB/AppModule evidence gap. AWS OIDC/IAM trust, preview deployment/runtime/browser proof, environment promotion, paid Google/OpenAI evaluation, human review and operational activation remain open release gates.

## Latest release-readiness attestation — 2026-09-18

The current branch has completed implementation and deterministic validation for the Phase 7 continuation and the verified desktop/mobile browser paths. Historical sections below retain the earlier integration records.

- Phase 7 focused regression: **3 suites / 66 tests passed**.
- Guarded disposable PostgreSQL/AppModule: **16 suites / 198 tests passed**; no real provider, SMS or production database was used.
- Full backend: **401 suites passed, 1 skipped; 5,786 tests passed, 44 skipped; 1 snapshot passed**. Type-check, Nest build, capability manifest (**47**), frontend/mobile/shared type-checks and builds passed.
- Deterministic conversation harness: **48/48 passed**, zero network/transport/safety errors, with fixture digest `24ab8fb9498ba7472972c6d3a66b2d19274bc47787f96e5f34e9d8a1abc97d4a` and assertion digest `8c6070f04f167f22e211d113d0fe6e64b2af8491057f861609f8d5d8c2042af4`.
- Authenticated synthetic browser: desktop shell and final-backend stream each **1 passed**; mobile final-backend proxy/drawer/reload/session-restore **1 passed**. Full IME/focus/scroll acceptance is not claimed.
- Provider evaluation: both-provider dry-run produced no transport; keyless live execution refused before transport with `MISSING_API_KEY`. Paid Google/OpenAI quality evaluation and human review remain open.
- Current independent SOL FINAL: **SHIP / HIGH** with no blocking findings.
- No real SMS, production DB change, merge to an environment branch, deployment or operational activation was performed.

The release state is therefore: implementation/deterministic verification **complete**; actual conversation quality **pending**; operational application **pending**.

## Phase 7 deterministic close — 2026-09-18

Phase 7 is integrated at `1d512cd3b1281cc28b42699dc3dd7394f591ee49`; the final correction source is `720425b8548599f2f647f58569ba3dc7fba031c4`. Present-but-unusable service-record sources now remain explicit digest-only unavailable scopes with `complete=true`, allowing a reviewed `no`/`noSend` customer transaction to persist terminal coverage while preventing service-record intent, delivery job and SMS creation. Malformed schedule identity/date data remains incomplete and fail-closed.

- Focused planner/recipe: **2 suites / 34 tests passed**.
- Guarded disposable PostgreSQL/AppModule: **16 suites / 198 tests passed** at the task SHA and again after integration.
- Full backend: **396 suites passed, 1 skipped; 5,713 tests passed, 44 skipped; 1 snapshot passed**.
- Type-check, Nest build, capability drift (**47**) and production dependency audit (**0 vulnerabilities**) passed.
- Independent SOL FINAL: **SHIP / HIGH**, no blocking findings.

The implementation and deterministic validation gates are closed. Paid Google/OpenAI quality evaluation, human review, real SMS, production database changes, deployment and operational activation remain open release gates.

## 최신 통합 업데이트 — 2026-09-18

현재 통합 HEAD는 `codex/bjj-conversation-v1`의 후속 통합 커밋까지 반영했다. Phase 7의 schedule-write successor/fence와 purge 후 SMS retry provenance AppModule 검증, desktop/mobile task snapshot·lifecycle controls, staging Google/OpenAI evaluation runner가 통합됐다.

- Guarded disposable PostgreSQL/AppModule agent E2E: **12 suites, 159 tests passed**.
- Durable retry/purge integration: **1 suite, 1 test passed**.
- Schedule record-store/service focused tests: **2 suites, 31 tests passed**.
- Desktop task controls: **15 focused tests passed**; frontend type-check passed.
- Mobile task controls: **3 focused suites, 54 tests passed**; mobile type-check and UI architecture gate passed.
- Provider evaluation runner: **6 focused tests passed**; both-provider dry-run plan is **576 runs** and keyless live invocation fails closed.

The Google staging run is recorded in [`staging-evaluation.md`](../ai-conversation-quality/staging-evaluation.md) and its redacted artifact. It completed 288 runs with 10 errors and scored 213/324 required tokens and 179/576 structured events, below the proposed quality threshold. The OpenAI run was refused before transport creation because no API key is present in the staging environment. No key value, raw prompt/response, production customer data, real SMS, or production database was used.

### Phase 7 task-origin carrier correction — 2026-09-18

The task-origin consent reference now travels from the staged schedule intent into the automatic service-record-link job payload. This closes the bounded carrier slice required for service-record-link provenance; it does not close the full Phase 7 plan.

- Focused regression: **3 suites, 135 tests passed**.
- Guarded disposable PostgreSQL/AppModule agent E2E: **15 suites, 193 tests passed** with `E2E_VENDOR_STUBS=1` and `SCHEDULER_LEASE_MODE=off`; no paid provider, real SMS, or production database was used.
- Backend regression: **396 suites passed, 1 skipped; 5,703 tests passed, 44 skipped; 1 snapshot passed**. Type-check, build, and capability drift (**47 capabilities**) passed.
- Independent SOL final review: **SHIP / MEDIUM**, reviewed commit `33b8993e3a3c19b21a66c99479e799322a982ca9` against base `604c47bbc850c55c65a4d50694495d39de91af6d`.

The remaining Phase 7 work is the cumulative consent/provider matrix and final cumulative review. Distributed lease behavior, paid Google/OpenAI quality evaluation, real SMS, production data changes, deployment, and feature activation remain separate gates.

## 현재 판정

로컬 합성 데이터와 vendor stub을 사용한 구현·결정적 검증은 통과했다. PR [#716](https://github.com/jaino-song/babyjamjam-admin/pull/716)의 backend, full-flow, call-inbox, auth observe/enforce, frontend, mobile, shared, OSV 및 advisory browser 검사는 통과했다. GitGuardian 이력 remediation 이후 최신 PR 상태를 다시 확인해야 하며, merge·배포·운영 활성화는 별도 게이트다. 이 기록은 실제 모델 품질, 실제 SMS, 운영 데이터 변경, 배포 또는 운영 활성화를 의미하지 않는다.

## GitGuardian history remediation — latest

- Rewrote the PR-only history so the target-choice fixture uses low-entropy synthetic identifiers for the Q, S and T variants.
- Reachable branch history contains zero `SYN_DUP_CLIENT_Q*`, `SYN_DUP_CLIENT_S*` or `SYN_DUP_CLIENT_T*` literals; the source-tree change is limited to `evals/conversation/cases.ts`.
- Deterministic harness rerun: **48/48 passed**, with zero network, transport or safety errors. Updated digests are fixture `24ab8fb9498ba7472972c6d3a66b2d19274bc47787f96e5f34e9d8a1abc97d4a` and assertion `8c6070f04f167f22e211d113d0fe6e64b2af8491057f861609f8d5d8c2042af4`.
- History merge `89789eb1e961708f10f68a7a48578d6def7f9f27` restores `dev` as the PR parent. The rewritten branch has not been pushed yet; GitGuardian must be rechecked after the force-with-lease update. No bypass is used.


## 재현한 검증

- Backend: 395 suites passed, 1 skipped; 5,691 tests passed, 44 skipped; 1 snapshot passed.
- Guarded PostgreSQL/AppModule agent E2E: latest task-focused run 11 suites, 158 tests passed; cumulative carrier run 14 suites, 192 tests passed.
- Deterministic conversation harness: 48 of 48 passed, zero network/transport/safety errors.
- Fixture remediation: flagged target-choice identifiers were replaced with low-entropy synthetic identifiers; focused conversation evaluator/runtime tests passed **2 suites, 25 tests**. Updated harness digests are fixture `d086f8cd41611d2242d84977d13b28788b5791fee980f3c935e563124e935c14` and assertion `832898bdd58a2eae06b826821688f72b15b03f6ecf167e94308d8d5ec59bf91d`.
- Capability manifest and drift: 47 capabilities passed.
- Frontend and mobile type-check: passed.
- Frontend and mobile lint: exit 0, existing warnings only.
- Frontend production build: passed.
- Mobile production build: passed with a loopback `NEXT_PUBLIC_API_BASE_URL` process value.
- Authenticated synthetic browser: desktop Release A 1 passed and 1 intentional skip; mobile real-backend 1 passed.
- Production dependency audit and changed-diff secret scan: clean.
- Remote PR checks: substantive CI and advisory browser checks passed; GitGuardian remains the only failing required check. It reports eight historical generic high-entropy findings from the original synthetic fixture commit `8ddcb4d80a7d93168f18c0346f1a85450d5e79de`; the current fixture values were sanitized, but the historical findings still block the check. Vercel entries are preview checks, and deployment jobs were skipped by workflow conditions.

## Release gates

1. Keep the feature flag and task creation disabled by default.
2. Promote only through the protected branch sequence: feature branch, `dev`, preview verification, then `main`.
3. Before any environment promotion, rerun the backend regression, capability drift, deterministic harness and authenticated browser checks against the target environment with vendor stubs or isolated recipients.
4. Paid Google/OpenAI evaluation must be a separate, explicitly configured staging run. Record model, prompt, context, fixture version, latency, cost and redacted results. Do not use production customer data.
5. SMS validation must use the existing stub and execution evidence. Real recipients require a separate operational approval.

## Rollback

- Disable new task creation and review proposal issuance with the existing emergency/feature control.
- Keep action status lookup, uncertain-result reconciliation and existing recovery paths enabled.
- Do not drop the new task tables or delete uncertain action evidence during rollback.
- Reconcile any in-flight action from its persisted execution evidence before re-enabling the feature.

## Evidence boundary

This document proves local deterministic verification, synthetic authenticated browser behavior and the listed remote CI results. It does not prove merge, deployment health, production database migration, real provider quality, real SMS delivery or operational activation. No paid Google/OpenAI request, production SMS, production database change or feature activation was performed.
