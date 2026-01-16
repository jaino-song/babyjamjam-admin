# Next.js + NestJS 풀스택 개발에서 마주친 이슈들

> Next.js App Router와 NestJS를 함께 사용할 때 발생한 실제 문제들과 해결 방법을 공유합니다.

## 목차
1. [API Route 프록시 패턴과 Authorization 헤더](#1-api-route-프록시-패턴과-authorization-헤더)
2. [405 Method Not Allowed - 누락된 HTTP 메서드](#2-405-method-not-allowed---누락된-http-메서드)
3. [DTO Validation과 Optional 필드](#3-dto-validation과-optional-필드)
4. [SSR과 CSR 사이의 중복 API 호출 최적화](#4-ssr과-csr-사이의-중복-api-호출-최적화)

---

## 아키텍처 개요

이 프로젝트에서는 Next.js API Route를 **프록시**로 사용하는 아키텍처를 채택했습니다:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│     Browser     │────▶│  Next.js API    │────▶│  NestJS API     │
│   (Client)      │     │  Route (Proxy)  │     │  (Backend)      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                      │                       │
         │   /api/clients       │   /clients            │
         │   (Same Origin)      │   (Cross Origin)      │
```

### 이 아키텍처의 장점
- **CORS 이슈 우회**: 브라우저에서 Same-Origin 요청
- **백엔드 URL 노출 방지**: 실제 API 서버 주소 숨김
- **서버 사이드 토큰 관리**: HTTP-only 쿠키에서 토큰 추출
- **요청/응답 가공**: 미들웨어, 캐싱, Rate Limiting 적용 가능

---

## 1. API Route 프록시 패턴과 Authorization 헤더

### 문제 상황

고객 목록을 조회하는데 계속 401 Unauthorized 에러가 발생했습니다.

```typescript
// frontend/app/api/clients/route.ts (문제 코드)
export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    
    // 🐛 Authorization 헤더 없이 요청!
    const response = await serverAPIClient.get("/clients", {
        params: Object.fromEntries(searchParams),
    });
    
    return NextResponse.json(response.data);
}
```

백엔드의 ClientController는 JWT Guard로 보호되어 있습니다:

```typescript
// backend/interface/controllers/client.controller.ts
@Controller('clients')
@UseGuards(JwtGuard)  // 모든 엔드포인트에 인증 필요
export class ClientController {
    @Get()
    findAll() { ... }
}
```

### 원인 분석

Next.js API Route에서 백엔드로 요청을 프록시할 때, 클라이언트의 쿠키에 저장된 JWT 토큰을 **자동으로 전달하지 않습니다**. 명시적으로 Authorization 헤더를 설정해야 합니다.

```
Browser                    Next.js API Route           NestJS Backend
   │                              │                           │
   │  Cookie: auth_token=xxx     │                           │
   │─────────────────────────────▶│                           │
   │                              │  (쿠키는 자동 전달 안 됨)   │
   │                              │  Authorization: ???       │
   │                              │──────────────────────────▶│
   │                              │                           │
   │                              │        401 Unauthorized   │
   │                              │◀──────────────────────────│
```

### 해결 방법

#### 1단계: 토큰 추출 유틸리티 함수

```typescript
// frontend/lib/auth/getAccessToken.ts
import { cookies } from 'next/headers';

export async function getAccessToken(): Promise<string | null> {
    const cookieStore = await cookies();
    return cookieStore.get('auth_token')?.value ?? null;
}

// 또는 Request 객체에서 직접 추출
export function getAccessTokenFromRequest(request: NextRequest): string | null {
    return request.cookies.get('auth_token')?.value ?? null;
}
```

#### 2단계: API Route에서 헤더 포함

```typescript
// frontend/app/api/clients/route.ts (수정된 코드)
import { getAccessTokenFromRequest } from '@/lib/auth/getAccessToken';

export async function GET(request: NextRequest) {
    const accessToken = getAccessTokenFromRequest(request);
    const { searchParams } = new URL(request.url);
    
    // ✅ Authorization 헤더 포함
    const response = await serverAPIClient.get("/clients", {
        params: Object.fromEntries(searchParams),
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });
    
    return NextResponse.json(response.data);
}
```

#### 3단계: 재사용 가능한 프록시 헬퍼 (권장)

```typescript
// frontend/lib/api/proxyRequest.ts
import { NextRequest, NextResponse } from 'next/server';
import { serverAPIClient } from '@/lib/axios/server';

interface ProxyOptions {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    path: string;
    request: NextRequest;
}

export async function proxyToBackend({ method, path, request }: ProxyOptions) {
    const accessToken = request.cookies.get('auth_token')?.value;
    
    const headers = {
        Authorization: accessToken ? `Bearer ${accessToken}` : '',
    };
    
    try {
        let response;
        
        switch (method) {
            case 'GET':
                const { searchParams } = new URL(request.url);
                response = await serverAPIClient.get(path, {
                    params: Object.fromEntries(searchParams),
                    headers,
                });
                break;
                
            case 'POST':
                const postBody = await request.json();
                response = await serverAPIClient.post(path, postBody, { headers });
                break;
                
            case 'PATCH':
                const patchBody = await request.json();
                response = await serverAPIClient.patch(path, patchBody, { headers });
                break;
                
            case 'DELETE':
                response = await serverAPIClient.delete(path, { headers });
                break;
        }
        
        return NextResponse.json(response.data, { status: response.status });
    } catch (error: any) {
        return NextResponse.json(
            { error: error.response?.data?.message || 'Internal Server Error' },
            { status: error.response?.status || 500 }
        );
    }
}
```

사용 예시:
```typescript
// frontend/app/api/clients/route.ts
export async function GET(request: NextRequest) {
    return proxyToBackend({ method: 'GET', path: '/clients', request });
}

export async function POST(request: NextRequest) {
    return proxyToBackend({ method: 'POST', path: '/clients', request });
}
```

---

## 2. 405 Method Not Allowed - 누락된 HTTP 메서드

### 문제 상황

직원 생성 버튼을 클릭하면 405 에러가 발생했습니다.

```
POST http://localhost:3000/api/employees 405 (Method Not Allowed)
```

### 원인 분석

Next.js API Route 파일에 GET 메서드만 구현되어 있었습니다:

```typescript
// frontend/app/api/employees/route.ts (문제 코드)
export async function GET(request: NextRequest) {
    // GET만 구현됨
    const response = await serverAPIClient.get("/employees", ...);
    return NextResponse.json(response.data);
}

// POST, PATCH, DELETE 없음!
```

Next.js API Route는 **명시적으로 export된 HTTP 메서드만** 처리합니다. 다른 메서드로 요청하면 자동으로 405를 반환합니다.

### 해결 방법

필요한 모든 HTTP 메서드를 구현합니다:

```typescript
// frontend/app/api/employees/route.ts (수정된 코드)
import { NextRequest, NextResponse } from 'next/server';
import { serverAPIClient } from '@/lib/axios/server';

// 조회
export async function GET(request: NextRequest) {
    const accessToken = getAccessToken(request);
    const { searchParams } = new URL(request.url);
    
    const response = await serverAPIClient.get("/employees", {
        params: Object.fromEntries(searchParams),
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    
    return NextResponse.json(response.data);
}

// 생성
export async function POST(request: NextRequest) {
    const accessToken = getAccessToken(request);
    const body = await request.json();
    
    const response = await serverAPIClient.post("/employees", body, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    
    return NextResponse.json(response.data, { status: 201 });
}

// 수정 (단일 리소스가 아닌 경우)
export async function PATCH(request: NextRequest) {
    const accessToken = getAccessToken(request);
    const body = await request.json();
    
    const response = await serverAPIClient.patch(`/employees/${body.id}`, body, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    
    return NextResponse.json(response.data);
}

// 삭제
export async function DELETE(request: NextRequest) {
    const accessToken = getAccessToken(request);
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    await serverAPIClient.delete(`/employees/${id}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    
    return NextResponse.json({ success: true });
}
```

### Dynamic Route 활용 (권장)

단일 리소스 작업은 Dynamic Route를 사용하는 것이 더 RESTful합니다:

```
app/api/employees/
├── route.ts              # GET (목록), POST (생성)
└── [id]/
    └── route.ts          # GET (단일), PATCH (수정), DELETE (삭제)
```

```typescript
// frontend/app/api/employees/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';

type Params = { params: { id: string } };

export async function GET(request: NextRequest, { params }: Params) {
    const { id } = params;
    const response = await serverAPIClient.get(`/employees/${id}`, ...);
    return NextResponse.json(response.data);
}

export async function PATCH(request: NextRequest, { params }: Params) {
    const { id } = params;
    const body = await request.json();
    const response = await serverAPIClient.patch(`/employees/${id}`, body, ...);
    return NextResponse.json(response.data);
}

export async function DELETE(request: NextRequest, { params }: Params) {
    const { id } = params;
    await serverAPIClient.delete(`/employees/${id}`, ...);
    return new NextResponse(null, { status: 204 });
}
```

---

## 3. DTO Validation과 Optional 필드

### 문제 상황

직원 등록 시 백엔드에서 Validation 에러가 발생했습니다:

```json
{
    "statusCode": 400,
    "message": ["registeredDate must be a valid ISO 8601 date string"],
    "error": "Bad Request"
}
```

### 원인 분석

백엔드 DTO에서 `registeredDate`가 필수 필드로 설정되어 있었지만, 프론트엔드에서는 선택적으로 전송하고 있었습니다:

```typescript
// backend/interface/dto/employee.dto.ts (문제 코드)
export class CreateEmployeeDto {
    @IsString()
    name!: string;
    
    @IsDateString()
    registeredDate!: string;  // 필수 필드로 설정됨
    
    // ...
}
```

### 해결 방법

#### 방법 1: DTO를 Optional로 수정

```typescript
// backend/interface/dto/employee.dto.ts (수정된 코드)
import { IsOptional, IsDateString, IsString } from 'class-validator';

export class CreateEmployeeDto {
    @IsString()
    name!: string;
    
    @IsOptional()           // Optional 데코레이터 추가
    @IsDateString()
    registeredDate?: string;  // 타입도 optional로 변경
}
```

#### 방법 2: 서비스에서 기본값 설정

```typescript
// backend/application/services/employee.service.ts
async create(dto: CreateEmployeeDto) {
    return this.employeeRepository.create({
        ...dto,
        registeredDate: dto.registeredDate ?? new Date().toISOString(),
    });
}
```

#### 방법 3: DTO에서 Transform으로 기본값 설정

```typescript
import { Transform } from 'class-transformer';

export class CreateEmployeeDto {
    @IsDateString()
    @Transform(({ value }) => value ?? new Date().toISOString())
    registeredDate!: string;
}
```

### DTO 설계 베스트 프랙티스

```typescript
// Create DTO - 생성 시 필요한 필드만
export class CreateEmployeeDto {
    @IsString()
    @IsNotEmpty()
    name!: string;
    
    @IsOptional()
    @IsDateString()
    registeredDate?: string;
}

// Update DTO - 모든 필드를 Optional로
export class UpdateEmployeeDto {
    @IsOptional()
    @IsString()
    name?: string;
    
    @IsOptional()
    @IsDateString()
    registeredDate?: string;
}

// 또는 PartialType 사용 (NestJS 제공)
import { PartialType } from '@nestjs/mapped-types';

export class UpdateEmployeeDto extends PartialType(CreateEmployeeDto) {}
```

---

## 4. SSR과 CSR 사이의 중복 API 호출 최적화

### 문제 상황

대시보드 페이지 로딩 시 `/auth/me` API가 **2번** 호출되었습니다. Network 탭에서 확인:

```
1. /auth/me (Server Component에서)
2. /auth/me (Client Component에서)
```

로딩 시간: 400-600ms

### 원인 분석

```typescript
// dashboard/page.tsx (Server Component)
export default async function DashboardPage() {
    const user = await getCurrentUser();  // 1번째 호출
    
    return (
        <DashboardLayout user={user}>
            <Header />  {/* 내부에서 또 호출 */}
        </DashboardLayout>
    );
}

// Header.tsx (Client Component)
'use client';
export function Header() {
    // 2번째 호출 - 서버에서 이미 가져온 데이터를 모름
    const { data: user, isLoading } = useGetAuthUser();
    
    if (isLoading) return <Skeleton />;
    return <UserMenu user={user} />;
}
```

서버 컴포넌트에서 가져온 데이터가 클라이언트 컴포넌트로 **전달되지 않아** 클라이언트에서 다시 요청하는 문제입니다.

### 해결 방법

#### 1단계: UserProvider Context 생성

```typescript
// components/providers/UserProvider.tsx
'use client';

import { createContext, useContext, useMemo, ReactNode } from 'react';

interface User {
    id: number;
    name: string;
    email: string;
    role: string;
}

interface UserContextType {
    initialUser: User | null;
}

const UserContext = createContext<UserContextType | null>(null);

export function UserProvider({ 
    initialUser, 
    children 
}: { 
    initialUser: User | null; 
    children: ReactNode 
}) {
    // useMemo로 불필요한 리렌더링 방지
    const contextValue = useMemo(
        () => ({ initialUser }), 
        [initialUser]
    );
    
    return (
        <UserContext.Provider value={contextValue}>
            {children}
        </UserContext.Provider>
    );
}

export function useInitialUser() {
    const context = useContext(UserContext);
    if (!context) {
        throw new Error('useInitialUser must be used within UserProvider');
    }
    return context.initialUser;
}
```

#### 2단계: Layout에서 Provider 적용

```typescript
// dashboard/layout.tsx
import { getCurrentUser } from '@/lib/auth/cookies';
import { UserProvider } from '@/components/providers/UserProvider';

export default async function DashboardLayout({ 
    children 
}: { 
    children: React.ReactNode 
}) {
    const user = await getCurrentUser();  // 서버에서 1번만 호출
    
    return (
        <UserProvider initialUser={user}>
            {children}
        </UserProvider>
    );
}
```

#### 3단계: useGetAuthUser 훅 수정 (initialData 지원)

```typescript
// hooks/useGetAuthUser.ts
import { useQuery } from '@tanstack/react-query';
import { useInitialUser } from '@/components/providers/UserProvider';

interface UseGetAuthUserOptions {
    initialData?: User | null;
}

export function useGetAuthUser(options?: UseGetAuthUserOptions) {
    // Provider에서 초기 데이터 가져오기
    const initialUser = useInitialUser();
    
    return useQuery({
        queryKey: ['authUser'],
        queryFn: fetchAuthUser,
        staleTime: 1000 * 60 * 30,     // 30분간 fresh
        gcTime: 1000 * 60 * 60,         // 1시간 후 GC
        // Provider 또는 직접 전달받은 initialData 사용
        initialData: options?.initialData ?? initialUser ?? undefined,
    });
}
```

#### 4단계: Header에서 사용 (중복 호출 제거됨)

```typescript
// Header.tsx (수정 후)
'use client';

export function Header() {
    // initialData가 있으므로 즉시 렌더링, API 호출 없음
    const { data: user } = useGetAuthUser();
    
    // isLoading 체크 불필요 - initialData로 즉시 표시
    return <UserMenu user={user} />;
}
```

#### 5단계: 서버 사이드 중복 방지 (React cache)

서버 컴포넌트 내에서도 같은 데이터를 여러 번 요청할 수 있습니다. React의 `cache`로 방지:

```typescript
// lib/auth/cookies.ts
import { cache } from 'react';
import { cookies } from 'next/headers';

// cache()로 같은 요청 사이클 내 중복 방지
export const getCurrentUser = cache(async (): Promise<User | null> => {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth_token')?.value;
    
    if (!token) return null;
    
    try {
        const response = await fetch(`${API_URL}/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        return response.json();
    } catch {
        return null;
    }
});
```

### 결과

| 지표 | 최적화 전 | 최적화 후 |
|------|----------|----------|
| `/auth/me` 호출 횟수 | 2회 | 1회 |
| 대시보드 로딩 시간 | 400-600ms | 100-200ms |
| Header 로딩 스피너 | 표시됨 | 즉시 렌더링 |

### 데이터 흐름 비교

**최적화 전:**
```
Server Component ─────▶ API 호출 (1)
        │
        ▼
    HTML 전송
        │
        ▼
Client Hydration
        │
        ▼
Client Component ─────▶ API 호출 (2)
```

**최적화 후:**
```
Server Component ─────▶ API 호출 (1회만)
        │
        │  UserProvider에 데이터 주입
        ▼
    HTML 전송 (데이터 포함)
        │
        ▼
Client Hydration
        │
        ▼
Client Component ─────▶ initialData 사용 (API 호출 없음)
```

---

## 정리: Next.js + NestJS 풀스택 체크리스트

### API Route 프록시
- [ ] Authorization 헤더 명시적 전달
- [ ] 에러 핸들링 및 적절한 상태 코드 반환
- [ ] 재사용 가능한 프록시 헬퍼 함수 작성

### HTTP 메서드
- [ ] 필요한 모든 메서드 구현 (GET, POST, PATCH, DELETE)
- [ ] Dynamic Route로 RESTful 구조 설계
- [ ] 적절한 HTTP 상태 코드 반환 (201, 204 등)

### DTO Validation
- [ ] Create/Update DTO 분리
- [ ] Optional 필드에 @IsOptional() 데코레이터
- [ ] 기본값 처리 전략 수립

### 데이터 흐름 최적화
- [ ] Server → Client 데이터 전달 (Context/Props)
- [ ] React Query initialData 활용
- [ ] React cache()로 서버 사이드 중복 방지
- [ ] 적절한 staleTime/gcTime 설정

---

## 참고 자료

- [Next.js Route Handlers](https://nextjs.org/docs/app/building-your-application/routing/route-handlers)
- [React Query - Initial Query Data](https://tanstack.com/query/latest/docs/react/guides/initial-query-data)
- [NestJS Validation](https://docs.nestjs.com/techniques/validation)
- [React cache() function](https://react.dev/reference/react/cache)
