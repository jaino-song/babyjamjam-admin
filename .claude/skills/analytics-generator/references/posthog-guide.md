# PostHog Integration Guide

> **역할**: PostHog 분석 통합 전문가
> **담당**: 이벤트 트래킹, Feature Flags, Session Recording, A/B Testing

---

## 🎯 사용 시점 (Trigger)

이 문서를 참조하는 경우:
- "Analytics 추가해줘"
- "PostHog 연동해줘"
- "Feature Flag 만들어줘"
- "세션 녹화 설정해줘"
- "A/B 테스트 설정해줘"

---

## 📥 Input (필수 정보)

```
□ PostHog 환경
  └─ Cloud vs Self-hosted
  └─ Project API Key

□ 플랫폼 정보
  └─ Web (Next.js)
  └─ Backend (NestJS)
  └─ Mobile (Expo)

□ 필요 기능
  └─ 이벤트 트래킹
  └─ Feature Flags
  └─ Session Recording
  └─ A/B Testing
```

---

## 📤 Output (생성해야 할 파일)

```
packages/analytics/
├── src/
│   ├── index.ts
│   ├── posthog.ts
│   ├── events.ts
│   ├── feature-flags.ts
│   ├── identify.ts
│   └── privacy.ts
├── package.json
└── tsconfig.json

apps/web/
├── providers/
│   └── analytics-provider.tsx
└── hooks/
    └── use-analytics.ts

apps/backend/src/modules/analytics/
├── analytics.module.ts
├── analytics.service.ts
└── analytics.controller.ts
```

---

## 🔢 구현 순서

### Step 1: Analytics 패키지 생성

```bash
# 패키지 생성
mkdir -p packages/analytics/src
cd packages/analytics
pnpm init
```

**package.json:**

```json
{
  "name": "@repo/analytics",
  "version": "1.0.0",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "posthog-js": "^1.96.0",
    "posthog-node": "^3.6.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0"
  }
}
```

---

### Step 2: PostHog 클라이언트 (서버/클라이언트 분리)

**packages/analytics/src/posthog.ts:**

```typescript
// ✅ 클라이언트용 (브라우저)
import posthog from 'posthog-js';

// ✅ 서버용 (Node.js)
import { PostHog } from 'posthog-node';

export interface PostHogConfig {
  apiKey: string;
  apiHost?: string;
  debug?: boolean;
}

/**
 * 클라이언트 PostHog 인스턴스
 * ⚠️ 브라우저에서만 사용
 */
export function initClientPostHog(config: PostHogConfig): typeof posthog {
  if (typeof window === 'undefined') {
    throw new Error('initClientPostHog must be called in browser');
  }

  posthog.init(config.apiKey, {
    api_host: config.apiHost || 'https://app.posthog.com',
    // ANL-002: PII 보호
    sanitize_properties: (properties) => {
      // 이메일 해싱
      if (properties.$email) {
        properties.$email = hashEmail(properties.$email);
      }
      return properties;
    },
    // ANL-003: 세션 녹화 마스킹
    session_recording: {
      maskAllInputs: true,
      maskTextContent: true,
    },
    // ANL-006: 옵트아웃 존중
    opt_out_capturing_by_default: false,
    persistence: 'localStorage+cookie',
    loaded: (posthog) => {
      if (config.debug) {
        posthog.debug();
      }
    },
  });

  return posthog;
}

/**
 * 서버 PostHog 인스턴스
 * ⚠️ Node.js에서만 사용
 */
export function createServerPostHog(config: PostHogConfig): PostHog {
  return new PostHog(config.apiKey, {
    host: config.apiHost || 'https://app.posthog.com',
    // ANL-005: Batch 처리
    flushAt: 20,
    flushInterval: 10000,
  });
}

/**
 * ANL-002: 이메일 해싱
 */
export function hashEmail(email: string): string {
  // SHA-256 해싱 (crypto-js 또는 Web Crypto API 사용)
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(email.toLowerCase()).digest('hex');
}

/**
 * ANL-002: 전화번호 해싱
 */
export function hashPhone(phone: string): string {
  const crypto = require('crypto');
  const normalized = phone.replace(/\D/g, '');
  return crypto.createHash('sha256').update(normalized).digest('hex');
}
```

---

### Step 3: 이벤트 정의 (Type-safe)

**packages/analytics/src/events.ts:**

