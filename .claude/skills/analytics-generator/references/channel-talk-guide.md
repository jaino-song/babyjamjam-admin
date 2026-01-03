# Channel Talk Integration Guide

> 채널톡 고객 소통 플랫폼 연동 가이드

## 개요

Channel Talk은 실시간 채팅, 고객 지원, 마케팅 자동화를 위한 플랫폼입니다.

### 주요 기능

- 실시간 고객 채팅
- 챗봇 자동 응답
- 마케팅 팝업/캠페인
- 사용자 행동 분석
- CRM 연동

---

## 설치

### Web (Next.js)

```bash
pnpm add @channel.io/channel-web-sdk-loader
```

### React Native (Expo)

```bash
pnpm add react-native-channel-plugin
npx expo install react-native-channel-plugin
```

---

## Web 초기화

### SDK 설정

```typescript
// lib/channel-talk.ts
import ChannelService from '@channel.io/channel-web-sdk-loader';

interface ChannelTalkUser {
  memberId: string;
  profile?: {
    name?: string;
    email?: string;
    mobileNumber?: string;
    avatarUrl?: string;
    [key: string]: any;
  };
}

class ChannelTalkManager {
  private static instance: ChannelTalkManager;
  private isBooted = false;

  static getInstance() {
    if (!this.instance) {
      this.instance = new ChannelTalkManager();
    }
    return this.instance;
  }

  boot(pluginKey: string) {
    if (this.isBooted) return;

    ChannelService.loadScript();
    ChannelService.boot({
      pluginKey,
      hideChannelButtonOnBoot: false,
      language: 'ko',
    });

    this.isBooted = true;
  }

  updateUser(user: ChannelTalkUser) {
    ChannelService.updateUser({
      memberId: user.memberId,
      profile: user.profile,
    });
  }

  track(eventName: string, eventProperty?: Record<string, any>) {
    ChannelService.track(eventName, eventProperty);
  }

  showMessenger() {
    ChannelService.showMessenger();
  }

  hideMessenger() {
    ChannelService.hideMessenger();
  }

  shutdown() {
    ChannelService.shutdown();
    this.isBooted = false;
  }
}

export const channelTalk = ChannelTalkManager.getInstance();
```

### Next.js Provider

```tsx
// providers/ChannelTalkProvider.tsx
'use client';

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { channelTalk } from '@/lib/channel-talk';

export function ChannelTalkProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();

  useEffect(() => {
    const pluginKey = process.env.NEXT_PUBLIC_CHANNEL_TALK_PLUGIN_KEY;
    
    if (!pluginKey) {
      console.warn('Channel Talk plugin key not found');
      return;
    }

    channelTalk.boot(pluginKey);

    return () => {
      channelTalk.shutdown();
    };
  }, []);

  // 사용자 정보 연동
  useEffect(() => {
    if (session?.user) {
      channelTalk.updateUser({
        memberId: session.user.id,
        profile: {
          name: session.user.name || undefined,
          email: session.user.email || undefined,
          avatarUrl: session.user.image || undefined,
        },
      });
    }
  }, [session]);

  return <>{children}</>;
}
```

### App에 Provider 추가

```tsx
// app/layout.tsx
import { ChannelTalkProvider } from '@/providers/ChannelTalkProvider';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <ChannelTalkProvider>
          {children}
        </ChannelTalkProvider>
      </body>
    </html>
  );
}
```

---

## React Native (Expo) 초기화

### SDK 설정

```typescript
// lib/channel-talk.native.ts
import ChannelIO from 'react-native-channel-plugin';

class ChannelTalkNative {
  private isBooted = false;

  async boot(pluginKey: string) {
    if (this.isBooted) return;

    try {
      const result = await ChannelIO.boot({
        pluginKey,
        language: 'ko',
      });
      
      this.isBooted = result.status === 'SUCCESS';
    } catch (error) {
      console.error('Channel Talk boot failed:', error);
    }
  }

  async updateUser(memberId: string, profile?: Record<string, any>) {
    await ChannelIO.updateUser({
      memberId,
      profile,
    });
  }

  track(eventName: string, eventProperty?: Record<string, any>) {
    ChannelIO.track(eventName, eventProperty);
  }

  showMessenger() {
    ChannelIO.showMessenger();
  }

  hideMessenger() {
    ChannelIO.hideMessenger();
  }

  async shutdown() {
    await ChannelIO.shutdown();
    this.isBooted = false;
  }
}

export const channelTalkNative = new ChannelTalkNative();
```

### Expo 설정

```json
// app.json
{
  "expo": {
    "plugins": [
      ["react-native-channel-plugin"]
    ]
  }
}
```

---

## 이벤트 트래킹

### 커스텀 이벤트

```typescript
// 구매 완료 이벤트
channelTalk.track('purchase_completed', {
  orderId: 'order-123',
  amount: 50000,
  currency: 'KRW',
  items: ['item-1', 'item-2'],
});

// 회원가입 이벤트
channelTalk.track('signup_completed', {
  method: 'email',
  referrer: 'google',
});

// 페이지 뷰
channelTalk.track('page_view', {
  pageName: 'product_detail',
  productId: 'prod-123',
});
```

