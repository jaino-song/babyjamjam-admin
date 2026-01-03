# Development Context

> Phase간 공유되는 개발 컨텍스트 문서

## 📊 Phase 진행 상태

| Phase | 스킬 | 상태 | 완료일 |
|-------|------|------|--------|
| 0 | orchestrator | ✅ | {date} |
| 1 | backend-generator | ⏳ | - |
| 2 | frontend-generator | ⏳ | - |
| 3 | mobile-generator | ⏳ | - |
| 4 | admin-generator | ⏳ | - |
| 5 | analytics-generator | ⏳ | - |

---

## 🔗 Backend API (Phase 1 완료 후 업데이트)

### Base URL

```
Development: http://localhost:3001/api
Production: {tbd}
```

### Endpoints

```yaml
# Auth
POST   /auth/login
POST   /auth/register
POST   /auth/refresh
DELETE /auth/logout

# Users
GET    /users/me
PATCH  /users/me
DELETE /users/me

# {Resource1}
GET    /{resource1}
POST   /{resource1}
GET    /{resource1}/:id
PATCH  /{resource1}/:id
DELETE /{resource1}/:id

# {Resource2}
GET    /{resource2}
POST   /{resource2}
GET    /{resource2}/:id
PATCH  /{resource2}/:id
DELETE /{resource2}/:id
```

### Response Format

```typescript
// 성공
{
  success: true,
  data: T,
  meta?: { page, limit, total }
}

// 실패
{
  success: false,
  error: {
    code: string,
    message: string,
    details?: unknown
  }
}
```

---

## 📦 공유 타입 (packages/types)

### 엔티티 타입

```typescript
// packages/types/src/entities/user.ts
export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

export enum UserRole {
  USER = 'USER',
  ADMIN = 'ADMIN',
}

// packages/types/src/entities/{entity}.ts
// Phase 1에서 생성
```

### API 타입

```typescript
// packages/types/src/api/auth.ts
export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

// packages/types/src/api/{resource}.ts
// Phase 1에서 생성
```

### 공통 타입

```typescript
// packages/types/src/common/api.ts
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta?: PaginationMeta;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
```

---

## 🎨 Design Tokens (Phase 2/3에서 사용)

### Colors

```css
--color-primary: #3b82f6;
--color-primary-hover: #2563eb;
--color-secondary: #64748b;
--color-background: #ffffff;
--color-foreground: #0f172a;
--color-muted: #f1f5f9;
--color-accent: #f59e0b;
--color-destructive: #ef4444;
```

### Typography

```css
--font-family-sans: 'Inter', sans-serif;
--font-family-mono: 'JetBrains Mono', monospace;

--font-size-xs: 0.75rem;
--font-size-sm: 0.875rem;
--font-size-base: 1rem;
--font-size-lg: 1.125rem;
--font-size-xl: 1.25rem;
--font-size-2xl: 1.5rem;
```

### Spacing

```css
--spacing-1: 0.25rem;
--spacing-2: 0.5rem;
--spacing-3: 0.75rem;
--spacing-4: 1rem;
--spacing-6: 1.5rem;
--spacing-8: 2rem;
```

---

## 📱 Mobile Specific (Phase 3)

### Deep Links

```
{app-scheme}://
├── /home
├── /profile
├── /{resource}/:id
└── /auth/callback
```

### Push Notifications

```typescript
// Topic 구조
{app-id}/users/{userId}
{app-id}/topics/{topicName}
```

---

## 📊 Analytics Events (Phase 5에서 정의)

### Core Events

```typescript
// 사용자 행동
'user_signed_up'
'user_logged_in'
'user_logged_out'

// 핵심 기능
'{feature}_viewed'
'{feature}_created'
'{feature}_updated'
'{feature}_deleted'

// 전환
'checkout_started'
'checkout_completed'
'subscription_started'
```

---

## 🔧 환경 변수

### Backend (.env)

```bash
# Database
DATABASE_URL=

# Auth
JWT_SECRET=
JWT_EXPIRES_IN=

# OAuth
KAKAO_CLIENT_ID=
KAKAO_CLIENT_SECRET=

# External
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
```

### Frontend (.env.local)

```bash
# API
NEXT_PUBLIC_API_URL=

# Auth
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# Analytics
NEXT_PUBLIC_POSTHOG_KEY=
```

### Mobile (.env)

```bash
# API
EXPO_PUBLIC_API_URL=

# Auth
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
```

---

## 📝 Phase별 메모

### Phase 1 메모

```
- 
```

### Phase 2 메모

```
- 
```

### Phase 3 메모

```
- 
```

### Phase 4 메모

```
- 
```

### Phase 5 메모

```
- 
```

---

*이 문서는 각 Phase 완료 시 업데이트됩니다.*
