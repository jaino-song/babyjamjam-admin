# Security & Authentication Guide

> **역할**: 인증/인가 시스템 구현 전문가
> **담당**: JWT, OAuth, RBAC, 보안 설정

---

## 🎯 사용 시점 (Trigger)

이 문서를 참조하는 경우:
- "로그인 기능 구현해줘"
- "OAuth 연동해줘"
- "권한 관리 추가해줘"
- implementation-plan.md에 Auth 포함 시

---

## 📥 Input (필수 정보)

```
□ implementation-plan.md의 Auth 섹션
  └─ 인증 방식 (이메일/비밀번호, OAuth)
  └─ OAuth Providers (카카오, 네이버, 구글)
  └─ Role 정의 (USER, ADMIN, etc.)

□ 플랫폼 정보
  └─ Web만? Mobile만? 둘 다?
```

---

## 📤 Output (생성해야 할 파일)

```
src/
├── modules/auth/
│   ├── domain/
│   │   ├── entities/
│   │   │   ├── user.entity.ts
│   │   │   └── refresh-token.entity.ts
│   │   ├── value-objects/
│   │   │   ├── email.vo.ts
│   │   │   └── password.vo.ts
│   │   └── repositories/
│   │       ├── user.repository.interface.ts
│   │       └── refresh-token.repository.interface.ts
│   ├── application/
│   │   ├── commands/
│   │   │   ├── register.command.ts
│   │   │   ├── login.command.ts
│   │   │   ├── logout.command.ts
│   │   │   └── refresh-token.command.ts
│   │   ├── handlers/
│   │   └── dtos/
│   ├── infrastructure/
│   │   ├── persistence/
│   │   ├── services/
│   │   │   ├── bcrypt-password-hasher.ts
│   │   │   └── jwt-token.service.ts
│   │   └── oauth/
│   │       ├── kakao.strategy.ts
│   │       ├── naver.strategy.ts
│   │       └── google.strategy.ts
│   └── presentation/
│       ├── controllers/
│       │   └── auth.controller.ts
│       └── guards/
│           ├── jwt-auth.guard.ts
│           └── roles.guard.ts
├── core/
│   ├── decorators/
│   │   ├── current-user.decorator.ts
│   │   └── roles.decorator.ts
│   └── guards/
└── shared/
    └── types/
        └── auth.types.ts
```

---

## 🔑 토큰 전략

### Access Token vs Refresh Token

| 항목 | Access Token | Refresh Token |
|------|--------------|---------------|
| **만료** | 15분 | 7일 |
| **저장 (Web)** | HttpOnly Cookie | HttpOnly Cookie (path 제한) |
| **저장 (Mobile)** | SecureStore | SecureStore |
| **갱신** | Refresh Token으로 | 재로그인 |
| **용도** | API 인증 | Access Token 갱신 |

### JWT Payload

```typescript
// ✅ GOOD - 최소 정보만
interface JwtPayload {
  sub: string;      // user id
  roles: string[];  // ["USER"] or ["ADMIN"]
  iat: number;
  exp: number;
}

// ❌ BAD - 민감 정보 포함
interface JwtPayload {
  sub: string;
  email: string;     // ❌ 불필요
  name: string;      // ❌ 불필요
  password: string;  // ❌ 절대 금지!
}
```

---

## 🔢 구현 순서

### Step 1: 토큰 서비스

```typescript
// infrastructure/services/jwt-token.service.ts
@Injectable()
export class JwtTokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  generateAccessToken(userId: string, roles: string[]): string {
    return this.jwtService.sign(
      { sub: userId, roles },
      {
        secret: this.configService.get('JWT_SECRET'),
        expiresIn: '15m',
      },
    );
  }

  generateRefreshToken(userId: string): string {
    return this.jwtService.sign(
      { sub: userId, type: 'refresh' },
      {
        secret: this.configService.get('JWT_REFRESH_SECRET'),
        expiresIn: '7d',
      },
    );
  }

  verifyAccessToken(token: string): JwtPayload {
    return this.jwtService.verify(token, {
      secret: this.configService.get('JWT_SECRET'),
    });
  }
}
```

