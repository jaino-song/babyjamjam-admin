# Mobile Payments Integration Guide

Expo/React Native 모바일 앱에서의 결제 통합 가이드입니다.

## 📱 결제 유형

| 유형 | 사용 시나리오 | 플랫폼 수수료 |
|------|--------------|--------------|
| **In-App Purchase (IAP)** | 디지털 콘텐츠, 구독 | 15-30% |
| **외부 결제 (Stripe/Toss)** | 실물 상품, 서비스 | 2.5-3.5% |

> ⚠️ **Apple/Google 정책**: 앱 내 디지털 콘텐츠는 반드시 IAP 사용 필수

---

## 📦 패키지 설치

### Expo IAP
```bash
npx expo install expo-in-app-purchases
```

### React Native IAP (Bare workflow)
```bash
npm install react-native-iap
```

### Stripe React Native
```bash
npm install @stripe/stripe-react-native
npx expo install expo-build-properties
```

---

## 🛒 In-App Purchase (IAP)

### 1. App Store / Play Store 설정

#### iOS (App Store Connect)
1. App Store Connect → 앱 선택 → "인앱 구입" 
2. 상품 유형 선택:
   - **소모성 (Consumable)**: 코인, 보석 등
   - **비소모성 (Non-consumable)**: 프리미엄 기능 잠금 해제
   - **자동 갱신 구독**: 월간/연간 구독
   - **비갱신 구독**: 시즌 패스

#### Android (Google Play Console)
1. Play Console → 앱 선택 → "수익 창출" → "상품"
2. 상품 유형:
   - **관리 제품**: 일회성 구매
   - **구독**: 정기 결제

### 2. Expo IAP 구현

```typescript
// src/hooks/use-iap.ts
import { useEffect, useState } from 'react';
import * as InAppPurchases from 'expo-in-app-purchases';
import { Platform } from 'react-native';

const PRODUCT_IDS = {
  ios: ['com.myapp.premium_monthly', 'com.myapp.premium_yearly'],
  android: ['premium_monthly', 'premium_yearly'],
};

export function useIAP() {
  const [products, setProducts] = useState<InAppPurchases.IAPItemDetails[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPurchasing, setIsPurchasing] = useState(false);

  useEffect(() => {
    initIAP();

    // 구매 리스너
    const purchaseListener = InAppPurchases.setPurchaseListener(
      async ({ responseCode, results }) => {
        if (responseCode === InAppPurchases.IAPResponseCode.OK && results) {
          for (const purchase of results) {
            if (!purchase.acknowledged) {
              await processPurchase(purchase);
            }
          }
        }
      }
    );

    return () => {
      purchaseListener.remove();
      InAppPurchases.disconnectAsync();
    };
  }, []);

  const initIAP = async () => {
    try {
      await InAppPurchases.connectAsync();
      
      const productIds = Platform.OS === 'ios' 
        ? PRODUCT_IDS.ios 
        : PRODUCT_IDS.android;
      
      const { results } = await InAppPurchases.getProductsAsync(productIds);
      setProducts(results ?? []);
    } catch (error) {
      console.error('IAP init error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const purchase = async (productId: string) => {
    setIsPurchasing(true);
    try {
      await InAppPurchases.purchaseItemAsync(productId);
    } catch (error) {
      console.error('Purchase error:', error);
      throw error;
    } finally {
      setIsPurchasing(false);
    }
  };

  const processPurchase = async (purchase: InAppPurchases.InAppPurchase) => {
    try {
      // 1. 서버로 영수증 전송하여 검증
      const response = await fetch(`${API_URL}/iap/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: Platform.OS,
          productId: purchase.productId,
          receipt: Platform.OS === 'ios' 
            ? purchase.transactionReceipt 
            : purchase.purchaseToken,
          transactionId: purchase.transactionId,
        }),
      });

      if (!response.ok) {
        throw new Error('Server verification failed');
      }

      // 2. 구매 완료 처리 (소모품인 경우)
      await InAppPurchases.finishTransactionAsync(purchase, true);
      
    } catch (error) {
      console.error('Process purchase error:', error);
      // 검증 실패 시 재시도 로직
    }
  };

  const restorePurchases = async () => {
    try {
      const { results } = await InAppPurchases.getPurchaseHistoryAsync();
      // 구매 내역 복원 처리
      return results;
    } catch (error) {
      console.error('Restore error:', error);
      throw error;
    }
  };

  return {
    products,
    isLoading,
    isPurchasing,
    purchase,
    restorePurchases,
  };
}
```

### 3. IAP UI 컴포넌트

```typescript
// src/components/subscription/subscription-plans.tsx
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useIAP } from '@/hooks/use-iap';

