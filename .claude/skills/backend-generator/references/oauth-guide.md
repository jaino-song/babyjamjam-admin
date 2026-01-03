# OAuth Implementation Guide

> **역할**: OAuth 소셜 로그인 구현 전문가
> **담당**: Kakao, Google, Naver OAuth 연동

---

## 🎯 사용 시점 (Trigger)

이 문서를 참조하는 경우:
- "카카오 로그인 추가해줘"
- "소셜 로그인 구현해줘"
- "OAuth 연동해줘"
- implementation-plan.md에 OAuth Providers 포함 시

---

## 📊 OAuth 플로우

### Web (Authorization Code Flow)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Web OAuth Flow                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  User          Frontend         Backend           OAuth Provider         │
│   │               │                │                    │                │
│   │──[1] 로그인 버튼 클릭──▶│                    │                │
│   │               │                │                    │                │
│   │               │──[2] /auth/kakao 요청──▶│                    │
│   │               │                │                    │                │
│   │               │                │──[3] 302 Redirect──▶│                │
│   │               │                │    (with client_id)│                │
│   │               │                │                    │                │
│   │◀──────────[4] OAuth 로그인 페이지 표시──────────────│                │
│   │                                                      │                │
│   │──[5] 로그인 & 동의──────────────────────────────────▶│                │
│   │                                                      │                │
│   │               │                │◀──[6] Callback──────│                │
│   │               │                │    (with code)      │                │
│   │               │                │                    │                │
│   │               │                │──[7] Token 요청────▶│                │
│   │               │                │    (code + secret)  │                │
│   │               │                │                    │                │
│   │               │                │◀──[8] Access Token──│                │
│   │               │                │    + User Info      │                │
│   │               │                │                    │                │
│   │               │                │──[9] User 생성/조회  │                │
│   │               │                │──[10] JWT 발급      │                │
│   │               │                │                    │                │
│   │               │◀──[11] 302 Redirect + Cookie────────│                │
│   │               │    (Frontend URL)                   │                │
│   │               │                │                    │                │
│   │◀──[12] Dashboard 표시──│                    │                │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Mobile (Authorization Code + Deep Link)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       Mobile OAuth Flow                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  User          App              Backend           OAuth Provider         │
│   │             │                  │                    │                │
│   │──[1] 로그인 버튼 탭──▶│                    │                │
│   │             │                  │                    │                │
│   │             │──[2] WebBrowser.openAuthSession──────▶│                │
│   │             │    (OAuth URL + redirect_uri)         │                │
│   │             │                  │                    │                │
│   │◀──────[3] OAuth 로그인 페이지 (In-App Browser)──────│                │
│   │                                                      │                │
│   │──[4] 로그인 & 동의──────────────────────────────────▶│                │
│   │                                                      │                │
│   │◀──────────[5] Redirect to myapp://auth/callback──────│                │
│   │             │    (with code)                         │                │
│   │             │                  │                    │                │
│   │             │──[6] /auth/token/mobile 요청──▶│                │
│   │             │    (code)                              │                │
│   │             │                  │──[7] Token 교환────▶│                │
│   │             │                  │◀──[8] Access Token──│                │
│   │             │                  │                    │                │
│   │             │                  │──[9] JWT 발급       │                │
│   │             │                  │                    │                │
│   │             │◀──[10] JSON Response─────────│                │
│   │             │    { accessToken, refreshToken }       │                │
│   │             │                  │                    │                │
│   │             │──[11] SecureStore 저장                 │                │
│   │             │                  │                    │                │
│   │◀──[12] Home 화면 표시──│                    │                │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 📦 필수 패키지

```bash
# Backend - Web OAuth (Passport)
pnpm add passport passport-kakao passport-google-oauth20 passport-naver-v2
pnpm add @nestjs/passport

# Backend - Mobile OAuth (직접 API 호출)
pnpm add @nestjs/axios axios

# Frontend (Web) - 불필요 (백엔드에서 처리)

# Mobile
npx expo install expo-web-browser expo-linking expo-crypto
```

---

## 📁 파일 구조

```
src/modules/auth/
├── infrastructure/
│   └── oauth/
│       ├── strategies/                    # Web OAuth (Passport)
│       │   ├── kakao.strategy.ts
│       │   ├── google.strategy.ts
│       │   └── naver.strategy.ts
│       ├── oauth.controller.ts            # Web + Mobile 엔드포인트
│       ├── oauth.service.ts               # 공통 로직 (User 생성/조회, JWT 발급)
│       ├── oauth-token-exchange.service.ts  # ✅ Mobile 전용 (code → token 교환)
│       └── oauth.types.ts
├── application/
│   └── commands/
│       └── oauth-login.command.ts
└── auth.module.ts
```

---

## 🔢 구현 순서

### Step 1: OAuth Types

```typescript
// infrastructure/oauth/oauth.types.ts
export interface OAuthUser {
  provider: 'kakao' | 'google' | 'naver';
  providerId: string;
  email: string | null;
  name: string | null;
  profileImage: string | null;
}

export interface OAuthProfile {
  provider: string;
  id: string;
  email?: string;
  displayName?: string;
  photos?: Array<{ value: string }>;
}

// Kakao 전용
export interface KakaoProfile {
  id: number;
  kakao_account?: {
    email?: string;
    profile?: {
      nickname?: string;
      profile_image_url?: string;
    };
  };
}

// Naver 전용
export interface NaverProfile {
  id: string;
  email?: string;
  nickname?: string;
  profile_image?: string;
  name?: string;
}
```