```typescript
/**
 * 모든 트래킹 이벤트 정의
 * Type-safe 이벤트 트래킹
 */

// 이벤트 이름 상수
export const AnalyticsEvents = {
  // 페이지뷰
  PAGE_VIEW: 'page_view',
  
  // 인증
  AUTH_LOGIN: 'auth_login',
  AUTH_SIGNUP: 'auth_signup',
  AUTH_LOGOUT: 'auth_logout',
  AUTH_PASSWORD_RESET: 'auth_password_reset',
  
  // 사용자 액션
  USER_PROFILE_UPDATE: 'user_profile_update',
  USER_SETTINGS_CHANGE: 'user_settings_change',
  
  // 결제
  PAYMENT_INITIATED: 'payment_initiated',
  PAYMENT_COMPLETED: 'payment_completed',
  PAYMENT_FAILED: 'payment_failed',
  SUBSCRIPTION_STARTED: 'subscription_started',
  SUBSCRIPTION_CANCELLED: 'subscription_cancelled',
  
  // Feature 사용
  FEATURE_USED: 'feature_used',
  
  // 에러
  ERROR_OCCURRED: 'error_occurred',
} as const;

export type AnalyticsEventName = typeof AnalyticsEvents[keyof typeof AnalyticsEvents];

// 이벤트별 프로퍼티 타입
export interface AnalyticsEventProperties {
  [AnalyticsEvents.PAGE_VIEW]: {
    path: string;
    referrer?: string;
    title?: string;
  };
  
  [AnalyticsEvents.AUTH_LOGIN]: {
    method: 'email' | 'oauth';
    provider?: 'google' | 'kakao' | 'naver';
  };
  
  [AnalyticsEvents.AUTH_SIGNUP]: {
    method: 'email' | 'oauth';
    provider?: string;
    referral_code?: string;
  };
  
  [AnalyticsEvents.PAYMENT_COMPLETED]: {
    amount: number;
    currency: string;
    product_id: string;
    payment_method: string;
  };
  
  [AnalyticsEvents.FEATURE_USED]: {
    feature_name: string;
    feature_variant?: string;
  };
  
  [AnalyticsEvents.ERROR_OCCURRED]: {
    error_type: string;
    error_message: string;
    error_stack?: string;
    page?: string;
  };
}

// 타입 안전한 트래킹 함수
export type TrackEvent = <E extends AnalyticsEventName>(
  event: E,
  properties: E extends keyof AnalyticsEventProperties 
    ? AnalyticsEventProperties[E] 
    : Record<string, unknown>
) => void;
```

---

### Step 4: 사용자 식별 (PII 보호)

**packages/analytics/src/identify.ts:**

```typescript
import { hashEmail, hashPhone } from './posthog';

/**
 * 사용자 식별 데이터
 * ANL-002: 모든 PII는 해싱하여 전송
 */
export interface UserIdentity {
  userId: string;
  email?: string;
  phone?: string;
  name?: string;
  createdAt?: Date;
  plan?: string;
  traits?: Record<string, unknown>;
}

/**
 * PII를 해싱한 안전한 사용자 속성 생성
 */
export function createSafeUserProperties(user: UserIdentity): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    user_id: user.userId,
  };

  // ANL-002: 이메일 해싱
  if (user.email) {
    properties.email_hash = hashEmail(user.email);
    properties.email_domain = user.email.split('@')[1]; // 도메인은 유지 (분석용)
  }

  // ANL-002: 전화번호 해싱
  if (user.phone) {
    properties.phone_hash = hashPhone(user.phone);
  }

  // 이름은 전송하지 않음 (PII)
  // ❌ properties.name = user.name;

  // 비 PII 데이터
  if (user.createdAt) {
    properties.created_at = user.createdAt.toISOString();
  }
  if (user.plan) {
    properties.plan = user.plan;
  }
  if (user.traits) {
    Object.assign(properties, user.traits);
  }

  return properties;
}

/**
 * PostHog identify 호출
 */
export function identifyUser(
  posthog: any,
  user: UserIdentity
): void {
  const properties = createSafeUserProperties(user);
  posthog.identify(user.userId, properties);
}

/**
 * 사용자 리셋 (로그아웃 시)
 */
export function resetUser(posthog: any): void {
  posthog.reset();
}
```

---

### Step 5: Feature Flags