### Step 2: JWT Strategy (하이브리드)

```typescript
// infrastructure/strategies/jwt.strategy.ts
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private configService: ConfigService) {
    super({
      // ✅ Cookie와 Bearer 둘 다 지원
      jwtFromRequest: ExtractJwt.fromExtractors([
        // 1순위: Authorization Header (Mobile & API)
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        // 2순위: Cookie (Web Browser)
        (request: Request) => request?.cookies?.access_token,
      ]),
      secretOrKey: configService.get('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<UserPayload> {
    return {
      id: payload.sub,
      roles: payload.roles,
    };
  }
}
```

### Step 3: 플랫폼별 토큰 응답

```typescript
// application/handlers/login.handler.ts
@CommandHandler(LoginCommand)
export class LoginHandler implements ICommandHandler<LoginCommand> {
  async execute(command: LoginCommand): Promise<LoginResult> {
    // 1. 사용자 검증
    const user = await this.userRepository.findByEmail(command.email);
    if (!user) {
      throw new InvalidCredentialsException();
    }

    // 2. 비밀번호 검증
    const isValid = await this.passwordHasher.compare(
      command.password,
      user.password,
    );
    if (!isValid) {
      throw new InvalidCredentialsException();
    }

    // 3. 토큰 생성
    const accessToken = this.tokenService.generateAccessToken(user.id, user.roles);
    const refreshToken = this.tokenService.generateRefreshToken(user.id);

    // 4. Refresh Token 저장 (DB)
    await this.refreshTokenRepository.save(
      RefreshToken.create({
        userId: user.id,
        token: refreshToken,
        deviceId: command.deviceId,
        expiresAt: addDays(new Date(), 7),
      }),
    );

    return { user, accessToken, refreshToken };
  }
}
```

### Step 4: Controller - 플랫폼 분기

```typescript
// presentation/controllers/auth.controller.ts
@Controller('auth')
export class AuthController {
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
    @Headers('x-platform') platform?: string,
  ) {
    const result = await this.commandBus.execute(
      new LoginCommand(dto.email, dto.password, dto.deviceId),
    );

    // ✅ 플랫폼별 분기
    if (platform === 'mobile') {
      // Mobile: JSON 응답
      return {
        user: UserResponseDto.from(result.user),
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      };
    }

    // Web: Cookie 설정
    this.setAuthCookies(res, result);
    return { user: UserResponseDto.from(result.user) };
  }

  private setAuthCookies(res: Response, result: LoginResult) {
    res.cookie('access_token', result.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 15 * 60 * 1000, // 15분
    });

    res.cookie('refresh_token', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/auth/refresh', // 이 경로에서만 전송
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7일
    });
  }
}
```

---

## 🛡️ Refresh Token Rotation

보안 강화: 사용할 때마다 새 토큰 발급

```typescript
@Post('refresh')
async refresh(
  @Body() dto: RefreshTokenDto,
  @Req() req: Request,
  @Res({ passthrough: true }) res: Response,
) {
  // Cookie 또는 Body에서 refresh token 추출
  const refreshToken = dto.refreshToken || req.cookies.refresh_token;

  const result = await this.commandBus.execute(
    new RefreshTokenCommand(refreshToken),
  );

  // 플랫폼별 응답 (login과 동일)
  if (dto.refreshToken) {
    return result;
  }
  this.setAuthCookies(res, result);
  return { success: true };
}
```

