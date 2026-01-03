---
name: fullstack-orchestrator
description: |
  E2E 풀스택 프로젝트 조율 스킬. Phase 0에서 계획 수립 후, 각 Phase별 스킬(backend/frontend/mobile/admin/analytics)을 순차 호출하여 완전한 프로젝트를 생성합니다.
  
  트리거: "앱 만들어줘", "서비스 개발해줘", "프로젝트 시작해줘", "풀스택 프로젝트 만들어줘"
  
  이 스킬은 오케스트레이터 역할만 수행하며, 직접 코드를 생성하지 않습니다. 계획 수립 후 각 Phase를 담당 스킬에 위임합니다.
---

# Fullstack Orchestrator

> **오케스트레이터 역할**: 계획 수립 + Phase 스킬 호출 + 리뷰
> 직접 코드를 생성하지 않습니다.

## Phase 구조

```
Phase 0: Orchestrator (계획 수립)
    └─ 요구사항 수집 → 플랫폼 선택 → UI 방향 → Plan 생성
Phase 1: backend-generator ← Task 호출
    └─ NestJS + Prisma + Clean Architecture
Phase 2: frontend-generator ← Task 호출 (웹 선택 시)
    └─ Next.js + TanStack Query + Tailwind
Phase 3: mobile-generator ← Task 호출 (모바일 선택 시)
    └─ Expo Router + React Native
Phase 4: admin-generator ← Task 호출
    └─ Next.js + shadcn/ui Admin Dashboard
Phase 5: analytics-generator ← Task 호출
    └─ PostHog + Feature Flags
```

**직렬 구조**: 한 Phase 완료 → 리뷰 → 다음 Phase

---

## Phase 0: 계획 수립

### Step 1: 요구사항 수집

사용자에게 질문:

```markdown
프로젝트를 시작하기 전에 몇 가지 확인이 필요합니다:

1. **프로젝트명**: 어떤 이름으로 할까요?
2. **핵심 기능**: 어떤 서비스인가요? (예: 쇼핑몰, SaaS, 커뮤니티)
3. **주요 엔티티**: 핵심 데이터는 무엇인가요? (예: User, Product, Order)
4. **인증 방식**: 어떤 로그인을 지원할까요? (예: 이메일, Kakao OAuth)
5. **결제 기능**: 결제가 필요한가요? (Stripe/TossPayments)
```

### Step 2: 플랫폼 선택

```markdown
어떤 플랫폼을 개발할까요? (번호로 선택)

1) 웹만 (Web Only) - Phase 2 실행, Phase 3 건너뜀
2) 앱만 (Mobile Only) - Phase 3 실행, Phase 2 건너뜀
3) 둘 다 (Web + Mobile) - Phase 2, 3 모두 실행
```

### Step 3: UI 디자인 방향

```markdown
Frontend UI를 어떻게 만들까요? (번호로 선택)

1) 디자인 레퍼런스 제공 → URL을 주시면 분석합니다
2) AI가 디자인 생성 → 브랜드 톤, 선호 색상, 레이아웃 스타일 알려주세요
```

### Step 4: Plan 문서 생성

`assets/project-plan-template.md`와 `assets/dev-context-template.md`를 참조하여 생성:

```
docs/
├── implementation-plan.md    # 전체 계획
└── dev-context.md            # Phase간 컨텍스트
```

---

## Phase 스킬 호출 방법

각 Phase는 **Task 명령**으로 해당 스킬을 호출합니다.

### Phase 1 → backend-generator

```
Task: backend-generator 스킬을 사용해서 백엔드를 구현해줘.

Context:
- 프로젝트: {project-name}
- 계획서: docs/implementation-plan.md
- 엔티티: User, Product, Order
- 인증: OAuth (Kakao)

완료 조건:
- [ ] prisma/schema.prisma 생성
- [ ] 모든 UseCase 구현
- [ ] 테스트 통과
- [ ] apps/backend/structure.md 생성
```