**packages/analytics/src/feature-flags.ts:**

```typescript
import posthog from 'posthog-js';

/**
 * Feature Flag 이름 상수
 */
export const FeatureFlags = {
  // UI/UX
  NEW_ONBOARDING: 'new-onboarding',
  DARK_MODE: 'dark-mode',
  
  // 기능
  AI_SUGGESTIONS: 'ai-suggestions',
  ADVANCED_ANALYTICS: 'advanced-analytics',
  
  // A/B 테스트
  PRICING_PAGE_VARIANT: 'pricing-page-variant',
  CHECKOUT_FLOW: 'checkout-flow',
} as const;

export type FeatureFlagName = typeof FeatureFlags[keyof typeof FeatureFlags];

/**
 * Feature Flag 체크 (클라이언트)
 */
export function isFeatureEnabled(flag: FeatureFlagName): boolean {
  if (typeof window === 'undefined') {
    console.warn('isFeatureEnabled should be called on client side');
    return false;
  }
  return posthog.isFeatureEnabled(flag) ?? false;
}

/**
 * Feature Flag 변형 가져오기 (A/B 테스트)
 */
export function getFeatureVariant(flag: FeatureFlagName): string | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return posthog.getFeatureFlag(flag) as string | undefined;
}

/**
 * Feature Flag 페이로드 가져오기
 */
export function getFeaturePayload(flag: FeatureFlagName): Record<string, unknown> | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return posthog.getFeatureFlagPayload(flag) as Record<string, unknown> | undefined;
}

/**
 * Feature Flag 오버라이드 (개발/테스트용)
 */
export function overrideFeatureFlag(flag: FeatureFlagName, value: boolean | string): void {
  if (typeof window === 'undefined') return;
  posthog.featureFlags.override({ [flag]: value });
}

/**
 * React Hook - useFeatureFlag
 */
export function useFeatureFlag(flag: FeatureFlagName): boolean {
  const [enabled, setEnabled] = useState<boolean>(false);
  
  useEffect(() => {
    // 초기값
    setEnabled(isFeatureEnabled(flag));
    
    // Flag 변경 감지
    const unsubscribe = posthog.onFeatureFlags(() => {
      setEnabled(isFeatureEnabled(flag));
    });
    
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [flag]);
  
  return enabled;
}

// useState import
import { useState, useEffect } from 'react';
```

---

### Step 6: 프라이버시 & 옵트아웃

**packages/analytics/src/privacy.ts:**

```typescript
import posthog from 'posthog-js';

/**
 * ANL-006: 트래킹 옵트아웃
 */
export function optOutTracking(): void {
  if (typeof window === 'undefined') return;
  
  posthog.opt_out_capturing();
  localStorage.setItem('analytics_opt_out', 'true');
}

/**
 * 트래킹 옵트인
 */
export function optInTracking(): void {
  if (typeof window === 'undefined') return;
  
  posthog.opt_in_capturing();
  localStorage.removeItem('analytics_opt_out');
}

/**
 * 옵트아웃 상태 확인
 */
export function isOptedOut(): boolean {
  if (typeof window === 'undefined') return false;
  
  return posthog.has_opted_out_capturing() || 
         localStorage.getItem('analytics_opt_out') === 'true';
}

/**
 * 세션 녹화 시작
 */
export function startSessionRecording(): void {
  if (typeof window === 'undefined') return;
  if (isOptedOut()) return;
  
  posthog.startSessionRecording();
}

/**
 * 세션 녹화 중지
 */
export function stopSessionRecording(): void {
  if (typeof window === 'undefined') return;
  posthog.stopSessionRecording();
}

/**
 * 특정 요소 마스킹 (클래스 추가)
 * ANL-003: 민감 정보 마스킹
 */
export const MASK_CLASS = 'ph-no-capture';

/**
 * 동의 배너 표시 여부
 */
export function shouldShowConsentBanner(): boolean {
  if (typeof window === 'undefined') return false;
  
  const hasConsent = localStorage.getItem('analytics_consent');
  return hasConsent === null;
}

/**
 * 동의 저장
 */
export function saveConsent(allowed: boolean): void {
  if (typeof window === 'undefined') return;
  
  localStorage.setItem('analytics_consent', allowed ? 'true' : 'false');
  
  if (allowed) {
    optInTracking();
  } else {
    optOutTracking();
  }
}

/**
 * GDPR 데이터 삭제 요청
 */
export async function requestDataDeletion(email: string): Promise<void> {
  // PostHog API를 통한 데이터 삭제 요청
  // 실제 구현은 백엔드를 통해 처리
  console.log('Data deletion requested for:', email);
}
```

