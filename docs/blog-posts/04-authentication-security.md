# 인증과 보안: OAuth, JWT, 그리고 실수로부터 배우기

> 프로덕션 환경에서 발생한 보안 이슈들과 해결 방법을 공유합니다. 개발 편의 기능이 어떻게 보안 취약점이 될 수 있는지도 다룹니다.

## 목차
1. [개발 환경 인증 바이패스의 위험성](#1-개발-환경-인증-바이패스의-위험성)
2. [역할 기반 JWT 토큰 만료 전략](#2-역할-기반-jwt-토큰-만료-전략)
3. [React Server Components CVE 대응](#3-react-server-components-cve-대응)
4. [Mobile Safari OAuth 문제와 Server Actions](#4-mobile-safari-oauth-문제와-server-actions)

---

## 1. 개발 환경 인증 바이패스의 위험성

### 문제 상황

개발 편의를 위해 추가한 인증 바이패스 코드가 **프리뷰 환경까지 적용**되어, 인증 없이 모든 API에 접근 가능한 심각한 보안 취약점이 발생했습니다.

### 문제가 된 코드

```typescript
// backend/infrastructure/auth/jwt.guard.ts
@Injectable()
export class JwtGuard extends AuthGuard('jwt') {
    canActivate(context: ExecutionContext) {
        // 🚨 위험: 개발/프리뷰 환경에서 인증 완전 우회
        if (process.env.NODE_ENV === 'development' || 
            process.env.VERCEL_ENV === 'preview') {
            return true;
        }
        
        return super.canActivate(context);
    }
}
```

```typescript
// frontend/src/app/lib/auth/cookies.ts
export async function getCurrentUser(): Promise<User | null> {
    // 🚨 위험: 개발/프리뷰 환경에서 가짜 사용자 반환
    if (process.env.NODE_ENV === 'development' || 
        process.env.VERCEL_ENV === 'preview') {
        return {
            id: 999,
            name: 'Dev User',
            email: 'dev@example.com',
            role: 'owner',  // 최고 권한!
        };
    }
    
    // 실제 인증 로직...
}
```

### 왜 위험한가?

| 환경 | NODE_ENV | VERCEL_ENV | 접근 가능 여부 |
|------|----------|------------|--------------|
| 로컬 개발 | development | - | 공개 (의도함) |
| Vercel Preview | production | preview | **공개 (의도 안 함!)** |
| Vercel Production | production | production | 인증 필요 |

**Vercel Preview 환경**은:
- PR을 올리면 자동으로 생성되는 미리보기 URL
- 누구나 URL을 알면 접근 가능
- `VERCEL_ENV=preview`로 설정됨
- **실제 프로덕션 데이터베이스에 연결될 수 있음**

### 해결 방법

#### 1단계: 모든 바이패스 코드 제거

```typescript
// backend/infrastructure/auth/jwt.guard.ts
@Injectable()
export class JwtGuard extends AuthGuard('jwt') {
    canActivate(context: ExecutionContext) {
        // ✅ 모든 환경에서 인증 필수
        return super.canActivate(context);
    }
}
```

```typescript
// frontend/src/app/lib/auth/cookies.ts
export async function getCurrentUser(): Promise<User | null> {
    // ✅ 모든 환경에서 실제 인증
    const token = cookies().get('auth_token')?.value;
    if (!token) return null;
    
    const response = await fetch(`${API_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    
    return response.ok ? response.json() : null;
}
```

#### 2단계: 로컬 개발용 대안 마련

개발 편의성을 포기하지 않으면서 보안을 유지하는 방법:

```typescript
// .env.local (git에서 제외됨)
DEV_AUTH_BYPASS=true
DEV_USER_EMAIL=dev@example.com

// jwt.guard.ts
@Injectable()
export class JwtGuard extends AuthGuard('jwt') {
    canActivate(context: ExecutionContext) {
        // 로컬에서만, 그리고 명시적 플래그가 있을 때만
        if (process.env.NODE_ENV === 'development' && 
            process.env.DEV_AUTH_BYPASS === 'true' &&
            !process.env.VERCEL) {  // Vercel 환경이 아닐 때만
            return true;
        }
        
        return super.canActivate(context);
    }
}
```

#### 3단계: Preview 환경 보호

```typescript
// middleware.ts (Next.js)
export function middleware(request: NextRequest) {
    // Preview 환경에서 기본 인증 추가
    if (process.env.VERCEL_ENV === 'preview') {
        const authHeader = request.headers.get('authorization');
        const expectedAuth = `Basic ${btoa(process.env.PREVIEW_AUTH!)}`;
        
        if (authHeader !== expectedAuth) {
            return new NextResponse('Authentication required', {
                status: 401,
                headers: { 'WWW-Authenticate': 'Basic' },
            });
        }
    }
    
    return NextResponse.next();
}
```

### 핵심 교훈

> **개발 편의 기능은 절대 `NODE_ENV`나 `VERCEL_ENV`에만 의존하지 마라.**

1. Preview/Staging 환경은 production과 동일한 보안 수준 유지
2. 개발용 바이패스는 **로컬 환경변수**로만 활성화
3. 바이패스 코드에는 반드시 주석으로 위험성 명시

```typescript
// ⚠️ WARNING: This bypass is ONLY for local development.
// Never enable in any deployed environment.
// See: BUGFIX.md #15 for the security incident this caused.
```

---

## 2. 역할 기반 JWT 토큰 만료 전략

### 문제 상황

관리자(`owner`)와 매니저(`manager`)가 자주 로그아웃되어 업무 효율이 저하되었습니다.

### 원인 분석

모든 사용자에게 동일한 짧은 토큰 만료 시간 적용:
- Access Token: 3일
- Refresh Token: 1일

매일 8시간 근무하는 관리자는 3일마다 재로그인 필요.

### 해결 방법: 역할 기반 만료 시간

```typescript
// backend/application/services/auth.service.ts
@Injectable()
export class AuthService {
    async validateKakaoUser(kakaoData: KakaoData) {
        const user = await this.findOrCreateUser(kakaoData);
        
        // 역할에 따른 토큰 만료 시간 설정
        const isPrivilegedRole = ['owner', 'manager'].includes(user.role);
        
        const accessTokenOptions = isPrivilegedRole
            ? { expiresIn: '30d' }   // 관리자: 30일
            : { expiresIn: '3d' };   // 일반 사용자: 3일
        
        const refreshTokenOptions = isPrivilegedRole
            ? { expiresIn: '7d' }    // 관리자: 7일
            : { expiresIn: '1d' };   // 일반 사용자: 1일
        
        const accessToken = await this.jwtService.signAsync(
            { sub: user.id, role: user.role, type: 'access' },
            accessTokenOptions
        );
        
        const refreshToken = await this.jwtService.signAsync(
            { sub: user.id, role: user.role, type: 'refresh' },
            refreshTokenOptions
        );
        
        return { user, accessToken, refreshToken };
    }
}
```

### 결과

| 역할 | Access Token | Refresh Token | 재로그인 주기 |
|------|--------------|---------------|--------------|
| owner, manager | 30일 | 7일 | ~30일 |
| user | 3일 | 1일 | ~3일 |

### 쿠키 설정도 역할 기반으로

```typescript
// frontend/app/auth/callback/actions.ts
'use server';

export async function exchangeToken(code: string) {
    const { data } = await serverAPIClient.post('/auth/token', { code });
    
    // 토큰에서 역할 추출
    const decoded = jwtDecode<{ role: string }>(data.accessToken);
    const isPrivileged = ['owner', 'manager'].includes(decoded.role);
    
    const cookieStore = await cookies();
    
    // 역할에 따른 쿠키 maxAge 설정
    cookieStore.set('auth_token', data.accessToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: isPrivileged 
            ? 30 * 24 * 60 * 60   // 30일
            : 3 * 24 * 60 * 60,   // 3일
    });
    
    cookieStore.set('refresh_token', data.refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 7 * 24 * 60 * 60,  // 7일 (모든 역할 동일)
    });
    
    return { success: true };
}
```

### 보안 고려사항

긴 토큰 만료 시간의 위험을 완화하기 위한 추가 조치:

```typescript
// 1. 중요 작업 시 재인증 요구
@UseGuards(JwtGuard, ReauthGuard)
@Post('delete-all-data')
async dangerousOperation() { ... }

// 2. 토큰 강제 무효화 기능
async revokeAllTokens(userId: number) {
    await this.prisma.user.update({
        where: { id: userId },
        data: { tokenVersion: { increment: 1 } },
    });
}

// 3. 토큰 검증 시 버전 확인
async validateToken(token: string) {
    const payload = this.jwtService.verify(token);
    const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
    });
    
    if (payload.tokenVersion !== user.tokenVersion) {
        throw new UnauthorizedException('Token revoked');
    }
}
```

---

## 3. React Server Components CVE 대응

### 문제 상황

보안 스캔에서 React Server Components 관련 CVE 취약점이 발견되었습니다.

### 영향받은 패키지

- `next`
- `react-server-dom-webpack`
- `react-server-dom-parcel`
- `react-server-dom-turbopack`

### 해결 방법

Vercel에서 제공하는 자동 패치 도구 사용:

```bash
# 취약한 패키지를 자동으로 탐지하고 패치
npx fix-react2shell-next
```

### 수동 패치 (필요 시)

```json
// package.json
{
    "overrides": {
        "react-server-dom-webpack": "^19.0.0-rc.1"
    }
}
```

```bash
# 의존성 재설치
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