---

### Step 2: Kakao Strategy

```typescript
// infrastructure/oauth/strategies/kakao.strategy.ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-kakao';
import { ConfigService } from '@nestjs/config';
import { OAuthUser, KakaoProfile } from '../oauth.types';

@Injectable()
export class KakaoStrategy extends PassportStrategy(Strategy, 'kakao') {
  constructor(private readonly configService: ConfigService) {
    super({
      clientID: configService.getOrThrow('KAKAO_CLIENT_ID'),
      clientSecret: configService.get('KAKAO_CLIENT_SECRET'), // 선택
      callbackURL: configService.getOrThrow('KAKAO_CALLBACK_URL'),
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: Profile,
    done: (error: any, user?: OAuthUser) => void,
  ): Promise<void> {
    try {
      const kakaoAccount = (profile._json as KakaoProfile).kakao_account;
      
      const user: OAuthUser = {
        provider: 'kakao',
        providerId: String(profile.id),
        email: kakaoAccount?.email || null,
        name: kakaoAccount?.profile?.nickname || profile.displayName || null,
        profileImage: kakaoAccount?.profile?.profile_image_url || null,
      };

      done(null, user);
    } catch (error) {
      done(error);
    }
  }
}
```

---

### Step 3: Google Strategy

```typescript
// infrastructure/oauth/strategies/google.strategy.ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback, Profile } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import { OAuthUser } from '../oauth.types';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(private readonly configService: ConfigService) {
    super({
      clientID: configService.getOrThrow('GOOGLE_CLIENT_ID'),
      clientSecret: configService.getOrThrow('GOOGLE_CLIENT_SECRET'),
      callbackURL: configService.getOrThrow('GOOGLE_CALLBACK_URL'),
      scope: ['email', 'profile'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): Promise<void> {
    try {
      const { id, name, emails, photos } = profile;

      const user: OAuthUser = {
        provider: 'google',
        providerId: id,
        email: emails?.[0]?.value || null,
        name: name ? `${name.givenName} ${name.familyName}`.trim() : null,
        profileImage: photos?.[0]?.value || null,
      };

      done(null, user);
    } catch (error) {
      done(error as Error);
    }
  }
}
```

---

### Step 4: Naver Strategy

```typescript
// infrastructure/oauth/strategies/naver.strategy.ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-naver-v2';
import { ConfigService } from '@nestjs/config';
import { OAuthUser, NaverProfile } from '../oauth.types';

@Injectable()
export class NaverStrategy extends PassportStrategy(Strategy, 'naver') {
  constructor(private readonly configService: ConfigService) {
    super({
      clientID: configService.getOrThrow('NAVER_CLIENT_ID'),
      clientSecret: configService.getOrThrow('NAVER_CLIENT_SECRET'),
      callbackURL: configService.getOrThrow('NAVER_CALLBACK_URL'),
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: Profile,
    done: (error: any, user?: OAuthUser) => void,
  ): Promise<void> {
    try {
      const naverProfile = profile._json as NaverProfile;

      const user: OAuthUser = {
        provider: 'naver',
        providerId: naverProfile.id,
        email: naverProfile.email || null,
        name: naverProfile.name || naverProfile.nickname || null,
        profileImage: naverProfile.profile_image || null,
      };

      done(null, user);
    } catch (error) {
      done(error);
    }
  }
}
```

---

### Step 5: OAuth Service

```typescript
// infrastructure/oauth/oauth.service.ts
import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { ConfigService } from '@nestjs/config';
import { OAuthUser } from './oauth.types';
import { OAuthLoginCommand } from '../../application/commands/oauth-login.command';

@Injectable()
export class OAuthService {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly configService: ConfigService,
  ) {}

  async processOAuthLogin(oauthUser: OAuthUser): Promise<{
    user: any;
    accessToken: string;
    refreshToken: string;
  }> {
    return this.commandBus.execute(new OAuthLoginCommand(oauthUser));
  }

  getFrontendUrl(): string {
    return this.configService.getOrThrow('FRONTEND_URL');
  }

  getMobileScheme(): string {
    return this.configService.getOrThrow('MOBILE_SCHEME');
  }
}
```

---

### Step 6: OAuth Login Command

```typescript
// application/commands/oauth-login.command.ts
import { OAuthUser } from '../../infrastructure/oauth/oauth.types';

export class OAuthLoginCommand {
  constructor(public readonly oauthUser: OAuthUser) {}
}
```