---

### Step 7: Next.js Provider

**apps/web/providers/analytics-provider.tsx:**

```typescript
'use client';

import { useEffect, createContext, useContext, useState, ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import posthog from 'posthog-js';
import {
  initClientPostHog,
  AnalyticsEvents,
  identifyUser,
  resetUser,
  isOptedOut,
  shouldShowConsentBanner,
  saveConsent,
  type UserIdentity,
} from '@repo/analytics';

interface AnalyticsContextType {
  track: (event: string, properties?: Record<string, unknown>) => void;
  identify: (user: UserIdentity) => void;
  reset: () => void;
  isReady: boolean;
  optOut: () => void;
  optIn: () => void;
  showConsentBanner: boolean;
  setConsent: (allowed: boolean) => void;
}

const AnalyticsContext = createContext<AnalyticsContextType | null>(null);

interface AnalyticsProviderProps {
  children: ReactNode;
}

export function AnalyticsProvider({ children }: AnalyticsProviderProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isReady, setIsReady] = useState(false);
  const [showConsentBanner, setShowConsentBanner] = useState(false);

  // PostHog 초기화
  useEffect(() => {
    // ANL-006: 옵트아웃 상태면 초기화 스킵
    if (isOptedOut()) {
      setIsReady(true);
      return;
    }

    // ANL-001: Public Key만 사용
    initClientPostHog({
      apiKey: process.env.NEXT_PUBLIC_POSTHOG_KEY!,
      apiHost: process.env.NEXT_PUBLIC_POSTHOG_HOST,
      debug: process.env.NODE_ENV === 'development',
    });

    setIsReady(true);
    setShowConsentBanner(shouldShowConsentBanner());
  }, []);

  // 페이지뷰 트래킹
  useEffect(() => {
    if (!isReady || isOptedOut()) return;

    const url = pathname + (searchParams.toString() ? `?${searchParams}` : '');
    posthog.capture(AnalyticsEvents.PAGE_VIEW, {
      path: pathname,
      url,
      referrer: document.referrer,
      title: document.title,
    });
  }, [pathname, searchParams, isReady]);

  const track = (event: string, properties?: Record<string, unknown>) => {
    if (!isReady || isOptedOut()) return;
    posthog.capture(event, properties);
  };

  const identify = (user: UserIdentity) => {
    if (!isReady || isOptedOut()) return;
    identifyUser(posthog, user);
  };

  const reset = () => {
    if (!isReady) return;
    resetUser(posthog);
  };

  const optOut = () => {
    posthog.opt_out_capturing();
    localStorage.setItem('analytics_opt_out', 'true');
  };

  const optIn = () => {
    posthog.opt_in_capturing();
    localStorage.removeItem('analytics_opt_out');
  };

  const setConsent = (allowed: boolean) => {
    saveConsent(allowed);
    setShowConsentBanner(false);
  };

  return (
    <AnalyticsContext.Provider
      value={{
        track,
        identify,
        reset,
        isReady,
        optOut,
        optIn,
        showConsentBanner,
        setConsent,
      }}
    >
      {children}
      {showConsentBanner && <ConsentBanner onConsent={setConsent} />}
    </AnalyticsContext.Provider>
  );
}

export function useAnalytics() {
  const context = useContext(AnalyticsContext);
  if (!context) {
    throw new Error('useAnalytics must be used within AnalyticsProvider');
  }
  return context;
}

// 동의 배너 컴포넌트
function ConsentBanner({ onConsent }: { onConsent: (allowed: boolean) => void }) {
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-gray-900 text-white p-4 z-50">
      <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
        <p className="text-sm">
          서비스 개선을 위해 익명화된 사용 데이터를 수집합니다. 
          개인정보는 수집하지 않습니다.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => onConsent(false)}
            className="px-4 py-2 text-sm border border-gray-600 rounded hover:bg-gray-800"
          >
            거부
          </button>
          <button
            onClick={() => onConsent(true)}
            className="px-4 py-2 text-sm bg-blue-600 rounded hover:bg-blue-700"
          >
            동의
          </button>
        </div>
      </div>
    </div>
  );
}
```

