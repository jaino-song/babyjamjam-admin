# Supabase Integration Guide

> ⚠️ **중요**: 이 가이드는 Supabase를 **보조 서비스**로 사용하는 방법을 설명합니다.
> **메인 백엔드 로직은 반드시 NestJS로 구현해야 합니다.**
> Supabase는 Auth, Storage, Realtime 등의 기능에만 사용하세요.

> **역할**: Supabase를 NestJS의 Infrastructure Layer와 함께 사용하는 통합 가이드
> **담당**: Auth, Database(보조), Storage, Realtime을 Supabase로 구성

---

## 🎯 사용 시점 (Trigger)

이 문서를 참조하는 경우:
- NestJS 백엔드에서 Supabase Auth 통합이 필요할 때
- Supabase Storage를 파일 저장소로 사용할 때
- Supabase Realtime 기능이 필요할 때

> ❌ "Supabase로 백엔드 구성해줘" → 대신 NestJS + Supabase 통합 방식 사용
> ✅ "Supabase Auth 사용해줘" → NestJS에서 Supabase Auth 연동

---

## 📊 아키텍처 Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                 Supabase as Infrastructure Layer                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  Presentation Layer                                                  │    │
│  │  • Controllers (API Routes in Next.js or NestJS)                     │    │
│  │  • Supabase Auth 토큰 검증                                           │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                              │                                               │
│                              ▼                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  Application Layer                                                   │    │
│  │  • Use Cases / Services                                              │    │
│  │  • DTOs                                                              │    │
│  │  • 순수 TypeScript (외부 의존성 없음)                                │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                              │                                               │
│                              ▼                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  Domain Layer (순수)                                                 │    │
│  │  • Entities, Value Objects                                           │    │
│  │  • Repository Interfaces                                             │    │
│  │  • ❌ Supabase 의존성 없음                                           │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                              │                                               │
│                              ▼                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  Infrastructure Layer                                                │    │
│  │  • SupabaseAuthService (토큰 검증)                                   │    │
│  │  • SupabaseRepository (DB 연동)                                      │    │
│  │  • SupabaseStorageService (파일 업로드)                              │    │
│  │  • ✅ Supabase 의존성은 여기만                                       │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                              │                                               │
│                              ▼                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  Supabase Cloud                                                      │    │
│  │  • Auth (Google, Kakao OIDC, Naver OIDC)                             │    │
│  │  • PostgreSQL Database                                               │    │
│  │  • Storage (파일)                                                    │    │
│  │  • Realtime (선택)                                                   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 📦 필수 패키지

```bash
# Supabase Client
pnpm add @supabase/supabase-js

# Server-side (Next.js App Router)
pnpm add @supabase/ssr

# 타입 생성 (선택)
pnpm add -D supabase
```

---

## 📁 파일 구조

```
src/
├── lib/
│   └── supabase/
│       ├── client.ts                    # 브라우저 클라이언트
│       ├── server.ts                    # 서버 클라이언트
│       ├── admin.ts                     # Service Role 클라이언트
│       └── middleware.ts                # Auth 미들웨어
│
├── modules/
│   └── {domain}/
│       ├── domain/
│       │   ├── entities/
│       │   │   └── {entity}.entity.ts   # 순수 Entity
│       │   ├── value-objects/
│       │   │   └── {vo}.vo.ts
│       │   └── repositories/
│       │       └── {entity}.repository.interface.ts
│       │
│       ├── application/
│       │   ├── services/
│       │   │   └── {entity}.service.ts  # Use Cases
│       │   └── dtos/
│       │       ├── create-{entity}.dto.ts
│       │       └── update-{entity}.dto.ts
│       │
│       └── infrastructure/
│           └── persistence/
│               ├── supabase-{entity}.repository.ts
│               └── {entity}.mapper.ts
│
├── app/
│   ├── api/
│   │   └── {domain}/
│   │       └── route.ts                 # API Routes
│   └── auth/
│       ├── callback/
│       │   └── route.ts                 # OAuth Callback
│       └── confirm/
│           └── route.ts                 # Email Confirm
│
└── middleware.ts                         # Auth Middleware
```