export function SubscriptionPlans() {
  const { products, isLoading, isPurchasing, purchase } = useIAP();

  if (isLoading) {
    return <ActivityIndicator size="large" />;
  }

  return (
    <View className="p-4 space-y-4">
      <Text className="text-2xl font-bold">프리미엄 구독</Text>
      
      {products.map((product) => (
        <TouchableOpacity
          key={product.productId}
          onPress={() => purchase(product.productId)}
          disabled={isPurchasing}
          className="bg-white p-4 rounded-xl shadow"
        >
          <Text className="text-lg font-semibold">{product.title}</Text>
          <Text className="text-gray-600">{product.description}</Text>
          <Text className="text-2xl font-bold text-blue-600 mt-2">
            {product.price}
          </Text>
        </TouchableOpacity>
      ))}

      {isPurchasing && (
        <View className="absolute inset-0 bg-black/50 items-center justify-center">
          <ActivityIndicator size="large" color="white" />
        </View>
      )}
    </View>
  );
}
```

### 4. Backend 영수증 검증

```typescript
// src/iap/application/use-cases/verify-receipt.use-case.ts
import { Injectable, Inject } from '@nestjs/common';
import { AppleReceiptVerifier } from '../../infrastructure/verifiers/apple-receipt.verifier';
import { GoogleReceiptVerifier } from '../../infrastructure/verifiers/google-receipt.verifier';

@Injectable()
export class VerifyReceiptUseCase {
  constructor(
    private readonly appleVerifier: AppleReceiptVerifier,
    private readonly googleVerifier: GoogleReceiptVerifier,
    @Inject('SubscriptionRepositoryPort')
    private readonly subscriptionRepository: SubscriptionRepositoryPort,
  ) {}

  async execute(dto: VerifyReceiptDto) {
    let verificationResult;

    if (dto.platform === 'ios') {
      verificationResult = await this.appleVerifier.verify(dto.receipt);
    } else {
      verificationResult = await this.googleVerifier.verify(
        dto.productId,
        dto.receipt, // purchaseToken
      );
    }

    if (!verificationResult.isValid) {
      throw new Error('Invalid receipt');
    }

    // 구독 정보 저장/업데이트
    await this.subscriptionRepository.upsert({
      userId: dto.userId,
      platform: dto.platform,
      productId: dto.productId,
      transactionId: dto.transactionId,
      expiresAt: verificationResult.expiresAt,
      isActive: true,
    });

    return { success: true, expiresAt: verificationResult.expiresAt };
  }
}
```

```typescript
// src/iap/infrastructure/verifiers/apple-receipt.verifier.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AppleReceiptVerifier {
  private readonly sharedSecret: string;

  constructor(private readonly config: ConfigService) {
    this.sharedSecret = this.config.getOrThrow('APPLE_SHARED_SECRET');
  }

  async verify(receiptData: string) {
    // 프로덕션 서버 먼저 시도
    let result = await this.verifyWithApple(
      'https://buy.itunes.apple.com/verifyReceipt',
      receiptData,
    );

    // 21007 에러면 샌드박스로 재시도
    if (result.status === 21007) {
      result = await this.verifyWithApple(
        'https://sandbox.itunes.apple.com/verifyReceipt',
        receiptData,
      );
    }

    if (result.status !== 0) {
      return { isValid: false };
    }

    const latestReceipt = result.latest_receipt_info?.[0];
    
    return {
      isValid: true,
      productId: latestReceipt?.product_id,
      transactionId: latestReceipt?.transaction_id,
      expiresAt: latestReceipt?.expires_date_ms 
        ? new Date(parseInt(latestReceipt.expires_date_ms))
        : null,
    };
  }

  private async verifyWithApple(url: string, receiptData: string) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        'receipt-data': receiptData,
        password: this.sharedSecret,
        'exclude-old-transactions': true,
      }),
    });

    return response.json();
  }
}
```

```typescript
// src/iap/infrastructure/verifiers/google-receipt.verifier.ts
import { Injectable } from '@nestjs/common';
import { google } from 'googleapis';

