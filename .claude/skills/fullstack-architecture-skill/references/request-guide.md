# Project Request Guide

최고의 결과물을 얻기 위한 요청 작성 가이드.

## TL;DR

```
## 프로젝트명
[서비스 이름]

## 한 줄 설명
[무엇을 하는 서비스인지]

## 핵심 기능
1. [기능 1]
2. [기능 2]
3. [기능 3]

## 사용자 스토리
- [역할]은 [행동]을 할 수 있다

## Routes
- /path (설명) [public/protected]

## Entities
- EntityName: field1, field2, field3

## 플랫폼
- [ ] Web
- [ ] Mobile
- [ ] Backend
- [ ] E2E Tests

## 외부 연동
- [서비스명]: [용도]
```

---

## 상세 가이드

### 1. 프로젝트 개요

**필수 항목:**
- 프로젝트명 (영문, kebab-case 권장)
- 한 줄 설명

**좋은 예:**
```
## 프로젝트명
fiterview

## 한 줄 설명
AI 기반 모의면접 플랫폼. 이력서 분석 → 맞춤 질문 생성 → 실시간 면접 → 피드백 제공.
```

**피해야 할 예:**
```
## 프로젝트명
면접 앱  ← 영문 권장

## 한 줄 설명
면접 연습하는 앱  ← 너무 모호
```

---

### 2. 핵심 기능 정의

**작성 원칙:**
- 동사로 시작 (생성, 조회, 수정, 삭제, 분석, 전송 등)
- 구체적인 행동 명시
- 우선순위 순으로 나열

**좋은 예:**
```
## 핵심 기능
1. 이력서 PDF 업로드 및 텍스트 추출
2. GPT 기반 맞춤 면접 질문 생성 (직무별)
3. 음성 인식(STT)으로 답변 수집
4. 답변 분석 및 개선점 피드백
5. 면접 히스토리 저장 및 통계
```

**피해야 할 예:**
```
## 핵심 기능
1. 면접 기능  ← 무슨 기능?
2. AI 기능    ← 구체적이지 않음
3. 저장       ← 무엇을?
```

---

### 3. 사용자 스토리

**형식:**
```
[역할]은 [목적]을 위해 [행동]을 할 수 있다.
```

**좋은 예:**
```
## 사용자 스토리

### 인증
- 사용자는 카카오/네이버/구글 계정으로 로그인할 수 있다
- 사용자는 로그아웃할 수 있다
- 사용자는 회원 탈퇴할 수 있다

### 이력서
- 사용자는 PDF 이력서를 업로드할 수 있다
- 사용자는 업로드한 이력서 목록을 볼 수 있다
- 사용자는 이력서를 삭제할 수 있다

### 면접
- 사용자는 직무를 선택하고 면접을 시작할 수 있다
- 사용자는 질문에 음성으로 답변할 수 있다
- 사용자는 면접 중 다음 질문으로 넘어갈 수 있다
- 사용자는 면접을 중단할 수 있다

### 피드백
- 사용자는 면접 종료 후 답변별 피드백을 볼 수 있다
- 사용자는 전체 면접 점수를 볼 수 있다
- 사용자는 과거 면접 기록을 볼 수 있다
```

**스토리 체크리스트:**
```
□ CRUD 모두 정의했는가? (생성/조회/수정/삭제)
□ 예외 상황 고려했는가? (취소, 중단, 실패)
□ 권한별 차이가 있는가? (비회원/회원/관리자)
□ 상태 변경이 있는가? (시작→진행→완료)
```

---

### 4. Routes 정의

**형식:**
```
- /path (설명) [public/protected] [GET/POST 등]
```

**상세 예시:**
```
## Routes

### Public (로그인 불필요)
- / (랜딩 페이지)
- /login (로그인)
- /auth/callback (OAuth 콜백)

### Protected (로그인 필요)
- /dashboard (메인 대시보드)
- /resumes (이력서 목록)
- /resumes/upload (이력서 업로드)
- /interviews (면접 목록)
- /interviews/new (면접 시작 - 직무 선택)
- /interviews/[id] (면접 진행)
- /interviews/[id]/result (면접 결과)
- /settings (설정)
- /settings/profile (프로필 수정)

### API Routes (Backend)
- POST /api/resumes/upload (이력서 업로드)
- GET /api/resumes (이력서 목록)
- DELETE /api/resumes/[id] (이력서 삭제)
- POST /api/interviews (면접 생성)
- GET /api/interviews/[id] (면접 상세)
- POST /api/interviews/[id]/answer (답변 제출)
- POST /api/interviews/[id]/complete (면접 완료)
```

**Route 체크리스트:**
```
□ 동적 경로는 [param] 표기했는가?
□ public/protected 구분했는가?
□ 중첩 경로 구조가 논리적인가?
□ API 엔드포인트도 포함했는가?
```

---

### 5. Entities (데이터 모델)

**형식:**
```
EntityName:
  - fieldName: type (설명) [required/optional] [unique]
```

