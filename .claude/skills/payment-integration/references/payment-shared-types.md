# Payment Shared Types

결제 시스템에서 사용하는 공통 타입과 인터페이스 정의입니다.

---

## 🏗️ Domain Layer

### Entity

```typescript
// src/payment/domain/entities/payment.entity.ts
export class Payment {
  readonly id: string;
  readonly orderId: string;
  readonly userId: string;
  readonly amount: number;
  readonly currency: Currency;
  readonly status: PaymentStatus;
  readonly provider: PaymentProvider;
  readonly providerPaymentId: string; // paymentKey, paymentIntentId 등
  readonly metadata: Record<string, string>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly paidAt: Date | null;
  readonly canceledAt: Date | null;
  readonly failureReason: string | null;

  constructor(props: PaymentProps) {
    Object.assign(this, props);
  }

  isPending(): boolean {
    return ['pending', 'processing', 'requires_action'].includes(this.status);
  }

  isSucceeded(): boolean {
    return this.status === 'succeeded';
  }

  isCanceled(): boolean {
    return this.status === 'canceled';
  }

  canCancel(): boolean {
    return this.isSucceeded() && !this.canceledAt;
  }
}

interface PaymentProps {
  id: string;
  orderId: string;
  userId: string;
  amount: number;
  currency: Currency;
  status: PaymentStatus;
  provider: PaymentProvider;
  providerPaymentId: string;
  metadata?: Record<string, string>;
  createdAt?: Date;
  updatedAt?: Date;
  paidAt?: Date | null;
  canceledAt?: Date | null;
  failureReason?: string | null;
}
```

### Value Objects

```typescript
// src/payment/domain/value-objects/money.vo.ts
export class Money {
  constructor(
    readonly amount: number,
    readonly currency: Currency,
  ) {
    if (amount < 0) {
      throw new Error('Amount cannot be negative');
    }
  }

  add(other: Money): Money {
    if (this.currency !== other.currency) {
      throw new Error('Cannot add different currencies');
    }
    return new Money(this.amount + other.amount, this.currency);
  }

  subtract(other: Money): Money {
    if (this.currency !== other.currency) {
      throw new Error('Cannot subtract different currencies');
    }
    return new Money(this.amount - other.amount, this.currency);
  }

  multiply(factor: number): Money {
    return new Money(Math.round(this.amount * factor), this.currency);
  }

  equals(other: Money): boolean {
    return this.amount === other.amount && this.currency === other.currency;
  }

  toMinorUnits(): number {
    // KRW는 소수점 없음, USD는 센트 단위
    if (this.currency === 'KRW') {
      return this.amount;
    }
    return Math.round(this.amount * 100);
  }

  static fromMinorUnits(amount: number, currency: Currency): Money {
    if (currency === 'KRW') {
      return new Money(amount, currency);
    }
    return new Money(amount / 100, currency);
  }

  format(): string {
    return new Intl.NumberFormat('ko-KR', {
      style: 'currency',
      currency: this.currency,
    }).format(this.amount);
  }
}
```

```typescript
// src/payment/domain/value-objects/payment-method.vo.ts
export class PaymentMethod {
  constructor(
    readonly type: PaymentMethodType,
    readonly details: PaymentMethodDetails,
  ) {}

  isCard(): boolean {
    return this.type === 'card';
  }

  isBankTransfer(): boolean {
    return this.type === 'bank_transfer';
  }

  isVirtualAccount(): boolean {
    return this.type === 'virtual_account';
  }

  getMaskedNumber(): string | null {
    if (this.details.cardNumber) {
      return `****-****-****-${this.details.cardNumber.slice(-4)}`;
    }
    return null;
  }
}

interface PaymentMethodDetails {
  cardNumber?: string;
  cardBrand?: CardBrand;
  bankCode?: string;
  accountNumber?: string;
  expiryMonth?: number;
  expiryYear?: number;
}
```

### Enums & Types