### 예방 조치

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/frontend"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 10
    
  - package-ecosystem: "npm"
    directory: "/backend"
    schedule:
      interval: "weekly"
```

```yaml
# .github/workflows/security-scan.yml
name: Security Scan
on:
  schedule:
    - cron: '0 0 * * *'  # 매일 자정
  push:
    branches: [main]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm audit --audit-level=high
        working-directory: ./frontend
      - run: npm audit --audit-level=high
        working-directory: ./backend
```

---

## 4. Mobile Safari OAuth 문제와 Server Actions

### 문제 상황

모바일 Safari에서 카카오 OAuth 로그인 후 토큰 교환이 실패했습니다.

```
Network Error: Failed to fetch
```

데스크톱 브라우저에서는 정상 작동.

### 원인 분석

Safari의 **ITP (Intelligent Tracking Prevention)**가 OAuth 리다이렉트 후의 클라이언트 사이드 요청을 차단했습니다.

```typescript
// 🚨 Safari ITP에 의해 차단됨
// frontend/app/auth/callback/page.tsx
'use client';

export default function AuthCallback() {
    useEffect(() => {
        const code = searchParams.get('code');
        
        // Safari가 이 요청을 차단!
        // OAuth 리다이렉트 직후의 cross-origin 요청으로 간주
        axios.post('/api/auth/token', { code })
            .then(response => { ... })
            .catch(error => {
                // Network Error
            });
    }, []);
}
```

**Safari ITP의 동작:**
1. 사용자가 카카오(외부 도메인)에서 로그인
2. 우리 사이트로 리다이렉트
3. Safari: "이건 cross-site tracking일 수 있어!"
4. 클라이언트 사이드 fetch/axios 요청 차단

### 해결 방법: Server Actions 사용

Server Actions는 **서버에서 실행**되므로 Safari ITP의 영향을 받지 않습니다.

```typescript
// frontend/app/auth/callback/actions.ts
'use server';