---

## 🔢 구현 순서

### Step 1: Supabase 프로젝트 설정

**1.1 Supabase Dashboard에서 프로젝트 생성**

```
1. https://supabase.com → New Project
2. Project name, Database password 설정
3. Region: Northeast Asia (ap-northeast-1) 권장
```

**1.2 환경 변수 설정**

```bash
# .env.local
NEXT_PUBLIC_SUPABASE_URL=https://[project-id].supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...  # 서버 전용, 절대 노출 금지
```

---

### Step 2: OAuth Provider 설정

**2.1 Google (네이티브 지원)**

```
Supabase Dashboard → Authentication → Providers → Google

1. Google Cloud Console에서 OAuth 2.0 Client 생성
2. Authorized redirect URI: https://[project-id].supabase.co/auth/v1/callback
3. Client ID, Client Secret을 Supabase에 입력
```

**2.2 Kakao (Custom OIDC)**

```
Supabase Dashboard → Authentication → Providers → Add Custom Provider

Provider name: kakao
Client ID: [카카오 앱 REST API 키]
Client Secret: [카카오 앱 Client Secret]
Issuer URL: https://kauth.kakao.com
Authorization endpoint: https://kauth.kakao.com/oauth/authorize
Token endpoint: https://kauth.kakao.com/oauth/token
User info endpoint: https://kapi.kakao.com/v2/user/me
Scopes: profile_nickname,profile_image,account_email
```

**2.3 Naver (Custom OIDC)**

```
Supabase Dashboard → Authentication → Providers → Add Custom Provider

Provider name: naver
Client ID: [네이버 앱 Client ID]
Client Secret: [네이버 앱 Client Secret]
Issuer URL: https://nid.naver.com
Authorization endpoint: https://nid.naver.com/oauth2.0/authorize
Token endpoint: https://nid.naver.com/oauth2.0/token
User info endpoint: https://openapi.naver.com/v1/nid/me
Scopes: profile,email
```

---

### Step 3: Supabase Client 설정

**3.1 브라우저 클라이언트**

```typescript
// src/lib/supabase/client.ts
import { createBrowserClient } from '@supabase/ssr'
import { Database } from '@/types/supabase'

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

**3.2 서버 클라이언트 (Server Components, Route Handlers)**

```typescript
// src/lib/supabase/server.ts
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { Database } from '@/types/supabase'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Server Component에서는 무시
          }
        },
      },
    }
  )
}
```

**3.3 Admin 클라이언트 (Service Role - 서버 전용)**

```typescript
// src/lib/supabase/admin.ts
import { createClient } from '@supabase/supabase-js'
import { Database } from '@/types/supabase'

// ⚠️ 절대 클라이언트에 노출하지 않을 것
export const supabaseAdmin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
)
```

**3.4 Middleware (토큰 갱신)**

```typescript
// src/middleware.ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // 토큰 갱신 (중요!)
  const { data: { user } } = await supabase.auth.getUser()

  // 보호된 경로 체크
  const isProtectedRoute = request.nextUrl.pathname.startsWith('/dashboard')
  const isAuthRoute = request.nextUrl.pathname.startsWith('/auth')

  if (isProtectedRoute && !user) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (isAuthRoute && user) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

---

### Step 4: OAuth Callback 처리

```typescript
// src/app/auth/callback/route.ts
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // 에러 시 로그인 페이지로
  return NextResponse.redirect(`${origin}/login?error=auth_callback_error`)
}
```

---

### Step 5: Domain Layer (순수 - Supabase 의존성 없음)

