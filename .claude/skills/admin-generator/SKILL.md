---
name: admin-generator
description: |
  Next.js + shadcn/ui 어드민 대시보드 생성/수정 스킬. RBAC (Role-Based Access Control) 권한 관리를 포함합니다.
  
  트리거: "어드민 만들어줘", "관리자 페이지 만들어줘", "백오피스 만들어줘", "어드민 수정해줘", "관리자 대시보드 추가해줘"
  
  전체 풀스택 프로젝트가 필요하면 fullstack-orchestrator 스킬을 사용하세요.
---

# Admin Generator

Next.js + shadcn/ui 기반 어드민 대시보드를 생성하거나 수정합니다.

## 필수 제약 사항

```
✅ Next.js App Router
✅ shadcn/ui 컴포넌트
✅ TanStack Table (DataTable)
✅ Zod 스키마 검증
✅ RBAC 권한 관리
```

---

## 워크플로우

### Step 0: 작업 유형 확인 (필수)

```markdown
## 🎯 어드민 작업 유형

어떤 작업을 도와드릴까요? (번호로 선택)

| # | 유형 | 설명 |
|:-:|------|------|
| 1 | **🆕 신규 생성** | 새 어드민 대시보드 생성 |
| 2 | **🔧 기존 수정** | 기존 어드민 수정/확장 |
```

### [기존 수정 선택 시] 추가 질문:

```markdown
1. **프로젝트 경로**: ___
2. **현재 구조**: 1) (admin) route group 2) /admin 라우트 3) 별도 앱 4) 모르겠음
3. **수정 범위**: 1) 새 페이지 2) 기존 수정 3) 권한 시스템 4) DataTable 5) 위젯
4. **코드 분석 필요**: 1) 네 2) 아니요
```

### Step 1: 요구사항 확인

```markdown
## 어드민 요구사항

1. **관리할 리소스**: (예: 사용자, 상품, 주문)
2. **사용자 역할**: 1) Admin 2) Manager 3) Viewer 4) 커스텀
3. **필요한 기능**: 1) 대시보드 2) 사용자 관리 3) 콘텐츠 관리 4) 주문 관리 5) 설정 6) 로그
4. **UI 요구사항**: 1) 사이드바 2) 다크모드 3) 반응형 4) 페이지네이션 5) 필터/검색
```

---

## 아키텍처

**어드민 라우트 구조:**

```
apps/admin/
├── src/
│   ├── app/
│   │   ├── layout.tsx        # Root 레이아웃
│   │   ├── page.tsx          # 대시보드
│   │   ├── users/
│   │   │   ├── page.tsx      # 사용자 목록
│   │   │   └── [id]/page.tsx # 사용자 상세
│   │   ├── products/
│   │   │   └── page.tsx
│   │   └── settings/
│   │       └── page.tsx
│   ├── components/
│   │   ├── layout/           # 레이아웃 컴포넌트
│   │   │   ├── Sidebar.tsx
│   │   │   └── Header.tsx
│   │   ├── tables/           # DataTable 컴포넌트
│   │   ├── forms/            # 폼 컴포넌트
│   │   └── ui/               # shadcn/ui
│   ├── hooks/
│   │   └── useAdminAuth.ts
│   └── lib/
│       ├── api/
│       └── rbac/             # 권한 관리
└── package.json
```

---

## 참조 문서

| 문서 | 조건 | 경로 |
|------|------|------|
| Admin 가이드 | 항상 | `references/admin-guide.md` |
| Admin 컴포넌트 | 항상 | `references/admin-components.md` |
| Admin 인증 | 권한 관리 시 | `references/admin-auth.md` |
| Admin 대시보드 | 대시보드 생성 시 | `references/admin-dashboard.md` |
| Admin API | API 연동 시 | `references/admin-api.md` |

---

## 핵심 컴포넌트

### DataTable

```tsx
'use client';
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
} from '@tanstack/react-table';

export function DataTable<TData>({ columns, data }: Props<TData>) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  // ... render
}
```

### 권한 가드

```tsx
'use client';

interface RoleGuardProps {
  allowedRoles: Role[];
  children: React.ReactNode;
}

export function RoleGuard({ allowedRoles, children }: RoleGuardProps) {
  const { user } = useAuth();
  
  if (!user || !allowedRoles.includes(user.role)) {
    return <AccessDenied />;
  }
  
  return <>{children}</>;
}
```

---

## 검증

```bash
# 타입 체크
pnpm exec tsc --noEmit

# 빌드
pnpm build
```

---

## structure.md 템플릿 (필수 생성)

```markdown
# Admin Structure

> 생성일: {날짜}

## 기술 스택
- **Framework**: Next.js (App Router)
- **UI**: shadcn/ui
- **Table**: TanStack Table
- **Auth**: RBAC

## 페이지 구조
| 경로 | 설명 | 권한 |
|------|------|------|
| / | 대시보드 | Admin, Manager |
| /users | 사용자 관리 | Admin |
| /settings | 설정 | Admin |

## 역할 정의
| 역할 | 권한 |
|------|------|
| Admin | 전체 접근 |
| Manager | 콘텐츠 관리 |
| Viewer | 읽기 전용 |
```

---

## 금지 사항

- ❌ 백엔드 코드 생성
- ❌ 사용자 확인 없이 기존 코드 수정
- ❌ 민감정보 평문 노출 (마스킹 필수)
- ❌ 권한 검증 없는 관리 기능
- ❌ 접근성 미고려 UI

---

## 완료 체크리스트

### 신규 생성
- [ ] 라우트 구조 생성
- [ ] 공통 레이아웃 (사이드바, 헤더)
- [ ] 권한 가드 구현
- [ ] DataTable 컴포넌트
- [ ] 대시보드 페이지
- [ ] 관리 페이지들
- [ ] 반응형 스타일링
- [ ] **structure.md 생성**

### 기존 수정
- [ ] 기존 구조 분석 완료
- [ ] 수정 범위 사용자 확인
- [ ] 코드 수정 완료
- [ ] 변경 사항 문서화
