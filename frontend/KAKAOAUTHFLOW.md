# Kakao OAuth 2.0 Authorization Code Flow

This document describes how the secure OAuth 2.0-style authorization code flow has been implemented for Kakao authentication in this application.

## Overview

Previously, access and refresh tokens were passed directly in URL query parameters from the backend to the frontend, which posed a security vulnerability. The new implementation uses the **OAuth 2.0 Authorization Code Flow**, where:

1. The backend issues a short-lived authorization code
2. The frontend exchanges this code server-to-server for actual tokens
3. Tokens are securely stored in HTTP-only cookies

This approach prevents token exposure in browser history, logs, and referrer headers.

## Architecture Flow

```
┌─────────┐      ┌────────────┐      ┌─────────────┐      ┌──────────────┐
│  User   │─────▶│   Kakao    │─────▶│   Backend   │─────▶│   Frontend   │
│ Browser │      │   OAuth    │      │  NestJS API │      │  Next.js App │
└─────────┘      └────────────┘      └─────────────┘      └──────────────┘
     │                  │                    │                     │
     │  1. Initiate     │                    │                     │
     │─────────────────▶│                    │                     │
     │                  │                    │                     │
     │  2. OAuth Login  │                    │                     │
     │◀─────────────────│                    │                     │
     │                  │                    │                     │
     │  3. Callback     │                    │                     │
     │──────────────────┼───────────────────▶│                     │
     │                  │                    │                     │
     │                  │  4. Create Auth    │                     │
     │                  │     Code (30s)     │                     │
     │                  │                    │                     │
     │  5. Redirect with code                │                     │
     │───────────────────────────────────────┼────────────────────▶│
     │                  │                    │                     │
     │                  │  6. Exchange Code  │                     │
     │                  │     for Tokens     │                     │
     │                  │                    │◀────────────────────│
     │                  │                    │                     │
     │                  │  7. Return Tokens  │                     │
     │                  │                    │─────────────────────▶│
     │                  │                    │                     │
     │                  │                    │  8. Set HTTP-only   │
     │                  │                    │     Cookies         │
     │                  │                    │                     │
     │  9. Redirect to Dashboard             │                     │
     │◀──────────────────────────────────────┼─────────────────────│
```

## Implementation Details

### 1. User Initiates Login

**Endpoint:** `GET /auth/kakao`

User clicks the "Login with Kakao" button on the frontend, which redirects to:
```
https://api.backend.com/auth/kakao
```

This endpoint is protected by `@UseGuards(AuthGuard('kakao'))` and redirects to Kakao's OAuth login page.

**Backend Implementation:**
```typescript
// backend/interface/controllers/auth.controller.ts
@Get("kakao")
@UseGuards(AuthGuard("kakao"))
async kakaoLogin() {
    // Redirects user to Kakao login page
}
```

### 2. Kakao OAuth Callback

**Endpoint:** `GET /auth/kakao/callback`

After successful authentication, Kakao redirects back with user data:

**Backend Implementation:**
```typescript
// backend/interface/controllers/auth.controller.ts
@Get("kakao/callback")
@UseGuards(AuthGuard("kakao"))
async kakaoCallback(@Req() req: any, @Res() res: Response) {
    // 1. Validate Kakao user and generate JWT tokens
    const tokens = await this.authService.validateKakaoUser(req.user);
    
    // 2. Create short-lived authorization code
    const code = await this.authService.createAuthCode(tokens);
    
    // 3. Redirect to frontend with code
    const frontendURL = process.env.NODE_ENV === "production" 
        ? process.env.PRODUCTION_FRONTEND_URL 
        : process.env.DEVELOPMENT_FRONTEND_URL;
    
    res.redirect(`${frontendURL}/auth/callback?code=${code}`);
}
```

**Key Operations:**