```typescript
// src/modules/user/domain/entities/user.entity.ts
import { UserId } from '../value-objects/user-id.vo'
import { Email } from '../value-objects/email.vo'

export type UserRole = 'USER' | 'ADMIN'
export type AuthProvider = 'google' | 'kakao' | 'naver' | 'email'

interface UserProps {
  id: UserId
  email: Email
  name: string
  profileImage: string | null
  role: UserRole
  provider: AuthProvider
  createdAt: Date
  updatedAt: Date
}

export class User {
  private readonly props: UserProps

  private constructor(props: UserProps) {
    this.props = props
  }

  static create(props: {
    id: string
    email: string
    name: string
    profileImage?: string | null
    role?: UserRole
    provider: AuthProvider
    createdAt?: Date
    updatedAt?: Date
  }): User {
    return new User({
      id: UserId.create(props.id),
      email: Email.create(props.email),
      name: props.name,
      profileImage: props.profileImage ?? null,
      role: props.role ?? 'USER',
      provider: props.provider,
      createdAt: props.createdAt ?? new Date(),
      updatedAt: props.updatedAt ?? new Date(),
    })
  }

  // Getters
  get id(): UserId { return this.props.id }
  get email(): Email { return this.props.email }
  get name(): string { return this.props.name }
  get profileImage(): string | null { return this.props.profileImage }
  get role(): UserRole { return this.props.role }
  get provider(): AuthProvider { return this.props.provider }
  get createdAt(): Date { return this.props.createdAt }
  get updatedAt(): Date { return this.props.updatedAt }

  // 비즈니스 로직
  isAdmin(): boolean {
    return this.props.role === 'ADMIN'
  }

  promoteToAdmin(): User {
    if (this.isAdmin()) {
      throw new Error('User is already an admin')
    }
    return new User({
      ...this.props,
      role: 'ADMIN',
      updatedAt: new Date(),
    })
  }

  updateProfile(name: string, profileImage: string | null): User {
    return new User({
      ...this.props,
      name,
      profileImage,
      updatedAt: new Date(),
    })
  }
}
```

```typescript
// src/modules/user/domain/repositories/user.repository.interface.ts
import { User } from '../entities/user.entity'
import { UserId } from '../value-objects/user-id.vo'
import { Email } from '../value-objects/email.vo'

export interface UserRepository {
  findById(id: UserId): Promise<User | null>
  findByEmail(email: Email): Promise<User | null>
  findByAuthId(authId: string): Promise<User | null>
  save(user: User): Promise<void>
  delete(id: UserId): Promise<void>
}

// DI Token
export const USER_REPOSITORY = Symbol('USER_REPOSITORY')
```

---

### Step 6: Infrastructure Layer (Supabase 의존성)

```typescript
// src/modules/user/infrastructure/persistence/user.mapper.ts
import { User, AuthProvider, UserRole } from '../../domain/entities/user.entity'
import { Database } from '@/types/supabase'

type UserRow = Database['public']['Tables']['users']['Row']
type UserInsert = Database['public']['Tables']['users']['Insert']

export class UserMapper {
  static toDomain(row: UserRow): User {
    return User.create({
      id: row.id,
      email: row.email,
      name: row.name,
      profileImage: row.profile_image,
      role: row.role as UserRole,
      provider: row.provider as AuthProvider,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    })
  }

  static toPersistence(user: User): UserInsert {
    return {
      id: user.id.value,
      email: user.email.value,
      name: user.name,
      profile_image: user.profileImage,
      role: user.role,
      provider: user.provider,
      created_at: user.createdAt.toISOString(),
      updated_at: user.updatedAt.toISOString(),
    }
  }
}
```

