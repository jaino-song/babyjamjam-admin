# Expo Router 가이드

Expo Router + React Native 개발 가이드

---

## 1. 프로젝트 초기화

### 1.1 새 프로젝트 생성

```bash
# Expo Router 템플릿으로 생성
npx create-expo-app@latest apps/mobile --template tabs

# 또는 기본 템플릿 + Router 수동 설정
npx create-expo-app@latest apps/mobile
cd apps/mobile
npx expo install expo-router expo-linking expo-constants expo-status-bar
```

### 1.2 package.json 설정

```json
{
  "name": "mobile",
  "main": "expo-router/entry",
  "scripts": {
    "start": "expo start",
    "android": "expo start --android",
    "ios": "expo start --ios",
    "web": "expo start --web",
    "test": "jest",
    "lint": "eslint . --ext .ts,.tsx",
    "typecheck": "tsc --noEmit"
  }
}
```

### 1.3 app.json 설정

```json
{
  "expo": {
    "name": "MyApp",
    "slug": "my-app",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/icon.png",
    "scheme": "myapp",
    "userInterfaceStyle": "automatic",
    "splash": {
      "image": "./assets/splash.png",
      "resizeMode": "contain",
      "backgroundColor": "#ffffff"
    },
    "assetBundlePatterns": ["**/*"],
    "ios": {
      "supportsTablet": true,
      "bundleIdentifier": "com.company.myapp"
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/adaptive-icon.png",
        "backgroundColor": "#ffffff"
      },
      "package": "com.company.myapp"
    },
    "web": {
      "bundler": "metro",
      "output": "static",
      "favicon": "./assets/favicon.png"
    },
    "plugins": ["expo-router"],
    "experiments": {
      "typedRoutes": true
    }
  }
}
```

---

## 2. Expo Router 파일 구조

### 2.1 기본 라우팅

```
app/
├── _layout.tsx          # Root 레이아웃
├── index.tsx            # / (홈)
├── about.tsx            # /about
├── settings.tsx         # /settings
└── [id].tsx             # /123 (동적 라우트)
```

### 2.2 그룹 라우팅

```
app/
├── _layout.tsx
├── (auth)/              # URL에 표시 안됨
│   ├── _layout.tsx
│   ├── login.tsx        # /login
│   └── register.tsx     # /register
├── (tabs)/              # 탭 네비게이션
│   ├── _layout.tsx
│   ├── home.tsx         # /home
│   ├── explore.tsx      # /explore
│   └── profile.tsx      # /profile
└── (modal)/
    └── settings.tsx     # 모달로 표시
```

### 2.3 중첩 동적 라우트

```
app/
├── products/
│   ├── index.tsx        # /products
│   ├── [id].tsx         # /products/123
│   └── [id]/
│       ├── reviews.tsx  # /products/123/reviews
│       └── [reviewId].tsx # /products/123/reviews/456
```

---

## 3. 레이아웃 패턴

### 3.1 Root Layout

```typescript
// app/_layout.tsx
import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { AuthProvider } from '../lib/auth/AuthContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// 스플래시 스크린 유지
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return null;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen 
            name="modal" 
            options={{ presentation: 'modal' }} 
          />
        </Stack>
      </AuthProvider>
    </QueryClientProvider>
  );
}
```

### 3.2 Tab Layout

```typescript
// app/(tabs)/_layout.tsx
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useColorScheme } from 'react-native';
import { Colors } from '../../constants/Colors';

export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
        headerShown: false,
      }}>
      <Tabs.Screen
        name="home"
        options={{
          title: '홈',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons 
              name={focused ? 'home' : 'home-outline'} 
              size={24} 
              color={color} 
            />
          ),
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: '탐색',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons 
              name={focused ? 'compass' : 'compass-outline'} 
              size={24} 
              color={color} 
            />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: '프로필',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons 
              name={focused ? 'person' : 'person-outline'} 
              size={24} 
              color={color} 
            />
          ),
        }}
      />
    </Tabs>
  );
}
```

### 3.3 Auth Layout (Protected Routes)

```typescript
// app/(auth)/_layout.tsx
import { Redirect, Stack } from 'expo-router';
import { useAuth } from '../../lib/auth/useAuth';
import { ActivityIndicator, View } from 'react-native';

export default function AuthLayout() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  // 이미 로그인된 경우 홈으로 리다이렉트
  if (isAuthenticated) {
    return <Redirect href="/(tabs)/home" />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
    </Stack>
  );
}
```