**상세 예시:**
```
## Entities

### User
- id: string (UUID) [required] [unique]
- email: string [required] [unique]
- name: string [required]
- profileImage: string [optional]
- provider: enum(kakao, naver, google) [required]
- providerId: string [required]
- createdAt: datetime [required]
- updatedAt: datetime [required]

### Resume
- id: string (UUID) [required] [unique]
- userId: string (FK → User) [required]
- fileName: string [required]
- fileUrl: string [required]
- extractedText: text [optional]
- analyzedAt: datetime [optional]
- createdAt: datetime [required]

### Interview
- id: string (UUID) [required] [unique]
- userId: string (FK → User) [required]
- resumeId: string (FK → Resume) [optional]
- jobType: enum(frontend, backend, fullstack, ...) [required]
- status: enum(pending, in_progress, completed, cancelled) [required]
- totalScore: number [optional]
- startedAt: datetime [optional]
- completedAt: datetime [optional]
- createdAt: datetime [required]

### Question
- id: string (UUID) [required] [unique]
- interviewId: string (FK → Interview) [required]
- content: text [required]
- category: enum(technical, behavioral, situational) [required]
- order: number [required]
- createdAt: datetime [required]

### Answer
- id: string (UUID) [required] [unique]
- questionId: string (FK → Question) [required]
- content: text [required]
- audioUrl: string [optional]
- feedback: text [optional]
- score: number [optional]
- createdAt: datetime [required]

## Relations
- User 1:N Resume
- User 1:N Interview
- Interview 1:N Question
- Question 1:1 Answer
- Resume 1:N Interview (optional)
```

**Entity 체크리스트:**
```
□ 모든 Entity에 id, createdAt 있는가?
□ FK 관계 명시했는가?
□ enum 값 구체적으로 나열했는가?
□ required/optional 구분했는가?
□ 상태(status) 필드의 흐름이 명확한가?
```

---

### 6. 플랫폼 & Deliverables

**형식:**
```
## 플랫폼
- [x] Web (Next.js)
- [x] Mobile (Expo)
- [x] Backend (NestJS)
- [x] E2E Tests (Playwright)

## 우선순위
1순위: Backend + Web
2순위: E2E Tests
3순위: Mobile
```

**옵션 상세:**
```
## Deliverables 상세

### Backend
- [x] Prisma Schema
- [x] DDD Module 구조
- [x] REST API
- [ ] GraphQL (불필요)
- [x] JWT 인증
- [x] OAuth (카카오, 네이버, 구글)
- [x] File Upload (S3)
- [ ] WebSocket (불필요)
- [x] Swagger 문서

### Web (Next.js)
- [x] App Router
- [x] Server Components
- [x] Tailwind + Framer Motion
- [x] TanStack Query
- [x] Zustand
- [x] React Hook Form + Zod
- [ ] i18n (불필요)

### Mobile (Expo)
- [x] Expo Router
- [x] SecureStore 인증
- [x] 오프라인 지원
- [x] Push Notification
- [ ] 카메라 (불필요)

### Testing
- [x] E2E (Playwright)
- [x] Page Object Model
- [ ] Unit Tests (선택)
- [ ] Integration Tests (선택)
```

---

### 7. 외부 연동

**형식:**
```
## 외부 연동

### 필수
- OpenAI API: 질문 생성, 답변 분석
- AWS S3: 이력서 파일 저장
- Clova Speech (STT): 음성→텍스트

### 선택
- Google Analytics: 사용자 분석
- Sentry: 에러 트래킹
```

**연동 정보 상세:**
```
## 외부 연동 상세

### OpenAI API
- 용도: 맞춤 면접 질문 생성, 답변 피드백
- 모델: gpt-4-turbo
- 예상 호출: 면접당 5-10회
- 필요 정보: API Key (환경변수)

### AWS S3
- 용도: 이력서 PDF, 음성 파일 저장
- 버킷: {project}-uploads
- 권한: presigned URL 사용
- 필요 정보: Access Key, Secret Key, Bucket Name, Region

### Clova Speech (STT)
- 용도: 답변 음성 → 텍스트 변환
- 언어: 한국어
- 필요 정보: Client ID, Client Secret

### OAuth Providers
- Kakao: REST API 사용, Redirect URI 필요
- Naver: 네이버 로그인 API
- Google: OAuth 2.0
```

---

### 8. 비기능 요구사항 (선택)

```
## 비기능 요구사항

### 성능
- 페이지 로드: 3초 이내
- API 응답: 500ms 이내
- 동시 접속: 100명

### 보안
- HTTPS 필수
- JWT 만료: Access 15분, Refresh 7일
- Rate Limiting: 100 req/min

### 확장성
- 초기: 단일 서버
- 향후: 컨테이너 기반 스케일링 고려

### 호환성
- 브라우저: Chrome, Safari, Firefox (최신 2버전)
- 모바일: iOS 15+, Android 10+
```

---

## 완성 예시: Fiterview

