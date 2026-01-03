# Stripe Payments Integration Guide

Stripe를 사용한 글로벌 결제 통합 가이드입니다.

## 📦 패키지 설치

### Backend (NestJS)
```bash
npm install stripe
```

### Frontend (Next.js)
```bash
npm install @stripe/stripe-js @stripe/react-stripe-js
```

---

## 🏗️ Backend 구현 (NestJS)

### 1. Port 인터페이스 정의

```typescript
// src/payment/domain/ports/payment-gateway.port.ts
export interface CreatePaymentIntentParams {
  amount: number;
  currency: string;
  customerId?: string;
  metadata?: Record<string, string>;
  idempotencyKey: string;
}

export interface PaymentIntent {
  id: string;
  clientSecret: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
}

export type PaymentStatus = 
  | 'requires_payment_method'
  | 'requires_confirmation'
  | 'requires_action'
  | 'processing'
  | 'succeeded'
  | 'canceled';

export interface PaymentGatewayPort {
  createPaymentIntent(params: CreatePaymentIntentParams): Promise<PaymentIntent>;
  retrievePaymentIntent(paymentIntentId: string): Promise<PaymentIntent>;
  cancelPaymentIntent(paymentIntentId: string): Promise<PaymentIntent>;
  verifyWebhookSignature(payload: string, signature: string): Stripe.Event;
}
```

### 2. Stripe Adapter 구현

```typescript
// src/payment/infrastructure/adapters/stripe.adapter.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { PaymentGatewayPort, CreatePaymentIntentParams, PaymentIntent } from '../../domain/ports/payment-gateway.port';

@Injectable()
export class StripeAdapter implements PaymentGatewayPort {
  private readonly stripe: Stripe;
  private readonly webhookSecret: string;

  constructor(private readonly configService: ConfigService) {
    this.stripe = new Stripe(
      this.configService.getOrThrow('STRIPE_SECRET_KEY'),
      { apiVersion: '2024-12-18.acacia' }
    );
    this.webhookSecret = this.configService.getOrThrow('STRIPE_WEBHOOK_SECRET');
  }

  async createPaymentIntent(params: CreatePaymentIntentParams): Promise<PaymentIntent> {
    const { amount, currency, customerId, metadata, idempotencyKey } = params;

    const paymentIntent = await this.stripe.paymentIntents.create(
      {
        amount,
        currency,
        customer: customerId,
        metadata,
        automatic_payment_methods: { enabled: true },
      },
      { idempotencyKey }
    );

    return this.mapToPaymentIntent(paymentIntent);
  }

  async retrievePaymentIntent(paymentIntentId: string): Promise<PaymentIntent> {
    const paymentIntent = await this.stripe.paymentIntents.retrieve(paymentIntentId);
    return this.mapToPaymentIntent(paymentIntent);
  }

  async cancelPaymentIntent(paymentIntentId: string): Promise<PaymentIntent> {
    const paymentIntent = await this.stripe.paymentIntents.cancel(paymentIntentId);
    return this.mapToPaymentIntent(paymentIntent);
  }

  verifyWebhookSignature(payload: string, signature: string): Stripe.Event {
    return this.stripe.webhooks.constructEvent(
      payload,
      signature,
      this.webhookSecret
    );
  }

  private mapToPaymentIntent(pi: Stripe.PaymentIntent): PaymentIntent {
    return {
      id: pi.id,
      clientSecret: pi.client_secret!,
      amount: pi.amount,
      currency: pi.currency,
      status: pi.status as PaymentStatus,
    };
  }
}
```

### 3. Use Cases