@Injectable()
export class GoogleReceiptVerifier {
  private androidPublisher;

  constructor() {
    const auth = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      scopes: ['https://www.googleapis.com/auth/androidpublisher'],
    });

    this.androidPublisher = google.androidpublisher({
      version: 'v3',
      auth,
    });
  }

  async verify(productId: string, purchaseToken: string) {
    try {
      // 구독 상품인 경우
      const response = await this.androidPublisher.purchases.subscriptions.get({
        packageName: process.env.ANDROID_PACKAGE_NAME,
        subscriptionId: productId,
        token: purchaseToken,
      });

      const data = response.data;

      return {
        isValid: data.paymentState === 1, // 1 = Received
        productId,
        transactionId: data.orderId,
        expiresAt: data.expiryTimeMillis 
          ? new Date(parseInt(data.expiryTimeMillis))
          : null,
      };
    } catch (error) {
      console.error('Google verification error:', error);
      return { isValid: false };
    }
  }
}
```

---

## 💳 외부 결제 (Stripe) - 실물 상품용

### 1. Stripe React Native 설정

```typescript
// app/_layout.tsx
import { StripeProvider } from '@stripe/stripe-react-native';

export default function RootLayout() {
  return (
    <StripeProvider
      publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY!}
      merchantIdentifier="merchant.com.myapp" // Apple Pay용
    >
      <Stack />
    </StripeProvider>
  );
}
```

### 2. 결제 시트 구현

```typescript
// src/hooks/use-stripe-payment.ts
import { useState } from 'react';
import { useStripe } from '@stripe/stripe-react-native';
import { Alert } from 'react-native';

export function useStripePayment() {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [isLoading, setIsLoading] = useState(false);

  const initializePayment = async (orderId: string) => {
    setIsLoading(true);

    try {
      // 1. 서버에서 PaymentIntent 생성
      const response = await fetch(`${API_URL}/payments/create-intent`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ orderId }),
      });

      const { clientSecret, ephemeralKey, customerId } = await response.json();

      // 2. Payment Sheet 초기화
      const { error: initError } = await initPaymentSheet({
        merchantDisplayName: 'My App',
        customerId,
        customerEphemeralKeySecret: ephemeralKey,
        paymentIntentClientSecret: clientSecret,
        allowsDelayedPaymentMethods: true,
        defaultBillingDetails: {
          name: 'User Name',
        },
        // Apple Pay 설정 (iOS)
        applePay: {
          merchantCountryCode: 'KR',
        },
        // Google Pay 설정 (Android)
        googlePay: {
          merchantCountryCode: 'KR',
          testEnv: __DEV__,
        },
      });

      if (initError) {
        throw initError;
      }

      return true;
    } catch (error) {
      console.error('Init payment error:', error);
      Alert.alert('오류', '결제 초기화에 실패했습니다.');
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  const presentPayment = async () => {
    const { error } = await presentPaymentSheet();

    if (error) {
      if (error.code === 'Canceled') {
        // 사용자가 취소
        return { success: false, canceled: true };
      }
      Alert.alert('결제 실패', error.message);
      return { success: false, canceled: false };
    }

    return { success: true, canceled: false };
  };

  return {
    initializePayment,
    presentPayment,
    isLoading,
  };
}
```

### 3. 결제 화면 컴포넌트

```typescript
// src/screens/checkout-screen.tsx
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useEffect, useState } from 'react';
import { useStripePayment } from '@/hooks/use-stripe-payment';
import { useRouter } from 'expo-router';

interface CheckoutScreenProps {
  orderId: string;
  totalAmount: number;
}