```typescript
// RefreshTokenHandler
async execute(command: RefreshTokenCommand): Promise<TokenPair> {
  // 1. 토큰 검증
  const stored = await this.refreshTokenRepository.findByToken(command.token);
  if (!stored || stored.isRevoked || stored.isExpired) {
    throw new InvalidRefreshTokenException();
  }

  // 2. 기존 토큰 무효화 (1회용)
  await this.refreshTokenRepository.revoke(stored.id);

  // 3. 새 토큰 쌍 발급
  const user = await this.userRepository.findById(stored.userId);
  const accessToken = this.tokenService.generateAccessToken(user.id, user.roles);
  const newRefreshToken = this.tokenService.generateRefreshToken(user.id);

  // 4. 새 Refresh Token 저장
  await this.refreshTokenRepository.save(
    RefreshToken.create({
      userId: user.id,
      token: newRefreshToken,
      familyId: stored.familyId, // 토큰 체인 추적
      expiresAt: addDays(new Date(), 7),
    }),
  );

  return { accessToken, refreshToken: newRefreshToken };
}
```

---

## 👤 RBAC (Role-Based Access Control)

### Roles Decorator

```typescript
// core/decorators/roles.decorator.ts
export const ROLES_KEY = 'roles';
export const Roles = (...roles: RoleType[]) => SetMetadata(ROLES_KEY, roles);

// 사용
@Roles(RoleType.ADMIN)
@Get('admin/users')
async getAllUsers() { ... }
```

### Roles Guard

```typescript
// core/guards/roles.guard.ts
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<RoleType[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles) {
      return true; // @Roles 없으면 통과
    }

    const { user } = context.switchToHttp().getRequest();
    return requiredRoles.some((role) => user.roles?.includes(role));
  }
}
```

### Controller 적용

```typescript
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard) // 순서 중요!
@Roles(RoleType.ADMIN)
export class AdminController {
  @Get('users')
  async getAllUsers() { ... }
}
```

---

## 🔐 OAuth 구현

### Kakao Strategy

```typescript
// infrastructure/oauth/kakao.strategy.ts
@Injectable()
export class KakaoStrategy extends PassportStrategy(Strategy, 'kakao') {
  constructor(private configService: ConfigService) {
    super({
      clientID: configService.get('KAKAO_CLIENT_ID'),
      clientSecret: configService.get('KAKAO_CLIENT_SECRET'),
      callbackURL: configService.get('KAKAO_CALLBACK_URL'),
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: KakaoProfile,
  ): Promise<OAuthUser> {
    const { id, kakao_account } = profile._json;
    
    return {
      provider: 'kakao',
      providerId: String(id),
      email: kakao_account?.email,
      name: kakao_account?.profile?.nickname,
      profileImage: kakao_account?.profile?.profile_image_url,
    };
  }
}
```

### OAuth Controller

```typescript
@Controller('auth')
export class OAuthController {
  @Get('kakao')
  @UseGuards(AuthGuard('kakao'))
  async kakaoLogin() {
    // Passport가 리다이렉트 처리
  }

  @Get('kakao/callback')
  @UseGuards(AuthGuard('kakao'))
  async kakaoCallback(
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const oauthUser = req.user as OAuthUser;
    
    const result = await this.commandBus.execute(
      new OAuthLoginCommand(oauthUser),
    );

    // Web: Cookie 설정 후 리다이렉트
    this.setAuthCookies(res, result);
    res.redirect(this.configService.get('FRONTEND_URL'));
  }
}
```

---

## ❌ Anti-Patterns (절대 금지!)

### 1. JWT에 민감 정보 포함

```typescript
// ❌ BAD
const token = jwt.sign({
  sub: user.id,
  email: user.email,      // ❌ 불필요
  password: user.password, // ❌ 절대 금지!
  creditCard: '1234...',  // ❌ 절대 금지!
}, secret);
```

**왜 안 되는가:**
- JWT는 암호화가 아닌 서명만 함
- Base64 디코딩으로 내용 노출
- 토큰 탈취 시 민감 정보 유출

---

### 2. Access Token을 localStorage에 저장 (Web)

```typescript
// ❌ BAD - XSS 취약
localStorage.setItem('accessToken', token);

// API 호출
fetch('/api', {
  headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` }
});
```

**왜 안 되는가:**
- XSS 공격으로 JavaScript에서 접근 가능
- 악성 스크립트가 토큰 탈취 가능

```typescript
// ✅ GOOD - HttpOnly Cookie
// 서버에서 설정
res.cookie('access_token', token, { httpOnly: true, secure: true });