### Phase 2 → frontend-generator

```
Task: frontend-generator 스킬을 사용해서 프론트엔드를 구현해줘.

Context:
- 프로젝트: {project-name}
- Backend API: apps/backend/structure.md 참조
- UI 디자인: docs/{project}-design-language.md

완료 조건:
- [ ] 모든 페이지 구현
- [ ] API 연동 완료
- [ ] apps/web/structure.md 생성
```

### Phase 3 → mobile-generator

```
Task: mobile-generator 스킬을 사용해서 모바일 앱을 구현해줘.

Context:
- 프로젝트: {project-name}
- Backend API: apps/backend/structure.md 참조
- 공유 타입: packages/types 참조

완료 조건:
- [ ] 모든 스크린 구현
- [ ] API 연동 완료
- [ ] apps/mobile/structure.md 생성
```

### Phase 4 → admin-generator

```
Task: admin-generator 스킬을 사용해서 어드민 패널을 구현해줘.

Context:
- 프로젝트: {project-name}
- Backend API: apps/backend/structure.md 참조
- RBAC: Admin, Manager 역할

완료 조건:
- [ ] 대시보드 구현
- [ ] CRUD 페이지 구현
- [ ] RBAC 적용
```

### Phase 5 → analytics-generator

```
Task: analytics-generator 스킬을 사용해서 분석을 통합해줘.

Context:
- 프로젝트: {project-name}
- 플랫폼: Web / Mobile

완료 조건:
- [ ] PostHog 설정
- [ ] Feature Flags 설정
- [ ] 이벤트 트래킹 구현
```

---

## Phase간 컨텍스트 공유

```
docs/
├── implementation-plan.md         # Phase 0에서 생성
├── dev-context.md                 # Phase간 공유 정보
└── {project}-design-language.md   # UI 디자인 토큰

apps/
├── backend/structure.md           # Phase 1 → 2, 3, 4가 참조
├── web/structure.md               # Phase 2 완료 시
├── mobile/structure.md            # Phase 3 완료 시
└── admin/structure.md             # Phase 4 완료 시
```

---

## Phase 완료 리뷰

| Phase | 리뷰 항목 |
|-------|----------|
| 1 | DDD 레이어 구조, Prisma 스키마, 테스트 커버리지 |
| 2 | 컴포넌트 구조, TanStack Query 사용, API Proxy 패턴 |
| 3 | Expo Router 구조, Secure Store 사용, Deep Link |
| 4 | RBAC 적용, DataTable 구현, Admin 전용 API |
| 5 | 보안 코드, Feature Flags, 이벤트 스키마 |

---

## 선택적 통합: 결제 기능

사용자가 결제 기능을 요청한 경우:

```
Task: payment-integration 스킬을 사용해서 결제를 통합해줘.

Context:
- Provider: TossPayments / Stripe
- 결제 유형: 일회성 / 구독
```

---

## 생성되는 Monorepo 구조

```
{project-name}/
├── apps/
│   ├── backend/           # Phase 1
│   ├── web/               # Phase 2 (웹 선택 시)
│   ├── mobile/            # Phase 3 (앱 선택 시)
│   └── admin/             # Phase 4
├── packages/
│   ├── types/             # 공유 타입
│   ├── utils/             # 공유 유틸
│   └── ui/                # 공유 UI (선택)
├── docs/
│   ├── implementation-plan.md
│   ├── dev-context.md
│   └── {project}-design-language.md
├── prisma/
│   └── schema.prisma
├── .env.example
└── README.md
```

---

## 금지 사항

- ❌ Orchestrator가 직접 코드 생성
- ❌ Phase 스킬 없이 구현 진행
- ❌ 리뷰 없이 다음 Phase 진행
- ❌ structure.md 생성 없이 Phase 완료
- ❌ dev-context.md 업데이트 없이 Phase 전환

---

## 검증

```bash
python3 scripts/project-completion-validator.py
```
