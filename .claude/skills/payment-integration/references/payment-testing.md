# Payment Testing Guide

결제 시스템 테스트 가이드입니다.

---

## 🧪 테스트 전략

### 테스트 피라미드

```
         ┌─────────┐
         │  E2E    │  ← 결제 플로우 전체 (Playwright)
        ┌┴─────────┴┐
        │Integration │  ← API + Webhook (Supertest)
       ┌┴───────────┴┐
       │    Unit     │  ← Use Case, Domain Logic (Jest)
      └──────────────┘
```

### 테스트 범위

| 레이어 | 테스트 대상 | 도구 |
|--------|------------|------|
| Domain | Entity, Value Object, 비즈니스 로직 | Jest |
| Application | Use Case, 서비스 로직 | Jest + Mock |
| Infrastructure | Repository, Adapter | Jest + Test DB |
| Presentation | Controller, Webhook | Supertest |
| E2E | 결제 플로우 전체 | Playwright |

---

## 🔧 테스트 환경 설정

### Jest 설정

```typescript
// jest.config.ts
import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
};

export default config;
```

### 테스트 Setup

```typescript
// src/test/setup.ts
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

beforeAll(async () => {
  // 테스트 DB 연결
});

afterAll(async () => {
  await prisma.$disconnect();
});

// 각 테스트 전 DB 클리어
beforeEach(async () => {
  const tablenames = await prisma.$queryRaw<
    Array<{ tablename: string }>
  >`SELECT tablename FROM pg_tables WHERE schemaname='public'`;

  const tables = tablenames
    .map(({ tablename }) => tablename)
    .filter((name) => name !== '_prisma_migrations')
    .map((name) => `"public"."${name}"`)
    .join(', ');

  try {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables} CASCADE;`);
  } catch (error) {
    console.log({ error });
  }
});
```

---

## 🎯 Unit Tests

### Domain Entity 테스트

```typescript
// src/payment/domain/entities/__tests__/payment.entity.spec.ts
import { Payment } from '../payment.entity';

describe('Payment Entity', () => {
  const createPayment = (overrides = {}): Payment => {
    return new Payment({
      id: 'pay_123',
      orderId: 'order_123',
      userId: 'user_123',
      amount: 10000,
      currency: 'KRW',
      status: 'pending',
      provider: 'stripe',
      providerPaymentId: 'pi_123',
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      paidAt: null,
      canceledAt: null,
      failureReason: null,
      ...overrides,
    });
  };

  describe('isPending', () => {
    it('should return true when status is pending', () => {
      const payment = createPayment({ status: 'pending' });
      expect(payment.isPending()).toBe(true);
    });

    it('should return true when status is processing', () => {
      const payment = createPayment({ status: 'processing' });
      expect(payment.isPending()).toBe(true);
    });

    it('should return false when status is succeeded', () => {
      const payment = createPayment({ status: 'succeeded' });
      expect(payment.isPending()).toBe(false);
    });
  });

  describe('canCancel', () => {
    it('should return true when succeeded and not canceled', () => {
      const payment = createPayment({ 
        status: 'succeeded',
        paidAt: new Date(),
        canceledAt: null,
      });
      expect(payment.canCancel()).toBe(true);
    });

    it('should return false when already canceled', () => {
      const payment = createPayment({ 
        status: 'succeeded',
        canceledAt: new Date(),
      });
      expect(payment.canCancel()).toBe(false);
    });
  });
});
```

### Value Object 테스트

```typescript
// src/payment/domain/value-objects/__tests__/money.vo.spec.ts
import { Money } from '../money.vo';