```typescript
// application/handlers/oauth-login.handler.ts
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { Inject } from '@nestjs/common';
import { OAuthLoginCommand } from '../commands/oauth-login.command';
import { UserRepository } from '../../domain/repositories/user.repository.interface';
import { JwtTokenService } from '../../infrastructure/services/jwt-token.service';
import { User } from '../../domain/entities/user.entity';

@CommandHandler(OAuthLoginCommand)
export class OAuthLoginHandler implements ICommandHandler<OAuthLoginCommand> {
  constructor(
    @Inject('UserRepository')
    private readonly userRepository: UserRepository,
    private readonly tokenService: JwtTokenService,
    @Inject('RefreshTokenRepository')
    private readonly refreshTokenRepository: any,
  ) {}

  async execute(command: OAuthLoginCommand) {
    const { oauthUser } = command;

    // 1. 기존 사용자 조회 (provider + providerId)
    let user = await this.userRepository.findByProvider(
      oauthUser.provider,
      oauthUser.providerId,
    );

    // 2. 없으면 새로 생성
    if (!user) {
      // 이메일로 기존 계정 확인 (계정 연결)
      if (oauthUser.email) {
        const existingUser = await this.userRepository.findByEmail(oauthUser.email);
        if (existingUser) {
          // 기존 계정에 OAuth provider 연결
          existingUser.linkOAuthProvider(oauthUser.provider, oauthUser.providerId);
          await this.userRepository.save(existingUser);
          user = existingUser;
        }
      }

      // 그래도 없으면 새 계정 생성
      if (!user) {
        user = User.createFromOAuth({
          email: oauthUser.email,
          name: oauthUser.name || `User_${oauthUser.providerId.slice(-6)}`,
          profileImage: oauthUser.profileImage,
          provider: oauthUser.provider,
          providerId: oauthUser.providerId,
        });
        await this.userRepository.save(user);
      }
    } else {
      // 기존 사용자: 프로필 정보 업데이트
      user.updateFromOAuth({
        name: oauthUser.name,
        profileImage: oauthUser.profileImage,
      });
      await this.userRepository.save(user);
    }

    // 3. JWT 토큰 발급
    const accessToken = this.tokenService.generateAccessToken(user.id, user.roles);
    const refreshToken = this.tokenService.generateRefreshToken(user.id);

    // 4. Refresh Token 저장
    await this.refreshTokenRepository.save({
      userId: user.id,
      token: refreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    return { user, accessToken, refreshToken };
  }
}
```

---

### Step 7: Mobile OAuth Token Exchange Service

> **Mobile 전용**: Passport는 Web Redirect 기반이라 Mobile Deep Link와 호환 안 됨.
> Mobile에서는 직접 각 Provider API를 호출해서 code → token 교환해야 함.

```typescript
// infrastructure/oauth/oauth-token-exchange.service.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { OAuthUser } from './oauth.types';

type OAuthProvider = 'kakao' | 'google' | 'naver';

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
}

@Injectable()
export class OAuthTokenExchangeService {
  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {}

  /**
   * Mobile에서 받은 authorization code를 처리
   * 1. code → OAuth Provider access_token 교환
   * 2. access_token으로 사용자 정보 조회
   */
  async exchangeCodeForUser(
    code: string,
    provider: OAuthProvider,
    redirectUri: string,
  ): Promise<OAuthUser> {
    // 1. Code → Access Token 교환
    const tokenResponse = await this.exchangeCodeForToken(code, provider, redirectUri);

    // 2. Access Token으로 사용자 정보 조회
    const userInfo = await this.getUserInfo(tokenResponse.access_token, provider);

    return userInfo;
  }

  // ==================== CODE → TOKEN 교환 ====================

  private async exchangeCodeForToken(
    code: string,
    provider: OAuthProvider,
    redirectUri: string,
  ): Promise<TokenResponse> {
    switch (provider) {
      case 'kakao':
        return this.exchangeKakaoCode(code, redirectUri);
      case 'google':
        return this.exchangeGoogleCode(code, redirectUri);
      case 'naver':
        return this.exchangeNaverCode(code, redirectUri);
      default:
        throw new BadRequestException(`Unsupported provider: ${provider}`);
    }
  }

  private async exchangeKakaoCode(code: string, redirectUri: string): Promise<TokenResponse> {
    const tokenUrl = 'https://kauth.kakao.com/oauth/token';
    
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.configService.getOrThrow('KAKAO_CLIENT_ID'),
      redirect_uri: redirectUri,
      code,
    });

    // Kakao는 client_secret이 선택사항
    const clientSecret = this.configService.get('KAKAO_CLIENT_SECRET');
    if (clientSecret) {
      params.append('client_secret', clientSecret);
    }

    const response = await firstValueFrom(
      this.httpService.post<TokenResponse>(tokenUrl, params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
    );

    return response.data;
  }

  private async exchangeGoogleCode(code: string, redirectUri: string): Promise<TokenResponse> {
    const tokenUrl = 'https://oauth2.googleapis.com/token';

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.configService.getOrThrow('GOOGLE_CLIENT_ID'),
      client_secret: this.configService.getOrThrow('GOOGLE_CLIENT_SECRET'),
      redirect_uri: redirectUri,
      code,
    });

    const response = await firstValueFrom(
      this.httpService.post<TokenResponse>(tokenUrl, params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
    );

    return response.data;
  }

  private async exchangeNaverCode(code: string, redirectUri: string): Promise<TokenResponse> {
    const tokenUrl = 'https://nid.naver.com/oauth2.0/token';

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: this.configService.getOrThrow('NAVER_CLIENT_ID'),
      client_secret: this.configService.getOrThrow('NAVER_CLIENT_SECRET'),
      redirect_uri: redirectUri,
      code,
    });

    const response = await firstValueFrom(
      this.httpService.post<TokenResponse>(tokenUrl, params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
    );

    return response.data;
  }

  // ==================== 사용자 정보 조회 ====================

  private async getUserInfo(accessToken: string, provider: OAuthProvider): Promise<OAuthUser> {
    switch (provider) {
      case 'kakao':
        return this.getKakaoUserInfo(accessToken);
      case 'google':
        return this.getGoogleUserInfo(accessToken);
      case 'naver':
        return this.getNaverUserInfo(accessToken);
      default:
        throw new BadRequestException(`Unsupported provider: ${provider}`);
    }
  }

  private async getKakaoUserInfo(accessToken: string): Promise<OAuthUser> {
    const userInfoUrl = 'https://kapi.kakao.com/v2/user/me';

    const response = await firstValueFrom(
      this.httpService.get(userInfoUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    );

    const { id, kakao_account } = response.data;

    return {
      provider: 'kakao',
      providerId: String(id),
      email: kakao_account?.email || null,
      name: kakao_account?.profile?.nickname || null,
      profileImage: kakao_account?.profile?.profile_image_url || null,
    };
  }

  private async getGoogleUserInfo(accessToken: string): Promise<OAuthUser> {
    const userInfoUrl = 'https://www.googleapis.com/oauth2/v2/userinfo';

    const response = await firstValueFrom(
      this.httpService.get(userInfoUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    );

    const { id, email, name, picture } = response.data;

    return {
      provider: 'google',
      providerId: id,
      email: email || null,
      name: name || null,
      profileImage: picture || null,
    };
  }

  private async getNaverUserInfo(accessToken: string): Promise<OAuthUser> {
    const userInfoUrl = 'https://openapi.naver.com/v1/nid/me';

    const response = await firstValueFrom(
      this.httpService.get(userInfoUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    );

    const { response: profile } = response.data;

    return {
      provider: 'naver',
      providerId: profile.id,
      email: profile.email || null,
      name: profile.name || profile.nickname || null,
      profileImage: profile.profile_image || null,
    };
  }
}
```