```typescript
// src/payment/application/use-cases/create-payment-intent.use-case.ts
import { Injectable, Inject } from '@nestjs/common';
import { PaymentGatewayPort } from '../../domain/ports/payment-gateway.port';
import { OrderRepositoryPort } from '../../domain/ports/order-repository.port';
import { v4 as uuidv4 } from 'uuid';

export interface CreatePaymentIntentDto {
  orderId: string;
  userId: string;
}

@Injectable()
export class CreatePaymentIntentUseCase {
  constructor(
    @Inject('PaymentGatewayPort')
    private readonly paymentGateway: PaymentGatewayPort,
    @Inject('OrderRepositoryPort')
    private readonly orderRepository: OrderRepositoryPort,
  ) {}

  async execute(dto: CreatePaymentIntentDto) {
    // 1. 주문 정보 조회 (서버에서 금액 확인)
    const order = await this.orderRepository.findById(dto.orderId);
    if (!order) {
      throw new Error('Order not found');
    }

    if (order.userId !== dto.userId) {
      throw new Error('Unauthorized');
    }

    // 2. PaymentIntent 생성 (서버에서 조회한 금액 사용)
    const paymentIntent = await this.paymentGateway.createPaymentIntent({
      amount: order.totalAmount, // ⚠️ 반드시 서버의 금액 사용
      currency: 'usd',
      metadata: {
        orderId: order.id,
        userId: dto.userId,
      },
      idempotencyKey: `order_${order.id}_${uuidv4()}`,
    });

    // 3. 주문에 PaymentIntent ID 저장
    await this.orderRepository.update(order.id, {
      paymentIntentId: paymentIntent.id,
    });

    return {
      clientSecret: paymentIntent.clientSecret,
      paymentIntentId: paymentIntent.id,
    };
  }
}
```

### 4. Webhook Controller

```typescript
// src/payment/presentation/controllers/stripe-webhook.controller.ts
import {
  Controller,
  Post,
  Headers,
  Req,
  HttpCode,
  Inject,
  RawBodyRequest,
} from '@nestjs/common';
import { Request } from 'express';
import Stripe from 'stripe';
import { PaymentGatewayPort } from '../../domain/ports/payment-gateway.port';
import { ProcessWebhookUseCase } from '../../application/use-cases/process-webhook.use-case';

@Controller('webhooks/stripe')
export class StripeWebhookController {
  constructor(
    @Inject('PaymentGatewayPort')
    private readonly paymentGateway: PaymentGatewayPort,
    private readonly processWebhookUseCase: ProcessWebhookUseCase,
  ) {}

  @Post()
  @HttpCode(200)
  async handleWebhook(
    @Headers('stripe-signature') signature: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const payload = req.rawBody!.toString();

    // 1. 서명 검증
    let event: Stripe.Event;
    try {
      event = this.paymentGateway.verifyWebhookSignature(payload, signature);
    } catch (err) {
      throw new Error(`Webhook signature verification failed: ${err.message}`);
    }

    // 2. 이벤트 처리
    await this.processWebhookUseCase.execute(event);

    return { received: true };
  }
}
```

### 5. Webhook 이벤트 처리

```typescript
// src/payment/application/use-cases/process-webhook.use-case.ts
import { Injectable, Inject, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { OrderRepositoryPort } from '../../domain/ports/order-repository.port';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class ProcessWebhookUseCase {
  private readonly logger = new Logger(ProcessWebhookUseCase.name);

  constructor(
    @Inject('OrderRepositoryPort')
    private readonly orderRepository: OrderRepositoryPort,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async execute(event: Stripe.Event) {
    // Idempotency: 이미 처리된 이벤트인지 확인
    const processed = await this.orderRepository.isEventProcessed(event.id);
    if (processed) {
      this.logger.log(`Event ${event.id} already processed, skipping`);
      return;
    }

    switch (event.type) {
      case 'payment_intent.succeeded':
        await this.handlePaymentSucceeded(event.data.object as Stripe.PaymentIntent);
        break;

      case 'payment_intent.payment_failed':
        await this.handlePaymentFailed(event.data.object as Stripe.PaymentIntent);
        break;

      case 'customer.subscription.created':
        await this.handleSubscriptionCreated(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.deleted':
        await this.handleSubscriptionCanceled(event.data.object as Stripe.Subscription);
        break;

      case 'invoice.payment_succeeded':
        await this.handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;

      default:
        this.logger.log(`Unhandled event type: ${event.type}`);
    }

    // 처리 완료 기록
    await this.orderRepository.markEventProcessed(event.id);
  }

  private async handlePaymentSucceeded(paymentIntent: Stripe.PaymentIntent) {
    const orderId = paymentIntent.metadata.orderId;
    
    await this.orderRepository.update(orderId, {
      status: 'PAID',
      paidAt: new Date(),
    });

    // 도메인 이벤트 발행
    this.eventEmitter.emit('order.paid', { orderId, paymentIntentId: paymentIntent.id });
  }

  private async handlePaymentFailed(paymentIntent: Stripe.PaymentIntent) {
    const orderId = paymentIntent.metadata.orderId;
    
    await this.orderRepository.update(orderId, {
      status: 'PAYMENT_FAILED',
      failureReason: paymentIntent.last_payment_error?.message,
    });

    this.eventEmitter.emit('order.payment_failed', { orderId });
  }

  private async handleSubscriptionCreated(subscription: Stripe.Subscription) {
    this.eventEmitter.emit('subscription.created', {
      subscriptionId: subscription.id,
      customerId: subscription.customer,
      status: subscription.status,
    });
  }

  private async handleSubscriptionCanceled(subscription: Stripe.Subscription) {
    this.eventEmitter.emit('subscription.canceled', {
      subscriptionId: subscription.id,
      customerId: subscription.customer,
    });
  }

  private async handleInvoicePaid(invoice: Stripe.Invoice) {
    this.eventEmitter.emit('invoice.paid', {
      invoiceId: invoice.id,
      subscriptionId: invoice.subscription,
      amountPaid: invoice.amount_paid,
    });
  }
}
```

