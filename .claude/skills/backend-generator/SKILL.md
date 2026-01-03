---
name: backend-generator
description: |
  NestJS + Prisma 백엔드 생성/수정 스킬. Clean Architecture + DDD 패턴을 적용하여 API 서버를 구현합니다.
  
  트리거: "백엔드만 만들어줘", "NestJS API 만들어줘", "서버만 개발해줘", "백엔드 수정해줘", "API 추가해줘"
  
  전체 풀스택 프로젝트가 필요하면 fullstack-orchestrator 스킬을 사용하세요.
---

# Backend Generator

NestJS + Prisma + PostgreSQL 기반 백엔드를 생성하거나 수정합니다.

## 필수 제약 사항

```
❌ Supabase 단독 사용 불가
❌ Firebase 사용 불가
❌ Serverless Functions 단독 사용 불가
✅ NestJS + Prisma + PostgreSQL 필수
```

> Supabase는 Auth, Storage 등 보조 서비스로만 사용 가능

---

## 워크플로우

### Step 0: 작업 유형 확인 (필수)

```markdown
## 🎯 백엔드 작업 유형

어떤 작업을 도와드릴까요? (번호로 선택)

| # | 유형 | 설명 |
|:-:|------|------|
| 1 | **🆕 신규 생성** | 새 백엔드 프로젝트 생성 |
| 2 | **🔧 기존 수정** | 기존 프로젝트 수정/확장 |
```

### [기존 수정 선택 시] 추가 질문:

```markdown
1. **프로젝트 경로**: ___
2. **현재 아키텍처**: 1) Clean Architecture 2) 일반 NestJS 3) 모르겠음
3. **수정 범위**: 1) 새 모듈 추가 2) API 수정 3) 인증 추가 4) 결제 추가 5) 리팩토링
4. **코드 분석 필요**: 1) 네 2) 아니요
```

### Step 1: 요구사항 확인

```markdown
## 백엔드 요구사항

1. **서비스 설명**: 어떤 서비스인가요?
2. **주요 엔티티**: (예: User, Product, Order)
3. **인증 방식**: 1) 이메일/비밀번호 2) OAuth 3) 둘 다 4) 인증 불필요
4. **추가 기능**: 1) 결제 2) 파일 업로드 3) 실시간 알림 4) AI/LLM 연동
5. **Database**: 1) PostgreSQL (Supabase) 2) PostgreSQL (Self-hosted)
```

### Step 2: 아키텍처

**Clean Architecture 레이어:**

```
src/
├── domain/               # 핵심 비즈니스 로직
│   ├── entities/         # 도메인 엔티티
│   ├── value-objects/    # 값 객체
│   └── ports/            # Repository 인터페이스
├── application/          # 유스케이스
│   ├── commands/         # 쓰기 작업
│   └── queries/          # 읽기 작업
├── infrastructure/       # 외부 시스템 연동
│   ├── prisma/           # Prisma 어댑터
│   ├── auth/             # 인증 구현체
│   └── external/         # 외부 API
└── presentation/         # API 레이어
    ├── controllers/      # HTTP 컨트롤러
    └── dto/              # Request/Response DTO
```

---

## 참조 문서

기능에 따라 해당 문서를 읽어야 합니다:

| 문서 | 조건 | 경로 |
|------|------|------|
| NestJS 가이드 | 항상 | `references/nestjs-guide.md` |
| 보안 가이드 | 항상 | `references/security.md` |
| OAuth 가이드 | OAuth 선택 시 | `references/oauth-guide.md` |
| Supabase 가이드 | Supabase 선택 시 | `references/supabase-guide.md` |
| LLM 가이드 | AI 연동 시 | `references/llm-guide.md` |

---

## 구현 순서

```
1. Prisma Schema 정의 (implementation-plan.md 기반)
2. Auth 모듈 구현 (security.md 참조)
3. 각 도메인 모듈 구현 (nestjs-guide.md 참조)
4. API 엔드포인트 연결
5. 기본 테스트 작성
```

---

## Output 구조

```
apps/backend/
├── src/
│   ├── domain/
│   ├── application/
│   ├── infrastructure/
│   └── presentation/
├── prisma/
│   └── schema.prisma
├── test/
├── .env.example
├── package.json
└── docs/
    └── backend-structure.md    # 필수 생성
```

---

## structure.md 템플릿 (필수 생성)

```markdown
# Backend Structure

> 생성일: {날짜}

## 아키텍처
- **패턴**: DDD + Clean Architecture
- **프레임워크**: NestJS
- **ORM**: Prisma
- **인증**: JWT (Access + Refresh Token)

## 모듈 구조
| 모듈 | 역할 | 주요 API |
|------|------|----------|
| auth | 인증/인가 | POST /auth/login, POST /auth/register |
| user | 사용자 관리 | GET /users/me, PATCH /users/me |

## API 엔드포인트 요약
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /auth/login | - | 로그인 |

## 환경 변수
| Key | Description | Required |
|-----|-------------|:--------:|
| DATABASE_URL | DB 연결 문자열 | ✓ |
| JWT_SECRET | JWT 시크릿 | ✓ |
```

---

## 검증

```bash
# Prisma 스키마 검증
npx prisma validate

# 테스트 실행
pnpm test

# 빌드 확인
pnpm build
```

---

## 코드 표준

- **아키텍처**: DDD + Clean Architecture
- **레이어**: presentation → application → domain → infrastructure
- **인증**: JWT + Refresh Token
- **검증**: class-validator + Zod
- **ORM**: Prisma

---

## 금지 사항

- ❌ Frontend 코드 생성
- ❌ 사용자 확인 없이 기존 코드 수정
- ❌ 보안 규칙 위반 (평문 비밀번호, SQL Injection)
- ❌ 테스트 없는 UseCase 생성

---

## 완료 체크리스트

### 신규 생성
- [ ] Prisma 스키마 생성
- [ ] 모든 Entity/UseCase 구현
- [ ] 인증 시스템 구현 (필요 시)
- [ ] API 엔드포인트 테스트
- [ ] .env.example 작성
- [ ] **structure.md 생성**

### 기존 수정
- [ ] 기존 구조 분석 완료
- [ ] 수정 범위 사용자 확인
- [ ] 코드 수정 완료
- [ ] 영향받는 테스트 업데이트
- [ ] 변경 사항 문서화