// API 호출 - 자동 전송
fetch('/api', { credentials: 'include' });
```

---

### 3. Refresh Token 재사용 허용

```typescript
// ❌ BAD - 토큰 재사용 가능
async refresh(token: string) {
  const payload = this.jwtService.verify(token);
  return this.generateNewTokens(payload.sub);
  // 기존 토큰 무효화 안 함!
}
```

**왜 안 되는가:**
- 탈취된 토큰으로 무한 갱신 가능
- 세션 하이재킹 위험

---

### 4. 비밀번호 평문 저장

```typescript
// ❌ BAD
await this.prisma.user.create({
  data: {
    email: dto.email,
    password: dto.password, // ❌ 평문 저장!
  },
});
```

**왜 안 되는가:**
- DB 유출 시 모든 비밀번호 노출
- 규정 위반 (PIPA, GDPR 등)

```typescript
// ✅ GOOD - bcrypt 해싱
const hashedPassword = await bcrypt.hash(dto.password, 12);
await this.prisma.user.create({
  data: {
    email: dto.email,
    password: hashedPassword,
  },
});
```

---

### 5. 하드코딩된 시크릿

```typescript
// ❌ BAD
const token = jwt.sign(payload, 'my-super-secret-key');
```

**왜 안 되는가:**
- 코드에 시크릿 노출
- Git 히스토리에 영구 기록
- 환경별 시크릿 분리 불가

```typescript
// ✅ GOOD - 환경 변수
const token = jwt.sign(payload, process.env.JWT_SECRET);
```

---

## ✅ 보안 체크리스트

### 인증 구현

- [ ] Access Token 만료 시간 15분 이하
- [ ] Refresh Token DB 저장 (Revocation 가능)
- [ ] Refresh Token Rotation 적용
- [ ] Web: HttpOnly Cookie 사용
- [ ] Mobile: SecureStore 사용
- [ ] 비밀번호 bcrypt 해싱 (rounds: 12)

### API 보안

- [ ] Rate Limiting 적용 (IP + User)
- [ ] CORS 허용 도메인 명시
- [ ] Helmet.js 적용
- [ ] 입력 값 검증 (class-validator)
- [ ] SQL Injection 방어 (ORM 사용)

### 시크릿 관리

- [ ] 환경 변수로 시크릿 관리
- [ ] .env 파일 .gitignore에 추가
- [ ] Production: AWS Secrets Manager 또는 Vault

### OAuth

- [ ] Redirect URI 화이트리스트
- [ ] State 파라미터로 CSRF 방어
- [ ] 토큰 교환 서버 사이드에서만

---

## 📝 환경 변수 예시

```bash
# .env.example

# JWT
JWT_SECRET=your-access-token-secret-min-32-chars
JWT_REFRESH_SECRET=your-refresh-token-secret-min-32-chars
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

# OAuth - Kakao
KAKAO_CLIENT_ID=your-kakao-client-id
KAKAO_CLIENT_SECRET=your-kakao-client-secret
KAKAO_CALLBACK_URL=http://localhost:3000/auth/kakao/callback

# OAuth - Naver
NAVER_CLIENT_ID=your-naver-client-id
NAVER_CLIENT_SECRET=your-naver-client-secret
NAVER_CALLBACK_URL=http://localhost:3000/auth/naver/callback

# OAuth - Google
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback

# Frontend URL (for OAuth redirect)
FRONTEND_URL=http://localhost:3000
```

---

## 🔗 다른 문서와의 관계

### 이전 단계에서 받는 것
- **SKILL.md (Product Manager)** → 인증 방식, OAuth Providers, Role 정의

### 함께 사용하는 것
- **nestjs-guide.md** → 모듈 구조, Repository 패턴

### 다음 단계에 전달하는 것
- **frontend/nextjs-guide.md** → 인증 API contract, 토큰 처리 방식
- **mobile/expo-guide.md** → SecureStore 저장 방식