---

### Step 8: OAuth Controller

```typescript
// infrastructure/oauth/oauth.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Response, Request } from 'express';
import { ApiTags, ApiOperation, ApiBody } from '@nestjs/swagger';
import { OAuthService } from './oauth.service';
import { OAuthTokenExchangeService } from './oauth-token-exchange.service';
import { OAuthUser } from './oauth.types';

class MobileTokenExchangeDto {
  code: string;
  provider: 'kakao' | 'google' | 'naver';
  redirectUri: string; // Mobile에서 사용한 redirect_uri (Deep Link)
}

@ApiTags('OAuth')
@Controller('auth')
export class OAuthController {
  constructor(
    private readonly oauthService: OAuthService,
    private readonly tokenExchangeService: OAuthTokenExchangeService,
  ) {}

  // ==================== WEB: KAKAO ====================

  @Get('kakao')
  @UseGuards(AuthGuard('kakao'))
  @ApiOperation({ summary: '[Web] 카카오 로그인 시작' })
  async kakaoLogin() {
    // Passport가 카카오로 리다이렉트
  }

  @Get('kakao/callback')
  @UseGuards(AuthGuard('kakao'))
  @ApiOperation({ summary: '[Web] 카카오 로그인 콜백' })
  async kakaoCallback(@Req() req: Request, @Res() res: Response) {
    return this.handleWebOAuthCallback(req, res);
  }

  // ==================== WEB: GOOGLE ====================

  @Get('google')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: '[Web] 구글 로그인 시작' })
  async googleLogin() {
    // Passport가 구글로 리다이렉트
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: '[Web] 구글 로그인 콜백' })
  async googleCallback(@Req() req: Request, @Res() res: Response) {
    return this.handleWebOAuthCallback(req, res);
  }

  // ==================== WEB: NAVER ====================

  @Get('naver')
  @UseGuards(AuthGuard('naver'))
  @ApiOperation({ summary: '[Web] 네이버 로그인 시작' })
  async naverLogin() {
    // Passport가 네이버로 리다이렉트
  }

  @Get('naver/callback')
  @UseGuards(AuthGuard('naver'))
  @ApiOperation({ summary: '[Web] 네이버 로그인 콜백' })
  async naverCallback(@Req() req: Request, @Res() res: Response) {
    return this.handleWebOAuthCallback(req, res);
  }

  // ==================== MOBILE: TOKEN EXCHANGE ====================

  @Post('token/mobile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ 
    summary: '[Mobile] OAuth 토큰 교환',
    description: 'Mobile에서 받은 authorization code를 JWT 토큰으로 교환',
  })
  @ApiBody({ type: MobileTokenExchangeDto })
  async exchangeTokenForMobile(@Body() dto: MobileTokenExchangeDto) {
    // 1. Code → OAuth Provider Access Token → User Info
    const oauthUser = await this.tokenExchangeService.exchangeCodeForUser(
      dto.code,
      dto.provider,
      dto.redirectUri,
    );

    // 2. User 생성/조회 + JWT 발급
    const result = await this.oauthService.processOAuthLogin(oauthUser);

    // 3. JSON 응답 (Mobile은 Cookie 대신 JSON)
    return {
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        profileImage: result.user.profileImage,
      },
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    };
  }

  // ==================== WEB: COMMON ====================

  private async handleWebOAuthCallback(req: Request, res: Response) {
    const oauthUser = req.user as OAuthUser;

    try {
      const result = await this.oauthService.processOAuthLogin(oauthUser);

      // Cookie 설정 (Web)
      this.setAuthCookies(res, result.accessToken, result.refreshToken);

      // Frontend로 리다이렉트
      const frontendUrl = this.oauthService.getFrontendUrl();
      return res.redirect(`${frontendUrl}/auth/callback?success=true`);
    } catch (error) {
      const frontendUrl = this.oauthService.getFrontendUrl();
      return res.redirect(`${frontendUrl}/auth/callback?error=oauth_failed`);
    }
  }

  private setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
    const isProduction = process.env.NODE_ENV === 'production';

    res.cookie('access_token', accessToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 15 * 60 * 1000, // 15분
      path: '/',
    });

    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7일
      path: '/auth/refresh',
    });
  }
}
```

