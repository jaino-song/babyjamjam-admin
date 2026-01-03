# Code Standards

공통 코드 스타일 및 명명 규칙 가이드

---

## 📁 파일 명명 규칙

### Frontend (Next.js)

| 유형 | 규칙 | 예시 |
|------|------|------|
| Components | PascalCase | `Button.tsx`, `UserCard.tsx` |
| Hooks | camelCase + use prefix | `useAuth.ts`, `useModal.ts` |
| Utils | camelCase | `formatDate.ts`, `parseQuery.ts` |
| Types | PascalCase + .types.ts | `User.types.ts`, `Api.types.ts` |
| Constants | SCREAMING_SNAKE | `API_ENDPOINTS.ts` |
| Stores | camelCase + Store | `authStore.ts`, `cartStore.ts` |

### Backend (NestJS)

| 유형 | 규칙 | 예시 |
|------|------|------|
| Entities | `{name}.entity.ts` | `user.entity.ts` |
| Value Objects | `{name}.vo.ts` | `email.vo.ts` |
| Use Cases | `{action}-{entity}.use-case.ts` | `create-user.use-case.ts` |
| Ports | `{name}.port.ts` | `user-repository.port.ts` |
| Adapters | `{provider}-{name}.adapter.ts` | `prisma-user.adapter.ts` |
| DTOs | `{action}-{entity}.dto.ts` | `create-user.dto.ts` |
| Controllers | `{name}.controller.ts` | `user.controller.ts` |
| Modules | `{name}.module.ts` | `user.module.ts` |

### Mobile (Expo)

| 유형 | 규칙 | 예시 |
|------|------|------|
| Screens | PascalCase + Screen | `HomeScreen.tsx` |
| Components | PascalCase | `ProfileCard.tsx` |
| Hooks | camelCase + use prefix | `useNotification.ts` |
| Services | camelCase + Service | `authService.ts` |

---

## 📂 디렉토리 구조

### Clean Architecture Layers

```
project/
├── src/
│   ├── domain/           # 핵심 비즈니스 로직
│   │   ├── entities/     # 도메인 엔티티
│   │   ├── value-objects/# 값 객체
│   │   └── ports/        # 인터페이스 정의
│   │
│   ├── application/      # 유스케이스
│   │   ├── commands/     # 쓰기 작업
│   │   ├── queries/      # 읽기 작업
│   │   └── dtos/         # 데이터 전송 객체
│   │
│   ├── infrastructure/   # 외부 연동
│   │   ├── adapters/     # 포트 구현체
│   │   ├── database/     # DB 설정
│   │   └── external/     # 외부 API
│   │
│   └── presentation/     # 컨트롤러/UI
│       ├── controllers/  # API 엔드포인트
│       └── middlewares/  # 미들웨어
```

### Frontend 구조

```
frontend/
├── app/                  # Next.js App Router
│   ├── (auth)/          # 인증 관련 그룹
│   ├── (dashboard)/     # 대시보드 그룹
│   └── api/             # API Routes (프록시)
│
├── components/
│   ├── ui/              # 기본 UI 컴포넌트
│   ├── forms/           # 폼 컴포넌트
│   └── layouts/         # 레이아웃 컴포넌트
│
├── hooks/               # 커스텀 훅
├── stores/              # Zustand 스토어
├── services/            # API 호출 서비스
├── types/               # 타입 정의
└── utils/               # 유틸리티 함수
```

---

## 📝 코드 스타일

### TypeScript

```typescript
// ✅ Named exports 사용 (default export 금지)
export const UserCard = () => { ... };
export function formatDate(date: Date): string { ... }

// ✅ async/await 사용 (.then() 금지)
async function fetchUser(id: string): Promise<User> {
  const response = await api.get(`/users/${id}`);
  return response.data;
}

// ✅ any 타입 금지 (불가피한 경우 주석 필수)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const legacyData: any = externalLibrary.getData();

// ✅ 인터페이스 vs 타입
// 확장 가능한 객체 → interface
interface UserRepository {
  findById(id: string): Promise<User | null>;
}

// 유니온, 유틸리티 → type
type Status = 'pending' | 'approved' | 'rejected';
type PartialUser = Partial<User>;
```

