# React Native Expo Guide

## 디렉토리 구조

```
src/
├── app/                        # Expo Router
│   ├── (auth)/                 # 인증 불필요 스크린
│   │   ├── _layout.tsx
│   │   ├── login.tsx
│   │   └── register.tsx
│   ├── (tabs)/                 # 탭 네비게이션
│   │   ├── _layout.tsx
│   │   ├── home.tsx
│   │   ├── search.tsx
│   │   └── profile.tsx
│   ├── _layout.tsx             # Root Layout
│   └── index.tsx               # Entry (리다이렉트)
├── features/                   # Feature 모듈 (Web과 동일)
│   ├── auth/
│   │   ├── components/
│   │   ├── hooks/
│   │   └── services/
│   └── [feature]/
├── shared/
│   ├── components/
│   ├── hooks/
│   └── lib/
└── core/
    ├── api/                    # Axios 설정
    ├── providers/
    ├── stores/
    └── storage/                # SecureStore 래퍼
```

## Root Layout

```typescript
// app/_layout.tsx
import { Stack } from 'expo-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/core/api/queryClient';
import { useAuthBootstrap } from '@/features/auth/hooks/useAuthBootstrap';

export default function RootLayout() {
  const { isLoading, isAuthenticated } = useAuthBootstrap();

  if (isLoading) {
    return <SplashScreen />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </QueryClientProvider>
  );
}
```

## 탭 네비게이션

```typescript
// app/(tabs)/_layout.tsx
import { Tabs } from 'expo-router';
import { Home, Search, User } from 'lucide-react-native';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#3b82f6',
        tabBarInactiveTintColor: '#9ca3af',
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: '홈',
          tabBarIcon: ({ color, size }) => <Home size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: '검색',
          tabBarIcon: ({ color, size }) => <Search size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: '프로필',
          tabBarIcon: ({ color, size }) => <User size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
```

## 인증 부트스트랩

```typescript
// features/auth/hooks/useAuthBootstrap.ts
import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useAuthStore } from '@/core/stores/auth.store';
import { authApi } from '@/core/api';

export function useAuthBootstrap() {
  const [isLoading, setIsLoading] = useState(true);
  const { setUser, logout } = useAuthStore();
  const router = useRouter();

  useEffect(() => {
    async function bootstrap() {
      try {
        const token = await SecureStore.getItemAsync('accessToken');
        
        if (!token) {
          router.replace('/(auth)/login');
          return;
        }

        const user = await authApi.getMe();
        setUser(user);
        router.replace('/(tabs)/home');
      } catch (error) {
        logout();
        router.replace('/(auth)/login');
      } finally {
        setIsLoading(false);
      }
    }

    bootstrap();
  }, []);

  return { isLoading };
}
```

## SecureStore 래퍼

```typescript
// core/storage/secureStorage.ts
import * as SecureStore from 'expo-secure-store';

export const secureStorage = {
  async get(key: string): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },

  async set(key: string, value: string): Promise<void> {
    await SecureStore.setItemAsync(key, value);
  },

  async remove(key: string): Promise<void> {
    await SecureStore.deleteItemAsync(key);
  },

  async clear(): Promise<void> {
    await Promise.all([
      SecureStore.deleteItemAsync('accessToken'),
      SecureStore.deleteItemAsync('refreshToken'),
    ]);
  },
};

// 토큰 관리
export const tokenStorage = {
  async getAccessToken() {
    return secureStorage.get('accessToken');
  },
  async setAccessToken(token: string) {
    return secureStorage.set('accessToken', token);
  },
  async getRefreshToken() {
    return secureStorage.get('refreshToken');
  },
  async setRefreshToken(token: string) {
    return secureStorage.set('refreshToken', token);
  },
  async clearTokens() {
    return secureStorage.clear();
  },
};
```

## OAuth 처리 (Expo AuthSession)