---

### Step 8: NestJS Analytics Module

**apps/backend/src/modules/analytics/analytics.service.ts:**

```typescript
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PostHog } from 'posthog-node';

@Injectable()
export class AnalyticsService implements OnModuleDestroy {
  private readonly posthog: PostHog;

  constructor(private readonly configService: ConfigService) {
    // ANL-001: 서버에서만 Private Key 사용
    this.posthog = new PostHog(
      this.configService.get<string>('POSTHOG_API_KEY')!,
      {
        host: this.configService.get<string>('POSTHOG_HOST') || 'https://app.posthog.com',
        // ANL-005: Batch 처리로 Rate Limiting 대응
        flushAt: 20,
        flushInterval: 10000,
      },
    );
  }

  /**
   * 서버 사이드 이벤트 트래킹
   */
  capture(
    distinctId: string,
    event: string,
    properties?: Record<string, unknown>,
  ): void {
    this.posthog.capture({
      distinctId,
      event,
      properties,
    });
  }

  /**
   * Feature Flag 체크 (서버 사이드)
   */
  async isFeatureEnabled(
    distinctId: string,
    flag: string,
  ): Promise<boolean> {
    return await this.posthog.isFeatureEnabled(flag, distinctId) ?? false;
  }

  /**
   * Feature Flag 변형 가져오기
   */
  async getFeatureFlag(
    distinctId: string,
    flag: string,
  ): Promise<string | boolean | undefined> {
    return await this.posthog.getFeatureFlag(flag, distinctId);
  }

  /**
   * 사용자 속성 업데이트
   */
  identify(
    distinctId: string,
    properties: Record<string, unknown>,
  ): void {
    this.posthog.identify({
      distinctId,
      properties,
    });
  }

  /**
   * 그룹 분석 설정
   */
  groupIdentify(
    groupType: string,
    groupKey: string,
    properties: Record<string, unknown>,
  ): void {
    this.posthog.groupIdentify({
      groupType,
      groupKey,
      properties,
    });
  }

  /**
   * 모듈 종료 시 버퍼 플러시
   */
  async onModuleDestroy(): Promise<void> {
    await this.posthog.shutdown();
  }
}
```

**apps/backend/src/modules/analytics/analytics.module.ts:**

```typescript
import { Module, Global } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';

@Global()
@Module({
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
```

---

### Step 9: Expo Provider (Mobile)

**apps/mobile/providers/analytics-provider.tsx:**

```typescript
import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import PostHog from 'posthog-react-native';
import * as SecureStore from 'expo-secure-store';
import { hashEmail, hashPhone } from '@repo/analytics';

interface AnalyticsContextType {
  track: (event: string, properties?: Record<string, unknown>) => void;
  identify: (userId: string, traits?: Record<string, unknown>) => void;
  reset: () => void;
  isReady: boolean;
}

const AnalyticsContext = createContext<AnalyticsContextType | null>(null);

interface AnalyticsProviderProps {
  children: ReactNode;
}

export function AnalyticsProvider({ children }: AnalyticsProviderProps) {
  const [isReady, setIsReady] = useState(false);
  const [posthog, setPosthog] = useState<PostHog | null>(null);

  useEffect(() => {
    const initAnalytics = async () => {
      // 옵트아웃 체크
      const optedOut = await SecureStore.getItemAsync('analytics_opt_out');
      if (optedOut === 'true') {
        setIsReady(true);
        return;
      }

      const client = new PostHog(
        process.env.EXPO_PUBLIC_POSTHOG_KEY!,
        {
          host: process.env.EXPO_PUBLIC_POSTHOG_HOST,
          // ANL-003: 세션 녹화 설정
          enableSessionReplay: true,
          sessionReplayConfig: {
            maskAllTextInputs: true,
            maskAllImages: false,
          },
        }
      );

      setPosthog(client);
      setIsReady(true);
    };

    initAnalytics();
  }, []);

  const track = (event: string, properties?: Record<string, unknown>) => {
    if (!posthog || !isReady) return;
    posthog.capture(event, properties);
  };

  const identify = (userId: string, traits?: Record<string, unknown>) => {
    if (!posthog || !isReady) return;
    
    // ANL-002: PII 해싱
    const safeTraits = { ...traits };
    if (safeTraits.email && typeof safeTraits.email === 'string') {
      safeTraits.email_hash = hashEmail(safeTraits.email);
      delete safeTraits.email;
    }
    if (safeTraits.phone && typeof safeTraits.phone === 'string') {
      safeTraits.phone_hash = hashPhone(safeTraits.phone);
      delete safeTraits.phone;
    }
    
    posthog.identify(userId, safeTraits);
  };

  const reset = () => {
    if (!posthog) return;
    posthog.reset();
  };

  return (
    <AnalyticsContext.Provider value={{ track, identify, reset, isReady }}>
      {children}
    </AnalyticsContext.Provider>
  );
}

export function useAnalytics() {
  const context = useContext(AnalyticsContext);
  if (!context) {
    throw new Error('useAnalytics must be used within AnalyticsProvider');
  }
  return context;
}
```

