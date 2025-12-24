---
name: fullstack-architecture
description: Next.js + React Native Expo + NestJS 풀스택 프로젝트 생성기. 요구사항(Requirements)과 산출물(Deliverables)을 입력하면 아키텍처 표준에 맞는 코드를 생성. "~~ 서비스 만들어줘", "~~ 페이지 추가해줘", "~~ 기능 구현해줘" 같은 요청 시 사용. 보안, 확장성, 테스트를 고려한 엔터프라이즈급 코드 생성.
---

# Fullstack Architecture Generator

요구사항을 받아 Next.js + Expo + NestJS 풀스택 코드를 생성하는 Skill.

## 사용 시점

1. **새 서비스 생성**: "Todo 앱 만들어줘", "이커머스 서비스 구축해줘"
2. **기능 추가**: "결제 기능 추가해줘", "OAuth 로그인 구현해줘"
3. **페이지 생성**: "/products 페이지 만들어줘", "대시보드 추가해줘"
4. **API 구현**: "사용자 CRUD API 만들어줘"
5. **Figma → 코드**: "이 Figma 디자인으로 컴포넌트 만들어줘"

## 워크플로우

### A. 요구사항 → 코드 생성

```
[1] 요구사항 분석 → [2] 아키텍처 설계 → [3] 코드 생성 → [4] 테스트 생성
```

### B. Figma → 코드 생성

```
[1] Figma 노드 파싱 → [2] 레이아웃 분석 → [3] Tailwind 매핑 → [4] 컴포넌트 생성 → [5] testId 추가
```

Figma MCP 도구로 디자인 컨텍스트를 받으면:
1. Auto Layout → Flexbox 변환
2. 색상 → Design Token 매핑
3. 타이포그래피 → Tailwind 클래스 변환
4. 기존 컴포넌트 시스템과 매칭
5. testId 자동 생성

상세 규칙: `references/figma-to-tailwind.md`

### Step 1: 요구사항 분석

사용자 입력에서 추출:
- **Routes**: 필요한 페이지/화면 목록
- **Features**: 핵심 기능 목록
- **Entities**: 데이터 모델
- **Platforms**: web / mobile / both

### Step 2: 아키텍처 설계

References 참조하여 설계:
- `architecture.md` → 전체 구조
- `security.md` → 인증이 필요한 경우
- `backend-nestjs.md` → API 설계
- `frontend-nextjs.md` / `mobile-expo.md` → 클라이언트 구조

### Step 3: 코드 생성

생성 순서:
1. **Backend**: Entity → Repository → Service → Controller → DTO
2. **Shared**: Types → Validators → API Client
3. **Frontend**: Pages → Components → Hooks → Stores
4. **Mobile**: Screens → Components → Hooks (if needed)

References 참조:
- `component-system.md` → UI 컴포넌트
- `api-state.md` → API 호출 & 상태 관리
- `standards.md` → 네이밍 & 코드 스타일

### Step 4: 테스트 생성

- `testing.md` → E2E 테스트 (Playwright)
- Page Object Model 패턴 적용
- testId 컨벤션 준수

## 입력 형식

### 간단한 요청
```
Todo 앱 만들어줘
- 할 일 추가/수정/삭제
- 완료 체크
- 로그인 필요
```

### 상세한 요청
```
## Requirements
- 사용자는 상품을 검색하고 장바구니에 담을 수 있다
- 카카오/네이버 로그인 지원
- 결제는 토스페이먼츠 연동

## Routes
- / (홈)
- /products (상품 목록)
- /products/[id] (상품 상세)
- /cart (장바구니)
- /checkout (결제)
- /orders (주문 내역)

## Deliverables
- [x] Web (Next.js)
- [x] Mobile (Expo)
- [x] Backend (NestJS)
- [x] E2E Tests
```

## 출력 구조

```
{project-name}/                   # 프로젝트명 (kebab-case)
├── apps/
│   ├── web/
│   │   ├── src/
│   │   │   ├── app/              # Routes
│   │   │   ├── features/         # Feature modules
│   │   │   └── shared/           # Components
│   │   └── e2e/                  # Playwright tests
│   ├── mobile/
│   │   └── src/
│   │       ├── app/              # Expo Router
│   │       └── features/
│   └── backend/
│       └── src/
│           ├── modules/          # DDD modules
│           └── shared/
└── packages/
    ├── types/                    # Shared types
    └── validators/               # Zod schemas
```

**폴더명 규칙:**
- 프로젝트명을 kebab-case로 변환
- 예: "Todo App" → `todo-app/`
- 예: "Fiterview" → `fiterview/`
- 예: "E-commerce Platform" → `e-commerce-platform/`

## 기술 스택

| Layer | Technology |
|-------|------------|
| Web | Next.js 14+, TypeScript, Tailwind, Framer Motion |
| Mobile | Expo Router, React Native |
| Backend | NestJS, Prisma, PostgreSQL |
| State | TanStack Query, Zustand, Axios |
| Validation | Zod |
| Testing | Playwright, Vitest |

## Reference 가이드

### 선택적 로드 (토큰 최적화)

**모든 reference를 로드하지 말 것.** 상황에 맞는 파일만 로드:

```
필수 (항상 로드):
├── generation-workflow.md
└── templates.md

조건부 로드:
├── Backend 포함 → backend-nestjs.md, security.md
├── Web 포함 → frontend-nextjs.md, component-system.md
├── Mobile 포함 → mobile-expo.md
├── E2E 포함 → testing.md
├── Figma 입력 → figma-to-tailwind.md
└── 첫 요청 시 → request-guide.md
```

### Reference 목록

| 주제 | 파일 | 로드 조건 |
|------|------|----------|
| 요청 작성 | `request-guide.md` | 첫 요청 분석 시 |
| 전체 구조 | `architecture.md` | 새 프로젝트 시 |
| 보안 | `security.md` | 인증 포함 시 |
| 백엔드 | `backend-nestjs.md` | Backend 생성 시 |
| 웹 | `frontend-nextjs.md` | Web 생성 시 |
| 모바일 | `mobile-expo.md` | Mobile 생성 시 |
| 컴포넌트 | `component-system.md` | UI 생성 시 |
| API/상태 | `api-state.md` | 프론트 생성 시 |
| 테스트 | `testing.md` | E2E 생성 시 |
| DevOps | `devops.md` | 배포 설정 시 |
| 표준 | `standards.md` | 코드 리뷰 시 |
| 생성 워크플로우 | `generation-workflow.md` | **항상** |
| 템플릿 | `templates.md` | **항상** |
| Figma 변환 | `figma-to-tailwind.md` | Figma 입력 시 |

## 생성 규칙

1. **모든 컴포넌트에 testId 추가** → E2E 테스트 연동
2. **Backend API 먼저 설계** → 프론트는 API 기반으로 생성
3. **타입은 packages/types에** → 프론트/백 공유
4. **Zod 스키마는 packages/validators에** → 양쪽 검증
5. **E2E 테스트 필수 생성** → 핵심 User Journey 커버