### Import 순서

```typescript
// 1. 외부 라이브러리
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

// 2. 내부 모듈 (절대 경로)
import { UserRepository } from '@/domain/ports/user-repository.port';
import { CreateUserDto } from '@/application/dtos/create-user.dto';

// 3. 상대 경로
import { validateEmail } from './utils';
import type { LocalType } from './types';
```

### 주석 규칙

```typescript
// 비즈니스 로직: 한국어 주석
// 포인트 적립은 결제 완료 후 24시간 뒤에 처리됩니다
const POINT_DELAY_HOURS = 24;

// Technical comments: English
// Retry with exponential backoff for transient failures
async function fetchWithRetry<T>(fn: () => Promise<T>): Promise<T> { ... }

/**
 * JSDoc은 public API에만 사용
 * @param userId - 사용자 고유 ID
 * @returns 사용자 정보 또는 null
 */
export async function getUser(userId: string): Promise<User | null> { ... }
```

---

## 🔒 보안 규칙

### 필수 검증

```typescript
// Zod로 모든 외부 입력 검증
const CreateUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2).max(50),
});

// DTO에서 검증
export class CreateUserDto {
  @IsEmail()
  email: string;

  @MinLength(8)
  password: string;
}
```

### 민감 데이터

```typescript
// ❌ 절대 금지
console.log('Password:', user.password);
return { ...user, password: user.password };

// ✅ 올바른 방식
const { password, ...safeUser } = user;
return safeUser;
```

---

## ❌ 금지 사항

### 패키지

| 금지 | 대체 |
|------|------|
| moment.js | date-fns |
| Redux, MobX, Recoil | Zustand |
| TypeORM, Sequelize | Prisma |
| jQuery | 순수 JS/React |
| lodash (전체) | lodash-es (개별 import) |

### 코드 패턴

```typescript
// ❌ any 타입
const data: any = fetchData();

// ❌ console.log (개발 환경 제외)
console.log('debug:', data);

// ❌ 직접 DB 호출 (infrastructure 외부)
const user = await prisma.user.findUnique({ where: { id } });

// ❌ 백엔드 직접 호출 (클라이언트)
await fetch('http://backend:3001/api/users');

// ✅ Next.js API Route 통해 호출
await fetch('/api/users');
```

---

## ✅ 권장 사항

### 에러 처리

```typescript
// 커스텀 에러 클래스 사용
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class UserNotFoundError extends AppError {
  constructor(userId: string) {
    super(`User not found: ${userId}`, 'USER_NOT_FOUND', 404);
  }
}
```

### 타입 안전성

```typescript
// Result 패턴으로 에러 처리
type Result<T, E = Error> = 
  | { success: true; data: T }
  | { success: false; error: E };

async function createUser(dto: CreateUserDto): Promise<Result<User>> {
  try {
    const user = await userRepository.save(dto);
    return { success: true, data: user };
  } catch (error) {
    return { success: false, error: error as Error };
  }
}
```

---

## 📊 코드 리뷰 체크리스트

### 🔒 Security Manager

- [ ] 모든 입력이 Zod/class-validator로 검증되는가?
- [ ] SQL Injection, XSS 가능성은 없는가?
- [ ] 민감 데이터가 노출되지 않는가?
- [ ] 인증/인가 로직이 올바른가?

### 👨‍💻 Developer

- [ ] 코드가 재사용 가능하고 모듈화되어 있는가?
- [ ] 의존성 방향이 올바른가? (domain ← application ← infrastructure)
- [ ] any 타입 없이 타입 안전한가?
- [ ] 에러 처리가 일관성 있는가?

### 📊 Product Manager

- [ ] 확장 가능한 구조인가?
- [ ] 불필요한 API 호출이나 DB 쿼리가 없는가?
- [ ] 사용자 경험 (로딩, 에러 메시지)이 고려되었는가?

---

## 🔗 관련 문서

- [Testing Guide](./testing.md)
- [DevOps Guide](./devops.md)
