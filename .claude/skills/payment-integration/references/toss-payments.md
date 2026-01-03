# TossPayments Integration Guide

토스페이먼츠를 사용한 한국 결제 통합 가이드입니다.

## 📦 패키지 설치

### Frontend (Next.js)
```bash
npm install @tosspayments/tosspayments-sdk
# 또는 결제위젯 사용 시
npm install @tosspayments/payment-widget-sdk
```

### Backend (NestJS)
토스페이먼츠는 REST API 기반이므로 별도 SDK 없이 HTTP 클라이언트 사용

---

## 🏗️ Backend 구현 (NestJS)

### 1. TossPayments Adapter

```typescript
// src/payment/infrastructure/adapters/toss-payments.adapter.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as crypto from 'crypto';
import {
  PaymentGatewayPort,
  CreatePaymentParams,
  PaymentResult,
  WebhookEvent,
} from '../../domain/ports/payment-gateway.port';

@Injectable()
export class TossPaymentsAdapter implements PaymentGatewayPort {
  private readonly logger = new Logger(TossPaymentsAdapter.name);
  private readonly baseUrl = 'https://api.tosspayments.com/v1';
  private readonly secretKey: string;
  private readonly webhookSecret: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    this.secretKey = this.configService.getOrThrow('TOSS_PAYMENTS_SECRET_KEY');
    this.webhookSecret = this.configService.getOrThrow('TOSS_PAYMENTS_WEBHOOK_SECRET');
  }

  private getAuthHeader(): string {
    return `Basic ${Buffer.from(`${this.secretKey}:`).toString('base64')}`;
  }

  async confirmPayment(paymentKey: string, orderId: string, amount: number): Promise<PaymentResult> {
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/payments/confirm`,
          { paymentKey, orderId, amount },
          {
            headers: {
              Authorization: this.getAuthHeader(),
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      return this.mapToPaymentResult(response.data);
    } catch (error) {
      this.logger.error('Payment confirmation failed', error.response?.data);
      throw error;
    }
  }

  async cancelPayment(
    paymentKey: string,
    cancelReason: string,
    cancelAmount?: number,
  ): Promise<PaymentResult> {
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/payments/${paymentKey}/cancel`,
          {
            cancelReason,
            cancelAmount,
          },
          {
            headers: {
              Authorization: this.getAuthHeader(),
              'Content-Type': 'application/json',
              'Idempotency-Key': `cancel_${paymentKey}_${Date.now()}`,
            },
          },
        ),
      );

      return this.mapToPaymentResult(response.data);
    } catch (error) {
      this.logger.error('Payment cancellation failed', error.response?.data);
      throw error;
    }
  }

  async getPayment(paymentKey: string): Promise<PaymentResult> {
    const response = await firstValueFrom(
      this.httpService.get(`${this.baseUrl}/payments/${paymentKey}`, {
        headers: { Authorization: this.getAuthHeader() },
      }),
    );

    return this.mapToPaymentResult(response.data);
  }

  async getPaymentByOrderId(orderId: string): Promise<PaymentResult> {
    const response = await firstValueFrom(
      this.httpService.get(`${this.baseUrl}/payments/orders/${orderId}`, {
        headers: { Authorization: this.getAuthHeader() },
      }),
    );

    return this.mapToPaymentResult(response.data);
  }

  verifyWebhook(payload: string, signature: string): boolean {
    // 토스페이먼츠 웹훅 서명 검증
    const expectedSignature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(payload)
      .digest('base64');

    return signature === expectedSignature;
  }

  private mapToPaymentResult(data: any): PaymentResult {
    return {
      paymentKey: data.paymentKey,
      orderId: data.orderId,
      orderName: data.orderName,
      status: this.mapStatus(data.status),
      method: data.method,
      totalAmount: data.totalAmount,
      balanceAmount: data.balanceAmount,
      suppliedAmount: data.suppliedAmount,
      vat: data.vat,
      requestedAt: new Date(data.requestedAt),
      approvedAt: data.approvedAt ? new Date(data.approvedAt) : null,
      card: data.card ? {
        issuerCode: data.card.issuerCode,
        acquirerCode: data.card.acquirerCode,
        number: data.card.number,
        installmentPlanMonths: data.card.installmentPlanMonths,
        cardType: data.card.cardType,
        ownerType: data.card.ownerType,
      } : null,
      receipt: data.receipt?.url,
      failure: data.failure,
    };
  }

  private mapStatus(status: string): PaymentStatus {
    const statusMap: Record<string, PaymentStatus> = {
      'READY': 'pending',
      'IN_PROGRESS': 'processing',
      'WAITING_FOR_DEPOSIT': 'awaiting_deposit',
      'DONE': 'succeeded',
      'CANCELED': 'canceled',
      'PARTIAL_CANCELED': 'partially_refunded',
      'ABORTED': 'failed',
      'EXPIRED': 'expired',
    };
    return statusMap[status] || 'unknown';
  }
}
```

### 2. 결제 승인 Use Case

```typescript
// src/payment/application/use-cases/confirm-payment.use-case.ts
import { Injectable, Inject, BadRequestException } from '@nestjs/common';
import { TossPaymentsAdapter } from '../../infrastructure/adapters/toss-payments.adapter';
import { OrderRepositoryPort } from '../../domain/ports/order-repository.port';

export interface ConfirmPaymentDto {
  paymentKey: string;
  orderId: string;
  amount: number;
}

@Injectable()
export class ConfirmPaymentUseCase {
  constructor(
    @Inject('TossPaymentsAdapter')
    private readonly tossPayments: TossPaymentsAdapter,
    @Inject('OrderRepositoryPort')
    private readonly orderRepository: OrderRepositoryPort,
  ) {}

  async execute(dto: ConfirmPaymentDto) {
    // 1. 주문 정보 조회 (서버에서 금액 확인)
    const order = await this.orderRepository.findById(dto.orderId);
    if (!order) {
      throw new BadRequestException('주문을 찾을 수 없습니다.');
    }

    // 2. ⚠️ 금액 검증 (클라이언트 금액과 서버 금액 비교)
    if (order.totalAmount !== dto.amount) {
      throw new BadRequestException('결제 금액이 일치하지 않습니다.');
    }

    // 3. 토스페이먼츠 결제 승인 요청
    const payment = await this.tossPayments.confirmPayment(
      dto.paymentKey,
      dto.orderId,
      order.totalAmount, // ⚠️ 반드시 서버의 금액 사용
    );

    // 4. 주문 상태 업데이트
    await this.orderRepository.update(order.id, {
      status: 'PAID',
      paymentKey: dto.paymentKey,
      paidAt: payment.approvedAt,
    });

    return {
      success: true,
      payment,
    };
  }
}
```

### 3. Webhook Controller

```typescript
// src/payment/presentation/controllers/toss-webhook.controller.ts
import {
  Controller,
  Post,
  Headers,
  Body,
  HttpCode,
  Inject,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { TossPaymentsAdapter } from '../../infrastructure/adapters/toss-payments.adapter';
import { ProcessTossWebhookUseCase } from '../../application/use-cases/process-toss-webhook.use-case';

interface TossWebhookPayload {
  eventType: string;
  createdAt: string;
  data: {
    paymentKey?: string;
    orderId?: string;
    status?: string;
    [key: string]: any;
  };
}

@Controller('webhooks/toss')
export class TossWebhookController {
  private readonly logger = new Logger(TossWebhookController.name);

  constructor(
    @Inject('TossPaymentsAdapter')
    private readonly tossPayments: TossPaymentsAdapter,
    private readonly processWebhookUseCase: ProcessTossWebhookUseCase,
  ) {}

  @Post()
  @HttpCode(200)
  async handleWebhook(
    @Headers('x-toss-signature') signature: string,
    @Body() payload: TossWebhookPayload,
  ) {
    // 1. 서명 검증
    const rawPayload = JSON.stringify(payload);
    const isValid = this.tossPayments.verifyWebhook(rawPayload, signature);
    
    if (!isValid) {
      this.logger.warn('Invalid webhook signature');
      throw new UnauthorizedException('Invalid signature');
    }

    // 2. 이벤트 처리
    await this.processWebhookUseCase.execute(payload);

    return { success: true };
  }
}
```

### 4. Webhook 이벤트 처리

```typescript
// src/payment/application/use-cases/process-toss-webhook.use-case.ts
import { Injectable, Inject, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class ProcessTossWebhookUseCase {
  private readonly logger = new Logger(ProcessTossWebhookUseCase.name);

  constructor(
    @Inject('OrderRepositoryPort')
    private readonly orderRepository: OrderRepositoryPort,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async execute(payload: TossWebhookPayload) {
    const { eventType, data } = payload;

    switch (eventType) {
      case 'PAYMENT_STATUS_CHANGED':
        await this.handlePaymentStatusChanged(data);
        break;

      case 'DEPOSIT_CALLBACK':
        await this.handleVirtualAccountDeposit(data);
        break;

      case 'PAYMENT_CANCEL_COMPLETED':
        await this.handlePaymentCanceled(data);
        break;

      default:
        this.logger.log(`Unhandled event type: ${eventType}`);
    }
  }

  private async handlePaymentStatusChanged(data: any) {
    const { orderId, status, paymentKey } = data;

    switch (status) {
      case 'DONE':
        await this.orderRepository.update(orderId, {
          status: 'PAID',
          paymentKey,
          paidAt: new Date(),
        });
        this.eventEmitter.emit('order.paid', { orderId, paymentKey });
        break;

      case 'CANCELED':
        await this.orderRepository.update(orderId, {
          status: 'CANCELED',
        });
        this.eventEmitter.emit('order.canceled', { orderId });
        break;

      case 'ABORTED':
        await this.orderRepository.update(orderId, {
          status: 'PAYMENT_FAILED',
        });
        this.eventEmitter.emit('order.payment_failed', { orderId });
        break;
    }
  }

  private async handleVirtualAccountDeposit(data: any) {
    // 가상계좌 입금 완료 처리
    const { orderId } = data;
    
    await this.orderRepository.update(orderId, {
      status: 'PAID',
      paidAt: new Date(),
    });

    this.eventEmitter.emit('order.paid', { orderId });
  }

  private async handlePaymentCanceled(data: any) {
    const { orderId, cancelAmount } = data;
    
    const order = await this.orderRepository.findById(orderId);
    
    if (cancelAmount === order.totalAmount) {
      await this.orderRepository.update(orderId, { status: 'REFUNDED' });
    } else {
      await this.orderRepository.update(orderId, { status: 'PARTIALLY_REFUNDED' });
    }

    this.eventEmitter.emit('order.refunded', { orderId, cancelAmount });
  }
}
```

---

## 🎨 Frontend 구현 (Next.js)

### 1. 결제위젯 방식 (권장)

```typescript
// src/components/checkout/toss-payment-widget.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import {
  loadPaymentWidget,
  PaymentWidgetInstance,
} from '@tosspayments/payment-widget-sdk';

const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY!;

interface TossPaymentWidgetProps {
  orderId: string;
  orderName: string;
  amount: number;
  customerEmail: string;
  customerName: string;
}

export function TossPaymentWidget({
  orderId,
  orderName,
  amount,
  customerEmail,
  customerName,
}: TossPaymentWidgetProps) {
  const paymentWidgetRef = useRef<PaymentWidgetInstance | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    async function initWidget() {
      // 고객 키 생성 (로그인 사용자는 고유 ID, 비회원은 ANONYMOUS)
      const customerKey = `customer_${Date.now()}`; // 실제로는 사용자 ID 사용

      const paymentWidget = await loadPaymentWidget(clientKey, customerKey);
      paymentWidgetRef.current = paymentWidget;

      // 결제 UI 렌더링
      await paymentWidget.renderPaymentMethods(
        '#payment-widget',
        { value: amount },
        { variantKey: 'DEFAULT' }
      );

      // 약관 UI 렌더링
      await paymentWidget.renderAgreement('#agreement', {
        variantKey: 'AGREEMENT',
      });

      setIsReady(true);
    }

    initWidget();
  }, [amount]);

  const handlePayment = async () => {
    const paymentWidget = paymentWidgetRef.current;
    if (!paymentWidget) return;

    setIsLoading(true);

    try {
      await paymentWidget.requestPayment({
        orderId,
        orderName,
        customerEmail,
        customerName,
        successUrl: `${window.location.origin}/checkout/success`,
        failUrl: `${window.location.origin}/checkout/fail`,
      });
    } catch (error) {
      console.error('Payment request failed:', error);
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 결제 수단 선택 UI */}
      <div id="payment-widget" />
      
      {/* 약관 동의 UI */}
      <div id="agreement" />

      {/* 결제 버튼 */}
      <button
        onClick={handlePayment}
        disabled={!isReady || isLoading}
        className="w-full bg-blue-600 text-white py-4 rounded-lg font-semibold disabled:opacity-50"
      >
        {isLoading ? '결제 처리 중...' : `${amount.toLocaleString()}원 결제하기`}
      </button>
    </div>
  );
}
```

### 2. SDK v2 직접 방식

```typescript
// src/components/checkout/toss-payment-v2.tsx
'use client';

import { useEffect, useState } from 'react';
import { loadTossPayments } from '@tosspayments/tosspayments-sdk';

const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY!;

interface TossPaymentV2Props {
  orderId: string;
  orderName: string;
  amount: number;
  customerEmail: string;
  customerName: string;
}

export function TossPaymentV2({
  orderId,
  orderName,
  amount,
  customerEmail,
  customerName,
}: TossPaymentV2Props) {
  const [widgets, setWidgets] = useState<any>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    async function initPayment() {
      const customerKey = `customer_${Date.now()}`;
      const tossPayments = await loadTossPayments(clientKey);
      const widgetsInstance = tossPayments.widgets({ customerKey });
      
      // 금액 설정
      await widgetsInstance.setAmount({
        currency: 'KRW',
        value: amount,
      });

      // UI 렌더링
      await Promise.all([
        widgetsInstance.renderPaymentMethods({
          selector: '#payment-method',
          variantKey: 'DEFAULT',
        }),
        widgetsInstance.renderAgreement({
          selector: '#agreement',
          variantKey: 'AGREEMENT',
        }),
      ]);

      setWidgets(widgetsInstance);
      setIsReady(true);
    }

    initPayment();
  }, [amount]);

  const handlePayment = async () => {
    if (!widgets) return;

    try {
      await widgets.requestPayment({
        orderId,
        orderName,
        customerEmail,
        customerName,
        customerMobilePhone: '01012341234',
        successUrl: `${window.location.origin}/checkout/success`,
        failUrl: `${window.location.origin}/checkout/fail`,
      });
    } catch (error) {
      console.error('Payment failed:', error);
    }
  };

  return (
    <div className="space-y-6">
      <div id="payment-method" />
      <div id="agreement" />
      <button
        onClick={handlePayment}
        disabled={!isReady}
        className="w-full bg-blue-600 text-white py-4 rounded-lg"
      >
        {amount.toLocaleString()}원 결제하기
      </button>
    </div>
  );
}
```

### 3. 결제 성공 페이지

```typescript
// src/app/checkout/success/page.tsx
import { Suspense } from 'react';
import { SuccessContent } from './success-content';

export default function CheckoutSuccessPage() {
  return (
    <Suspense fallback={<div>결제 확인 중...</div>}>
      <SuccessContent />
    </Suspense>
  );
}
```

```typescript
// src/app/checkout/success/success-content.tsx
'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';

export function SuccessContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');

  const paymentKey = searchParams.get('paymentKey');
  const orderId = searchParams.get('orderId');
  const amount = searchParams.get('amount');

  const confirmMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/payments/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentKey,
          orderId,
          amount: Number(amount),
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message);
      }

      return response.json();
    },
    onSuccess: () => {
      setStatus('success');
    },
    onError: () => {
      setStatus('error');
    },
  });

  useEffect(() => {
    if (paymentKey && orderId && amount) {
      confirmMutation.mutate();
    }
  }, [paymentKey, orderId, amount]);

  if (status === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
        <p className="mt-4 text-gray-600">결제를 확인하고 있습니다...</p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <div className="text-red-500 text-6xl">✕</div>
        <h1 className="mt-4 text-2xl font-bold">결제 확인 실패</h1>
        <p className="mt-2 text-gray-600">잠시 후 다시 시도해 주세요.</p>
        <button
          onClick={() => router.push('/checkout')}
          className="mt-6 px-6 py-3 bg-blue-600 text-white rounded-lg"
        >
          다시 시도
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      <div className="text-green-500 text-6xl">✓</div>
      <h1 className="mt-4 text-2xl font-bold">결제가 완료되었습니다</h1>
      <p className="mt-2 text-gray-600">주문번호: {orderId}</p>
      <button
        onClick={() => router.push('/orders')}
        className="mt-6 px-6 py-3 bg-blue-600 text-white rounded-lg"
      >
        주문 내역 확인
      </button>
    </div>
  );
}
```

### 4. 결제 실패 페이지

```typescript
// src/app/checkout/fail/page.tsx
'use client';

import { useSearchParams, useRouter } from 'next/navigation';

export default function CheckoutFailPage() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const errorCode = searchParams.get('code');
  const errorMessage = searchParams.get('message');

  return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      <div className="text-red-500 text-6xl">✕</div>
      <h1 className="mt-4 text-2xl font-bold">결제에 실패했습니다</h1>
      <p className="mt-2 text-gray-600">{errorMessage || '알 수 없는 오류가 발생했습니다.'}</p>
      {errorCode && (
        <p className="mt-1 text-sm text-gray-400">오류 코드: {errorCode}</p>
      )}
      <button
        onClick={() => router.back()}
        className="mt-6 px-6 py-3 bg-blue-600 text-white rounded-lg"
      >
        다시 시도
      </button>
    </div>
  );
}
```

### 5. Next.js API Route (결제 승인)

```typescript
// src/app/api/payments/confirm/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { paymentKey, orderId, amount } = await request.json();

  // Backend API 호출
  const response = await fetch(`${process.env.BACKEND_URL}/payments/confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.accessToken}`,
    },
    body: JSON.stringify({ paymentKey, orderId, amount }),
  });

  const data = await response.json();

  if (!response.ok) {
    return NextResponse.json(data, { status: response.status });
  }

  return NextResponse.json(data);
}
```