describe('Money Value Object', () => {
  describe('constructor', () => {
    it('should create Money instance with valid amount', () => {
      const money = new Money(10000, 'KRW');
      expect(money.amount).toBe(10000);
      expect(money.currency).toBe('KRW');
    });

    it('should throw error for negative amount', () => {
      expect(() => new Money(-100, 'KRW')).toThrow('Amount cannot be negative');
    });
  });

  describe('add', () => {
    it('should add two Money instances with same currency', () => {
      const money1 = new Money(10000, 'KRW');
      const money2 = new Money(5000, 'KRW');
      const result = money1.add(money2);
      
      expect(result.amount).toBe(15000);
      expect(result.currency).toBe('KRW');
    });

    it('should throw error when adding different currencies', () => {
      const money1 = new Money(100, 'KRW');
      const money2 = new Money(50, 'USD');
      
      expect(() => money1.add(money2)).toThrow('Cannot add different currencies');
    });
  });

  describe('toMinorUnits', () => {
    it('should return same amount for KRW', () => {
      const money = new Money(10000, 'KRW');
      expect(money.toMinorUnits()).toBe(10000);
    });

    it('should convert to cents for USD', () => {
      const money = new Money(100, 'USD');
      expect(money.toMinorUnits()).toBe(10000);
    });
  });
});
```

### Use Case 테스트

```typescript
// src/payment/application/use-cases/__tests__/create-payment-intent.use-case.spec.ts
import { CreatePaymentIntentUseCase } from '../create-payment-intent.use-case';
import { PaymentGatewayPort } from '../../../domain/ports/payment-gateway.port';
import { OrderRepositoryPort } from '../../../domain/ports/order-repository.port';

describe('CreatePaymentIntentUseCase', () => {
  let useCase: CreatePaymentIntentUseCase;
  let mockPaymentGateway: jest.Mocked<PaymentGatewayPort>;
  let mockOrderRepository: jest.Mocked<OrderRepositoryPort>;

  beforeEach(() => {
    mockPaymentGateway = {
      createPaymentIntent: jest.fn(),
      confirmPayment: jest.fn(),
      cancelPayment: jest.fn(),
      getPayment: jest.fn(),
      verifyWebhook: jest.fn(),
    };

    mockOrderRepository = {
      findById: jest.fn(),
      update: jest.fn(),
      save: jest.fn(),
    };

    useCase = new CreatePaymentIntentUseCase(
      mockPaymentGateway,
      mockOrderRepository,
    );
  });

  describe('execute', () => {
    const dto = {
      orderId: 'order_123',
      userId: 'user_123',
    };

    const mockOrder = {
      id: 'order_123',
      userId: 'user_123',
      totalAmount: 10000,
      status: 'PENDING',
    };

    const mockPaymentIntent = {
      id: 'pi_123',
      clientSecret: 'pi_123_secret',
      amount: 10000,
      currency: 'KRW',
      status: 'requires_payment_method',
    };

    it('should create payment intent successfully', async () => {
      mockOrderRepository.findById.mockResolvedValue(mockOrder);
      mockPaymentGateway.createPaymentIntent.mockResolvedValue(mockPaymentIntent);
      mockOrderRepository.update.mockResolvedValue(mockOrder);

      const result = await useCase.execute(dto);

      expect(result.clientSecret).toBe('pi_123_secret');
      expect(result.paymentIntentId).toBe('pi_123');
      
      // 서버에서 조회한 금액으로 PaymentIntent 생성 확인
      expect(mockPaymentGateway.createPaymentIntent).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: mockOrder.totalAmount, // ⚠️ 서버 금액 사용
        }),
      );
    });

    it('should throw error when order not found', async () => {
      mockOrderRepository.findById.mockResolvedValue(null);

      await expect(useCase.execute(dto)).rejects.toThrow('Order not found');
    });

    it('should throw error when user is not authorized', async () => {
      mockOrderRepository.findById.mockResolvedValue({
        ...mockOrder,
        userId: 'different_user',
      });

      await expect(useCase.execute(dto)).rejects.toThrow('Unauthorized');
    });
  });
});
```

### Webhook 처리 테스트

```typescript
// src/payment/application/use-cases/__tests__/process-webhook.use-case.spec.ts
import { ProcessWebhookUseCase } from '../process-webhook.use-case';
import { EventEmitter2 } from '@nestjs/event-emitter';