### 6. Module 설정

```typescript
// src/payment/payment.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { StripeAdapter } from './infrastructure/adapters/stripe.adapter';
import { PrismaOrderRepository } from './infrastructure/repositories/prisma-order.repository';
import { CreatePaymentIntentUseCase } from './application/use-cases/create-payment-intent.use-case';
import { ProcessWebhookUseCase } from './application/use-cases/process-webhook.use-case';
import { StripeWebhookController } from './presentation/controllers/stripe-webhook.controller';
import { PaymentController } from './presentation/controllers/payment.controller';

@Module({
  imports: [ConfigModule, EventEmitterModule.forRoot()],
  controllers: [PaymentController, StripeWebhookController],
  providers: [
    // Ports
    {
      provide: 'PaymentGatewayPort',
      useClass: StripeAdapter,
    },
    {
      provide: 'OrderRepositoryPort',
      useClass: PrismaOrderRepository,
    },
    // Use Cases
    CreatePaymentIntentUseCase,
    ProcessWebhookUseCase,
  ],
  exports: ['PaymentGatewayPort'],
})
export class PaymentModule {}
```

---

## 🎨 Frontend 구현 (Next.js)

### 1. Stripe Provider 설정

```typescript
// src/providers/stripe-provider.tsx
'use client';

import { loadStripe } from '@stripe/stripe-js';
import { Elements } from '@stripe/react-stripe-js';
import { ReactNode } from 'react';

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!
);

interface StripeProviderProps {
  children: ReactNode;
  clientSecret: string;
}

export function StripeProvider({ children, clientSecret }: StripeProviderProps) {
  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret,
        appearance: {
          theme: 'stripe',
          variables: {
            colorPrimary: '#0066ff',
          },
        },
      }}
    >
      {children}
    </Elements>
  );
}
```

### 2. Checkout Form 컴포넌트

```typescript
// src/components/checkout/checkout-form.tsx
'use client';

import { useState } from 'react';
import {
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';

interface CheckoutFormProps {
  orderId: string;
}

export function CheckoutForm({ orderId }: CheckoutFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setIsLoading(true);
    setError(null);

    const { error: submitError } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/checkout/success?orderId=${orderId}`,
      },
    });

    if (submitError) {
      setError(submitError.message ?? 'An error occurred');
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <PaymentElement />
      
      {error && (
        <div className="text-red-500 text-sm">{error}</div>
      )}

      <button
        type="submit"
        disabled={!stripe || isLoading}
        className="w-full bg-blue-600 text-white py-3 rounded-lg disabled:opacity-50"
      >
        {isLoading ? '처리 중...' : '결제하기'}
      </button>
    </form>
  );
}
```

### 3. Checkout 페이지

```typescript
// src/app/checkout/[orderId]/page.tsx
import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { CheckoutContent } from './checkout-content';

interface PageProps {
  params: Promise<{ orderId: string }>;
}

export default async function CheckoutPage({ params }: PageProps) {
  const { orderId } = await params;

  return (
    <div className="max-w-lg mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">결제</h1>
      <Suspense fallback={<CheckoutSkeleton />}>
        <CheckoutContent orderId={orderId} />
      </Suspense>
    </div>
  );
}

function CheckoutSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-12 bg-gray-200 rounded" />
      <div className="h-12 bg-gray-200 rounded" />
      <div className="h-12 bg-gray-200 rounded" />
    </div>
  );
}
```

```typescript
// src/app/checkout/[orderId]/checkout-content.tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { StripeProvider } from '@/providers/stripe-provider';
import { CheckoutForm } from '@/components/checkout/checkout-form';
import { api } from '@/lib/api';