---

## 💳 결제 수단별 특이사항

### 카드 결제
- 할부 개월 수 설정 가능
- 카드사 포인트 사용 가능

### 가상계좌
- 입금 기한 설정 필수
- 입금 완료 시 Webhook으로 알림

### 계좌이체
- 실시간 계좌이체
- 현금영수증 발급 가능

### 간편결제
- 토스페이, 카카오페이, 네이버페이 등
- flowMode: 'DIRECT'로 직접 결제창 열기

---

## 🔄 정기결제 (Billing)

```typescript
// 빌링키 발급
const billingResponse = await fetch('/api/billing/issue', {
  method: 'POST',
  body: JSON.stringify({
    customerKey: 'unique-customer-id',
    cardNumber: '카드번호',
    cardExpirationYear: '만료연도',
    cardExpirationMonth: '만료월',
    // ...
  }),
});

// 빌링키로 결제
const paymentResponse = await fetch('/api/billing/pay', {
  method: 'POST',
  body: JSON.stringify({
    billingKey: 'billing-key-xxx',
    amount: 10000,
    orderId: 'order-xxx',
    orderName: '정기결제',
  }),
});
```

---

## 🧪 테스트

### 테스트 키
- Client Key: `test_ck_...`
- Secret Key: `test_sk_...`

### 테스트 카드
| 카드사 | 카드번호 |
|--------|----------|
| 일반 승인 | 5678-9012-3456-7890 |
| 결제 실패 | 1234-1234-1234-1234 |

---

*v1.0.0 | 2025-01-03*