---

### Step 9: Module 등록

```typescript
// auth.module.ts
import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { HttpModule } from '@nestjs/axios';  // ✅ Mobile OAuth용
import { CqrsModule } from '@nestjs/cqrs';
import { ConfigModule, ConfigService } from '@nestjs/config';

// Strategies (Web OAuth용 - Passport)
import { JwtStrategy } from './infrastructure/strategies/jwt.strategy';
import { KakaoStrategy } from './infrastructure/oauth/strategies/kakao.strategy';
import { GoogleStrategy } from './infrastructure/oauth/strategies/google.strategy';
import { NaverStrategy } from './infrastructure/oauth/strategies/naver.strategy';

// Controllers
import { AuthController } from './presentation/controllers/auth.controller';
import { OAuthController } from './infrastructure/oauth/oauth.controller';

// Services
import { OAuthService } from './infrastructure/oauth/oauth.service';
import { OAuthTokenExchangeService } from './infrastructure/oauth/oauth-token-exchange.service'; // ✅ Mobile OAuth용
import { JwtTokenService } from './infrastructure/services/jwt-token.service';

// Handlers
import { OAuthLoginHandler } from './application/handlers/oauth-login.handler';

// Repositories
import { PrismaUserRepository } from './infrastructure/persistence/prisma-user.repository';
import { PrismaRefreshTokenRepository } from './infrastructure/persistence/prisma-refresh-token.repository';

const CommandHandlers = [OAuthLoginHandler];
const Strategies = [JwtStrategy, KakaoStrategy, GoogleStrategy, NaverStrategy];

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET'),
        signOptions: { expiresIn: '15m' },
      }),
      inject: [ConfigService],
    }),
    HttpModule.register({  // ✅ Mobile OAuth - Provider API 호출용
      timeout: 5000,
      maxRedirects: 5,
    }),
    CqrsModule,
  ],
  controllers: [AuthController, OAuthController],
  providers: [
    ...Strategies,
    ...CommandHandlers,
    OAuthService,
    OAuthTokenExchangeService,  // ✅ Mobile OAuth용
    JwtTokenService,
    {
      provide: 'UserRepository',
      useClass: PrismaUserRepository,
    },
    {
      provide: 'RefreshTokenRepository',
      useClass: PrismaRefreshTokenRepository,
    },
  ],
  exports: [JwtTokenService],
})
export class AuthModule {}
```

### 필수 패키지 추가

```bash
# @nestjs/axios 설치 (Mobile OAuth용)
pnpm add @nestjs/axios axios
```

---

## 📱 Mobile OAuth 구현 (Expo)

### Deep Link 설정

```json
// app.json
{
  "expo": {
    "scheme": "myapp",
    "ios": {
      "bundleIdentifier": "com.myapp.app"
    },
    "android": {
      "package": "com.myapp.app",
      "intentFilters": [
        {
          "action": "VIEW",
          "data": [{ "scheme": "myapp" }],
          "category": ["BROWSABLE", "DEFAULT"]
        }
      ]
    }
  }
}
```

### OAuth 서비스 (Mobile)