describe('ProcessWebhookUseCase', () => {
  let useCase: ProcessWebhookUseCase;
  let mockOrderRepository: jest.Mocked<OrderRepositoryPort>;
  let mockEventEmitter: jest.Mocked<EventEmitter2>;

  beforeEach(() => {
    mockOrderRepository = {
      findById: jest.fn(),
      update: jest.fn(),
      isEventProcessed: jest.fn(),
      markEventProcessed: jest.fn(),
    };

    mockEventEmitter = {
      emit: jest.fn(),
    } as any;

    useCase = new ProcessWebhookUseCase(mockOrderRepository, mockEventEmitter);
  });

  describe('payment_intent.succeeded', () => {
    const event = {
      id: 'evt_123',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_123',
          metadata: { orderId: 'order_123' },
        },
      },
    };

    it('should update order status to PAID', async () => {
      mockOrderRepository.isEventProcessed.mockResolvedValue(false);

      await useCase.execute(event);

      expect(mockOrderRepository.update).toHaveBeenCalledWith(
        'order_123',
        expect.objectContaining({ status: 'PAID' }),
      );
    });

    it('should emit order.paid event', async () => {
      mockOrderRepository.isEventProcessed.mockResolvedValue(false);

      await useCase.execute(event);

      expect(mockEventEmitter.emit).toHaveBeenCalledWith(
        'order.paid',
        expect.objectContaining({ orderId: 'order_123' }),
      );
    });

    it('should skip if event already processed (idempotency)', async () => {
      mockOrderRepository.isEventProcessed.mockResolvedValue(true);

      await useCase.execute(event);

      expect(mockOrderRepository.update).not.toHaveBeenCalled();
    });
  });
});
```

---

## 🔌 Integration Tests

### Webhook Controller 테스트

```typescript
// src/payment/presentation/controllers/__tests__/stripe-webhook.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import Stripe from 'stripe';
import { AppModule } from '../../../../app.module';

describe('StripeWebhookController (Integration)', () => {
  let app: INestApplication;
  let stripe: Stripe;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET_TEST!;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // raw body parser 설정
    app.useGlobalPipes(/* ... */);
    await app.init();

    stripe = new Stripe(process.env.STRIPE_SECRET_KEY_TEST!);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /webhooks/stripe', () => {
    it('should return 200 for valid webhook', async () => {
      const payload = JSON.stringify({
        id: 'evt_test',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test',
            metadata: { orderId: 'order_123' },
          },
        },
      });

      const signature = stripe.webhooks.generateTestHeaderString({
        payload,
        secret: webhookSecret,
      });

      const response = await request(app.getHttpServer())
        .post('/webhooks/stripe')
        .set('stripe-signature', signature)
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ received: true });
    });

    it('should return 401 for invalid signature', async () => {
      const payload = JSON.stringify({
        id: 'evt_test',
        type: 'payment_intent.succeeded',
      });

      const response = await request(app.getHttpServer())
        .post('/webhooks/stripe')
        .set('stripe-signature', 'invalid_signature')
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(response.status).toBe(401);
    });
  });
});
```

### Payment API 테스트

```typescript
// src/payment/presentation/controllers/__tests__/payment.controller.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';

describe('PaymentController (Integration)', () => {
  let app: INestApplication;
  let accessToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    // 테스트용 인증 토큰 발급
    accessToken = await getTestAccessToken();
  });

  describe('POST /payments/create-intent', () => {
    it('should create payment intent for valid order', async () => {
      // 테스트 주문 생성
      const order = await createTestOrder({ amount: 10000 });

      const response = await request(app.getHttpServer())
        .post('/payments/create-intent')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ orderId: order.id });

      expect(response.status).toBe(201);
      expect(response.body).toHaveProperty('clientSecret');
      expect(response.body).toHaveProperty('paymentIntentId');
    });

    it('should reject if order not found', async () => {
      const response = await request(app.getHttpServer())
        .post('/payments/create-intent')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ orderId: 'non_existent_order' });

      expect(response.status).toBe(404);
    });

    it('should reject unauthorized request', async () => {
      const response = await request(app.getHttpServer())
        .post('/payments/create-intent')
        .send({ orderId: 'order_123' });

      expect(response.status).toBe(401);
    });
  });
});
```

---

## 🌐 E2E Tests (Playwright)

### 결제 플로우 E2E

```typescript
// e2e/payment.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Payment Flow', () => {
  test.beforeEach(async ({ page }) => {
    // 테스트 사용자 로그인
    await page.goto('/login');
    await page.fill('[name="email"]', 'test@example.com');
    await page.fill('[name="password"]', 'password123');
    await page.click('button[type="submit"]');
    await page.waitForURL('/dashboard');
  });

  test('should complete card payment successfully', async ({ page }) => {
    // 1. 상품 장바구니 추가
    await page.goto('/products/1');
    await page.click('button:text("장바구니에 추가")');

    // 2. 장바구니로 이동
    await page.goto('/cart');
    await page.click('button:text("결제하기")');

    // 3. 결제 페이지 확인
    await expect(page).toHaveURL(/\/checkout/);
    
    // 4. Stripe 결제 폼 입력 (테스트 카드)
    const stripeFrame = page.frameLocator('iframe[name*="__stripe"]').first();
    await stripeFrame.locator('[name="cardnumber"]').fill('4242424242424242');
    await stripeFrame.locator('[name="exp-date"]').fill('1230');
    await stripeFrame.locator('[name="cvc"]').fill('123');

    // 5. 결제 버튼 클릭
    await page.click('button:text("결제하기")');

    // 6. 성공 페이지 확인
    await expect(page).toHaveURL(/\/checkout\/success/);
    await expect(page.locator('text=결제가 완료되었습니다')).toBeVisible();
  });

  test('should handle payment failure gracefully', async ({ page }) => {
    await page.goto('/checkout/order_123');

    // 실패하는 테스트 카드 사용
    const stripeFrame = page.frameLocator('iframe[name*="__stripe"]').first();
    await stripeFrame.locator('[name="cardnumber"]').fill('4000000000000002');
    await stripeFrame.locator('[name="exp-date"]').fill('1230');
    await stripeFrame.locator('[name="cvc"]').fill('123');

    await page.click('button:text("결제하기")');

    // 에러 메시지 확인
    await expect(page.locator('text=카드가 거절되었습니다')).toBeVisible();
  });
});
```

### TossPayments E2E

```typescript
// e2e/toss-payment.spec.ts
import { test, expect } from '@playwright/test';