#### a. User Validation & Token Generation
```typescript
// backend/application/services/auth.service.ts
async validateKakaoUser(kakaoData: KakaoData): Promise<UserValidationResult> {
    // Find or create user in database
    let user = await this.prisma.user.findFirst({
        where: { kakaoId: kakaoData.kakaoId }
    });
    
    if (!user) {
        user = await this.prisma.user.create({
            data: {
                kakaoId: kakaoData.kakaoId,
                email: kakaoData.email,
                name: kakaoData.name,
                profile_image: kakaoData.profileImage,
                role: "user",
            },
        });
    }
    
    // Generate JWT tokens with role-based expiration
    const signOptions = user.role === "owner"
        ? { expiresIn: "30d" }  // Owner: 30 days
        : { expiresIn: "3d" };   // User: 3 days
    
    const refreshSignOptions = user.role === "owner"
        ? { expiresIn: "7d" }
        : { expiresIn: "1d" };
    
    const accessToken = await this.jwt.signAsync(
        { sub: user.id, role: user.role, type: 'access' },
        signOptions
    );
    
    const refreshToken = await this.jwt.signAsync(
        { sub: user.id, role: user.role, type: 'refresh' },
        refreshSignOptions
    );
    
    return { user: user.id, accessToken, refreshToken };
}
```

#### b. Authorization Code Creation
```typescript
// backend/application/services/auth.service.ts
private authCodes = new Map<string, StoredAuthCode>();

async createAuthCode(tokens: { accessToken: string; refreshToken: string }): Promise<string> {
    // Generate secure random code
    const code = crypto.randomBytes(32).toString("hex");
    
    // Store code with 30-second expiration
    this.authCodes.set(code, {
        tokens,
        expiresAt: Date.now() + 30 * 1000, // 30 seconds
    });
    
    // Cleanup expired codes
    this.cleanupExpiredCodes();
    
    return code;
}
```

**Security Features:**
- **Short-lived:** Authorization codes expire after 30 seconds
- **One-time use:** Codes are deleted after exchange
- **Cryptographically secure:** Generated using `crypto.randomBytes(32)`
- **Automatic cleanup:** Expired codes are periodically removed

### 3. Frontend Receives Authorization Code

**Route:** `/auth/callback`

The frontend callback page receives the authorization code and exchanges it for tokens:

**Frontend Implementation:**
```typescript
// frontend/app/auth/callback/page.tsx
export default function AuthCallbackPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [error, setError] = useState<string | null>(null);
    
    useEffect(() => {
        const exchangeCodeForTokens = async () => {
            const code = searchParams.get("code");
            
            if (!code) {
                setError("Authorization Code Required");
                return;
            }
            
            try {
                // Exchange code for tokens via server-side API route
                // Note: axios client has '/api' as baseURL, so path is '/auth/token'
                await api.post("/auth/token", { code });
                
                // Redirect to dashboard on success
                router.replace("/dashboard");
            } catch (err) {
                console.error("Token Exchange Error: ", err);
                
                if (err instanceof AxiosError) {
                    const axiosError = err as AxiosError<APIErrorReponse>;
                    setError(axiosError.response?.data.error || "Authentication Failed");
                } else {
                    setError("Authentication Failed");
                }
            }
        };
        
        exchangeCodeForTokens();
    }, [searchParams, router]);
    
    // Show loading spinner or error message
    // ...
}
```

### 4. Code-to-Token Exchange (Server-Side)

**API Route:** `POST /api/auth/token`

This Next.js server-side route handles the secure exchange:

**Frontend API Route Implementation:**
```typescript
// frontend/app/api/auth/token/route.ts
export async function POST(request: NextRequest) {
    try {
        const { code } = await request.json();
        
        if (!code) {
            return NextResponse.json(
                { error: "Authorization Code Required" }, 
                { status: 400 }
            );
        }
        
        // Exchange code for tokens with backend
        const { data } = await serverAPIClient.post("/auth/token", { code });
        
        const cookieStore = await cookies();
        
        // Decode token to get role for maxAge calculation
        let role = "user";
        try {
            const decoded = jwtDecode<TokenPayload>(data.accessToken);
            role = decoded.role || "user";
        } catch {
            console.error("Failed to decode token");
        }
        
        // Set access token cookie
        cookieStore.set("auth_token", data.accessToken, {
            httpOnly: true,  // Prevents JavaScript access
            secure: isProduction,  // HTTPS only in production
            sameSite: "lax",  // Allow same-site redirects
            path: "/",
            maxAge: role === "owner" 
                ? 30 * 24 * 60 * 60  // 30 days
                : 3 * 24 * 60 * 60,  // 3 days
        });
        
        // Set refresh token cookie
        cookieStore.set("refresh_token", data.refreshToken, {
            httpOnly: true,
            secure: isProduction,
            sameSite: "lax",
            path: "/",
            maxAge: 7 * 24 * 60 * 60, // 7 days
        });
        
        return NextResponse.json({ message: "Success" }, { status: 200 });
    } catch (error) {
        // Error handling...
    }
}
```

