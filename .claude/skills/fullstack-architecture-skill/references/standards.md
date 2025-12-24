# Code Standards Guide

## 네이밍 컨벤션

### 파일명

```
// TypeScript/React
user.service.ts           # kebab-case + 타입 접미사
user.repository.ts
create-user.command.ts    # 복합어는 kebab-case
UserCard.tsx              # React 컴포넌트는 PascalCase

// 타입별 접미사
*.service.ts              # 서비스
*.repository.ts           # 리포지토리
*.controller.ts           # 컨트롤러
*.entity.ts               # 엔티티
*.dto.ts                  # DTO
*.interface.ts            # 인터페이스
*.types.ts                # 타입 모음
*.hook.ts / use*.ts       # 커스텀 훅
*.store.ts                # Zustand 스토어
*.api.ts                  # API 서비스
*.test.ts / *.spec.ts     # 테스트
```

### 코드 네이밍

```typescript
// Classes: PascalCase
class UserService {}
class CreateUserCommand {}

// Functions/Methods: camelCase
function createUser() {}
async function handleSubmit() {}

// Variables: camelCase
const userName = 'John';
let isLoading = false;

// Constants: UPPER_SNAKE_CASE
const MAX_RETRY_COUNT = 3;
const API_BASE_URL = 'https://api.example.com';

// Interfaces/Types: PascalCase
interface UserDto {}
type CreateUserInput = {};

// Enums: PascalCase (멤버도)
enum UserRole {
  Admin = 'ADMIN',
  User = 'USER',
}

// React Components: PascalCase
function UserCard() {}
const UserList: React.FC = () => {};

// Hooks: use prefix
function useAuth() {}
function useCurrentUser() {}

// Event Handlers: handle prefix
function handleClick() {}
function handleSubmit() {}

// Boolean: is/has/can/should prefix
const isLoading = true;
const hasPermission = false;
const canEdit = true;
```

## Import 순서

```typescript
// 1. Node built-ins
import { readFile } from 'fs';
import path from 'path';

// 2. External packages
import { Injectable } from '@nestjs/common';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

// 3. Internal packages (monorepo)
import { User } from '@repo/types';
import { loginSchema } from '@repo/validators';

// 4. Absolute imports (from src)
import { useAuth } from '@/features/auth/hooks';
import { Button } from '@/shared/components';

// 5. Relative imports
import { UserCard } from '../components';
import { formatDate } from './utils';

// 6. Types (if separate)
import type { UserDto } from './types';
```

## 코드 스타일

### 함수 선언

```typescript
// 선호: 화살표 함수 (React 컴포넌트 제외)
const createUser = async (data: CreateUserInput): Promise<User> => {
  // ...
};

// React 컴포넌트: function 선언
export function UserCard({ user }: UserCardProps) {
  return <div>{user.name}</div>;
}

// 또는 화살표 함수도 허용
export const UserCard = ({ user }: UserCardProps) => {
  return <div>{user.name}</div>;
};
```

### 타입 선언

```typescript
// Interface: 확장 가능한 객체
interface User {
  id: string;
  email: string;
  name: string;
}

// Type: Union, Intersection, Utility
type UserRole = 'admin' | 'user' | 'guest';
type CreateUserInput = Omit<User, 'id'>;

// Props는 Interface 선호
interface ButtonProps {
  variant: 'primary' | 'secondary';
  size?: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
}
```

### Early Return

```typescript
// 좋음: Early return으로 가독성 향상
function processUser(user: User | null) {
  if (!user) {
    return null;
  }

  if (!user.isActive) {
    return { error: 'User is inactive' };
  }

  return { data: user };
}

// 피하기: 중첩된 조건문
function processUser(user: User | null) {
  if (user) {
    if (user.isActive) {
      return { data: user };
    } else {
      return { error: 'User is inactive' };
    }
  } else {
    return null;
  }
}
```

### 비구조화 할당

```typescript
// Props 비구조화
function UserCard({ name, email, avatar }: UserCardProps) {
  return (
    <div>
      <img src={avatar} alt={name} />
      <span>{name}</span>
      <span>{email}</span>
    </div>
  );
}

// 객체에서 필요한 것만 추출
const { id, name } = user;

// 기본값 설정
const { page = 1, limit = 10 } = params;
```

## 에러 처리

### Backend

```typescript
// Domain Exception 정의
export class UserNotFoundException extends DomainException {
  constructor(id: string) {
    super('USER_NOT_FOUND', `User with ID ${id} not found`, 404);
  }
}

// 사용
async findById(id: string): Promise<User> {
  const user = await this.repository.findById(id);
  
  if (!user) {
    throw new UserNotFoundException(id);
  }
  
  return user;
}
```