```typescript
// src/payment/domain/types/payment.types.ts

// 결제 상태
export type PaymentStatus =
  | 'pending'           // 결제 대기
  | 'processing'        // 처리 중
  | 'requires_action'   // 추가 인증 필요 (3DS 등)
  | 'awaiting_deposit'  // 입금 대기 (가상계좌)
  | 'succeeded'         // 결제 성공
  | 'failed'            // 결제 실패
  | 'canceled'          // 결제 취소
  | 'refunded'          // 전액 환불
  | 'partially_refunded' // 부분 환불
  | 'expired'           // 만료
  | 'unknown';

// 통화
export type Currency = 'KRW' | 'USD' | 'JPY' | 'EUR';

// 결제 제공자
export type PaymentProvider = 
  | 'stripe'
  | 'toss_payments'
  | 'apple_iap'
  | 'google_play';

// 결제 수단 타입
export type PaymentMethodType =
  | 'card'
  | 'bank_transfer'
  | 'virtual_account'
  | 'easy_pay'
  | 'mobile'
  | 'iap';

// 카드 브랜드
export type CardBrand =
  | 'visa'
  | 'mastercard'
  | 'amex'
  | 'jcb'
  | 'unionpay'
  | 'diners'
  | 'discover'
  | 'bc'
  | 'shinhan'
  | 'samsung'
  | 'hyundai'
  | 'lotte'
  | 'kb'
  | 'hana'
  | 'woori'
  | 'nh'
  | 'citi';

// 간편결제 타입
export type EasyPayType =
  | 'toss_pay'
  | 'kakao_pay'
  | 'naver_pay'
  | 'samsung_pay'
  | 'payco'
  | 'apple_pay'
  | 'google_pay';
```

---

## 📝 Port Interfaces

### Payment Gateway Port

```typescript
// src/payment/domain/ports/payment-gateway.port.ts
export interface PaymentGatewayPort {
  // 결제 생성
  createPaymentIntent(params: CreatePaymentIntentParams): Promise<PaymentIntent>;
  
  // 결제 확인/승인
  confirmPayment(params: ConfirmPaymentParams): Promise<PaymentResult>;
  
  // 결제 조회
  getPayment(paymentId: string): Promise<PaymentResult>;
  
  // 결제 취소/환불
  cancelPayment(params: CancelPaymentParams): Promise<PaymentResult>;
  
  // 부분 환불
  refundPayment(params: RefundPaymentParams): Promise<RefundResult>;
  
  // Webhook 검증
  verifyWebhook(payload: string, signature: string): WebhookEvent;
}

// 결제 의도 생성 파라미터
export interface CreatePaymentIntentParams {
  amount: number;
  currency: Currency;
  orderId: string;
  orderName: string;
  customerId?: string;
  customerEmail?: string;
  metadata?: Record<string, string>;
  idempotencyKey: string;
}

// 결제 의도 응답
export interface PaymentIntent {
  id: string;
  clientSecret: string;
  amount: number;
  currency: Currency;
  status: PaymentStatus;
}

// 결제 확인 파라미터
export interface ConfirmPaymentParams {
  paymentKey?: string;        // TossPayments
  paymentIntentId?: string;   // Stripe
  orderId: string;
  amount: number;
}

// 결제 결과
export interface PaymentResult {
  id: string;
  orderId: string;
  orderName?: string;
  status: PaymentStatus;
  amount: number;
  currency: Currency;
  method?: PaymentMethodType;
  provider: PaymentProvider;
  paidAt?: Date | null;
  receipt?: string;
  failure?: {
    code: string;
    message: string;
  };
}

// 취소 파라미터
export interface CancelPaymentParams {
  paymentId: string;
  reason: string;
  amount?: number; // 부분 취소 시
  idempotencyKey: string;
}

// 환불 파라미터
export interface RefundPaymentParams {
  paymentId: string;
  amount: number;
  reason: string;
  idempotencyKey: string;
}

// 환불 결과
export interface RefundResult {
  id: string;
  paymentId: string;
  amount: number;
  status: 'pending' | 'succeeded' | 'failed';
  reason: string;
}

// Webhook 이벤트
export interface WebhookEvent {
  id: string;
  type: WebhookEventType;
  data: Record<string, any>;
  createdAt: Date;
}

export type WebhookEventType =
  | 'payment.succeeded'
  | 'payment.failed'
  | 'payment.canceled'
  | 'payment.refunded'
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.canceled'
  | 'invoice.paid'
  | 'invoice.payment_failed';
```

### Subscription Gateway Port