**Backend Token Exchange:**
```typescript
// backend/interface/controllers/auth.controller.ts
@Post("token")
async exchangeToken(@Body() body: TokenExchangeDto) {
    const tokens = await this.authService.exchangeCodeForTokens(body.code);
    return tokens;
}
```

```typescript
// backend/application/services/auth.service.ts
async exchangeCodeForTokens(code: string): Promise<{ accessToken: string; refreshToken: string }> {
    const stored = this.authCodes.get(code);
    
    // Validate code exists
    if (!stored) {
        throw new UnauthorizedException("Invalid authorization code");
    }
    
    // Check expiration
    if (Date.now() > stored.expiresAt) {
        this.authCodes.delete(code);
        throw new UnauthorizedException("Authorization code expired");
    }
    
    // Delete code (one-time use)
    this.authCodes.delete(code);
    
    return stored.tokens;
}
```

## Security Benefits

### 1. **Tokens Never Exposed in URLs**
- Authorization code is short-lived (30 seconds) and one-time use
- Actual tokens are exchanged server-to-server
- Tokens stored in HTTP-only cookies, inaccessible to JavaScript

### 2. **Protection Against Multiple Attack Vectors**

| Attack Vector | Protection Mechanism |
|--------------|---------------------|
| XSS (Cross-Site Scripting) | HTTP-only cookies prevent JavaScript access |
| CSRF (Cross-Site Request Forgery) | `sameSite: "lax"` cookie attribute provides CSRF protection while allowing normal navigation |
| Token Interception | Tokens never transmitted via URL or client-side |
| Replay Attacks | One-time use codes with 30-second expiration |
| Browser History Leakage | Only temporary codes appear in history |
| Referrer Leakage | Tokens not in URL, can't leak via referrer headers |

### 3. **Role-Based Token Expiration**

```typescript
// Owner users get longer-lived tokens
const signOptions = user.role === "owner"
    ? { expiresIn: "30d" }  // 30 days access
    : { expiresIn: "3d" };   // 3 days access

const refreshSignOptions = user.role === "owner"
    ? { expiresIn: "7d" }   // 7 days refresh
    : { expiresIn: "1d" };   // 1 day refresh
```

### 4. **Automatic Cleanup**
- Expired authorization codes are automatically removed
- Prevents memory leaks and reduces attack surface

## Environment Configuration

### Backend (.env)
```bash
# Kakao OAuth
KAKAO_CLIENT_ID=your_kakao_client_id
KAKAO_CALLBACK_URL=http://localhost:3001/auth/kakao/callback

# JWT
JWT_SECRET=your_jwt_secret

# Frontend URLs
DEVELOPMENT_FRONTEND_URL=http://localhost:3000
PRODUCTION_FRONTEND_URL=https://your-production-frontend.com
```

### Frontend (.env.local)
```bash
# Backend API URLs
NEXT_PUBLIC_API_URL=https://api.production.com
DEVELOPMENT_API_URL=http://localhost:3001

# Environment
NODE_ENV=development # or production
```

## Data Flow Summary

