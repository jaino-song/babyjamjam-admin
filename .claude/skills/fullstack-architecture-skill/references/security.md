# Security & Authentication Guide

## 인증 플로우 개요

```
┌─────────────────────────────────────────────────────────────────┐
│              OAuth + JWT Authentication Flow                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  User → Frontend → Backend → OAuth Provider → Backend → Frontend│
│         [1]        [2]           [3]            [4]       [5]   │
│                                                                  │
│  1. 로그인 버튼 클릭                                              │
│  2. OAuth Provider로 리다이렉트                                   │
│  3. 사용자 인증 & 권한 동의                                       │
│  4. Authorization Code로 콜백                                     │
│  5. Code를 Token으로 교환                                         │
└─────────────────────────────────────────────────────────────────┘
```

## 토큰 전략

| 항목 | Access Token | Refresh Token |
|------|--------------|---------------|
| 만료 | 15분 | 7일 |
| 저장 (Web) | HttpOnly Cookie | HttpOnly Cookie (path 제한) |
| 저장 (Mobile) | SecureStore | SecureStore |
| 갱신 | Refresh Token으로 | 재로그인 |

### JWT Payload 구조

```typescript
// Access Token (최소 정보만)
{
  sub: "user-uuid",
  roles: ["user"],
  iat: 1234567890,
  exp: 1234568790  // 15분 후
}

// Refresh Token은 DB 저장 (Revocation 가능)
RefreshToken {
  id: uuid,
  userId: uuid,
  deviceId: string,      // Device Binding
  familyId: uuid,        // Token Rotation 추적
  expiresAt: timestamp,
  revokedAt: timestamp?
}
```

## 플랫폼별 인증

### Web (Next.js) - HttpOnly Cookie

```typescript
// Backend: Cookie 설정
res.cookie('access_token', tokens.token, {
  httpOnly: true,     // XSS 방어
  secure: true,       // HTTPS only
  sameSite: 'strict', // CSRF 방어
  maxAge: 15 * 60 * 1000, // 15분
});

res.cookie('refresh_token', tokens.refreshToken, {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: '/auth/refresh', // 이 경로에서만 전송
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7일
});
```

### Mobile (Expo) - SecureStore + Bearer

```typescript
// Token 저장
import * as SecureStore from 'expo-secure-store';

await SecureStore.setItemAsync('accessToken', accessToken);
await SecureStore.setItemAsync('refreshToken', refreshToken);

// API 요청 시
headers: {
  Authorization: `Bearer ${await SecureStore.getItemAsync('accessToken')}`
}
```

## Backend: 하이브리드 JWT Strategy

```typescript
// jwt.strategy.ts - Cookie와 Bearer 둘 다 지원
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        // 1순위: Authorization Header (모바일 & API)
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        // 2순위: Cookie (웹 브라우저)
        (request: Request) => request?.cookies?.access_token,
      ]),
      secretOrKey: process.env.JWT_SECRET,
    });
  }
}
```

## Token 교환 엔드포인트

```typescript
// 플랫폼 감지해서 응답 방식 분기
@Post("token")
async exchangeToken(
  @Body() body: { code: string; platform?: 'web' | 'mobile' },
  @Res() res: Response,
) {
  const tokens = await this.authService.exchangeCodeForTokens(body.code);
  
  if (body.platform === 'mobile') {
    // 모바일: JSON 응답
    return res.json({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    });
  }
  
  // 웹: Cookie 설정
  this.setAuthCookies(res, tokens);
  return res.json({ success: true });
}
```

## Refresh Token Rotation

```typescript
// 보안 강화: 사용 시마다 새 토큰 발급
@Post("refresh")
async refresh(@Body() body: { refreshToken?: string }, @Req() req, @Res() res) {
  const refreshToken = body.refreshToken || req.cookies.refresh_token;
  
  // 1. 기존 토큰 검증
  const payload = await this.authService.verifyRefreshToken(refreshToken);
  
  // 2. 새 토큰 쌍 발급
  const newTokens = await this.authService.generateTokens(payload.userId);
  
  // 3. 기존 토큰 무효화 (1회용)
  await this.authService.revokeRefreshToken(refreshToken);
  
  // 4. 응답
  if (body.refreshToken) {
    // 모바일
    return res.json(newTokens);
  }
  // 웹
  this.setAuthCookies(res, newTokens);
  return res.json({ success: true });
}
```

## 보안 체크리스트

### API 보안
- [ ] Rate Limiting (IP + User 기반)
- [ ] Request Validation (Zod/class-validator)
- [ ] SQL Injection 방어 (ORM 사용)
- [ ] XSS 방어 (출력 시 Sanitize)
- [ ] CORS 설정 (허용 도메인 명시)
- [ ] Security Headers (Helmet.js)
- [ ] Sensitive Data Logging 금지
- [ ] API Versioning (/v1/, /v2/)

### 인증 보안
- [ ] Refresh Token Rotation
- [ ] Device Binding (선택)
- [ ] 동시 세션 제한 (선택)
- [ ] 비정상 로그인 감지

### 비밀 관리
```
Production:
- AWS Secrets Manager / Vault 사용
- 환경 변수로 주입
- 주기적 Rotation
- 코드에 하드코딩 절대 금지
```

## OAuth Redirect URI 설정

```
# Web
https://your-domain.com/auth/callback

# Mobile (Expo)
your-app://auth/callback
# 또는
https://auth.expo.io/@username/app-name

# 개발 환경
http://localhost:3000/auth/callback
exp://localhost:8081/--/auth/callback
```