### 표준 이벤트

| 이벤트명 | 설명 | 속성 예시 |
|----------|------|----------|
| `signup_completed` | 회원가입 완료 | method, referrer |
| `login_completed` | 로그인 완료 | method |
| `purchase_completed` | 구매 완료 | orderId, amount, currency |
| `cart_added` | 장바구니 추가 | productId, quantity |
| `subscription_started` | 구독 시작 | planId, amount |

---

## 마케팅 자동화

### 팝업 캠페인 트리거

```typescript
// 특정 조건에서 메신저 표시
const showSupportPopup = () => {
  channelTalk.showMessenger();
};

// 예: 장바구니 이탈 시
useEffect(() => {
  const handleBeforeUnload = () => {
    if (cartItems.length > 0) {
      channelTalk.track('cart_abandonment', {
        itemCount: cartItems.length,
        totalAmount: cartTotal,
      });
    }
  };

  window.addEventListener('beforeunload', handleBeforeUnload);
  return () => window.removeEventListener('beforeunload', handleBeforeUnload);
}, [cartItems]);
```

### 커스텀 버튼

```tsx
// components/SupportButton.tsx
'use client';

import { channelTalk } from '@/lib/channel-talk';

export function SupportButton() {
  return (
    <button
      onClick={() => channelTalk.showMessenger()}
      className="fixed bottom-4 right-4 bg-blue-500 text-white rounded-full p-4"
    >
      💬 문의하기
    </button>
  );
}
```

---

## PostHog과 통합

### 이벤트 동시 전송

```typescript
// lib/analytics.ts
import { posthog } from '@/lib/posthog';
import { channelTalk } from '@/lib/channel-talk';

export const analytics = {
  track: (eventName: string, properties?: Record<string, any>) => {
    // PostHog에 전송
    posthog.capture(eventName, properties);
    
    // Channel Talk에 전송
    channelTalk.track(eventName, properties);
  },

  identify: (userId: string, traits?: Record<string, any>) => {
    // PostHog
    posthog.identify(userId, traits);
    
    // Channel Talk
    channelTalk.updateUser({
      memberId: userId,
      profile: traits,
    });
  },
};
```

### 사용 예시

```typescript
// 어디서든 통합 analytics 사용
import { analytics } from '@/lib/analytics';

// 구매 완료
analytics.track('purchase_completed', {
  orderId: 'order-123',
  amount: 50000,
});

// 사용자 식별
analytics.identify(user.id, {
  name: user.name,
  email: user.email,
  plan: user.subscription?.plan,
});
```

---

## 보안 고려사항

### ANL-007: Channel Talk 보안

```typescript
// ✅ Good: Plugin Key만 클라이언트에서 사용
const pluginKey = process.env.NEXT_PUBLIC_CHANNEL_TALK_PLUGIN_KEY;

// ❌ Bad: Access Token/Secret을 클라이언트에서 사용
// Access Token은 서버 사이드 API에서만 사용
```

### 민감정보 제외

```typescript
// 민감정보는 profile에 포함하지 않음
channelTalk.updateUser({
  memberId: user.id,
  profile: {
    name: user.name,
    email: user.email,
    // ❌ 포함하지 않음:
    // password, ssn, creditCard, etc.
  },
});
```

---

## 환경 변수

```bash
# .env.local
NEXT_PUBLIC_CHANNEL_TALK_PLUGIN_KEY=your-plugin-key

# 서버 사이드 API용 (선택)
CHANNEL_TALK_ACCESS_TOKEN=your-access-token
CHANNEL_TALK_ACCESS_SECRET=your-access-secret
```

---

## 테스트

```typescript
// __tests__/channel-talk.test.ts
import { channelTalk } from '@/lib/channel-talk';
import ChannelService from '@channel.io/channel-web-sdk-loader';

jest.mock('@channel.io/channel-web-sdk-loader');

describe('Channel Talk', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should boot with plugin key', () => {
    channelTalk.boot('test-plugin-key');
    
    expect(ChannelService.boot).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginKey: 'test-plugin-key',
      })
    );
  });

  it('should track events', () => {
    channelTalk.track('test_event', { key: 'value' });
    
    expect(ChannelService.track).toHaveBeenCalledWith(
      'test_event',
      { key: 'value' }
    );
  });

  it('should update user', () => {
    channelTalk.updateUser({
      memberId: 'user-123',
      profile: { name: 'Test User' },
    });
    
    expect(ChannelService.updateUser).toHaveBeenCalledWith({
      memberId: 'user-123',
      profile: { name: 'Test User' },
    });
  });
});
```

---

## 체크리스트

- [ ] SDK 설치 (@channel.io/channel-web-sdk-loader)
- [ ] Plugin Key 환경변수 설정
- [ ] Provider 구현 및 적용
- [ ] 사용자 정보 연동
- [ ] 이벤트 트래킹 구현
- [ ] PostHog 통합 (선택)
- [ ] 테스트 작성