---

## 🔒 보안 체크리스트

### ANL-001: API Key 보안

- [ ] `POSTHOG_API_KEY` (Private) - 서버에서만 사용
- [ ] `NEXT_PUBLIC_POSTHOG_KEY` (Public) - 클라이언트용
- [ ] Private Key가 클라이언트 번들에 포함되지 않음

### ANL-002: PII 보호

- [ ] 이메일 해싱 (`hashEmail`)
- [ ] 전화번호 해싱 (`hashPhone`)
- [ ] 이름, 주소 등 PII 전송 금지
- [ ] `sanitize_properties` 설정

### ANL-003: 세션 녹화 마스킹

- [ ] `maskAllInputs: true`
- [ ] `maskTextContent: true`
- [ ] 민감 요소에 `ph-no-capture` 클래스

### ANL-005: Rate Limiting

- [ ] Batch 처리 (`flushAt: 20`)
- [ ] 플러시 간격 (`flushInterval: 10000`)
- [ ] 과도한 이벤트 전송 방지

### ANL-006: 옵트아웃

- [ ] `opt_out_capturing()` 구현
- [ ] 동의 배너 UI
- [ ] localStorage 저장
- [ ] 옵트아웃 상태 존중

---

## 📝 환경 변수

```bash
# .env.example

# PostHog - Server (ANL-001: Private Key는 서버에서만)
POSTHOG_API_KEY=phc_xxx_server_key

# PostHog - Client (Public Key)
NEXT_PUBLIC_POSTHOG_KEY=phc_xxx_public_key
NEXT_PUBLIC_POSTHOG_HOST=https://app.posthog.com

# Mobile
EXPO_PUBLIC_POSTHOG_KEY=phc_xxx_public_key
EXPO_PUBLIC_POSTHOG_HOST=https://app.posthog.com
```

---

## ❌ Anti-Patterns (절대 금지!)

### 1. 클라이언트에서 Private Key 사용

```typescript
// ❌ BAD
const posthog = new PostHog(process.env.POSTHOG_API_KEY); // Private key!

// ✅ GOOD
const posthog = initClientPostHog({
  apiKey: process.env.NEXT_PUBLIC_POSTHOG_KEY, // Public key
});
```

### 2. PII 평문 전송

```typescript
// ❌ BAD
posthog.identify(userId, {
  email: 'user@example.com', // ❌ 평문!
  phone: '010-1234-5678',    // ❌ 평문!
});

// ✅ GOOD
posthog.identify(userId, {
  email_hash: hashEmail('user@example.com'),
  phone_hash: hashPhone('010-1234-5678'),
});
```

### 3. 세션 녹화 마스킹 없음

```typescript
// ❌ BAD
posthog.init(apiKey, {
  session_recording: true, // 마스킹 없음!
});

// ✅ GOOD
posthog.init(apiKey, {
  session_recording: {
    maskAllInputs: true,
    maskTextContent: true,
  },
});
```

### 4. 옵트아웃 무시

```typescript
// ❌ BAD
function track(event) {
  posthog.capture(event); // 옵트아웃 체크 없음!
}

// ✅ GOOD
function track(event) {
  if (isOptedOut()) return;
  posthog.capture(event);
}
```

---

## 🔗 다른 문서와의 관계

### 함께 사용하는 것
- **frontend/nextjs-guide.md** → Provider 통합
- **mobile/expo-guide.md** → 모바일 분석

### 다음 단계에 전달하는 것
- **Feature Flags** → A/B 테스트 결과 분석
- **세션 녹화** → UX 개선 인사이트
