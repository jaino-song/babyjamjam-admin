# BabyJamJam 대화형 업무 AI v1.0 릴리스 준비 기록

작성일: 2026-09-18  
통합 worktree: `/Users/jaino/Development/babyjamjam-admin/bjj-conversation-v1`  
통합 브랜치: `codex/bjj-conversation-v1`  
검증 기준 커밋: `defc787667df8a5db624fdd5e4a3df4b5ad3b7ef`

## 현재 판정

로컬 합성 데이터와 vendor stub을 사용한 구현·결정적 검증은 통과했다. PR [#716](https://github.com/jaino-song/babyjamjam-admin/pull/716)의 backend, full-flow, call-inbox, auth observe/enforce, frontend, mobile, shared, OSV 및 advisory browser 검사는 통과했다. GitGuardian 필수 검사는 계속 실패해 merge가 차단되어 있다. 이 기록은 실제 모델 품질, 실제 SMS, 운영 데이터 변경, 배포 또는 운영 활성화를 의미하지 않는다.

## 재현한 검증

- Backend: 395 suites passed, 1 skipped; 5,691 tests passed, 44 skipped; 1 snapshot passed.
- Guarded PostgreSQL/AppModule agent E2E: latest task-focused run 11 suites, 158 tests passed; cumulative carrier run 14 suites, 192 tests passed.
- Deterministic conversation harness: 48 of 48 passed, zero network/transport/safety errors.
- Capability manifest and drift: 47 capabilities passed.
- Frontend and mobile type-check: passed.
- Frontend and mobile lint: exit 0, existing warnings only.
- Frontend production build: passed.
- Mobile production build: passed with a loopback `NEXT_PUBLIC_API_BASE_URL` process value.
- Authenticated synthetic browser: desktop Release A 1 passed and 1 intentional skip; mobile real-backend 1 passed.
- Production dependency audit and changed-diff secret scan: clean.
- Remote PR checks: substantive CI and advisory browser checks passed; GitGuardian remains the only failing required check. Vercel entries are preview checks, and deployment jobs were skipped by workflow conditions.

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
