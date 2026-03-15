# 기술 블로그 포스트 모음

실제 프로덕션 프로젝트에서 마주친 버그들과 해결 방법을 주제별로 정리한 기술 블로그 포스트입니다.

---

## 📚 포스트 목록

### 1. [JavaScript/TypeScript 함정](./01-javascript-typescript-pitfalls.md)
> Falsy 값, 타입 불일치, 안전한 객체 접근

**다루는 버그:**
- `0`이 falsy 값으로 처리되는 문제
- 백엔드/프론트엔드 타입 불일치
- 번역 함수의 타입 안전성

**핵심 키워드:** `||` vs `??`, `parseInt`, Optional Chaining

---

### 2. [Next.js + NestJS 풀스택 이슈](./02-nextjs-nestjs-fullstack-issues.md)
> API 프록시 패턴, Authorization 헤더, 중복 API 호출 최적화

**다루는 버그:**
- API Route에서 Authorization 헤더 누락
- 405 Method Not Allowed
- DTO Validation 필수 필드 오류
- SSR/CSR 중복 API 호출

**핵심 키워드:** API Route, React Query initialData, UserProvider, React cache()

---

### 3. [데이터베이스 & ORM 설계](./03-database-orm-design.md)
> 외래 키 제약 조건, 히스토리 추적, Prisma 관계 설정

**다루는 버그:**
- Foreign Key Constraint Violation

**핵심 키워드:** 중간 테이블, Association Table, 트랜잭션, Prisma Relations

---

### 4. [인증 & 보안](./04-authentication-security.md)
> OAuth, JWT, 개발 환경 보안, CVE 대응

**다루는 버그:**
- 개발 환경 인증 바이패스 보안 취약점
- JWT 토큰 만료 시간 전략
- React Server Components CVE
- Mobile Safari OAuth (ITP) 문제

**핵심 키워드:** Server Actions, 역할 기반 토큰, Dependabot, Safari ITP

---

### 5. [배포 & DevOps](./05-deployment-devops.md)
> Railway 배포, NestJS 서버 설정

**다루는 버그:**
- Railway에서 NestJS 서버 실행 실패

**핵심 키워드:** `0.0.0.0` 바인딩, devDependencies, PORT 환경변수

---

### 6. [React/UI 이슈](./06-react-ui-issues.md)
> Hydration Error, React Query 캐시, 가격 포맷팅

**다루는 버그:**
- HTML 중첩 오류 (MUI)
- React Query 캐시 무효화 문제
- 가격 입력 필드 포맷팅

**핵심 키워드:** MUI component prop, Query Key Factory, formatPrice/parsePrice

---

### 7. [PWA Service Worker](./07-pwa-service-worker.md)
> Service Worker 업데이트, 사용자 피드백

**다루는 버그:**
- SW 업데이트 시 오버레이 미표시

**핵심 키워드:** skipWaiting, postMessage, controllerchange

---

## 🏷️ 태그별 분류

### 난이도별
- **초급:** #1 (Falsy 값), #6 (HTML 중첩)
- **중급:** #2 (API 프록시), #3 (DB 설계), #7 (PWA)
- **고급:** #4 (보안), #5 (배포)

### 기술 스택별
- **Frontend:** #1, #2, #6, #7
- **Backend:** #2, #3, #4, #5
- **Database:** #3
- **DevOps:** #5
- **Security:** #4

### 프레임워크별
- **Next.js:** #2, #4, #6, #7
- **NestJS:** #2, #3, #4, #5
- **React Query:** #2, #6
- **Prisma:** #3
- **MUI:** #6

---

## 📖 읽는 순서 추천

### 풀스택 개발자라면
1. [JavaScript/TypeScript 함정](./01-javascript-typescript-pitfalls.md)
2. [Next.js + NestJS 풀스택 이슈](./02-nextjs-nestjs-fullstack-issues.md)
3. [데이터베이스 & ORM 설계](./03-database-orm-design.md)
4. [인증 & 보안](./04-authentication-security.md)

### 프론트엔드 개발자라면
1. [JavaScript/TypeScript 함정](./01-javascript-typescript-pitfalls.md)
2. [React/UI 이슈](./06-react-ui-issues.md)
3. [PWA Service Worker](./07-pwa-service-worker.md)
4. [Next.js + NestJS 풀스택 이슈](./02-nextjs-nestjs-fullstack-issues.md) (2, 4번 섹션)

### 백엔드 개발자라면
1. [데이터베이스 & ORM 설계](./03-database-orm-design.md)
2. [인증 & 보안](./04-authentication-security.md)
3. [배포 & DevOps](./05-deployment-devops.md)
4. [Next.js + NestJS 풀스택 이슈](./02-nextjs-nestjs-fullstack-issues.md) (3번 섹션)

---

## 📝 원본 버그 문서

이 블로그 포스트들은 프로젝트의 [BUGFIX.md](../../BUGFIX.md)에 기록된 버그들을 바탕으로 작성되었습니다.

---

## 📅 작성 정보

- **프로젝트:** BabyJamJam Staff
- **기간:** 2025-12 ~ 2026-01
- **기술 스택:** Next.js 16, NestJS 10, Prisma 6, TypeScript 5