export function CheckoutScreen({ orderId, totalAmount }: CheckoutScreenProps) {
  const router = useRouter();
  const { initializePayment, presentPayment, isLoading } = useStripePayment();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    async function init() {
      const success = await initializePayment(orderId);
      setIsReady(success);
    }
    init();
  }, [orderId]);

  const handlePayment = async () => {
    const result = await presentPayment();
    
    if (result.success) {
      router.replace(`/orders/${orderId}/success`);
    }
  };

  return (
    <View className="flex-1 p-4">
      <View className="flex-1">
        {/* 주문 요약 */}
        <View className="bg-white p-4 rounded-xl">
          <Text className="text-lg font-semibold">주문 요약</Text>
          <View className="flex-row justify-between mt-4">
            <Text>총 결제 금액</Text>
            <Text className="font-bold">{totalAmount.toLocaleString()}원</Text>
          </View>
        </View>
      </View>

      {/* 결제 버튼 */}
      <TouchableOpacity
        onPress={handlePayment}
        disabled={!isReady || isLoading}
        className={`py-4 rounded-xl ${isReady ? 'bg-blue-600' : 'bg-gray-300'}`}
      >
        {isLoading ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text className="text-white text-center font-semibold text-lg">
            {totalAmount.toLocaleString()}원 결제하기
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
}
```

---

## 🔄 TossPayments 모바일 (WebView 방식)

토스페이먼츠는 React Native SDK를 공식 지원하지 않으므로 WebView 사용:

```typescript
// src/components/toss-payment-webview.tsx
import { WebView } from 'react-native-webview';
import { useRef } from 'react';

interface TossPaymentWebViewProps {
  orderId: string;
  orderName: string;
  amount: number;
  customerEmail: string;
  onSuccess: (paymentKey: string) => void;
  onFail: (error: string) => void;
}

export function TossPaymentWebView({
  orderId,
  orderName,
  amount,
  customerEmail,
  onSuccess,
  onFail,
}: TossPaymentWebViewProps) {
  const webViewRef = useRef<WebView>(null);

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <script src="https://js.tosspayments.com/v2/standard"></script>
    </head>
    <body>
      <div id="payment-widget"></div>
      <script>
        const clientKey = '${process.env.EXPO_PUBLIC_TOSS_CLIENT_KEY}';
        const customerKey = 'customer_${Date.now()}';
        
        async function initPayment() {
          const tossPayments = TossPayments(clientKey);
          const widgets = tossPayments.widgets({ customerKey });
          
          await widgets.setAmount({ currency: 'KRW', value: ${amount} });
          
          await Promise.all([
            widgets.renderPaymentMethods({
              selector: '#payment-widget',
              variantKey: 'DEFAULT',
            }),
          ]);
          
          // 자동으로 결제 요청
          await widgets.requestPayment({
            orderId: '${orderId}',
            orderName: '${orderName}',
            customerEmail: '${customerEmail}',
            successUrl: 'tosspay://success',
            failUrl: 'tosspay://fail',
          });
        }
        
        initPayment();
      </script>
    </body>
    </html>
  `;

  const handleNavigationStateChange = (navState: any) => {
    const { url } = navState;
    
    if (url.startsWith('tosspay://success')) {
      const params = new URLSearchParams(url.split('?')[1]);
      onSuccess(params.get('paymentKey') || '');
    } else if (url.startsWith('tosspay://fail')) {
      const params = new URLSearchParams(url.split('?')[1]);
      onFail(params.get('message') || 'Payment failed');
    }
  };

  return (
    <WebView
      ref={webViewRef}
      source={{ html }}
      onNavigationStateChange={handleNavigationStateChange}
      originWhitelist={['*', 'tosspay://*']}
      javaScriptEnabled
    />
  );
}
```

---

## ⚠️ 플랫폼 정책 주의사항

### Apple App Store
- 디지털 콘텐츠/서비스는 반드시 IAP 사용
- 구독 자동 갱신 정보 표시 필수
- "구매 복원" 버튼 필수

### Google Play Store
- 디지털 콘텐츠는 Google Play Billing 사용
- 실물 상품/서비스는 외부 결제 가능
- 구독 해지 방법 안내 필수

---

## 🔐 보안 체크리스트

- [ ] 서버에서 영수증/구매 토큰 검증
- [ ] 클라이언트 금액 신뢰하지 않음
- [ ] 구매 완료 후 finishTransaction 호출
- [ ] 중복 구매 방지 로직
- [ ] 구매 복원 기능 구현

---

*v1.0.0 | 2025-01-03*
