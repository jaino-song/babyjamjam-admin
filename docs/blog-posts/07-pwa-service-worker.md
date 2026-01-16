# PWA Service Worker 업데이트: 사용자에게 알려주기

> PWA 앱 업데이트 시 사용자에게 피드백을 제공하는 방법과, Service Worker 라이프사이클을 제어하는 방법을 공유합니다.

## 목차
1. [문제 상황](#문제-상황)
2. [Service Worker 라이프사이클 이해](#service-worker-라이프사이클-이해)
3. [해결 방법: 업데이트 오버레이](#해결-방법-업데이트-오버레이)
4. [구현 상세](#구현-상세)

---

## 문제 상황

### 증상

PWA 앱을 업데이트하면 새 버전의 Service Worker가 **즉시 활성화**되어, 사용자에게 업데이트가 진행 중임을 알릴 시간이 없었습니다.

```
사용자 경험:
1. 앱을 열다
2. 갑자기 페이지가 새로고침됨 (뭔가 업데이트된 것 같은데...)
3. 무슨 일이 일어났는지 모름
```

**원하는 경험:**
```
1. 앱을 열다
2. "앱 업데이트 중..." 오버레이 표시
3. 업데이트 완료 후 새 버전 로드
4. 사용자가 업데이트를 인지함
```

### 원인 분석

문제가 된 Service Worker 코드:

```javascript
// sw.js (문제 코드)
self.addEventListener('install', (event) => {
    // 🚨 즉시 skipWaiting 호출
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        clients.claim()  // 모든 클라이언트 즉시 제어
    );
});
```

**문제:** `skipWaiting()`이 `install` 이벤트에서 즉시 호출되면:
1. 새 SW 설치 완료
2. 바로 `skipWaiting()` 실행
3. 기존 SW 중단, 새 SW 활성화
4. `clients.claim()`으로 페이지 제어권 획득
5. 페이지 새로고침

→ 프론트엔드에서 오버레이를 표시할 시간이 없음

---

## Service Worker 라이프사이클 이해

### 정상적인 라이프사이클

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Installing │────▶│   Waiting   │────▶│   Active    │
└─────────────┘     └─────────────┘     └─────────────┘
       │                   │                   │
       │                   │                   │
   새 SW 다운로드      기존 SW가           새 SW가
   및 설치            활성 상태면          페이지 제어
                      대기
```

### skipWaiting 없이

```
시나리오: 사용자가 앱을 사용 중일 때 새 버전 배포

1. 새 SW 설치됨 → 'waiting' 상태
2. 기존 SW가 여전히 활성
3. 사용자가 모든 탭을 닫음
4. 다시 앱을 열면 새 SW 활성화

문제: 사용자가 오래된 버전을 계속 사용할 수 있음
```

### skipWaiting 사용 시

```
1. 새 SW 설치됨
2. skipWaiting() 호출
3. 새 SW가 즉시 활성화 (기존 SW 중단)
4. clients.claim()으로 기존 페이지 제어

장점: 사용자가 항상 최신 버전 사용
단점: 갑작스러운 업데이트로 UX 저하
```

---

## 해결 방법: 업데이트 오버레이

### 전략

1. SW의 `install` 이벤트에서 `skipWaiting()` 즉시 호출하지 않음
2. 프론트엔드에서 새 SW 감지 시 오버레이 표시
3. 오버레이 표시 후 SW에게 `skipWaiting` 메시지 전송
4. SW가 메시지 받고 `skipWaiting()` 호출
5. 페이지 새로고침

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Frontend  │     │   Old SW    │     │   New SW    │
└─────────────┘     └─────────────┘     └─────────────┘
       │                   │                   │
       │    1. 새 SW 감지   │                   │
       │◀──────────────────┼───────────────────│
       │                   │                   │
       │  2. 오버레이 표시  │                   │
       │                   │                   │
       │  3. 딜레이 (1초)   │                   │
       │                   │                   │
       │  4. SKIP_WAITING  │                   │
       │───────────────────┼──────────────────▶│
       │                   │                   │
       │                   │  5. skipWaiting() │
       │                   │◀──────────────────│
       │                   │                   │
       │  6. controllerchange                  │
       │◀──────────────────┼───────────────────│
       │                   │                   │
       │  7. 페이지 새로고침 │                   │
       │                   │                   │
```

---

## 구현 상세

### 1. Service Worker (sw.js)

```javascript
// frontend/public/sw.js

// 설치 시 skipWaiting 호출하지 않음
self.addEventListener('install', (event) => {
    console.log('[SW] Installing new version...');
    // skipWaiting()을 여기서 호출하지 않음!
    // 프론트엔드의 메시지를 기다림
});

// 활성화 시 클라이언트 제어
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating new version...');
    event.waitUntil(
        clients.claim()
    );
});

// 프론트엔드로부터 메시지 수신
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        console.log('[SW] Received SKIP_WAITING message');
        self.skipWaiting();
    }
});

// Fetch 이벤트 핸들러 (캐싱 전략)
self.addEventListener('fetch', (event) => {
    // Network-first 전략
    event.respondWith(
        fetch(event.request)
            .catch(() => caches.match(event.request))
    );
});
```

### 2. useServiceWorkerUpdate 훅

```typescript
// frontend/src/app/hooks/useServiceWorkerUpdate.ts
'use client';

import { useState, useEffect, useCallback } from 'react';

interface UseServiceWorkerUpdateReturn {
    isUpdateAvailable: boolean;
    isUpdating: boolean;
    triggerUpdate: () => Promise<void>;
}

export function useServiceWorkerUpdate(): UseServiceWorkerUpdateReturn {
    const [isUpdateAvailable, setIsUpdateAvailable] = useState(false);
    const [isUpdating, setIsUpdating] = useState(false);
    const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
    
    useEffect(() => {
        // SSR 환경 체크
        if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
            return;
        }
        
        const handleUpdate = async () => {
            const registration = await navigator.serviceWorker.ready;
            
            // 이미 대기 중인 SW가 있는지 확인
            if (registration.waiting) {
                setWaitingWorker(registration.waiting);
                setIsUpdateAvailable(true);
            }
            
            // 새 SW 설치 감지
            registration.addEventListener('updatefound', () => {
                const newWorker = registration.installing;
                
                if (!newWorker) return;
                
                newWorker.addEventListener('statechange', () => {
                    // 새 SW가 설치 완료되고 대기 상태가 되면
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        console.log('[Hook] New SW installed and waiting');
                        setWaitingWorker(newWorker);
                        setIsUpdateAvailable(true);
                    }
                });
            });
        };
        
        handleUpdate();
        
        // controllerchange 이벤트 - 새 SW가 활성화되면 페이지 새로고침
        const handleControllerChange = () => {
            console.log('[Hook] Controller changed, reloading...');
            window.location.reload();
        };
        
        navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);
        
        return () => {
            navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
        };
    }, []);
    
    // 업데이트 트리거 함수
    const triggerUpdate = useCallback(async () => {
        if (!waitingWorker) {
            console.warn('[Hook] No waiting worker to update');
            return;
        }
        
        console.log('[Hook] Triggering update...');
        setIsUpdating(true);
        
        // 1초 딜레이 - 오버레이가 표시될 시간 확보
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // SW에게 skipWaiting 메시지 전송
        waitingWorker.postMessage({ type: 'SKIP_WAITING' });
        
        // controllerchange 이벤트가 발생하면 자동으로 새로고침됨
    }, [waitingWorker]);
    
    return {
        isUpdateAvailable,
        isUpdating,
        triggerUpdate,
    };
}
```

### 3. 업데이트 오버레이 컴포넌트

```tsx
// frontend/src/app/(components)/ServiceWorkerUpdateOverlay.tsx
'use client';

import { useEffect } from 'react';
import { Box, CircularProgress, Typography, Fade } from '@mui/material';
import { useServiceWorkerUpdate } from '@/hooks/useServiceWorkerUpdate';

export function ServiceWorkerUpdateOverlay() {
    const { isUpdateAvailable, isUpdating, triggerUpdate } = useServiceWorkerUpdate();
    
    // 업데이트가 가능하면 자동으로 트리거
    useEffect(() => {
        if (isUpdateAvailable && !isUpdating) {
            triggerUpdate();
        }
    }, [isUpdateAvailable, isUpdating, triggerUpdate]);
    
    // 업데이트 중이 아니면 아무것도 렌더링하지 않음
    if (!isUpdating) {
        return null;
    }
    
    return (
        <Fade in={isUpdating}>
            <Box
                sx={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 9999,
                }}
            >
                <CircularProgress size={48} thickness={4} />
                <Typography
                    variant="h6"
                    sx={{ mt: 3, color: 'text.secondary' }}
                >
                    앱 업데이트 중...
                </Typography>
                <Typography
                    variant="body2"
                    sx={{ mt: 1, color: 'text.disabled' }}
                >
                    잠시만 기다려주세요
                </Typography>
            </Box>
        </Fade>
    );
}
```

### 4. 루트 레이아웃에 적용

```tsx
// frontend/src/app/layout.tsx
import { ServiceWorkerUpdateOverlay } from '@/components/ServiceWorkerUpdateOverlay';

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="ko">
            <body>
                <ServiceWorkerUpdateOverlay />
                {children}
            </body>
        </html>
    );
}
```

---

## 추가 고려사항

### 수동 업데이트 확인 트리거

사용자가 직접 업데이트를 확인할 수 있도록:

```typescript
// 설정 페이지 등에서
const checkForUpdate = async () => {
    const registration = await navigator.serviceWorker.ready;
    await registration.update();  // 수동으로 업데이트 확인
};
```

### 업데이트 알림 (자동 업데이트 대신)

즉시 업데이트 대신 사용자에게 선택권 제공:

```tsx
function UpdatePrompt() {
    const { isUpdateAvailable, triggerUpdate } = useServiceWorkerUpdate();
    
    if (!isUpdateAvailable) return null;
    
    return (
        <Snackbar open={true}>
            <Alert
                severity="info"
                action={
                    <Button color="inherit" onClick={triggerUpdate}>
                        업데이트
                    </Button>
                }
            >
                새 버전이 있습니다!
            </Alert>
        </Snackbar>
    );
}
```

### 캐시 버전 관리

```javascript
// sw.js
const CACHE_VERSION = 'v2';  // 버전 변경 시 캐시 갱신

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames
                    .filter(name => name !== CACHE_VERSION)
                    .map(name => caches.delete(name))
            );
        })
    );
});
```

---

## 결과

### Before (즉시 skipWaiting)

```
1. 앱 열기
2. 갑자기 새로고침 (0.1초)
3. 사용자 혼란
```

### After (딜레이 + 오버레이)

```
1. 앱 열기
2. "앱 업데이트 중..." 오버레이 표시 (1초)
3. 새로고침
4. 사용자가 업데이트 인지
```

---

## 정리: PWA 업데이트 체크리스트

### Service Worker
- [ ] `install` 이벤트에서 즉시 `skipWaiting()` 호출하지 않기
- [ ] `message` 이벤트에서 `SKIP_WAITING` 메시지 처리
- [ ] 캐시 버전 관리

### Frontend
- [ ] `useServiceWorkerUpdate` 훅으로 SW 상태 감지
- [ ] 업데이트 오버레이/알림 UI 구현
- [ ] `controllerchange` 이벤트로 새로고침 처리
- [ ] 적절한 딜레이로 오버레이 표시 시간 확보

### UX 고려사항
- [ ] 사용자에게 업데이트 진행 상황 알림
- [ ] 중요한 작업 중 업데이트 방지 (선택적)
- [ ] 오프라인 지원 시 캐시 전략 검토

---

## 참고 자료

- [Service Worker Lifecycle](https://web.dev/service-worker-lifecycle/)
- [The Service Worker Lifecycle](https://developers.google.com/web/fundamentals/primers/service-workers/lifecycle)
- [Workbox - Skip Waiting](https://developers.google.com/web/tools/workbox/modules/workbox-core#skip_waiting_and_clients_claim)
- [PWA Update Strategies](https://redfin.engineering/how-to-fix-the-refresh-button-when-using-service-workers-a8e27af6df68)