```
## 프로젝트명
fiterview

## 한 줄 설명
AI 기반 모의면접 플랫폼. 이력서 분석 후 맞춤 질문 생성, 음성 답변 수집, AI 피드백 제공.

## 핵심 기능
1. 이력서 PDF 업로드 및 텍스트 추출
2. 직무별 맞춤 면접 질문 생성 (GPT-4)
3. 음성 인식으로 답변 수집 (Clova STT)
4. 답변 분석 및 개선점 피드백
5. 면접 히스토리 및 성장 통계

## 사용자 스토리

### 인증
- 사용자는 카카오/네이버/구글로 로그인할 수 있다
- 사용자는 로그아웃할 수 있다

### 이력서
- 사용자는 PDF 이력서를 업로드할 수 있다
- 사용자는 이력서 목록을 조회할 수 있다
- 사용자는 이력서를 삭제할 수 있다

### 면접
- 사용자는 직무를 선택하고 면접을 시작할 수 있다
- 사용자는 음성으로 질문에 답변할 수 있다
- 사용자는 답변을 다시 녹음할 수 있다
- 사용자는 면접을 중단할 수 있다

### 결과
- 사용자는 면접 종료 후 답변별 피드백을 볼 수 있다
- 사용자는 전체 점수와 등급을 볼 수 있다
- 사용자는 과거 면접 결과를 비교할 수 있다

## Routes

### Public
- / (랜딩)
- /login (로그인)
- /auth/callback/[provider] (OAuth 콜백)

### Protected
- /dashboard (메인)
- /resumes (이력서 목록)
- /resumes/upload (업로드)
- /interviews (면접 기록)
- /interviews/new (새 면접 - 설정)
- /interviews/[id] (면접 진행)
- /interviews/[id]/result (결과)
- /settings (설정)

## Entities

### User
- id: string [PK]
- email: string [unique]
- name: string
- profileImage: string?
- provider: enum(kakao, naver, google)
- providerId: string

### Resume
- id: string [PK]
- userId: string [FK]
- fileName: string
- fileUrl: string
- extractedText: text?

### Interview
- id: string [PK]
- userId: string [FK]
- resumeId: string? [FK]
- jobType: enum(frontend, backend, fullstack, ios, android, devops, data)
- status: enum(pending, in_progress, completed, cancelled)
- totalScore: number?
- grade: enum(A, B, C, D, F)?

### Question
- id: string [PK]
- interviewId: string [FK]
- content: text
- category: enum(technical, behavioral, situational)
- order: number

### Answer
- id: string [PK]
- questionId: string [FK]
- content: text
- audioUrl: string?
- feedback: text?
- score: number?

## 플랫폼
- [x] Web (Next.js)
- [x] Mobile (Expo)
- [x] Backend (NestJS)
- [x] E2E Tests

## 외부 연동
- OpenAI API: 질문 생성, 피드백
- AWS S3: 파일 저장
- Clova Speech: STT
- OAuth: 카카오, 네이버, 구글
```

---

## 요청 품질 체크리스트

제출 전 확인:

```
□ 프로젝트 한 줄 설명이 명확한가?
□ 핵심 기능이 동사로 시작하는가?
□ 사용자 스토리가 CRUD를 모두 포함하는가?
□ Routes가 public/protected로 구분되어 있는가?
□ Entity 관계(FK)가 명시되어 있는가?
□ enum 값이 구체적으로 나열되어 있는가?
□ 플랫폼 선택이 되어 있는가?
□ 외부 연동 서비스가 명시되어 있는가?
```

---

## 요청 수준별 결과물 차이

| 요청 수준 | 결과물 품질 |
|----------|------------|
| "Todo 앱 만들어줘" | 기본 CRUD만, 추정 기반 구조 |
| 핵심 기능 + Routes | 명확한 페이지 구조, 기본 컴포넌트 |
| + Entity 정의 | 정확한 DB 스키마, 타입 공유 |
| + 사용자 스토리 | 완전한 비즈니스 로직, 엣지 케이스 처리 |
| + 외부 연동 | 실제 서비스 연동 코드 포함 |
| **Full Spec** | **프로덕션 레디 코드** |

---

## Quick Templates

### SaaS 서비스
```
## 프로젝트명
[name]

## 한 줄 설명
[target users]를 위한 [core value] 서비스

## 핵심 기능
1. 회원가입/로그인 (OAuth)
2. [핵심 기능 1]
3. [핵심 기능 2]
4. 결제/구독 (선택)
5. 관리자 대시보드 (선택)

## Routes
- / (랜딩)
- /pricing (가격)
- /login
- /dashboard
- /[feature]
- /settings
- /admin (관리자)
```

### E-commerce
```
## 핵심 기능
1. 상품 목록/검색/필터
2. 상품 상세 (옵션, 리뷰)
3. 장바구니
4. 주문/결제
5. 주문 내역/배송 조회
6. 리뷰 작성

## Routes
- /products
- /products/[id]
- /cart
- /checkout
- /orders
- /orders/[id]
```

### 커뮤니티/SNS
```
## 핵심 기능
1. 게시글 작성/수정/삭제
2. 이미지/동영상 업로드
3. 좋아요/댓글
4. 팔로우/팔로워
5. 피드/타임라인
6. 알림

## Routes
- /feed
- /posts/[id]
- /users/[id]
- /notifications
- /settings
```