---

## 4. 네비게이션

### 4.1 Link 컴포넌트

```typescript
import { Link } from 'expo-router';

// 기본 사용
<Link href="/about">About</Link>

// 동적 라우트
<Link href="/products/123">Product Details</Link>

// 타입 안전 (typedRoutes 활성화 시)
<Link href={{ pathname: '/products/[id]', params: { id: '123' } }}>
  Product
</Link>

// 스타일링
<Link href="/settings" asChild>
  <Pressable>
    <Text>Settings</Text>
  </Pressable>
</Link>
```

### 4.2 useRouter Hook

```typescript
import { useRouter } from 'expo-router';

export function MyComponent() {
  const router = useRouter();

  const handleNavigate = () => {
    // push - 스택에 추가
    router.push('/products/123');

    // replace - 현재 화면 교체
    router.replace('/(tabs)/home');

    // back - 뒤로 가기
    router.back();

    // 파라미터와 함께
    router.push({
      pathname: '/products/[id]',
      params: { id: '123', category: 'electronics' },
    });
  };

  return <Button onPress={handleNavigate} title="Navigate" />;
}
```

### 4.3 useLocalSearchParams

```typescript
import { useLocalSearchParams } from 'expo-router';

// app/products/[id].tsx
export default function ProductDetail() {
  const { id, category } = useLocalSearchParams<{
    id: string;
    category?: string;
  }>();

  return (
    <View>
      <Text>Product ID: {id}</Text>
      {category && <Text>Category: {category}</Text>}
    </View>
  );
}
```

---

## 5. 보안 저장소

### 5.1 expo-secure-store 설치

```bash
npx expo install expo-secure-store
```

### 5.2 보안 저장소 모듈

```typescript
// lib/storage/secure.ts
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// 웹 환경 폴백 (개발용)
const webStorage = {
  getItem: (key: string) => localStorage.getItem(key),
  setItem: (key: string, value: string) => localStorage.setItem(key, value),
  deleteItem: (key: string) => localStorage.removeItem(key),
};

const isWeb = Platform.OS === 'web';

const KEYS = {
  ACCESS_TOKEN: 'access_token',
  REFRESH_TOKEN: 'refresh_token',
  USER_DATA: 'user_data',
} as const;

export const secureStorage = {
  // 토큰 관리
  async getAccessToken(): Promise<string | null> {
    if (isWeb) return webStorage.getItem(KEYS.ACCESS_TOKEN);
    return SecureStore.getItemAsync(KEYS.ACCESS_TOKEN);
  },

  async setAccessToken(token: string): Promise<void> {
    if (isWeb) {
      webStorage.setItem(KEYS.ACCESS_TOKEN, token);
      return;
    }
    await SecureStore.setItemAsync(KEYS.ACCESS_TOKEN, token);
  },

  async getRefreshToken(): Promise<string | null> {
    if (isWeb) return webStorage.getItem(KEYS.REFRESH_TOKEN);
    return SecureStore.getItemAsync(KEYS.REFRESH_TOKEN);
  },

  async setRefreshToken(token: string): Promise<void> {
    if (isWeb) {
      webStorage.setItem(KEYS.REFRESH_TOKEN, token);
      return;
    }
    await SecureStore.setItemAsync(KEYS.REFRESH_TOKEN, token);
  },

  // JSON 데이터 저장
  async setJSON<T>(key: string, value: T): Promise<void> {
    const jsonString = JSON.stringify(value);
    if (isWeb) {
      webStorage.setItem(key, jsonString);
      return;
    }
    await SecureStore.setItemAsync(key, jsonString);
  },

  async getJSON<T>(key: string): Promise<T | null> {
    const value = isWeb
      ? webStorage.getItem(key)
      : await SecureStore.getItemAsync(key);
    if (!value) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  },

  // 전체 삭제
  async clearAll(): Promise<void> {
    const keys = Object.values(KEYS);
    if (isWeb) {
      keys.forEach((key) => webStorage.deleteItem(key));
      return;
    }
    await Promise.all(keys.map((key) => SecureStore.deleteItemAsync(key)));
  },
};
```

---

## 6. 인증 컨텍스트

### 6.1 AuthContext 구현