### Frontend

```typescript
// API 에러 처리
try {
  await api.users.create(data);
} catch (error) {
  if (error.code === 'USER_ALREADY_EXISTS') {
    form.setError('email', { message: '이미 사용 중인 이메일입니다' });
  } else {
    addToast({ type: 'error', title: '오류가 발생했습니다' });
  }
}

// React Error Boundary
<ErrorBoundary fallback={<ErrorFallback />}>
  <UserProfile />
</ErrorBoundary>
```

## 주석 규칙

```typescript
// 1. 코드가 "왜" 그런지 설명 (무엇을 하는지 X)
// 레거시 API 호환성을 위해 snake_case 유지
const user_name = response.user_name;

// 2. TODO/FIXME 형식
// TODO: 인증 로직 추가 필요 (@david, 2024-01)
// FIXME: 메모리 누수 가능성 있음

// 3. JSDoc (공개 API, 복잡한 함수)
/**
 * 사용자를 생성합니다.
 * @param data - 생성할 사용자 정보
 * @returns 생성된 사용자
 * @throws {UserAlreadyExistsException} 이메일이 이미 존재하는 경우
 */
async function createUser(data: CreateUserInput): Promise<User> {
  // ...
}

// 4. 불필요한 주석 피하기
// 사용자 이름을 설정한다 <- 불필요
user.name = name;
```

## Git 컨벤션

### 브랜치 전략

```
main (production)
  │
  ├── develop (staging)
  │     │
  │     ├── feature/user-auth
  │     ├── feature/payment-integration
  │     └── fix/login-redirect-bug
  │
  └── hotfix/critical-security-patch
```

### 브랜치 네이밍

```
feature/[티켓번호]-[설명]     # 새 기능
fix/[티켓번호]-[설명]         # 버그 수정
hotfix/[설명]                 # 긴급 수정
refactor/[설명]               # 리팩토링
docs/[설명]                   # 문서
chore/[설명]                  # 설정, 빌드

예시:
feature/AUTH-123-kakao-login
fix/USER-456-profile-update
hotfix/security-jwt-validation
```

### 커밋 메시지 (Conventional Commits)

```
<type>(<scope>): <subject>

<body>

<footer>
```

```
Types:
- feat: 새로운 기능
- fix: 버그 수정
- docs: 문서 변경
- style: 코드 포맷팅 (기능 변경 X)
- refactor: 리팩토링
- test: 테스트 추가/수정
- chore: 빌드, 설정 변경

예시:
feat(auth): 카카오 OAuth 로그인 추가

- KakaoStrategy 구현
- OAuth callback 처리
- 토큰 발급 로직

Closes #123
```

## PR 체크리스트

```markdown
## Description
<!-- 변경 사항 설명 -->

## Type of Change
- [ ] 새로운 기능 (feat)
- [ ] 버그 수정 (fix)
- [ ] 리팩토링 (refactor)
- [ ] 문서 (docs)

## Checklist
- [ ] 테스트 통과
- [ ] 타입 에러 없음
- [ ] Lint 에러 없음
- [ ] 문서 업데이트 (필요시)
- [ ] Breaking Change 명시 (필요시)
- [ ] DB 마이그레이션 안전성 검토 (필요시)

## Screenshots (UI 변경시)
<!-- 스크린샷 첨부 -->

## Related Issues
Closes #
```

## ADR (Architecture Decision Records)

```markdown
# ADR-001: JWT 토큰 저장 전략

## Status
Accepted

## Context
웹과 모바일에서 JWT 토큰을 안전하게 저장해야 함.
XSS, CSRF 공격에 대한 방어가 필요함.

## Decision
- Web: HttpOnly Cookie 사용
- Mobile: SecureStore (iOS Keychain / Android Keystore) 사용
- 백엔드: Cookie와 Bearer 토큰 둘 다 지원

## Consequences
### 장점
- 웹에서 XSS 공격에 안전
- 모바일에서 기기 레벨 암호화
- 플랫폼별 최적 보안

### 단점
- 백엔드 JWT Strategy 복잡도 증가
- 플랫폼별 인증 로직 분기 필요

## Alternatives Considered
1. localStorage 사용 - XSS 취약점으로 기각
2. Cookie만 사용 - 모바일에서 제한적

## Related
- ADR-002: Refresh Token Rotation
```

## ESLint + Prettier 설정

```javascript
// .eslintrc.js
module.exports = {
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'prettier',
  ],
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/explicit-function-return-type': 'off',
    'react/react-in-jsx-scope': 'off',
    'react/prop-types': 'off',
  },
};

// .prettierrc
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100
}
```
