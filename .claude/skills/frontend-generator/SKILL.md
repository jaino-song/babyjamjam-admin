---
name: frontend-generator
description: |
  Next.js + TanStack Query + Tailwind 프론트엔드 생성/수정 스킬. App Router + Server Components 패턴을 적용합니다.
  
  트리거: "프론트엔드만 만들어줘", "웹 UI 만들어줘", "Next.js 앱 만들어줘", "프론트엔드 수정해줘", "화면 추가해줘"
  
  전체 풀스택 프로젝트가 필요하면 fullstack-orchestrator 스킬을 사용하세요.
---

# Frontend Generator

Next.js + TanStack Query + Tailwind 기반 프론트엔드를 생성하거나 수정합니다.

## 필수 제약 사항

```
✅ Next.js App Router 필수
✅ TanStack Query (서버 상태)
✅ Zustand (클라이언트 상태)
✅ Tailwind CSS
❌ Pages Router 사용 불가
❌ Redux, MobX 사용 불가
```

---

## 워크플로우

### Step 0: 작업 유형 확인 (필수)

```markdown
## 🎯 프론트엔드 작업 유형

어떤 작업을 도와드릴까요? (번호로 선택)

| # | 유형 | 설명 |
|:-:|------|------|
| 1 | **🆕 신규 생성** | 새 프론트엔드 프로젝트 생성 |
| 2 | **🔧 기존 수정** | 기존 프로젝트 수정/확장 |
```

### [기존 수정 선택 시] 추가 질문:

```markdown
1. **프로젝트 경로**: ___
2. **현재 구조**: 1) App Router + TanStack Query 2) App Router (기본) 3) Pages Router 4) 모르겠음
3. **수정 범위**: 1) 새 페이지 추가 2) UI 수정 3) 상태관리 추가 4) API 연동 5) 스타일링
4. **디자인 참조**: 1) Figma 있음 2) 레퍼런스 있음 3) 없음
```

### Step 1: 요구사항 확인

```markdown
## 프론트엔드 요구사항

1. **서비스 설명**: 어떤 서비스인가요?
2. **주요 페이지**: (예: 홈, 대시보드, 프로필)
3. **인증 UI**: 1) 로그인/회원가입 2) OAuth 버튼 3) 인증 불필요
4. **디자인 참조**: 1) Figma 링크 2) 레퍼런스 사이트 3) 없음
5. **추가 기능**: 1) 다국어 2) 다크모드 3) 애니메이션 4) 차트
```

### Step 2: 디자인 분석 (선택)

Figma 또는 레퍼런스 제공 시:

- `references/figma-guide.md` - Figma 사용 시
- `references/ui-design-analyzer.md` - 레퍼런스 분석 시
- `references/ui-design/*` - 디자인 토큰 생성 시

---

## 아키텍처

**Next.js App Router 구조:**

```
apps/web/
├── src/
│   ├── app/                    # App Router
│   │   ├── (auth)/            # 인증 페이지 그룹
│   │   ├── (main)/            # 메인 페이지 그룹
│   │   ├── api/               # API Proxy Routes
│   │   ├── layout.tsx         # Root Layout
│   │   └── page.tsx           # Home Page
│   ├── components/            # 컴포넌트
│   │   ├── ui/               # 공통 UI (Button, Input 등)
│   │   ├── layout/           # 레이아웃 (Header, Footer 등)
│   │   └── features/         # 기능별 컴포넌트
│   ├── hooks/                 # Custom Hooks
│   ├── lib/                   # 유틸리티
│   │   ├── api/              # API 클라이언트
│   │   └── utils/            # 헬퍼 함수
│   └── stores/                # Zustand 스토어
├── public/                    # 정적 파일
├── tailwind.config.ts
└── package.json
```

---

## 참조 문서

| 문서 | 조건 | 경로 |
|------|------|------|
| Next.js 가이드 | 항상 | `references/nextjs-guide.md` |
| 컴포넌트 시스템 | 항상 | `references/component-system.md` |
| API & State | 항상 | `references/api-state.md` |
| Figma 가이드 | Figma 사용 시 | `references/figma-guide.md` |
| UI 분석기 | 레퍼런스 분석 시 | `references/ui-design-analyzer.md` |
| UI 디자인 | 디자인 토큰 시 | `references/ui-design/*.md` |

---

## API 통신 패턴 (중요)

**클라이언트 → Next.js API Route → 백엔드** 패턴 필수:

```typescript
// ❌ 잘못된 방식: 클라이언트에서 직접 백엔드 호출
const data = await axios.get('https://api.example.com/users');

// ✅ 올바른 방식: API Proxy 경유
const data = await axios.get('/api/users');
```

```typescript
// app/api/users/route.ts
export async function GET() {
  const res = await fetch(`${process.env.BACKEND_URL}/users`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return Response.json(await res.json());
}
```

---

## 검증

```bash
# TypeScript 체크
pnpm exec tsc --noEmit

# 린트
pnpm lint

# 빌드 확인
pnpm build
```

---

## structure.md 템플릿 (필수 생성)

```markdown
# Frontend Structure

> 생성일: {날짜}

## 기술 스택
- **Framework**: Next.js (App Router)
- **State**: TanStack Query + Zustand
- **Styling**: Tailwind CSS

## 페이지 구조
| 경로 | 설명 | 인증 |
|------|------|:----:|
| / | 홈 | - |
| /login | 로그인 | - |
| /dashboard | 대시보드 | ✓ |

## 컴포넌트
| 컴포넌트 | 위치 | 설명 |
|----------|------|------|
| Button | components/ui | 공통 버튼 |

## API Routes
| Route | Method | Backend |
|-------|--------|---------|
| /api/auth/login | POST | /auth/login |
```

---

## 금지 사항

- ❌ Backend 코드 생성
- ❌ 사용자 확인 없이 기존 코드 수정
- ❌ 클라이언트에서 직접 백엔드 API 호출
- ❌ Pages Router 사용
- ❌ Redux, MobX 사용

---

## 완료 체크리스트

### 신규 생성
- [ ] 프로젝트 구조 생성
- [ ] 주요 페이지 구현
- [ ] 공통 컴포넌트 구현
- [ ] API Proxy 설정
- [ ] Tailwind 설정
- [ ] TypeScript 빌드 성공
- [ ] **structure.md 생성**

### 기존 수정
- [ ] 기존 구조 분석 완료
- [ ] 수정 범위 사용자 확인
- [ ] 코드 수정 완료
- [ ] 변경 사항 문서화