import { cookies } from 'next/headers';
import { serverAPIClient } from '@/lib/axios/server';

export async function exchangeToken(code: string) {
    try {
        // 서버에서 실행 - ITP 우회
        const { data } = await serverAPIClient.post('/auth/token', { code });
        
        const cookieStore = await cookies();
        
        cookieStore.set('auth_token', data.accessToken, {
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
            path: '/',
        });
        
        return { success: true };
    } catch (error) {
        return { success: false, error: 'Token exchange failed' };
    }
}
```

```typescript
// frontend/app/auth/callback/page.tsx
'use client';

import { exchangeToken } from './actions';

export default function AuthCallback() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [error, setError] = useState<string | null>(null);
    
    useEffect(() => {
        const handleAuth = async () => {
            const code = searchParams.get('code');
            
            if (!code) {
                setError('Authorization code not found');
                return;
            }
            
            // Server Action 호출 - Safari에서도 작동!
            const result = await exchangeToken(code);
            
            if (result.success) {
                router.replace('/dashboard');
            } else {
                setError(result.error || 'Authentication failed');
            }
        };
        
        handleAuth();
    }, [searchParams, router]);
    
    if (error) {
        return <ErrorDisplay message={error} />;
    }
    
    return <LoadingSpinner message="로그인 중..." />;
}
```

### Server Actions vs API Routes

| 특성 | Server Actions | API Routes |
|------|---------------|------------|
| 실행 위치 | 서버 | 서버 |
| Safari ITP | 영향 없음 | 클라이언트 호출 시 영향받을 수 있음 |
| 쿠키 설정 | `cookies()` 직접 사용 | `NextResponse.cookies` |
| 타입 안전성 | 함수 시그니처로 보장 | 수동 검증 필요 |
| 번들 크기 | 클라이언트에 포함 안 됨 | Route 파일 별도 |

### OAuth 플로우 전체 구조

```
┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
│  User   │───▶│  Kakao  │───▶│ Backend │───▶│Frontend │
│ Browser │    │  OAuth  │    │ NestJS  │    │ Next.js │
└─────────┘    └─────────┘    └─────────┘    └─────────┘
     │              │              │              │
     │ 1. Login     │              │              │
     │─────────────▶│              │              │
     │              │              │              │
     │ 2. Callback  │              │              │
     │◀─────────────│              │              │
     │              │              │              │
     │ 3. Auth Code │              │              │
     │──────────────┼─────────────▶│              │
     │              │              │              │
     │              │  4. Create   │              │
     │              │  Temp Code   │              │
     │              │              │              │
     │ 5. Redirect with temp code  │              │
     │◀─────────────┼──────────────┼──────────────│
     │              │              │              │
     │              │              │  6. Server   │
     │              │              │     Action   │
     │              │              │◀─────────────│
     │              │              │              │
     │              │  7. Exchange │              │
     │              │     Tokens   │              │
     │              │◀─────────────┼──────────────│
     │              │              │              │
     │              │              │  8. Set      │
     │              │              │  Cookies     │
     │              │              │─────────────▶│
     │              │              │              │
     │ 9. Redirect to Dashboard    │              │
     │◀─────────────┼──────────────┼──────────────│
```

---

## 정리: 인증/보안 체크리스트

### 개발 환경 분리
- [ ] 개발용 바이패스는 `VERCEL` 환경변수로 배포 환경 구분
- [ ] Preview 환경은 Production과 동일한 보안 수준
- [ ] 바이패스 코드에 경고 주석 필수

### JWT 토큰
- [ ] 역할에 따른 만료 시간 차등 적용
- [ ] 중요 작업 시 재인증 요구
- [ ] 토큰 강제 무효화 기능 구현

### 보안 패치
- [ ] Dependabot 또는 유사 도구 설정
- [ ] 정기적인 `npm audit` 실행
- [ ] CVE 발생 시 신속한 패치 적용

### OAuth 구현
- [ ] Server Actions로 토큰 교환 (Safari ITP 우회)
- [ ] HTTP-only 쿠키로 토큰 저장
- [ ] 짧은 만료 시간의 임시 코드 사용

---

## 참고 자료

- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [Safari ITP Documentation](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/)
- [Next.js Server Actions](https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations)
- [JWT Best Practices](https://auth0.com/blog/a-look-at-the-latest-draft-for-jwt-bcp/)