```typescript
// lib/auth/AuthContext.tsx
import React, { createContext, useContext, useEffect, useState } from 'react';
import { useRouter, useSegments } from 'expo-router';
import { secureStorage } from '../storage/secure';

interface User {
  id: string;
  email: string;
  name: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const segments = useSegments();

  // 앱 시작 시 저장된 토큰 확인
  useEffect(() => {
    checkAuth();
  }, []);

  // 인증 상태 변경 시 리다이렉트
  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!user && !inAuthGroup) {
      // 로그인 필요
      router.replace('/(auth)/login');
    } else if (user && inAuthGroup) {
      // 이미 로그인됨
      router.replace('/(tabs)/home');
    }
  }, [user, segments, isLoading]);

  const checkAuth = async () => {
    try {
      const token = await secureStorage.getAccessToken();
      if (token) {
        // 토큰 검증 및 사용자 정보 로드
        const userData = await secureStorage.getJSON<User>('user_data');
        if (userData) {
          setUser(userData);
        }
      }
    } catch (error) {
      console.error('Auth check failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const signIn = async (email: string, password: string) => {
    setIsLoading(true);
    try {
      // API 호출
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        throw new Error('Login failed');
      }

      const data = await response.json();
      
      // 토큰 저장
      await secureStorage.setAccessToken(data.accessToken);
      await secureStorage.setRefreshToken(data.refreshToken);
      await secureStorage.setJSON('user_data', data.user);
      
      setUser(data.user);
    } finally {
      setIsLoading(false);
    }
  };

  const signUp = async (email: string, password: string, name: string) => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name }),
      });

      if (!response.ok) {
        throw new Error('Registration failed');
      }

      const data = await response.json();
      
      await secureStorage.setAccessToken(data.accessToken);
      await secureStorage.setRefreshToken(data.refreshToken);
      await secureStorage.setJSON('user_data', data.user);
      
      setUser(data.user);
    } finally {
      setIsLoading(false);
    }
  };

  const signOut = async () => {
    await secureStorage.clearAll();
    setUser(null);
    router.replace('/(auth)/login');
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        signIn,
        signUp,
        signOut,
      }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
```

---

## 7. API 클라이언트

### 7.1 Axios 설정

```typescript
// lib/api/client.ts
import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { secureStorage } from '../storage/secure';
import Constants from 'expo-constants';

const API_URL = Constants.expoConfig?.extra?.apiUrl || 'http://localhost:3000';

export const apiClient = axios.create({
  baseURL: API_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor - 토큰 자동 추가
apiClient.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    const token = await secureStorage.getAccessToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor - 토큰 갱신
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
    };

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const refreshToken = await secureStorage.getRefreshToken();
        if (!refreshToken) {
          throw new Error('No refresh token');
        }

        const response = await axios.post(`${API_URL}/auth/refresh`, {
          refreshToken,
        });

        const { accessToken, refreshToken: newRefreshToken } = response.data;

        await secureStorage.setAccessToken(accessToken);
        await secureStorage.setRefreshToken(newRefreshToken);

        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return apiClient(originalRequest);
      } catch (refreshError) {
        // 토큰 갱신 실패 - 로그아웃 처리
        await secureStorage.clearAll();
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);
```

### 7.2 TanStack Query 훅

```typescript
// hooks/useProducts.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../lib/api/client';

interface Product {
  id: string;
  name: string;
  price: number;
  description: string;
}

export function useProducts() {
  return useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      const { data } = await apiClient.get<Product[]>('/products');
      return data;
    },
  });
}

export function useProduct(id: string) {
  return useQuery({
    queryKey: ['products', id],
    queryFn: async () => {
      const { data } = await apiClient.get<Product>(`/products/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