test.describe('TossPayments Flow', () => {
  test('should complete payment via TossPayments', async ({ page }) => {
    await page.goto('/checkout/order_123');

    // 결제 위젯 로딩 대기
    await page.waitForSelector('#payment-widget');
    
    // 카드 결제 선택
    await page.click('text=카드');
    
    // 결제 버튼 클릭
    await page.click('button:text("결제하기")');

    // TossPayments 결제창으로 이동 확인
    // (테스트 환경에서는 redirect URL로 mock)
    await page.waitForURL(/\/checkout\/success/);
  });
});
```

---

## 🧪 테스트 카드 번호

### Stripe

| 시나리오 | 카드 번호 | CVC | 만료일 |
|----------|----------|-----|--------|
| 성공 | 4242 4242 4242 4242 | 아무 3자리 | 미래 날짜 |
| 거절 | 4000 0000 0000 0002 | 아무 3자리 | 미래 날짜 |
| 잔액 부족 | 4000 0000 0000 9995 | 아무 3자리 | 미래 날짜 |
| 3DS 필요 | 4000 0025 0000 3155 | 아무 3자리 | 미래 날짜 |
| 만료된 카드 | 4000 0000 0000 0069 | 아무 3자리 | 미래 날짜 |
| CVC 오류 | 4000 0000 0000 0127 | 아무 3자리 | 미래 날짜 |

### TossPayments

| 시나리오 | 카드 번호 |
|----------|----------|
| 일반 승인 | 테스트 모드에서 자동 승인 |
| 결제 실패 | 특정 테스트 시나리오 설정 필요 |

---

## 🔧 Stripe CLI 테스트

```bash
# Webhook 로컬 테스트
stripe listen --forward-to localhost:3001/webhooks/stripe

# 특정 이벤트 트리거
stripe trigger payment_intent.succeeded
stripe trigger payment_intent.payment_failed
stripe trigger customer.subscription.created
stripe trigger invoice.payment_succeeded

# 커스텀 이벤트 데이터로 트리거
stripe trigger payment_intent.succeeded \
  --add payment_intent:metadata.orderId=order_123
```

---

## 📊 테스트 커버리지 목표

| 레이어 | 목표 커버리지 |
|--------|-------------|
| Domain | 90%+ |
| Application | 85%+ |
| Infrastructure | 70%+ |
| Presentation | 80%+ |
| E2E | Critical paths |

---

## ✅ 테스트 체크리스트

### Unit Tests
- [ ] Payment Entity 테스트
- [ ] Money Value Object 테스트
- [ ] CreatePaymentIntent Use Case 테스트
- [ ] ConfirmPayment Use Case 테스트
- [ ] ProcessWebhook Use Case 테스트
- [ ] Error handling 테스트

### Integration Tests
- [ ] Webhook 서명 검증 테스트
- [ ] Payment API 테스트
- [ ] Repository 테스트

### E2E Tests
- [ ] 결제 성공 플로우
- [ ] 결제 실패 플로우
- [ ] 결제 취소 플로우
- [ ] 구독 결제 플로우

---

*v1.0.0 | 2025-01-03*
