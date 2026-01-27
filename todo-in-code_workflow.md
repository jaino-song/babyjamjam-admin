# TODO-in-Code Method

> Reddit r/ClaudeAI 포스트 기반 핵심 요약

## 문제

```
.md 파일로 보고서/계획 저장
    ↓
코드와 동기화 안 됨
    ↓
"이거 아직 유효한가?" 계속 확인해야 함
    ↓
인지적 부채 → 불안
```

## 해결책

**TODO를 코드 파일 안에 직접 삽입**

## 효과

| Before | After |
|--------|-------|
| 보고서 따로, 코드 따로 | 코드 = 진실의 원천 |
| 뭐가 남았는지 기억해야 함 | `grep TODO` 하면 끝 |
| 대규모 계획 → Claude가 건너뜀 | 작은 범위 TODO → 하나씩 처리 |
| 문서 동기화 부담 | 구현하면 TODO 삭제, 자동 동기화 |

## 좋은 TODO 예시

```typescript
// ❌ 모호함
// TODO: 결제 기능 추가

// ✅ 명시적, 범위 한정
// TODO(P1): processPayment 구현
//   - Stripe API 연동
//   - 에러 핸들링
//   - 멱등성 키 적용
```

## 핵심 원칙

1. **코드가 유일한 진실의 원천** - 외부 .md 파일에 TODO 관리 금지
2. **명시적이고 범위 한정된 TODO** - 모호한 TODO는 건너뛰기 쉬움
3. **해당 컨텍스트에 위치** - TODO는 관련 코드 바로 옆에
4. **완료되면 삭제** - 자동으로 동기화됨

## 한 줄 요약

> **코드가 유일한 진실의 원천이 되게 하라. 외부 문서 대신 TODO를 코드 안에.**

---

*Source: [Reddit r/ClaudeAI](https://www.reddit.com/r/ClaudeAI/comments/1q85tlf/i_feel_like_ive_just_had_a_breakthrough_with_how/)*