```typescript
// features/auth/services/oauth.mobile.ts
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { apiClient } from '@/core/api/axios';
import { tokenStorage } from '@/core/storage/secureStorage';

WebBrowser.maybeCompleteAuthSession();

const API_URL = process.env.EXPO_PUBLIC_API_URL;

type OAuthProvider = 'kakao' | 'google' | 'naver';

// Provider별 OAuth URL 설정
const OAUTH_CONFIG = {
  kakao: {
    authUrl: 'https://kauth.kakao.com/oauth/authorize',
    clientId: process.env.EXPO_PUBLIC_KAKAO_CLIENT_ID!,
  },
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    clientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID!,
    scope: 'email profile',
  },
  naver: {
    authUrl: 'https://nid.naver.com/oauth2.0/authorize',
    clientId: process.env.EXPO_PUBLIC_NAVER_CLIENT_ID!,
  },
};

export async function loginWithOAuth(provider: OAuthProvider): Promise<boolean> {
  try {
    // 1. Redirect URI 생성 (Deep Link)
    const redirectUri = Linking.createURL('auth/callback');

    // 2. OAuth Provider URL 생성 (Backend 거치지 않고 직접)
    const config = OAUTH_CONFIG[provider];
    const state = generateRandomState(); // CSRF 방지
    
    let authUrl: string;
    
    switch (provider) {
      case 'kakao':
        authUrl = `${config.authUrl}?client_id=${config.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${state}`;
        break;
      case 'google':
        authUrl = `${config.authUrl}?client_id=${config.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(config.scope!)}&state=${state}&access_type=offline`;
        break;
      case 'naver':
        authUrl = `${config.authUrl}?client_id=${config.clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=${state}`;
        break;
    }

    // 3. In-App Browser 열기
    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUri);

    if (result.type !== 'success') {
      console.log('OAuth cancelled or failed:', result.type);
      return false;
    }

    // 4. URL에서 code 추출
    const url = Linking.parse(result.url);
    const code = url.queryParams?.code as string;
    const error = url.queryParams?.error as string;
    const returnedState = url.queryParams?.state as string;

    if (error) {
      console.error('OAuth error:', error);
      return false;
    }

    if (!code) {
      console.error('No authorization code received');
      return false;
    }

    // State 검증 (CSRF 방지)
    if (returnedState !== state) {
      console.error('State mismatch - possible CSRF attack');
      return false;
    }

    // 5. Backend API로 code 전송 → JWT 토큰 받기
    const response = await apiClient.post<{
      user: { id: string; email: string; name: string; profileImage: string };
      accessToken: string;
      refreshToken: string;
    }>('/auth/token/mobile', {
      code,
      provider,
      redirectUri, // Backend에서 토큰 교환 시 필요
    });

    const { accessToken, refreshToken } = response.data;

    // 6. SecureStore에 저장
    await tokenStorage.setAccessToken(accessToken);
    await tokenStorage.setRefreshToken(refreshToken);

    return true;
  } catch (error) {
    console.error('OAuth login error:', error);
    return false;
  }
}

// CSRF 방지용 랜덤 state 생성
function generateRandomState(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// 각 Provider별 wrapper
export const loginWithKakao = () => loginWithOAuth('kakao');
export const loginWithGoogle = () => loginWithOAuth('google');
export const loginWithNaver = () => loginWithOAuth('naver');
```

### 환경 변수 (Mobile)

```bash
# .env (Expo)
EXPO_PUBLIC_API_URL=http://localhost:3000

# OAuth Client IDs (Public - Mobile용)
# ⚠️ Client Secret은 절대 Mobile에 포함하지 않음!
EXPO_PUBLIC_KAKAO_CLIENT_ID=your-kakao-rest-api-key
EXPO_PUBLIC_GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
EXPO_PUBLIC_NAVER_CLIENT_ID=your-naver-client-id
```

### OAuth 버튼 컴포넌트 (Mobile)

```typescript
// features/auth/components/OAuthButtons.tsx
import { View, TouchableOpacity, Text, Image, StyleSheet, ActivityIndicator } from 'react-native';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { loginWithKakao, loginWithGoogle, loginWithNaver } from '../services/oauth.mobile';

export function OAuthButtons() {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);

  const handleOAuthLogin = async (
    provider: 'kakao' | 'google' | 'naver',
    loginFn: () => Promise<boolean>,
  ) => {
    setLoading(provider);
    try {
      const success = await loginFn();
      if (success) {
        router.replace('/(tabs)/home');
      }
    } finally {
      setLoading(null);
    }
  };

  return (
    <View style={styles.container}>
      {/* Kakao */}
      <TouchableOpacity
        style={[styles.button, styles.kakaoButton]}
        onPress={() => handleOAuthLogin('kakao', loginWithKakao)}
        disabled={loading !== null}
      >
        {loading === 'kakao' ? (
          <ActivityIndicator color="#000" />
        ) : (
          <>
            <Image source={require('@/assets/icons/kakao.png')} style={styles.icon} />
            <Text style={styles.kakaoText}>카카오로 시작하기</Text>
          </>
        )}
      </TouchableOpacity>

      {/* Google */}
      <TouchableOpacity
        style={[styles.button, styles.googleButton]}
        onPress={() => handleOAuthLogin('google', loginWithGoogle)}
        disabled={loading !== null}
      >
        {loading === 'google' ? (
          <ActivityIndicator color="#000" />
        ) : (
          <>
            <Image source={require('@/assets/icons/google.png')} style={styles.icon} />
            <Text style={styles.googleText}>Google로 시작하기</Text>
          </>
        )}
      </TouchableOpacity>

      {/* Naver */}
      <TouchableOpacity
        style={[styles.button, styles.naverButton]}
        onPress={() => handleOAuthLogin('naver', loginWithNaver)}
        disabled={loading !== null}
      >
        {loading === 'naver' ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Image source={require('@/assets/icons/naver.png')} style={styles.icon} />
            <Text style={styles.naverText}>네이버로 시작하기</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 8,
    gap: 8,
  },
  icon: { width: 20, height: 20 },
  kakaoButton: { backgroundColor: '#FEE500' },
  kakaoText: { color: '#000', fontWeight: '600' },
  googleButton: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd' },
  googleText: { color: '#000', fontWeight: '600' },
  naverButton: { backgroundColor: '#03C75A' },
  naverText: { color: '#fff', fontWeight: '600' },
});
```

---

## 🌐 Web OAuth 구현 (Next.js)

### OAuth 버튼 컴포넌트 (Web)

```typescript
// features/auth/components/OAuthButtons.tsx
'use client';

import Image from 'next/image';
import { Button } from '@/shared/components/ui/button';

const API_URL = process.env.NEXT_PUBLIC_API_URL;

export function OAuthButtons() {
  const handleOAuthLogin = (provider: 'kakao' | 'google' | 'naver') => {
    // 백엔드 OAuth 시작 URL로 리다이렉트
    window.location.href = `${API_URL}/auth/${provider}`;
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Kakao */}
      <Button
        variant="outline"
        className="w-full bg-[#FEE500] hover:bg-[#FDD800] text-black border-none"
        onClick={() => handleOAuthLogin('kakao')}
      >
        <Image src="/icons/kakao.svg" alt="Kakao" width={20} height={20} className="mr-2" />
        카카오로 시작하기
      </Button>

      {/* Google */}
      <Button
        variant="outline"
        className="w-full"
        onClick={() => handleOAuthLogin('google')}
      >
        <Image src="/icons/google.svg" alt="Google" width={20} height={20} className="mr-2" />
        Google로 시작하기
      </Button>

      {/* Naver */}
      <Button
        variant="outline"
        className="w-full bg-[#03C75A] hover:bg-[#02b351] text-white border-none"
        onClick={() => handleOAuthLogin('naver')}
      >
        <Image src="/icons/naver.svg" alt="Naver" width={20} height={20} className="mr-2" />
        네이버로 시작하기
      </Button>
    </div>
  );
}
```

### OAuth Callback 페이지 (Web)

```typescript
// app/(auth)/auth/callback/page.tsx
'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/core/stores/auth.store';
import { authApi } from '@/core/api';

export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setUser, setLoading } = useAuthStore();

  useEffect(() => {
    const handleCallback = async () => {
      const success = searchParams.get('success');
      const error = searchParams.get('error');

      if (error) {
        console.error('OAuth error:', error);
        router.replace('/login?error=oauth_failed');
        return;
      }

      if (success === 'true') {
        try {
          // 쿠키가 이미 설정됨 → 사용자 정보 조회
          const user = await authApi.getMe();
          setUser(user);
          router.replace('/dashboard');
        } catch (err) {
          console.error('Failed to get user:', err);
          router.replace('/login?error=auth_failed');
        }
      } else {
        router.replace('/login');
      }
    };

    handleCallback();
  }, [searchParams, router, setUser, setLoading]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto" />
        <p className="mt-4 text-muted-foreground">로그인 처리 중...</p>
      </div>
    </div>
  );
}
```

---

## 🔧 Provider 설정 가이드

### Kakao

1. [Kakao Developers](https://developers.kakao.com/) 접속
2. 애플리케이션 추가
3. **앱 키 > REST API 키** 복사 → `KAKAO_CLIENT_ID`
4. **제품 설정 > 카카오 로그인** 활성화
5. **Redirect URI 등록**:
   - Web: `https://your-domain.com/auth/kakao/callback`
   - Local: `http://localhost:3000/auth/kakao/callback`
6. **동의 항목** 설정: 닉네임, 이메일 (선택)

### Google

1. [Google Cloud Console](https://console.cloud.google.com/) 접속
2. 프로젝트 생성
3. **API 및 서비스 > 사용자 인증 정보 > OAuth 2.0 클라이언트 ID** 생성
4. **클라이언트 ID** → `GOOGLE_CLIENT_ID`
5. **클라이언트 보안 비밀번호** → `GOOGLE_CLIENT_SECRET`
6. **승인된 리디렉션 URI** 추가:
   - `https://your-domain.com/auth/google/callback`
   - `http://localhost:3000/auth/google/callback`
7. **OAuth 동의 화면** 설정: 앱 이름, 범위(email, profile)

### Naver

1. [Naver Developers](https://developers.naver.com/) 접속
2. **Application > 애플리케이션 등록**
3. **사용 API**: 네이버 로그인 선택
4. **Client ID** → `NAVER_CLIENT_ID`
5. **Client Secret** → `NAVER_CLIENT_SECRET`
6. **서비스 URL**: `https://your-domain.com`
7. **Callback URL**:
   - `https://your-domain.com/auth/naver/callback`
   - `http://localhost:3000/auth/naver/callback`

---

## 📝 환경 변수

```bash
# .env.example

# JWT
JWT_SECRET=your-jwt-secret-min-32-characters
JWT_REFRESH_SECRET=your-refresh-secret-min-32-characters

# OAuth - Kakao
KAKAO_CLIENT_ID=your-kakao-rest-api-key
KAKAO_CLIENT_SECRET=                          # 선택 (보안 강화 시)
KAKAO_CALLBACK_URL=http://localhost:3000/auth/kakao/callback

# OAuth - Google
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback

# OAuth - Naver
NAVER_CLIENT_ID=your-naver-client-id
NAVER_CLIENT_SECRET=your-naver-client-secret
NAVER_CALLBACK_URL=http://localhost:3000/auth/naver/callback

# URLs
FRONTEND_URL=http://localhost:3000
MOBILE_SCHEME=myapp
```

---

## ❌ Anti-Patterns (절대 금지!)

### 1. Client Secret을 프론트엔드에 노출

```typescript
// ❌ BAD - 프론트엔드에서 직접 토큰 교환
const response = await fetch('https://kauth.kakao.com/oauth/token', {
  body: JSON.stringify({
    client_id: process.env.NEXT_PUBLIC_KAKAO_CLIENT_ID,
    client_secret: process.env.NEXT_PUBLIC_KAKAO_SECRET, // ❌ 절대 금지!
    code: authCode,
  }),
});
```

**왜 안 되는가:**
- Client Secret이 브라우저에 노출
- 악의적 사용자가 Secret 탈취 가능

```typescript
// ✅ GOOD - 백엔드에서 토큰 교환
// Frontend
window.location.href = `${API_URL}/auth/kakao`;

// Backend에서 Secret 사용
```

---

### 2. State 파라미터 미사용 (CSRF 취약)

```typescript
// ❌ BAD - state 없이 OAuth 시작
const authUrl = `https://kauth.kakao.com/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}`;

// Callback에서 검증 안 함
@Get('kakao/callback')
async callback(@Query('code') code: string) {
  // code만 사용 → CSRF 공격에 취약
}
```

**왜 안 되는가:**
- 공격자가 자신의 code를 피해자에게 주입 가능
- 피해자 계정이 공격자 계정과 연결될 수 있음

```typescript
// ✅ GOOD - state 파라미터 사용
// Passport가 자동으로 state 관리
@UseGuards(AuthGuard('kakao'))
```

---

### 3. 이메일 없이 무조건 계정 생성

```typescript
// ❌ BAD - 이메일 확인 없이 계정 생성
const user = User.createFromOAuth({
  email: null, // 이메일 없어도 생성
  provider: 'kakao',
  providerId: profile.id,
});
```

**문제점:**
- 나중에 이메일 기반 기능 사용 불가
- 계정 복구 어려움

```typescript
// ✅ GOOD - 이메일 필수 요청 또는 대체 처리
if (!oauthUser.email) {
  // 1. 이메일 입력 페이지로 리다이렉트
  // 또는
  // 2. 임시 이메일 생성 (provider_id@oauth.local)
}
```

---

### 4. Provider별 중복 사용자 미처리

```typescript
// ❌ BAD - 같은 이메일로 다른 Provider 가입 시 오류
const existingUser = await this.userRepository.findByEmail(email);
if (existingUser) {
  throw new Error('이미 가입된 이메일입니다'); // ❌ 계정 연결 안 됨
}
```

**왜 안 되는가:**
- 사용자가 카카오로 가입 후 구글로 로그인 불가
- UX 저하

```typescript
// ✅ GOOD - 기존 계정에 Provider 연결
if (existingUser) {
  existingUser.linkOAuthProvider(provider, providerId);
  await this.userRepository.save(existingUser);
  return existingUser;
}
```

---

## ✅ 체크리스트

### 백엔드

- [ ] passport-kakao, passport-google-oauth20, passport-naver-v2 설치
- [ ] 각 Provider Strategy 구현
- [ ] OAuth Controller 구현 (시작 + 콜백)
- [ ] OAuthLoginCommand/Handler 구현
- [ ] User Entity에 provider, providerId 필드 추가
- [ ] 기존 계정 연결 로직 구현
- [ ] 환경 변수 설정

### 프론트엔드 (Web)

- [ ] OAuth 버튼 컴포넌트
- [ ] /auth/callback 페이지
- [ ] 로그인 실패 처리

### 모바일

- [ ] expo-web-browser, expo-linking 설치
- [ ] app.json scheme 설정
- [ ] OAuth 서비스 구현
- [ ] Deep Link 콜백 처리
- [ ] SecureStore 토큰 저장

### Provider 설정

- [ ] Kakao Developers 앱 등록 + Redirect URI
- [ ] Google Cloud Console OAuth 설정 + Redirect URI
- [ ] Naver Developers 앱 등록 + Callback URL

### 보안

- [ ] Client Secret은 백엔드에서만 사용
- [ ] HTTPS 필수 (Production)
- [ ] Redirect URI 화이트리스트
- [ ] State 파라미터 (Passport 자동 처리)

---

## 🔗 다른 문서와의 관계

### 함께 참조

- **security.md** → JWT 토큰 전략, 쿠키 설정
- **nestjs-guide.md** → DDD 구조, Command/Handler 패턴

### 다음 단계

- **frontend/nextjs-guide.md** → OAuth 콜백 페이지
- **mobile/expo-guide.md** → SecureStore, Deep Link