```typescript
// features/auth/services/oauth.ts
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { authApi } from '@/core/api';
import { tokenStorage } from '@/core/storage/secureStorage';

WebBrowser.maybeCompleteAuthSession();

export async function loginWithKakao(): Promise<boolean> {
  try {
    // 1. OAuth URL로 브라우저 열기
    const redirectUrl = Linking.createURL('auth/callback');
    const authUrl = `${API_URL}/auth/kakao?redirect_uri=${redirectUrl}`;
    
    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
    
    if (result.type !== 'success') {
      return false;
    }

    // 2. URL에서 code 추출
    const url = Linking.parse(result.url);
    const code = url.queryParams?.code as string;

    if (!code) {
      return false;
    }

    // 3. Code를 토큰으로 교환
    const tokens = await authApi.exchangeCode(code, 'mobile');
    
    // 4. 토큰 저장
    await tokenStorage.setAccessToken(tokens.accessToken);
    await tokenStorage.setRefreshToken(tokens.refreshToken);

    return true;
  } catch (error) {
    console.error('OAuth error:', error);
    return false;
  }
}
```

## Offline First 패턴

```typescript
// features/posts/hooks/usePosts.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { postsApi } from '@/core/api';

export function usePosts() {
  return useQuery({
    queryKey: ['posts'],
    queryFn: postsApi.getAll,
    // Offline First 설정
    networkMode: 'offlineFirst',
    gcTime: 24 * 60 * 60 * 1000,  // 24시간 캐시
    staleTime: 5 * 60 * 1000,     // 5분
  });
}

export function useCreatePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: postsApi.create,
    // Optimistic Update
    onMutate: async (newPost) => {
      await queryClient.cancelQueries({ queryKey: ['posts'] });
      
      const previousPosts = queryClient.getQueryData(['posts']);
      
      queryClient.setQueryData(['posts'], (old: Post[]) => [
        { ...newPost, id: 'temp-' + Date.now(), _optimistic: true },
        ...old,
      ]);

      return { previousPosts };
    },
    onError: (err, newPost, context) => {
      queryClient.setQueryData(['posts'], context?.previousPosts);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['posts'] });
    },
  });
}
```

## Deep Linking 설정

```json
// app.json
{
  "expo": {
    "scheme": "myapp",
    "ios": {
      "bundleIdentifier": "com.myapp.app",
      "associatedDomains": ["applinks:myapp.com"]
    },
    "android": {
      "package": "com.myapp.app",
      "intentFilters": [
        {
          "action": "VIEW",
          "autoVerify": true,
          "data": [
            { "scheme": "myapp" },
            { "scheme": "https", "host": "myapp.com", "pathPrefix": "/app" }
          ],
          "category": ["BROWSABLE", "DEFAULT"]
        }
      ]
    }
  }
}
```

## 푸시 알림 설정

```typescript
// core/notifications/pushNotifications.ts
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    console.log('Push notifications require a physical device');
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    return null;
  }

  const token = await Notifications.getExpoPushTokenAsync({
    projectId: 'your-project-id',
  });

  if (Platform.OS === 'android') {
    Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
    });
  }

  return token.data;
}
```

## Web과 코드 공유

```typescript
// packages/api-client (공유)
export const createApiClient = (config: ApiConfig) => ({
  posts: {
    getAll: () => request('/posts'),
    create: (data) => request('/posts', { method: 'POST', body: data }),
  },
});

// apps/web/src/core/api/client.ts
import { createApiClient } from '@repo/api-client';
export const api = createApiClient({
  baseUrl: process.env.NEXT_PUBLIC_API_URL,
  getToken: async () => null, // Cookie 사용
});

// apps/mobile/src/core/api/client.ts
import { createApiClient } from '@repo/api-client';
import { tokenStorage } from '../storage/secureStorage';
export const api = createApiClient({
  baseUrl: process.env.EXPO_PUBLIC_API_URL,
  getToken: () => tokenStorage.getAccessToken(),
});
```