```typescript
// src/modules/user/infrastructure/persistence/supabase-user.repository.ts
import { createClient } from '@/lib/supabase/server'
import { User } from '../../domain/entities/user.entity'
import { UserRepository } from '../../domain/repositories/user.repository.interface'
import { UserId } from '../../domain/value-objects/user-id.vo'
import { Email } from '../../domain/value-objects/email.vo'
import { UserMapper } from './user.mapper'

export class SupabaseUserRepository implements UserRepository {
  async findById(id: UserId): Promise<User | null> {
    const supabase = await createClient()
    
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', id.value)
      .single()

    if (error || !data) return null
    return UserMapper.toDomain(data)
  }

  async findByEmail(email: Email): Promise<User | null> {
    const supabase = await createClient()
    
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email.value)
      .single()

    if (error || !data) return null
    return UserMapper.toDomain(data)
  }

  async findByAuthId(authId: string): Promise<User | null> {
    const supabase = await createClient()
    
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('auth_id', authId)
      .single()

    if (error || !data) return null
    return UserMapper.toDomain(data)
  }

  async save(user: User): Promise<void> {
    const supabase = await createClient()
    const data = UserMapper.toPersistence(user)

    const { error } = await supabase
      .from('users')
      .upsert(data, { onConflict: 'id' })

    if (error) {
      throw new Error(`Failed to save user: ${error.message}`)
    }
  }

  async delete(id: UserId): Promise<void> {
    const supabase = await createClient()

    const { error } = await supabase
      .from('users')
      .delete()
      .eq('id', id.value)

    if (error) {
      throw new Error(`Failed to delete user: ${error.message}`)
    }
  }
}
```

---

### Step 7: Application Layer (Use Cases)

```typescript
// src/modules/user/application/services/user.service.ts
import { User } from '../../domain/entities/user.entity'
import { UserRepository } from '../../domain/repositories/user.repository.interface'
import { UserId } from '../../domain/value-objects/user-id.vo'
import { GetUserDto, UpdateUserDto } from '../dtos/user.dto'

export class UserService {
  constructor(private readonly userRepository: UserRepository) {}

  async getUser(dto: GetUserDto): Promise<User | null> {
    const userId = UserId.create(dto.id)
    return this.userRepository.findById(userId)
  }

  async updateProfile(dto: UpdateUserDto): Promise<User> {
    const userId = UserId.create(dto.id)
    const user = await this.userRepository.findById(userId)

    if (!user) {
      throw new Error('User not found')
    }

    const updatedUser = user.updateProfile(dto.name, dto.profileImage ?? null)
    await this.userRepository.save(updatedUser)

    return updatedUser
  }

  async promoteToAdmin(dto: GetUserDto): Promise<User> {
    const userId = UserId.create(dto.id)
    const user = await this.userRepository.findById(userId)

    if (!user) {
      throw new Error('User not found')
    }

    const adminUser = user.promoteToAdmin()
    await this.userRepository.save(adminUser)

    return adminUser
  }
}
```

---

### Step 8: Presentation Layer (API Routes)

```typescript
// src/app/api/users/[id]/route.ts
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { UserService } from '@/modules/user/application/services/user.service'
import { SupabaseUserRepository } from '@/modules/user/infrastructure/persistence/supabase-user.repository'

const userService = new UserService(new SupabaseUserRepository())

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const { data: { user: authUser } } = await supabase.auth.getUser()

  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await userService.getUser({ id: params.id })

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  return NextResponse.json({
    id: user.id.value,
    email: user.email.value,
    name: user.name,
    profileImage: user.profileImage,
    role: user.role,
  })
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const supabase = await createClient()
  const { data: { user: authUser } } = await supabase.auth.getUser()

  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 본인만 수정 가능
  if (authUser.id !== params.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const user = await userService.updateProfile({
    id: params.id,
    name: body.name,
    profileImage: body.profileImage,
  })

  return NextResponse.json({
    id: user.id.value,
    email: user.email.value,
    name: user.name,
    profileImage: user.profileImage,
  })
}
```

---

### Step 9: Frontend Auth Hooks

```typescript
// src/hooks/useAuth.ts
'use client'

import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { useCallback } from 'react'

export function useAuth() {
  const supabase = createClient()
  const router = useRouter()

  const signInWithGoogle = useCallback(async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (error) throw error
  }, [supabase])

  const signInWithKakao = useCallback(async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'kakao' as any, // Custom OIDC
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (error) throw error
  }, [supabase])

  const signInWithNaver = useCallback(async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'naver' as any, // Custom OIDC
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (error) throw error
  }, [supabase])

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
    router.push('/login')
    router.refresh()
  }, [supabase, router])

  return {
    signInWithGoogle,
    signInWithKakao,
    signInWithNaver,
    signOut,
  }
}
```

