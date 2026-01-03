---
name: mobile-generator
description: |
  Expo Router + React Native 모바일 앱 생성/수정 스킬. expo-secure-store 보안 저장소 + EAS 빌드 설정을 적용합니다.
  
  트리거: "모바일 앱 만들어줘", "Expo 앱 만들어줘", "앱만 개발해줘", "모바일 수정해줘", "RN 앱 만들어줘"
  
  전체 풀스택 프로젝트가 필요하면 fullstack-orchestrator 스킬을 사용하세요.
---

# Mobile Generator

Expo Router + React Native 기반 모바일 앱을 생성하거나 수정합니다.

## 필수 제약 사항

```
❌ React Navigation 단독 사용 불가 (Expo Router 사용)
❌ AsyncStorage에 민감 정보 저장 불가
❌ 순수 React Native CLI 불가 (Expo 필수)
✅ Expo Router + expo-secure-store 필수
```

> 보안 토큰은 반드시 `expo-secure-store` 사용

---

## 워크플로우

### Step 0: 작업 유형 확인 (필수)

```markdown
## 🎯 모바일 작업 유형

어떤 작업을 도와드릴까요? (번호로 선택)

| # | 유형 | 설명 |
|:-:|------|------|
| 1 | **🆕 신규 생성** | 새 모바일 앱 생성 |
| 2 | **🔧 기존 수정** | 기존 앱 수정/확장 |
```

### [기존 수정 선택 시] 추가 질문:

```markdown
1. **프로젝트 경로**: ___
2. **현재 네비게이션**: 1) Expo Router 2) React Navigation 3) 모르겠음
3. **수정 범위**: 1) 새 스크린 2) 인증 플로우 3) API 연동 4) 상태 관리 5) 푸시 알림
4. **코드 분석 필요**: 1) 네 2) 아니요
```

### Step 1: 요구사항 확인

```markdown
## 모바일 앱 요구사항

1. **앱 설명**: 어떤 앱인가요?
2. **주요 화면**: (예: 로그인, 홈, 프로필)
3. **인증 방식**: 1) 이메일/비밀번호 2) OAuth 3) 생체 인증 4) 인증 불필요
4. **네비게이션 유형**: 1) 탭 2) 스택 3) 드로어 4) 혼합
5. **추가 기능**: 1) 푸시 알림 2) 카메라 3) 위치 4) 오프라인 5) 딥링크
6. **빌드 타겟**: 1) iOS + Android 2) iOS only 3) Android only
```

---

## 아키텍처

**Expo Router 구조:**

```
apps/mobile/
├── app/                    # Expo Router 페이지
│   ├── _layout.tsx         # Root 레이아웃
│   ├── index.tsx           # 홈 화면
│   ├── (auth)/             # 인증 그룹
│   │   ├── _layout.tsx
│   │   ├── login.tsx
│   │   └── register.tsx
│   ├── (tabs)/             # 탭 네비게이션
│   │   ├── _layout.tsx
│   │   ├── home.tsx
│   │   └── profile.tsx
│   └── [id].tsx            # 동적 라우트
├── components/             # 재사용 컴포넌트
├── hooks/                  # 커스텀 훅
├── lib/                    # 유틸리티
│   ├── api/               # API 클라이언트
│   ├── storage/           # 보안 저장소
│   └── auth/              # 인증 로직
├── stores/                 # Zustand 스토어
├── app.json               # Expo 설정
├── eas.json               # EAS 빌드 설정
└── package.json
```

---

## 참조 문서

| 문서 | 조건 | 경로 |
|------|------|------|
| Expo 가이드 | 항상 | `references/expo-guide.md` |

---

## 보안 저장소 패턴 (필수)

```typescript
// lib/storage/secure.ts
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'auth_token';
const REFRESH_TOKEN_KEY = 'refresh_token';

export const secureStorage = {
  async getToken(): Promise<string | null> {
    return SecureStore.getItemAsync(TOKEN_KEY);
  },
  
  async setToken(token: string): Promise<void> {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  },
  
  async removeToken(): Promise<void> {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  },
  
  async clearAll(): Promise<void> {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
  },
};
```

---

## 검증

```bash
# 타입 체크
pnpm exec tsc --noEmit

# 테스트 실행
pnpm test

# EAS 빌드 검증
eas build --platform all --profile preview --non-interactive
```

---

## structure.md 템플릿 (필수 생성)

```markdown
# Mobile Structure

> 생성일: {날짜}

## 기술 스택
- **Framework**: Expo (SDK 52+)
- **Router**: Expo Router
- **State**: TanStack Query + Zustand
- **Storage**: expo-secure-store

## 스크린 구조
| 경로 | 설명 | 인증 |
|------|------|:----:|
| / | 홈 | - |
| /login | 로그인 | - |
| /(tabs)/home | 메인 탭 | ✓ |

## 네비게이션
- (auth): 인증 플로우 (스택)
- (tabs): 메인 앱 (하단 탭)
```

---

## 금지 사항

- ❌ AsyncStorage에 토큰/민감 정보 저장
- ❌ React Navigation 사용 (Expo Router 사용)
- ❌ 사용자 확인 없이 기존 코드 수정
- ❌ 하드코딩된 API URL

---

## 완료 체크리스트

### 신규 생성
- [ ] Expo Router 구조 생성
- [ ] 보안 저장소 구현 (expo-secure-store)
- [ ] 인증 플로우 구현 (필요 시)
- [ ] 기본 스크린 생성
- [ ] eas.json 설정
- [ ] 타입 체크 통과
- [ ] **structure.md 생성**

### 기존 수정
- [ ] 기존 구조 분석 완료
- [ ] 수정 범위 사용자 확인
- [ ] 코드 수정 완료
- [ ] 변경 사항 문서화