```typescript
// src/payment/domain/ports/subscription-gateway.port.ts
export interface SubscriptionGatewayPort {
  // 구독 생성
  createSubscription(params: CreateSubscriptionParams): Promise<Subscription>;
  
  // 구독 조회
  getSubscription(subscriptionId: string): Promise<Subscription>;
  
  // 구독 업데이트 (플랜 변경 등)
  updateSubscription(params: UpdateSubscriptionParams): Promise<Subscription>;
  
  // 구독 취소
  cancelSubscription(subscriptionId: string, cancelAtPeriodEnd?: boolean): Promise<Subscription>;
  
  // 구독 재활성화
  resumeSubscription(subscriptionId: string): Promise<Subscription>;
  
  // Checkout Session 생성 (Stripe)
  createCheckoutSession(params: CreateCheckoutSessionParams): Promise<CheckoutSession>;
}

export interface CreateSubscriptionParams {
  customerId: string;
  priceId: string;
  trialDays?: number;
  metadata?: Record<string, string>;
}

export interface Subscription {
  id: string;
  customerId: string;
  priceId: string;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  trialEnd?: Date | null;
}

export type SubscriptionStatus =
  | 'active'
  | 'past_due'
  | 'unpaid'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'trialing'
  | 'paused';

export interface CreateCheckoutSessionParams {
  customerId?: string;
  customerEmail?: string;
  priceId: string;
  mode: 'subscription' | 'payment';
  successUrl: string;
  cancelUrl: string;
  trialDays?: number;
  metadata?: Record<string, string>;
}

export interface CheckoutSession {
  id: string;
  url: string;
}
```

### Repository Port

```typescript
// src/payment/domain/ports/payment-repository.port.ts
export interface PaymentRepositoryPort {
  save(payment: Payment): Promise<Payment>;
  findById(id: string): Promise<Payment | null>;
  findByOrderId(orderId: string): Promise<Payment | null>;
  findByProviderPaymentId(providerPaymentId: string): Promise<Payment | null>;
  findByUserId(userId: string, options?: FindPaymentsOptions): Promise<Payment[]>;
  update(id: string, data: Partial<PaymentUpdateData>): Promise<Payment>;
  
  // Idempotency
  isEventProcessed(eventId: string): Promise<boolean>;
  markEventProcessed(eventId: string): Promise<void>;
}

export interface FindPaymentsOptions {
  limit?: number;
  offset?: number;
  status?: PaymentStatus[];
  startDate?: Date;
  endDate?: Date;
}

export interface PaymentUpdateData {
  status: PaymentStatus;
  paidAt?: Date;
  canceledAt?: Date;
  failureReason?: string;
  providerPaymentId?: string;
}
```

---

## 📋 DTO Definitions

### Request DTOs

```typescript
// src/payment/application/dto/create-payment.dto.ts
import { z } from 'zod';

export const createPaymentSchema = z.object({
  orderId: z.string().min(1),
  amount: z.number().positive(),
  currency: z.enum(['KRW', 'USD']).default('KRW'),
  customerEmail: z.string().email().optional(),
  metadata: z.record(z.string()).optional(),
});

export type CreatePaymentDto = z.infer<typeof createPaymentSchema>;
```

```typescript
// src/payment/application/dto/confirm-payment.dto.ts
import { z } from 'zod';

export const confirmPaymentSchema = z.object({
  paymentKey: z.string().optional(),      // TossPayments
  paymentIntentId: z.string().optional(), // Stripe
  orderId: z.string().min(1),
  amount: z.number().positive(),
}).refine(
  (data) => data.paymentKey || data.paymentIntentId,
  { message: 'Either paymentKey or paymentIntentId is required' }
);

export type ConfirmPaymentDto = z.infer<typeof confirmPaymentSchema>;
```

```typescript
// src/payment/application/dto/cancel-payment.dto.ts
import { z } from 'zod';

export const cancelPaymentSchema = z.object({
  paymentId: z.string().min(1),
  reason: z.string().min(1).max(200),
  amount: z.number().positive().optional(), // 부분 취소 시
});

export type CancelPaymentDto = z.infer<typeof cancelPaymentSchema>;
```

### Response DTOs

```typescript
// src/payment/application/dto/payment-response.dto.ts
export interface PaymentResponseDto {
  id: string;
  orderId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  method?: string;
  paidAt?: string;
  receipt?: string;
}

export function toPaymentResponse(payment: Payment): PaymentResponseDto {
  return {
    id: payment.id,
    orderId: payment.orderId,
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status,
    method: payment.method,
    paidAt: payment.paidAt?.toISOString(),
    receipt: payment.receipt,
  };
}
```

---

## 🗃️ Prisma Schema