```typescript
// src/hooks/useUser.ts
'use client'

import { createClient } from '@/lib/supabase/client'
import { User } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'

export function useUser() {
  const supabase = createClient()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)
      setLoading(false)
    }

    getUser()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null)
        setLoading(false)
      }
    )

    return () => subscription.unsubscribe()
  }, [supabase])

  return { user, loading }
}
```

---

### Step 10: Database Schema (Supabase SQL)

```sql
-- Supabase Dashboard → SQL Editor에서 실행

-- Users 테이블 (auth.users 확장)
CREATE TABLE public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  profile_image TEXT,
  role TEXT NOT NULL DEFAULT 'USER' CHECK (role IN ('USER', 'ADMIN')),
  provider TEXT NOT NULL CHECK (provider IN ('google', 'kakao', 'naver', 'email')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS 활성화
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own profile"
  ON public.users FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.users FOR UPDATE
  USING (auth.uid() = id);

-- Admin은 모든 사용자 조회 가능
CREATE POLICY "Admins can view all users"
  ON public.users FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role = 'ADMIN'
    )
  );

-- 새 사용자 가입 시 자동으로 users 테이블에 추가
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, name, profile_image, provider)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    NEW.raw_user_meta_data->>'avatar_url',
    COALESCE(NEW.raw_app_meta_data->>'provider', 'email')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Updated At 자동 갱신
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
```

---

## ✅ 체크리스트

### Supabase 설정
- [ ] Supabase 프로젝트 생성
- [ ] 환경 변수 설정 (URL, ANON_KEY, SERVICE_ROLE_KEY)
- [ ] Google OAuth Provider 설정
- [ ] Kakao Custom OIDC 설정
- [ ] Naver Custom OIDC 설정
- [ ] Database 테이블 생성 (SQL)
- [ ] RLS Policies 설정

### 코드 구현
- [ ] Supabase Client 설정 (client, server, admin)
- [ ] Middleware 설정 (토큰 갱신)
- [ ] OAuth Callback Route 구현
- [ ] Domain Layer (Entity, Value Objects, Repository Interface)
- [ ] Infrastructure Layer (Supabase Repository, Mapper)
- [ ] Application Layer (Services)
- [ ] Presentation Layer (API Routes)
- [ ] Frontend Hooks (useAuth, useUser)

### 보안
- [ ] SERVICE_ROLE_KEY 서버에서만 사용
- [ ] RLS 활성화 및 정책 설정
- [ ] Middleware에서 보호된 경로 체크

---

## ❌ Anti-Patterns

### 1. Domain Layer에서 Supabase 직접 사용

```typescript
// ❌ BAD - Domain이 Infrastructure 의존
import { createClient } from '@/lib/supabase/client'

export class User {
  async save() {
    const supabase = createClient()
    await supabase.from('users').insert(this) // ❌ 절대 금지!
  }
}
```

### 2. 클라이언트에서 Service Role Key 사용

```typescript
// ❌ BAD - Service Role Key 노출
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // ❌ 브라우저에 노출됨!
)
```

### 3. RLS 없이 운영

```typescript
// ❌ BAD - RLS 비활성화 상태로 운영
// 누구나 모든 데이터 접근 가능
```

---

## 🔗 다른 Guide와의 관계

| 상황 | 참조할 문서 |
|------|------------|
| OAuth 상세 설정 | 이 문서 (supabase-guide.md) |
| LLM 기능 추가 시 | `llm-guide.md` |
| 결제 기능 추가 시 | `toss-payments.md` |
| Frontend 상태 관리 | `api-state.md` |
| 테스트 작성 | `testing.md` |
