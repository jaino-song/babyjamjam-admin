# Project Implementation Plan Template

> Phase 0에서 사용자와 함께 작성하는 프로젝트 계획서

## 📋 프로젝트 개요

### 기본 정보

| 항목 | 내용 |
|------|------|
| 프로젝트명 | `{project-name}` |
| 설명 | {one-line-description} |
| 생성일 | {date} |

### 서비스 유형 (번호로 선택)

1) B2C 서비스 (소비자 대상)
2) B2B SaaS (기업 대상)
3) 커뮤니티/소셜
4) 마켓플레이스
5) 기타: ___________

---

## 🎯 핵심 기능

### 필수 기능 (MVP)

1. **{feature-1}**: {description}
2. **{feature-2}**: {description}
3. **{feature-3}**: {description}

### 추가 기능 (Post-MVP)

1. **{feature-4}**: {description}
2. **{feature-5}**: {description}

---

## 👥 사용자 유형

| 역할 | 설명 | 권한 |
|------|------|------|
| User | 일반 사용자 | 기본 기능 접근 |
| Admin | 관리자 | 모든 기능 + 관리 |
| {role} | {description} | {permissions} |

---

## 📊 데이터 모델

### 핵심 엔티티

```
User
├── id: UUID
├── email: string (unique)
├── name: string
├── role: enum (USER, ADMIN)
├── createdAt: DateTime
└── updatedAt: DateTime

{Entity2}
├── id: UUID
├── {field1}: {type}
├── {field2}: {type}
└── {relations}

{Entity3}
├── id: UUID
├── {field1}: {type}
└── {relations}
```

### 엔티티 관계

```
User 1:N {Entity2}
{Entity2} N:M {Entity3}
```

---

## 🔐 인증/인가

### 인증 방식 (복수 선택 가능, 쉼표로 구분)

1) 이메일/비밀번호
2) OAuth - Kakao
3) OAuth - Google
4) OAuth - Apple
5) Magic Link

### 인가 전략 (번호로 선택)

1) Role-based (RBAC)
2) Permission-based
3) Attribute-based (ABAC)

---

## 💳 결제 (선택)

### 결제 제공자 (번호로 선택)

1) 해당 없음
2) TossPayments (국내)
3) Stripe (글로벌)

### 결제 유형 (복수 선택 가능, 쉼표로 구분)

1) 일회성 결제
2) 정기 구독
3) 사용량 기반

---

## 🖥️ 플랫폼 선택

### 클라이언트 (번호로 선택)

1) Web Only: Next.js
2) Mobile Only: Expo (React Native)
3) Both: Next.js + Expo

### 관리자

- Admin Dashboard (필수)

---

## 🎨 UI 디자인 방향

### 디자인 소스 (번호로 선택)

1) 레퍼런스 URL 제공: {url}
2) AI 생성: 아래 선호도 기반

### 선호도 (AI 생성 시)

| 항목 | 선택 |
|------|------|
| 전체 톤 | 모던 / 클래식 / 미니멀 |
| 주요 색상 | {color} |
| 보조 색상 | {color} |
| 폰트 스타일 | 산세리프 / 세리프 |
| 레이아웃 | 카드형 / 리스트형 / 그리드형 |

---

## 📱 Phase 실행 계획

```
Phase 0: 계획 수립 ✅
    ↓
Phase 1: Backend (NestJS)
    - 예상 엔티티: {count}개
    - 예상 UseCase: {count}개
    ↓
Phase 2: Frontend (Next.js) [웹 선택 시]
    - 예상 페이지: {count}개
    - 예상 컴포넌트: {count}개
    ↓
Phase 3: Mobile (Expo) [앱 선택 시]
    - 예상 스크린: {count}개
    ↓
Phase 4: Admin (Next.js + shadcn)
    - CRUD 대상: {entities}
    ↓
Phase 5: Analytics (PostHog)
    - 주요 이벤트: {count}개
```

---

## 🔗 외부 연동

### 필수

- Supabase (DB + Auth)

### 선택 (복수 선택 가능, 쉼표로 구분)

1) 결제: TossPayments / Stripe
2) 분석: PostHog
3) 이메일: Resend / SendGrid
4) 파일 저장: Supabase Storage / S3
5) AI: OpenAI / Anthropic

---

## ✅ 확인 사항

- [ ] 모든 필수 항목 작성 완료
- [ ] 사용자 역할 정의 완료
- [ ] 핵심 엔티티 정의 완료
- [ ] 플랫폼 선택 완료
- [ ] UI 방향 결정 완료

---

*이 문서는 Phase 0에서 생성되어 모든 Phase에서 참조됩니다.*