interface CheckoutContentProps {
  orderId: string;
}

export function CheckoutContent({ orderId }: CheckoutContentProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['paymentIntent', orderId],
    queryFn: () => api.post<{ clientSecret: string }>('/api/payments/create-intent', { orderId }),
  });

  if (isLoading) {
    return <div>결제 정보 로딩 중...</div>;
  }

  if (error || !data?.clientSecret) {
    return <div>결제 정보를 불러올 수 없습니다.</div>;
  }

  return (
    <StripeProvider clientSecret={data.clientSecret}>
      <CheckoutForm orderId={orderId} />
    </StripeProvider>
  );
}
```

### 4. Next.js API Route (Proxy)

```typescript
// src/app/api/payments/create-intent/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();

  // Backend API 호출 (프록시)
  const response = await fetch(`${process.env.BACKEND_URL}/payments/create-intent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.accessToken}`,
    },
    body: JSON.stringify({
      orderId: body.orderId,
      userId: session.user.id,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    return NextResponse.json(data, { status: response.status });
  }

  return NextResponse.json(data);
}
```

---

## 🔄 구독 결제 (Subscription)

### Backend - 구독 생성

```typescript
// src/payment/application/use-cases/create-subscription.use-case.ts
import { Injectable, Inject } from '@nestjs/common';
import Stripe from 'stripe';

@Injectable()
export class CreateSubscriptionUseCase {
  constructor(
    @Inject('StripeClient')
    private readonly stripe: Stripe,
  ) {}

  async execute(dto: CreateSubscriptionDto) {
    // 1. 고객 조회 또는 생성
    let customer = await this.findOrCreateCustomer(dto.userId, dto.email);

    // 2. Checkout Session 생성 (구독용)
    const session = await this.stripe.checkout.sessions.create({
      customer: customer.id,
      mode: 'subscription',
      line_items: [
        {
          price: dto.priceId, // Stripe Dashboard에서 생성한 Price ID
          quantity: 1,
        },
      ],
      success_url: `${dto.successUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: dto.cancelUrl,
      subscription_data: {
        trial_period_days: dto.trialDays,
        metadata: {
          userId: dto.userId,
        },
      },
    });

    return {
      sessionId: session.id,
      url: session.url,
    };
  }

  private async findOrCreateCustomer(userId: string, email: string) {
    // 기존 고객 검색
    const existing = await this.stripe.customers.list({
      email,
      limit: 1,
    });

    if (existing.data.length > 0) {
      return existing.data[0];
    }

    // 새 고객 생성
    return this.stripe.customers.create({
      email,
      metadata: { userId },
    });
  }
}
```

### Frontend - 구독 버튼

```typescript
// src/components/subscription/subscribe-button.tsx
'use client';

import { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

interface SubscribeButtonProps {
  priceId: string;
  planName: string;
}

export function SubscribeButton({ priceId, planName }: SubscribeButtonProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleSubscribe = async () => {
    setIsLoading(true);

    try {
      const response = await fetch('/api/subscriptions/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceId }),
      });

      const { sessionId } = await response.json();

      const stripe = await stripePromise;
      await stripe?.redirectToCheckout({ sessionId });
    } catch (error) {
      console.error('Subscription error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <button
      onClick={handleSubscribe}
      disabled={isLoading}
      className="bg-blue-600 text-white px-6 py-3 rounded-lg disabled:opacity-50"
    >
      {isLoading ? '처리 중...' : `${planName} 구독하기`}
    </button>
  );
}
```

---

## 🧪 테스트 카드 번호

| 시나리오 | 카드 번호 |
|----------|----------|
| 성공 | 4242 4242 4242 4242 |
| 결제 거절 | 4000 0000 0000 0002 |
| 3D Secure 필요 | 4000 0025 0000 3155 |
| 잔액 부족 | 4000 0000 0000 9995 |

CVC: 아무 3자리 숫자
만료일: 미래 날짜

---

## 🔧 Stripe CLI (로컬 테스트)

```bash
# 설치
brew install stripe/stripe-cli/stripe

# 로그인
stripe login

# Webhook 로컬 포워딩
stripe listen --forward-to localhost:3001/webhooks/stripe

# 테스트 이벤트 트리거
stripe trigger payment_intent.succeeded
```

---

*v1.0.0 | 2025-01-03*
