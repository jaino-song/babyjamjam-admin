---
name: payment-integration
description: |
  Stripe/TossPayments 결제 통합 스킬. 웹/모바일 결제, 구독(정기결제), 웹훅 처리를 구현합니다.
  
  트리거: "결제 붙여줘", "Stripe 연동해줘", "토스페이먼츠 추가해줘", "구독 결제 만들어줘", "정기결제 추가해줘"
  
  이 스킬은 기존 프로젝트에 결제 기능을 추가하는 용도입니다.
---

# Payment Integration

결제 시스템을 기존 프로젝트에 통합하는 스킬입니다.

## 보안 필수 사항

```
✅ 서버 사이드 금액 검증 필수
✅ Webhook 서명 검증 필수
✅ 민감 정보 암호화 필수
✅ idempotency key 사용 필수
❌ 클라이언트에서 금액 신뢰 금지
❌ Secret Key 노출 금지
❌ Webhook 서명 검증 생략 금지
```

---

## 워크플로우

### Step 0: 작업 유형 확인

```markdown
## 🎯 결제 작업 유형

어떤 작업을 도와드릴까요? (번호로 선택)

| # | 유형 | 설명 |
|:-:|------|------|
| 1 | **🆕 신규 추가** | 새 결제 시스템 구축 |
| 2 | **🔧 기존 수정** | 기존 결제 시스템 수정 |
```

### Step 1: 플랫폼/지역 확인

```markdown
## 💳 결제 환경 (각 항목 번호로 선택)

1. **타겟 지역**:
   1) 한국 (KR) → TossPayments 권장
   2) 글로벌 → Stripe 권장
   3) 둘 다

2. **플랫폼**:
   1) 웹만
   2) 모바일만 (IAP 포함)
   3) 웹 + 모바일

3. **결제 유형**:
   1) 단건 결제
   2) 구독 (Subscription)
   3) 둘 다
```

---

## 참조 문서

| 문서 | 조건 | 경로 |
|------|------|------|
| Stripe 가이드 | Stripe 선택 시 | `references/stripe-payments.md` |
| TossPayments 가이드 | Toss 선택 시 | `references/toss-payments.md` |
| 모바일 IAP | 모바일 선택 시 | `references/mobile-payments.md` |
| 공통 타입 | 항상 | `references/payment-shared-types.md` |
| 테스트 가이드 | 테스트 시 | `references/payment-testing.md` |
| 구독 가이드 | 구독/정기결제 시 | `references/subscription-guide.md` |

---

## 아키텍처

### Clean Architecture 결제 레이어

```
┌─────────────────────────────────────────────────┐
│                  Presentation                    │
│  (Controllers, Webhooks, Next.js API Routes)    │
├─────────────────────────────────────────────────┤
│                  Application                     │
│    (CreatePaymentUseCase, ProcessWebhook...)    │
├─────────────────────────────────────────────────┤
│                    Domain                        │
│  (Payment Entity, PaymentGatewayPort, Events)   │
├─────────────────────────────────────────────────┤
│                Infrastructure                    │
│  (StripeAdapter, TossPaymentsAdapter, Prisma)   │
└─────────────────────────────────────────────────┘
```

### Port & Adapter 패턴

```typescript
// domain/ports/payment-gateway.port.ts
export interface PaymentGatewayPort {
  createPaymentIntent(params: CreatePaymentParams): Promise<PaymentIntent>;
  confirmPayment(paymentIntentId: string): Promise<Payment>;
  cancelPayment(paymentId: string, reason?: string): Promise<Payment>;
  createSubscription(params: CreateSubscriptionParams): Promise<Subscription>;
  cancelSubscription(subscriptionId: string): Promise<void>;
  verifyWebhook(payload: string, signature: string): WebhookEvent;
}
```

---

## 보안 아키텍처

### 금액 검증 플로우

```
Client → Server → DB(주문정보) → 결제 게이트웨이
            ↓
    금액 일치 검증 (DB vs Client 요청)
            ↓
    불일치 시 → 결제 거부 + 로깅
```

### Webhook 검증 플로우

```
Webhook 요청 → 서명 검증 → 성공 → 이벤트 처리 + idempotency 체크
                    ↓
              실패 → 401 + 알림
```

### 민감 정보 처리

| 데이터 | 처리 방법 |
|--------|----------|
| 카드 번호 | 토큰화 (PG사 처리) |
| API Secret Key | 환경변수 (절대 노출 금지) |
| Webhook Secret | 환경변수 |
| 사용자 결제 정보 | 암호화 저장 |

---

## 검증

```bash
python scripts/payment-security-validator.py
```

---

## 환경변수 설정

### Stripe
```env
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_PUBLISHABLE_KEY=pk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
```

### TossPayments
```env
TOSS_PAYMENTS_CLIENT_KEY=test_ck_xxx
TOSS_PAYMENTS_SECRET_KEY=test_sk_xxx
TOSS_PAYMENTS_WEBHOOK_SECRET=xxx
```

---

## 금지 사항

- ❌ 클라이언트에서 전달받은 금액을 그대로 결제
- ❌ Secret Key를 환경변수 없이 하드코딩
- ❌ Webhook 서명 검증 생략
- ❌ 결제 실패 시 적절한 롤백 없이 진행
- ❌ 민감 정보를 로그에 평문으로 기록
- ❌ idempotency key 없이 결제 요청

---

## 완료 체크리스트

### Backend
- [ ] Payment 모듈 생성 (NestJS)
- [ ] PaymentGatewayPort 인터페이스 정의
- [ ] Stripe/Toss Adapter 구현
- [ ] Webhook Controller 구현
- [ ] 서명 검증 로직 구현
- [ ] 금액 재검증 로직 구현

### Frontend
- [ ] 결제 UI 구현 (Checkout/Widget)
- [ ] 결제 성공/실패 페이지
- [ ] 로딩 상태 처리

### Mobile (선택)
- [ ] Expo IAP 설정
- [ ] 영수증 검증 로직

### 공통
- [ ] 테스트 결제 성공
- [ ] Webhook 테스트 성공
- [ ] 보안 검증 통과