1. **User → Kakao:** User initiates login
2. **Kakao → Backend:** OAuth callback with user data
3. **Backend → Backend:** Validate user, generate JWT tokens
4. **Backend → Backend:** Create 30-second authorization code
5. **Backend → Frontend:** Redirect with authorization code
6. **Frontend → Frontend (Server):** Client page calls server API route
7. **Frontend (Server) → Backend:** Exchange code for tokens
8. **Backend → Frontend (Server):** Return actual tokens
9. **Frontend (Server) → Frontend:** Set HTTP-only cookies
10. **Frontend → User:** Redirect to dashboard, authenticated

## Key Files

### Backend
- **Controller:** `backend/interface/controllers/auth.controller.ts`
- **Service:** `backend/application/services/auth.service.ts`
- **DTO:** `backend/interface/dto/token-exchange.dto.ts`

### Frontend
- **Callback Page:** `frontend/app/auth/callback/page.tsx`
- **Token Exchange API:** `frontend/app/api/auth/token/route.ts`
- **Axios Client:** `frontend/app/lib/axios/client.ts`
- **Axios Server:** `frontend/app/lib/axios/server.ts`

## Testing the Flow

### Development Testing

1. Start backend server:
```bash
cd backend
npm run start:dev
```

2. Start frontend server:
```bash
cd frontend
npm run dev
```

3. Navigate to login page:
```
http://localhost:3000/login
```

4. Click "Login with Kakao"

5. Monitor network requests:
   - Initial redirect: `GET /auth/kakao`
   - Kakao callback: `GET /auth/kakao/callback`
   - Frontend redirect: `GET /auth/callback?code=...`
   - Token exchange: `POST /api/auth/token`
   - Final redirect: `GET /dashboard`

6. Verify cookies are set:
   - Open browser DevTools → Application → Cookies
   - Check for `access-token` and `refresh-token`
   - Verify `HttpOnly` flag is set

### Security Verification

1. **Code Expiration Test:**
   - Capture an authorization code from the URL
   - Wait 31+ seconds
   - Try to exchange it → Should fail with "Authorization code expired"

2. **Code Reuse Test:**
   - Exchange a code successfully
   - Try to use the same code again → Should fail with "Invalid authorization code"

3. **Cookie Security Test:**
   - Try to access cookies via `document.cookie` in browser console
   - Should not see `access-token` or `refresh-token` (HTTP-only)

4. **XSS Protection Test:**
   - Verify tokens are never accessible via JavaScript
   - All token operations happen server-side

## Troubleshooting

> **📝 Note:** For detailed information about bugs that were found and fixed during implementation, see [BUGFIX.md](./BUGFIX.md).

### Common Issues

**Issue: "Authorization Code Required"**
- Check that Kakao redirect includes the code parameter
- Verify backend is generating the code correctly

**Issue: "Authorization code expired"**
- Frontend took longer than 30 seconds to exchange code
- Check network latency
- Consider increasing expiration if needed (not recommended for security)

**Issue: "Invalid authorization code"**
- Code was already used (one-time use)
- Code was never generated
- Check backend `authCodes` Map

**Issue: Cookies not being set**
- Verify `sameSite` and `secure` settings match environment
- In development, `secure` should be `false`
- Check CORS configuration

**Issue: Infinite redirect loop**
- Check that `/auth/callback` is not protected by auth middleware
- Verify cookie path is set to `/`
- Ensure cookies are being read correctly by middleware

## Future Improvements

1. **Persistent Storage:** Move authorization codes from in-memory Map to Redis for distributed systems
2. **Rate Limiting:** Add rate limiting to token exchange endpoint
3. **Audit Logging:** Log all authentication attempts and token exchanges
4. **Token Refresh:** Implement automatic token refresh using refresh tokens
5. **Session Management:** Add ability to revoke sessions/tokens
6. **Multi-factor Authentication:** Add optional 2FA layer

## References

- [BUGFIX.md](./BUGFIX.md) - Documented bugs found and fixed during implementation
- [OAuth 2.0 Authorization Code Flow](https://oauth.net/2/grant-types/authorization-code/)
- [Kakao Login API Documentation](https://developers.kakao.com/docs/latest/en/kakaologin/rest-api)
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)

---

**Last Updated:** 2025-11-29  
**Author:** Development Team  
**Version:** 1.0.0