export function useCreateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (product: Omit<Product, 'id'>) => {
      const { data } = await apiClient.post<Product>('/products', product);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
}
```

---

## 8. 상태 관리 (Zustand)

```typescript
// stores/appStore.ts
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface AppState {
  theme: 'light' | 'dark' | 'system';
  notifications: boolean;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  setNotifications: (enabled: boolean) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      theme: 'system',
      notifications: true,
      setTheme: (theme) => set({ theme }),
      setNotifications: (notifications) => set({ notifications }),
    }),
    {
      name: 'app-storage',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
```

---

## 9. EAS 빌드 설정

### 9.1 eas.json

```json
{
  "cli": {
    "version": ">= 5.0.0"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "ios": {
        "simulator": true
      },
      "android": {
        "buildType": "apk"
      }
    },
    "preview": {
      "distribution": "internal",
      "ios": {
        "simulator": false
      },
      "android": {
        "buildType": "apk"
      }
    },
    "production": {
      "distribution": "store",
      "ios": {
        "resourceClass": "m-medium"
      },
      "android": {
        "buildType": "app-bundle"
      }
    }
  },
  "submit": {
    "production": {
      "ios": {
        "appleId": "your-apple-id@email.com",
        "ascAppId": "1234567890"
      },
      "android": {
        "serviceAccountKeyPath": "./google-services-key.json",
        "track": "production"
      }
    }
  }
}
```

### 9.2 EAS CLI 명령어

```bash
# 프로젝트 설정
eas build:configure

# 개발 빌드
eas build --profile development --platform all

# 프리뷰 빌드 (테스터 배포)
eas build --profile preview --platform all

# 프로덕션 빌드
eas build --profile production --platform all

# 스토어 제출
eas submit --platform all
```

---

## 10. 테스트

### 10.1 Jest 설정

```javascript
// jest.config.js
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['@testing-library/jest-native/extend-expect'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
};
```

### 10.2 컴포넌트 테스트

```typescript
// components/__tests__/Button.test.tsx
import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Button } from '../Button';

describe('Button', () => {
  it('renders correctly', () => {
    const { getByText } = render(<Button title="Click me" onPress={() => {}} />);
    expect(getByText('Click me')).toBeTruthy();
  });

  it('calls onPress when pressed', () => {
    const onPress = jest.fn();
    const { getByText } = render(<Button title="Click me" onPress={onPress} />);
    
    fireEvent.press(getByText('Click me'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('shows loading indicator when loading', () => {
    const { getByTestId } = render(
      <Button title="Click me" onPress={() => {}} loading />
    );
    expect(getByTestId('loading-indicator')).toBeTruthy();
  });
});
```

---

## 11. 공통 패턴

### 11.1 에러 바운더리

```typescript
// components/ErrorBoundary.tsx
import React from 'react';
import { View, Text, Button, StyleSheet } from 'react-native';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>문제가 발생했습니다</Text>
          <Text style={styles.message}>{this.state.error?.message}</Text>
          <Button
            title="다시 시도"
            onPress={() => this.setState({ hasError: false })}
          />
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  title: { fontSize: 20, fontWeight: 'bold', marginBottom: 10 },
  message: { color: '#666', marginBottom: 20, textAlign: 'center' },
});
```

### 11.2 로딩 상태

```typescript
// components/LoadingScreen.tsx
import { ActivityIndicator, View, StyleSheet } from 'react-native';

export function LoadingScreen() {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#007AFF" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
```

### 11.3 폼 처리

```typescript
// hooks/useForm.ts
import { useState, useCallback } from 'react';
import { z } from 'zod';

export function useForm<T extends z.ZodSchema>(
  schema: T,
  initialValues: z.infer<T>
) {
  const [values, setValues] = useState<z.infer<T>>(initialValues);
  const [errors, setErrors] = useState<Partial<Record<keyof z.infer<T>, string>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const setValue = useCallback(<K extends keyof z.infer<T>>(
    key: K,
    value: z.infer<T>[K]
  ) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    // 입력 시 해당 필드 에러 제거
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  }, []);

  const validate = useCallback((): boolean => {
    const result = schema.safeParse(values);
    if (!result.success) {
      const fieldErrors: Partial<Record<keyof z.infer<T>, string>> = {};
      result.error.errors.forEach((err) => {
        const key = err.path[0] as keyof z.infer<T>;
        if (!fieldErrors[key]) {
          fieldErrors[key] = err.message;
        }
      });
      setErrors(fieldErrors);
      return false;
    }
    setErrors({});
    return true;
  }, [schema, values]);

  const handleSubmit = useCallback(
    async (onSubmit: (values: z.infer<T>) => Promise<void>) => {
      if (!validate()) return;
      
      setIsSubmitting(true);
      try {
        await onSubmit(values);
      } finally {
        setIsSubmitting(false);
      }
    },
    [validate, values]
  );

  return { values, errors, isSubmitting, setValue, validate, handleSubmit };
}
```

---

*v1.0.0 | 2025-01-03 | Mobile Generator Reference*
