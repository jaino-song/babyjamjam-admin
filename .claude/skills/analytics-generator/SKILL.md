---
name: analytics-generator
description: |
  PostHog 분석 통합 스킬. Feature Flags, Session Recording, A/B Testing을 구현합니다.
  
  트리거: "분석 추가해줘", "PostHog 연동해줘", "Analytics 설정해줘", "Feature Flag 만들어줘", "A/B 테스트 설정해줘", "채널톡 연동해줘"
  
  이 스킬은 기존 프로젝트에 Analytics를 추가하는 용도입니다.
---

# Analytics Generator

PostHog 분석 통합을 기존 프로젝트에 추가합니다.

## 필수 제약 사항

```
✅ PostHog Cloud 또는 Self-hosted 계정
✅ 기존 Next.js/NestJS 프로젝트
✅ PII 보호 정책 준수
❌ 클라이언트에서 API Key 직접 노출 금지
```

---

## 워크플로우

### Step 0: 작업 유형 확인 (필수)

```markdown
## 🎯 Analytics 작업 유형

어떤 작업을 도와드릴까요? (번호로 선택)

| # | 유형 | 설명 |
|:-:|------|------|
| 1 | **🆕 신규 설정** | PostHog 초기 설정 |
| 2 | **📊 Feature Flag** | Feature Flag 추가 |
| 3 | **🎬 Session Recording** | 세션 녹화 설정 |
| 4 | **🧪 A/B Testing** | A/B 테스트 설정 |
| 5 | **📈 Custom Events** | 커스텀 이벤트 추가 |
| 6 | **💬 Channel Talk** | 채널톡 연동 |
```

### Step 1: 요구사항 확인

```markdown
## Analytics 요구사항

1. **PostHog 환경**: 1) PostHog Cloud 2) Self-hosted
2. **프로젝트 유형**: 1) Web 2) 풀스택 3) Web + Mobile 4) 모든 플랫폼
3. **필요 기능**: 1) 페이지뷰 2) 사용자 식별 3) 커스텀 이벤트 4) Feature Flags 5) Session Recording 6) A/B Testing
4. **개인정보 보호**: 1) GDPR 2) PIPA (한국) 3) 옵트아웃 UI
```

---

## 아키텍처

**패키지 구조:**

```
packages/
└── analytics/
    ├── src/
    │   ├── index.ts           # 메인 export
    │   ├── posthog.ts         # PostHog 클라이언트
    │   ├── events.ts          # 이벤트 정의
    │   ├── feature-flags.ts   # Feature Flags
    │   ├── identify.ts        # 사용자 식별
    │   └── privacy.ts         # PII 보호
    └── package.json

apps/
├── web/providers/analytics-provider.tsx
├── backend/src/modules/analytics/
└── mobile/providers/analytics-provider.tsx
```

---

## 참조 문서

| 문서 | 조건 | 경로 |
|------|------|------|
| PostHog 가이드 | 항상 | `references/posthog-guide.md` |
| 채널톡 가이드 | 채널톡 연동 시 | `references/channel-talk-guide.md` |

---

## 보안 규칙 (ANL 코드)

| 코드 | 규칙 | 설명 |
|------|------|------|
| ANL-001 | API Key 서버 전용 | Public Key만 클라이언트에서 사용 |
| ANL-002 | PII 해싱 | 이메일, 전화번호 등 해싱 필수 |
| ANL-003 | 세션 마스킹 | 입력 필드 마스킹 설정 |
| ANL-004 | 이벤트 검증 | 클라이언트 이벤트 서버 검증 |
| ANL-005 | Rate Limiting | 이벤트 전송 제한 |
| ANL-006 | 옵트아웃 | 사용자 옵트아웃 기능 제공 |

---

## 검증

```bash
# Validator 실행
python3 scripts/analytics-validator.py

# TypeScript 체크
cd packages/analytics && pnpm tsc --noEmit
```

---

## 금지 사항

- ❌ 클라이언트에서 Private API Key 사용
- ❌ PII 평문 전송 (이메일, 전화번호, 이름)
- ❌ 세션 녹화 시 입력 필드 마스킹 없이 사용
- ❌ 사용자 동의 없이 추적 시작
- ❌ 옵트아웃 기능 없이 배포

---

## 완료 체크리스트

### 신규 설정
- [ ] packages/analytics 생성
- [ ] PostHog Provider 설정
- [ ] PII 해싱 유틸 구현
- [ ] 옵트아웃 메커니즘 구현
- [ ] Feature Flags 설정 (필요 시)
- [ ] Session Recording 설정 (필요 시)

### 테스트
- [ ] 페이지뷰 트래킹 확인
- [ ] 사용자 식별 테스트
- [ ] 커스텀 이벤트 테스트
- [ ] 옵트아웃 동작 확인