```prisma
// prisma/schema.prisma

model Payment {
  id                String         @id @default(cuid())
  orderId           String         @unique
  userId            String
  amount            Int
  currency          String         @default("KRW")
  status            PaymentStatus  @default(PENDING)
  provider          PaymentProvider
  providerPaymentId String?        @unique
  method            String?
  metadata          Json?
  receipt           String?
  failureReason     String?
  
  paidAt            DateTime?
  canceledAt        DateTime?
  createdAt         DateTime       @default(now())
  updatedAt         DateTime       @updatedAt

  order             Order          @relation(fields: [orderId], references: [id])
  user              User           @relation(fields: [userId], references: [id])
  refunds           Refund[]

  @@index([userId])
  @@index([status])
  @@index([createdAt])
}

model Refund {
  id          String       @id @default(cuid())
  paymentId   String
  amount      Int
  reason      String
  status      RefundStatus @default(PENDING)
  
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt

  payment     Payment      @relation(fields: [paymentId], references: [id])

  @@index([paymentId])
}

model ProcessedEvent {
  id          String   @id
  processedAt DateTime @default(now())

  @@index([processedAt])
}

model Subscription {
  id                  String             @id @default(cuid())
  userId              String
  provider            PaymentProvider
  providerSubId       String             @unique
  priceId             String
  status              SubscriptionStatus @default(ACTIVE)
  currentPeriodStart  DateTime
  currentPeriodEnd    DateTime
  cancelAtPeriodEnd   Boolean            @default(false)
  trialEnd            DateTime?
  
  createdAt           DateTime           @default(now())
  updatedAt           DateTime           @updatedAt

  user                User               @relation(fields: [userId], references: [id])

  @@index([userId])
  @@index([status])
}

enum PaymentStatus {
  PENDING
  PROCESSING
  REQUIRES_ACTION
  AWAITING_DEPOSIT
  SUCCEEDED
  FAILED
  CANCELED
  REFUNDED
  PARTIALLY_REFUNDED
  EXPIRED
}

enum PaymentProvider {
  STRIPE
  TOSS_PAYMENTS
  APPLE_IAP
  GOOGLE_PLAY
}

enum RefundStatus {
  PENDING
  SUCCEEDED
  FAILED
}

enum SubscriptionStatus {
  ACTIVE
  PAST_DUE
  UNPAID
  CANCELED
  INCOMPLETE
  TRIALING
  PAUSED
}
```

---

## 🛡️ Error Types

```typescript
// src/payment/domain/errors/payment.errors.ts
export class PaymentError extends Error {
  constructor(
    message: string,
    public readonly code: PaymentErrorCode,
    public readonly details?: Record<string, any>,
  ) {
    super(message);
    this.name = 'PaymentError';
  }
}

export type PaymentErrorCode =
  | 'PAYMENT_NOT_FOUND'
  | 'PAYMENT_ALREADY_PROCESSED'
  | 'PAYMENT_AMOUNT_MISMATCH'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_CANCELED'
  | 'INVALID_PAYMENT_STATUS'
  | 'REFUND_AMOUNT_EXCEEDED'
  | 'WEBHOOK_SIGNATURE_INVALID'
  | 'PROVIDER_ERROR'
  | 'IDEMPOTENCY_KEY_CONFLICT';

export class PaymentNotFoundError extends PaymentError {
  constructor(paymentId: string) {
    super(`Payment not found: ${paymentId}`, 'PAYMENT_NOT_FOUND');
  }
}

export class PaymentAmountMismatchError extends PaymentError {
  constructor(expected: number, received: number) {
    super(
      `Amount mismatch: expected ${expected}, received ${received}`,
      'PAYMENT_AMOUNT_MISMATCH',
      { expected, received },
    );
  }
}

export class WebhookSignatureInvalidError extends PaymentError {
  constructor() {
    super('Invalid webhook signature', 'WEBHOOK_SIGNATURE_INVALID');
  }
}
```

---

## 🎯 Domain Events

```typescript
// src/payment/domain/events/payment.events.ts
export abstract class PaymentDomainEvent {
  readonly occurredAt: Date = new Date();
  
  constructor(
    public readonly aggregateId: string,
    public readonly aggregateType: string = 'Payment',
  ) {}
}

export class PaymentCreatedEvent extends PaymentDomainEvent {
  constructor(
    paymentId: string,
    public readonly orderId: string,
    public readonly amount: number,
  ) {
    super(paymentId);
  }
}

export class PaymentSucceededEvent extends PaymentDomainEvent {
  constructor(
    paymentId: string,
    public readonly orderId: string,
    public readonly amount: number,
    public readonly paidAt: Date,
  ) {
    super(paymentId);
  }
}

export class PaymentFailedEvent extends PaymentDomainEvent {
  constructor(
    paymentId: string,
    public readonly orderId: string,
    public readonly reason: string,
  ) {
    super(paymentId);
  }
}

export class PaymentRefundedEvent extends PaymentDomainEvent {
  constructor(
    paymentId: string,
    public readonly refundId: string,
    public readonly amount: number,
    public readonly isPartial: boolean,
  ) {
    super(paymentId);
  }
}
```

---

*v1.0.0 | 2025-01-03*
