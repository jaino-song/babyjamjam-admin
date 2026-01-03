# Subscription Guide (구독/정기결제 가이드)

> 구독 서비스 구현을 위한 종합 가이드

---

## 목차

1. [구독 플랜 설계](#1-구독-플랜-설계)
2. [구독 라이프사이클](#2-구독-라이프사이클)
3. [정기 결제 구현](#3-정기-결제-구현)
4. [결제 실패 처리 (Dunning)](#4-결제-실패-처리-dunning)
5. [취소 및 환불](#5-취소-및-환불)
6. [Clean Architecture 구현 예시](#6-clean-architecture-구현-예시)
7. [프론트엔드 통합](#7-프론트엔드-통합)

---

## 1. 구독 플랜 설계

### 1.1 플랜 구조

```typescript
// domain/value-objects/plan-tier.vo.ts
export type PlanTier = 'FREE' | 'BASIC' | 'PRO' | 'ENTERPRISE';

export interface PlanDefinition {
  tier: PlanTier;
  name: string;
  description: string;
  monthlyPrice: number;
  yearlyPrice: number;   // 연간 결제 시 할인된 가격
  features: PlanFeature[];
  limits: PlanLimits;
}

export interface PlanFeature {
  key: string;
  name: string;
  included: boolean;
  limit?: number;        // null = 무제한
}

export interface PlanLimits {
  maxProjects: number;   // -1 = 무제한
  maxMembers: number;
  storageGB: number;
  apiCallsPerMonth: number;
}
```

### 1.2 가격 정책

```typescript
// domain/constants/pricing.ts
export const PRICING_CONFIG = {
  FREE: {
    monthly: 0,
    yearly: 0,
    yearlyDiscount: 0,
  },
  BASIC: {
    monthly: 9900,           // 월 9,900원 (또는 $9)
    yearly: 99000,           // 연 99,000원 (약 17% 할인)
    yearlyDiscount: 0.17,
  },
  PRO: {
    monthly: 29900,
    yearly: 299000,          // 연 299,000원 (약 17% 할인)
    yearlyDiscount: 0.17,
  },
  ENTERPRISE: {
    monthly: null,           // 문의
    yearly: null,
    yearlyDiscount: 0.20,
  },
} as const;

// 연간 할인 계산
export function calculateYearlyPrice(monthlyPrice: number, discountRate: number): number {
  const fullYearPrice = monthlyPrice * 12;
  return Math.floor(fullYearPrice * (1 - discountRate));
}
```

### 1.3 기능 제한 매트릭스

```typescript
// domain/constants/feature-matrix.ts
export const FEATURE_MATRIX: Record<PlanTier, PlanFeature[]> = {
  FREE: [
    { key: 'basic_analytics', name: '기본 분석', included: true },
    { key: 'projects', name: '프로젝트', included: true, limit: 3 },
    { key: 'members', name: '팀원', included: true, limit: 1 },
    { key: 'storage', name: '저장공간', included: true, limit: 1 }, // 1GB
    { key: 'api_access', name: 'API 접근', included: false },
    { key: 'priority_support', name: '우선 지원', included: false },
    { key: 'custom_domain', name: '커스텀 도메인', included: false },
  ],
  BASIC: [
    { key: 'basic_analytics', name: '기본 분석', included: true },
    { key: 'projects', name: '프로젝트', included: true, limit: 10 },
    { key: 'members', name: '팀원', included: true, limit: 5 },
    { key: 'storage', name: '저장공간', included: true, limit: 10 }, // 10GB
    { key: 'api_access', name: 'API 접근', included: true, limit: 10000 },
    { key: 'priority_support', name: '우선 지원', included: false },
    { key: 'custom_domain', name: '커스텀 도메인', included: false },
  ],
  PRO: [
    { key: 'basic_analytics', name: '기본 분석', included: true },
    { key: 'advanced_analytics', name: '고급 분석', included: true },
    { key: 'projects', name: '프로젝트', included: true }, // 무제한
    { key: 'members', name: '팀원', included: true, limit: 20 },
    { key: 'storage', name: '저장공간', included: true, limit: 100 }, // 100GB
    { key: 'api_access', name: 'API 접근', included: true, limit: 100000 },
    { key: 'priority_support', name: '우선 지원', included: true },
    { key: 'custom_domain', name: '커스텀 도메인', included: true },
  ],
  ENTERPRISE: [
    { key: 'all_features', name: '모든 기능', included: true },
    { key: 'unlimited', name: '무제한', included: true },
    { key: 'sla', name: 'SLA 보장', included: true },
    { key: 'dedicated_support', name: '전담 지원', included: true },
    { key: 'on_premise', name: '온프레미스 설치', included: true },
  ],
};
```

### 1.4 플랜 접근 제어

```typescript
// application/services/feature-gate.service.ts
@Injectable()
export class FeatureGateService {
  constructor(
    @Inject('SubscriptionRepositoryPort')
    private readonly subscriptionRepo: SubscriptionRepositoryPort,
  ) {}

  async checkFeatureAccess(
    userId: string,
    featureKey: string,
  ): Promise<{ allowed: boolean; reason?: string; currentUsage?: number; limit?: number }> {
    const subscription = await this.subscriptionRepo.findActiveByUserId(userId);
    
    if (!subscription) {
      return { allowed: false, reason: 'NO_ACTIVE_SUBSCRIPTION' };
    }

    const feature = FEATURE_MATRIX[subscription.planTier].find(f => f.key === featureKey);
    
    if (!feature || !feature.included) {
      return { allowed: false, reason: 'FEATURE_NOT_INCLUDED' };
    }

    // 사용량 제한이 있는 경우
    if (feature.limit !== undefined) {
      const usage = await this.getUsage(userId, featureKey);
      if (usage >= feature.limit) {
        return {
          allowed: false,
          reason: 'LIMIT_EXCEEDED',
          currentUsage: usage,
          limit: feature.limit,
        };
      }
    }

    return { allowed: true };
  }

  private async getUsage(userId: string, featureKey: string): Promise<number> {
    // 기능별 사용량 조회 로직
    // ...
  }
}
```

---

## 2. 구독 라이프사이클

### 2.1 상태 다이어그램

```
┌──────────────────────────────────────────────────────────────────────┐
│                          구독 라이프사이클                              │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────┐    결제 성공    ┌─────────┐                             │
│  │  TRIAL  │ ─────────────→ │  ACTIVE │ ←─────────────┐              │
│  │ (무료체험)│                │  (활성) │              │              │
│  └────┬────┘                └────┬────┘              │              │
│       │                          │                   │              │
│       │ 체험 만료                 │ 결제 실패          │ 결제 성공     │
│       │ (미결제)                  ↓                   │              │
│       │                    ┌──────────┐              │              │
│       │                    │ PAST_DUE │ ─────────────┘              │
│       │                    │ (연체)   │                              │
│       │                    └────┬────┘                              │
│       │                          │                                   │
│       │                          │ Grace Period 종료                 │
│       │                          ↓                                   │
│       │                    ┌──────────┐                              │
│       └──────────────────→ │ CANCELED │                              │
│                            │  (취소)  │ ←─── 사용자 취소              │
│                            └────┬────┘                              │
│                                 │                                    │
│                                 │ 데이터 보관 기간 종료               │
│                                 ↓                                    │
│                            ┌──────────┐                              │
│                            │ EXPIRED  │                              │
│                            │  (만료)  │                              │
│                            └──────────┘                              │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.2 구독 상태 정의

```typescript
// domain/value-objects/subscription-status.vo.ts
export type SubscriptionStatus = 
  | 'TRIALING'    // 무료 체험 중
  | 'ACTIVE'      // 정상 구독 중
  | 'PAST_DUE'    // 결제 연체 (유예 기간)
  | 'PAUSED'      // 일시 정지
  | 'CANCELED'    // 취소됨 (기간 만료 대기)
  | 'EXPIRED';    // 완전 만료

export interface SubscriptionStatusTransition {
  from: SubscriptionStatus;
  to: SubscriptionStatus;
  trigger: string;
  timestamp: Date;
}
```

### 2.3 Trial (무료 체험) 구현

```typescript
// application/use-cases/commands/start-trial.use-case.ts
@Injectable()
export class StartTrialUseCase {
  constructor(
    @Inject('SubscriptionRepositoryPort')
    private readonly subscriptionRepo: SubscriptionRepositoryPort,
    @Inject('EventEmitterPort')
    private readonly eventEmitter: EventEmitterPort,
  ) {}

  async execute(dto: StartTrialDto): Promise<Subscription> {
    const { userId, planTier, trialDays = 14 } = dto;

    // 기존 Trial 이력 확인 (중복 방지)
    const existingTrial = await this.subscriptionRepo.findTrialHistoryByUserId(userId);
    if (existingTrial) {
      throw new TrialAlreadyUsedError(userId);
    }

    const trialEnd = addDays(new Date(), trialDays);

    const subscription = Subscription.create({
      userId,
      planTier,
      status: 'TRIALING',
      currentPeriodStart: new Date(),
      currentPeriodEnd: trialEnd,
      trialEnd,
      cancelAtPeriodEnd: false,
    });

    const saved = await this.subscriptionRepo.save(subscription);

    await this.eventEmitter.emit('subscription.trial_started', {
      subscriptionId: saved.id,
      userId,
      planTier,
      trialEnd,
    });

    return saved;
  }
}
```

### 2.4 Trial 만료 처리

```typescript
// application/use-cases/commands/process-trial-expiry.use-case.ts
@Injectable()
export class ProcessTrialExpiryUseCase {
  async execute(): Promise<void> {
    // 만료된 Trial 조회
    const expiredTrials = await this.subscriptionRepo.findExpiredTrials();

    for (const subscription of expiredTrials) {
      // 결제 수단이 등록되어 있으면 자동 구독 전환
      const hasPaymentMethod = await this.paymentMethodRepo.existsByUserId(
        subscription.userId
      );

      if (hasPaymentMethod) {
        await this.convertTrialToActive(subscription);
      } else {
        await this.expireTrialWithoutPayment(subscription);
      }
    }
  }

  private async convertTrialToActive(subscription: Subscription): Promise<void> {
    // 첫 결제 진행
    const payment = await this.createFirstPayment(subscription);
    
    if (payment.status === 'SUCCEEDED') {
      subscription.activate();
      await this.subscriptionRepo.save(subscription);
    } else {
      subscription.markPastDue();
      await this.subscriptionRepo.save(subscription);
    }
  }

  private async expireTrialWithoutPayment(subscription: Subscription): Promise<void> {
    subscription.cancel('trial_expired_no_payment');
    await this.subscriptionRepo.save(subscription);
    
    // 이메일 발송
    await this.notificationService.sendTrialExpiredEmail(subscription.userId);
  }
}
```

### 2.5 업그레이드/다운그레이드 처리

```typescript
// application/use-cases/commands/change-plan.use-case.ts
@Injectable()
export class ChangePlanUseCase {
  async execute(dto: ChangePlanDto): Promise<ChangePlanResult> {
    const { subscriptionId, newPlanTier, effectiveDate = 'immediately' } = dto;

    const subscription = await this.subscriptionRepo.findById(subscriptionId);
    if (!subscription) {
      throw new SubscriptionNotFoundError(subscriptionId);
    }

    const currentTier = subscription.planTier;
    const isUpgrade = this.isPlanUpgrade(currentTier, newPlanTier);

    // 비례 계산 (Proration)
    const proration = await this.calculateProration(subscription, newPlanTier);

    if (effectiveDate === 'immediately') {
      return await this.applyPlanChangeImmediately(subscription, newPlanTier, proration, isUpgrade);
    } else {
      return await this.schedulePlanChangeAtPeriodEnd(subscription, newPlanTier);
    }
  }

  private isPlanUpgrade(current: PlanTier, newTier: PlanTier): boolean {
    const tierOrder: PlanTier[] = ['FREE', 'BASIC', 'PRO', 'ENTERPRISE'];
    return tierOrder.indexOf(newTier) > tierOrder.indexOf(current);
  }

  private async calculateProration(
    subscription: Subscription,
    newPlanTier: PlanTier,
  ): Promise<ProrationResult> {
    const daysUsed = differenceInDays(new Date(), subscription.currentPeriodStart);
    const totalDays = differenceInDays(subscription.currentPeriodEnd, subscription.currentPeriodStart);
    const remainingDays = totalDays - daysUsed;

    const currentDailyRate = this.getDailyRate(subscription.planTier);
    const newDailyRate = this.getDailyRate(newPlanTier);

    // 이미 사용한 금액
    const usedAmount = currentDailyRate * daysUsed;
    // 현재 플랜으로 남은 금액
    const currentRemainingValue = currentDailyRate * remainingDays;
    // 새 플랜으로 남은 기간 금액
    const newRemainingCost = newDailyRate * remainingDays;

    return {
      creditAmount: currentRemainingValue,  // 환불될 크레딧
      chargeAmount: newRemainingCost,        // 새로 청구될 금액
      netAmount: newRemainingCost - currentRemainingValue,  // 순 청구액 (음수면 환불)
      remainingDays,
    };
  }

  private async applyPlanChangeImmediately(
    subscription: Subscription,
    newPlanTier: PlanTier,
    proration: ProrationResult,
    isUpgrade: boolean,
  ): Promise<ChangePlanResult> {
    if (isUpgrade) {
      // 업그레이드: 차액 청구 후 즉시 적용
      if (proration.netAmount > 0) {
        await this.chargeProration(subscription.userId, proration.netAmount);
      }
      subscription.changePlan(newPlanTier);
    } else {
      // 다운그레이드: 크레딧으로 저장, 즉시 적용 또는 기간 종료 시 적용
      if (proration.netAmount < 0) {
        await this.addCredit(subscription.userId, Math.abs(proration.netAmount));
      }
      subscription.changePlan(newPlanTier);
    }

    await this.subscriptionRepo.save(subscription);

    return {
      subscription,
      proration,
      effectiveDate: new Date(),
    };
  }

  private async schedulePlanChangeAtPeriodEnd(
    subscription: Subscription,
    newPlanTier: PlanTier,
  ): Promise<ChangePlanResult> {
    subscription.schedulePlanChange(newPlanTier);
    await this.subscriptionRepo.save(subscription);

    return {
      subscription,
      proration: null,
      effectiveDate: subscription.currentPeriodEnd,
      scheduledPlanTier: newPlanTier,
    };
  }
}
```

---

## 3. 정기 결제 구현

### 3.1 Stripe Subscription API 연동

```typescript
// infrastructure/adapters/stripe-subscription.adapter.ts
import Stripe from 'stripe';

@Injectable()
export class StripeSubscriptionAdapter implements SubscriptionGatewayPort {
  private stripe: Stripe;

  constructor(private configService: ConfigService) {
    this.stripe = new Stripe(configService.get('STRIPE_SECRET_KEY'), {
      apiVersion: '2024-11-20.acacia',
    });
  }

  async createSubscription(params: CreateSubscriptionParams): Promise<ExternalSubscription> {
    const { customerId, priceId, trialDays, metadata } = params;

    const subscription = await this.stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      trial_period_days: trialDays,
      payment_behavior: 'default_incomplete',
      payment_settings: {
        save_default_payment_method: 'on_subscription',
      },
      expand: ['latest_invoice.payment_intent'],
      metadata,
    });

    return this.mapStripeSubscription(subscription);
  }

  async updateSubscription(
    subscriptionId: string,
    params: UpdateSubscriptionParams,
  ): Promise<ExternalSubscription> {
    const { priceId, prorationBehavior = 'create_prorations' } = params;

    const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
    
    const updated = await this.stripe.subscriptions.update(subscriptionId, {
      items: [{
        id: subscription.items.data[0].id,
        price: priceId,
      }],
      proration_behavior: prorationBehavior,
    });

    return this.mapStripeSubscription(updated);
  }

  async cancelSubscription(
    subscriptionId: string,
    options: CancelOptions = {},
  ): Promise<ExternalSubscription> {
    const { cancelAtPeriodEnd = true, reason } = options;

    if (cancelAtPeriodEnd) {
      // 기간 종료 시 취소
      const subscription = await this.stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: true,
        cancellation_details: {
          comment: reason,
        },
      });
      return this.mapStripeSubscription(subscription);
    } else {
      // 즉시 취소
      const subscription = await this.stripe.subscriptions.cancel(subscriptionId, {
        cancellation_details: {
          comment: reason,
        },
      });
      return this.mapStripeSubscription(subscription);
    }
  }

  async pauseSubscription(subscriptionId: string): Promise<ExternalSubscription> {
    const subscription = await this.stripe.subscriptions.update(subscriptionId, {
      pause_collection: {
        behavior: 'void',  // 'mark_uncollectible' | 'keep_as_draft' | 'void'
      },
    });
    return this.mapStripeSubscription(subscription);
  }

  async resumeSubscription(subscriptionId: string): Promise<ExternalSubscription> {
    const subscription = await this.stripe.subscriptions.update(subscriptionId, {
      pause_collection: null,
    });
    return this.mapStripeSubscription(subscription);
  }

  private mapStripeSubscription(stripe: Stripe.Subscription): ExternalSubscription {
    return {
      id: stripe.id,
      status: this.mapStatus(stripe.status),
      currentPeriodStart: new Date(stripe.current_period_start * 1000),
      currentPeriodEnd: new Date(stripe.current_period_end * 1000),
      cancelAtPeriodEnd: stripe.cancel_at_period_end,
      canceledAt: stripe.canceled_at ? new Date(stripe.canceled_at * 1000) : null,
      trialEnd: stripe.trial_end ? new Date(stripe.trial_end * 1000) : null,
      metadata: stripe.metadata,
    };
  }

  private mapStatus(stripeStatus: Stripe.Subscription.Status): SubscriptionStatus {
    const statusMap: Record<Stripe.Subscription.Status, SubscriptionStatus> = {
      'trialing': 'TRIALING',
      'active': 'ACTIVE',
      'past_due': 'PAST_DUE',
      'paused': 'PAUSED',
      'canceled': 'CANCELED',
      'unpaid': 'PAST_DUE',
      'incomplete': 'TRIALING',
      'incomplete_expired': 'EXPIRED',
    };
    return statusMap[stripeStatus];
  }
}
```

### 3.2 TossPayments 빌링키 연동

```typescript
// infrastructure/adapters/toss-billing.adapter.ts
@Injectable()
export class TossBillingAdapter implements SubscriptionGatewayPort {
  private readonly baseUrl = 'https://api.tosspayments.com/v1/billing';

  constructor(
    private httpService: HttpService,
    private configService: ConfigService,
  ) {}

  // 빌링키 발급
  async issueBillingKey(params: IssueBillingKeyParams): Promise<BillingKey> {
    const { customerKey, authKey } = params;

    const response = await this.httpService.axiosRef.post(
      `${this.baseUrl}/authorizations/issue`,
      { customerKey, authKey },
      { headers: this.getHeaders() },
    );

    return {
      billingKey: response.data.billingKey,
      customerKey: response.data.customerKey,
      cardInfo: {
        issuerCode: response.data.card.issuerCode,
        number: response.data.card.number,
        cardType: response.data.card.cardType,
      },
    };
  }

  // 정기 결제 실행
  async chargeWithBillingKey(params: ChargeParams): Promise<PaymentResult> {
    const { billingKey, customerKey, amount, orderId, orderName } = params;

    try {
      const response = await this.httpService.axiosRef.post(
        `${this.baseUrl}/${billingKey}`,
        {
          customerKey,
          amount,
          orderId,
          orderName,
        },
        { headers: this.getHeaders() },
      );

      return {
        success: true,
        paymentKey: response.data.paymentKey,
        orderId: response.data.orderId,
        amount: response.data.totalAmount,
        approvedAt: new Date(response.data.approvedAt),
      };
    } catch (error) {
      return {
        success: false,
        error: {
          code: error.response?.data?.code,
          message: error.response?.data?.message,
        },
      };
    }
  }

  // 자동 결제 스케줄링 (직접 구현 필요)
  async scheduleRecurringPayment(params: ScheduleParams): Promise<void> {
    // TossPayments는 자동 반복 결제 기능이 없으므로
    // 서버에서 스케줄러를 통해 직접 구현해야 함
    const job = {
      subscriptionId: params.subscriptionId,
      billingKey: params.billingKey,
      nextPaymentDate: params.nextPaymentDate,
      amount: params.amount,
    };

    await this.schedulerService.schedulePayment(job);
  }

  private getHeaders() {
    const secretKey = this.configService.get('TOSS_PAYMENTS_SECRET_KEY');
    const encodedKey = Buffer.from(`${secretKey}:`).toString('base64');
    
    return {
      Authorization: `Basic ${encodedKey}`,
      'Content-Type': 'application/json',
    };
  }
}
```

### 3.3 정기 결제 스케줄러 (TossPayments용)

```typescript
// application/services/billing-scheduler.service.ts
@Injectable()
export class BillingSchedulerService {
  constructor(
    @Inject('SubscriptionRepositoryPort')
    private readonly subscriptionRepo: SubscriptionRepositoryPort,
    @Inject('PaymentGatewayPort')
    private readonly paymentGateway: PaymentGatewayPort,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  // 매일 자정에 실행
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async processScheduledPayments(): Promise<void> {
    const dueSubscriptions = await this.subscriptionRepo.findDueForPayment();

    for (const subscription of dueSubscriptions) {
      await this.processPayment(subscription);
    }
  }

  private async processPayment(subscription: Subscription): Promise<void> {
    const billingKey = await this.getBillingKey(subscription.userId);
    
    if (!billingKey) {
      await this.handleMissingPaymentMethod(subscription);
      return;
    }

    const result = await this.paymentGateway.chargeWithBillingKey({
      billingKey: billingKey.key,
      customerKey: subscription.userId,
      amount: this.calculateAmount(subscription),
      orderId: `SUB_${subscription.id}_${Date.now()}`,
      orderName: `${subscription.planTier} 플랜 구독료`,
    });

    if (result.success) {
      await this.handlePaymentSuccess(subscription, result);
    } else {
      await this.handlePaymentFailure(subscription, result);
    }
  }

  private async handlePaymentSuccess(
    subscription: Subscription,
    result: PaymentResult,
  ): Promise<void> {
    // 구독 기간 연장
    subscription.renewPeriod();
    subscription.activate();
    await this.subscriptionRepo.save(subscription);

    // 결제 기록 저장
    await this.paymentRepo.save({
      subscriptionId: subscription.id,
      amount: result.amount,
      paymentKey: result.paymentKey,
      status: 'SUCCEEDED',
      paidAt: result.approvedAt,
    });

    // 이메일 발송
    await this.notificationService.sendPaymentSuccessEmail(subscription);
  }

  private async handlePaymentFailure(
    subscription: Subscription,
    result: PaymentResult,
  ): Promise<void> {
    // 재시도 로직으로 전환 (Dunning)
    subscription.markPastDue();
    await this.subscriptionRepo.save(subscription);

    // 실패 기록
    await this.paymentRepo.save({
      subscriptionId: subscription.id,
      amount: this.calculateAmount(subscription),
      status: 'FAILED',
      errorCode: result.error?.code,
      errorMessage: result.error?.message,
    });

    // 재시도 스케줄링
    await this.scheduleDunningRetry(subscription);
  }
}
```

### 3.4 Webhook 이벤트 처리

```typescript
// presentation/controllers/stripe-webhook.controller.ts
@Controller('webhooks/stripe')
export class StripeWebhookController {
  constructor(
    private readonly webhookService: StripeWebhookService,
    private configService: ConfigService,
  ) {}

  @Post()
  @HttpCode(200)
  async handleWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ): Promise<{ received: boolean }> {
    const event = this.verifyWebhookSignature(req.rawBody, signature);
    
    await this.webhookService.processEvent(event);
    
    return { received: true };
  }

  private verifyWebhookSignature(
    payload: Buffer,
    signature: string,
  ): Stripe.Event {
    const webhookSecret = this.configService.get('STRIPE_WEBHOOK_SECRET');
    
    try {
      return Stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    } catch (err) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
  }
}

// application/services/stripe-webhook.service.ts
@Injectable()
export class StripeWebhookService {
  constructor(
    private readonly subscriptionRepo: SubscriptionRepositoryPort,
    private readonly paymentRepo: PaymentRepositoryPort,
    private readonly notificationService: NotificationService,
  ) {}

  async processEvent(event: Stripe.Event): Promise<void> {
    // 멱등성 체크
    const isProcessed = await this.webhookLogRepo.exists(event.id);
    if (isProcessed) {
      return;
    }

    switch (event.type) {
      // 인보이스 결제 성공
      case 'invoice.paid':
        await this.handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;

      // 인보이스 결제 실패
      case 'invoice.payment_failed':
        await this.handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      // 구독 상태 변경
      case 'customer.subscription.updated':
        await this.handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;

      // 구독 삭제
      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      // Trial 곧 종료
      case 'customer.subscription.trial_will_end':
        await this.handleTrialWillEnd(event.data.object as Stripe.Subscription);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    // 처리 완료 기록
    await this.webhookLogRepo.save({
      eventId: event.id,
      eventType: event.type,
      processedAt: new Date(),
    });
  }

  private async handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
    const subscriptionId = invoice.subscription as string;
    const subscription = await this.subscriptionRepo.findByExternalId(subscriptionId);

    if (!subscription) return;

    // 구독 기간 갱신
    subscription.renewPeriod();
    subscription.activate();
    await this.subscriptionRepo.save(subscription);

    // 결제 기록
    await this.paymentRepo.save({
      subscriptionId: subscription.id,
      externalId: invoice.id,
      amount: invoice.amount_paid,
      currency: invoice.currency,
      status: 'SUCCEEDED',
      paidAt: new Date(invoice.status_transitions.paid_at * 1000),
    });

    // 결제 완료 알림
    await this.notificationService.sendPaymentSuccessEmail(subscription.userId, {
      amount: invoice.amount_paid,
      invoiceUrl: invoice.hosted_invoice_url,
    });
  }

  private async handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    const subscriptionId = invoice.subscription as string;
    const subscription = await this.subscriptionRepo.findByExternalId(subscriptionId);

    if (!subscription) return;

    subscription.markPastDue();
    await this.subscriptionRepo.save(subscription);

    // 결제 실패 알림
    await this.notificationService.sendPaymentFailedEmail(subscription.userId, {
      amount: invoice.amount_due,
      nextAttempt: invoice.next_payment_attempt 
        ? new Date(invoice.next_payment_attempt * 1000) 
        : null,
      updatePaymentUrl: this.generateUpdatePaymentUrl(subscription.userId),
    });
  }

  private async handleSubscriptionUpdated(stripeSubscription: Stripe.Subscription): Promise<void> {
    const subscription = await this.subscriptionRepo.findByExternalId(stripeSubscription.id);
    if (!subscription) return;

    // 상태 동기화
    subscription.syncWithExternal({
      status: this.mapStatus(stripeSubscription.status),
      currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
      cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
    });

    await this.subscriptionRepo.save(subscription);
  }

  private async handleSubscriptionDeleted(stripeSubscription: Stripe.Subscription): Promise<void> {
    const subscription = await this.subscriptionRepo.findByExternalId(stripeSubscription.id);
    if (!subscription) return;

    subscription.expire();
    await this.subscriptionRepo.save(subscription);

    // 구독 종료 알림
    await this.notificationService.sendSubscriptionEndedEmail(subscription.userId);
  }

  private async handleTrialWillEnd(stripeSubscription: Stripe.Subscription): Promise<void> {
    const subscription = await this.subscriptionRepo.findByExternalId(stripeSubscription.id);
    if (!subscription) return;

    // Trial 종료 3일 전 알림
    await this.notificationService.sendTrialEndingEmail(subscription.userId, {
      trialEndsAt: new Date(stripeSubscription.trial_end * 1000),
      planName: subscription.planTier,
    });
  }
}
```

---

## 4. 결제 실패 처리 (Dunning)

### 4.1 재시도 정책

```typescript
// domain/value-objects/dunning-config.vo.ts
export const DUNNING_CONFIG = {
  // 재시도 일정 (결제 실패 후 n일)
  retrySchedule: [1, 3, 7, 14],
  
  // 최대 재시도 횟수
  maxRetries: 4,
  
  // 유예 기간 (마지막 재시도 후 n일)
  gracePeriodDays: 7,
  
  // 알림 스케줄
  notificationSchedule: {
    paymentFailed: 0,      // 즉시
    firstReminder: 1,      // 1일 후
    secondReminder: 3,     // 3일 후
    finalWarning: 7,       // 7일 후 (서비스 중단 경고)
    serviceDisabled: 14,   // 14일 후 (서비스 중단)
  },
} as const;
```

### 4.2 Dunning 프로세스 구현

```typescript
// application/services/dunning.service.ts
@Injectable()
export class DunningService {
  constructor(
    @Inject('SubscriptionRepositoryPort')
    private readonly subscriptionRepo: SubscriptionRepositoryPort,
    @Inject('PaymentGatewayPort')
    private readonly paymentGateway: PaymentGatewayPort,
    private readonly notificationService: NotificationService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async processDunning(): Promise<void> {
    const pastDueSubscriptions = await this.subscriptionRepo.findByStatus('PAST_DUE');

    for (const subscription of pastDueSubscriptions) {
      await this.processSubscription(subscription);
    }
  }

  private async processSubscription(subscription: Subscription): Promise<void> {
    const failedPayment = await this.paymentRepo.findLatestFailed(subscription.id);
    const daysSinceFailure = differenceInDays(new Date(), failedPayment.createdAt);
    const retryCount = failedPayment.retryCount || 0;

    // 재시도 일정 확인
    const shouldRetry = DUNNING_CONFIG.retrySchedule.includes(daysSinceFailure);
    
    if (shouldRetry && retryCount < DUNNING_CONFIG.maxRetries) {
      await this.retryPayment(subscription, failedPayment);
    }

    // 유예 기간 종료 확인
    const totalDays = DUNNING_CONFIG.retrySchedule[DUNNING_CONFIG.retrySchedule.length - 1] 
      + DUNNING_CONFIG.gracePeriodDays;
    
    if (daysSinceFailure >= totalDays) {
      await this.handleGracePeriodExpired(subscription);
    }

    // 알림 발송
    await this.sendDunningNotification(subscription, daysSinceFailure);
  }

  private async retryPayment(
    subscription: Subscription,
    failedPayment: Payment,
  ): Promise<void> {
    const billingKey = await this.getBillingKey(subscription.userId);
    
    const result = await this.paymentGateway.chargeWithBillingKey({
      billingKey: billingKey.key,
      customerKey: subscription.userId,
      amount: failedPayment.amount,
      orderId: `RETRY_${failedPayment.id}_${Date.now()}`,
      orderName: `${subscription.planTier} 플랜 구독료 (재시도)`,
    });

    if (result.success) {
      subscription.activate();
      await this.subscriptionRepo.save(subscription);

      await this.notificationService.sendPaymentRecoveredEmail(subscription.userId);
    } else {
      await this.paymentRepo.incrementRetryCount(failedPayment.id);
    }
  }

  private async handleGracePeriodExpired(subscription: Subscription): Promise<void> {
    subscription.cancel('payment_failed_grace_expired');
    await this.subscriptionRepo.save(subscription);

    await this.notificationService.sendSubscriptionCanceledEmail(subscription.userId, {
      reason: '결제 실패로 인한 자동 해지',
      canReactivate: true,
    });
  }

  private async sendDunningNotification(
    subscription: Subscription,
    daysSinceFailure: number,
  ): Promise<void> {
    const { notificationSchedule } = DUNNING_CONFIG;

    // 중복 알림 방지
    const lastNotification = await this.notificationRepo.findLatest(
      subscription.userId,
      'dunning',
    );

    if (lastNotification && 
        isSameDay(lastNotification.sentAt, new Date())) {
      return;
    }

    if (daysSinceFailure === notificationSchedule.firstReminder) {
      await this.notificationService.sendDunningReminder(subscription.userId, {
        type: 'first_reminder',
        daysRemaining: 14 - daysSinceFailure,
      });
    } else if (daysSinceFailure === notificationSchedule.secondReminder) {
      await this.notificationService.sendDunningReminder(subscription.userId, {
        type: 'second_reminder',
        daysRemaining: 14 - daysSinceFailure,
      });
    } else if (daysSinceFailure === notificationSchedule.finalWarning) {
      await this.notificationService.sendFinalWarning(subscription.userId, {
        serviceDisabledAt: addDays(new Date(), 7),
      });
    }
  }
}
```

### 4.3 유예 기간 (Grace Period) UI

```tsx
// apps/web/components/subscription/GracePeriodBanner.tsx
'use client';

import { differenceInDays } from 'date-fns';
import { AlertTriangle } from 'lucide-react';
import { useSubscription } from '@/hooks/useSubscription';

export function GracePeriodBanner() {
  const { subscription, updatePaymentMethod } = useSubscription();

  if (subscription?.status !== 'PAST_DUE') {
    return null;
  }

  const daysRemaining = differenceInDays(
    subscription.gracePeriodEnd,
    new Date()
  );

  const urgencyColor = daysRemaining <= 3 
    ? 'bg-red-50 border-red-200 text-red-800'
    : daysRemaining <= 7
    ? 'bg-yellow-50 border-yellow-200 text-yellow-800'
    : 'bg-orange-50 border-orange-200 text-orange-800';

  return (
    <div className={`fixed top-0 left-0 right-0 z-50 p-4 border-b ${urgencyColor}`}>
      <div className="container mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-5 w-5" />
          <div>
            <p className="font-medium">결제 문제가 발생했습니다</p>
            <p className="text-sm opacity-80">
              {daysRemaining > 0 
                ? `${daysRemaining}일 내에 결제 수단을 업데이트하지 않으면 서비스가 중단됩니다.`
                : '오늘 결제 수단을 업데이트하지 않으면 서비스가 중단됩니다.'
              }
            </p>
          </div>
        </div>
        <button
          onClick={updatePaymentMethod}
          className="px-4 py-2 bg-white rounded-lg border shadow-sm hover:bg-gray-50"
        >
          결제 수단 업데이트
        </button>
      </div>
    </div>
  );
}
```

---

## 5. 취소 및 환불

### 5.1 취소 옵션

```typescript
// domain/value-objects/cancel-options.vo.ts
export interface CancelSubscriptionOptions {
  // 취소 시점
  cancelAt: 'immediately' | 'period_end';
  
  // 취소 사유
  reason: CancelReason;
  
  // 상세 사유 (사용자 입력)
  feedback?: string;
  
  // 환불 여부
  refund?: {
    type: 'full' | 'prorated' | 'none';
    amount?: number;
  };
}

export type CancelReason =
  | 'too_expensive'
  | 'not_using'
  | 'missing_features'
  | 'found_alternative'
  | 'temporary_pause'
  | 'technical_issues'
  | 'other';

export const CANCEL_REASON_LABELS: Record<CancelReason, string> = {
  too_expensive: '가격이 너무 비싸요',
  not_using: '서비스를 잘 사용하지 않아요',
  missing_features: '필요한 기능이 없어요',
  found_alternative: '다른 서비스를 찾았어요',
  temporary_pause: '잠시 쉬려고요',
  technical_issues: '기술적 문제가 있어요',
  other: '기타',
};
```

### 5.2 취소 처리

```typescript
// application/use-cases/commands/cancel-subscription.use-case.ts
@Injectable()
export class CancelSubscriptionUseCase {
  constructor(
    @Inject('SubscriptionRepositoryPort')
    private readonly subscriptionRepo: SubscriptionRepositoryPort,
    @Inject('PaymentGatewayPort')
    private readonly paymentGateway: PaymentGatewayPort,
    private readonly refundService: RefundService,
    private readonly feedbackService: FeedbackService,
  ) {}

  async execute(dto: CancelSubscriptionDto): Promise<CancelResult> {
    const { subscriptionId, options } = dto;

    const subscription = await this.subscriptionRepo.findById(subscriptionId);
    if (!subscription) {
      throw new SubscriptionNotFoundError(subscriptionId);
    }

    // 취소 사유 저장
    await this.feedbackService.saveCancelFeedback({
      subscriptionId,
      reason: options.reason,
      feedback: options.feedback,
    });

    // 환불 처리
    let refundResult: RefundResult | null = null;
    if (options.refund && options.refund.type !== 'none') {
      refundResult = await this.processRefund(subscription, options.refund);
    }

    // 구독 취소
    if (options.cancelAt === 'immediately') {
      await this.cancelImmediately(subscription, options.reason);
    } else {
      await this.cancelAtPeriodEnd(subscription, options.reason);
    }

    return {
      subscription,
      refund: refundResult,
      effectiveDate: options.cancelAt === 'immediately' 
        ? new Date() 
        : subscription.currentPeriodEnd,
    };
  }

  private async cancelImmediately(
    subscription: Subscription,
    reason: string,
  ): Promise<void> {
    // 외부 결제 시스템 취소
    await this.paymentGateway.cancelSubscription(subscription.externalId, {
      cancelAtPeriodEnd: false,
      reason,
    });

    subscription.cancel(reason);
    await this.subscriptionRepo.save(subscription);
  }

  private async cancelAtPeriodEnd(
    subscription: Subscription,
    reason: string,
  ): Promise<void> {
    // 외부 결제 시스템에 기간 종료 시 취소 설정
    await this.paymentGateway.cancelSubscription(subscription.externalId, {
      cancelAtPeriodEnd: true,
      reason,
    });

    subscription.scheduleCancellation(reason);
    await this.subscriptionRepo.save(subscription);
  }

  private async processRefund(
    subscription: Subscription,
    refundOptions: RefundOptions,
  ): Promise<RefundResult> {
    if (refundOptions.type === 'full') {
      return await this.refundService.processFullRefund(subscription);
    } else if (refundOptions.type === 'prorated') {
      return await this.refundService.processProration(subscription);
    }
    return null;
  }
}
```

### 5.3 비례 환불 (Proration) 계산

```typescript
// application/services/refund.service.ts
@Injectable()
export class RefundService {
  async calculateProration(subscription: Subscription): Promise<ProrationAmount> {
    const lastPayment = await this.paymentRepo.findLatestSuccessful(subscription.id);
    
    if (!lastPayment) {
      return { amount: 0, currency: 'KRW' };
    }

    const periodDays = differenceInDays(
      subscription.currentPeriodEnd,
      subscription.currentPeriodStart
    );
    
    const usedDays = differenceInDays(
      new Date(),
      subscription.currentPeriodStart
    );
    
    const remainingDays = periodDays - usedDays;
    
    // 일할 계산
    const dailyRate = lastPayment.amount / periodDays;
    const refundAmount = Math.floor(dailyRate * remainingDays);

    return {
      amount: refundAmount,
      currency: lastPayment.currency,
      periodDays,
      usedDays,
      remainingDays,
      dailyRate,
    };
  }

  async processProration(subscription: Subscription): Promise<RefundResult> {
    const proration = await this.calculateProration(subscription);
    
    if (proration.amount <= 0) {
      return {
        success: true,
        amount: 0,
        reason: 'NO_REFUND_DUE',
      };
    }

    const lastPayment = await this.paymentRepo.findLatestSuccessful(subscription.id);

    // Stripe 환불
    const refund = await this.paymentGateway.createRefund({
      paymentId: lastPayment.externalId,
      amount: proration.amount,
      reason: 'requested_by_customer',
    });

    // 환불 기록
    await this.refundRepo.save({
      subscriptionId: subscription.id,
      paymentId: lastPayment.id,
      amount: proration.amount,
      externalId: refund.id,
      status: 'SUCCEEDED',
    });

    return {
      success: true,
      amount: proration.amount,
      refundId: refund.id,
    };
  }
}
```

### 5.4 취소 사유 수집 및 윈백 전략

```tsx
// apps/web/components/subscription/CancelFlow.tsx
'use client';

import { useState } from 'react';
import { useSubscription } from '@/hooks/useSubscription';
import { CANCEL_REASON_LABELS, CancelReason } from '@/types/subscription';

interface CancelFlowProps {
  subscriptionId: string;
  onComplete: () => void;
}

export function CancelFlow({ subscriptionId, onComplete }: CancelFlowProps) {
  const [step, setStep] = useState<'reason' | 'offer' | 'confirm' | 'feedback'>('reason');
  const [reason, setReason] = useState<CancelReason | null>(null);
  const [feedback, setFeedback] = useState('');
  const { cancelSubscription, pauseSubscription } = useSubscription();

  // 윈백 제안 결정
  const getWinbackOffer = (reason: CancelReason) => {
    switch (reason) {
      case 'too_expensive':
        return {
          type: 'discount',
          title: '특별 할인 제안',
          description: '구독을 유지하시면 다음 3개월간 50% 할인해 드릴게요.',
          action: '할인 적용하기',
        };
      case 'not_using':
      case 'temporary_pause':
        return {
          type: 'pause',
          title: '잠시 일시정지는 어떨까요?',
          description: '구독을 취소하는 대신 최대 3개월까지 일시정지할 수 있어요.',
          action: '일시정지하기',
        };
      case 'missing_features':
        return {
          type: 'feedback',
          title: '어떤 기능이 필요하신가요?',
          description: '소중한 의견을 주시면 우선적으로 개발을 검토할게요.',
          action: '의견 남기기',
        };
      default:
        return null;
    }
  };

  const handleReasonSelect = (selectedReason: CancelReason) => {
    setReason(selectedReason);
    const offer = getWinbackOffer(selectedReason);
    setStep(offer ? 'offer' : 'confirm');
  };

  const handleAcceptOffer = async () => {
    if (!reason) return;

    const offer = getWinbackOffer(reason);
    if (offer?.type === 'pause') {
      await pauseSubscription(subscriptionId, { months: 3 });
      onComplete();
    } else if (offer?.type === 'discount') {
      // 할인 쿠폰 적용 로직
      onComplete();
    }
  };

  const handleConfirmCancel = async () => {
    await cancelSubscription(subscriptionId, {
      cancelAt: 'period_end',
      reason: reason!,
      feedback,
    });
    setStep('feedback');
  };

  return (
    <div className="max-w-lg mx-auto p-6">
      {/* Step 1: 취소 사유 선택 */}
      {step === 'reason' && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">떠나시는 이유가 무엇인가요?</h2>
          <p className="text-gray-600">
            더 나은 서비스를 만들기 위해 의견을 들려주세요.
          </p>
          <div className="space-y-2">
            {Object.entries(CANCEL_REASON_LABELS).map(([key, label]) => (
              <button
                key={key}
                onClick={() => handleReasonSelect(key as CancelReason)}
                className="w-full p-4 text-left border rounded-lg hover:bg-gray-50"
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 2: 윈백 제안 */}
      {step === 'offer' && reason && (
        <div className="space-y-4">
          {(() => {
            const offer = getWinbackOffer(reason);
            return offer ? (
              <>
                <div className="p-6 bg-blue-50 rounded-xl">
                  <h3 className="text-lg font-semibold text-blue-900">
                    {offer.title}
                  </h3>
                  <p className="mt-2 text-blue-700">{offer.description}</p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={handleAcceptOffer}
                    className="flex-1 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    {offer.action}
                  </button>
                  <button
                    onClick={() => setStep('confirm')}
                    className="flex-1 py-3 border rounded-lg hover:bg-gray-50"
                  >
                    그래도 취소할게요
                  </button>
                </div>
              </>
            ) : null;
          })()}
        </div>
      )}

      {/* Step 3: 최종 확인 */}
      {step === 'confirm' && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">정말 취소하시겠어요?</h2>
          <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-yellow-800">
              현재 결제 주기가 끝나면 구독이 종료됩니다.
              그때까지는 모든 기능을 계속 사용하실 수 있어요.
            </p>
          </div>
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="추가로 남기실 말씀이 있으신가요? (선택)"
            className="w-full p-3 border rounded-lg resize-none h-24"
          />
          <div className="flex gap-3">
            <button
              onClick={() => setStep('reason')}
              className="flex-1 py-3 border rounded-lg hover:bg-gray-50"
            >
              돌아가기
            </button>
            <button
              onClick={handleConfirmCancel}
              className="flex-1 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700"
            >
              구독 취소
            </button>
          </div>
        </div>
      )}

      {/* Step 4: 완료 + 피드백 감사 */}
      {step === 'feedback' && (
        <div className="text-center space-y-4">
          <div className="w-16 h-16 mx-auto bg-green-100 rounded-full flex items-center justify-center">
            <span className="text-2xl">✓</span>
          </div>
          <h2 className="text-xl font-semibold">취소가 완료되었습니다</h2>
          <p className="text-gray-600">
            소중한 의견 감사합니다.<br />
            언제든 다시 돌아오셔도 환영해요! 🙌
          </p>
          <button
            onClick={onComplete}
            className="px-6 py-2 bg-gray-900 text-white rounded-lg"
          >
            확인
          </button>
        </div>
      )}
    </div>
  );
}
```

---

## 6. Clean Architecture 구현 예시

### 6.1 디렉토리 구조

```
apps/backend/src/modules/subscription/
├── domain/
│   ├── entities/
│   │   └── subscription.entity.ts
│   ├── value-objects/
│   │   ├── billing-cycle.vo.ts
│   │   ├── plan-tier.vo.ts
│   │   └── subscription-status.vo.ts
│   ├── events/
│   │   ├── subscription-created.event.ts
│   │   ├── subscription-canceled.event.ts
│   │   └── subscription-renewed.event.ts
│   └── ports/
│       ├── subscription.repository.port.ts
│       └── subscription-gateway.port.ts
│
├── application/
│   ├── commands/
│   │   ├── create-subscription.use-case.ts
│   │   ├── cancel-subscription.use-case.ts
│   │   ├── change-plan.use-case.ts
│   │   └── process-payment.use-case.ts
│   ├── queries/
│   │   ├── get-subscription-status.use-case.ts
│   │   └── get-subscription-history.use-case.ts
│   ├── services/
│   │   ├── feature-gate.service.ts
│   │   ├── dunning.service.ts
│   │   └── refund.service.ts
│   └── dtos/
│       ├── create-subscription.dto.ts
│       └── change-plan.dto.ts
│
├── infrastructure/
│   ├── adapters/
│   │   ├── stripe-subscription.adapter.ts
│   │   ├── toss-billing.adapter.ts
│   │   └── prisma-subscription.repository.ts
│   └── persistence/
│       └── subscription.schema.prisma
│
└── presentation/
    ├── controllers/
    │   ├── subscription.controller.ts
    │   └── webhook.controller.ts
    └── guards/
        └── subscription.guard.ts
```

### 6.2 Entity 구현

```typescript
// domain/entities/subscription.entity.ts
import { BillingCycle } from '../value-objects/billing-cycle.vo';
import { SubscriptionStatus } from '../value-objects/subscription-status.vo';
import { PlanTier } from '../value-objects/plan-tier.vo';

export interface SubscriptionProps {
  id: string;
  userId: string;
  planTier: PlanTier;
  status: SubscriptionStatus;
  billingCycle: BillingCycle;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  trialEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  cancelReason: string | null;
  externalId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export class Subscription {
  private props: SubscriptionProps;

  private constructor(props: SubscriptionProps) {
    this.props = props;
  }

  static create(input: Omit<SubscriptionProps, 'id' | 'createdAt' | 'updatedAt'>): Subscription {
    return new Subscription({
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  static fromPersistence(data: SubscriptionProps): Subscription {
    return new Subscription(data);
  }

  // Getters
  get id(): string { return this.props.id; }
  get userId(): string { return this.props.userId; }
  get planTier(): PlanTier { return this.props.planTier; }
  get status(): SubscriptionStatus { return this.props.status; }
  get billingCycle(): BillingCycle { return this.props.billingCycle; }
  get currentPeriodStart(): Date { return this.props.currentPeriodStart; }
  get currentPeriodEnd(): Date { return this.props.currentPeriodEnd; }
  get trialEnd(): Date | null { return this.props.trialEnd; }
  get cancelAtPeriodEnd(): boolean { return this.props.cancelAtPeriodEnd; }
  get externalId(): string | null { return this.props.externalId; }

  // 상태 확인 메서드
  isActive(): boolean {
    return this.props.status === 'ACTIVE';
  }

  isTrialing(): boolean {
    return this.props.status === 'TRIALING';
  }

  isPastDue(): boolean {
    return this.props.status === 'PAST_DUE';
  }

  canAccessFeatures(): boolean {
    return ['ACTIVE', 'TRIALING', 'PAST_DUE'].includes(this.props.status);
  }

  // 상태 변경 메서드
  activate(): void {
    this.props.status = 'ACTIVE';
    this.props.updatedAt = new Date();
  }

  markPastDue(): void {
    this.props.status = 'PAST_DUE';
    this.props.updatedAt = new Date();
  }

  cancel(reason: string): void {
    this.props.status = 'CANCELED';
    this.props.canceledAt = new Date();
    this.props.cancelReason = reason;
    this.props.updatedAt = new Date();
  }

  scheduleCancellation(reason: string): void {
    this.props.cancelAtPeriodEnd = true;
    this.props.cancelReason = reason;
    this.props.updatedAt = new Date();
  }

  expire(): void {
    this.props.status = 'EXPIRED';
    this.props.updatedAt = new Date();
  }

  pause(): void {
    this.props.status = 'PAUSED';
    this.props.updatedAt = new Date();
  }

  resume(): void {
    this.props.status = 'ACTIVE';
    this.props.updatedAt = new Date();
  }

  renewPeriod(): void {
    const periodLength = this.props.billingCycle === 'MONTHLY' ? 30 : 365;
    this.props.currentPeriodStart = new Date();
    this.props.currentPeriodEnd = addDays(new Date(), periodLength);
    this.props.updatedAt = new Date();
  }

  changePlan(newPlanTier: PlanTier): void {
    this.props.planTier = newPlanTier;
    this.props.updatedAt = new Date();
  }

  schedulePlanChange(newPlanTier: PlanTier): void {
    this.props.metadata = {
      ...this.props.metadata,
      scheduledPlanChange: newPlanTier,
    };
    this.props.updatedAt = new Date();
  }

  syncWithExternal(data: {
    status: SubscriptionStatus;
    currentPeriodEnd: Date;
    cancelAtPeriodEnd: boolean;
  }): void {
    this.props.status = data.status;
    this.props.currentPeriodEnd = data.currentPeriodEnd;
    this.props.cancelAtPeriodEnd = data.cancelAtPeriodEnd;
    this.props.updatedAt = new Date();
  }

  setExternalId(externalId: string): void {
    this.props.externalId = externalId;
    this.props.updatedAt = new Date();
  }

  toPersistence(): SubscriptionProps {
    return { ...this.props };
  }
}
```

### 6.3 Value Objects

```typescript
// domain/value-objects/billing-cycle.vo.ts
export type BillingCycle = 'MONTHLY' | 'YEARLY';

export const BILLING_CYCLE_DAYS: Record<BillingCycle, number> = {
  MONTHLY: 30,
  YEARLY: 365,
};

export function calculateNextBillingDate(
  currentDate: Date,
  cycle: BillingCycle,
): Date {
  return addDays(currentDate, BILLING_CYCLE_DAYS[cycle]);
}
```

### 6.4 Repository Port

```typescript
// domain/ports/subscription.repository.port.ts
import { Subscription } from '../entities/subscription.entity';
import { SubscriptionStatus } from '../value-objects/subscription-status.vo';

export interface SubscriptionRepositoryPort {
  findById(id: string): Promise<Subscription | null>;
  findByUserId(userId: string): Promise<Subscription[]>;
  findActiveByUserId(userId: string): Promise<Subscription | null>;
  findByExternalId(externalId: string): Promise<Subscription | null>;
  findByStatus(status: SubscriptionStatus): Promise<Subscription[]>;
  findExpiredTrials(): Promise<Subscription[]>;
  findDueForPayment(): Promise<Subscription[]>;
  findTrialHistoryByUserId(userId: string): Promise<Subscription | null>;
  save(subscription: Subscription): Promise<Subscription>;
  delete(id: string): Promise<void>;
}
```

### 6.5 Use Case 구현

```typescript
// application/commands/create-subscription.use-case.ts
@Injectable()
export class CreateSubscriptionUseCase {
  constructor(
    @Inject('SubscriptionRepositoryPort')
    private readonly subscriptionRepo: SubscriptionRepositoryPort,
    @Inject('SubscriptionGatewayPort')
    private readonly subscriptionGateway: SubscriptionGatewayPort,
    @Inject('EventEmitterPort')
    private readonly eventEmitter: EventEmitterPort,
  ) {}

  async execute(dto: CreateSubscriptionDto): Promise<Subscription> {
    const { userId, planTier, billingCycle, paymentMethodId, trialDays } = dto;

    // 기존 활성 구독 확인
    const existingSubscription = await this.subscriptionRepo.findActiveByUserId(userId);
    if (existingSubscription) {
      throw new SubscriptionAlreadyExistsError(userId);
    }

    // 외부 결제 시스템에 구독 생성
    const externalSubscription = await this.subscriptionGateway.createSubscription({
      customerId: userId, // 또는 별도의 customer ID
      priceId: this.getPriceId(planTier, billingCycle),
      trialDays,
      metadata: { userId, planTier },
    });

    // 내부 구독 엔티티 생성
    const subscription = Subscription.create({
      userId,
      planTier,
      billingCycle,
      status: trialDays ? 'TRIALING' : 'ACTIVE',
      currentPeriodStart: externalSubscription.currentPeriodStart,
      currentPeriodEnd: externalSubscription.currentPeriodEnd,
      trialEnd: externalSubscription.trialEnd,
      cancelAtPeriodEnd: false,
      canceledAt: null,
      cancelReason: null,
      externalId: externalSubscription.id,
      metadata: {},
    });

    const saved = await this.subscriptionRepo.save(subscription);

    // 이벤트 발행
    await this.eventEmitter.emit('subscription.created', {
      subscriptionId: saved.id,
      userId,
      planTier,
      billingCycle,
    });

    return saved;
  }

  private getPriceId(planTier: PlanTier, billingCycle: BillingCycle): string {
    // Stripe Price ID 매핑
    const priceMap: Record<string, string> = {
      'BASIC_MONTHLY': 'price_xxx',
      'BASIC_YEARLY': 'price_yyy',
      'PRO_MONTHLY': 'price_zzz',
      'PRO_YEARLY': 'price_aaa',
    };
    return priceMap[`${planTier}_${billingCycle}`];
  }
}
```

### 6.6 Query Use Case

```typescript
// application/queries/get-subscription-status.use-case.ts
@Injectable()
export class GetSubscriptionStatusUseCase {
  constructor(
    @Inject('SubscriptionRepositoryPort')
    private readonly subscriptionRepo: SubscriptionRepositoryPort,
  ) {}

  async execute(userId: string): Promise<SubscriptionStatusResult> {
    const subscription = await this.subscriptionRepo.findActiveByUserId(userId);

    if (!subscription) {
      return {
        hasSubscription: false,
        status: null,
        planTier: 'FREE',
        features: FEATURE_MATRIX['FREE'],
        canAccessPremiumFeatures: false,
      };
    }

    return {
      hasSubscription: true,
      status: subscription.status,
      planTier: subscription.planTier,
      billingCycle: subscription.billingCycle,
      currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      features: FEATURE_MATRIX[subscription.planTier],
      canAccessPremiumFeatures: subscription.canAccessFeatures(),
      trialEnd: subscription.trialEnd,
      isTrialing: subscription.isTrialing(),
    };
  }
}
```

---

## 7. 프론트엔드 통합

### 7.1 구독 상태 훅

```typescript
// apps/web/hooks/useSubscription.ts
'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { subscriptionApi } from '@/lib/api/subscription';
import { toast } from 'sonner';

export function useSubscription() {
  const queryClient = useQueryClient();

  const { data: subscription, isLoading, error } = useQuery({
    queryKey: ['subscription'],
    queryFn: subscriptionApi.getStatus,
    staleTime: 1000 * 60 * 5, // 5분
  });

  const createSubscriptionMutation = useMutation({
    mutationFn: subscriptionApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
      toast.success('구독이 시작되었습니다!');
    },
    onError: (error) => {
      toast.error('구독 생성에 실패했습니다');
    },
  });

  const cancelSubscriptionMutation = useMutation({
    mutationFn: subscriptionApi.cancel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
      toast.success('구독이 취소되었습니다');
    },
  });

  const changePlanMutation = useMutation({
    mutationFn: subscriptionApi.changePlan,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
      toast.success('플랜이 변경되었습니다');
    },
  });

  return {
    subscription,
    isLoading,
    error,
    createSubscription: createSubscriptionMutation.mutate,
    cancelSubscription: cancelSubscriptionMutation.mutate,
    changePlan: changePlanMutation.mutate,
    isCreating: createSubscriptionMutation.isPending,
    isCanceling: cancelSubscriptionMutation.isPending,
  };
}
```

### 7.2 구독 상태 표시 UI

```tsx
// apps/web/components/subscription/SubscriptionStatus.tsx
'use client';

import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
import { useSubscription } from '@/hooks/useSubscription';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';

const STATUS_BADGES = {
  ACTIVE: { label: '활성', variant: 'success' as const },
  TRIALING: { label: '무료 체험', variant: 'info' as const },
  PAST_DUE: { label: '연체', variant: 'warning' as const },
  CANCELED: { label: '취소됨', variant: 'secondary' as const },
  PAUSED: { label: '일시정지', variant: 'secondary' as const },
  EXPIRED: { label: '만료', variant: 'destructive' as const },
};

export function SubscriptionStatus() {
  const { subscription, isLoading } = useSubscription();

  if (isLoading) {
    return <SubscriptionStatusSkeleton />;
  }

  if (!subscription?.hasSubscription) {
    return (
      <Card className="p-6">
        <h3 className="text-lg font-semibold">무료 플랜</h3>
        <p className="mt-2 text-gray-600">
          프리미엄 기능을 사용하려면 구독을 시작하세요.
        </p>
        <a
          href="/pricing"
          className="mt-4 inline-block px-4 py-2 bg-blue-600 text-white rounded-lg"
        >
          플랜 보기
        </a>
      </Card>
    );
  }

  const statusBadge = STATUS_BADGES[subscription.status];

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold">{subscription.planTier} 플랜</h3>
            <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
          </div>
          <p className="mt-1 text-gray-600">
            {subscription.billingCycle === 'MONTHLY' ? '월간' : '연간'} 결제
          </p>
        </div>
        <a href="/settings/billing" className="text-blue-600 hover:underline">
          관리
        </a>
      </div>

      <div className="mt-4 pt-4 border-t space-y-2">
        {subscription.isTrialing && subscription.trialEnd && (
          <p className="text-sm">
            <span className="text-gray-600">무료 체험 종료:</span>{' '}
            <span className="font-medium">
              {format(subscription.trialEnd, 'yyyy년 M월 d일', { locale: ko })}
            </span>
          </p>
        )}
        
        <p className="text-sm">
          <span className="text-gray-600">
            {subscription.cancelAtPeriodEnd ? '종료 예정일:' : '다음 결제일:'}
          </span>{' '}
          <span className="font-medium">
            {format(subscription.currentPeriodEnd, 'yyyy년 M월 d일', { locale: ko })}
          </span>
        </p>

        {subscription.cancelAtPeriodEnd && (
          <p className="text-sm text-orange-600">
            구독이 종료될 예정입니다. 계속 사용하시려면 취소를 철회하세요.
          </p>
        )}
      </div>
    </Card>
  );
}
```

### 7.3 플랜 선택 컴포넌트

```tsx
// apps/web/components/subscription/PricingPlans.tsx
'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { PRICING_CONFIG, FEATURE_MATRIX } from '@/constants/pricing';
import { PlanTier, BillingCycle } from '@/types/subscription';
import { formatCurrency } from '@/utils/format';

interface PricingPlansProps {
  currentPlan?: PlanTier;
  onSelectPlan: (plan: PlanTier, cycle: BillingCycle) => void;
}

export function PricingPlans({ currentPlan, onSelectPlan }: PricingPlansProps) {
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('MONTHLY');

  const plans: PlanTier[] = ['FREE', 'BASIC', 'PRO', 'ENTERPRISE'];

  return (
    <div className="py-12">
      {/* 결제 주기 토글 */}
      <div className="flex justify-center mb-8">
        <div className="inline-flex p-1 bg-gray-100 rounded-lg">
          <button
            onClick={() => setBillingCycle('MONTHLY')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition ${
              billingCycle === 'MONTHLY'
                ? 'bg-white shadow'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            월간 결제
          </button>
          <button
            onClick={() => setBillingCycle('YEARLY')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition ${
              billingCycle === 'YEARLY'
                ? 'bg-white shadow'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            연간 결제
            <span className="ml-1 text-xs text-green-600">17% 할인</span>
          </button>
        </div>
      </div>

      {/* 플랜 카드 그리드 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
        {plans.map((plan) => {
          const pricing = PRICING_CONFIG[plan];
          const features = FEATURE_MATRIX[plan];
          const price = billingCycle === 'MONTHLY' 
            ? pricing.monthly 
            : pricing.yearly;
          const isCurrentPlan = currentPlan === plan;
          const isPopular = plan === 'PRO';

          return (
            <div
              key={plan}
              className={`relative p-6 bg-white rounded-2xl border-2 ${
                isPopular 
                  ? 'border-blue-500 shadow-lg' 
                  : 'border-gray-200'
              }`}
            >
              {isPopular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="px-3 py-1 bg-blue-500 text-white text-xs font-medium rounded-full">
                    인기
                  </span>
                </div>
              )}

              <h3 className="text-xl font-bold">{plan}</h3>
              
              <div className="mt-4">
                {price !== null ? (
                  <>
                    <span className="text-4xl font-bold">
                      {formatCurrency(price)}
                    </span>
                    <span className="text-gray-600">
                      /{billingCycle === 'MONTHLY' ? '월' : '년'}
                    </span>
                  </>
                ) : (
                  <span className="text-2xl font-bold">문의</span>
                )}
              </div>

              <ul className="mt-6 space-y-3">
                {features.slice(0, 5).map((feature) => (
                  <li 
                    key={feature.key}
                    className={`flex items-start gap-2 text-sm ${
                      feature.included ? 'text-gray-900' : 'text-gray-400'
                    }`}
                  >
                    <Check 
                      className={`w-4 h-4 mt-0.5 ${
                        feature.included ? 'text-green-500' : 'text-gray-300'
                      }`} 
                    />
                    <span>
                      {feature.name}
                      {feature.limit !== undefined && (
                        <span className="text-gray-500">
                          {' '}({feature.limit === -1 ? '무제한' : feature.limit})
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>

              <button
                onClick={() => onSelectPlan(plan, billingCycle)}
                disabled={isCurrentPlan || plan === 'FREE'}
                className={`mt-6 w-full py-3 rounded-lg font-medium transition ${
                  isCurrentPlan
                    ? 'bg-gray-100 text-gray-500 cursor-not-allowed'
                    : isPopular
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-gray-900 text-white hover:bg-gray-800'
                } ${plan === 'FREE' ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {isCurrentPlan 
                  ? '현재 플랜' 
                  : plan === 'ENTERPRISE' 
                  ? '문의하기' 
                  : '시작하기'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

### 7.4 결제 수단 관리

```tsx
// apps/web/components/subscription/PaymentMethodManager.tsx
'use client';

import { useState } from 'react';
import { CreditCard, Plus, Trash2, Check } from 'lucide-react';
import { usePaymentMethods } from '@/hooks/usePaymentMethods';
import { PaymentMethod } from '@/types/payment';

export function PaymentMethodManager() {
  const { 
    paymentMethods, 
    defaultMethodId,
    addPaymentMethod,
    removePaymentMethod,
    setDefaultMethod,
    isLoading,
  } = usePaymentMethods();
  const [isAdding, setIsAdding] = useState(false);

  const handleAddMethod = async () => {
    setIsAdding(true);
    // Stripe Elements 또는 TossPayments 위젯 열기
    await addPaymentMethod();
    setIsAdding(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">결제 수단</h3>
        <button
          onClick={handleAddMethod}
          disabled={isAdding}
          className="flex items-center gap-2 px-3 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-800"
        >
          <Plus className="w-4 h-4" />
          추가
        </button>
      </div>

      {paymentMethods.length === 0 ? (
        <div className="p-6 text-center border rounded-lg border-dashed">
          <CreditCard className="w-8 h-8 mx-auto text-gray-400" />
          <p className="mt-2 text-gray-600">등록된 결제 수단이 없습니다</p>
        </div>
      ) : (
        <div className="space-y-3">
          {paymentMethods.map((method) => (
            <PaymentMethodCard
              key={method.id}
              method={method}
              isDefault={method.id === defaultMethodId}
              onSetDefault={() => setDefaultMethod(method.id)}
              onRemove={() => removePaymentMethod(method.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface PaymentMethodCardProps {
  method: PaymentMethod;
  isDefault: boolean;
  onSetDefault: () => void;
  onRemove: () => void;
}

function PaymentMethodCard({ 
  method, 
  isDefault, 
  onSetDefault, 
  onRemove 
}: PaymentMethodCardProps) {
  const cardBrandLogos: Record<string, string> = {
    visa: '/icons/visa.svg',
    mastercard: '/icons/mastercard.svg',
    amex: '/icons/amex.svg',
  };

  return (
    <div className={`p-4 border rounded-lg ${isDefault ? 'border-blue-500 bg-blue-50' : ''}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <img 
            src={cardBrandLogos[method.card.brand] || '/icons/card.svg'} 
            alt={method.card.brand}
            className="w-10 h-6 object-contain"
          />
          <div>
            <p className="font-medium">
              •••• •••• •••• {method.card.last4}
            </p>
            <p className="text-sm text-gray-600">
              {method.card.expMonth}/{method.card.expYear}
            </p>
          </div>
          {isDefault && (
            <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded">
              기본
            </span>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          {!isDefault && (
            <button
              onClick={onSetDefault}
              className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded"
              title="기본으로 설정"
            >
              <Check className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onRemove}
            className="p-2 text-gray-600 hover:text-red-600 hover:bg-red-50 rounded"
            title="삭제"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
```

---

## 8. 체크리스트

### 구현 완료 체크리스트

#### 도메인 레이어
- [ ] Subscription Entity 구현
- [ ] BillingCycle, PlanTier, SubscriptionStatus Value Objects
- [ ] SubscriptionRepositoryPort 정의
- [ ] SubscriptionGatewayPort 정의
- [ ] Domain Events 정의

#### 애플리케이션 레이어
- [ ] CreateSubscription UseCase
- [ ] CancelSubscription UseCase
- [ ] ChangePlan UseCase
- [ ] GetSubscriptionStatus Query
- [ ] FeatureGateService
- [ ] DunningService
- [ ] RefundService

#### 인프라스트럭처 레이어
- [ ] Stripe Subscription Adapter
- [ ] TossPayments Billing Adapter
- [ ] Prisma Subscription Repository

#### 프레젠테이션 레이어
- [ ] Subscription Controller
- [ ] Webhook Controller
- [ ] Subscription Guard

#### 프론트엔드
- [ ] useSubscription Hook
- [ ] SubscriptionStatus 컴포넌트
- [ ] PricingPlans 컴포넌트
- [ ] PaymentMethodManager 컴포넌트
- [ ] CancelFlow 컴포넌트
- [ ] GracePeriodBanner 컴포넌트

#### 테스트
- [ ] Subscription Entity 단위 테스트
- [ ] UseCase 단위 테스트 (Mock Repository)
- [ ] Webhook Handler 통합 테스트
- [ ] E2E 구독 플로우 테스트

---

*v1.0.0 | 2025-01-03*
